import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "./_vite-test-server.mjs";

import { assertPublicBuilderDocument, builderDocumentSha256, stableBuilderJson } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { compileUltimateB2ComponentReleaseV2, ultimateB2PublicationV2Compatibility } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { validateBuilderNativeAssetReferences } from "../netlify-sites/ultimate-b2-builder/server/_builder-native-activity-store.js";
import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { nativeChildIdFromUuid } from "../src/data/native-activities/nativeChildIdentity.js";
import { assessNativeSingleChoiceReadiness } from "../src/data/native-activities/nativeSingleChoice.js";
import { logicalAreaStyle } from "../src/components/builder-studio/stageGeometry.js";
import {
  addUnansweredNativeSingleChoiceQuestion,
  createNativeSingleChoiceHotspotArea,
  findNextUnusedNativeSingleChoiceBinding,
  removeNativeSingleChoiceOption,
  setNativeSingleChoiceHotspotArea,
  setNativeSingleChoiceCorrectAnswer,
} from "../src/data/native-activities/nativeSingleChoiceAuthoring.js";
import { selectNativeSingleChoiceResponse, updateNativeSingleChoiceVisualNavigation, visibleNativeSingleChoicePanelIndexes } from "../src/data/native-activities/nativeSingleChoiceRuntime.js";
import { createNativeSingleChoiceTeacherSession, nativeSingleChoiceTeacherPresentationState, updateNativeSingleChoiceTeacherSession } from "../src/components/native-single-choice/nativeSingleChoiceTeacherRuntime.js";
import { createPublicationV2FixtureSources } from "./fixtures/publication-v2.js";

const kind = resolveNativeActivityKind("single-choice");
const activityId = "ultimate-b2-sb-u1-p1-o97";
const pageId = "ub2-sb-unit-1-part-1";
const ids = {
  questions: [nativeChildIdFromUuid("q", "20000000-0000-4000-8000-000000000001"), nativeChildIdFromUuid("q", "20000000-0000-4000-8000-000000000002")],
  options: [
    [nativeChildIdFromUuid("opt", "20000000-0000-4000-8000-000000000011"), nativeChildIdFromUuid("opt", "20000000-0000-4000-8000-000000000012")],
    [nativeChildIdFromUuid("opt", "20000000-0000-4000-8000-000000000013"), nativeChildIdFromUuid("opt", "20000000-0000-4000-8000-000000000014")],
  ],
  panels: [nativeChildIdFromUuid("panel", "20000000-0000-4000-8000-000000000021"), nativeChildIdFromUuid("panel", "20000000-0000-4000-8000-000000000022")],
  hotspots: Array.from({ length: 4 }, (_, index) => nativeChildIdFromUuid("hot", `20000000-0000-4000-8000-${String(index + 31).padStart(12, "0")}`)),
};
const visualAsset = { assetId: "20000000-0000-4000-8000-000000000041", checksumSha256: "b".repeat(64), role: "activity_artwork", slot: "visual-background" };

test("new visual hotspots bind to the next unused option in authored order", () => {
  const questions = ids.questions.map((questionId, index) => ({ id: questionId, options: ids.options[index].map((id) => ({ id })) }));
  const panels = [{ hotspots: [] }];
  const first = findNextUnusedNativeSingleChoiceBinding(questions, panels);
  assert.deepEqual(first, { questionId: ids.questions[0], optionId: ids.options[0][0], value: `${ids.questions[0]}:${ids.options[0][0]}` });
  panels[0].hotspots.push(first);
  assert.equal(findNextUnusedNativeSingleChoiceBinding(questions, panels).optionId, ids.options[0][1]);
  const explicit = `${ids.questions[1]}:${ids.options[1][1]}`;
  assert.equal(findNextUnusedNativeSingleChoiceBinding(questions, panels, explicit).value, explicit);
  panels[0].hotspots = questions.flatMap((question) => question.options.map((option) => ({ questionId: question.id, optionId: option.id })));
  assert.equal(findNextUnusedNativeSingleChoiceBinding(questions, panels), null);
  panels[0].hotspots = panels[0].hotspots.filter((hotspot) => hotspot.optionId !== ids.options[0][0]);
  assert.equal(findNextUnusedNativeSingleChoiceBinding(questions, panels).optionId, ids.options[0][0], "deletion makes the original option eligible again");
});

