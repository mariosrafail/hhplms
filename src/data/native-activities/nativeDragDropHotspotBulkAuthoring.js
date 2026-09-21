import { normalizeNativeActivityPublic } from "./nativeActivityPublic.js";
import { createNativeChildId, isNativeChildId } from "./nativeChildIdentity.js";
import {
  NATIVE_DRAG_DROP_LIMITS,
  nativeDragDropMappingWordIds,
  normalizeNativeDragDropInteraction,
  normalizeNativeDragDropSolution,
  validateNativeDragDropTopology,
} from "./nativeDragDrop.js";

export const NATIVE_DRAG_DROP_HOTSPOT_BULK_MAX_CHARACTERS = 64 * 1024;

const SOURCE_PATTERN = /^\s*SOURCE\s+([0-9]+)x([0-9]+)\s*$/;
const PANEL_PATTERN = /^\s*PANEL\s+([0-9]+)\s*$/;
const TARGET_PATTERN = /^\s*TARGET\s+([0-9]+)\s+items=([^\s]+)\s+x=(-?[0-9]+)\s+y=(-?[0-9]+)\s+width=([0-9]+)\s+height=([0-9]+)\s*$/;
const fail = (line, message) => { throw new Error(line ? `Line ${line}: ${message}` : message); };

function integer(raw, line, label, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(line, `${label} must be a safe integer from ${minimum} to ${maximum}.`);
  return value;
}

export function parseNativeDragDropHotspotBulk(source) {
  if (typeof source !== "string" || !source.trim()) throw new Error("Paste target geometry before previewing.");
  if (source.length > NATIVE_DRAG_DROP_HOTSPOT_BULK_MAX_CHARACTERS) throw new Error(`Target geometry must not exceed ${NATIVE_DRAG_DROP_HOTSPOT_BULK_MAX_CHARACTERS.toLocaleString("en-US")} characters.`);
  const directives = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n").map((text, index) => ({ text, line: index + 1 })).filter(({ text }) => text.trim());
  const sourceMatch = directives[0]?.text.match(SOURCE_PATTERN);
  if (!sourceMatch) fail(directives[0]?.line, "expected SOURCE <width>x<height>.");
  const sourceWidth = integer(sourceMatch[1], directives[0].line, "SOURCE width", { maximum: NATIVE_DRAG_DROP_LIMITS.surfaceMaximum });
  const sourceHeight = integer(sourceMatch[2], directives[0].line, "SOURCE height", { maximum: NATIVE_DRAG_DROP_LIMITS.surfaceMaximum });
  const panels = []; const panelOrdinals = new Set(); let panel = null; let targetCount = 0;
  for (const directive of directives.slice(1)) {
    if (directive.text.trimStart().startsWith("SOURCE")) fail(directive.line, "SOURCE may appear only once and must be first.");
    const panelMatch = directive.text.match(PANEL_PATTERN);
    if (panelMatch) {
      if (panel && !panel.entries.length) fail(panel.line, `PANEL ${panel.ordinal} must contain a TARGET entry.`);
      const ordinal = integer(panelMatch[1], directive.line, "PANEL ordinal", { maximum: NATIVE_DRAG_DROP_LIMITS.panels });
      if (panelOrdinals.has(ordinal)) fail(directive.line, `PANEL ${ordinal} is duplicated.`);
      panelOrdinals.add(ordinal); panel = { ordinal, line: directive.line, entries: [] }; panels.push(panel); continue;
    }
    const match = directive.text.match(TARGET_PATTERN);
    if (!match) fail(directive.line, "expected TARGET <ordinal> items=<item|item> x=<x> y=<y> width=<width> height=<height>.");
    if (!panel) fail(directive.line, "add a PANEL header before TARGET entries.");
    const ordinal = integer(match[1], directive.line, "TARGET ordinal", { maximum: NATIVE_DRAG_DROP_LIMITS.targetsPerPanel });
    if (panel.entries.some((entry) => entry.ordinal === ordinal)) fail(directive.line, `TARGET ${ordinal} is duplicated in PANEL ${panel.ordinal}.`);
    const itemReferences = match[2].split("|");
    if (!itemReferences.length || itemReferences.some((reference) => !reference) || new Set(itemReferences).size !== itemReferences.length) fail(directive.line, "items must contain unique references separated by |.");
    const area = {
      x: integer(match[3], directive.line, "x", { minimum: -sourceWidth, maximum: sourceWidth }),
      y: integer(match[4], directive.line, "y", { minimum: -sourceHeight, maximum: sourceHeight }),
      width: integer(match[5], directive.line, "width", { maximum: sourceWidth * 2 }),
      height: integer(match[6], directive.line, "height", { maximum: sourceHeight * 2 }),
    };
    if (area.x >= sourceWidth || area.y >= sourceHeight || area.x + area.width <= 0 || area.y + area.height <= 0) fail(directive.line, "target rectangle is completely outside SOURCE.");
    targetCount += 1;
    if (targetCount > NATIVE_DRAG_DROP_LIMITS.totalTargets) fail(directive.line, `at most ${NATIVE_DRAG_DROP_LIMITS.totalTargets} targets may be imported.`);
    panel.entries.push({ ordinal, itemReferences, area, line: directive.line });
  }
  if (!panels.length) throw new Error("Add at least one PANEL block.");
  if (!panel.entries.length) fail(panel.line, `PANEL ${panel.ordinal} must contain a TARGET entry.`);
  return { sourceWidth, sourceHeight, panels, targetCount };
}

