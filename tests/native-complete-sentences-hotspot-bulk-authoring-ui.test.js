import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "./_vite-test-server.mjs";

test("Complete the Sentences hotspot importer exposes its strict format, ordering caveat, replacement scope, and accessible controls", async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { NativeCompleteSentencesHotspotBulkImporter } = await vite.ssrLoadModule("/src/apps/book-builder/hosted/NativeCompleteSentencesHotspotBulkImporter.jsx");
    const markup = renderToStaticMarkup(React.createElement(NativeCompleteSentencesHotspotBulkImporter, { hasExistingHotspots: true, onImport: () => ({ summary: {} }) }));
    assert.match(markup, /Bulk import hotspots from text/);
    assert.match(markup, /SOURCE defines the coordinate system used by the original page or XML/);
    assert.match(markup, /PANEL numbers use the current panel order/);
    assert.match(markup, /ITEM 3 means current Sentence 3 in Builder order/);
    assert.match(markup, /ITEM numbers do not necessarily match the printed exercise numbers/);
    assert.match(markup, /Upload each referenced panel background before importing/);
    assert.match(markup, /Different resolutions are scaled automatically\. Cropped or reflowed images may need manual adjustment/);
    assert.match(markup, /The pasted source is not saved; only generated hotspot geometry is stored/);
    assert.match(markup, /aria-label="Complete the Sentences hotspot geometry format example"/);
    assert.match(markup, /SOURCE 1024x582/);
    assert.match(markup, /PANEL 2/);
    assert.match(markup, /ITEM 8 x=523 y=367 width=140 height=27/);
    assert.match(markup, /<label for="[^"]+-source"><span>Paste hotspot geometry<\/span><textarea id="[^"]+-source"/);
    assert.match(markup, /maxLength="65536"/);
    assert.match(markup, /Replace existing hotspots on listed panels/);
    assert.match(markup, /aria-describedby="[^"]+-replace-help"/);
    assert.match(markup, /Hotspots on other panels are left unchanged/);
    assert.match(markup, /<button[^>]*disabled=""[^>]*title="Paste hotspot geometry first"[^>]*>/);
    assert.match(markup, /Import hotspots<\/button>/);
    assert.match(markup, /Clear source/);
  } finally { await vite.close(); }
});

test("importer remains separate from semantic generation and owns no persistence or Teacher data", async () => {
  const [component, semantic, editor] = await Promise.all([
    readFile(new URL("../src/apps/book-builder/hosted/NativeCompleteSentencesHotspotBulkImporter.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/book-builder/hosted/NativeBulkGenerator.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/book-builder/hosted/NativeCompleteSentencesEditor.jsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(semantic, /CompleteSentencesHotspotBulkImporter|ITEM 8 x=523/);
  assert.doesNotMatch(component, /fetch\(|saveNativeActivity|uploadNativeActivity|teacherDocument|teacherDraft|acceptedTexts|answer\.text|dangerouslySetInnerHTML/);
  assert.match(component, /role="alert"/);
  assert.match(component, /role="status"/);
  assert.match(component, /const clear = \(\) => \{ setSource\(""\); setError\(""\); setSummary\(null\); \}/);
  const start = editor.indexOf("const importHotspots");
  const integration = editor.slice(start, editor.indexOf("useEffect", start));
  assert.ok(start > 0);
  assert.match(integration, /generateNativeCompleteSentencesHotspotImportCandidate/);
  assert.match(integration, /setPublicDraft\(result\.publicDocument\)/);
  assert.match(integration, /setSelectedPanelId\(result\.selection\.panelId\)/);
  assert.match(integration, /setSelectedHotspotId\(result\.selection\.hotspotId\)/);
  assert.match(integration, /setDrawing\(false\)/);
  assert.match(integration, /setLockedHotspotIds/);
  assert.match(integration, /retainedIds\.has\(id\)/);
  assert.match(integration, /changed\(\)/);
  assert.doesNotMatch(integration, /setTeacherDraft|saveNativeActivity|fetch\(/);
  assert.match(editor, /<NativeCompleteSentencesHotspotBulkImporter hasExistingHotspots=/);
});
