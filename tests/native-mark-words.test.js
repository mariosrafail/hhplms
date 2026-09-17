import assert from "node:assert/strict";
import test from "node:test";
import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { assertPublicBuilderDocument } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { assertStudentSafeReleaseProjection } from "../src/data/ultimate-b2/componentPublication.js";
import { canonicalMarkWordsText, segmentMarkWordsText, normalizeNativeMarkWordsInteraction, nativeMarkWordsAssetRequirements } from "../src/data/native-activities/nativeMarkWords.js";
import { alignNativeMarkWordsAnswers, rebuildNativeMarkWordsPassage, removeNativeMarkWordsPassage, createNativeMarkWordsPanel, nextNativeMarkWordsBinding } from "../src/data/native-activities/nativeMarkWordsAuthoring.js";
import { parseNativeMarkWordsBulk, generateNativeMarkWordsBulkCandidate } from "../src/data/native-activities/nativeMarkWordsBulkAuthoring.js";
import { restoreNativeMarkWordsResponses, toggleNativeMarkWordsResponse } from "../src/data/native-activities/nativeMarkWordsRuntime.js";
import { nativeAssignmentCapability, containsClientTeacherMaterial } from "../netlify/functions/_book-content/native-assignment-runtime.js";
import { buildNativeFinalSubmission } from "../src/components/lms/student/runtime/studentSubmissionContract.js";
import { ULTIMATE_B2_PUBLICATION_V2_COMPATIBILITY_VARIANTS, reconstructUltimateB2PublicationV2Compatibility, ultimateB2PublicationV2Compatibility } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { compilePublicationV2Fixture } from "./fixtures/publication-v2.js";
import { markWordsFixtureId, legacyMarkWordsPair } from "./fixtures/native-mark-words.js";
import { nativeActivityUsesManagedAssetSlot, removeNativeManagedAssetReferenceIfUnused } from "../src/data/native-activities/nativeActivityPublic.js";

const kind = resolveNativeActivityKind("mark-the-words");
function blank() { return { publicDocument: kind.createBlankPublic({ activityId: "mark-words-fixture", title: "Mark the Words", placement: { pageId: "ub2-sb-unit-1-part-1" } }), teacherDocument: kind.createBlankTeacher({ activityId: "mark-words-fixture" }) }; }
function fixture() { return generateNativeMarkWordsBulkCandidate({ ...legacyMarkWordsPair(blank()), source: "1. I *watch* films while my watch *charges*.\n2. They *have been working* all morning." }); }

test("Mark the Words blank creation keeps one part and reports actionable incomplete readiness", () => {
  const pair = blank(); assert.equal(kind.validatePair(pair.publicDocument, pair.teacherDocument), true);
  assert.deepEqual(kind.assessReadiness(pair.publicDocument, pair.teacherDocument), { ready: false, issues: ["Draw at least one visual target."] });
  pair.publicDocument.parts.push(structuredClone(pair.publicDocument.parts[0])); assert.throws(() => kind.normalizePublic(pair.publicDocument), /exactly one Part/);
});

test("Mark the Words segmentation is deterministic, Unicode safe and preserves original whitespace", () => {
  const source = "  Café\tcan't can’t mother-in-law co‑operate e\u0301 😀\r\nΑθήνα 42.\rLast!  ";
  const text = canonicalMarkWordsText(source); const ranges = segmentMarkWordsText(source);
  assert.deepEqual(ranges.map((word) => text.slice(word.start, word.end)), ["Café", "can't", "can’t", "mother-in-law", "co‑operate", "e\u0301", "Αθήνα", "42", "Last"]);
  assert.deepEqual(ranges, segmentMarkWordsText(source)); assert.equal(text, source.replace(/\r\n?/g, "\n"));
  assert.throws(() => canonicalMarkWordsText("bad\ud800"));
  assert.equal(segmentMarkWordsText("😀 ...\n").length, 0);
});

