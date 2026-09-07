import { studentsBookContentSql, studentsBookPageSql, currentStudentsBookSources, canonicalStudentsBookPages } from "./fixtures/students-book-current.js";
import assert from "node:assert/strict";
import test from "node:test";

import { createBuilderPreviewHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-preview.js";
import { authorizeBuilderPreviewRequest, issueBuilderPreviewAuthorization } from "../netlify-sites/ultimate-b2-builder/server/_builder-preview-authorization.js";
import { resolveBuilderContentResource } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-registry.js";
import { builderDocumentSha256 } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { createBuilderRelatedDocumentLoader } from "../netlify-sites/ultimate-b2-builder/server/_builder-related-context.js";
import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { createEmptyManagedComponentHotspotManifest } from "../scripts/ultimate-b2/hotspot-manifest.js";
import { createPublicationV2FixtureSources, publicationV2Fixture } from "./fixtures/publication-v2.js";

const route = "/builder/preview/content/books/ultimate-b2/components/ultimate-b2-students-book/hotspots";
const resource = await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "hotspots");
const forbiddenResponseData = /acceptedAnswers|correctAnswer|correctOptionId|modelAnswer|teacherSolution|revealText|password|token|secret|databaseUrl/i;
const managedComponents = ["ultimate-b2-workbook", "ultimate-b2-grammar-book"];
const managedPreviewEnvironment = { BUILDER_PREVIEW_AUTH_SECRET: "managed-preview-regression-secret-with-more-than-thirty-two-bytes" };
const managedPreviewNow = Date.parse("2026-08-27T12:00:00Z");

function event(method = "GET", path = route, headers = {}) {
  return { httpMethod: method, path, headers };
}

function parsed(response) {
  return JSON.parse(response.body);
}

function row(document, overrides = {}) {
  return {
    schema_version: resource.schemaVersion,
    revision: 3,
    payload: document,
    payload_sha256: builderDocumentSha256(document),
    ...overrides,
  };
}

function managedPageFixture(componentSlug) {
  const abbreviation = componentSlug === "ultimate-b2-workbook" ? "wb" : "gb";
  return {
    id: `ultimate-b2-${abbreviation}-unit-1-page-1`,
    stableKey: `${componentSlug}/pages/ultimate-b2-${abbreviation}-unit-1-page-1`,
    unitId: `${abbreviation}-unit-1`,
    assetId: `${abbreviation}-page-asset-1`,
  };
}

function managedPagesSql(componentSlug) {
  const page = managedPageFixture(componentSlug);
  return async (strings) => {
    const query = strings.join(" ");
    if (query.includes("from book_packages package join book_components component")) return [{ id: componentSlug, revision: 2 }];
    if (query.includes("from units unit")) return [{ id: page.unitId, slug: "unit-1", title: "Unit 1", unit_number: 1, sort_order: 1 }];
    if (query.includes("from book_pages page")) return [{
      id: page.id,
      stable_key: page.stableKey,
      source_metadata: { is_active: true },
      unit_id: page.unitId,
      unit_number: 1,
      asset_id: page.assetId,
    }];
    return [];
  };
}

async function managedPreview(componentSlug, { storedHotspots = null, nativeIndex = null, publicDocuments = {} } = {}) {
  const resolved = [];
  const loaded = [];
  const issued = issueBuilderPreviewAuthorization({
    bookSlug: "ultimate-b2", componentSlug, view: "library", pageId: null, activityId: null, releaseId: null,
  }, { environment: managedPreviewEnvironment, now: managedPreviewNow, nonce: "managedPreviewRegressionNonce" });
  const handler = createBuilderPreviewHandler({
    getDatabase: () => managedPagesSql(componentSlug),
    resolveResource: async (...arguments_) => {
      resolved.push(`${arguments_[2]}:${arguments_[3] || ""}`);
      return resolveBuilderContentResource(...arguments_);
    },
    authorizePreview: (previewEvent, sql, scope) => authorizeBuilderPreviewRequest(previewEvent, sql, scope, { environment: managedPreviewEnvironment, now: managedPreviewNow + 1_000 }),
    loadDocument: async (_sql, candidate) => {
      loaded.push(`${candidate.resource}:${candidate.documentKey}`);
      if (candidate.resource === "hotspots") return storedHotspots;
      if (candidate.resource === "native-activity-index") return nativeIndex;
      if (candidate.resource === "native-activity-public") throw new Error("Managed hotspot preview must batch public documents.");
      if (candidate.resource === "native-activity-teacher") throw new Error("Teacher documents must not be loaded for managed hotspot preview.");
      return null;
    },
    loadDocuments: async (_sql, resources) => new Map(resources.flatMap((candidate) => {
      loaded.push(`batch:${candidate.resource}:${candidate.documentKey}`);
      const source = publicDocuments[candidate.documentKey];
      return source ? [[candidate.documentKey, source]] : [];
    })),
    logger: { warn() {}, error() {} },
  });
  const response = await handler({
    httpMethod: "GET",
    path: `/builder/preview/content/books/ultimate-b2/components/${componentSlug}/hotspots`,
    headers: {},
    queryStringParameters: { previewAuthorization: issued.token },
  });
  return { response, body: parsed(response), resolved, loaded, token: issued.token };
}

