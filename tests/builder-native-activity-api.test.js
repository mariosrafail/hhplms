import { studentsBookPageSql, currentStudentsBookSources, canonicalStudentsBookPages } from "./fixtures/students-book-current.js";
import assert from "node:assert/strict";
import { generateNativeMarkWordsBulkCandidate } from "../src/data/native-activities/nativeMarkWordsBulkAuthoring.js";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { json } from "../netlify-sites/ultimate-b2-builder/server/_builder-auth.js";
import { createBuilderContentHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-content.js";
import { builderDocumentSha256 } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { resolveBuilderContentResource } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-registry.js";
import { createBuilderNativeActivitiesHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-native-activities.js";
import { resolveNativeActivityAdapter } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-adapters.js";
import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { addNativeCompleteSentencesItem } from "../src/data/native-activities/nativeCompleteSentencesAuthoring.js";
import { createPublicationV2FixtureSources, publicationV2Fixture } from "./fixtures/publication-v2.js";

const actor = "10000000-0000-4000-8000-000000000001";
const root = "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/create";
const pageId = "ub2-sb-unit-1-part-1";
const request = (overrides = {}) => ({ httpMethod: overrides.method || "POST", path: overrides.path || root, headers: { host: "builder.example", origin: "https://builder.example", cookie: "hh_builder_session=live", "content-type": "application/json", ...overrides.headers }, body: JSON.stringify(overrides.body || { kind: "open-response", pageId, title: "Native draft", clientMutationId: overrides.clientMutationId || randomUUID() }) });

function harness(overrides = {}) {
  let indexState = null;
  let hotspotState = null;
  const documents = new Map();
  const mutations = new Map();
  const pairMutations = new Map();
  const deleteMutations = new Map();
  const handler = createBuilderNativeActivitiesHandler({
    getDatabase: () => studentsBookPageSql(),
    authorize: async (event) => event.headers.cookie === "hh_builder_session=live" ? { builderUser: { id: actor } } : { error: json(401, { error: "Unauthorized" }) },
    loadDocument: async (_sql, resource) => resource.documentType === "native_activity_index" ? indexState
      : resource.documentType === "hotspots" ? hotspotState
        : documents.get(`${resource.documentType}:${resource.documentKey}`) || null,
    loadKnownActivityIds: async () => [...documents.keys()].filter((key) => key.startsWith("native_activity_public:")).map((key) => key.slice("native_activity_public:".length)),
    create: async (_sql, input) => {
      const replay = mutations.get(input.clientMutationId);
      if (replay) return replay.requestSha256 === input.requestSha256 ? { ...replay.result, outcome: "idempotent" } : { ...replay.result, outcome: "mutation_id_conflict" };
      if ((indexState?.revision || 0) !== input.expectedIndexRevision) return { outcome: "revision_conflict", indexRevision: indexState?.revision || 0 };
      if (documents.has(`native_activity_public:${input.activityId}`)) return { outcome: "identity_conflict", activityId: input.activityId };
      indexState = { revision: input.expectedIndexRevision + 1, source: "database", document: input.indexDocument };
      documents.set(`native_activity_public:${input.activityId}`, { revision: 1, source: "database", document: input.publicDocument });
      documents.set(`native_activity_teacher:${input.activityId}`, { revision: 1, source: "database", document: input.teacherDocument });
      const result = { outcome: "created", activityId: input.activityId, indexRevision: indexState.revision, publicRevision: 1, teacherRevision: 1 };
      mutations.set(input.clientMutationId, { requestSha256: input.requestSha256, result });
      return result;
    },
    delete: async (_sql, input) => {
      const replay = deleteMutations.get(input.clientMutationId);
      if (replay) return replay.requestSha256 === input.requestSha256 ? { ...replay.result, outcome: "idempotent" } : { ...replay.result, outcome: "mutation_id_conflict" };
      if (!indexState?.document.activities.some((entry) => entry.activityId === input.activityId)) return { outcome: "activity_not_active" };
      if (indexState.revision !== input.expectedIndexRevision || (hotspotState?.revision || 0) !== input.expectedHotspotRevision) return {
        outcome: "revision_conflict", indexRevision: indexState.revision, hotspotRevision: hotspotState?.revision || 0,
      };
      indexState = { revision: indexState.revision + 1, source: "database", document: input.indexDocument };
      if (input.hotspotChanged) hotspotState = { revision: (hotspotState?.revision || 0) + 1, source: "database", document: input.hotspotDocument };
      const result = { outcome: "deleted", activityId: input.activityId, indexRevision: indexState.revision, hotspotRevision: hotspotState?.revision || 0, removedHotspotCount: input.removedHotspotCount };
      deleteMutations.set(input.clientMutationId, { requestSha256: input.requestSha256, result });
      return result;
    },
    mutateLifecycle: overrides.mutateLifecycle,
    prepareAsset: overrides.prepareAsset,
    claimAsset: overrides.claimAsset,
    validateAssets: overrides.validateAssets || (async () => true),
    savePair: async (_sql, input) => {
      const replay = pairMutations.get(input.clientMutationId);
      if (replay) return replay.requestSha256 === input.requestSha256 ? { ...replay.result, outcome: "idempotent" } : { ...replay.result, outcome: "mutation_id_conflict" };
      const publicState = documents.get(`native_activity_public:${input.activityId}`);
      const teacherState = documents.get(`native_activity_teacher:${input.activityId}`);
      if (publicState.revision !== input.expectedPublicRevision || teacherState.revision !== input.expectedTeacherRevision) return { outcome: "revision_conflict", currentPublicRevision: publicState.revision, currentTeacherRevision: teacherState.revision };
      publicState.revision += 1; teacherState.revision += 1; publicState.document = input.publicDocument; teacherState.document = input.teacherDocument;
      const result = { outcome: "saved", publicRevision: publicState.revision, teacherRevision: teacherState.revision, currentPublicRevision: publicState.revision, currentTeacherRevision: teacherState.revision };
      pairMutations.set(input.clientMutationId, { requestSha256: input.requestSha256, result });
      return result;
    },
    logger: { error() {} },
  });
  return { handler, documents, getIndex: () => indexState, getHotspots: () => hotspotState, setHotspots: (document, revision = 1) => { hotspotState = { revision, source: "database", document }; } };
}

function createWorkbookCatalogSources(entries) {
  const kind = resolveNativeActivityKind("open-response");
  const index = { schemaVersion: "1.0", activities: entries.map(({ activityId, pageId, sortOrder }) => ({ activityId, kind: "open-response", placement: { pageId }, sortOrder })) };
  return {
    native: {
      index: { payload: index, revision: 1, sha256: builderDocumentSha256(index) },
      activities: Object.fromEntries(index.activities.map((entry) => {
        const publicDocument = kind.createBlankPublic({ activityId: entry.activityId, title: `Workbook ${entry.activityId}`, placement: entry.placement });
        const teacherDocument = kind.createBlankTeacher({ activityId: entry.activityId });
        return [entry.activityId, {
          index: entry,
          public: { payload: publicDocument, revision: 1, sha256: builderDocumentSha256(publicDocument) },
          teacher: { payload: teacherDocument, revision: 1, sha256: builderDocumentSha256(teacherDocument) },
        }];
      })),
      assetRows: [],
    },
  };
}

test("native creation HTTP boundary rejects missing auth, wrong origin, unknown scope, kind, and placement", async () => {
  const { handler } = harness();
  assert.equal((await handler(request({ headers: { cookie: "" } }))).statusCode, 401);
  assert.equal((await handler(request({ headers: { origin: "https://attacker.example" } }))).statusCode, 403);
  assert.equal((await handler(request({ path: "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-workbook/create" }))).statusCode, 400);
  assert.equal((await handler(request({ body: { kind: "matching", pageId, title: "x", clientMutationId: randomUUID() } }))).statusCode, 400);
  assert.equal((await handler(request({ body: { kind: "image", pageId: "unknown", title: "x", clientMutationId: randomUUID() } }))).statusCode, 400);
});

test("Image paired save requires auth and origin and delegates semantic managed-asset validation", async () => {
  const checked = [];
  const { handler, documents } = harness({ validateAssets: async (_sql, input) => { checked.push(input); if (input.assets[0]?.checksumSha256 !== "a".repeat(64)) throw new Error("Native managed asset references are invalid."); return true; } });
  const created = JSON.parse((await handler(request({ body: { kind: "image", pageId, title: "Secured image", clientMutationId: randomUUID() } }))).body);
  const publicDocument = structuredClone(documents.get(`native_activity_public:${created.activityId}`).document);
  const teacherDocument = structuredClone(documents.get(`native_activity_teacher:${created.activityId}`).document);
  const path = `/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/activities/${created.activityId}/save`;
  const body = { expectedPublicRevision: 1, expectedTeacherRevision: 1, clientMutationId: randomUUID(), publicDocument, teacherDocument };
  assert.equal((await handler(request({ path, body, headers: { cookie: "" } }))).statusCode, 401);
  assert.equal((await handler(request({ path, body, headers: { origin: "https://attacker.example" } }))).statusCode, 403);
  const assetSlot = "asset-image";
  publicDocument.assets = [{ assetId: "10000000-0000-4000-8000-000000000099", checksumSha256: "b".repeat(64), role: "activity_artwork", slot: assetSlot }];
  publicDocument.parts[0].interaction = { kind: "image", surface: { width: 1024, height: 582 }, images: [
    { id: `img-${"a".repeat(32)}`, assetSlot, area: { x: 10, y: 20, width: 320, height: 220 }, order: 0, altText: "Diagram", decorative: false, fit: "contain", locked: false },
    { id: `img-${"b".repeat(32)}`, assetSlot, area: { x: 40, y: 50, width: 320, height: 220 }, order: 1, altText: "Second use", decorative: false, fit: "cover", locked: true },
  ] };
  const rejected = await handler(request({ path, body: { ...body, publicDocument, clientMutationId: randomUUID() } }));
  assert.equal(rejected.statusCode, 400);
  assert.equal(checked[0].activityId, created.activityId);
  assert.equal(checked[0].componentSlug, "ultimate-b2-students-book");
  publicDocument.assets[0].checksumSha256 = "a".repeat(64);
  publicDocument.readableText = { kind: "image", assetSlot, sourceWidth: 1000, sourceHeight: 1800, altText: "Readable passage" };
  const saved = await handler(request({ path, body: { ...body, publicDocument, clientMutationId: randomUUID() } }));
  assert.equal(saved.statusCode, 200);
  assert.equal(JSON.parse(saved.body).publicRevision, 2);
  assert.equal(JSON.parse(saved.body).publicDocument.parts[0].interaction.images.length, 2);
  assert.equal(JSON.parse(saved.body).publicDocument.assets.length, 1);
  assert.deepEqual(checked.at(-1).requirements, [{ slot: assetSlot, width: 1000, height: 1800, label: "Readable Text" }]);
});

test("one create mutation produces index, public, and Teacher documents and replays the stable ID", async () => {
  const { handler, documents, getIndex } = harness();
  const clientMutationId = randomUUID();
  const first = await handler(request({ clientMutationId }));
  const replay = await handler(request({ clientMutationId }));
  assert.equal(first.statusCode, 200);
  const created = JSON.parse(first.body);
  assert.match(created.activityId, /^ultimate-b2-sb-u1-p1-o\d+$/);
  assert.equal(JSON.parse(replay.body).activityId, created.activityId);
  assert.equal(JSON.parse(replay.body).idempotent, true);
  assert.equal(getIndex().document.activities[0].activityId, created.activityId);
  assert.equal(documents.get(`native_activity_public:${created.activityId}`).document.parts[0].id, "part-1");
  assert.equal(documents.get(`native_activity_teacher:${created.activityId}`).document.parts[0].id, "part-1");
  const changed = await handler(request({ clientMutationId, body: { kind: "image", pageId, title: "Different", clientMutationId } }));
  assert.equal(changed.statusCode, 409);
  assert.equal(JSON.parse(changed.body).error, "mutation_id_conflict");
});

test("activity relocation forwards the server-derived authoritative source page independently of the client expectation", async () => {
  const captured = [];
  const { handler } = harness({
    mutateLifecycle: async (_sql, input) => {
      captured.push(input);
      return { outcome: "location_conflict" };
    },
  });
  const created = JSON.parse((await handler(request())).body);
  const clientExpectedSource = "ub2-sb-unit-1-part-2";
  const path = `/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/activities/${created.activityId}/move`;
  const moved = await handler(request({ path, body: {
    sourcePageId: clientExpectedSource,
    destinationPageId: "reading-19",
    clientMutationId: randomUUID(),
  } }));

  assert.equal(moved.statusCode, 409);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].sourcePageId, clientExpectedSource);
  assert.equal(captured[0].authoritativeSourcePageId, pageId);
});

