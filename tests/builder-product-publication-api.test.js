import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createBuilderWorker } from "../cloudflare/builder/worker.js";
import { BUILDER_RELEASE_SOURCE_ASSETS_BUCKET } from "../cloudflare/builder/storage-bindings.js";
import { buildBuilderPageAssetObjectKey } from "../lib/book-assets/object-keys.js";
import { createBuilderPublicationFunction } from "../netlify-sites/ultimate-b2-builder/functions/builder-publication.js";
import { json } from "../netlify-sites/ultimate-b2-builder/server/_builder-auth.js";
import { ComponentPublicationAssetError } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-assets.js";
import { freezeComponentPublicationAssetPins } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-pins.js";
import { createBuilderProductPublicationHandler, parseBuilderProductPublicationRoute } from "../netlify-sites/ultimate-b2-builder/server/_builder-product-publication.js";

const base = "/builder/api/publication/books/ultimate-b2";
const actor = "10000000-0000-4000-8000-000000000001";
const components = [
  ["ultimate-b2-students-book", "ultimate-b2-students-book-v2", "2.0", "a"],
  ["ultimate-b2-workbook", "ultimate-b2-workbook-v1", "1.0", "b"],
  ["ultimate-b2-grammar-book", "ultimate-b2-grammar-book-v1", "1.0", "c"],
];

function event(path = base, method = "GET", value = null, headers = {}) {
  return { path, httpMethod: method, headers: { host: "builder.example", origin: "https://builder.example", cookie: "hh_builder_session=live", "content-type": "application/json", ...headers }, body: value ? JSON.stringify(value) : "" };
}

const parsed = (response) => JSON.parse(response.body);
const digest = (character) => character.repeat(64);

function compiledMembers(sourceOverride = new Map()) {
  return components.map(([componentSlug, compilerId, releaseSchemaVersion, marker]) => ({
    componentSlug,
    compiler: { compilerId, releaseSchemaVersion },
    compiled: {
      compilerId,
      releaseSchemaVersion,
      compatibility: digest(marker),
      sourceSnapshot: { marker },
      sourceSnapshotSha256: sourceOverride.get(componentSlug) || digest(marker),
      publicProjection: { marker },
      publicProjectionSha256: digest(marker),
      teacherProjection: { marker },
      teacherProjectionSha256: digest(marker),
      assetManifest: [],
      nativeAssetSources: [],
      releaseSha256: digest(marker),
    },
  }));
}

function managedPageSource() {
  const componentSlug = components[0][0];
  const descriptor = { sha256: digest("f"), extension: "png", mediaType: "image/png", role: "managed_page_image" };
  const pageId = "students-page-one";
  return {
    descriptor,
    row: {
      id: randomUUID(),
      book_slug: "ultimate-b2",
      component_slug: componentSlug,
      asset_role: "page_image",
      checksum_sha256: descriptor.sha256,
      byte_size: 68,
      mime_type: descriptor.mediaType,
      object_key: buildBuilderPageAssetObjectKey({ bookSlug: "ultimate-b2", componentSlug, pageId, checksum: descriptor.sha256, extension: ".png" }),
      storage_profile: "private",
      storage_bucket: BUILDER_RELEASE_SOURCE_ASSETS_BUCKET,
      publication_status: "draft",
      access_level: "internal",
      source_metadata: { publication_page_id: pageId },
    },
  };
}

function compiledMembersWith(source) {
  const compiled = compiledMembers();
  compiled[0].compiled.assetManifest = [source.descriptor];
  compiled[0].compiled.nativeAssetSources = [source];
  return compiled;
}

function releaseSourceBucket(source, changes = {}) {
  const calls = [];
  return {
    calls,
    async head(objectKey) {
      calls.push(objectKey);
      if (changes.missing) return null;
      return {
        size: Object.hasOwn(changes, "size") ? changes.size : Number(source.row.byte_size),
        httpMetadata: { contentType: Object.hasOwn(changes, "contentType") ? changes.contentType : source.row.mime_type },
        customMetadata: Object.hasOwn(changes, "customMetadata") ? changes.customMetadata : { sha256: source.row.checksum_sha256 },
        etag: "binding-etag",
      };
    },
  };
}

