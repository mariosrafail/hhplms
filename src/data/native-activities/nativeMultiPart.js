import { nativeOpenResponsePanels } from "./nativeOpenResponse.js";
import { isMarkWordsVisual } from "./nativeMarkWordsVisualTargets.js";
import { NATIVE_MULTI_PART_CHILDREN, nativeMultiPartTeacherChild } from "./nativeMultiPartChildren.js";
import { isNativeChildId, createNativeChildId } from "./nativeChildIdentity.js";
import { normalizeNativePedagogicalText } from "./nativePedagogicalText.js";

export const NATIVE_MULTI_PART_VERSION = "multi-part.v1";
export const NATIVE_MULTI_PART_CANVAS_VERSION = "multi-part.v2";
export const NATIVE_MULTI_PART_CANVAS_KINDS = Object.freeze(["drag-drop", "single-choice", "mark-the-words", "open-response", "complete-sentences"]);
export const NATIVE_MULTI_PART_LIMITS = Object.freeze({ panels: 12, sections: 24, assets: 128, bytes: 262144, responseBytes: 100000, dimension: 8192 });
export const NATIVE_MULTI_PART_CHILD_KINDS = Object.freeze(Object.keys(NATIVE_MULTI_PART_CHILDREN));
const exact = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) throw new Error(`${label} has missing or unknown fields.`);
};
const integer = (value, min, max) => { if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error("Multi-Part geometry is outside its limits."); return value; };
const budget = (value) => { if (new TextEncoder().encode(JSON.stringify(value)).length > NATIVE_MULTI_PART_LIMITS.bytes) throw new Error("Multi-Part aggregate content budget exceeded."); };
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export function nativeMultiPartAssetSlots(value, result = new Set()) {
  if (!value || typeof value !== "object") return result;
  for (const [key, entry] of Object.entries(value)) {
    if (/^(?:assetSlot|.*AssetSlot)$/.test(key) && typeof entry === "string" && entry) result.add(entry);
    else if (entry && typeof entry === "object") nativeMultiPartAssetSlots(entry, result);
  }
  return result;
}

export function projectNativeMultiPartChild(document, section, teacherDocument = null) {
  const slots = nativeMultiPartAssetSlots(section.interaction);
  const publicDocument = { schemaVersion: "1.0", activityId: document.activityId, kind: section.kind, metadata: { title: section.title || document.metadata.title, visibleInstructionText: "" }, placement: document.placement, assets: document.assets.filter((asset) => slots.has(asset.slot)), parts: [{ id: "part-1", interaction: section.interaction }] };
  const privateSection = teacherDocument?.parts[0].solution.sections.find((entry) => entry.id === section.id);
  return { publicDocument, teacherDocument: privateSection ? { schemaVersion: "1.0", activityId: document.activityId, kind: section.kind, parts: [{ id: "part-1", solution: privateSection.solution }] } : null };
}