test("native deletion prunes every page reference, preserves history, is idempotent, and never reuses the stable ID", async () => {
  const { handler, documents, getIndex, getHotspots, setHotspots } = harness();
  const first = JSON.parse((await handler(request())).body);
  const unrelated = "legacy-u1-p1-a1";
  const hotspot = (id, activityKey, hotspotPageId = pageId) => ({
    id, unitNumber: 1, pageId: hotspotPageId, pageNumber: hotspotPageId === pageId ? 5 : 6,
    left: 10, top: 10, width: 20, height: 20, label: id, actionType: "normalized_activity", activityKey,
  });
  setHotspots({ schemaVersion: "1.0", packageSlug: "ultimate-b2", componentSlug: "students-book", pages: {
    [pageId]: [hotspot("delete-one", first.activityId), hotspot("keep-one", unrelated)],
    "ub2-sb-unit-1-part-2": [hotspot("delete-two", first.activityId, "ub2-sb-unit-1-part-2")],
  } }, 7);
  const mutationId = randomUUID();
  const path = `/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/activities/${first.activityId}/delete`;
  assert.equal((await handler(request({ path, body: { clientMutationId: mutationId }, headers: { cookie: "" } }))).statusCode, 401);
  assert.equal((await handler(request({ path, body: { clientMutationId: mutationId }, headers: { origin: "https://attacker.example" } }))).statusCode, 403);
  assert.equal((await handler(request({ path, body: { clientMutationId: mutationId, activityId: first.activityId } }))).statusCode, 400);
  const deletion = await handler(request({ path, body: { clientMutationId: mutationId } }));
  assert.equal(deletion.statusCode, 200);
  assert.deepEqual(JSON.parse(deletion.body), {
    outcome: "deleted", activityId: first.activityId, indexRevision: 2, hotspotRevision: 8, removedHotspotCount: 2, idempotent: false,
  });
  assert.equal(getIndex().document.activities.some((entry) => entry.activityId === first.activityId), false);
  assert.deepEqual(Object.values(getHotspots().document.pages).flat().map((entry) => entry.activityKey), [unrelated]);
  assert.ok(documents.has(`native_activity_public:${first.activityId}`), "public history remains");
  assert.ok(documents.has(`native_activity_teacher:${first.activityId}`), "Teacher history remains");
  assert.equal(JSON.parse((await handler(request({ path, body: { clientMutationId: mutationId } }))).body).idempotent, true);
  assert.equal((await handler(request({ path, body: { clientMutationId: randomUUID() } }))).statusCode, 404);

  const second = JSON.parse((await handler(request({ body: { kind: "open-response", pageId, title: "Replacement", clientMutationId: randomUUID() } }))).body);
  assert.notEqual(second.activityId, first.activityId);
  assert.ok(Number(second.activityId.match(/-o(\d+)$/)?.[1]) > Number(first.activityId.match(/-o(\d+)$/)?.[1]));
  assert.equal((await handler(request({ path: `/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/activities/${second.activityId}/delete`, body: { clientMutationId: mutationId } }))).statusCode, 409);
  assert.equal((await handler(request({ path: "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/activities/ultimate-b2-sb-u1-p1-o1/delete", body: { clientMutationId: randomUUID() } }))).statusCode, 404);
});