test("public Builder preview returns the canonical repository revision without a session", async () => {
  let databaseReads = 0;
  const handler = createBuilderPreviewHandler({
    getDatabase: () => studentsBookContentSql(null, () => { databaseReads += 1; }),
  });
  const response = await handler(event("GET", route, {}));
  const body = parsed(response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Content-Type"], "application/json");
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(databaseReads, 5);
  assert.deepEqual(Object.keys(body), [
    "bookSlug", "componentSlug", "resource", "schemaVersion", "revision", "source", "document",
  ]);
  assert.deepEqual(body, {
    bookSlug: "ultimate-b2",
    componentSlug: "ultimate-b2-students-book",
    resource: "hotspots",
    schemaVersion: "1.0",
    revision: 0,
    source: "repository",
    document: resource.baseline(),
  });
  assert.doesNotMatch(response.body, forbiddenResponseData);
  assert.doesNotMatch(response.body, /session|user|email|payloadSha|timestamp|clientMutationId/i);
});

test("public Builder preview returns the checksum-validated latest database revision", async () => {
  const sources = currentStudentsBookSources();
  const document = sources.documents.hotspots.payload;
  const pageId = Object.keys(document.pages)[0];
  Object.assign(document.pages[pageId][0], { left: 11.125, top: 22.25, width: 13.375, height: 14.5 });
  const handler = createBuilderPreviewHandler({
    getDatabase: () => studentsBookContentSql({ ...sources, documents: { hotspots: { payload: document, revision: 3, sha256: builderDocumentSha256(document) } } }),
  });
  const response = await handler(event());
  const body = parsed(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.revision, 3);
  assert.equal(body.source, "database");
  assert.deepEqual(body.document, resource.validate(document));
  assert.deepEqual(
    (({ left, top, width, height }) => ({ left, top, width, height }))(body.document.pages[pageId][0]),
    { left: 11.125, top: 22.25, width: 13.375, height: 14.5 },
  );
  assert.doesNotMatch(response.body, forbiddenResponseData);
});

test("hotspot preview loads declared native context and preserves a valid persisted native target", async () => {
  const fixture = currentStudentsBookSources();
  const loaded = [];
  const handler = createBuilderPreviewHandler({
    getDatabase: () => studentsBookPageSql(),
    loadDocument: async (_sql, candidate) => {
      loaded.push(`${candidate.resource}:${candidate.documentKey}`);
      if (candidate.resource === "hotspots") return { revision: fixture.documents.hotspots.revision, source: "database", document: fixture.documents.hotspots.payload };
      if (candidate.resource === "native-activity-index") return { revision: fixture.native.index.revision, source: "database", document: fixture.native.index.payload };
      if (candidate.resource === "native-activity-public") throw new Error("Hotspot preview must batch public documents.");
      if (candidate.resource === "native-activity-teacher") throw new Error("Teacher documents must not be loaded for hotspot preview.");
      return null;
    },
    loadDocuments: async (_sql, resources) => new Map(resources.flatMap((candidate) => {
      loaded.push(`batch:${candidate.resource}:${candidate.documentKey}`);
      const source = fixture.native.activities[candidate.documentKey]?.public;
      return source ? [[candidate.documentKey, { revision: source.revision, source: "database", document: source.payload }]] : [];
    })),
  });
  const response = await handler(event());
  const body = parsed(response);
  assert.equal(response.statusCode, 200);
  assert.equal(body.document.pages[publicationV2Fixture.pageId].some((hotspot) => hotspot.activityKey === publicationV2Fixture.openResponseId), true);
  assert.equal(loaded.includes("native-activity-index:default"), true);
  assert.equal(loaded.includes(`batch:native-activity-public:${publicationV2Fixture.openResponseId}`), true);
  assert.equal(loaded.some((value) => value.startsWith("native-activity-teacher:")), false);
  assert.doesNotMatch(response.body, forbiddenResponseData);
});

for (const componentSlug of managedComponents) {
  test(`managed ${componentSlug} hotspot preview returns the repository empty baseline without lifecycle access`, async () => {
    const result = await managedPreview(componentSlug);
    assert.equal(result.response.statusCode, 200);
    assert.equal(result.body.source, "repository");
    assert.equal(result.body.revision, 0);
    assert.equal(result.body.componentSlug, componentSlug);
    assert.deepEqual(result.body.document, createEmptyManagedComponentHotspotManifest(componentSlug));
    assert.deepEqual(result.body.document.pages, {});
    assert.equal(result.resolved.includes("native-activity-index:"), true);
    assert.equal(result.loaded.includes("native-activity-index:default"), true);
    assert.equal(result.resolved.some((value) => value.startsWith("activity-lifecycle:")), false);
    assert.equal(result.loaded.some((value) => value.startsWith("activity-lifecycle:")), false);
    assert.equal(result.loaded.some((value) => value.startsWith("native-activity-public:")), false);
    assert.equal(result.loaded.some((value) => value.startsWith("native-activity-teacher:")), false);
    assert.doesNotMatch(result.response.body, forbiddenResponseData);
  });
}

test("managed hotspot preview keeps the narrow related-resource allow-list", async () => {
  for (const componentSlug of managedComponents) {
    const managedResource = await resolveBuilderContentResource("ultimate-b2", componentSlug, "hotspots");
    assert.deepEqual(managedResource.requiredRelatedForPreview, ["native-activity-index", "native-activity-public"]);
    assert.equal(managedResource.requiredRelatedForPreview.includes("activity-lifecycle"), false);
  }
});

test("managed preview related-resource loader rejects undeclared lifecycle access before resolution or loading", async () => {
  let resolutions = 0;
  let loads = 0;
  const loadRelated = createBuilderRelatedDocumentLoader({
    sql: {},
    resource: await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-workbook", "hotspots"),
    resolveResource: async () => { resolutions += 1; return null; },
    loadDocument: async () => { loads += 1; return null; },
    allowedResources: ["native-activity-index", "native-activity-public"],
  });
  await assert.rejects(loadRelated("activity-lifecycle", ""), /related resource was not declared/);
  assert.equal(resolutions, 0);
  assert.equal(loads, 0);
});

test("persisted managed hotspots preview with same-component public native activity and no Teacher read", async () => {
  const componentSlug = "ultimate-b2-workbook";
  const page = managedPageFixture(componentSlug);
  const activityId = "ultimate-b2-wb-unit-1-page-1-o1";
  const publicDocument = resolveNativeActivityKind("open-response").createBlankPublic({ activityId, title: "Workbook open response", placement: { pageId: page.id } });
  const document = createEmptyManagedComponentHotspotManifest(componentSlug);
  document.pages[page.id] = [{
    id: "workbook-hotspot-one", unitNumber: 1, pageId: page.id,
    left: 10, top: 15, width: 20, height: 25, label: "Open workbook activity",
    actionType: "normalized_activity", activityKey: activityId,
  }];
  const result = await managedPreview(componentSlug, {
    storedHotspots: { revision: 6, source: "database", document },
    nativeIndex: { revision: 2, source: "database", document: { schemaVersion: "1.0", activities: [{ activityId, kind: "open-response", placement: { pageId: page.id }, sortOrder: 1 }] } },
    publicDocuments: { [activityId]: { revision: 3, source: "database", document: publicDocument } },
  });
  assert.equal(result.response.statusCode, 200);
  assert.equal(result.body.source, "database");
  assert.equal(result.body.revision, 6);
  assert.equal(result.body.document.pages[page.id][0].activityKey, activityId);
  assert.equal(result.loaded.includes(`batch:native-activity-public:${activityId}`), true);
  assert.equal(result.loaded.some((value) => value.startsWith("native-activity-teacher:")), false);
  assert.equal(result.resolved.some((value) => value.startsWith("activity-lifecycle:")), false);
  assert.doesNotMatch(result.response.body, forbiddenResponseData);
});

test("Students hotspot preview rejects non-native targets without consulting mutable canonical lifecycle", async () => {
  const document = currentStudentsBookSources().documents.hotspots.payload;
  const target = Object.values(document.pages).flat()[0];
  target.activityKey = "ultimate-b2-sb-u1-p1-o1";
  const loaded = [];
  const handler = createBuilderPreviewHandler({
    getDatabase: () => studentsBookPageSql(),
    loadDocument: async (_sql, candidate) => {
      loaded.push(`${candidate.resource}:${candidate.documentKey}`);
      if (candidate.resource === "hotspots") return { revision: 8, source: "database", document };
      if (candidate.resource === "activity-lifecycle") return { revision: 1, source: "database", document: { schemaVersion: "1.0", activities: { [target.activityKey]: { status: "retired", pageId: target.pageId } } } };
      if (candidate.resource === "native-activity-index") return null;
      if (candidate.resource === "native-activity-teacher") throw new Error("Teacher documents must not be loaded for Students hotspot preview.");
      return null;
    },
    logger: { error() {} },
  });
  const response = await handler(event());
  assert.equal(response.statusCode, 500);
  assert.equal(loaded.includes("activity-lifecycle:default"), false);
  assert.equal(loaded.includes("native-activity-index:default"), true);
  assert.equal(loaded.some((value) => value.startsWith("native-activity-teacher:")), false);
  assert.deepEqual(parsed(response), { error: "builder_preview_failed" });
});

test("managed hotspot preview rejects a token issued for the other component before document loading", async () => {
  const workbook = await managedPreview("ultimate-b2-workbook");
  let documentLoads = 0;
  const handler = createBuilderPreviewHandler({
    getDatabase: () => managedPagesSql("ultimate-b2-grammar-book"),
    authorizePreview: (previewEvent, sql, scope) => authorizeBuilderPreviewRequest(previewEvent, sql, scope, { environment: managedPreviewEnvironment, now: managedPreviewNow + 1_000 }),
    loadDocument: async () => { documentLoads += 1; return null; },
    logger: { warn() {}, error() {} },
  });
  const response = await handler({
    httpMethod: "GET",
    path: "/builder/preview/content/books/ultimate-b2/components/ultimate-b2-grammar-book/hotspots",
    headers: {},
    queryStringParameters: { previewAuthorization: workbook.token },
  });
  assert.equal(response.statusCode, 401);
  assert.equal(documentLoads, 0);
});

test("hotspot preview rejects deleted, unknown, and malformed native targets without weakening geometry", async () => {
  const fixture = currentStudentsBookSources();
  const preview = async (document, index = fixture.native.index.payload, publicDocuments = fixture.native.activities) => createBuilderPreviewHandler({
    getDatabase: () => studentsBookPageSql(),
    loadDocument: async (_sql, candidate) => {
      if (candidate.resource === "hotspots") return { revision: 4, source: "database", document };
      if (candidate.resource === "native-activity-index") return { revision: 2, source: "database", document: index };
      if (candidate.resource === "native-activity-public") throw new Error("Hotspot preview must batch public documents.");
      return null;
    },
    loadDocuments: async (_sql, resources) => new Map(resources.flatMap((candidate) => {
      const source = publicDocuments[candidate.documentKey]?.public;
      return source ? [[candidate.documentKey, { revision: source.revision, source: "database", document: source.payload }]] : [];
    })),
    logger: { error() {} },
  })(event());

  const deletedIndex = structuredClone(fixture.native.index.payload);
  deletedIndex.activities = deletedIndex.activities.filter((entry) => entry.activityId !== publicationV2Fixture.openResponseId);
  assert.equal((await preview(fixture.documents.hotspots.payload, deletedIndex)).statusCode, 500);

  const missingPublic = structuredClone(fixture.native.activities);
  delete missingPublic[publicationV2Fixture.openResponseId];
  assert.equal((await preview(fixture.documents.hotspots.payload, fixture.native.index.payload, missingPublic)).statusCode, 500);

  const unknown = structuredClone(fixture.documents.hotspots.payload);
  unknown.pages[publicationV2Fixture.pageId].find((hotspot) => hotspot.activityKey === publicationV2Fixture.openResponseId).activityKey = "unknown-native-activity";
  assert.equal((await preview(unknown)).statusCode, 500);

  const invalidGeometry = structuredClone(fixture.documents.hotspots.payload);
  invalidGeometry.pages[publicationV2Fixture.pageId][0].left = -1;
  assert.equal((await preview(invalidGeometry)).statusCode, 500);
});

test("preview resources without a related-context declaration do not load the native index", async () => {
  const teacherResource = await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "ui-controller");
  const resolutions = [];
  const handler = createBuilderPreviewHandler({
    getDatabase: () => studentsBookPageSql(),
    resolveResource: async (...arguments_) => {
      resolutions.push(arguments_.slice(2).join(":"));
      return resolveBuilderContentResource(...arguments_);
    },
    authorizePreview: async () => true,
    loadDocument: async () => ({ revision: 1, source: "database", document: teacherResource.baseline() }),
  });
  const response = await handler(event("GET", "/builder/preview/content/books/ultimate-b2/components/ultimate-b2-students-book/ui-controller"));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(resolutions, ["ui-controller:"]);
});