function visualPair() {
  const publicDocument = kind.createBlankPublic({ activityId, title: "Visual Multiple Choice", placement: { pageId } });
  publicDocument.assets = [visualAsset];
  publicDocument.parts[0].interaction.questions = ids.questions.map((questionId, questionIndex) => ({
    id: questionId,
    prompt: `Question ${questionIndex + 1}?`,
    options: ids.options[questionIndex].map((optionId, optionIndex) => ({ id: optionId, text: `Option ${questionIndex + 1}.${optionIndex + 1}` })),
  }));
  publicDocument.parts[0].interaction.presentation = {
    kind: "image-hotspot",
    panels: ids.panels.map((panelId, panelIndex) => ({
      id: panelId,
      backgroundAssetSlot: visualAsset.slot,
      sourceWidth: 1200,
      sourceHeight: 800,
      hotspots: ids.options[panelIndex].map((optionId, optionIndex) => ({
        id: ids.hotspots[panelIndex * 2 + optionIndex],
        questionId: ids.questions[panelIndex],
        optionId,
        area: { x: 100 + optionIndex * 400, y: 200, width: 300, height: 120 },
      })),
    })),
  };
  const teacherDocument = kind.createBlankTeacher({ activityId });
  teacherDocument.parts[0].solution.correctAnswers = ids.questions.map((questionId, index) => ({ questionId, correctOptionId: ids.options[index][1] }));
  return { publicDocument, teacherDocument };
}

function mutateVisual(mutator) {
  const pair = visualPair();
  mutator(pair.publicDocument.parts[0].interaction.presentation, pair.publicDocument);
  return pair;
}

test("legacy text-only Single Choice canonical JSON remains unchanged while current publication uses the latest compatibility", () => {
  const document = {
    schemaVersion: "1.0", activityId: "choice-compat", kind: "single-choice",
    metadata: { title: "Compatibility", visibleInstructionText: "" }, placement: { pageId: "page-1" }, assets: [],
    parts: [{ id: "part-1", interaction: { kind: "single-choice", questions: [{ id: "q-00000000000040008000000000000001", prompt: "Question?", options: [{ id: "opt-00000000000040008000000000000001", text: "A" }, { id: "opt-00000000000040008000000000000002", text: "B" }] }] } }],
  };
  const normalized = kind.normalizePublic(document, "choice-compat");
  assert.deepEqual(Object.keys(normalized.parts[0].interaction), ["kind", "questions"]);
  assert.equal(builderDocumentSha256(normalized), "370d125e49355054168f083193ff088daa98dcdfad9aadb6c74b4372c51e40ba");
  assert.doesNotMatch(stableBuilderJson(normalized), /presentation/);

  const compiled = compileUltimateB2ComponentReleaseV2(createPublicationV2FixtureSources());
  assert.equal(compiled.compatibility, ultimateB2PublicationV2Compatibility());
  assert.equal(compiled.sourceSnapshotSha256, builderDocumentSha256(compiled.sourceSnapshot));
  assert.equal(compiled.publicProjectionSha256, builderDocumentSha256(compiled.publicProjection));
  assert.equal(compiled.teacherProjectionSha256, builderDocumentSha256(compiled.teacherProjection));
  assert.equal(compiled.releaseSha256, builderDocumentSha256({ compatibility: compiled.compatibility, sourceSnapshot: compiled.sourceSnapshot, publicProjection: compiled.publicProjection, teacherProjection: compiled.teacherProjection }));
});

test("visual Single Choice normalizes strict student-safe panels and source-pixel hotspots", () => {
  const pair = visualPair();
  assert.equal(kind.validatePair(pair.publicDocument, pair.teacherDocument), true);
  const normalized = kind.normalizePublic(pair.publicDocument, activityId);
  assert.equal(normalized.schemaVersion, "1.0");
  assert.equal(normalized.parts.length, 1);
  assert.equal(normalized.parts[0].id, "part-1");
  assert.equal(normalized.parts[0].interaction.presentation.panels.length, 2);
  assert.doesNotThrow(() => assertPublicBuilderDocument(normalized));
  assert.doesNotMatch(JSON.stringify(normalized), /correctAnswers|correctOptionId|isCorrect|answerKey/);
  assert.match(JSON.stringify(pair.teacherDocument), /correctAnswers|correctOptionId/);
  assert.equal(Object.hasOwn(normalized.parts[0].interaction.presentation.panels[0].hotspots[0], "highlightArea"), false, "old records stay byte-stable and the runtime deterministically falls back to area");
});

test("Single Choice supports canonical private exact sets while preserving legacy scalar answers", () => {
  const legacy = visualPair();
  assert.deepEqual(kind.normalizeTeacher(legacy.teacherDocument, activityId).parts[0].solution.correctAnswers[0], {
    questionId: ids.questions[0], correctOptionId: ids.options[0][1],
  });
  assert.equal(Object.hasOwn(kind.normalizePublic(legacy.publicDocument, activityId).parts[0].interaction.questions[0], "selectionMode"), false);

  const current = visualPair();
  current.publicDocument.parts[0].interaction.questions[0].selectionMode = "multiple";
  current.teacherDocument.parts[0].solution.correctAnswers[0] = { questionId: ids.questions[0], correctOptionIds: ids.options[0] };
  assert.equal(kind.validatePair(current.publicDocument, current.teacherDocument), true);
  assert.deepEqual(kind.normalizeTeacher(current.teacherDocument, activityId).parts[0].solution.correctAnswers[0].correctOptionIds, ids.options[0]);
  const nonCanonical = structuredClone(current.teacherDocument);
  nonCanonical.parts[0].solution.correctAnswers[0].correctOptionIds.reverse();
  assert.throws(() => kind.validatePair(current.publicDocument, nonCanonical), /exactly match/);
  const wrongMode = structuredClone(current.publicDocument);
  wrongMode.parts[0].interaction.questions[0].selectionMode = "single";
  assert.throws(() => kind.validatePair(wrongMode, current.teacherDocument), /exactly match/);
});

