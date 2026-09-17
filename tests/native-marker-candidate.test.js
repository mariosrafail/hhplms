import assert from "node:assert/strict";
import test from "node:test";
import { createMarkWordsFixture } from "./fixtures/native-mark-words.js";
import { nativeMarkerCandidate, markerId } from "./fixtures/native-marker-candidate.js";
import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { nativeAudioTextReadableHighlights, resizeNativeAudioTextHotspot } from "../src/data/native-activities/nativeAudioTextHotspots.js";
import { nativeActivityUsesManagedAssetSlot, removeNativeManagedAssetReferenceIfUnused } from "../src/data/native-activities/nativeActivityPublic.js";
import { nativeMarkWordsAssetRequirements } from "../src/data/native-activities/nativeMarkWords.js";
import { addVisualTarget, removeVisualTarget } from "../src/data/native-activities/nativeMarkWordsVisualAuthoring.js";
import { DEFAULT_MARK_WORDS_MARKER, markWordsMarkerArea } from "../src/data/native-activities/nativeMarkWordsMarkers.js";
import { toggleNativeMarkWordsResponse, restoreNativeMarkWordsResponses } from "../src/data/native-activities/nativeMarkWordsRuntime.js";
import { buildNativeFinalSubmission, restoreNativeSubmissionResponses } from "../src/components/lms/student/runtime/studentSubmissionContract.js";
import { normalizeMarkWordsResponse, scoreMarkWordsResponse } from "../netlify/functions/_book-content/mark-words-response.js";
import { createMultiPartSection } from "../src/apps/book-builder/hosted/nativeMultiPartAuthoring.js";
const kind = resolveNativeActivityKind("mark-the-words");
test("new standalone and flow children are image-only public/Teacher pairs", () => {
  const pub = kind.createBlankPublic({ activityId: "new", title: "New", placement: { pageId: "ub2-sb-unit-1-part-1" } });
  const teacher = kind.createBlankTeacher({ activityId: "new" });
  assert.equal(kind.validatePair(pub, teacher), true); assert.equal(pub.parts[0].interaction.presentation.kind, "visual-target"); assert.equal(pub.parts[0].interaction.items, undefined);
  const child = createMultiPartSection("mark-the-words", { layout: "flow", surface: { width: 1024, height: 582 } });
  assert.equal(child.section.interaction.presentation.kind, "visual-target"); assert.equal(child.privateSection.solution.schemaVersion, "mark-the-words.visual.v1");
});
test("highlights preserve stable identities, legacy absence/null and exact round-trips", () => {
  const { publicDocument: pub } = nativeMarkerCandidate();
  const first = pub.audioTextHotspots.hotspots[0]; const original = structuredClone(first.readableHighlights);
  assert.deepEqual(kind.normalizePublic(JSON.parse(JSON.stringify(pub))), pub);
  first.readableHighlights[1].area.x += 20; first.readableHighlights.splice(1, 1);
  assert.deepEqual(first.readableHighlights, [original[0], original[2]]);
  first.readableHighlights = []; assert.deepEqual(nativeAudioTextReadableHighlights(kind.normalizePublic(pub).audioTextHotspots.hotspots[0]), []);
  delete first.readableHighlights; assert.equal(nativeAudioTextReadableHighlights(first).length, 1);
  first.readableHighlightArea = null; assert.deepEqual(nativeAudioTextReadableHighlights(first), []);
  first.readableHighlightArea = original[0].area; assert.equal(nativeAudioTextReadableHighlights(first).length, 1);
  first.readableHighlights = original; assert.throws(() => kind.normalizePublic(pub), /one readable/);
  delete first.readableHighlightArea; first.readableHighlights[1].id = first.readableHighlights[0].id; assert.throws(() => kind.normalizePublic(pub), /duplicate/);
  const size = resizeNativeAudioTextHotspot({ x: 990, y: 550, width: 24, height: 24 }, 48, { width: 1024, height: 582 });
  assert.deepEqual(size, { x: 976, y: 534, width: 48, height: 48 });
});
test("drawing snapshots and palette-only assets survive cleanup and strict normalization", () => {
  const { publicDocument: pub, teacherDocument: teacher } = nativeMarkerCandidate(); const interaction = pub.parts[0].interaction; const panel = interaction.presentation.panels[0];
  const before = structuredClone(panel.hotspots);
  assert.deepEqual(markWordsMarkerArea({ x: 20, y: 40, width: 80, height: 30 }, { ...DEFAULT_MARK_WORDS_MARKER, thickness: 7 }), { x: 20, y: 63, width: 80, height: 7 });
  const id = addVisualTarget(pub, teacher, panel.id, { x: 20, y: 200, width: 80, height: 30 }, undefined, { correct: true, marker: { ...DEFAULT_MARK_WORDS_MARKER } });
  const added = panel.hotspots.at(-1); assert.deepEqual(added.markArea, { x: 20, y: 227, width: 80, height: 3 }); assert.deepEqual(panel.hotspots.slice(0, -1), before);
  assert.ok(teacher.parts[0].solution.answers[0].correctTargetIds.includes(added.targetId));
  removeVisualTarget(pub, teacher, panel.id, id); panel.hotspots.forEach((hotspot) => { hotspot.graphicAssetSlot = null; });
  removeNativeManagedAssetReferenceIfUnused(pub, "graphic"); assert.ok(nativeActivityUsesManagedAssetSlot(pub, "graphic")); assert.ok(nativeMarkWordsAssetRequirements(pub).some((entry) => entry.slot === "graphic"));
  kind.normalizePublic(pub); const bad = structuredClone(pub); bad.parts[0].interaction.presentation.markerPresets[0].url = "https://invalid"; assert.throws(() => kind.normalizePublic(bad));
});
test("selection markers survive toggle, submit and restoration without affecting exact-set scores", () => {
  const { publicDocument: pub, teacherDocument: teacher } = nativeMarkerCandidate(); const panel = pub.parts[0].interaction.presentation.panels[0]; const ids = panel.hotspots.map((hotspot) => hotspot.targetId);
  let responses = toggleNativeMarkWordsResponse(pub, {}, panel.id, ids[0], markerId(1));
  responses = toggleNativeMarkWordsResponse(pub, responses, panel.id, ids[1], markerId(2));
  assert.equal(responses.markers[panel.id][ids[0]], markerId(1));
  responses = toggleNativeMarkWordsResponse(pub, responses, panel.id, ids[0], markerId(2)); assert.equal(responses.markers[panel.id][ids[0]], undefined);
  responses = toggleNativeMarkWordsResponse(pub, responses, panel.id, ids[0], markerId(3));
  const envelope = buildNativeFinalSubmission({ target: { nativeKind: "mark-the-words", entry: { document: pub }, capability: { responseSchemaVersion: "native-response.v1" } }, responses }).response;
  const normalized = normalizeMarkWordsResponse(pub, envelope); assert.equal(normalized.error, undefined);
  assert.deepEqual(restoreNativeMarkWordsResponses(pub, restoreNativeSubmissionResponses(normalized.payload)), responses);
  for (const [selected, expected] of [[teacher.parts[0].solution.answers[0].correctTargetIds, 100], [ids, 0], [[ids[0]], 0], [[], 0]]) {
    for (const marker of [markerId(1), markerId(2)]) {
      const value = normalizeMarkWordsResponse(pub, { schemaVersion: "native-response.v1", items: [{ id: panel.id, value: selected, markers: Object.fromEntries(selected.map((id) => [id, marker])) }] });
      assert.equal(value.error, undefined); assert.equal(scoreMarkWordsResponse(pub, teacher, value.payload).scorePercent, expected);
    }
  }
  envelope.items[0].markers[ids[0]] = "foreign"; assert.ok(normalizeMarkWordsResponse(pub, envelope).error);
});

test("legacy text selections never acquire visual marker metadata", () => {
  const { publicDocument: pub } = createMarkWordsFixture();
  const item = pub.parts[0].interaction.items[0];
  const response = toggleNativeMarkWordsResponse(pub, {}, item.id, item.words[0].id, "default-underline");
  assert.deepEqual(response, { [item.id]: [item.words[0].id] });
});
