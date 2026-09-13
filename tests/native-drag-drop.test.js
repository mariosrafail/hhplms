import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertPublicBuilderDocument, builderDocumentSha256 } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { compileUltimateB2ComponentReleaseV2 } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { nativeChildIdFromUuid } from "../src/data/native-activities/nativeChildIdentity.js";
import { normalizeNativeActivityPublic, nativeActivityUsesManagedAssetSlot, removeNativeManagedAssetReferenceIfUnused } from "../src/data/native-activities/nativeActivityPublic.js";
import {
  assessNativeDragDropReadiness,
  NATIVE_DRAG_DROP_DEFAULT_PRESENTATION,
  nativeDragDropAssetRequirements,
  nativeDragDropMappingWordIds,
  nativeDragDropShortLabel,
  normalizeNativeDragDropInteraction,
  normalizeNativeDragDropResponses,
  placeNativeDragDropWord,
  reassignNativeDragDropMapping,
  removeNativeDragDropImage,
  removeNativeDragDropPanel,
  removeNativeDragDropResponse,
  removeNativeDragDropWord,
  shuffleNativeDragDropWordIds,
  updateNativeDragDropRevealState,
  visibleNativeDragDropWordIds,
} from "../src/data/native-activities/nativeDragDrop.js";
import { createPublicationV2FixtureSources, publicationV2Fixture } from "./fixtures/publication-v2.js";

const id = (prefix, suffix) => nativeChildIdFromUuid(prefix, `20000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`);
const activityId = "ultimate-b2-sb-u1-p1-o95";
const wordIds = [id("word", 1), id("word", 2), id("word", 3)];
const panelIds = [id("panel", 11), id("panel", 12)];
const imageIds = [id("img", 21), id("img", 22), id("img", 23)];
const targetIds = [id("target", 31), id("target", 32)];
const assets = [
  { assetId: "20000000-0000-4000-8000-000000000041", checksumSha256: "b".repeat(64), role: "activity_artwork", slot: "drag-panel-shared" },
  { assetId: "20000000-0000-4000-8000-000000000042", checksumSha256: "c".repeat(64), role: "activity_artwork", slot: "drag-panel-overlay" },
];
const fontAsset = { assetId: "20000000-0000-4000-8000-000000000043", checksumSha256: "d".repeat(64), role: "activity_font", slot: "font-20000000000040008000000000000043" };

function pair() {
  const kind = resolveNativeActivityKind("drag-drop");
  const publicDocument = kind.createBlankPublic({ activityId, title: "Drag the words", placement: { pageId: publicationV2Fixture.pageId } });
  const teacherDocument = kind.createBlankTeacher({ activityId });
  publicDocument.assets = structuredClone(assets);
  publicDocument.parts[0].interaction.words = [
    { id: wordIds[0], text: "repeated" },
    { id: wordIds[1], text: "repeated" },
    { id: wordIds[2], text: "distractor" },
  ];
  publicDocument.parts[0].interaction.panels = [
    {
      id: panelIds[0], surface: { width: 1000, height: 600 },
      images: [
        { id: imageIds[0], assetSlot: assets[0].slot, area: { x: 0, y: 0, width: 1000, height: 600 }, order: 0, altText: "First scene", decorative: false, fit: "cover", locked: true },
        { id: imageIds[1], assetSlot: assets[1].slot, area: { x: 100, y: 80, width: 300, height: 200 }, order: 1, altText: "Overlay", decorative: false, fit: "contain", locked: false },
      ],
      dropTargets: [{ id: targetIds[0], area: { x: 80, y: 420, width: 220, height: 80 }, accessibleLabel: "First sentence blank" }],
    },
    {
      id: panelIds[1], surface: { width: 1000, height: 600 },
      images: [{ id: imageIds[2], assetSlot: assets[0].slot, area: { x: 0, y: 0, width: 1000, height: 600 }, order: 0, altText: "Second scene", decorative: false, fit: "contain", locked: false }],
      dropTargets: [{ id: targetIds[1], area: { x: 600, y: 350, width: 250, height: 90 }, accessibleLabel: "Second sentence blank" }],
    },
  ];
  teacherDocument.parts[0].solution.mappings = [{ targetId: targetIds[0], wordId: wordIds[1] }, { targetId: targetIds[1], wordId: wordIds[0] }];
  return { kind, publicDocument, teacherDocument };
}

