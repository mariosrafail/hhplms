import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createBuilderEditionHandler, editionReadiness } from "../netlify-sites/ultimate-b2-builder/server/_builder-editions.js";
import { readPublishedEdition } from "../netlify/functions/_book-content/edition-read.js";
import { contentEdition } from "../src/data/contentEditions.js";
import { editionFixtureRelease } from "./fixtures/content-editions.js";

const root = "/builder/api/publication/editions/books/ultimate-b2/editions/greek";
const event = (path = "", method = "GET", body = null) => ({ path: root + path, httpMethod: method,
  headers: { host: "localhost:8888", origin: "http://localhost:8888", "content-type": "application/json" }, body: body && JSON.stringify(body) });
test("edition Builder routes preserve authentication, origin and explicit missing-source readiness", async () => {
  const unauthorized = createBuilderEditionHandler({ getDatabase: () => null, authorize: async () => ({ error: { statusCode: 401 } }) });
  assert.equal((await unauthorized(event())).statusCode, 401);
  const status = { edition: contentEdition("ultimate-b2", "greek"), sources: [], associations: {}, releases: [], selectionRevision: 0, headRevision: 0 };
  assert.equal(editionReadiness(status).filter((entry) => !entry.ready).length, 3);
  const handler = createBuilderEditionHandler({ getDatabase: () => null, authorize: async () => ({ builderUser: { id: randomUUID() } }), ready: async () => true,
    status: async () => status, loadRelease: async () => null, mutate: async () => { throw new Error("Must not write"); } });
  assert.equal((await handler(event())).statusCode, 200);
  const request = event("/prepare", "POST", { clientMutationId: randomUUID(), expectedRevision: 0 });
  assert.equal(JSON.parse((await handler(request)).body).error, "edition_required_sources_missing");
  request.headers.origin = "https://foreign.invalid";
  assert.equal((await handler(request)).statusCode, 403);
  assert.equal((await handler({ ...event(), path: root.replace("ultimate-b2", "ultimate-b1") })).statusCode, 409);
  const missingSchema = createBuilderEditionHandler({ getDatabase: () => null, authorize: async () => ({ builderUser: {} }), ready: async () => false });
  assert.equal(JSON.parse((await missingSchema(event())).body).error, "edition_schema_unavailable");
});
test("LMS edition access is additional to book access and cannot be enabled by a UI flag", async () => {
  const release = editionFixtureRelease("greek");
  const query = { bookSlug: "ultimate-b2", editionId: "greek", releaseId: release.id, entitled: true, role: "teacher" };
  const student = { id: randomUUID(), school_id: randomUUID(), role: "student" };
  const denied = { bookAccess: async () => null, ready: async () => true, allowed: async () => false, load: async () => { throw new Error("Must not read"); } };
  assert.equal((await readPublishedEdition(null, student, query, denied)).statusCode, 403);
  assert.equal((await readPublishedEdition(null, student, query, { ...denied, bookAccess: async () => ({ statusCode: 403 }) })).statusCode, 403);
  const allowed = { ...denied, allowed: async () => true, load: async (_sql, context) => { assert.equal(context.publishedOnly, true); return release; } };
  const response = await readPublishedEdition(null, student, query, allowed);
  assert.equal(response.statusCode, 200);
  assert.doesNotMatch(response.body, /PHASE_5_PRIVATE_TEACHER_SENTINEL|teacherProjection|"inputs"/);
  assert.equal((await readPublishedEdition(null, student, { ...query, componentSlug: "ultimate-b2-students-book", teacherActivityId: "any" }, allowed)).statusCode, 403);
  assert.equal((await readPublishedEdition(null, student, { ...query, componentSlug: "ultimate-b2-students-book", teacherAssetActivityId: "any" }, allowed)).statusCode, 403);
  assert.equal((await readPublishedEdition(null, student, query, { ...allowed, ready: async () => false })).statusCode, 403);
});