test("public preview resource lookup fails unknown and non-preview resources closed before database access", async () => {
  let databaseCalls = 0;
  const getDatabase = () => { databaseCalls += 1; return async () => []; };
  const handler = createBuilderPreviewHandler({ getDatabase });
  const unknownRoutes = [
    "/builder/preview/content/books/unknown/components/ultimate-b2-students-book/hotspots",
    "/builder/preview/content/books/ultimate-b2/components/unknown/hotspots",
    "/builder/preview/content/books/ultimate-b2/components/ultimate-b2-students-book/unknown",
  ];
  for (const unknownRoute of unknownRoutes) {
    const response = await handler(event("GET", unknownRoute));
    assert.equal(response.statusCode, 404);
    assert.deepEqual(parsed(response), { error: "builder_preview_resource_not_found" });
  }

  const authenticatedOnly = createBuilderPreviewHandler({
    getDatabase,
    resolveResource: async () => ({ ...resource, previewReadable: false }),
  });
  assert.equal((await authenticatedOnly(event())).statusCode, 404);
  assert.equal(databaseCalls, 0);
});

test("public preview is GET-only and never authorizes through Builder cookies", async () => {
  let databaseCalls = 0;
  const handler = createBuilderPreviewHandler({
    getDatabase: () => { databaseCalls += 1; return async () => []; },
  });
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = await handler(event(method, route, { cookie: "hh_builder_session=private" }));
    assert.equal(response.statusCode, 405);
    assert.deepEqual(parsed(response), { error: "method_not_allowed" });
  }
  assert.equal(databaseCalls, 0);

  const withoutSession = await handler(event());
  const withSession = await handler(event("GET", route, { cookie: "hh_builder_session=private" }));
  assert.deepEqual(withSession, withoutSession);
});

