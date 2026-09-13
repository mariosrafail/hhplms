import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { findNativeOldschoolListeningCue, nativeOldschoolListeningCueScrollY, nativeOldschoolListeningFragmentFontSize, nativeOldschoolListeningRegionStyle, nativeOldschoolListeningScrollTarget, nativeOldschoolListeningTranscriptFragments, parseNativeOldschoolListeningSrt } from "../src/components/native-oldschool-listening/nativeOldschoolListeningRuntime.js";
import { nativeChildIdFromUuid } from "../src/data/native-activities/nativeChildIdentity.js";
import { addNativeOldschoolListeningCue, addNativeOldschoolListeningRegion, clearNativeOldschoolListeningMappings, removeNativeOldschoolListeningCue, removeNativeOldschoolListeningRegion, updateNativeOldschoolListeningRegion } from "../src/data/native-activities/nativeOldschoolListeningAuthoring.js";
import { parseNativeOldschoolListeningJson, serializeNativeOldschoolListeningJson } from "../src/data/native-activities/nativeOldschoolListeningJson.js";
import { adaptLegacyListeningAuthoringToOldschoolInteraction } from "../src/data/native-activities/legacyOldschoolListeningAdapter.js";
import { createNativeOpenResponseQuestion } from "../src/data/native-activities/nativeOpenResponse.js";
import { assessNativeOldschoolListeningReadiness, nativeOldschoolListeningAssetRequirements, normalizeNativeOldschoolListeningInteraction } from "../src/data/native-activities/nativeOldschoolListening.js";
import { switchNativeOldschoolListeningQuestionMode } from "../src/data/native-activities/nativeOldschoolListeningAuthoring.js";
import { createNativeSingleChoiceQuestion } from "../src/data/native-activities/nativeSingleChoice.js";
import { oldschoolQuestionPanel, setOldschoolQuestionMembership } from "../src/data/native-activities/nativeOldschoolQuestionSurface.js";
import { nativeOldschoolListeningQuestionPublicDocument } from "../src/data/native-activities/nativeOldschoolListening.js";
import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import legacyListeningAuthoring from "../src/data/ultimate-b2/authoring/unit-01-reading-exercise-2.listening.json" with { type: "json" };

const id = (prefix, last) => nativeChildIdFromUuid(prefix, `00000000-0000-4000-8000-${String(last).padStart(12, "0")}`);
const audio = { assetId: "10000000-0000-4000-8000-000000000001", checksumSha256: "a".repeat(64), role: "activity_artwork", slot: "oldschool-main-audio" };
const page = { assetId: "10000000-0000-4000-8000-000000000002", checksumSha256: "b".repeat(64), role: "activity_artwork", slot: "oldschool-page-image" };
const font = { assetId: "10000000-0000-4000-8000-000000000003", checksumSha256: "c".repeat(64), role: "activity_font", slot: "font-10000000000040008000000000000003" };
const choiceBackground = { assetId: "10000000-0000-4000-8000-000000000004", checksumSha256: "d".repeat(64), role: "activity_artwork", slot: "oldschool-choice-background" };

function completePair() {
  const definition = resolveNativeActivityKind("oldschool-listening");
  const publicDocument = definition.createBlankPublic({ activityId: "oldschool-listening-test", title: "Oldschool Listening", placement: { pageId: "page-1" } });
  const teacherDocument = definition.createBlankTeacher({ activityId: publicDocument.activityId });
  publicDocument.assets = [audio, page];
  const interaction = publicDocument.parts[0].interaction;
  interaction.audioAssetSlot = audio.slot;
  interaction.audioDurationMs = 8_000;
  Object.assign(interaction.panels[1], { pageAssetSlot: page.slot, sourceWidth: 1000, sourceHeight: 1800, altText: "A photographed textbook listening page" });
  const questionId = id("q", 1);
  interaction.questions.push(createNativeOpenResponseQuestion(questionId));
  teacherDocument.parts[0].solution.modelAnswers.push({ questionId, text: "The speaker recommends the train." });
  interaction.questions[0].prompt = "What does the speaker recommend?";
  interaction.cues.push(
    { id: id("cue", 2), startMs: 0, endMs: 3_000, text: "First line", highlightRegions: [{ id: id("region", 3), x: 100, y: 120, width: 700, height: 80 }, { id: id("region", 4), x: 100, y: 230, width: 420, height: 70 }], scrollY: 160 },
    { id: id("cue", 5), startMs: 3_000, endMs: 8_000, text: "Second line", highlightRegions: [{ id: id("region", 6), x: 100, y: 1200, width: 760, height: 90 }], scrollY: null },
  );
  return { definition, publicDocument, teacherDocument };
}

