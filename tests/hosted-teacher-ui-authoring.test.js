import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createBuilderTeacherUiAssetsHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-teacher-ui-assets.js";
import {
  HOSTED_EDITABLE_UI_BINDINGS,
  HOSTED_EDITABLE_UI_BINDINGS_BY_ID,
  HOSTED_TEACHER_UI_TITLE_BINDING_IDS,
} from "../src/data/ultimate-b2/hostedTeacherUiBindingCatalog.js";
import {
  createEmptyHostedTeacherUiDocument,
  hostedTeacherUiAssetPath,
  normalizeHostedTeacherUiDocument,
  normalizeHostedTeacherUiPreview,
  projectHostedTeacherUiPreview,
} from "../src/data/ultimate-b2/hostedTeacherUiDocument.js";
import { ultimateB2TeacherAppAuthoring, ultimateB2TeacherAppDefaultAssets } from "../src/data/ultimate-b2/teacherAppAuthoring.js";
import { createTeacherRuntimeUiAssetModel } from "../src/apps/android-teacher-offline/teacherRuntimeUiAssetModel.js";
import { builderTeacherUiAssetApiScopedRoot, teacherUiAssetErrorMessage } from "../src/apps/book-builder/hosted/builderTeacherUiAssetApi.js";

const actorId = "10000000-0000-4000-8000-000000000001";
const headers = { host: "builder.example", origin: "https://builder.example", "content-type": "application/json" };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFgAI/ScL4WQAAAABJRU5ErkJggg==", "base64");
const checksum = createHash("sha256").update(png).digest("hex");

function asset(overrides = {}) {
  return { sha256: checksum, extension: "png", mediaType: "image/png", sizeBytes: png.length, width: 1, height: 1, originalFilename: "replacement.png", ...overrides };
}

function event(path, body, httpMethod = "POST", requestHeaders = headers) {
  return { httpMethod, path, headers: requestHeaders, body: body === undefined ? "" : JSON.stringify(body) };
}

class MemoryStorage {
  objects = new Map();
  uploads = [];
  signed = [];
  key(profile, objectKey) { return `${profile}:${objectKey}`; }
  async signedPutUrl(input) { this.signed.push(input); return { url: `https://uploads.invalid/${input.objectKey}`, headers: { "Content-Type": input.contentType }, expiresIn: input.ttlSeconds }; }
  async head({ profile, objectKey }) { const item = this.objects.get(this.key(profile, objectKey)); if (!item) throw Object.assign(new Error("NotFound"), { name: "NotFound" }); return { byteSize: item.body.length, contentType: item.contentType, checksumSha256: item.sha256 || null }; }
  async download({ profile, objectKey }) { return Buffer.from(this.objects.get(this.key(profile, objectKey)).body); }
  async upload(input) { const key = this.key(input.profile, input.objectKey); if (!this.objects.has(key)) { this.objects.set(key, { body: Buffer.from(input.body), contentType: input.contentType, sha256: input.checksumSha256 }); this.uploads.push(input); return { reused: false }; } return { reused: true }; }
  async delete({ profile, objectKey }) { this.objects.delete(this.key(profile, objectKey)); }
  publicUrl(objectKey) { return `https://books.invalid/${objectKey}`; }
}

const authorize = async () => ({ builderUser: { id: actorId } });
const fakeInspect = async ({ bytes, originalFilename, descriptor }) => {
  const mediaType = descriptor.section === "audio" ? "audio/mpeg" : descriptor.variant === "gaf" ? "application/x-gaf" : "image/png";
  const extension = mediaType === "audio/mpeg" ? ".mp3" : mediaType === "application/x-gaf" ? ".gaf" : ".png";
  const raster = mediaType.startsWith("image/");
  return {
    bytes,
    metadata: { sha256: createHash("sha256").update(bytes).digest("hex"), mediaType, sizeBytes: bytes.length, width: raster ? 1 : null, height: raster ? 1 : null, originalFilename },
    inspection: { extension, gaf: descriptor.variant === "gaf" ? { sources: [{ atlasId: 1, csf: 1 }, { atlasId: 2, csf: 1 }, { atlasId: 1, csf: 2 }, { atlasId: 2, csf: 2 }] } : null },
  };
};

