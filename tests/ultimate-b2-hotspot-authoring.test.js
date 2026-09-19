import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import manifest from "../src/data/ultimate-b2/authoring/studentsBookHotspots.json" with { type: "json" };
import {
  getUltimateB2AuthoredHotspotActivityKey,
  getUltimateB2StudentsBookHotspotActions,
  getUltimateB2StudentsBookHotspots,
  ultimateB2StudentsBookHotspotToAction,
} from "../src/data/ultimate-b2/studentsBookHotspots.js";
import {
  ultimateB2StudentsBookAuthoringActivities,
  ultimateB2StudentsBookAuthoringPages,
} from "../src/data/ultimate-b2/studentsBookAuthoringCatalog.js";
import { validateAndNormalizeUltimateB2HotspotManifest } from "../scripts/ultimate-b2/hotspot-manifest.mjs";
import openerAssets from "../src/data/ultimate-b2/unit1Part1LegacyOpenerAssetManifest.json" with { type: "json" };
import { isUltimateB2Unit1LegacyOpener } from "../src/data/ultimate-b2/unit1Part1LegacyOpener.js";
import { findStudentsBookImplementation } from "../src/data/ultimate-b2/studentsBookCatalog.js";
import { buildUltimateB2TeacherSolutionPayload } from "../netlify/functions/_ultimate-b2-teacher-solutions.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const openerId = "ultimate-b2-sb-u1-p1-o1";

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

test("authored hotspot manifest is canonical and limited to Ultimate B2 Students Book Units 1 and 2", () => {
  assert.deepEqual(validateAndNormalizeUltimateB2HotspotManifest(manifest), manifest);
  assert.equal(manifest.packageSlug, "ultimate-b2");
  assert.equal(manifest.componentSlug, "students-book");
  const validPageIds = new Set(ultimateB2StudentsBookAuthoringPages.map((page) => page.id));
  for (const [pageId, hotspots] of Object.entries(manifest.pages)) {
    assert.ok(validPageIds.has(pageId));
    for (const hotspot of hotspots) {
      assert.ok([1, 2].includes(hotspot.unitNumber));
      assert.ok(Number.isFinite(hotspot.left) && Number.isFinite(hotspot.top));
      assert.ok(hotspot.width > 0 && hotspot.height > 0);
      assert.ok(hotspot.left >= 0 && hotspot.top >= 0);
      assert.ok(hotspot.left + hotspot.width <= 100);
      assert.ok(hotspot.top + hotspot.height <= 100);
    }
  }
});

test("the authoring activity dropdown is derived from all 78 enabled normalized activities", () => {
  assert.equal(ultimateB2StudentsBookAuthoringActivities.filter((activity) => activity.unitNumber === 1).length, 38);
  assert.equal(ultimateB2StudentsBookAuthoringActivities.filter((activity) => activity.unitNumber === 2).length, 40);
  assert.equal(ultimateB2StudentsBookAuthoringActivities.length, 78);
  assert.equal(new Set(ultimateB2StudentsBookAuthoringActivities.map((activity) => activity.activityKey)).size, 78);
  for (const activity of ultimateB2StudentsBookAuthoringActivities) {
    assert.equal(activity.availability, "enabled");
    assert.notEqual(activity.implementationMode, "unsupported-disabled");
    assert.match(activity.activityKey, /^ultimate-b2-sb-u[12]-p\d+-o\d+$/);
  }
});

test("manifest validation rejects cross-package data, invalid geometry, unavailable activity keys, and duplicate ids", () => {
  assert.throws(() => validateAndNormalizeUltimateB2HotspotManifest({ ...manifest, packageSlug: "another-book" }), /Only ultimate-b2/);
  assert.throws(() => validateAndNormalizeUltimateB2HotspotManifest({ ...manifest, componentSlug: "workbook" }), /Only students-book/);
  const invalidGeometry = structuredClone(manifest);
  invalidGeometry.pages["ub2-sb-unit-1-part-1"][0].width = 101;
  assert.throws(() => validateAndNormalizeUltimateB2HotspotManifest(invalidGeometry), /coordinates must stay within/);
  const invalidActivity = structuredClone(manifest);
  invalidActivity.pages["ub2-sb-unit-1-part-1"][0].activityKey = "ultimate-b2-sb-u1-p99-o99";
  assert.throws(() => validateAndNormalizeUltimateB2HotspotManifest(invalidActivity), /unavailable activityKey/);
  const duplicate = structuredClone(manifest);
  duplicate.pages["ub2-sb-unit-1-part-1"].push(structuredClone(duplicate.pages["ub2-sb-unit-1-part-1"][0]));
  assert.throws(() => validateAndNormalizeUltimateB2HotspotManifest(duplicate), /Duplicate hotspot id/);
});

