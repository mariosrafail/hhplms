import assert from "node:assert/strict";
import test from "node:test";

import { studentsBookPageUnitsFromActivePageIds, studentsBookPageUnitsFromCatalog, studentsBookCurrentPageUnitsFromCatalog } from "../src/apps/android-teacher-offline/studentsBookPageLifecycleProjection.js";
import { resolveStudentsBookPageAuthority } from "../netlify-sites/ultimate-b2-builder/server/_students-book-page-authority.js";
import { studentsBookUnits } from "./fixtures/students-book-current.js";
import studentsBookContent from "../src/data/ultimate-b2/generated/students-book.runtime.json" with { type: "json" };
import { buildStudentsBookPageUnits } from "../src/data/ultimate-b2/studentsBookReaderModel.js";

const authorization = `v1.${Buffer.from("page-scope").toString("base64url")}.${"a".repeat(43)}`;
const pageUnits = buildStudentsBookPageUnits(studentsBookContent, (unitNumber, partNumber) => `/canonical/unit-${unitNumber}-part-${partNumber}.png`);
const allPages = pageUnits.flatMap((unit) => unit.pages);

test("Student draft page projection removes tombstones and binds overrides to the exact scoped authorization", () => {
  const deletedId = allPages[1].id;
  const override = allPages[0];
  const projectedUnits = studentsBookPageUnitsFromCatalog(pageUnits, {
    component: { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", kind: "students-book" },
    pages: allPages.filter(({ id }) => id !== deletedId).map((page) => page.id === override.id
      ? { id: page.id, source: "override", image: { url: `/preview/pages/books/ultimate-b2/components/ultimate-b2-students-book/pages/${page.id}/assets/10000000-0000-4000-8000-000000000001?previewAuthorization=stale` } }
      : { id: page.id, source: "repository-baseline", image: { url: page.images[0] } }),
  }, authorization);
  const projected = projectedUnits.flatMap((unit) => unit.pages);
  assert.equal(projected.some(({ id }) => id === deletedId), false);
  assert.match(projected.find(({ id }) => id === override.id).images[0], new RegExp(`previewAuthorization=${encodeURIComponent(authorization)}`));
  assert.doesNotMatch(projected.find(({ id }) => id === override.id).images[0], /stale/);
  assert.deepEqual(projected.map(({ id }) => id), allPages.filter(({ id }) => id !== deletedId).map(({ id }) => id));
});

test("Student release page projection is backward-compatible and preserves canonical order", () => {
  const active = allPages.filter((_, index) => index !== 2).map(({ id }) => id);
  assert.deepEqual(studentsBookPageUnitsFromActivePageIds(pageUnits, active).flatMap((unit) => unit.pages.map(({ id }) => id)), active);
  assert.throws(() => studentsBookPageUnitsFromActivePageIds(pageUnits, [null]), /identities/);
  assert.throws(() => studentsBookPageUnitsFromCatalog(pageUnits, { component: { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-workbook", kind: "managed" }, pages: [] }, authorization), /identity/);
});

test("current Saved Draft projects all authoritative canonical and managed pages without generated actions", () => {
  const authority = resolveStudentsBookPageAuthority({ revision: 0, units: studentsBookUnits, rows: [] });
  const pages = authority.pages.map(({ imageRow, storedRow, ...page }) => structuredClone(page));
  const deleted = pages.splice(1, 1)[0];
  const overridden = pages[0]; const assetId = "10000000-0000-4000-8000-000000000001";
  overridden.label = "Preserved editorial label"; overridden.printedLabel = "Custom folio"; overridden.sortOrder = 999;
  overridden.image = { source: "managed", assetId, width: 581, height: 794, url: `/preview/pages/books/ultimate-b2/components/ultimate-b2-students-book/pages/${overridden.id}/assets/${assetId}/preview?previewAuthorization=stale` };
  const managedId = `sb-page-${"a".repeat(32)}`;
  pages.push({ id: managedId, stableKey: `ultimate-b2-students-book/pages/${managedId}`, componentSlug: "ultimate-b2-students-book", origin: "managed", unitId: studentsBookUnits[9].id, unitNumber: 10, unitTitle: "Unit 10", sortOrder: -10, partNumber: null, printedPages: [], printedLabel: "110", label: "Added page", image: { source: "managed", assetId, width: 320, height: 640, url: `/preview/pages/books/ultimate-b2/components/ultimate-b2-students-book/pages/${managedId}/assets/${assetId}/preview` } });
  const payload = { component: { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", kind: "students-book" }, units: studentsBookUnits.map((unit) => ({ id: unit.id, slug: unit.slug, title: unit.title, unitNumber: unit.unit_number })), pages };
  const before = structuredClone(payload);
  const result = studentsBookCurrentPageUnitsFromCatalog(payload, authorization);
  assert.equal(result.length, 10); assert.equal(result.flatMap((unit) => unit.pages).length, 110);
  assert.equal(result[9].pages[0].id, managedId);
  assert.equal(result[0].pages.at(-1).title, overridden.label);
  assert.equal(result[0].pages.at(-1).spreadNumber, "Custom folio");
  assert.ok(result.flatMap((unit) => unit.pages).every((page) => page.activities.length === 0 && page.actions.length === 0 && page.id !== deleted.id));
  assert.match(result[9].pages[0].images[0], new RegExp(encodeURIComponent(authorization)));
  assert.doesNotMatch(result[0].pages.at(-1).images[0], /stale/);
  assert.equal(result[9].pages[0].imageWidth, 320); assert.equal(result[9].pages[0].imageHeight, 640);
  assert.deepEqual(payload, before);
  for (const change of [
    (value) => { value.pages[0].unitId = studentsBookUnits[9].id; },
    (value) => { value.pages[0].image.url = "https://foreign.example/image.png"; },
    (value) => { value.pages[0].image.url = value.pages[0].image.url.replace("ultimate-b2-students-book/pages", "ultimate-b2-workbook/pages"); },
    (value) => { value.pages.push(value.pages[0]); },
  ]) { const invalid = structuredClone(payload); change(invalid); assert.throws(() => studentsBookCurrentPageUnitsFromCatalog(invalid, authorization), /invalid|mismatch/); }
  assert.deepEqual(studentsBookCurrentPageUnitsFromCatalog({ ...payload, pages: [] }, authorization).flatMap((unit) => unit.pages), []);
});


test("current page titles retain editorial labels and shorten only the standard canonical presentation", async () => {
  const { studentsBookPageTitle } = await import("../src/apps/android-teacher-offline/studentsBookPageTitle.js");
  const page = { origin: "canonical", unitTitle: "Unit 5", sectionTitle: "Reading", printedLabel: "66-67", label: "Unit 5 · Reading · 66-67" };
  assert.equal(studentsBookPageTitle(page), "Reading");
  assert.equal(studentsBookPageTitle({ ...page, label: "Editorial full title" }), "Editorial full title");
  assert.equal(studentsBookPageTitle({ ...page, origin: "managed" }), page.label);
  assert.equal(page.label, "Unit 5 · Reading · 66-67");
});
