import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "./_vite-test-server.mjs";

import { extractMultipleChoiceAuthoring } from "../scripts/ultimate-b2/extract-multiple-choice-authoring.mjs";
import { ultimateB2MultipleChoiceBuilderPlugin } from "../scripts/ultimate-b2/multiple-choice-builder-vite-plugin.mjs";
import authoring from "../src/data/ultimate-b2/authoring/unit-01-reading-exercise-3.multiple-choice.json" with { type: "json" };
import { normalizeMultipleChoiceAuthoring } from "../src/data/ultimate-b2/multipleChoiceAuthoringSchema.js";

const sourceRoot = "C:/Users/mario/Nextcloud/hhplms/Ultimate English B2.app/Contents/Resources/assets/books/book1/unit/1/part2/obj3";

test("tracked Object 3 authoring preserves the decoded two-panel source model", () => {
  const normalized = normalizeMultipleChoiceAuthoring(authoring);
  assert.equal(normalized.activityId, "ultimate-b2-sb-u1-p2-o3");
  assert.equal(normalized.source.totalPages, 2);
  assert.deepEqual(normalized.panels.map((panel) => panel.imageAsset), ["image_1.png", "image_3.png"]);
  assert.deepEqual(normalized.panels.map((panel) => panel.questionIds.length), [4, 2]);
  assert.equal(normalized.panels[0].instructionArea.y, 18);
  assert.equal(normalized.questions.length, 6);
  assert.ok(normalized.questions.every((question) => question.options.length === 4));
  assert.deepEqual(normalized.questions.map((question) => question.correctOptionId.at(-1)), ["2", "3", "1", "1", "3", "4"]);
  assert.deepEqual(normalized.questions.map((question) => question.highlightRegions.length), [2, 3, 3, 2, 8, 5]);
  assert.equal(normalized.questions.reduce((sum, question) => sum + question.highlightRegions.length, 0), 23);
  assert.deepEqual(normalized.questions.map((question) => question.audioLogicalKey.at(-1)), ["1", "2", "3", "4", "5", "6"]);
  assert.throws(() => normalizeMultipleChoiceAuthoring({ ...authoring, arbitraryPath: "C:/escape" }), /unsupported field/);
  assert.throws(() => normalizeMultipleChoiceAuthoring({ ...authoring, questions: [{ ...authoring.questions[0], options: [] }] }), /exactly four options/);
});

test("publisher IWB extraction independently reproduces the tracked Object 3 manifest", { skip: !existsSync(sourceRoot) }, async () => {
  const extracted = await extractMultipleChoiceAuthoring({ source: sourceRoot });
  assert.deepEqual(extracted, normalizeMultipleChoiceAuthoring(authoring));
});

test("local Object 3 endpoint validates, preserves source evidence, and atomically saves edits", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hhplms-object3-endpoint-"));
  const authoringPath = path.join(directory, "object3.json");
  await writeFile(authoringPath, `${JSON.stringify(authoring, null, 2)}\n`);
  const server = await createServer({ configFile: false, appType: "custom", logLevel: "silent", plugins: [ultimateB2MultipleChoiceBuilderPlugin({ authoringPath })], server: { host: "127.0.0.1", port: 0 } });
  try {
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const edited = structuredClone(authoring);
    edited.questions[0].options[0].area.x += 1;
    edited.questions[0].highlightRegions[0].x += 1;
    edited.source.path = "assets/books/book1/unit/1/part2/changed";
    const response = await fetch(`${base}/__hhplms/ultimate-b2-multiple-choice-authoring`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edited) });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.questions[0].options[0].area.x, authoring.questions[0].options[0].area.x + 1);
    assert.equal(saved.questions[0].highlightRegions[0].x, authoring.questions[0].highlightRegions[0].x + 1);
    assert.equal(saved.source.path, authoring.source.path);
    assert.deepEqual(JSON.parse(await readFile(authoringPath, "utf8")), saved);
    const rejected = await fetch(`${base}/__hhplms/ultimate-b2-multiple-choice-authoring`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...edited, arbitraryPath: "C:/escape" }) });
    assert.equal(rejected.status, 400);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Object 3 runtime and builder expose bounded navigation, feedback, area editors, and preview", async () => {
  const [runtime, runtimeCss, pages, navigation, embedded, activityBuilder, registry, builder, entry] = await Promise.all([
    readFile("src/components/lms/activities/ultimate-b2/TeacherLegacyMultipleChoiceActivity.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/teacherLegacyMultipleChoiceActivity.css", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflinePages.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherBookNavigationCore.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineEmbeddedActivity.jsx", "utf8"),
    readFile("src/apps/ultimate-b2-builder/UltimateB2ActivityBuilder.jsx", "utf8"),
    readFile("src/apps/ultimate-b2-builder/activityEditorRegistry.js", "utf8"),
    readFile("src/apps/ultimate-b2-builder/UltimateB2MultipleChoiceBuilder.jsx", "utf8"),
    readFile("src/apps/ultimate-b2-builder/activityBuilderEntry.jsx", "utf8"),
  ]);
  assert.match(runtime, /attempts[\s\S]*solved/);
  assert.match(runtime, /option\.id === question\.correctOptionId/);
  assert.match(runtime, /disabled=\{Boolean\(solved\[question\.id\]\)\}/);
  assert.match(runtime, /onEnded=\{returnToQuestions\}/);
  assert.match(runtime, /returnPanelRef/);
  assert.match(runtime, /useExclusiveMediaPlayback/);
  assert.doesNotMatch(runtime, /teacher-multiple-choice-part-indicator|Part \{panel\.number\} \/ \{panels\.length\}/);
  assert.match(runtimeCss, /width: 1280px[\s\S]*height: 728px/);
  assert.match(runtimeCss, /is-wrong[\s\S]*#b42318/);
  assert.match(runtimeCss, /is-correct[\s\S]*#067647/);
  assert.match(pages, /multipleChoiceAvailable/);
  assert.match(pages, /internalNavigation/);
  assert.match(pages, /toggle-text[\s\S]*previous-panel[\s\S]*next-panel/);
  assert.match(navigation, /Previous activity part[\s\S]*Next activity part/);
  assert.match(embedded, /virtual:ultimate-b2-multiple-choice-presentation/);
  assert.match(activityBuilder, /ultimateB2ActivityEditorRegistry/);
  assert.match(registry, /UltimateB2ListeningBuilder[\s\S]*UltimateB2MultipleChoiceBuilder/);
  for (const section of ["Overview", "Panels / Parts", "Questions & Answers", "Highlight Audio / Text Links", "Preview"]) assert.match(builder, new RegExp(section.replace(/[ /]/g, ".*")));
  assert.match(builder, /EditableHotspotLayer/);
  assert.match(builder, /TeacherLegacyMultipleChoiceActivity/);
  assert.match(builder, /beforeunload/);
  assert.match(entry, /ultimateB2MultipleChoiceBuilder\.css/);
});

test("answer-key authoring enters through the teacher-only shell, not shared asset bindings", async () => {
  const [assets, shared, teacherEntry] = await Promise.all([
    readFile("src/data/ultimate-b2/unit1Part2LegacyPilotAssets.js", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/UltimateB2LegacyPilotActivity.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineEmbeddedActivity.jsx", "utf8"),
  ]);
  assert.doesNotMatch(assets, /correctOptionId/);
  assert.doesNotMatch(shared, /unit-01-reading-exercise-3\.multiple-choice\.json/);
  assert.match(teacherEntry, /multipleChoiceAuthoring/);
});
