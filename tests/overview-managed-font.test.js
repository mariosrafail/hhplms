import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { normalizeHostedTeacherUiDocument, projectHostedTeacherUiPreview } from "../src/data/ultimate-b2/hostedTeacherUiDocument.js";
import { buildBuilderFontLibraryObjectKey } from "../lib/book-assets/object-keys.js";
import { collectOverviewFont, validateOverviewFontRow, mergeOverviewFontSources, deliverOverviewFont } from "../netlify-sites/ultimate-b2-builder/server/_builder-overview-font.js";
import { compileManagedUiReleaseV2 } from "../netlify-sites/ultimate-b2-builder/server/_builder-managed-ui-publication-compiler.js";
import { compileStudentsBookReleaseV3 } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v3.js";
import { verifyImmutableComponentRelease } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { builderDocumentSha256 as hash } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { publishedManagedBookSources, managedPageRouteIds } from "./fixtures/published-managed-book.js";
import { studentsBookV3Sources, studentsBookV3ReleaseRow as row } from "./fixtures/students-book-publication-v3.js";
import { freezeComponentPublicationAssetPins } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-pins.js";
import { createBuilderPreviewHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-preview.js";
import { createBuilderTeacherUiAssetsHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-teacher-ui-assets.js";
import { createTeacherRuntimeUiAssetModel } from "../src/apps/android-teacher-offline/teacherRuntimeUiAssetModel.js";
import { ultimateB2TeacherAppAuthoring } from "../src/data/ultimate-b2/teacherAppAuthoring.js";

const bytes = Buffer.from(await readFile(new URL("./fixtures/fonts/Ahem.ttf.base64", import.meta.url), "utf8"), "base64");
const checksum = createHash("sha256").update(bytes).digest("hex");
const assetId = "abcdef12-1234-4567-89ab-123456789abc";
const reference = { assetId, checksumSha256: checksum, role: "activity_font", slot: `font-${assetId.replaceAll("-", "")}` };
const identity = (bookSlug) => ({ bookSlug, componentSlug: `${bookSlug}-students-book` });
const document = (book) => ({ schemaVersion: "1.0", packageId: `${book}-students-book`, assets: {}, overviewCaptionFontAsset: reference });
const fontRow = (book) => ({ id: assetId, checksum_sha256: checksum, asset_role: "activity_font", mime_type: "font/ttf", byte_size: bytes.length,
  publication_status: "draft", access_level: "internal", storage_profile: "private", storage_bucket: "private-assets",
  book_slug: book, component_slug: `${book}-students-book`, source_metadata: { font_library_scope: "component" },
  object_key: buildBuilderFontLibraryObjectKey({ ...identity(book), checksum }) });

test("overview managed reference is closed, canonical and mutually exclusive; historical bytes stay unchanged", () => {
  const base = { schemaVersion: "1.0", packageId: "ultimate-b2-students-book", assets: {} };
  for (const family of [null, "Arial", "Georgia", "Verdana"]) {
    const input = { schemaVersion: base.schemaVersion, packageId: base.packageId, ...(family ? { overviewCaptionFontFamily: family } : {}), assets: {} };
    assert.equal(JSON.stringify(normalizeHostedTeacherUiDocument(input)), JSON.stringify(input));
  }
  assert.deepEqual(normalizeHostedTeacherUiDocument(document("ultimate-b2")).overviewCaptionFontAsset, reference);
  for (const invalid of [null, {}, { ...reference, role: "activity_artwork" }, { ...reference, slot: "font-arbitrary" }, { ...reference, familyAlias: "unsafe" }, { ...reference, checksumSha256: "x" }]) {
    assert.throws(() => normalizeHostedTeacherUiDocument({ ...base, overviewCaptionFontAsset: invalid }));
  }
  assert.throws(() => normalizeHostedTeacherUiDocument({ ...document("ultimate-b2"), overviewCaptionFontFamily: "Arial" }));
});

for (const book of ["ultimate-b1", "ultimate-b1-plus", "ultimate-b2"]) {
  test(`${book}: owned font freezes once, stays out of Student projection and is delivered from a verified immutable pin`, async () => {
    const scope = identity(book), ui = document(book), source = validateOverviewFontRow(ui, fontRow(book), scope);
    const sources = book === "ultimate-b2" ? studentsBookV3Sources() : publishedManagedBookSources(scope.componentSlug, { pageIds: await managedPageRouteIds(scope.componentSlug) });
    sources.documents.teacherUi = { payload: ui, revision: 1, sha256: hash(ui) };
    sources.overviewFontSources = [source];
    const compiled = book === "ultimate-b2" ? compileStudentsBookReleaseV3(sources) : compileManagedUiReleaseV2(sources, scope.componentSlug);
    const release = { ...row(compiled), id: randomUUID(), asset_storage_mode: "pinned-source-v1" };
    const verified = verifyImmutableComponentRelease(release);
    assert.deepEqual(verified.teacherProjection.ui.overviewCaptionFontAsset, reference);
    assert.equal(compiled.publicProjection.assets.some((asset) => asset.sha256 === checksum), false);
    assert.equal(JSON.stringify(compiled.publicProjection).includes(assetId), false);
    assert.equal(compiled.assetManifest.filter((asset) => asset.sha256 === checksum).length, 1);
    const sharedSources = structuredClone(sources);
    const activity = Object.values(sharedSources.native.activities).find((entry) => entry.public.payload.kind === "open-response");
    activity.public.payload.assets.push(reference);
    activity.public.payload.parts[0].interaction.questions[0].responseRegion.presentation.answerFontAssetSlot = reference.slot;
    activity.public.sha256 = hash(activity.public.payload);
    sharedSources.native.assetRows.push(fontRow(book));
    const shared = book === "ultimate-b2" ? compileStudentsBookReleaseV3(sharedSources) : compileManagedUiReleaseV2(sharedSources, scope.componentSlug);
    verifyImmutableComponentRelease(row(shared));
    assert.equal(shared.assetManifest.filter((asset) => asset.sha256 === checksum).length, 1);
    assert.equal(shared.nativeAssetSources.filter((entry) => entry.descriptor.sha256 === checksum).length, 1);
    assert.equal(shared.publicProjection.assets.filter((asset) => asset.sha256 === checksum).length, 1, "only an independently referencing public activity exposes this shared font");
    const storage = { bucket: () => "private-assets", head: async () => ({ checksumSha256: checksum, byteSize: bytes.length, contentType: "font/ttf" }), download: async () => bytes };
    const [pin] = await freezeComponentPublicationAssetPins(storage, { ...scope, assetManifest: [source.descriptor], nativeAssetSources: [source] });
    const storedPin = { component_release_id: release.id, book_asset_id: pin.assetId, asset_role: pin.role, source_asset_role: pin.sourceAssetRole,
      checksum_sha256: pin.checksumSha256, byte_size: pin.byteSize, media_type: pin.mediaType, extension: pin.extension, storage_profile: pin.storageProfile,
      storage_bucket: pin.storageBucket, object_key: pin.objectKey, source_owner_key: pin.ownerKey, source_asset_slot: pin.assetSlot, pin_sha256: pin.pinSha256 };
    const response = await deliverOverviewFont({ release, verified, method: "GET", storage, loadPin: async () => storedPin });
    assert.deepEqual(Buffer.from(response.body, "base64"), bytes);
    assert.equal(response.headers["Content-Type"], "font/ttf");
    await assert.rejects(deliverOverviewFont({ release, verified, method: "GET", storage, loadPin: async () => ({ ...storedPin, book_asset_id: randomUUID() }) }));
    const frozen = structuredClone(release); sources.documents.teacherUi.payload = { ...ui, overviewCaptionFontAsset: { ...reference, checksumSha256: "a".repeat(64) } };
    assert.deepEqual(release, frozen); verifyImmutableComponentRelease(release);
    const missing = structuredClone(release); missing.asset_manifest = missing.asset_manifest.filter((asset) => asset.sha256 !== checksum);
    assert.throws(() => verifyImmutableComponentRelease(missing));
    assert.equal(mergeOverviewFontSources([source], [source]).length, 1);
    assert.throws(() => mergeOverviewFontSources([source], [{ ...source, row: { ...source.row, id: randomUUID() } }]));
  });
  test(`${book}: Save rejects forged reference before mutation; draft delivery requires Teacher authorization`, async () => {
    const scope = identity(book), ui = document(book);
    for (const change of [{ id: randomUUID() }, { checksum_sha256: "b".repeat(64) }, { book_slug: "foreign" }, { component_slug: "foreign" }, { publication_status: "archived" }, { access_level: "public" }, { storage_profile: "public" }, { source_metadata: {} }]) {
      assert.throws(() => validateOverviewFontRow(ui, { ...fontRow(book), ...change }, scope));
    }
    const loadFont = async (_sql, requested) => requested.bookSlug === book ? fontRow(book) : null;
    await assert.rejects(collectOverviewFont({}, document("foreign"), identity("foreign"), loadFont));
    let writes = 0;
    const save = createBuilderTeacherUiAssetsHandler({ getDatabase: () => ({}), authorize: async () => ({ builderUser: { id: randomUUID() } }),
      overviewFontReady: async () => true, collectOverviewFont: async () => { throw new Error("foreign"); }, saveDocument: async () => { writes++; } });
    const result = await save({ path: `/builder/api/ui-assets/books/${book}/components/${scope.componentSlug}/save`, httpMethod: "POST",
      headers: { host: "builder.example", origin: "https://builder.example", "content-type": "application/json" }, body: JSON.stringify({ document: ui, candidateUploadIds: [], expectedRevision: 0, clientMutationId: randomUUID() }) });
    assert.equal(result.statusCode, 400, result.body); assert.equal(writes, 0);
    let authorized = false, reads = 0;
    const preview = createBuilderPreviewHandler({ getDatabase: () => ({}), authorizePreview: async () => authorized, loadDocument: async () => ({ document: ui, revision: 1 }),
      collectOverviewFont: async () => { reads++; return [validateOverviewFontRow(ui, fontRow(book), scope)]; }, storage: () => ({ download: async () => bytes }) });
    const event = { path: `/builder/preview/content/books/${book}/components/${scope.componentSlug}/ui-controller/font`, httpMethod: "GET" };
    assert.equal((await preview(event)).statusCode, 401); assert.equal(reads, 0);
    authorized = true; const delivered = await preview(event); assert.equal(delivered.statusCode, 200, delivered.body); assert.deepEqual(Buffer.from(delivered.body, "base64"), bytes);
  });
}

test("runtime resolves draft authorization, immutable Teacher endpoint and supplied frozen local font separately", () => {
  const authorization = `v2.YQ.${"a".repeat(43)}`, scope = identity("ultimate-b1");
  const input = { authoring: ultimateB2TeacherAppAuthoring, resolveCanonicalAssetUrl: () => "/canonical.png", hostedPreview: projectHostedTeacherUiPreview(document("ultimate-b1"), { packageId: scope.componentSlug }), identity: scope };
  const model = (runtimeContext, extra = {}) => createTeacherRuntimeUiAssetModel({ ...input, runtimeContext, ...extra }).classroom;
  assert.match(model({ kind: "builder-preview", authorization }).overviewCaptionFontUrl, /ui-controller\/font\?previewAuthorization=/);
  assert.match(model({ kind: "release-preview", releaseId: randomUUID(), authorization: authorization.replace("v2", "v3") }).overviewCaptionFontUrl, /teacher-ui-font\?previewAuthorization=/);
  assert.equal(model({ kind: "bare" }).overviewCaptionFontUrl, null, "offline never falls back to the mutable library");
  assert.equal(model({ kind: "bare" }, { resolveFrozenFontUrl: () => "/pack/frozen.ttf" }).overviewCaptionFontUrl, "/pack/frozen.ttf");
});
