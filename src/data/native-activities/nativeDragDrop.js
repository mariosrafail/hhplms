import { NATIVE_ACTIVITY_SYSTEM_FONT_FAMILIES } from "./nativeActivityFont.js";
import { isNativeChildId } from "./nativeChildIdentity.js";
import { nativeActivityFontFamily } from "./nativeActivityFont.js";
import { NATIVE_IMAGE_DEFAULT_SURFACE, NATIVE_IMAGE_LIMITS, normalizeNativeImageInteraction } from "./nativeImage.js";
import { removeNativeManagedAssetReferenceIfUnused } from "./nativeActivityPublic.js";
import { normalizeNativePedagogicalText, normalizeNativeSingleLineText } from "./nativePedagogicalText.js";

export const NATIVE_DRAG_DROP_LIMITS = Object.freeze({
  words: 100,
  wordTextLength: 300,
  panels: 12,
  targetsPerPanel: 40,
  totalTargets: 120,
  targetLabelLength: 300,
  imagesPerPanel: NATIVE_IMAGE_LIMITS.images,
  surfaceMaximum: NATIVE_IMAGE_LIMITS.surfaceMaximum,
  fontSizeMinimum: 8,
  fontSizeMaximum: 96,
  answerBankHeightMinimum: 96,
  answerBankHeightMaximum: 420,
  textPanelHeightMinimum: 180,
  textPanelHeightMaximum: 900,
  itemImageDimension: 8_192,
  itemDisplayMinimum: 16,
  itemDisplayMaximum: 256,
});

export const NATIVE_DRAG_DROP_DEFAULT_SURFACE = NATIVE_IMAGE_DEFAULT_SURFACE;
export const NATIVE_DRAG_DROP_FONT_FAMILIES = NATIVE_ACTIVITY_SYSTEM_FONT_FAMILIES;
export const NATIVE_DRAG_DROP_DEFAULT_PRESENTATION = Object.freeze({
  bankWordStyle: Object.freeze({ fontFamily: "Arial", fontSize: 18, color: "#172033", fontAssetSlot: null }),
  placedAnswerStyle: Object.freeze({ fontFamily: "Arial", fontSize: 21, color: "#172033", fontAssetSlot: null }),
});
export const NATIVE_DRAG_DROP_LAYOUT_MODES = Object.freeze(["standard", "text"]);
export const NATIVE_DRAG_DROP_DEFAULT_LAYOUT = Object.freeze({
  layoutMode: "standard",
  answerBankHeightPx: 116,
  textPanelHeightPx: 360,
});

