import assert from "node:assert/strict";
import test from "node:test";
import { publishedBookReadModel } from "../netlify/functions/_book-content/published-book-model.js";
import { verifyUltimateB2ManagedComponentRelease } from "../netlify-sites/ultimate-b2-builder/server/_builder-managed-publication-compiler.js";
import { builderDocumentSha256 } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { managedPageRouteIds, publishedManagedBookFixture, workbookOrderingLayout } from "./fixtures/published-managed-book.js";
import { compilePublicationV2Fixture } from "./fixtures/publication-v2.js";
import { compileStudentsBookReleaseV3 } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v3.js";
import { studentsBookV3Sources, studentsBookV3ReleaseRow } from "./fixtures/students-book-publication-v3.js";
import { canonicalStudentsBookPages } from "../netlify-sites/ultimate-b2-builder/server/_builder-page-catalog.js";

async function fixture(options = {}) {
  const ids = await managedPageRouteIds("ultimate-b2-workbook", workbookOrderingLayout.length);
  const compiled = publishedManagedBookFixture("ultimate-b2-workbook", { pageIds: ids, pageLayout: workbookOrderingLayout, ...options });
  const row = { id: "50000000-0000-4000-8000-000000000001", release_number: 1,
    compiler_id: compiled.compilerId, release_schema_version: compiled.releaseSchemaVersion,
    runtime_compatibility_sha256: compiled.compatibility, source_snapshot: compiled.sourceSnapshot,
    source_snapshot_sha256: compiled.sourceSnapshotSha256, public_projection: compiled.publicProjection,
    public_projection_sha256: compiled.publicProjectionSha256, teacher_projection: compiled.teacherProjection,
    teacher_projection_sha256: compiled.teacherProjectionSha256, asset_manifest: compiled.assetManifest, release_sha256: compiled.releaseSha256 };
  const verified = verifyUltimateB2ManagedComponentRelease(row, "ultimate-b2-workbook");
  return { ids, row, compiled, projection: verified.publicProjection };
}

test("Workbook groups overlapping page positions by canonical Unit order without changing immutable content", async () => {
  const { ids, row, projection } = await fixture();
  const before = structuredClone(projection);
  const book = publishedBookReadModel(row, projection);
  assert.deepEqual(book.pages.map((page) => page.id), ids);
  assert.deepEqual(book.pages.map((page) => page.unitId), ["unit-1", "unit-1", "unit-2", "unit-2", "unit-3", "unit-3"]);
  assert.deepEqual(book.pages.map((page) => page.sortOrder), [20, 40, 10, 20, 5, 5]);
  assert.deepEqual(projection, before);
  assert.equal(builderDocumentSha256(projection), row.public_projection_sha256);
  assert.doesNotThrow(() => verifyUltimateB2ManagedComponentRelease(row, "ultimate-b2-workbook"));
});

test("Workbook Unit sortOrder wins over Unit number, slug, title and projection array order", async () => {
  const { ids, row, projection } = await fixture({ unitSortOrders: { 1: 30, 2: 10, 3: 20 } });
  assert.deepEqual(publishedBookReadModel(row, projection).pages.map((page) => page.id), [ids[2], ids[3], ids[4], ids[5], ids[0], ids[1]]);
});

test("Workbook uses stable page identity for equal page positions and canonical Unit tie ordering", async () => {
  const generated = await managedPageRouteIds("ultimate-b2-workbook", workbookOrderingLayout.length);
  const pageIds = [...generated.slice(0, 4), generated[5], generated[4]];
  const { row, projection } = await fixture({ pageIds, unitSortOrders: { 1: 1, 2: 1 } });
  const before = structuredClone(projection);
  assert.deepEqual(publishedBookReadModel(row, projection).pages.map((page) => page.id), generated);
  assert.deepEqual(projection, before);
});

test("Workbook page positions win over source array order and page identity within a Unit", async () => {
  const pageLayout = workbookOrderingLayout.map((page, index) => ({ ...page, sortOrder: index === 0 ? 40 : index === 1 ? 20 : page.sortOrder }));
  const { ids, row, projection } = await fixture({ pageLayout });
  assert.deepEqual(publishedBookReadModel(row, projection).pages.map((page) => page.id), [ids[1], ids[0], ...ids.slice(2)]);
});

test("Workbook cannot invent canonical Unit ownership for a page", async () => {
  const { row, projection } = await fixture();
  projection.pages[0].unitId = "50000000-0000-4000-8000-000000000099";
  assert.throws(() => publishedBookReadModel(row, projection), /publication_page_unit_mismatch/);
});

test("Students Book historical and v3 read models retain their existing page ordering", () => {
  const legacy = compilePublicationV2Fixture();
  const legacyBook = publishedBookReadModel({ id: "legacy", release_number: 1 }, legacy.publicProjection);
  const active = new Set(legacy.publicProjection.activePageIds);
  assert.deepEqual(legacyBook.pages.map((page) => page.id), canonicalStudentsBookPages.filter((page) => active.has(page.id)).sort((a, b) => a.sortOrder - b.sortOrder).map((page) => page.id));
  const compiled = compileStudentsBookReleaseV3(studentsBookV3Sources());
  const row = studentsBookV3ReleaseRow(compiled);
  const before = structuredClone(compiled.publicProjection);
  assert.deepEqual(publishedBookReadModel(row, compiled.publicProjection).pages.map((page) => page.id), [...compiled.publicProjection.pages].sort((a, b) => a.sortOrder - b.sortOrder).map((page) => page.id));
  assert.deepEqual(compiled.publicProjection, before);
});