test("hosted Teacher UI catalog is the unique live subset of canonical bindings", () => {
  assert.equal(HOSTED_EDITABLE_UI_BINDINGS.length, 144);
  assert.equal(HOSTED_EDITABLE_UI_BINDINGS_BY_ID["navigation.videoWorksheet"].label, "Video Worksheet");
  assert.equal(ultimateB2TeacherAppDefaultAssets["navigation.videoWorksheet"].repositoryPath, ultimateB2TeacherAppDefaultAssets["navigation.video"].repositoryPath);
  assert.equal(new Set(HOSTED_EDITABLE_UI_BINDINGS.map(({ id }) => id)).size, HOSTED_EDITABLE_UI_BINDINGS.length);
  for (const binding of HOSTED_EDITABLE_UI_BINDINGS) assert.ok(ultimateB2TeacherAppDefaultAssets[binding.id], binding.id);
  assert.equal(HOSTED_EDITABLE_UI_BINDINGS.some(({ id }) => id.startsWith("page.")), false);
  assert.equal(HOSTED_EDITABLE_UI_BINDINGS.some(({ id }) => ultimateB2TeacherAppDefaultAssets[id].role === "navibar-library"), false);
  assert.deepEqual(HOSTED_TEACHER_UI_TITLE_BINDING_IDS, ["title.gaf", "title.sd.1", "title.sd.2", "title.hd.1", "title.hd.2"]);
  assert.deepEqual(HOSTED_EDITABLE_UI_BINDINGS.filter(({ category, mediaFamily }) => category === "sounds" && mediaFamily === "audio").map(({ id }) => id), ["sound.button", "sound.correct", "sound.incorrect", "sound.page-turn"]);
});

