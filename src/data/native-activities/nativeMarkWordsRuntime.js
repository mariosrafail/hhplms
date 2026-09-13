import { markWordsResponseGroups } from "./nativeMarkWordsVisualTargets.js";
export function restoreNativeMarkWordsResponses(document, input) {
  const result = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return result;
  for (const item of markWordsResponseGroups(document.parts[0].interaction)) {
    const selected = input[item.id];
    if (!Array.isArray(selected) || new Set(selected).size !== selected.length || selected.some((id) => typeof id !== "string" || !item.options.includes(id))) continue;
    result[item.id] = item.options.filter((id) => selected.includes(id));
  }
  return result;
}

export function toggleNativeMarkWordsResponse(document, responses, itemId, wordId) {
  const current = restoreNativeMarkWordsResponses(document, responses);
  const item = markWordsResponseGroups(document.parts[0].interaction).find((entry) => entry.id === itemId);
  if (!item?.options.includes(wordId)) return current;
  const selected = new Set(current[itemId] || []);
  if (selected.has(wordId)) selected.delete(wordId); else selected.add(wordId);
  return { ...current, [itemId]: item.options.filter((id) => selected.has(id)) };
}
