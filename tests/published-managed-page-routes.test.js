import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createServer } from "./_vite-test-server.mjs";
import { managedPageRouteIds, publishedManagedBookFixture } from "./fixtures/published-managed-book.js";
import { publishedBookReadModel } from "../netlify/functions/_book-content/published-book-model.js";

let server, routes, studentsPages, workbookPages;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false }, logLevel: "silent" });
  routes = await server.ssrLoadModule("/src/utils/hashRoutes.js");
  studentsPages = await managedPageRouteIds("ultimate-b2-students-book");
  workbookPages = await managedPageRouteIds("ultimate-b2-workbook");
});
after(async () => { await server?.close(); });

for (const role of ["student", "teacher"]) {
  const prefix = role === "student" ? "/courses" : "/teacher/books";
  test(`${role}: canonical managed page identities survive creation, Workbook compilation and routing`, () => {
    const compiled = publishedManagedBookFixture("ultimate-b2-workbook", { pageIds: workbookPages });
    const book = publishedBookReadModel({ id: "30000000-0000-4000-8000-000000000001", release_number: 1 }, compiled.publicProjection);
    assert.deepEqual(compiled.publicProjection.pages.map((page) => page.id), workbookPages);
    assert.deepEqual(book.pages.map((page) => page.id), workbookPages);
    for (const [component, pages] of [["students-book", studentsPages], ["workbook", workbookPages]]) {
      for (const pageId of pages) {
        const hash = routes.buildBookPageHash(role, `ultimate-b2-${component}`, "unit-1", pageId);
        for (const subview of ["pages", "flipbook"]) {
          const route = routes.parseHashRoute(hash.replace("/pages/", `/${subview}/`));
          assert.equal(route.valid, true, hash);
          assert.equal(route.role, role);
          assert.equal(route.selectedPackageSlug, "ultimate-b2");
          assert.equal(route.selectedBookId, component);
          assert.equal(route.selectedBookSubview, subview);
          assert.equal(route.selectedPageId, pageId);
          assert.equal(route.selectedPageUnitId, null, "Unit resolution belongs to the immutable book");
        }
      }
    }
  });

  test(`${role}: component boundaries, malformed and opaque page IDs remain rejected`, () => {
    for (const component of ["students-book", "workbook"]) {
      const own = component === "workbook" ? workbookPages[0] : studentsPages[0];
      const foreign = component === "workbook" ? studentsPages[0] : workbookPages[0];
      const base = `${prefix}/ultimate-b2/components/ultimate-b2-${component}`;
      for (const subview of ["pages", "flipbook"]) {
        for (const token of [foreign, "abcde123-4567-4abc-89ab-0123456789ab", "a".repeat(32), "opaque-page-value", own.slice(0, -1), `${own}0`, `${own.slice(0, -1)}g`, own.toUpperCase(), `${own}/extra`, `${own}%2Fextra`, `${own}?other=1`, `${own}%00`]) {
          assert.equal(routes.parseHashRoute(`${base}/${subview}/${token}`).valid, false, token);
        }
      }
      assert.equal(routes.parseHashRoute(`${base}/exercises/${own}`).valid, false);
    }
    for (const token of [...studentsPages, ...workbookPages]) {
      assert.equal(routes.parseHashRoute(`${prefix}/ultimate-b2/components/ultimate-b2-grammar-book/pages/${token}`).valid, false);
    }
    for (const packageSlug of ["ultimate-b1", "ultimate-b1-plus"]) {
      const route = routes.parseHashRoute(`${prefix}/${packageSlug}/components/${packageSlug}-workbook/pages/${workbookPages[0]}`);
      assert.equal(route.valid, false, "Cross-book managed prefixes are rejected even for empty shells");
    }
  });

  for (const bookSlug of ["ultimate-b1", "ultimate-b1-plus"]) for (const suffix of ["students-book", "workbook"]) {
    test(`${role}: ${bookSlug} ${suffix} accepts only its real managed creation route`, async () => {
      const component = `${bookSlug}-${suffix}`;
      const [pageId] = await managedPageRouteIds(component);
      const base = `${prefix}/${bookSlug}/components/${component}`;
      for (const subview of ["pages", "flipbook"]) {
        const route = routes.parseHashRoute(`${base}/${subview}/${pageId}`);
        assert.equal(route.valid, true); assert.equal(route.selectedPageId, pageId); assert.equal(route.selectedPackageSlug, bookSlug);
        for (const invalid of [workbookPages[0], studentsPages[0], "opaque-id", "1", pageId.toUpperCase(), `${pageId}/extra`, `${pageId}%2Fextra`, pageId.slice(1), `${pageId}0`]) {
          assert.equal(routes.parseHashRoute(`${base}/${subview}/${invalid}`).valid, false, invalid);
        }
      }
    });
  }

  test(`${role}: existing static Workbook page identities and numbers remain valid`, () => {
    for (const [id, number] of [["wb-listening-20", 20], ["wb-consolidation-21", 21]]) {
      for (const token of [id, number]) {
        const route = routes.parseHashRoute(`${prefix}/ultimate-b2/components/ultimate-b2-workbook/pages/${token}`);
        assert.equal(route.valid, true);
        assert.equal(route.selectedPackageSlug, "ultimate-b2");
        assert.equal(route.selectedBookId, "workbook");
        assert.equal(route.selectedPageId, id);
        assert.equal(route.selectedPageUnitId, "ub2-wb-unit-2-pages");
      }
    }
  });
}
