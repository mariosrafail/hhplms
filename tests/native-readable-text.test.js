import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "./_vite-test-server.mjs";

import { assertPublicBuilderDocument, builderDocumentSha256 } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { validateBuilderNativeAssetReferences } from "../netlify-sites/ultimate-b2-builder/server/_builder-native-activity-store.js";
import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { candidateNativeAudioTextAssetSlots, NATIVE_AUDIO_TEXT_FIXED_FOCUS_ASPECT_RATIO, NATIVE_AUDIO_TEXT_HIGHLIGHT_COLORS, nativeAudioTextAssetRequirements, nativeAudioTextFocusLayout, nativeAudioTextHotspotTargets, nativeAudioTextReadableHighlightArea } from "../src/data/native-activities/nativeAudioTextHotspots.js";
import { NATIVE_ACTIVITY_KINDS } from "../src/data/native-activities/nativeActivityKinds.js";
import { removeNativeManagedAssetReferenceIfUnused } from "../src/data/native-activities/nativeActivityPublic.js";
import { createNativeOpenResponseQuestion, promoteNativeOpenResponsePanels } from "../src/data/native-activities/nativeOpenResponse.js";

const reference = { assetId: "10000000-0000-4000-8000-000000000004", checksumSha256: "a".repeat(64), role: "activity_artwork", slot: "readable-text" };
const readableText = { kind: "image", assetSlot: reference.slot, sourceWidth: 1000, sourceHeight: 1800, altText: "Readable passage" };
const audioReference = { assetId: "10000000-0000-4000-8000-000000000005", checksumSha256: "b".repeat(64), role: "activity_artwork", slot: "audio-one" };
const audioHotspot = { id: `aud-${"1".repeat(32)}`, panelId: null, activityArea: { x: 20, y: 30, width: 48, height: 48 }, readableFocusArea: { x: 100, y: 200, width: 700, height: 400 }, audioAssetSlot: audioReference.slot, label: "Listen to the first paragraph" };
const pageId = "page-1";
const q = "q-00000000000040008000000000000001";

function oldDocuments() {
  const openQuestion = { ...createNativeOpenResponseQuestion(q, 0), prompt: "Prompt 1" };
  const artwork = { ...reference, slot: "asset-one" };
  const base = (activityId, kind, interaction, assets = []) => ({ schemaVersion: "1.0", activityId, kind, metadata: { title: "Compatibility", visibleInstructionText: "" }, placement: { pageId }, assets, parts: [{ id: "part-1", interaction }] });
  return {
    openResponse: base("open-compat", "open-response", { kind: "open-response", surface: { width: 1024, height: 582 }, artwork: [], questions: [openQuestion] }),
    image: base("image-compat", "image", { kind: "image", surface: { width: 1024, height: 582 }, images: [{ id: "img-00000000000040008000000000000001", assetSlot: artwork.slot, area: { x: 0, y: 0, width: 1024, height: 582 }, order: 0, altText: "Diagram", decorative: false, fit: "contain", locked: false }] }, [artwork]),
    textChoice: base("choice-compat", "single-choice", { kind: "single-choice", questions: [{ id: q, prompt: "Question?", options: [{ id: "opt-00000000000040008000000000000001", text: "A" }, { id: "opt-00000000000040008000000000000002", text: "B" }] }] }),
    visualChoice: base("visual-compat", "single-choice", { kind: "single-choice", questions: [{ id: q, prompt: "Question?", options: [{ id: "opt-00000000000040008000000000000001", text: "A" }, { id: "opt-00000000000040008000000000000002", text: "B" }] }], presentation: { kind: "image-hotspot", panels: [{ id: "panel-00000000000040008000000000000001", backgroundAssetSlot: artwork.slot, sourceWidth: 1200, sourceHeight: 800, hotspots: [{ id: "hot-00000000000040008000000000000001", questionId: q, optionId: "opt-00000000000040008000000000000001", area: { x: 100, y: 200, width: 300, height: 120 } }, { id: "hot-00000000000040008000000000000002", questionId: q, optionId: "opt-00000000000040008000000000000002", area: { x: 500, y: 200, width: 300, height: 120 } }] }] } }, [artwork]),
  };
}

