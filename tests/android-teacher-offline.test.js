import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FORBIDDEN_VISIBLE_BRANDING_PATTERN } from "../scripts/_branding-audit.mjs";

import manifest from "../android-content-packs/ultimate-b2-students-book/manifest.json" with { type: "json" };
import catalog from "../android-content-packs/ultimate-b2-students-book/catalog.json" with { type: "json" };
import activities from "../android-content-packs/ultimate-b2-students-book/activities.json" with { type: "json" };
import assetsManifest from "../android-content-packs/ultimate-b2-students-book/assets-manifest.json" with { type: "json" };
import studentsBookRuntime from "../src/data/ultimate-b2/generated/students-book.runtime.json" with { type: "json" };
import {
  teacherAvailableStudentsBookUnits,
  teacherLibraryUnitMetadata,
} from "../src/apps/android-teacher-offline/teacherOfflineUnitMetadata.js";
import {
  ACTIVITY_MODES,
  canOpenActivityInMode,
  getActivityModeCapabilities,
} from "../src/components/lms/activities/activityModes.js";
import { validateTeacherContentPack } from "../src/apps/android-teacher-offline/packValidation.js";
import {
  adjacentEnabledStudentsBookActivity,
  enabledStudentsBookActivitySequence,
  findStudentsBookImplementation,
} from "../src/data/ultimate-b2/studentsBookCatalog.js";
import { checkPresentationAnswers } from "../src/components/lms/activities/presentationAnswers.js";
import { buildUltimateB2TeacherSolutionPayload } from "../netlify/functions/_ultimate-b2-teacher-solutions.js";
import {
  classifyTeacherViewport,
  getTeacherDisplayScale,
  TEACHER_VIEWPORT_PROFILES,
} from "../src/apps/android-teacher-offline/viewportProfiles.js";
import {
  buildStudentsBookOverviewEntries,
  studentsBookOverviewLayout,
} from "../src/apps/android-teacher-offline/studentsBookOverviewLayout.js";
import { splitOverviewEntries } from "../src/apps/android-teacher-offline/unitOverviewLayout.js";
import {
  DEFAULT_TEACHER_OFFLINE_SETTINGS,
  migrateTeacherOfflineSettingsV1,
  sanitizeTeacherOfflineSettings,
  teacherMenuDelayMilliseconds,
} from "../src/apps/android-teacher-offline/teacherOfflineSettings.js";
import {
  isTeacherOfflinePageLocation,
  resolveTeacherOfflineActivityLocation,
} from "../src/apps/android-teacher-offline/teacherOfflineActivityLocation.js";

import {
  calculateEmbeddedActivityScale,
  EMBEDDED_ACTIVITY_MIN_TARGET_SIZE,
  resolveEmbeddedActivityFit,
} from "../src/apps/android-teacher-offline/embeddedActivityFit.js";
import { renderedDeltaToTeacherStage } from "../src/apps/android-teacher-offline/teacherStageGeometry.js";

