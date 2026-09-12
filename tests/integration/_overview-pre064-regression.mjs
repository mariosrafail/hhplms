import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createBuilderProductPublicationHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication.js";
import { createBuilderTeacherUiAssetsHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-teacher-ui-assets.js";
import { overviewUiDatabaseReady } from "../../netlify-sites/ultimate-b2-builder/server/_builder-overview-ui-capability.js";
import { resolveBuilderContentResource } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-registry.js";
import { saveBuilderComponentDocument } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-store.js";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { verifyImmutableComponentRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";
import { checkRuntimeSchemaReadiness } from "../../netlify/functions/_runtime-schema-readiness.js";

// Reuse the existing historical-family fixture. No readiness, compiler, storage
// verification or publication persistence function is mocked here.
export async function verifyOverviewPre064({ pool, sql, actor, storage, families }) {
  const authorize = async () => ({ builderUser: { id: actor } });
  const publication = createBuilderProductPublicationHandler({ getDatabase: () => sql, authorize, storage: () => storage });
  const ui = createBuilderTeacherUiAssetsHandler({ getDatabase: () => sql, authorize, storage: () => storage });
  const event = (path, body) => ({ path, httpMethod: body ? "POST" : "GET", headers: { host: "builder.example", origin: "https://builder.example", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = (response, status = 200) => { assert.equal(response.statusCode, status, response.body); return JSON.parse(response.body); };
  const call = (book, action = "", body) => publication(event(`/builder/api/publication/books/${book}${action ? `/${action}` : ""}`, body));
  const prepare = (book) => call(book, "prepare", { clientMutationId: randomUUID(), releaseNote: "Schema boundary fixture" });
  const publish = (book, id, revision) => call(book, "publish", { productReleaseId: id, expectedHeadRevision: revision, clientMutationId: randomUUID() });
  const tables = ["book_component_releases", "book_product_releases", "book_product_release_members", "book_component_release_asset_pins", "book_component_publication_heads", "book_product_publication_heads", "book_component_publication_events", "book_product_publication_mutations", "builder_component_documents", "builder_component_document_revisions", "builder_teacher_ui_asset_upload_sessions"];
  const capture = async () => Object.fromEntries(await Promise.all(tables.map(async (table) => [table, (await pool.query(`select row_to_json(t)::text value from ${table} t order by row_to_json(t)::text`)).rows])));
  const revision = async (slug) => Number((await pool.query("select revision from builder_component_documents where book_component_id=(select id from book_components where slug=$1) and document_type='teacher_ui'", [slug])).rows[0]?.revision || 0);
  const save = async (book, document) => ui(event(`/builder/api/ui-assets/books/${book}/components/${document.packageId}/save`, { expectedRevision: await revision(document.packageId), clientMutationId: randomUUID(), candidateUploadIds: [], document }));
  const legacyRows = (await pool.query("select * from book_component_releases order by id")).rows;
  const originalBytes = JSON.stringify(legacyRows);
  const verifyHistory = async () => {
    const rows = (await pool.query("select * from book_component_releases where id=any($1::uuid[]) order by id", [legacyRows.map((row) => row.id)])).rows;
    assert.equal(JSON.stringify(rows), originalBytes);
    rows.forEach(verifyImmutableComponentRelease);
  };
  assert.equal(await overviewUiDatabaseReady(sql), false, "test must start on real schema 063");
  assert.equal((await checkRuntimeSchemaReadiness(sql, { cacheTtlMs: 0 })).ready, true, "application authentication schema remains ready on 063");
  for (const { book, id } of families) {
    const slug = `${book}-students-book`;
    const legacy = { schemaVersion: "1.0", packageId: slug, assets: {} };
    const initial = result(await call(book));
    assert.equal(initial.published.id, id, `${book}: historical status remains readable on 063`);
    result(await save(book, legacy));
    const candidate = result(await prepare(book));
    const frozen = (await pool.query("select r.* from book_component_releases r join book_product_release_members m on m.component_release_id=r.id where m.product_release_id=$1 order by r.id", [candidate.productReleaseId])).rows;
    frozen.forEach(verifyImmutableComponentRelease);
    assert.ok(result(await call(book)).releases.some((entry) => entry.id === candidate.productReleaseId));
    const newer = { ...legacy, overviewCaptionFontFamily: "Georgia", independentPartsBackgrounds: true };
    const beforeSave = await capture();
    assert.equal(result(await save(book, newer), 409).error, "publication_ui_schema_unavailable");
    assert.deepEqual(await capture(), beforeSave, "rejected Save changes no document, upload, release or mutation row");
    // Seed future JSON as external test data, bypassing the HTTP Save gate. This
    // exercises PREPARE's independent defense using real collected source data.
    const resource = await resolveBuilderContentResource(book, slug, "ui-controller");
    assert.equal((await saveBuilderComponentDocument(sql, { resource, expectedRevision: await revision(slug), clientMutationId: randomUUID(), document: newer, payloadSha256: builderDocumentSha256(newer), builderUserId: actor })).outcome, "saved");
    const beforePrepare = await capture();
    assert.equal(result(await prepare(book), 409).error, "publication_ui_schema_unavailable");
    assert.deepEqual(await capture(), beforePrepare, "rejected PREPARE creates no partial member, pin, product, head or mutation");
    result(await call(book)); // New draft must not turn GET status into a feature gate.
    assert.equal(result(await publish(book, candidate.productReleaseId, initial.headRevision), 409).error, "stale_release_preview", "legacy PUBLISH uses frozen UI, not new fields in today's draft");
    assert.deepEqual(await capture(), beforePrepare, "stale legacy PUBLISH also leaves all mutation tables unchanged");
    result(await save(book, legacy));
    // Restoring bytes advances the revision: prepare a fresh legacy candidate.
    const restored = result(await prepare(book));
    result(await publish(book, restored.productReleaseId, initial.headRevision));
    assert.equal(result(await call(book)).published.id, restored.productReleaseId);
    const reread = (await pool.query("select r.* from book_component_releases r join book_product_release_members m on m.component_release_id=r.id where m.product_release_id=$1 order by r.id", [candidate.productReleaseId])).rows;
    assert.deepEqual(reread, frozen, "pre-064 v2 releases retain source/projection/hash bytes");
  }
  await verifyHistory();
  const preUpgrade = (await pool.query("select * from book_component_releases order by id")).rows;
  await applyCanonicalProductionMigrations(pool);
  assert.equal(await overviewUiDatabaseReady(sql), true);
  assert.equal((await checkRuntimeSchemaReadiness(sql, { cacheTtlMs: 0 })).ready, true);
  for (const { book } of families) {
    const state = result(await call(book));
    const document = { schemaVersion: "1.0", packageId: `${book}-students-book`, assets: {}, overviewCaptionFontFamily: "Georgia", independentPartsBackgrounds: true };
    result(await save(book, document));
    const prepared = result(await prepare(book));
    result(await publish(book, prepared.productReleaseId, state.headRevision));
    assert.equal(result(await call(book)).published.id, prepared.productReleaseId);
    const rows = (await pool.query("select r.* from book_component_releases r join book_product_release_members m on m.component_release_id=r.id where m.product_release_id=$1 order by m.member_order", [prepared.productReleaseId])).rows;
    rows.forEach(verifyImmutableComponentRelease);
    assert.equal(rows[0].teacher_projection.ui.overviewCaptionFontFamily, "Georgia");
    assert.equal(rows[0].teacher_projection.ui.independentPartsBackgrounds, true);
    assert.equal((await pool.query("select builder_b1_product_integrity($1) valid", [prepared.productReleaseId])).rows[0].valid, true);
  }
  await verifyHistory();
  const preserved = (await pool.query("select * from book_component_releases where id=any($1::uuid[]) order by id", [preUpgrade.map((row) => row.id)])).rows;
  assert.deepEqual(preserved, preUpgrade, "063 v1 and v2 release bytes survive 064 and new publications");
  preserved.forEach(verifyImmutableComponentRelease);
}
