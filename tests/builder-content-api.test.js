import { studentsBookPageSql, currentStudentsBookSources, canonicalStudentsBookPages } from "./fixtures/students-book-current.js";
import assert from "node:assert/strict";
import test from "node:test";

import { json } from "../netlify-sites/ultimate-b2-builder/server/_builder-auth.js";
import { createBuilderContentHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-content.js";
import { resolveBuilderContentResource } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-registry.js";
import { builderDocumentSha256 } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { loadBuilderComponentDocument, loadBuilderComponentDocuments } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-store.js";
import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { createPublicationV2FixtureSources, publicationV2Fixture } from "./fixtures/publication-v2.js";

const builderUserId = "10000000-0000-4000-8000-000000000001";
const route = "/builder/api/content/books/ultimate-b2/components/ultimate-b2-students-book/hotspots";
const mutationOne = "10000000-0000-4000-8000-000000000011";
const mutationTwo = "10000000-0000-4000-8000-000000000012";
const hotspotResource = await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "hotspots");

function event({ method = "GET", path = route, cookie = "hh_builder_session=live", origin = "https://builder.example", body, contentType = "application/json" } = {}) {
  return {
    httpMethod: method,
    path,
    headers: {
      host: "builder.example",
      ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {}),
      ...(contentType ? { "content-type": contentType } : {}),
    },
    body: body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body),
  };
}

function parsed(response) {
  return JSON.parse(response.body);
}

function memoryHarness() {
  const native = currentStudentsBookSources().native;
  let current = null;
  const history = [];
  const audits = [];
  const saveCalls = [];
  const handler = createBuilderContentHandler({
    getDatabase: () => studentsBookPageSql(),
    authorize: async (request) => {
      const cookie = request.headers.cookie || "";
      if (cookie !== "hh_builder_session=live") return { error: json(401, { error: "Unauthorized" }) };
      return { builderUser: { id: builderUserId, role: "developer", status: "active" } };
    },
    loadDocument: async (_sql, resource) => resource.resource === "hotspots" && current
      ? { revision: current.revision, source: "database", document: current.document }
      : resource.resource === "native-activity-index" ? { revision: native.index.revision, source: "database", document: native.index.payload } : null,
    loadDocuments: async (_sql, resources) => new Map(resources.map((resource) => [resource.documentKey, { revision: 1, source: "database", document: native.activities[resource.documentKey].public.payload }])),
    saveDocument: async (_sql, input) => {
      saveCalls.push(input);
      const replay = history.find((item) => item.clientMutationId === input.clientMutationId);
      if (replay) return replay.payloadSha256 === input.payloadSha256
        ? { outcome: "idempotent", revision: replay.revision, currentRevision: current.revision, document: replay.document, payloadSha256: replay.payloadSha256 }
        : { outcome: "mutation_id_conflict", revision: replay.revision, currentRevision: current.revision, document: null };
      const currentRevision = current?.revision || 0;
      if (input.expectedRevision !== currentRevision) return { outcome: "revision_conflict", revision: null, currentRevision, document: null };
      const revision = currentRevision + 1;
      current = { revision, document: input.document, updatedBy: input.builderUserId };
      history.push({ revision, document: input.document, payloadSha256: input.payloadSha256, clientMutationId: input.clientMutationId });
      audits.push({ action: "builder_document_saved", actor: input.builderUserId, metadata: { book_slug: input.resource.bookSlug, component_slug: input.resource.componentSlug, document_type: input.resource.documentType, revision, source: "database" } });
      return { outcome: "saved", revision, currentRevision: revision, document: input.document, payloadSha256: input.payloadSha256 };
    },
  });
  return { handler, history, audits, saveCalls, current: () => current };
}

function baseline() {
  return currentStudentsBookSources().documents.hotspots.payload;
}

function saveReadyDocument(document = baseline()) {
  const result = structuredClone(document);
  delete result.pages["review-30"];
  return result;
}

function changedDocument(label = "Changed safely") {
  const document = saveReadyDocument();
  const pageId = Object.keys(document.pages)[0];
  document.pages[pageId][0].label = label;
  return document;
}