test("Oldschool Listening is a distinct registered kind with blank paired documents", () => {
  const definition = resolveNativeActivityKind("oldschool-listening");
  assert.equal(definition.label, "Oldschool Listening");
  const publicDocument = definition.createBlankPublic({ activityId: "blank-oldschool", title: "Blank", placement: { pageId: "page-1" } });
  const teacherDocument = definition.createBlankTeacher({ activityId: "blank-oldschool" });
  assert.equal(publicDocument.kind, "oldschool-listening");
  assert.equal(publicDocument.parts[0].interaction.panels[1].kind, "synchronized-page");
  assert.equal(publicDocument.parts[0].interaction.questionMode, "open-response");
  assert.deepEqual(teacherDocument.parts[0].solution, { kind: "oldschool-listening", questionMode: "open-response", modelAnswers: [] });
});

test("Oldschool prompt visibility round-trips independently of answers and semantic topology", () => {
  const { definition, publicDocument, teacherDocument } = completePair();
  const before = structuredClone(publicDocument);
  const interaction = publicDocument.parts[0].interaction;
  const question = interaction.questions[0];
  setOldschoolQuestionMembership(interaction, question.id, "prompt", false);
  const restored = definition.normalizePublic(JSON.parse(JSON.stringify(publicDocument)));
  assert.deepEqual(restored.parts[0].interaction.questionSurface, { promptQuestionIds: [], responseQuestionIds: [question.id] });
  assert.deepEqual(restored.parts[0].interaction.questions, before.parts[0].interaction.questions);
  assert.deepEqual(restored.parts[0].interaction.cues, before.parts[0].interaction.cues);
  assert.deepEqual(restored.parts[0].interaction.snippetHotspots, before.parts[0].interaction.snippetHotspots);
  assert.equal(definition.validatePair(restored, teacherDocument), true);
  assert.equal(definition.assessReadiness(restored, teacherDocument).ready, true);
  const projection = nativeOldschoolListeningQuestionPublicDocument(restored);
  assert.deepEqual(projection.parts[0].interaction.presentation.panels[0].promptQuestionIds, []);
  setOldschoolQuestionMembership(restored.parts[0].interaction, question.id, "prompt", true);
  assert.deepEqual(oldschoolQuestionPanel(restored.parts[0].interaction).promptQuestionIds, [question.id]);
  const old = definition.normalizePublic(before);
  assert.equal(Object.hasOwn(old.parts[0].interaction, "questionSurface"), false, "legacy projection identity has no injected visibility defaults");
  for (const invalid of [null, {}, { promptQuestionIds: [question.id, question.id], responseQuestionIds: [] }, { promptQuestionIds: ["unknown"], responseQuestionIds: [] }, { promptQuestionIds: [], responseQuestionIds: [], modelAnswers: [] }]) {
    interaction.questionSurface = invalid;
    assert.throws(() => definition.normalizePublic(publicDocument));
  }
});

test("legacy Oldschool Listening documents without a discriminator normalize deterministically as Open Response", () => {
  const { definition, publicDocument, teacherDocument } = completePair();
  delete publicDocument.parts[0].interaction.questionMode;
  delete teacherDocument.parts[0].solution.questionMode;
  const normalized = definition.normalizePublic(publicDocument);
  const normalizedTeacher = definition.normalizeTeacher(teacherDocument);
  assert.equal(normalized.parts[0].interaction.questionMode, "open-response");
  assert.equal(normalizedTeacher.parts[0].solution.questionMode, "open-response");
  assert.equal(definition.validatePair(normalized, normalizedTeacher), true);
});

