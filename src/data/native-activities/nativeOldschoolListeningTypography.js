import { NATIVE_ACTIVITY_SYSTEM_FONT_FAMILIES } from "./nativeActivityFont.js";
import { normalizeNativeLineEndings } from "./nativePedagogicalText.js";

export const OLDSCHOOL_TYPOGRAPHY_LIMITS = Object.freeze({ documentBytes: 1024 * 1024, textLength: 262144, runsPerRegion: 128, runsTotal: 8000 });
const inlineKeys = ["fontFamily", "fontAssetSlot", "fontSize", "fontWeight", "italic", "underline", "color"];

function optionalKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`${label} has invalid or unknown fields.`);
}

export function normalizeOldschoolTypography(value, { assets = [], inline = false, label = "Transcript typography" } = {}) {
  optionalKeys(value, inline ? inlineKeys : [...inlineKeys, "align", "lineHeight"], label);
  const result = {};
  for (const key of inline ? inlineKeys : [...inlineKeys, "align", "lineHeight"]) {
    if (!Object.hasOwn(value, key)) continue;
    const entry = value[key];
    if (key === "fontFamily" && !NATIVE_ACTIVITY_SYSTEM_FONT_FAMILIES.includes(entry)) throw new Error(`${label}.fontFamily must be an approved system family; use a managed font for other families.`);
    if (key === "fontAssetSlot" && (typeof entry !== "string" || !assets.some((asset) => asset.slot === entry && asset.role === "activity_font"))) throw new Error(`${label}.fontAssetSlot must reference a managed component font.`);
    if (["fontSize", "lineHeight"].includes(key) && (!Number.isInteger(entry) || entry < 8 || entry > (key === "fontSize" ? 96 : 192))) throw new Error(`${label}.${key} is outside the source-pixel bounds.`);
    if (key === "fontWeight" && ![100, 200, 300, 400, 500, 600, 700, 800, 900].includes(entry)) throw new Error(`${label}.fontWeight is invalid.`);
    if (["italic", "underline"].includes(key) && typeof entry !== "boolean") throw new Error(`${label}.${key} must be boolean.`);
    if (key === "color" && (typeof entry !== "string" || !/^#[0-9a-f]{6}$/i.test(entry))) throw new Error(`${label}.color must be a six-digit hex color.`);
    if (key === "align" && !["left", "center", "right"].includes(entry)) throw new Error(`${label}.align is invalid.`);
    result[key] = key === "color" ? entry.toLowerCase() : entry;
  }
  return result;
}

export function normalizeOldschoolRuns(value, text, assets, label = "Transcript runs") {
  if (!Array.isArray(value) || !value.length || value.length > OLDSCHOOL_TYPOGRAPHY_LIMITS.runsPerRegion) throw new Error(`${label} count is invalid.`);
  const runs = value.map((run) => {
    optionalKeys(run, ["text", "typography"], label);
    const content = normalizeNativeLineEndings(run.text);
    // Boundary whitespace belongs to the run. Never trim runs individually.
    if (typeof content !== "string" || !content.length || content.length > 4000 || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(content)) throw new Error(`${label}.text is invalid.`);
    return { text: content, ...(Object.hasOwn(run, "typography") ? { typography: normalizeOldschoolTypography(run.typography, { assets, inline: true, label }) } : {}) };
  });
  if (runs.map((run) => run.text).join("") !== text) throw new Error(`${label} must exactly match the region plain text, including spaces and line breaks.`);
  return runs;
}

export function oldschoolTranscriptFontSlots(interaction) {
  return new Set((interaction?.cues || []).flatMap((cue) => (cue.highlightRegions || []).flatMap((region) => [region.typography?.fontAssetSlot, ...(region.runs || []).map((run) => run.typography?.fontAssetSlot)])).filter(Boolean));
}

// Panel 1 validates its own references. Transcript-only fonts are validated by
// the parent and must not appear as unused Panel 1 answer fonts.
export function oldschoolQuestionAssets(interaction, assets) {
  const transcript = oldschoolTranscriptFontSlots(interaction);
  const answers = new Set((interaction.questions || []).map((question) => question.responseRegion?.presentation?.answerFontAssetSlot));
  return assets.filter((asset) => asset.role !== "activity_font" || !transcript.has(asset.slot) || answers.has(asset.slot));
}

export function validateOldschoolTranscriptBudget(interaction) {
  if (new TextEncoder().encode(JSON.stringify(interaction)).length > OLDSCHOOL_TYPOGRAPHY_LIMITS.documentBytes) throw new Error("Oldschool Listening document exceeds 1 MiB.");
  let characters = 0; let runs = 0;
  for (const cue of interaction.cues) {
    characters += cue.text.length;
    for (const region of cue.highlightRegions) {
      characters += (region.text || "").length;
      for (const run of region.runs || []) { runs++; characters += run.text.length; }
    }
  }
  if (characters > OLDSCHOOL_TYPOGRAPHY_LIMITS.textLength || runs > OLDSCHOOL_TYPOGRAPHY_LIMITS.runsTotal) throw new Error("Oldschool Listening aggregate transcript budget exceeded.");
}
