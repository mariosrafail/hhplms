import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { syntheticStudentsBookActivities } from "../fixtures/students-book-preservation.js";
import { builderDocumentSha256, stableBuilderJson } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { ultimateB2StudentsBookAuthoringActivities, ultimateB2StudentsBookAuthoringPages } from "../../src/data/ultimate-b2/studentsBookAuthoringCatalog.js";
import { historicalCombinedRelease } from "../fixtures/historical-combined.js";
import { canonicalStudentsBookPages } from "../../netlify-sites/ultimate-b2-builder/server/_builder-page-catalog.js";
import { prepareBuilderPageUpload, claimBuilderPageUpload, completeBuilderPageUpload } from "../../netlify-sites/ultimate-b2-builder/server/_builder-pages-store.js";
import sharp from "sharp";
import { createHash } from "node:crypto";

export async function captureStudentsBookPreservation(pool) {
  const tables = (await pool.query("select tablename from pg_tables where schemaname=current_schema() order by tablename")).rows;
  const snapshot = {};
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z][a-z0-9_]*$/);
    snapshot[tablename] = (await pool.query(`select to_jsonb(record) value from "${tablename}" record`)).rows
      .map(({ value }) => stableBuilderJson(value)).sort();
  }
  return snapshot;
}

export function assertStudentsBookDatabasePreserved(before, after, { addedUnits = 0, migration = null } = {}) {
  for (const [table, rows] of Object.entries(before)) {
    assert.ok(after[table], `Missing preserved table ${table}`);
    if (table === "eduforge_migration_history" && migration) {
      const original = new Set(rows);
      assert.ok(rows.every((row) => after[table].includes(row)), "Existing migration history changed");
      const added = after[table].filter((row) => !original.has(row)).map(JSON.parse);
      assert.equal(added.length, 1);
      assert.equal(added[0].filename, migration.filename);
      assert.equal(added[0].checksum_sha256, migration.checksum);
    }
    else if (table !== "units" || !addedUnits) assert.deepEqual(after[table], rows, `Preservation failed: ${table}`);
    else {
      assert.equal(after.units.length, rows.length + addedUnits);
      const actual = new Set(after.units);
      for (const row of rows) assert.ok(actual.has(row), "An existing Unit changed");
      const component = before.book_components.map(JSON.parse).find((row) => row.slug === "ultimate-b2-students-book");
      const newUnits = after.units.filter((row) => !rows.includes(row)).map(JSON.parse);
      assert.deepEqual(newUnits.map((row) => row.unit_number).sort((a, b) => a - b), [3, 4, 5, 6, 7, 8, 9, 10]);
      assert.ok(newUnits.every((row) => row.book_component_id === component.id && row.slug === `unit-${row.unit_number}`));
    }
  }
}