function candidate(overrides = {}) {
  return {
    id: overrides.id || randomUUID(),
    number: 1,
    bookSlug: "ultimate-b2",
    compilerId: "ultimate-b2-product-v1",
    releaseSchemaVersion: "1.0",
    sourceSnapshotSha256: digest("d"),
    releaseSha256: digest("e"),
    releaseNote: "Atomic",
    createdAt: "2026-08-28T00:00:00.000Z",
    current: overrides.current === true,
    members: components.map(([componentSlug, compilerId, releaseSchemaVersion, marker], index) => ({
      componentSlug,
      order: index + 1,
      status: "included",
      componentReleaseId: randomUUID(),
      compilerId,
      releaseSchemaVersion,
      releaseSha256: digest(marker),
      compatibility: digest(marker),
      memberSha256: digest(marker),
      unavailableReason: null,
      sourceSnapshotSha256: overrides.sourceOverride?.get(componentSlug) || digest(marker),
    })),
  };
}

function harness(overrides = {}) {
  let compiled = overrides.compiled || compiledMembers();
  let createdInput;
  let publishInput;
  let frozen = [];
  let storageCalls = 0;
  const release = overrides.release || candidate();
  const handler = createBuilderProductPublicationHandler({
    getDatabase: () => ({}),
    authorize: async (request) => request.headers.cookie === "hh_builder_session=live" ? { builderUser: { id: actor } } : { error: json(401, { error: "Unauthorized" }) },
    ready: overrides.ready || (async () => true),
    pinReady: overrides.pinReady || (async () => true),
    compileProduct: async () => compiled,
    status: async () => ({ headRevision: 0, published: null, releases: [] }),
    freezePins: async (storage, input) => { frozen.push(input.componentSlug); return overrides.freezePins ? overrides.freezePins(storage, input) : []; },
    storage: () => { storageCalls += 1; return overrides.storage ? overrides.storage() : {}; },
    randomUuid: randomUUID,
    create: async (sql, input) => { createdInput = input; return overrides.create ? overrides.create(sql, input) : { outcome: "created", productReleaseId: release.id, releaseNumber: 1, releaseSha256: release.releaseSha256, sourceSnapshotSha256: release.sourceSnapshotSha256, members: release.members }; },
    loadRelease: async () => release,
    loadAssetModes: async () => release.members.map((member) => ({ product_release_id: release.id, component_slug: member.componentSlug, asset_storage_mode: "pinned-source-v1" })),
    verifyCandidate: async () => true,
    loadComponentRows: async () => [],
    loadMutation: async () => overrides.replay || null,
    publish: async (sql, input) => { publishInput = input; return overrides.publish ? overrides.publish(sql, input) : { outcome: "published", productReleaseId: input.productReleaseId, releaseNumber: 1, headRevision: 1 }; },
    logger: overrides.logger || { error() {} },
  });
  return { handler, release, get createdInput() { return createdInput; }, get publishInput() { return publishInput; }, get frozen() { return frozen; }, get storageCalls() { return storageCalls; }, setCompiled(value) { compiled = value; } };
}

test("product route is distinct from component routes and requires auth, schema, and same origin", async () => {
  assert.deepEqual(parseBuilderProductPublicationRoute(event(base)), { bookSlug: "ultimate-b2", action: "status" });
  assert.equal(parseBuilderProductPublicationRoute(event(`${base}/components/ultimate-b2-students-book`)), null);
  const { handler } = harness();
  assert.equal((await handler(event(base, "GET", null, { cookie: "" }))).statusCode, 401);
  assert.equal((await handler(event(`${base}/prepare`, "POST", { clientMutationId: randomUUID(), releaseNote: "" }, { origin: "https://attacker.example" }))).statusCode, 403);
  assert.equal((await harness({ ready: async () => false }).handler(event(base))).statusCode, 409);
  assert.equal((await handler(event("/builder/api/publication/books/ultimate-c1"))).statusCode, 404);
});