export function scaleNativeDragDropHotspotArea(area, source, target) {
  const clipped = {
    x: Math.max(0, area.x), y: Math.max(0, area.y),
    right: Math.min(source.width, area.x + area.width), bottom: Math.min(source.height, area.y + area.height),
  };
  if (clipped.right <= clipped.x || clipped.bottom <= clipped.y) throw new Error("Target rectangle is completely outside SOURCE.");
  const left = Math.floor(clipped.x * target.width / source.width);
  const top = Math.floor(clipped.y * target.height / source.height);
  const right = Math.ceil(clipped.right * target.width / source.width);
  const bottom = Math.ceil(clipped.bottom * target.height / source.height);
  return { area: { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }, clipped: clipped.x !== area.x || clipped.y !== area.y || clipped.right !== area.x + area.width || clipped.bottom !== area.y + area.height };
}

function resolveReference(reference, words, line) {
  if (/^[0-9]+$/.test(reference)) {
    const ordinal = Number(reference);
    const word = words[ordinal - 1];
    if (!word) fail(line, `item ${reference} does not exist in the current bank.`);
    return { word, reference, resolution: `item ${ordinal}` };
  }
  const matches = words.filter((word) => word.id === reference);
  if (matches.length !== 1) fail(line, `item reference ${reference} is unknown or ambiguous.`);
  return { word: matches[0], reference, resolution: "stable ID" };
}

