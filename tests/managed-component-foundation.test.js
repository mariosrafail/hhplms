import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createManagedNativeActivityAdapter } from "../netlify-sites/ultimate-b2-builder/server/_managed-native-activity-adapter.js";
import {
  createEmptyManagedComponentHotspotManifest,
  validateAndNormalizeManagedComponentHotspotManifest,
} from "../scripts/ultimate-b2/hotspot-manifest.js";
import { createNoopStartupAssets, runInteractiveViewerStartup } from "../src/apps/android-teacher-offline/interactiveStartupAssets.js";
import {
  createManagedReviewContentPackProvider,
  createManagedReviewDescriptor,
  createManagedReviewHotspotProvider,
  authorizeManagedReviewPageUnits,
  managedHostedStartupAssets,
  managedPageUnitsFromCatalog,
  managedPageUnitsFromRelease,
} from "../src/apps/android-teacher-offline/managedReviewRuntime.js";

const workbook = "ultimate-b2-workbook";
const grammar = "ultimate-b2-grammar-book";
const activity = "ultimate-b2-wb-managed-page-o1";
const pages = [{ id: "wb-page-one", unitNumber: 1 }, { id: "wb-page-two", unitNumber: 2 }];
const newManagedComponents = Object.freeze([
  ["ultimate-b1", "ultimate-b1-students-book", "Ultimate English B1", "Students Book"],
  ["ultimate-b1", "ultimate-b1-workbook", "Ultimate English B1", "Workbook"],
  ["ultimate-b1", "ultimate-b1-grammar-book", "Ultimate English B1", "Grammar Book"],
  ["ultimate-b1-plus", "ultimate-b1-plus-students-book", "Ultimate English B1+", "Students Book"],
  ["ultimate-b1-plus", "ultimate-b1-plus-workbook", "Ultimate English B1+", "Workbook"],
  ["ultimate-b1-plus", "ultimate-b1-plus-grammar-book", "Ultimate English B1+", "Grammar Book"],
]);

test("the shared product shell keeps empty managed Units navigable and highlights the originating edition", async () => {
  const [app, library, pagesView, overview] = await Promise.all([
    readFile("src/apps/android-teacher-offline/TeacherOfflineApp.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineLibrary.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherClassroomPages.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineUnitOverview.jsx", "utf8"),
  ]);
  assert.match(app, /initialEditionId=\{activeRuntime\.component\.teacherEditionId\}/);
  assert.match(library, /useState\(initialEditionId\)/);
  assert.doesNotMatch(pagesView, /if \(!pages\.length\) return/);
  assert.match(overview, /No pages are available for this Unit yet\./);
  assert.match(overview, /TeacherBookNavigation onHome=\{onBackToLibrary\} onBack=\{onBackToLibrary\}/);
});

test("managed hotspot manifests accept empty page maps and enforce page, activity, identity, and geometry scope", () => {
  for (const componentSlug of [workbook, grammar]) {
    assert.deepEqual(validateAndNormalizeManagedComponentHotspotManifest(createEmptyManagedComponentHotspotManifest(componentSlug), { componentSlug, pages: [], activities: [] }).pages, {});
  }
  const document = {
    schemaVersion: "1.0", packageSlug: "ultimate-b2", componentSlug: workbook,
    pages: { "wb-page-one": [{ id: "hotspot-one", unitNumber: 1, pageId: "wb-page-one", left: 10, top: 20, width: 30, height: 40, label: "Open", actionType: "normalized_activity", activityKey: activity }] },
  };
  const normalized = validateAndNormalizeManagedComponentHotspotManifest(document, { componentSlug: workbook, pages, activities: [{ activityId: activity, title: "Workbook activity" }] });
  assert.equal(normalized.pages["wb-page-one"][0].activityKey, activity);
  assert.throws(() => validateAndNormalizeManagedComponentHotspotManifest(document, { componentSlug: workbook, pages: [{ id: "wb-page-two", unitNumber: 2 }], activities: [{ activityId: activity }] }), /Unknown managed component page/);
  assert.throws(() => validateAndNormalizeManagedComponentHotspotManifest(document, { componentSlug: workbook, pages, activities: [{ activityId: "ultimate-b2-gb-foreign-o1" }] }), /unavailable activityKey/);
  const overflow = structuredClone(document); overflow.pages["wb-page-one"][0].width = 91;
  assert.throws(() => validateAndNormalizeManagedComponentHotspotManifest(overflow, { componentSlug: workbook, pages, activities: [{ activityId: activity }] }), /within the page image/);
  assert.throws(() => validateAndNormalizeManagedComponentHotspotManifest({ ...document, componentSlug: grammar }, { componentSlug: workbook, pages, activities: [{ activityId: activity }] }), /identity/);
});