test("legacy native canonical documents omit Readable Text and preserve fixed hashes", () => {
  const expected = {
    openResponse: "e70bfded61344025cd16bb6243b91edd84d70c80d4b42a080bf760ddf1efe091",
    image: "ccabdf138c2c782aee981ac50f284152992decd470b8afb1434b0c91d0234189",
    textChoice: "370d125e49355054168f083193ff088daa98dcdfad9aadb6c74b4372c51e40ba",
    visualChoice: "9fb8597f6d6313d05c6c8f8380eec66344ba29e3cd2fc391f2f2776b306ff1e7",
  };
  for (const [name, document] of Object.entries(oldDocuments())) {
    const normalized = resolveNativeActivityKind(document.kind).normalizePublic(document, document.activityId);
    assert.equal(Object.hasOwn(normalized, "readableText"), false);
    assert.equal(builderDocumentSha256(normalized), expected[name]);
  }
});

test("Readable Text is one strict generic student-safe optional managed image contract", () => {
  for (const kindName of NATIVE_ACTIVITY_KINDS) {
    const kind = resolveNativeActivityKind(kindName);
    const document = kind.createBlankPublic({ activityId: `${kindName}-readable`, title: "Readable", placement: { pageId } });
    document.assets = [reference]; document.readableText = readableText;
    const normalized = kind.normalizePublic(document);
    assert.deepEqual(normalized.readableText, readableText);
    assert.doesNotThrow(() => assertPublicBuilderDocument(normalized));
    assert.doesNotMatch(JSON.stringify(normalized), /correctAnswers|correctOptionId|modelAnswers|teacherSolution|https?:\/\//i);
  }
});

test("Readable Text rejects unknown keys, direct URLs, invalid kind, slot, dimensions, and alt text", () => {
  const kind = resolveNativeActivityKind("open-response");
  const valid = kind.createBlankPublic({ activityId: "open-readable", title: "Readable", placement: { pageId } });
  valid.assets = [reference]; valid.readableText = readableText;
  const mutations = [
    (value) => { value.readableText.extra = true; },
    (value) => { value.readableText.url = "https://private.example/image.png"; },
    (value) => { value.readableText.kind = "html"; },
    (value) => { value.readableText.assetSlot = "missing"; },
    (value) => { value.readableText.sourceWidth = 0; },
    (value) => { value.readableText.sourceHeight = 8_193; },
    (value) => { value.readableText.altText = ""; },
    (value) => { value.readableText.altText = "x".repeat(301); },
  ];
  for (const mutate of mutations) { const invalid = structuredClone(valid); mutate(invalid); assert.throws(() => kind.normalizePublic(invalid)); }
});

test("Audio / Readable-Text hotspots are strict, public, visual-surface-bound managed capabilities", () => {
  for (const kindName of ["open-response", "image"]) {
    const kind = resolveNativeActivityKind(kindName);
    const document = kind.createBlankPublic({ activityId: `${kindName}-audio`, title: "Audio focus", placement: { pageId } });
    document.assets = [reference, audioReference];
    document.readableText = readableText;
    document.audioTextHotspots = { hotspots: [audioHotspot] };
    const normalized = kind.normalizePublic(document);
    assert.deepEqual(normalized.audioTextHotspots, { hotspots: [audioHotspot] });
    assert.deepEqual(nativeAudioTextAssetRequirements(normalized), [{ slot: audioReference.slot, mediaType: "audio/mpeg", label: "Audio hotspot 1" }]);
    assert.doesNotThrow(() => assertPublicBuilderDocument(normalized));
    assert.doesNotMatch(JSON.stringify(normalized), /modelAnswer|correctOption|teacher|https?:\/\//i);
  }
});

test("legacy Audio/Text focus layout inference uses the documented narrow fixed-ratio tolerance", () => {
  assert.equal(nativeAudioTextFocusLayout({ readableFocusArea: { width: 1024, height: 291 } }), "fixed-aspect");
  assert.equal(nativeAudioTextFocusLayout({ readableFocusArea: { width: NATIVE_AUDIO_TEXT_FIXED_FOCUS_ASPECT_RATIO * 291 * 1.014, height: 291 } }), "fixed-aspect");
  assert.equal(nativeAudioTextFocusLayout({ readableFocusArea: { width: NATIVE_AUDIO_TEXT_FIXED_FOCUS_ASPECT_RATIO * 291 * 1.016, height: 291 } }), "natural-width");
  assert.equal(nativeAudioTextFocusLayout({ focusLayout: "natural-width", readableFocusArea: { width: 1024, height: 291 } }), "natural-width");
});

test("Readable-Text hotspots use one canonical no-audio value without phantom assets", () => {
  const kind = resolveNativeActivityKind("open-response");
  const document = kind.createBlankPublic({ activityId: "open-readable-only", title: "Readable focus", placement: { pageId } });
  document.assets = [reference];
  document.readableText = readableText;
  document.audioTextHotspots = { hotspots: [{ ...audioHotspot, audioAssetSlot: "", label: "Open readable excerpt" }] };
  const normalized = kind.normalizePublic(document);
  assert.equal(normalized.audioTextHotspots.hotspots[0].audioAssetSlot, "");
  assert.deepEqual(candidateNativeAudioTextAssetSlots(normalized.audioTextHotspots), []);
  assert.deepEqual(candidateNativeAudioTextAssetSlots({ hotspots: [{ audioAssetSlot: "" }, { audioAssetSlot: "   " }, audioHotspot, audioHotspot] }), [audioReference.slot, audioReference.slot]);
  assert.deepEqual(nativeAudioTextAssetRequirements(normalized), []);
  const mixed = structuredClone(normalized);
  mixed.assets.push(audioReference);
  mixed.audioTextHotspots.hotspots.push({ ...audioHotspot, id: `aud-${"2".repeat(32)}` }, { ...audioHotspot, id: `aud-${"3".repeat(32)}` });
  assert.deepEqual(nativeAudioTextAssetRequirements(mixed), [{ slot: audioReference.slot, mediaType: "audio/mpeg", label: "Audio hotspot 2" }]);
  for (const mutate of [
    (value) => { value.audioTextHotspots.hotspots[0].audioAssetSlot = null; },
    (value) => { delete value.audioTextHotspots.hotspots[0].audioAssetSlot; },
    (value) => { value.audioTextHotspots.hotspots[0].audioAssetSlot = "   "; },
    (value) => { value.audioTextHotspots.hotspots[0].audioAssetSlot = "missing-audio"; },
  ]) {
    const invalid = structuredClone(document); mutate(invalid);
    assert.throws(() => kind.normalizePublic(invalid), /audioAssetSlot|unknown fields/);
  }
});

test("existing explicit MP3-bearing Readable-Text hotspot identity remains unchanged", () => {
  const kind = resolveNativeActivityKind("open-response");
  const document = kind.createBlankPublic({ activityId: "open-audio", title: "Audio focus", placement: { pageId } });
  document.assets = [reference, audioReference]; document.readableText = readableText; document.audioTextHotspots = { hotspots: [{ ...audioHotspot, focusLayout: "natural-width" }] };
  assert.equal(builderDocumentSha256(kind.normalizePublic(document)), "959f16588051594b880f9f011cb77e902e1860e312eaa25ac378088d14c8d474");
});

test("panelized Open Response audio hotspots bind to the selected panel surface", () => {
  const kind = resolveNativeActivityKind("open-response");
  const document = kind.createBlankPublic({ activityId: "open-panel-audio", title: "Panel audio", placement: { pageId } });
  document.parts[0].interaction = promoteNativeOpenResponsePanels(document.parts[0].interaction);
  const secondPanel = { id: `panel-${"2".repeat(32)}`, surface: { width: 800, height: 500 }, images: [], questionIds: [] };
  document.parts[0].interaction.presentation.panels.push(secondPanel);
  document.assets = [reference, audioReference];
  document.readableText = readableText;
  document.audioTextHotspots = { hotspots: [{ ...audioHotspot, panelId: secondPanel.id }] };
  const normalized = kind.normalizePublic(document);
  assert.deepEqual(nativeAudioTextHotspotTargets(normalized), [
    { panelId: document.parts[0].interaction.presentation.panels[0].id, width: 1024, height: 582 },
    { panelId: secondPanel.id, width: 800, height: 500 },
  ]);
  assert.equal(normalized.audioTextHotspots.hotspots[0].panelId, secondPanel.id);
});

test("optional readable-focus inner rectangles preserve old shapes and validate independent highlights", () => {
  const kind = resolveNativeActivityKind("open-response");
  const document = kind.createBlankPublic({ activityId: "open-highlight", title: "Highlight", placement: { pageId } });
  document.assets = [reference, audioReference];
  document.readableText = readableText;
  document.audioTextHotspots = { hotspots: [audioHotspot] };
  const oldNormalized = kind.normalizePublic(document);
  assert.equal(Object.hasOwn(oldNormalized.audioTextHotspots.hotspots[0], "highlightColor"), false);
  assert.equal(Object.hasOwn(oldNormalized.audioTextHotspots.hotspots[0], "readableHighlightArea"), false);
  assert.deepEqual(nativeAudioTextReadableHighlightArea(oldNormalized.audioTextHotspots.hotspots[0]), { x: 128, y: 232, width: 644, height: 336 });
  const explicit = structuredClone(document);
  explicit.audioTextHotspots.hotspots[0].readableHighlightArea = { x: 150, y: 240, width: 420, height: 120 };
  assert.deepEqual(kind.normalizePublic(explicit).audioTextHotspots.hotspots[0].readableHighlightArea, explicit.audioTextHotspots.hotspots[0].readableHighlightArea);
  const deleted = structuredClone(document);
  deleted.audioTextHotspots.hotspots[0].readableHighlightArea = null;
  assert.equal(kind.normalizePublic(deleted).audioTextHotspots.hotspots[0].readableHighlightArea, null);
  assert.equal(nativeAudioTextReadableHighlightArea(deleted.audioTextHotspots.hotspots[0]), null);
  for (const highlightColor of NATIVE_AUDIO_TEXT_HIGHLIGHT_COLORS) {
    const colored = structuredClone(document);
    colored.audioTextHotspots.hotspots[0].highlightColor = highlightColor;
    assert.equal(kind.normalizePublic(colored).audioTextHotspots.hotspots[0].highlightColor, highlightColor);
  }
  const unsafe = structuredClone(document);
  unsafe.audioTextHotspots.hotspots[0].highlightColor = "url(javascript:unsafe)";
  assert.throws(() => kind.normalizePublic(unsafe), /highlightColor/);
  const outside = structuredClone(explicit);
  outside.audioTextHotspots.hotspots[0].readableHighlightArea.x = 50;
  assert.throws(() => kind.normalizePublic(outside), /must stay inside readableFocusArea/);
});

test("Audio / Readable-Text hotspots reject each incomplete or unsafe relationship", () => {
  const kind = resolveNativeActivityKind("open-response");
  const valid = kind.createBlankPublic({ activityId: "open-audio", title: "Audio focus", placement: { pageId } });
  valid.assets = [reference, audioReference];
  valid.readableText = readableText;
  valid.audioTextHotspots = { hotspots: [audioHotspot] };
  const mutations = [
    (value) => { delete value.readableText; },
    (value) => { value.audioTextHotspots.extra = true; },
    (value) => { value.audioTextHotspots.hotspots[0].privateAnswer = "secret"; },
    (value) => { value.audioTextHotspots.hotspots[0].audioAssetSlot = reference.slot; },
    (value) => { value.audioTextHotspots.hotspots[0].panelId = "missing-panel"; },
    (value) => { value.audioTextHotspots.hotspots[0].activityArea.width = 47; },
    (value) => { value.audioTextHotspots.hotspots[0].activityArea.x = 1000; },
    (value) => { value.audioTextHotspots.hotspots[0].readableFocusArea.height = 1800; },
    (value) => { value.audioTextHotspots.hotspots[0].label = "<unsafe>"; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    assert.throws(() => kind.normalizePublic(invalid));
  }
  const textChoiceKind = resolveNativeActivityKind("single-choice");
  const textChoice = textChoiceKind.createBlankPublic({ activityId: "choice-audio", title: "No stage", placement: { pageId } });
  textChoice.assets = [reference, audioReference]; textChoice.readableText = readableText; textChoice.audioTextHotspots = { hotspots: [audioHotspot] };
  assert.throws(() => textChoiceKind.normalizePublic(textChoice), /visual activity surface/);
});

test("managed Readable Text dimensions and activity ownership fail closed", async () => {
  const row = { id: reference.assetId, checksum_sha256: reference.checksumSha256, asset_role: reference.role, publication_status: "draft", access_level: "internal", storage_profile: "private", source_metadata: { native_activity_id: "open-readable", asset_slot: reference.slot }, width: 1000, height: 1800 };
  const sql = async () => [row];
  const input = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", activityId: "open-readable", assets: [reference], requirements: [{ slot: reference.slot, width: 1000, height: 1800, label: "Readable Text" }] };
  await assert.doesNotReject(() => validateBuilderNativeAssetReferences(sql, input));
  await assert.rejects(() => validateBuilderNativeAssetReferences(async () => [{ ...row, width: 999 }], input), /Readable Text dimensions/);
  await assert.rejects(() => validateBuilderNativeAssetReferences(async () => [{ ...row, source_metadata: { ...row.source_metadata, native_activity_id: "other" } }], input), /not owned/);
});

test("managed hotspot audio requires audio/mpeg and no image dimensions", async () => {
  const row = { id: audioReference.assetId, checksum_sha256: audioReference.checksumSha256, asset_role: audioReference.role, publication_status: "draft", access_level: "internal", storage_profile: "private", source_metadata: { native_activity_id: "open-audio", asset_slot: audioReference.slot }, mime_type: "audio/mpeg", width: null, height: null };
  const input = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", activityId: "open-audio", assets: [audioReference], requirements: nativeAudioTextAssetRequirements({ audioTextHotspots: { hotspots: [audioHotspot] } }) };
  await assert.doesNotReject(() => validateBuilderNativeAssetReferences(async () => [row], input));
  await assert.rejects(() => validateBuilderNativeAssetReferences(async () => [{ ...row, mime_type: "image/png" }], input), /media type/);
});

test("managed reference cleanup retains a slot until every activity use is removed", () => {
  const document = {
    assets: [reference],
    readableText,
    parts: [{ interaction: { images: [{ assetSlot: reference.slot }] } }],
  };
  removeNativeManagedAssetReferenceIfUnused(document, reference.slot);
  assert.deepEqual(document.assets, [reference]);
  delete document.readableText;
  removeNativeManagedAssetReferenceIfUnused(document, reference.slot);
  assert.deepEqual(document.assets, [reference]);
  document.parts[0].interaction.images = [];
  removeNativeManagedAssetReferenceIfUnused(document, reference.slot);
  assert.deepEqual(document.assets, []);

  const audioDocument = { assets: [audioReference], parts: [{ interaction: {} }], audioTextHotspots: { hotspots: [{ ...audioHotspot }, { ...audioHotspot, id: `aud-${"4".repeat(32)}` }] } };
  audioDocument.audioTextHotspots.hotspots[0].audioAssetSlot = "";
  removeNativeManagedAssetReferenceIfUnused(audioDocument, audioReference.slot);
  assert.deepEqual(audioDocument.assets, [audioReference], "shared audio remains while another hotspot uses it");
  audioDocument.audioTextHotspots.hotspots[1].audioAssetSlot = "";
  removeNativeManagedAssetReferenceIfUnused(audioDocument, audioReference.slot);
  assert.deepEqual(audioDocument.assets, [], "the managed reference is removed after the last hotspot detaches it");
});

test("shared Builder and Teacher runtime wire all native kinds without duplicating private data or toolbars", async () => {
  const files = await Promise.all([
    "NativeOpenResponseEditor.jsx", "NativeImageEditor.jsx", "NativeSingleChoiceEditor.jsx", "NativeCompleteSentencesEditor.jsx", "NativeListeningEditor.jsx",
  ].map((name) => readFile(new URL(`../src/apps/book-builder/hosted/${name}`, import.meta.url), "utf8")));
  files.forEach((source) => { assert.match(source, /<NativeReadableTextEditor/); assert.match(source, /<NativeVideoEditor/); });
  const shared = await readFile(new URL("../src/apps/book-builder/hosted/NativeReadableTextEditor.jsx", import.meta.url), "utf8");
  assert.match(shared, /uploadNativeActivityAsset/); assert.match(shared, /Upload a readable-text image/); assert.doesNotMatch(shared, /teacherDocument|correctAnswer|modelAnswer/);
  assert.match(shared, /<NativeAudioTextHotspotEditor/);
  const hotspotEditor = await readFile(new URL("../src/apps/book-builder/hosted/NativeAudioTextHotspotEditor.jsx", import.meta.url), "utf8");
  assert.match(hotspotEditor, /accept="audio\/mpeg,.mp3"/); assert.match(hotspotEditor, /Test hotspot/); assert.doesNotMatch(hotspotEditor, /teacherDocument|correctAnswer|modelAnswer/);
  assert.match(hotspotEditor, /<StageSelectionFrame/); assert.match(hotspotEditor, /label="Outer readable text focus"/); assert.match(hotspotEditor, /label="Inner colored highlight"/); assert.match(hotspotEditor, /Delete inner highlight/); assert.match(hotspotEditor, /Highlight color/);
  assert.match(hotspotEditor, /Keep aspect ratio/); assert.match(hotspotEditor, /OUTER_FOCUS_ASPECT_RATIO = NATIVE_AUDIO_TEXT_FIXED_FOCUS_ASPECT_RATIO/); assert.match(hotspotEditor, /onFocusLayout\(checked \? "fixed-aspect" : "natural-width"\)/); assert.match(hotspotEditor, /aspectRatio=\{keepAspectRatio \? OUTER_FOCUS_ASPECT_RATIO : null\}/); assert.match(hotspotEditor, /<StageGeometryControls/);
  assert.match(hotspotEditor, /No MP3 attached \(optional\)/); assert.match(hotspotEditor, /Remove MP3/); assert.match(hotspotEditor, /audioAssetSlot = ""/); assert.match(hotspotEditor, /Open readable excerpt/);
  assert.doesNotMatch(hotspotEditor.match(/label="Inner colored highlight"[^\n]+/)?.[0] || "", /aspectRatio|preserveAspectRatio/);
  assert.match(hotspotEditor, /NATIVE_AUDIO_TEXT_HIGHLIGHT_COLORS\.map/); assert.match(hotspotEditor, /data-studio-stage/);
  const pages = await readFile(new URL("../src/apps/android-teacher-offline/TeacherOfflinePages.jsx", import.meta.url), "utf8");
  assert.match(pages, /nativeVideoAvailable/); assert.match(pages, /nativeVideoAvailable \? sendActivityCommand\("toggle-video"\)/); assert.match(pages, /activeIconName: "showTextPressed"/);
});

test("shared hotspot artwork embeds the exact canonical repository cue bytes without importing the Teacher-only asset tree", async () => {
  for (const state of ["active", "pressed"]) {
    const [sharedSvg, canonicalPng] = await Promise.all([
      readFile(new URL(`../src/assets/native-activities/audio-text-hotspot-${state}.svg`, import.meta.url), "utf8"),
      readFile(new URL(`../src/assets/books/ultimate-b2/legacy-classroom-ui/icons/media/activity-audio/ab-button-${state}.png`, import.meta.url)),
    ]);
    const embedded = sharedSvg.match(/base64,([^"']+)/)?.[1];
    assert.ok(embedded);
    assert.deepEqual(Buffer.from(embedded, "base64"), canonicalPng);
  }
  const runtime = await readFile(new URL("../src/components/native-readable-text/NativeAudioTextHotspots.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(runtime, /legacyClassroomAssets|legacy-classroom-ui/);
});

test("runtime uses page artwork and renders readable focus without requesting optional audio", async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { NativeAudioTextFocusContent, NativeAudioTextHotspotButtons, nativeAudioTextHotspotArtwork } = await vite.ssrLoadModule("/src/components/native-readable-text/NativeAudioTextHotspots.jsx");
    const noAudioHotspot = { ...audioHotspot, audioAssetSlot: "", label: "Open readable excerpt" };
    const presentation = { hotspots: [noAudioHotspot], activeHotspotId: null, onToggle() {} };
    const normalButton = renderToStaticMarkup(React.createElement(NativeAudioTextHotspotButtons, { surface: { width: 1024, height: 582 }, presentation }));
    const pressedButton = renderToStaticMarkup(React.createElement(NativeAudioTextHotspotButtons, { surface: { width: 1024, height: 582 }, presentation: { ...presentation, activeHotspotId: noAudioHotspot.id } }));
    const readableArtwork = nativeAudioTextHotspotArtwork(noAudioHotspot);
    const audioArtwork = nativeAudioTextHotspotArtwork(audioHotspot);
    assert.ok(readableArtwork.active.startsWith("data:image/svg+xml"));
    assert.ok(readableArtwork.pressed.startsWith("data:image/svg+xml"));
    assert.notEqual(readableArtwork.active, audioArtwork.active);
    assert.notEqual(readableArtwork.pressed, audioArtwork.pressed);
    assert.ok(normalButton.includes(readableArtwork.active.replaceAll("'", "&#x27;")));
    assert.ok(pressedButton.includes(readableArtwork.pressed.replaceAll("'", "&#x27;")));

    const requested = [];
    const noAudioDocument = { readableText, assets: [reference] };
    const focus = renderToStaticMarkup(React.createElement(NativeAudioTextFocusContent, { document: noAudioDocument, hotspot: noAudioHotspot, assetUrl: (assetId) => { requested.push(assetId); return `/asset/${assetId}`; }, autoPlay: true }));
    assert.match(focus, /native-audio-text-focus-crop/);
    assert.match(focus, /native-audio-text-focus-highlight/);
    assert.doesNotMatch(focus, /<audio|preload="metadata"/);
    assert.deepEqual(requested, [reference.assetId]);

    const audioDocument = { readableText, assets: [reference, audioReference] };
    const audioButtons = renderToStaticMarkup(React.createElement(NativeAudioTextHotspotButtons, { surface: { width: 1024, height: 582 }, presentation: { hotspots: [audioHotspot], activeHotspotId: audioHotspot.id, onToggle() {} } }));
    const audioFocus = renderToStaticMarkup(React.createElement(NativeAudioTextFocusContent, { document: audioDocument, hotspot: audioHotspot, assetUrl: (assetId) => `/asset/${assetId}`, autoPlay: true }));
    assert.ok(audioButtons.includes(audioArtwork.pressed.replaceAll("'", "&#x27;")));
    assert.match(audioFocus, /<audio[^>]+preload="metadata"[^>]+audio-one|<audio[^>]+preload="metadata"/);
  } finally { await vite.close(); }
});

test("native Readable Text presentation toggles only when available and uses bounded internal scrolling", async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { nextNativeReadableTextView, nextNativeSupplementaryView, normalizeNativeChildPresentationState } = await vite.ssrLoadModule("/src/components/native-readable-text/NativeReadableTextPresentation.jsx");
    assert.equal(nextNativeReadableTextView("questions", "toggle-text", true), "text");
    assert.equal(nextNativeReadableTextView("text", "toggle-text", true), "questions");
    assert.equal(nextNativeReadableTextView("questions", "toggle-text", false), "questions");
    assert.equal(nextNativeReadableTextView("questions", "next-panel", true), "questions");
    assert.equal(nextNativeReadableTextView("text", "show-next", true), "questions");
    assert.equal(nextNativeReadableTextView("text", "show-all", true), "questions");
    assert.equal(nextNativeReadableTextView("text", "reset-activity", true), "questions");
    assert.equal(nextNativeSupplementaryView("questions", "toggle-video", { readableText: true, video: true }), "video");
    assert.equal(nextNativeSupplementaryView("text", "toggle-video", { readableText: true, video: true }), "video");
    assert.equal(nextNativeSupplementaryView("video", "toggle-text", { readableText: true, video: true }), "text");
    assert.equal(nextNativeSupplementaryView("video", "toggle-video", { readableText: true, video: true }), "questions");
    assert.equal(nextNativeSupplementaryView("questions", "toggle-video", { readableText: true, video: false }), "questions");
    assert.deepEqual(normalizeNativeChildPresentationState({
      panelIndex: 7,
      panelCount: 2,
      reveal: { supported: true, total: 2, revealed: 9, pristine: false, correctOptionIds: ["private"] },
      modelAnswers: ["private"],
      panelNavigationActive: true,
    }), { panelIndex: 1, panelCount: 2, panelNavigationActive: true, reveal: { supported: true, total: 2, revealed: 2, pristine: false } });
  } finally { await vite.close(); }
  const [component, viewport, focus, css] = await Promise.all([
    readFile(new URL("../src/components/native-readable-text/NativeReadableTextPresentation.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/native-readable-text/NativeVerticalScrollViewport.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/native-readable-text/NativeAudioTextHotspots.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/native-readable-text/nativeReadableText.css", import.meta.url), "utf8"),
  ]);
  assert.match(component, /hidden=\{effectiveView === "text" \|\| effectiveView === "video"\}/); assert.match(css, /\.native-readable-text-activity-view\[hidden\]\s*\{\s*display:\s*none\s*!important/); assert.match(viewport, /scrollHeight > viewport\.clientHeight/); assert.match(viewport, /role="scrollbar"/);
  assert.match(viewport, /aria-valuenow/); assert.match(viewport, /ArrowUp/); assert.match(viewport, /PageDown/); assert.match(viewport, /setPointerCapture/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(focus, /<audio ref=\{audioRef\} hidden autoPlay=\{autoPlay\}/);
  assert.match(focus, /const audio = audioRef\.current/);
  assert.match(focus, /audio\.pause\(\); audio\.currentTime = 0/);
  assert.match(focus, /data-highlight-color=\{nativeAudioTextHighlightColor\(hotspot\.highlightColor\)\}/);
  assert.match(focus, /style=\{\{ aspectRatio: `\$\{focus\.width\} \/ \$\{focus\.height\}` \}\}/);
  assert.doesNotMatch(focus, /preserveAspectRatio="none"/);
  assert.doesNotMatch(focus, /<header|<strong|>Close<|\bcontrols\b/);
  assert.match(css, /overflow: auto/); assert.match(css, /overscroll-behavior: contain/); assert.match(css, /scrollbar-width: none/); assert.match(css, /::-webkit-scrollbar/); assert.match(css, /width: 100%; height: auto/);
  assert.match(css, /native-readable-text-scroll-control/); assert.match(css, /native-readable-text-scroll-thumb/);
  assert.match(css, /\.native-audio-text-focus\s*\{[^}]*display: grid;[^}]*width: 100%;[^}]*height: 100%;[^}]*overflow: hidden/);
  assert.match(css, /\.native-readable-text-presentation\[data-audio-focus\][^}]*aspect-ratio: 1024 \/ 582;[^}]*grid-template-rows: minmax\(0, 1fr\) minmax\(0, 1fr\);[^}]*gap: 0/);
  assert.match(css, /\.native-audio-text-focus-crop[^}]*width: 100%;[^}]*height: 100%/);
  assert.doesNotMatch(css, /native-audio-text-focus header|native-audio-text-focus audio/);
  assert.match(css, /\.native-readable-text-view[^}]*min-height: 0;[^}]*max-height: none/);
  assert.doesNotMatch(css, /max-height: min\(76vh, 760px\)/);
  assert.match(focus, /nativeAudioTextReadableHighlightArea\(hotspot\)/);
  assert.match(focus, /native-audio-text-focus-highlight/);
  assert.match(css, /native-audio-text-focus-highlight[^}]*22%/);
  assert.doesNotMatch(css, /native-audio-text-focus-crop::after/);
});