function normalizeSurface(value) {
  exact(value, ["width", "height"], "Multi-Part surface");
  return { width: integer(value.width, 1, 8192), height: integer(value.height, 1, 8192) };
}
function normalizeArea(value, surface) {
  exact(value, ["x", "y", "width", "height"], "Multi-Part region");
  return { x: integer(value.x, 0, surface.width - 1), y: integer(value.y, 0, surface.height - 1), width: integer(value.width, 1, surface.width - value.x), height: integer(value.height, 1, surface.height - value.y) };
}
function childPanel(interaction) {
  const panels = interaction.panels || interaction.presentation?.panels || [];
  if (panels.length > 1) throw new Error("A Multi-Part section supports one visual panel. Move additional content into another section.");
  return panels[0];
}
function validateCanvas(panel, sections, version) {
  const active = [];
  for (const section of sections) {
    if (!(version === NATIVE_MULTI_PART_CANVAS_VERSION ? NATIVE_MULTI_PART_CANVAS_KINDS : ["drag-drop", "single-choice"]).includes(section.kind)) throw new Error("This shared canvas version does not support the section type.");
    const interaction = section.interaction;
    const child = section.kind === "open-response" ? nativeOpenResponsePanels(interaction)[0] : childPanel(interaction);
    if (!child) continue;
    const surface = ["drag-drop", "open-response"].includes(section.kind) ? child.surface : { width: child.sourceWidth, height: child.sourceHeight };
    if (surface.width !== panel.surface.width || surface.height !== panel.surface.height) throw new Error("Shared overlays must use their parent canvas coordinates.");
    if (section.kind === "drag-drop") {
      if (child.images.length) throw new Error("Shared Drag & Drop uses the parent background.");
      if (interaction.layoutMode === "text") {
        if (!section.textRegion) throw new Error("Shared Text Drag & Drop requires a text image region.");
        const region = section.textRegion;
        for (const target of child.dropTargets) if (target.area.x < region.x || target.area.y < region.y || target.area.x + target.area.width > region.x + region.width || target.area.y + target.area.height > region.y + region.height) throw new Error("Text targets must stay inside their scrolling image region.");
        active.push({ owner: section.id, area: region });
      }
      if (!section.bankRegion) throw new Error("Shared Drag & Drop requires a reserved answer bank region.");
      active.push({ owner: section.id, area: section.bankRegion, bank: true });
    } else if (section.kind === "open-response") {
      if (child.images.length !== 1 || child.images[0].assetSlot !== panel.background?.assetSlot || Object.entries({ x: 0, y: 0, ...panel.surface }).some(([key, value]) => child.images[0].area[key] !== value)) throw new Error("Open Response must use the shared background at its parent coordinates.");
    } else if (child.backgroundAssetSlot !== panel.background?.assetSlot) throw new Error("Section must use the shared panel background.");
    if (section.kind === "mark-the-words" && !isMarkWordsVisual(interaction)) throw new Error("Shared Mark the Words requires visual targets.");
    const regions = section.kind === "open-response" ? interaction.questions.map((question) => question.responseRegion) : section.kind === "drag-drop" ? child.dropTargets : child.hotspots;
    for (const item of regions) active.push({ owner: section.id, area: normalizeArea(item.area, panel.surface) });
  }
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    if ((active[i].owner !== active[j].owner || active[i].bank || active[j].bank) && overlaps(active[i].area, active[j].area)) throw new Error("Shared canvas active regions overlap ambiguously.");
  }
}

export function createEmptyNativeMultiPartInteraction() {
  return { kind: "multi-part", schemaVersion: NATIVE_MULTI_PART_VERSION, panels: [], sections: [] };
}

