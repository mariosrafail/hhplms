import { DEFAULT_MARK_WORDS_MARKER, markWordsMarkerArea, isOutlineCategoryMode, outlineCategory, outlineCategoryPresets } from "./nativeMarkWordsMarkers.js";
import { createNativeChildId } from "./nativeChildIdentity.js";
import { removeNativeManagedAssetReferenceIfUnused } from "./nativeActivityPublic.js";

export function alignVisualTargetAnswers(pub, teacher) {
  const previous = new Map(teacher.parts[0].solution.answers.map((answer) => [answer.panelId, answer]));
  teacher.parts[0].solution.answers = pub.parts[0].interaction.presentation.panels.map((panel) => ({ ...(isOutlineCategoryMode(pub.parts[0].interaction) ? { categories: Object.fromEntries(Object.entries(previous.get(panel.id)?.categories || {}).filter(([id]) => panel.hotspots.some((hotspot) => hotspot.targetId === id))) } : {}), panelId: panel.id, correctTargetIds: panel.hotspots.filter((hotspot) => previous.get(panel.id)?.correctTargetIds.includes(hotspot.targetId)).map((hotspot) => hotspot.targetId) }));
}
export function addVisualTarget(pub, teacher, panelId, area, createId = createNativeChildId, defaults = {}) {
  const interaction = pub.parts[0].interaction;
  const target = { id: createId("target"), label: `Target ${interaction.targets.length + 1}` };
  const marker = { ...DEFAULT_MARK_WORDS_MARKER, ...defaults.marker };
  const hotspot = { id: createId("hot"), targetId: target.id, area: { ...area }, markArea: markWordsMarkerArea(area, marker), graphicAssetSlot: marker.graphicAssetSlot, marker };
  if (isOutlineCategoryMode(interaction)) { delete hotspot.marker; hotspot.graphicAssetSlot = null; hotspot.markArea = { ...area }; }
  interaction.targets.push(target);
  interaction.presentation.panels.find((panel) => panel.id === panelId).hotspots.push(hotspot);
  alignVisualTargetAnswers(pub, teacher);
  if (defaults.correct) setVisualTargetCorrect(pub, teacher, panelId, target.id, true, marker);
  return hotspot.id;
}
export function removeVisualTarget(pub, teacher, panelId, hotspotId) {
  const interaction = pub.parts[0].interaction;
  const panel = interaction.presentation.panels.find((entry) => entry.id === panelId);
  const hotspot = panel.hotspots.find((entry) => entry.id === hotspotId);
  panel.hotspots = panel.hotspots.filter((entry) => entry.id !== hotspotId);
  interaction.targets = interaction.targets.filter((target) => target.id !== hotspot?.targetId);
  alignVisualTargetAnswers(pub, teacher);
  if (hotspot?.graphicAssetSlot) removeNativeManagedAssetReferenceIfUnused(pub, hotspot.graphicAssetSlot);
}
export function setVisualTargetCorrect(pub, teacher, panelId, targetId, correct, marker = null) {
  const panel = pub.parts[0].interaction.presentation.panels.find((entry) => entry.id === panelId);
  const answer = teacher.parts[0].solution.answers.find((entry) => entry.panelId === panelId);
  if (isOutlineCategoryMode(pub.parts[0].interaction)) {
    answer.categories ||= {};
    if (correct) answer.categories[targetId] = outlineCategory(marker) || answer.categories[targetId] || outlineCategory(outlineCategoryPresets(pub.parts[0].interaction)[0]);
    else delete answer.categories[targetId];
  }
  const ids = new Set(answer.correctTargetIds);
  if (correct) ids.add(targetId); else ids.delete(targetId);
  answer.correctTargetIds = panel.hotspots.filter((hotspot) => ids.has(hotspot.targetId)).map((hotspot) => hotspot.targetId);
}

export function enableOutlineCategories(pub, teacher, enabled, { confirmed = false } = {}) {
  const interaction = pub.parts[0].interaction;
  if (!enabled && isOutlineCategoryMode(interaction) && !confirmed) throw new Error("Confirm discarding private category assignments before disabling category grading.");
  if (enabled && isOutlineCategoryMode(interaction)) return;
  if (!enabled) { delete interaction.answerMode; for (const answer of teacher.parts[0].solution.answers) delete answer.categories; return; }
  const fallback = outlineCategoryPresets(interaction)[0];
  if (!fallback) throw new Error("Add an outline color to the palette first.");
  interaction.answerMode = "outline-category";
  for (const panel of interaction.presentation.panels) {
    const answer = teacher.parts[0].solution.answers.find((entry) => entry.panelId === panel.id);
    answer.categories = {};
    for (const hotspot of panel.hotspots) {
      if (answer.correctTargetIds.includes(hotspot.targetId)) answer.categories[hotspot.targetId] = outlineCategory(hotspot.marker) || outlineCategory(fallback);
      delete hotspot.marker; hotspot.graphicAssetSlot = null; hotspot.markArea = { ...hotspot.area };
    }
  }
}