function saveBody(document, expectedRevision = 0, clientMutationId = mutationOne) {
  return { expectedRevision, clientMutationId, document };
}

test("Builder content requires only a live Builder session for GET and Save", async () => {
  const { handler } = memoryHarness();
  for (const cookie of ["", "hh_lms_session=ordinary", "hh_platform_admin_session=admin", "hh_builder_session=revoked", "hh_builder_session=paused"]) {
    assert.equal((await handler(event({ cookie }))).statusCode, 401);
    assert.equal((await handler(event({ method: "PUT", cookie, body: saveBody(changedDocument()) }))).statusCode, 401);
  }
  assert.equal((await handler(event())).statusCode, 200);
});

test("Builder content mutation enforces same origin and JSON before persistence", async () => {
  const { handler, saveCalls } = memoryHarness();
  assert.equal((await handler(event({ method: "PUT", origin: "", body: saveBody(changedDocument()) }))).statusCode, 403);
  assert.equal((await handler(event({ method: "PUT", origin: "https://other.example", body: saveBody(changedDocument()) }))).statusCode, 403);
  assert.equal((await handler(event({ method: "PUT", contentType: "text/plain", body: saveBody(changedDocument()) }))).statusCode, 415);
  assert.equal((await handler(event({ method: "PUT", body: saveBody(changedDocument()) }))).statusCode, 200);
  assert.equal(saveCalls.length, 1);
});

test("resource registry enables managed hotspots while unknown and Test Book resources fail closed", async () => {
  const { handler } = memoryHarness();
  for (const componentSlug of ["ultimate-b2-workbook", "ultimate-b2-grammar-book"]) {
    const response = await handler(event({ path: `/builder/api/content/books/ultimate-b2/components/${componentSlug}/hotspots` }));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(parsed(response).document.pages, {});
  }
  const paths = [
    "/builder/api/content/books/unknown/components/ultimate-b2-students-book/hotspots",
    "/builder/api/content/books/ultimate-b2/components/unknown/hotspots",
    "/builder/api/content/books/ultimate-b2/components/ultimate-b2-test-book/hotspots",
    "/builder/api/content/books/ultimate-b2/components/ultimate-b2-workbook/open-response/ultimate-b2-sb-u1-p5-o2",
    "/builder/api/content/books/ultimate-b2/components/ultimate-b2-grammar-book/open-response/ultimate-b2-sb-u1-p5-o2",
    "/builder/api/content/books/ultimate-b2/components/ultimate-b2-test-book/open-response/ultimate-b2-sb-u1-p5-o2",
    "/builder/api/content/books/ultimate-b2/components/ultimate-b2-students-book/activities",
  ];
  for (const path of paths) assert.equal((await handler(event({ path }))).statusCode, 404);
});

test("GET returns validated repository revision zero until a hosted document exists", async () => {
  const { handler } = memoryHarness();
  const response = await handler(event());
  assert.equal(response.statusCode, 200);
  const payload = parsed(response);
  assert.equal(payload.revision, 0);
  assert.equal(payload.source, "repository");
  assert.equal(payload.document.schemaVersion, "1.0");
  assert.equal(payload.document.packageSlug, "ultimate-b2");
  assert.equal(payload.document.componentSlug, "students-book");
});

test("first and second Saves persist revisions and reload returns the latest document", async () => {
  const { handler, history, audits, current, saveCalls } = memoryHarness();
  const firstDocument = changedDocument("Revision one");
  const first = parsed(await handler(event({ method: "PUT", body: saveBody(firstDocument) })));
  assert.equal(first.revision, 1);
  assert.equal(first.source, "database");
  const secondDocument = changedDocument("Revision two");
  const second = parsed(await handler(event({ method: "PUT", body: saveBody(secondDocument, 1, mutationTwo) })));
  assert.equal(second.revision, 2);
  const loaded = parsed(await handler(event()));
  assert.equal(loaded.revision, 2);
  assert.equal(loaded.document.pages[Object.keys(loaded.document.pages)[0]][0].label, "Revision two");
  assert.equal(history.length, 2);
  assert.equal(current().updatedBy, builderUserId);
  assert.equal(saveCalls[0].builderUserId, builderUserId);
  assert.equal(typeof saveCalls[0].document?.then, "undefined");
  assert.deepEqual(audits.map(({ action }) => action), ["builder_document_saved", "builder_document_saved"]);
  assert.doesNotMatch(JSON.stringify(audits), /payload|password|token|answer|solution/i);
});