export function normalizeNativeMultiPartInteraction(input, { assets = [], commonAssetSlots = new Set() } = {}) {
  budget(input);
  exact(input, ["kind", "schemaVersion", "panels", "sections"], "Multi-Part interaction");
  if (input.kind !== "multi-part" || ![NATIVE_MULTI_PART_VERSION, NATIVE_MULTI_PART_CANVAS_VERSION].includes(input.schemaVersion) || !Array.isArray(input.panels) || input.panels.length > 12 || !Array.isArray(input.sections) || input.sections.length > 24 || assets.length > 128) throw new Error("Multi-Part kind, version or aggregate limits are invalid.");
  const panelIds = new Set(); const sectionIds = new Set(); const used = new Set(commonAssetSlots);
  const panels = input.panels.map((panel) => {
    exact(panel, ["id", "title", "layout", "surface", "background"], "Multi-Part panel");
    if (!isNativeChildId(panel.id, "panel") || panelIds.has(panel.id) || !["flow", "canvas"].includes(panel.layout)) throw new Error("Multi-Part panel identity or layout is invalid.");
    panelIds.add(panel.id);
    const surface = normalizeSurface(panel.surface);
    let background = null;
    if (panel.background !== null) {
      exact(panel.background, ["assetSlot", "altText"], "Multi-Part background");
      if (panel.layout !== "canvas" || !assets.some((asset) => asset.slot === panel.background.assetSlot && asset.role === "activity_artwork")) throw new Error("Multi-Part background must be managed artwork on a shared canvas.");
      background = { assetSlot: panel.background.assetSlot, altText: normalizeNativePedagogicalText(panel.background.altText, "Canvas description", 2000) };
      used.add(background.assetSlot);
    }
    return { id: panel.id, title: normalizeNativePedagogicalText(panel.title, "Panel title", 300), layout: panel.layout, surface, background };
  });
  const sections = input.sections.map((section) => {
    exact(section, ["id", "kind", "title", "panelId", "bankRegion", "interaction", ...(Object.hasOwn(section, "textRegion") ? ["textRegion"] : [])], "Multi-Part section");
    const adapter = NATIVE_MULTI_PART_CHILDREN[section.kind];
    if (!adapter || !isNativeChildId(section.id, "section") || sectionIds.has(section.id) || !panelIds.has(section.panelId) || section.interaction?.kind !== section.kind) throw new Error("Multi-Part section identity, kind or membership is invalid.");
    sectionIds.add(section.id);
    const panel = panels.find((entry) => entry.id === section.panelId);
    const slots = nativeMultiPartAssetSlots(section.interaction);
    let interaction;
    try {
      interaction = adapter.normalizeInteraction(section.interaction, { assets: assets.filter((asset) => slots.has(asset.slot)), commonAssetSlots: new Set() });
      childPanel(interaction);
    } catch (error) { throw new Error(`${panel.title || panel.id} / ${section.title || section.kind}: ${error.message}`); }
    nativeMultiPartAssetSlots(interaction).forEach((slot) => used.add(slot));
    const bankRegion = section.bankRegion === null ? null : normalizeArea(section.bankRegion, panel.surface);
    if (bankRegion && (panel.layout !== "canvas" || section.kind !== "drag-drop")) throw new Error("Reserved answer banks belong to shared Drag & Drop sections.");
    const textRegion = Object.hasOwn(section, "textRegion") ? normalizeArea(section.textRegion, panel.surface) : null;
    if (textRegion && (panel.layout !== "canvas" || section.kind !== "drag-drop" || interaction.layoutMode !== "text")) throw new Error("Text image regions belong to shared Text Drag & Drop sections.");
    return { ...(textRegion ? { textRegion } : {}), id: section.id, kind: section.kind, title: normalizeNativePedagogicalText(section.title, "Section title", 300), panelId: section.panelId, bankRegion, interaction };
  });
  for (const panel of panels) if (panel.layout === "canvas") {
    try { validateCanvas(panel, sections.filter((section) => section.panelId === panel.id), input.schemaVersion); }
    catch (error) { throw new Error(`${panel.title || panel.id}: ${error.message}`); }
  }
  if (assets.some((asset) => !used.has(asset.slot))) throw new Error("Multi-Part managed assets must be used by a section, panel or common media.");
  return { kind: "multi-part", schemaVersion: input.schemaVersion, panels, sections };
}

export function normalizeNativeMultiPartSolution(input) {
  budget(input);
  exact(input, ["kind", "schemaVersion", "sections"], "Multi-Part Teacher solution");
  if (input.kind !== "multi-part" || ![NATIVE_MULTI_PART_VERSION, NATIVE_MULTI_PART_CANVAS_VERSION].includes(input.schemaVersion) || !Array.isArray(input.sections) || input.sections.length > 24) throw new Error("Multi-Part Teacher limits or version are invalid.");
  const seen = new Set();
  const sections = input.sections.map((entry) => {
    exact(entry, ["id", "kind", "solution"], "Multi-Part Teacher section");
    if (!isNativeChildId(entry.id, "section") || seen.has(entry.id) || !NATIVE_MULTI_PART_CHILDREN[entry.kind] || entry.solution?.kind !== entry.kind) throw new Error("Multi-Part Teacher section identity or kind is invalid.");
    seen.add(entry.id);
    return { id: entry.id, kind: entry.kind, solution: nativeMultiPartTeacherChild(entry.kind).normalizeSolution(entry.solution) };
  });
  return { kind: "multi-part", schemaVersion: input.schemaVersion, sections };
}