test("mixed image and text items retain stable responses, reusable mappings and managed image liveness", () => {
  const current = pair();
  const itemAsset = { assetId: "20000000-0000-4000-8000-000000000044", checksumSha256: "e".repeat(64), role: "activity_artwork", slot: "tick-image" };
  current.publicDocument.assets.push(itemAsset);
  const word = current.publicDocument.parts[0].interaction.words[0];
  word.text = "Tick"; word.reusable = true;
  word.image = { assetSlot: itemAsset.slot, sourceWidth: 48, sourceHeight: 64, displayWidth: 48, displayHeight: 64 };
  const normalized = current.kind.normalizePublic(current.publicDocument);
  assert.deepEqual(normalized.parts[0].interaction.words[0].image, word.image);
  assert.equal(Object.hasOwn(normalized.parts[0].interaction.words[1], "image"), false);
  const placed = placeNativeDragDropWord({}, targetIds[0], word.id, { reusable: true });
  const repeated = placeNativeDragDropWord(placed, targetIds[1], word.id, { reusable: true });
  assert.deepEqual(normalizeNativeDragDropResponses(repeated, normalized), repeated);
  assert.ok(visibleNativeDragDropWordIds(wordIds, repeated, null, normalized.parts[0].interaction.words).includes(word.id));
  assert.equal(nativeActivityUsesManagedAssetSlot(normalized, itemAsset.slot), true);
  assert.ok(nativeDragDropAssetRequirements(normalized).some((requirement) => requirement.slot === itemAsset.slot && requirement.width === 48 && requirement.height === 64));
  const beforeId = word.id;
  word.image.sourceWidth = 96;
  assert.equal(current.kind.normalizePublic(current.publicDocument).parts[0].interaction.words[0].id, beforeId);
  removeNativeDragDropWord(current.publicDocument, current.teacherDocument, word.id);
  assert.equal(current.publicDocument.assets.some((asset) => asset.slot === itemAsset.slot), false);
});

test("image item descriptors reject URLs, private fields, unsupported assets and unbounded sizing", () => {
  const current = pair();
  const word = current.publicDocument.parts[0].interaction.words[0];
  const valid = { assetSlot: assets[0].slot, sourceWidth: 1000, sourceHeight: 600, displayWidth: 64, displayHeight: 64 };
  for (const invalid of [{ ...valid, url: "https://example.com/tick.svg" }, { ...valid, assetSlot: "missing" }, { ...valid, sourceWidth: 8193 }, { ...valid, displayWidth: 0 }, { ...valid, displayHeight: 257 }, { ...valid, correct: true }, null]) {
    word.image = invalid;
    assert.throws(() => current.kind.normalizePublic(current.publicDocument));
  }
  word.image = valid; word.text = "";
  assert.throws(() => current.kind.normalizePublic(current.publicDocument), /text/);
});

test("Drag & Drop blank pair and complete pair normalize strictly with Teacher-only mappings", () => {
  const kind = resolveNativeActivityKind("drag-drop");
  const blankPublic = kind.createBlankPublic({ activityId, title: "Blank", placement: { pageId: publicationV2Fixture.pageId } });
  const blankTeacher = kind.createBlankTeacher({ activityId });
  assert.equal(kind.validatePair(blankPublic, blankTeacher), true);
  assert.deepEqual(blankPublic.parts[0].interaction.presentation, NATIVE_DRAG_DROP_DEFAULT_PRESENTATION);
  assert.deepEqual(kind.assessReadiness(blankPublic, blankTeacher), { ready: false, issues: ["Add at least one draggable word.", "Add at least one visual panel."] });

  const current = pair();
  const publicDocument = current.kind.normalizePublic(current.publicDocument, activityId);
  const teacherDocument = current.kind.normalizeTeacher(current.teacherDocument, activityId);
  assert.equal(current.kind.validatePair(publicDocument, teacherDocument), true);
  assert.deepEqual(assessNativeDragDropReadiness(publicDocument, teacherDocument), { ready: true, issues: [] });
  assert.doesNotThrow(() => assertPublicBuilderDocument(publicDocument));
  assert.doesNotMatch(JSON.stringify(publicDocument), /mappings|correctWordId|answerKey|solution|isCorrect/i);
  assert.match(JSON.stringify(teacherDocument), /mappings/);
  assert.equal(publicDocument.parts[0].interaction.words[0].text, publicDocument.parts[0].interaction.words[1].text, "duplicate visible text is legal for distinct instances");
  assert.equal(teacherDocument.parts[0].solution.mappings.some((mapping) => mapping.wordId === wordIds[2]), false, "extra bank words are legal distractors");

  const legacy = pair(); delete legacy.publicDocument.parts[0].interaction.presentation;
  assert.deepEqual(legacy.kind.normalizePublic(legacy.publicDocument).parts[0].interaction.presentation, NATIVE_DRAG_DROP_DEFAULT_PRESENTATION, "legacy documents receive deterministic shared typography defaults");
});

