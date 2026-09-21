import { isNativeChildId } from "./nativeChildIdentity.js";

export const DEFAULT_MARK_WORDS_MARKER = Object.freeze({ kind: "underline", color: "#e0a000", thickness: 3, height: 3, alignment: "bottom", graphicAssetSlot: null });
export function normalizeMarkWordsMarker(value, assets, { preset = false } = {}) {
  const keys = ["kind", "color", "thickness", "height", "alignment", "graphicAssetSlot", ...(preset ? ["id"] : [])];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== keys.sort().join()) throw new Error("Marker has missing or unknown fields.");
  if (preset && !isNativeChildId(value.id, "marker")) throw new Error("Invalid marker identity.");
  if (!["graphic", "outline", "underline"].includes(value.kind) || !(value.kind === "outline" ? /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i : /^#[0-9a-f]{6}$/i).test(value.color) || !["bottom", "manual"].includes(value.alignment)) throw new Error("Invalid marker style.");
  for (const key of ["thickness", "height"]) if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > 192) throw new Error("Invalid marker dimensions.");
  if (value.kind === "graphic" ? !assets.some((asset) => asset.slot === value.graphicAssetSlot && asset.role === "activity_artwork") : value.graphicAssetSlot !== null) throw new Error("Graphic marker requires managed artwork; style markers have no asset.");
  return { ...value };
}
export function markWordsMarkerArea(area, marker) {
  const height = Math.min(marker.kind === "underline" ? Math.max(marker.height, marker.thickness) : marker.height, area.height);
  return marker.kind === "outline" ? { ...area } : { x: area.x, y: area.y + area.height - height, width: area.width, height };
}
export function markWordsTargetMarker(hotspot) {
  return hotspot.marker || { ...DEFAULT_MARK_WORDS_MARKER, kind: hotspot.graphicAssetSlot ? "graphic" : "underline", graphicAssetSlot: hotspot.graphicAssetSlot || null, alignment: "manual" };
}
export function markWordsMarkerPresets(interaction) {
  if (interaction.presentation?.markerPresets?.length) return interaction.presentation.markerPresets;
  const graphics = (interaction.presentation?.panels || []).flatMap((panel) => panel.hotspots).filter((hotspot) => hotspot.graphicAssetSlot);
  return [{ id: "default-underline", ...DEFAULT_MARK_WORDS_MARKER }, ...graphics.filter((hotspot, index) => graphics.findIndex((other) => other.graphicAssetSlot === hotspot.graphicAssetSlot) === index).map((hotspot) => ({ id: `legacy-${hotspot.id}`, ...markWordsTargetMarker(hotspot) }))];
}
export function validateMarkWordsSelectionMarkers(interaction, groupId, selected, markers) {
  if (!markers || typeof markers !== "object" || Array.isArray(markers)) throw new Error("Selection markers must be an object.");
  const presets = new Set(markWordsMarkerPresets(interaction).map((preset) => preset.id));
  const panel = interaction.presentation?.panels?.find((entry) => entry.id === groupId);
  if (!panel || Object.entries(markers).some(([id, marker]) => !selected.includes(id) || !panel.hotspots.some((hotspot) => hotspot.targetId === id) || typeof marker !== "string" || !presets.has(marker))) throw new Error("Unknown, foreign or unselected marker reference.");
  return Object.fromEntries(selected.filter((id) => Object.hasOwn(markers, id)).map((id) => [id, markers[id]]));
}

export const isOutlineCategoryMode = (interaction) => interaction?.answerMode === "outline-category";
export function outlineCategory(marker) {
  if (marker?.kind !== "outline" || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(marker.color)) return null;
  const hex = marker.color.slice(1).toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((value) => value + value).join("") : hex}`;
}
export function outlineCategoryPresets(interaction) {
  const seen = new Set();
  return markWordsMarkerPresets(interaction).filter((preset) => {
    const category = outlineCategory(preset);
    if (!category || seen.has(category)) return false;
    seen.add(category); return true;
  });
}
export function markWordsSelectionCategory(interaction, presetId) {
  return outlineCategory(markWordsMarkerPresets(interaction).find((preset) => preset.id === presetId));
}
