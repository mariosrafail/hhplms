import assert from "node:assert/strict";
import test from "node:test";

import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { nativeChildIdFromUuid } from "../src/data/native-activities/nativeChildIdentity.js";
import { generateNativeDragDropHotspotImportCandidate, parseNativeDragDropHotspotBulk, scaleNativeDragDropHotspotArea } from "../src/data/native-activities/nativeDragDropHotspotBulkAuthoring.js";

const id = (prefix, suffix) => nativeChildIdFromUuid(prefix, `50000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`);
const activityId = "ultimate-b2-sb-u1-p1-o199";

function pair({ textMode = false, reusable = false } = {}) {
  const kind = resolveNativeActivityKind("drag-drop");
  const publicDocument = kind.createBlankPublic({ activityId, title: "Import", placement: { pageId: "ub2-sb-unit-1-part-1" } });
  const teacherDocument = kind.createBlankTeacher({ activityId });
  const asset = { assetId: "50000000-0000-4000-8000-000000000090", checksumSha256: "a".repeat(64), role: "activity_artwork", slot: "import-background" };
  publicDocument.assets = [asset];
  publicDocument.parts[0].interaction.layoutMode = textMode ? "text" : "standard";
  publicDocument.parts[0].interaction.words = [
    { id: id("word", 1), text: "First phrase", reusable, shortLabel: "A" },
    { id: id("word", 2), text: "Second phrase", reusable: false, shortLabel: "B" },
    { id: id("word", 3), text: "Third phrase", reusable: false, shortLabel: "C" },
  ];
  publicDocument.parts[0].interaction.panels = [{
    id: id("panel", 1), surface: { width: 800, height: 400 },
    images: [{ id: id("img", 1), assetSlot: asset.slot, area: { x: 0, y: 0, width: 800, height: 400 }, order: 0, altText: "Passage", decorative: false, fit: "contain", locked: true }],
    dropTargets: [],
  }];
  return { publicDocument, teacherDocument };
}

test("Drag & Drop hotspot parser accepts multi-item rows and reports source lines", () => {
  const parsed = parseNativeDragDropHotspotBulk("SOURCE 1000x500\nPANEL 1\nTARGET 1 items=1|3 x=100 y=50 width=200 height=40");
  assert.deepEqual(parsed.panels[0].entries[0].itemReferences, ["1", "3"]);
  assert.equal(parsed.panels[0].entries[0].line, 3);
  assert.throws(() => parseNativeDragDropHotspotBulk("SOURCE 1000x500\nTARGET 1 items=1 x=0 y=0 width=10 height=10"), /PANEL header/);
  assert.throws(() => parseNativeDragDropHotspotBulk("SOURCE 1000x500\nPANEL 1\nTARGET 1 items=1|1 x=0 y=0 width=10 height=10"), /unique references/);
});

test("Drag & Drop hotspot scaling is deterministic and clips intersecting rectangles", () => {
  assert.deepEqual(scaleNativeDragDropHotspotArea({ x: 100, y: 50, width: 200, height: 40 }, { width: 1000, height: 500 }, { width: 800, height: 400 }), { area: { x: 80, y: 40, width: 160, height: 32 }, clipped: false });
  assert.deepEqual(scaleNativeDragDropHotspotArea({ x: -10, y: 490, width: 30, height: 30 }, { width: 1000, height: 500 }, { width: 800, height: 400 }), { area: { x: 0, y: 392, width: 16, height: 8 }, clipped: true });
});

for (const height of [291, 312, 582]) test(`Standard SOURCE 1024x${height} retains the uploaded logical surface`, () => {
  const current = pair();
  const panel = current.publicDocument.parts[0].interaction.panels[0];
  panel.surface = { width: 1024, height };
  panel.images[0].area = { x: 0, y: 0, ...panel.surface };
  const result = generateNativeDragDropHotspotImportCandidate({ ...current, source: `SOURCE 1024x${height}\nPANEL 1\nTARGET 1 items=1 x=100 y=50 width=200 height=40`, createId: (prefix) => id(prefix, 95) });
  const saved = JSON.parse(JSON.stringify(result.publicDocument));
  assert.deepEqual(saved.parts[0].interaction.panels[0].surface, panel.surface);
  assert.deepEqual(saved.parts[0].interaction.panels[0].dropTargets[0].area, { x: 100, y: 50, width: 200, height: 40 });
  assert.equal(saved.parts[0].interaction.layoutMode, "standard");
});

