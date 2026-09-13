import assert from "node:assert/strict";
import test from "node:test";
import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { assertPublicBuilderDocument } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { nativeAudioTextAssetRequirements, nativeAudioTextHotspotTargets } from "../src/data/native-activities/nativeAudioTextHotspots.js";
import { removeNativeDragDropPanel, resizeNativeDragDropAudioTextHotspots, normalizeNativeDragDropResponses, placeNativeDragDropWord, removeNativeDragDropResponse, visibleNativeDragDropWordIds } from "../src/data/native-activities/nativeDragDrop.js";
import { projectNativeMultiPartChild } from "../src/data/native-activities/nativeMultiPart.js";
import { sharedFive, sharedFiveTeacher } from "./fixtures/native-runtime-regressions/shared-five-data.js";
import { dragDropImprovementsPair, dndId } from "./fixtures/native-runtime-regressions/drag-drop-improvements-data.js";
import { nativeAssignmentCapability } from "../netlify/functions/_book-content/native-assignment-runtime.js";

const kind = resolveNativeActivityKind("drag-drop");
test("Randomize is checked for new documents, strict and additive for legacy documents", () => {
  assert.equal(kind.createBlankPublic({ activityId: "randomize", title: "New", placement: { pageId: "page-1" } }).parts[0].interaction.randomize, true);
  const { publicDocument } = dragDropImprovementsPair();
  const normalized = kind.normalizePublic(publicDocument);
  assert.equal(normalized.parts[0].interaction.randomize, false);
  assert.deepEqual(kind.normalizePublic(JSON.parse(JSON.stringify(normalized))), normalized);
  delete publicDocument.parts[0].interaction.randomize;
  const legacy = kind.normalizePublic(publicDocument);
  assert.equal(Object.hasOwn(legacy.parts[0].interaction, "randomize"), false);
  const { randomize, ...withoutOption } = normalized.parts[0].interaction;
  assert.deepEqual(legacy.parts[0].interaction, withoutOption);
  for (const value of [null, 0, 1, "false", "true", [], {}, undefined]) {
    publicDocument.parts[0].interaction.randomize = value;
    assert.throws(() => kind.normalizePublic(publicDocument), /randomize must be a boolean/);
  }
});

test("Drag & Drop hotspots use stable panel surfaces and separate bounded readable coordinates", () => {
  const { publicDocument } = dragDropImprovementsPair();
  const normalized = kind.normalizePublic(publicDocument);
  assert.deepEqual(nativeAudioTextHotspotTargets(normalized), [1, 2].map((n) => ({ panelId: dndId("panel", n), width: 1024, height: 582 })));
  assert.deepEqual(normalized.audioTextHotspots, publicDocument.audioTextHotspots);
  assert.deepEqual(nativeAudioTextAssetRequirements(normalized), [{ slot: "audio", mediaType: "audio/mpeg", label: "Audio hotspot 2" }]);
  assert.doesNotThrow(() => assertPublicBuilderDocument(normalized));
  for (const mutate of [
    (d) => { d.audioTextHotspots.hotspots[0].panelId = "missing"; },
    (d) => { d.audioTextHotspots.hotspots[0].activityArea.x = 1024; },
    (d) => { d.audioTextHotspots.hotspots[0].readableFocusArea.y = 1800; },
    (d) => { d.audioTextHotspots.hotspots[0].audioAssetSlot = "missing"; },
  ]) { const invalid = structuredClone(normalized); mutate(invalid); assert.throws(() => kind.normalizePublic(invalid)); }
  normalized.parts[0].interaction.panels.reverse();
  assert.deepEqual(kind.normalizePublic(normalized).audioTextHotspots, publicDocument.audioTextHotspots);
});