test("Prepare compiles, source-verifies, and pins Students, Workbook, and Grammar as one ordered family without CopyObject", async () => {
  const run = harness();
  const response = await run.handler(event(`${base}/prepare`, "POST", { clientMutationId: randomUUID(), releaseNote: "Atomic" }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(run.frozen, components.map(([componentSlug]) => componentSlug));
  assert.deepEqual(run.createdInput.members.map((member) => member.componentSlug), components.map(([componentSlug]) => componentSlug));
  assert.equal(run.createdInput.members.length, 3);
  assert.equal(run.createdInput.members.some((member) => member.componentSlug.includes("test-book")), false);
  assert.ok(run.createdInput.members.every((member) => /^[0-9a-f-]{36}$/.test(member.releaseId)));
  assert.ok(run.createdInput.members.every((member) => member.assetStorageMode === "pinned-source-v1" && Array.isArray(member.assetPins)));
  assert.equal(parsed(response).productReleaseId, run.release.id);
});

test("Cloudflare Worker, Netlify adapter, and publication wrapper propagate RELEASE_SOURCE_ASSETS into Product Prepare", async () => {
  const source = managedPageSource();
  const binding = releaseSourceBucket(source);
  const run = harness({ compiled: compiledMembersWith(source), freezePins: freezeComponentPublicationAssetPins });
  const publication = createBuilderPublicationFunction({
    componentHandler: async () => { throw new Error("Product Prepare must not select the component handler"); },
    productHandler: run.handler,
  });
  const worker = createBuilderWorker({ handlers: { publication } });
  const response = await worker.fetch(new Request(`https://builder.hhplms.workers.dev${base}/prepare`, {
    method: "POST",
    headers: {
      Host: "builder.hhplms.workers.dev",
      Origin: "https://builder.hhplms.workers.dev",
      Cookie: "hh_builder_session=live",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ clientMutationId: randomUUID(), releaseNote: "Binding-backed" }),
  }), { RELEASE_SOURCE_ASSETS: binding });

  assert.equal(response.status, 200);
  assert.deepEqual(binding.calls, [source.row.object_key]);
  assert.equal(run.storageCalls, 0, "Cloudflare runtime must not instantiate local S3 storage");
  assert.equal(run.createdInput.members[0].assetPins[0].objectKey, source.row.object_key);
});

test("Product Prepare preserves the local S3-compatible storage path outside Cloudflare context", async () => {
  const localStorage = {};
  const run = harness({
    storage: () => localStorage,
    async freezePins(storage) {
      assert.equal(storage, localStorage);
      return [];
    },
  });
  const response = await run.handler(event(`${base}/prepare`, "POST", { clientMutationId: randomUUID(), releaseNote: "Local" }));
  assert.equal(response.statusCode, 200);
  assert.equal(run.storageCalls, 1);
  assert.ok(run.createdInput);
});

test("Cloudflare Product Prepare fails closed for missing objects, invalid metadata, or a missing binding", async () => {
  const scenarios = [
    ["missing object", { missing: true }],
    ["checksum mismatch", { customMetadata: { sha256: digest("e") } }],
    ["missing checksum metadata", { customMetadata: {} }],
    ["malformed checksum metadata", { customMetadata: { sha256: "not-a-sha256" } }],
    ["byte-size mismatch", { size: 69 }],
    ["MIME mismatch", { contentType: "image/webp" }],
  ];
  for (const [label, changes] of scenarios) {
    const source = managedPageSource();
    const binding = releaseSourceBucket(source, changes);
    const diagnostics = [];
    const run = harness({
      compiled: compiledMembersWith(source),
      freezePins: freezeComponentPublicationAssetPins,
      logger: { error(_message, diagnostic) { diagnostics.push(diagnostic); } },
    });
    const response = await run.handler(
      event(`${base}/prepare`, "POST", { clientMutationId: randomUUID(), releaseNote: label }),
      { cloudflare: { releaseSourceAssets: binding, releaseSourceAssetsBucket: BUILDER_RELEASE_SOURCE_ASSETS_BUCKET } },
    );
    assert.equal(response.statusCode, 409, label);
    assert.deepEqual(parsed(response), { error: "release_asset_unavailable" }, label);
    assert.equal(run.createdInput, undefined, label);
    assert.equal(run.storageCalls, 0, `${label} must not fall back to local S3`);
    assert.doesNotMatch(JSON.stringify(parsed(response)), /bucket|object|key|credential|token|secret/i, label);
    assert.doesNotMatch(JSON.stringify(diagnostics), new RegExp(source.row.object_key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), label);
  }

  for (const [label, releaseSourceAssets] of [["missing binding", undefined], ["unusable binding", {}]]) {
    const diagnostics = [];
    const run = harness({ logger: { error(_message, diagnostic) { diagnostics.push(diagnostic); } } });
    const response = await run.handler(
      event(`${base}/prepare`, "POST", { clientMutationId: randomUUID(), releaseNote: label }),
      { cloudflare: { releaseSourceAssets, releaseSourceAssetsBucket: BUILDER_RELEASE_SOURCE_ASSETS_BUCKET } },
    );
    assert.equal(response.statusCode, 409, label);
    assert.deepEqual(parsed(response), { error: "release_asset_unavailable" }, label);
    assert.equal(run.createdInput, undefined, label);
    assert.equal(run.storageCalls, 0, `${label} must not fall back to local S3`);
    assert.deepEqual(diagnostics, [{
      code: "release_asset_unavailable",
      assetId: "unknown",
      assetRole: "unknown",
      assetStage: "pin-storage",
      failureClass: "source_storage_identity_invalid",
    }], label);
  }
});

test("managed page source-integrity failures keep product Prepare atomic, safely logged, and retryable", async () => {
  for (const failingComponent of ["ultimate-b2-workbook", "ultimate-b2-grammar-book"]) {
    let failOnce = true;
    let createCalls = 0;
    let publishCalls = 0;
    const diagnostics = [];
    const run = harness({
      async freezePins(_storage, input) {
        if (failOnce && input.componentSlug === failingComponent) {
          failOnce = false;
          throw Object.assign(new ComponentPublicationAssetError({
            assetId: randomUUID(),
            role: "managed_page_image",
            stage: `pin-${input.componentSlug}`,
            failureClass: "source_checksum_mismatch",
          }), {
            bucket: "private-secret-bucket",
            sourceObjectKey: "builder-pages/private/source.png",
            destinationObjectKey: "builder-release-assets/private/destination.png",
            copySource: "/private-secret-bucket/source.png",
            etag: '"private-etag"',
            authorization: "secret Authorization",
            cookie: "secret Cookie",
          });
        }
        return [];
      },
      async create() { createCalls += 1; return { outcome: "created", productReleaseId: run.release.id, releaseNumber: 1, releaseSha256: run.release.releaseSha256, sourceSnapshotSha256: run.release.sourceSnapshotSha256, members: run.release.members }; },
      async publish() { publishCalls += 1; return { outcome: "published" }; },
      logger: { error(_message, diagnostic) { diagnostics.push(diagnostic); } },
    });
    const first = await run.handler(event(`${base}/prepare`, "POST", { clientMutationId: randomUUID(), releaseNote: `Fail ${failingComponent}` }));
    assert.equal(first.statusCode, 409, failingComponent);
    assert.deepEqual(parsed(first), { error: "release_asset_unavailable" }, failingComponent);
    assert.equal(createCalls, 0, failingComponent);
    assert.equal(publishCalls, 0, failingComponent);
    assert.deepEqual(diagnostics[0], {
      code: "release_asset_unavailable",
      assetId: diagnostics[0].assetId,
      assetRole: "managed_page_image",
      assetStage: `pin-${failingComponent}`,
      failureClass: "source_checksum_mismatch",
    }, failingComponent);
    assert.match(diagnostics[0].assetId, /^[0-9a-f-]{36}$/i, failingComponent);
    assert.doesNotMatch(JSON.stringify(diagnostics), /bucket|sourceObjectKey|destinationObjectKey|CopySource|ETag|Authorization|Cookie|private/i, failingComponent);

    const retry = await run.handler(event(`${base}/prepare`, "POST", { clientMutationId: randomUUID(), releaseNote: `Retry ${failingComponent}` }));
    assert.equal(retry.statusCode, 200, failingComponent);
    assert.equal(createCalls, 1, failingComponent);
    assert.equal(publishCalls, 0, failingComponent);
    assert.equal(run.frozen.length >= 3, true, `${failingComponent} retry must re-verify sources without materialization`);
  }
});

test("new Prepare fails closed before compilation when role-scoped pin schema migration 050 is unavailable", async () => {
  const run = harness({ pinReady: async () => false });
  const response = await run.handler(event(`${base}/prepare`, "POST", { clientMutationId: randomUUID(), releaseNote: "" }));
  assert.equal(response.statusCode, 409);
  assert.deepEqual(parsed(response), { error: "release_pin_schema_unavailable" });
  assert.deepEqual(run.frozen, []);
  assert.equal(run.createdInput, undefined);
});

test("Publish rejects family staleness before the atomic head move and permits exact mutation replay", async () => {
  const staleSource = new Map([["ultimate-b2-workbook", digest("f")]]);
  const run = harness();
  run.setCompiled(compiledMembers(staleSource));
  const request = { productReleaseId: run.release.id, expectedHeadRevision: 0, clientMutationId: randomUUID() };
  const stale = await run.handler(event(`${base}/publish`, "POST", request));
  assert.equal(stale.statusCode, 409);
  assert.equal(parsed(stale).error, "stale_release_preview");
  assert.equal(run.publishInput, undefined);

  const replay = harness({ replay: { product_release_id: run.release.id } });
  replay.setCompiled(compiledMembers(staleSource));
  const response = await replay.handler(event(`${base}/publish`, "POST", { ...request, productReleaseId: replay.release.id }));
  assert.equal(response.statusCode, 200);
  assert.equal(replay.publishInput.productReleaseId, replay.release.id);
});