test("managed native adapters derive authoritative Unit placement and keep Workbook and Grammar identities disjoint", async () => {
  const observed = [];
  const sql = async (strings, ...values) => {
    observed.push({ text: strings.join("?"), values });
    return [{ stable_key: `${workbook}/pages/wb-page-one`, sort_order: 7, source_metadata: { is_active: true }, unit_id: "20000000-0000-4000-8000-000000000001", unit_number: "3", unit_title: "Unit 3" }];
  };
  const workbookAdapter = createManagedNativeActivityAdapter(workbook);
  const placement = await workbookAdapter.normalizePlacement({ pageId: "wb-page-one", unitNumber: 9 }, { sql, bookSlug: "ultimate-b2", componentSlug: workbook });
  assert.deepEqual(placement, { pageId: "wb-page-one", sourcePageId: "wb-page-one", unitId: "20000000-0000-4000-8000-000000000001", unitNumber: 3, unitTitle: "Unit 3", sortOrder: 7, assignmentState: "assigned" });
  assert.ok(observed[0].values.flat().includes(`${workbook}/pages/wb-page-one`));
  await assert.rejects(workbookAdapter.normalizePlacement({ pageId: "gb-page-one" }, { sql, bookSlug: "ultimate-b2", componentSlug: grammar }), /invalid/);
  const workbookId = workbookAdapter.nextActivityId({ placement, nativeIndex: { activities: [] } });
  const grammarId = createManagedNativeActivityAdapter(grammar).nextActivityId({ placement: { ...placement, pageId: "gb-page-one" }, nativeIndex: { activities: [] } });
  assert.match(workbookId, /^ultimate-b2-wb-/);
  assert.match(grammarId, /^ultimate-b2-gb-/);
  assert.notEqual(workbookId, grammarId);
});

test("managed existing placement resolution classifies active, deleted, unavailable-Unit, and absent owned pages without weakening destinations", async () => {
  const adapter = createManagedNativeActivityAdapter(workbook);
  const unit = { unit_id: "20000000-0000-4000-8000-000000000001", unit_number: 3, unit_title: "Unit 3" };
  const row = (pageId, sourceMetadata, overrides = {}) => ({
    stable_key: `${workbook}/pages/${pageId}`,
    sort_order: 8,
    source_metadata: sourceMetadata,
    ...unit,
    ...overrides,
  });
  const context = (sql, componentSlug = workbook) => ({ sql, bookSlug: "ultimate-b2", componentSlug });

  const activeSql = async () => [row("wb-active", { is_active: true })];
  const active = await adapter.resolveExistingPlacement({ pageId: "wb-active" }, context(activeSql));
  assert.deepEqual({ state: active.assignmentState, unitId: active.unitId, unitNumber: active.unitNumber }, { state: "assigned", unitId: unit.unit_id, unitNumber: 3 });
  assert.equal((await adapter.normalizeDestinationPlacement({ pageId: "wb-active" }, context(activeSql))).assignmentState, "assigned");

  const deletedSql = async () => [row("wb-deleted", { is_active: false, is_deleted: true })];
  const deleted = await adapter.resolveExistingPlacement({ pageId: "wb-deleted" }, context(deletedSql));
  assert.deepEqual({ pageId: deleted.pageId, state: deleted.assignmentState, reason: deleted.unassignedReason }, { pageId: "wb-deleted", state: "unassigned", reason: "page-deleted" });
  await assert.rejects(adapter.normalizeDestinationPlacement({ pageId: "wb-deleted" }, context(deletedSql)), /inactive/);

  let invalidUnitQuery = "";
  const invalidUnitSql = async (strings) => {
    invalidUnitQuery = strings.join("?");
    return [row("wb-invalid-unit", { is_active: true }, { unit_id: null, unit_number: null, unit_title: null })];
  };
  const invalidUnit = await adapter.resolveExistingPlacement({ pageId: "wb-invalid-unit" }, context(invalidUnitSql));
  assert.deepEqual(invalidUnit, { pageId: "wb-invalid-unit", sourcePageId: "wb-invalid-unit", assignmentState: "unassigned", unassignedReason: "page-unavailable" });
  assert.match(invalidUnitQuery, /left join units unit/i);
  await assert.rejects(adapter.normalizePlacement({ pageId: "wb-invalid-unit" }, context(invalidUnitSql)), /unknown/);
  await assert.rejects(adapter.normalizeDestinationPlacement({ pageId: "wb-invalid-unit" }, context(invalidUnitSql)), /unknown/);

  const absentSql = async () => [];
  assert.deepEqual(await adapter.resolveExistingPlacement({ pageId: "wb-absent" }, context(absentSql)), {
    pageId: "wb-absent", sourcePageId: "wb-absent", assignmentState: "unassigned", unassignedReason: "page-unavailable",
  });
  await assert.rejects(adapter.normalizePlacement({ pageId: "wb-absent" }, context(absentSql)), /unknown/);
  await assert.rejects(adapter.normalizeDestinationPlacement({ pageId: "wb-absent" }, context(absentSql)), /unknown/);

  await assert.rejects(adapter.resolveExistingPlacement({ pageId: "wb-deleted" }, context(deletedSql, grammar)), /invalid/);
  const databaseFailure = Object.assign(new Error("database unavailable"), { code: "CONNECTION_LOST" });
  await assert.rejects(adapter.resolveExistingPlacement({ pageId: "wb-absent" }, context(async () => { throw databaseFailure; })), (error) => error === databaseFailure);
});