test("legacy optional highlight geometry remains accepted without changing canonical area", () => {
  const pair = visualPair();
  const hotspot = pair.publicDocument.parts[0].interaction.presentation.panels[0].hotspots[0];
  hotspot.highlightArea = { x: 150, y: 225, width: 100, height: 50 };
  const normalized = kind.normalizePublic(pair.publicDocument, activityId);
  const current = normalized.parts[0].interaction.presentation.panels[0].hotspots[0];
  assert.deepEqual(current.area, hotspot.area);
  assert.deepEqual(current.highlightArea, hotspot.highlightArea);
  const invalid = structuredClone(pair.publicDocument);
  invalid.parts[0].interaction.presentation.panels[0].hotspots[0].highlightArea = { x: 0, y: 0, width: 50, height: 50 };
  assert.throws(() => kind.normalizePublic(invalid, activityId), /inside its click area/);
});

test("new hotspot area is deterministic, integral, positive, and fully source-bounded", () => {
  assert.deepEqual(createNativeSingleChoiceHotspotArea(1000, 582), { x: 487, y: 278, width: 25, height: 25 });
  assert.deepEqual(createNativeSingleChoiceHotspotArea(1001, 583), { x: 488, y: 279, width: 25, height: 25 });
  assert.deepEqual(createNativeSingleChoiceHotspotArea(12, 8), { x: 0, y: 0, width: 12, height: 8 });
  assert.deepEqual(createNativeSingleChoiceHotspotArea(25, 25), { x: 0, y: 0, width: 25, height: 25 });
  assert.deepEqual(createNativeSingleChoiceHotspotArea(1000, 582), createNativeSingleChoiceHotspotArea(1000, 582));
  assert.throws(() => createNativeSingleChoiceHotspotArea(0, 25), /positive integers/);
});

test("moving or resizing a legacy hotspot canonicalizes only the touched hotspot", () => {
  const pair = visualPair();
  const [touched, untouched] = pair.publicDocument.parts[0].interaction.presentation.panels[0].hotspots;
  touched.highlightArea = { x: 150, y: 225, width: 100, height: 50 };
  untouched.highlightArea = { x: 550, y: 225, width: 100, height: 50 };
  setNativeSingleChoiceHotspotArea(touched, { x: 120, y: 210, width: 280, height: 100 });
  assert.deepEqual(touched, { id: ids.hotspots[0], questionId: ids.questions[0], optionId: ids.options[0][0], area: { x: 120, y: 210, width: 280, height: 100 } });
  assert.deepEqual(untouched.highlightArea, { x: 550, y: 225, width: 100, height: 50 });
});

test("visual contract rejects unknown fields, invalid identities, dimensions, geometry, and semantic bindings", () => {
  const cases = [
    mutateVisual((presentation) => { presentation.extra = true; }),
    mutateVisual((presentation) => { presentation.panels[0].id = "panel-1"; }),
    mutateVisual((presentation) => { presentation.panels[0].sourceWidth = 0; }),
    mutateVisual((presentation) => { presentation.panels[0].hotspots[0].area.x = 1199; }),
    mutateVisual((presentation) => { presentation.panels[0].hotspots[0].questionId = nativeChildIdFromUuid("q", "20000000-0000-4000-8000-000000000099"); }),
    mutateVisual((presentation) => { presentation.panels[0].hotspots[0].optionId = ids.options[1][0]; }),
    mutateVisual((presentation) => { presentation.panels[1].hotspots[0].id = presentation.panels[0].hotspots[0].id; }),
    mutateVisual((presentation) => { presentation.panels[0].hotspots[0].correctOptionId = ids.options[0][0]; }),
  ];
  for (const pair of cases) assert.throws(() => kind.normalizePublic(pair.publicDocument, activityId));
});

test("visual topology requires exact unambiguous option coverage and keeps each question on one panel", () => {
  const missing = mutateVisual((presentation) => { presentation.panels[0].hotspots.pop(); });
  assert.throws(() => kind.validatePair(missing.publicDocument, missing.teacherDocument), /exactly one hotspot/);
  const duplicate = mutateVisual((presentation) => { presentation.panels[0].hotspots[1].optionId = presentation.panels[0].hotspots[0].optionId; });
  assert.throws(() => kind.validatePair(duplicate.publicDocument, duplicate.teacherDocument), /exactly one hotspot/);
  const split = mutateVisual((presentation) => {
    const moved = presentation.panels[0].hotspots.pop();
    presentation.panels[1].hotspots.push(moved);
  });
  assert.throws(() => kind.validatePair(split.publicDocument, split.teacherDocument), /cannot span visual panels/);
});

