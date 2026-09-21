import assert from "node:assert/strict";
import test from "node:test";
import { alternativesPair, outlinePair, sharedTextPair, optionId } from "./fixtures/native-builder-options.js";
import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { nativeAssignmentCapability } from "../netlify/functions/_book-content/native-assignment-runtime.js";
import { nativeDragDropAnswerAllocation, nativeDragDropTargetText } from "../src/data/native-activities/nativeDragDropAnswers.js";
import { removeNativeDragDropWord, normalizeNativeDragDropResponses, updateNativeDragDropRevealState } from "../src/data/native-activities/nativeDragDrop.js";
import { outlineCategory, outlineCategoryPresets } from "../src/data/native-activities/nativeMarkWordsMarkers.js";
import { restoreNativeMarkWordsResponses, toggleNativeMarkWordsResponse } from "../src/data/native-activities/nativeMarkWordsRuntime.js";
import { buildNativeFinalSubmission, restoreNativeSubmissionResponses } from "../src/components/lms/student/runtime/studentSubmissionContract.js";
import { duplicateNativeMultiPartSection, projectNativeMultiPartChild } from "../src/data/native-activities/nativeMultiPart.js";
function roundTrip(pair, kind) {
  const adapter = resolveNativeActivityKind(kind);
  const pub = adapter.normalizePublic(JSON.parse(JSON.stringify(pair.publicDocument)));
  const teacher = adapter.normalizeTeacher(JSON.parse(JSON.stringify(pair.teacherDocument)));
  assert.equal(adapter.validatePair(pub, teacher), true);
  assert.equal(adapter.assessReadiness(pub, teacher).ready, true);
  return { pub, teacher, adapter };
}
const permutations = (values) => values.length ? values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map((rest) => [value, ...rest])) : [[]];
test("all 24 single-slot permutations survive normalization and authoritative scoring", () => {
  const { pub, teacher } = roundTrip(alternativesPair(), "drag-drop");
  const interaction = pub.parts[0].interaction, targets = interaction.panels[0].dropTargets;
  const capability = nativeAssignmentCapability("drag-drop");
  const normalize = (items) => capability.normalizeResponse(pub, { schemaVersion: "native-response.v1", items });
  for (const order of permutations(interaction.words.map((word) => word.id))) {
    const result = normalize(targets.map((target, i) => ({ id: target.id, value: [order[i]] })));
    assert.equal(result.error, undefined);
    assert.equal(capability.evaluateResponse(pub, teacher, result.payload).scorePercent, 100);
  }
  assert.equal(capability.evaluateResponse(pub, teacher, normalize([]).payload).scorePercent, 0);
  interaction.words.push({ id: optionId("word", 99), text: "distractor", shortLabel: "E", reusable: false });
  const wrong = normalize(targets.map((target, i) => ({ id: target.id, value: [i ? interaction.words[i].id : optionId("word", 99)] })));
  assert.equal(wrong.error, undefined); assert.equal(capability.evaluateResponse(pub, teacher, wrong.payload).scorePercent, 75);
  assert.ok(normalize([{ id: targets[0].id, value: interaction.words.map((word) => word.id) }]).error);
  assert.ok(normalize(targets.map((target) => ({ id: target.id, value: [interaction.words[0].id] }))).error);
  assert.ok(normalize([{ id: targets[0].id, value: [optionId("word", 98)] }]).error);
  assert.deepEqual(normalizeNativeDragDropResponses({ [targets[0].id]: interaction.words.map((word) => word.id) }, pub), {});
  const allocation = nativeDragDropAnswerAllocation(interaction, teacher.parts[0].solution.mappings);
  const revealed = updateNativeDragDropRevealState(new Set(), targets.map((target) => target.id), "show-all");
  assert.equal(new Set([...revealed].flatMap((id) => allocation.get(id))).size, 4);
  assert.ok([...allocation.values()].every((ids) => ids.length === 1));
  assert.doesNotMatch(JSON.stringify(pub), /wordIds|mappings/);
});
test("matching backtracks, impossible allocations fail, and all-required remains exact", () => {
  const { publicDocument: pub, teacherDocument: teacher } = alternativesPair();
  const interaction = pub.parts[0].interaction, mappings = teacher.parts[0].solution.mappings;
  mappings[1].wordIds = [interaction.words[0].id];
  assert.notEqual(nativeDragDropAnswerAllocation(interaction, mappings).get(mappings[0].targetId)[0], interaction.words[0].id);
  mappings[2].wordIds = [interaction.words[0].id];
  assert.equal(nativeDragDropAnswerAllocation(interaction, mappings), null);
  const adapter = resolveNativeActivityKind("drag-drop");
  assert.throws(() => adapter.validatePair(adapter.normalizePublic(pub), adapter.normalizeTeacher(teacher)), /allocation/);
  assert.equal(adapter.assessReadiness(pub, teacher).ready, false);
  const current = alternativesPair(); current.publicDocument.parts[0].interaction.panels[0].dropTargets[0].answerMode = "all";
  assert.throws(() => roundTrip(current, "drag-drop"), /capacity/);
  removeNativeDragDropWord(current.publicDocument, current.teacherDocument, interaction.words[3].id);
  assert.equal(current.publicDocument.parts[0].interaction.panels[0].dropTargets[1].answerMode, "any");
});
test("Teacher sentence start changes only the initial letter and preserves items and labels", () => {
  for (const text of ["because", "as a result", "‘because, YES!’"]) {
    const word = { text, id: "same", shortLabel: "A" };
    assert.equal(nativeDragDropTargetText(word, {}, true), text);
    assert.equal(nativeDragDropTargetText(word, { sentenceStart: true }, false), text);
    assert.equal(nativeDragDropTargetText({ ...word, image: {} }, { sentenceStart: true }, true), text);
    assert.equal(nativeDragDropTargetText(word, { sentenceStart: true }, true), text.replace(/\p{L}/u, (x) => x.toUpperCase()));
    assert.equal(word.text, text); assert.equal(word.shortLabel, "A");
  }
});
test("outline categories are private, color based, independently selectable and graded", () => {
  const { pub, teacher, adapter } = roundTrip(outlinePair(), "mark-the-words");
  const interaction = pub.parts[0].interaction, panel = interaction.presentation.panels[0];
  const answer = teacher.parts[0].solution.answers[0], [first, second] = answer.correctTargetIds;
  const blue = interaction.presentation.markerPresets.find((preset) => preset.color === "#0055cc");
  const orange = interaction.presentation.markerPresets.find((preset) => preset.color === "#dd7700");
  interaction.presentation.markerPresets.push({ ...blue, id: optionId("marker", 90), color: "#0055CC", thickness: 10, alignment: "manual" });
  assert.equal(outlineCategoryPresets(interaction).filter((preset) => outlineCategory(preset) === "#0055cc").length, 1);
  assert.equal(outlineCategory({ kind: "outline", color: "#AbC" }), "#aabbcc");
  assert.equal(outlineCategory({ kind: "underline", color: "#abc" }), null);
  let response = toggleNativeMarkWordsResponse(pub, {}, panel.id, first, blue.id);
  assert.deepEqual(response[panel.id], [first]);
  response = toggleNativeMarkWordsResponse(pub, response, panel.id, second, orange.id);
  const capability = nativeAssignmentCapability("mark-the-words");
  const score = (values) => {
    const envelope = buildNativeFinalSubmission({ target: { nativeKind: "mark-the-words", entry: { document: pub }, capability: { responseSchemaVersion: "native-response.v1" } }, responses: values }).response;
    const result = capability.normalizeResponse(pub, envelope); assert.equal(result.error, undefined);
    assert.deepEqual(restoreNativeMarkWordsResponses(pub, restoreNativeSubmissionResponses(result.payload)), values);
    return capability.evaluateResponse(pub, teacher, result.payload).scorePercent;
  };
  assert.equal(score(response), 100);
  response = toggleNativeMarkWordsResponse(pub, response, panel.id, first, orange.id);
  assert.deepEqual(response[panel.id], [first, second]); assert.equal(score(response), 0);
  response = toggleNativeMarkWordsResponse(pub, response, panel.id, first, orange.id);
  assert.deepEqual(response[panel.id], [second]); assert.equal(response.markers[panel.id][first], undefined);
  assert.doesNotMatch(JSON.stringify(pub), /categories|correctTargetIds/);
  const duplicated = duplicateNativeMultiPartSection({ id: optionId("section", 1), title: "Grouped", kind: "mark-the-words", interaction }, { id: optionId("section", 1), kind: "mark-the-words", solution: teacher.parts[0].solution });
  const copiedAnswer = duplicated.privateSection.solution.answers[0];
  assert.ok(copiedAnswer.correctTargetIds.every((id) => copiedAnswer.categories[id]));
  assert.equal(Object.hasOwn(copiedAnswer.categories, first), false);
  panel.hotspots[0].marker = { ...blue }; delete panel.hotspots[0].marker.id;
  assert.throws(() => adapter.normalizePublic(pub), /target-specific/);
});
test("shared Text Drag & Drop round-trips beside another kind with independent sections and bounds", () => {
  const { pub, teacher, adapter } = roundTrip(sharedTextPair(), "multi-part");
  const sections = pub.parts[0].interaction.sections;
  for (const section of sections.filter((entry) => entry.kind === "drag-drop")) {
    const child = projectNativeMultiPartChild(pub, section, teacher);
    assert.equal(child.publicDocument.parts[0].interaction.layoutMode, "text");
    assert.equal(child.publicDocument.parts[0].interaction.panels[0].dropTargets[0].sentenceStart, true);
    assert.equal(child.publicDocument.parts[0].interaction.words[0].shortLabel, "A");
  }
  const copy = duplicateNativeMultiPartSection(sections[0], teacher.parts[0].solution.sections[0]);
  assert.deepEqual(copy.section.textRegion, sections[0].textRegion);
  assert.notEqual(copy.section.interaction.panels[0].dropTargets[0].id, sections[0].interaction.panels[0].dropTargets[0].id);
  sections[0].textRegion.y = 40;
  assert.throws(() => adapter.normalizePublic(pub), /inside|overlap/);
});