test("panel removal cleans orphan hotspots/audio while shared references survive; resizing only moves markers", () => {
  const pair = dragDropImprovementsPair();
  const pub = pair.publicDocument;
  const before = structuredClone(pub.audioTextHotspots);
  resizeNativeDragDropAudioTextHotspots(pub, dndId("panel", 2), { width: 1024, height: 582 }, { width: 600, height: 1000 });
  const marker = pub.audioTextHotspots.hotspots[1];
  assert.deepEqual(marker.readableFocusArea, before.hotspots[1].readableFocusArea);
  assert.deepEqual(marker.readableHighlightArea, before.hotspots[1].readableHighlightArea);
  assert.deepEqual(pub.audioTextHotspots.hotspots[0], before.hotspots[0]);
  assert.equal(marker.activityArea.width, marker.activityArea.height);
  assert.ok(marker.activityArea.x + marker.activityArea.width <= 600);
  removeNativeDragDropPanel(pub, pair.teacherDocument, dndId("panel", 2));
  assert.equal(pub.assets.some((a) => a.slot === "audio"), false);
  assert.equal(pub.assets.some((a) => a.slot === "background"), true);
  assert.doesNotThrow(() => kind.normalizePublic(pub));
  removeNativeDragDropPanel(pub, pair.teacherDocument, dndId("panel", 1));
  assert.equal(Object.hasOwn(pub, "audioTextHotspots"), false);
  assert.deepEqual(pub.assets.map((a) => a.slot), ["item", "readable"]);
});

test("X/Y required placements retain reusable X across targets, duplicate text identities, and instance removal", () => {
  const { publicDocument, teacherDocument } = dragDropImprovementsPair();
  const pub = kind.normalizePublic(publicDocument);
  assert.equal(kind.validatePair(pub, kind.normalizeTeacher(teacherDocument)), true);
  for (const order of [[1, 2], [2, 1]]) {
    let responses = {};
    for (const n of order) responses = placeNativeDragDropWord(responses, dndId("target", 1), dndId("word", n), { capacity: 2, reusable: n === 1 });
    responses = placeNativeDragDropWord(responses, dndId("target", 2), dndId("word", 1), { reusable: true });
    assert.deepEqual(normalizeNativeDragDropResponses(responses, pub), responses);
    assert.deepEqual(placeNativeDragDropWord(responses, dndId("target", 1), dndId("word", 1), { capacity: 2, reusable: true }), responses);
    const words = pub.parts[0].interaction.words;
    assert.deepEqual(visibleNativeDragDropWordIds(words.map((w) => w.id), responses, null, words), [1, 3, 4].map((n) => dndId("word", n)));
    assert.deepEqual(removeNativeDragDropResponse(responses, dndId("target", 1), dndId("word", 1))[dndId("target", 2)], [dndId("word", 1)]);
    const capability = nativeAssignmentCapability("drag-drop", pub);
    const payload = { items: [...Object.entries(responses).map(([id, value]) => ({ id, value })), { id: dndId("target", 3), value: [dndId("word", 3)] }] };
    assert.equal(capability.evaluateResponse(pub, teacherDocument, payload).scorePercent, 100);
    assert.ok(capability.teacherReviewProjection(pub, teacherDocument, payload).every((entry) => entry.isCorrect));
    payload.items.find((item) => item.id === dndId("target", 1)).value = [dndId("word", 1)];
    assert.equal(capability.evaluateResponse(pub, teacherDocument, payload).correctCount, 2, "X alone does not satisfy the X/Y target");
  }
  pub.parts[0].interaction.words[0].reusable = false;
  assert.throws(() => kind.validatePair(pub, kind.normalizeTeacher(teacherDocument)), /reusable/i);
});

test("multipart persists Randomize on the parent and projects the same child interaction without child media", () => {
  const parent = structuredClone(sharedFive);
  const section = parent.parts[0].interaction.sections.find((s) => s.kind === "drag-drop");
  section.interaction.randomize = false;
  const multipart = resolveNativeActivityKind("multi-part");
  const saved = multipart.normalizePublic(JSON.parse(JSON.stringify(parent)));
  const child = projectNativeMultiPartChild(saved, saved.parts[0].interaction.sections.find((s) => s.id === section.id), sharedFiveTeacher);
  assert.equal(child.publicDocument.parts[0].interaction.randomize, false);
  assert.deepEqual(child.publicDocument.parts[0].interaction.words, section.interaction.words);
  assert.equal(child.publicDocument.readableText, undefined);
  assert.equal(child.publicDocument.audioTextHotspots, undefined);
});
