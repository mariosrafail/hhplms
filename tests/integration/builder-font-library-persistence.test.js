import { exerciseOldschoolTypographyPairSave } from "./_oldschool-typography-persistence.mjs";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import {
  claimBuilderFontUpload,
  completeBuilderFontUpload,
  listBuilderFonts,
  loadBuilderFontAsset,
  prepareBuilderFontUpload,
  validateBuilderNativeAssetReferences,
} from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activity-store.js";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";
import { runtimeSchemaContract } from "../../netlify/functions/_runtime-schema-contract.js";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL || "";
const enabled = Boolean(databaseUrl) && process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";
const actor = "10000000-0000-4000-8000-000000000001";
const checksum = "b719ecb31c5b21fc573c03f6421c74ac63c271a5a3ff841e34f9705fb94b8448";
function scoped(base, schema) { const url = new URL(base); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); }
function tag(pool) { return async (strings, ...values) => { let text = strings[0]; for (let index = 0; index < values.length; index += 1) text += `$${index + 1}${strings[index + 1]}`; return (await pool.query(text, values)).rows; }; }

test("isolated PostgreSQL scopes, deduplicates, and validates reusable component fonts", { skip: !enabled }, async (t) => {
  const schema = `builder_fonts_${randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`create schema "${schema}"`);
  const pool = new Pool({ connectionString: scoped(databaseUrl, schema), max: 5 });
  t.after(async () => { await pool.end(); await admin.query(`drop schema if exists "${schema}" cascade`); await admin.end(); });
  const migrations = await applyCanonicalProductionMigrations(pool);
  assert.equal(migrations.at(-1).filename, runtimeSchemaContract.latestMigration);
  await pool.query("insert into builder_users(id,full_name,email,password_hash) values($1,'Font Actor','font-actor@example.test','hash')", [actor]);
  const sql = tag(pool);

  async function prepareClaim(componentSlug) {
    const uploadId = randomUUID(); const clientMutationId = randomUUID();
    const input = {
      bookSlug: "ultimate-b2", componentSlug, clientMutationId, uploadId,
      requestSha256: randomBytes(32).toString("hex"),
      fileDescriptor: { name: "Ahem.ttf", size: 21768, type: "font/ttf", displayLabel: "Ahem" },
      stagingObjectKey: `builder-font-library/ultimate-b2/${componentSlug}/${uploadId}/staging/font`,
      builderUserId: actor, expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
    assert.equal((await prepareBuilderFontUpload(sql, input)).outcome, "prepared");
    assert.equal((await claimBuilderFontUpload(sql, { uploadId, clientMutationId, builderUserId: actor })).outcome, "claimed");
    return { uploadId, clientMutationId };
  }
  async function finish(componentSlug, session, digest = checksum) {
    return completeBuilderFontUpload(sql, {
      uploadId: session.uploadId, builderUserId: actor,
      objectKey: `builder-font-library/ultimate-b2/${componentSlug}/assets/${digest}.ttf`,
      storageBucket: "private-assets", mimeType: "font/ttf", byteSize: 21768,
      checksumSha256: digest, displayLabel: "Ahem", originalFilename: "Ahem.ttf",
    });
  }

  const first = await prepareClaim("ultimate-b2-students-book");
  const firstAssetId = await finish("ultimate-b2-students-book", first);
  assert.match(firstAssetId, /^[0-9a-f-]{36}$/);
  const replay = await claimBuilderFontUpload(sql, { uploadId: first.uploadId, clientMutationId: first.clientMutationId, builderUserId: actor });
  assert.equal(replay.outcome, "idempotent"); assert.equal(replay.resultingAssetId, firstAssetId);

  const second = await prepareClaim("ultimate-b2-students-book");
  assert.equal(await finish("ultimate-b2-students-book", second), firstAssetId, "identical bytes deduplicate inside the component");
  assert.equal((await listBuilderFonts(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" })).length, 1);
  assert.equal((await listBuilderFonts(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-workbook" })).length, 0);
  assert.equal(await loadBuilderFontAsset(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-workbook", assetId: firstAssetId }), null);

  const workbook = await prepareClaim("ultimate-b2-workbook");
  const workbookAssetId = await finish("ultimate-b2-workbook", workbook);
  assert.notEqual(workbookAssetId, firstAssetId, "the same bytes retain a distinct component ownership identity");
  assert.equal((await pool.query("select count(*)::int count from book_assets where asset_role='activity_font' and checksum_sha256=$1", [checksum])).rows[0].count, 2);

  const reference = { assetId: firstAssetId, checksumSha256: checksum, role: "activity_font", slot: `font-${firstAssetId.replaceAll("-", "")}` };
  await assert.doesNotReject(validateBuilderNativeAssetReferences(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", activityId: "activity-one", assets: [reference], requirements: [{ slot: reference.slot, mediaType: "font/ttf", label: "Complete the Sentences font" }] }));
  await assert.doesNotReject(validateBuilderNativeAssetReferences(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", activityId: "activity-two", assets: [reference], requirements: [{ slot: reference.slot, mediaType: "font/ttf", label: "Complete the Sentences font" }] }));
  await assert.rejects(validateBuilderNativeAssetReferences(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-workbook", activityId: "activity-two", assets: [reference] }));
  await assert.rejects(validateBuilderNativeAssetReferences(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", activityId: "activity-two", assets: [{ ...reference, slot: "font-forged" }] }));

  await exerciseOldschoolTypographyPairSave({ pool, sql, actor, fontReference: reference });

  const row = await loadBuilderFontAsset(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", assetId: firstAssetId });
  assert.equal(row.source_metadata.font_library_scope, "component");
  assert.equal(row.source_metadata.display_label, "Ahem");
  assert.equal(row.storage_profile, "private"); assert.equal(row.access_level, "internal"); assert.equal(row.publication_status, "draft");
  const audit = await pool.query("select metadata from builder_audit_log where action='builder_font_finalized' order by created_at");
  assert.equal(audit.rows.some((entry) => entry.metadata.reused_existing_asset === true), true);
  assert.doesNotMatch(JSON.stringify(audit.rows), /filename|object|checksum|token|secret/i);
});