test("an additional managed image-only panel is valid while global option coverage remains exact", () => {
  const pair = visualPair();
  pair.publicDocument.parts[0].interaction.presentation.panels.push({
    id: nativeChildIdFromUuid("panel", "20000000-0000-4000-8000-000000000023"),
    backgroundAssetSlot: visualAsset.slot,
    sourceWidth: 1200,
    sourceHeight: 800,
    hotspots: [],
  });
  assert.equal(assessNativeSingleChoiceReadiness(pair.publicDocument, pair.teacherDocument).ready, true);
  assert.equal(kind.validatePair(pair.publicDocument, pair.teacherDocument), true);
  pair.publicDocument.parts[0].interaction.presentation.panels[0].hotspots.pop();
  assert.equal(assessNativeSingleChoiceReadiness(pair.publicDocument, pair.teacherDocument).ready, false);
  assert.throws(() => kind.validatePair(pair.publicDocument, pair.teacherDocument), /visual options must have exactly one hotspot/);
});

test("local unanswered authoring never guesses option one and strict persisted topology remains enforced", () => {
  const publicDocument = kind.createBlankPublic({ activityId, title: "Manual", placement: { pageId } });
  const teacherDocument = kind.createBlankTeacher({ activityId });
  let counter = 0;
  const generated = [ids.questions[0], ids.options[0][0], ids.options[0][1]];
  const { questionId } = addUnansweredNativeSingleChoiceQuestion(publicDocument, teacherDocument, () => generated[counter++]);
  const question = publicDocument.parts[0].interaction.questions[0];
  question.prompt = "Choose explicitly."; question.options[0].text = "First"; question.options[1].text = "Second";
  assert.deepEqual(teacherDocument.parts[0].solution.correctAnswers, []);
  assert.match(assessNativeSingleChoiceReadiness(publicDocument, teacherDocument).issues.join(" "), /needs a correct option/);
  assert.throws(() => kind.validatePair(publicDocument, teacherDocument), /exactly match/);
  setNativeSingleChoiceCorrectAnswer(publicDocument, teacherDocument, questionId, question.options[1].id);
  assert.equal(assessNativeSingleChoiceReadiness(publicDocument, teacherDocument).ready, true);
  assert.equal(kind.validatePair(publicDocument, teacherDocument), true);
  removeNativeSingleChoiceOption(publicDocument, teacherDocument, questionId, question.options[1].id);
  assert.deepEqual(teacherDocument.parts[0].solution.correctAnswers, []);
});

test("visual navigation and selection preserve the canonical response model", () => {
  const original = { [ids.questions[0]]: ids.options[0][0] };
  const changed = selectNativeSingleChoiceResponse(original, ids.questions[0], ids.options[0][1]);
  assert.deepEqual(changed, { [ids.questions[0]]: ids.options[0][1] });
  assert.deepEqual(original, { [ids.questions[0]]: ids.options[0][0] });
  let navigation = { panelIndex: 0, showAll: false };
  navigation = updateNativeSingleChoiceVisualNavigation(navigation, 2, "next");
  assert.deepEqual(navigation, { panelIndex: 1, showAll: false });
  assert.deepEqual(updateNativeSingleChoiceVisualNavigation(navigation, 2, "next"), navigation);
  navigation = updateNativeSingleChoiceVisualNavigation(navigation, 2, "toggle-all");
  assert.deepEqual(visibleNativeSingleChoicePanelIndexes(navigation, 2), [0, 1]);
  navigation = updateNativeSingleChoiceVisualNavigation(navigation, 2, "paged");
  assert.deepEqual(visibleNativeSingleChoicePanelIndexes(navigation, 2), [1]);
});

test("source-pixel hotspots use shared percentage geometry at every responsive render size", () => {
  const style = logicalAreaStyle({ x: 120, y: 80, width: 300, height: 160 }, { width: 1200, height: 800 });
  assert.deepEqual(style, { left: "10%", top: "10%", width: "25%", height: "20%" });
  const rendered = (width) => ({ x: width * .1, y: (width * 2 / 3) * .1, width: width * .25, height: (width * 2 / 3) * .2 });
  assert.deepEqual(rendered(600), { x: 60, y: 40, width: 150, height: 80 });
  assert.deepEqual(rendered(960), { x: 96, y: 64, width: 240, height: 128 });
});

