import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { json } from "../netlify-sites/ultimate-b2-builder/server/_builder-auth.js";
import { builderDocumentSha256 } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { createBuilderPublicationHandler, selectComponentReleaseAsset } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication.js";
import { compileUltimateB2ComponentRelease } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler.js";
import { compileUltimateB2ComponentReleaseV2 } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { importUltimateB2HostedOpenResponseBundle } from "../scripts/ultimate-b2/open-response-hosted-import.js";
import { createUltimateB2HostedOpenResponseSeed } from "../src/data/ultimate-b2/hostedOpenResponseDraft.js";
import { createEmptyHostedTeacherUiDocument } from "../src/data/ultimate-b2/hostedTeacherUiDocument.js";
import { findStudentsBookImplementation } from "../src/data/ultimate-b2/studentsBookCatalog.js";
import { compilePublicationV2Fixture, publicationV2Fixture } from "./fixtures/publication-v2.js";
import { task6SourceBundle } from "./fixtures/open-response-task6.js";
import { compileStudentsBookReleaseV3 } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v3.js";
import { canonicalStudentsBookPages, studentsBookUnits } from "./fixtures/students-book-current.js";

const base = "/builder/api/publication/books/ultimate-b2/components/ultimate-b2-students-book";
const actor = "10000000-0000-4000-8000-000000000001";

function event(path = base, method = "GET", body, headers = {}) { return { path, httpMethod: method, headers: { host: "builder.example", origin: "https://builder.example", "content-type": "application/json", cookie: "hh_builder_session=live", ...headers }, body: body ? JSON.stringify(body) : "" }; }
const parsed = (response) => JSON.parse(response.body);

function harness(overrides = {}) {
  const release = overrides.release || (overrides.current ? compileStudentsBookReleaseV3({ pages: { revision: 0, units: studentsBookUnits, rows: canonicalStudentsBookPages.map((page) => ({ stable_key: page.stableKey, source_metadata: { is_deleted: true } })) }, native: { activities: {}, assetRows: [] } }) : compileUltimateB2ComponentReleaseV2({ documents: {}, imports: {}, native: { activities: {}, assetRows: [] } }));
  let currentRelease = release;
  let mutation = null;
  const id = randomUUID();
  let published = false;
  const releaseRow = { id, release_number: 1, release_schema_version: release.releaseSchemaVersion, compiler_id: release.compilerId, release_sha256: release.releaseSha256, runtime_compatibility_sha256: release.compatibility, source_snapshot: release.sourceSnapshot, source_snapshot_sha256: release.sourceSnapshotSha256, public_projection: release.publicProjection, public_projection_sha256: release.publicProjectionSha256, teacher_projection: release.teacherProjection, teacher_projection_sha256: release.teacherProjectionSha256, asset_manifest: release.assetManifest, ...(overrides.releaseRow || {}) };
  const handler = createBuilderPublicationHandler({
    getDatabase: () => ({}), authorize: async (request) => request.headers.cookie === "hh_builder_session=live" ? { builderUser: { id: actor } } : { error: json(401, { error: "Unauthorized" }) },
    authorizePreview: async (request) => request.headers["x-preview-authorized"] === "yes",
    collect: async () => ({}), compile: () => currentRelease, storage: overrides.storage || (() => ({ head: async () => ({ byteSize: 1, checksumSha256: "a".repeat(64), contentType: "image/png" }), publicUrl: () => "https://assets.example/object" })),
    materialize: overrides.materialize,
    create: overrides.create || (async (_sql, input) => ({ outcome: "created", releaseId: id, releaseNumber: 1, releaseSha256: input.releaseSha256 })),
    status: async () => ({ headRevision: published ? 1 : 0, published: published ? { id, number: 1, sourceSnapshotSha256: release.sourceSnapshotSha256 } : null, releases: [{ id, number: 1, releaseSha256: release.releaseSha256, sourceSnapshotSha256: release.sourceSnapshotSha256, createdAt: "2026-01-01T00:00:00Z" }] }),
    publish: async (_sql, input) => { published = true; return { outcome: "published", releaseId: input.releaseId, releaseNumber: 1, headRevision: 1 }; },
    loadMutation: async () => mutation,
    loadRelease: overrides.loadRelease || (async () => releaseRow),
    loadAssetPin: overrides.loadAssetPin,
    servePinnedAsset: overrides.servePinnedAsset,
    logger: overrides.logger || { error() {} },
  });
  return { handler, id, release, isPublished() { return published; }, setCurrentRelease(value) { currentRelease = value; }, setMutation(value) { mutation = value; } };
}

