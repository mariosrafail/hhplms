import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "./_vite-test-server.mjs";

test("Multiple Choice hotspot importer exposes the strict format, prerequisites, replacement scope, and accessible controls", async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { NativeSingleChoiceHotspotBulkImporter } = await vite.ssrLoadModule("/src/apps/book-builder/hosted/NativeSingleChoiceHotspotBulkImporter.jsx");
    const markup = renderToStaticMarkup(React.createElement(NativeSingleChoiceHotspotBulkImporter, { hasExistingHotspots: true, onImport: () => ({ summary: {} }) }));
    assert.match(markup, /Bulk import hotspots from text/);
    assert.match(markup, /SOURCE defines the coordinate system used by the original page or XML/);
    assert.match(markup, /PANEL numbers use the current panel order/);
    assert.match(markup, /1\.3 means current Question 1, Option 3/);
    assert.match(markup, /Upload each panel background before importing/);
    assert.match(markup, /Different resolutions are scaled automatically\. Cropped or reflowed images may need manual adjustment/);
    assert.match(markup, /The pasted source is not saved; only generated hotspot geometry is stored/);
    assert.match(markup, /aria-label="Multiple Choice hotspot geometry format example"/);
    assert.match(markup, /SOURCE 1024x582/);
    assert.match(markup, /PANEL 2/);
    assert.match(markup, /2\.3 x=500 y=240 width=150 height=30/);
    assert.match(markup, /<label for="[^"]+-source"><span>Paste hotspot geometry<\/span><textarea id="[^"]+-source"/);
    assert.match(markup, /maxLength="65536"/);
    assert.match(markup, /Replace existing hotspots on listed panels/);
    assert.match(markup, /Hotspots on other panels are left unchanged/);
    assert.match(markup, /<button[^>]*disabled=""[^>]*title="Paste hotspot geometry first"[^>]*>/);
    assert.match(markup, /Import hotspots<\/button>/);
    assert.match(markup, /Clear source/);
  } finally { await vite.close(); }
});

test("importer remains separate from semantic generation and owns no persistence or Teacher data", async () => {
  const [component, semantic, editor, visualAuthoring] = await Promise.all([
    readFile(new URL("../src/apps/book-builder/hosted/NativeSingleChoiceHotspotBulkImporter.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/book-builder/hosted/NativeBulkGenerator.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/book-builder/hosted/NativeSingleChoiceEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/book-builder/hosted/NativeSingleChoiceVisualAuthoring.jsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(semantic, /Bulk import hotspots|HotspotBulkImporter|SOURCE 1024x582/);
  assert.doesNotMatch(component, /fetch\(|saveNativeActivity|uploadNativeActivity|teacherDocument|teacherDraft|correctOption|correctAnswers|dangerouslySetInnerHTML/);
  assert.match(component, /role="alert"/);
  assert.match(component, /role="status"/);
  assert.match(component, /const clear = \(\) => \{ setSource\(""\); setError\(""\); setSummary\(null\); \}/);
  const integration = editor.slice(editor.indexOf("const importHotspots"), editor.indexOf("const addQuestion"));
  assert.match(integration, /generateNativeSingleChoiceHotspotImportCandidate/);
  assert.match(integration, /setPublicDraft\(result\.publicDocument\)/);
  assert.match(integration, /setSelectedPanelId\(result\.selection\.panelId\)/);
  assert.match(integration, /setSelectedHotspotId\(result\.selection\.hotspotId\)/);
  assert.match(integration, /changed\(\)/);
  assert.doesNotMatch(integration, /setTeacherDraft|saveNativeActivity|fetch\(/);
  assert.match(editor, /NativeSingleChoiceVisualAuthoring/);
  assert.match(visualAuthoring, /presentation \? <><NativeSingleChoiceHotspotBulkImporter/);
});