test("runtime lookup and action conversion preserve the normalized activity key", () => {
  const hotspots = getUltimateB2StudentsBookHotspots({ pageId: "ub2-sb-unit-1-part-1", pageNumber: 5, unitNumber: 1 });
  assert.equal(hotspots.length, manifest.pages["ub2-sb-unit-1-part-1"].length);
  const openerHotspot = hotspots.find((hotspot) => hotspot.activityKey === openerId);
  assert.ok(openerHotspot);
  const action = ultimateB2StudentsBookHotspotToAction(openerHotspot);
  assert.equal(action.activityKey, openerId);
  assert.equal(action.target, "normalized-activity");
  assert.equal(action.left, `${openerHotspot.left}%`);
  assert.equal(action.authoredHotspot, true);
  assert.equal(getUltimateB2AuthoredHotspotActivityKey(action), openerId);
  assert.equal(getUltimateB2AuthoredHotspotActivityKey({ ...action, authoredHotspot: false }), null);
  assert.deepEqual(getUltimateB2StudentsBookHotspotActions({ pageId: "missing" }), []);
});

test("web resolves publisher releases while offline viewers retain the tracked hotspot manifest", async () => {
  const [viewer, pageImagePanel, androidViewer, teacherViewer, teacherViewerStyles, stubs, registry] = await Promise.all([
    readFile(path.join(repositoryRoot, "src/components/lms/books/BookPageViewer.jsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src/components/lms/books/BookPageImagePanel.jsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src/apps/android-offline/AndroidBookViewer.jsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src/apps/android-teacher-offline/TeacherClassroomPages.jsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src/apps/android-teacher-offline/teacherOfflinePageViewer.css"), "utf8"),
    readFile(path.join(repositoryRoot, "src/apps/android-offline/androidOfflineServiceStubs.js"), "utf8"),
    readFile(path.join(repositoryRoot, "src/apps/android-teacher-offline/reviewComponentRegistry.js"), "utf8"),
  ]);
  assert.match(viewer, /BookPageImageLayer/);
  assert.match(pageImagePanel, /publishedHotspotActions/);
  assert.match(pageImagePanel, /usePublishedComponentRelease/);
  assert.match(androidViewer, /BookPackageBrowser/);
  assert.match(teacherViewer, /hotspotProvider\?\.getActions/);
  assert.match(registry, /getUltimateB2StudentsBookHotspotActions/);
  assert.doesNotMatch(pageImagePanel, /listBookPageHotspots/);
  assert.match(stubs, /listBookPageHotspots/);
  assert.match(teacherViewerStyles, /\.teacher-offline-pages-viewer \.teacher-offline-page-hotspot[\s\S]*border: 2px solid transparent/);
  assert.match(teacherViewerStyles, /background-color: transparent/);
  assert.match(teacherViewerStyles, /\.teacher-offline-page-hotspot:active[\s\S]*background-color: rgba\(255, 221, 0, 0\.3\)/);
});

test("local builder can select a validated book menu skin without placing Teacher assets in shared configuration", async () => {
  const [builder, plugin, catalog, selections] = await Promise.all([
    readFile(path.join(repositoryRoot, "src/apps/ultimate-b2-builder/UltimateB2HotspotBuilder.jsx"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts/ultimate-b2/hotspot-builder-vite-plugin.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "src/config/bookMenuSkins.js"), "utf8"),
    readFile(path.join(repositoryRoot, "src/config/bookMenuSkinSelections.json"), "utf8"),
  ]);
  assert.match(builder, /Book menu skin/);
  assert.match(builder, /listBookMenuSkinOptions\(packageId\)/);
  assert.match(builder, /menuSkinEndpoint/);
  assert.match(plugin, /book-menu-skin-selection/);
  assert.match(plugin, /loopbackAddresses/);
  assert.match(plugin, /validateAndNormalizeBookMenuSkinSelections/);
  assert.doesNotMatch(catalog, /legacyClassroomAssets|legacy-classroom-ui|\.png|\.gaf/);
  assert.deepEqual(JSON.parse(selections).selections, { "ultimate-b2-students-book": "ultimate-b2-legacy" });
});