export async function seedStudentsBookPreservation(pool, extraCount = 2) {
  const actor = randomUUID();
  await pool.query("insert into builder_users(id,full_name,email,password_hash) values($1,'Synthetic preservation',$2,'not-a-login-hash')", [actor, `${actor}@example.test`]);
  const scope = (await pool.query("select package.id package_id,component.id component_id from book_packages package join book_components component on component.book_package_id=package.id where package.slug='ultimate-b2' and component.slug='ultimate-b2-students-book'")).rows[0];
  const activities = syntheticStudentsBookActivities(extraCount);
  const sql = async (strings, ...values) => (await pool.query(strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), values)).rows;
  const media = new Map();
  for (const [i, page] of canonicalStudentsBookPages.slice(0, 4).entries()) {
    const unit = (await pool.query("select id from units where book_component_id=$1 and unit_number=$2", [scope.component_id, page.unitNumber])).rows[0];
    if (i < 2) {
      const bytes = await sharp({ create: { width: page.image.width, height: page.image.height, channels: 3, background: i ? "#246789" : "#897654" } }).png().toBuffer();
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const uploadId = randomUUID();
      const mutation = randomUUID();
      const prepared = await prepareBuilderPageUpload(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", pageKey: page.stableKey, mode: "replace", expectedRevision: i, clientMutationId: mutation, uploadId, requestSha256: checksum, pageMetadata: { label: `Synthetic override ${i}`, printedLabel: `Custom ${i}`, sortOrder: 600 + i, baselineWidth: page.image.width, baselineHeight: page.image.height }, fileDescriptor: { name: "synthetic.png", size: bytes.length, type: "image/png" }, stagingObjectKey: `builder-page-assets/ultimate-b2/ultimate-b2-students-book/${page.id}/${uploadId}/staging/page-image`, builderUserId: actor, expiresAt: "2099-01-01T00:00:00Z" });
      assert.equal(prepared.outcome, "prepared");
      assert.equal((await claimBuilderPageUpload(sql, { uploadId, expectedRevision: i, clientMutationId: mutation, builderUserId: actor })).outcome, "claimed");
      const objectKey = `builder-page-assets/ultimate-b2/ultimate-b2-students-book/${page.id}/assets/${checksum}.png`;
      assert.equal((await completeBuilderPageUpload(sql, { uploadId, builderUserId: actor, objectKey, storageBucket: "synthetic-private", mimeType: "image/png", byteSize: bytes.length, checksumSha256: checksum, width: page.image.width, height: page.image.height })).outcome, "saved");
      media.set(objectKey, bytes);
    } else {
      await pool.query("insert into book_pages(book_package_id,book_component_id,unit_id,stable_key,label,sort_order,source_metadata) values($1,$2,$3,$4,$5,$6,$7)", [scope.package_id, scope.component_id, unit.id, page.stableKey, `Synthetic metadata ${i}`, 600 + i, { printed_label: `Custom ${i}`, has_metadata_override: true, is_deleted: i === 3, is_permanently_deleted: i === 3, is_active: i !== 3 }]);
    }
  }
  async function save(type, key, payload, revisionCount = 1) {
    for (let revision = 0; revision < revisionCount; revision += 1) {
      const saved = (await pool.query("select * from save_builder_component_document('ultimate-b2','ultimate-b2-students-book',$1,$2,'1.0',$3,$4::jsonb,$5,$6,$7)", [type, key, revision, JSON.stringify(payload), builderDocumentSha256(payload), actor, randomUUID()])).rows[0];
      assert.equal(saved.outcome, "saved");
    }
  }
  await save("native_activity_index", "default", { schemaVersion: "1.0", activities: activities.map((entry) => entry.index) }, 2);
  for (const entry of activities) {
    await save("native_activity_public", entry.index.activityId, entry.public.payload, entry.public.revision);
    await save("native_activity_teacher", entry.index.activityId, entry.teacher.payload, entry.teacher.revision);
  }
  const pages = {};
  for (let i = 0; i < 46; i += 1) {
    const entry = activities[i % 44];
    const page = ultimateB2StudentsBookAuthoringPages.find((page) => page.id === entry.index.placement.pageId);
    assert.ok(page);
    (pages[page.id] ||= []).push({ id: `synthetic-hotspot-${i}`, unitNumber: page.unitNumber, pageId: page.id, pageNumber: page.pageNumber, left: 5, top: 5 + i % 30, width: 15, height: 10, label: `Synthetic link ${i}`, actionType: "normalized_activity", activityKey: entry.index.activityId });
  }
  await save("hotspots", "default", { schemaVersion: "1.0", packageSlug: "ultimate-b2", componentSlug: "students-book", pages }, 3);
  await save("activity_lifecycle", "default", { schemaVersion: "1.0", activities: Object.fromEntries(ultimateB2StudentsBookAuthoringActivities.map((entry) => [entry.activityKey, { status: "retired", pageId: entry.pageId }])) }, 2);
  // Retained pairs are deliberately outside the active index. Fixture setup
  // creates their deletion history; transition tests never call Delete on them.
  for (let i = 0; i < 19; i += 1) {
    const activityId = `ultimate-b2-sb-u1-p1-o${500 + i}`;
    for (const [type, template] of [["native_activity_public", activities[0].public.payload], ["native_activity_teacher", activities[0].teacher.payload]]) {
      await save(type, activityId, { ...structuredClone(template), activityId });
    }
    await pool.query("insert into builder_native_activity_deletion_mutations(book_component_id,client_mutation_id,request_sha256,activity_id,resulting_index_revision,resulting_hotspot_revision,removed_hotspot_count,created_by_builder_user_id) values($1,$2,$3,$4,2,3,0,$5)", [scope.component_id, randomUUID(), "a".repeat(64), activityId, actor]);
  }
  const release = historicalCombinedRelease();
  const releaseId = randomUUID();
  await pool.query("insert into book_component_releases(id,book_package_id,book_component_id,release_number,release_schema_version,compiler_id,runtime_compatibility_sha256,source_snapshot,source_snapshot_sha256,public_projection,public_projection_sha256,teacher_projection,teacher_projection_sha256,asset_manifest,release_sha256,request_sha256,client_mutation_id,created_by_builder_user_id) values($1,$2,$3,11,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16)", [releaseId, scope.package_id, scope.component_id, release.release_schema_version, release.compiler_id, release.runtime_compatibility_sha256, release.source_snapshot, release.source_snapshot_sha256, release.public_projection, release.public_projection_sha256, release.teacher_projection, release.teacher_projection_sha256, JSON.stringify(release.asset_manifest), release.release_sha256, randomUUID(), actor]);
  const teacher = (await pool.query("select id,school_id from app_users where role='teacher' and school_id is not null limit 1")).rows[0];
  const student = (await pool.query("select id from app_users where role='student' and school_id=$1 limit 1", [teacher.school_id])).rows[0];
  const assignment = (await pool.query("insert into activity_assignments(school_id,teacher_id,student_id,title,target_kind,native_release_id,native_activity_id) values($1,$2,$3,'Synthetic historical assignment','published_native',$4,'ultimate-b2-sb-u1-p1-o99') returning id", [teacher.school_id, teacher.id, student.id, releaseId])).rows[0];
  await pool.query("insert into activity_submissions(activity_assignment_id,school_id,student_id,answers,response_schema_version,response_payload,status,submission_slot) values($1,$2,$3,'{}','1.0',$4,'submitted',1)", [assignment.id, teacher.school_id, student.id, { synthetic: true, response: "Preserve this historical response" }]);
  return { actor, scope, activities, releaseId, assignmentId: assignment.id, media };
}