test("managed existing placements batch one scoped SQL read and preserve active, deleted, unavailable, and absent semantics", async () => {
  const adapter = createManagedNativeActivityAdapter(workbook);
  const unit = { unit_id: "20000000-0000-4000-8000-000000000001", unit_number: 3, unit_title: "Unit 3" };
  const row = (pageId, sourceMetadata, overrides = {}) => ({
    stable_key: `${workbook}/pages/${pageId}`,
    sort_order: 8,
    source_metadata: sourceMetadata,
    ...unit,
    ...overrides,
  });
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return [
      row("wb-active", { is_active: true }),
      row("wb-deleted", { is_active: false, is_deleted: true }),
      row("wb-invalid-unit", { is_active: true }, { unit_id: null, unit_number: null, unit_title: null }),
    ];
  };
  const context = { sql, bookSlug: "ultimate-b2", componentSlug: workbook };
  const placements = await adapter.resolveExistingPlacements([
    { pageId: "wb-active" }, { pageId: "wb-deleted" }, { pageId: "wb-invalid-unit" },
    { pageId: "wb-absent" }, { pageId: "wb-active" },
  ], context);

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /page\.stable_key=any\(\?::text\[\]\)/i);
  assert.deepEqual(calls[0].values.at(-1), [
    `${workbook}/pages/wb-active`, `${workbook}/pages/wb-deleted`,
    `${workbook}/pages/wb-invalid-unit`, `${workbook}/pages/wb-absent`,
  ]);
  assert.equal(placements.size, 4);
  assert.equal(placements.get("wb-active").assignmentState, "assigned");
  assert.equal(placements.get("wb-deleted").unassignedReason, "page-deleted");
  assert.equal(placements.get("wb-invalid-unit").unassignedReason, "page-unavailable");
  assert.equal(placements.get("wb-absent").unassignedReason, "page-unavailable");
  await assert.rejects(adapter.resolveExistingPlacements([{ pageId: "wb-active" }], { ...context, componentSlug: grammar }), /invalid/);
  const databaseFailure = Object.assign(new Error("database unavailable"), { code: "CONNECTION_LOST" });
  await assert.rejects(adapter.resolveExistingPlacements([{ pageId: "wb-active" }], { ...context, sql: async () => { throw databaseFailure; } }), (error) => error === databaseFailure);
});

function managedCatalog(componentSlug) {
  const units = Array.from({ length: 10 }, (_, index) => ({ id: `${componentSlug}-unit-${index + 1}`, slug: `unit-${index + 1}`, title: `Unit ${index + 1}`, unitNumber: index + 1, sortOrder: index + 1 }));
  return {
    revision: 3, component: { bookSlug: "ultimate-b2", componentSlug, kind: "managed", title: componentSlug === workbook ? "Workbook" : "Grammar Book" }, units,
    pages: [1, 2].map((number) => ({ id: `${componentSlug}-page-${number}`, componentSlug, unitId: units[0].id, label: `Page ${number}`, printedLabel: String(number), sortOrder: number, image: { source: "managed", url: `/preview/pages/${componentSlug}/${number}`, width: number === 1 ? 1180 : 581, height: 794 } })),
  };
}