for (const textMode of [false, true]) test(`append atomically adds geometry and private reusable mappings in ${textMode ? "text" : "standard"}`, () => {
  const current = pair({ reusable: true, textMode });
  const before = structuredClone(current);
  const result = generateNativeDragDropHotspotImportCandidate({ source: "SOURCE 1000x500\nPANEL 1\nTARGET 1 items=1|2 x=100 y=50 width=200 height=40\nTARGET 2 items=1 x=400 y=80 width=120 height=40", ...current, createId: (prefix) => id(prefix, prefix === "target" ? 10 + resultCounter++ : 99) });
  assert.deepEqual(current, before, "preview/candidate creation never mutates drafts");
  assert.deepEqual(result.publicDocument.parts[0].interaction.panels[0].dropTargets.map((target) => target.capacity), [2, 1]);
  assert.deepEqual(result.teacherDocument.parts[0].solution.mappings.map((mapping) => mapping.wordIds), [[id("word", 1), id("word", 2)], [id("word", 1)]]);
  assert.equal(result.summary.rows[0].items[0].shortLabel, "A");
});

let resultCounter = 0;

test("replace preserves ordinal IDs, removes stale mappings, and supports clipped warnings", () => {
  resultCounter = 0;
  const current = pair();
  const initial = generateNativeDragDropHotspotImportCandidate({ source: "SOURCE 800x400\nPANEL 1\nTARGET 1 items=1 x=10 y=10 width=100 height=30\nTARGET 2 items=2 x=200 y=10 width=100 height=30", ...current, createId: (prefix) => id(prefix, 20 + resultCounter++) });
  const firstId = initial.publicDocument.parts[0].interaction.panels[0].dropTargets[0].id;
  const replaced = generateNativeDragDropHotspotImportCandidate({ source: "SOURCE 800x400\nPANEL 1\nTARGET 1 items=3 x=-10 y=10 width=100 height=30", publicDocument: initial.publicDocument, teacherDocument: initial.teacherDocument, mode: "replace", createId: (prefix) => id(prefix, 40 + resultCounter++) });
  assert.equal(replaced.publicDocument.parts[0].interaction.panels[0].dropTargets[0].id, firstId);
  assert.equal(replaced.teacherDocument.parts[0].solution.mappings.length, 1);
  assert.equal(replaced.summary.removedTargets, 1); assert.equal(replaced.summary.clippedTargets, 1);
});

test("unknown references and non-reusable cross-target mappings fail without partial mutation", () => {
  const current = pair(); const before = structuredClone(current);
  assert.throws(() => generateNativeDragDropHotspotImportCandidate({ source: "SOURCE 800x400\nPANEL 1\nTARGET 1 items=99 x=10 y=10 width=100 height=30", ...current }), /does not exist/);
  assert.throws(() => generateNativeDragDropHotspotImportCandidate({ source: "SOURCE 800x400\nPANEL 1\nTARGET 1 items=1 x=10 y=10 width=100 height=30\nTARGET 2 items=1 x=200 y=10 width=100 height=30", ...current }), /only reusable items/);
  assert.deepEqual(current, before);
});

test("text-mode import previews stable labels and full phrases", () => {
  const current = pair({ textMode: true });
  const result = generateNativeDragDropHotspotImportCandidate({ source: `SOURCE 800x400\nPANEL 1\nTARGET 1 items=${id("word", 2)} x=10 y=10 width=100 height=30`, ...current });
  assert.deepEqual(result.summary.rows[0].items[0], { reference: id("word", 2), resolution: "stable ID", id: id("word", 2), shortLabel: "B", text: "Second phrase" });
});