test("Teacher Review exposes all ten canonical Students Book Units without enabling authored-disabled activities", () => {
  assert.deepEqual(teacherAvailableStudentsBookUnits.map((unit) => unit.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(studentsBookRuntime.units.map((unit) => unit.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const unit of studentsBookRuntime.units.filter((candidate) => candidate.number >= 3)) {
    const activities = unit.pages.flatMap((page) => page.activities || []);
    assert.ok(activities.length > 0);
    assert.ok(activities.every((activity) => activity.availability === "disabled"));
  }
});

const multipleChoiceId = "ultimate-b2-sb-u1-p2-o3";
const typedId = "ultimate-b2-sb-u2-p3-o4";
const openResponseId = "ultimate-b2-sb-u1-p1-o1";
const missingSolutionId = "ultimate-b2-sb-u1-p7-o5";
const disabledId = "ultimate-b2-sb-u1-p8-o3";
const teacherSolutionIds = activities.activities.map((activity) => activity.stableActivityId);
const teacherSolutions = {
  schemaVersion: 1,
  teacherOnly: true,
  activityIds: teacherSolutionIds,
  solutions: Object.fromEntries(teacherSolutionIds.map((activityId) => [
    activityId,
    buildUltimateB2TeacherSolutionPayload(activityId),
  ])),
};
const pack = { manifest, catalog, activities, teacherSolutions, assetsManifest };

test("Android Teacher user-facing branding is publisher-owned in both themes", async () => {
  const source = await readFile("src/apps/android-teacher-offline/TeacherOfflineSettingsDialog.jsx", "utf8");
  assert.match(source, /Hamilton House LMS/);
  assert.match(source, /Version 0\.1\.0/);
  assert.doesNotMatch(source, FORBIDDEN_VISIBLE_BRANDING_PATTERN);
});

test("CI builds the teacher pack before its internal verification", async () => {
  const [workflow, packageJson] = await Promise.all([
    readFile(".github/workflows/ci.yml", "utf8"),
    readFile("package.json", "utf8"),
  ]);
  const scripts = JSON.parse(packageJson).scripts;
  const teacherBuild = scripts["build:android-teacher-offline"];

  assert.doesNotMatch(workflow, /npm run verify:android-teacher-pack/);
  assert.match(workflow, /npm run build:android-offline[\s\S]*npm run verify:android-student-bundle-safety[\s\S]*npm run build:android-teacher-offline/);
  assert.ok(teacherBuild.indexOf("build-pack.mjs") < teacherBuild.indexOf("verify-pack.mjs"));
});

test("CI installs Chromium once in each browser job before its first Playwright gate", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  const unitJob = workflow.split("\n  android-debug-builds:")[0];
  const integrationJob = workflow.split("\n  integration-database:")[1]?.split("\n  deploy-cloudflare-builder:")[0];
  assert.ok(integrationJob);
  assert.equal(unitJob.match(/npx playwright install --with-deps chromium/g)?.length, 1);
  assert.equal(integrationJob.match(/npx playwright install --with-deps chromium/g)?.length, 1);
  assert.match(unitJob, /npx playwright install --with-deps chromium[\s\S]*npm run test:lms-native-drag-drop-layout/);
  assert.match(integrationJob, /npm run test:integration[\s\S]*npm run build[\s\S]*npx playwright install --with-deps chromium[\s\S]*npm run test:published-book-assignments/);
});

test("teacher viewport profiles use available width and height rather than device identity", () => {
  assert.equal(classifyTeacherViewport({ width: 800, height: 360 }), TEACHER_VIEWPORT_PROFILES.COMPACT);
  assert.equal(classifyTeacherViewport({ width: 1024, height: 600 }), TEACHER_VIEWPORT_PROFILES.MEDIUM);
  assert.equal(classifyTeacherViewport({ width: 1180, height: 820 }), TEACHER_VIEWPORT_PROFILES.EXPANDED);
  assert.equal(classifyTeacherViewport({ width: 1280, height: 720 }), TEACHER_VIEWPORT_PROFILES.LARGE);
  assert.equal(classifyTeacherViewport({ width: 1920, height: 1080 }), TEACHER_VIEWPORT_PROFILES.EXTRA_LARGE);
  assert.equal(classifyTeacherViewport({ width: 3840, height: 2160 }), TEACHER_VIEWPORT_PROFILES.EXTRA_LARGE);
});

test("Teacher stage scale is the unclamped 1920x1080 contain-fit ratio", () => {
  assert.ok(Math.abs(getTeacherDisplayScale(800, 360) - 1 / 3) < 0.0001);
  assert.ok(Math.abs(getTeacherDisplayScale(1280, 720) - 2 / 3) < 0.0001);
  assert.equal(getTeacherDisplayScale(1920, 1080), 1);
  assert.ok(Math.abs(getTeacherDisplayScale(2560, 1440) - 4 / 3) < 0.0001);
  assert.equal(getTeacherDisplayScale(3840, 2160), 2);
  assert.equal(getTeacherDisplayScale(7680, 4320), 4);
  assert.equal(getTeacherDisplayScale(3840, 1080), 1);
  assert.equal(getTeacherDisplayScale(0, 0), 1);
});

test("Teacher fixed stage separates viewport fit from bounded Interface Size", async () => {
  const [app, stage, rootCss, fixedCss] = await Promise.all([
    readFile("src/apps/android-teacher-offline/TeacherOfflineApp.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherFixedStage.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/teacherOfflineRoot.css", "utf8"),
    readFile("src/apps/android-teacher-offline/teacherFixedStage.css", "utf8"),
  ]);
  assert.doesNotMatch(app, /viewport\.displayScale \* userInterfaceScale/);
  assert.match(app, /"--teacher-display-scale": viewport\.displayScale/);
  assert.match(app, /"--teacher-ui-scale": effectiveUiScale/);
  assert.match(app, /resolveViewportBackdrop[\s\S]*name: "intro", color: "#fefefe", image: "none"[\s\S]*name: "library"[\s\S]*name: "media"[\s\S]*"unit-overview"[\s\S]*<TeacherFixedStage[\s\S]*viewport=\{viewport\}[\s\S]*viewportBackdrop=\{viewportBackdrop\}/);
  assert.match(stage, /data-teacher-stage-scale/);
  assert.match(stage, /data-viewport-backdrop=\{viewportBackdrop\?\.name\}/);
  assert.match(stage, /backgroundColor: viewportBackdrop\?\.color[\s\S]*backgroundImage: viewportBackdrop\?\.image/);
  assert.match(rootCss, /teacherFixedStage\.css/);
  assert.doesNotMatch(rootCss, /teacherDisplayScale\.css/);
  assert.match(fixedCss, /width: 1920px[\s\S]*height: 1080px[\s\S]*scale\(var\(--teacher-stage-scale\)\)/);
  assert.match(fixedCss, /\.teacher-fixed-stage-host\[data-viewport-backdrop\][\s\S]*background-size: cover/);
  for (const backdrop of ["library", "contents", "unit-overview", "page", "media"]) {
    assert.match(fixedCss, new RegExp(`data-viewport-backdrop="${backdrop}"`));
  }
  assert.match(fixedCss, /\.teacher-offline-library\.has-classroom-tools[\s\S]*\.teacher-offline-unit-overview-screen[\s\S]*\.teacher-offline-pages-viewer[\s\S]*\.teacher-offline-media[\s\S]*background: transparent/);
  assert.match(fixedCss, /\.legacy-home-launcher[\s\S]*\.teacher-offline-unit-overview-screen[\s\S]*\.teacher-offline-pages-viewer[\s\S]*\.classroom-teaching-toolbar[\s\S]*\.legacy-settings-dialog/);
});

test("Teacher page pan converts rendered pointer deltas into logical stage pixels", () => {
  assert.equal(renderedDeltaToTeacherStage(100, 0.5), 200);
  assert.equal(renderedDeltaToTeacherStage(100, 1), 100);
  assert.equal(renderedDeltaToTeacherStage(100, 2), 50);
});

test("Students Book overview groups every real Unit 1-10 page exactly once", () => {
  const unit1 = studentsBookRuntime.units.find((unit) => unit.number === 1);
  const unit2 = studentsBookRuntime.units.find((unit) => unit.number === 2);
  const unit1Entries = buildStudentsBookOverviewEntries(unit1);
  const unit2Entries = buildStudentsBookOverviewEntries(unit2);

  assert.equal(unit1.pages.length, 10);
  assert.equal(unit1Entries.length, 9);
  assert.deepEqual(unit1Entries.flatMap((entry) => entry.pageIds), unit1.pages.map((page) => page.id));
  assert.deepEqual(unit1Entries.find((entry) => entry.label === "Practice 1").pageIds, ["ub2-sb-unit-1-part-9", "ub2-sb-unit-1-part-10"]);

  assert.equal(unit2.pages.length, 12);
  assert.equal(unit2Entries.length, 10);
  assert.deepEqual(unit2Entries.flatMap((entry) => entry.pageIds), unit2.pages.map((page) => page.id));
  assert.deepEqual(unit2Entries.find((entry) => entry.label === "Practice 2").pageIds, ["practice-31", "practice-32"]);
  assert.deepEqual(unit2Entries.find((entry) => entry.label === "Progress check 1").pageIds, ["progress-check-33", "progress-check-34"]);
  assert.deepEqual(studentsBookOverviewLayout[2][0], { label: null, pageLabel: "pg 19", pageIds: ["reading-19"], row: 1 });

  for (const unit of studentsBookRuntime.units.filter((candidate) => candidate.number >= 3 && candidate.number <= 10)) {
    const entries = buildStudentsBookOverviewEntries(unit);
    assert.equal(entries.length, unit.pages.length);
    assert.deepEqual(entries.flatMap((entry) => entry.pageIds), unit.pages.map((page) => page.id));
    assert.equal(new Set(entries.flatMap((entry) => entry.pageIds)).size, unit.pages.length);
    assert.ok(entries.every((entry) => entry.pages.length === 1 && [1, 2].includes(entry.row) && entry.columnSpan > 0));
    const semanticRows = splitOverviewEntries(entries);
    assert.deepEqual(entries.filter((entry) => entry.row === 1).map((entry) => entry.id), semanticRows.top.map((entry) => entry.id));
    assert.deepEqual(entries.filter((entry) => entry.row === 2).map((entry) => entry.id), semanticRows.bottom.map((entry) => entry.id));
    assert.ok(semanticRows.topWeight >= semanticRows.bottomWeight);
  }

  assert.throws(
    () => buildStudentsBookOverviewEntries({ ...unit1, pages: unit1.pages.slice(1) }),
    /Invalid Unit 1 overview layout/,
  );
});

test("teacher settings are bounded, category-specific, and map menu delay to 1-10 seconds", () => {
  const settings = sanitizeTeacherOfflineSettings({
    audio: { buttonEnabled: false, buttonVolume: 140, navigationVolume: -8, toolbarVolume: 61 },
    content: { showNavbarLeft: false, showNavbarRight: false, menuAutoHide: true, menuDelay: 75 },
    graphics: { interfaceScale: 150, colourIntensity: 5, effectsEnabled: false },
  });
  assert.deepEqual(settings.audio, {
    buttonEnabled: false,
    buttonVolume: 100,
    navigationEnabled: true,
    navigationVolume: 0,
    toolbarEnabled: true,
    toolbarVolume: 61,
  });
  assert.deepEqual(settings.content, { showNavbarLeft: false, showNavbarRight: false, menuAutoHide: true, menuDelay: 75 });
  assert.deepEqual(settings.graphics, {
    appearanceMode: "modern",
    motionEnabled: true,
    interfaceScale: 110,
    colourIntensity: 40,
    effectsEnabled: false,
  });
  assert.equal(teacherMenuDelayMilliseconds(0), 1000);
  assert.equal(teacherMenuDelayMilliseconds(100), 10000);
});

test("teacher settings v1 migration preserves existing values and adds modern motion defaults", () => {
  const migrated = migrateTeacherOfflineSettingsV1({
    audio: { buttonEnabled: false, buttonVolume: 17, navigationEnabled: false, navigationVolume: 32, toolbarEnabled: true, toolbarVolume: 49 },
    content: { showNavbarLeft: false, showNavbarRight: true, menuAutoHide: true, menuDelay: 81 },
    graphics: { interfaceScale: 106, colourIntensity: 72, effectsEnabled: false },
  });
  assert.deepEqual(migrated.audio, { buttonEnabled: false, buttonVolume: 17, navigationEnabled: false, navigationVolume: 32, toolbarEnabled: true, toolbarVolume: 49 });
  assert.deepEqual(migrated.content, { showNavbarLeft: false, showNavbarRight: true, menuAutoHide: true, menuDelay: 81 });
  assert.deepEqual(migrated.graphics, { appearanceMode: "modern", motionEnabled: true, interfaceScale: 106, colourIntensity: 72, effectsEnabled: false });
  assert.equal(DEFAULT_TEACHER_OFFLINE_SETTINGS.graphics.appearanceMode, "modern");
  assert.equal(DEFAULT_TEACHER_OFFLINE_SETTINGS.graphics.motionEnabled, true);
  assert.equal(sanitizeTeacherOfflineSettings({ graphics: { appearanceMode: "invalid", motionEnabled: "yes" } }).graphics.appearanceMode, "modern");
});

test("generic Teacher shell identity is not B2-only while menu identity remains specific", async () => {
  const [settingsDialog, entry, library, menuSkins, app, startupStatus] = await Promise.all([
    readFile("src/apps/android-teacher-offline/TeacherOfflineSettingsDialog.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/teacherOfflineEntry.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineLibrary.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/teacherBookMenuSkins.js", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineApp.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherViewerStartupStatus.jsx", "utf8"),
  ]);
  assert.match(settingsDialog, /Hamilton House LMS/);
  assert.match(settingsDialog, /Interactive Classroom/);
  assert.doesNotMatch(settingsDialog, /Ultimate English B2 interactive classroom content/);
  assert.match(entry, /Hamilton House LMS/);
  assert.match(library, /menuSkin\.title\.accessibleLabel/);
  assert.match(menuSkins, /Ultimate English B2/);
  assert.match(app, /TeacherViewerStartupStatus[\s\S]*bookTitle=\{initialRuntime\.book\.title\}/);
  assert.match(app, /initialRuntime\?\.book\.title \|\| componentRequest\.bookTitle \|\| "Hamilton House"/);
  assert.match(startupStatus, /Preparing \$\{bookTitle\} Interactive/);
  assert.doesNotMatch(startupStatus, />Ultimate B2 Interactive</);
});

test("Teacher launcher preserves B2 unit titles while B1 package shells stay neutral", () => {
  const contaminatedUnits = teacherAvailableStudentsBookUnits.map((unit) => ({
    number: unit.number,
    title: unit.title,
  }));
  const b2Units = teacherLibraryUnitMetadata("ultimate-b2", contaminatedUnits.map((unit) => ({
    ...unit,
    title: `Unit ${unit.number}`,
  })));
  assert.deepEqual(b2Units.map((unit) => unit.title), teacherAvailableStudentsBookUnits.map((unit) => unit.title));

  for (const bookSlug of ["ultimate-b1", "ultimate-b1-plus"]) {
    const shellUnits = teacherLibraryUnitMetadata(bookSlug, contaminatedUnits);
    assert.deepEqual(shellUnits.map((unit) => unit.title), Array.from({ length: 10 }, (_, index) => `Unit ${index + 1}`));
    assert.ok(shellUnits.every((unit) => !teacherAvailableStudentsBookUnits.some((b2Unit) => b2Unit.title === unit.title)));
  }
});

test("modern Teacher unit selectors use shared titles and touch-safe interaction CSS", async () => {
  const [component, metadata, modernCss] = await Promise.all([
    readFile("src/apps/android-teacher-offline/TeacherUnitSwitch.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/teacherOfflineUnitMetadata.js", "utf8"),
    readFile("src/apps/android-teacher-offline/teacherOfflineModern.css", "utf8"),
  ]);
  assert.match(component, /teacherAvailableStudentsBookUnits\.map/);
  assert.match(component, /teacher-unit-switch-badge/);
  assert.match(component, /teacher-unit-switch-title/);
  assert.match(component, /aria-pressed=\{selected\}/);
  assert.match(metadata, /Lights, Camera, Action!/);
  assert.match(metadata, /Journeys of Discovery/);
  assert.match(modernCss, /\.teacher-unit-switch button:not\(:disabled\):active/);
  assert.match(modernCss, /@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?\.teacher-unit-switch button:not\(:disabled\):hover/);
  assert.doesNotMatch(modernCss.replace(/@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?\n\}/, ""), /\.teacher-unit-switch[^\n]*:hover/);
  assert.match(modernCss, /\.teacher-unit-switch button::before[\s\S]*?border-radius: 13px/);
});

test("Teacher book screens use one canonical navigation row with code-controlled Video and Show Text context actions", async () => {
  const [navigation, navigationCore, shell, book, pages, overview, media, fixedCss, toolbarCss] = await Promise.all([
    readFile("src/apps/android-teacher-offline/TeacherBookNavigation.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherBookNavigationCore.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherShellChrome.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineBook.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflinePages.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineUnitOverview.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineMedia.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/teacherFixedStage.css", "utf8"),
    readFile("src/apps/android-teacher-offline/legacyTeacherToolbar.css", "utf8"),
  ]);
  const orderedLabels = ['aria-label="Home"', 'aria-label="Back"', 'aria-label={`Previous ${navigationMode}`}', 'aria-label={`Next ${navigationMode}`}'];
  let previousIndex = -1;
  for (const label of orderedLabels) {
    const currentIndex = navigationCore.indexOf(label);
    assert.ok(currentIndex > previousIndex, `${label} follows the canonical order`);
    previousIndex = currentIndex;
  }
  assert.ok(navigationCore.indexOf("internalNavigation &&") > previousIndex);
  assert.ok(navigationCore.indexOf("actions.map") < navigationCore.indexOf("bookSwitches.map"));
  assert.match(navigationCore, /previousDisabled = true/);
  assert.match(navigationCore, /nextDisabled = true/);
  assert.match(navigationCore, /contextAction = null/);
  assert.match(navigationCore, /contextActions = null/);
  assert.match(navigationCore, /internalNavigation = null/);
  assert.match(navigationCore, /aria-pressed=\{typeof action\.active === "boolean" \? action\.active : undefined\}/);
  assert.match(navigationCore, /disabled=\{Boolean\(action\.disabled\)\}/);
  assert.match(navigationCore, /action\.activeIconName/);
  assert.match(navigationCore, /renderContextIcon\?\.\(action\)/);
  assert.match(navigationCore, /Previous activity part/);
  assert.match(navigationCore, /Next activity part/);
  assert.match(navigationCore, /bookSwitches\.map/);
  assert.match(navigationCore, /data-teacher-control-id=\{item\.controlId\}/);
  assert.match(navigationCore, /aria-current=\{!unavailable && selectedBookId === item\.id \? "page" : undefined\}/);
  assert.match(navigationCore, /onClick=\{\(\) => \{ if \(!unavailable\) onBookSwitch\(item\.id\); \}\}/);
  assert.doesNotMatch(navigationCore, />GB<|>WB</);
  assert.match(navigation, /TeacherBookNavigationCore/);
  assert.match(navigation, /LegacyClassroomIcon/);
  assert.match(navigation, /useTeacherRuntimeUiAssets\(\)/);
  assert.match(navigation, /runtimeUiAssets\.classroom\.bookSwitches/);
  assert.match(navigation, /data-icon-state="active"/);
  assert.match(navigation, /data-icon-state="pressed"/);
  assert.match(navigation, /data-icon-state="disabled"/);
  assert.match(navigation, /teacher-book-navigation-book-switch-image/);
  assert.equal((shell.match(/<button\b/g) || []).length, 3);
  for (const label of ["Open classroom settings", "Minimize application", "Close application"]) assert.match(shell, new RegExp(`aria-label="${label}"`));
  assert.match(book, /availableUnitNumbers = \(pageUnits \|\| \[\]\)/);
  assert.doesNotMatch(book, /TeacherUnitSwitch|teacher-offline-view-tabs|Contents and exercises/);
  assert.match(pages, /<TeacherBookNavigation/);
  assert.match(pages, /onBack=\{activityActive \? onCloseActivity : \(\) => onSelectPage\(""\)\}/);
  assert.match(pages, /previousDisabled=\{activityActive \? activeIndex <= 0 : selectedIndex <= 0\}/);
  assert.match(pages, /nextDisabled=\{activityActive \? activeIndex < 0 \|\| activeIndex >= pageActivityIds\.length - 1 : selectedIndex < 0 \|\| selectedIndex >= pages\.length - 1\}/);
  assert.match(pages, /id: "video"[\s\S]*iconName: "video"/);
  assert.match(pages, /id: "show-text"[\s\S]*label: "Show Text"[\s\S]*iconName: "showText"/);
  assert.match(pages, /contextActions=\{contextActions\}/);
  assert.match(pages, /id: "reload"[\s\S]*id: "show-all"[\s\S]*id: "show-next"/);
  assert.match(pages, /sendActivityCommand\("reset-activity"\)/);
  assert.match(pages, /sendActivityCommand\("show-all"\)/);
  assert.match(pages, /sendActivityCommand\("show-next"\)/);
  assert.match(pages, /internalNavigation=\{internalNavigation\}/);
  assert.match(overview, /<TeacherBookNavigation/);
  assert.match(media, /<TeacherBookNavigation onHome=\{onHome\} onBack=\{onBack\}/);
  for (const source of [book, pages, overview, media]) assert.doesNotMatch(source, /legacy-page-navigation|teacher-unit-side-navigation|legacy-overview-book-links/);
  assert.doesNotMatch(overview, /Previous unit|Next unit|Grid2X2|Minimize2/);
  assert.match(overview, /ClassroomToolOverlay[\s\S]*ClassroomToolbar/);
  assert.match(fixedCss, /\.teacher-book-navigation[\s\S]*height: 66px/);
  assert.match(fixedCss, /\.teacher-book-navigation-book-switch-image[\s\S]*width: 58px;[\s\S]*height: 58px;[\s\S]*object-fit: contain/);
  assert.match(fixedCss, /\.teacher-book-navigation[\s\S]*position: absolute;[\s\S]*bottom: calc\(var\(--teacher-presentation-screen-padding-bottom\) \+ var\(--teacher-fixed-classroom-toolbar-height\) \+ var\(--teacher-presentation-grid-gap\)\)/);
  assert.doesNotMatch(fixedCss, /\.teacher-book-navigation[\s\S]*margin: -7px/);
  assert.match(toolbarCss, /\.classroom-teaching-toolbar[\s\S]*height: var\(--classroom-toolbar-height\)/);
  assert.match(toolbarCss, /\.legacy-teacher-tool-icon-stack[\s\S]*transform: none/);
});

test("contextual activity video overlay keeps captions reliable in Android WebView", async () => {
  const [overlay, embedded, player, css] = await Promise.all([
    readFile("src/apps/android-teacher-offline/TeacherOfflineActivityVideoOverlay.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineEmbeddedActivity.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/NormalizedStudentsBookActivity.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/teacherOfflinePageViewer.css", "utf8"),
  ]);
  assert.match(overlay, /parseWebVtt/);
  assert.match(overlay, /teacher-activity-video-caption/);
  assert.match(overlay, /Subtitles on/);
  assert.match(overlay, /controls\s*\/>|controls[\s\S]*mediaElementRef/);
  assert.match(overlay, /teacher-activity-video-controls/);
  assert.match(overlay, /Pause video/);
  assert.match(overlay, /Video position/);
  assert.match(overlay, /Video volume/);
  assert.match(overlay, /aria-label="Close video"/);
  assert.match(embedded, /videoOpen && <TeacherOfflineActivityVideoOverlay/);
  assert.ok(embedded.lastIndexOf("TeacherOfflineActivityVideoOverlay") > embedded.indexOf("teacher-offline-embedded-activity-content"));
  assert.match(player, /onTimeUpdate/);
  assert.match(player, /controlsList="nofullscreen nodownload noremoteplayback"/);
  assert.match(player, /kind="captions"/);
  assert.match(css, /\.teacher-activity-video-overlay[\s\S]*position: absolute/);
  assert.match(css, /\.teacher-activity-video-overlay[\s\S]*padding: 0/);
  assert.match(css, /\.teacher-activity-video-panel[\s\S]*width: 100%[\s\S]*height: 100%/);
  assert.match(css, /\.teacher-offline-pages-viewer \.teacher-offline-page-reader\.has-embedded-activity[\s\S]*background: #fff/);
  assert.match(css, /\.teacher-activity-video-caption/);
});

test("Android Teacher saves the video worksheet through one shared native document-picker registration", async () => {
  const [activity, registration, mainActivity, pdfSaver] = await Promise.all([
    readFile("src/components/lms/activities/ultimate-b2/UltimateB2LegacyPilotActivity.jsx", "utf8"),
    readFile("src/components/native-video/pdfSaverPlugin.js", "utf8"),
    readFile("android/app/src/main/java/com/eduforge/offlinebooks/MainActivity.java", "utf8"),
    readFile("android/app/src/main/java/com/eduforge/offlinebooks/PdfSaverPlugin.java", "utf8"),
  ]);
  assert.match(registration, /registerPlugin\("PdfSaver"\)/);
  assert.doesNotMatch(activity, /registerPlugin\("PdfSaver"\)/);
  assert.match(activity, /PdfSaver\.savePdf/);
  assert.match(mainActivity, /registerPlugin\(PdfSaverPlugin\.class\)/);
  assert.match(pdfSaver, /Intent\.ACTION_CREATE_DOCUMENT/);
  assert.match(pdfSaver, /setType\("application\/pdf"\)/);
  assert.match(pdfSaver, /getAssets\(\)\.open\("public\/" \+ cleanPath\)/);
});

test("teacher-presentation-offline is a distinct centralized non-submitting mode", () => {
  assert.equal(ACTIVITY_MODES.TEACHER_PRESENTATION_OFFLINE, "teacher-presentation-offline");
  const capabilities = getActivityModeCapabilities(ACTIVITY_MODES.TEACHER_PRESENTATION_OFFLINE);
  assert.deepEqual(capabilities, {
    canEditAnswers: true,
    canSubmitStudentWork: false,
    canRequestSolutions: false,
    canUseOfflineSolutions: true,
    canRevealSolutions: true,
    canCheckLocally: true,
    canResetActivity: true,
    isReadOnly: false,
    isPresentation: true,
    isOffline: true,
    showLargeControls: true,
    persistAttempt: false,
  });
  assert.equal(getActivityModeCapabilities(ACTIVITY_MODES.STUDENT).canUseOfflineSolutions, false);
  assert.equal(getActivityModeCapabilities(ACTIVITY_MODES.TEACHER_PRESENTATION).canUseOfflineSolutions, false);
});

test("offline teacher pack has exact enabled/disabled counts and enabled-only navigation", () => {
  const sequence = enabledStudentsBookActivitySequence();
  assert.equal(manifest.activityCountsByUnit["1"], 38);
  assert.equal(manifest.activityCountsByUnit["2"], 40);
  assert.equal(manifest.enabledActivityCount, 78);
  assert.equal(manifest.disabledActivityCount, 12);
  assert.equal(sequence.length, 78);
  assert.equal(new Set(sequence.map((activity) => activity.stableActivityId)).size, 78);
  assert.deepEqual(
    activities.activities.map((activity) => activity.stableActivityId),
    sequence.map((activity) => activity.stableActivityId),
  );
  assert.equal(teacherSolutions.solutions[disabledId], undefined);
  assert.equal(canOpenActivityInMode(findStudentsBookImplementation(disabledId), ACTIVITY_MODES.TEACHER_PRESENTATION_OFFLINE), false);
});

test("every enabled Contents activity resolves to its real Students Book runtime page", () => {
  const pageUnits = studentsBookRuntime.units.map((unit) => ({ number: unit.number, pages: unit.pages }));
  for (const activity of activities.activities) {
    const resolved = resolveTeacherOfflineActivityLocation({
      activityId: activity.stableActivityId,
      activities: activities.activities,
      pageUnits,
    });
    assert.ok(resolved, `${activity.stableActivityId} resolves`);
    assert.equal(resolved.location.unitNumber, activity.unitNumber);
    const page = pageUnits
      .find((unit) => Number(unit.number) === Number(activity.unitNumber))
      .pages.find((candidate) => candidate.id === resolved.location.pageId);
    assert.ok(page.activities.some((candidate) => candidate.id === activity.stableActivityId));
  }
});

test("page hotspot origins remain exact while Contents uses runtime metadata", () => {
  const pageUnits = studentsBookRuntime.units.map((unit) => ({ number: unit.number, pages: unit.pages }));
  const activityId = "ultimate-b2-sb-u1-p2-o3";
  const nominal = resolveTeacherOfflineActivityLocation({ activityId, activities: activities.activities, pageUnits });
  assert.equal(nominal.location.pageId, "ub2-sb-unit-1-part-2");
  const hotspotOrigin = { unitNumber: 1, tab: "pages", pageId: "ub2-sb-unit-1-part-1" };
  const authored = resolveTeacherOfflineActivityLocation({ activityId, activities: activities.activities, pageUnits, originLocation: hotspotOrigin });
  assert.deepEqual(authored.location, hotspotOrigin);
  assert.equal(isTeacherOfflinePageLocation(authored.location, hotspotOrigin), true);
  assert.equal(isTeacherOfflinePageLocation({ ...authored.location, pageId: "other" }, hotspotOrigin), false);
});

test("embedded Teacher activities always use complete presentation fit instead of scroll fallback", () => {
  assert.equal(calculateEmbeddedActivityScale({ availableWidth: 1200, availableHeight: 700, contentWidth: 1000, contentHeight: 600 }), 1);
  assert.equal(calculateEmbeddedActivityScale({ availableWidth: 1600, availableHeight: 910, contentWidth: 1280, contentHeight: 728, allowUpscale: true }), 1.25);
  assert.equal(calculateEmbeddedActivityScale({ availableWidth: 900, availableHeight: 450, contentWidth: 1200, contentHeight: 900 }), 0.5);
  assert.equal(calculateEmbeddedActivityScale({ availableWidth: 0, availableHeight: 450, contentWidth: 1200, contentHeight: 900 }), 1);
  assert.equal(EMBEDDED_ACTIVITY_MIN_TARGET_SIZE, 38);
  assert.deepEqual(
    resolveEmbeddedActivityFit({ availableWidth: 900, availableHeight: 450, contentWidth: 1200, contentHeight: 900, minimumTargetSize: 80 }),
    { mode: "scale", scale: 0.5 },
  );
  assert.deepEqual(
    resolveEmbeddedActivityFit({ availableWidth: 900, availableHeight: 450, contentWidth: 1200, contentHeight: 900, minimumTargetSize: 48 }),
    { mode: "scale", scale: 0.5 },
  );
  assert.deepEqual(
    resolveEmbeddedActivityFit({ availableWidth: 1600, availableHeight: 910, contentWidth: 1280, contentHeight: 728, allowUpscale: true }),
    { mode: "scale", scale: 1.25 },
  );
});

test("offline teacher solutions preserve verified, model-response, and missing-evidence states", () => {
  const multipleChoice = teacherSolutions.solutions[multipleChoiceId];
  const multipleQuestion = multipleChoice.questions[`${multipleChoiceId}-q1`];
  assert.deepEqual(multipleQuestion.correctOptionIds, [`${multipleChoiceId}-q1-o2`]);

  const typed = teacherSolutions.solutions[typedId];
  const typedQuestion = typed.questions[`${typedId}-q8`];
  assert.deepEqual(typedQuestion.acceptedAnswers, ["out/off", "out", "off"]);
  assert.equal(checkPresentationAnswers({ [typedQuestion.questionId]: " off. " }, typed)[typedQuestion.questionId], "correct");
  assert.equal(teacherSolutions.solutions[openResponseId].solutionAvailability, "model-response");
  assert.equal(Object.keys(teacherSolutions.solutions[openResponseId].questions).length, 3);
  const videoActivity = teacherSolutions.solutions["ultimate-b2-sb-u1-p2-o1"];
  assert.equal(videoActivity.solutionAvailability, "model-response");
  assert.equal(Object.keys(videoActivity.questions).length, 2);
  assert.match(videoActivity.questions["ultimate-b2-sb-u1-p2-o1-q1"].acceptedAnswers[0], /viewer in control/);
  assert.match(videoActivity.questions["ultimate-b2-sb-u1-p2-o1-q2"].acceptedAnswers[0], /physically and mentally/);
  assert.equal(teacherSolutions.solutions[missingSolutionId].solutionAvailability, "missing");
});

test("pack runtime validation rejects corrupted semantic checksums safely", async () => {
  assert.deepEqual(await validateTeacherContentPack(pack), { valid: true, reason: "" });
  const corrupt = structuredClone(pack);
  corrupt.activities.activities[0].title = "corrupted";
  const result = await validateTeacherContentPack(corrupt);
  assert.equal(result.valid, false);
  assert.match(result.reason, /Integrity check failed/);
});

test("previous and next traverse exactly the 78 enabled activities", () => {
  const sequence = enabledStudentsBookActivitySequence();
  for (let index = 0; index < sequence.length; index += 1) {
    const current = sequence[index];
    assert.equal(
      adjacentEnabledStudentsBookActivity(current.stableActivityId, -1)?.stableActivityId || null,
      sequence[index - 1]?.stableActivityId || null,
    );
    assert.equal(
      adjacentEnabledStudentsBookActivity(current.stableActivityId, 1)?.stableActivityId || null,
      sequence[index + 1]?.stableActivityId || null,
    );
  }
});

test("teacher app embeds book activities in the mounted page shell with one classroom toolbar", async () => {
  const preparation = await readFile("src/apps/android-teacher-offline/hostedComponentPreparation.js", "utf8");
  const [app, book, pages, embedded, activityLocation, overview, presentation, media, library, unitMetadata, toolbar, overlay, toolsContext, renderer, provider, storage, entry, networkGuard, pageViewerStyles, classroomToolStyles] = await Promise.all([
    readFile("src/apps/android-teacher-offline/TeacherOfflineApp.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineBook.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflinePages.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineEmbeddedActivity.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/teacherOfflineActivityLocation.js", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineUnitOverview.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflinePresentation.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineMedia.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineLibrary.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/teacherOfflineUnitMetadata.js", "utf8"),
    readFile("src/apps/android-teacher-offline/ClassroomToolbar.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/ClassroomToolOverlay.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/ClassroomToolsContext.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/NormalizedStudentsBookActivity.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/generatedPackProvider.js", "utf8"),
    readFile("src/apps/android-teacher-offline/teacherOfflineStorage.js", "utf8"),
    readFile("src/apps/android-teacher-offline/teacherOfflineEntry.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/teacherOfflineNetworkGuard.js", "utf8"),
    readFile("src/apps/android-teacher-offline/teacherOfflinePageViewer.css", "utf8"),
    readFile("src/apps/android-teacher-offline/classroomTools.css", "utf8"),
  ]);
  assert.doesNotMatch(app, /TeacherOfflinePresentation|navigation\.view === "activity"/);
  assert.match(app, /current\.view === "book" && current\.activityId[\s\S]*returnToBookPage\(\)/);
  assert.match(app, /window\.history\.pushState\(pageState[\s\S]*window\.history\.pushState\(activityState/);
  assert.match(app, /activityId=\{navigation\.activityId \|\| ""\}/);
  assert.match(book, /activeActivity=\{activeActivity\}/);
  assert.match(pages, /TeacherOfflineEmbeddedActivity/);
  assert.match(pages, /\$\{selectedBookId\}:activity:\$\{embeddedActivityId\}/);
  assert.match(pages, /activityActive \? \{\} : \{[\s\S]*onPointerDown/);
  assert.match(pages, /event\.target\.closest\?\.\("\.teacher-offline-page-hotspot"\)/);
  assert.doesNotMatch(pages, /Page activities|teacher-page-actions-trigger|teacher-offline-page-actions|actionsOpen/);
  assert.match(pages, /onBack=\{activityActive \? onCloseActivity : \(\) => onSelectPage\(""\)\}/);
  assert.equal((pages.match(/<ClassroomToolbar\b/g) || []).length, 1);
  assert.match(embedded, /TEACHER_PRESENTATION_OFFLINE/);
  assert.match(embedded, /NormalizedStudentsBookActivity/);
  assert.match(embedded, /ResizeObserver/);
  assert.match(activityLocation, /pageContainsActivity[\s\S]*pageNumbers[\s\S]*printedPage/);
  assert.match(pageViewerStyles, /\.teacher-offline-embedded-activity[\s\S]*align-items: center[\s\S]*justify-content: center[\s\S]*overflow: hidden/);
  assert.match(pageViewerStyles, /transform: scale\(var\(--embedded-activity-scale, 1\)\)/);
  assert.doesNotMatch(pageViewerStyles, /data-fit-mode="scroll"/);
  assert.match(classroomToolStyles, /\.teacher-offline-page-stage\.has-embedded-activity > \.classroom-stage-transform\s*\{[\s\S]*?min-height: 0;/);
  assert.doesNotMatch(embedded, /Back to book|Activity \{index|ClassroomToolbar|teacher-offline-presentation/);
  assert.match(presentation, /TeacherOfflinePresentation/);
  assert.match(pages, /<img[\s\S]*key=\{page\.id\}/);
  assert.match(pages, /TeacherOfflineUnitOverview/);
  assert.match(pages, /<TeacherOfflineUnitOverview[\s\S]*componentIdentity=\{componentIdentity\}/);
  assert.match(overview, /teacher-unit-page-card/);
  assert.match(overview, /buildTeacherUnitOverviewEntries\(\{ unit, selectedBookId, componentIdentity \}\)/);
  assert.match(overview, /onClick=\{\(\) => onSelectPage\(entry\.pageIds\[0\]\)\}/);
  assert.match(overview, /entry\.pages\.map\(\(candidate\) =>/);
  assert.doesNotMatch(overview, /teacher-unit-page-target|navigationTargets|role="group"/);
  assert.doesNotMatch(overview, /activities<\/small>/);
  assert.match(pages, /legacy-page-heading/);
  assert.doesNotMatch(pages, /legacy-page-navigation/);
  assert.match(pages, /<TeacherBookNavigation/);
  assert.match(pages, /ClassroomToolOverlay/);
  assert.match(pages, /ClassroomToolbar/);
  assert.doesNotMatch(pages, /requestFullscreen|Fit page|Fit width|Reset zoom/);
  assert.equal((pages.match(/<img\b/g) || []).length, 1);
  assert.equal((overview.match(/<img\b/g) || []).length, 1);
  assert.doesNotMatch(pages, /<aside/);
  assert.match(presentation, /ClassroomToolOverlay[\s\S]*ClassroomToolbar/);
  assert.match(media, /ClassroomToolOverlay[\s\S]*ClassroomToolbar/);
  assert.match(app, /ClassroomToolsProvider/);
  assert.match(toolbar, /useClassroomTools|PEN MODE|COVER MODE|SPOTLIGHT MODE|ZOOM MODE/);
  assert.doesNotMatch(toolbar, /lucide-react/);
  assert.match(toolbar, /ACTIVE_TOOL_TO_LEGACY_ID/);
  assert.match(toolbar, /selected=\{selectedTool === item\.id\}/);
  assert.match(overlay, /setPointerCapture[\s\S]*type: "stroke"/);
  assert.match(overlay, /addCover[\s\S]*setSpotlight[\s\S]*setRegionZoom/);
  assert.match(overlay, /Delete selected cover/);
  assert.doesNotMatch(overlay, /createPortal|document\.body/);
  assert.match(toolsContext, /interactive-classroom:annotations:v1/);
  assert.match(toolsContext, /past:[\s\S]*present:[\s\S]*future:/);
  assert.match(toolsContext, /drawings:[\s\S]*overlays:/);
  assert.match(toolsContext, /clearCovers[\s\S]*setSpotlight[\s\S]*clearAllMarkup/);
  for (const title of ["Respect Our Planet", "Fit For Life", "Law and Order", "You're Hired!", "Add to Cart", "Making the Grade", "Better Together", "It's Just Science!"]) assert.match(unitMetadata, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(library, /initialEditionId = "students-book"/);
  assert.match(library, /useState\(initialEditionId\)/);
  assert.match(library, /menuSkin\.editions\.map/);
  assert.doesNotMatch(library, /teacherOfflineUnitMetadata|Lights, Camera, Action/);
  assert.match(app, /units=\{packageUnitMetadata\}/);
  assert.match(app, /teacherLibraryUnitMetadata\(packageStudentsRuntime\?\.bookSlug/);
  assert.match(library, /aria-pressed=\{!unavailable && selectedEdition === edition\.id\}/);
  assert.match(app, /initialEditionId=\{activeRuntime\.component\.teacherEditionId\}/);
  assert.match(library, /menuSkin\.extras/);
  assert.match(library, /ExtrasColumn/);
  assert.doesNotMatch(library, /LockKeyhole|legacy-home-lock|Locked/);
  assert.match(library, /disabled=\{unavailable\}/);
  assert.match(library, /aria-disabled=\{available \? undefined : "true"\}/);
  assert.match(library, /aria-disabled=\{item\.destination \? undefined : "true"\}/);
  assert.match(library, /onClick=\{available \?/);
  assert.match(library, /menuSkin\.publisherLogo/);
  assert.match(library, /menuSkin\.units/);
  assert.match(library, /menuSkin\.editions/);
  assert.match(library, /LegacyMenuTitleAnimation animate=\{animationsActive\} label=\{menuSkin\.title\.animationLabel\}/);
  assert.match(library, /ClassroomToolOverlay[\s\S]*ClassroomToolbar/);
  assert.doesNotMatch(library, /Students Book cover|legacy-home-identity|homeTools|legacy-home-classroom-toolbar|Minimize|MonitorPlay|Interactive Classroom[^<]*Offline/);
  assert.doesNotMatch(library, /legacy-home-settings-button|legacy-home-close-button|legacy-home-minimize-button/);
  assert.match(toolbar, /items\.map/);
  assert.match(app, /onOpenSettings=\{\(\) => setSettingsOpen\(true\)\}/);
  assert.match(app, /onMinimize=\{minimizeApplication\}/);
  assert.match(app, /onClose=\{closeApplication\}/);
  assert.match(app, /Capacitor\.isNativePlatform\(\)[\s\S]*App\.exitApp\(\)/);
  assert.match(app, /Capacitor\.isNativePlatform\(\)[\s\S]*App\.minimizeApp\(\)[\s\S]*return;/);
  assert.match(app, /hosted && globalThis\.parent && globalThis\.parent !== globalThis[\s\S]*globalThis\.parent\.postMessage\(VIEWER_EXIT_FULLSCREEN_MESSAGE, "\*"\)/);
  assert.match(renderer, /mediaElement\.pause\(\)[\s\S]*removeAttribute\("src"\)[\s\S]*mediaElement\.load\(\)/);
  assert.match(renderer, /mediaRef\.current\?\.pause/);
  assert.match(renderer, /visibilitychange/);
  assert.match(renderer, /preload="metadata"/);
  assert.match(renderer, /onError=\{\(\) => setMediaError/);
  assert.match(app, /initialRuntime\.contentPackProvider\.load/);
  assert.match(app, /preparationCache: componentPreparationRef\.current/);
  assert.match(preparation, /preparationCache\.get\(runtime\.key\)/);
  assert.doesNotMatch(app, /\[activeRuntime, startupAttempt\]/);
  assert.match(app, /reviewComponentRegistry/);
  assert.match(app, /App\.addListener\("backButton"/);
  assert.match(app, /current\.location\?\.pageId \|\| current\.location\?\.tab === "exercises"[\s\S]*returnToUnitOverview\(\)/);
  assert.match(app, /current\.view === "media"\) returnToBookPage\(\)/);
  assert.match(app, /current\.view === "library"[\s\S]*App\.exitApp/);
  assert.match(app, /replace: true/);
  assert.doesNotMatch(app, /onSubmit|markAndroidOfflinePageComplete|saveAndroidOfflineAnswer/);
  assert.doesNotMatch(storage, /answer|solution|submission|grade/i);
  assert.match(provider, /teacher-solutions\.json/);
  assert.match(entry, /visibilitychange/);
  assert.match(entry, /pagehide/);
  assert.match(networkGuard, /\["WebSocket", "EventSource"\]/);
});

test("teacher Android shell is landscape, immersive, offline-only, and safely labeled", async () => {
  const [manifest, activity, gradle, buildScript, apkVerifier] = await Promise.all([
    readFile("android/app/src/main/AndroidManifest.xml", "utf8"),
    readFile("android/app/src/main/java/com/eduforge/offlinebooks/MainActivity.java", "utf8"),
    readFile("android/app/build.gradle", "utf8"),
    readFile("scripts/android-teacher/build-apk.mjs", "utf8"),
    readFile("scripts/android-teacher/verify-apk.mjs", "utf8"),
  ]);
  assert.match(manifest, /android:screenOrientation="landscape"/);
  assert.doesNotMatch(manifest, /android\.permission\.INTERNET/);
  assert.match(activity, /BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE/);
  assert.match(activity, /onPause\(\)[\s\S]*pauseWebMedia/);
  assert.doesNotMatch(activity, /FLAG_LAYOUT_NO_LIMITS/);
  assert.match(gradle, /teacherPresentation[\s\S]*Hamilton House LMS/);
  assert.match(buildScript, /build:android-teacher-offline[\s\S]*cap[\s\S]*run-gradle\.mjs[\s\S]*verify:android-teacher-apk/);
  assert.match(apkVerifier, /applicationId[\s\S]*applicationLabel[\s\S]*minSdk[\s\S]*targetSdk/);
});

test("teacher media mappings are checkout-local and never use raw publisher application paths", async () => {
  const [sources, runtimeAssets] = await Promise.all([
    readFile("scripts/android-teacher/pack-asset-sources.mjs", "utf8"),
    readFile("src/data/ultimate-b2/ultimateB2MediaAssets.teacher-offline.js", "utf8"),
  ]);
  assert.doesNotMatch(sources, /Ultimate English B2\.app|Contents[\\/]Resources/);
  assert.doesNotMatch(runtimeAssets, /Ultimate English B2\.app|Contents[\\/]Resources/);
  assert.match(sources, /teacher-offline-media/);
  assert.match(runtimeAssets, /teacher-offline-media/);
});

test("Teacher startup intro is first, reproducible, centered, non-skippable, and WebView-safe", async () => {
  const [introBytes, recovery, introComponent, introStyles, app, library, launcherStyles] = await Promise.all([
    readFile("src/assets/books/ultimate-b2/teacher-offline-media/ultimate-b2-startup-intro.mp4"),
    readFile("scripts/ultimate-b2/recover-startup-intro.mjs", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherStartupIntro.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/teacherStartupIntro.css", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineApp.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineLibrary.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/teacherOfflineLauncher.css", "utf8"),
  ]);
  assert.equal(createHash("sha256").update(introBytes).digest("hex"), "07c988a41eb5347c3f9e910f9fb0cc15b0b4de85056e1c08fcb3a71016f0948f");
  assert.equal(introBytes.toString("ascii", 4, 8), "ftyp");
  assert.ok(introBytes.includes(Buffer.from("avc1", "ascii")));
  assert.ok(introBytes.includes(Buffer.from("mp4a", "ascii")));
  assert.match(recovery, /8aacc2a90f2f19e529b39e09debad3af9c5c495e35a21ccf4a7c40898435655f/);
  assert.match(recovery, /Contents\/Resources\/assets\/videos\/intro\.flv/);
  assert.match(recovery, /libx264[\s\S]*yuv420p[\s\S]*25[\s\S]*aac[\s\S]*44100/);
  assert.match(introComponent, /autoPlay[\s\S]*playsInline[\s\S]*preload="auto"/);
  assert.match(introComponent, /onEnded=\{\(\) => finish\("ended"\)\}/);
  assert.match(introComponent, /onError=\{\(\) => finish\("error"\)\}/);
  assert.match(introComponent, /videoRef\.current[\s\S]*await video\.play\(\)/);
  assert.match(introComponent, /Play intro/);
  assert.doesNotMatch(introComponent, /Skip intro|finish\("skipped"\)/);
  assert.match(introStyles, /html\[data-app-mode="android-teacher-offline"\][\s\S]*background:\s*#fefefe/);
  assert.match(introStyles, /\.teacher-fixed-stage-host\[data-viewport-backdrop="intro"\][\s\S]*background:\s*#fefefe/);
  assert.match(introStyles, /\.teacher-startup-intro\s*\{[\s\S]*background:\s*#fefefe/);
  assert.match(introStyles, /\.teacher-startup-intro video\s*\{[\s\S]*background:\s*#fefefe/);
  assert.doesNotMatch(introStyles, /(?:teacher-startup-intro|teacher-viewer-startup)[^{]*\{[^}]*background:\s*#fff(?:\s|;|$)/);
  assert.match(introStyles, /place-items:\s*center/);
  assert.match(introStyles, /grid-template-rows:\s*minmax\(0, 1fr\)/);
  assert.match(introStyles, /width:\s*auto[\s\S]*height:\s*auto/);
  assert.match(introStyles, /max-width:\s*min\(90vw, 100%, 1024px\)/);
  assert.match(introStyles, /max-height:\s*min\(86dvh, 100%, 768px\)/);
  assert.match(introStyles, /object-fit:\s*contain/);
  assert.doesNotMatch(introStyles, /teacher-startup-intro-skip|background:\s*#020711/);
  assert.match(app, /startupIntroPending[\s\S]*TeacherStartupIntro/);
  assert.match(app, /if \(startupIntroPending\)[\s\S]*TeacherStartupIntro[\s\S]*componentRequest\.kind === "invalid"[\s\S]*else if \(productState\.status === "loading"\)[\s\S]*initialRuntime\.startupAssets\.hosted[\s\S]*TeacherViewerStartupStatus[\s\S]*teacher-offline-pack-wait[\s\S]*else if \(productState\.status === "error"\)/);
  assert.match(app, /runInteractiveViewerStartup\([\s\S]*initialRuntime\.contentPackProvider\.load[\s\S]*startupAssets: initialRuntime\.startupAssets/);
  assert.doesNotMatch(app, /Checking classroom content/);
  assert.doesNotMatch(app, /if \(productState\.status === "loading"\)\s*\{\s*return/);
  assert.match(app, /if \(!animationsActive \|\| hostedPreviewRequested\) setStartupIntroPending\(false\)/);
  assert.match(app, /useState\(animationsActive && !hostedPreviewRequested\)/);
  assert.match(app, /if \(startupIntroPendingRef\.current\)\s*\{\s*return;\s*\}/);
  assert.doesNotMatch(app, /if \(startupIntroPendingRef\.current\)\s*\{\s*setStartupIntroPending\(false\)/);
  assert.match(library, /legacy-home-floating-chrome/);
  assert.doesNotMatch(library, /legacy-home-topbar/);
  assert.match(launcherStyles, /\.teacher-offline-library\.has-classroom-tools::after\s*\{\s*display: none/);
  assert.match(launcherStyles, /\.legacy-home-launcher\s*\{[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/);
});

test("web and student build aliases cannot import the offline solution file", async () => {
  const [viteConfig, emptyProvider, webService] = await Promise.all([
    readFile("vite.config.js", "utf8"),
    readFile("src/apps/android-teacher-offline/noOfflineSolutions.js", "utf8"),
    readFile("src/services/bookContentApi.js", "utf8"),
  ]);
  assert.match(viteConfig, /isAndroidTeacherOffline[\s\S]*generatedPackProvider\.js[\s\S]*noOfflineSolutions\.js/);
  assert.doesNotMatch(emptyProvider, /teacher-solutions|acceptedAnswers|correctOptionIds/);
  assert.match(webService, /teacher-activity-solutions/);
  assert.doesNotMatch(webService, /android-content-packs|teacher-solutions\.json/);
});