test("Drag & Drop accepts four bank words for three fully mapped targets and leaves one distractor unused", () => {
  const current = pair();
  const distractorId = id("word", 4);
  const thirdTargetId = id("target", 33);
  current.publicDocument.parts[0].interaction.words.push({ id: distractorId, text: "extra distractor" });
  current.publicDocument.parts[0].interaction.panels[1].dropTargets.push({
    id: thirdTargetId,
    area: { x: 320, y: 120, width: 250, height: 90 },
    accessibleLabel: "Third sentence blank",
  });
  current.teacherDocument.parts[0].solution.mappings.push({ targetId: thirdTargetId, wordId: wordIds[2] });

  assert.equal(current.kind.validatePair(current.publicDocument, current.teacherDocument), true);
  const normalizedPublic = current.kind.normalizePublic(current.publicDocument);
  const normalizedTeacher = current.kind.normalizeTeacher(current.teacherDocument);
  assert.deepEqual(assessNativeDragDropReadiness(normalizedPublic, normalizedTeacher), { ready: true, issues: [] });
  const answers = new Map(current.teacherDocument.parts[0].solution.mappings.map((mapping) => [mapping.targetId, nativeDragDropMappingWordIds(mapping)]));
  assert.equal(answers.size, 3);
  assert.equal([...answers.values()].flat().includes(distractorId), false);
  assert.equal(answers.get(thirdTargetId).includes(wordIds[2]), true, "Teacher scoring still resolves the third target by stable ID");
});

test("shared bank and placed-answer typography normalize independently and close managed font requirements", () => {
  const current = pair();
  const font = fontAsset;
  current.publicDocument.assets.push(font);
  current.publicDocument.parts[0].interaction.presentation = {
    bankWordStyle: { fontFamily: "Georgia", fontSize: 17, color: "#123ABC", fontAssetSlot: font.slot },
    placedAnswerStyle: { fontFamily: "Verdana", fontSize: 23, color: "#654321", fontAssetSlot: font.slot },
  };
  const normalized = current.kind.normalizePublic(current.publicDocument);
  assert.deepEqual(normalized.parts[0].interaction.presentation, {
    bankWordStyle: { fontFamily: "Georgia", fontSize: 17, color: "#123abc", fontAssetSlot: font.slot },
    placedAnswerStyle: { fontFamily: "Verdana", fontSize: 23, color: "#654321", fontAssetSlot: font.slot },
  });
  assert.deepEqual(nativeDragDropAssetRequirements(normalized).map((entry) => [entry.slot, entry.mediaType || null]), [[assets[0].slot, null], [assets[1].slot, null], [font.slot, "font/ttf"]]);
  assert.equal(nativeActivityUsesManagedAssetSlot(normalized, font.slot), true);
  normalized.parts[0].interaction.presentation.bankWordStyle.fontAssetSlot = null;
  removeNativeManagedAssetReferenceIfUnused(normalized, font.slot);
  assert.equal(normalized.assets.some((asset) => asset.slot === font.slot), true, "a font shared by both text styles remains attached while either style uses it");
  normalized.parts[0].interaction.presentation.placedAnswerStyle.fontAssetSlot = null;
  removeNativeManagedAssetReferenceIfUnused(normalized, font.slot);
  assert.equal(normalized.assets.some((asset) => asset.slot === font.slot), false);
  assert.doesNotMatch(JSON.stringify(normalized), /mappings|solution/);

  const invalid = structuredClone(current.publicDocument); invalid.parts[0].interaction.presentation.bankWordStyle.fontAssetSlot = "missing-font";
  assert.throws(() => current.kind.normalizePublic(invalid), /authorized font/);
});

