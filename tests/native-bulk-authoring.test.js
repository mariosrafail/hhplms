import assert from "node:assert/strict";
import test from "node:test";

import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import {
  generateNativeBulkCandidate,
  parseNativeCompleteSentencesBulk,
  parseNativeDragDropBulk,
  parseNativeOpenResponseBulk,
  parseNativeSingleChoiceBulk,
} from "../src/data/native-activities/nativeBulkAuthoring.js";
import { promoteNativeOpenResponsePanels } from "../src/data/native-activities/nativeOpenResponse.js";
import { nativeAssignmentCapability, NATIVE_RESPONSE_SCHEMA_VERSION } from "../netlify/functions/_book-content/native-assignment-runtime.js";

const activityId = "bulk-authoring-test";
const placement = { pageId: "page-1" };
let child = 1;
const createId = (prefix) => `${prefix}-${String(child++).padStart(32, "0")}`;

function blank(kind) {
  const definition = resolveNativeActivityKind(kind);
  return {
    publicDocument: definition.createBlankPublic({ activityId, title: "Bulk test", placement }),
    teacherDocument: definition.createBlankTeacher({ activityId }),
  };
}

test("Complete bulk parser strips numbering, preserves multiline prompts, alternatives, and escapes", () => {
  const parsed = parseNativeCompleteSentencesBulk("\r\n7) First line\rcontinued *up/out*.\r\n\r\n9. Use *round\\/around* here.\r\n");
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].prompt, "First line\ncontinued [[blank]].");
  assert.deepEqual(parsed[0].acceptedTexts, ["up", "out"]);
  assert.equal(parsed[0].displayText, "up/out");
  assert.deepEqual(parsed[1].acceptedTexts, ["round/around"]);
  assert.doesNotMatch(parsed.map((item) => item.prompt).join(""), /^7|^9/m);
});

test("Complete and Drag & Drop marked parsing reject ambiguity with source diagnostics", () => {
  assert.throws(() => parseNativeCompleteSentencesBulk("1. Valid *one*.\n\n2. Missing answer"), /Item 2, line 3: exactly one answer segment/);
  assert.throws(() => parseNativeCompleteSentencesBulk("1. Bad *up\/*"), /alternatives cannot be empty/);
  assert.throws(() => parseNativeCompleteSentencesBulk("1. Bad *same\/same*"), /unique/);
  assert.throws(() => parseNativeDragDropBulk("1. Bad *one* and *two*"), /exactly one marked answer segment/);
});

test("Drag & Drop keeps a slash-marked segment as one label and preserves duplicates", () => {
  const parsed = parseNativeDragDropBulk("1. Turn *down*.\n2. They turned *up/out*.\n3. Again *down*.");
  assert.deepEqual(parsed.map((item) => item.text), ["down", "up/out", "down"]);
});

test("Multiple Choice parser derives single and multiple modes without truncating options", () => {
  const parsed = parseNativeSingleChoiceBulk("1. Single prompt\n*right\nwrong\n\\*literal leading asterisk\n\n2) Multiple prompt\n*right 1\nwrong\n*right 2");
  assert.equal(parsed[0].selectionMode, "single");
  assert.deepEqual(parsed[0].options.map(({ text, correct }) => [text, correct]), [["right", true], ["wrong", false], ["*literal leading asterisk", false]]);
  assert.equal(parsed[1].selectionMode, "multiple");
  assert.deepEqual(parsed[1].options.filter((option) => option.correct).map((option) => option.text), ["right 1", "right 2"]);
  assert.throws(() => parseNativeSingleChoiceBulk("1. Broken\nright\nwrong"), /Question 1, line 1: at least one option must begin with/);
  assert.throws(() => parseNativeSingleChoiceBulk("1. Too many\n*a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk"), /line 12: no more than 10 options/);
});

