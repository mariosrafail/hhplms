import { validateMarkWordsSelectionMarkers, markWordsMarkerPresets } from "./nativeMarkWordsMarkers.js";
import { isMarkWordsVisual, markWordsResponseGroups } from "./nativeMarkWordsVisualTargets.js";
export function restoreNativeMarkWordsResponses(document, input) {
  const result = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return result;
  for (const item of markWordsResponseGroups(document.parts[0].interaction)) {
    const selected = input[item.id];
    if (!Array.isArray(selected) || new Set(selected).size !== selected.length || selected.some((id) => typeof id !== "string" || !item.options.includes(id))) continue;
    result[item.id] = item.options.filter((id) => selected.includes(id));
    if (input.markers?.[item.id]) {
      try { const markers = validateMarkWordsSelectionMarkers(document.parts[0].interaction, item.id, selected, input.markers[item.id]); result.markers ||= {}; result.markers[item.id] = markers; } catch { /* Invalid metadata never changes the selected answer. */ }
    }
  }
  return result;
}

export function toggleNativeMarkWordsResponse(document, responses, itemId, wordId, markerId = null) {
  if (!isMarkWordsVisual(document.parts[0].interaction)) markerId = null;
  const current = restoreNativeMarkWordsResponses(document, responses);
  const item = markWordsResponseGroups(document.parts[0].interaction).find((entry) => entry.id === itemId);
  if (!item?.options.includes(wordId)) return current;
  const selected = new Set(current[itemId] || []);
  if (selected.has(wordId)) selected.delete(wordId); else selected.add(wordId);
  const next = { ...current, [itemId]: item.options.filter((id) => selected.has(id)) };
  if (markerId !== null || current.markers) {
    const markers = { ...(current.markers?.[itemId] || {}) };
    delete markers[wordId];
    if (selected.has(wordId) && markWordsMarkerPresets(document.parts[0].interaction).some((preset) => preset.id === markerId)) markers[wordId] = markerId;
    next.markers = { ...current.markers, [itemId]: markers };
  }
  return next;
}