test("authored Open Response renderer preserves the exact Unit 1 baseline identity", async () => {
  const opener = findStudentsBookImplementation(openerId);
  assert.equal(isUltimateB2Unit1LegacyOpener(opener), true);
  assert.equal(isUltimateB2Unit1LegacyOpener(findStudentsBookImplementation("ultimate-b2-sb-u1-p2-o1")), false);
  assert.equal(isUltimateB2Unit1LegacyOpener({ ...opener, partNumber: 2 }), false);
  const [normalizedRenderer, openerRenderer, teacherAnswerUi, activityStyles, recoveredActivityStyles] = await Promise.all([
    readFile(path.join(repositoryRoot, "src/components/lms/activities/ultimate-b2/NormalizedStudentsBookActivity.jsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src/components/lms/activities/ultimate-b2/UltimateB2LegacyUnitOpenerActivity.jsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src/components/lms/activities/ultimate-b2/TeacherAnswerUi.jsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src/styles/activities.css"), "utf8"),
    readFile(path.join(repositoryRoot, "src/styles/ultimate-b2-recovered-activities.css"), "utf8"),
  ]);
  assert.match(normalizedRenderer, /hasUltimateB2OpenResponseAuthoring\(activity\)/);
  assert.match(normalizedRenderer, /isUltimateB2Unit1Part2LegacyPilot\(activity\)/);
  assert.match(openerRenderer, /data-legacy-unit-opener-activity/);
  assert.match(openerRenderer, /capabilities\.canRevealSolutions/);
  assert.match(openerRenderer, /TeacherLegacyUnitOpenerAnswer/);
  assert.match(teacherAnswerUi, /revealQuestion\(questionId\)/);
  assert.match(openerRenderer, /capabilities\.canEditAnswers[\s\S]*textarea/);
  assert.doesNotMatch(openerRenderer, /many artistic processes|every theatre moment is unique/);
  assert.match(activityStyles, /@import "\.\/ultimate-b2-recovered-activities\.css"/);
  assert.match(recoveredActivityStyles, /\.legacy-unit-opener-paper[\s\S]*aspect-ratio:\s*var\(--publisher-surface-width, 1024\)\s*\/\s*var\(--publisher-surface-height, 582\)/);
  assert.match(recoveredActivityStyles, /\.legacy-unit-opener-response-region\.is-revealed/);
});

test("opener publisher assets preserve original bytes and exact scoped provenance", async (t) => {
  assert.deepEqual(openerAssets.scope.activityIds, [openerId]);
  assert.equal(openerAssets.copiedAssets.length, 2);
  const trackedDirectory = path.join(repositoryRoot, "src/assets/books/ultimate-b2/legacy-pilot/unit-1/part-1/obj1");
  const actualFiles = (await readdir(trackedDirectory)).sort();
  assert.deepEqual(actualFiles, ["image_1.png", "image_2.png"]);
  for (const asset of openerAssets.copiedAssets) {
    const tracked = path.join(repositoryRoot, ...asset.trackedPath.split("/"));
    assert.equal(await sha256(tracked), asset.sha256);
    assert.equal((await readFile(tracked)).length, asset.bytes);
  }
  const publisherRoot = path.join(repositoryRoot, "Ultimate English B2.app");
  try { await access(publisherRoot); } catch { t.diagnostic("Publisher source unavailable; tracked hashes still verified."); return; }
  for (const asset of [...openerAssets.copiedAssets, ...openerAssets.modelAnswerEvidence]) {
    assert.equal(await sha256(path.join(publisherRoot, ...asset.sourceRelativePath.split("/"))), asset.sha256);
  }
});

test("exact publisher model responses remain teacher-only and do not change scoring identity", async () => {
  const activity = findStudentsBookImplementation(openerId);
  assert.equal(activity.implementationMode, "teacher-reviewed");
  assert.equal(activity.scoringMode, "pending-teacher-review");
  const solution = buildUltimateB2TeacherSolutionPayload(openerId);
  assert.equal(solution.solutionAvailability, "model-response");
  assert.match(solution.questions[`${openerId}-q1`].acceptedAnswers[0], /^Films are an art form which involve many artistic processes/);
  assert.match(solution.questions[`${openerId}-q2`].acceptedAnswers[0], /every theatre moment is unique\.$/);
  assert.match(solution.questions[`${openerId}-q3`].acceptedAnswers[0], /everything else is organised around it\.$/);
  const browserRuntime = await readFile(path.join(repositoryRoot, "src/data/ultimate-b2/generated/unit-01.runtime.json"), "utf8");
  assert.doesNotMatch(browserRuntime, /Films are an art form which involve many artistic processes/);
});
