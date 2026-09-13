import { XMLParser, XMLValidator } from "fast-xml-parser";
import { NATIVE_ACTIVITY_SYSTEM_FONT_FAMILIES } from "./nativeActivityFont.js";
import { normalizeNativeOldschoolListeningInteraction } from "./nativeOldschoolListening.js";
import { normalizeOldschoolTypography, oldschoolTranscriptFontSlots } from "./nativeOldschoolListeningTypography.js";

export const OLDSCHOOL_XML_MAXIMUM_BYTES = 1024 * 1024;
const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", trimValues: false, parseTagValue: false, parseAttributeValue: false, processEntities: false, cdataPropName: "#cdata", commentPropName: "#comment" });
const tagOf = (node) => Object.keys(node).find((key) => key !== ":@");
const attributes = (node) => node[":@"] || {};
const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };

function decode(text) {
  return text.replace(/&([^;\s]+);/g, (_, entity) => {
    if (Object.hasOwn(entities, entity)) return entities[entity];
    if (/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(entity)) {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) return String.fromCodePoint(code);
    }
    throw new Error(`Unsupported transcript entity &${entity};.`);
  });
}

function parseSafeXml(input, label) {
  if (typeof input !== "string" || !input.trim() || new TextEncoder().encode(input).length > OLDSCHOOL_XML_MAXIMUM_BYTES) throw new Error(`${label} is empty or exceeds 1 MiB.`);
  if (/<!DOCTYPE|<!ENTITY/i.test(input) || /<\?(?!xml\s)/i.test(input)) throw new Error(`${label} forbids DTD, entities and processing instructions.`);
  let depth = 0; let nodes = 0;
  for (const [token] of input.matchAll(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<(?:[^"'<>]|"[^"]*"|'[^']*')*>/g)) {
    if (++nodes > 20000) throw new Error(`${label} structural limit exceeded.`);
    if (/^<[!?]/.test(token)) continue;
    if (/^<\//.test(token)) depth--;
    else if (!/\/>$/.test(token)) depth++;
    if (depth > 32) throw new Error(`${label} nesting limit exceeded.`);
  }
  if (XMLValidator.validate(input, { allowBooleanAttributes: false }) !== true) throw new Error(`${label} is malformed.`);
  return parser.parse(input);
}

function boolean(value, label) {
  if (value !== "true" && value !== "false") throw new Error(`${label} must be true or false.`);
  return value === "true";
}

function color(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^(?:0x[0-9a-f]{1,6}|[0-9]+)$/i.test(value)) {
    const number = Number(value);
    if (Number.isSafeInteger(number) && number >= 0 && number <= 0xffffff) return `#${number.toString(16).padStart(6, "0")}`;
  }
  throw new Error("Unsupported transcript font color.");
}

function font(name, bindings, assets) {
  if (typeof name !== "string" || !name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Source font name is invalid.");
  const binding = Object.hasOwn(bindings, name) ? bindings[name] : null;
  if (binding) return normalizeOldschoolTypography(binding, { assets });
  if (NATIVE_ACTIVITY_SYSTEM_FONT_FAMILIES.includes(name)) return { fontFamily: name };
  throw new Error(`Source font "${name}" needs an explicit system or managed font binding before import. A name does not supply a font file.`);
}

function textNodeContent(nodes) {
  return nodes.map((node) => {
    const tag = tagOf(node);
    if (tag === "#text") return decode(node[tag]);
    if (tag === "#cdata") return node[tag].map((entry) => entry["#text"]).join("");
    throw new Error("Transcript text must contain literal XML text or CDATA; encode inline HTML in an isHTML=true text field.");
  }).join("");
}

function inlineRuns(text, bindings, assets) {
  // Only a narrow inert markup language is accepted, never browser HTML.
  const nodes = parseSafeXml(`<runs>${text.replace(/<br\s*>/gi, "<br/>")}</runs>`, "Transcript inline markup")[0].runs;
  const runs = [];
  const append = (content, typography) => { if (content) runs.push({ text: content, ...(Object.keys(typography).length ? { typography } : {}) }); };
  const visit = (children, inherited = {}) => children.forEach((node) => {
    const tag = tagOf(node); const attrs = attributes(node);
    if (tag === "#text") { append(decode(node[tag]), inherited); return; }
    const permitted = tag === "font" ? ["face", "size", "color"] : [];
    if (!["b", "strong", "i", "em", "u", "font", "br"].includes(tag) || Object.keys(attrs).some((key) => !permitted.includes(key))) throw new Error(`Unsupported transcript markup or attributes: ${tag}.`);
    if (tag === "br") { if (node[tag].length) throw new Error("Transcript br must be empty."); append("\n", inherited); return; }
    const style = { ...inherited };
    if (["b", "strong"].includes(tag)) style.fontWeight = 700;
    if (["i", "em"].includes(tag)) style.italic = true;
    if (tag === "u") style.underline = true;
    if (attrs.face !== undefined) {
      delete style.fontAssetSlot; delete style.fontFamily;
      Object.assign(style, font(decode(attrs.face), bindings, assets));
    }
    if (attrs.size !== undefined) { if (!/^\d+$/.test(attrs.size)) throw new Error("Inline font size must be absolute source pixels."); style.fontSize = Number(attrs.size); }
    if (attrs.color !== undefined) style.color = color(attrs.color);
    visit(node[tag], normalizeOldschoolTypography(style, { assets, inline: true }));
  });
  visit(nodes);
  return runs;
}

function trimFragmentBoundary(runs) {
  // Legacy mapping trims fragment boundary spaces. Interior spaces and every
  // line break remain significant: extra source breaks must cause a mismatch.
  while (runs.length) { runs[0].text = runs[0].text.replace(/^ +/, ""); if (runs[0].text) break; runs.shift(); }
  while (runs.length) { runs.at(-1).text = runs.at(-1).text.replace(/ +$/, ""); if (runs.at(-1).text) break; runs.pop(); }
  return runs;
}

function sourceFragments(xml, assets, fontBindings) {
  const nodes = parseSafeXml(xml, "Transcript XML"); const exercises = [];
  const visit = (children) => children.forEach((node) => {
    const tag = tagOf(node);
    if (tag.split(":").at(-1).toLowerCase() === "script" || Object.keys(attributes(node)).some((key) => /(?:^|:)on/i.test(key))) throw new Error("Transcript XML forbids scripts and event handlers.");
    if (Object.values(attributes(node)).some((value) => /^(?:https?:|file:|javascript:|data:|\/\/)/i.test(decode(String(value)).trim()))) throw new Error("Transcript XML forbids external resources.");
    if (tag === "exercise" && attributes(node).type === "karaokeScroll") exercises.push(node);
    if (Array.isArray(node[tag])) visit(node[tag]);
  });
  visit(nodes);
  if (exercises.length !== 1) throw new Error("Transcript XML must contain exactly one karaokeScroll exercise.");
  const containers = exercises[0].exercise.filter((node) => tagOf(node) === "texts");
  if (containers.length !== 1) throw new Error("karaokeScroll must contain one texts collection.");
  const texts = containers[0].texts.filter((node) => !["#text", "#comment"].includes(tagOf(node)));
  if (!texts.length || texts.length > 4000 || texts.some((node) => tagOf(node) !== "text")) throw new Error("karaokeScroll text collection is invalid.");
  const ids = new Set(); const names = new Set();
  return texts.map((node) => {
    const a = attributes(node);
    const allowed = ["id", "name", "x", "y", "width", "height", "fontName", "fontSize", "fontColor", "fontBold", "fontItalic", "fontUnderline", "align", "isHTML", "times", "lineHeight"];
    if (Object.keys(a).some((key) => !allowed.includes(key))) throw new Error("Unsupported karaokeScroll text attributes.");
    if (!/^[1-9][0-9]{0,7}$/.test(a.id) || ids.has(a.id) || (a.name && names.has(a.name))) throw new Error("Duplicate, ambiguous or invalid source text identity.");
    ids.add(a.id); if (a.name) names.add(a.name);
    const times = /^(\d+)-(\d+)$/.exec(a.times);
    if (!times || Number(times[2]) <= Number(times[1])) throw new Error(`Source text ${a.id} has invalid timing.`);
    if (!/^\d+$/.test(a.fontSize)) throw new Error(`Source text ${a.id} has invalid fontSize.`);
    const typography = normalizeOldschoolTypography({ ...font(decode(a.fontName || ""), fontBindings, assets), fontSize: Number(a.fontSize), color: color(a.fontColor || ""), fontWeight: boolean(a.fontBold, "fontBold") ? 700 : 400, align: a.align,
      ...(a.fontItalic !== undefined ? { italic: boolean(a.fontItalic, "fontItalic") } : {}), ...(a.fontUnderline !== undefined ? { underline: boolean(a.fontUnderline, "fontUnderline") } : {}),
      ...(a.lineHeight !== undefined ? { lineHeight: /^\d+$/.test(a.lineHeight) ? Number(a.lineHeight) : NaN } : {}),
    }, { assets });
    const content = textNodeContent(node.text).replace(/\r\n?/g, "\n");
    const runs = trimFragmentBoundary(boolean(a.isHTML, "isHTML") ? inlineRuns(content, fontBindings, assets) : [{ text: content }]);
    return { id: a.id, startMs: Number(times[1]), endMs: Number(times[2]), text: runs.map((run) => run.text).join(""), typography, runs };
  });
}

export function previewOldschoolTranscriptTypographyXml(xml, interaction, { assets = [], fontBindings = {}, ...context } = {}) {
  const fragments = sourceFragments(xml, assets, fontBindings);
  const previousSlots = oldschoolTranscriptFontSlots(interaction);
  const answerSlots = new Set(interaction.questions.map((question) => question.responseRegion?.presentation?.answerFontAssetSlot));
  const bindingSlots = new Set(Object.values(fontBindings).map((binding) => binding.fontAssetSlot).filter(Boolean));
  const initialAssets = assets.filter((asset) => !bindingSlots.has(asset.slot) || previousSlots.has(asset.slot) || answerSlots.has(asset.slot));
  const current = normalizeNativeOldschoolListeningInteraction(interaction, { ...context, assets: initialAssets });
  const next = structuredClone(current); const used = new Set(); const changes = [];
  for (const cue of next.cues) {
    for (const region of cue.highlightRegions) {
      if (typeof region.text !== "string") throw new Error("Typography import requires exact plain text in every mapped region.");
      const candidates = fragments.filter((fragment) => fragment.startMs === cue.startMs && fragment.endMs === cue.endMs && fragment.text === region.text);
      const identified = candidates.filter((fragment) => region.id === `region-${fragment.id.padStart(32, "0")}`);
      const matches = identified.length ? identified : candidates;
      if (matches.length !== 1 || used.has(matches[0]?.id)) throw new Error(`Typography mismatch or ambiguous match for ${cue.id}/${region.id}; timing and exact text must uniquely correspond. No changes applied.`);
      const source = matches[0];
      const encodedIdentity = fragments.find((fragment) => region.id === `region-${fragment.id.padStart(32, "0")}`);
      if (encodedIdentity && encodedIdentity.id !== source.id) throw new Error(`Source identity mismatch for ${region.id}. No changes applied.`);
      used.add(source.id);
      region.typography = source.typography;
      if (source.runs.some((run) => run.typography)) region.runs = source.runs;
      else delete region.runs;
      changes.push({ cueId: cue.id, regionId: region.id, sourceId: source.id, typography: source.typography, inlineRuns: region.runs?.length || 0 });
    }
  }
  if (used.size !== fragments.length) throw new Error("Source/mapping fragment count mismatch. No changes applied.");
  const usedFonts = oldschoolTranscriptFontSlots(next);
  const candidateAssets = assets.filter((asset) => (!bindingSlots.has(asset.slot) && !previousSlots.has(asset.slot)) || usedFonts.has(asset.slot) || answerSlots.has(asset.slot));
  normalizeNativeOldschoolListeningInteraction(next, { ...context, assets: candidateAssets });
  return { cues: next.cues, assets: candidateAssets, changes, sourceCueCount: new Set(fragments.map((f) => `${f.startMs}-${f.endMs}`)).size,
    // Used only in the local preview transaction, never saved in the document.
    mappingSnapshot: JSON.stringify(interaction),
  };
}

export function applyOldschoolTranscriptTypographyPreview(interaction, preview) {
  if (JSON.stringify(interaction) !== preview.mappingSnapshot) throw new Error("Mapping changed after XML preview. Preview the XML again before applying.");
  interaction.cues = structuredClone(preview.cues);
}