test("public word and target ordering cannot encode the private stable-ID answer", () => {
  const current = pair();
  current.publicDocument.parts[0].interaction.words.reverse();
  current.publicDocument.parts[0].interaction.panels.reverse();
  current.publicDocument.parts[0].interaction.panels.forEach((panel) => panel.dropTargets.reverse());
  assert.equal(current.kind.validatePair(current.publicDocument, current.teacherDocument), true);
  assert.deepEqual(new Map(current.teacherDocument.parts[0].solution.mappings.map((mapping) => [mapping.targetId, mapping.wordId])), new Map([[targetIds[0], wordIds[1]], [targetIds[1], wordIds[0]]]));
});

test("Drag & Drop rejects unknown fields, invalid geometry, duplicate identities, and invalid mapping topology", () => {
  const extra = pair(); extra.publicDocument.parts[0].interaction.answerKey = [];
  assert.throws(() => extra.kind.normalizePublic(extra.publicDocument), /unknown fields/);
  const outside = pair(); outside.publicDocument.parts[0].interaction.panels[0].dropTargets[0].area.x = 900;
  assert.throws(() => outside.kind.normalizePublic(outside.publicDocument), /inside/);
  const duplicate = pair(); duplicate.publicDocument.parts[0].interaction.panels[1].dropTargets[0].id = targetIds[0];
  assert.throws(() => duplicate.kind.normalizePublic(duplicate.publicDocument), /duplicate/);
  const dangling = pair(); dangling.teacherDocument.parts[0].solution.mappings[0].wordId = id("word", 999);
  assert.throws(() => dangling.kind.validatePair(dangling.publicDocument, dangling.teacherDocument), /private stable-ID mapping/);
  const reused = pair(); reused.teacherDocument.parts[0].solution.mappings[1].wordId = reused.teacherDocument.parts[0].solution.mappings[0].wordId;
  assert.throws(() => reused.kind.validatePair(reused.publicDocument, reused.teacherDocument), /only reusable items/);
  const missing = pair(); missing.teacherDocument.parts[0].solution.mappings.pop();
  assert.throws(() => missing.kind.validatePair(missing.publicDocument, missing.teacherDocument), /one private/);
});

test("managed image requirements close every layer once and canonical removals retain shared assets", () => {
  const current = pair();
  assert.deepEqual(nativeDragDropAssetRequirements(current.publicDocument).map((entry) => entry.slot), [assets[0].slot, assets[1].slot]);
  removeNativeDragDropImage(current.publicDocument, panelIds[0], imageIds[1]);
  assert.deepEqual(current.publicDocument.assets.map((asset) => asset.slot), [assets[0].slot]);
  removeNativeDragDropPanel(current.publicDocument, current.teacherDocument, panelIds[0]);
  assert.deepEqual(current.publicDocument.assets.map((asset) => asset.slot), [assets[0].slot], "shared panel artwork remains referenced");
  assert.deepEqual(current.teacherDocument.parts[0].solution.mappings, [{ targetId: targetIds[1], wordId: wordIds[0] }]);
  removeNativeDragDropWord(current.publicDocument, current.teacherDocument, wordIds[0]);
  assert.deepEqual(current.teacherDocument.parts[0].solution.mappings, []);
});

test("controlled response helpers place, move, displace, remove, and sanitize one word instance", () => {
  const current = pair();
  assert.deepEqual(normalizeNativeDragDropResponses({ [targetIds[0]]: wordIds[0], [targetIds[1]]: wordIds[0], unknown: wordIds[2] }, current.publicDocument), { [targetIds[0]]: [wordIds[0]] });
  let responses = placeNativeDragDropWord({}, targetIds[0], wordIds[0]);
  responses = placeNativeDragDropWord(responses, targetIds[1], wordIds[0]);
  assert.deepEqual(responses, { [targetIds[1]]: [wordIds[0]] }, "moving a word clears its old target");
  responses = placeNativeDragDropWord(responses, targetIds[1], wordIds[1]);
  assert.deepEqual(responses, { [targetIds[1]]: [wordIds[1]] }, "placing into an occupied target displaces its old word");
  assert.deepEqual(removeNativeDragDropResponse(responses, targetIds[1]), {});
});