test("package controllers separate effective visual thumbnails from the read-only four-sound inventory", async () => {
  const [visualController, soundController] = await Promise.all([
    readFile("src/apps/ultimate-b2-builder/HostedTeacherUiController.jsx", "utf8"),
    readFile("src/apps/ultimate-b2-builder/HostedSoundController.jsx", "utf8"),
  ]);
  assert.match(visualController, /category !== "sounds" && mediaFamily !== "audio"/);
  assert.match(visualController, /previewUrls\[binding\.id\][\s\S]*hostedTeacherUiAssetPath\(saved, identity\)[\s\S]*resolveUltimateB2BuilderVisualAssetUrl\(binding\.id\)/);
  assert.match(visualController, /URL\.createObjectURL\(file\)/);
  assert.match(visualController, /URL\.revokeObjectURL/);
  assert.match(visualController, /effective (?:asset|atlas)/);
  assert.match(soundController, /category === "sounds" && binding\.mediaFamily === "audio"/);
  assert.match(soundController, /Sound authoring will be added in a later milestone\./);
  assert.match(soundController, /saved \? "Saved override" : "Canonical"/);
  assert.doesNotMatch(soundController, /type="file"|uploadTeacherUiAsset|saveTeacherUiDocument|<audio\b|<button\b/);
  for (const source of [visualController, soundController]) {
    assert.match(source, /bookSlug = "ultimate-b2"/);
    assert.match(source, /componentSlug = "ultimate-b2-students-book"/);
    assert.match(source, /bookTitle = "Ultimate B2"/);
    assert.match(source, /normalizeHostedTeacherUiDocument\(payload\.document, /);
  }
  assert.match(visualController, /prepareTeacherUiAssets\(\{ bookSlug, componentSlug,/);
  assert.match(visualController, /saveTeacherUiDocument\(\{ bookSlug, componentSlug,/);
});

test("hosted Teacher UI operational errors have concise non-secret messages", () => {
  assert.equal(teacherUiAssetErrorMessage("teacher_ui_storage_unavailable"), "Teacher interface asset storage is unavailable. Contact the hosted Builder operator.");
  assert.equal(teacherUiAssetErrorMessage("teacher_ui_schema_unavailable"), "Teacher interface upload records are unavailable. Contact the hosted Builder operator.");
  assert.equal(teacherUiAssetErrorMessage("invalid_filename"), "invalid_filename");
});

test("hosted Teacher UI schema normalizes overrides, strips private diagnostics, and enforces the title group", () => {
  const document = normalizeHostedTeacherUiDocument({ ...createEmptyHostedTeacherUiDocument(), assets: { "background.main": asset() } });
  assert.equal(document.assets["background.main"].originalFilename, "replacement.png");
  const projection = projectHostedTeacherUiPreview(document);
  assert.equal("originalFilename" in projection.assets["background.main"], false);
  assert.deepEqual(normalizeHostedTeacherUiPreview(projection), projection);
  for (const invalid of [
    { ...createEmptyHostedTeacherUiDocument(), assets: { "page.reading-19": asset() } },
    { ...createEmptyHostedTeacherUiDocument(), assets: { "navibar.back.active": asset() } },
    { ...createEmptyHostedTeacherUiDocument(), assets: { "background.main": { ...asset(), url: "https://evil.invalid/a.png" } } },
    { ...createEmptyHostedTeacherUiDocument(), assets: { "title.gaf": asset({ extension: "gaf", mediaType: "application/x-gaf", width: null, height: null, originalFilename: "title.gaf" }) } },
  ]) assert.throws(() => normalizeHostedTeacherUiDocument(invalid));
});

test("hosted Teacher UI documents and draft assets preserve B2 compatibility while scoping B1/B1+ identities", () => {
  const sample = asset();
  assert.equal(createEmptyHostedTeacherUiDocument().packageId, "ultimate-b2-students-book");
  assert.equal(hostedTeacherUiAssetPath(sample), `/preview/ui-assets-v2/${checksum}.png`);
  for (const bookSlug of ["ultimate-b1", "ultimate-b1-plus"]) {
    const componentSlug = `${bookSlug}-students-book`;
    const empty = createEmptyHostedTeacherUiDocument(componentSlug);
    assert.deepEqual(empty, { schemaVersion: "1.0", packageId: componentSlug, assets: {} });
    assert.equal(normalizeHostedTeacherUiDocument(empty, { packageId: componentSlug }).packageId, componentSlug);
    assert.throws(() => normalizeHostedTeacherUiDocument(empty), /identity/);
    assert.equal(hostedTeacherUiAssetPath(sample, { bookSlug, componentSlug }), `/preview/ui-assets-v2/books/${bookSlug}/components/${componentSlug}/${checksum}.png`);
    assert.equal(builderTeacherUiAssetApiScopedRoot({ bookSlug, componentSlug }), `/builder/api/ui-assets/books/${bookSlug}/components/${componentSlug}`);
  }
  assert.throws(() => builderTeacherUiAssetApiScopedRoot({ bookSlug: "../b1", componentSlug: "ultimate-b1-students-book" }), /identity/);
});

test("B1 runtime UI uses the same immutable definitions with B1 package metadata and scoped overrides", () => {
  const identity = { bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-students-book" };
  const document = normalizeHostedTeacherUiDocument({ ...createEmptyHostedTeacherUiDocument(identity.componentSlug), assets: { "background.main": asset() } }, { packageId: identity.componentSlug });
  const preview = projectHostedTeacherUiPreview(document, { packageId: identity.componentSlug });
  const resolved = createTeacherRuntimeUiAssetModel({ authoring: ultimateB2TeacherAppAuthoring, resolveCanonicalAssetUrl: ({ id }) => `canonical:${id}`, hostedPreview: preview, identity });
  assert.equal(resolved.classroom.backgrounds.classroomGlacier, `/preview/ui-assets-v2/books/ultimate-b1/components/ultimate-b1-students-book/${checksum}.png`);
  assert.equal(Object.keys(resolved.classroom.sounds).length, 4);
});

test("runtime factory changes only the selected binding and reaches menu, toolbar, navigation, title, sound, hotspot, and media chrome", () => {
  const canonical = createTeacherRuntimeUiAssetModel({ authoring: ultimateB2TeacherAppAuthoring, resolveCanonicalAssetUrl: ({ id }) => `canonical:${id}` });
  const preview = projectHostedTeacherUiPreview(normalizeHostedTeacherUiDocument({ ...createEmptyHostedTeacherUiDocument(), assets: { "background.main": asset() } }));
  const resolved = createTeacherRuntimeUiAssetModel({ authoring: ultimateB2TeacherAppAuthoring, resolveCanonicalAssetUrl: ({ id }) => `canonical:${id}`, hostedPreview: preview });
  assert.equal(resolved.classroom.backgrounds.classroomGlacier, `/preview/ui-assets-v2/${checksum}.png`);
  assert.equal(resolved.classroom.backgrounds.studentsBookPartsBackground, canonical.classroom.backgrounds.studentsBookPartsBackground);
  for (const value of [resolved.classroom.branding.bookMenu.units, resolved.toolbarItems, resolved.classroom.bookSwitches, resolved.classroom.revealControls, resolved.classroom.branding.menuTitle, resolved.classroom.sounds, resolved.classroom.controls, resolved.classroom.mediaPlayer]) assert.ok(value);
});

test("exact release Teacher UI assets use the explicit UI-owner member context", () => {
  const releaseId = "10000000-0000-4000-8000-000000000099";
  const productReleaseId = "10000000-0000-4000-8000-000000000098";
  const memberSha256 = "b".repeat(64);
  const token = `v3.${Buffer.from("scope").toString("base64url")}.${"a".repeat(43)}`;
  const preview = projectHostedTeacherUiPreview(normalizeHostedTeacherUiDocument({ ...createEmptyHostedTeacherUiDocument(), assets: { "background.main": asset() } }));
  const runtimeContext = { kind: "release-preview", teacherPreview: true, authorization: token, productReleaseId, releaseId, memberSha256 };
  const resolved = createTeacherRuntimeUiAssetModel({ authoring: ultimateB2TeacherAppAuthoring, resolveCanonicalAssetUrl: ({ id }) => `canonical:${id}`, hostedPreview: preview, runtimeContext });
  assert.equal(resolved.classroom.backgrounds.classroomGlacier, `/preview/releases/books/ultimate-b2/components/ultimate-b2-students-book/${releaseId}/assets/${checksum}.png?previewAuthorization=${encodeURIComponent(token)}`);
});

test("prepare authenticates one allowlisted slot, creates opaque private staging, and rejects excluded or partial groups", async () => {
  const storage = new MemoryStorage();
  let preparedInput;
  const handler = createBuilderTeacherUiAssetsHandler({
    getDatabase: () => ({}), authorize, storage: () => storage,
    prepare: async (_sql, input) => { preparedInput = input; return { outcome: "prepared", uploadId: input.uploadId, currentRevision: 0, state: "prepared", fileDescriptors: input.fileDescriptors }; },
    logger: { error() {} },
  });
  const response = await handler(event("/builder/api/ui-assets/prepare", { expectedRevision: 0, clientMutationId: randomUUID(), files: [{ bindingId: "background.main", name: "local.png", size: png.length, type: "image/png" }] }));
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(storage.signed[0].profile, "private");
  assert.equal(preparedInput.fileDescriptors[0].objectKey.includes("local.png"), false);
  assert.doesNotMatch(response.body, /objectKey|bucket|accessKey|secret/i);
  for (const files of [
    [{ bindingId: "page.reading-19", name: "local.png", size: 1, type: "image/png" }],
    [{ bindingId: "navibar.back.active", name: "local.png", size: 1, type: "image/png" }],
    [{ bindingId: "title.gaf", name: "title.gaf", size: 1, type: "application/x-gaf" }],
    [{ bindingId: "background.main", name: "../local.png", size: 1, type: "image/png" }],
  ]) assert.equal((await handler(event("/builder/api/ui-assets/prepare", { expectedRevision: 0, clientMutationId: randomUUID(), files }))).statusCode, 400);
  const unauthenticated = createBuilderTeacherUiAssetsHandler({ getDatabase: () => ({}), authorize: async () => ({ error: { statusCode: 401, headers: {}, body: "" } }), logger: { error() {} } });
  assert.equal((await unauthenticated(event("/builder/api/ui-assets/prepare", {}))).statusCode, 401);
});

test("prepare reports schema and storage outages safely without changing request validation", async () => {
  const request = () => event("/builder/api/ui-assets/prepare", { expectedRevision: 0, clientMutationId: randomUUID(), files: [{ bindingId: "background.main", name: "local.png", size: png.length, type: "image/png" }] });
  const diagnostics = [];
  const base = { getDatabase: () => ({}), authorize, logger: { error: (_message, diagnostic) => diagnostics.push(diagnostic) } };

  const schemaUnavailable = createBuilderTeacherUiAssetsHandler({
    ...base,
    prepare: async () => { throw Object.assign(new Error("database details must stay private"), { code: "42883" }); },
  });
  const schemaResponse = await schemaUnavailable(request());
  assert.equal(schemaResponse.statusCode, 503);
  assert.deepEqual(JSON.parse(schemaResponse.body), { error: "teacher_ui_schema_unavailable" });
  assert.deepEqual(diagnostics.pop(), { category: "schema", code: "42883" });
  assert.doesNotMatch(schemaResponse.body, /database|42883/i);

  const configurationUnavailable = createBuilderTeacherUiAssetsHandler({
    ...base,
    prepare: async (_sql, input) => ({ outcome: "prepared", uploadId: input.uploadId, currentRevision: 0, state: "prepared", fileDescriptors: input.fileDescriptors }),
    storage: () => { throw new Error("missing secret configuration details"); },
  });
  const configurationResponse = await configurationUnavailable(request());
  assert.equal(configurationResponse.statusCode, 503);
  assert.deepEqual(JSON.parse(configurationResponse.body), { error: "teacher_ui_storage_unavailable" });
  assert.deepEqual(diagnostics.pop(), { category: "storage", code: "unknown" });
  assert.doesNotMatch(configurationResponse.body, /missing|secret/i);

  const signingStorage = new MemoryStorage();
  signingStorage.signedPutUrl = async () => { throw Object.assign(new Error("signing details must stay private"), { code: "CredentialsProviderError" }); };
  const signingUnavailable = createBuilderTeacherUiAssetsHandler({
    ...base,
    prepare: async (_sql, input) => ({ outcome: "prepared", uploadId: input.uploadId, currentRevision: 0, state: "prepared", fileDescriptors: input.fileDescriptors }),
    storage: () => signingStorage,
  });
  const signingResponse = await signingUnavailable(request());
  assert.equal(signingResponse.statusCode, 503);
  assert.deepEqual(JSON.parse(signingResponse.body), { error: "teacher_ui_storage_unavailable" });
  assert.deepEqual(diagnostics.pop(), { category: "storage", code: "CredentialsProviderError" });
  assert.doesNotMatch(signingResponse.body, /signing|credentials/i);

  const invalidDescriptor = await configurationUnavailable(event("/builder/api/ui-assets/prepare", { expectedRevision: 0, clientMutationId: randomUUID(), files: [{ bindingId: "background.main", name: "../local.png", size: png.length, type: "image/png" }] }));
  assert.equal(invalidDescriptor.statusCode, 400);
  const invalidOrigin = await configurationUnavailable(event("/builder/api/ui-assets/prepare", {}, "POST", { ...headers, origin: "https://other.example" }));
  assert.equal(invalidOrigin.statusCode, 403);
});

test("finalize inspects actual bytes, promotes immutable content, returns an unsaved candidate, and cleans staging", async () => {
  const storage = new MemoryStorage();
  const uploadId = randomUUID();
  const objectKey = `builder-ui-assets/ultimate-b2/ultimate-b2-students-book/${uploadId}/staging/${randomUUID()}`;
  storage.objects.set(storage.key("private", objectKey), { body: png, contentType: "image/png" });
  let completed;
  let saved = 0;
  const handler = createBuilderTeacherUiAssetsHandler({
    getDatabase: () => ({}), authorize, storage: () => storage, inspect: fakeInspect,
    loadUploadScope: async () => ({ bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" }),
    claim: async () => ({ outcome: "claimed", currentRevision: 0, state: "finalizing", fileDescriptors: [{ bindingId: "background.main", name: "replacement.png", size: png.length, type: "image/png", mediaFamily: "raster", objectKey }] }),
    complete: async (_sql, input) => { completed = input; },
    saveDocument: async () => { saved += 1; },
    logger: { error() {} },
  });
  const response = await handler(event("/builder/api/ui-assets/finalize", { uploadId, expectedRevision: 0, clientMutationId: randomUUID() }));
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(completed.validatedAssets["background.main"].sha256, checksum);
  assert.equal(storage.uploads.length, 1);
  assert.equal(storage.uploads[0].profile, "public");
  assert.equal(storage.objects.has(storage.key("private", objectKey)), false);
  assert.equal(saved, 0, "finalize must not save the current UI document");
});

test("save requires same-actor binding candidates, preserves revision conflicts, and permits canonical revert", async () => {
  const candidateId = randomUUID();
  const replacement = asset();
  const replacementDocument = normalizeHostedTeacherUiDocument({ ...createEmptyHostedTeacherUiDocument(), assets: { "background.main": replacement } });
  let savedInput;
  const base = {
    getDatabase: () => ({}), authorize,
    loadDocument: async () => null,
    loadCandidates: async () => [{ id: candidateId, state: "validated", expectedRevision: 0, validatedAssets: { "background.main": replacement } }],
    saveDocument: async (_sql, input) => { savedInput = input; return { outcome: "saved", revision: 1, currentRevision: 1, document: input.document }; },
    markSaved: async () => {}, logger: { error() {} },
  };
  const handler = createBuilderTeacherUiAssetsHandler(base);
  const response = await handler(event("/builder/api/ui-assets/save", { expectedRevision: 0, clientMutationId: randomUUID(), document: replacementDocument, candidateUploadIds: [candidateId] }));
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(savedInput.resource.documentType, "teacher_ui");
  assert.equal(savedInput.document.assets["background.main"].sha256, checksum);

  const crossBinding = createBuilderTeacherUiAssetsHandler({ ...base, loadCandidates: async () => [{ id: candidateId, state: "validated", validatedAssets: { "navigation.home": replacement } }] });
  assert.equal((await crossBinding(event("/builder/api/ui-assets/save", { expectedRevision: 0, clientMutationId: randomUUID(), document: replacementDocument, candidateUploadIds: [candidateId] }))).statusCode, 400);

  const conflict = createBuilderTeacherUiAssetsHandler({ ...base, saveDocument: async () => ({ outcome: "revision_conflict", currentRevision: 2 }) });
  const conflictResponse = await conflict(event("/builder/api/ui-assets/save", { expectedRevision: 0, clientMutationId: randomUUID(), document: replacementDocument, candidateUploadIds: [candidateId] }));
  assert.equal(conflictResponse.statusCode, 409);
  assert.equal(JSON.parse(conflictResponse.body).currentRevision, 2);

  const revert = createBuilderTeacherUiAssetsHandler({ ...base, loadDocument: async () => ({ revision: 1, document: replacementDocument }), loadCandidates: async () => [], saveDocument: async (_sql, input) => ({ outcome: "saved", revision: 2, currentRevision: 2, document: input.document }) });
  assert.equal((await revert(event("/builder/api/ui-assets/save", { expectedRevision: 1, clientMutationId: randomUUID(), document: createEmptyHostedTeacherUiDocument(), candidateUploadIds: [] }))).statusCode, 200);
});

test("public UI asset delivery keeps v1 compatibility and adds the isolated v2 cache namespace", async () => {
  const storage = new MemoryStorage();
  const objectKey = `publishers/hamilton-house/books/ultimate-b2/editions/students-book/versions/hosted-draft/components/ultimate-b2-students-book/teacher-ui/assets/${checksum}.png`;
  storage.objects.set(storage.key("public", objectKey), { body: png, contentType: "image/png", sha256: checksum });
  const handler = createBuilderTeacherUiAssetsHandler({ storage: () => storage, logger: { error() {} } });
  for (const namespace of ["ui-assets", "ui-assets-v2"]) {
    for (const prefix of ["", "/builder", "/.netlify/functions/builder-teacher-ui-assets"]) {
      const response = await handler(event(`${prefix}/preview/${namespace}/${checksum}.png`, undefined, "GET", {}));
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.Location, `https://books.invalid/${objectKey}`);
      assert.equal(response.headers["Cache-Control"], "public, max-age=31536000, immutable");
    }
  }
  assert.equal((await handler(event(`/preview/ui-assets/${checksum}.png`, undefined, "POST", {}))).statusCode, 405);
  assert.equal((await handler(event(`/preview/ui-assets/${"a".repeat(64)}.png`, undefined, "GET", {}))).statusCode, 404);
  assert.equal((await handler(event("/preview/ui-assets/../../private/key", undefined, "GET", {}))).statusCode, 404);

  const unavailable = createBuilderTeacherUiAssetsHandler({ storage: () => { throw new Error("private configuration detail"); }, logger: { error() {} } });
  const unavailableResponse = await unavailable(event(`/preview/ui-assets/${checksum}.png`, undefined, "GET", {}));
  assert.equal(unavailableResponse.statusCode, 503);
  assert.deepEqual(JSON.parse(unavailableResponse.body), { error: "teacher_ui_storage_unavailable" });
});

test("runtime UI consumers use the explicit provider boundary rather than module-static asset objects", async () => {
  const sources = await Promise.all([
    "TeacherOfflineBook.jsx", "TeacherOfflinePages.jsx", "TeacherBookNavigation.jsx", "UltimateB2ClassroomToolbar.jsx", "LegacyMenuTitleAnimation.jsx", "legacyClassroomSound.js", "TeacherListeningPlayerAssets.js",
  ].map((name) => readFile(new URL(`../src/apps/android-teacher-offline/${name}`, import.meta.url), "utf8")));
  assert.equal(sources.every((source) => /useTeacherRuntimeUiAssets|runtimeUiAssets/.test(source)), true);
  assert.equal(sources.every((source) => !/import \{ legacyClassroomAssets/.test(source)), true);
});
