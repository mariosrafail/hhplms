import test from "node:test";
import assert from "node:assert/strict";
import { createOldschoolModePair } from "./fixtures/oldschool-modes.js";
import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from "../src/data/native-activities/nativeActivityRuntimeValidation.js";
import { assessNativeOldschoolListeningReadiness, nativeOldschoolListeningAssetRequirements } from "../src/data/native-activities/nativeOldschoolListening.js";
import { projectOldschoolQuestionPair, writeBackOldschoolQuestionPair } from "../src/data/native-activities/nativeOldschoolQuestionBinding.js";
import { switchNativeOldschoolListeningQuestionMode } from "../src/data/native-activities/nativeOldschoolListeningAuthoring.js";
import { nativeAssignmentCapability } from "../netlify/functions/_book-content/native-assignment-runtime.js";
import { buildNativeFinalSubmission } from "../src/components/lms/student/runtime/studentSubmissionContract.js";
import { parseNativeOldschoolListeningJson, serializeNativeOldschoolListeningJson } from "../src/data/native-activities/nativeOldschoolListeningJson.js";

const normalizeNativePublicRuntimeDocument = (doc) => normalizeNativeRuntimePublicDocument(doc, { activityId: doc.activityId, kind: doc.kind });
const normalizeNativeTeacherRuntimeDocument = (doc, publicDocument) => normalizeNativeRuntimeTeacherDocument(doc, { activityId: doc.activityId, kind: doc.kind, publicDocument });

for (const mode of ["open-response", "single-choice", "drag-drop"]) for (let supporting = 0; supporting < 5; supporting++) {
  test(`Oldschool ${mode}, supporting ${supporting}: normalized pair, assets, projection and switch`, () => {
    const pair = createOldschoolModePair(mode, supporting);
    const document = normalizeNativePublicRuntimeDocument(pair.publicDocument);
    const teacher = normalizeNativeTeacherRuntimeDocument(pair.teacherDocument, document);
    assert.equal(assessNativeOldschoolListeningReadiness(document, teacher).ready, true);
    const outer = structuredClone(document);
    const context = { assets: document.assets, commonAssetSlots: new Set([document.readableText?.assetSlot, ...document.audioTextHotspots?.hotspots.map((hotspot) => hotspot.audioAssetSlot) || []].filter(Boolean)) };
    assert.deepEqual(parseNativeOldschoolListeningJson(serializeNativeOldschoolListeningJson(document.parts[0].interaction, context), context), document.parts[0].interaction);
    const child = projectOldschoolQuestionPair(document, teacher);
    assert.equal(child.publicDocument.readableText, undefined);
    assert(!child.publicDocument.assets.some((asset) => asset.slot === "transcript-audio"));
    normalizeNativePublicRuntimeDocument(child.publicDocument);
    writeBackOldschoolQuestionPair(document, teacher, child);
    assert.deepEqual(document.parts[0].interaction.panels, outer.parts[0].interaction.panels);
    assert.deepEqual(document.readableText, outer.readableText);
    assert.deepEqual(document.audioTextHotspots, outer.audioTextHotspots);
    assert.deepEqual(document.assets, outer.assets);
    normalizeNativeTeacherRuntimeDocument(teacher, normalizeNativePublicRuntimeDocument(document));
    assert(nativeOldschoolListeningAssetRequirements(document).some((asset) => asset.slot === "transcript-audio"));
    for (const nextMode of ["drag-drop", "single-choice", "open-response"]) {
      switchNativeOldschoolListeningQuestionMode(document, teacher, nextMode);
      normalizeNativeTeacherRuntimeDocument(teacher, normalizeNativePublicRuntimeDocument(document));
      assert.deepEqual(document.audioTextHotspots, outer.audioTextHotspots);
      assert.deepEqual(document.parts[0].interaction.cues, outer.parts[0].interaction.cues);
    }
  });
}

test("Oldschool rejects unknown modes, mismatched solutions, stale assets and invalid hotspot bounds", () => {
  for (const mutate of [
    (doc) => { doc.parts[0].interaction.questionMode = "unknown"; },
    (doc) => { doc.audioTextHotspots.hotspots[0].panelId = "panel-2"; },
    (doc) => { doc.audioTextHotspots.hotspots[0].activityArea.x = 1024; },
    (doc) => { doc.parts[0].interaction.questionInteraction.panels[0].dropTargets[0].capacity = 0; },
    (doc) => { doc.assets.push({ ...doc.assets[0], slot: "unused" }); },
  ]) {
    const { publicDocument } = createOldschoolModePair("drag-drop"); mutate(publicDocument);
    assert.throws(() => normalizeNativePublicRuntimeDocument(publicDocument));
  }
  const { publicDocument, teacherDocument } = createOldschoolModePair("drag-drop");
  teacherDocument.parts[0].solution.mappings[0].wordIds = ["word-ffffffffffffffffffffffffffffffff"];
  assert.throws(() => normalizeNativeTeacherRuntimeDocument(teacherDocument, publicDocument));
  teacherDocument.parts[0].solution = { kind: "oldschool-listening", questionMode: "open-response", modelAnswers: [] };
  assert.throws(() => normalizeNativeTeacherRuntimeDocument(teacherDocument, publicDocument));
});

test("Oldschool DnD submits and grades canonical stable-ID placements without exposing mappings", () => {
  const { publicDocument, teacherDocument } = createOldschoolModePair("drag-drop");
  const child = publicDocument.parts[0].interaction.questionInteraction;
  const capability = nativeAssignmentCapability("oldschool-listening", publicDocument);
  const response = buildNativeFinalSubmission({ target: { nativeKind: "oldschool-listening", capability, entry: { document: publicDocument } }, responses: { [child.panels[0].dropTargets[0].id]: [child.words[0].id] } }).response;
  const normalized = capability.normalizeResponse(publicDocument, response);
  assert.equal(normalized.payload.kind, "oldschool-listening");
  assert.equal(capability.evaluateResponse(publicDocument, teacherDocument, normalized.payload).scorePercent, 100);
  assert.equal(capability.teacherReviewProjection(publicDocument, teacherDocument, normalized.payload)[0].isCorrect, true);
  assert(!JSON.stringify(publicDocument).includes('"mappings"'));
  assert(capability.normalizeResponse(publicDocument, { ...response, items: [{ id: "unknown", value: [child.words[0].id] }] }).error);
});
