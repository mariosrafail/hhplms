import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import { createAssignment } from "../../netlify/functions/_book-content/assignment-actions.js";
import { createHomework, getTeacherHomework, updateHomework } from "../../netlify/functions/_book-content/homework-actions.js";
import { accessiblePackageIds, fetchPackageTree } from "../../netlify/functions/_book-content/shared.js";
import { buildHomeworkActivityOptions } from "../../src/components/lms/teacher/homeworkUiModel.js";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL || "";
const enabled = Boolean(databaseUrl) && process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";

function scoped(base, schema) {
  const url = new URL(base);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

function tagged(executor) {
  return async (strings, ...values) => {
    let text = strings[0];
    for (let index = 0; index < values.length; index += 1) text += `$${index + 1}${strings[index + 1]}`;
    return (await executor.query(text, values)).rows;
  };
}

function parse(response) {
  return { status: response.statusCode, body: JSON.parse(response.body || "{}") };
}

function assignmentTree(tree) {
  return {
    ...tree,
    components: tree.components.map((component) => ({
      ...component,
      units: component.units.map((unit) => ({
        ...unit,
        lessons: unit.lessons.map((lesson) => ({
          ...lesson,
          exercises: lesson.exercises.map((activity) => ({ ...activity, dbActivity: activity })),
        })),
      })),
    })),
  };
}

function editRequest(homework, overrides = {}) {
  return {
    homeworkId: homework.id,
    expectedUpdatedAt: homework.updatedAt instanceof Date ? homework.updatedAt.toISOString() : homework.updatedAt,
    title: homework.title,
    teacherNotes: homework.teacherNotes,
    worksheetLinks: homework.worksheetLinks,
    dueAt: homework.dueAt instanceof Date ? homework.dueAt.toISOString() : homework.dueAt,
    classIds: homework.classes.map((item) => item.id),
    items: homework.items.map((item) => ({ kind: "legacy_activity", activityId: item.activityId })),
    ...overrides,
  };
}

test("authorized B1, B1+, and B2 legacy catalog enforces package boundaries across Homework and standalone assignment writes", { skip: !enabled, timeout: 180_000 }, async (t) => {
  const schema = `multi_package_catalog_${randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`create schema "${schema}"`);
  const pool = new Pool({ connectionString: scoped(databaseUrl, schema), max: 4 });
  t.after(async () => {
    await pool.end();
    await admin.query(`drop schema if exists "${schema}" cascade`);
    await admin.end();
  });
  // Exercise the historical mutable catalog before managed-only publication is installed.
  await applyCanonicalProductionMigrations(pool, { through: "061_students_book_publication_v3.sql" });

  const teacher = (await pool.query("select id,school_id from app_users where role='teacher' and school_id is not null limit 1")).rows[0];
  assert.ok(teacher);
  const scopes = (await pool.query(`
    select package.id package_id,package.slug package_slug,component.id component_id,unit_record.id unit_id
    from book_packages package
    join book_components component on component.book_package_id=package.id
    join units unit_record on unit_record.book_component_id=component.id and unit_record.slug='unit-1'
    where (package.slug,component.slug) in (
      ('ultimate-b1','ultimate-b1-students-book'),
      ('ultimate-b1-plus','ultimate-b1-plus-students-book'),
      ('ultimate-b2','ultimate-b2-students-book')
    )
    order by case package.slug when 'ultimate-b1' then 1 when 'ultimate-b1-plus' then 2 else 3 end
  `)).rows;
  assert.deepEqual(scopes.map((row) => row.package_slug), ["ultimate-b1", "ultimate-b1-plus", "ultimate-b2"]);

  const activitiesByPackage = new Map();
  for (const scope of scopes) {
    const lesson = (await pool.query(`
      insert into lessons(unit_id,title,slug,lesson_type,sort_order,position,instructions,status)
      values($1,$2,$3,'reading',901,901,'Integration fixture','published') returning id
    `, [scope.unit_id, `${scope.package_slug} assignment fixture`, `assignment-${randomUUID()}`])).rows[0];
    const activities = (await pool.query(`
      insert into activities(lesson_id,title,slug,type,activity_type,content,content_json,settings_json,sort_order,is_assignable)
      values
        ($1,'Shared catalog title',$2,'open_answer','open_answer','{}','{}','{}',1,true),
        ($1,'Second real activity',$3,'open_answer','open_answer','{}','{}','{}',2,true)
      returning id,title
    `, [lesson.id, `activity-${randomUUID()}`, `activity-${randomUUID()}`])).rows;
    activitiesByPackage.set(scope.package_slug, activities);
  }
  await pool.query(`
    insert into book_access(user_id,book_package_id,role_scope)
    select $1,id,'teacher' from book_packages where slug=any($2::text[])
    on conflict do nothing
  `, [teacher.id, scopes.map((row) => row.package_slug)]);

  const classes = new Map();
  for (const scope of scopes) {
    const classRow = (await pool.query(`
      insert into classes(school_id,name,slug,teacher_id,book_package_id,status,invite_code)
      values($1,$2,$3,$4,$5,'active',$6) returning id,name,book_package_id
    `, [teacher.school_id, `${scope.package_slug} class`, `class-${randomUUID()}`, teacher.id, scope.package_id, randomBytes(5).toString("hex")])).rows[0];
    classes.set(scope.package_slug, classRow);
  }
  const nullPackageClass = (await pool.query(`
    insert into classes(school_id,name,slug,teacher_id,book_package_id,status,invite_code)
    values($1,'Legacy null-package class',$2,$3,null,'active',$4) returning id,name,book_package_id
  `, [teacher.school_id, `class-${randomUUID()}`, teacher.id, randomBytes(5).toString("hex")])).rows[0];

  const sql = tagged(pool);
  sql.homeworkMutationTransaction = async (homeworkId, callback) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`homework:${homeworkId}`]);
      const result = await callback(tagged(client));
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  };
  const teacherUser = { ...teacher, role: "teacher" };
  const allowed = await accessiblePackageIds(sql, teacherUser);
  assert.equal(scopes.every((scope) => allowed.includes(String(scope.package_id))), true);
  const trees = [];
  for (const scope of scopes) {
    trees.push(assignmentTree(await fetchPackageTree(sql, { packageId: scope.package_id })));
  }
  const options = buildHomeworkActivityOptions(trees);
  const fixtureIds = new Set([...activitiesByPackage.values()].flat().map((activity) => String(activity.id)));
  const fixtureOptions = options.filter((option) => fixtureIds.has(String(option.activityId)));
  assert.equal(fixtureOptions.length, 6);
  assert.deepEqual([...new Set(fixtureOptions.map((option) => option.packageSlug))], ["ultimate-b1", "ultimate-b1-plus", "ultimate-b2"]);
  assert.equal(fixtureOptions.filter((option) => option.title === "Shared catalog title").length, 3);
  assert.equal(fixtureOptions.every((option) => option.label.includes(option.packageTitle) && option.label.includes(option.componentTitle)), true);

  const b1Items = activitiesByPackage.get("ultimate-b1").map((activity) => ({ kind: "legacy_activity", activityId: activity.id }));
  const b1Request = {
    idempotencyKey: "multi-package-b1-success",
    title: "B1 compatible Homework",
    classIds: [classes.get("ultimate-b1").id],
    items: b1Items,
  };
  const created = parse(await createHomework(sql, b1Request, teacherUser));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.homework.items.every((item) => item.packageId === classes.get("ultimate-b1").book_package_id), true);

  for (const [idempotencyKey, classIds, expectedConflict] of [
    ["multi-package-cross-package", [classes.get("ultimate-b2").id], "class-package-mismatch"],
    ["multi-package-mixed-classes", [classes.get("ultimate-b1").id, classes.get("ultimate-b2").id], "mixed-class-packages"],
    ["multi-package-null-class", [nullPackageClass.id], "class-package-unassigned"],
  ]) {
    const response = parse(await createHomework(sql, { ...b1Request, idempotencyKey, classIds }, teacherUser));
    assert.equal(response.status, 409);
    assert.equal(response.body.conflict, expectedConflict);
    assert.equal(Number((await pool.query("select count(*) from homeworks where idempotency_key=$1", [idempotencyKey])).rows[0].count), 0);
  }

  const standaloneMismatch = parse(await createAssignment(sql, {
    idempotencyKey: "standalone-cross-package",
    classIds: [classes.get("ultimate-b2").id],
    activityId: activitiesByPackage.get("ultimate-b1")[0].id,
  }, teacherUser));
  assert.equal(standaloneMismatch.status, 409);
  assert.equal(standaloneMismatch.body.conflict, "class-package-mismatch");

  const b1PlusTarget = { kind: "legacy_activity", activityId: activitiesByPackage.get("ultimate-b1-plus")[0].id };
  const incompatibleEdit = parse(await updateHomework(sql, editRequest(created.body.homework, {
    items: [b1Items[0], b1PlusTarget],
  }), teacherUser));
  assert.equal(incompatibleEdit.status, 409);
  assert.equal(incompatibleEdit.body.conflict, "class-package-mismatch");
  const preserved = await getTeacherHomework(sql, created.body.homework.id, teacher.id, teacherUser);
  assert.deepEqual(preserved.items.map((item) => item.activityId), b1Items.map((item) => item.activityId));

  const unauthorizedTeacher = (await pool.query(`
    insert into app_users(school_id,full_name,email,role,status)
    values($1,'Unentitled teacher',$2,'teacher','active') returning id,school_id
  `, [teacher.school_id, `unentitled-${randomUUID()}@example.test`])).rows[0];
  const unauthorizedClass = (await pool.query(`
    insert into classes(school_id,name,slug,teacher_id,book_package_id,status,invite_code)
    values($1,'Unentitled B2 class',$2,$3,$4,'active',$5) returning id
  `, [teacher.school_id, `class-${randomUUID()}`, unauthorizedTeacher.id, classes.get("ultimate-b2").book_package_id, randomBytes(5).toString("hex")])).rows[0];
  const denied = parse(await createAssignment(sql, {
    idempotencyKey: "unentitled-crafted-target",
    classIds: [unauthorizedClass.id],
    activityId: activitiesByPackage.get("ultimate-b1")[0].id,
  }, { ...unauthorizedTeacher, role: "teacher" }));
  assert.equal(denied.status, 403);
  const historicalHomework = await getTeacherHomework(sql, created.body.homework.id, teacher.id, teacherUser);
  await applyCanonicalProductionMigrations(pool);
  assert.deepEqual(await getTeacherHomework(sql, created.body.homework.id, teacher.id, teacherUser), historicalHomework);
  for (const scope of scopes) {
    const current = buildHomeworkActivityOptions([assignmentTree(await fetchPackageTree(sql, { packageId: scope.package_id }))]);
    const ids = new Set(activitiesByPackage.get(scope.package_slug).map((activity) => String(activity.id)));
    assert.equal(current.filter((option) => ids.has(String(option.activityId))).length, scope.package_slug === "ultimate-b2" ? 2 : 0);
  }
  const blocked = parse(await createHomework(sql, { ...b1Request, idempotencyKey: "new-mutable-b1-rejected" }, teacherUser));
  assert.notEqual(blocked.status, 201);
  assert.equal(Number((await pool.query("select count(*) from homeworks where idempotency_key='new-mutable-b1-rejected'")).rows[0].count), 0);
});