test("session word order shuffles immutably and consumed words return to the same position", () => {
  const words = pair().publicDocument.parts[0].interaction.words;
  const original = structuredClone(words);
  const samples = [.8, .1];
  const order = shuffleNativeDragDropWordIds(words, () => samples.shift());
  assert.deepEqual(order, [wordIds[1], wordIds[0], wordIds[2]]);
  assert.deepEqual(words, original, "presentation shuffling never mutates serialized words");
  const responses = { [targetIds[0]]: wordIds[0] };
  assert.deepEqual(visibleNativeDragDropWordIds(order, responses), [wordIds[1], wordIds[2]]);
  assert.deepEqual(visibleNativeDragDropWordIds(order, {}), order, "removing a response restores the session position");
  const overrides = new Map([[targetIds[1], words.find((word) => word.id === wordIds[2])]]);
  assert.deepEqual(visibleNativeDragDropWordIds(order, {}, overrides), [wordIds[1], wordIds[0]]);
});

test("stable-ID mapping reassignment supports exact arrays and only permits reusable cross-target use", () => {
  const current = pair().teacherDocument.parts[0].solution.mappings;
  assert.throws(() => reassignNativeDragDropMapping(current, targetIds[0], [wordIds[0]]), /Only reusable/);
  const reused = reassignNativeDragDropMapping(current, targetIds[0], [wordIds[0]], { reusableWordIds: new Set([wordIds[0]]) });
  assert.deepEqual(reused, [{ targetId: targetIds[1], wordIds: [wordIds[0]] }, { targetId: targetIds[0], wordIds: [wordIds[0]] }]);
  assert.deepEqual(current, [{ targetId: targetIds[0], wordId: wordIds[1] }, { targetId: targetIds[1], wordId: wordIds[0] }], "the private draft input remains immutable");
});

test("multi-answer, reusable, text layout, stable labels, heights, and legacy shapes normalize compatibly", () => {
  const current = pair();
  const interaction = current.publicDocument.parts[0].interaction;
  interaction.layoutMode = "standard"; interaction.answerBankHeightPx = 164; interaction.textPanelHeightPx = 420;
  interaction.words[0].reusable = true; interaction.words[0].shortLabel = "A";
  interaction.words[1].reusable = false; interaction.words[1].shortLabel = "B";
  interaction.words[2].reusable = false; interaction.words[2].shortLabel = "AA";
  interaction.panels[0].dropTargets[0].capacity = 2;
  interaction.panels[1].dropTargets[0].capacity = 1;
  current.teacherDocument.parts[0].solution.mappings = [
    { targetId: targetIds[0], wordIds: [wordIds[0], wordIds[1]] },
    { targetId: targetIds[1], wordIds: [wordIds[0]] },
  ];
  const normalizedPublic = current.kind.normalizePublic(current.publicDocument);
  const normalizedTeacher = current.kind.normalizeTeacher(current.teacherDocument);
  assert.equal(current.kind.validatePair(normalizedPublic, normalizedTeacher), true);
  assert.deepEqual(normalizedTeacher.parts[0].solution.mappings[0].wordIds, [wordIds[0], wordIds[1]]);
  assert.deepEqual(normalizeNativeDragDropResponses({ [targetIds[0]]: [wordIds[1], wordIds[0]], [targetIds[1]]: wordIds[0] }, normalizedPublic), { [targetIds[0]]: [wordIds[1], wordIds[0]], [targetIds[1]]: [wordIds[0]] });
  let placed = placeNativeDragDropWord({}, targetIds[0], wordIds[0], { capacity: 2, reusable: true });
  placed = placeNativeDragDropWord(placed, targetIds[1], wordIds[0], { capacity: 1, reusable: true });
  assert.deepEqual(placed, { [targetIds[0]]: [wordIds[0]], [targetIds[1]]: [wordIds[0]] });
  assert.deepEqual(visibleNativeDragDropWordIds(wordIds, placed, null, normalizedPublic.parts[0].interaction.words), wordIds);
  assert.equal(nativeDragDropShortLabel(25), "Z"); assert.equal(nativeDragDropShortLabel(26), "AA");
  assert.deepEqual(nativeDragDropMappingWordIds({ wordId: wordIds[0] }), [wordIds[0]]);
  const text = structuredClone(normalizedPublic); text.parts[0].interaction.layoutMode = "text"; text.parts[0].interaction.words[0].reusable = true;
  assert.equal(current.kind.validatePair(text, normalizedTeacher), true);
  const textPublic = current.kind.normalizePublic(text);
  assert.deepEqual(normalizeNativeDragDropResponses(placed, textPublic), placed);
  const removed = removeNativeDragDropResponse(placed, targetIds[0], wordIds[0]);
  assert.deepEqual(removed, { [targetIds[1]]: [wordIds[0]] });
  assert.deepEqual(visibleNativeDragDropWordIds(wordIds, removed, null, textPublic.parts[0].interaction.words), wordIds);
  text.parts[0].interaction.words[0].reusable = false;
  assert.throws(() => current.kind.validatePair(text, normalizedTeacher), /only reusable/);
  text.parts[0].interaction.words[0].reusable = "true";
  assert.throws(() => current.kind.normalizePublic(text), /must be a boolean/);
});