test("deleted native activities reject stale paired saves and asset preparation without invoking mutation stores", async () => {
  let validated = 0;
  let prepared = 0;
  let claimed = 0;
  const { handler, documents } = harness({
    validateAssets: async () => { validated += 1; },
    prepareAsset: async () => { prepared += 1; throw new Error("must not prepare"); },
    claimAsset: async () => { claimed += 1; throw new Error("must not claim"); },
  });
  const created = JSON.parse((await handler(request())).body);
  const path = `/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/activities/${created.activityId}`;
  assert.equal((await handler(request({ path: `${path}/delete`, body: { clientMutationId: randomUUID() } }))).statusCode, 200);
  const staleSave = await handler(request({ path: `${path}/save`, body: {
    expectedPublicRevision: 1, expectedTeacherRevision: 1, clientMutationId: randomUUID(),
    publicDocument: documents.get(`native_activity_public:${created.activityId}`).document,
    teacherDocument: documents.get(`native_activity_teacher:${created.activityId}`).document,
  } }));
  assert.equal(staleSave.statusCode, 404);
  assert.equal(validated, 0);
  const stalePrepare = await handler(request({ path: `${path}/assets/prepare`, body: {
    name: "audio.mp3", size: 100, type: "audio/mpeg", assetSlot: "audio-one", clientMutationId: randomUUID(),
  } }));
  assert.equal(stalePrepare.statusCode, 404);
  assert.equal(prepared, 0);
  const staleFinalize = await handler(request({ path: `${path}/assets/finalize`, body: {
    uploadId: randomUUID(), clientMutationId: randomUUID(),
  } }));
  assert.equal(staleFinalize.statusCode, 404);
  assert.equal(claimed, 0);
});