test("corrupt checksum and invalid stored schema return only a generic failure", async () => {
  const document = resource.baseline();
  const diagnostics = [];
  for (const storedRow of [
    row(document, { payload_sha256: "0".repeat(64) }),
    row(document, { schema_version: "9.9" }),
  ]) {
    const handler = createBuilderPreviewHandler({
      getDatabase: () => async () => [storedRow],
      logger: { error: (...arguments_) => diagnostics.push(arguments_) },
    });
    const response = await handler(event());
    assert.equal(response.statusCode, 500);
    assert.deepEqual(parsed(response), { error: "builder_preview_failed" });
    assert.doesNotMatch(response.body, /checksum|schema|payload|database|sql/i);
  }
  assert.equal(diagnostics.length, 2);
  for (const [, diagnostic] of diagnostics) {
    assert.deepEqual(Object.keys(diagnostic), ["stage", "errorName", "errorCode"]);
    assert.doesNotMatch(JSON.stringify(diagnostic), /checksum|schema|payload|DATABASE_URL|postgres|cookie/i);
  }
});

test("private keys are rejected before projection and can never be serialized", async () => {
  const privateDocument = resource.baseline();
  privateDocument.teacherSolution = "must-not-escape";
  const handler = createBuilderPreviewHandler({
    getDatabase: () => studentsBookPageSql(),
    loadDocument: async () => ({ revision: 7, source: "database", document: privateDocument }),
    logger: { error() {} },
  });
  const response = await handler(event());
  assert.equal(response.statusCode, 500);
  assert.deepEqual(parsed(response), { error: "builder_preview_failed" });
  assert.doesNotMatch(response.body, /teacherSolution|must-not-escape/i);
});