test("bulk multiple expressions produce clean public passages and independent repeated occurrences", () => {
  const { publicDocument: pub, teacherDocument: teacher } = fixture();
  assert.equal(kind.validatePair(pub, teacher), true); assert.equal(kind.assessReadiness(pub, teacher).ready, true);
  assertPublicBuilderDocument(pub); assertStudentSafeReleaseProjection(pub);
  const first = pub.parts[0].interaction.items[0]; const repeated = first.words.filter((word) => first.text.slice(word.start, word.end) === "watch");
  assert.equal(repeated.length, 2); assert.notEqual(repeated[0].id, repeated[1].id);
  assert.equal(teacher.parts[0].solution.answers[0].correctWordIds.includes(repeated[0].id), true);
  assert.equal(teacher.parts[0].solution.answers[0].correctWordIds.includes(repeated[1].id), false);
  assert.equal(teacher.parts[0].solution.answers[1].correctWordIds.length, 3); assert.doesNotMatch(JSON.stringify(pub), /correctWordIds|\*/);
});

test("bulk escaping keeps literal asterisks, backslashes and slashes", () => {
  const parsed = parseNativeMarkWordsBulk(String.raw`1. Use \*stars\* and \\ paths; *up/down*.`)[0];
  assert.equal(parsed.text, "Use *stars* and \\ paths; up/down.");
  assert.deepEqual(parsed.correctRanges.map((range) => parsed.text.slice(range.start, range.end)), ["up", "down"]);
  assert.equal(parseNativeMarkWordsBulk("1. *watch*\n  films")[0].text, "watch\n  films");
});

for (const source of ["1. no markers", "1. *unmatched", "1. ** empty", "1. *  * empty", "1. wa*tch*", "0. *word*", "2. *word*", "1. *word*\n1. *other*", "1.*word*", "1. *...*", "1. *word* \\bad", `1. *word* ${"x ".repeat(201)}`]) test(`malformed bulk leaves both drafts untouched: ${source.slice(0, 35)}`, () => {
  const pair = fixture(); const before = structuredClone(pair);
  assert.throws(() => generateNativeMarkWordsBulkCandidate({ ...pair, source, replaceExisting: true, confirmed: true }), /line/);
  assert.deepEqual(pair, before);
});

test("reorder preserves identities and explicit rebuild clears only affected answers and geometry", () => {
  const pair = fixture(); const pub = pair.publicDocument; const teacher = pair.teacherDocument; const items = pub.parts[0].interaction.items;
  const original = structuredClone(items[1]); const oldWords = items[0].words.map((word) => word.id);
  assert.throws(() => rebuildNativeMarkWordsPassage(pub, teacher, items[0].id, "I watch."), /Confirm/);
  rebuildNativeMarkWordsPassage(pub, teacher, items[0].id, "I watch.", { confirmed: true });
  assert.equal(items[0].words.some((word) => oldWords.includes(word.id)), false); assert.deepEqual(teacher.parts[0].solution.answers[0].correctWordIds, []);
  assert.deepEqual(items[1], original); assert.equal(kind.assessReadiness(pub, teacher).ready, false);
  items.reverse(); alignNativeMarkWordsAnswers(pub, teacher); assert.equal(items[0].id, original.id); kind.validatePair(pub, teacher);
  removeNativeMarkWordsPassage(pub, teacher, items[1].id); assert.deepEqual(pub.parts[0].interaction.items, [original]); assert.equal(teacher.parts[0].solution.answers.length, 1);
});

test("append retains old occurrences; replacement requires confirmation and creates fresh occurrences", () => {
  const pair = fixture(); const old = structuredClone(pair.publicDocument.parts[0].interaction.items);
  const appended = generateNativeMarkWordsBulkCandidate({ ...pair, source: "1. *New* passage." });
  assert.deepEqual(appended.publicDocument.parts[0].interaction.items.slice(0, 2), old);
  assert.throws(() => generateNativeMarkWordsBulkCandidate({ ...pair, source: "1. *New* passage.", replaceExisting: true }), /Confirm/);
  const replaced = generateNativeMarkWordsBulkCandidate({ ...pair, source: "1. *New* passage.", replaceExisting: true, confirmed: true });
  assert.equal(replaced.publicDocument.parts[0].interaction.items.length, 1); assert.deepEqual(pair.publicDocument.parts[0].interaction.items, old);
});

