import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { studentsBookPageSql } from "./fixtures/students-book-current.js";

import { json } from "../netlify-sites/ultimate-b2-builder/server/_builder-auth.js";
import { createBuilderUnitExtraAssetsHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-unit-extra-assets.js";
import { loadBuilderUnitExtraAssetUploadScope } from "../netlify-sites/ultimate-b2-builder/server/_builder-unit-extra-assets-store.js";
import { nativeChildIdFromUuid } from "../src/data/native-activities/nativeChildIdentity.js";
import { createEmptyUltimateB2UnitExtras } from "../src/data/ultimate-b2/unitExtras.js";

const actor = "10000000-0000-4000-8000-000000000001";
const uploadId = "10000000-0000-4000-8000-000000000002";
const assetId = "10000000-0000-4000-8000-000000000003";
const itemId = nativeChildIdFromUuid("video", "10000000-0000-4000-8000-000000000004");
const audioItemId = nativeChildIdFromUuid("audio", "10000000-0000-4000-8000-000000000005");
const mp4 = await readFile(new URL("../src/assets/books/ultimate-b2/teacher-offline-media/ultimate-b2-startup-intro.mp4", import.meta.url));
const mp3 = await readFile(new URL("../src/assets/books/ultimate-b2/legacy-classroom-ui/audio/feedback/pop.mp3", import.meta.url));
const base = `/builder/api/unit-extras/books/ultimate-b2/components/ultimate-b2-students-book/units/unit-1/videos/${itemId}/assets`;
const audioBase = `/builder/api/unit-extras/books/ultimate-b2/components/ultimate-b2-students-book/units/unit-1/audios/${audioItemId}/assets`;
const request = (path, body, overrides = {}) => ({ httpMethod: overrides.method || "POST", path, headers: { host: "builder.example", origin: "https://builder.example", cookie: "live", "content-type": "application/json", ...overrides.headers }, body: JSON.stringify(body || {}) });

function harness({ claimOverrides = {}, uploadScopeOverrides = {}, storedActivityId = null, storedPageId = null, mediaKind = "videos", activeItemId = itemId, mediaBytes = mp4, mimeType = "video/mp4", completeFailure = false } = {}) {
  let prepared; let completed; let failed; let validated; let claimCount = 0; let archived = false; const deleted = [];
  const storage = {
    signedPutUrl: async () => ({ url: "https://storage.example/upload", headers: { "Content-Type": mimeType } }),
    signedGetUrl: async () => "https://storage.example/preview",
    head: async () => ({ byteSize: mediaBytes.length, contentType: mimeType }),
    download: async () => mediaBytes,
    upload: async () => ({ reused: false }),
    delete: async ({ objectKey }) => { deleted.push(objectKey); },
    bucket: () => "private-assets",
  };
  const loadAsset = async (_sql, input) => input.assetId === assetId ? {
    id: assetId,
    checksum_sha256: completed?.checksumSha256 || "a".repeat(64),
    asset_role: mediaKind === "audios" ? "unit_extra_audio" : "unit_extra_video",
    object_key: completed?.objectKey || `builder-unit-extras/${mediaKind === "audios" ? "audio.mp3" : "video.mp4"}`,
    storage_profile: "private",
    storage_bucket: "private-assets",
    mime_type: mimeType,
    byte_size: completed?.byteSize || mediaBytes.length,
    duration_seconds: mediaKind === "audios" ? null : (completed?.durationMs || 5_840) / 1_000,
    publication_status: "draft",
    access_level: "internal",
    activity_id: storedActivityId,
    page_id: storedPageId,
    source_metadata: { unit_extra_item_id: activeItemId, asset_slot: activeItemId },
  } : null;
  const handler = createBuilderUnitExtraAssetsHandler({
    getDatabase: () => studentsBookPageSql(),
    authorize: async (event) => event.headers.cookie === "live" ? { builderUser: { id: actor } } : { error: json(401, { error: "Unauthorized" }) },
    authorizePreview: async (event) => ({ authorized: event.headers["x-preview-authorized"] === "yes" }),
    resolveResource: async () => ({ schemaVersion: "1.0", validate: (value) => value }),
    randomUuid: () => uploadId,
    storage: () => storage,
    prepare: async (_sql, input) => { prepared = input; return { outcome: "prepared", uploadId, state: "prepared", fileDescriptor: input.fileDescriptor, stagingObjectKey: input.stagingObjectKey }; },
    loadUploadScope: async () => ({ bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", unitSlug: "unit-1", itemId: activeItemId, assetSlot: activeItemId, ...uploadScopeOverrides }),
    claim: async () => { claimCount += 1; return { outcome: "claimed", unitSlug: "unit-1", itemId: activeItemId, assetSlot: activeItemId, fileDescriptor: prepared.fileDescriptor, stagingObjectKey: prepared.stagingObjectKey, ...claimOverrides }; },
    complete: async (_sql, input) => { completed = input; if (completeFailure) throw new Error("database_finalize_failed"); return assetId; },
    fail: async (_sql, input) => { failed = input; return true; },
    loadAsset,
    validateAssets: async (_sql, input) => { validated = input; },
    saveDocument: async (_sql, input) => ({ outcome: "saved", revision: input.expectedRevision + 1, document: input.document }),
    archiveUnreferenced: async () => { archived = true; return []; },
    logger: { error() {} },
  });
  return { handler, getPrepared: () => prepared, getCompleted: () => completed, getFailed: () => failed, getValidated: () => validated, getArchived: () => archived, getDeleted: () => deleted, getClaimCount: () => claimCount };
}

test("Unit Extra store resolves the immutable actor-owned upload scope", async () => {
  const sql = async () => [{
    book_slug: "ultimate-b2",
    component_slug: "ultimate-b2-students-book",
    unit_slug: "unit-1",
    unit_extra_item_id: itemId,
    asset_slot: itemId,
  }];
  assert.deepEqual(await loadBuilderUnitExtraAssetUploadScope(sql, { uploadId, builderUserId: actor }), {
    bookSlug: "ultimate-b2",
    componentSlug: "ultimate-b2-students-book",
    unitSlug: "unit-1",
    itemId,
    assetSlot: itemId,
  });
  assert.equal(await loadBuilderUnitExtraAssetUploadScope(async () => [], { uploadId, builderUserId: actor }), null);
});

test("Unit Extra prepare is authenticated, same-origin, revision-bound, and MP4-only", async () => {
  const mutation = randomUUID();
  const valid = { expectedRevision: 1, clientMutationId: mutation, file: { name: "extra.mp4", size: mp4.length, type: "video/mp4", assetSlot: itemId } };
  assert.equal((await harness().handler(request(`${base}/prepare`, valid, { headers: { cookie: "" } }))).statusCode, 401);
  assert.equal((await harness().handler(request(`${base}/prepare`, valid, { headers: { origin: "https://attacker.example" } }))).statusCode, 403);
  for (const file of [{ ...valid.file, name: "../extra.mp4" }, { ...valid.file, name: "extra.webm", type: "video/webm" }, { ...valid.file, assetSlot: `${itemId}0` }]) {
    assert.equal((await harness().handler(request(`${base}/prepare`, { ...valid, file }))).statusCode, 400);
  }
  const current = harness();
  const response = await current.handler(request(`${base}/prepare`, valid));
  assert.equal(response.statusCode, 200);
  assert.equal(current.getPrepared().expectedRevision, 1);
  assert.equal(current.getPrepared().unitSlug, "unit-1");
  assert.equal(current.getPrepared().assetSlot, itemId);
  assert.equal(JSON.stringify(JSON.parse(response.body)).includes("stagingObjectKey"), false);
});

test("Unit Extra finalize inspects MP4, persists Unit-owned metadata, and exposes no private object identity", async () => {
  const current = harness(); const clientMutationId = randomUUID();
  await current.handler(request(`${base}/prepare`, { expectedRevision: 1, clientMutationId, file: { name: "extra.mp4", size: mp4.length, type: "video/mp4", assetSlot: itemId } }));
  const finalized = await current.handler(request(`${base}/finalize`, { uploadId, expectedRevision: 1, clientMutationId }));
  assert.equal(finalized.statusCode, 200);
  const body = JSON.parse(finalized.body);
  assert.deepEqual(body.reference, { assetId, checksumSha256: current.getCompleted().checksumSha256, role: "unit_extra_video", slot: itemId });
  assert.equal(body.metadata.durationMs, 5_840);
  assert.match(current.getCompleted().objectKey, new RegExp(`/unit-1/${itemId}/assets/[a-f0-9]{64}\\.mp4$`));
  assert.equal(JSON.stringify(body).includes("object_key"), false);
  const preview = await current.handler(request(`${base}/${assetId}/preview`, null, { method: "GET" }));
  assert.equal(preview.statusCode, 302);
  assert.equal(preview.headers.Location, "https://storage.example/preview");
});

test("standalone Unit Extra Audio accepts only MP3, inspects bytes, and returns an audio-scoped reference", async () => {
  const current = harness({ mediaKind: "audios", activeItemId: audioItemId, mediaBytes: mp3, mimeType: "audio/mpeg" });
  const clientMutationId = randomUUID();
  const prepared = await current.handler(request(`${audioBase}/prepare`, { expectedRevision: 1, clientMutationId, file: { name: "extra.mp3", size: mp3.length, type: "audio/mpeg", assetSlot: audioItemId } }));
  assert.equal(prepared.statusCode, 200);
  const wrong = await current.handler(request(`${audioBase}/prepare`, { expectedRevision: 1, clientMutationId: randomUUID(), file: { name: "extra.mp4", size: mp3.length, type: "video/mp4", assetSlot: audioItemId } }));
  assert.equal(wrong.statusCode, 400);
  const finalized = await current.handler(request(`${audioBase}/finalize`, { uploadId, expectedRevision: 1, clientMutationId }));
  assert.equal(finalized.statusCode, 200);
  const body = JSON.parse(finalized.body);
  assert.deepEqual(body.reference, { assetId, checksumSha256: current.getCompleted().checksumSha256, role: "unit_extra_audio", slot: audioItemId });
  assert.equal(Object.hasOwn(body.metadata, "durationMs"), false);
  assert.equal(current.getCompleted().durationMs, null);
  assert.match(current.getCompleted().objectKey, new RegExp(`/unit-1/${audioItemId}/assets/[a-f0-9]{64}\\.mp3$`));
});

test("a failed Unit Extra Audio database finalize removes newly created immutable and staging objects", async () => {
  const current = harness({ mediaKind: "audios", activeItemId: audioItemId, mediaBytes: mp3, mimeType: "audio/mpeg", completeFailure: true });
  const clientMutationId = randomUUID();
  await current.handler(request(`${audioBase}/prepare`, { expectedRevision: 1, clientMutationId, file: { name: "extra.mp3", size: mp3.length, type: "audio/mpeg", assetSlot: audioItemId } }));
  const response = await current.handler(request(`${audioBase}/finalize`, { uploadId, expectedRevision: 1, clientMutationId }));
  assert.equal(response.statusCode, 400);
  assert.equal(current.getDeleted().some((key) => key.endsWith("/staging/audio")), true);
  assert.equal(current.getDeleted().some((key) => new RegExp(`/assets/[a-f0-9]{64}\\.mp3$`).test(key)), true);
});

test("Saved Draft Unit Extra media uses a separate scoped no-cookie preview route", async () => {
  const previewPath = `/builder/preview/unit-extras/books/ultimate-b2/components/ultimate-b2-students-book/units/unit-1/videos/${itemId}/assets/${assetId}/preview`;
  const current = harness();
  assert.equal((await current.handler(request(previewPath, null, { method: "GET", headers: { cookie: "" } }))).statusCode, 401);
  const response = await current.handler(request(previewPath, null, { method: "GET", headers: { cookie: "", "x-preview-authorized": "yes" } }));
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.Location, "https://storage.example/preview");
  assert.equal(response.headers["Cache-Control"], "private, no-store");
});

test("Unit Extra finalize rejects cross-Unit sessions before claiming and rejects activity/page-owned assets", async () => {
  const clientMutationId = randomUUID();
  const wrongUnit = harness({ uploadScopeOverrides: { unitSlug: "unit-2" } });
  await wrongUnit.handler(request(`${base}/prepare`, { expectedRevision: 1, clientMutationId, file: { name: "extra.mp4", size: mp4.length, type: "video/mp4", assetSlot: itemId } }));
  const wrongUnitResponse = await wrongUnit.handler(request(`${base}/finalize`, { uploadId, expectedRevision: 1, clientMutationId }));
  assert.equal(wrongUnitResponse.statusCode, 409);
  assert.deepEqual(JSON.parse(wrongUnitResponse.body), { error: "upload_scope_conflict" });
  assert.equal(wrongUnit.getClaimCount(), 0);

  for (const ownership of [{ storedActivityId: actor }, { storedPageId: actor }]) {
    const current = harness(ownership); const mutation = randomUUID();
    await current.handler(request(`${base}/prepare`, { expectedRevision: 1, clientMutationId: mutation, file: { name: "extra.mp4", size: mp4.length, type: "video/mp4", assetSlot: itemId } }));
    const response = await current.handler(request(`${base}/finalize`, { uploadId, expectedRevision: 1, clientMutationId: mutation }));
    assert.equal(response.statusCode, 400);
    assert.equal(current.getFailed().failureCode, "asset_record_unavailable");
  }
});

test("Unit Extra save validates canonical references and archives only after a successful saved revision", async () => {
  const current = harness();
  const response = await current.handler(request("/builder/api/unit-extras/books/ultimate-b2/components/ultimate-b2-students-book/save", {
    expectedRevision: 0,
    clientMutationId: randomUUID(),
    document: createEmptyUltimateB2UnitExtras(),
  }));
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).revision, 1);
  assert.deepEqual(current.getValidated().document, createEmptyUltimateB2UnitExtras());
  assert.equal(current.getArchived(), true);
});