test("student surface keeps text radios unchanged and renders accessible managed visual hotspots", async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { NativeSingleChoiceStudentSurface } = await vite.ssrLoadModule("/src/components/native-single-choice/NativeSingleChoiceStudentSurface.jsx");
    const pair = visualPair();
    pair.publicDocument.parts[0].interaction.presentation.panels[0].hotspots[0].highlightArea = { x: 150, y: 225, width: 100, height: 50 };
    const visual = renderToStaticMarkup(React.createElement(NativeSingleChoiceStudentSurface, { document: pair.publicDocument, assetUrl: () => "/published/background.png", responses: { [ids.questions[0]]: ids.options[0][1] } }));
    assert.match(visual, /published\/background\.png/);
    assert.match(visual, /native-single-choice-hotspot/);
    assert.match(visual, /native-single-choice-highlight/);
    assert.match(visual, /aria-pressed="true"/);
    assert.match(visual, /Question 1\?: Option 1\.1/);
    assert.match(visual, /Show All/);
    assert.match(visual, />Next</);
    assert.equal((visual.match(/left:8\.333333333333332%;top:25%;width:25%;height:15%/g) || []).length, 2, "click targeting and feedback both use area");
    assert.doesNotMatch(visual, /left:12\.5%;top:28\.125%;width:8\.333333333333332%;height:6\.25%/);
    assert.doesNotMatch(visual, /correctAnswers|correctOptionId/);
    const readOnly = renderToStaticMarkup(React.createElement(NativeSingleChoiceStudentSurface, { document: pair.publicDocument, assetUrl: () => "/published/background.png", initialResponses: { [ids.questions[0]]: ids.options[0][0] }, readOnly: true }));
    assert.match(readOnly, /aria-pressed="true"/);
    assert.match(readOnly, /disabled=""/);

    const textDocument = kind.createBlankPublic({ activityId, title: "Text", placement: { pageId } });
    textDocument.parts[0].interaction.questions = pair.publicDocument.parts[0].interaction.questions;
    const textMarkup = renderToStaticMarkup(React.createElement(NativeSingleChoiceStudentSurface, { document: textDocument }));
    assert.match(textMarkup, /type="radio"/);
    assert.doesNotMatch(textMarkup, /native-single-choice-visual-stage|Show All/);
  } finally { await vite.close(); }
});

test("Teacher external navigation and answer reveal commands preserve attempts and follow semantic question order", () => {
  const pair = visualPair();
  let session = createNativeSingleChoiceTeacherSession();
  session = updateNativeSingleChoiceTeacherSession(session, pair.publicDocument, pair.teacherDocument, { type: "select", questionId: ids.questions[0], optionId: ids.options[0][0] });
  assert.equal(session.optionStates[ids.options[0][0]], "incorrect");
  assert.equal(nativeSingleChoiceTeacherPresentationState(session, pair.publicDocument, pair.teacherDocument).reveal.revealed, 0, "wrong attempts are not revealed answers");

  session = updateNativeSingleChoiceTeacherSession(session, pair.publicDocument, pair.teacherDocument, { type: "show-next" });
  assert.equal(session.optionStates[ids.options[0][0]], "incorrect", "wrong feedback survives reveal");
  assert.equal(session.optionStates[ids.options[0][1]], "correct");
  assert.equal(session.panelIndex, 0);
  assert.equal(nativeSingleChoiceTeacherPresentationState(session, pair.publicDocument, pair.teacherDocument).reveal.revealed, 1);

  session = updateNativeSingleChoiceTeacherSession(session, pair.publicDocument, pair.teacherDocument, { type: "show-next" });
  assert.equal(session.optionStates[ids.options[1][1]], "correct");
  assert.equal(session.panelIndex, 1, "cross-panel reveal navigates to the revealed question");
  assert.equal(nativeSingleChoiceTeacherPresentationState(session, pair.publicDocument, pair.teacherDocument).reveal.revealed, 2);
  assert.equal(updateNativeSingleChoiceTeacherSession(session, pair.publicDocument, pair.teacherDocument, { type: "show-next" }), session, "completed reveal is stable");

  session = updateNativeSingleChoiceTeacherSession(session, pair.publicDocument, pair.teacherDocument, { type: "previous-panel" });
  assert.equal(session.panelIndex, 0);
  assert.equal(session.optionStates[ids.options[1][1]], "correct", "navigation preserves answers on other panels");
  session = updateNativeSingleChoiceTeacherSession(session, pair.publicDocument, pair.teacherDocument, { type: "reset-activity" });
  assert.deepEqual(session.responses, {});
  assert.deepEqual(session.optionStates, {});
  assert.equal(session.solvedQuestionIds.size, 0);
  assert.equal(session.panelIndex, 0);
});

