import { normalizeMarkWordsMarker } from "./nativeMarkWordsMarkers.js";
import { isNativeChildId } from "./nativeChildIdentity.js";
import { normalizeNativePedagogicalText } from "./nativePedagogicalText.js";

export const MARK_WORDS_VISUAL_VERSION = "mark-the-words.visual.v1";
export const isMarkWordsVisual = (interaction) => interaction?.presentation?.kind === "visual-target";
const exact = (value, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error("Visual target has missing or unknown fields.");
};
const integer = (value, min, max) => { if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error("Visual target geometry is outside canvas bounds."); };
const identity = (value, prefix, seen) => { if (!isNativeChildId(value, prefix) || seen.has(value)) throw new Error("Visual target identity is invalid or duplicate."); seen.add(value); };
const area = (value, panel) => {
  exact(value, ["x", "y", "width", "height"]);
  integer(value.x, 0, panel.sourceWidth - 1); integer(value.y, 0, panel.sourceHeight - 1);
  integer(value.width, 1, panel.sourceWidth - value.x); integer(value.height, 1, panel.sourceHeight - value.y);
  return { ...value };
};
export function createEmptyMarkWordsVisualInteraction() {
  return { kind: "mark-the-words", schemaVersion: MARK_WORDS_VISUAL_VERSION, targets: [], presentation: { kind: "visual-target", panels: [] } };
}
export function createEmptyMarkWordsVisualSolution() {
  return { kind: "mark-the-words", schemaVersion: MARK_WORDS_VISUAL_VERSION, answers: [] };
}
export function normalizeMarkWordsVisualInteraction(input, { assets = [] } = {}) {
  exact(input, ["kind", "schemaVersion", "targets", "presentation"]);
  if (input.kind !== "mark-the-words" || input.schemaVersion !== MARK_WORDS_VISUAL_VERSION || !Array.isArray(input.targets) || input.targets.length > 800) throw new Error("Visual target version or limits are invalid.");
  const seen = new Set();
  const targets = input.targets.map((target) => {
    exact(target, ["id", "label"]); identity(target.id, "target", seen);
    return { id: target.id, label: normalizeNativePedagogicalText(target.label, "Target label", 300) };
  });
  const hasPresets = Object.hasOwn(input.presentation, "markerPresets");
  exact(input.presentation, ["kind", "panels", ...(hasPresets ? ["markerPresets"] : [])]);
  let markerPresets;
  if (hasPresets) {
    if (!Array.isArray(input.presentation.markerPresets) || input.presentation.markerPresets.length > 32) throw new Error("Marker palette exceeds limits.");
    const ids = new Set();
    markerPresets = input.presentation.markerPresets.map((preset) => { const normalized = normalizeMarkWordsMarker(preset, assets, { preset: true }); if (ids.has(preset.id)) throw new Error("Duplicate marker preset."); ids.add(preset.id); return normalized; });
  }
  if (!isMarkWordsVisual(input) || !Array.isArray(input.presentation.panels) || input.presentation.panels.length > 8) throw new Error("Visual target panels are invalid.");
  const mapped = new Set();
  const panels = input.presentation.panels.map((panel) => {
    exact(panel, ["id", "backgroundAssetSlot", "sourceWidth", "sourceHeight", "hotspots"]); identity(panel.id, "panel", seen);
    integer(panel.sourceWidth, 1, 16384); integer(panel.sourceHeight, 1, 16384);
    if (panel.backgroundAssetSlot !== "" && !assets.some((asset) => asset.slot === panel.backgroundAssetSlot && asset.role === "activity_artwork")) throw new Error("Visual background must reference managed artwork.");
    if (!Array.isArray(panel.hotspots) || panel.hotspots.length > 800) throw new Error("Visual hotspots exceed limits.");
    const hotspots = panel.hotspots.map((hotspot) => {
      exact(hotspot, ["id", "targetId", "area", "markArea", "graphicAssetSlot", ...(Object.hasOwn(hotspot, "marker") ? ["marker"] : [])]);
      if (Object.hasOwn(hotspot, "marker")) { normalizeMarkWordsMarker(hotspot.marker, assets); if (hotspot.marker.graphicAssetSlot !== hotspot.graphicAssetSlot) throw new Error("Marker graphic binding mismatch."); } identity(hotspot.id, "hot", seen);
      if (!targets.some((target) => target.id === hotspot.targetId) || mapped.has(hotspot.targetId)) throw new Error("Visual hotspot must bind one unique target.");
      mapped.add(hotspot.targetId);
      if (hotspot.graphicAssetSlot !== null && !assets.some((asset) => asset.slot === hotspot.graphicAssetSlot && asset.role === "activity_artwork")) throw new Error("Visual graphic must reference managed artwork or No graphic.");
      return { ...hotspot, area: area(hotspot.area, panel), markArea: area(hotspot.markArea, panel) };
    });
    for (let a = 0; a < hotspots.length; a++) for (let b = a + 1; b < hotspots.length; b++) {
      const x = hotspots[a].area; const y = hotspots[b].area;
      if (x.x < y.x + y.width && y.x < x.x + x.width && x.y < y.y + y.height && y.y < x.y + x.height) throw new Error("Visual click areas must not overlap.");
    }
    return { ...panel, hotspots };
  });
  if (mapped.size !== targets.length) throw new Error("Every visual target must have a hotspot.");
  return { kind: input.kind, schemaVersion: MARK_WORDS_VISUAL_VERSION, targets, presentation: { kind: "visual-target", panels, ...(hasPresets ? { markerPresets } : {}) } };
}
export function normalizeMarkWordsVisualSolution(input) {
  exact(input, ["kind", "schemaVersion", "answers"]);
  if (input.kind !== "mark-the-words" || input.schemaVersion !== MARK_WORDS_VISUAL_VERSION || !Array.isArray(input.answers) || input.answers.length > 8) throw new Error("Visual Teacher version or limits are invalid.");
  const seen = new Set();
  return { ...input, answers: input.answers.map((answer) => {
    exact(answer, ["panelId", "correctTargetIds"]); identity(answer.panelId, "panel", seen);
    if (!Array.isArray(answer.correctTargetIds) || answer.correctTargetIds.length > 800) throw new Error("Visual Teacher targets exceed limits.");
    const ids = new Set(); answer.correctTargetIds.forEach((id) => identity(id, "target", ids));
    return { panelId: answer.panelId, correctTargetIds: [...answer.correctTargetIds] };
  }) };
}
export function validateMarkWordsVisualTopology(interaction, solution) {
  normalizeMarkWordsVisualSolution(solution);
  const panels = interaction.presentation.panels;
  if (panels.length !== solution.answers.length || panels.some((panel, index) => {
    const answer = solution.answers[index];
    const ordered = panel.hotspots.filter((hotspot) => answer?.correctTargetIds.includes(hotspot.targetId)).map((hotspot) => hotspot.targetId);
    return answer?.panelId !== panel.id || JSON.stringify(ordered) !== JSON.stringify(answer.correctTargetIds);
  })) throw new Error("Visual Teacher answers must match panel identities and target order.");
}
export function markWordsResponseGroups(interaction) {
  return isMarkWordsVisual(interaction)
    ? interaction.presentation.panels.map((panel) => ({ id: panel.id, options: panel.hotspots.map((hotspot) => hotspot.targetId) }))
    : interaction.items.map((item) => ({ id: item.id, options: item.words.map((word) => word.id) }));
}
export function markWordsAnswerGroups(solution) {
  return new Map(solution.answers.map((answer) => [answer.panelId ?? answer.itemId, answer.correctTargetIds ?? answer.correctWordIds]));
}