test("publication mutations require Builder auth, same origin, JSON, and explicit supported component", async () => {
  const { handler } = harness();
  assert.equal((await handler(event(base, "GET", null, { cookie: "" }))).statusCode, 401);
  assert.equal((await handler(event(`${base}/prepare`, "POST", { clientMutationId: randomUUID(), releaseNote: "" }, { origin: "https://attacker.example" }))).statusCode, 403);
  assert.equal((await handler(event("/builder/api/publication/books/ultimate-b2/components/ultimate-b2-test-book", "GET"))).statusCode, 404);
});

test("prepare returns an immutable inactive release identity and only publish moves the active head", async () => {
  const { handler, id, release, isPublished } = harness({ current: true });
  const prepared = await handler(event(`${base}/prepare`, "POST", { clientMutationId: randomUUID(), releaseNote: "" }));
  assert.equal(prepared.statusCode, 200);
  assert.equal(parsed(prepared).releaseId, id);
  assert.equal(parsed(prepared).releaseSha256, release.releaseSha256);
  assert.equal(isPublished(), false);
  const published = await handler(event(`${base}/publish`, "POST", { releaseId: id, expectedHeadRevision: 0, clientMutationId: randomUUID() }));
  assert.equal(published.statusCode, 200);
  assert.equal(parsed(published).headRevision, 1);
  assert.equal(isPublished(), true);
});

test("publish rechecks the current compiled source identity before the transactional head move", async () => {
  const { handler, id, release, setCurrentRelease } = harness({ current: true });
  setCurrentRelease({ ...release, sourceSnapshotSha256: "f".repeat(64) });
  const response = await handler(event(`${base}/publish`, "POST", { releaseId: id, expectedHeadRevision: 0, clientMutationId: randomUUID() }));
  assert.equal(response.statusCode, 409);
  assert.equal(parsed(response).error, "stale_release_preview");
});

test("a successful publish mutation retry remains idempotent after later draft changes", async () => {
  const { handler, id, release, setCurrentRelease, setMutation } = harness({ current: true });
  setCurrentRelease({ ...release, sourceSnapshotSha256: "f".repeat(64) });
  setMutation({ release_id: id, outcome: "published" });
  const response = await handler(event(`${base}/publish`, "POST", { releaseId: id, expectedHeadRevision: 0, clientMutationId: randomUUID() }));
  assert.equal(response.statusCode, 200);
});

test("release preview is pinned by strict component-owned UUID and exposes projections separately", async () => {
  const { handler, id } = harness();
  const prefix = `/builder/preview/releases/books/ultimate-b2/components/ultimate-b2-students-book/${id}`;
  const publicResponse = await handler(event(`${prefix}/public`, "GET", null, { cookie: "", "x-preview-authorized": "yes" }));
  assert.equal(publicResponse.statusCode, 200);
  assert.ok(parsed(publicResponse).projection.activities);
  assert.equal("teacherProjection" in parsed(publicResponse), false);
  assert.equal((await handler(event(`${prefix}/teacher-ui`, "GET", null, { cookie: "" }))).statusCode, 401);
  assert.equal((await handler(event(`${prefix}/teacher-ui`, "GET", null, { cookie: "", "x-preview-authorized": "yes" }))).statusCode, 200);
  assert.equal((await handler(event(`${prefix}/teacher-solution/ultimate-b2-sb-u1-p1-o1`, "GET", null, { cookie: "" }))).statusCode, 401);
  assert.equal((await handler(event(`${prefix}/assets/${"a".repeat(64)}.png`, "HEAD", null, { cookie: "", "x-preview-authorized": "yes" }))).statusCode, 404);
  assert.equal((await handler(event(`${prefix}/assets/${"a".repeat(64)}.png`, "POST", null, { cookie: "" }))).statusCode, 405);
  assert.equal((await handler(event(`/builder/preview/releases/books/ultimate-b2/components/ultimate-b2-workbook/${id}/public`, "GET", null, { cookie: "" }))).statusCode, 401);
});

test("release preview rejects an asset manifest that is not exactly derived from its projections", async () => {
  const { handler, id, release } = harness();
  release.assetManifest.push({ sha256: "a".repeat(64), extension: "png", mediaType: "image/png", role: "open_response_artwork" });
  const response = await handler(event(`/builder/preview/releases/books/ultimate-b2/components/ultimate-b2-students-book/${id}/public`, "GET", null, { cookie: "", "x-preview-authorized": "yes" }));
  assert.equal(response.statusCode, 409);
  assert.equal(parsed(response).error, "release_integrity_failed");
});

