// Stable-ID bipartite matching: alternatives are eligibility, not item reuse.
export function nativeDragDropAnswerAllocation(interaction, mappings) {
  const expected = new Map(mappings.map((mapping) => [mapping.targetId, mapping.wordIds || [mapping.wordId]]));
  const words = new Map(interaction.words.map((word) => [word.id, word]));
  const slots = interaction.panels.flatMap((panel) => panel.dropTargets).flatMap((target) => {
    const ids = expected.get(target.id) || [];
    return target.answerMode === "any" ? [{ targetId: target.id, ids }] : ids.map((id) => ({ targetId: target.id, ids: [id] }));
  });
  const owners = new Map(); const assigned = new Map();
  function assign(index, visited) {
    for (const id of slots[index].ids) {
      if (!words.has(id) || visited.has(id)) continue;
      visited.add(id);
      if (words.get(id).reusable || !owners.has(id) || assign(owners.get(id), visited)) {
        if (!words.get(id).reusable) owners.set(id, index);
        assigned.set(index, id); return true;
      }
    }
    return false;
  }
  for (let index = 0; index < slots.length; index++) if (!assign(index, new Set())) return null;
  const result = new Map();
  slots.forEach((slot, index) => result.set(slot.targetId, [...(result.get(slot.targetId) || []), assigned.get(index)]));
  return result;
}

export function nativeDragDropTargetCorrect(target, selected, expected) {
  return expected.length > 0 && (target.answerMode === "any"
    ? selected.length === 1 && expected.includes(selected[0])
    : selected.length === expected.length && new Set(selected).size === selected.length && selected.every((id) => expected.includes(id)));
}

export function nativeDragDropTargetText(word, target, teacher = false) {
  if (!teacher || !target.sentenceStart || word.image) return word.text;
  return word.text.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase());
}