export function generateNativeDragDropHotspotImportCandidate({ source, publicDocument, teacherDocument, mode = "append", createId = createNativeChildId }) {
  if (!["append", "replace"].includes(mode)) throw new Error("Choose append or replace mode.");
  const parsed = parseNativeDragDropHotspotBulk(source);
  const publicCandidate = structuredClone(publicDocument); const teacherCandidate = structuredClone(teacherDocument);
  const interaction = publicCandidate?.parts?.[0]?.interaction;
  if (publicCandidate?.kind !== "drag-drop" || interaction?.kind !== "drag-drop" || teacherCandidate?.kind !== "drag-drop") throw new Error("Open a native Drag & Drop draft before importing targets.");
  if (!interaction.words?.length) throw new Error("Create draggable items before importing targets.");
  const panels = interaction.panels || []; const listedPanelIds = new Set(); const warnings = []; const rows = [];
  const existingIds = new Set(panels.flatMap((panel) => panel.dropTargets || []).map((target) => target.id));
  const mappings = new Map((teacherCandidate.parts?.[0]?.solution?.mappings || []).map((mapping) => [mapping.targetId, nativeDragDropMappingWordIds(mapping)]));
  const incomingByPanel = new Map(); let preservedIds = 0; let createdIds = 0; let clippedTargets = 0; let removedTargets = 0;
  for (const parsedPanel of parsed.panels) {
    const panel = panels[parsedPanel.ordinal - 1];
    if (!panel) fail(parsedPanel.line, `PANEL ${parsedPanel.ordinal} does not exist.`);
    if (!panel.images?.length) fail(parsedPanel.line, `PANEL ${parsedPanel.ordinal} needs a managed image before importing.`);
    listedPanelIds.add(panel.id);
    if (parsed.sourceWidth * panel.surface.height !== parsed.sourceHeight * panel.surface.width) warnings.push(`Panel ${parsedPanel.ordinal} has a different aspect ratio from SOURCE ${parsed.sourceWidth}×${parsed.sourceHeight}; coordinates were scaled independently.`);
    const nextTargets = [];
    for (const entry of parsedPanel.entries) {
      const resolved = entry.itemReferences.map((reference) => resolveReference(reference, interaction.words, entry.line));
      const wordIds = resolved.map(({ word }) => word.id);
      const scaled = scaleNativeDragDropHotspotArea(entry.area, { width: parsed.sourceWidth, height: parsed.sourceHeight }, panel.surface);
      if (scaled.clipped) { clippedTargets += 1; warnings.push(`Line ${entry.line}: target was clipped to SOURCE bounds before scaling.`); }
      const existing = mode === "replace" ? panel.dropTargets?.[entry.ordinal - 1] : null;
      let id = existing?.id;
      if (id) preservedIds += 1;
      else {
        id = createId("target");
        if (!isNativeChildId(id, "target") || existingIds.has(id)) throw new Error("Target identity generation produced a duplicate or invalid ID.");
        existingIds.add(id); createdIds += 1;
      }
      const target = { ...existing, id, area: scaled.area, accessibleLabel: existing?.accessibleLabel || `Drop target ${entry.ordinal}`, capacity: existing?.answerMode === "any" ? 1 : wordIds.length };
      nextTargets.push(target); mappings.set(id, wordIds);
      rows.push({ line: entry.line, panelOrdinal: parsedPanel.ordinal, targetOrdinal: entry.ordinal, targetId: id, items: resolved.map(({ word, reference, resolution }) => ({ reference, resolution, id: word.id, shortLabel: word.shortLabel, text: word.text })) });
    }
    incomingByPanel.set(panel.id, nextTargets);
  }
  for (const panel of panels) {
    if (!listedPanelIds.has(panel.id)) continue;
    const incoming = incomingByPanel.get(panel.id) || [];
    if (mode === "replace") {
      const retained = new Set(incoming.map((target) => target.id));
      const deleted = panel.dropTargets.filter((target) => !retained.has(target.id));
      removedTargets += deleted.length; deleted.forEach((target) => mappings.delete(target.id)); panel.dropTargets = incoming;
    } else {
      if (panel.dropTargets.length + incoming.length > NATIVE_DRAG_DROP_LIMITS.targetsPerPanel) throw new Error(`Panel target limit of ${NATIVE_DRAG_DROP_LIMITS.targetsPerPanel} would be exceeded.`);
      panel.dropTargets.push(...incoming);
    }
  }
  teacherCandidate.parts[0].solution.mappings = panels.flatMap((panel) => panel.dropTargets).map((target) => ({ targetId: target.id, wordIds: mappings.get(target.id) || [] })).filter((mapping) => mapping.wordIds.length);
  Object.assign(publicCandidate, normalizeNativeActivityPublic(publicCandidate, { normalizeInteraction: normalizeNativeDragDropInteraction, expectedKind: "drag-drop" }));
  teacherCandidate.parts[0].solution = normalizeNativeDragDropSolution(teacherCandidate.parts[0].solution);
  validateNativeDragDropTopology(publicCandidate, teacherCandidate);
  const first = rows[0];
  return {
    publicDocument: publicCandidate, teacherDocument: teacherCandidate,
    selection: first ? { panelId: panels[first.panelOrdinal - 1].id, targetId: first.targetId } : null,
    summary: { headline: `${rows.length} target${rows.length === 1 ? "" : "s"} ready`, sourceDimensions: { width: parsed.sourceWidth, height: parsed.sourceHeight }, mode, panelsUpdated: parsed.panels.length, targetsImported: rows.length, preservedIds, createdIds, removedTargets, clippedTargets, warnings: [...new Set(warnings)], rows },
  };
}
