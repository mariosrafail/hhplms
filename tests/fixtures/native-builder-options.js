import { publicDocument, teacherDocument } from "./native-runtime-regressions/multi-part-data.js";
import { projectNativeMultiPartChild } from "../../src/data/native-activities/nativeMultiPart.js";
import { nativeMarkerCandidate, markerId } from "./native-marker-candidate.js";
import { enableOutlineCategories } from "../../src/data/native-activities/nativeMarkWordsVisualAuthoring.js";
import { DEFAULT_MARK_WORDS_MARKER } from "../../src/data/native-activities/nativeMarkWordsMarkers.js";
export const optionId = (prefix, n) => `${prefix}-${String(n).padStart(32, "0")}`;
export function alternativesPair() {
  const section = publicDocument.parts[0].interaction.sections[0];
  const pair = structuredClone(projectNativeMultiPartChild(publicDocument, section, teacherDocument));
  const interaction = pair.publicDocument.parts[0].interaction;
  interaction.randomize = false;
  interaction.words = ["apple", "banana", "orange", "pear"].map((text, index) => ({ id: optionId("word", index + 1), text, reusable: false, shortLabel: String.fromCharCode(65 + index) }));
  interaction.panels[0].images = [{ id: optionId("img", 1), assetSlot: "shared", area: { x: 0, y: 0, width: 1024, height: 582 }, order: 0, decorative: true, altText: "", fit: "contain", locked: true }];
  interaction.panels[0].dropTargets = interaction.words.map((word, index) => ({ id: optionId("target", index + 1), area: { x: 40 + index * 240, y: 80, width: 200, height: 60 }, accessibleLabel: `Target ${index + 1}`, capacity: 1, answerMode: "any", sentenceStart: index === 0 }));
  pair.teacherDocument.parts[0].solution.mappings = interaction.panels[0].dropTargets.map((target) => ({ targetId: target.id, wordIds: interaction.words.map((word) => word.id) }));
  return pair;
}
export function outlinePair() {
  const pair = nativeMarkerCandidate();
  const interaction = pair.publicDocument.parts[0].interaction;
  interaction.presentation.markerPresets = interaction.presentation.markerPresets.filter((preset) => preset.kind !== "outline");
  interaction.presentation.markerPresets.push(...["#0055cc", "#dd7700", "#228833"].map((color, i) => ({ id: markerId(i + 4), ...DEFAULT_MARK_WORDS_MARKER, kind: "outline", color })));
  enableOutlineCategories(pair.publicDocument, pair.teacherDocument, true);
  const answer = pair.teacherDocument.parts[0].solution.answers[0];
  answer.correctTargetIds.forEach((id, i) => { answer.categories[id] = ["#0055cc", "#dd7700"][i]; });
  return pair;
}
export function sharedTextPair() {
  const pair = structuredClone({ publicDocument, teacherDocument });
  const interaction = pair.publicDocument.parts[0].interaction;
  interaction.panels = [interaction.panels[0]];
  interaction.sections = interaction.sections.filter((section) => section.panelId === interaction.panels[0].id);
  pair.teacherDocument.parts[0].solution.sections = pair.teacherDocument.parts[0].solution.sections.filter((section) => interaction.sections.some((entry) => entry.id === section.id));
  interaction.sections.filter((section) => section.kind === "drag-drop").forEach((section, index) => {
    const child = section.interaction;
    child.layoutMode = "text"; child.textPanelHeightPx = 180; child.randomize = false;
    section.textRegion = { x: index * 512, y: 150, width: 500, height: 290 };
    child.words[0] = { id: child.words[0].id, text: "as a result", shortLabel: "A", reusable: false };
    child.panels[0].dropTargets[0] = { ...child.panels[0].dropTargets[0], area: { x: index * 512 + 40, y: 370, width: 120, height: 40 }, sentenceStart: true, answerMode: "any" };
  });
  return pair;
}