test("native asset materialization failure creates no release row", async () => {
  let createCalls = 0;
  const { handler } = harness({
    release: compilePublicationV2Fixture(),
    materialize: async () => { throw new Error("release_asset_unavailable"); },
    create: async () => { createCalls += 1; return { outcome: "created" }; },
  });
  const response = await handler(event(`${base}/prepare`, "POST", { clientMutationId: randomUUID(), releaseNote: "" }));
  assert.equal(response.statusCode, 409);
  assert.equal(parsed(response).error, "release_asset_unavailable");
  assert.equal(createCalls, 0);
});

test("Prepare verifies Unit Extra videos in immutable private release storage before creating a release", async () => {
  const release = compilePublicationV2Fixture();
  let createCalls = 0;
  const privateHeads = [];
  const { handler } = harness({
    release,
    materialize: async () => {},
    storage: () => ({
      async head(input) {
        privateHeads.push(input);
        const source = release.nativeAssetSources.find(({ descriptor }) => input.objectKey.endsWith(`${descriptor.sha256}.${descriptor.extension}`));
        if (!source || input.profile !== "private") throw new Error("missing_test_object");
        return { checksumSha256: source.descriptor.sha256, byteSize: Number(source.row.byte_size), contentType: source.descriptor.mediaType };
      },
      publicUrl: () => "https://assets.example/object",
    }),
    create: async (_sql, input) => { createCalls += 1; return { outcome: "created", releaseId: randomUUID(), releaseNumber: 1, releaseSha256: input.releaseSha256 }; },
  });
  const response = await handler(event(`${base}/prepare`, "POST", { clientMutationId: randomUUID(), releaseNote: "Unit Extra regression" }));
  assert.equal(response.statusCode, 200);
  assert.equal(createCalls, 1);
  assert.equal(privateHeads.filter(({ objectKey }) => objectKey.endsWith(".mp4")).length, 2);
  assert.ok(privateHeads.every(({ profile, objectKey }) => profile === "private" && objectKey.startsWith("builder-release-assets/ultimate-b2/ultimate-b2-students-book/")));
});

test("Prepare fails closed before release creation when immutable private verification fails", async () => {
  const release = compilePublicationV2Fixture();
  const unitExtra = release.nativeAssetSources.find(({ descriptor }) => descriptor.role === "unit_extra_video");
  const scenarios = [
    { name: "missing", failureClass: "immutable_object_missing", head() { throw new Error("missing"); } },
    { name: "wrong byte size", failureClass: "immutable_byte_size_mismatch", head(source) { return { checksumSha256: source.descriptor.sha256, byteSize: Number(source.row.byte_size) + 1, contentType: source.descriptor.mediaType }; } },
    { name: "wrong SHA-256", failureClass: "immutable_checksum_mismatch", head(source) { return { checksumSha256: "f".repeat(64), byteSize: Number(source.row.byte_size), contentType: source.descriptor.mediaType }; } },
  ];
  for (const scenario of scenarios) {
    let createCalls = 0;
    const diagnostics = [];
    const { handler } = harness({
      release,
      materialize: async () => {},
      logger: { error(_message, diagnostic) { diagnostics.push(diagnostic); } },
      storage: () => ({
        async head(input) {
          const source = release.nativeAssetSources.find(({ descriptor }) => input.objectKey.endsWith(`${descriptor.sha256}.${descriptor.extension}`));
          if (!source) throw new Error("unexpected object");
          if (source === unitExtra) return scenario.head(source);
          return { checksumSha256: source.descriptor.sha256, byteSize: Number(source.row.byte_size), contentType: source.descriptor.mediaType };
        },
      }),
      create: async () => { createCalls += 1; return { outcome: "created" }; },
    });
    const response = await handler(event(`${base}/prepare`, "POST", { clientMutationId: randomUUID(), releaseNote: scenario.name }));
    assert.equal(response.statusCode, 409, scenario.name);
    assert.equal(parsed(response).error, "release_asset_unavailable", scenario.name);
    assert.equal(createCalls, 0, scenario.name);
    assert.deepEqual(diagnostics[0], {
      code: "release_asset_unavailable",
      assetId: unitExtra.row.id,
      assetRole: "unit_extra_video",
      assetStage: "verify",
      failureClass: scenario.failureClass,
    }, scenario.name);
  }
});

