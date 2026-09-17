import { sharedFive, sharedFiveTeacher } from "./native-runtime-regressions/shared-five-data.js";
import { projectNativeMultiPartChild } from "../../src/data/native-activities/nativeMultiPart.js";
import { DEFAULT_MARK_WORDS_MARKER } from "../../src/data/native-activities/nativeMarkWordsMarkers.js";
export const markerId = (n) => `marker-${String(n).padStart(32, "0")}`;
export function nativeMarkerCandidate() {
  const section = sharedFive.parts[0].interaction.sections.find((entry) => entry.kind === "mark-the-words");
  const pair = structuredClone(projectNativeMultiPartChild(sharedFive, section, sharedFiveTeacher));
  const doc = pair.publicDocument; const interaction = doc.parts[0].interaction;
  interaction.presentation.markerPresets = [
    { id: markerId(1), ...DEFAULT_MARK_WORDS_MARKER, kind: "graphic", graphicAssetSlot: "graphic" },
    { id: markerId(2), ...DEFAULT_MARK_WORDS_MARKER, kind: "outline", color: "#be2030", thickness: 4 },
    { id: markerId(3), ...DEFAULT_MARK_WORDS_MARKER, color: "#208030" },
  ];
  doc.readableText = { kind: "image", assetSlot: "shared", sourceWidth: 1024, sourceHeight: 582, altText: "Readable fixture" };
  const panel = interaction.presentation.panels[0];
  pair.teacherDocument.parts[0].solution.answers[0].correctTargetIds = panel.hotspots.slice(0, 2).map((hotspot) => hotspot.targetId);
  doc.audioTextHotspots = { hotspots: [40, 275, 535].map((y, index) => ({ id: `aud-${String(index + 1).padStart(32, "0")}`, panelId: panel.id, activityArea: { x: 900, y, width: 20, height: 20 }, readableFocusArea: { x: 0, y: 0, width: 800, height: 500 }, readableHighlights: [1, 2, 3].map((n) => ({ id: `highlight-${String(n).padStart(32, "0")}`, area: { x: 30, y: n * 50, width: 150, height: 25 } })), focusLayout: "natural-width", audioAssetSlot: "", label: `Excerpt ${index + 1}` })) };
  return pair;
}
