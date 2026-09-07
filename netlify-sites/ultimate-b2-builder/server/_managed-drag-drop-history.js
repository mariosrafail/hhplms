// Immutable managed-release verification only. See the frozen fixture provenance.
// These profiles must never be used by authoring, draft normalization or compilation.
export const MANAGED_DRAG_DROP_VERIFICATION_PROFILES = Object.freeze([
  "current", "original", "presentation",
]);

function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new Error("Historical Drag & Drop has unsupported fields.");
  }
}

export function normalizeHistoricalManagedDragDropPublic(value, activityId, kind, profile) {
  if (!["original", "presentation"].includes(profile)) throw new Error("Unknown historical Drag & Drop profile.");
  exact(value, ["schemaVersion", "activityId", "kind", "metadata", "placement", "assets", "parts",
    ...["readableText", "video", "audioTextHotspots"].filter((key) => Object.hasOwn(value, key))]);
  const interaction = value.parts?.[0]?.interaction;
  exact(interaction, ["kind", "words", "panels", ...(profile === "presentation" ? ["presentation"] : [])]);
  for (const word of interaction.words) {
    exact(word, ["id", "text"]);
    if (profile === "original" && /[\u0000-\u001f\u007f]/.test(word.text)) throw new Error("Original Drag & Drop words must be single line.");
  }
  if (profile === "original" && [value.metadata?.title, value.metadata?.visibleInstructionText, value.readableText?.altText,
    ...interaction.panels.flatMap((panel) => panel.images.map((image) => image.altText))].some((text) => /[\u0000-\u001f\u007f]/.test(text))) {
    throw new Error("Original Drag & Drop metadata and image descriptions must be single line.");
  }
  for (const panel of interaction.panels) {
    for (const target of panel.dropTargets) exact(target, ["id", "area", "accessibleLabel"]);
  }
  // Current validators supply IDs, bounds, asset liveness, styles and public-safety
  // invariants. Reconstruct only the independently checked historical field set.
  const normalized = kind.normalizePublic(value, activityId);
  const current = normalized.parts[0].interaction;
  normalized.parts[0].interaction = {
    kind: "drag-drop",
    words: current.words.map(({ id, text }) => ({ id, text })),
    ...(profile === "presentation" ? { presentation: current.presentation } : {}),
    panels: current.panels.map((panel) => ({ ...panel, dropTargets: panel.dropTargets.map(({ id, area, accessibleLabel }) => ({ id, area, accessibleLabel })) })),
  };
  return normalized;
}

export function normalizeHistoricalManagedDragDropTeacher(value, activityId, kind) {
  const solution = value.parts?.[0]?.solution;
  exact(solution, ["kind", "mappings"]);
  for (const mapping of solution.mappings) exact(mapping, ["targetId", "wordId"]);
  // No reused word instances were valid in either historical Teacher contract.
  if (new Set(solution.mappings.map((mapping) => mapping.wordId)).size !== solution.mappings.length) {
    throw new Error("Historical Drag & Drop word mappings must be unique.");
  }
  const normalized = kind.normalizeTeacher(value, activityId);
  normalized.parts[0].solution = { kind: "drag-drop", mappings: normalized.parts[0].solution.mappings.map(({ targetId, wordIds }) => ({ targetId, wordId: wordIds[0] })) };
  return normalized;
}