test("managed hosted runtime starts and browses a ten-Unit two-page pack with zero activities and hotspots", async () => {
  const payload = managedCatalog(workbook);
  const mapped = managedPageUnitsFromCatalog(payload, workbook);
  assert.equal(mapped.length, 10);
  assert.deepEqual(mapped[0].pages.map((page) => page.id), [`${workbook}-page-1`, `${workbook}-page-2`]);
  assert.deepEqual(mapped[0].pages.map((page) => [page.imageWidth, page.imageHeight]), [[1180, 794], [581, 794]]);
  assert.ok(mapped.every((unit) => Array.isArray(unit.pages)));
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { configurable: true, value: { search: `?builderPreview=1&previewAuthorization=v2.payload.${"a".repeat(43)}` } });
  try {
    const fetchImpl = async (url) => ({
      ok: true,
      async json() {
        return String(url).startsWith("/preview/pages/") ? payload : { bookSlug: "ultimate-b2", componentSlug: workbook, resource: "hotspots", schemaVersion: "1.0", revision: 0, source: "repository", document: createEmptyManagedComponentHotspotManifest(workbook) };
      },
    });
    const content = createManagedReviewContentPackProvider(workbook);
    const hotspots = createManagedReviewHotspotProvider(workbook);
    const states = [];
    const result = await runInteractiveViewerStartup({
      loadContentPack: () => content.load({ fetchImpl }),
      prepareHotspots: () => hotspots.prepare({ fetchImpl }),
      startupAssets: createNoopStartupAssets(),
      onState: (state) => states.push(state),
    });
    assert.equal(result.pack.pageUnits[0].pages.length, 2);
    assert.deepEqual(result.pack.activities.activities, []);
    assert.deepEqual(hotspots.getActions({ pageId: `${workbook}-page-1` }), []);
    assert.equal(states.at(-1).status, "ready");
  } finally {
    if (previousLocation) Object.defineProperty(globalThis, "location", previousLocation);
    else delete globalThis.location;
  }
});