test("Teacher UI draft preview requires explicit Builder/scoped authorization", async () => {
  const teacherResource = await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "ui-controller");
  const teacherRoute = "/builder/preview/content/books/ultimate-b2/components/ultimate-b2-students-book/ui-controller";
  const document = teacherResource.baseline();
  const handler = createBuilderPreviewHandler({
    getDatabase: () => studentsBookPageSql(),
    authorizePreview: async (request) => request.headers["x-preview-authorized"] === "yes",
    loadDocument: async () => ({ revision: 1, source: "database", document }),
  });
  assert.equal((await handler(event("GET", teacherRoute))).statusCode, 401);
  const authorized = await handler(event("GET", teacherRoute, { "x-preview-authorized": "yes" }));
  assert.equal(authorized.statusCode, 200);
  assert.deepEqual(parsed(authorized).document, teacherResource.projectPreview(document));
});

test("actual Teacher UI preview authorization accepts fresh exact scope and rejects expired or wrong scope", async () => {
  const environment = { BUILDER_PREVIEW_AUTH_SECRET: "test-only-preview-secret-with-at-least-thirty-two-bytes" };
  const now = Date.parse("2026-08-15T16:00:00Z");
  const intent = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", view: "library", pageId: null, activityId: null, releaseId: null };
  const issued = issueBuilderPreviewAuthorization(intent, { environment, now, nonce: "abcdefghijklmnopQRSTUV" });
  const teacherResource = await resolveBuilderContentResource(intent.bookSlug, intent.componentSlug, "ui-controller");
  const teacherRoute = "/builder/preview/content/books/ultimate-b2/components/ultimate-b2-students-book/ui-controller";
  const request = (token) => ({ httpMethod: "GET", path: teacherRoute, headers: {}, queryStringParameters: { previewAuthorization: token } });
  const handlerAt = (requestNow) => createBuilderPreviewHandler({
    getDatabase: () => async () => [],
    authorizePreview: (previewEvent, sql, scope) => authorizeBuilderPreviewRequest(previewEvent, sql, scope, { environment, now: requestNow }),
    loadDocument: async () => ({ revision: 1, source: "database", document: teacherResource.baseline() }),
  });
  assert.equal((await handlerAt(now + 1_000)(request(issued.token))).statusCode, 200);
  assert.equal((await handlerAt(now + 301_000)(request(issued.token))).statusCode, 401);
  assert.equal((await handlerAt(now + 1_000)(request("malformed"))).statusCode, 401);
  const wrongScope = issueBuilderPreviewAuthorization({ ...intent, componentSlug: "ultimate-b2-workbook" }, { environment, now, nonce: "abcdefghijklmnopQRSTUV" });
  assert.equal((await handlerAt(now + 1_000)(request(wrongScope.token))).statusCode, 401);
});