test("Teacher reveal state supports individual, next, all, reset, and idempotent actions", () => {
  let revealed = updateNativeDragDropRevealState(new Set(), targetIds, { targetId: targetIds[1] });
  assert.deepEqual([...revealed], [targetIds[1]]);
  assert.equal(updateNativeDragDropRevealState(revealed, targetIds, { targetId: targetIds[1] }), revealed);
  revealed = updateNativeDragDropRevealState(revealed, targetIds, "show-next");
  assert.deepEqual(new Set(revealed), new Set(targetIds));
  assert.equal(updateNativeDragDropRevealState(revealed, targetIds, "show-all"), revealed);
  assert.deepEqual([...updateNativeDragDropRevealState(revealed, targetIds, "reset-activity")], []);
});

function source(payload, revision = 1) { return { payload, revision, sha256: builderDocumentSha256(payload) }; }

for (const layoutMode of ["standard", "text"]) test(`publication v2 separates ${layoutMode} reusable mappings and closes every Drag & Drop image asset`, () => {
  const current = pair(); const sources = createPublicationV2FixtureSources();
  current.publicDocument.parts[0].interaction.layoutMode = layoutMode;
  current.publicDocument.parts[0].interaction.randomize = false;
  current.publicDocument.readableText = { kind: "image", assetSlot: assets[0].slot, sourceWidth: 1000, sourceHeight: 600, altText: "Readable passage" };
  current.publicDocument.audioTextHotspots = { hotspots: [{ id: id("aud", 90), panelId: panelIds[0], activityArea: { x: 20, y: 30, width: 48, height: 48 }, readableFocusArea: { x: 0, y: 0, width: 1000, height: 291 }, audioAssetSlot: "", label: "Read the excerpt" }] };
  current.publicDocument.parts[0].interaction.words[0].reusable = true;
  current.publicDocument.parts[0].interaction.panels[0].dropTargets[0].capacity = 2;
  current.teacherDocument.parts[0].solution.mappings = [{ targetId: targetIds[0], wordIds: [wordIds[0], wordIds[1]] }, { targetId: targetIds[1], wordIds: [wordIds[0]] }];
  current.publicDocument.assets.push(fontAsset);
  current.publicDocument.parts[0].interaction.presentation.bankWordStyle.fontAssetSlot = fontAsset.slot;
  const entry = { activityId, kind: "drag-drop", placement: { pageId: publicationV2Fixture.pageId }, sortOrder: 4 };
  sources.native.index.payload.activities.push(entry); sources.native.index = source(sources.native.index.payload, sources.native.index.revision);
  sources.native.activities[activityId] = { index: entry, public: source(current.publicDocument), teacher: source(current.teacherDocument) };
  sources.native.assetRows.push(...assets.map((asset, index) => ({ id: asset.assetId, checksum_sha256: asset.checksumSha256, asset_role: asset.role, object_key: `builder-native-assets/drag-${index}.png`, storage_profile: "private", storage_bucket: "private", mime_type: "image/png", byte_size: 100, width: 1000, height: 600, publication_status: "draft", access_level: "internal", source_metadata: { native_activity_id: activityId, asset_slot: asset.slot } })));
  sources.native.assetRows.push({ id: fontAsset.assetId, checksum_sha256: fontAsset.checksumSha256, asset_role: fontAsset.role, object_key: `builder-font-library/ultimate-b2/ultimate-b2-students-book/${fontAsset.checksumSha256}.ttf`, storage_profile: "private", storage_bucket: "private", mime_type: "font/ttf", byte_size: 22000, width: null, height: null, publication_status: "draft", access_level: "internal", source_metadata: { font_library_scope: "component", display_label: "Ahem" } });
  sources.documents.hotspots.payload.pages[publicationV2Fixture.pageId].push({ id: "hotspot-native-drag-drop-test", unitNumber: 1, pageId: publicationV2Fixture.pageId, pageNumber: 5, left: 68, top: 4, width: 12, height: 12, label: "Drag and Drop", actionType: "normalized_activity", activityKey: activityId });
  sources.documents.hotspots = source(sources.documents.hotspots.payload, sources.documents.hotspots.revision);
  const compiled = compileUltimateB2ComponentReleaseV2(sources);
  const published = compiled.publicProjection.nativeActivities[activityId].document;
  assert.equal(published.parts[0].interaction.randomize, false);
  assert.deepEqual(published.audioTextHotspots, current.publicDocument.audioTextHotspots);
  assert.deepEqual(published.parts[0].interaction.panels.map((panel) => panel.images.length), [2, 1]);
  assert.doesNotMatch(JSON.stringify(published), /mappings|solution/);
  assert.match(JSON.stringify(compiled.teacherProjection.nativeActivities[activityId]), /mappings/);
  assert.deepEqual(compiled.assetManifest.filter((asset) => asset.role === "activity_artwork" && ["b", "c"].includes(asset.sha256[0])).map((asset) => asset.sha256).sort(), ["b".repeat(64), "c".repeat(64)]);
  assert.ok(compiled.assetManifest.some((asset) => asset.sha256 === fontAsset.checksumSha256 && asset.role === "activity_font" && asset.extension === "ttf" && asset.mediaType === "font/ttf"));
});

