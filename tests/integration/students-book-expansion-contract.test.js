import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";
import { applyProductionMigration } from "../../scripts/_migration-transaction.mjs";
import { loadProductionMigrationManifest } from "../../scripts/_migration-readiness.mjs";
import { canonicalStudentsBookPages } from "../../netlify-sites/ultimate-b2-builder/server/_builder-page-catalog.js";
import { loadStudentsBookPageAuthority } from "../../netlify-sites/ultimate-b2-builder/server/_students-book-page-authority.js";
import { prepareBuilderPageUpload, claimBuilderPageUpload, completeBuilderPageUpload } from "../../netlify-sites/ultimate-b2-builder/server/_builder-pages-store.js";
import { createBuilderNativeActivitiesHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activities.js";
import { createBuilderContentHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content.js";
import { studentsBookCurrentNativeActivityAdapter } from "../../netlify-sites/ultimate-b2-builder/server/_students-book-native-activity-adapter.js";
import { seedAllBookPreservation, assertPreservedSyntheticMediaReadable } from "./_all-book-preservation.mjs";

const databaseUrl = process.env.TEST_DATABASE_URL || "";
const enabled = Boolean(databaseUrl) && process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";

test("Students Book expansion rejects conflicting identities and preserves metadata across old/new upload contracts", { skip: !enabled }, async (t) => {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname));
  const schema = `sb_contract_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`create schema "${schema}"`);
  const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  t.after(async () => { await pool.end(); await admin.query(`drop schema "${schema}" cascade`); await admin.end(); });
  await applyCanonicalProductionMigrations(pool, { through: "059_published_assignment_book_locators.sql" });
  const sql = async (strings, ...values) => (await pool.query(strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), values)).rows;
  const preExpansion = await loadStudentsBookPageAuthority(sql);
  assert.equal(preExpansion.pages.length, 110);
  assert.ok(preExpansion.pages.filter((page) => page.unitNumber > 2).every((page) => page.unitId === null));
  assert.equal(preExpansion.units.length, 2); // Read does not bootstrap missing infrastructure.
  const scopeContext = { sql, bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" };
  await assert.rejects(studentsBookCurrentNativeActivityAdapter.normalizePlacement({ pageId: preExpansion.pages.find((page) => page.unitNumber === 3).id }, scopeContext), /infrastructure is unavailable/);
  const component = (await pool.query("select * from book_components where slug='ultimate-b2-students-book'")).rows[0];
  const migration = (await loadProductionMigrationManifest()).find((entry) => entry.filename === "060_students_book_page_expansion.sql");
  assert.equal(migration.filename, "060_students_book_page_expansion.sql");
  const client = await pool.connect();
  try {
    // Separate disposable conflicts; no protected fixture records are mutated.
    const conflict = (await pool.query("insert into units(book_component_id,title,slug,unit_number,sort_order) values($1,'Conflict','unit-3',null,3) returning id", [component.id])).rows[0];
    await assert.rejects(applyProductionMigration(client, migration), /students_book_unit_mapping_conflict/);
    assert.equal((await pool.query("select count(*)::int count from units where book_component_id=$1", [component.id])).rows[0].count, 3);
    assert.equal((await pool.query("select to_regclass('builder_students_book_canonical_pages') relation")).rows[0].relation, null);
    await pool.query("delete from units where id=$1", [conflict.id]);
    const foreign = (await pool.query("select unit.id,unit.book_component_id,component.book_package_id from units unit join book_components component on component.id=unit.book_component_id where component.slug='ultimate-b2-workbook' limit 1")).rows[0];
    const pageConflict = (await pool.query("insert into book_pages(book_package_id,book_component_id,unit_id,stable_key,label,sort_order) values($1,$2,$3,$4,'Collision',1) returning id", [foreign.book_package_id, foreign.book_component_id, foreign.id, canonicalStudentsBookPages[0].stableKey])).rows[0];
    await assert.rejects(applyProductionMigration(client, migration), /students_book_page_unit_conflict/);
    assert.equal((await pool.query("select count(*)::int count from units where book_component_id=$1", [component.id])).rows[0].count, 2);
    await pool.query("delete from book_pages where id=$1", [pageConflict.id]);
    assert.equal(await applyProductionMigration(client, migration), "applied");
  } finally { client.release(); }
  const actor = randomUUID();
  await pool.query("insert into builder_users(id,full_name,email,password_hash) values($1,'Disposable contract actor',$2,'synthetic')", [actor, `${actor}@example.test`]);
  const authority = await loadStudentsBookPageAuthority(sql);
  assert.equal(authority.units.length, 10);
  const page = canonicalStudentsBookPages.find((entry) => entry.unitNumber === 3);
  const makeInput = (overrides = {}) => ({ bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", pageKey: page.stableKey, mode: "replace", expectedRevision: 0, clientMutationId: randomUUID(), uploadId: randomUUID(), requestSha256: "a".repeat(64), pageMetadata: { label: page.label, printedLabel: page.printedLabel, sortOrder: 10, baselineWidth: page.image.width, baselineHeight: page.image.height }, fileDescriptor: { name: "synthetic.png", size: 128, type: "image/png" }, stagingObjectKey: `synthetic/${randomUUID()}`, builderUserId: actor, expiresAt: "2099-01-01T00:00:00Z", ...overrides });
  for (const pageMetadata of [null, {}, [], { label: null, sortOrder: 1 }, { label: "Synthetic", sortOrder: "1" }]) {
    assert.equal((await prepareBuilderPageUpload(sql, makeInput({ pageMetadata }))).outcome, "invalid_page_metadata");
  }
  const input = makeInput();
  assert.equal((await prepareBuilderPageUpload(sql, makeInput({ pageMetadata: { ...input.pageMetadata, baselineWidth: "not-an-int" } }))).outcome, "canonical_dimensions_conflict");
  assert.equal((await prepareBuilderPageUpload(sql, makeInput({ pageMetadata: { ...input.pageMetadata, unitId: authority.units[0].id } }))).outcome, "invalid_unit");
  const foreignUnit = (await pool.query("select unit.id from units unit join book_components component on component.id=unit.book_component_id where component.slug='ultimate-b2-workbook' limit 1")).rows[0].id;
  assert.equal((await prepareBuilderPageUpload(sql, makeInput({ pageMetadata: { ...input.pageMetadata, unitId: foreignUnit } }))).outcome, "invalid_unit");
  assert.equal((await prepareBuilderPageUpload(sql, input)).outcome, "prepared");
  assert.equal((await prepareBuilderPageUpload(sql, input)).outcome, "idempotent");
  assert.equal((await prepareBuilderPageUpload(sql, { ...input, requestSha256: "b".repeat(64) })).outcome, "mutation_id_conflict");
  assert.equal((await claimBuilderPageUpload(sql, { uploadId: input.uploadId, expectedRevision: 0, clientMutationId: input.clientMutationId, builderUserId: actor })).outcome, "claimed");
  const output = { uploadId: input.uploadId, builderUserId: actor, objectKey: "synthetic/canonical.png", storageBucket: "synthetic", mimeType: "image/png", byteSize: 128, checksumSha256: "a".repeat(64), width: page.image.width, height: page.image.height };
  await assert.rejects(completeBuilderPageUpload(sql, { ...output, width: null }), /page upload metadata is invalid/);
  assert.equal((await pool.query("select count(*)::int count from book_pages where stable_key=$1", [page.stableKey])).rows[0].count, 0);
  assert.equal((await completeBuilderPageUpload(sql, output)).outcome, "saved");
  assert.equal((await prepareBuilderPageUpload(sql, makeInput())).outcome, "revision_conflict");
  // Simulate an existing editorial override on a disposable page, then execute
  // an old-style image-only replacement without a Unit UUID.
  await pool.query("update book_pages set label='Editorial title',sort_order=721,source_metadata=source_metadata||'{\"has_metadata_override\":true,\"printed_label\":\"Editorial folio\"}' where stable_key=$1", [page.stableKey]);
  const second = makeInput({ expectedRevision: 1 });
  assert.equal((await prepareBuilderPageUpload(sql, second)).outcome, "prepared");
  assert.equal((await claimBuilderPageUpload(sql, { uploadId: second.uploadId, expectedRevision: 1, clientMutationId: second.clientMutationId, builderUserId: actor })).outcome, "claimed");
  assert.equal((await completeBuilderPageUpload(sql, { ...output, uploadId: second.uploadId })).outcome, "saved");
  const preserved = (await pool.query("select label,sort_order,source_metadata from book_pages where stable_key=$1", [page.stableKey])).rows[0];
  assert.equal(preserved.label, "Editorial title"); assert.equal(preserved.sort_order, 721); assert.equal(preserved.source_metadata.printed_label, "Editorial folio");
  const managedId = `sb-page-${randomUUID().replaceAll("-", "")}`;
  const managed = makeInput({ expectedRevision: 2, mode: "create", pageKey: `ultimate-b2-students-book/pages/${managedId}`, pageMetadata: { label: "Unit 10 synthetic page", printedLabel: "Editorial 110", sortOrder: 900, unitId: authority.units.find((unit) => unit.unit_number === 10).id } });
  assert.equal((await prepareBuilderPageUpload(sql, managed)).outcome, "prepared");
  assert.equal((await claimBuilderPageUpload(sql, { uploadId: managed.uploadId, expectedRevision: 2, clientMutationId: managed.clientMutationId, builderUserId: actor })).outcome, "claimed");
  assert.equal((await completeBuilderPageUpload(sql, { ...output, uploadId: managed.uploadId, objectKey: "synthetic/managed.png", width: 48, height: 64 })).outcome, "saved");
  const authorize = async () => ({ builderUser: { id: actor } });
  const native = createBuilderNativeActivitiesHandler({ getDatabase: () => sql, authorize });
  const content = createBuilderContentHandler({ getDatabase: () => sql, authorize });
  const event = (path, httpMethod = "GET", body = undefined) => ({ path, httpMethod, headers: { host: "builder.example", origin: "https://builder.example", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const contentPath = "/builder/api/content/books/ultimate-b2/components/ultimate-b2-students-book/hotspots";
  const nativePath = "/builder/api/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/create";
  const document = { schemaVersion: "1.0", packageSlug: "ultimate-b2", componentSlug: "students-book", pages: { [canonicalStudentsBookPages[1].id]: [] } };
  for (const [pageId, unitNumber] of [[page.id, 3], [managedId, 10]]) {
    const response = await native(event(nativePath, "POST", { kind: "open-response", pageId, title: "Disposable unified target", clientMutationId: randomUUID() }));
    assert.equal(response.statusCode, 200, response.body);
    const activityId = JSON.parse(response.body).activityId;
    document.pages[pageId] = [{ id: `hotspot-${unitNumber}`, pageId, unitNumber, left: 1.1234567, top: 2.7654321, width: 10.111111, height: 12.123456, label: "  Editorial whitespace  ", actionType: "normalized_activity", activityKey: activityId }];
  }
  const put = (value, expectedRevision) => content(event(contentPath, "PUT", { document: value, expectedRevision, clientMutationId: randomUUID() }));
  const first = await put(document, 0); assert.equal(first.statusCode, 200, first.body);
  const rowsBeforeRead = (await pool.query("select to_jsonb(record) row from builder_component_documents record order by id")).rows;
  const read = await content(event(contentPath)); assert.equal(read.statusCode, 200, read.body);
  assert.deepEqual(JSON.parse(read.body).document, document);
  assert.deepEqual((await pool.query("select to_jsonb(record) row from builder_component_documents record order by id")).rows, rowsBeforeRead);
  const secondSave = await put(JSON.parse(read.body).document, 1); assert.equal(secondSave.statusCode, 200, secondSave.body);
  assert.deepEqual(JSON.parse((await content(event(contentPath))).body).document, document);
  for (const invalid of [
    { ...document, pages: { ...document.pages, [`sb-page-${"f".repeat(32)}`]: [] } },
    { ...document, pages: { ...document.pages, "unknown-canonical-page": [] } },
    { ...document, pages: { ...document.pages, "wb-page-foreign": [] } },
    { ...document, sourceAuthority: "ignore-scoped-authority" },
  ]) assert.equal((await put(invalid, 2)).statusCode, 400);
  const wrongPlacement = structuredClone(document);
  wrongPlacement.pages[managedId][0].activityKey = document.pages[page.id][0].activityKey;
  assert.equal((await put(wrongPlacement, 2)).statusCode, 400);
  assert.equal((await put(document, 1)).statusCode, 409);
  const retained = await studentsBookCurrentNativeActivityAdapter.resolveExistingPlacement({ pageId: `sb-page-${"e".repeat(32)}` }, scopeContext);
  assert.equal(retained.assignmentState, "unassigned"); assert.equal(retained.unassignedReason, "page-unavailable");
  assert.equal(retained.sourcePageId, `sb-page-${"e".repeat(32)}`);
  // New canonical font keys must pass the real SQL pin guard, compiler and
  // release-scoped delivery after expansion; the preservation test uses old keys.
  const media = new Map();
  const controls = await seedAllBookPreservation(pool, { actor, media }, { canonicalFonts: true });
  await assertPreservedSyntheticMediaReadable(pool, media, controls);
});
