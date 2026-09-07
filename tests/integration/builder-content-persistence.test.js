import { createBuilderNativeActivitiesHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activities.js";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import pg from "pg";

import { createBuilderContentHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content.js";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";

const { Pool } = pg;
const testDatabaseUrl = process.env.TEST_DATABASE_URL || "";
const enabled = Boolean(testDatabaseUrl) && process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";
const builderUserId = "10000000-0000-4000-8000-000000000001";
const route = "/builder/api/content/books/ultimate-b2/components/ultimate-b2-students-book/hotspots";
const openResponseActivityId = "ultimate-b2-sb-u1-p1-o1";
const openResponseRoute = `/builder/api/content/books/ultimate-b2/components/ultimate-b2-students-book/open-response/${openResponseActivityId}`;

function scoped(base, schema) {
  const url = new URL(base);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

function tag(pool) {
  return async (strings, ...values) => {
    let text = strings[0];
    for (let index = 0; index < values.length; index += 1) text += `$${index + 1}${strings[index + 1]}`;
    return (await pool.query(text, values)).rows;
  };
}

function event(method = "GET", body = null, path = route) {
  return {
    httpMethod: method,
    path,
    headers: { host: "localhost:8888", origin: "http://localhost:8888", "content-type": "application/json" },
    body: body === null ? "" : JSON.stringify(body),
  };
}

test("isolated PostgreSQL persists current state, strict history, idempotency, concurrency, and audit atomically", { skip: !enabled }, async (t) => {
  const schema = `builder_content_${randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString: testDatabaseUrl, max: 1 });
  await admin.query(`create schema "${schema}"`);
  const pool = new Pool({ connectionString: scoped(testDatabaseUrl, schema), max: 2 });
  t.after(async () => {
    await pool.end();
    await admin.query(`drop schema if exists "${schema}" cascade`);
    await admin.end();
  });
  const migrations = await applyCanonicalProductionMigrations(pool);
  assert.ok(migrations.some(({ filename }) => filename === "032_builder_component_authoring.sql"));
  await pool.query(`
    insert into builder_users(id,full_name,email,password_hash)
    values($1,'Builder Integration','builder-integration@example.test','not-a-real-login-hash')
  `, [builderUserId]);

  const sql = tag(pool);
  const handler = createBuilderContentHandler({
    getDatabase: () => sql,
    authorize: async () => ({ builderUser: { id: builderUserId, role: "developer", status: "active" } }),
  });
  const initial = JSON.parse((await handler(event())).body);
  assert.equal(initial.revision, 0);
  assert.deepEqual(initial.document.pages, {});
  const pageId = "ub2-sb-unit-1-part-1";
  const native = createBuilderNativeActivitiesHandler({ getDatabase: () => sql, authorize: async () => ({ builderUser: { id: builderUserId } }) });
  const created = await native(event("POST", { kind: "open-response", pageId, title: "Current native persistence target", clientMutationId: "10000000-0000-4000-8000-000000000099" }, "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/create"));
  assert.equal(created.statusCode, 200, created.body);
  const nativeBefore = (await pool.query("select * from builder_component_documents where document_type like 'native_%' order by id")).rows;
  initial.document.pages[pageId] = [{ id: "integration-native-hotspot", pageId, unitNumber: 1, pageNumber: 5, left: 1, top: 2, width: 10, height: 12, label: "Integration revision one", actionType: "normalized_activity", activityKey: JSON.parse(created.body).activityId }];
  const mutationOne = "10000000-0000-4000-8000-000000000011";
  const firstBody = { expectedRevision: 0, clientMutationId: mutationOne, document: initial.document };
  const first = await handler(event("PUT", firstBody));
  assert.equal(first.statusCode, 200);
  assert.equal(JSON.parse(first.body).revision, 1);

  const replay = await handler(event("PUT", firstBody));
  assert.equal(replay.statusCode, 200);
  assert.equal(JSON.parse(replay.body).idempotent, true);

  const changedReuse = structuredClone(initial.document);
  changedReuse.pages[pageId][0].label = "Wrong mutation reuse";
  assert.equal((await handler(event("PUT", { ...firstBody, document: changedReuse }))).statusCode, 409);

  const secondDocument = structuredClone(initial.document);
  secondDocument.pages[pageId][0].label = "Integration revision two";
  const second = await handler(event("PUT", {
    expectedRevision: 1,
    clientMutationId: "10000000-0000-4000-8000-000000000012",
    document: secondDocument,
  }));
  assert.equal(JSON.parse(second.body).revision, 2);

  const stale = await handler(event("PUT", {
    expectedRevision: 1,
    clientMutationId: "10000000-0000-4000-8000-000000000013",
    document: initial.document,
  }));
  assert.equal(stale.statusCode, 409);
  assert.equal(JSON.parse(stale.body).currentRevision, 2);

  const counts = await pool.query(`
    select
      (select count(*)::int from builder_component_documents where document_type='hotspots') documents,
      (select count(*)::int from builder_component_document_revisions revision join builder_component_documents document on document.id=revision.document_id where document.document_type='hotspots') revisions,
      (select count(*)::int from builder_audit_log where action='builder_document_saved' and metadata->>'document_type'='hotspots') audits
  `);
  assert.deepEqual(counts.rows[0], { documents: 1, revisions: 2, audits: 2 });
  const state = await pool.query("select revision,payload,updated_by_builder_user_id from builder_component_documents where document_type='hotspots'");
  assert.equal(Number(state.rows[0].revision), 2);
  assert.equal(state.rows[0].payload.pages[pageId][0].label, "Integration revision two");
  assert.equal(state.rows[0].updated_by_builder_user_id, builderUserId);
  await assert.rejects(pool.query("update builder_component_document_revisions set revision=3"), /append-only/);

  const openResponseBaseline = JSON.parse((await handler(event("GET", null, openResponseRoute))).body);
  assert.equal(openResponseBaseline.revision, 0);
  assert.equal(openResponseBaseline.document.activityId, openResponseActivityId);
  openResponseBaseline.document.questions[0].prompt = "Database-backed hosted prompt";
  const openResponseSave = await handler(event("PUT", {
    expectedRevision: 0,
    clientMutationId: "10000000-0000-4000-8000-000000000021",
    document: openResponseBaseline.document,
  }, openResponseRoute));
  assert.equal(openResponseSave.statusCode, 200);
  assert.equal(JSON.parse(openResponseSave.body).revision, 1);
  assert.deepEqual((await pool.query("select * from builder_component_documents where document_type like 'native_%' order by id")).rows, nativeBefore);
  const identities = await pool.query("select document_type,document_key,revision from builder_component_documents where document_type in ('hotspots','open_response') order by document_type,document_key");
  assert.deepEqual(identities.rows.map((row) => ({ ...row, revision: Number(row.revision) })), [
    { document_type: "hotspots", document_key: "default", revision: 2 },
    { document_type: "open_response", document_key: openResponseActivityId, revision: 1 },
  ]);
});