test("stale revisions conflict without overwrite", async () => {
  const { handler, history, current } = memoryHarness();
  await handler(event({ method: "PUT", body: saveBody(changedDocument("Current")) }));
  const response = await handler(event({ method: "PUT", body: saveBody(changedDocument("Stale"), 0, mutationTwo) }));
  assert.equal(response.statusCode, 409);
  assert.deepEqual(parsed(response), { error: "revision_conflict", currentRevision: 1 });
  assert.equal(current().document.pages[Object.keys(current().document.pages)[0]][0].label, "Current");
  assert.equal(history.length, 1);
});

test("mutation retries are idempotent while changed payload reuse is rejected", async () => {
  const { handler, history } = memoryHarness();
  const document = changedDocument("Retry-safe");
  const first = parsed(await handler(event({ method: "PUT", body: saveBody(document) })));
  const replay = parsed(await handler(event({ method: "PUT", body: saveBody(document) })));
  assert.equal(first.revision, 1);
  assert.equal(replay.revision, 1);
  assert.equal(replay.idempotent, true);
  assert.equal(history.length, 1);
  const changed = await handler(event({ method: "PUT", body: saveBody(changedDocument("Different")) }));
  assert.equal(changed.statusCode, 409);
  assert.equal(parsed(changed).error, "mutation_id_conflict");
  assert.equal(history.length, 1);
});

test("hotspot validation rejects unknown pages, geometry, IDs, activities, actions, malformed bodies, and private keys", async () => {
  const cases = [];
  const unknownPage = baseline(); unknownPage.pages.unknown = []; cases.push(unknownPage);
  const badBounds = baseline(); badBounds.pages[Object.keys(badBounds.pages)[0]][0].left = 101; cases.push(badBounds);
  const duplicate = baseline(); { const key = Object.keys(duplicate.pages)[0]; duplicate.pages[key].push({ ...duplicate.pages[key][0] }); } cases.push(duplicate);
  const badActivity = baseline(); badActivity.pages[Object.keys(badActivity.pages)[0]][0].activityKey = "unknown"; cases.push(badActivity);
  const badAction = baseline(); badAction.pages[Object.keys(badAction.pages)[0]][0].actionType = "delete"; cases.push(badAction);
  const { handler, saveCalls, audits } = memoryHarness();
  for (const document of cases) assert.equal((await handler(event({ method: "PUT", body: saveBody(document) }))).statusCode, 400);
  assert.equal((await handler(event({ method: "PUT", body: "{" }))).statusCode, 400);
  assert.equal((await handler(event({ method: "PUT", body: { ...saveBody(baseline()), builderUserId } }))).statusCode, 400);
  assert.equal((await handler(event({ method: "PUT", body: `${" ".repeat(512 * 1024)}x` }))).statusCode, 413);
  const privateDocument = baseline(); privateDocument.pages[Object.keys(privateDocument.pages)[0]][0].metadata = { Correct_Option_IDs: ["x"] };
  assert.equal(parsed(await handler(event({ method: "PUT", body: saveBody(privateDocument) }))).error, "private_document_key_rejected");
  assert.equal(saveCalls.length, 0);
  assert.equal(audits.length, 0);
});

test("stable checksums are key-order independent", () => {
  assert.equal(builderDocumentSha256({ b: 2, a: { d: 4, c: 3 } }), builderDocumentSha256({ a: { c: 3, d: 4 }, b: 2 }));
});

