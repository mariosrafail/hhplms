import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublicationCompiler } from '../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js';
import { findProductComponent } from '../src/data/bookProductCatalog.js';
import { managedPageRouteIds, publishedManagedBookFixture } from './fixtures/published-managed-book.js';
import { verifyImmutableComponentRelease } from '../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js';
import { builderDocumentSha256 } from '../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js';
import { workbookOrderingLayout } from './fixtures/published-managed-book.js';

const row = (compiled) => ({ compiler_id: compiled.compilerId, release_schema_version: compiled.releaseSchemaVersion,
  runtime_compatibility_sha256: compiled.compatibility, source_snapshot: compiled.sourceSnapshot, source_snapshot_sha256: compiled.sourceSnapshotSha256,
  public_projection: compiled.publicProjection, public_projection_sha256: compiled.publicProjectionSha256,
  teacher_projection: compiled.teacherProjection, teacher_projection_sha256: compiled.teacherProjectionSha256,
  asset_manifest: compiled.assetManifest, release_sha256: compiled.releaseSha256 });

for (const book of ['ultimate-b1', 'ultimate-b1-plus']) {
  for (const suffix of ['students-book', 'workbook']) {
    const component = `${book}-${suffix}`;
    test(`${component} has an explicitly registered managed publication compiler`, () => {
      const compiler = resolvePublicationCompiler(`${component}-v1`, '1.0');
      assert.ok(compiler);
      assert.equal(findProductComponent(book, component).publication.compilerId, `${component}-v${suffix === 'students-book' ? 2 : 1}`);
      assert.equal(resolvePublicationCompiler(`${component}-v1`, '3.0'), null);
      assert.throws(() => compiler.compile({}), /managed_pages_empty|topology/);
    });
    test(`${component} compiles real creation identities, verifies immutably and rejects forged topology`, async () => {
      const pageIds = await managedPageRouteIds(component);
      const prefix = `${book === 'ultimate-b1' ? 'b1' : 'b1-plus'}-${suffix === 'workbook' ? 'wb' : 'sb'}`;
      assert.deepEqual(pageIds, [`${prefix}-page-abcde12345674abc89ab0123456789ab`, `${prefix}-page-98765432abcd4321abcd0123456789ef`]);
      const compiled = publishedManagedBookFixture(component, { pageIds });
      const verified = verifyImmutableComponentRelease(row(compiled));
      assert.equal(verified.publicProjection.bookSlug, book);
      assert.deepEqual(verified.publicProjection.pages.map((page) => page.id), pageIds);
      assert.equal(Object.keys(verified.publicProjection.nativeActivities)[0], `${book}-${suffix === 'workbook' ? 'wb' : 'sb'}-98765432abcd4321abcd0123456789ef-o1`);
      assert.ok(!JSON.stringify(verified.publicProjection).includes('PUBLISHED_BOOK_PRIVATE_TEACHER_SENTINEL'));
      const corrupt = structuredClone(compiled);
      corrupt.sourceSnapshot.pages.sha256 = '0'.repeat(64);
      corrupt.sourceSnapshotSha256 = builderDocumentSha256(corrupt.sourceSnapshot);
      corrupt.releaseSha256 = builderDocumentSha256({ compatibility: corrupt.compatibility, sourceSnapshot: corrupt.sourceSnapshot, publicProjection: corrupt.publicProjection, teacherProjection: corrupt.teacherProjection });
      assert.throws(() => verifyImmutableComponentRelease(row(corrupt)), /release_integrity_failed/);
    });
    test(`${component} orders canonical Units before overlapping page positions and stable ties`, async () => {
      const pageIds = await managedPageRouteIds(component, 6);
      const compiled = publishedManagedBookFixture(component, { pageIds, pageLayout: workbookOrderingLayout, unitSortOrders: { 1: 3, 2: 2, 3: 1 } });
      assert.deepEqual(compiled.publicProjection.pages.map((page) => page.id), [pageIds[4], pageIds[5], pageIds[2], pageIds[3], pageIds[0], pageIds[1]]);
      assert.doesNotThrow(() => verifyImmutableComponentRelease(row(compiled)));
    });
  }
  test(`${book} Grammar and unknown compiler remain unpublished`, () => {
    assert.equal(resolvePublicationCompiler(`${book}-grammar-book-v1`), null);
    assert.equal(resolvePublicationCompiler(`${book}-test-book-v1`), null);
  });
}
