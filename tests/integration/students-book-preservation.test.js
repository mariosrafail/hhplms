import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";
import { seedStudentsBookPreservation, captureStudentsBookPreservation, assertStudentsBookDatabasePreserved } from "./_students-book-preservation.mjs";
import { verifyImmutableComponentRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { loadBuilderPages } from "../../netlify-sites/ultimate-b2-builder/server/_builder-pages-store.js";
import { loadProductionMigrationManifest } from "../../scripts/_migration-readiness.mjs";
import { applyProductionMigration } from "../../scripts/_migration-transaction.mjs";
import { seedAllBookPreservation, assertPreservedSyntheticMediaReadable, seedPreservationLearningHistory, assertPreservedLearningReadable, seedPreservationExtrasAndUi } from "./_all-book-preservation.mjs";

const databaseUrl = process.env.TEST_DATABASE_URL || "";
const enabled = Boolean(databaseUrl) && process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";

test("isolated Students Book expansion retains exact authored records and historical releases on upgrade and retry", { skip: !enabled }, async (t) => {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname), "Preservation fixture requires local PostgreSQL");
  const schema = `sb_preservation_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`create schema "${schema}"`);
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  t.after(async () => { await pool.end(); await admin.query(`drop schema "${schema}" cascade`); await admin.end(); });
  await applyCanonicalProductionMigrations(pool, { through: "059_published_assignment_book_locators.sql" });
  const fixture = await seedStudentsBookPreservation(pool);
  const controls = await seedAllBookPreservation(pool, fixture);
  const extrasAndUi = await seedPreservationExtrasAndUi(pool, fixture);
  const uiBytesBefore = Buffer.from(fixture.media.get(extrasAndUi.uiKey));
  const learning = await seedPreservationLearningHistory(pool, fixture, controls);
  await assertPreservedLearningReadable(learning);
  await assertPreservedSyntheticMediaReadable(pool, fixture.media, controls);
  const before = await captureStudentsBookPreservation(pool);
  const migration = (await loadProductionMigrationManifest()).find((entry) => entry.filename === "060_students_book_page_expansion.sql");
  const definitions = async () => (await pool.query("select proname,pg_get_functiondef(oid) definition from pg_proc where pronamespace=current_schema()::regnamespace order by proname,oid")).rows;
  const baselineDefinitions = await definitions();
  const client = await pool.connect();
  try {
    // Failure after the expansion statements proves that function DDL, registry
    // rows and Unit inserts all remain inside the runner-owned transaction.
    await assert.rejects(applyProductionMigration(client, { ...migration, sql: `${migration.sql}\ndo $$ begin raise exception 'injected migration execution failure'; end $$;` }), /injected migration execution failure/);
    assertStudentsBookDatabasePreserved(before, await captureStudentsBookPreservation(pool));
    assert.equal((await pool.query("select to_regclass('builder_students_book_canonical_pages') as relation")).rows[0].relation, null);
    assert.deepEqual(await definitions(), baselineDefinitions);
    // A database trigger fails the real history INSERT, after all migration SQL
    // has executed. No resolver/handler/transaction operation is mocked.
    await pool.query(`create function reject_expansion_history() returns trigger language plpgsql as $$ begin if new.filename='060_students_book_page_expansion.sql' then raise exception 'injected history write failure'; end if; return new; end $$;
      create trigger reject_expansion_history before insert on eduforge_migration_history for each row execute function reject_expansion_history();`);
    await assert.rejects(applyProductionMigration(client, migration), /injected history write failure/);
    assertStudentsBookDatabasePreserved(before, await captureStudentsBookPreservation(pool));
    assert.equal((await pool.query("select to_regclass('builder_students_book_canonical_pages') as relation")).rows[0].relation, null);
    await pool.query("drop trigger reject_expansion_history on eduforge_migration_history; drop function reject_expansion_history();");
    assert.deepEqual(await definitions(), baselineDefinitions);
    assert.equal(await applyProductionMigration(client, migration), "applied");
    assert.equal(await applyProductionMigration(client, migration), "verified");
    await assert.rejects(applyProductionMigration(client, { ...migration, checksum: "0".repeat(64), compatibleChecksums: [] }), /Checksum mismatch/);
  } finally { client.release(); }
  const expanded = await captureStudentsBookPreservation(pool);
  assertStudentsBookDatabasePreserved(before, expanded, { addedUnits: 8, migration });
  assert.equal(expanded.builder_students_book_canonical_pages.length, 110);
  // Repeat canonical runner invocation verifies checksums without executing SQL.
  await applyCanonicalProductionMigrations(pool, { through: "060_students_book_page_expansion.sql" });
  assertStudentsBookDatabasePreserved(expanded, await captureStudentsBookPreservation(pool));
  const sql = async (strings, ...values) => {
    const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
    return (await pool.query(query, values)).rows;
  };
  await loadBuilderPages(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" });
  const release = (await pool.query("select * from book_component_releases where id=$1", [fixture.releaseId])).rows[0];
  verifyImmutableComponentRelease(release);
  const after = await captureStudentsBookPreservation(pool);
  assertStudentsBookDatabasePreserved(expanded, after);
  await assertPreservedSyntheticMediaReadable(pool, fixture.media, controls);
  await assertPreservedLearningReadable(learning);
  assert.deepEqual(fixture.media.get(extrasAndUi.uiKey), uiBytesBefore);
  assertStudentsBookDatabasePreserved(expanded, await captureStudentsBookPreservation(pool));
  const changed = structuredClone(after);
  const document = JSON.parse(changed.builder_component_documents.find((row) => row.includes(fixture.activities[0].index.activityId) && JSON.parse(row).document_type === "native_activity_public"));
  const position = changed.builder_component_documents.findIndex((row) => JSON.parse(row).id === document.id);
  document.payload.metadata.title = "Unacceptable same-count edit";
  changed.builder_component_documents[position] = JSON.stringify(document);
  assert.throws(() => assertStudentsBookDatabasePreserved(expanded, changed), /Preservation failed/);
  const publicationMigration = (await loadProductionMigrationManifest()).find((entry) => entry.filename === "061_students_book_publication_v3.sql");
  await applyCanonicalProductionMigrations(pool);
  const versioned = await captureStudentsBookPreservation(pool);
  assertStudentsBookDatabasePreserved(expanded, versioned, { migration: publicationMigration });
  await assertPreservedSyntheticMediaReadable(pool, fixture.media, controls);
  await assertPreservedLearningReadable(learning);
  await applyCanonicalProductionMigrations(pool);
  assertStudentsBookDatabasePreserved(versioned, await captureStudentsBookPreservation(pool));
  t.diagnostic(`Synthetic preservation: ${fixture.activities.length} Students Book active pairs plus ${controls.reduce((count, control) => count + control.index.length, 0)} in ${controls.length} other components; protected unlinked activities; Unit Extras/Teacher UI; product family and pins; submitted/reviewed Homework; all existing table rows compared`);
});