test("stored documents verify raw checksums before validation and fail corrupt state closed", async () => {
  const document = baseline();
  const row = {
    schema_version: hotspotResource.schemaVersion,
    revision: 3,
    payload: document,
    payload_sha256: builderDocumentSha256(document),
  };
  const loaded = await loadBuilderComponentDocument(async () => [row], hotspotResource);
  assert.equal(loaded.revision, 3);
  assert.equal(typeof loaded.document?.then, "undefined");

  await assert.rejects(
    loadBuilderComponentDocument(async () => [{ ...row, payload_sha256: "0".repeat(64) }], hotspotResource),
    /checksum is invalid/,
  );
  const invalidPage = structuredClone(document);
  invalidPage.pages.unknown = [];
  await assert.rejects(
    loadBuilderComponentDocument(async () => [{ ...row, payload: invalidPage, payload_sha256: builderDocumentSha256(invalidPage) }], hotspotResource),
    /Unknown Students Book page id/,
  );
});

test("component document batches are exact-scope, public-only, bounded, and canonically validated", async () => {
  const fixture = currentStudentsBookSources();
  const ids = [publicationV2Fixture.openResponseId, publicationV2Fixture.imageId];
  const resources = await Promise.all(ids.map((id) => resolveBuilderContentResource(
    "ultimate-b2", "ultimate-b2-students-book", "native-activity-public", id,
  )));
  let calls = 0;
  let capturedQuery = "";
  let capturedValues = [];
  const sql = async (strings, ...values) => {
    calls += 1;
    capturedQuery = strings.join(" ");
    capturedValues = values;
    return values.at(-1).map((documentKey) => {
      const source = fixture.native.activities[documentKey].public;
      return {
        document_key: documentKey,
        schema_version: "1.0",
        revision: source.revision,
        payload: source.payload,
        payload_sha256: source.sha256,
      };
    });
  };

  assert.deepEqual(await loadBuilderComponentDocuments(() => { throw new Error("empty batch queried"); }, []), new Map());
  const one = await loadBuilderComponentDocuments(sql, resources.slice(0, 1));
  assert.equal(one.get(ids[0]).document.activityId, ids[0]);
  const many = await loadBuilderComponentDocuments(sql, resources);
  assert.deepEqual([...many.keys()], ids);
  assert.equal(calls, 2);
  assert.match(capturedQuery, /document\.document_key=any/);
  assert.deepEqual(capturedValues.slice(0, 3), ["ultimate-b2", "ultimate-b2-students-book", "native_activity_public"]);
  assert.deepEqual(capturedValues.at(-1), ids);
  assert.equal(capturedValues.includes("native_activity_teacher"), false);

  const firstSource = fixture.native.activities[ids[0]].public;
  const corruptRow = {
    document_key: ids[0], schema_version: "1.0", revision: firstSource.revision,
    payload: firstSource.payload, payload_sha256: "0".repeat(64),
  };
  await assert.rejects(loadBuilderComponentDocuments(async () => [corruptRow], resources.slice(0, 1)), /checksum is invalid/);
  await assert.rejects(loadBuilderComponentDocuments(async () => [{ ...corruptRow, payload_sha256: firstSource.sha256, schema_version: "0.0" }], resources.slice(0, 1)), /schema is unsupported/);
  await assert.rejects(loadBuilderComponentDocuments(async () => [{ ...corruptRow, payload_sha256: firstSource.sha256, revision: 0 }], resources.slice(0, 1)), /revision is invalid/);
  await assert.rejects(loadBuilderComponentDocuments(async () => [{ ...corruptRow, document_key: "ultimate-b2-sb-foreign-o1" }], resources.slice(0, 1)), /unexpected document/);
  await assert.rejects(loadBuilderComponentDocuments(async () => [], [resources[0], resources[0]]), /duplicate key/);
  const foreignComponent = await resolveBuilderContentResource(
    "ultimate-b2", "ultimate-b2-workbook", "native-activity-public", "ultimate-b2-wb-unit-1-page-1-o1",
  );
  await assert.rejects(loadBuilderComponentDocuments(async () => [], [resources[0], foreignComponent]), /one component and document type/);
});