test("Open Response parser supports prompt continuation and one or two multiline answer blocks", () => {
  const parsed = parseNativeOpenResponseBulk("1. Prompt line\ncontinued prompt\n*first line\nsecond line*\n*alternative*\n\n2) Second prompt\n*only answer*");
  assert.deepEqual(parsed[0], { prompt: "Prompt line\ncontinued prompt", modelAnswers: ["first line\nsecond line", "alternative"], sourceLine: 1 });
  assert.deepEqual(parsed[1].modelAnswers, ["only answer"]);
  assert.throws(() => parseNativeOpenResponseBulk("1. Missing answer"), /one or two model answers/);
  assert.throws(() => parseNativeOpenResponseBulk("1. Prompt\n*one*\n*two*\n*three*"), /line 4: no more than two/);
  assert.throws(() => parseNativeOpenResponseBulk("1. Prompt\n*answer*\ntrailing"), /line 3: unsupported content/);
});

test("bulk parsers preserve Unicode plain text and reject markup or forbidden controls", () => {
  assert.equal(parseNativeCompleteSentencesBulk("1. Pokémon’s answer is *σωστό*.")[0].acceptedTexts[0], "σωστό");
  assert.equal(parseNativeDragDropBulk("1. Keep *back\\\\slash*.")[0].text, "back\\slash");
  assert.throws(() => parseNativeSingleChoiceBulk("1. <script>prompt</script>\n*yes\nno"), /prompt is invalid/);
  assert.throws(() => parseNativeOpenResponseBulk("1. Prompt\n*answer\u0000*"), /model answer is invalid/);
  assert.throws(() => parseNativeSingleChoiceBulk("1. Prompt\n*yes\tvalue\nno"), /option is invalid/);
});