test("Teacher multiple-answer interaction solves only the exact set and reveals every correct option", () => {
  const pair = visualPair();
  const question = pair.publicDocument.parts[0].interaction.questions[0];
  question.selectionMode = "multiple";
  pair.teacherDocument.parts[0].solution.correctAnswers[0] = { questionId: question.id, correctOptionIds: [...ids.options[0]] };
  let session = createNativeSingleChoiceTeacherSession();
  session = updateNativeSingleChoiceTeacherSession(session, pair.publicDocument, pair.teacherDocument, { type: "select", questionId: question.id, optionId: ids.options[0][0] });
  assert.deepEqual(session.responses[question.id], [ids.options[0][0]]);
  assert.equal(session.solvedQuestionIds.has(question.id), false, "a proper subset is not solved");
  session = updateNativeSingleChoiceTeacherSession(session, pair.publicDocument, pair.teacherDocument, { type: "select", questionId: question.id, optionId: ids.options[0][1] });
  assert.equal(session.solvedQuestionIds.has(question.id), true);
  assert.deepEqual(ids.options[0].map((optionId) => session.optionStates[optionId]), ["correct", "correct"]);

  session = createNativeSingleChoiceTeacherSession();
  session = updateNativeSingleChoiceTeacherSession(session, pair.publicDocument, pair.teacherDocument, { type: "show-next" });
  assert.deepEqual(session.responses[question.id], ids.options[0]);
  assert.deepEqual(ids.options[0].map((optionId) => session.optionStates[optionId]), ["correct", "correct"]);
});

test("Teacher presentation state contains counts only and never answer identities", () => {
  const pair = visualPair();
  let session = createNativeSingleChoiceTeacherSession();
  session = updateNativeSingleChoiceTeacherSession(session, pair.publicDocument, pair.teacherDocument, { type: "show-all" });
  const outward = nativeSingleChoiceTeacherPresentationState(session, pair.publicDocument, pair.teacherDocument);
  assert.deepEqual(outward, { panelIndex: 0, panelCount: 2, reveal: { supported: true, total: 2, revealed: 2, pristine: false } });
  assert.doesNotMatch(JSON.stringify(outward), new RegExp(ids.questions.concat(ids.options.flat()).join("|")));
});

test("teacher surface uses the shared classroom presentation without rendering a primary answer-key list", async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const [{ NativeSingleChoiceTeacherSurface }, { NativeSingleChoicePresentation }] = await Promise.all([
      vite.ssrLoadModule("/src/components/native-single-choice/NativeSingleChoiceTeacherSurface.jsx"),
      vite.ssrLoadModule("/src/components/native-single-choice/NativeSingleChoicePresentation.jsx"),
    ]);
    const pair = visualPair();
    const teacherVisual = renderToStaticMarkup(React.createElement(NativeSingleChoiceTeacherSurface, {
      publicDocument: pair.publicDocument,
      teacherDocument: pair.teacherDocument,
      assetUrl: () => "/teacher/background.png",
    }));
    assert.match(teacherVisual, /data-native-single-choice-presentation="visual"/);
    assert.match(teacherVisual, /teacher\/background\.png/);
    assert.match(teacherVisual, /native-single-choice-visual-stage/);
    assert.match(teacherVisual, /left:8\.333333333333332%;top:25%;width:25%;height:15%/);
    assert.match(teacherVisual, /Show All/);
    assert.match(teacherVisual, />Next</);
    assert.doesNotMatch(teacherVisual, /Correct answer|correctAnswers|correctOptionId/);

    const classroomTeacherVisual = renderToStaticMarkup(React.createElement(NativeSingleChoiceTeacherSurface, {
      publicDocument: pair.publicDocument,
      teacherDocument: pair.teacherDocument,
      assetUrl: () => "/teacher/background.png",
      presentation: { command: null, onStateChange: () => {} },
    }));
    assert.doesNotMatch(classroomTeacherVisual, /native-single-choice-visual-navigation/);
    assert.doesNotMatch(classroomTeacherVisual, /<button[^>]*>Show All<|<button[^>]*>Next</);
    assert.match(classroomTeacherVisual, /aria-live="polite" aria-label="Panel 1 of 2"/);
    assert.doesNotMatch(classroomTeacherVisual, />Panel [12](?: of 2)?</);

    const onePanelPair = visualPair();
    onePanelPair.publicDocument.parts[0].interaction.questions = onePanelPair.publicDocument.parts[0].interaction.questions.slice(0, 1);
    onePanelPair.publicDocument.parts[0].interaction.presentation.panels = onePanelPair.publicDocument.parts[0].interaction.presentation.panels.slice(0, 1);
    onePanelPair.teacherDocument.parts[0].solution.correctAnswers = onePanelPair.teacherDocument.parts[0].solution.correctAnswers.slice(0, 1);
    const onePanelClassroom = renderToStaticMarkup(React.createElement(NativeSingleChoiceTeacherSurface, {
      publicDocument: onePanelPair.publicDocument,
      teacherDocument: onePanelPair.teacherDocument,
      assetUrl: () => "/teacher/one-panel.png",
      presentation: { command: null, onStateChange: () => {} },
    }));
    assert.equal((onePanelClassroom.match(/<section class="native-single-choice-visual-panel"/g) || []).length, 1);
    assert.doesNotMatch(onePanelClassroom, /native-single-choice-visual-navigation|<button[^>]*>Next</);
    assert.equal(nativeSingleChoiceTeacherPresentationState(createNativeSingleChoiceTeacherSession(), onePanelPair.publicDocument, onePanelPair.teacherDocument).panelCount, 1);

    const neutralFeedback = renderToStaticMarkup(React.createElement(NativeSingleChoicePresentation, {
      document: pair.publicDocument,
      assetUrl: () => "/teacher/background.png",
      responses: { [ids.questions[0]]: ids.options[0][1] },
      optionStates: { [ids.options[0][0]]: "incorrect", [ids.options[0][1]]: "correct" },
      disabledQuestionIds: new Set([ids.questions[0]]),
      className: "native-single-choice-teacher",
    }));
    assert.match(neutralFeedback, /data-answer-state="incorrect"/);
    assert.match(neutralFeedback, /data-answer-state="correct"/);
    assert.match(neutralFeedback, /Try again\./);
    assert.match(neutralFeedback, /Correct\./);
    assert.match(neutralFeedback, /disabled=""/);

    const textDocument = kind.createBlankPublic({ activityId, title: "Text", placement: { pageId } });
    textDocument.parts[0].interaction.questions = pair.publicDocument.parts[0].interaction.questions;
    const teacherText = renderToStaticMarkup(React.createElement(NativeSingleChoiceTeacherSurface, {
      publicDocument: textDocument,
      teacherDocument: pair.teacherDocument,
    }));
    assert.match(teacherText, /data-native-single-choice-presentation="text"/);
    assert.match(teacherText, /type="radio"/);
    assert.doesNotMatch(teacherText, /native-single-choice-visual-stage|Correct answer/);
  } finally { await vite.close(); }
});