test("native validation uses one public batch for zero, one, and many activities and stays below the save budget", async () => {
  const pageId = "ub2-sb-unit-1-part-1";
  const kind = resolveNativeActivityKind("open-response");
  for (const activityCount of [0, 1, 60]) {
    const entries = Array.from({ length: activityCount }, (_, index) => ({
      activityId: `ultimate-b2-sb-batch-o${index + 100}`,
      kind: "open-response",
      placement: { pageId },
      sortOrder: index + 1,
    }));
    const publicDocuments = new Map(entries.map((entry) => [entry.activityId, {
      revision: 1,
      source: "database",
      document: kind.createBlankPublic({ activityId: entry.activityId, title: entry.activityId, placement: entry.placement }),
    }]));
    let operations = 0;
    let batchCalls = 0;
    let batchSize = 0;
    const consumeBudget = () => {
      operations += 1;
      if (operations > 50) {
        const error = new Error("outbound operation budget exceeded");
        error.name = "NeonDbError";
        throw error;
      }
    };
    const handler = createBuilderContentHandler({
      getDatabase: () => studentsBookPageSql({ onQuery: consumeBudget }),
      authorize: async () => ({ builderUser: { id: builderUserId, role: "developer", status: "active" } }),
      loadDocument: async (_sql, candidate) => {
        consumeBudget();
        if (candidate.resource === "native-activity-index") return { revision: 1, source: "database", document: { schemaVersion: "1.0", activities: entries } };
        return null;
      },
      loadDocuments: async (_sql, resources) => {
        consumeBudget();
        batchCalls += 1;
        batchSize = resources.length;
        assert.equal(resources.every((candidate) => candidate.resource === "native-activity-public" && candidate.audience === "public"), true);
        return new Map(resources.map((candidate) => [candidate.documentKey, publicDocuments.get(candidate.documentKey)]));
      },
      saveDocument: async (_sql, input) => {
        consumeBudget();
        return { outcome: "saved", revision: 1, currentRevision: 1, document: input.document, payloadSha256: input.payloadSha256 };
      },
    });
    const response = await handler(event({ method: "PUT", body: saveBody({ ...hotspotResource.baseline(), pages: {} }) }));
    assert.equal(response.statusCode, 200);
    assert.equal(batchCalls, activityCount === 0 ? 0 : 1);
    assert.equal(batchSize, activityCount);
    assert.equal(operations, activityCount === 0 ? 5 : 6);
  }
});

test("native hotspot targets save, reload, and fail closed when the saved native catalog cannot prove membership", async () => {
  const fixture = currentStudentsBookSources();
  let saved = null;
  const handler = createBuilderContentHandler({
    getDatabase: () => studentsBookPageSql(),
    authorize: async () => ({ builderUser: { id: builderUserId, role: "developer", status: "active" } }),
    loadDocument: async (_sql, resource) => {
      if (resource.resource === "hotspots") return saved;
      if (resource.resource === "native-activity-index") return { revision: fixture.native.index.revision, source: "database", document: fixture.native.index.payload };
      if (resource.resource === "native-activity-public") throw new Error("Native hotspot validation must batch public documents.");
      return null;
    },
    loadDocuments: async (_sql, resources) => new Map(resources.flatMap((resource) => {
      const source = fixture.native.activities[resource.documentKey]?.public;
      return source ? [[resource.documentKey, { revision: source.revision, source: "database", document: source.payload }]] : [];
    })),
    saveDocument: async (_sql, input) => {
      saved = { revision: 1, source: "database", document: input.document };
      return { outcome: "saved", revision: 1, currentRevision: 1, document: input.document, payloadSha256: input.payloadSha256 };
    },
  });
  const document = saveReadyDocument(fixture.documents.hotspots.payload);
  const response = await handler(event({ method: "PUT", body: saveBody(document) }));
  assert.equal(response.statusCode, 200);
  assert.equal(parsed(await handler(event())).document.pages[publicationV2Fixture.pageId].some((hotspot) => hotspot.activityKey === publicationV2Fixture.openResponseId), true);

  saved = null;
  delete fixture.native.activities[publicationV2Fixture.openResponseId];
  const rejected = await handler(event({ method: "PUT", body: saveBody(document, 0, mutationTwo) }));
  assert.equal(rejected.statusCode, 400);
  assert.match(parsed(rejected).detail, /incomplete/);
});