for (const mutate of [p => { p.publicDocument.parts[0].interaction.items[0].words[0].end += 1; }, p => { p.publicDocument.parts[0].interaction.items[0].words.reverse(); }, p => { p.publicDocument.parts[0].interaction.items[0].words.pop(); }, p => { p.publicDocument.parts[0].interaction.items[0].words[1].id = p.publicDocument.parts[0].interaction.items[0].words[0].id; }, p => { p.teacherDocument.activityId = "other"; }, p => { p.teacherDocument.parts[0].id = "part-2"; }, p => { p.teacherDocument.parts[0].solution.answers[0].correctWordIds = p.teacherDocument.parts[0].solution.answers[1].correctWordIds; }, p => { p.publicDocument.parts[0].interaction.items[0].isCorrect = true; }]) test("strict pair rejects stale, duplicate, dangling or private data", () => { const pair = fixture(); mutate(pair); assert.throws(() => kind.validatePair(pair.publicDocument, pair.teacherDocument)); });

for (const key of ["correctWordIds", "Correct-Word_IDS", "is_correct", "answer-count", "marked_source"]) test(`public writes, release and submitted client material reject nested ${key}`, () => {
  const value = { nested: [{ [key]: [] }] };
  assert.throws(() => assertPublicBuilderDocument(value)); assert.throws(() => assertStudentSafeReleaseProjection(value)); assert.equal(containsClientTeacherMaterial(value), true);
});
test("token and secret public bans remain intact", () => { for (const key of ["token", "tokens", "secret", "SESSION_TOKEN"]) assert.throws(() => assertPublicBuilderDocument({ nested: { [key]: "x" } })); });

test("visual mapping covers distractors, excludes overlaps and keeps underline area distinct", () => {
  const pair = fixture(); const pub = pair.publicDocument; const current = pub.parts[0].interaction;
  const panel = createNativeMarkWordsPanel(); panel.backgroundAssetSlot = "words-image";
  pub.assets = [{ assetId: "10000000-0000-4000-8000-000000000001", checksumSha256: "a".repeat(64), role: "activity_artwork", slot: panel.backgroundAssetSlot }];
  current.presentation.kind = "image-hotspot"; current.presentation.panels = [panel];
  assert.equal(kind.assessReadiness(pub, pair.teacherDocument).ready, false);
  for (const [itemIndex, item] of current.items.entries()) for (const [index, word] of item.words.entries()) {
    assert.deepEqual(nextNativeMarkWordsBinding(current, panel.id), { itemId: item.id, wordId: word.id });
    panel.hotspots.push({ id: `hot-${String(panel.hotspots.length + 1).padStart(32, "0")}`, itemId: item.id, wordId: word.id, area: { x: index * 90, y: itemIndex * 100, width: 80, height: 80 }, markArea: { x: index * 90 + 10, y: itemIndex * 100 + 10, width: 60, height: 30 } });
  }
  assert.equal(kind.assessReadiness(pub, pair.teacherDocument).ready, true); assert.equal(nextNativeMarkWordsBinding(current, panel.id), null);
  assert.equal(nativeMarkWordsAssetRequirements(pub)[0].slot, panel.backgroundAssetSlot);
  const before = structuredClone(panel.hotspots[0].markArea); panel.hotspots[0].area.height = 90;
  normalizeNativeMarkWordsInteraction(current, { assets: pub.assets }); assert.deepEqual(panel.hotspots[0].markArea, before);
  panel.hotspots[1].area.x = 0; assert.throws(() => normalizeNativeMarkWordsInteraction(current, { assets: pub.assets }));
});

