import { DEFAULT_MARK_WORDS_MARKER, markWordsMarkerArea } from "./nativeMarkWordsMarkers.js";
import { createNativeChildId } from "./nativeChildIdentity.js";
import { removeNativeManagedAssetReferenceIfUnused } from "./nativeActivityPublic.js";

export function alignVisualTargetAnswers(pub, teacher) {
  const previous = new Map(teacher.parts[0].solution.answers.map((answer) => [answer.panelId, answer.correctTargetIds]));
  teacher.parts[0].solution.answers = pub.parts[0].interaction.presentation.panels.map((panel) => ({ panelId: panel.id, correctTargetIds: panel.hotspots.filter((hotspot) => previous.get(panel.id)?.includes(hotspot.targetId)).map((hotspot) => hotspot.targetId) }));
}
export function addVisualTarget(pub, teacher, panelId, area, createId = createNativeChildId, defaults = {}) {
  const interaction = pub.parts[0].interaction;
  const target = { id: createId("target"), label: `Target ${interaction.targets.length + 1}` };
  const marker = { ...DEFAULT_MARK_WORDS_MARKER, ...defaults.marker };
  const hotspot = { id: createId("hot"), targetId: target.id, area: { ...area }, markArea: markWordsMarkerArea(area, marker), graphicAssetSlot: marker.graphicAssetSlot, marker };
  interaction.targets.push(target);
  interaction.presentation.panels.find((panel) => panel.id === panelId).hotspots.push(hotspot);
  alignVisualTargetAnswers(pub, teacher);
  if (defaults.correct) setVisualTargetCorrect(pub, teacher, panelId, target.id, true);
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
export function setVisualTargetCorrect(pub, teacher, panelId, targetId, correct) {
  const panel = pub.parts[0].interaction.presentation.panels.find((entry) => entry.id === panelId);
  const answer = teacher.parts[0].solution.answers.find((entry) => entry.panelId === panelId);
  const ids = new Set(answer.correctTargetIds);
  if (correct) ids.add(targetId); else ids.delete(targetId);
  answer.correctTargetIds = panel.hotspots.filter((hotspot) => ids.has(hotspot.targetId)).map((hotspot) => hotspot.targetId);
}
