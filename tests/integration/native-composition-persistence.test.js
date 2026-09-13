import { exerciseVisualTargetPersistence } from "./_visual-target-persistence.mjs";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { loadProductionMigrationManifest } from "../../scripts/_migration-readiness.mjs";
import { createBuilderNativeActivitiesHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activities.js";
import { builderTeacherAnswerAssetsReady } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-teacher-assets.js";
import { prepareBuilderNativeAssetUpload, claimBuilderNativeAssetUpload, completeBuilderNativeAssetUpload } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activity-store.js";
const url = process.env.TEST_DATABASE_URL || "";
const enabled = Boolean(url) && process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";
const actor = "10000000-0000-4000-8000-000000000001";
const identity = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" };
const root = "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book";
const event = (suffix, body) => ({ httpMethod: "POST", path: `${root}/${suffix}`, headers: { host: "localhost:8888", origin: "http://localhost:8888", "content-type": "application/json" }, body: JSON.stringify(body) });

test("isolated PostgreSQL transitions protected assets without changing public raster dedup and creates one Multi-Part parent", { skip: !enabled }, async (t) => {
  const schema = `native_composition_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 }); await admin.query(`create schema "${schema}"`);
  const scoped = new URL(url); scoped.searchParams.set("options", `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: scoped.toString(), max: 3 });
  t.after(async () => { await pool.end(); await admin.query(`drop schema "${schema}" cascade`); await admin.end(); });
  const sql = async (strings, ...values) => (await pool.query(strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values)).rows;
  const migrations = await loadProductionMigrationManifest();
  for (const migration of migrations.filter((entry) => !entry.filename.startsWith("058_"))) await pool.query(migration.sql);
  assert.equal(await builderTeacherAnswerAssetsReady(sql), false);
  await pool.query("insert into builder_users(id,full_name,email,password_hash) values($1,'Synthetic Actor','composition@example.test','not-a-password')", [actor]);
  const handler = createBuilderNativeActivitiesHandler({ getDatabase: () => sql, authorize: async () => ({ builderUser: { id: actor } }), logger: { error() {}, warn() {} } });
  const created = await handler(event("create", { kind: "image", title: "Protected raster", pageId: "ub2-sb-unit-1-part-1", clientMutationId: randomUUID() }));
  assert.equal(created.statusCode, 200, created.body);
  const activityId = JSON.parse(created.body).activityId;
  const prepare = { name: "answer.png", size: 68, type: "image/png", assetSlot: "sample", purpose: "teacher-answer", clientMutationId: randomUUID() };
  const before = await handler(event(`activities/${activityId}/assets/prepare`, prepare));
  assert.equal(before.statusCode, 503, before.body);
  await pool.query(migrations.find((entry) => entry.filename.startsWith("058_")).sql);
  assert.equal(await builderTeacherAnswerAssetsReady(sql), true);
  const upload = async (purpose, slot, invalidPath = false) => {
    const uploadId = randomUUID(); const clientMutationId = randomUUID();
    await prepareBuilderNativeAssetUpload(sql, { ...identity, activityId, assetSlot: slot, uploadId, clientMutationId, builderUserId: actor, requestSha256: randomBytes(32).toString("hex"), fileDescriptor: { name: "answer.png", size: 68, type: "image/png", assetSlot: slot, purpose }, stagingObjectKey: `builder-native-assets/${identity.bookSlug}/${identity.componentSlug}/${activityId}/${uploadId}/staging/asset`, expiresAt: new Date(Date.now() + 600000).toISOString() });
    await claimBuilderNativeAssetUpload(sql, { uploadId, clientMutationId, builderUserId: actor });
    return completeBuilderNativeAssetUpload(sql, { uploadId, builderUserId: actor, objectKey: `builder-native-assets/${identity.bookSlug}/${identity.componentSlug}/${activityId}/assets/${purpose === "teacher-answer" && !invalidPath ? "teacher-answers/" : ""}${"a".repeat(64)}.png`, storageBucket: "private-assets", mimeType: "image/png", byteSize: 68, checksumSha256: "a".repeat(64), width: 1, height: 1 });
  };
  const publicAsset = await upload("native-asset", "public-first");
  assert.equal(await upload("native-asset", "public-second"), publicAsset);
  await assert.rejects(upload("teacher-answer", "bad-path", true), /invalid protected/);
  const privateAsset = await upload("teacher-answer", "answer-first");
  assert.notEqual(privateAsset, publicAsset);
  assert.equal(await upload("teacher-answer", "answer-second"), privateAsset);
  const row = (await pool.query("select * from book_assets where id=$1", [privateAsset])).rows[0];
  assert.equal(row.asset_role, "native_teacher_answer"); assert.equal(row.source_metadata.asset_slot, "answer-first"); assert.equal(row.access_level, "internal");
  const descriptor = { sha256: row.checksum_sha256, extension: "png", mediaType: "image/png", role: row.asset_role };
  const privateTeacher = { nativeActivities: { [activityId]: { document: { parts: [{ solution: { kind: "image", sampleAnswer: { image: { reference: { assetId: privateAsset, checksumSha256: row.checksum_sha256, role: row.asset_role, slot: "answer-first" } } } } }] } } } };
  const insertRelease = async (teacher, number) => (await pool.query(`insert into book_component_releases(
    book_package_id,book_component_id,release_number,release_schema_version,compiler_id,runtime_compatibility_sha256,
    source_snapshot,source_snapshot_sha256,public_projection,public_projection_sha256,teacher_projection,teacher_projection_sha256,
    asset_manifest,release_sha256,request_sha256,client_mutation_id,created_by_builder_user_id,asset_storage_mode)
    values($1,$2,$3,'2.0','ultimate-b2-students-book-v2',$4,'{}',$4,'{}',$4,$5,$4,$6,$4,$4,$7,$8,'pinned-source-v1') returning id`,
  [row.book_package_id, row.book_component_id, number, "b".repeat(64), JSON.stringify(teacher), JSON.stringify([descriptor]), randomUUID(), actor])).rows[0].id;
  const insertPin = (releaseId, slot = "answer-first") => pool.query(`insert into book_component_release_asset_pins(
    component_release_id,book_package_id,book_component_id,book_asset_id,asset_role,source_asset_role,checksum_sha256,byte_size,
    media_type,extension,storage_profile,storage_bucket,object_key,source_owner_key,source_asset_slot,pin_sha256)
    values($1,$2,$3,$4,$5,$5,$6,$7,'image/png','png','private',$8,$9,$10,$11,
    builder_release_asset_pin_sha256($4,$5,$5,$6,$7,'image/png','png','private',$8,$9,$10,$11))`,
  [releaseId, row.book_package_id, row.book_component_id, privateAsset, row.asset_role, row.checksum_sha256, row.byte_size, row.storage_bucket, row.object_key, activityId, slot]);
  const foreignTeacher = { nativeActivities: { foreign: privateTeacher.nativeActivities[activityId] } };
  await assert.rejects(insertPin(await insertRelease(foreignTeacher, 1)), /release_pin_integrity_failed/);
  const pinnedRelease = await insertRelease(privateTeacher, 2);
  await assert.rejects(insertPin(pinnedRelease, "forged-slot"), /release_pin_integrity_failed/);
  await insertPin(pinnedRelease);
  assert.equal((await pool.query("select count(*)::int count from book_component_release_asset_pins where component_release_id=$1", [pinnedRelease])).rows[0].count, 1);
  await assert.rejects(pool.query("delete from book_assets where id=$1", [privateAsset]), /pinned|referenc|violates/i);
  const multi = await handler(event("create", { kind: "multi-part", title: "One parent", pageId: "ub2-sb-unit-1-part-1", clientMutationId: randomUUID() }));
  assert.equal(multi.statusCode, 200, multi.body);
  const multiId = JSON.parse(multi.body).activityId;
  const docs = (await pool.query("select payload from builder_component_documents where document_key=$1 and document_type in ('native_activity_public','native_activity_teacher')", [multiId])).rows;
  await exerciseVisualTargetPersistence({ pool, sql, handler, event, actor, identity });
  assert.equal(docs.length, 2); assert.ok(docs.every((entry) => entry.payload.kind === "multi-part" && entry.payload.parts.length === 1));
});