test("Oldschool Listening canonical Single Choice mode round-trips with private answers", () => {
  const { definition, publicDocument, teacherDocument } = completePair();
  const interaction = publicDocument.parts[0].interaction;
  const questionId = id("q", 21);
  const optionIds = [id("opt", 22), id("opt", 23), id("opt", 24)];
  interaction.questionMode = "single-choice";
  delete interaction.artwork;
  interaction.questions = [createNativeSingleChoiceQuestion(questionId, optionIds)];
  interaction.questions[0].prompt = "Which details are stated?";
  interaction.questions[0].selectionMode = "multiple";
  interaction.questions[0].options.forEach((option, index) => { option.text = `Option ${index + 1}`; });
  teacherDocument.parts[0].solution = { kind: "oldschool-listening", questionMode: "single-choice", correctAnswers: [{ questionId, correctOptionIds: [optionIds[0], optionIds[2]] }] };
  const normalized = definition.normalizePublic(publicDocument);
  const normalizedTeacher = definition.normalizeTeacher(teacherDocument);
  assert.equal(normalized.parts[0].interaction.questionMode, "single-choice");
  assert.deepEqual(normalizedTeacher.parts[0].solution.correctAnswers[0].correctOptionIds, [optionIds[0], optionIds[2]]);
  assert.equal(definition.validatePair(normalized, normalizedTeacher), true);
  assert.equal(JSON.stringify(normalized).includes("correctOption"), false);
  assert.deepEqual(parseNativeOldschoolListeningJson(serializeNativeOldschoolListeningJson(normalized.parts[0].interaction, { assets: normalized.assets }), { assets: normalized.assets }), normalized.parts[0].interaction);
});

test("Oldschool question modes retain only valid, used canonical managed assets", () => {
  const openResponse = completePair();
  openResponse.publicDocument.assets.push(font);
  openResponse.publicDocument.parts[0].interaction.questions[0].responseRegion.presentation.answerFontAssetSlot = font.slot;
  const normalizedOpenResponse = openResponse.definition.normalizePublic(openResponse.publicDocument);
  assert.ok(nativeOldschoolListeningAssetRequirements(normalizedOpenResponse).some((requirement) => requirement.slot === font.slot && requirement.mediaType === "font/ttf"));
  const wrongFont = structuredClone(openResponse.publicDocument); wrongFont.assets.find((asset) => asset.slot === font.slot).role = "activity_artwork";
  assert.throws(() => openResponse.definition.normalizePublic(wrongFont), /component font/);
  const unusedFont = structuredClone(openResponse.publicDocument); delete unusedFont.parts[0].interaction.questions[0].responseRegion.presentation.answerFontAssetSlot;
  assert.throws(() => openResponse.definition.normalizePublic(unusedFont), /managed asset must be used/);

  const singleChoice = completePair();
  switchNativeOldschoolListeningQuestionMode(singleChoice.publicDocument, singleChoice.teacherDocument, "single-choice");
  const questionId = id("q", 31); const options = [id("opt", 32), id("opt", 33)];
  singleChoice.publicDocument.assets.push(choiceBackground);
  singleChoice.publicDocument.parts[0].interaction.questions = [createNativeSingleChoiceQuestion(questionId, options)];
  singleChoice.publicDocument.parts[0].interaction.questions[0].prompt = "Choose one.";
  singleChoice.publicDocument.parts[0].interaction.questions[0].options[0].text = "First";
  singleChoice.publicDocument.parts[0].interaction.questions[0].options[1].text = "Second";
  singleChoice.publicDocument.parts[0].interaction.presentation = { kind: "image-hotspot", panels: [{ id: id("panel", 34), backgroundAssetSlot: choiceBackground.slot, sourceWidth: 1024, sourceHeight: 582, hotspots: options.map((optionId, index) => ({ id: id("hot", 35 + index), questionId, optionId, area: { x: 100 + index * 300, y: 200, width: 200, height: 80 } })) }] };
  singleChoice.teacherDocument.parts[0].solution.correctAnswers = [{ questionId, correctOptionId: options[0] }];
  const normalizedChoice = singleChoice.definition.normalizePublic(singleChoice.publicDocument);
  assert.deepEqual(nativeOldschoolListeningAssetRequirements(normalizedChoice).at(-1), { slot: choiceBackground.slot, width: 1024, height: 582 });
  assert.equal(singleChoice.definition.validatePair(normalizedChoice, singleChoice.definition.normalizeTeacher(singleChoice.teacherDocument)), true);
});

test("Oldschool public documents reject teacher-only answer fields", () => {
  const { definition, publicDocument } = completePair();
  publicDocument.parts[0].interaction.correctAnswers = [];
  assert.throws(() => definition.normalizePublic(publicDocument), /unknown fields/);
});