test("Saved Draft Unit Extras require exact scoped authorization and project only Viewer media fields", async () => {
  const unitExtrasResource = await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "unit-extras");
  const sources = createPublicationV2FixtureSources();
  const unitExtrasRoute = "/builder/preview/content/books/ultimate-b2/components/ultimate-b2-students-book/unit-extras";
  const scopes = [];
  const handler = createBuilderPreviewHandler({
    getDatabase: () => studentsBookPageSql(),
    authorizePreview: async (_request, _sql, scope) => { scopes.push(scope); return true; },
    loadDocument: async () => ({ revision: sources.unitExtras.document.revision, source: "database", document: sources.unitExtras.document.payload }),
  });
  const response = await handler(event("GET", unitExtrasRoute));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(scopes, [{ action: "unit-extras-draft", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" }]);
  const body = parsed(response);
  assert.equal(body.resource, "unit-extras");
  assert.equal(body.source, "database");
  assert.equal(body.document.units[0].categories.videos.length, 2);
  assert.equal(body.document.units[0].categories.videos[0].video.cues.length, 1);
  assert.doesNotMatch(JSON.stringify(body.document), /fileName|byteSize/);

  const denied = createBuilderPreviewHandler({
    getDatabase: () => studentsBookPageSql(), authorizePreview: async () => false,
    loadDocument: async () => { throw new Error("must not load unauthorized Unit Extras"); },
  });
  assert.equal((await denied(event("GET", unitExtrasRoute))).statusCode, 401);
});