export function validateNativeMultiPartTopology(publicDocument, teacherDocument) {
  if (publicDocument.parts[0].interaction.schemaVersion !== teacherDocument.parts[0].solution.schemaVersion) throw new Error("Multi-Part public and Teacher versions must match.");
  const sections = publicDocument.parts[0].interaction.sections;
  const solutions = teacherDocument.parts[0].solution.sections;
  if (sections.length !== solutions.length || sections.some((section) => !solutions.some((entry) => entry.id === section.id && entry.kind === section.kind))) throw new Error("Multi-Part public and Teacher section identities must match exactly.");
  for (const section of sections) {
    const child = projectNativeMultiPartChild(publicDocument, section, teacherDocument);
    nativeMultiPartTeacherChild(section.kind).topology(child.publicDocument, child.teacherDocument);
  }
  return true;
}

export function assessNativeMultiPartReadiness(publicDocument, teacherDocument) {
  const interaction = publicDocument.parts[0].interaction;
  const issues = [];
  if (!interaction.panels.length || !interaction.sections.length) issues.push("Add a panel and at least one section.");
  for (const panel of interaction.panels) {
    if (!interaction.sections.some((section) => section.panelId === panel.id)) issues.push(`${panel.title || "Panel"} needs a section.`);
    if (panel.layout === "canvas" && !panel.background) issues.push(`${panel.title || "Canvas"} needs a background image.`);
  }
  for (const section of interaction.sections) {
    const child = projectNativeMultiPartChild(publicDocument, section, teacherDocument);
    if (!child.teacherDocument) { issues.push("A section has no matching Teacher data."); continue; }
    const panel = interaction.panels.find((entry) => entry.id === section.panelId);
    if (section.kind === "drag-drop" && panel.layout === "canvas" && panel.background) {
      child.publicDocument = structuredClone(child.publicDocument);
      const reference = publicDocument.assets.find((asset) => asset.slot === panel.background.assetSlot);
      if (!child.publicDocument.assets.some((asset) => asset.slot === reference.slot)) child.publicDocument.assets.push(reference);
      child.publicDocument.parts[0].interaction.panels[0].images = [{ id: "img-00000000000000000000000000000000", assetSlot: reference.slot, area: { x: 0, y: 0, ...panel.surface }, order: 0, altText: panel.background.altText, decorative: true, fit: "contain", locked: true }];
    }
    const readiness = nativeMultiPartTeacherChild(section.kind).readiness(child.publicDocument, child.teacherDocument);
    issues.push(...readiness.issues.map((issue) => `${panel.title || panel.id} / ${section.title || section.kind}: ${issue}`));
  }
  return { ready: !issues.length, issues };
}

export function duplicateNativeMultiPartSection(section, privateSection, newId = createNativeChildId("section")) {
  const ids = new Map();
  const collect = (value) => { if (!value || typeof value !== "object") return; for (const [key, entry] of Object.entries(value)) { if (key === "id" && typeof entry === "string" && /^[a-z]+-[a-f0-9]{32}$/.test(entry)) ids.set(entry, createNativeChildId(entry.split("-")[0])); else if (entry && typeof entry === "object") collect(entry); } };
  collect(section.interaction);
  const remapString = (value) => ids.get(value) || value.replace(/^(q-[a-f0-9]{32})(-response)$/, (_, id, suffix) => `${ids.get(id) || id}${suffix}`);
  const remap = (value) => typeof value === "string" ? remapString(value) : Array.isArray(value) ? value.map(remap) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [ids.get(key) || key, remap(entry)])) : value;
  return { section: { ...remap(section), id: newId, title: `${section.title} copy`.trim() }, privateSection: { ...remap(privateSection), id: newId } };
}

export function nativeMultiPartAssetRequirements(document) {
  const interaction = document.parts[0].interaction;
  return [
    ...interaction.panels.filter((panel) => panel.background).map((panel) => ({ slot: panel.background.assetSlot, width: panel.surface.width, height: panel.surface.height, label: "Shared canvas background" })),
    ...interaction.sections.flatMap((section) => NATIVE_MULTI_PART_CHILDREN[section.kind].requirements?.(projectNativeMultiPartChild(document, section).publicDocument) || []),
  ];
}