test("Oldschool authoring composes canonical Open Response and shared Single Choice controls", async () => {
  const [editor, openResponsePanel, singleChoicePanel, canonicalSingleChoice] = await Promise.all([
    readFile(new URL("../src/apps/book-builder/hosted/NativeListeningEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/book-builder/hosted/NativeListeningQuestionAuthoring.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/book-builder/hosted/NativeSingleChoiceQuestionAuthoring.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/book-builder/hosted/NativeSingleChoiceEditor.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /Panel 1 activity type/);
  assert.match(openResponsePanel, /NativeOpenResponseResponseControls/);
  assert.match(openResponsePanel, /useNativeListeningResponseFonts/);
  assert.match(openResponsePanel, /NativeBulkGenerator/);
  assert.match(openResponsePanel, /target\.promptStyle\.fontSize/);
  assert.match(openResponsePanel, /target\.promptStyle\.align/);
  assert.match(editor, /NativeSingleChoiceQuestionAuthoring/);
  assert.match(editor, /NativeSingleChoiceVisualAuthoring/);
  assert.match(singleChoicePanel, /NativeBulkGenerator/);
  assert.match(canonicalSingleChoice, /NativeSingleChoiceQuestionAuthoring/);
});

test("Oldschool Listening rejects unknown modes and incompatible public/Teacher modes", () => {
  const { definition, publicDocument, teacherDocument } = completePair();
  publicDocument.parts[0].interaction.questionMode = "essay";
  assert.throws(() => definition.normalizePublic(publicDocument), /question mode/i);
  publicDocument.parts[0].interaction.questionMode = "open-response";
  teacherDocument.parts[0].solution = { kind: "oldschool-listening", questionMode: "single-choice", correctAnswers: [] };
  assert.throws(() => definition.validatePair(publicDocument, teacherDocument), /question mode/i);
});

test("switching Oldschool question mode resets only incompatible Panel 1 state", () => {
  const { publicDocument, teacherDocument } = completePair();
  publicDocument.assets.push(font); publicDocument.parts[0].interaction.questions[0].responseRegion.presentation.answerFontAssetSlot = font.slot;
  publicDocument.readableText = { kind: "image", assetSlot: page.slot, sourceWidth: 1000, sourceHeight: 1800, altText: "Readable page" };
  const beforePanelTwo = structuredClone(publicDocument.parts[0].interaction.panels[1]);
  const beforeCues = structuredClone(publicDocument.parts[0].interaction.cues);
  const beforeSnippets = structuredClone(publicDocument.parts[0].interaction.snippetHotspots);
  switchNativeOldschoolListeningQuestionMode(publicDocument, teacherDocument, "single-choice");
  const interaction = publicDocument.parts[0].interaction;
  assert.equal(interaction.questionMode, "single-choice");
  assert.deepEqual(interaction.questions, []);
  assert.equal(Object.hasOwn(interaction, "artwork"), false);
  assert.deepEqual(interaction.panels[1], beforePanelTwo);
  assert.deepEqual(interaction.cues, beforeCues);
  assert.deepEqual(interaction.snippetHotspots, beforeSnippets);
  assert.equal(publicDocument.readableText.altText, "Readable page");
  assert.equal(publicDocument.assets.some((asset) => asset.slot === font.slot), false);
  assert.deepEqual(teacherDocument.parts[0].solution, { kind: "oldschool-listening", questionMode: "single-choice", correctAnswers: [] });
});

test("Oldschool Listening normalizes multiple source-pixel highlight regions and paired Teacher answers", () => {
  const { definition, publicDocument, teacherDocument } = completePair();
  const normalized = definition.normalizePublic(publicDocument);
  const normalizedTeacher = definition.normalizeTeacher(teacherDocument);
  assert.equal(normalized.parts[0].interaction.cues[0].highlightRegions.length, 2);
  assert.equal(definition.validatePair(normalized, normalizedTeacher), true);
  assert.deepEqual(nativeOldschoolListeningAssetRequirements(normalized), [
    { slot: audio.slot, mediaType: "audio/mpeg", label: "Oldschool Listening MP3" },
    { slot: page.slot, width: 1000, height: 1800, label: "Oldschool Listening page image" },
  ]);
  assert.deepEqual(assessNativeOldschoolListeningReadiness(normalized, normalizedTeacher), { ready: true, issues: [] });
  assert.equal(JSON.stringify(normalized).includes("speaker recommends"), false);
});

test("current regions without fragment text remain valid and receive a deterministic source-positioned transcript fallback", () => {
  const { publicDocument } = completePair();
  const interaction = normalizeNativeOldschoolListeningInteraction(publicDocument.parts[0].interaction, { assets: publicDocument.assets });
  assert.equal(Object.hasOwn(interaction.cues[0].highlightRegions[0], "text"), false);
  const fragments = nativeOldschoolListeningTranscriptFragments(interaction.cues);
  const firstCueFragments = fragments.filter((fragment) => fragment.cueId === interaction.cues[0].id);
  assert.equal(firstCueFragments.length, 2);
  assert.equal(firstCueFragments.map((fragment) => fragment.text).filter(Boolean).join(" "), interaction.cues[0].text);
  assert.deepEqual(firstCueFragments.map(({ x, y, width, height }) => ({ x, y, width, height })), interaction.cues[0].highlightRegions.map(({ x, y, width, height }) => ({ x, y, width, height })));
});

test("partially enriched mappings safely fall back to the complete cue wording", () => {
  const { publicDocument } = completePair();
  publicDocument.parts[0].interaction.cues[0].highlightRegions[0].text = "A retained exact fragment";
  const interaction = normalizeNativeOldschoolListeningInteraction(publicDocument.parts[0].interaction, { assets: publicDocument.assets });
  const fragments = nativeOldschoolListeningTranscriptFragments(interaction.cues).filter((fragment) => fragment.cueId === interaction.cues[0].id);
  assert.equal(fragments.every((fragment) => fragment.exact === false), true);
  assert.equal(fragments.map((fragment) => fragment.text).filter(Boolean).join(" "), interaction.cues[0].text);
});

test("legacy exact fragments without authored styles retain uniform 21px while fallback fitting remains safe", () => {
  const exactFragments = [
    { exact: true, text: "What", width: 36, height: 20 },
    { exact: true, text: "A deliberately long exact source fragment that must never auto-shrink", width: 900, height: 31 },
    { exact: true, text: "Wide", width: 1_200, height: 90 },
    { exact: true, text: "Narrow exact source text", width: 24, height: 12 },
  ];
  assert.deepEqual(exactFragments.map(nativeOldschoolListeningFragmentFontSize), [21, 21, 21, 21]);
  assert.equal(nativeOldschoolListeningFragmentFontSize({ exact: false, text: "A deliberately long fallback fragment that still needs safe fitting", width: 40, height: 20 }), 5.6);
});

test("Oldschool Listening rejects unknown fields, overlaps, out-of-bounds geometry, and cues beyond duration", () => {
  const { publicDocument } = completePair();
  const context = { assets: publicDocument.assets };
  const interaction = publicDocument.parts[0].interaction;
  assert.throws(() => normalizeNativeOldschoolListeningInteraction({ ...interaction, transcriptHtml: "<b>unsafe</b>" }, context), /unknown fields/);
  const overlap = structuredClone(interaction); overlap.cues[1].startMs = 2_999;
  assert.throws(() => normalizeNativeOldschoolListeningInteraction(overlap, context), /ordered and non-overlapping/);
  const beyond = structuredClone(interaction); beyond.cues[1].endMs = 8_001;
  assert.throws(() => normalizeNativeOldschoolListeningInteraction(beyond, context), /exceeds the audio duration/);
  const outside = structuredClone(interaction); outside.cues[0].highlightRegions[0].x = 999;
  assert.throws(() => normalizeNativeOldschoolListeningInteraction(outside, context), /stay inside/);
});

test("cue lookup is half-open and authored or derived scroll targets remain bounded", () => {
  const { publicDocument } = completePair();
  const cues = publicDocument.parts[0].interaction.cues;
  assert.equal(findNativeOldschoolListeningCue(cues, 2_999).id, cues[0].id);
  assert.equal(findNativeOldschoolListeningCue(cues, 3_000).id, cues[1].id);
  assert.equal(findNativeOldschoolListeningCue(cues, 8_000), null);
  assert.equal(nativeOldschoolListeningCueScrollY(cues[0]), 160);
  assert.equal(nativeOldschoolListeningCueScrollY(cues[1]), 1245);
  assert.equal(nativeOldschoolListeningScrollTarget({ targetY: 1600, sourceHeight: 1800, renderedHeight: 1800, scrollTop: 0, viewportHeight: 500 }), 1300);
  assert.equal(nativeOldschoolListeningScrollTarget({ targetY: 200, sourceHeight: 1800, renderedHeight: 1800, scrollTop: 0, viewportHeight: 500 }), 0);
  assert.deepEqual(nativeOldschoolListeningRegionStyle(cues[0].highlightRegions[0], { width: 1000, height: 1800 }), { left: "10%", top: `${120 / 1800 * 100}%`, width: "70%", height: `${80 / 1800 * 100}%` });
});

test("SRT import is strict and creates intentionally unmapped cues", () => {
  const cues = parseNativeOldschoolListeningSrt("1\n00:00:00,000 --> 00:00:01,500\nMapped later", { createId: () => id("cue", 7) });
  assert.deepEqual(cues[0].highlightRegions, []);
  assert.equal(cues[0].scrollY, null);
  assert.throws(() => parseNativeOldschoolListeningSrt("not srt", { createId: () => id("cue", 8) }), /SRT/);
  const markup = parseNativeOldschoolListeningSrt("1\n00:00:00,000 --> 00:00:01,000\n<img src=x onerror=alert(1)>", { createId: () => id("cue", 10) });
  assert.equal(markup[0].text, "<img src=x onerror=alert(1)>");
});

test("mapping authoring supports add, move/resize, delete, and explicit clear", () => {
  const cue = { highlightRegions: [] };
  const region = addNativeOldschoolListeningRegion(cue, { x: 10.2, y: 20.7, width: 99.5, height: 49.5 }, { createId: () => id("region", 9) });
  assert.deepEqual({ x: region.x, y: region.y, width: region.width, height: region.height }, { x: 10, y: 21, width: 100, height: 50 });
  updateNativeOldschoolListeningRegion(cue, region.id, { x: 30, y: 40, width: 110, height: 60 });
  assert.equal(cue.highlightRegions[0].x, 30);
  assert.equal(removeNativeOldschoolListeningRegion(cue, region.id).id, region.id);
  const interaction = { cues: [{ highlightRegions: [{ id: "one" }], scrollY: 10 }, { highlightRegions: [{ id: "two" }], scrollY: null }] };
  clearNativeOldschoolListeningMappings(interaction);
  assert.deepEqual(interaction.cues, [{ highlightRegions: [], scrollY: null }, { highlightRegions: [], scrollY: null }]);
});

test("cue authoring creates stable identities, orders cues, and removes dependent snippet references", () => {
  const interaction = { cues: [{ id: id("cue", 12), startMs: 2_000, endMs: 3_000, text: "Later", highlightRegions: [], scrollY: null }], snippetHotspots: [{ id: id("aud", 13), cueIds: [id("cue", 11), id("cue", 12)] }, { id: id("aud", 14), cueIds: [id("cue", 11)] }] };
  const created = addNativeOldschoolListeningCue(interaction, { startMs: 0.4, endMs: 1_000.4, text: "Earlier" }, { createId: () => id("cue", 11) });
  assert.equal(interaction.cues[0].id, created.id);
  assert.deepEqual(created.highlightRegions, []);
  assert.equal(removeNativeOldschoolListeningCue(interaction, created.id).id, created.id);
  assert.deepEqual(interaction.snippetHotspots, [{ id: id("aud", 13), cueIds: [id("cue", 12)] }]);
});

test("readiness exposes actionable timing, text, geometry, mapping, and duration failures", () => {
  const { publicDocument, teacherDocument } = completePair();
  const cues = publicDocument.parts[0].interaction.cues;
  cues[0].text = "";
  cues[1].startMs = 2_900;
  cues[1].endMs = 8_001;
  cues[1].highlightRegions[0].y = 1_799;
  const result = assessNativeOldschoolListeningReadiness(publicDocument, teacherDocument);
  assert.equal(result.ready, false);
  assert.match(result.issues.join("\n"), /needs text|overlaps the previous cue|extends beyond|must stay inside/);
});

test("canonical JSON interchange round-trips only validated exact Oldschool Listening data", () => {
  const { publicDocument } = completePair();
  const context = { assets: publicDocument.assets };
  publicDocument.parts[0].interaction.cues[0].highlightRegions[0].text = "The opening source fragment";
  publicDocument.parts[0].interaction.cues[0].highlightRegions[1].text = "continues here.";
  const serialized = serializeNativeOldschoolListeningJson(publicDocument.parts[0].interaction, context);
  assert.deepEqual(parseNativeOldschoolListeningJson(serialized, context), normalizeNativeOldschoolListeningInteraction(publicDocument.parts[0].interaction, context));
  assert.deepEqual(parseNativeOldschoolListeningJson(serialized, context).cues[0].highlightRegions.map((region) => region.text), ["The opening source fragment", "continues here."]);
  const unknown = JSON.parse(serialized); unknown.fetchUrl = "https://example.invalid/";
  assert.throws(() => parseNativeOldschoolListeningJson(JSON.stringify(unknown), context), /unknown fields/);
  const unknownRegion = JSON.parse(serialized); unknownRegion.cues[0].highlightRegions[0].html = "<b>unsafe</b>";
  assert.throws(() => parseNativeOldschoolListeningJson(JSON.stringify(unknownRegion), context), /unknown fields/);
  const plainText = JSON.parse(serialized); plainText.cues[0].highlightRegions[0].text = "<img src=x onerror=alert(1)>";
  assert.equal(parseNativeOldschoolListeningJson(JSON.stringify(plainText), context).cues[0].highlightRegions[0].text, "<img src=x onerror=alert(1)>");
  assert.throws(() => parseNativeOldschoolListeningJson("x".repeat(1024 * 1024 + 1), context), /1 MiB/);
});

test("tracked legacy Object 2 deterministically adapts 37 cues, 98 positioned facts, multi-region cues, and authored scroll behavior", () => {
  assert.equal(legacyListeningAuthoring.activityId, "ultimate-b2-sb-u1-p2-o2");
  assert.equal(legacyListeningAuthoring.karaoke.cues.length, 37);
  assert.equal(legacyListeningAuthoring.karaoke.fragments.length, 98);
  assert.equal(legacyListeningAuthoring.karaoke.scrollTimeline.length, 8);
  const interaction = adaptLegacyListeningAuthoringToOldschoolInteraction(legacyListeningAuthoring, { audioAssetSlot: audio.slot, pageAssetSlot: page.slot, audioDurationMs: legacyListeningAuthoring.karaoke.cues.at(-1).endMs, pageAltText: "Recovered positioned listening text" });
  const normalized = normalizeNativeOldschoolListeningInteraction(interaction, { assets: [audio, page] });
  assert.equal(normalized.cues.length, 37);
  assert.equal(normalized.cues.reduce((count, cue) => count + cue.highlightRegions.length, 0), 98);
  assert.equal(normalized.cues.flatMap((cue) => cue.highlightRegions).every((region) => typeof region.text === "string" && region.text.length > 0), true);
  const sourceFragments = new Map(legacyListeningAuthoring.karaoke.fragments.map((fragment) => [fragment.id, fragment]));
  assert.deepEqual(normalized.cues.flatMap((cue) => cue.highlightRegions).map((region) => region.text), legacyListeningAuthoring.karaoke.cues.flatMap((cue) => cue.fragmentIds.map((fragmentId) => sourceFragments.get(fragmentId).runs.map((run) => run.text).join(""))));
  assert.ok(normalized.cues.some((cue) => cue.highlightRegions.length > 1));
  assert.ok(new Set(normalized.cues.map((cue) => cue.scrollY).filter((value) => value !== null)).size > 1);
  const later = normalized.cues.at(-2); const earlier = normalized.cues[2];
  assert.equal(findNativeOldschoolListeningCue(normalized.cues, later.startMs).id, later.id);
  assert.equal(findNativeOldschoolListeningCue(normalized.cues, earlier.startMs).id, earlier.id);
  assert.ok(normalized.cues.every((cue) => cue.highlightRegions.every((region) => region.x + region.width <= normalized.panels[1].sourceWidth && region.y + region.height <= normalized.panels[1].sourceHeight)));
  const crossColumnCue = normalized.cues.find((cue) => cue.highlightRegions.some((region, index) => index && region.y < cue.highlightRegions[index - 1].y));
  assert.ok(crossColumnCue, "tracked reading order must retain a cue that crosses from the left column to the top of the right column");
  const rendered = nativeOldschoolListeningTranscriptFragments(normalized.cues).filter((fragment) => fragment.cueId === crossColumnCue.id);
  assert.deepEqual(rendered.map((fragment) => fragment.regionId), crossColumnCue.highlightRegions.map((region) => region.id));
  assert.deepEqual(rendered.map((fragment) => fragment.text), crossColumnCue.highlightRegions.map((region) => region.text));
});