test("Complete candidate generation is transactional, exact-mode, and preserves ordinal hotspot geometry", () => {
  child = 1;
  const pair = blank("complete-sentences");
  const itemId = createId("item"); const hotspotId = createId("hot");
  pair.publicDocument.parts[0].interaction.items = [{ id: itemId, prompt: "Old [[blank]]" }];
  pair.publicDocument.parts[0].interaction.presentation.panels[0].hotspots = [{ id: hotspotId, itemId, area: { x: 10, y: 20, width: 100, height: 40 } }];
  pair.teacherDocument.parts[0].solution.answers = [{ itemId, text: "old" }];
  const before = structuredClone(pair);
  assert.throws(() => generateNativeBulkCandidate({ kind: "complete-sentences", source: "1. New *up/out*.", ...pair, createId }), /Replace existing content/);
  assert.deepEqual(pair, before);
  const result = generateNativeBulkCandidate({ kind: "complete-sentences", source: "1. New *up/out*.", ...pair, replaceExisting: true, createId });
  assert.equal(result.publicDocument.parts[0].interaction.evaluationMode, "exact-answer");
  assert.equal(result.publicDocument.parts[0].interaction.items[0].id, itemId);
  assert.deepEqual(result.publicDocument.parts[0].interaction.presentation.panels[0].hotspots[0].area, { x: 10, y: 20, width: 100, height: 40 });
  assert.deepEqual(result.teacherDocument.parts[0].solution.answers[0].acceptedTexts, ["up", "out"]);
  assert.doesNotMatch(JSON.stringify(result.publicDocument), /acceptedTexts|\"up\"|\"out\"/);
  const capability = nativeAssignmentCapability("complete-sentences", result.publicDocument);
  const score = (value) => {
    const normalized = capability.normalizeResponse(result.publicDocument, { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [{ id: itemId, value }] });
    return capability.evaluateResponse(result.publicDocument, result.teacherDocument, normalized.payload).scorePercent;
  };
  assert.equal(score("up"), 100);
  assert.equal(score("out"), 100);
  assert.equal(score("up/out"), 0, "the display spelling is not implicitly accepted");
  assert.deepEqual(pair, before, "candidate construction never mutates the current draft pair");
});

test("Multiple Choice candidate reuses ordinal identities and filters only surplus visual bindings", () => {
  child = 20;
  const pair = blank("single-choice");
  const questionId = createId("q"); const optionIds = [createId("opt"), createId("opt"), createId("opt")];
  pair.publicDocument.parts[0].interaction.questions = [{ id: questionId, prompt: "Old", options: optionIds.map((id, index) => ({ id, text: `Old ${index}` })) }];
  pair.teacherDocument.parts[0].solution.correctAnswers = [{ questionId, correctOptionId: optionIds[0] }];
  pair.publicDocument.assets = [{ assetId: "10000000-0000-4000-8000-000000000020", checksumSha256: "a".repeat(64), role: "activity_artwork", slot: "bulk-choice-background" }];
  const panelId = createId("panel");
  pair.publicDocument.parts[0].interaction.presentation = { kind: "image-hotspot", panels: [{ id: panelId, backgroundAssetSlot: "bulk-choice-background", sourceWidth: 1024, sourceHeight: 582, hotspots: optionIds.map((optionId, index) => ({ id: createId("hot"), questionId, optionId, area: { x: 20 + index * 120, y: 30, width: 100, height: 40 } })) }] };
  const oldAreas = pair.publicDocument.parts[0].interaction.presentation.panels[0].hotspots.map((hotspot) => hotspot.area);
  const result = generateNativeBulkCandidate({ kind: "single-choice", source: "1. New prompt\n*First\nSecond", ...pair, replaceExisting: true, createId });
  const question = result.publicDocument.parts[0].interaction.questions[0];
  assert.equal(question.id, questionId);
  assert.deepEqual(question.options.map((option) => option.id), optionIds.slice(0, 2));
  assert.equal(question.selectionMode, "single");
  assert.deepEqual(result.teacherDocument.parts[0].solution.correctAnswers[0].correctOptionIds, [optionIds[0]]);
  assert.deepEqual(result.publicDocument.parts[0].interaction.presentation.panels[0].hotspots.map((hotspot) => hotspot.area), oldAreas.slice(0, 2));
  assert.equal(result.readiness.ready, true);
});

test("Open Response candidate preserves reused geometry and assigns only new questions to the first panel", () => {
  child = 40;
  const pair = blank("open-response");
  pair.publicDocument.parts[0].interaction = promoteNativeOpenResponsePanels(pair.publicDocument.parts[0].interaction);
  const readableAsset = { assetId: "10000000-0000-4000-8000-000000000041", checksumSha256: "b".repeat(64), role: "activity_artwork", slot: "bulk-readable" };
  const videoAsset = { assetId: "10000000-0000-4000-8000-000000000042", checksumSha256: "c".repeat(64), role: "activity_artwork", slot: "bulk-video" };
  pair.publicDocument.assets = [readableAsset, videoAsset];
  pair.publicDocument.readableText = { kind: "image", assetSlot: readableAsset.slot, sourceWidth: 640, sourceHeight: 480, altText: "Readable companion" };
  pair.publicDocument.video = { kind: "managed-mp4", assetSlot: videoAsset.slot, fileName: "companion.mp4", byteSize: 1000, durationMs: 2000, cues: [{ id: `cue-${"4".repeat(32)}`, startMs: 0, endMs: 1000, text: "Caption" }] };
  const result = generateNativeBulkCandidate({ kind: "open-response", source: "1. First\n*Answer one*\n\n2. Second\n*Answer two*\n*Alternative*", ...pair, createId });
  assert.equal(result.publicDocument.parts[0].interaction.questions.length, 2);
  assert.deepEqual(result.publicDocument.parts[0].interaction.presentation.panels[0].questionIds, result.publicDocument.parts[0].interaction.questions.map((question) => question.id));
  assert.equal(result.teacherDocument.parts[0].solution.modelAnswers[0].text, "Answer one");
  assert.deepEqual(result.teacherDocument.parts[0].solution.modelAnswers[1].modelAnswerTexts, ["Answer two", "Alternative"]);
  assert.deepEqual(result.publicDocument.readableText, pair.publicDocument.readableText);
  assert.deepEqual(result.publicDocument.video, pair.publicDocument.video);
  const replaced = generateNativeBulkCandidate({ kind: "open-response", source: "1. Edited\n*New answer*", publicDocument: result.publicDocument, teacherDocument: result.teacherDocument, replaceExisting: true, createId });
  assert.equal(replaced.publicDocument.parts[0].interaction.questions[0].id, result.publicDocument.parts[0].interaction.questions[0].id);
  assert.deepEqual(replaced.publicDocument.parts[0].interaction.questions[0].responseRegion.area, result.publicDocument.parts[0].interaction.questions[0].responseRegion.area);
});

test("Drag & Drop candidate preserves target geometry, maps by ordinal, and reports mismatches", () => {
  child = 60;
  const pair = blank("drag-drop");
  const panelId = createId("panel"); const targets = [createId("target"), createId("target")];
  pair.publicDocument.parts[0].interaction.panels = [{ id: panelId, surface: { width: 1024, height: 582 }, images: [], dropTargets: targets.map((id, index) => ({ id, area: { x: 20 + index * 100, y: 30, width: 80, height: 40 }, accessibleLabel: `Target ${index + 1}` })) }];
  const result = generateNativeBulkCandidate({ kind: "drag-drop", source: "1. One *down*.\n2. Two *up/out*.", ...pair, createId });
  assert.deepEqual(result.publicDocument.parts[0].interaction.words.map((word) => word.text), ["down", "up/out"]);
  assert.deepEqual(result.teacherDocument.parts[0].solution.mappings.map((mapping) => mapping.targetId), targets);
  assert.deepEqual(result.publicDocument.parts[0].interaction.panels[0].dropTargets.map((target) => target.area), pair.publicDocument.parts[0].interaction.panels[0].dropTargets.map((target) => target.area));
  const mismatch = generateNativeBulkCandidate({ kind: "drag-drop", source: "1. One *down*.", ...pair, createId });
  assert.equal(mismatch.readiness.ready, false);
  assert.match(mismatch.readiness.issues.join(" "), /target 2 needs 1 private correct item/);
  assert.equal(mismatch.teacherDocument.parts[0].solution.mappings.length, 1);
});

test("a malformed later item causes zero candidate mutation for every supported kind", () => {
  const cases = [
    ["complete-sentences", "1. Valid *one*.\n2. Invalid"],
    ["single-choice", "1. Valid\n*yes\nno\n2. Invalid\nyes\nno"],
    ["open-response", "1. Valid\n*answer*\n2. Invalid"],
    ["drag-drop", "1. Valid *one*.\n2. Invalid"],
  ];
  for (const [kind, source] of cases) {
    const pair = blank(kind); const before = structuredClone(pair);
    assert.throws(() => generateNativeBulkCandidate({ kind, source, ...pair, createId }));
    assert.deepEqual(pair, before, `${kind} current drafts stay unchanged`);
  }
});


test("Text word replacement preserves reusable mappings, multi-item capacities, and distractors", () => {
  const pair = blank("drag-drop");
  const words = [1, 2, 3, 4].map((number) => ({ id: createId("word"), text: `Word ${number}`, reusable: number === 1 }));
  const targets = [1, 2, 3].map((number) => ({ id: createId("target"), area: { x: number * 100, y: 20, width: 80, height: 40 }, accessibleLabel: `Target ${number}`, capacity: number === 1 ? 2 : 1 }));
  Object.assign(pair.publicDocument.parts[0].interaction, { layoutMode: "text", words, panels: [{ id: createId("panel"), surface: { width: 1024, height: 582 }, images: [], dropTargets: targets }] });
  pair.teacherDocument.parts[0].solution.mappings = [{ targetId: targets[0].id, wordIds: [words[0].id, words[1].id] }, { targetId: targets[1].id, wordIds: [words[0].id] }, { targetId: targets[2].id, wordIds: [words[2].id] }];
  const result = generateNativeBulkCandidate({ kind: "drag-drop", source: "1. *A*\n2. *B*\n3. *C*\n4. *Distractor*", ...pair, replaceExisting: true, createId });
  assert.deepEqual(result.teacherDocument.parts[0].solution.mappings, pair.teacherDocument.parts[0].solution.mappings);
  assert.deepEqual(result.publicDocument.parts[0].interaction.panels[0].dropTargets, targets);
  assert.equal(result.publicDocument.parts[0].interaction.words[0].reusable, true);
  assert.equal(result.readiness.issues.some((issue) => /mapping|target.*needs|mismatch/.test(issue)), false);
});