test("Prepare rejects an unsupported publication asset role before release creation", async () => {
  const release = compilePublicationV2Fixture();
  release.assetManifest = [{ sha256: "0".repeat(64), extension: "png", mediaType: "image/png", role: "future_publication_asset" }, ...release.assetManifest];
  let createCalls = 0;
  const { handler } = harness({
    release,
    materialize: async () => {},
    storage: () => ({ async head() { throw new Error("unsupported roles must not reach storage"); } }),
    create: async () => { createCalls += 1; return { outcome: "created" }; },
  });
  const response = await handler(event(`${base}/prepare`, "POST", { clientMutationId: randomUUID(), releaseNote: "Unsupported role" }));
  assert.equal(response.statusCode, 409);
  assert.equal(parsed(response).error, "release_asset_unavailable");
  assert.equal(createCalls, 0);
});

test("prepared Unit Extra video preview is release-bound, authorized, and privately signed", async () => {
  const release = compilePublicationV2Fixture();
  const signed = [];
  const { handler, id } = harness({
    release,
    storage: () => ({ async signedGetUrl(input) { signed.push(input); return "https://private-assets.example/signed-unit-extra"; } }),
  });
  const path = `/builder/preview/releases/books/ultimate-b2/components/ultimate-b2-students-book/${id}/assets/${publicationV2Fixture.unitExtraAssetChecksum}.mp4`;
  assert.equal((await handler(event(path, "GET", null, { cookie: "" }))).statusCode, 401);
  const response = await handler(event(path, "GET", null, { cookie: "", "x-preview-authorized": "yes" }));
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.Location, "https://private-assets.example/signed-unit-extra");
  assert.equal(response.headers["Cache-Control"], "private, no-store");
  assert.deepEqual(signed, [{ profile: "private", objectKey: `builder-release-assets/ultimate-b2/ultimate-b2-students-book/${publicationV2Fixture.unitExtraAssetChecksum}.mp4` }]);
});

test("pinned-source release assets resolve an exact pin through the authorized same-origin delivery path and never fall back", async () => {
  const release = compilePublicationV2Fixture();
  const asset = release.assetManifest.find((candidate) => candidate.role === "unit_extra_video");
  let signedCalls = 0;
  let delivered;
  let loadedIdentity;
  const run = harness({
    release,
    releaseRow: { asset_storage_mode: "pinned-source-v1" },
    storage: () => ({ async signedGetUrl() { signedCalls += 1; return "https://raw.invalid"; } }),
    loadAssetPin: async (_sql, identity) => {
      loadedIdentity = identity;
      return ({
      component_release_id: run.id, book_asset_id: randomUUID(), asset_role: asset.role, source_asset_role: asset.role,
      checksum_sha256: asset.sha256, byte_size: 4096, media_type: asset.mediaType, extension: asset.extension,
      storage_profile: "private", storage_bucket: "never-public", object_key: "never/public", source_owner_key: "video-owner",
      source_asset_slot: "video-owner", pin_sha256: "f".repeat(64),
      });
    },
    servePinnedAsset: async (input) => { delivered = input; return { statusCode: 206, headers: { "Content-Type": asset.mediaType }, body: "streamed" }; },
  });
  const path = `/builder/preview/releases/books/ultimate-b2/components/ultimate-b2-students-book/${run.id}/assets/${asset.sha256}.${asset.extension}`;
  const response = await run.handler(event(path, "GET", null, { cookie: "", "x-preview-authorized": "yes" }));
  assert.equal(response.statusCode, 206);
  assert.equal(delivered.pin.object_key, "never/public");
  assert.equal(loadedIdentity.role, asset.role);
  assert.equal(signedCalls, 0);

  const missing = harness({ release, releaseRow: { asset_storage_mode: "pinned-source-v1" }, loadAssetPin: async () => null });
  const missingPath = path.replace(run.id, missing.id);
  const failed = await missing.handler(event(missingPath, "GET", null, { cookie: "", "x-preview-authorized": "yes" }));
  assert.equal(failed.statusCode, 409);
  assert.equal(parsed(failed).error, "release_pin_integrity_failed");
});

test("shared release URL bytes select a deterministic role-scoped descriptor independent of manifest order", () => {
  const sha256 = "9".repeat(64);
  const artwork = { sha256, extension: "mp4", mediaType: "video/mp4", role: "activity_artwork" };
  const unitExtra = { sha256, extension: "mp4", mediaType: "video/mp4", role: "unit_extra_video" };
  assert.deepEqual(selectComponentReleaseAsset([unitExtra, artwork], sha256, "mp4"), artwork);
  assert.deepEqual(selectComponentReleaseAsset([artwork, unitExtra], sha256, "mp4"), artwork);
});