test("visual background is materialized through publication and dimension mismatches fail closed", () => {
  const sources = createPublicationV2FixtureSources();
  const entry = sources.native.activities[activityId];
  const pair = visualPair();
  entry.public.payload = pair.publicDocument;
  entry.public.sha256 = builderDocumentSha256(pair.publicDocument);
  entry.teacher.payload = pair.teacherDocument;
  entry.teacher.sha256 = builderDocumentSha256(pair.teacherDocument);
  sources.native.assetRows.push({
    id: visualAsset.assetId, checksum_sha256: visualAsset.checksumSha256, asset_role: visualAsset.role,
    object_key: "builder-native-assets/visual.png", storage_profile: "private", storage_bucket: "private", mime_type: "image/png", byte_size: 100,
    width: 1200, height: 800, publication_status: "draft", access_level: "internal", source_metadata: { native_activity_id: activityId, asset_slot: visualAsset.slot },
  });
  const compiled = compileUltimateB2ComponentReleaseV2(sources);
  assert.equal(compiled.publicProjection.nativeActivities[activityId].document.parts[0].interaction.presentation.panels.length, 2);
  assert.ok(compiled.assetManifest.some((asset) => asset.sha256 === visualAsset.checksumSha256));
  assert.doesNotMatch(JSON.stringify(compiled.publicProjection), /correctAnswers|correctOptionId/);
  sources.native.assetRows.at(-1).width = 1199;
  assert.throws(() => compileUltimateB2ComponentReleaseV2(sources), /native_activity_asset_invalid/);
});

test("authoring save validates managed background ownership and intrinsic dimensions", async () => {
  const row = {
    id: visualAsset.assetId, checksum_sha256: visualAsset.checksumSha256, asset_role: visualAsset.role,
    publication_status: "draft", access_level: "internal", storage_profile: "private", width: 1200, height: 800,
    source_metadata: { native_activity_id: activityId, asset_slot: visualAsset.slot },
  };
  const sql = async () => [row];
  const input = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", activityId, assets: [visualAsset], requirements: [{ slot: visualAsset.slot, width: 1200, height: 800 }] };
  await assert.doesNotReject(validateBuilderNativeAssetReferences(sql, input));
  await assert.rejects(validateBuilderNativeAssetReferences(sql, { ...input, requirements: [{ slot: visualAsset.slot, width: 1199, height: 800 }] }), /dimensions do not match/);
});