test("hotspot PUT rejects retired and moved canonical targets before save_document", async () => {
  const document = saveReadyDocument();
  const pageId = Object.keys(document.pages)[0];
  const activityId = "ultimate-b2-sb-u1-p1-o1";
  document.pages[pageId][0].activityKey = activityId;
  for (const lifecycleEntry of [
    { status: "retired", pageId },
    { status: "active", pageId: "ub2-sb-unit-1-part-2" },
  ]) {
    let saveCalls = 0;
    const handler = createBuilderContentHandler({
      getDatabase: () => studentsBookPageSql(),
      authorize: async () => ({ builderUser: { id: builderUserId, role: "developer", status: "active" } }),
      loadDocument: async (_sql, candidate) => {
        if (candidate.resource === "activity-lifecycle") return { revision: 1, source: "database", document: { schemaVersion: "1.0", activities: { [activityId]: lifecycleEntry } } };
        return null;
      },
      saveDocument: async () => { saveCalls += 1; throw new Error("save_document must not be reached"); },
    });
    const response = await handler(event({ method: "PUT", body: saveBody(document) }));
    assert.equal(response.statusCode, 400);
    assert.equal(parsed(response).error, "invalid_document");
    assert.equal(saveCalls, 0);
    assert.match(parsed(response).detail, /unavailable activityKey/);
  }
});

test("hotspot PUT rejects inactive, moved, kind-mismatched, and placement-mismatched native targets before save_document", async () => {
  const makeCase = ({ indexTransform = (value) => value, publicTransform = (value) => value }) => {
    const fixture = currentStudentsBookSources();
    const activityId = publicationV2Fixture.openResponseId;
    const document = saveReadyDocument(fixture.documents.hotspots.payload);
    document.pages[publicationV2Fixture.pageId] = document.pages[publicationV2Fixture.pageId]
      .filter((hotspot) => hotspot.activityKey === activityId || !hotspot.activityKey.includes("-o9"));
    const index = structuredClone(fixture.native.index.payload);
    index.activities = indexTransform(index.activities.filter((entry) => entry.activityId === activityId));
    const publicDocument = publicTransform(structuredClone(fixture.native.activities[activityId].public.payload));
    return { activityId, document, index, publicDocument };
  };
  const cases = [
    makeCase({ indexTransform: () => [] }),
    makeCase({
      indexTransform: ([entry]) => [{ ...entry, placement: { pageId: "ub2-sb-unit-1-part-2" } }],
      publicTransform: (document) => ({ ...document, placement: { pageId: "ub2-sb-unit-1-part-2" } }),
    }),
    makeCase({ indexTransform: ([entry]) => [{ ...entry, kind: "image" }] }),
    makeCase({ indexTransform: ([entry]) => [{ ...entry, placement: { pageId: "ub2-sb-unit-1-part-2" } }] }),
  ];
  for (const candidate of cases) {
    let saveCalls = 0;
    const handler = createBuilderContentHandler({
      getDatabase: () => studentsBookPageSql(),
      authorize: async () => ({ builderUser: { id: builderUserId, role: "developer", status: "active" } }),
      loadDocument: async (_sql, resource) => resource.resource === "native-activity-index"
        ? { revision: 1, source: "database", document: candidate.index }
        : null,
      loadDocuments: async (_sql, resources) => new Map(resources.map((resource) => [resource.documentKey, {
        revision: 1, source: "database", document: candidate.publicDocument,
      }])),
      saveDocument: async () => { saveCalls += 1; throw new Error("save_document must not be reached"); },
    });
    const response = await handler(event({ method: "PUT", body: saveBody(candidate.document) }));
    assert.equal(response.statusCode, 400);
    assert.equal(parsed(response).error, "invalid_document");
    assert.equal(saveCalls, 0);
  }
});
