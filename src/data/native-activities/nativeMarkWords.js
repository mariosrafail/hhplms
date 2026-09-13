import { isMarkWordsVisual, MARK_WORDS_VISUAL_VERSION, normalizeMarkWordsVisualInteraction, normalizeMarkWordsVisualSolution, validateMarkWordsVisualTopology } from "./nativeMarkWordsVisualTargets.js";
import { isNativeChildId } from "./nativeChildIdentity.js";
import { normalizeNativeLineEndings } from "./nativePedagogicalText.js";
import { validateNativeActivityDocumentPair } from "./nativeActivityTeacher.js";

export const NATIVE_MARK_WORDS_LIMITS = Object.freeze({ passages: 20, wordsPerPassage: 200, words: 800, text: 8_000, totalText: 24_000, panels: 8, sourceDimension: 16_384 });

export function markWordsExact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) throw new Error(`${label} has missing or unknown fields.`);
}

// UTF-16 offsets into canonical text. Letters/numbers with combining marks form
// words; internal apostrophes and hyphens join them. Emoji/punctuation are gaps.
// No locale-sensitive segmentation or Unicode normalization changes the source.
export function canonicalMarkWordsText(input) {
  const text = normalizeNativeLineEndings(input);
  if (typeof text !== "string" || text.length > NATIVE_MARK_WORDS_LIMITS.text || /[\u0000-\u0008\u000b-\u001f\u007f<>]/u.test(text) || /[\uD800-\uDFFF]/u.test(text)) throw new Error("Passage text is invalid or exceeds 8,000 characters.");
  return text;
}

