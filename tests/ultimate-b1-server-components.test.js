import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { serveBuilderPublicAsset } from "../cloudflare/builder/teacher-ui-assets.js";
import { buildBookAssetHostedTeacherUiPublicKey } from "../lib/book-assets/object-keys.js";
import {
  listBuilderServerComponents,
  resolveBuilderPackageUi,
  resolveBuilderServerComponent,
} from "../netlify-sites/ultimate-b2-builder/server/_builder-component-registry.js";
import { createBuilderContentHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-content.js";
import { resolveBuilderContentResource } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-registry.js";
import { builderDocumentSha256 } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { createBuilderNativeActivitiesHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-native-activities.js";
import { resolveNativeActivityAdapter } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-adapters.js";
import { resolveBuilderPageComponent } from "../netlify-sites/ultimate-b2-builder/server/_builder-page-catalog.js";
import { createBuilderPagesHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-pages.js";
import {
  inspectBuilderPreviewAuthorizationScope,
  issueBuilderPreviewAuthorization,
  verifyBuilderPreviewAuthorization,
} from "../netlify-sites/ultimate-b2-builder/server/_builder-preview-authorization.js";
import { createBuilderPreviewAuthorizationHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-preview-authorization-handler.js";
import { createBuilderPublicationHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication.js";
import {
  collectBuilderNativeActivityCatalogSources,
  collectUltimateB2ManagedPublicationSources,
} from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-store.js";
import { createBuilderTeacherUiAssetsHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-teacher-ui-assets.js";

const actorId = "10000000-0000-4000-8000-000000000001";
const previewEnvironment = { BUILDER_PREVIEW_AUTH_SECRET: "ultimate-b1-server-test-secret-with-thirty-two-bytes" };
const previewNow = Date.parse("2026-09-02T12:00:00Z");
const headers = { host: "builder.example", origin: "https://builder.example", cookie: "live", "content-type": "application/json" };

const components = Object.freeze([
  { bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-students-book", pagePrefix: "b1-sb", activityPrefix: "ultimate-b1-sb" },
  { bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-workbook", pagePrefix: "b1-wb", activityPrefix: "ultimate-b1-wb" },
  { bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-grammar-book", pagePrefix: "b1-gb", activityPrefix: "ultimate-b1-gb" },
  { bookSlug: "ultimate-b1-plus", componentSlug: "ultimate-b1-plus-students-book", pagePrefix: "b1-plus-sb", activityPrefix: "ultimate-b1-plus-sb" },
  { bookSlug: "ultimate-b1-plus", componentSlug: "ultimate-b1-plus-workbook", pagePrefix: "b1-plus-wb", activityPrefix: "ultimate-b1-plus-wb" },
  { bookSlug: "ultimate-b1-plus", componentSlug: "ultimate-b1-plus-grammar-book", pagePrefix: "b1-plus-gb", activityPrefix: "ultimate-b1-plus-gb" },
]);

const uiOwners = components.filter(({ componentSlug }) => componentSlug.endsWith("-students-book"));

function event(path, { method = "GET", body = null, queryStringParameters = undefined, requestHeaders = headers } = {}) {
  return {
    httpMethod: method,
    path,
    headers: requestHeaders,
    ...(body === null ? {} : { body: JSON.stringify(body) }),
    ...(queryStringParameters ? { queryStringParameters } : {}),
  };
}

function managedUnits(componentSlug) {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `${String(index + 1).padStart(8, "0")}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    slug: `unit-${index + 1}`,
    unit_number: index + 1,
    title: `Unit ${index + 1}`,
    sort_order: index + 1,
  }));
}

test("the server registry exposes exactly six managed B1/B1+ tuples and keeps Test Books closed", async () => {
  assert.deepEqual(
    listBuilderServerComponents().filter(({ bookSlug }) => bookSlug === "ultimate-b1" || bookSlug === "ultimate-b1-plus")
      .map(({ bookSlug, componentSlug }) => `${bookSlug}/${componentSlug}`),
    components.map(({ bookSlug, componentSlug }) => `${bookSlug}/${componentSlug}`),
  );

  for (const identity of components) {
    const registration = resolveBuilderServerComponent(identity.bookSlug, identity.componentSlug);
    assert.equal(registration.mode, "managed");
    assert.equal(registration.pageCatalog.pagePrefix, identity.pagePrefix);
    assert.equal(registration.nativeActivity.activityPrefix, identity.activityPrefix);
    assert.deepEqual(registration.publication, { enabled: !identity.componentSlug.endsWith("-grammar-book") });
    assert.equal(registration.content.unitExtras, false);
    assert.deepEqual(resolveBuilderPageComponent(identity.bookSlug, identity.componentSlug).baseline, []);

    const [hotspots, lifecycle, nativeIndex] = await Promise.all([
      resolveBuilderContentResource(identity.bookSlug, identity.componentSlug, "hotspots", ""),
      resolveBuilderContentResource(identity.bookSlug, identity.componentSlug, "activity-lifecycle", ""),
      resolveBuilderContentResource(identity.bookSlug, identity.componentSlug, "native-activity-index", ""),
    ]);
    assert.deepEqual(hotspots.baseline(), { schemaVersion: "1.0", packageSlug: identity.bookSlug, componentSlug: identity.componentSlug, pages: {} });
    assert.deepEqual(lifecycle.baseline(), { schemaVersion: "1.0", activities: {} });
    assert.deepEqual(nativeIndex.baseline(), { schemaVersion: "1.0", activities: [] });
    assert.ok(resolveNativeActivityAdapter(identity.bookSlug, identity.componentSlug));
  }

  for (const bookSlug of ["ultimate-b1", "ultimate-b1-plus"]) {
    const componentSlug = `${bookSlug}-test-book`;
    assert.equal(resolveBuilderServerComponent(bookSlug, componentSlug), null);
    assert.equal(resolveBuilderPageComponent(bookSlug, componentSlug), null);
    assert.equal(resolveNativeActivityAdapter(bookSlug, componentSlug), null);
    assert.equal(await resolveBuilderContentResource(bookSlug, componentSlug, "hotspots", ""), null);
  }
  assert.equal(resolveBuilderServerComponent("ultimate-b1", "ultimate-b1-plus-workbook"), null);

  const b2Students = resolveBuilderServerComponent("ultimate-b2", "ultimate-b2-students-book");
  assert.equal(b2Students.mode, "canonical");
  assert.equal(b2Students.publication.enabled, true);
  assert.ok(resolveBuilderPageComponent(b2Students.bookSlug, b2Students.componentSlug).baseline.length > 0);
  assert.deepEqual(resolveBuilderPageComponent("ultimate-b2", "ultimate-b2-workbook").baseline, []);
});

test("all six page and content API catalogs start as isolated empty ten-Unit shells", async () => {
  const loadedPageScopes = [];
  const pages = createBuilderPagesHandler({
    getDatabase: () => ({}),
    authorize: async () => ({ builderUser: { id: actorId } }),
    loadPages: async (_sql, identity) => {
      loadedPageScopes.push(`${identity.bookSlug}/${identity.componentSlug}`);
      return { revision: 0, hotspotRevision: 0, rows: [], units: managedUnits(identity.componentSlug) };
    },
    logger: { error() {} },
  });
  const content = createBuilderContentHandler({
    getDatabase: () => ({}),
    authorize: async () => ({ builderUser: { id: actorId } }),
    loadDocument: async () => null,
    logger: { error() {} },
  });

  for (const identity of components) {
    const pageResponse = await pages(event(`/builder/api/pages/books/${identity.bookSlug}/components/${identity.componentSlug}`));
    assert.equal(pageResponse.statusCode, 200, pageResponse.body);
    const pageCatalog = JSON.parse(pageResponse.body);
    assert.deepEqual(pageCatalog.pages, []);
    assert.deepEqual(pageCatalog.deletedPages, []);
    assert.deepEqual(pageCatalog.units.map(({ unitNumber }) => unitNumber), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual({ bookSlug: pageCatalog.component.bookSlug, componentSlug: pageCatalog.component.componentSlug }, {
      bookSlug: identity.bookSlug,
      componentSlug: identity.componentSlug,
    });

    for (const resource of ["hotspots", "activity-lifecycle", "native-activity-index"]) {
      const response = await content(event(`/builder/api/content/books/${identity.bookSlug}/components/${identity.componentSlug}/${resource}`));
      assert.equal(response.statusCode, 200, response.body);
      const payload = JSON.parse(response.body);
      assert.equal(payload.bookSlug, identity.bookSlug);
      assert.equal(payload.componentSlug, identity.componentSlug);
      if (resource === "hotspots") assert.deepEqual(payload.document.pages, {});
      if (resource === "activity-lifecycle") assert.deepEqual(payload.document.activities, {});
      if (resource === "native-activity-index") assert.deepEqual(payload.document.activities, []);
    }
  }
  assert.deepEqual(loadedPageScopes, components.map(({ bookSlug, componentSlug }) => `${bookSlug}/${componentSlug}`));
});

test("native creation persists and reloads only the exact B1/B1+ component identity", async () => {
  const states = new Map(components.map((identity) => [`${identity.bookSlug}/${identity.componentSlug}`, {
    identity,
    pageId: `${identity.pagePrefix}-page-one`,
    index: { revision: 0, document: { schemaVersion: "1.0", activities: [] } },
    documents: new Map(),
  }]));
  const stateFor = ({ bookSlug, componentSlug }) => states.get(`${bookSlug}/${componentSlug}`);
  let pairSaveCalls = 0;
  const sql = async (_strings, ...values) => {
    const state = states.get(`${values[0]}/${values[1]}`);
    const stableKeys = Array.isArray(values[2]) ? values[2] : [values[2]];
    const stableKey = state ? `${state.identity.componentSlug}/pages/${state.pageId}` : null;
    return state && stableKeys.includes(stableKey) ? [{
      stable_key: stableKey,
      sort_order: 1,
      source_metadata: { is_active: true, is_permanently_deleted: false },
      unit_id: "10000000-0000-4000-8000-000000000001",
      unit_number: 1,
      unit_title: "Unit 1",
    }] : [];
  };
  const source = (stored) => ({ revision: stored.revision, payload: stored.document, sha256: builderDocumentSha256(stored.document) });
  const handler = createBuilderNativeActivitiesHandler({
    getDatabase: () => sql,
    authorize: async () => ({ builderUser: { id: actorId } }),
    loadKnownActivityIds: async () => [],
    loadDocument: async (_sql, resource) => {
      const state = stateFor(resource);
      if (resource.documentType === "native_activity_index") return state.index;
      return state.documents.get(`${resource.documentType}:${resource.documentKey}`) || null;
    },
    create: async (_sql, input) => {
      const state = stateFor(input);
      state.index = { revision: state.index.revision + 1, document: input.indexDocument };
      state.documents.set(`native_activity_public:${input.activityId}`, { revision: 1, document: input.publicDocument });
      state.documents.set(`native_activity_teacher:${input.activityId}`, { revision: 1, document: input.teacherDocument });
      return { outcome: "created", activityId: input.activityId, indexRevision: state.index.revision, publicRevision: 1, teacherRevision: 1 };
    },
    savePair: async () => { pairSaveCalls += 1; throw new Error("forged placement reached persistence"); },
    collectCatalog: async (_sql, identity) => {
      const state = stateFor(identity);
      return { native: {
        index: source(state.index),
        activities: Object.fromEntries(state.index.document.activities.map((entry) => [entry.activityId, {
          index: entry,
          public: source(state.documents.get(`native_activity_public:${entry.activityId}`)),
          teacher: source(state.documents.get(`native_activity_teacher:${entry.activityId}`)),
        }])),
        assetRows: [],
      } };
    },
    logger: { error() {}, warn() {} },
  });

  const createdByTuple = new Map();
  for (const identity of components) {
    const root = `/builder/api/native-activities/books/${identity.bookSlug}/components/${identity.componentSlug}`;
    const empty = await handler(event(`${root}/catalog`));
    assert.equal(empty.statusCode, 200, empty.body);
    assert.deepEqual(JSON.parse(empty.body).activities, []);

    const created = await handler(event(`${root}/create`, {
      method: "POST",
      body: { kind: "image", pageId: stateFor(identity).pageId, title: `${identity.componentSlug} image`, clientMutationId: randomUUID() },
    }));
    assert.equal(created.statusCode, 200, created.body);
    const activityId = JSON.parse(created.body).activityId;
    createdByTuple.set(`${identity.bookSlug}/${identity.componentSlug}`, activityId);
    assert.match(activityId, new RegExp(`^${identity.activityPrefix}-`));
    assert.ok(await resolveBuilderContentResource(identity.bookSlug, identity.componentSlug, "native-activity-public", activityId));
    assert.ok(await resolveBuilderContentResource(identity.bookSlug, identity.componentSlug, "native-activity-teacher", activityId));

    const reloaded = await handler(event(`${root}/catalog`));
    assert.equal(reloaded.statusCode, 200, reloaded.body);
    const catalog = JSON.parse(reloaded.body);
    assert.deepEqual({ bookSlug: catalog.bookSlug, componentSlug: catalog.componentSlug }, {
      bookSlug: identity.bookSlug,
      componentSlug: identity.componentSlug,
    });
    assert.deepEqual(catalog.activities.map(({ activityId: id }) => id), [activityId]);
  }

  const b1Activity = createdByTuple.get("ultimate-b1/ultimate-b1-students-book");
  assert.equal(resolveNativeActivityAdapter("ultimate-b1-plus", "ultimate-b1-plus-students-book").ownsActivityId(b1Activity), false);
  assert.equal(await resolveBuilderContentResource("ultimate-b1-plus", "ultimate-b1-plus-students-book", "native-activity-public", b1Activity), null);
  const forgedPlacement = await handler(event("/builder/api/native-activities/books/ultimate-b1-plus/components/ultimate-b1-plus-students-book/create", {
    method: "POST",
    body: { kind: "image", pageId: "b1-sb-page-one", title: "forged", clientMutationId: randomUUID() },
  }));
  assert.equal(forgedPlacement.statusCode, 400);
  assert.equal(JSON.parse(forgedPlacement.body).error, "invalid_native_activity_placement");

  const b1State = states.get("ultimate-b1/ultimate-b1-students-book");
  const publicDocument = b1State.documents.get(`native_activity_public:${b1Activity}`).document;
  const teacherDocument = b1State.documents.get(`native_activity_teacher:${b1Activity}`).document;
  const forgedSave = await handler(event(`/builder/api/native-activities/books/ultimate-b1/components/ultimate-b1-students-book/activities/${b1Activity}/save`, {
    method: "POST",
    body: {
      expectedPublicRevision: 1,
      expectedTeacherRevision: 1,
      clientMutationId: randomUUID(),
      publicDocument: { ...publicDocument, placement: { pageId: "b1-plus-sb-page-one" } },
      teacherDocument,
    },
  }));
  assert.equal(forgedSave.statusCode, 400);
  assert.equal(JSON.parse(forgedSave.body).error, "invalid_native_activity_pair");
  assert.equal(pairSaveCalls, 0);
});

test("the shared native catalog collector admits exact B1/B1+ tuples without opening publication collection", async () => {
  const queried = [];
  const sql = async (_strings, ...values) => {
    queried.push(values);
    return [{ book_slug: values[0], component_slug: values[1], document_type: null }];
  };
  for (const identity of components) {
    const sources = await collectBuilderNativeActivityCatalogSources(sql, identity);
    assert.deepEqual(sources, { native: { index: null, activities: {} } });
  }
  assert.deepEqual(queried.map(([bookSlug, componentSlug]) => `${bookSlug}/${componentSlug}`), components.map(({ bookSlug, componentSlug }) => `${bookSlug}/${componentSlug}`));
  const queryCount = queried.length;
  await assert.rejects(collectBuilderNativeActivityCatalogSources(sql, { bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-test-book" }), /Publication component is unavailable/);
  await assert.rejects(collectUltimateB2ManagedPublicationSources(sql, "ultimate-b1-workbook"), /Publication component is unavailable/);
  assert.equal(queried.length, queryCount, "closed component registries must reject before SQL");
});

test("preview actions cover exact active tuples and registered immutable components", async () => {
  const tokenEvent = (token) => ({ queryStringParameters: { previewAuthorization: token } });
  for (const identity of components) {
    const intent = { ...identity, view: "library", pageId: null, activityId: null, releaseId: null };
    delete intent.pagePrefix;
    delete intent.activityPrefix;
    const issued = issueBuilderPreviewAuthorization(intent, { environment: previewEnvironment, now: previewNow, nonce: `nonce-${identity.componentSlug}` });
    const scoped = (action) => ({ action, bookSlug: identity.bookSlug, componentSlug: identity.componentSlug });
    for (const action of ["native-draft-public", "native-draft-teacher", "native-draft-asset", "managed-page-catalog", "managed-page-asset", "managed-hotspots", "component-switch"]) {
      assert.equal(verifyBuilderPreviewAuthorization(tokenEvent(issued.token), scoped(action), { environment: previewEnvironment, now: previewNow }), true, `${identity.componentSlug}:${action}`);
    }
    assert.equal(verifyBuilderPreviewAuthorization(tokenEvent(issued.token), scoped("teacher-ui-draft"), { environment: previewEnvironment, now: previewNow }), identity.componentSlug.endsWith("-students-book"), `${identity.componentSlug}:teacher-ui-draft`);
    const uiOwner = resolveBuilderPackageUi(identity.bookSlug);
    assert.equal(verifyBuilderPreviewAuthorization(tokenEvent(issued.token), { action: "teacher-ui-draft", bookSlug: uiOwner.bookSlug, componentSlug: uiOwner.componentSlug }, { environment: previewEnvironment, now: previewNow }), identity.componentSlug === uiOwner.componentSlug, `${identity.componentSlug}:package-ui-owner`);
    const foreignUiOwner = resolveBuilderPackageUi(identity.bookSlug === "ultimate-b1" ? "ultimate-b1-plus" : "ultimate-b1");
    assert.equal(verifyBuilderPreviewAuthorization(tokenEvent(issued.token), { action: "teacher-ui-draft", bookSlug: foreignUiOwner.bookSlug, componentSlug: foreignUiOwner.componentSlug }, { environment: previewEnvironment, now: previewNow }), false, `${identity.componentSlug}:foreign-package-ui-owner`);
    for (const action of ["unit-extras-draft", "unit-extra-draft-asset", "open-response-teacher", "release-public"]) {
      assert.equal(verifyBuilderPreviewAuthorization(tokenEvent(issued.token), scoped(action), { environment: previewEnvironment, now: previewNow }), false, `${identity.componentSlug}:${action}`);
    }
    const releaseIntent = { ...intent, releaseId: "10000000-0000-4000-8000-000000000099" };
    if (identity.componentSlug.endsWith("-grammar-book")) assert.throws(() => issueBuilderPreviewAuthorization(releaseIntent, { environment: previewEnvironment, now: previewNow, nonce: "release-disabled" }));
    else {
      const preview = issueBuilderPreviewAuthorization(releaseIntent, { environment: previewEnvironment, now: previewNow, nonce: "registered-release" });
      assert.equal(verifyBuilderPreviewAuthorization(tokenEvent(preview.token), { ...scoped("release-public"), releaseId: releaseIntent.releaseId }, { environment: previewEnvironment, now: previewNow }), true);
    }
  }
  assert.throws(() => issueBuilderPreviewAuthorization({ bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-test-book", view: "library", pageId: null, activityId: null, releaseId: null }, { environment: previewEnvironment, now: previewNow, nonce: "test-book-disabled" }));
  assert.throws(() => issueBuilderPreviewAuthorization({ bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-plus-workbook", view: "library", pageId: null, activityId: null, releaseId: null }, { environment: previewEnvironment, now: previewNow, nonce: "forged-tuple" }));

  const b2Intent = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", view: "activity", pageId: null, activityId: "ultimate-b2-sb-u1-p1-o1", releaseId: null };
  const b2 = issueBuilderPreviewAuthorization(b2Intent, { environment: previewEnvironment, now: previewNow, nonce: "b2-invariant-nonce" });
  for (const action of ["unit-extras-draft", "open-response-teacher", "managed-page-catalog", "component-switch"]) {
    assert.equal(verifyBuilderPreviewAuthorization(tokenEvent(b2.token), { action, bookSlug: b2Intent.bookSlug, componentSlug: b2Intent.componentSlug, activityId: b2Intent.activityId }, { environment: previewEnvironment, now: previewNow }), true);
  }
  assert.equal(verifyBuilderPreviewAuthorization(tokenEvent(b2.token), { action: "managed-hotspots", bookSlug: b2Intent.bookSlug, componentSlug: b2Intent.componentSlug }, { environment: previewEnvironment, now: previewNow }), false);

  const sourceIntent = { bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-students-book", view: "library", pageId: null, activityId: null, releaseId: null };
  const source = issueBuilderPreviewAuthorization(sourceIntent, { environment: previewEnvironment, now: previewNow, nonce: "b1-switch-source" });
  const switchHandler = createBuilderPreviewAuthorizationHandler({
    getDatabase: () => { throw new Error("component exchange must not open the database"); },
    authorize: async () => { throw new Error("component exchange must not use a Builder cookie"); },
    inspect: (request, scope) => inspectBuilderPreviewAuthorizationScope(request, scope, { environment: previewEnvironment, now: previewNow }),
    issue: (intent) => issueBuilderPreviewAuthorization(intent, { environment: previewEnvironment, now: previewNow, nonce: "b1-switch-target" }),
    logger: { error() {} },
  });
  const exchange = async (intent) => switchHandler(event("/preview/authorization/exchange", {
    method: "POST",
    body: { source: { bookSlug: sourceIntent.bookSlug, componentSlug: sourceIntent.componentSlug }, intent },
    queryStringParameters: { previewAuthorization: source.token },
    requestHeaders: { "content-type": "application/json" },
  }));
  const samePackage = await exchange({ ...sourceIntent, componentSlug: "ultimate-b1-workbook" });
  assert.equal(samePackage.statusCode, 200, samePackage.body);
  const switched = JSON.parse(samePackage.body).token;
  assert.equal(verifyBuilderPreviewAuthorization(tokenEvent(switched), { action: "managed-page-catalog", bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-workbook" }, { environment: previewEnvironment, now: previewNow }), true);
  assert.equal(verifyBuilderPreviewAuthorization(tokenEvent(switched), { action: "teacher-ui-draft", bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-students-book" }, { environment: previewEnvironment, now: previewNow }), false);
  const ownerExchange = await switchHandler(event("/preview/authorization/exchange", {
    method: "POST",
    body: {
      source: { bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-workbook" },
      intent: sourceIntent,
    },
    queryStringParameters: { previewAuthorization: switched },
    requestHeaders: { "content-type": "application/json" },
  }));
  assert.equal(ownerExchange.statusCode, 200, ownerExchange.body);
  assert.equal(verifyBuilderPreviewAuthorization(tokenEvent(JSON.parse(ownerExchange.body).token), { action: "teacher-ui-draft", bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-students-book" }, { environment: previewEnvironment, now: previewNow }), true);
  assert.equal((await exchange({ ...sourceIntent, bookSlug: "ultimate-b1-plus", componentSlug: "ultimate-b1-plus-workbook" })).statusCode, 401);
});

test("package UI documents, mutation routes, candidates, sessions, and public objects remain package-scoped", async () => {
  for (const owner of uiOwners) {
    const identity = resolveBuilderPackageUi(owner.bookSlug, owner.componentSlug);
    assert.deepEqual({ bookSlug: identity.bookSlug, componentSlug: identity.componentSlug, packageId: identity.packageId }, {
      bookSlug: owner.bookSlug,
      componentSlug: owner.componentSlug,
      packageId: owner.componentSlug,
    });
    const resource = await resolveBuilderContentResource(owner.bookSlug, owner.componentSlug, "ui-controller", "");
    assert.deepEqual(resource.baseline(), { schemaVersion: "1.0", packageId: owner.componentSlug, assets: {} });
  }
  assert.equal(resolveBuilderPackageUi("ultimate-b1", "ultimate-b1-workbook"), null);
  assert.deepEqual((await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "ui-controller", "")).baseline(), {
    schemaVersion: "1.0", packageId: "ultimate-b2-students-book", assets: {},
  });

  const prepared = [];
  const storage = {
    async signedPutUrl(input) { return { url: `https://uploads.invalid/${input.objectKey}`, headers: { "Content-Type": input.contentType } }; },
  };
  const prepareHandler = createBuilderTeacherUiAssetsHandler({
    getDatabase: () => ({}),
    authorize: async () => ({ builderUser: { id: actorId } }),
    storage: () => storage,
    prepare: async (_sql, input) => {
      prepared.push(input);
      return { outcome: "prepared", uploadId: input.uploadId, currentRevision: 0, state: "prepared", fileDescriptors: input.fileDescriptors };
    },
    logger: { error() {} },
  });
  for (const owner of uiOwners) {
    const response = await prepareHandler(event(`/builder/api/ui-assets/books/${owner.bookSlug}/components/${owner.componentSlug}/prepare`, {
      method: "POST",
      body: { expectedRevision: 0, clientMutationId: randomUUID(), files: [{ bindingId: "background.main", name: "background.png", size: 123, type: "image/png" }] },
    }));
    assert.equal(response.statusCode, 200, response.body);
    const input = prepared.at(-1);
    assert.deepEqual({ bookSlug: input.bookSlug, componentSlug: input.componentSlug }, { bookSlug: owner.bookSlug, componentSlug: owner.componentSlug });
    assert.match(input.fileDescriptors[0].objectKey, new RegExp(`builder-ui-assets/${owner.bookSlug}/${owner.componentSlug}/`));
  }
  assert.equal((await prepareHandler(event("/builder/api/ui-assets/books/ultimate-b1/components/ultimate-b1-test-book/prepare", { method: "POST", body: {} }))).statusCode, 404);

  let claimCalls = 0;
  const crossSession = createBuilderTeacherUiAssetsHandler({
    getDatabase: () => ({}),
    authorize: async () => ({ builderUser: { id: actorId } }),
    loadUploadScope: async () => ({ bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-students-book" }),
    claim: async () => { claimCalls += 1; return { outcome: "claimed" }; },
    logger: { error() {} },
  });
  const crossFinalize = await crossSession(event("/builder/api/ui-assets/books/ultimate-b1-plus/components/ultimate-b1-plus-students-book/finalize", {
    method: "POST",
    body: { uploadId: randomUUID(), expectedRevision: 0, clientMutationId: randomUUID() },
  }));
  assert.equal(crossFinalize.statusCode, 404);
  assert.deepEqual(JSON.parse(crossFinalize.body), { error: "session_not_found" });
  assert.equal(claimCalls, 0, "a foreign upload must be rejected before the stateful claim");

  const candidateId = randomUUID();
  let candidateScope;
  let saveCalls = 0;
  const crossCandidate = createBuilderTeacherUiAssetsHandler({
    getDatabase: () => ({}),
    authorize: async () => ({ builderUser: { id: actorId } }),
    loadDocument: async () => null,
    loadCandidates: async (_sql, input) => { candidateScope = input; return []; },
    saveDocument: async () => { saveCalls += 1; throw new Error("foreign candidate reached save"); },
    logger: { error() {} },
  });
  const candidateDocument = {
    schemaVersion: "1.0",
    packageId: "ultimate-b1-plus-students-book",
    assets: { "background.main": { sha256: "a".repeat(64), extension: "png", mediaType: "image/png", sizeBytes: 123, width: 1, height: 1, originalFilename: "background.png" } },
  };
  const rejectedCandidate = await crossCandidate(event("/builder/api/ui-assets/books/ultimate-b1-plus/components/ultimate-b1-plus-students-book/save", {
    method: "POST",
    body: { expectedRevision: 0, clientMutationId: randomUUID(), document: candidateDocument, candidateUploadIds: [candidateId] },
  }));
  assert.equal(rejectedCandidate.statusCode, 400);
  assert.equal(JSON.parse(rejectedCandidate.body).error, "invalid_candidate_reference");
  assert.deepEqual({ bookSlug: candidateScope.bookSlug, componentSlug: candidateScope.componentSlug }, {
    bookSlug: "ultimate-b1-plus", componentSlug: "ultimate-b1-plus-students-book",
  });
  assert.equal(saveCalls, 0);

  const checksum = "b".repeat(64);
  let headedKey = null;
  const delivery = createBuilderTeacherUiAssetsHandler({
    storage: () => ({
      async head({ objectKey }) { headedKey = objectKey; },
      publicUrl(objectKey) { return `https://books.invalid/${objectKey}`; },
    }),
    logger: { error() {} },
  });
  const publicResponse = await delivery(event(`/preview/ui-assets-v2/books/ultimate-b1/components/ultimate-b1-students-book/${checksum}.png`, { requestHeaders: {} }));
  assert.equal(publicResponse.statusCode, 302);
  assert.equal(headedKey, buildBookAssetHostedTeacherUiPublicKey({ bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-students-book", checksum, extension: "png" }));
  const keyBeforeForgery = headedKey;
  assert.equal((await delivery(event(`/preview/ui-assets-v2/books/ultimate-b1/components/ultimate-b1-plus-students-book/${checksum}.png`, { requestHeaders: {} }))).statusCode, 404);
  assert.equal(headedKey, keyBeforeForgery);
  assert.equal(buildBookAssetHostedTeacherUiPublicKey({ checksum, extension: "png" }), `publishers/hamilton-house/books/ultimate-b2/editions/students-book/versions/hosted-draft/components/ultimate-b2-students-book/teacher-ui/assets/${checksum}.png`);

  let workerKey = null;
  const workerResponse = await serveBuilderPublicAsset(new Request(`https://viewer.example/preview/ui-assets-v2/books/ultimate-b1-plus/components/ultimate-b1-plus-students-book/${checksum}.png`), {
    async get(objectKey) { workerKey = objectKey; return { body: new Uint8Array([1]), size: 1, httpEtag: '"b1-plus"' }; },
  });
  assert.equal(workerResponse.status, 200);
  assert.equal(workerKey, buildBookAssetHostedTeacherUiPublicKey({ bookSlug: "ultimate-b1-plus", componentSlug: "ultimate-b1-plus-students-book", checksum, extension: "png" }));
});

test("B1/B1+ standalone component mutations and Grammar/Test publication remain closed", async () => {
  let databaseCalls = 0;
  const handler = createBuilderPublicationHandler({
    getDatabase: () => { databaseCalls += 1; throw new Error("disabled publication must not reach storage"); },
    logger: { error() {} },
  });
  for (const identity of components) {
    const response = await handler(event(`/builder/api/publication/books/${identity.bookSlug}/components/${identity.componentSlug}/prepare`, { method: "POST", body: {} }));
    assert.equal(response.statusCode, 404);
    assert.deepEqual(JSON.parse(response.body), { error: "publication_component_not_found" });
  }
  for (const bookSlug of ["ultimate-b1", "ultimate-b1-plus"]) {
    assert.equal((await handler(event(`/builder/api/publication/books/${bookSlug}/components/${bookSlug}-test-book`))).statusCode, 404);
  }
  assert.equal(databaseCalls, 0);
});
