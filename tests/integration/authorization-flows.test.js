import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";
import { hashToken, sessionCookieName, setSqlForTests } from "../../netlify/functions/_auth-utils.js";
import { handler as usersHandler } from "../../netlify/functions/users.js";
import { handler as userHandler } from "../../netlify/functions/user.js";
import { handler as studentSignupHandler } from "../../netlify/functions/auth-student-signup.js";
import { handler as authMeHandler } from "../../netlify/functions/auth-me.js";
import { handler as lessonSubmitHandler } from "../../netlify/functions/lesson-submit.js";
import { handler as bookContentHandler } from "../../netlify/functions/book-content.js";
import { handler as courseHandler } from "../../netlify/functions/course.js";
import { handler as lessonHandler } from "../../netlify/functions/lesson.js";
import { handler as activityHandler } from "../../netlify/functions/activity.js";
import { handler as operationalHealthHandler } from "../../netlify/functions/operational-health.js";
import { countRelationshipIssues, relationshipChecks } from "../../scripts/_tenant-integrity-checks.mjs";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";

const testDatabaseUrl = process.env.TEST_DATABASE_URL || "";
const confirmedIsolated = process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";
const integrationEnabled = Boolean(testDatabaseUrl && confirmedIsolated);
const { Pool } = pg;

