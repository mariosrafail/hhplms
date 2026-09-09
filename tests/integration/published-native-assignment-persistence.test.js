import { createMarkWordsFixture, markWordsFixtureId } from "../fixtures/native-mark-words.js";
import { publicDocument as multiPublic, teacherDocument as multiTeacher } from "../fixtures/native-runtime-regressions/multi-part-data.js";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import { createAssignment, listAssignmentTargets, listAssignmentsForStudent } from "../../netlify/functions/_book-content/assignment-actions.js";
import { reviewSubmission } from "../../netlify/functions/_book-content/class-actions.js";
import { getAssignmentResults, submitActivity } from "../../netlify/functions/_book-content/submission-actions.js";
import { compilePublicationV2Fixture, publicationV2Fixture } from "../fixtures/publication-v2.js";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";
import { listPublishedBooks, getStudentAssignmentDetail, getPublishedBookActivity } from "../../netlify/functions/_book-content/published-book-actions.js";
import { managedPageRouteIds, publishedManagedBookFixture } from "../fixtures/published-managed-book.js";

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

async function insertRelease(pool, { packageId, componentId, builderId, releaseNumber, fixture }) {
  const compiled = fixture.compiled || compilePublicationV2Fixture(fixture);
  const releaseId = randomUUID();
  await pool.query(`
    insert into book_component_releases(
      id,book_package_id,book_component_id,release_number,release_schema_version,compiler_id,
      runtime_compatibility_sha256,source_snapshot,source_snapshot_sha256,
      public_projection,public_projection_sha256,teacher_projection,teacher_projection_sha256,
      asset_manifest,release_sha256,request_sha256,client_mutation_id,created_by_builder_user_id
    ) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12::jsonb,$13,$14::jsonb,$15,$16,$17,$18)
  `, [
    releaseId, packageId, componentId, releaseNumber, compiled.releaseSchemaVersion, compiled.compilerId,
    compiled.compatibility, JSON.stringify(compiled.sourceSnapshot), compiled.sourceSnapshotSha256,
    JSON.stringify(compiled.publicProjection), compiled.publicProjectionSha256,
    JSON.stringify(compiled.teacherProjection), compiled.teacherProjectionSha256,
    JSON.stringify(compiled.assetManifest), compiled.releaseSha256, randomBytes(32).toString("hex"), randomUUID(), builderId,
  ]);
  return { releaseId };
}

