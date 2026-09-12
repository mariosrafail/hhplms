import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";
import { collectStudentsBookPublicationV3Sources } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-sources-v3.js";
import { compileStudentsBookReleaseV3 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v3.js";
import { createComponentRelease, publishComponentRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-store.js";
import { verifyImmutableComponentRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { captureStudentsBookPreservation, assertStudentsBookDatabasePreserved } from "./_students-book-preservation.mjs";
import { createAssignment, listAssignmentsForStudent } from "../../netlify/functions/_book-content/assignment-actions.js";
import { createHomework, getTeacherHomework, updateHomework } from "../../netlify/functions/_book-content/homework-actions.js";
import { fetchActivity, fetchPackageTree } from "../../netlify/functions/_book-content-utils.js";
import { studentSafePackageTree } from "../../netlify/functions/_book-content/shared.js";
import { verifyB2OverviewFont } from "./_overview-b2-font-regression.mjs";

const databaseUrl = process.env.TEST_DATABASE_URL || "";
const enabled = Boolean(databaseUrl) && process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";

test("Students Book v3 SQL freshness agrees with the actual collector/compiler and rejects stale Unit/page metadata", { skip: !enabled }, async (t) => {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname));
  const schema = `sb_v3_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 }); await admin.query(`create schema "${schema}"`);
  const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  t.after(async () => { await pool.end(); await admin.query(`drop schema "${schema}" cascade`); await admin.end(); });
  await applyCanonicalProductionMigrations(pool);
  const sql = async (strings, ...values) => (await pool.query(strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), values)).rows;
  const actor = randomUUID();
  await pool.query("insert into builder_users(id,full_name,email,password_hash) values($1,'V3 synthetic actor',$2,'synthetic')", [actor, `${actor}@example.test`]);
  const component = (await pool.query("select * from book_components where slug='ultimate-b2-students-book'")).rows[0];
  const verifyTransition = await seedLegacyTransition(pool, sql, component);
  const before = await captureStudentsBookPreservation(pool);
  const compiled = compileStudentsBookReleaseV3(await collectStudentsBookPublicationV3Sources(sql));
  const snapshot = (await pool.query("select builder_students_book_v3_page_snapshot($1) snapshot", [component.id])).rows[0].snapshot;
  assert.deepEqual(snapshot, { units: compiled.publicProjection.units, pages: compiled.publicProjection.pages });
  assertStudentsBookDatabasePreserved(before, await captureStudentsBookPreservation(pool));
  const created = await createComponentRelease(sql, { ...compiled, bookSlug: "ultimate-b2", componentSlug: component.slug, requestSha256: compiled.releaseSha256, releaseNote: "Synthetic metadata freshness", clientMutationId: randomUUID(), builderUserId: actor });
  assert.equal(created.outcome, "created");
  assert.equal((await pool.query("select builder_current_legacy_activity_allowed($1) allowed", [component.id])).rows[0].allowed, true, "A prepared v3 release must not activate source policy");
  const current = async () => (await pool.query("select builder_release_sources_are_current($1) current", [created.releaseId])).rows[0].current;
  assert.equal(await current(), true);
  const row = (await pool.query("select * from book_component_releases where id=$1", [created.releaseId])).rows[0];
  assert.deepEqual(verifyImmutableComponentRelease(row).publicProjection, compiled.publicProjection);
  // Direct mutations concern only this disposable fixture, and deliberately do
  // not bump page revision: freshness must compare the actual captured topology.
  await pool.query("update units set title='Edited Unit' where id=$1", [compiled.publicProjection.units[0].id]);
  assert.equal(await current(), false);
  const published = await publishComponentRelease(sql, { bookSlug: "ultimate-b2", componentSlug: component.slug, releaseId: created.releaseId, expectedHeadRevision: 0, requestSha256: "a".repeat(64), builderUserId: actor, clientMutationId: randomUUID() });
  assert.equal(published.outcome, "stale_release_preview");
  assert.equal((await pool.query("select count(*)::int count from book_component_publication_heads")).rows[0].count, 0);
  assert.deepEqual(verifyImmutableComponentRelease(row).publicProjection, compiled.publicProjection);
  await pool.query("update units set title=$2 where id=$1", [compiled.publicProjection.units[0].id, compiled.publicProjection.units[0].title]);
  const activated = await publishComponentRelease(sql, { bookSlug: "ultimate-b2", componentSlug: component.slug, releaseId: created.releaseId, expectedHeadRevision: 0, requestSha256: "b".repeat(64), builderUserId: actor, clientMutationId: randomUUID() });
  assert.equal(activated.outcome, "published");
  await verifyTransition();
  await verifyB2OverviewFont({ pool, sql, actor });
});

async function seedLegacyTransition(pool, sql, component) {
  const teacher = { ...(await pool.query("select id,school_id from app_users where role='teacher' and school_id is not null limit 1")).rows[0], role: "teacher" };
  const student = { ...(await pool.query("select id,school_id from app_users where role='student' and school_id=$1 limit 1", [teacher.school_id])).rows[0], role: "student" };
  await pool.query("update app_users set status='active' where id=$1", [student.id]);
  await pool.query("insert into book_access(user_id,book_package_id,role_scope) values($1,$2,'teacher'),($3,$2,'student') on conflict do nothing", [teacher.id, component.book_package_id, student.id]);
  const lesson = (await pool.query("select lesson.id from lessons lesson join units unit on unit.id=lesson.unit_id where unit.book_component_id=$1 limit 1", [component.id])).rows[0];
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await pool.query("insert into activities(lesson_id,title,slug,type,activity_type,content,content_json,settings_json,is_assignable) values($1,'Disposable source policy',$2,'multiple_choice','multiple_choice','{}','{}','{}',true) returning id", [lesson.id, `source-policy-${randomUUID()}`])).rows[0].id);
  const classId = (await pool.query("insert into classes(school_id,name,slug,teacher_id,book_package_id,status,invite_code) values($1,'Source policy',$2,$3,$4,'active',$5) returning id", [teacher.school_id, `source-policy-${randomUUID()}`, teacher.id, component.book_package_id, randomBytes(5).toString("hex")])).rows[0].id;
  await pool.query("insert into class_students(class_id,student_id,status) values($1,$2,'active')", [classId, student.id]);
  sql.homeworkMutationTransaction = async (homeworkId, callback) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`homework:${homeworkId}`]);
      const tagged = async (strings, ...values) => (await client.query(strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), values)).rows;
      const result = await callback(tagged); await client.query("commit"); return result;
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  };
  const success = (response, expectedStatus = 200) => { assert.equal(response.statusCode, expectedStatus, response.body); return JSON.parse(response.body); };
  const assignment = success(await createAssignment(sql, { activityId: ids[0], classIds: [classId], idempotencyKey: randomUUID() }, teacher)).assignment;
  const homeworkInput = { title: "Before v3", classIds: [classId], items: ids.slice(0, 2).map((activityId) => ({ kind: "legacy_activity", activityId })), idempotencyKey: randomUUID() };
  const homework = success(await createHomework(sql, homeworkInput, teacher), 201).homework;
  const beforeItems = (await pool.query("select * from homework_items where homework_id=$1 order by id", [homework.id])).rows;
  const beforeAssignments = (await pool.query("select * from activity_assignments where homework_id=$1 order by id", [homework.id])).rows;
  const beforeTree = await fetchPackageTree(sql, { packageId: component.book_package_id });
  const beforeComponent = beforeTree.components.find((entry) => entry.slug === component.slug);
  assert.equal(beforeComponent.legacyDiscoveryAllowed, true);
  assert(beforeComponent.units.flatMap((unit) => unit.lessons.flatMap((lesson) => lesson.exercises)).some((activity) => activity.id === ids[0]));
  assert.deepEqual(beforeTree.components.map((entry) => entry.slug), [component.slug, "ultimate-b2-workbook"]);
  assert(await fetchActivity(sql, { activityId: ids[0], currentDiscovery: true }));
  return async () => {
    assert.equal((await pool.query("select builder_current_legacy_activity_allowed($1) allowed", [component.id])).rows[0].allowed, false);
    assert.equal(await fetchActivity(sql, { activityId: ids[0], currentDiscovery: true }), null);
    assert(await fetchActivity(sql, { activityId: ids[0] }), "Historical internal resolution remains available");
    const afterTree = await fetchPackageTree(sql, { packageId: component.book_package_id });
    assert.deepEqual(afterTree.components, beforeTree.components.map((entry) => entry.slug === component.slug
      ? { ...entry, legacyDiscoveryAllowed: false, units: [] } : entry), "The published book card survives without its current legacy hierarchy; other component policies are unchanged");
    const safeComponent = studentSafePackageTree(afterTree).components.find((entry) => entry.slug === component.slug);
    assert.equal(safeComponent.legacyDiscoveryAllowed, false);
    assert.deepEqual(safeComponent.units, []);
    const denied = await createAssignment(sql, { activityId: ids[0], classIds: [classId], idempotencyKey: randomUUID() }, teacher);
    assert.equal(denied.statusCode, 409); assert.equal(JSON.parse(denied.body).code, "students_book_native_publication_required");
    assert.equal((await createHomework(sql, { ...homeworkInput, idempotencyKey: randomUUID() }, teacher)).statusCode, 409);
    const detail = await getTeacherHomework(sql, homework.id, teacher.id, teacher);
    assert.ok(detail);
    const edited = await updateHomework(sql, { homeworkId: homework.id, expectedUpdatedAt: detail.updatedAt, title: "Before v3", teacherNotes: "Existing historical Homework retained", classIds: [classId], items: homeworkInput.items }, teacher);
    success(edited);
    assert.deepEqual((await pool.query("select * from homework_items where homework_id=$1 order by id", [homework.id])).rows, beforeItems);
    const afterAssignments = (await pool.query("select * from activity_assignments where homework_id=$1 order by id", [homework.id])).rows;
    assert.deepEqual(afterAssignments.map(({ teacher_notes, updated_at, ...assignment }) => assignment), beforeAssignments.map(({ teacher_notes, updated_at, ...assignment }) => assignment));
    assert(afterAssignments.every((entry, index) => entry.updated_at > beforeAssignments[index].updated_at));
    assert(afterAssignments.every((entry) => entry.teacher_notes === "Existing historical Homework retained"));
    const updated = await getTeacherHomework(sql, homework.id, teacher.id, teacher);
    assert.equal((await updateHomework(sql, { homeworkId: homework.id, expectedUpdatedAt: updated.updatedAt, title: updated.title, classIds: [classId], items: [homeworkInput.items[0], { kind: "legacy_activity", activityId: ids[2] }] }, teacher)).statusCode, 409);
    const listed = await listAssignmentsForStudent(sql, student.id, student, { assignmentId: assignment.id });
    assert(listed.some((entry) => entry.id === assignment.id));
    await assert.rejects(pool.query("insert into activity_assignments(school_id,activity_id,teacher_id,student_id,title) values($1,$2,$3,$4,'Bypass')", [teacher.school_id, ids[0], teacher.id, student.id]), (error) => error.code === "PZ004");
    await assert.rejects(pool.query("insert into homework_items(homework_id,position,target_kind,activity_id) values($1,3,'legacy_activity',$2)", [homework.id, ids[2]]), (error) => error.code === "PZ004");
    const otherPolicies = (await pool.query("select slug,builder_current_legacy_activity_allowed(id) allowed from book_components where id<>$1", [component.id])).rows;
    const managedOnly = new Set(["ultimate-b1-students-book", "ultimate-b1-workbook", "ultimate-b1-plus-students-book", "ultimate-b1-plus-workbook"]);
    assert(otherPolicies.length > 1 && otherPolicies.every((entry) => entry.allowed === !managedOnly.has(entry.slug)));
  };
}