function postgresTemplate(pool) {
  const queryTemplate = (queryable) => async (strings, ...values) => {
    let text = strings[0];
    for (let index = 0; index < values.length; index += 1) {
      text += `$${index + 1}${strings[index + 1]}`;
    }
    return (await queryable.query(text, values)).rows;
  };
  const template = queryTemplate(pool);
  template.assignmentLifecycleTransaction = async (assignmentId, callback) => {
    const client = await pool.connect();
    const transactionSql = queryTemplate(client);
    try {
      await client.query("begin");
      await transactionSql`select pg_advisory_xact_lock(hashtextextended(${"activity-assignment:" + assignmentId}, 0))`;
      const result = await callback(transactionSql);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };
  return template;
}

function scopedDatabaseUrl(baseUrl, schema) {
  const url = new URL(baseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

function parseResponse(response) {
  return { status: response.statusCode, body: JSON.parse(response.body || "{}"), headers: response.headers || {} };
}

async function call(handler, { method = "GET", query = {}, body = {}, cookie = "", ip = "127.0.0.10" } = {}) {
  const rawQuery = new URLSearchParams(query).toString();
  return parseResponse(await handler({
    httpMethod: method,
    headers: { host: "localhost:8888", cookie, "x-nf-client-connection-ip": ip },
    queryStringParameters: query,
    rawQuery,
    body: method === "GET" ? "" : JSON.stringify(body),
  }));
}

async function createSession(pool, userId) {
  const token = randomBytes(24).toString("hex");
  await pool.query(
    "insert into auth_sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')",
    [userId, hashToken(token)],
  );
  return `${sessionCookieName}=${token}`;
}

async function insertUser(pool, { schoolId, name, email, role, status = "active" }) {
  const passwordHash = await bcrypt.hash("integration-password", 4);
  const result = await pool.query(
    `insert into app_users (school_id, full_name, email, role, status, password_hash, auth_provider)
     values ($1, $2, $3, $4, $5, $6, 'password') returning id`,
    [schoolId, name, email, role, status, passwordHash],
  );
  return result.rows[0].id;
}

test("handler-level authorization flows preserve tenant and resource state", { skip: !integrationEnabled, timeout: 120_000 }, async (t) => {
  assert.notEqual(testDatabaseUrl, process.env.DATABASE_URL, "TEST_DATABASE_URL must not equal DATABASE_URL");
  const schema = `hhplms_test_${randomBytes(6).toString("hex")}`;
  const adminPool = new Pool({ connectionString: testDatabaseUrl });
  await adminPool.query(`create schema "${schema}"`);
  const scopedUrl = scopedDatabaseUrl(testDatabaseUrl, schema);
  const pool = new Pool({ connectionString: scopedUrl });
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = scopedUrl;
  setSqlForTests(postgresTemplate(pool));

  t.after(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    setSqlForTests(null);
    await pool.end();
    await adminPool.query(`drop schema if exists "${schema}" cascade`);
    await adminPool.end();
  });

  await applyCanonicalProductionMigrations(pool);

  const schools = await pool.query(
    `insert into schools (name) values ('Integration School A'), ('Integration School B') returning id, name`,
  );
  const schoolA = schools.rows.find((row) => row.name.endsWith("A")).id;
  const schoolB = schools.rows.find((row) => row.name.endsWith("B")).id;
  const adminId = await insertUser(pool, { schoolId: schoolA, name: "Admin A", email: "admin-a@integration.test", role: "admin" });
  const otherAdminId = await insertUser(pool, { schoolId: schoolB, name: "Admin B", email: "admin-b@integration.test", role: "admin" });
  const teacherId = await insertUser(pool, { schoolId: schoolA, name: "Teacher A", email: "teacher-a@integration.test", role: "teacher" });
  const otherTeacherId = await insertUser(pool, { schoolId: schoolB, name: "Teacher B", email: "teacher-b@integration.test", role: "teacher" });
  const studentId = await insertUser(pool, { schoolId: schoolA, name: "Student A", email: "student-a@integration.test", role: "student" });
  const pausedStudentId = await insertUser(pool, { schoolId: schoolA, name: "Paused Student", email: "paused@integration.test", role: "student", status: "paused" });
  const adminCookie = await createSession(pool, adminId);
  const otherAdminCookie = await createSession(pool, otherAdminId);
  const teacherCookie = await createSession(pool, teacherId);
  const otherTeacherCookie = await createSession(pool, otherTeacherId);
  const studentCookie = await createSession(pool, studentId);
  const pausedCookie = await createSession(pool, pausedStudentId);

  await t.test("protected native answer GET and HEAD reject anonymous, Student role forgery and unlicensed Teachers", async () => {
    const query = { action: "published-native-answer-asset", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", activityId: "ultimate-b2-sb-u1-p1-o902", releaseId: "30000000-0000-4000-8000-000000000001", role: "teacher", audience: "teacher" };
    for (const method of ["GET", "HEAD"]) {
      for (const [cookie, expected] of [["", 401], [studentCookie, 403], [otherTeacherCookie, 403]]) {
        const response = await call(bookContentHandler, { method, query, cookie });
        assert.equal(response.status, expected, JSON.stringify(response));
        assert.equal(response.headers.Location, undefined);
        assert.doesNotMatch(JSON.stringify(response.body), /object_key|teacher-answers\/|native_teacher_answer|sampleAnswer/);
      }
    }
  });

  await t.test("operational health reports the migrated isolated database without identifiers", async () => {
    const health = await call(operationalHealthHandler);
    assert.equal(health.status, 200);
    assert.equal(health.body.status, "ok");
    assert.equal(health.body.database, "ok");
    assert.equal(typeof health.body.build, "string");
  });

  await t.test("users GET/POST/PATCH/DELETE remain school-scoped", async () => {
    const created = await call(usersHandler, {
      method: "POST", cookie: adminCookie,
      body: { full_name: "Disposable Teacher", email: "disposable@integration.test", role: "teacher", status: "active", password: "password123" },
    });
    assert.equal(created.status, 201);
    const disposableId = created.body.user.id;
    const listed = await call(usersHandler, { cookie: adminCookie });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.users.some((user) => user.id === otherTeacherId), false);
    const patched = await call(userHandler, { method: "PATCH", cookie: adminCookie, query: { id: disposableId }, body: { status: "paused" } });
    assert.equal(patched.status, 200);
    assert.equal((await pool.query("select status from app_users where id = $1", [disposableId])).rows[0].status, "paused");
    const deleted = await call(userHandler, { method: "DELETE", cookie: adminCookie, query: { id: disposableId } });
    assert.equal(deleted.status, 200);
    assert.equal((await pool.query("select count(*)::int as count from app_users where id = $1", [disposableId])).rows[0].count, 0);
  });

  const publisher = (await pool.query("insert into publishers (name, slug) values ('Integration Publisher', $1) returning id", [`publisher-${schema}`])).rows[0];
  const bookPackage = (await pool.query(
    "insert into book_packages (publisher_id, title, slug, level, status) values ($1, 'Integration Book', $2, 'B2', 'active') returning id, slug",
    [publisher.id, `book-${schema}`],
  )).rows[0];
  const classA = (await pool.query(
    `insert into classes (school_id, teacher_id, name, level, slug, assigned_book, book_package_id, invite_code, status)
     values ($1, $2, 'Class A', 'B2', $3, 'Integration Book', $4, 'VALIDA12', 'active') returning id`,
    [schoolA, teacherId, `class-a-${schema}`, bookPackage.id],
  )).rows[0];
  const classB = (await pool.query(
    `insert into classes (school_id, teacher_id, name, level, slug, invite_code, status)
     values ($1, $2, 'Class B', 'B2', $3, 'VALIDB12', 'active') returning id`,
    [schoolB, otherTeacherId, `class-b-${schema}`],
  )).rows[0];
  await pool.query(
    `insert into classes (school_id, teacher_id, name, level, slug, invite_code, status)
     values ($1, $2, 'Inactive', 'B2', $3, 'INACT123', 'archived')`,
    [schoolA, teacherId, `inactive-${schema}`],
  );
  await pool.query("insert into class_students (class_id, student_id, status) values ($1, $2, 'active')", [classA.id, studentId]);

  await t.test("book package trees honor teacher, student, admin, and cross-school entitlement boundaries", async () => {
    const classEntitledTeacher = await call(bookContentHandler, {
      cookie: teacherCookie,
      query: { action: "tree", slug: bookPackage.slug },
    });
    assert.equal(classEntitledTeacher.status, 200);

    const unentitledTeacher = await call(bookContentHandler, {
      cookie: otherTeacherCookie,
      query: { action: "tree", slug: bookPackage.slug },
    });
    assert.equal(unentitledTeacher.status, 403);

    const classMembershipDoesNotChangeStudentPolicy = await call(bookContentHandler, {
      cookie: studentCookie,
      query: { action: "tree", slug: bookPackage.slug },
    });
    assert.equal(classMembershipDoesNotChangeStudentPolicy.status, 403);

    const ownSchoolAdmin = await call(bookContentHandler, {
      cookie: adminCookie,
      query: { action: "tree", slug: bookPackage.slug },
    });
    assert.equal(ownSchoolAdmin.status, 200);

    const explicitTeacherId = await insertUser(pool, {
      schoolId: schoolA,
      name: "Explicit Teacher",
      email: "explicit-teacher@integration.test",
      role: "teacher",
    });
    const explicitTeacherCookie = await createSession(pool, explicitTeacherId);
    await pool.query(
      "insert into book_access (user_id, book_package_id, role_scope) values ($1, $2, 'teacher')",
      [explicitTeacherId, bookPackage.id],
    );
    assert.equal((await call(bookContentHandler, {
      cookie: explicitTeacherCookie,
      query: { action: "tree", slug: bookPackage.slug },
    })).status, 200);

    const foreignPackage = (await pool.query(
      "insert into book_packages (publisher_id, title, slug, level, status) values ($1, 'Foreign School Book', $2, 'B2', 'active') returning id, slug",
      [publisher.id, `foreign-book-${schema}`],
    )).rows[0];
    await pool.query("update classes set book_package_id = $1 where id = $2", [foreignPackage.id, classB.id]);
    assert.equal((await call(bookContentHandler, {
      cookie: otherTeacherCookie,
      query: { action: "tree", slug: foreignPackage.slug },
    })).status, 200);
    assert.equal((await call(bookContentHandler, {
      cookie: teacherCookie,
      query: { action: "tree", slug: foreignPackage.slug },
    })).status, 403);
    assert.equal((await call(bookContentHandler, {
      cookie: adminCookie,
      query: { action: "tree", slug: foreignPackage.slug },
    })).status, 403);
  });

  await t.test("signup and joining require active invite codes and are atomic", async () => {
    assert.equal((await call(bookContentHandler, { query: { action: "class-by-slug", slug: `class-a-${schema}` } })).status, 404);
    assert.equal((await call(bookContentHandler, { query: { action: "class-by-invite", inviteCode: "INACT123" } })).status, 404);
    const inviteAttemptsBeforePolicyFailures = (await pool.query("select count(*)::int count from class_invite_attempts")).rows[0].count;
    const policyFailures = [
      { email: "nine-character@integration.test", password: "NineChars" },
      { email: "too-long@integration.test", password: "x".repeat(129) },
      { email: "whitespace@integration.test", password: " ".repeat(10) },
      { email: "equal-password@integration.test", password: "EQUAL-PASSWORD@INTEGRATION.TEST" },
      { email: "demo-password@integration.test", password: "password123" },
    ];
    for (const [index, policyCase] of policyFailures.entries()) {
      const response = await call(studentSignupHandler, {
        method: "POST", ip: `127.0.0.${30 + index}`,
        body: { fullName: "Rejected Policy Student", classCode: "VALIDA12", ...policyCase },
      });
      assert.equal(response.status, 400);
      assert.equal(response.headers["Set-Cookie"], undefined);
      assert.equal((await pool.query("select count(*)::int count from app_users where email=$1", [policyCase.email])).rows[0].count, 0);
    }
    assert.equal((await pool.query("select count(*)::int count from class_invite_attempts")).rows[0].count, inviteAttemptsBeforePolicyFailures);

    const invalidEmail = "invalid-invite@integration.test";
    const invalid = await call(studentSignupHandler, {
      method: "POST", ip: "127.0.0.20",
      body: { fullName: "Invalid", email: invalidEmail, password: "Invalid-Invite-2026!", classCode: `class-a-${schema}` },
    });
    assert.equal(invalid.status, 400);
    assert.equal((await pool.query("select count(*)::int as count from app_users where email = $1", [invalidEmail])).rows[0].count, 0);

    for (const [field, value] of [["classId", classA.id], ["classSlug", `class-a-${schema}`]]) {
      const injectedEmail = `${field.toLowerCase()}-injection@integration.test`;
      const injected = await call(studentSignupHandler, {
        method: "POST", ip: field === "classId" ? "127.0.0.41" : "127.0.0.42",
        body: { fullName: "Injection Rejected", email: injectedEmail, password: "Safe-Injection-2026!", classCode: "VALIDA12", [field]: value },
      });
      assert.equal(injected.status, 400);
      assert.equal((await pool.query("select count(*)::int count from app_users where email=$1", [injectedEmail])).rows[0].count, 0);
    }

    const signup = await call(studentSignupHandler, {
      method: "POST", ip: "127.0.0.21",
      body: {
        fullName: "New Student",
        email: "new-student@integration.test",
        password: "TenChars1!",
        classCode: "VALIDA12",
        schoolId: schoolB,
        school_id: schoolB,
        role: "teacher",
        status: "invited",
      },
    });
    assert.equal(signup.status, 201);
    assert.match(signup.headers["Set-Cookie"], new RegExp(`^${sessionCookieName}=`));
    assert.equal(signup.body.joinedClass.inviteCode, undefined);
    const newStudentId = signup.body.user.id;
    const storedStudent = (await pool.query("select school_id,role,status,password_hash from app_users where id=$1", [newStudentId])).rows[0];
    assert.equal(storedStudent.school_id, schoolA);
    assert.equal(storedStudent.role, "student");
    assert.equal(storedStudent.status, "active");
    assert.match(storedStudent.password_hash, /^\$2[aby]\$12\$/);
    assert.equal((await pool.query("select count(*)::int as count from class_students where class_id = $1 and student_id = $2", [classA.id, newStudentId])).rows[0].count, 1);
    assert.equal((await pool.query("select count(*)::int as count from class_students where class_id = $1 and student_id = $2", [classB.id, newStudentId])).rows[0].count, 0);
    assert.equal((await pool.query("select count(*)::int count from auth_sessions where user_id=$1", [newStudentId])).rows[0].count, 1);
    const newStudentCookie = signup.headers["Set-Cookie"].split(";")[0];
    const currentStudent = await call(authMeHandler, { cookie: newStudentCookie });
    assert.equal(currentStudent.status, 200);
    assert.equal(currentStudent.body.user.id, newStudentId);
    assert.equal(currentStudent.body.user.school_id, schoolA);
    assert.equal((await call(userHandler, { cookie: newStudentCookie, query: { id: otherTeacherId } })).status, 403);

    for (const [email, password, ip] of [
      ["max-length@integration.test", "x".repeat(128), "127.0.0.43"],
      ["unicode-passphrase@integration.test", "ασφαλής κωδικός 2026", "127.0.0.44"],
    ]) {
      const boundarySignup = await call(studentSignupHandler, {
        method: "POST", ip,
        body: { fullName: "Boundary Student", email, password, classCode: "VALIDA12" },
      });
      assert.equal(boundarySignup.status, 201);
      assert.equal((await pool.query(
        "select count(*)::int count from class_students cs join app_users u on u.id=cs.student_id where cs.class_id=$1 and u.email=$2",
        [classA.id, email],
      )).rows[0].count, 1);
    }

    const duplicate = await call(studentSignupHandler, {
      method: "POST", ip: "127.0.0.45",
      body: { fullName: "Duplicate Student", email: "new-student@integration.test", password: "Another-Safe-2026!", classCode: "VALIDA12" },
    });
    assert.equal(duplicate.status, 409);
    assert.equal((await pool.query("select count(*)::int count from app_users where email='new-student@integration.test'")).rows[0].count, 1);
    assert.equal((await pool.query("select count(*)::int count from class_students where student_id=$1", [newStudentId])).rows[0].count, 1);

    const slugJoin = await call(bookContentHandler, { method: "POST", cookie: studentCookie, query: { action: "join-class" }, body: { slug: `class-a-${schema}` } });
    assert.equal(slugJoin.status, 400);
    const crossSchool = await call(bookContentHandler, { method: "POST", cookie: studentCookie, query: { action: "join-class" }, body: { inviteCode: "VALIDB12" }, ip: "127.0.0.22" });
    assert.equal(crossSchool.status, 403);
    assert.equal((await pool.query("select count(*)::int as count from class_students where class_id = $1 and student_id = $2", [classB.id, studentId])).rows[0].count, 0);
  });

  const courseA = (await pool.query("insert into courses (school_id, title, status) values ($1, 'Course A', 'active') returning id", [schoolA])).rows[0];
  const courseB = (await pool.query("insert into courses (school_id, title, status) values ($1, 'Course B', 'active') returning id", [schoolB])).rows[0];
  const assignedLesson = (await pool.query("insert into lessons (course_id, school_id, title, status) values ($1, $2, 'Assigned Lesson', 'published') returning id", [courseA.id, schoolA])).rows[0];
  const unassignedLesson = (await pool.query("insert into lessons (course_id, school_id, title, status) values ($1, $2, 'Unassigned Lesson', 'published') returning id", [courseA.id, schoolA])).rows[0];
  const foreignLesson = (await pool.query("insert into lessons (course_id, school_id, title, status) values ($1, $2, 'Foreign Lesson', 'published') returning id", [courseB.id, schoolB])).rows[0];
  await pool.query(
    `insert into lesson_activities (lesson_id, school_id, type, title, content, correct_answers, ownership_type)
     values ($1, $2, 'multiple_choice', 'Question', '{"questions":[{"id":"q1","prompt":"Pick"}]}', '{"q1":"yes"}', 'official')`,
    [assignedLesson.id, schoolA],
  );
  await pool.query(
    "insert into lesson_assignments (school_id, lesson_id, assigned_by, student_id, status) values ($1, $2, $3, $4, 'assigned')",
    [schoolA, assignedLesson.id, teacherId, studentId],
  );

  await t.test("lesson submission requires explicit access and session-derived student", async () => {
    const assigned = await call(lessonSubmitHandler, { method: "POST", cookie: studentCookie, body: { lesson_id: assignedLesson.id, answers: {} } });
    assert.equal(assigned.status, 200);
    const stored = (await pool.query("select student_id from lesson_submissions where lesson_id = $1", [assignedLesson.id])).rows[0];
    assert.equal(stored.student_id, studentId);
    assert.equal((await call(lessonSubmitHandler, { method: "POST", cookie: studentCookie, body: { lesson_id: unassignedLesson.id, answers: {} } })).status, 404);
    assert.equal((await call(lessonSubmitHandler, { method: "POST", cookie: studentCookie, body: { lesson_id: foreignLesson.id, answers: {} } })).status, 404);
    assert.equal((await call(lessonSubmitHandler, { method: "POST", cookie: studentCookie, body: { lesson_id: assignedLesson.id, student_id: pausedStudentId, answers: {} } })).status, 403);
    assert.equal((await call(lessonSubmitHandler, { method: "POST", cookie: pausedCookie, body: { lesson_id: assignedLesson.id, answers: {} } })).status, 401);
    assert.equal((await pool.query("select count(*)::int as count from lesson_submissions where lesson_id = $1", [assignedLesson.id])).rows[0].count, 1);
  });

  await t.test("master content is admin-editable while teachers own only custom activities", async () => {
    assert.equal((await call(courseHandler, { method: "PATCH", cookie: teacherCookie, body: { title: "Teacher overwrite" } })).status, 403);
    assert.equal((await call(courseHandler, { method: "PATCH", cookie: adminCookie, body: { title: "Admin Course" } })).status, 200);
    assert.equal((await pool.query("select title from courses where id = $1", [courseA.id])).rows[0].title, "Admin Course");
    assert.equal((await call(lessonHandler, { method: "PATCH", cookie: teacherCookie, query: { id: assignedLesson.id }, body: { title: "Teacher overwrite" } })).status, 403);
    assert.equal((await call(lessonHandler, { method: "PATCH", cookie: adminCookie, query: { id: assignedLesson.id }, body: { title: "Admin Lesson" } })).status, 200);
    const created = await call(activityHandler, {
      method: "POST", cookie: teacherCookie,
      body: { lesson_id: assignedLesson.id, type: "multiple_choice", title: "Teacher Custom", content: { questions: [] }, correct_answers: {} },
    });
    assert.equal(created.status, 200);
    const customActivity = (await pool.query("select id, ownership_type, created_by from lesson_activities where title = 'Teacher Custom' and lesson_id = $1", [assignedLesson.id])).rows[0];
    assert.equal(customActivity.ownership_type, "custom");
    assert.equal(customActivity.created_by, teacherId);
    assert.equal((await call(activityHandler, { method: "PATCH", cookie: teacherCookie, query: { id: customActivity.id }, body: { title: "Teacher Updated" } })).status, 200);
  });

  const component = (await pool.query("insert into book_components (book_package_id, title, slug, component_type) values ($1, 'Book', $2, 'students_book') returning id", [bookPackage.id, `component-${schema}`])).rows[0];
  const unit = (await pool.query("insert into units (book_component_id, title, slug) values ($1, 'Unit', $2) returning id", [component.id, `unit-${schema}`])).rows[0];
  const bookLesson = (await pool.query("insert into lessons (unit_id, title, slug, status) values ($1, 'Book Lesson', $2, 'published') returning id", [unit.id, `lesson-${schema}`])).rows[0];
  const activity = (await pool.query(
    `insert into activities (school_id, lesson_id, title, type, slug, activity_type, content, content_json, ownership_type)
     values ($1, $2, 'Book Activity', 'multiple_choice', $3, 'multiple_choice', '{}', '{}', 'official') returning id`,
    [schoolA, bookLesson.id, `activity-${schema}`],
  )).rows[0];
  const question = (await pool.query("insert into questions (activity_id, question_number, prompt, question_type, feedback_json) values ($1, 1, 'Answer yes', 'multiple_choice', '{\"acceptedAnswers\":[\"affirmative\"]}') returning id", [activity.id])).rows[0];
  await pool.query("insert into question_options (question_id, option_label, option_text, is_correct) values ($1, 'A', 'yes', true), ($1, 'B', 'no', false)", [question.id]);
  await pool.query("insert into book_access (user_id, book_package_id, role_scope) values ($1, $2, 'teacher')", [teacherId, bookPackage.id]);

  await t.test("dashboard metrics use session-scoped tenant data, distinct memberships, and latest submissions", async () => {
    const metricsActivity = (await pool.query(
      `insert into activities (school_id, lesson_id, title, type, slug, activity_type, content, content_json, ownership_type)
       values ($1, $2, 'Metrics Activity', 'multiple_choice', $3, 'multiple_choice', '{}', '{}', 'official') returning id`,
      [schoolA, bookLesson.id, `metrics-activity-${schema}`],
    )).rows[0];
    const secondStudentId = await insertUser(pool, {
      schoolId: schoolA,
      name: "Second Student",
      email: `second-student-${schema}@integration.test`,
      role: "student",
    });
    const zeroStudentId = await insertUser(pool, {
      schoolId: schoolA,
      name: "New Student",
      email: `new-student-${schema}@integration.test`,
      role: "student",
    });
    const zeroStudentCookie = await createSession(pool, zeroStudentId);
    await pool.query(
      "insert into book_access (user_id, book_package_id, role_scope) values ($1, $2, 'student')",
      [studentId, bookPackage.id],
    );
    const alphaClass = (await pool.query(
      `insert into classes (school_id, teacher_id, name, level, slug, invite_code, status)
       values ($1, $2, 'Alpha Class', 'B1', $3, 'ALPHA123', 'active') returning id`,
      [schoolA, teacherId, `alpha-${schema}`],
    )).rows[0];
    await pool.query(
      `insert into class_students (class_id, student_id, status)
       values ($1, $2, 'active'), ($1, $3, 'active')`,
      [alphaClass.id, studentId, secondStudentId],
    );

    const assignments = (await pool.query(
      `insert into activity_assignments (school_id, activity_id, teacher_id, class_id, student_id, status, title)
       values
         ($1, $2, $3, $4, null, 'assigned', 'Scored class work'),
         ($1, $2, $3, null, $5, 'assigned', 'Direct work'),
         ($1, $2, $3, $4, null, 'assigned', 'Unscored work'),
         ($1, $2, $3, $4, null, 'assigned', 'Pending work'),
         ($1, $2, $3, $4, null, 'closed', 'Closed work')
       returning id, title`,
      [schoolA, metricsActivity.id, teacherId, classA.id, studentId],
    )).rows;
    const assignmentId = (title) => assignments.find((row) => row.title === title).id;
    await pool.query(
      `insert into activity_submissions
         (school_id, activity_id, activity_assignment_id, student_id, answers, score, score_percent, status, submitted_at)
       values
         ($1, $2, $3, $4, '{}', 100, 100, 'submitted', now() - interval '2 hours'),
         ($1, $2, $3, $4, '{}', 0, 0, 'submitted', now() - interval '1 hour'),
         ($1, $2, $5, $4, '{}', 80, 80, 'submitted', now()),
         ($1, $2, $6, $4, '{}', null, null, 'awaiting_review', now())`,
      [
        schoolA,
        metricsActivity.id,
        assignmentId("Scored class work"),
        studentId,
        assignmentId("Direct work"),
        assignmentId("Unscored work"),
      ],
    );
    await pool.query(
      `insert into activity_assignments (school_id, activity_id, teacher_id, student_id, status, title)
       values ($1, $2, $3, $4, 'assigned', 'Foreign assignment')`,
      [schoolB, metricsActivity.id, otherTeacherId, studentId],
    );

    const teacherMetrics = await call(bookContentHandler, {
      cookie: teacherCookie,
      query: { action: "dashboard-metrics" },
    });
    assert.equal(teacherMetrics.status, 200);
    assert.deepEqual(teacherMetrics.body, {
      role: "teacher",
      metrics: {
        activeBookPackages: 1,
        activeBookComponents: 1,
        activeClasses: 2,
        activeStudents: 5,
        activeAssignments: 4,
      },
    });

    const studentMetrics = await call(bookContentHandler, {
      cookie: studentCookie,
      query: { action: "dashboard-metrics" },
    });
    assert.equal(studentMetrics.status, 200);
    assert.deepEqual(studentMetrics.body, {
      role: "student",
      metrics: {
        activeBookPackages: 1,
        activeBookComponents: 1,
        pendingAssignments: 1,
        completedAssignments: 3,
        scoredAssignments: 2,
        averageScore: 40,
      },
      profile: {
        schoolName: "Integration School A",
        classNames: ["Alpha Class", "Class A"],
        primaryClassName: "Alpha Class",
        level: "B1",
      },
    });
    assert.equal(studentMetrics.headers["Cache-Control"], "private, no-store");
    assert.equal(studentMetrics.headers.Vary, "Cookie");

    const otherTeacherMetrics = await call(bookContentHandler, {
      cookie: otherTeacherCookie,
      query: { action: "dashboard-metrics" },
    });
    assert.deepEqual(otherTeacherMetrics.body, {
      role: "teacher",
      metrics: {
        activeBookPackages: 1,
        activeBookComponents: 0,
        activeClasses: 1,
        activeStudents: 0,
        activeAssignments: 1,
      },
    });

    const emptyMetrics = await call(bookContentHandler, {
      cookie: zeroStudentCookie,
      query: { action: "dashboard-metrics" },
    });
    assert.deepEqual(emptyMetrics.body.metrics, {
      activeBookPackages: 0,
      activeBookComponents: 0,
      pendingAssignments: 0,
      completedAssignments: 0,
      scoredAssignments: 0,
      averageScore: null,
    });
    assert.deepEqual(emptyMetrics.body.profile, {
      schoolName: "Integration School A",
      classNames: [],
      primaryClassName: null,
      level: null,
    });
  });

  await t.test("assignment, results, review, hotspots and custom activities enforce owner/tenant", async () => {
    const createdAssignment = await call(bookContentHandler, {
      method: "POST", cookie: teacherCookie, query: { action: "create-assignment" },
      body: { activityId: activity.id, classId: classA.id, title: "Assigned work", idempotencyKey: `assignment-${schema}-a` },
    });
    assert.equal(createdAssignment.status, 200);
    const assignmentId = createdAssignment.body.assignment.id;
    const repeatedAssignment = await call(bookContentHandler, {
      method: "POST", cookie: teacherCookie, query: { action: "create-assignment" },
      body: { activityId: activity.id, classId: classA.id, title: "Assigned work", idempotencyKey: `assignment-${schema}-a` },
    });
    assert.equal(repeatedAssignment.status, 200);
    assert.equal(repeatedAssignment.body.assignment.id, assignmentId);
    assert.equal(Number((await pool.query(
      "select count(*) as count from activity_assignments where teacher_id = $1 and activity_id = $2 and class_id = $3",
      [teacherId, activity.id, classA.id],
    )).rows[0].count), 1);
    assert.equal((await pool.query("select school_id from activity_assignments where id = $1", [assignmentId])).rows[0].school_id, schoolA);
    const visibleAssignments = await call(bookContentHandler, { cookie: studentCookie, query: { action: "assignments" } });
    assert.equal(visibleAssignments.status, 200);
    const visibleAssignment = visibleAssignments.body.assignments.find((item) => item.assignmentId === assignmentId);
    assert.equal(visibleAssignment.activity.questions[0].id, question.id);
    const escalated = await call(bookContentHandler, { method: "POST", cookie: studentCookie, query: { action: "create-assignment" }, body: { activityId: activity.id, classId: classA.id } });
    assert.equal(escalated.status, 403);
    const rejectedClientScore = await call(bookContentHandler, {
      method: "POST", cookie: studentCookie, query: { action: "submit" },
      body: { activityId: activity.id, assignmentId, studentId: studentId, score: 0, result: { answers: { [question.id]: "affirmative" } } },
    });
    assert.equal(rejectedClientScore.status, 400);
    assert.match(rejectedClientScore.body.error, /score fields/i);
    const submitted = await call(bookContentHandler, {
      method: "POST", cookie: studentCookie, query: { action: "submit" },
      body: { activityId: activity.id, assignmentId, studentId: studentId, answers: { [question.id]: "affirmative" } },
    });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.submission.scorePercent, 100);
    const submissionId = submitted.body.submission.id;
    const duplicateSubmission = await call(bookContentHandler, {
      method: "POST", cookie: studentCookie, query: { action: "submit" },
      body: { activityId: activity.id, assignmentId, result: { answers: { [question.id]: "affirmative" } } },
    });
    assert.equal(duplicateSubmission.status, 409);
    const results = await call(bookContentHandler, { cookie: teacherCookie, query: { action: "assignment-results", assignmentId } });
    assert.equal(results.status, 200);
    const submittedRow = results.body.rows.find((row) => row.studentId === studentId);
    assert.equal(submittedRow?.submissionId, submissionId);
    assert.equal(submittedRow?.submissionStatus, "submitted");
    assert.deepEqual(submittedRow?.answers, { [question.id]: "affirmative" });
    assert.equal(submittedRow?.answerDetails?.[0]?.prompt, "Answer yes");
    assert.equal(submittedRow?.answerDetails?.[0]?.answer, "affirmative");

    const reassigned = await call(bookContentHandler, {
      method: "POST", cookie: teacherCookie, query: { action: "create-assignment" },
      body: { activityId: activity.id, classId: classA.id, title: "Assigned work", idempotencyKey: `assignment-${schema}-b` },
    });
    assert.equal(reassigned.status, 200);
    const reassignmentId = reassigned.body.assignment.id;
    assert.notEqual(reassignmentId, assignmentId);
    const resubmitted = await call(bookContentHandler, {
      method: "POST", cookie: studentCookie, query: { action: "submit" },
      body: { activityId: activity.id, assignmentId: reassignmentId, result: { answers: { [question.id]: "affirmative" } } },
    });
    assert.equal(resubmitted.status, 200);
    assert.notEqual(resubmitted.body.submission.id, submissionId);
    const reassignmentResults = await call(bookContentHandler, { cookie: teacherCookie, query: { action: "assignment-results", assignmentId: reassignmentId } });
    assert.equal(reassignmentResults.body.rows.find((row) => row.studentId === studentId)?.submissionId, resubmitted.body.submission.id);
    const originalResultsAgain = await call(bookContentHandler, { cookie: teacherCookie, query: { action: "assignment-results", assignmentId } });
    assert.equal(originalResultsAgain.body.rows.find((row) => row.studentId === studentId)?.submissionId, submissionId);
    assert.equal((await call(bookContentHandler, { cookie: otherTeacherCookie, query: { action: "assignment-results", assignmentId } })).status, 403);
    const reviewed = await call(bookContentHandler, { method: "POST", cookie: teacherCookie, query: { action: "review-submission" }, body: { submissionId, teacherFeedback: "Good" } });
    assert.equal(reviewed.status, 200);
    assert.equal((await pool.query("select teacher_feedback from activity_submissions where id = $1", [submissionId])).rows[0].teacher_feedback, "Good");

    const reviewActivity = (await pool.query(
      `insert into activities (school_id, lesson_id, title, type, slug, activity_type, content, content_json, ownership_type)
       values ($1, $2, 'Reviewed response', 'writing', $3, 'teacher_reviewed_response', '{}', '{"implementationMode":"teacher-reviewed"}', 'official')
       returning id`,
      [schoolA, bookLesson.id, `review-${schema}`],
    )).rows[0];
    const reviewQuestion = (await pool.query(
      "insert into questions (activity_id, question_number, prompt, question_type) values ($1, 1, 'Write a response', 'long_text') returning id",
      [reviewActivity.id],
    )).rows[0];
    const reviewAssignmentResponse = await call(bookContentHandler, {
      method: "POST", cookie: teacherCookie, query: { action: "create-assignment" },
      body: { activityId: reviewActivity.id, classId: classA.id, title: "Writing task" },
    });
    assert.equal(reviewAssignmentResponse.status, 200);
    const reviewSubmissionResponse = await call(bookContentHandler, {
      method: "POST", cookie: studentCookie, query: { action: "submit" },
      body: {
        activityId: reviewActivity.id,
        assignmentId: reviewAssignmentResponse.body.assignment.id,
        answers: { [reviewQuestion.id]: "My evidence-backed response." },
      },
    });
    assert.equal(reviewSubmissionResponse.status, 200);
    assert.equal(reviewSubmissionResponse.body.submission.status, "awaiting_review");
    assert.equal(reviewSubmissionResponse.body.submission.scorePercent, null);
    const pendingSubmissionId = reviewSubmissionResponse.body.submission.id;
    const scoreRequired = await call(bookContentHandler, {
      method: "POST", cookie: teacherCookie, query: { action: "review-submission" },
      body: { submissionId: pendingSubmissionId, teacherFeedback: "Please add evidence." },
    });
    assert.equal(scoreRequired.status, 400);
    const completedReview = await call(bookContentHandler, {
      method: "POST", cookie: teacherCookie, query: { action: "review-submission" },
      body: { submissionId: pendingSubmissionId, scorePercent: 82, teacherFeedback: "Clear response." },
    });
    assert.equal(completedReview.status, 200);
    assert.equal(completedReview.body.submission.status, "reviewed");
    assert.equal(completedReview.body.submission.scorePercent, 82);
    const studentGrades = await call(bookContentHandler, { cookie: studentCookie, query: { action: "grades" } });
    const reviewedGrade = studentGrades.body.grades.find((grade) => grade.id === pendingSubmissionId);
    assert.equal(reviewedGrade.status, "reviewed");
    assert.equal(reviewedGrade.scorePercent, 82);
    assert.equal(reviewedGrade.teacherFeedback, "Clear response.");

    const expiredAssignmentResponse = await call(bookContentHandler, {
      method: "POST", cookie: teacherCookie, query: { action: "create-assignment" },
      body: { activityId: activity.id, classId: classA.id, title: "Expired work", dueAt: "2020-01-01T00:00:00.000Z" },
    });
    assert.equal(expiredAssignmentResponse.status, 200);
    const expiredSubmission = await call(bookContentHandler, {
      method: "POST", cookie: studentCookie, query: { action: "submit" },
      body: {
        activityId: activity.id,
        assignmentId: expiredAssignmentResponse.body.assignment.id,
        answers: { [question.id]: "affirmative" },
      },
    });
    assert.equal(expiredSubmission.status, 403);
    assert.match(expiredSubmission.body.error, /deadline/i);
    const hotspot = await call(bookContentHandler, {
      method: "POST", cookie: teacherCookie, query: { action: "save-page-hotspots" },
      body: { packageSlug: bookPackage.slug, componentSlug: `component-${schema}`, pageId: "1", hotspots: [{ label: "Open", left: 10, top: 10, width: 10, height: 10, actionType: "none" }] },
    });
    assert.equal(hotspot.status, 200);
    assert.equal((await pool.query("select created_by, school_id from book_page_hotspots where id = $1", [hotspot.body.hotspots[0].id])).rows[0].created_by, teacherId);
    const custom = await call(bookContentHandler, {
      method: "POST", cookie: teacherCookie, query: { action: "create-book-activity" },
      body: { packageSlug: bookPackage.slug, componentSlug: `component-${schema}`, pageId: "1", title: "Custom", type: "open_answer" },
    });
    assert.equal(custom.status, 200);
    const customId = custom.body.activity.id;
    const tamper = await call(bookContentHandler, {
      method: "POST", cookie: otherTeacherCookie, query: { action: "update-book-activity" },
      body: { activityId: customId, title: "Stolen" },
    });
    assert.equal(tamper.status, 404);
    assert.equal((await pool.query("select title from book_activities where id = $1", [customId])).rows[0].title, "Custom");
  });

  await t.test("assignment delete and close lifecycle is authorized, race-safe, and preserves submitted history", async () => {
    const sameSchoolTeacherId = await insertUser(pool, {
      schoolId: schoolA,
      name: "Other Teacher A",
      email: `other-teacher-a-${schema}@integration.test`,
      role: "teacher",
    });
    const sameSchoolTeacherCookie = await createSession(pool, sameSchoolTeacherId);
    const secondStudentId = await insertUser(pool, {
      schoolId: schoolA,
      name: "Lifecycle Student B",
      email: `lifecycle-student-b-${schema}@integration.test`,
      role: "student",
    });
    const secondStudentCookie = await createSession(pool, secondStudentId);
    await pool.query("insert into class_students (class_id, student_id, status) values ($1, $2, 'active')", [classA.id, secondStudentId]);

    const createLifecycleAssignment = async (title) => {
      const response = await call(bookContentHandler, {
        method: "POST",
        cookie: teacherCookie,
        query: { action: "create-assignment" },
        body: { activityId: activity.id, classId: classA.id, title },
      });
      assert.equal(response.status, 200);
      return response.body.assignment.id;
    };
    const mutate = (cookie, action, id) => call(bookContentHandler, {
      method: "POST", cookie, query: { action }, body: { assignmentId: id },
    });

    const teacherDeleteId = await createLifecycleAssignment("Teacher delete zero submissions");
    assert.equal((await mutate(sameSchoolTeacherCookie, "delete-assignment", teacherDeleteId)).status, 403);
    assert.equal((await mutate(otherTeacherCookie, "delete-assignment", teacherDeleteId)).status, 403);
    assert.equal((await mutate(otherAdminCookie, "delete-assignment", teacherDeleteId)).status, 403);
    assert.equal((await mutate(studentCookie, "delete-assignment", teacherDeleteId)).status, 403);
    assert.equal((await mutate(teacherCookie, "delete-assignment", teacherDeleteId)).status, 200);
    assert.equal((await pool.query("select count(*)::int count from activity_assignments where id = $1", [teacherDeleteId])).rows[0].count, 0);
    assert.equal((await call(bookContentHandler, { cookie: studentCookie, query: { action: "assignments" } })).body.assignments.some((row) => row.assignmentId === teacherDeleteId), false);
    const deletedStaleSubmit = await call(bookContentHandler, {
      method: "POST", cookie: studentCookie, query: { action: "submit" },
      body: { activityId: activity.id, assignmentId: teacherDeleteId, answers: { [question.id]: "affirmative" } },
    });
    assert.equal(deletedStaleSubmit.status, 404);
    assert.match(deletedStaleSubmit.body.error, /no longer available/i);

    const adminDeleteId = await createLifecycleAssignment("Admin delete zero submissions");
    assert.equal((await mutate(adminCookie, "delete-assignment", adminDeleteId)).status, 200);
    assert.equal((await pool.query("select count(*)::int count from activity_assignments where id = $1", [adminDeleteId])).rows[0].count, 0);

    const closeId = await createLifecycleAssignment("Close submitted assignment");
    const submitted = await call(bookContentHandler, {
      method: "POST",
      cookie: studentCookie,
      query: { action: "submit" },
      body: { activityId: activity.id, assignmentId: closeId, answers: { [question.id]: "affirmative" } },
    });
    assert.equal(submitted.status, 200);
    const submissionId = submitted.body.submission.id;
    const feedback = await call(bookContentHandler, {
      method: "POST", cookie: teacherCookie, query: { action: "review-submission" }, body: { submissionId, teacherFeedback: "Preserve this feedback." },
    });
    assert.equal(feedback.status, 200);
    const beforeSubmission = (await pool.query("select answers, score, score_percent, correct_count, total_count, status, teacher_feedback from activity_submissions where id = $1", [submissionId])).rows[0];
    const beforeAnswers = (await pool.query("select question_id, answer_text, is_correct, feedback_text from student_answers where submission_id = $1 order by question_id", [submissionId])).rows;

    const deleteConflict = await mutate(teacherCookie, "delete-assignment", closeId);
    assert.equal(deleteConflict.status, 409);
    assert.equal(deleteConflict.body.conflict, "assignment-has-submissions");
    assert.equal((await mutate(sameSchoolTeacherCookie, "close-assignment", closeId)).status, 403);
    assert.equal((await mutate(otherTeacherCookie, "close-assignment", closeId)).status, 403);
    assert.equal((await mutate(otherAdminCookie, "close-assignment", closeId)).status, 403);
    assert.equal((await mutate(studentCookie, "close-assignment", closeId)).status, 403);
    assert.equal((await mutate(teacherCookie, "close-assignment", closeId)).status, 200);
    assert.equal((await mutate(adminCookie, "close-assignment", closeId)).status, 200);
    assert.equal((await pool.query("select status from activity_assignments where id = $1", [closeId])).rows[0].status, "closed");
    assert.deepEqual((await pool.query("select answers, score, score_percent, correct_count, total_count, status, teacher_feedback from activity_submissions where id = $1", [submissionId])).rows[0], beforeSubmission);
    assert.deepEqual((await pool.query("select question_id, answer_text, is_correct, feedback_text from student_answers where submission_id = $1 order by question_id", [submissionId])).rows, beforeAnswers);

    const staleSubmit = await call(bookContentHandler, {
      method: "POST",
      cookie: secondStudentCookie,
      query: { action: "submit" },
      body: { activityId: activity.id, assignmentId: closeId, answers: { [question.id]: "affirmative" } },
    });
    assert.equal(staleSubmit.status, 409);
    assert.match(staleSubmit.body.error, /closed.*no longer be submitted/i);
    assert.equal((await pool.query("select count(*)::int count from activity_submissions where activity_assignment_id = $1 and student_id = $2", [closeId, secondStudentId])).rows[0].count, 0);
    const submittedHistory = (await call(bookContentHandler, { cookie: studentCookie, query: { action: "assignments" } })).body.assignments.find((row) => row.assignmentId === closeId);
    const closedHistory = (await call(bookContentHandler, { cookie: secondStudentCookie, query: { action: "assignments" } })).body.assignments.find((row) => row.assignmentId === closeId);
    assert.equal(submittedHistory.status, "closed");
    assert.equal(submittedHistory.submissionId, submissionId);
    assert.equal(closedHistory.status, "closed");
    assert.equal(closedHistory.submissionId, null);
    const teacherHistory = (await call(bookContentHandler, { cookie: teacherCookie, query: { action: "teacher-assignments" } })).body.assignments.find((row) => row.id === closeId);
    assert.equal(teacherHistory.status, "closed");
    assert.equal(teacherHistory.submittedCount, 1);
    assert.equal((await call(bookContentHandler, { cookie: teacherCookie, query: { action: "assignment-results", assignmentId: closeId } })).status, 200);

    const raceId = await createLifecycleAssignment("Submission wins delete race");
    const raceClient = await pool.connect();
    try {
      await raceClient.query("begin");
      await raceClient.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`activity-assignment:${raceId}`]);
      await raceClient.query(
        `insert into activity_submissions (school_id, activity_id, activity_assignment_id, student_id, answers, score, score_percent, correct_count, total_count, status, submitted_at, submission_slot)
         values ($1, $2, $3, $4, '{}', 100, 100, 1, 1, 'submitted', now(), 1)`,
        [schoolA, activity.id, raceId, studentId],
      );
      const racedDelete = mutate(teacherCookie, "delete-assignment", raceId);
      await new Promise((resolve) => setImmediate(resolve));
      await raceClient.query("commit");
      const racedResponse = await racedDelete;
      assert.equal(racedResponse.status, 409);
      assert.equal((await pool.query("select count(*)::int count from activity_assignments where id = $1", [raceId])).rows[0].count, 1);
      assert.equal((await pool.query("select count(*)::int count from activity_submissions where activity_assignment_id = $1", [raceId])).rows[0].count, 1);
    } catch (error) {
      await raceClient.query("rollback").catch(() => {});
      throw error;
    } finally {
      raceClient.release();
    }
  });

  await t.test("integrity checks allow official master content without a teacher creator and detect semantic custom gaps", async () => {
    await pool.query(
      `insert into book_page_hotspots (package_slug, component_slug, page_id, label, left_percent, top_percent, width_percent, height_percent, created_by, school_id)
       values ($1, $2, 'official-page', 'Official', 1, 1, 5, 5, null, $3)`,
      [bookPackage.slug, `component-${schema}`, schoolA],
    );
    const mediaId = (await pool.query(
      `insert into book_media_assets (package_slug, component_slug, page_id, file_name, mime_type, public_url, kind, created_by, school_id)
       values ($1, $2, 'official-page', 'official.pdf', 'application/pdf', '/official.pdf', 'document', null, $3) returning id`,
      [bookPackage.slug, `component-${schema}`, schoolA],
    )).rows[0].id;
    await pool.query(
      `insert into book_activities (package_slug, component_slug, page_id, title, type, media_id, status, created_by, school_id)
       values ($1, $2, 'official-page', 'Official master activity', 'text_panel', $3, 'published', null, $4)`,
      [bookPackage.slug, `component-${schema}`, mediaId, schoolA],
    );
    const checks = new Map(relationshipChecks);
    for (const name of ["hotspots_missing_content_context", "media_missing_content_context", "book_activities_missing_relationship"]) {
      assert.equal(await countRelationshipIssues(pool, checks.get(name)), 0, name);
    }

    const customId = (await pool.query(
      `insert into activities (school_id, created_by, ownership_type, lesson_id, title, type, slug, activity_type, content, content_json)
       values ($1, null, 'custom', $2, 'Missing creator', 'multiple_choice', $3, 'multiple_choice', '{}', '{}') returning id`,
      [schoolA, bookLesson.id, `missing-creator-${schema}`],
    )).rows[0].id;
    assert.equal(await countRelationshipIssues(pool, checks.get("custom_activities_without_creator")), 1);
    await pool.query("delete from activities where id = $1", [customId]);
  });
});
