import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createServer } from "./_vite-test-server.mjs";
import { applyStudentsBookCatalog } from "../src/data/ultimate-b2/studentsBookCatalog.js";

// Load the real browser modules with their canonical Vite virtual-asset aliases.
let server, normalizeBookPackageTree, mergeBookPackageWithDemoFallback, replaceDemoBookPackage, parseHashRoute;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false }, logLevel: "silent" });
  ({ normalizeBookPackageTree } = await server.ssrLoadModule("/src/services/bookContentApi.js"));
  ({ mergeBookPackageWithDemoFallback, replaceDemoBookPackage } = await server.ssrLoadModule("/src/data/bookPackages.js"));
  ({ parseHashRoute } = await server.ssrLoadModule("/src/utils/hashRoutes.js"));
});
after(async () => { await server?.close(); });

test("managed Students Book page routes preserve opaque IDs for immutable published resolution", () => {
  const pageId = `sb-page-${"a".repeat(32)}`;
  for (const prefix of ["/courses", "/teacher/books"]) {
    const base = `${prefix}/ultimate-b2/components/ultimate-b2-students-book/pages`;
    const route = parseHashRoute(`${base}/${pageId}`);
    assert.equal(route.valid, true);
    assert.equal(route.selectedBookId, "students-book");
    assert.equal(route.selectedPageId, pageId);
    assert.equal(parseHashRoute(`${base}/not-a-published-page`).valid, false);
    assert.equal(parseHashRoute(`${prefix}/ultimate-b2/components/ultimate-b2-grammar-book/pages/${pageId}`).valid, false);
    assert.equal(parseHashRoute(`${prefix}/ultimate-b2/components/ultimate-b2-workbook/pages/${pageId}`).valid, false);
  }
});

function packageTree(legacyDiscoveryAllowed) {
  return {
    id: "10000000-0000-4000-8000-000000000001", slug: "ultimate-b2", title: "Ultimate B2", level: "B2",
    components: [
      { id: "20000000-0000-4000-8000-000000000001", slug: "ultimate-b2-students-book", title: "Ultimate B2 Students Book", componentType: "students_book", legacyDiscoveryAllowed, units: [] },
      { id: "20000000-0000-4000-8000-000000000002", slug: "ultimate-b2-workbook", title: "Ultimate B2 Workbook", componentType: "workbook", legacyDiscoveryAllowed: true, units: [] },
    ],
  };
}

test("published-only Students Book keeps its card identity without recovered Student, Teacher or page catalogs", () => {
  const input = packageTree(false);
  const normalized = normalizeBookPackageTree(input);
  const studentsBook = normalized.components[0];
  assert.equal(studentsBook.id, input.components[0].id);
  assert.equal(studentsBook.slug, input.components[0].slug);
  assert.equal(studentsBook.title, input.components[0].title);
  assert.equal(studentsBook.componentType, "students_book");
  assert.equal(studentsBook.legacyDiscoveryAllowed, false);
  assert.deepEqual(studentsBook.units, []);
  assert.deepEqual(studentsBook.teacherUnits, []);
  assert.deepEqual(studentsBook.pageUnits, []);
  assert.notEqual(studentsBook.catalogKind, "recovered-students-book");
  assert.deepEqual(normalized.components[1], normalizeBookPackageTree(packageTree(true)).components[1], "Workbook normalization is unchanged");
  assert.deepEqual(applyStudentsBookCatalog(input.components[0]), input.components[0], "The catalog builder does not recreate a disabled legacy catalog");
  assert.deepEqual(mergeBookPackageWithDemoFallback(normalized).components[0], studentsBook);
  assert.deepEqual(replaceDemoBookPackage([normalizeBookPackageTree(packageTree(true))], normalized)[0].components[0], studentsBook);
});

test("explicit policy overrides stale legacy units while absent/pre-v3 policy retains the existing catalog", () => {
  for (const policy of [undefined, true]) {
    const studentsBook = normalizeBookPackageTree(packageTree(policy)).components[0];
    assert.equal(studentsBook.legacyDiscoveryAllowed, true);
    assert.equal(studentsBook.catalogKind, "recovered-students-book");
    assert.equal(studentsBook.units.flatMap((unit) => unit.lessons.flatMap((lesson) => lesson.exercises)).length, 78);
  }
  const stale = packageTree(false);
  stale.components[0].units = normalizeBookPackageTree(packageTree(true)).components[0].units;
  const studentsBook = normalizeBookPackageTree(stale).components[0];
  assert.deepEqual(studentsBook.units, []);
  assert.deepEqual(studentsBook.teacherUnits, []);
  assert.deepEqual(studentsBook.pageUnits, []);
});
