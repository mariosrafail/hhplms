import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { json } from "../netlify-sites/ultimate-b2-builder/server/_builder-auth.js";
import { canonicalStudentsBookPages } from "../netlify-sites/ultimate-b2-builder/server/_builder-page-catalog.js";
import { createBuilderPagesHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-pages.js";
import { classifyBuilderPreviewAuthorization, issueBuilderPreviewAuthorization } from "../netlify-sites/ultimate-b2-builder/server/_builder-preview-authorization.js";
import runtime from "../src/data/ultimate-b2/generated/students-book.runtime.json" with { type: "json" };

const actor = "10000000-0000-4000-8000-000000000001";
const uploadId = "10000000-0000-4000-8000-000000000002";
const assetId = "10000000-0000-4000-8000-000000000003";
const base = "/builder/api/pages/books/ultimate-b2/components";
const first = canonicalStudentsBookPages[0];
const canonicalBytes = await readFile(new URL(`../${runtime.units[0].pages[0].pageImage.localHdAssetPath}`, import.meta.url));
const managedUnits = (componentSlug) => Array.from({ length: 10 }, (_, index) => ({
  id: `${componentSlug === "ultimate-b2-workbook" ? "20000000" : "30000000"}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  slug: `unit-${index + 1}`,
  unit_number: index + 1,
  title: `Unit ${index + 1}`,
  sort_order: index + 1,
}));

function request(path, body, overrides = {}) {
  return {
    httpMethod: overrides.method || (body ? "POST" : "GET"),
    path,
    headers: { host: "builder.example", origin: "https://builder.example", cookie: "live", "content-type": "application/json", ...overrides.headers },
    ...(overrides.queryStringParameters ? { queryStringParameters: overrides.queryStringParameters } : {}),
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

function harness(options = {}) {
  let prepared; let completed; let failed; let mutation; let canonicalMutation; let lifecycleMutation; let claimCount = 0;
  const storage = {
    signedPutUrl: async () => ({ url: "https://storage.example/upload", headers: { "Content-Type": first.image.mimeType } }),
    signedGetUrl: async () => "https://storage.example/private-preview",
    head: async () => ({ byteSize: canonicalBytes.length, contentType: first.image.mimeType }),
    download: async () => canonicalBytes,
    upload: async () => ({}),
    delete: async () => {},
    bucket: () => "private-assets",
  };
  const handler = createBuilderPagesHandler({
    getDatabase: () => ({}),
    authorize: async (event) => event.headers.cookie === "live" ? { builderUser: { id: actor } } : { error: json(401, { error: "Unauthorized" }) },
    ...(options.authorizePreview ? { authorizePreview: options.authorizePreview } : {}),
    randomUuid: () => uploadId,
    storage: () => storage,
    loadPages: async (_sql, identity) => options.loadPages?.(identity) || { revision: options.revision || 0, hotspotRevision: 0, rows: [], units: identity.componentSlug === "ultimate-b2-students-book" ? [] : managedUnits(identity.componentSlug) },
    loadHotspots: async () => options.hotspots || null,
    loadActivityReferences: async () => options.activityReferences || { nativeIndex: null, lifecycle: null, legacyActivityIds: [] },
    prepare: async (_sql, input) => {
      prepared = input;
      return { outcome: "prepared", upload_id: uploadId, current_revision: input.expectedRevision, session_state: "prepared", staging_object_key: input.stagingObjectKey };
    },
    loadUploadScope: options.loadUploadScope || (async () => options.uploadScope || ({
      bookSlug: prepared?.bookSlug || "ultimate-b2",
      componentSlug: prepared?.componentSlug || "ultimate-b2-students-book",
    })),
    claim: async () => {
      claimCount += 1;
      return ({
      outcome: "claimed", book_slug: "ultimate-b2", component_slug: "ultimate-b2-students-book",
      page_key: `${first.componentSlug}/pages/${first.id}`, upload_mode: "replace", current_revision: 0,
      page_metadata: prepared.pageMetadata, file_descriptor: prepared.fileDescriptor, staging_object_key: prepared.stagingObjectKey,
      ...options.claim,
      });
    },
    complete: async (_sql, input) => { completed = input; return { outcome: "saved", page_id: actor, asset_id: assetId, revision: 1 }; },
    fail: async (_sql, input) => { failed = input; return true; },
    mutate: async (_sql, input) => { mutation = input; return { outcome: "saved", current_revision: input.expectedRevision + 1 }; },
    mutateCanonical: async (_sql, input) => { canonicalMutation = input; mutation = input; return { outcome: "saved", current_revision: input.expectedRevision + 1 }; },
    deleteLifecycle: async (_sql, input) => { lifecycleMutation = input; return { outcome: "saved", current_revision: input.expectedRevision + 1, hotspot_revision: input.expectedHotspotRevision + (input.removedHotspotCount ? 1 : 0), removed_hotspot_count: input.removedHotspotCount, preserved_activity_count: input.preservedActivityCount }; },
    restorePage: options.restorePage || (async (_sql, input) => { mutation = input; return { outcome: "saved", current_revision: input.expectedRevision + 1 }; }),
    purgePage: options.purgePage || (async (_sql, input) => { mutation = input; return { outcome: "saved", current_revision: input.expectedRevision + 1 }; }),
    loadAsset: options.loadAsset || (async () => null),
    inspectRaster: options.inspectRaster,
    logger: { error() {} },
  });
  return { handler, getPrepared: () => prepared, getCompleted: () => completed, getFailed: () => failed, getMutation: () => mutation, getCanonicalMutation: () => canonicalMutation, getLifecycleMutation: () => lifecycleMutation, getClaimCount: () => claimCount };
}

test("Students Book Pages derives the complete canonical catalog and exposes no repository paths", async () => {
  const current = harness();
  const response = await current.handler(request(`${base}/ultimate-b2-students-book`));
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  const expected = runtime.units.flatMap((unit) => unit.pages);
  assert.equal(body.pages.length, expected.length);
  assert.deepEqual([...new Set(body.pages.map((page) => page.unitNumber))], runtime.units.map((unit) => Number(unit.number)));
  assert.deepEqual(body.pages.map((page) => page.id), expected.map((page) => page.id));
  assert.deepEqual(body.pages.map((page) => page.printedPages), expected.map((page) => page.pageNumbers));
  assert.ok(body.pages.every((page) => page.source === "repository-baseline" && page.image.url.startsWith("/page-library/")));
  assert.doesNotMatch(response.body, /repositoryPath|localHdAssetPath|Nextcloud|[A-Z]:\\/);
});

test("Workbook and Grammar Pages are authenticated component-scoped ten-Unit empty libraries", async () => {
  const current = harness();
  assert.equal((await current.handler(request(`${base}/ultimate-b2-workbook`, null, { headers: { cookie: "" } }))).statusCode, 401);
  const response = await current.handler(request(`${base}/ultimate-b2-workbook`));
  const workbook = JSON.parse(response.body);
  assert.deepEqual(workbook.pages, []);
  assert.deepEqual(workbook.units.map((unit) => unit.unitNumber), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const grammarResponse = await current.handler(request(`${base}/ultimate-b2-grammar-book`));
  assert.equal(grammarResponse.statusCode, 200);
  const grammar = JSON.parse(grammarResponse.body);
  assert.equal(grammar.component.title, "Grammar Book");
  assert.deepEqual(grammar.units.map((unit) => unit.title), Array.from({ length: 10 }, (_, index) => `Unit ${index + 1}`));
});

test("managed creation requires a valid Unit identity and preserves it in prepare metadata", async () => {
  const current = harness();
  const unitId = managedUnits("ultimate-b2-workbook")[0].id;
  const descriptor = { mode: "create", pageId: "", expectedRevision: 0, clientMutationId: randomUUID(), metadata: { label: "Workbook page", printedLabel: "4", sortOrder: 1 }, file: { name: "page.png", size: canonicalBytes.length, type: "image/png" } };
  assert.equal((await current.handler(request(`${base}/ultimate-b2-workbook/assets/prepare`, descriptor))).statusCode, 400);
  const accepted = await current.handler(request(`${base}/ultimate-b2-workbook/assets/prepare`, { ...descriptor, clientMutationId: randomUUID(), metadata: { ...descriptor.metadata, unitId } }));
  assert.equal(accepted.statusCode, 200);
  assert.equal(current.getPrepared().pageMetadata.unitId, unitId);
  assert.match(JSON.parse(accepted.body).pageId, /^wb-/);
});

test("managed list serializes relational Unit metadata and normalizes bigint revisions safely", async () => {
  const units = managedUnits("ultimate-b2-grammar-book");
  const current = harness({ loadPages: () => ({ revision: 9n, units, rows: [{
    id: actor, stable_key: "ultimate-b2-grammar-book/pages/gb-one", label: "Grammar page", sort_order: 2,
    unit_id: units[9].id, unit_slug: "unit-10", unit_number: 10, unit_title: "Unit 10", unit_sort_order: 10,
    source_metadata: { is_active: true, printed_label: "88" }, asset_id: assetId, mime_type: "image/png", byte_size: 10n,
    checksum_sha256: "a".repeat(64), width: 100, height: 200,
  }] }) });
  const response = await current.handler(request(`${base}/ultimate-b2-grammar-book`));
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.revision, 9);
  assert.deepEqual({ unitId: body.pages[0].unitId, unitNumber: body.pages[0].unitNumber, unitTitle: body.pages[0].unitTitle }, { unitId: units[9].id, unitNumber: 10, unitTitle: "Unit 10" });
  assert.equal(body.pages[0].image.byteSize, 10);
});

test("all components expose explicit page capabilities and safe Deleted Pages lifecycle metadata", async () => {
  const units = managedUnits("ultimate-b2-workbook");
  const studentOverride = harness({ loadPages: () => ({ revision: 2, hotspotRevision: 1, units, rows: [{
    stable_key: first.stableKey, label: "Edited Student label", sort_order: first.sortOrder + 4, unit_id: units[0].id,
    source_metadata: { has_metadata_override: true, printed_label: "Edited 6-7" }, asset_id: null,
  }] }) });
  const student = JSON.parse((await studentOverride.handler(request(`${base}/ultimate-b2-students-book`))).body);
  const edited = student.pages.find((page) => page.id === first.id);
  assert.equal(edited.label, "Edited Student label");
  assert.equal(edited.printedLabel, "Edited 6-7");
  assert.equal(edited.image.source, "repository-baseline");
  assert.deepEqual(edited.capabilities, { moveUp: true, moveDown: true, editMetadata: true, replaceImage: true, restoreCanonicalImage: false, deletePage: true });

  const deletedRow = { id: actor, stable_key: "ultimate-b2-workbook/pages/wb-deleted", label: "Deleted Workbook page", sort_order: 4,
    unit_id: units[0].id, unit_slug: "unit-1", unit_number: 1, unit_title: "Unit 1", unit_sort_order: 1,
    source_metadata: { is_active: false, is_deleted: true, printed_label: "14", removed_hotspot_count: 2, preserved_activity_count: 3, deleted_at: "2026-08-30T10:00:00Z" } };
  const managed = harness({ loadPages: () => ({ revision: 5, hotspotRevision: 2, units, rows: [deletedRow] }) });
  const workbook = JSON.parse((await managed.handler(request(`${base}/ultimate-b2-workbook`))).body);
  assert.deepEqual(workbook.pages, []);
  assert.deepEqual(workbook.deletedPages[0], {
    id: "wb-deleted", stableKey: deletedRow.stable_key, componentSlug: "ultimate-b2-workbook", source: "deleted", unitId: units[0].id,
    unitNumber: 1, unitTitle: "Unit 1", label: "Deleted Workbook page", printedLabel: "14", sortOrder: 4,
    removedHotspotCount: 2, preservedActivityCount: 3, deletedAt: "2026-08-30T10:00:00Z", canRestore: true, canDeleteCompletely: true,
  });
});

test("Students Book replacement prepare is baseline-bound and returns only signed upload authorization", async () => {
  const current = harness(); const clientMutationId = randomUUID();
  const valid = { mode: "replace", pageId: first.id, expectedRevision: 0, clientMutationId, metadata: { label: "ignored", printedLabel: "", sortOrder: 1 }, file: { name: "replacement.png", size: canonicalBytes.length, type: "image/png" } };
  assert.equal((await current.handler(request(`${base}/ultimate-b2-students-book/assets/prepare`, { ...valid, mode: "create" }))).statusCode, 400);
  assert.equal((await current.handler(request(`${base}/ultimate-b2-students-book/assets/prepare`, { ...valid, pageId: "unknown-page" }))).statusCode, 400);
  assert.equal((await current.handler(request(`${base}/ultimate-b2-students-book/assets/prepare`, valid, { headers: { origin: "https://attacker.example" } }))).statusCode, 403);
  const response = await current.handler(request(`${base}/ultimate-b2-students-book/assets/prepare`, valid));
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(current.getPrepared().pageMetadata.baselineWidth, first.image.width);
  assert.equal(current.getPrepared().pageMetadata.baselineHeight, first.image.height);
  assert.equal(body.pageId, first.id);
  assert.equal(JSON.stringify(body).includes("stagingObjectKey"), false);
});

test("finalize verifies actual raster bytes and preserves component/page identity", async () => {
  const current = harness(); const clientMutationId = randomUUID();
  const descriptor = { mode: "replace", pageId: first.id, expectedRevision: 0, clientMutationId, metadata: metadata(first), file: { name: "replacement.png", size: canonicalBytes.length, type: "image/png" } };
  await current.handler(request(`${base}/ultimate-b2-students-book/assets/prepare`, descriptor));
  const response = await current.handler(request(`${base}/ultimate-b2-students-book/assets/finalize`, { uploadId, expectedRevision: 0, clientMutationId }));
  assert.equal(response.statusCode, 200);
  assert.match(current.getCompleted().objectKey, new RegExp(`/ultimate-b2-students-book/${first.id}/assets/[a-f0-9]{64}\\.png$`));
  assert.equal(current.getCompleted().width, first.image.width);
  assert.equal(current.getCompleted().height, first.image.height);
  assert.doesNotMatch(response.body, /objectKey|storageBucket|private-assets/);
});

test("finalize rejects cross-component and cross-package upload scopes before claim", async () => {
  const body = { uploadId, expectedRevision: 0, clientMutationId: randomUUID() };
  const uploadScope = { bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-workbook" };
  for (const path of [
    "/builder/api/pages/books/ultimate-b1/components/ultimate-b1-grammar-book/assets/finalize",
    "/builder/api/pages/books/ultimate-b1-plus/components/ultimate-b1-plus-workbook/assets/finalize",
  ]) {
    const current = harness({ uploadScope });
    const response = await current.handler(request(path, body));
    assert.equal(response.statusCode, 409);
    assert.equal(JSON.parse(response.body).error, "upload_scope_conflict");
    assert.equal(current.getClaimCount(), 0);
  }
  const missing = harness({ loadUploadScope: async () => null });
  assert.equal((await missing.handler(request("/builder/api/pages/books/ultimate-b1/components/ultimate-b1-workbook/assets/finalize", body))).statusCode, 404);
  assert.equal(missing.getClaimCount(), 0);
});

test("replacement rejects dimension drift and preview lookup remains component-scoped", async () => {
  const wrong = harness({ inspectRaster: async () => ({ bytes: canonicalBytes, checksumSha256: "a".repeat(64), mimeType: "image/png", extension: ".png", byteSize: canonicalBytes.length, width: first.image.width + 1, height: first.image.height }) });
  const clientMutationId = randomUUID();
  await wrong.handler(request(`${base}/ultimate-b2-students-book/assets/prepare`, { mode: "replace", pageId: first.id, expectedRevision: 0, clientMutationId, metadata: metadata(first), file: { name: "replacement.png", size: canonicalBytes.length, type: "image/png" } }));
  const rejected = await wrong.handler(request(`${base}/ultimate-b2-students-book/assets/finalize`, { uploadId, expectedRevision: 0, clientMutationId }));
  assert.equal(rejected.statusCode, 400);
  assert.equal(JSON.parse(rejected.body).error, "students_book_page_dimensions_mismatch");
  assert.equal(wrong.getFailed().failureCode, "students_book_page_dimensions_mismatch");

  const scoped = harness({ loadAsset: async (_sql, input) => input.componentSlug === "ultimate-b2-students-book" ? { object_key: "private/page.png" } : null });
  const workbookPreview = await scoped.handler(request(`${base}/ultimate-b2-workbook/pages/${first.id}/assets/${assetId}/preview`));
  assert.equal(workbookPreview.statusCode, 404);
});

test("Student and managed delete use one revision-bound page/hotspot lifecycle mutation", async () => {
  const current = harness();
  const body = { expectedRevision: 0, expectedHotspotRevision: 0, clientMutationId: randomUUID(), metadata: {} };
  const student = await current.handler(request(`${base}/ultimate-b2-students-book/pages/${first.id}/delete`, body));
  assert.equal(student.statusCode, 200);
  assert.equal(current.getLifecycleMutation().pageKey, `ultimate-b2-students-book/pages/${first.id}`);
  assert.equal(current.getLifecycleMutation().hotspotDocument.pages[first.id], undefined);
  const workbook = await current.handler(request(`${base}/ultimate-b2-workbook/pages/wb-page-safe/delete`, body));
  assert.equal(workbook.statusCode, 200);
  assert.equal(current.getLifecycleMutation().pageKey, "ultimate-b2-workbook/pages/wb-page-safe");
  assert.equal(current.getLifecycleMutation().componentSlug, "ultimate-b2-workbook");
});

test("delete counts every authoritative activity on the page, not only hotspot targets", async () => {
  const current = harness({ activityReferences: {
    nativeIndex: { activities: [{ activityId: "native-one", placement: { pageId: first.id } }] },
    lifecycle: { activities: { "legacy-u1-p1-a1": { status: "active", pageId: first.id } } },
    legacyActivityIds: ["legacy-database-row"],
  } });
  const body = { expectedRevision: 0, expectedHotspotRevision: 0, clientMutationId: randomUUID(), metadata: {} };
  const response = await current.handler(request(`${base}/ultimate-b2-students-book/pages/${first.id}/delete`, body));
  assert.equal(response.statusCode, 200, response.body);
  assert.ok(current.getLifecycleMutation().preservedActivityCount >= 3);
});

test("Students Book reorder accepts the zero boundary needed to move before the first canonical page", async () => {
  const current = harness();
  const input = { expectedRevision: 0, clientMutationId: randomUUID(), metadata: { label: first.label, printedLabel: first.printedLabel, sortOrder: 0 } };
  const response = await current.handler(request(`${base}/ultimate-b2-students-book/pages/${first.id}/reorder`, input));
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(current.getMutation().pageMetadata.sortOrder, 0);
  assert.deepEqual(current.getCanonicalMutation().canonicalPage, {
    stableKey: first.stableKey, unitNumber: first.unitNumber, label: first.label, printedLabel: first.printedLabel,
    sortOrder: first.sortOrder, checksumSha256: first.image.checksumSha256, mimeType: first.image.mimeType,
    width: first.image.width, height: first.image.height,
  });
  const unknown = await current.handler(request(`${base}/ultimate-b2-students-book/pages/not-canonical/metadata`, { ...input, clientMutationId: randomUUID() }));
  assert.equal(unknown.statusCode, 404);
  assert.equal(JSON.parse(unknown.body).error, "page_not_found");
});

test("restore and Delete completely are component-scoped revision mutations with controlled schema rollout", async () => {
  const current = harness({ revision: 4 });
  const input = { expectedRevision: 4, clientMutationId: randomUUID(), metadata: {} };
  const restored = await current.handler(request(`${base}/ultimate-b2-workbook/pages/wb-deleted/restore`, input));
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(current.getMutation().componentSlug, "ultimate-b2-workbook");
  const purged = await current.handler(request(`${base}/ultimate-b2-grammar-book/pages/gb-deleted/purge`, { ...input, clientMutationId: randomUUID() }));
  assert.equal(purged.statusCode, 200, purged.body);
  assert.equal(current.getMutation().componentSlug, "ultimate-b2-grammar-book");

  const unavailable = harness({ restorePage: async () => { throw Object.assign(new Error("missing function"), { code: "42883" }); } });
  const response = await unavailable.handler(request(`${base}/ultimate-b2-workbook/pages/wb-deleted/restore`, { expectedRevision: 0, clientMutationId: randomUUID(), metadata: {} }));
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error, "page_lifecycle_schema_not_ready");
});

test("managed preview library authorization reaches every same-component page while page authorization remains exact", async () => {
  const environment = { BUILDER_PREVIEW_AUTH_SECRET: "managed-pages-test-secret-with-at-least-thirty-two-bytes" };
  const now = Date.parse("2026-08-27T12:00:00Z");
  const componentSlug = "ultimate-b2-workbook";
  const units = managedUnits(componentSlug);
  const pageIds = ["ultimate-b2-wb-unit-1-page-1", "ultimate-b2-wb-unit-1-page-2"];
  const rows = pageIds.map((pageId, index) => ({
    stable_key: `${componentSlug}/pages/${pageId}`, label: `Workbook page ${index + 1}`, sort_order: index + 1,
    unit_id: units[0].id, unit_slug: units[0].slug, unit_number: 1, unit_title: "Unit 1", unit_sort_order: 1,
    source_metadata: { is_active: true, printed_label: String(index + 1) }, asset_id: assetId, mime_type: "image/png", byte_size: 10,
    checksum_sha256: "a".repeat(64), width: 100, height: 200,
  }));
  const current = harness({
    authorizePreview: async (event, _sql, requestedScope) => classifyBuilderPreviewAuthorization(event, requestedScope, { environment, now }),
    loadPages: () => ({ revision: 2, units, rows }),
    loadAsset: async (_sql, input) => pageIds.includes(input.pageId) && input.componentSlug === componentSlug ? { object_key: `private/${input.pageId}.png` } : null,
  });
  const issue = (view, pageId, issuedAt = now) => issueBuilderPreviewAuthorization({ bookSlug: "ultimate-b2", componentSlug, view, pageId, activityId: null, releaseId: null }, { environment, now: issuedAt, nonce: `${view}-managed-pages-nonce` }).token;
  const libraryToken = issue("library", null);
  const pageToken = issue("page", pageIds[0]);
  const previewRoot = `/builder/preview/pages/books/ultimate-b2/components/${componentSlug}`;
  const call = (path, token) => current.handler(request(path, null, { headers: { cookie: "" }, queryStringParameters: token === undefined ? {} : { previewAuthorization: token } }));

  const catalog = await call(previewRoot, libraryToken);
  assert.equal(catalog.statusCode, 200);
  const catalogBody = JSON.parse(catalog.body);
  assert.deepEqual(catalogBody.pages.map(({ id }) => id), pageIds);
  assert.equal(catalogBody.pages.every((page) => new URL(page.image.url, "https://viewer.example").searchParams.get("previewAuthorization") === libraryToken), true);
  for (const pageId of pageIds) assert.equal((await call(`${previewRoot}/pages/${pageId}/assets/${assetId}/preview`, libraryToken)).statusCode, 302);
  assert.equal((await call(`${previewRoot}/pages/${pageIds[0]}/assets/${assetId}/preview`, pageToken)).statusCode, 302);
  assert.equal((await call(`${previewRoot}/pages/${pageIds[1]}/assets/${assetId}/preview`, pageToken)).statusCode, 401);
  assert.equal((await call(previewRoot.replace("workbook", "grammar-book"), libraryToken)).statusCode, 401);
  assert.equal((await call(previewRoot, undefined)).statusCode, 401);
  assert.equal((await call(previewRoot, "malformed")).statusCode, 401);
  assert.equal((await call(previewRoot, issue("library", null, now - 600_000))).statusCode, 401);
});

function metadata(page) {
  return { label: page.label, printedLabel: page.printedLabel, sortOrder: page.sortOrder };
}