test("response toggles, restores and canonicalizes stable occurrence IDs", () => {
  const { publicDocument: pub } = fixture(); const item = pub.parts[0].interaction.items[0];
  let responses = toggleNativeMarkWordsResponse(pub, {}, item.id, item.words[5].id); responses = toggleNativeMarkWordsResponse(pub, responses, item.id, item.words[1].id);
  assert.deepEqual(responses[item.id], [item.words[1].id, item.words[5].id]);
  responses = toggleNativeMarkWordsResponse(pub, responses, item.id, item.words[1].id); assert.deepEqual(responses[item.id], [item.words[5].id]);
  assert.deepEqual(restoreNativeMarkWordsResponses(pub, { [item.id]: ["unknown"] }), {});
});

test("LMS exact-set grading handles omissions, repeated words, extras and select-all", () => {
  const pair = fixture(); const pub = pair.publicDocument; const teacher = pair.teacherDocument;
  const item = pub.parts[0].interaction.items[0]; const expected = teacher.parts[0].solution.answers[0].correctWordIds;
  const capability = nativeAssignmentCapability("mark-the-words");
  for (const [selection, correct] of [[expected, 1], [[expected[0]], 0], [[...expected, item.words[5].id], 0], [item.words.map((word) => word.id), 0], [[], 0]]) {
    const normalized = capability.normalizeResponse(pub, { schemaVersion: "native-response.v1", items: [{ id: item.id, value: [...selection].reverse() }] });
    assert.equal(normalized.error, undefined); assert.equal(capability.evaluateResponse(pub, teacher, normalized.payload).correctCount, correct);
  }
  const full = capability.normalizeResponse(pub, { schemaVersion: "native-response.v1", items: teacher.parts[0].solution.answers.map((answer) => ({ id: answer.itemId, value: answer.correctWordIds })) });
  assert.equal(capability.evaluateResponse(pub, teacher, full.payload).scorePercent, 100);
  const review = capability.teacherReviewProjection(pub, teacher, full.payload); assert.match(review[0].answer, /watch \(word 2\)/); assert.equal(review[0].prompt, item.text);
  const empty = buildNativeFinalSubmission({ assignmentId: "assigned", target: { nativeKind: "mark-the-words", entry: { document: pub }, capability }, responses: {} });
  assert.deepEqual(empty.response.items[0].value, []); assert.equal(capability.evaluateResponse(pub, teacher, capability.normalizeResponse(pub, empty.response).payload).correctCount, 0);
});

test("LMS rejects forged IDs, duplicate selections, extra fields and client target overrides", () => {
  const { publicDocument: pub } = fixture(); const [first, second] = pub.parts[0].interaction.items; const capability = nativeAssignmentCapability("mark-the-words");
  const envelope = (value) => ({ schemaVersion: "native-response.v1", items: [{ id: first.id, value }] });
  for (const value of [["unknown"], [second.words[0].id], [first.words[0].id, first.words[0].id], [1], "watch", null, [{ correctWordIds: [] }]]) assert.ok(capability.normalizeResponse(pub, envelope(value)).error);
  for (const key of ["kind", "score", "target", "correctCount"]) assert.ok(capability.normalizeResponse(pub, { ...envelope([]), [key]: "forged" }).error);
  const duplicate = envelope([]); duplicate.items.push(duplicate.items[0]); assert.ok(capability.normalizeResponse(pub, duplicate).error);
});

test("publication adds a derived compatibility variant without changing historical kind arrays", () => {
  const current = ULTIMATE_B2_PUBLICATION_V2_COMPATIBILITY_VARIANTS.find((variant) => variant.name === "mark-words-expanded");
  assert.equal(current.name, "mark-words-expanded"); assert.notEqual(current.compatibility, ultimateB2PublicationV2Compatibility());
  assert.equal(current.compatibility, reconstructUltimateB2PublicationV2Compatibility(current.nativeKinds, { unitExtras: true, pageLifecycle: true }));
  for (const variant of ULTIMATE_B2_PUBLICATION_V2_COMPATIBILITY_VARIANTS.slice(0, -2)) assert.equal(variant.nativeKinds.includes("mark-the-words"), false);
});