test("native documents are authenticated reads and paired writes are the only mutation boundary", async () => {
  const { handler: create, documents } = harness();
  const created = JSON.parse((await create(request())).body);
  const content = createBuilderContentHandler({
    getDatabase: () => studentsBookPageSql(), authorize: async (event) => event.headers.cookie === "hh_builder_session=live" ? { builderUser: { id: actor } } : { error: json(401, { error: "Unauthorized" }) },
    loadDocument: async (_sql, resource) => documents.get(`${resource.documentType}:${resource.documentKey}`) || null,
    saveDocument: async (_sql, input) => { documents.set(`${input.resource.documentType}:${input.resource.documentKey}`, { revision: input.expectedRevision + 1, source: "database", document: input.document }); return { outcome: "saved", revision: input.expectedRevision + 1, currentRevision: input.expectedRevision + 1, document: input.document }; },
  });
  const path = (resource) => `/builder/api/content/books/ultimate-b2/components/ultimate-b2-students-book/${resource}/${created.activityId}`;
  const event = (resource, method = "GET", body = null, cookie = "hh_builder_session=live") => ({ httpMethod: method, path: path(resource), headers: { host: "builder.example", origin: "https://builder.example", cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : "" });
  assert.equal((await content(event("native-activity-public", "GET", null, ""))).statusCode, 401);
  assert.equal((await content(event("native-activity-teacher", "GET", null, ""))).statusCode, 401);
  const publicDocument = documents.get(`native_activity_public:${created.activityId}`).document;
  const privatePublic = structuredClone(publicDocument); privatePublic.metadata.modelAnswer = "leak";
  const publicRejected = await content(event("native-activity-public", "PUT", { expectedRevision: 1, clientMutationId: randomUUID(), document: privatePublic }));
  assert.equal(publicRejected.statusCode, 405);
  assert.equal(JSON.parse(publicRejected.body).error, "method_not_allowed");
  const teacherDocument = documents.get(`native_activity_teacher:${created.activityId}`).document;
  const teacherSaved = await content(event("native-activity-teacher", "PUT", { expectedRevision: 1, clientMutationId: randomUUID(), document: teacherDocument }));
  assert.equal(teacherSaved.statusCode, 405);
  const changedKind = { ...publicDocument, kind: "image" };
  assert.equal((await content(event("native-activity-public", "PUT", { expectedRevision: 1, clientMutationId: randomUUID(), document: changedKind }))).statusCode, 405);
  assert.equal(await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "native-activity-public", "../../secret"), null);

  const imageCreated = JSON.parse((await create(request({ body: { kind: "image", pageId, title: "Image metadata", clientMutationId: randomUUID() } }))).body);
  const imagePublic = structuredClone(documents.get(`native_activity_public:${imageCreated.activityId}`).document); imagePublic.metadata.title = "Updated Image metadata";
  const imageTeacher = structuredClone(documents.get(`native_activity_teacher:${imageCreated.activityId}`).document);
  const imageSaved = await content({ httpMethod: "PUT", path: `/builder/api/content/books/ultimate-b2/components/ultimate-b2-students-book/native-activity-public/${imageCreated.activityId}`, headers: { host: "builder.example", origin: "https://builder.example", cookie: "hh_builder_session=live", "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1, clientMutationId: randomUUID(), document: imagePublic }) });
  assert.equal(imageSaved.statusCode, 405);
  const imagePairPath = `/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/activities/${imageCreated.activityId}/save`;
  const imagePairSaved = await create({ httpMethod: "POST", path: imagePairPath, headers: { host: "builder.example", origin: "https://builder.example", cookie: "hh_builder_session=live", "content-type": "application/json" }, body: JSON.stringify({ expectedPublicRevision: 1, expectedTeacherRevision: 1, clientMutationId: randomUUID(), publicDocument: imagePublic, teacherDocument: imageTeacher }) });
  assert.equal(imagePairSaved.statusCode, 200);
  assert.equal(JSON.parse(imagePairSaved.body).publicDocument.metadata.title, "Updated Image metadata");

  const questionId = `q-${"a".repeat(32)}`;
  publicDocument.parts[0].interaction.questions.push({ id: questionId, prompt: "Explain.", promptArea: { x: 20, y: 20, width: 400, height: 50 }, promptStyle: { fontFamily: "Arial", fontSize: 20, color: "#111827", align: "left" }, responseRegion: { id: `${questionId}-response`, ariaLabel: "Response for question 1", area: { x: 40, y: 100, width: 500, height: 120 }, presentation: { paddingX: 10, paddingY: 8, lineCount: 3, lineSpacing: 32, linePositions: [40, 72, 104], lineWidth: 480, answerFontFamily: "Arial", answerFontSizeMin: 12, answerFontSizeMax: 22, color: "#111827", align: "left" } } });
  teacherDocument.parts[0].solution.modelAnswers.push({ questionId, text: "A private answer." });
  const pairPath = `/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/activities/${created.activityId}/save`;
  const mutationId = randomUUID();
  const pairEvent = (body) => ({ httpMethod: "POST", path: pairPath, headers: { host: "builder.example", origin: "https://builder.example", cookie: "hh_builder_session=live", "content-type": "application/json" }, body: JSON.stringify(body) });
  const pairBody = { expectedPublicRevision: 1, expectedTeacherRevision: 1, clientMutationId: mutationId, publicDocument, teacherDocument };
  const saved = await create(pairEvent(pairBody));
  assert.equal(saved.statusCode, 200);
  assert.equal(JSON.parse(saved.body).publicRevision, 2);
  assert.equal(JSON.parse(saved.body).teacherRevision, 2);
  assert.equal(JSON.stringify(JSON.parse(saved.body).publicDocument).includes("private answer"), false);
  assert.equal(JSON.parse((await create(pairEvent(pairBody))).body).idempotent, true);
  const stale = await create(pairEvent({ ...pairBody, clientMutationId: randomUUID() }));
  assert.equal(stale.statusCode, 409);
});

test("authenticated native catalog exposes page-aware readiness without Teacher answers", async () => {
  const sources = createPublicationV2FixtureSources();
  const scopes = [];
  const handler = createBuilderNativeActivitiesHandler({
    getDatabase: () => studentsBookPageSql(),
    authorize: async (event) => event.headers.cookie === "hh_builder_session=live" ? { builderUser: { id: actor } } : { error: json(401, { error: "Unauthorized" }) },
    collectCatalog: async (_sql, scope) => { scopes.push(scope); return sources; },
    logger: { error() {} },
  });
  const path = "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/catalog";
  assert.equal((await handler(request({ method: "GET", path, headers: { cookie: "" } }))).statusCode, 401);
  const response = await handler(request({ method: "GET", path }));
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.deepEqual({ bookSlug: payload.bookSlug, componentSlug: payload.componentSlug }, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" });
  assert.deepEqual(scopes[0], { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" });
  assert.deepEqual(payload.activities.map((activity) => activity.activityId), [publicationV2Fixture.openResponseId, publicationV2Fixture.imageId, publicationV2Fixture.singleChoiceId, publicationV2Fixture.dragDropId]);
  assert.equal(payload.activities.every((activity) => activity.placement.pageId === publicationV2Fixture.pageId && activity.ready), true);
  assert.doesNotMatch(response.body, new RegExp(publicationV2Fixture.teacherSentinel));

  sources.native.activities[publicationV2Fixture.openResponseId].public.payload.parts[0].interaction.questions = [];
  sources.native.activities[publicationV2Fixture.openResponseId].teacher.payload.parts[0].solution.modelAnswers = [];
  const incomplete = await handler(request({ method: "GET", path }));
  assert.equal(incomplete.statusCode, 200, incomplete.body);
  const incompletePayload = JSON.parse(incomplete.body);
  assert.deepEqual(incompletePayload.activities.map((activity) => activity.activityId), [publicationV2Fixture.imageId, publicationV2Fixture.singleChoiceId, publicationV2Fixture.dragDropId]);
  assert.deepEqual(incompletePayload.invalidActivities, [{
    activityId: publicationV2Fixture.openResponseId, kind: "open-response", pageId: publicationV2Fixture.pageId,
    code: "document_integrity_invalid", stage: "public-document", loadable: false, ready: false,
  }]);
  assert.doesNotMatch(incomplete.body, new RegExp(publicationV2Fixture.teacherSentinel));
});

test("catalog quarantines a missing local pair while preserving valid activities and safe diagnostics", async () => {
  const sources = createPublicationV2FixtureSources();
  sources.native.activities[publicationV2Fixture.openResponseId].teacher = null;
  const warnings = [];
  const handler = createBuilderNativeActivitiesHandler({
    getDatabase: () => studentsBookPageSql(), authorize: async () => ({ builderUser: { id: actor } }),
    collectCatalog: async () => sources, logger: { error() {}, warn(message, fields) { warnings.push({ message, fields }); } },
  });
  const response = await handler(request({ method: "GET", path: "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/catalog" }));
  assert.equal(response.statusCode, 200, response.body);
  const payload = JSON.parse(response.body);
  assert.equal(payload.activities.some((activity) => activity.activityId === publicationV2Fixture.openResponseId), false);
  assert.deepEqual(payload.invalidActivities[0], {
    activityId: publicationV2Fixture.openResponseId, kind: "open-response", pageId: publicationV2Fixture.pageId,
    code: "pair_missing", stage: "pair-load", loadable: false, ready: false,
  });
  assert.deepEqual(warnings[0].fields, {
    componentSlug: "ultimate-b2-students-book", activityId: publicationV2Fixture.openResponseId,
    kind: "open-response", code: "pair_missing", stage: "pair-load",
  });
  assert.doesNotMatch(response.body, new RegExp(publicationV2Fixture.teacherSentinel));
});

test("catalog keeps a structurally valid activity non-ready when its local managed asset is missing", async () => {
  const sources = createPublicationV2FixtureSources();
  sources.native.assetRows = sources.native.assetRows.filter((asset) => asset.id !== publicationV2Fixture.assetId);
  const handler = createBuilderNativeActivitiesHandler({
    getDatabase: () => studentsBookPageSql(), authorize: async () => ({ builderUser: { id: actor } }), collectCatalog: async () => sources, logger: { error() {} },
  });
  const response = await handler(request({ method: "GET", path: "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/catalog" }));
  assert.equal(response.statusCode, 200, response.body);
  const image = JSON.parse(response.body).activities.find((activity) => activity.activityId === publicationV2Fixture.imageId);
  assert.equal(image.ready, false);
  assert.ok(image.issues.some((issue) => issue.includes("required managed asset")));
});

test("catalog fails closed when a referenced managed asset belongs to another component or activity", async () => {
  for (const asset of [
    { component_slug: "ultimate-b2-workbook" },
    { source_metadata: { native_activity_id: publicationV2Fixture.openResponseId, asset_slot: "composition-artwork" } },
  ]) {
    const sources = createPublicationV2FixtureSources();
    Object.assign(sources.native.assetRows[0], asset);
    const handler = createBuilderNativeActivitiesHandler({
      getDatabase: () => studentsBookPageSql(), authorize: async () => ({ builderUser: { id: actor } }), collectCatalog: async () => sources, logger: { error() {} },
    });
    const response = await handler(request({ method: "GET", path: "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/catalog" }));
    assert.equal(response.statusCode, 500);
    assert.deepEqual(JSON.parse(response.body), { error: "native_activity_request_failed" });
  }
});

test("catalog boundary failures retain one generic response and emit only their exact safe diagnostic stage", async () => {
  const studentPath = "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/catalog";
  const workbookPath = "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-workbook/catalog";
  const baseAdapter = resolveNativeActivityAdapter("ultimate-b2", "ultimate-b2-students-book");
  const cases = [
    {
      name: "scope unavailable",
      expected: { code: "native_catalog_boundary_invalid", boundaryStage: "catalog_scope_unavailable", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" },
      sources: { native: null },
    },
    {
      name: "foreign component identity",
      path: workbookPath,
      expected: {
        code: "native_catalog_boundary_invalid", boundaryStage: "activity_identity_outside_component",
        bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-workbook", activityId: publicationV2Fixture.openResponseId,
        kind: "open-response", pageId: publicationV2Fixture.pageId,
      },
    },
    {
      name: "known placement-domain rejection",
      mutate(sources) { sources.native.index.payload.activities[0].placement.pageId = "../invalid"; },
      expected: {
        code: "native_catalog_boundary_invalid", boundaryStage: "placement_resolution_failed",
        bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", activityId: publicationV2Fixture.openResponseId,
        kind: "open-response", // Invalid page syntax must not be echoed into diagnostics.
      },
    },
    {
      name: "resolved placement mismatch",
      resolveAdapter: () => ({ ...baseAdapter, resolveExistingPlacements: async () => new Map([[publicationV2Fixture.pageId, { pageId: "different-students-page" }]]) }),
      expected: {
        code: "native_catalog_boundary_invalid", boundaryStage: "placement_mismatch",
        bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", activityId: publicationV2Fixture.openResponseId,
        kind: "open-response", pageId: publicationV2Fixture.pageId,
      },
    },
    {
      name: "unsupported activity kind",
      mutate(sources) { sources.native.index.payload.activities[0].kind = "unsupported-kind"; },
      expected: {
        code: "native_catalog_boundary_invalid", boundaryStage: "activity_kind_unsupported",
        bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", activityId: publicationV2Fixture.openResponseId,
        kind: "unsupported-kind", pageId: publicationV2Fixture.pageId,
      },
    },
    {
      name: "activity resources unavailable",
      resolveResource: async () => null,
      expected: {
        code: "native_catalog_boundary_invalid", boundaryStage: "activity_resources_unavailable",
        bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", activityId: publicationV2Fixture.openResponseId,
        kind: "open-response", pageId: publicationV2Fixture.pageId,
      },
    },
    {
      name: "asset component mismatch",
      mutate(sources) { sources.native.assetRows[0].component_slug = "ultimate-b2-workbook"; },
      expected: { code: "native_catalog_boundary_invalid", boundaryStage: "asset_component_mismatch", activityId: publicationV2Fixture.imageId },
    },
    {
      name: "asset activity mismatch",
      mutate(sources) { sources.native.assetRows[0].source_metadata.native_activity_id = publicationV2Fixture.openResponseId; },
      expected: { code: "native_catalog_boundary_invalid", boundaryStage: "asset_activity_mismatch", activityId: publicationV2Fixture.imageId },
    },
  ];

  for (const scenario of cases) {
    const sources = scenario.sources || createPublicationV2FixtureSources();
    scenario.mutate?.(sources);
    const errors = [];
    const handler = createBuilderNativeActivitiesHandler({
      getDatabase: () => studentsBookPageSql(),
      authorize: async () => ({ builderUser: { id: actor } }),
      collectCatalog: async () => sources,
      ...(scenario.resolveAdapter ? { resolveAdapter: scenario.resolveAdapter } : {}),
      ...(scenario.resolveResource ? { resolveResource: scenario.resolveResource } : {}),
      logger: { error(message, fields) { errors.push({ message, fields }); } },
    });
    const response = await handler(request({ method: "GET", path: scenario.path || studentPath }));
    assert.equal(response.statusCode, 500, scenario.name);
    assert.deepEqual(JSON.parse(response.body), { error: "native_activity_request_failed" }, scenario.name);
    assert.deepEqual(errors, [{ message: "Builder native activity request failed", fields: scenario.expected }], scenario.name);
    const serializedDiagnostics = JSON.stringify({ response: response.body, errors });
    assert.doesNotMatch(serializedDiagnostics, new RegExp(publicationV2Fixture.teacherSentinel), scenario.name);
    assert.doesNotMatch(serializedDiagnostics, /"(?:modelAnswers|solution|checksum|object_key)"\s*:/i, scenario.name);
  }
});

test("catalog processing failures retain safe phase and code diagnostics without leaking documents or internals", async () => {
  const catalogPath = "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/catalog";
  const activityContext = {
    bookSlug: "ultimate-b2",
    componentSlug: "ultimate-b2-students-book",
    activityId: publicationV2Fixture.openResponseId,
    kind: "open-response",
    pageId: publicationV2Fixture.pageId,
  };
  const uncodedFailure = () => Object.assign(new Error("SELECT solution, modelAnswers, correctAnswers, mappings, checksum, object_key FROM PRIVATE_SECRET_MARKER"), {
    processingStage: "forged_stage",
    safeContext: { activityId: "forged-activity", solution: "PRIVATE_SECRET_MARKER" },
  });
  const codedFailure = () => Object.assign(uncodedFailure(), { code: "42P01" });
  const baseAdapter = resolveNativeActivityAdapter("ultimate-b2", "ultimate-b2-students-book");
  const cases = [
    {
      name: "uncoded source collection",
      collectCatalog: async () => { throw uncodedFailure(); },
      expected: { code: "native_catalog_processing_failed", processingStage: "source_collection", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" },
    },
    {
      name: "database-coded source collection",
      collectCatalog: async () => { throw codedFailure(); },
      expected: { code: "42P01", processingStage: "source_collection", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" },
    },
    {
      name: "uncoded placement batch load",
      resolveAdapter: () => ({ ...baseAdapter, resolveExistingPlacements: async () => { throw uncodedFailure(); } }),
      expected: { code: "native_catalog_processing_failed", processingStage: "placement_batch_load", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" },
    },
    {
      name: "database-coded placement batch load",
      resolveAdapter: () => ({ ...baseAdapter, resolveExistingPlacements: async () => { throw codedFailure(); } }),
      expected: { code: "42P01", processingStage: "placement_batch_load", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" },
    },
    {
      name: "adapter without batch placement capability",
      resolveAdapter() {
        const adapter = { ...baseAdapter };
        delete adapter.resolveExistingPlacements;
        return adapter;
      },
      expected: { code: "native_catalog_processing_failed", processingStage: "placement_batch_load", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" },
    },
    {
      name: "uncoded catalog asset load",
      prepare(sources) { delete sources.native.assetRows; },
      loadCatalogAssets: async () => { throw uncodedFailure(); },
      expected: { code: "native_catalog_processing_failed", processingStage: "catalog_asset_load", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" },
    },
    {
      name: "database-coded catalog asset load",
      prepare(sources) { delete sources.native.assetRows; },
      loadCatalogAssets: async () => { throw codedFailure(); },
      expected: { code: "42P01", processingStage: "catalog_asset_load", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" },
    },
    {
      name: "readiness assessment",
      resolveKind(kindName) {
        const kind = resolveNativeActivityKind(kindName);
        return kindName === "open-response" ? { ...kind, assessReadiness() { throw uncodedFailure(); } } : kind;
      },
      expected: { code: "native_catalog_processing_failed", processingStage: "readiness_assessment", ...activityContext },
    },
    {
      name: "asset requirement derivation",
      deriveAssetRequirements() { throw uncodedFailure(); },
      expected: { code: "native_catalog_processing_failed", processingStage: "asset_requirement_derivation", ...activityContext },
    },
    {
      name: "residual catalog projection",
      prepare(sources) { delete sources.native.assetRows; },
      loadCatalogAssets: async () => null,
      expected: { code: "native_catalog_processing_failed", processingStage: "catalog_projection", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" },
    },
  ];

  for (const scenario of cases) {
    const sources = createPublicationV2FixtureSources();
    scenario.prepare?.(sources);
    const errors = [];
    const handler = createBuilderNativeActivitiesHandler({
      getDatabase: () => studentsBookPageSql(),
      authorize: async () => ({ builderUser: { id: actor } }),
      collectCatalog: scenario.collectCatalog || (async () => sources),
      ...(scenario.resolveAdapter ? { resolveAdapter: scenario.resolveAdapter } : {}),
      ...(scenario.loadCatalogAssets ? { loadCatalogAssets: scenario.loadCatalogAssets } : {}),
      ...(scenario.resolveKind ? { resolveKind: scenario.resolveKind } : {}),
      ...(scenario.deriveAssetRequirements ? { deriveAssetRequirements: scenario.deriveAssetRequirements } : {}),
      logger: { error(message, fields) { errors.push({ message, fields }); } },
    });
    const response = await handler(request({ method: "GET", path: catalogPath }));
    assert.equal(response.statusCode, 500, scenario.name);
    assert.deepEqual(JSON.parse(response.body), { error: "native_activity_request_failed" }, scenario.name);
    assert.deepEqual(errors, [{ message: "Builder native activity request failed", fields: scenario.expected }], scenario.name);
    const serializedDiagnostics = JSON.stringify({ response: response.body, errors });
    assert.doesNotMatch(serializedDiagnostics, /PRIVATE_SECRET_MARKER|SELECT|solution|modelAnswers|correctAnswers|mappings|checksum|object_key/i, scenario.name);
  }
});

test("unexpected placement SQL failures preserve their safe infrastructure code without boundary or message leakage", async () => {
  const activityId = "ultimate-b2-wb-sql-failure-o1";
  const pageId = "workbook-sql-failure-page";
  const sources = createWorkbookCatalogSources([{ activityId, pageId, sortOrder: 1 }]);
  const databaseFailure = Object.assign(new Error("SELECT private_teacher_payload FROM hidden_table"), {
    code: "57P01",
    boundaryStage: "placement_resolution_failed",
    safeContext: { activityId, teacherDocument: { solution: "PRIVATE ANSWER" } },
  });
  const errors = [];
  const handler = createBuilderNativeActivitiesHandler({
    getDatabase: () => async () => { throw databaseFailure; },
    authorize: async () => ({ builderUser: { id: actor } }),
    collectCatalog: async () => sources,
    logger: { error(message, fields) { errors.push({ message, fields }); } },
  });
  const response = await handler(request({ method: "GET", path: "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-workbook/catalog" }));
  assert.equal(response.statusCode, 500);
  assert.deepEqual(JSON.parse(response.body), { error: "native_activity_request_failed" });
  assert.deepEqual(errors, [{ message: "Builder native activity request failed", fields: {
    code: "57P01", processingStage: "placement_batch_load", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-workbook",
  } }]);
  assert.doesNotMatch(JSON.stringify({ response: response.body, errors }), /private_teacher_payload|hidden_table|PRIVATE ANSWER|placement_resolution_failed/i);
});

test("catalog normalizes supported pre-rich Teacher answer shapes instead of quarantining them", async () => {
  const sources = createPublicationV2FixtureSources();
  const activityId = "ultimate-b2-sb-u1-p1-o95";
  const kind = resolveNativeActivityKind("complete-sentences");
  const publicDocument = kind.createBlankPublic({ activityId, title: "Historical Complete", placement: { pageId: publicationV2Fixture.pageId } });
  const teacherDocument = kind.createBlankTeacher({ activityId });
  let sequence = 1;
  const itemId = addNativeCompleteSentencesItem(publicDocument, teacherDocument, (prefix) => `${prefix}-${String(sequence++).padStart(32, "0")}`);
  publicDocument.parts[0].interaction.items[0].prompt = "This is _____.";
  teacherDocument.parts[0].solution.answers = [{ itemId, text: "historical" }];
  const entry = { activityId, kind: "complete-sentences", placement: { pageId: publicationV2Fixture.pageId }, sortOrder: 5 };
  sources.native.index.payload.activities.push(entry);
  sources.native.index.sha256 = builderDocumentSha256(sources.native.index.payload);
  sources.native.activities[activityId] = {
    index: entry,
    public: { payload: publicDocument, revision: 1, sha256: builderDocumentSha256(publicDocument) },
    teacher: { payload: teacherDocument, revision: 1, sha256: builderDocumentSha256(teacherDocument) },
  };
  assert.ok(sources.native.activities[publicationV2Fixture.openResponseId].teacher.payload.parts[0].solution.modelAnswers.every((answer) => Object.hasOwn(answer, "text")));
  assert.ok(sources.native.activities[publicationV2Fixture.singleChoiceId].teacher.payload.parts[0].solution.correctAnswers.every((answer) => Object.hasOwn(answer, "correctOptionId")));
  assert.ok(sources.native.activities[publicationV2Fixture.dragDropId].teacher.payload.parts[0].solution.mappings.length > 0);
  const handler = createBuilderNativeActivitiesHandler({
    getDatabase: () => studentsBookPageSql(), authorize: async () => ({ builderUser: { id: actor } }), collectCatalog: async () => sources, logger: { error() {} },
  });
  const response = await handler(request({ method: "GET", path: "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/catalog" }));
  assert.equal(response.statusCode, 200, response.body);
  const payload = JSON.parse(response.body);
  assert.equal(payload.invalidActivities, undefined);
  assert.deepEqual(payload.activities.map((activity) => activity.activityId), [...sources.native.index.payload.activities.map((item) => item.activityId)]);
  assert.equal(payload.activities.find((activity) => activity.activityId === activityId).ready, false);
});

test("Students Book catalog keeps a native activity on a tombstoned canonical page as Unassigned", async () => {
  const sources = createPublicationV2FixtureSources();
  const sql = studentsBookPageSql({ rows: [{ stable_key: `ultimate-b2-students-book/pages/${publicationV2Fixture.pageId}`, source_metadata: { is_active: false, is_deleted: true } }] });
  const handler = createBuilderNativeActivitiesHandler({
    getDatabase: () => sql,
    authorize: async () => ({ builderUser: { id: actor } }),
    collectCatalog: async () => sources,
    logger: { error() {} },
  });
  const response = await handler(request({ method: "GET", path: "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/catalog" }));
  assert.equal(response.statusCode, 200, response.body);
  const activities = JSON.parse(response.body).activities;
  assert.ok(activities.length > 0);
  assert.ok(activities.every((activity) => activity.sourcePageId === publicationV2Fixture.pageId && activity.placement.pageId === publicationV2Fixture.pageId));
  assert.ok(activities.every((activity) => activity.assignment.state === "unassigned" && activity.assignment.reason === "page-deleted"));
});

test("Workbook catalog keeps an unavailable historical placement visible beside a valid sibling without exposing Teacher data", async () => {
  const orphanPageId = "workbook-historical-page";
  const activePageId = "workbook-active-page";
  const orphanActivityId = "ultimate-b2-wb-historical-o1";
  const activeActivityId = "ultimate-b2-wb-active-o1";
  const sources = createWorkbookCatalogSources([
    { activityId: orphanActivityId, pageId: orphanPageId, sortOrder: 1 },
    { activityId: activeActivityId, pageId: activePageId, sortOrder: 2 },
  ]);
  const sql = async (_strings, ...values) => values.flat().includes(`ultimate-b2-workbook/pages/${activePageId}`) ? [{
    stable_key: `ultimate-b2-workbook/pages/${activePageId}`,
    sort_order: 2,
    source_metadata: { is_active: true },
    unit_id: "20000000-0000-4000-8000-000000000001",
    unit_number: 1,
    unit_title: "Unit 1",
  }] : [];
  const handler = createBuilderNativeActivitiesHandler({
    getDatabase: () => sql,
    authorize: async () => ({ builderUser: { id: actor } }),
    collectCatalog: async () => sources,
    logger: { error() {} },
  });

  const response = await handler(request({ method: "GET", path: "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-workbook/catalog" }));
  assert.equal(response.statusCode, 200, response.body);
  const payload = JSON.parse(response.body);
  assert.deepEqual(payload.activities.map((activity) => activity.activityId), [orphanActivityId, activeActivityId]);
  const orphan = payload.activities[0];
  assert.equal(orphan.sourcePageId, orphanPageId);
  assert.deepEqual(orphan.placement, { pageId: orphanPageId });
  assert.deepEqual(orphan.assignment, { state: "unassigned", reason: "page-unavailable" });
  assert.deepEqual(payload.activities[1].assignment, { state: "assigned" });
  assert.doesNotMatch(response.body, /solution|modelAnswers/i);
});

test("catalog placement loading remains one batch and never calls the per-entry resolver as Activity count grows", async () => {
  const path = "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-workbook/catalog";
  const baseAdapter = resolveNativeActivityAdapter("ultimate-b2", "ultimate-b2-workbook");
  for (const size of [1, 10, 60, 101]) {
    const entries = Array.from({ length: size }, (_, index) => ({
      activityId: `ultimate-b2-wb-scale-${index + 1}-o1`,
      pageId: `workbook-scale-page-${index + 1}`,
      sortOrder: index + 1,
    }));
    const sources = createWorkbookCatalogSources(entries);
    let batchCalls = 0;
    let perEntryCalls = 0;
    const handler = createBuilderNativeActivitiesHandler({
      getDatabase: () => studentsBookPageSql(),
      authorize: async () => ({ builderUser: { id: actor } }),
      collectCatalog: async () => sources,
      resolveAdapter: () => ({
        ...baseAdapter,
        async resolveExistingPlacements(inputs) {
          batchCalls += 1;
          return new Map(inputs.map(({ pageId }) => [pageId, { pageId, sourcePageId: pageId, assignmentState: "assigned" }]));
        },
        async resolveExistingPlacement() { perEntryCalls += 1; throw new Error("per-entry placement lookup must not run"); },
      }),
      logger: { error() {} },
    });
    const response = await handler(request({ method: "GET", path }));
    assert.equal(response.statusCode, 200, `${size} Activities: ${response.body}`);
    assert.equal(JSON.parse(response.body).activities.length, size);
    assert.equal(batchCalls, 1, `${size} Activities`);
    assert.equal(perEntryCalls, 0, `${size} Activities`);
  }
});

test("a 64-Activity Workbook catalog uses one deduplicated placement SQL query without dropping lifecycle states", async () => {
  const count = 64;
  const entries = Array.from({ length: count }, (_, index) => ({
    activityId: `ultimate-b2-wb-budget-${index + 1}-o1`,
    pageId: `workbook-budget-page-${index + 1}`,
    sortOrder: index + 1,
  }));
  const sources = createWorkbookCatalogSources(entries);
  let placementSqlCalls = 0;
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    if (!/from book_pages page/i.test(query)) return [];
    placementSqlCalls += 1;
    const stableKeys = values.find(Array.isArray) || [];
    return stableKeys.flatMap((stableKey) => {
      const pageNumber = Number(stableKey.match(/-(\d+)$/)?.[1]);
      if (pageNumber % 4 === 3) return [];
      const unavailableUnit = pageNumber % 4 === 2;
      const deleted = pageNumber % 4 === 1;
      return [{
        stable_key: stableKey,
        sort_order: pageNumber,
        source_metadata: { is_active: !deleted, is_deleted: deleted },
        unit_id: unavailableUnit ? null : "20000000-0000-4000-8000-000000000001",
        unit_number: unavailableUnit ? null : 1,
        unit_title: unavailableUnit ? null : "Unit 1",
      }];
    });
  };
  const handler = createBuilderNativeActivitiesHandler({
    getDatabase: () => sql,
    authorize: async () => ({ builderUser: { id: actor } }),
    collectCatalog: async () => sources,
    logger: { error() {} },
  });
  const response = await handler(request({ method: "GET", path: "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-workbook/catalog" }));
  assert.equal(response.statusCode, 200, response.body);
  const payload = JSON.parse(response.body);
  assert.equal(payload.activities.length, count);
  assert.equal(placementSqlCalls, 1);
  assert.equal(payload.activities.filter((activity) => activity.assignment.state === "assigned").length, 16);
  assert.equal(payload.activities.filter((activity) => activity.assignment.reason === "page-deleted").length, 16);
  assert.equal(payload.activities.filter((activity) => activity.assignment.reason === "page-unavailable").length, 32);
  assert.doesNotMatch(response.body, /solution|modelAnswers|correctAnswers|mappings/i);
});

test("a 101-Activity Students Book catalog uses a fixed component, Unit and page read independent of activity count", async () => {
  const adapter = resolveNativeActivityAdapter("ultimate-b2", "ultimate-b2-students-book");
  const entries = Array.from({ length: 101 }, (_, index) => ({
    activityId: `ultimate-b2-sb-budget-o${index + 1}`,
    pageId: canonicalStudentsBookPages[index % canonicalStudentsBookPages.length].id,
    sortOrder: index + 1,
  }));
  const sources = createWorkbookCatalogSources(entries);
  let placementSqlCalls = 0;
  const queries = [];
  const sql = studentsBookPageSql({ onQuery(query) {
    queries.push(query);
    if (/from book_pages page/i.test(query)) placementSqlCalls += 1;
  } });
  const handler = createBuilderNativeActivitiesHandler({
    getDatabase: () => sql,
    authorize: async () => ({ builderUser: { id: actor } }),
    collectCatalog: async () => sources,
    logger: { error() {} },
  });
  const response = await handler(request({ method: "GET", path: "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/catalog" }));
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(JSON.parse(response.body).activities.length, entries.length);
  assert.equal(placementSqlCalls, 1);
  assert.equal(queries.length, 3);
  assert.equal(queries.filter((query) => /from units unit/.test(query)).length, 1);
});

test("catalog fails closed when a Students Book activity is supplied for Workbook", async () => {
  const sources = createPublicationV2FixtureSources();
  const handler = createBuilderNativeActivitiesHandler({
    getDatabase: () => async () => [],
    authorize: async () => ({ builderUser: { id: actor } }),
    collectCatalog: async (_sql, scope) => {
      assert.deepEqual(scope, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-workbook" });
      return sources;
    },
    logger: { error() {} },
  });
  const response = await handler(request({ method: "GET", path: "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-workbook/catalog" }));
  assert.equal(response.statusCode, 500);
  assert.equal(JSON.parse(response.body).error, "native_activity_request_failed");
  assert.doesNotMatch(response.body, new RegExp(publicationV2Fixture.openResponseId));
});

test("an untrusted native index produces only a generic response and a stable safe server code", async () => {
  const errors = [];
  const handler = createBuilderNativeActivitiesHandler({
    getDatabase: () => studentsBookPageSql(), authorize: async () => ({ builderUser: { id: actor } }),
    collectCatalog: async () => { throw Object.assign(new Error("PRIVATE INDEX PAYLOAD"), { code: "native_catalog_index_invalid" }); },
    logger: { error(message, fields) { errors.push({ message, fields }); } },
  });
  const response = await handler(request({ method: "GET", path: "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/catalog" }));
  assert.equal(response.statusCode, 500);
  assert.deepEqual(JSON.parse(response.body), { error: "native_activity_request_failed" });
  assert.doesNotMatch(response.body, /PRIVATE INDEX PAYLOAD/);
  assert.deepEqual(errors, [{ message: "Builder native activity request failed", fields: {
    code: "native_catalog_index_invalid", processingStage: "source_collection", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book",
  } }]);
});

test("a component with no stored native index returns an exact empty catalog without falling back", async () => {
  const handler = createBuilderNativeActivitiesHandler({
    getDatabase: () => async () => [], authorize: async () => ({ builderUser: { id: actor } }),
    collectCatalog: async () => ({ native: { index: null, activities: {}, assetRows: [] } }), logger: { error() {} },
  });
  const response = await handler(request({ method: "GET", path: "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-workbook/catalog" }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { schemaVersion: "1.0", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-workbook", activities: [] });
});

test("B1 and B1+ managed components retain exact empty native catalogs", async () => {
  const handler = createBuilderNativeActivitiesHandler({
    getDatabase: () => async () => [], authorize: async () => ({ builderUser: { id: actor } }),
    collectCatalog: async () => ({ native: { index: null, activities: {}, assetRows: [] } }), logger: { error() {} },
  });
  for (const [bookSlug, componentSlug] of [
    ["ultimate-b1", "ultimate-b1-workbook"],
    ["ultimate-b1-plus", "ultimate-b1-plus-workbook"],
  ]) {
    const response = await handler(request({ method: "GET", path: `/builder/api/native-activities/books/${bookSlug}/components/${componentSlug}/catalog` }));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { schemaVersion: "1.0", bookSlug, componentSlug, activities: [] });
  }
});

test("Workbook lifecycle never treats a Students Book canonical ID as component-local", async () => {
  let mutationCalls = 0;
  const handler = createBuilderNativeActivitiesHandler({
    getDatabase: () => async () => [],
    authorize: async () => ({ builderUser: { id: actor } }),
    loadDocument: async (_sql, resource) => {
      if (resource.documentType === "native_activity_index") return { revision: 1, document: { schemaVersion: "1.0", activities: [] } };
      if (resource.documentType === "activity_lifecycle") return { revision: 1, document: { schemaVersion: "1.0", activities: {} } };
      if (resource.documentType === "hotspots") return { revision: 1, document: resource.baseline() };
      return null;
    },
    mutateLifecycle: async () => { mutationCalls += 1; return { outcome: "retired" }; },
    logger: { error() {} },
  });
  const canonicalId = "ultimate-b2-sb-u1-p1-o4";
  const response = await handler(request({
    path: `/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-workbook/activities/${canonicalId}/retire`,
    body: { sourcePageId: "ultimate-b2-wb-unit-1-page-1", clientMutationId: randomUUID() },
  }));
  assert.equal(response.statusCode, 404);
  assert.equal(mutationCalls, 0);
});

test("Mark the Words handler creates, saves, replays and rejects stale or leaking pairs", async () => {
  const { handler, documents } = harness();
  const creation = request({ body: { kind: "mark-the-words", pageId, title: "Mark the Words", clientMutationId: randomUUID() } });
  const first = await handler(creation); assert.equal(first.statusCode, 200);
  const created = JSON.parse(first.body); assert.equal(JSON.parse((await handler(creation)).body).activityId, created.activityId);
  const pair = generateNativeMarkWordsBulkCandidate({ source: "1. I *watch* my watch.", publicDocument: documents.get(`native_activity_public:${created.activityId}`).document, teacherDocument: documents.get(`native_activity_teacher:${created.activityId}`).document });
  const path = `/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/activities/${created.activityId}/save`;
  const body = { publicDocument: pair.publicDocument, teacherDocument: pair.teacherDocument, expectedPublicRevision: 1, expectedTeacherRevision: 1, clientMutationId: randomUUID() };
  const saved = await handler(request({ path, body })); assert.equal(saved.statusCode, 200, saved.body);
  assert.equal((await handler(request({ path, body }))).statusCode, 200);
  assert.equal((await handler(request({ path, body: { ...body, clientMutationId: randomUUID() } }))).statusCode, 409);
  const leaked = structuredClone(body); leaked.publicDocument.parts[0].interaction.items[0]["CORRECT_WORD_IDS"] = [];
  assert.equal((await handler(request({ path, body: leaked }))).statusCode, 400);
  assert.deepEqual(documents.get(`native_activity_teacher:${created.activityId}`).document, pair.teacherDocument);
});
