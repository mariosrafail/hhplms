import { isNativeChildId } from "./nativeChildIdentity.js";
import { nativeOpenResponsePanels } from "./nativeOpenResponse.js";

export const NATIVE_AUDIO_TEXT_HOTSPOT_LIMITS = Object.freeze({
  hotspots: 16,
  labelLength: 160,
  minimumSize: 16,
  maximumSize: 192,
});

export const NATIVE_AUDIO_TEXT_HIGHLIGHT_COLORS = Object.freeze(["yellow", "green", "cyan", "pink"]);
export const NATIVE_AUDIO_TEXT_DEFAULT_HIGHLIGHT_COLOR = "yellow";
export const NATIVE_AUDIO_TEXT_FOCUS_LAYOUTS = Object.freeze(["fixed-aspect", "natural-width"]);
export const NATIVE_AUDIO_TEXT_FIXED_FOCUS_ASPECT_RATIO = 1024 / 291;
export const NATIVE_AUDIO_TEXT_LEGACY_ASPECT_TOLERANCE = 0.015;

export function nativeAudioTextFocusLayout(hotspot) {
  if (NATIVE_AUDIO_TEXT_FOCUS_LAYOUTS.includes(hotspot?.focusLayout)) return hotspot.focusLayout;
  const focus = hotspot?.readableFocusArea;
  if (!focus?.width || !focus?.height) return "natural-width";
  const relativeDifference = Math.abs(focus.width / focus.height - NATIVE_AUDIO_TEXT_FIXED_FOCUS_ASPECT_RATIO) / NATIVE_AUDIO_TEXT_FIXED_FOCUS_ASPECT_RATIO;
  return relativeDifference <= NATIVE_AUDIO_TEXT_LEGACY_ASPECT_TOLERANCE ? "fixed-aspect" : "natural-width";
}

export function nativeAudioTextHighlightColor(value) {
  return NATIVE_AUDIO_TEXT_HIGHLIGHT_COLORS.includes(value) ? value : NATIVE_AUDIO_TEXT_DEFAULT_HIGHLIGHT_COLOR;
}

export function nativeAudioTextReadableHighlightArea(hotspot) {
  if (hotspot && Object.hasOwn(hotspot, "readableHighlightArea")) return hotspot.readableHighlightArea;
  const focus = hotspot?.readableFocusArea;
  if (!focus) return null;
  const insetX = Math.min(Math.max(1, Math.round(focus.width * 0.04)), Math.max(0, Math.floor((focus.width - 1) / 2)));
  const insetY = Math.min(Math.max(1, Math.round(focus.height * 0.08)), Math.max(0, Math.floor((focus.height - 1) / 2)));
  return { x: focus.x + insetX, y: focus.y + insetY, width: focus.width - insetX * 2, height: focus.height - insetY * 2 };
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(object(value, label)).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} has missing or unknown fields.`);
}

function coordinate(value, label, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${label} is invalid.`);
  return Math.round(value * 1_000) / 1_000;
}

function area(input, label, bounds, { circular = false } = {}) {
  exactKeys(input, ["x", "y", "width", "height"], label);
  const normalized = {
    x: coordinate(input.x, `${label}.x`, 0, bounds.width),
    y: coordinate(input.y, `${label}.y`, 0, bounds.height),
    width: coordinate(input.width, `${label}.width`, 1, bounds.width),
    height: coordinate(input.height, `${label}.height`, 1, bounds.height),
  };
  if (normalized.x + normalized.width > bounds.width || normalized.y + normalized.height > bounds.height) throw new Error(`${label} must stay inside its source image.`);
  if (circular && (normalized.width !== normalized.height
    || normalized.width < NATIVE_AUDIO_TEXT_HOTSPOT_LIMITS.minimumSize
    || normalized.width > NATIVE_AUDIO_TEXT_HOTSPOT_LIMITS.maximumSize)) {
    throw new Error(`${label} must be a small circular hotspot.`);
  }
  return normalized;
}

export function nativeAudioTextHotspotTargets(publicDocument) {
  const interaction = publicDocument?.parts?.[0]?.interaction;
  if (publicDocument?.kind === "drag-drop") {
    return (interaction?.panels || []).map((panel) => ({ panelId: panel.id, width: panel.surface.width, height: panel.surface.height }));
  }
  if (publicDocument?.kind === "open-response" && interaction?.presentation?.kind === "panels") {
    return nativeOpenResponsePanels(interaction).map((panel) => ({ panelId: panel.id, width: panel.surface.width, height: panel.surface.height }));
  }
  if (["image", "open-response"].includes(publicDocument?.kind) && interaction?.surface) {
    return [{ panelId: null, width: interaction.surface.width, height: interaction.surface.height }];
  }
  if (publicDocument?.kind === "single-choice" && interaction?.presentation?.kind === "image-hotspot") {
    return interaction.presentation.panels.map((panel) => ({ panelId: panel.id, width: panel.sourceWidth, height: panel.sourceHeight }));
  }
  if (publicDocument?.kind === "complete-sentences" && interaction?.presentation?.kind === "image-hotspot") {
    return interaction.presentation.panels.map((panel) => ({ panelId: panel.id, width: panel.sourceWidth, height: panel.sourceHeight }));
  }
  return [];
}

export function candidateNativeAudioTextAssetSlots(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !Array.isArray(input.hotspots)) return [];
  return input.hotspots.map((hotspot) => hotspot?.audioAssetSlot).filter((slot) => typeof slot === "string" && slot.trim());
}