export function nativeDragDropShortLabel(index) {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error("Drag & Drop short-label index is invalid.");
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

export function nativeDragDropMappingWordIds(mapping) {
  if (Array.isArray(mapping?.wordIds)) return mapping.wordIds;
  return typeof mapping?.wordId === "string" ? [mapping.wordId] : [];
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

function number(value, label, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${label} is invalid.`);
  return Math.round(value * 1_000) / 1_000;
}

function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} is invalid.`);
  return value;
}

function normalizeArea(input, surface, label) {
  exactKeys(input, ["x", "y", "width", "height"], label);
  const area = {
    x: number(input.x, `${label}.x`, 0, surface.width),
    y: number(input.y, `${label}.y`, 0, surface.height),
    width: number(input.width, `${label}.width`, 1, surface.width),
    height: number(input.height, `${label}.height`, 1, surface.height),
  };
  if (area.x + area.width > surface.width || area.y + area.height > surface.height) throw new Error(`${label} must stay inside its logical surface.`);
  return area;
}

function normalizeTextStyle(input, label, assets) {
  exactKeys(input, ["fontFamily", "fontSize", "color", "fontAssetSlot"], label);
  if (!NATIVE_DRAG_DROP_FONT_FAMILIES.includes(input.fontFamily)) throw new Error(`${label}.fontFamily is not approved.`);
  const fontSize = number(input.fontSize, `${label}.fontSize`, NATIVE_DRAG_DROP_LIMITS.fontSizeMinimum, NATIVE_DRAG_DROP_LIMITS.fontSizeMaximum);
  if (typeof input.color !== "string" || !/^#[0-9a-f]{6}$/i.test(input.color)) throw new Error(`${label}.color is invalid.`);
  const fontAssetSlot = input.fontAssetSlot === null ? null : String(input.fontAssetSlot);
  if (fontAssetSlot !== null && !assets.some((asset) => asset.slot === fontAssetSlot && asset.role === "activity_font")) throw new Error(`${label}.fontAssetSlot does not reference an authorized font.`);
  return { fontFamily: input.fontFamily, fontSize, color: input.color.toLowerCase(), fontAssetSlot };
}

function normalizePresentation(input, assets) {
  if (input === undefined) return structuredClone(NATIVE_DRAG_DROP_DEFAULT_PRESENTATION);
  exactKeys(input, ["bankWordStyle", "placedAnswerStyle"], "Native Drag & Drop presentation");
  return {
    bankWordStyle: normalizeTextStyle(input.bankWordStyle, "Native Drag & Drop bank word style", assets),
    placedAnswerStyle: normalizeTextStyle(input.placedAnswerStyle, "Native Drag & Drop placed answer style", assets),
  };
}

function normalizeItemImage(input, label, assets) {
  const hasCaption = Object.hasOwn(object(input, label), "caption");
  exactKeys(input, ["assetSlot", "sourceWidth", "sourceHeight", "displayWidth", "displayHeight", ...(hasCaption ? ["caption"] : [])], label);
  const reference = assets.find((asset) => asset.slot === input.assetSlot && asset.role === "activity_artwork");
  if (!reference) throw new Error(`${label} must reference managed activity artwork.`);
  return {
    assetSlot: reference.slot,
    sourceWidth: integer(input.sourceWidth, `${label}.sourceWidth`, 1, NATIVE_DRAG_DROP_LIMITS.itemImageDimension),
    sourceHeight: integer(input.sourceHeight, `${label}.sourceHeight`, 1, NATIVE_DRAG_DROP_LIMITS.itemImageDimension),
    displayWidth: integer(input.displayWidth, `${label}.displayWidth`, NATIVE_DRAG_DROP_LIMITS.itemDisplayMinimum, NATIVE_DRAG_DROP_LIMITS.itemDisplayMaximum),
    displayHeight: integer(input.displayHeight, `${label}.displayHeight`, NATIVE_DRAG_DROP_LIMITS.itemDisplayMinimum, NATIVE_DRAG_DROP_LIMITS.itemDisplayMaximum),
    ...(hasCaption ? { caption: normalizeNativeSingleLineText(input.caption, `${label}.caption`, NATIVE_DRAG_DROP_LIMITS.wordTextLength) } : {}),
  };
}

export function createEmptyNativeDragDropInteraction() {
  return { kind: "drag-drop", words: [], presentation: structuredClone(NATIVE_DRAG_DROP_DEFAULT_PRESENTATION), panels: [] };
}

export function normalizeNativeDragDropInteraction(input, { assets = [], commonAssetSlots = new Set() } = {}) {
  const value = structuredClone(object(input, "Native Drag & Drop interaction"));
  const hasPresentation = Object.hasOwn(value, "presentation");
  const hasLayoutMode = Object.hasOwn(value, "layoutMode");
  const hasAnswerBankHeight = Object.hasOwn(value, "answerBankHeightPx");
  const hasTextPanelHeight = Object.hasOwn(value, "textPanelHeightPx");
  exactKeys(value, ["kind", "words", ...(hasPresentation ? ["presentation"] : []), ...(hasLayoutMode ? ["layoutMode"] : []), ...(hasAnswerBankHeight ? ["answerBankHeightPx"] : []), ...(hasTextPanelHeight ? ["textPanelHeightPx"] : []), "panels"], "Native Drag & Drop interaction");
  if (value.kind !== "drag-drop") throw new Error("Native Drag & Drop interaction kind is invalid.");
  if (!Array.isArray(value.words) || value.words.length > NATIVE_DRAG_DROP_LIMITS.words) throw new Error("Native Drag & Drop word count is invalid.");
  if (!Array.isArray(value.panels) || value.panels.length > NATIVE_DRAG_DROP_LIMITS.panels) throw new Error("Native Drag & Drop panel count is invalid.");

  const layoutMode = hasLayoutMode ? String(value.layoutMode) : "standard";
  if (!NATIVE_DRAG_DROP_LAYOUT_MODES.includes(layoutMode)) throw new Error("Native Drag & Drop layout mode is invalid.");
  const answerBankHeightPx = hasAnswerBankHeight && value.answerBankHeightPx !== null
    ? integer(value.answerBankHeightPx, "Native Drag & Drop answer bank height", NATIVE_DRAG_DROP_LIMITS.answerBankHeightMinimum, NATIVE_DRAG_DROP_LIMITS.answerBankHeightMaximum)
    : null;
  const textPanelHeightPx = hasTextPanelHeight && value.textPanelHeightPx !== null
    ? integer(value.textPanelHeightPx, "Native Drag & Drop text panel height", NATIVE_DRAG_DROP_LIMITS.textPanelHeightMinimum, NATIVE_DRAG_DROP_LIMITS.textPanelHeightMaximum)
    : null;

  const wordIds = new Set();
  const shortLabels = new Set();
  const words = value.words.map((word, index) => {
    const label = `Native Drag & Drop words[${index}]`;
    const hasReusable = Object.hasOwn(word, "reusable");
    const hasShortLabel = Object.hasOwn(word, "shortLabel");
    const hasImage = Object.hasOwn(word, "image");
    exactKeys(word, ["id", "text", ...(hasReusable ? ["reusable"] : []), ...(hasShortLabel ? ["shortLabel"] : []), ...(hasImage ? ["image"] : [])], label);
    if (!isNativeChildId(word.id, "word") || wordIds.has(word.id)) throw new Error("Native Drag & Drop word identity is invalid or duplicate.");
    wordIds.add(word.id);
    const reusable = hasReusable ? word.reusable : false;
    if (typeof reusable !== "boolean") throw new Error(`${label}.reusable must be a boolean.`);
    const shortLabel = hasShortLabel ? normalizeNativeSingleLineText(word.shortLabel, `${label}.shortLabel`, 8, { required: true }) : nativeDragDropShortLabel(index);
    if (!/^[A-Z]{1,8}$/.test(shortLabel) || shortLabels.has(shortLabel)) throw new Error("Native Drag & Drop short labels must be unique uppercase letters.");
    shortLabels.add(shortLabel);
    return { id: word.id, text: normalizeNativePedagogicalText(word.text, `${label}.text`, NATIVE_DRAG_DROP_LIMITS.wordTextLength, { required: true }), reusable, shortLabel, ...(hasImage ? { image: normalizeItemImage(word.image, `${label}.image`, assets) } : {}) };
  });

  const presentation = normalizePresentation(value.presentation, assets);
  const panelIds = new Set();
  const imageIds = new Set();
  const targetIds = new Set();
  const usedAssetSlots = new Set(words.flatMap((word) => word.image ? [word.image.assetSlot] : []));
  let targetCount = 0;
  const panels = value.panels.map((panel, panelIndex) => {
    const label = `Native Drag & Drop panels[${panelIndex}]`;
    exactKeys(panel, ["id", "surface", "images", "dropTargets"], label);
    if (!isNativeChildId(panel.id, "panel") || panelIds.has(panel.id)) throw new Error("Native Drag & Drop panel identity is invalid or duplicate.");
    panelIds.add(panel.id);
    if (!Array.isArray(panel.images) || panel.images.length > NATIVE_DRAG_DROP_LIMITS.imagesPerPanel) throw new Error(`${label}.images count is invalid.`);
    if (!Array.isArray(panel.dropTargets) || panel.dropTargets.length > NATIVE_DRAG_DROP_LIMITS.targetsPerPanel) throw new Error(`${label}.dropTargets count is invalid.`);
    targetCount += panel.dropTargets.length;
    if (targetCount > NATIVE_DRAG_DROP_LIMITS.totalTargets) throw new Error("Native Drag & Drop total target count is invalid.");

    const compositionAssets = assets.filter((asset) => asset.role !== "activity_font");
    const panelAssetSlots = new Set(panel.images.map((image) => image.assetSlot));
    const otherAssetSlots = new Set([...commonAssetSlots, ...compositionAssets.filter((asset) => !panelAssetSlots.has(asset.slot)).map((asset) => asset.slot)]);
    const composition = normalizeNativeImageInteraction({ kind: "image", surface: panel.surface, images: panel.images }, { assets: compositionAssets, commonAssetSlots: otherAssetSlots });
    composition.images.forEach((image) => {
      if (imageIds.has(image.id)) throw new Error("Native Drag & Drop image identities must be unique across panels.");
      imageIds.add(image.id); usedAssetSlots.add(image.assetSlot);
    });
    const dropTargets = panel.dropTargets.map((target, targetIndex) => {
      const targetLabel = `${label}.dropTargets[${targetIndex}]`;
      const hasCapacity = Object.hasOwn(target, "capacity");
      exactKeys(target, ["id", "area", "accessibleLabel", ...(hasCapacity ? ["capacity"] : [])], targetLabel);
      if (!isNativeChildId(target.id, "target") || targetIds.has(target.id)) throw new Error("Native Drag & Drop target identity is invalid or duplicate.");
      targetIds.add(target.id);
      return {
        id: target.id,
        area: normalizeArea(target.area, composition.surface, `${targetLabel}.area`),
        accessibleLabel: normalizeNativeSingleLineText(target.accessibleLabel, `${targetLabel}.accessibleLabel`, NATIVE_DRAG_DROP_LIMITS.targetLabelLength, { required: true }),
        capacity: hasCapacity ? integer(target.capacity, `${targetLabel}.capacity`, 1, NATIVE_DRAG_DROP_LIMITS.words) : 1,
      };
    });
    return { id: panel.id, surface: composition.surface, images: composition.images, dropTargets };
  });

  [presentation.bankWordStyle.fontAssetSlot, presentation.placedAnswerStyle.fontAssetSlot].filter(Boolean).forEach((slot) => usedAssetSlots.add(slot));
  if (assets.some((asset) => !usedAssetSlots.has(asset.slot) && !commonAssetSlots.has(asset.slot))) throw new Error("Every Native Drag & Drop managed asset must be used by an image layer, text style, or common supporting content.");
  return { kind: "drag-drop", words, presentation, layoutMode, answerBankHeightPx, textPanelHeightPx, panels };
}

export function normalizeNativeDragDropSolution(input) {
  const value = structuredClone(object(input, "Native Drag & Drop Teacher solution"));
  exactKeys(value, ["kind", "mappings"], "Native Drag & Drop Teacher solution");
  if (value.kind !== "drag-drop" || !Array.isArray(value.mappings) || value.mappings.length > NATIVE_DRAG_DROP_LIMITS.totalTargets) throw new Error("Native Drag & Drop Teacher solution is invalid.");
  const targetIds = new Set();
  return { kind: "drag-drop", mappings: value.mappings.map((mapping, index) => {
    const label = `Native Drag & Drop mappings[${index}]`;
    const legacy = Object.hasOwn(mapping, "wordId") && !Object.hasOwn(mapping, "wordIds");
    exactKeys(mapping, ["targetId", legacy ? "wordId" : "wordIds"], label);
    if (!isNativeChildId(mapping.targetId, "target") || targetIds.has(mapping.targetId)) throw new Error("Native Drag & Drop target mapping is invalid or duplicate.");
    const wordIds = legacy ? [mapping.wordId] : mapping.wordIds;
    if (!Array.isArray(wordIds) || !wordIds.length || wordIds.length > NATIVE_DRAG_DROP_LIMITS.words || wordIds.some((wordId) => !isNativeChildId(wordId, "word")) || new Set(wordIds).size !== wordIds.length) throw new Error("Native Drag & Drop word mapping is invalid or duplicated within a target.");
    targetIds.add(mapping.targetId);
    return { targetId: mapping.targetId, wordIds: [...wordIds] };
  }) };
}

export function validateNativeDragDropTopology(publicDocument, teacherDocument) {
  const interaction = publicDocument.parts[0].interaction;
  const targets = interaction.panels.flatMap((panel) => panel.dropTargets);
  const targetIds = new Set(targets.map((target) => target.id));
  const wordIds = new Set(interaction.words.map((word) => word.id));
  const reusableWordIds = new Set(interaction.words.filter((word) => word.reusable).map((word) => word.id));
  const mappings = teacherDocument.parts[0].solution.mappings;
  const nonReusableUses = new Set();
  if (mappings.length !== targets.length
    || mappings.some((mapping) => {
      const expected = nativeDragDropMappingWordIds(mapping);
      const target = targets.find((entry) => entry.id === mapping.targetId);
      if (!targetIds.has(mapping.targetId) || !target || expected.length !== target.capacity || new Set(expected).size !== expected.length || expected.some((wordId) => !wordIds.has(wordId))) return true;
      for (const wordId of expected) {
        if (!reusableWordIds.has(wordId) && nonReusableUses.has(wordId)) return true;
        if (!reusableWordIds.has(wordId)) nonReusableUses.add(wordId);
      }
      return false;
    })
    || new Set(mappings.map((mapping) => mapping.targetId)).size !== mappings.length
  ) {
    throw new Error("Drag & Drop requires one private stable-ID mapping per target, exact capacity coverage, and only reusable items may map to multiple targets.");
  }
  return true;
}

export function assessNativeDragDropReadiness(publicDocument, teacherDocument) {
  const interaction = publicDocument.parts[0].interaction;
  const mappings = new Map(teacherDocument.parts[0].solution.mappings.map((mapping) => [mapping.targetId, nativeDragDropMappingWordIds(mapping)]));
  const wordIds = new Set(interaction.words.map((word) => word.id));
  const issues = [];
  if (!interaction.words.length) issues.push("Add at least one draggable word.");
  if (!interaction.panels.length) issues.push("Add at least one visual panel.");
  interaction.panels.forEach((panel, panelIndex) => {
    if (!panel.images.length) issues.push(`Panel ${panelIndex + 1} needs at least one image layer.`);
    if (!panel.dropTargets.length) issues.push(`Panel ${panelIndex + 1} needs at least one drop target.`);
    panel.images.forEach((image, imageIndex) => { if (!image.decorative && !image.altText) issues.push(`Panel ${panelIndex + 1} image ${imageIndex + 1} needs alt text or must be decorative.`); });
    panel.dropTargets.forEach((target, targetIndex) => {
      if (!target.accessibleLabel) issues.push(`Panel ${panelIndex + 1} target ${targetIndex + 1} needs an accessible label.`);
      const expected = mappings.get(target.id) || [];
      if (expected.length !== target.capacity || expected.some((wordId) => !wordIds.has(wordId))) issues.push(`Panel ${panelIndex + 1} target ${targetIndex + 1} needs ${target.capacity} private correct item${target.capacity === 1 ? "" : "s"}.`);
    });
  });
  return { ready: issues.length === 0, issues };
}

export function nativeDragDropAssetRequirements(publicDocument) {
  const interaction = publicDocument?.parts?.[0]?.interaction;
  const panels = interaction?.panels || [];
  const seen = new Set();
  const requirements = panels.flatMap((panel, panelIndex) => panel.images.flatMap((image, imageIndex) => {
    if (seen.has(image.assetSlot)) return [];
    seen.add(image.assetSlot);
    return [{ slot: image.assetSlot, label: `Drag & Drop panel ${panelIndex + 1} image ${imageIndex + 1}` }];
  }));
  for (const word of interaction?.words || []) {
    if (!word.image) continue;
    requirements.push({ slot: word.image.assetSlot, width: word.image.sourceWidth, height: word.image.sourceHeight, label: `Drag & Drop image item: ${word.text}` });
    seen.add(word.image.assetSlot);
  }
  for (const [style, label] of [[interaction?.presentation?.bankWordStyle, "Drag & Drop bank word font"], [interaction?.presentation?.placedAnswerStyle, "Drag & Drop placed answer font"]]) {
    const slot = style?.fontAssetSlot;
    if (slot && !seen.has(slot)) { seen.add(slot); requirements.push({ slot, mediaType: "font/ttf", label }); }
  }
  return requirements;
}

export function nativeDragDropTextFontFamily(publicDocument, style) {
  return nativeActivityFontFamily(publicDocument, style?.fontAssetSlot, style?.fontFamily || "Arial");
}

export function removeNativeDragDropImage(publicDocument, panelId, imageId) {
  const panel = publicDocument.parts[0].interaction.panels.find((entry) => entry.id === panelId);
  const image = panel?.images.find((entry) => entry.id === imageId);
  if (!panel || !image) throw new Error("Drag & Drop image does not exist.");
  panel.images = panel.images.filter((entry) => entry.id !== imageId).map((entry, order) => ({ ...entry, order }));
  removeNativeManagedAssetReferenceIfUnused(publicDocument, image.assetSlot);
  return image;
}

export function removeNativeDragDropPanel(publicDocument, teacherDocument, panelId) {
  const interaction = publicDocument.parts[0].interaction;
  const panel = interaction.panels.find((entry) => entry.id === panelId);
  if (!panel) throw new Error("Drag & Drop panel does not exist.");
  const targetIds = new Set(panel.dropTargets.map((target) => target.id));
  const assetSlots = new Set(panel.images.map((image) => image.assetSlot));
  interaction.panels = interaction.panels.filter((entry) => entry.id !== panelId);
  teacherDocument.parts[0].solution.mappings = teacherDocument.parts[0].solution.mappings.filter((mapping) => !targetIds.has(mapping.targetId));
  assetSlots.forEach((slot) => removeNativeManagedAssetReferenceIfUnused(publicDocument, slot));
  return panel;
}

export function removeNativeDragDropWord(publicDocument, teacherDocument, wordId) {
  const interaction = publicDocument.parts[0].interaction;
  const removed = interaction.words.find((word) => word.id === wordId);
  if (!removed) throw new Error("Drag & Drop word does not exist.");
  interaction.words = interaction.words.filter((word) => word.id !== wordId);
  if (removed.image) removeNativeManagedAssetReferenceIfUnused(publicDocument, removed.image.assetSlot);
  teacherDocument.parts[0].solution.mappings = teacherDocument.parts[0].solution.mappings.flatMap((mapping) => {
    const wordIds = nativeDragDropMappingWordIds(mapping).filter((candidate) => candidate !== wordId);
    return wordIds.length ? [{ targetId: mapping.targetId, wordIds }] : [];
  });
}

export function normalizeNativeDragDropResponses(input, publicDocument) {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const interaction = publicDocument.parts[0].interaction;
  const targetIds = new Set(interaction.panels.flatMap((panel) => panel.dropTargets.map((target) => target.id)));
  const wordById = new Map(interaction.words.map((word) => [word.id, word]));
  const targetById = new Map(interaction.panels.flatMap((panel) => panel.dropTargets.map((target) => [target.id, target])));
  const usedWords = new Set();
  const normalized = {};
  for (const [targetId, rawWordIds] of Object.entries(value)) {
    const target = targetById.get(targetId);
    const candidate = Array.isArray(rawWordIds) ? rawWordIds : [rawWordIds];
    if (!targetIds.has(targetId) || !candidate.length || candidate.length > target.capacity || new Set(candidate).size !== candidate.length || candidate.some((wordId) => !wordById.has(wordId))) continue;
    if (candidate.some((wordId) => !wordById.get(wordId).reusable && usedWords.has(wordId))) continue;
    candidate.filter((wordId) => !wordById.get(wordId).reusable).forEach((wordId) => usedWords.add(wordId));
    normalized[targetId] = [...candidate];
  }
  return normalized;
}

export function placeNativeDragDropWord(responses, targetId, wordId, { capacity = 1, reusable = false } = {}) {
  const next = Object.fromEntries(Object.entries(responses || {}).map(([id, value]) => [id, Array.isArray(value) ? [...value] : [value]]));
  if (!reusable) {
    for (const [currentTargetId, currentWordIds] of Object.entries(next)) {
      if (currentTargetId === targetId) continue;
      next[currentTargetId] = currentWordIds.filter((candidate) => candidate !== wordId);
      if (!next[currentTargetId].length) delete next[currentTargetId];
    }
  }
  const current = next[targetId] || [];
  if (current.includes(wordId)) return next;
  next[targetId] = capacity === 1 ? [wordId] : current.length < capacity ? [...current, wordId] : current;
  return next;
}

export function shuffleNativeDragDropWordIds(words, random = Math.random) {
  if (!Array.isArray(words) || typeof random !== "function") throw new Error("Drag & Drop shuffle input is invalid.");
  const ids = words.map((word) => word.id);
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const sample = Number(random());
    const swapIndex = Math.min(index, Math.max(0, Math.floor((Number.isFinite(sample) ? sample : 0) * (index + 1))));
    [ids[index], ids[swapIndex]] = [ids[swapIndex], ids[index]];
  }
  return ids;
}

export function visibleNativeDragDropWordIds(sessionWordIds, responses = {}, targetWordOverrides = null, words = []) {
  const reusable = new Set(words.filter((word) => word.reusable).map((word) => word.id));
  const consumed = new Set(Object.values(responses || {}).flatMap((value) => Array.isArray(value) ? value : [value]).filter((wordId) => !reusable.has(wordId)));
  if (targetWordOverrides instanceof Map) targetWordOverrides.forEach((value) => { (Array.isArray(value) ? value : [value]).forEach((word) => { if (word?.id && !reusable.has(word.id)) consumed.add(word.id); }); });
  return (sessionWordIds || []).filter((wordId) => !consumed.has(wordId));
}

export function reassignNativeDragDropMapping(mappings, targetId, wordIds, { reusableWordIds = new Set() } = {}) {
  if (!Array.isArray(mappings)) throw new Error("Drag & Drop mappings must be an array.");
  const expected = Array.isArray(wordIds) ? [...wordIds] : [wordIds];
  if (!expected.length || new Set(expected).size !== expected.length) throw new Error("A target needs one or more unique Drag & Drop items.");
  const next = mappings.filter((mapping) => mapping.targetId !== targetId).map((mapping) => ({ targetId: mapping.targetId, wordIds: [...nativeDragDropMappingWordIds(mapping)] }));
  for (const wordId of expected) {
    if (reusableWordIds.has(wordId)) continue;
    const conflict = next.find((mapping) => mapping.wordIds.includes(wordId));
    if (conflict) throw new Error("Only reusable Drag & Drop items can be correct for multiple targets.");
  }
  next.push({ targetId, wordIds: expected });
  return next;
}

export function removeNativeDragDropResponse(responses, targetId, wordId = null) {
  const next = Object.fromEntries(Object.entries(responses || {}).map(([id, value]) => [id, Array.isArray(value) ? [...value] : [value]]));
  if (wordId === null) delete next[targetId];
  else {
    next[targetId] = (next[targetId] || []).filter((candidate) => candidate !== wordId);
    if (!next[targetId].length) delete next[targetId];
  }
  return next;
}

export function updateNativeDragDropRevealState(current, targetIds, action) {
  const revealed = current instanceof Set ? current : new Set();
  if (action === "reset-activity") return revealed.size ? new Set() : revealed;
  if (action === "show-all") return revealed.size === targetIds.length && targetIds.every((targetId) => revealed.has(targetId)) ? revealed : new Set(targetIds);
  const targetId = action === "show-next" ? targetIds.find((candidate) => !revealed.has(candidate)) : action?.targetId;
  if (!targetId || !targetIds.includes(targetId) || revealed.has(targetId)) return revealed;
  return new Set(revealed).add(targetId);
}