test("Student and Teacher share a public classroom renderer while only Teacher owns private answer interpretation", async () => {
  const [editor, questionAuthoring, visualAuthoring, canvas, hostedRunner, publishedStudentRunner, publishedTeacherRunner, studentSurface, presentation, teacherSurface] = await Promise.all([
    readFile(new URL("../src/apps/book-builder/hosted/NativeSingleChoiceEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/book-builder/hosted/NativeSingleChoiceQuestionAuthoring.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/book-builder/hosted/NativeSingleChoiceVisualAuthoring.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/native-single-choice/NativeSingleChoiceHotspotCanvas.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/lms/activities/ultimate-b2/HostedNativeDraftActivityRunner.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/lms/activities/ultimate-b2/PublishedNativeStudentActivityRunner.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/lms/activities/ultimate-b2/PublishedNativeTeacherActivityRunner.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/native-single-choice/NativeSingleChoiceStudentSurface.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/native-single-choice/NativeSingleChoicePresentation.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/native-single-choice/NativeSingleChoiceTeacherSurface.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /<NativeSingleChoiceStudentSurface document=\{publicDraft\} assetUrl=\{assetUrl\}/);
  assert.doesNotMatch(editor, /NativeSingleChoiceStudentSurface[^>]+teacherDocument/);
  assert.match(editor, /addUnansweredNativeSingleChoiceQuestion/);
  assert.match(editor, /const readyToSave = readiness\.ready && !readableTextIncomplete && !videoIncomplete/);
  assert.match(editor, /<StudioSaveBar[\s\S]*disabled=\{!dirty \|\| state\.saving \|\| !readyToSave\}/);
  assert.match(editor, /uploadNativeActivityAsset/);
  assert.match(editor, /NativeSingleChoiceQuestionAuthoring/);
  assert.match(editor, /NativeSingleChoiceVisualAuthoring/);
  assert.match(visualAuthoring, /NativeSingleChoiceHotspotCanvas/);
  assert.match(questionAuthoring, /Needs answer/);
  assert.match(canvas, /StageSelectionFrame/);
  assert.match(canvas, /label="Hotspot"/);
  assert.match(canvas, /geometry=\{selected\.area\}/);
  assert.match(canvas, /onDelete=\{onDelete\}/);
  assert.match(editor, /createNativeSingleChoiceHotspotArea/);
  assert.match(visualAuthoring, />New hotspot<\/StudioButton>/);
  assert.match(editor, /setNativeSingleChoiceHotspotArea/);
  assert.doesNotMatch(canvas, /beginDraw|moveDraw|draftArea|highlightArea|selectedGeometry|drawingHighlight/);
  assert.doesNotMatch(editor, /Draw Highlight|Redraw Highlight|Edit Click Target|Edit Highlight|Draw hotspot|selectedGeometry|drawingHighlight|drawingEnabled/);
  assert.match(hostedRunner, /NativeSingleChoiceTeacherSurface publicDocument=\{document\} teacherDocument=\{state\.teacher\.entry\.document\} assetUrl=\{assetUrl\}/);
  assert.match(publishedStudentRunner, /NativeSingleChoiceStudentSurface document=\{document\} assetUrl=\{assetUrl\}/);
  assert.doesNotMatch(publishedStudentRunner, /NativeSingleChoiceTeacherSurface|teacherState|teacherDocument/);
  assert.match(publishedTeacherRunner, /NativeSingleChoiceTeacherSurface publicDocument=\{document\} teacherDocument=\{currentTeacher\} assetUrl=\{assetUrl\}/);
  assert.match(publishedTeacherRunner, /teacherState.releaseId === publication.releaseId/);
  assert.match(editor, /NativeSingleChoiceTeacherSurface publicDocument=\{publicDraft\} teacherDocument=\{teacherDraft\} assetUrl=\{assetUrl\}/);
  assert.match(studentSurface, /NativeSingleChoicePresentation/);
  assert.match(teacherSurface, /NativeSingleChoicePresentation/);
  assert.doesNotMatch(studentSurface, /teacherDocument|correctAnswers|correctOptionId/);
  assert.doesNotMatch(presentation, /teacherDocument|correctAnswers|correctOptionId|solution/);
  assert.match(teacherSurface, /teacherDocument\.parts\[0\]\.solution\.correctAnswers/);
  assert.doesNotMatch(teacherSurface, /NativeSingleChoiceEditor|Front|Back|HotspotCanvas/);
});

test("visual Viewer uses maximal contain sizing, transparent loaded chrome, and one registered stage", async () => {
  const [css, readableCss, presentation] = await Promise.all([
    readFile(new URL("../src/components/native-single-choice/nativeSingleChoice.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/native-readable-text/nativeReadableText.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/native-single-choice/NativeSingleChoicePresentation.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(css, /\.native-single-choice-stage-slot\s*\{[^}]*container-type:\s*size/s);
  assert.match(css, /\.native-single-choice-visual-stage\s*\{[^}]*background:\s*transparent[^}]*width:\s*min\(100cqw, calc\(100cqh \* var\(--native-single-choice-stage-aspect\)\)\)/s);
  assert.match(css, /\.native-single-choice-visual-stage > img,[\s\S]*object-fit:\s*contain/);
  assert.doesNotMatch(css, /object-fit:\s*fill/);
  assert.match(readableCss, /:has\(\.native-single-choice-visual-stage\):not\(\.is-audio-focus\)[^{]*\{[^}]*overflow:\s*hidden/s);
  assert.match(readableCss, /\[data-audio-focus\]::after[^}]*height:\s*7px[^}]*background:\s*#000[^}]*pointer-events:\s*none/s);
  assert.match(presentation, /style=\{\{ aspectRatio: `\$\{panel\.sourceWidth\} \/ \$\{panel\.sourceHeight\}` \}\}/);
  assert.match(presentation, /style=\{logicalAreaStyle\(hotspot\.area, \{ width: panel\.sourceWidth, height: panel\.sourceHeight \}\)\}/);
  assert.doesNotMatch(presentation, /hotspot\.highlightArea/);
});