export function normalizeNativeAudioTextHotspots(input, publicDocument) {
  const value = structuredClone(object(input, "Native audio/text hotspots"));
  exactKeys(value, ["hotspots"], "Native audio/text hotspots");
  if (!publicDocument.readableText) throw new Error("Native audio/text hotspots require Readable Text.");
  if (!Array.isArray(value.hotspots) || value.hotspots.length < 1 || value.hotspots.length > NATIVE_AUDIO_TEXT_HOTSPOT_LIMITS.hotspots) {
    throw new Error("Native audio/text hotspot count is invalid.");
  }
  const targets = nativeAudioTextHotspotTargets(publicDocument);
  if (!targets.length) throw new Error("Native audio/text hotspots require a visual activity surface.");
  const targetByPanel = new Map(targets.map((target) => [target.panelId, target]));
  const assetsBySlot = new Map(publicDocument.assets.map((asset) => [asset.slot, asset]));
  const ids = new Set();
  return {
    hotspots: value.hotspots.map((entry, index) => {
      const label = `Native audio/text hotspots[${index}]`;
      const hasHighlightColor = Object.hasOwn(entry, "highlightColor");
      const hasReadableHighlightArea = Object.hasOwn(entry, "readableHighlightArea");
      const hasFocusLayout = Object.hasOwn(entry, "focusLayout");
      exactKeys(entry, ["id", "panelId", "activityArea", "readableFocusArea", ...(hasReadableHighlightArea ? ["readableHighlightArea"] : []), "audioAssetSlot", "label", ...(hasHighlightColor ? ["highlightColor"] : []), ...(hasFocusLayout ? ["focusLayout"] : [])], label);
      if (!isNativeChildId(entry.id, "aud") || ids.has(entry.id)) throw new Error(`${label}.id is invalid or duplicate.`);
      ids.add(entry.id);
      if (entry.panelId !== null && typeof entry.panelId !== "string") throw new Error(`${label}.panelId is invalid.`);
      const target = targetByPanel.get(entry.panelId);
      if (!target) throw new Error(`${label}.panelId does not reference a visual activity surface.`);
      const audioAssetSlot = entry.audioAssetSlot;
      if (typeof audioAssetSlot !== "string") throw new Error(`${label}.audioAssetSlot is invalid.`);
      const audio = audioAssetSlot ? assetsBySlot.get(audioAssetSlot) : null;
      if (audioAssetSlot && (!audio || audio.role !== "activity_artwork" || audio.slot === publicDocument.readableText.assetSlot)) {
        throw new Error(`${label}.audioAssetSlot does not reference managed native audio.`);
      }
      if (typeof entry.label !== "string" || !entry.label.trim() || entry.label.length > NATIVE_AUDIO_TEXT_HOTSPOT_LIMITS.labelLength
        || /[<>\u0000-\u001f\u007f]/.test(entry.label)) throw new Error(`${label}.label is invalid.`);
      if (hasHighlightColor && !NATIVE_AUDIO_TEXT_HIGHLIGHT_COLORS.includes(entry.highlightColor)) throw new Error(`${label}.highlightColor is invalid.`);
      if (hasFocusLayout && !NATIVE_AUDIO_TEXT_FOCUS_LAYOUTS.includes(entry.focusLayout)) throw new Error(`${label}.focusLayout is invalid.`);
      const readableBounds = { width: publicDocument.readableText.sourceWidth, height: publicDocument.readableText.sourceHeight };
      const normalizedFocusArea = area(entry.readableFocusArea, `${label}.readableFocusArea`, readableBounds);
      const normalizedHighlightArea = hasReadableHighlightArea && entry.readableHighlightArea !== null
        ? area(entry.readableHighlightArea, `${label}.readableHighlightArea`, readableBounds)
        : null;
      if (normalizedHighlightArea && (normalizedHighlightArea.x < normalizedFocusArea.x
        || normalizedHighlightArea.y < normalizedFocusArea.y
        || normalizedHighlightArea.x + normalizedHighlightArea.width > normalizedFocusArea.x + normalizedFocusArea.width
        || normalizedHighlightArea.y + normalizedHighlightArea.height > normalizedFocusArea.y + normalizedFocusArea.height)) {
        throw new Error(`${label}.readableHighlightArea must stay inside readableFocusArea.`);
      }
      const normalized = {
        id: entry.id,
        panelId: entry.panelId,
        activityArea: area(entry.activityArea, `${label}.activityArea`, target, { circular: true }),
        readableFocusArea: normalizedFocusArea,
        ...(hasFocusLayout ? { focusLayout: entry.focusLayout } : {}),
        audioAssetSlot: audio?.slot || "",
        label: entry.label.trim(),
      };
      if (hasReadableHighlightArea) normalized.readableHighlightArea = normalizedHighlightArea;
      if (hasHighlightColor) normalized.highlightColor = entry.highlightColor;
      return normalized;
    }),
  };
}

export function nativeAudioTextAssetRequirements(publicDocument) {
  const seen = new Set();
  return (publicDocument?.audioTextHotspots?.hotspots || []).flatMap((hotspot, index) => {
    const slot = hotspot.audioAssetSlot;
    if (typeof slot !== "string" || !slot.trim() || seen.has(slot)) return [];
    seen.add(slot);
    return [{ slot, mediaType: "audio/mpeg", label: `Audio hotspot ${index + 1}` }];
  });
}