test("public immutable release assets redirect only to Worker-controlled same-origin namespaces", async () => {
  const teacherChecksum = "e".repeat(64);
  const teacherDocument = {
    ...createEmptyHostedTeacherUiDocument(),
    assets: { "background.main": { sha256: teacherChecksum, extension: "png", mediaType: "image/png", sizeBytes: 68, width: 1, height: 1, originalFilename: "background.png" } },
  };
  const teacherRelease = compileUltimateB2ComponentRelease({ documents: { teacherUi: { revision: 1, sha256: builderDocumentSha256(teacherDocument), payload: teacherDocument } } });
  let publicUrlCalls = 0;
  const storage = () => ({ publicUrl() { publicUrlCalls += 1; return "https://pub-storage.invalid/raw-object"; } });
  const teacherHarness = harness({ release: teacherRelease, storage });
  const teacherPath = `/builder/preview/releases/books/ultimate-b2/components/ultimate-b2-students-book/${teacherHarness.id}/assets/${teacherChecksum}.png`;
  assert.equal((await teacherHarness.handler(event(teacherPath, "GET", null, { cookie: "" }))).statusCode, 401);
  const teacherResponse = await teacherHarness.handler(event(teacherPath, "HEAD", null, { cookie: "", "x-preview-authorized": "yes" }));
  assert.equal(teacherResponse.statusCode, 302);
  assert.equal(teacherResponse.headers.Location, `/preview/ui-assets-v2/${teacherChecksum}.png`);
  assert.equal(teacherResponse.headers["Cache-Control"], "private, no-store");

  const activityId = "ultimate-b2-sb-u2-p1-o1";
  const seed = createUltimateB2HostedOpenResponseSeed(findStudentsBookImplementation(activityId));
  const imported = await importUltimateB2HostedOpenResponseBundle({
    activityId,
    files: await task6SourceBundle(),
    expectedQuestionIds: seed.questions.map((question) => question.id),
    assetPathFor: (sha256, extension) => `/preview/open-response-assets/${sha256}${extension}`,
  });
  const openResponseRelease = compileUltimateB2ComponentRelease({ imports: { [activityId]: { revision: 1, fingerprint: imported.fingerprint, publicProjection: imported.publicProjection, teacherProjection: imported.teacherProjection } } });
  const openResponseAsset = openResponseRelease.assetManifest.find((asset) => asset.role === "open_response_artwork");
  const openResponseHarness = harness({ release: openResponseRelease, storage });
  const openResponsePath = `/builder/preview/releases/books/ultimate-b2/components/ultimate-b2-students-book/${openResponseHarness.id}/assets/${openResponseAsset.sha256}.${openResponseAsset.extension}`;
  const openResponse = await openResponseHarness.handler(event(openResponsePath, "GET", null, { cookie: "", "x-preview-authorized": "yes" }));
  assert.equal(openResponse.statusCode, 302);
  assert.equal(openResponse.headers.Location, `/preview/open-response-assets/${openResponseAsset.sha256}.${openResponseAsset.extension}`);
  assert.equal(publicUrlCalls, 0, "immutable Review must never send public release assets to the raw storage host");
});

test("prepared native Teacher projection is separately authorized and release-member checked", async () => {
  const { handler, id } = harness({ release: compilePublicationV2Fixture() });
  const prefix = `/builder/preview/releases/books/ultimate-b2/components/ultimate-b2-students-book/${id}/native-teacher`;
  assert.equal((await handler(event(`${prefix}/${publicationV2Fixture.openResponseId}`, "GET", null, { cookie: "" }))).statusCode, 401);
  const allowed = await handler(event(`${prefix}/${publicationV2Fixture.openResponseId}`, "GET", null, { cookie: "", "x-preview-authorized": "yes" }));
  assert.equal(allowed.statusCode, 200);
  assert.match(allowed.body, new RegExp(publicationV2Fixture.teacherSentinel));
  const choice = await handler(event(`${prefix}/${publicationV2Fixture.singleChoiceId}`, "GET", null, { cookie: "", "x-preview-authorized": "yes" }));
  assert.equal(choice.statusCode, 200);
  assert.match(choice.body, /correctAnswers/);
  assert.equal((await handler(event(`${prefix}/ultimate-b2-sb-u1-p1-o95`, "GET", null, { cookie: "", "x-preview-authorized": "yes" }))).statusCode, 404);
});