async function publishRelease(pool, { packageId, componentId, releaseId, previousReleaseId = null, revision, builderId }) {
  await pool.query(`
    insert into book_component_publication_events(
      book_package_id,book_component_id,previous_release_id,release_id,expected_head_revision,
      resulting_head_revision,request_sha256,client_mutation_id,published_by_builder_user_id
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [packageId, componentId, previousReleaseId, releaseId, revision - 1, revision, randomBytes(32).toString("hex"), randomUUID(), builderId]);
  await pool.query(`
    insert into book_component_publication_heads(
      book_component_id,book_package_id,release_id,head_revision,published_by_builder_user_id
    ) values($1,$2,$3,$4,$5)
    on conflict(book_component_id) do update set
      release_id=excluded.release_id,
      head_revision=excluded.head_revision,
      published_by_builder_user_id=excluded.published_by_builder_user_id,
      published_at=now()
  `, [componentId, packageId, releaseId, revision, builderId]);
}

test("published native assignment remains release-pinned through submit, review, and a newer publication", { skip: !enabled }, async (t) => {
  const schema = `native_assignment_${randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`create schema "${schema}"`);
  const pool = new Pool({ connectionString: scoped(databaseUrl, schema), max: 4 });
  t.after(async () => {
    await pool.end();
    await admin.query(`drop schema if exists "${schema}" cascade`);
    await admin.end();
  });
  const migrations = await applyCanonicalProductionMigrations(pool);
  assert.ok(migrations.some(({ filename }) => filename === "040_published_native_assignment_runtime.sql"));

  const teacher = (await pool.query("select id,school_id from app_users where role='teacher' and school_id is not null limit 1")).rows[0];
  const student = (await pool.query("select id from app_users where role='student' and school_id=$1 limit 1", [teacher.school_id])).rows[0];
  const legacyActivity = (await pool.query("select id from activities limit 1")).rows[0];
  const scope = (await pool.query(`
    select package.id package_id,component.id component_id
    from book_packages package join book_components component on component.book_package_id=package.id
    where package.slug='ultimate-b2' and component.slug='ultimate-b2-students-book'
  `)).rows[0];
  assert.ok(teacher && student && legacyActivity && scope);
  await pool.query("update app_users set status='active' where id=$1", [student.id]);

  const classRow = (await pool.query(`
    insert into classes(school_id,name,slug,teacher_id,book_package_id,status,invite_code)
    values($1,'Native assignment integration',$2,$3,$4,'active',$5) returning id
  `, [teacher.school_id, `native-${randomUUID()}`, teacher.id, scope.package_id, randomBytes(5).toString("hex")])).rows[0];
  await pool.query("insert into class_students(class_id,student_id,status) values($1,$2,'active')", [classRow.id, student.id]);
  await pool.query(`
    insert into book_access(user_id,book_package_id,role_scope)
    values($1,$2,'teacher'),($3,$2,'student') on conflict do nothing
  `, [teacher.id, scope.package_id, student.id]);

  const legacy = (await pool.query(`
    insert into activity_assignments(school_id,activity_id,teacher_id,student_id,title)
    values($1,$2,$3,$4,'Legacy preserved') returning *
  `, [teacher.school_id, legacyActivity.id, teacher.id, student.id])).rows[0];
  assert.equal(legacy.target_kind, "legacy_activity");
  assert.equal(legacy.native_release_id, null);
  await assert.rejects(
    pool.query("insert into activity_assignments(school_id,teacher_id,student_id,title) values($1,$2,$3,'Missing target')", [teacher.school_id, teacher.id, student.id]),
    /activity_assignments_target_identity_check/,
  );

  const builderId = randomUUID();
  await pool.query(
    "insert into builder_users(id,full_name,email,password_hash) values($1,'Native assignment integration',$2,'not-a-login-hash')",
    [builderId, `native-${randomUUID()}@example.test`],
  );
  const releaseA = await insertRelease(pool, {
    packageId: scope.package_id,
    componentId: scope.component_id,
    builderId,
    releaseNumber: 99,
    fixture: { markWords: true, multiPart: true, prompt: "Release A prompt", teacherAnswer: "Release A protected answer" },
  });
  await publishRelease(pool, { packageId: scope.package_id, componentId: scope.component_id, releaseId: releaseA.releaseId, revision: 1, builderId });

  const sql = tagged(pool);
  sql.homeworkMutationTransaction = async (homeworkId, callback) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`homework:${homeworkId}`]);
      const result = await callback(tagged(client));
      await client.query("commit");
      return result;
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  };
  sql.assignmentLifecycleTransaction = async (assignmentId, callback) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`activity-assignment:${assignmentId}`]);
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
  const studentUser = { ...student, school_id: teacher.school_id, role: "student" };

  const markCreation = await createAssignment(sql, { idempotencyKey: "mark-words-integration", classIds: [classRow.id], target: { kind: "published_native", releaseId: releaseA.releaseId, nativeActivityId: markWordsFixtureId } }, teacherUser);
  assert.equal(markCreation.statusCode, 200, markCreation.body);
  const markAssignment = JSON.parse(markCreation.body).assignment;
  const multiCreation = await createAssignment(sql, { idempotencyKey: "composition-integration", classIds: [classRow.id], target: { kind: "published_native", releaseId: releaseA.releaseId, nativeActivityId: multiPublic.activityId } }, teacherUser);
  assert.equal(multiCreation.statusCode, 200, multiCreation.body);
  const multiAssignment = JSON.parse(multiCreation.body).assignment;
  const catalog = await listAssignmentTargets(sql, teacherUser);
  assert.equal(catalog.find((item) => item.target.nativeActivityId === publicationV2Fixture.openResponseId)?.assignable, true);
  assert.equal(catalog.find((item) => item.target.nativeActivityId === publicationV2Fixture.imageId)?.assignable, false);
  assert.doesNotMatch(JSON.stringify(catalog), /Release A protected answer/);

  for (const componentSlug of ["ultimate-b2-workbook", "ultimate-b2-grammar-book"]) {
    const componentId = (await pool.query("select id from book_components where book_package_id=$1 and slug=$2", [scope.package_id, componentSlug])).rows[0].id;
    const pageIds = componentSlug === "ultimate-b2-workbook" ? await managedPageRouteIds(componentSlug) : null;
    const release = await insertRelease(pool, { packageId: scope.package_id, componentId, builderId, releaseNumber: 99, fixture: { compiled: publishedManagedBookFixture(componentSlug, { pageIds }) } });
    await publishRelease(pool, { packageId: scope.package_id, componentId, releaseId: release.releaseId, revision: 1, builderId });
    if (componentSlug.endsWith("grammar-book")) {
      assert.equal((await getPublishedBookActivity(sql, studentUser, { bookSlug: "ultimate-b2", componentSlug, releaseId: release.releaseId, activityId: "ultimate-b2-gb-unit-1-page-1-o1" })).statusCode, 404);
    }
  }
  const booksResponse = await listPublishedBooks(sql, teacherUser);
  assert.equal(booksResponse.statusCode, 200, booksResponse.body);
  const books = JSON.parse(booksResponse.body).books;
  assert.deepEqual(books.map((book) => book.componentSlug).sort(), ["ultimate-b2-students-book", "ultimate-b2-workbook"]);
  assert.doesNotMatch(booksResponse.body, /PRIVATE_TEACHER|protected answer|modelAnswers/);
  const placement = books.find((book) => book.componentSlug.endsWith("students-book")).activities.find((entry) => entry.target.nativeActivityId === publicationV2Fixture.openResponseId).placements[0];
  const locator = { pageId: placement.pageId, hotspotId: placement.hotspotId };
  const locatedTarget = { kind: "published_native", releaseId: releaseA.releaseId, nativeActivityId: publicationV2Fixture.openResponseId, locator };
  const invalidLocation = await createAssignment(sql, { idempotencyKey: "invalid-location", classIds: [classRow.id], target: { ...locatedTarget, locator: { ...locator, hotspotId: "wrong-hotspot" } } }, teacherUser);
  assert.equal(invalidLocation.statusCode, 409);
  assert.equal(JSON.parse(invalidLocation.body).code, "publication_locator_mismatch");
  assert.equal(Number((await pool.query("select count(*) from activity_assignments where idempotency_key='invalid-location'")).rows[0].count), 0);

  const createResponse = await createAssignment(sql, {
    idempotencyKey: "native-integration-create",
    classIds: [classRow.id],
    target: locatedTarget,
  }, teacherUser);
  assert.equal(createResponse.statusCode, 200);
  const assignment = JSON.parse(createResponse.body).assignment;
  assert.equal(assignment.targetKind, "published_native");
  assert.equal(assignment.nativeReleaseId, releaseA.releaseId);
  assert.deepEqual((await pool.query("select native_book_locator from activity_assignments where id=$1", [assignment.id])).rows[0].native_book_locator, locator);
  for (const malformed of [[], "page", { pageId: 1, hotspotId: "hotspot" }, { ...locator, productReleaseId: null }, { ...locator, productReleaseId: 7 }, { ...locator, extra: true }]) {
    await assert.rejects(pool.query("update activity_assignments set native_book_locator=$1::jsonb where id=$2", [JSON.stringify(malformed), assignment.id]), /activity_assignments_native_book_locator_check/);
  }
  await assert.rejects(pool.query("update activity_assignments set native_book_locator=$1::jsonb where id=$2", [JSON.stringify(locator), legacy.id]), /activity_assignments_native_book_locator_check/);

  const b1Package = (await pool.query("select id from book_packages where slug='ultimate-b1'")).rows[0];
  const b1Class = (await pool.query(`
    insert into classes(school_id,name,slug,teacher_id,book_package_id,status,invite_code)
    values($1,'B1 native mismatch',$2,$3,$4,'active',$5) returning id
  `, [teacher.school_id, `native-mismatch-${randomUUID()}`, teacher.id, b1Package.id, randomBytes(5).toString("hex")])).rows[0];
  const nativeMismatch = await createAssignment(sql, {
    idempotencyKey: "native-cross-package-reject",
    classIds: [b1Class.id],
    target: { kind: "published_native", releaseId: releaseA.releaseId, nativeActivityId: publicationV2Fixture.openResponseId },
  }, teacherUser);
  assert.equal(nativeMismatch.statusCode, 409);
  assert.equal(JSON.parse(nativeMismatch.body).conflict, "class-package-mismatch");
  assert.equal(Number((await pool.query("select count(*) from activity_assignments where idempotency_key='native-cross-package-reject'")).rows[0].count), 0);

  const duplicateCreate = await createAssignment(sql, {
    idempotencyKey: "native-integration-create",
    classIds: [classRow.id],
    target: locatedTarget,
  }, teacherUser);
  assert.equal(duplicateCreate.statusCode, 200);
  assert.equal(JSON.parse(duplicateCreate.body).assignment.id, assignment.id);
  assert.equal(Number((await pool.query(
    "select count(*) from activity_assignments where native_release_id=$1 and native_activity_id=$2",
    [releaseA.releaseId, publicationV2Fixture.openResponseId],
  )).rows[0].count), 1);

  await assert.rejects(pool.query(`
    insert into activity_assignments(
      school_id,activity_id,target_kind,native_release_id,native_activity_id,teacher_id,student_id,title
    ) values($1,$2,'published_native',$3,$4,$5,$6,'Mixed target')
  `, [teacher.school_id, legacyActivity.id, releaseA.releaseId, publicationV2Fixture.openResponseId, teacher.id, student.id]), /activity_assignments_target_identity_check/);

  const choiceCreate = await createAssignment(sql, {
    idempotencyKey: "native-single-choice-create",
    classIds: [classRow.id],
    target: { kind: "published_native", releaseId: releaseA.releaseId, nativeActivityId: publicationV2Fixture.singleChoiceId },
  }, teacherUser);
  assert.equal(choiceCreate.statusCode, 200);
  const choiceAssignment = JSON.parse(choiceCreate.body).assignment;

  const releaseB = await insertRelease(pool, {
    packageId: scope.package_id,
    componentId: scope.component_id,
    builderId,
    releaseNumber: 100,
    fixture: { prompt: "Release B prompt", teacherAnswer: "Release B protected answer", singleChoiceCorrectOptionIndexes: [0, 2] },
  });
  const preparedCatalog = await listAssignmentTargets(sql, teacherUser);
  assert.equal(preparedCatalog.some((item) => item.target.releaseId === releaseB.releaseId), false);
  const preparedCreate = await createAssignment(sql, {
    idempotencyKey: "native-prepared-release",
    classIds: [classRow.id],
    target: { kind: "published_native", releaseId: releaseB.releaseId, nativeActivityId: publicationV2Fixture.openResponseId },
  }, teacherUser);
  assert.equal(preparedCreate.statusCode, 404);
  await publishRelease(pool, {
    packageId: scope.package_id,
    componentId: scope.component_id,
    releaseId: releaseB.releaseId,
    previousReleaseId: releaseA.releaseId,
    revision: 2,
    builderId,
  });

  const hydrated = (await listAssignmentsForStudent(sql, student.id, studentUser)).find((item) => item.id === assignment.id);
  assert.equal(hydrated.target.releaseId, releaseA.releaseId);
  assert.equal(hydrated.target.entry.document.parts[0].interaction.questions[0].prompt, "Release A prompt");
  assert.doesNotMatch(JSON.stringify(hydrated), /Release A protected answer|Release B protected answer/);
  const detail = await getStudentAssignmentDetail(sql, studentUser, { assignmentId: assignment.id });
  assert.equal(detail.statusCode, 200, detail.body);
  const detailAssignment = JSON.parse(detail.body).assignment;
  assert.deepEqual(detailAssignment.bookLocator, locator);
  assert.equal(detailAssignment.book.releaseId, releaseA.releaseId);
  assert.ok(detailAssignment.book.pages.some((page) => page.id === locator.pageId && page.hotspots.some((hotspot) => hotspot.id === locator.hotspotId)));
  assert.equal(detail.headers["Cache-Control"], "private, no-store");
  assert.equal((await getStudentAssignmentDetail(sql, { ...studentUser, id: randomUUID() }, { assignmentId: assignment.id })).statusCode, 404);
  assert.equal((await getStudentAssignmentDetail(sql, { ...studentUser, school_id: randomUUID() }, { assignmentId: assignment.id })).statusCode, 404);

  const questionId = hydrated.target.entry.document.parts[0].interaction.questions[0].id;
  const rejectedScore = await submitActivity(sql, {
    assignmentId: assignment.id,
    response: { schemaVersion: "native-response.v1", items: [{ id: questionId, value: "Student pinned response" }] },
    score: 100,
  }, studentUser);
  assert.equal(rejectedScore.statusCode, 400);
  const submitResponse = await submitActivity(sql, {
    assignmentId: assignment.id,
    target: { kind: "published_native", releaseId: releaseA.releaseId, nativeActivityId: publicationV2Fixture.openResponseId },
    response: { schemaVersion: "native-response.v1", items: [{ id: questionId, value: "Student pinned response" }] },
  }, studentUser);
  assert.equal(submitResponse.statusCode, 200);
  assert.equal(JSON.parse(submitResponse.body).submission.status, "awaiting_review");
  const stored = (await pool.query("select activity_id,response_schema_version,response_payload,score_percent from activity_submissions where activity_assignment_id=$1", [assignment.id])).rows[0];
  assert.equal(stored.activity_id, null);
  assert.equal(stored.response_schema_version, "native-response.v1");
  assert.equal(stored.response_payload.items[0].id, questionId);
  assert.equal(stored.score_percent, null);

  const resultsResponse = await getAssignmentResults(sql, assignment.id);
  assert.equal(resultsResponse.statusCode, 200);
  const results = JSON.parse(resultsResponse.body);
  assert.equal(results.rows[0].answerDetails[0].prompt, "Release A prompt");
  assert.equal(results.rows[0].answerDetails[0].answer, "Student pinned response");
  assert.equal(results.rows[0].answerDetails[0].modelAnswer, "Release A protected answer");

  const reviewResponse = await reviewSubmission(sql, {
    submissionId: results.rows[0].submissionId,
    scorePercent: 88,
    teacherFeedback: "Good evidence",
  }, teacherUser);
  assert.equal(reviewResponse.statusCode, 200);
  const reviewed = (await listAssignmentsForStudent(sql, student.id, studentUser)).find((item) => item.id === assignment.id);
  assert.equal(reviewed.submissionStatus, "reviewed");
  assert.equal(reviewed.scorePercent, 88);
  assert.equal(reviewed.teacherFeedback, "Good evidence");
  assert.equal(reviewed.target.releaseId, releaseA.releaseId);
  assert.doesNotMatch(JSON.stringify(reviewed), /Release A protected answer|Release B protected answer/);

  const choiceHydrated = (await listAssignmentsForStudent(sql, student.id, studentUser)).find((item) => item.id === choiceAssignment.id);
  assert.equal(choiceHydrated.target.releaseId, releaseA.releaseId);
  assert.equal(choiceHydrated.target.capability.reviewMode, "auto-scored");
  assert.doesNotMatch(JSON.stringify(choiceHydrated), /correctOptionId|correctAnswers/);
  const choiceQuestions = choiceHydrated.target.entry.document.parts[0].interaction.questions;
  const wrongOwnership = await submitActivity(sql, {
    assignmentId: choiceAssignment.id,
    response: { schemaVersion: "native-response.v1", items: [{ id: choiceQuestions[0].id, value: choiceQuestions[1].options[0].id }] },
  }, studentUser);
  assert.equal(wrongOwnership.statusCode, 400);
  const duplicateChoice = await submitActivity(sql, {
    assignmentId: choiceAssignment.id,
    response: { schemaVersion: "native-response.v1", items: [{ id: choiceQuestions[0].id, value: choiceQuestions[0].options[0].id }, { id: choiceQuestions[0].id, value: choiceQuestions[0].options[1].id }] },
  }, studentUser);
  assert.equal(duplicateChoice.statusCode, 400);
  const teacherInjection = await submitActivity(sql, {
    assignmentId: choiceAssignment.id,
    response: { schemaVersion: "native-response.v1", items: [], correctAnswers: [] },
  }, studentUser);
  assert.equal(teacherInjection.statusCode, 400);
  const scoreTamper = await submitActivity(sql, {
    assignmentId: choiceAssignment.id,
    score: 100,
    response: { schemaVersion: "native-response.v1", items: [{ id: choiceQuestions[0].id, value: choiceQuestions[0].options[1].id }] },
  }, studentUser);
  assert.equal(scoreTamper.statusCode, 400);
  const choiceSubmit = await submitActivity(sql, {
    assignmentId: choiceAssignment.id,
    response: { schemaVersion: "native-response.v1", items: [{ id: choiceQuestions[0].id, value: choiceQuestions[0].options[1].id }, { id: choiceQuestions[1].id, value: choiceQuestions[1].options[0].id }] },
  }, studentUser);
  assert.equal(choiceSubmit.statusCode, 200);
  assert.deepEqual(JSON.parse(choiceSubmit.body).submission, {
    id: JSON.parse(choiceSubmit.body).submission.id,
    status: "submitted", scorePercent: 50, correctCount: 1, totalCount: 2,
  });
  const choiceStored = (await pool.query("select response_payload,score_percent,correct_count,total_count,status from activity_submissions where activity_assignment_id=$1", [choiceAssignment.id])).rows[0];
  assert.equal(choiceStored.response_payload.kind, "single-choice");
  assert.equal(Number(choiceStored.score_percent), 50);
  assert.equal(choiceStored.correct_count, 1);
  assert.equal(choiceStored.total_count, 2);
  assert.equal(choiceStored.status, "submitted");
  const studentChoiceResult = (await listAssignmentsForStudent(sql, student.id, studentUser)).find((item) => item.id === choiceAssignment.id);
  assert.equal(studentChoiceResult.scorePercent, 50);
  assert.equal(studentChoiceResult.target.releaseId, releaseA.releaseId);
  assert.doesNotMatch(JSON.stringify(studentChoiceResult), /correctOptionId|correctAnswers/);
  const choiceResults = JSON.parse((await getAssignmentResults(sql, choiceAssignment.id)).body);
  assert.equal(choiceResults.rows[0].implementationMode, "auto-scored");
  assert.equal(choiceResults.rows[0].answerDetails[0].answer, choiceQuestions[0].options[1].text);
  assert.equal(choiceResults.rows[0].answerDetails[0].modelAnswer, choiceQuestions[0].options[1].text);
  assert.equal(choiceResults.rows[0].answerDetails[1].isCorrect, false);
  const scoreOverride = await reviewSubmission(sql, { submissionId: choiceResults.rows[0].submissionId, scorePercent: 100, teacherFeedback: "No override" }, teacherUser);
  assert.equal(scoreOverride.statusCode, 400);
  const feedbackOnly = await reviewSubmission(sql, { submissionId: choiceResults.rows[0].submissionId, teacherFeedback: "Server score retained" }, teacherUser);
  assert.equal(feedbackOnly.statusCode, 200);
  const choiceAfterReview = (await pool.query("select score_percent,status,teacher_feedback from activity_submissions where activity_assignment_id=$1", [choiceAssignment.id])).rows[0];
  assert.equal(Number(choiceAfterReview.score_percent), 50);
  assert.equal(choiceAfterReview.status, "submitted");
  assert.equal(choiceAfterReview.teacher_feedback, "Server score retained");

  const markPair = createMarkWordsFixture();
  const markItems = markPair.publicDocument.parts[0].interaction.items;
  const markAnswers = markPair.teacherDocument.parts[0].solution.answers;
  const markResponse = { schemaVersion: "native-response.v1", items: markAnswers.map((answer) => ({ id: answer.itemId, value: [...answer.correctWordIds].reverse() })) };
  const crossPassage = structuredClone(markResponse); crossPassage.items[0].value = [markItems[1].words[0].id];
  assert.equal((await submitActivity(sql, { assignmentId: markAssignment.id, response: crossPassage }, studentUser)).statusCode, 400);
  assert.equal((await submitActivity(sql, { assignmentId: markAssignment.id, score: 100, response: markResponse }, studentUser)).statusCode, 400);
  const marked = await submitActivity(sql, { assignmentId: markAssignment.id, response: markResponse }, studentUser);
  assert.equal(marked.statusCode, 200, marked.body); assert.equal(JSON.parse(marked.body).submission.scorePercent, 100);
  assert.equal((await submitActivity(sql, { assignmentId: markAssignment.id, response: markResponse }, studentUser)).statusCode, 409);
  const markStored = (await pool.query("select response_payload, score_percent from activity_submissions where activity_assignment_id=$1", [markAssignment.id])).rows[0];
  assert.equal(markStored.response_payload.kind, "mark-the-words"); assert.deepEqual(markStored.response_payload.items[0].value, markAnswers[0].correctWordIds);
  const restoredMark = (await listAssignmentsForStudent(sql, student.id, studentUser)).find((item) => item.id === markAssignment.id);
  assert.equal(restoredMark.target.releaseId, releaseA.releaseId); assert.doesNotMatch(JSON.stringify(restoredMark), /correctWordIds/);
  const markResults = JSON.parse((await getAssignmentResults(sql, markAssignment.id)).body);
  assert.equal(markResults.rows[0].implementationMode, "auto-scored"); assert.match(markResults.rows[0].answerDetails[0].answer, /watch \(word 2\)/);

  const multiResponse = { schemaVersion: "native-multi-response.v1", sections: multiPublic.parts[0].interaction.sections.filter((section) => section.kind !== "image").map((section) => {
    const solution = multiTeacher.parts[0].solution.sections.find((entry) => entry.id === section.id).solution;
    const items = section.kind === "drag-drop" ? solution.mappings.map((entry) => ({ id: entry.targetId, value: [entry.wordId] }))
      : section.kind === "single-choice" ? solution.correctAnswers.map((entry) => ({ id: entry.questionId, value: entry.correctOptionId }))
        : section.kind === "open-response" ? solution.modelAnswers.map((entry) => ({ id: entry.questionId, value: "My persisted explanation" }))
          : solution.answers.map((entry) => ({ id: entry.itemId, value: section.kind === "mark-the-words" ? entry.correctWordIds : entry.text }));
    return { id: section.id, kind: section.kind, response: { schemaVersion: "native-response.v1", items } };
  }) };
  const submittedMulti = await submitActivity(sql, { assignmentId: multiAssignment.id, response: multiResponse }, studentUser);
  assert.equal(submittedMulti.statusCode, 200, submittedMulti.body);
  assert.equal(JSON.parse(submittedMulti.body).submission.status, "awaiting_review");
  const multiStored = (await pool.query("select * from activity_submissions where activity_assignment_id=$1", [multiAssignment.id])).rows[0];
  assert.equal(multiStored.response_schema_version, "native-multi-response.v1"); assert.equal(multiStored.response_payload.sections.length, 8);
  assert.equal(multiStored.response_payload.sectionResults.length, 8); assert.equal(multiStored.score_percent, null);
  const multiRestored = (await listAssignmentsForStudent(sql, student.id, studentUser)).find((item) => item.id === multiAssignment.id);
  assert.equal(multiRestored.target.releaseId, releaseA.releaseId); assert.doesNotMatch(JSON.stringify(multiRestored), /Synthetic private explanation/);
  const multiResults = JSON.parse((await getAssignmentResults(sql, multiAssignment.id)).body);
  assert.equal(multiResults.rows[0].answerDetails.length, 8); assert.equal(new Set(multiResults.rows[0].answerDetails.map((detail) => detail.questionId)).size, 8);
  assert.equal((await reviewSubmission(sql, { submissionId: multiStored.id, score: 92, teacherFeedback: "Composed response reviewed" }, teacherUser)).statusCode, 200);
  assert.equal((await submitActivity(sql, { assignmentId: multiAssignment.id, response: multiResponse }, studentUser)).statusCode, 409);

  await assert.rejects(pool.query(`
    insert into activity_submissions(
      school_id,activity_assignment_id,student_id,answers,response_schema_version,response_payload,status
    ) values($1,$2,$3,'{}','native-response.v1','[]','awaiting_review')
  `, [teacher.school_id, assignment.id, student.id]), /activity_submissions_response_envelope_check/);
  if (process.env.PUBLISHED_BOOK_BROWSER === "1") {
    const { verifyPublishedBookBrowser } = await import("./_published-book-browser.mjs");
    await verifyPublishedBookBrowser({ pool, sql, teacher: teacherUser, student: studentUser, publishNewer: async () => {
      const newer = await insertRelease(pool, { packageId: scope.package_id, componentId: scope.component_id, builderId, releaseNumber: 110, fixture: { prompt: "Newer browser publication" } });
      await publishRelease(pool, { packageId: scope.package_id, componentId: scope.component_id, releaseId: newer.releaseId, previousReleaseId: releaseB.releaseId, revision: 3, builderId });
    } });
  }
  await t.test("historical Unit Extras endpoints verify unchanged hashes and remain pinned after newer releases", async () => {
    const { verifyHistoricalUnitExtrasPersistence } = await import("./_historical-unit-extras.mjs");
    await verifyHistoricalUnitExtrasPersistence({ pool, sql, scope, builderId, teacher: teacherUser, student: studentUser, classId: classRow.id, insertRelease, publishRelease });
  });
  await t.test("combined historical family preserves exact focus identity, endpoint security and assignment pins", async () => {
    const { verifyHistoricalCombinedPersistence } = await import("./_historical-combined.mjs");
    await verifyHistoricalCombinedPersistence({ pool, sql, scope, builderId, teacher: teacherUser, student: studentUser, classId: classRow.id, insertRelease, publishRelease });
  });
});
