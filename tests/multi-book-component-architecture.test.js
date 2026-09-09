import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createHash } from "node:crypto";

import {
  bookProductCatalog,
  createBookProductCatalog,
  findProductBook,
  findProductComponent,
} from "../src/data/bookProductCatalog.js";
import { PHASE_ONE_VISIBLE_COMPONENTS } from "../src/config/bookCatalogVisibility.js";
import { createReviewComponentRegistry } from "../src/apps/android-teacher-offline/reviewComponentRegistryCore.js";
import {
  createTeacherReviewComponentState,
  switchTeacherReviewComponent,
} from "../src/apps/android-teacher-offline/teacherReviewComponentState.js";
import {
  syntheticReviewCatalog,
  syntheticStudentsRuntime,
  syntheticWorkbookRuntime,
} from "./fixtures/review-component-registry-fixture.js";
import { createContentPackValidationPolicy, validateReviewContentPack } from "../src/apps/android-teacher-offline/packValidation.js";
import { resolveHostedBuilderTool } from "../src/apps/book-builder/hosted/hostedBuilderCapabilities.js";
import { readTeacherOfflineLocation, writeTeacherOfflineLocation } from "../src/apps/android-teacher-offline/teacherOfflineStorage.js";

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function semanticSha256(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

test("shared product catalog separates registration, install, authoring, LMS visibility, and Teacher mapping", () => {
  assert.deepEqual(bookProductCatalog.map(({ slug }) => slug), ["ultimate-b1", "ultimate-b1-plus", "ultimate-b2"]);
  assert.equal(new Set(bookProductCatalog.flatMap((book) => book.components.map(({ slug }) => slug))).size, 12);
  for (const bookSlug of ["ultimate-b1", "ultimate-b1-plus"]) {
    const book = findProductBook(bookSlug);
    assert.deepEqual(book.components.map(({ slug, type }) => ({ slug, type })), [
      { slug: `${bookSlug}-students-book`, type: "students_book" },
      { slug: `${bookSlug}-workbook`, type: "workbook" },
      { slug: `${bookSlug}-grammar-book`, type: "grammar_book" },
      { slug: `${bookSlug}-test-book`, type: "test_book" },
    ]);
    for (const component of book.components.slice(0, 3)) {
      assert.deepEqual({ review: component.reviewState, authoring: component.authoringState, adapter: component.authoringAdapterId, publication: component.publication }, {
        review: component.type === "grammar_book" ? "pending" : "installed",
        authoring: "active",
        adapter: component.slug,
        publication: { readable: component.type !== "grammar_book", writable: false, compilerId: component.type === "grammar_book" ? null : `${component.slug}-v1` },
      });
    }
    assert.deepEqual({ review: book.components[3].reviewState, authoring: book.components[3].authoringState, adapter: book.components[3].authoringAdapterId, edition: book.components[3].teacherEditionId }, {
      review: "pending", authoring: "pending", adapter: null, edition: null,
    });
    assert.deepEqual(book.components.filter(({ lmsVisible }) => lmsVisible).map(({ slug }) => slug), [`${bookSlug}-students-book`, `${bookSlug}-workbook`]);
  }
  const students = findProductComponent("ultimate-b2", "ultimate-b2-students-book");
  assert.deepEqual({ review: students.reviewState, authoring: students.authoringState, adapter: students.authoringAdapterId, visible: students.lmsVisible, edition: students.teacherEditionId }, {
    review: "installed", authoring: "active", adapter: "ultimate-b2-students-book", visible: true, edition: "students-book",
  });
  const workbook = findProductComponent("ultimate-b2", "ultimate-b2-workbook");
  assert.deepEqual({ review: workbook.reviewState, authoring: workbook.authoringState, adapter: workbook.authoringAdapterId, publication: workbook.publication }, {
    review: "installed", authoring: "active", adapter: "ultimate-b2-workbook", publication: { readable: true, writable: false, compilerId: "ultimate-b2-workbook-v1" },
  });
  const grammar = findProductComponent("ultimate-b2", "ultimate-b2-grammar-book");
  assert.deepEqual({ registered: grammar.registered, review: grammar.reviewState, authoring: grammar.authoringState, adapter: grammar.authoringAdapterId }, {
    registered: true, review: "installed", authoring: "active", adapter: "ultimate-b2-grammar-book",
  });
  const testBook = findProductComponent("ultimate-b2", "ultimate-b2-test-book");
  assert.deepEqual({ registered: testBook.registered, review: testBook.reviewState, authoring: testBook.authoringState, adapter: testBook.authoringAdapterId }, {
    registered: true, review: "pending", authoring: "pending", adapter: null,
  });
  assert.equal(findProductComponent("ultimate-b2", "ultimate-b2-grammar-book").lmsVisible, false);
  assert.equal(findProductComponent("ultimate-b2", "ultimate-b2-test-book").teacherEditionId, null);
  assert.deepEqual(PHASE_ONE_VISIBLE_COMPONENTS["ultimate-b2"], ["ultimate-b2-students-book", "ultimate-b2-workbook"]);
});

test("Builder tool routes require an explicit readable adapter capability", () => {
  const adapter = { capabilities: { pages: { readable: true, writable: true }, hotspots: { readable: true, writable: true }, activities: { readable: false, writable: false } } };
  assert.equal(resolveHostedBuilderTool(adapter, "pages"), "pages");
  assert.equal(resolveHostedBuilderTool(adapter, "hotspots"), "hotspots");
  assert.equal(resolveHostedBuilderTool(adapter, "activities"), null);
  assert.equal(resolveHostedBuilderTool(adapter, "ui"), null);
  assert.equal(resolveHostedBuilderTool(adapter, "delete"), null);
});

test("product catalog validation rejects duplicate, wrong-parent, unsupported-type, readiness, and edition mappings", () => {
  const base = findProductBook("ultimate-b1");
  assert.throws(() => createBookProductCatalog([base, base]), /duplicate product book/i);
  assert.throws(() => createBookProductCatalog([{ ...base, components: [{ ...base.components[0], bookSlug: "wrong" }] }]), /wrong parent/i);
  assert.throws(() => createBookProductCatalog([{ ...base, components: [{ ...base.components[0], type: "magazine" }] }]), /unsupported/i);
  assert.throws(() => createBookProductCatalog([{ ...base, components: [{ ...base.components[0], authoringState: "active", authoringAdapterId: null }] }]), /adapter mismatch/i);
  assert.throws(() => createBookProductCatalog([{ ...base, components: [{ ...base.components[0], teacherEditionId: null }] }]), /edition mapping/i);
});

test("test-only second component proves scoped pack, page, hotspot, solution, and switch behavior", async () => {
  const registry = createReviewComponentRegistry(syntheticReviewCatalog, [syntheticStudentsRuntime, syntheticWorkbookRuntime], {
    bookSlug: "test-book", componentSlug: "test-book-students",
  });
  const students = registry.resolve("test-book", "test-book-students");
  const workbook = registry.resolve("test-book", "test-book-workbook");
  assert.equal(students.kind, "installed");
  assert.equal(workbook.kind, "installed");
  assert.equal(registry.resolve("test-book", "test-book-pending").kind, "pending");
  assert.equal(registry.resolve("test-book", "unknown").kind, "unknown");
  assert.equal((await students.runtime.contentPackProvider.load()).marker, "students");
  assert.equal((await workbook.runtime.contentPackProvider.load()).marker, "workbook");
  assert.equal(students.runtime.pageUnits[0].pages[0].marker, "students");
  assert.equal(workbook.runtime.hotspotProvider.getActions()[0].id, "hotspot-workbook");
  assert.equal(workbook.runtime.solutionProvider.get("shared-activity"), "solution-workbook");
  assert.notEqual(students.runtime.solutionProvider.get("shared-activity"), workbook.runtime.solutionProvider.get("shared-activity"));

  let state = createTeacherReviewComponentState(students.runtime, { unitNumber: 1, tab: "pages", pageId: "students-page" });
  state = { ...state, navigation: { view: "book", location: { unitNumber: 1, tab: "pages", pageId: "students-page" }, activityId: "shared-activity" } };
  state = switchTeacherReviewComponent(state, workbook);
  assert.equal(state.active.componentSlug, "test-book-workbook");
  assert.equal(state.navigation.activityId, undefined);
  state = { ...state, navigation: { view: "book", location: { unitNumber: 1, tab: "pages", pageId: "workbook-page" }, activityId: "shared-activity" } };
  state = switchTeacherReviewComponent(state, students);
  assert.equal(state.active.componentSlug, "test-book-students");
  assert.equal(state.navigation.location.pageId, "students-page");
  const unchanged = switchTeacherReviewComponent(state, registry.resolve("test-book", "test-book-pending"));
  assert.equal(unchanged.active.componentSlug, "test-book-students");
  assert.match(unchanged.feedback, /not installed/i);
});

test("generic pack validation accepts an explicit synthetic identity without weakening Students Book counts", async () => {
  const catalog = { units: [{ lessons: [{ exercises: [{ stableActivityId: "shared-activity" }] }] }] };
  const activities = { activities: [{ stableActivityId: "shared-activity" }] };
  const assetsManifest = { assets: [] };
  const pack = {
    catalog,
    activities,
    assetsManifest,
    manifest: {
      schemaVersion: 1,
      minimumSupportedContentSchemaVersion: 1,
      minimumSupportedAppVersion: "0.1.0",
      packageId: "test-only-workbook-pack",
      componentId: "workbook",
      activityCountsByUnit: { "1": 1 },
      disabledActivityCount: 0,
      assetCount: 0,
      files: {
        "catalog.json": { semanticSha256: semanticSha256(catalog) },
        "activities.json": { semanticSha256: semanticSha256(activities) },
        "assets-manifest.json": { semanticSha256: semanticSha256(assetsManifest) },
      },
    },
  };
  const policy = createContentPackValidationPolicy({ packageId: "test-only-workbook-pack", componentId: "workbook", activityCount: 1, activityCountsByUnit: { "1": 1 }, disabledActivityCount: 0 });
  assert.deepEqual(await validateReviewContentPack(pack, policy), { valid: true, reason: "" });
  assert.equal((await validateReviewContentPack(pack)).valid, false);
});

test("Teacher location storage is component-scoped and reads legacy Students Book state only for its original identity", () => {
  const values = new Map([["interactive-classroom:location:v1", JSON.stringify({ unitNumber: 2, tab: "pages", pageId: "legacy-students" })]]);
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  try {
    const students = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" };
    const workbook = { bookSlug: "test-book", componentSlug: "test-book-workbook" };
    assert.equal(readTeacherOfflineLocation(students).pageId, "legacy-students");
    assert.equal(readTeacherOfflineLocation(workbook), null);
    writeTeacherOfflineLocation({ unitNumber: 1, tab: "pages", pageId: "workbook-page" }, workbook);
    writeTeacherOfflineLocation({ unitNumber: 2, tab: "exercises", pageId: "students-page" }, students);
    assert.equal(readTeacherOfflineLocation(workbook).pageId, "workbook-page");
    assert.deepEqual(readTeacherOfflineLocation(students), { unitNumber: 2, tab: "exercises", pageId: "students-page" });
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test("production boundaries contain no pending content, answers, or component-specific fallback in the Teacher app", async () => {
  const [registry, app, pages, catalog, fixture] = await Promise.all([
    readFile("src/apps/android-teacher-offline/reviewComponentRegistry.js", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineApp.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflinePages.jsx", "utf8"),
    readFile("src/data/bookProductCatalog.js", "utf8"),
    readFile("tests/fixtures/review-component-registry-fixture.js", "utf8"),
  ]);
  assert.match(registry, /studentsBookRuntime/);
  assert.doesNotMatch(registry, /workbook\/activities|grammar.*solutions|test.*hotspots/i);
  assert.doesNotMatch(app, /ultimateB2StudentsBookPageUnits|virtual:ultimate-b2-runtime-hotspots|interactiveContentPackProvider/);
  assert.doesNotMatch(pages, /virtual:ultimate-b2-runtime-hotspots/);
  assert.doesNotMatch(catalog, /solution|answer|pageUnits|activities/i);
  assert.match(fixture, /Test-only Book/);
});