test("Students Book publication includes Mark the Words deterministically with a private Teacher projection", () => {
  const first = compilePublicationV2Fixture({ markWords: true }); const second = compilePublicationV2Fixture({ markWords: true });
  assert.equal(first.releaseSha256, second.releaseSha256);
  assert.equal(first.publicProjection.nativeActivities[markWordsFixtureId].kind, "mark-the-words");
  assert.equal(first.teacherProjection.nativeActivities[markWordsFixtureId].document.parts[0].solution.answers.length, 2);
  assert.doesNotMatch(JSON.stringify(first.publicProjection.nativeActivities[markWordsFixtureId]), /correctWordIds|\*/);
});

test("rebuilding removes only the affected passage geometry and preserves shared assets and answers", () => {
  const { publicDocument: pub, teacherDocument: teacher } = fixture();
  const [first, second] = pub.parts[0].interaction.items;
  const panel = createNativeMarkWordsPanel();
  panel.hotspots = [first, second].map((item, index) => ({ id: `hot-${String(index + 1).padStart(32, "0")}`, itemId: item.id, wordId: item.words[0].id, area: { x: 100 * index, y: 0, width: 80, height: 30 }, markArea: { x: 100 * index, y: 0, width: 80, height: 30 } }));
  pub.parts[0].interaction.presentation.panels = [panel];
  const unaffected = structuredClone(teacher.parts[0].solution.answers[1]);
  rebuildNativeMarkWordsPassage(pub, teacher, first.id, "Fresh words.", { confirmed: true });
  assert.equal(panel.hotspots.length, 1); assert.equal(panel.hotspots[0].itemId, second.id);
  assert.deepEqual(teacher.parts[0].solution.answers[1], unaffected);
});

test("managed typography keeps a live font reference and rejects missing or wrong-role fonts", () => {
  const { publicDocument: pub, teacherDocument: teacher } = fixture();
  const font = { assetId: "10000000-0000-4000-8000-000000000008", checksumSha256: "a".repeat(64), role: "activity_font", slot: "passage-font" };
  pub.assets = [font]; pub.parts[0].interaction.presentation.textStyle.fontAssetSlot = font.slot;
  kind.validatePair(pub, teacher);
  assert.equal(nativeActivityUsesManagedAssetSlot(pub, font.slot), true);
  removeNativeManagedAssetReferenceIfUnused(pub, font.slot); assert.equal(pub.assets.length, 1);
  assert.deepEqual(nativeMarkWordsAssetRequirements(pub), [{ slot: font.slot, mediaType: "font/ttf", label: "Passage font" }]);
  const bad = structuredClone(pub); bad.assets[0].role = "activity_artwork"; assert.throws(() => kind.normalizePublic(bad));
  pub.parts[0].interaction.presentation.textStyle.fontAssetSlot = null;
  removeNativeManagedAssetReferenceIfUnused(pub, font.slot); assert.deepEqual(pub.assets, []);
});

test("bounded maximum text and word responses fit existing native request ceilings", () => {
  const source = Array.from({ length: 4 }, (_, index) => `${index + 1}. *${Array(200).fill("word").join(" ")}*`).join("\n");
  const pair = generateNativeMarkWordsBulkCandidate({ ...legacyMarkWordsPair(blank()), source });
  assert.equal(pair.publicDocument.parts[0].interaction.items.flatMap((item) => item.words).length, 800);
  const response = { schemaVersion: "native-response.v1", items: pair.teacherDocument.parts[0].solution.answers.map((answer) => ({ id: answer.itemId, value: answer.correctWordIds })) };
  assert.ok(Buffer.byteLength(JSON.stringify(response)) < 100_000);
  assert.ok(Buffer.byteLength(JSON.stringify(pair)) < 1024 * 1024);
  assert.throws(() => generateNativeMarkWordsBulkCandidate({ ...pair, source: "1. *extra*" }), /800/);
});