test("Builder and web/Android runtimes expose managed panels, controlled responses, pointer and keyboard paths", async () => {
  const [editor, surface, teacherSurface, studentRunner, teacherRunner, androidProvider, publicContract, viteConfig, buildProfiles] = await Promise.all([
    readFile(new URL("../src/apps/book-builder/hosted/NativeDragDropEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/native-drag-drop/NativeDragDropSurface.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/native-drag-drop/NativeDragDropTeacherSurface.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/lms/activities/ultimate-b2/PublishedNativeStudentActivityRunner.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/lms/activities/ultimate-b2/PublishedNativeTeacherActivityRunner.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/android-teacher-offline/hostedNativeDraftProvider.js", import.meta.url), "utf8"),
    readFile(new URL("../src/data/native-activities/nativeActivityPublic.js", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.js", import.meta.url), "utf8"),
    readFile(new URL("../src/config/buildProfiles.js", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /Add Background/); assert.match(editor, /Add Image/); assert.match(editor, /Replace image/); assert.match(editor, /Draw Drop Target/); assert.match(editor, /Teacher-only correct mappings/); assert.match(editor, /Move panel/); assert.match(editor, /Remove this word and its private target mapping/);
  assert.match(editor, /Correct word mapping \(select one or more\)/); assert.match(editor, /<StageGeometryControls/); assert.match(editor, /setMappingWords/); assert.match(editor, /resolveWordsForTarget/); assert.match(editor, /DragDropTextStyleControls/); assert.match(editor, /getBuilderFontLibrary/); assert.match(editor, /Text drag-and-drop/); assert.match(editor, /NativeDragDropHotspotBulkImporter/);
  assert.match(editor, /fit: "contain", locked: background/);
  assert.doesNotMatch(await readFile(new URL("../src/components/native-drag-drop/nativeDragDrop.css", import.meta.url), "utf8"), /\d+(?:\.\d+)?vh\b/, "activity sizing must be based on its container rather than the browser viewport");
  assert.match(surface, /onPointerDown/); assert.match(surface, /onPointerMove/); assert.match(surface, /elementFromPoint/); assert.match(surface, /selectedWordId/); assert.match(surface, /Delete/); assert.match(surface, /initialResponses/); assert.match(surface, /onResponsesChange/); assert.match(surface, /readOnly/);
  assert.match(surface, /data-drag-drop-drag-preview/); assert.match(surface, /pointerType/); assert.match(surface, /DRAG_MOVEMENT_THRESHOLD/); assert.match(surface, /onPointerCancel/); assert.match(surface, /onLostPointerCapture/); assert.match(surface, /visibleNativeDragDropWordIds/); assert.match(surface, /resolveWordsForTarget/); assert.match(surface, /createPortal/); assert.match(surface, /sourceRect\.height/); assert.match(surface, /offsetX/);
  assert.match(surface, /data-drag-drop-target-text/); assert.doesNotMatch(surface, /Choose a word, then choose a target/);
  assert.doesNotMatch(surface, /Drop here|data-used/);
  assert.match(studentRunner, /NativeDragDropStudentSurface/); assert.doesNotMatch(studentRunner, /NativeDragDropTeacherSurface|loadPublishedNativeTeacherDocument|teacherDocument/);
  assert.match(teacherRunner, /NativeDragDropTeacherSurface/); assert.match(teacherSurface, /teacherDocument\.parts\[0\]\.solution\.mappings/); assert.match(teacherSurface, /evaluatePlacement/);
  assert.doesNotMatch(surface, /teacherDocument|solution\.mappings|wordIdsByTarget|revealedWords|NativeDragDropTeacherSurface/);
  assert.match(viteConfig, /appMode === "android-offline"[\s\S]*PublishedNativeStudentActivityRunner\.jsx[\s\S]*isTeacherRuntime \|\| isHostedInteractiveReview[\s\S]*PublishedNativeTeacherActivityRunner\.jsx/);
  assert.match(buildProfiles, /INTERACTIVE_HOSTED_REVIEW[\s\S]*Student Interactive mode is intentionally hidden[\s\S]*teacherPresentation: true/);
  assert.match(editor, /Student Preview/); assert.match(editor, /Teacher Preview/);
  assert.match(androidProvider, /"drag-drop"/); assert.match(androidProvider, /normalizeNativeRuntimeTeacherDocument/);
  assert.match(publicContract, /interaction\?\.panels\?\.some\(\(panel\) => panel\.images/);
  assert.doesNotMatch(surface, /data-(?:answer|correct|mapping)/i);
});


test("canonical editor normalization retains supporting assets and permits incomplete authoring without publication readiness", () => {
  const current = pair();
  const readable = { assetId: "20000000-0000-4000-8000-000000000044", checksumSha256: "e".repeat(64), role: "activity_artwork", slot: "readable" };
  const audio = { ...readable, assetId: "20000000-0000-4000-8000-000000000045", slot: "audio" };
  Object.assign(current.publicDocument, { readableText: { kind: "image", assetSlot: readable.slot, sourceWidth: 1000, sourceHeight: 1800, altText: "Passage" }, supplementalAudio: { assetSlot: audio.slot, durationMs: 2000 } });
  current.publicDocument.assets.push(readable, audio, fontAsset);
  current.publicDocument.parts[0].interaction.presentation.bankWordStyle.fontAssetSlot = fontAsset.slot;
  const open = (document) => normalizeNativeActivityPublic(document, { normalizeInteraction: normalizeNativeDragDropInteraction, expectedKind: "drag-drop", expectedActivityId: activityId });
  const opened = open(current.publicDocument);
  assert.deepEqual(open(opened), opened);
  assert.deepEqual(opened.assets, current.publicDocument.assets);
  assert.deepEqual(opened.parts[0].interaction.panels.map((panel) => panel.images.map((image) => image.area)), current.publicDocument.parts[0].interaction.panels.map((panel) => panel.images.map((image) => image.area)));
  current.teacherDocument.parts[0].solution.mappings = [];
  assert.doesNotThrow(() => open(opened));
  assert.equal(current.kind.assessReadiness(opened, current.teacherDocument).ready, false);
  assert.throws(() => current.kind.validatePair(opened, current.teacherDocument), /one private/);
  for (const mutate of [
    (value) => { delete value.readableText; },
    (value) => { value.readableText.assetSlot = "missing"; },
    (value) => { value.assets.find((asset) => asset.slot === "readable").role = "activity_font"; },
    (value) => { value.assets.push({ ...audio, assetId: "20000000-0000-4000-8000-000000000046", slot: "orphan" }); },
  ]) { const invalid = structuredClone(opened); mutate(invalid); assert.throws(() => open(invalid)); }
});