test("all six new hosted Review descriptors are exact empty managed package runtimes", async () => {
  const runtimeContext = { kind: "builder-preview", teacherPreview: true, authorization: `v2.payload.${"a".repeat(43)}` };
  for (const [bookSlug, componentSlug, bookTitle, componentTitle] of newManagedComponents) {
    const descriptor = createManagedReviewDescriptor({ bookSlug, componentSlug });
    assert.deepEqual({ bookSlug: descriptor.bookSlug, componentSlug: descriptor.componentSlug }, { bookSlug, componentSlug });
    assert.deepEqual(descriptor.uiOwnerIdentity, { bookSlug, componentSlug: `${bookSlug}-students-book` });
    assert.equal(descriptor.installationScope, "hosted-builder-review");
    assert.equal(descriptor.startupAssets.hosted, true);
    assert.equal(descriptor.pageUnits.length, 10);
    assert.ok(descriptor.pageUnits.every((unit, index) => unit.number === index + 1 && unit.title === `Unit ${index + 1}` && unit.pages.length === 0));

    let pagePath = "";
    const pack = await descriptor.contentPackProvider.load({
      runtimeContext,
      fetchImpl: async (url) => {
        pagePath = String(url);
        return { ok: true, async json() {
          return {
            revision: 0,
            component: { bookSlug, componentSlug, kind: "managed", title: componentTitle },
            units: Array.from({ length: 10 }, (_, index) => ({ id: `${componentSlug}-unit-${index + 1}`, slug: `unit-${index + 1}`, title: `Unit ${index + 1}`, unitNumber: index + 1, sortOrder: index + 1 })),
            pages: [],
          };
        } };
      },
    });
    assert.match(pagePath, new RegExp(`^/preview/pages/books/${bookSlug}/components/${componentSlug}\\?previewAuthorization=`));
    assert.equal(pack.catalog.title, `${bookTitle} ${componentTitle}`);
    assert.equal(pack.pageUnits.length, 10);
    assert.ok(pack.pageUnits.every((unit) => unit.pages.length === 0));
    assert.deepEqual(pack.activities.activities, []);
    assert.deepEqual(pack.assetsManifest.assets, []);

    let uiPath = "";
    assert.equal(await descriptor.uiManifestProvider.load({
      runtimeContext,
      fetchImpl: async (url) => { uiPath = String(url); return { ok: false, status: 404 }; },
    }), null);
    assert.match(uiPath, new RegExp(`^/preview/content/books/${bookSlug}/components/${bookSlug}-students-book/ui-controller\\?previewAuthorization=`));
  }
  assert.throws(() => createManagedReviewDescriptor({ bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-test-book" }), /unsupported/);
  assert.throws(() => createManagedReviewDescriptor({ bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-plus-workbook" }), /unsupported/);
  const legacyB2 = createManagedReviewDescriptor("ultimate-b2-workbook");
  assert.deepEqual(legacyB2.uiOwnerIdentity, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" });
  let legacyUiPath = "";
  const legacyUi = await legacyB2.uiManifestProvider.load({
    runtimeContext,
    fetchImpl: async (url) => {
      legacyUiPath = String(url);
      return { ok: true, status: 200, async json() {
        return { document: { schemaVersion: "1.0", packageId: "ultimate-b2-students-book", assets: {} } };
      } };
    },
  });
  assert.deepEqual(legacyUi, { schemaVersion: "1.0", packageId: "ultimate-b2-students-book", assets: {} });
  assert.match(legacyUiPath, /^\/preview\/content\/books\/ultimate-b2\/components\/ultimate-b2-students-book\/ui-controller\?previewAuthorization=/);
});

test("immutable managed releases retain intrinsic page geometry for overview weighting", () => {
  const unitId = "10000000-0000-4000-8000-000000000001";
  const projection = {
    units: [{ id: unitId, slug: "unit-1", title: "Unit 1", unitNumber: 1, sortOrder: 1 }],
    pages: [{ id: "release-page-1", unitId, label: "Release page", printedLabel: "Page 1", sortOrder: 1, image: { sha256: "a".repeat(64), extension: "png", width: 1180, height: 794 } }],
  };
  const runtimeContext = { kind: "release-preview", releaseId: "20000000-0000-4000-8000-000000000001", authorization: `v3.payload.${"a".repeat(43)}` };
  const mapped = managedPageUnitsFromRelease(projection, workbook, runtimeContext);
  assert.deepEqual([mapped[0].pages[0].imageWidth, mapped[0].pages[0].imageHeight], [1180, 794]);
  assert.match(mapped[0].pages[0].images[0], /\/assets\/[a]{64}\.png\?previewAuthorization=v3\.payload\./);
});

test("managed component preparation keeps heavy page images on demand and reauthorizes cached metadata", () => {
  for (const componentSlug of [workbook, grammar]) {
    const pageUnits = managedPageUnitsFromCatalog(managedCatalog(componentSlug), componentSlug);
    const plan = managedHostedStartupAssets.createLoadPlan({
      pageUnits,
      activities: { activities: [] },
      assetsManifest: { assets: [] },
    }, null);
    assert.deepEqual(plan.blocking, []);
    assert.deepEqual(plan.background, []);
    const firstAuthorization = `v2.${Buffer.from("first").toString("base64url")}.${"a".repeat(43)}`;
    const secondAuthorization = `v2.${Buffer.from("second").toString("base64url")}.${"b".repeat(43)}`;
    const first = authorizeManagedReviewPageUnits(pageUnits, firstAuthorization);
    const second = authorizeManagedReviewPageUnits(pageUnits, secondAuthorization);
    assert.equal(new URL(first[0].pages[0].images[0], "https://viewer.example").searchParams.get("previewAuthorization"), firstAuthorization);
    assert.equal(new URL(second[0].pages[0].images[0], "https://viewer.example").searchParams.get("previewAuthorization"), secondAuthorization);
    assert.equal(pageUnits[0].pages[0].images[0].includes("previewAuthorization"), false);
  }
});

test("managed release UI preload uses the exchanged package UI-owner member context", () => {
  const releaseId = "20000000-0000-4000-8000-000000000099";
  const authorization = `v3.${Buffer.from("owner").toString("base64url")}.${"c".repeat(43)}`;
  const runtimeContext = { kind: "release-preview", releaseId, authorization };
  const plan = managedHostedStartupAssets.createLoadPlan(
    { assetsManifest: { assets: [] }, pageUnits: [], activities: { activities: [] } },
    { assets: { "background.main": { sha256: "d".repeat(64), extension: "png", mediaType: "image/png", sizeBytes: 1, width: 1, height: 1 } } },
    runtimeContext,
  );
  assert.equal(plan.blocking[0].url, `/preview/releases/books/ultimate-b2/components/ultimate-b2-students-book/${releaseId}/assets/${"d".repeat(64)}.png?previewAuthorization=${encodeURIComponent(authorization)}`);
});
