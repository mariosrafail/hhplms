import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createBuilderNativeActivitiesHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activities.js";
import { createBuilderTeacherUiAssetsHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-teacher-ui-assets.js";
import { createBuilderProductPublicationHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication.js";
import { overviewFontDatabaseReady } from "../../netlify-sites/ultimate-b2-builder/server/_builder-overview-font.js";
import { verifyImmutableComponentRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { resolveBuilderContentResource } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-registry.js";
import { saveBuilderComponentDocument } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-store.js";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { checkRuntimeSchemaReadiness } from "../../netlify/functions/_runtime-schema-readiness.js";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";

export async function verifyOverviewPre065({ pool, sql, actor, storage: pageStorage, families }) {
  const fonts = new Map();
  const bytes = Buffer.from(await readFile(new URL("../fixtures/fonts/Ahem.ttf.base64", import.meta.url), "utf8"), "base64");
  const storage = { ...pageStorage,
    upload: async (input) => input.contentType === "font/ttf" ? fonts.set(input.objectKey, Buffer.from(input.body)) : pageStorage.upload(input),
    download: async (input) => fonts.get(input.objectKey) || pageStorage.download(input),
    head: async (input) => fonts.has(input.objectKey) ? { byteSize: fonts.get(input.objectKey).length, contentType: "font/ttf", checksumSha256: createHash("sha256").update(fonts.get(input.objectKey)).digest("hex") } : pageStorage.head(input),
    delete: async (input) => fonts.has(input.objectKey) ? fonts.delete(input.objectKey) : pageStorage.delete(input),
  };
  const dependencies = { getDatabase: () => sql, authorize: async () => ({ builderUser: { id: actor } }), storage: () => storage };
  const native = createBuilderNativeActivitiesHandler(dependencies), uiHandler = createBuilderTeacherUiAssetsHandler(dependencies), publication = createBuilderProductPublicationHandler(dependencies);
  const event = (path, body) => ({ path, httpMethod: body ? "POST" : "GET", headers: { host: "builder.example", origin: "https://builder.example", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = (response, status = 200) => { assert.equal(response.statusCode, status, response.body); return JSON.parse(response.body); };
  const pub = (book, action = "", body) => publication(event(`/builder/api/publication/books/${book}${action ? `/${action}` : ""}`, body));
  const prepare = (book) => pub(book, "prepare", { clientMutationId: randomUUID(), releaseNote: "Managed overview font regression" });
  const publish = (book, id, revision) => pub(book, "publish", { productReleaseId: id, expectedHeadRevision: revision, clientMutationId: randomUUID() });
  const revision = async (slug) => Number((await pool.query("select revision from builder_component_documents where book_component_id=(select id from book_components where slug=$1) and document_type='teacher_ui'", [slug])).rows[0]?.revision || 0);
  const save = async (book, document) => uiHandler(event(`/builder/api/ui-assets/books/${book}/components/${document.packageId}/save`, { expectedRevision: await revision(document.packageId), clientMutationId: randomUUID(), candidateUploadIds: [], document }));
  const mutationTables = ["builder_component_documents", "builder_component_document_revisions", "book_component_releases", "book_product_releases", "book_product_release_members", "book_component_release_asset_pins", "book_component_publication_heads", "book_product_publication_heads", "book_component_publication_events", "book_product_publication_mutations", "builder_teacher_ui_asset_upload_sessions", "builder_audit_log"];
  const capture = async () => Object.fromEntries(await Promise.all(mutationTables.map(async (table) => [table, (await pool.query(`select row_to_json(t)::text value from ${table} t order by row_to_json(t)::text`)).rows])));
  assert.equal(await overviewFontDatabaseReady(sql), false, "must start against actual schema 064");
  assert.equal((await checkRuntimeSchemaReadiness(sql, { cacheTtlMs: 0 })).ready, true);
  const inputs = [];
  for (const { book } of families) {
    const slug = `${book}-students-book`, fontRoot = `/builder/api/native-activities/books/${book}/components/${slug}/fonts`;
    const clientMutationId = randomUUID();
    const upload = result(await native(event(`${fontRoot}/prepare`, { name: "Ahem.ttf", size: bytes.length, type: "font/ttf", clientMutationId })));
    const session = (await pool.query("select staging_object_key from builder_font_upload_sessions where id=$1", [upload.uploadId])).rows[0]; fonts.set(session.staging_object_key, bytes);
    const { font } = result(await native(event(`${fontRoot}/finalize`, { uploadId: upload.uploadId, clientMutationId })));
    assert.equal(result(await native(event(fontRoot))).fonts[0].assetId, font.assetId);
    const reference = { assetId: font.assetId, checksumSha256: font.checksumSha256, role: font.role, slot: font.slot };
    const legacy = { schemaVersion: "1.0", packageId: slug, overviewCaptionFontFamily: "Georgia", assets: {} };
    const managed = { schemaVersion: "1.0", packageId: slug, overviewCaptionFontAsset: reference, assets: {} };
    assert.equal((await pool.query("select builder_b1_ui_projection_integrity($1::jsonb,$2) valid", [JSON.stringify(managed), slug])).rows[0].valid, false);
    const initial = result(await pub(book)); result(await save(book, legacy));
    const before = await capture(); assert.equal(result(await save(book, managed), 409).error, "overview_font_schema_unavailable"); assert.deepEqual(await capture(), before);
    const candidate = result(await prepare(book));
    const resource = await resolveBuilderContentResource(book, slug, "ui-controller");
    assert.equal((await saveBuilderComponentDocument(sql, { resource, expectedRevision: await revision(slug), clientMutationId: randomUUID(), document: managed, payloadSha256: builderDocumentSha256(managed), builderUserId: actor })).outcome, "saved");
    const beforePrepare = await capture();
    assert.equal(result(await prepare(book), 409).error, "overview_font_schema_unavailable"); assert.deepEqual(await capture(), beforePrepare);
    result(await pub(book));
    assert.equal(result(await publish(book, candidate.productReleaseId, initial.headRevision), 409).error, "stale_release_preview", "PUBLISH uses immutable legacy content, not the managed draft");
    result(await save(book, legacy)); const restored = result(await prepare(book)); result(await publish(book, restored.productReleaseId, initial.headRevision));
    inputs.push({ book, managed, font });
  }
  const historical = (await pool.query("select * from book_component_releases order by id")).rows;
  await applyCanonicalProductionMigrations(pool);
  assert.equal(await overviewFontDatabaseReady(sql), true);
  assert.equal((await checkRuntimeSchemaReadiness(sql, { cacheTtlMs: 0 })).ready, true);
  for (const { book, managed, font } of inputs) {
    assert.equal((await pool.query("select builder_b1_ui_projection_integrity($1::jsonb,$2) valid", [JSON.stringify(managed), managed.packageId])).rows[0].valid, true);
    for (const invalid of [null, {}, { ...managed.overviewCaptionFontAsset, slot: "arbitrary" }, { ...managed.overviewCaptionFontAsset, role: "activity_artwork" }, { ...managed.overviewCaptionFontAsset, checksumSha256: "bad" }, { ...managed.overviewCaptionFontAsset, url: "https://invalid.test" }]) {
      assert.equal((await pool.query("select builder_b1_ui_projection_integrity($1::jsonb,$2) valid", [JSON.stringify({ ...managed, overviewCaptionFontAsset: invalid }), managed.packageId])).rows[0].valid, false);
    }
    const initial = result(await pub(book));
    const forged = { ...managed, overviewCaptionFontAsset: inputs.find((entry) => entry.book !== book).managed.overviewCaptionFontAsset };
    assert.equal(result(await save(book, forged), 400).error, "invalid_overview_font_reference");
    result(await save(book, managed));
    const prepared = result(await prepare(book)); result(await publish(book, prepared.productReleaseId, initial.headRevision));
    const release = (await pool.query("select r.* from book_component_releases r join book_product_release_members m on m.component_release_id=r.id where m.product_release_id=$1 and r.teacher_projection ? 'ui'", [prepared.productReleaseId])).rows[0];
    verifyImmutableComponentRelease(release);
    assert.deepEqual(release.teacher_projection.ui.overviewCaptionFontAsset, managed.overviewCaptionFontAsset);
    assert.equal(release.public_projection.assets.some((asset) => asset.sha256 === font.checksumSha256), false);
    const pins = (await pool.query("select * from book_component_release_asset_pins where component_release_id=$1 and asset_role='activity_font'", [release.id])).rows;
    assert.equal(pins.length, 1); assert.equal(pins[0].book_asset_id, font.assetId);
    assert.equal((await pool.query("select builder_b1_product_integrity($1) valid", [prepared.productReleaseId])).rows[0].valid, true);
  }
  const reread = (await pool.query("select * from book_component_releases where id=any($1::uuid[]) order by id", [historical.map((entry) => entry.id)])).rows;
  assert.deepEqual(reread, historical); reread.forEach(verifyImmutableComponentRelease);
}
