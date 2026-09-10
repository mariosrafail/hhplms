import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "./_vite-test-server.mjs";

test("shared Bulk generate UI is accessible, explicit about replacement, and has no persistence client", async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { NativeBulkGenerator } = await vite.ssrLoadModule("/src/apps/book-builder/hosted/NativeBulkGenerator.jsx");
    const markup = renderToStaticMarkup(React.createElement(NativeBulkGenerator, { kind: "complete-sentences", hasExistingContent: true, onGenerate: () => ({}) }));
    assert.match(markup, /Bulk generate from text/);
    assert.match(markup, /<textarea[^>]*rows="10"/);
    assert.match(markup, /Replace existing semantic content/);
    assert.match(markup, /Compatible panels, assets and geometry are preserved/);
    assert.match(markup, /Generate content/);
    assert.match(markup, /Clear source/);
    assert.match(markup, /Turn it \*down\*/);
  } finally { await vite.close(); }

  const source = await readFile(new URL("../src/apps/book-builder/hosted/NativeBulkGenerator.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|saveNativeActivity|uploadNativeActivity|publish|dangerouslySetInnerHTML/);
});

test("all four existing native editors apply generated candidates in memory and mark their normal dirty state", async () => {
  const editors = [
    ["NativeCompleteSentencesEditor.jsx", "complete-sentences", "changed()"],
    ["NativeSingleChoiceEditor.jsx", "single-choice", "changed()"],
    ["NativeOpenResponseEditor.jsx", "open-response", "markDirty()"],
    ["NativeDragDropEditor.jsx", "drag-drop", "markDirty()"],
  ];
  for (const [filename, kind, dirtyCall] of editors) {
    const source = await readFile(new URL(`../src/apps/book-builder/hosted/${filename}`, import.meta.url), "utf8");
    if (filename === "NativeSingleChoiceEditor.jsx") {
      const shared = await readFile(new URL("../src/apps/book-builder/hosted/NativeSingleChoiceQuestionAuthoring.jsx", import.meta.url), "utf8");
      assert.match(source, /NativeSingleChoiceQuestionAuthoring/);
      assert.match(shared, /NativeBulkGenerator kind="single-choice"/);
    } else assert.match(source, new RegExp(`NativeBulkGenerator kind=["']${kind}["']`));
    const generator = source.slice(source.indexOf("const generateBulk"), source.indexOf("const generateBulk") + 900);
    assert.match(generator, /generateNativeBulkCandidate/);
    assert.match(generator, /setPublicDraft\(result\.publicDocument\)/);
    assert.match(generator, /setTeacherDraft\(result\.teacherDocument\)/);
    assert.ok(generator.includes(dirtyCall), `${filename} marks its existing dirty state`);
  }
});
