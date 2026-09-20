import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { requireSafeDatabase, postgresTemplate } from "../../scripts/_staging-db.mjs";
import { loadProductionMigrationManifest } from "../../scripts/_migration-readiness.mjs";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";
import { contentEdition } from "../../src/data/contentEditions.js";
import { freezeEditionSource, prepareEditionRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-edition-domain.js";
import { mutateEdition, loadEditionStatus, loadEditionRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-edition-store.js";
import { editionFixtureInput } from "../fixtures/content-editions.js";
import { studentsBookUnits } from "../fixtures/students-book-current.js";

const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";
if (process.env.CONTENT_EDITION_BROWSER === "1" && !enabled) throw new Error("Content edition browser gate requires an isolated test database.");
if (process.env.WORDLIST_BROWSER === "1" && !enabled) throw new Error("Word List browser gate requires an isolated test database.");
if (process.env.WORDLIST_CLASSROOM_BROWSER === "1" && !enabled) throw new Error("Word List classroom gate requires an isolated test database.");
if (process.env.OFFLINE_EDITION_ACCEPTANCE === "1" && !enabled) throw new Error("Offline edition acceptance requires an isolated test database.");
test("disposable PostgreSQL isolates edition heads, atomically captures shared revisions and rejects replay/ownership conflicts", { skip: !enabled }, async (t) => {
  const target = requireSafeDatabase("test");
  const schema = `content_editions_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Pool({ connectionString: target.connectionString, max: 1 });
  await admin.query(`create schema "${schema}"`);
  const scoped = new URL(target.connectionString); scoped.searchParams.set("options", `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: scoped.toString(), max: 4 });
  t.after(async () => { await pool.end(); await admin.query(`drop schema "${schema}" cascade`); await admin.end(); });
  if (process.env.WORDLIST_CLASSROOM_BROWSER === "1" || process.env.OFFLINE_EDITION_ACCEPTANCE === "1") {
    await applyCanonicalProductionMigrations(pool);
  } else {
    for (const migration of await loadProductionMigrationManifest()) await pool.query(migration.sql);
  }
  const actor = randomUUID();
  await pool.query("insert into builder_users(id,full_name,email,password_hash) values($1,'Edition fixture','editions@example.test','unused')", [actor]);
  const sql = postgresTemplate(pool);
  const packageId = (await pool.query("select id from book_packages where slug='ultimate-b2'")).rows[0].id;
  const assetEditionId = (await pool.query("insert into book_editions(book_package_id,edition_identifier) values($1,'edition-fixture-assets') returning id", [packageId])).rows[0].id;
  const sourceInput = (component, scope) => {
    const input = editionFixtureInput(component, scope);
    if (component === "students-book") input.inputs = { pages: { revision: 0, units: structuredClone(studentsBookUnits), rows: [] },
      documents: {}, native: { index: null, activities: {}, assetRows: [] }, unitExtras: { document: null, assetRows: [] } };
    return input;
  };
  const sourceRecords = [sourceInput("students-book", "shared"), sourceInput("workbook", "shared"),
    sourceInput("grammar-book", "international"), sourceInput("grammar-book", "greek")].map(freezeEditionSource);
  for (const record of sourceRecords) {
    for (const row of record.source.inputs.pages.rows) {
      await pool.query(`insert into book_assets(id,book_package_id,edition_id,book_component_id,stable_logical_key,asset_role,
        object_key,storage_profile,storage_bucket,mime_type,byte_size,checksum_sha256,width,height,edition_identifier,version,publication_status,access_level)
        select $1,$2,$3,id,$4,'page_image',$5,'private',$6,'image/png',$10,$7,$8,1,'edition-fixture-assets','v1','draft','internal'
        from book_components where book_package_id=$2 and slug=$9`,
      [row.asset_id, packageId, assetEditionId, `ultimate-b2.edition-fixture.${row.asset_id}`, row.object_key, row.storage_bucket, row.checksum_sha256, row.width, record.reference.componentSlug, row.byte_size]);
    }
  }
  const saveRequest = (record, editionId = record.reference.scope.editionIds[0]) => ({ operation: "save-source", bookSlug: "ultimate-b2", editionId,
    sourceId: record.reference.sourceId, componentSlug: record.reference.componentSlug, expectedRevision: record.reference.revision - 1,
    record, assetIds: record.source.inputs.pages.rows.map((row) => row.asset_id) });
  for (const record of sourceRecords) {
    const mutationId = randomUUID(); const request = saveRequest(record);
    assert.equal((await mutateEdition(sql, actor, mutationId, request)).outcome, "saved");
    assert.equal((await mutateEdition(sql, actor, mutationId, request)).replayed, true);
    assert.equal((await mutateEdition(sql, actor, mutationId, { ...request, editionId: "greek" })).outcome,
      request.editionId === "greek" ? "saved" : "mutation_id_conflict");
  }
  const associate = (editionId, record, expectedRevision) => mutateEdition(sql, actor, randomUUID(), {
    operation: "associate", bookSlug: "ultimate-b2", editionId, sourceId: record.reference.sourceId,
    componentSlug: record.reference.componentSlug, expectedRevision,
  });
  assert.equal((await associate("international", sourceRecords[3], 0)).outcome, "edition_source_owner_mismatch");
  const releases = {};
  for (const editionId of ["international", "greek"]) {
    const sources = [sourceRecords[0], sourceRecords[1], sourceRecords[editionId === "greek" ? 3 : 2]];
    for (const [index, record] of sources.entries()) assert.equal((await associate(editionId, record, index)).outcome, "associated");
    const status = await loadEditionStatus(sql, "ultimate-b2", editionId);
    assert.equal(status.selectionRevision, 3);
    const release = prepareEditionRelease({ id: randomUUID(), number: 1, edition: contentEdition("ultimate-b2", editionId), sources });
    const prepareRequest = { operation: "prepare", bookSlug: "ultimate-b2", editionId, expectedRevision: 3, release };
    const prepareId = randomUUID();
    assert.equal((await mutateEdition(sql, actor, prepareId, prepareRequest)).outcome, "prepared");
    assert.equal((await mutateEdition(sql, actor, prepareId, prepareRequest)).replayed, true);
    assert.equal((await mutateEdition(sql, actor, prepareId, { ...prepareRequest, editionId: editionId === "greek" ? "international" : "greek" })).outcome, "mutation_id_conflict");
    assert.equal((await mutateEdition(sql, actor, randomUUID(), { operation: "publish", bookSlug: "ultimate-b2", editionId, expectedRevision: 0, releaseId: release.id })).outcome, "published");
    assert.deepEqual(await loadEditionRelease(sql, { bookSlug: "ultimate-b2", editionId, releaseId: release.id, publishedOnly: true }), release);
    releases[editionId] = release;
  }
  assert.equal(await loadEditionRelease(sql, { bookSlug: "ultimate-b2", editionId: "international", releaseId: releases.greek.id }), null);
  assert.equal((await mutateEdition(sql, actor, randomUUID(), { operation: "publish", bookSlug: "ultimate-b2", editionId: "international", expectedRevision: 1, releaseId: releases.greek.id })).outcome, "edition_release_context_mismatch");
  const changed = structuredClone(sourceRecords[1].source);
  changed.revision++; changed.inputs.pages.revision++; changed.inputs.pages.rows[0].label = "Shared future revision";
  assert.equal((await mutateEdition(sql, actor, randomUUID(), saveRequest(freezeEditionSource(changed)))).outcome, "saved");
  for (const editionId of ["international", "greek"]) {
    const status = await loadEditionStatus(sql, "ultimate-b2", editionId);
    assert.equal(status.publishedReleaseId, releases[editionId].id);
    assert.equal(status.sources.find((entry) => entry.reference.componentSlug.endsWith("workbook")).reference.revision, 2);
    assert.deepEqual(await loadEditionRelease(sql, { bookSlug: "ultimate-b2", editionId, releaseId: releases[editionId].id }), releases[editionId]);
  }
  assert.equal((await pool.query("select count(*)::int count from book_content_edition_access")).rows[0].count, 0);
  assert.equal((await pool.query("select count(*)::int count from book_product_publication_heads")).rows[0].count, 0);
  assert.equal((await pool.query("select count(*)::int count from book_component_publication_heads")).rows[0].count, 0);
  await assert.rejects(pool.query("update book_content_source_revisions set record='{}' where source_id=$1", [sourceRecords[0].reference.sourceId]), /edition_immutable_record/);
  await assert.rejects(pool.query("delete from book_content_edition_releases where id=$1", [releases.greek.id]), /edition_immutable_record/);
  const { editionNegativePersistence } = await import("./_content-edition-negative.mjs");
  await editionNegativePersistence({ pool, sql, actor, packageId, sources: sourceRecords, releases, saveRequest });
  const { exerciseWordListPersistence } = await import("./_wordlists-persistence.mjs");
  await exerciseWordListPersistence({ pool, sql, actor, packageId });
  if (process.env.CONTENT_EDITION_BROWSER === "1") {
    const { exerciseContentEditionBrowser } = await import("./_content-editions-browser.mjs");
    await exerciseContentEditionBrowser({ sql, pool, actor });
  }
});