export function segmentMarkWordsText(input) {
  const text = canonicalMarkWordsText(input);
  return [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’\-‐‑][\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
}

function identity(id, prefix, seen, label) {
  if (typeof id !== "string" || !isNativeChildId(id, prefix) || seen.has(id)) throw new Error(`${label} identity is invalid or duplicate.`);
  seen.add(id);
  return id;
}

function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} is outside its limits.`);
  return value;
}

function area(value, panel, label) {
  markWordsExact(value, ["x", "y", "width", "height"], label);
  integer(value.x, 0, panel.sourceWidth - 1, label);
  integer(value.y, 0, panel.sourceHeight - 1, label);
  integer(value.width, 1, panel.sourceWidth - value.x, label);
  integer(value.height, 1, panel.sourceHeight - value.y, label);
  return { ...value };
}

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function createEmptyNativeMarkWordsInteraction() {
  return { kind: "mark-the-words", items: [], presentation: { kind: "text", marking: "underline", textStyle: { fontAssetSlot: null, fontSize: 24, color: "#12304b", lineSpacing: 160 }, panels: [] } };
}

export function normalizeNativeMarkWordsInteraction(input, { assets = [] } = {}) {
  if (isMarkWordsVisual(input) || input?.schemaVersion === MARK_WORDS_VISUAL_VERSION) return normalizeMarkWordsVisualInteraction(input, { assets });
  markWordsExact(input, ["kind", "items", "presentation"], "Mark the Words interaction");
  if (input.kind !== "mark-the-words" || !Array.isArray(input.items) || input.items.length > NATIVE_MARK_WORDS_LIMITS.passages) throw new Error("Mark the Words passages are invalid.");
  const seen = new Set();
  let wordCount = 0; let textCount = 0;
  const items = input.items.map((item, index) => {
    const label = `Passage ${index + 1}`;
    markWordsExact(item, ["id", "text", "words"], label);
    const id = identity(item.id, "passage", seen, label);
    const text = canonicalMarkWordsText(item.text);
    const ranges = segmentMarkWordsText(text);
    if (!Array.isArray(item.words) || item.words.length !== ranges.length || ranges.length > NATIVE_MARK_WORDS_LIMITS.wordsPerPassage) throw new Error(`${label} must include every lexical word, up to 200 words.`);
    const words = item.words.map((word, position) => {
      markWordsExact(word, ["id", "start", "end"], `${label} word ${position + 1}`);
      identity(word.id, "word", seen, label);
      if (word.start !== ranges[position].start || word.end !== ranges[position].end) throw new Error(`${label} word ranges do not match the canonical passage.`);
      return { ...word };
    });
    wordCount += words.length; textCount += text.length;
    return { id, text, words };
  });
  if (wordCount > NATIVE_MARK_WORDS_LIMITS.words || textCount > NATIVE_MARK_WORDS_LIMITS.totalText) throw new Error("Activity exceeds 800 words or 24,000 passage characters.");
  const presentation = input.presentation;
  markWordsExact(presentation, ["kind", "marking", "textStyle", "panels"], "Mark the Words presentation");
  if (!["text", "image-hotspot"].includes(presentation.kind) || !["underline", "highlight"].includes(presentation.marking)) throw new Error("Mark the Words presentation is invalid.");
  const style = presentation.textStyle;
  markWordsExact(style, ["fontAssetSlot", "fontSize", "color", "lineSpacing"], "Passage typography");
  integer(style.fontSize, 12, 72, "Font size"); integer(style.lineSpacing, 120, 240, "Line spacing");
  if (typeof style.color !== "string" || !/^#[0-9a-f]{6}$/i.test(style.color) || (style.fontAssetSlot !== null && !assets.some((asset) => asset.slot === style.fontAssetSlot && asset.role === "activity_font"))) throw new Error("Passage font or color is invalid.");
  if (!Array.isArray(presentation.panels) || presentation.panels.length > NATIVE_MARK_WORDS_LIMITS.panels) throw new Error("Use at most eight visual panels.");
  const bindings = new Set(); const passagePanels = new Map();
  const panels = presentation.panels.map((panel, index) => {
    const label = `Panel ${index + 1}`;
    markWordsExact(panel, ["id", "backgroundAssetSlot", "sourceWidth", "sourceHeight", "hotspots"], label);
    identity(panel.id, "panel", seen, label);
    integer(panel.sourceWidth, 1, NATIVE_MARK_WORDS_LIMITS.sourceDimension, label);
    integer(panel.sourceHeight, 1, NATIVE_MARK_WORDS_LIMITS.sourceDimension, label);
    if (panel.backgroundAssetSlot !== "" && !assets.some((asset) => asset.slot === panel.backgroundAssetSlot && asset.role === "activity_artwork")) throw new Error(`${label} background must reference managed artwork.`);
    if (!Array.isArray(panel.hotspots) || panel.hotspots.length > NATIVE_MARK_WORDS_LIMITS.words) throw new Error(`${label} hotspots exceed limits.`);
    const hotspots = panel.hotspots.map((hotspot) => {
      markWordsExact(hotspot, ["id", "itemId", "wordId", "area", "markArea"], `${label} hotspot`);
      identity(hotspot.id, "hot", seen, label);
      const passage = items.find((item) => item.id === hotspot.itemId);
      if (!passage?.words.some((word) => word.id === hotspot.wordId) || bindings.has(hotspot.wordId)) throw new Error(`${label} hotspot needs a unique passage word binding.`);
      if (passagePanels.has(passage.id) && passagePanels.get(passage.id) !== panel.id) throw new Error("A passage cannot span visual panels.");
      bindings.add(hotspot.wordId); passagePanels.set(passage.id, panel.id);
      const click = area(hotspot.area, panel, `${label} click area`);
      const mark = area(hotspot.markArea, panel, `${label} marking area`);
      if (mark.x < click.x || mark.y < click.y || mark.x + mark.width > click.x + click.width || mark.y + mark.height > click.y + click.height) throw new Error("Marking area must stay inside its click area.");
      return { ...hotspot, area: click, markArea: mark };
    });
    for (let a = 0; a < hotspots.length; a += 1) for (let b = a + 1; b < hotspots.length; b += 1) if (overlaps(hotspots[a].area, hotspots[b].area)) throw new Error(`${label} word click areas must not overlap.`);
    return { ...panel, hotspots };
  });
  return { kind: "mark-the-words", items, presentation: { kind: presentation.kind, marking: presentation.marking, textStyle: { ...style }, panels } };
}

export function normalizeNativeMarkWordsSolution(input) {
  if (input?.schemaVersion === MARK_WORDS_VISUAL_VERSION) return normalizeMarkWordsVisualSolution(input);
  markWordsExact(input, ["kind", "answers"], "Mark the Words Teacher solution");
  if (input.kind !== "mark-the-words" || !Array.isArray(input.answers) || input.answers.length > NATIVE_MARK_WORDS_LIMITS.passages) throw new Error("Mark the Words Teacher answers are invalid.");
  const seen = new Set();
  return { kind: "mark-the-words", answers: input.answers.map((answer) => {
    markWordsExact(answer, ["itemId", "correctWordIds"], "Teacher passage answer");
    identity(answer.itemId, "passage", seen, "Teacher passage");
    if (!Array.isArray(answer.correctWordIds) || answer.correctWordIds.length > NATIVE_MARK_WORDS_LIMITS.wordsPerPassage) throw new Error("Teacher word IDs exceed limits.");
    const ids = new Set();
    answer.correctWordIds.forEach((id) => identity(id, "word", ids, "Teacher word"));
    return { itemId: answer.itemId, correctWordIds: [...answer.correctWordIds] };
  }) };
}

export function validateNativeMarkWordsTopology(publicDocument, teacherDocument) {
  validateNativeActivityDocumentPair(publicDocument, teacherDocument);
  if (isMarkWordsVisual(publicDocument.parts[0].interaction)) { validateMarkWordsVisualTopology(publicDocument.parts[0].interaction, teacherDocument.parts[0].solution); return true; }
  const items = publicDocument.parts[0].interaction.items;
  const answers = teacherDocument.parts[0].solution.answers;
  if (items.length !== answers.length || items.some((item, index) => {
    const answer = answers[index];
    const canonical = item.words.filter((word) => answer?.correctWordIds.includes(word.id)).map((word) => word.id);
    return answer?.itemId !== item.id || canonical.length !== answer.correctWordIds.length || canonical.some((id, i) => id !== answer.correctWordIds[i]);
  })) throw new Error("Teacher answers must match passage identities, authored order and word occurrences.");
  return true;
}

export function assessNativeMarkWordsReadiness(publicDocument, teacherDocument) {
  const issues = [];
  try {
    normalizeNativeMarkWordsInteraction(publicDocument.parts[0].interaction, { assets: publicDocument.assets });
    normalizeNativeMarkWordsSolution(teacherDocument.parts[0].solution);
    validateNativeMarkWordsTopology(publicDocument, teacherDocument);
  } catch (error) { return { ready: false, issues: [error.message] }; }
  const { items, presentation } = publicDocument.parts[0].interaction;
  if (isMarkWordsVisual(publicDocument.parts[0].interaction)) {
    if (!publicDocument.parts[0].interaction.targets.length) issues.push("Draw at least one visual target.");
    presentation.panels.forEach((panel, index) => {
      if (!panel.backgroundAssetSlot) issues.push(`Panel ${index + 1} needs a managed background.`);
      if (!teacherDocument.parts[0].solution.answers[index].correctTargetIds.length) issues.push(`Panel ${index + 1} needs at least one correct target.`);
    });
    return { ready: !issues.length, issues };
  }
  if (!items.length) issues.push("Add at least one exercise passage.");
  items.forEach((item, index) => {
    if (!item.words.length) issues.push(`Passage ${index + 1} needs at least one lexical word.`);
    if (!teacherDocument.parts[0].solution.answers[index].correctWordIds.length) issues.push(`Passage ${index + 1}: explicitly select at least one correct word in Answer Key.`);
  });
  if (presentation.kind === "image-hotspot") {
    if (!presentation.panels.length) issues.push("Add a visual panel and its background.");
    const mapped = new Set(presentation.panels.flatMap((panel) => panel.hotspots.map((hotspot) => hotspot.wordId)));
    items.forEach((item, index) => { const missing = item.words.filter((word) => !mapped.has(word.id)).length; if (missing) issues.push(`Passage ${index + 1}: map all words, including distractors (${missing} unmapped).`); });
  }
  presentation.panels.forEach((panel, index) => { if (!panel.backgroundAssetSlot) issues.push(`Panel ${index + 1} needs a managed background.`); });
  return { ready: !issues.length, issues };
}

export function nativeMarkWordsAssetRequirements(document) {
  const presentation = document.parts[0].interaction.presentation;
  if (isMarkWordsVisual(document.parts[0].interaction)) return [...presentation.panels.filter((panel) => panel.backgroundAssetSlot).map((panel) => ({ slot: panel.backgroundAssetSlot, width: panel.sourceWidth, height: panel.sourceHeight })), ...[...new Set(presentation.panels.flatMap((panel) => panel.hotspots.map((hotspot) => hotspot.graphicAssetSlot)).filter(Boolean))].map((slot) => ({ slot, mediaTypes: ["image/png", "image/jpeg", "image/webp"], label: "Target graphic" }))];
  return [...presentation.panels.filter((panel) => panel.backgroundAssetSlot).map((panel) => ({ slot: panel.backgroundAssetSlot, width: panel.sourceWidth, height: panel.sourceHeight })), ...(presentation.textStyle.fontAssetSlot ? [{ slot: presentation.textStyle.fontAssetSlot, mediaType: "font/ttf", label: "Passage font" }] : [])];
}
