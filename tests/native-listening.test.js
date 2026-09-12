import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { findNativeListeningCue, formatNativeListeningTime, parseNativeListeningDisplayTime, parseNativeListeningSrt, resolveNativeListeningHighlightedCueIds, transcriptScrollTarget } from "../src/components/native-listening/nativeListeningRuntime.js";
import { normalizeNativeActivityPublic } from "../src/data/native-activities/nativeActivityPublic.js";
import { normalizeNativeActivityTeacher } from "../src/data/native-activities/nativeActivityTeacher.js";
import { assessNativeListeningReadiness, createEmptyNativeListeningInteraction, initialNativeListeningArtworkArea, nativeListeningAssetRequirements, normalizeNativeListeningInteraction, normalizeNativeListeningSolution, validateNativeListeningTopology } from "../src/data/native-activities/nativeListening.js";
import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { builderDocumentSha256 } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { compileUltimateB2ComponentReleaseV2 } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { createPublicationV2FixtureSources } from "./fixtures/publication-v2.js";

const child = (prefix, digit) => `${prefix}-${digit.repeat(32)}`;
const audio = { assetId: "11111111-1111-4111-8111-111111111111", checksumSha256: "c".repeat(64), role: "activity_artwork", slot: "asset-audio" };
const background = { assetId: "22222222-2222-4222-8222-222222222222", checksumSha256: "b".repeat(64), role: "activity_artwork", slot: "asset-background" };
const hotspotAudio = { assetId: "33333333-3333-4333-8333-333333333333", checksumSha256: "e".repeat(64), role: "activity_artwork", slot: "asset-hotspot-audio" };

function pair() {
  const questionId = child("q", "1");
  const cueOne = child("cue", "2");
  const cueTwo = child("cue", "3");
  const publicDocument = {
    schemaVersion: "1.0", activityId: "listening-test", kind: "listening",
    metadata: { title: "Listening", visibleInstructionText: "Listen and answer." }, placement: { pageId: "page-1" },
    assets: [audio, background],
    parts: [{ id: "part-1", interaction: {
      kind: "listening", audioAssetSlot: audio.slot, audioDurationMs: 12_000,
      panels: [
        { id: "panel-1", kind: "questions", sourceWidth: 1024, sourceHeight: 582 },
        { id: "panel-2", kind: "synchronized-transcript", backgroundAssetSlot: background.slot, sourceWidth: 1000, sourceHeight: 1800, transcriptArea: { x: 100, y: 120, width: 800, height: 1500 } },
      ],
      questions: [{ id: questionId, prompt: "What did you hear?" }],
      cues: [{ id: cueOne, startMs: 0, endMs: 3_000, text: "First line" }, { id: cueTwo, startMs: 4_000, endMs: 8_000, text: "Second line" }],
      snippetHotspots: [{ id: child("aud", "4"), area: { x: 900, y: 30, width: 48, height: 48 }, cueIds: [cueOne, cueTwo], label: "Read excerpt" }],
    } }],
  };
  const teacherDocument = { schemaVersion: "1.0", activityId: "listening-test", kind: "listening", parts: [{ id: "part-1", solution: { kind: "listening", modelAnswers: [{ questionId, text: "Teacher secret answer" }] } }] };
  return { publicDocument, teacherDocument };
}

test("Listening is a canonical registered native kind with strict paired defaults", () => {
  const definition = resolveNativeActivityKind("listening");
  assert.equal(definition.label, "Listening");
  const publicDocument = definition.createBlankPublic({ activityId: "new-listening", title: "New Listening", placement: { pageId: "page-1" } });
  const teacherDocument = definition.createBlankTeacher({ activityId: "new-listening" });
  assert.equal(publicDocument.parts[0].interaction.panels.length, 2);
  assert.equal(teacherDocument.parts[0].solution.kind, "listening");
  assert.equal(definition.assessReadiness(publicDocument, teacherDocument).ready, false);
  assert.deepEqual(createEmptyNativeListeningInteraction().panels[1], { id: "panel-2", kind: "synchronized-transcript", backgroundAssetSlot: "", sourceWidth: 1024, sourceHeight: 582, transcriptArea: { x: 82, y: 47, width: 860, height: 489 } });
});

test("only the first exact-size Listening artwork defaults to the full question stage", () => {
  const surface = { width: 1024, height: 582 };
  assert.deepEqual(initialNativeListeningArtworkArea(surface, { width: 1024, height: 582 }, 0), { x: 0, y: 0, width: 1024, height: 582 });
  assert.notDeepEqual(initialNativeListeningArtworkArea(surface, { width: 1024, height: 582 }, 1), { x: 0, y: 0, width: 1024, height: 582 });
  assert.notDeepEqual(initialNativeListeningArtworkArea(surface, { width: 800, height: 600 }, 0), { x: 0, y: 0, width: 1024, height: 582 });
});

test("Listening public and Teacher documents normalize, remain separated, and are ready", () => {
  const source = pair();
  const publicDocument = normalizeNativeActivityPublic(source.publicDocument, { normalizeInteraction: normalizeNativeListeningInteraction, expectedKind: "listening" });
  const teacherDocument = normalizeNativeActivityTeacher(source.teacherDocument, { normalizeSolution: normalizeNativeListeningSolution, expectedKind: "listening" });
  assert.equal(validateNativeListeningTopology(publicDocument, teacherDocument), true);
  assert.deepEqual(assessNativeListeningReadiness(publicDocument, teacherDocument), { ready: true, issues: [] });
  assert.deepEqual(nativeListeningAssetRequirements(publicDocument), [
    { slot: audio.slot, mediaType: "audio/mpeg", label: "Listening MP3" },
    { slot: background.slot, width: 1000, height: 1800, label: "Listening background" },
  ]);
  const publicJson = JSON.stringify(publicDocument);
  assert.equal(publicJson.includes("Teacher secret answer"), false);
  assert.equal(publicJson.includes("modelAnswers"), false);
  assert.equal(JSON.stringify(teacherDocument).includes("Teacher secret answer"), true);
  assert.deepEqual(publicDocument.parts[0].interaction.artwork, []);
  assert.equal(publicDocument.parts[0].interaction.questions[0].responseRegion.id, `${publicDocument.parts[0].interaction.questions[0].id}-response`);
  assert.deepEqual(publicDocument.parts[0].interaction.questions[0].promptArea, { x: 72, y: 24, width: 880, height: 38 });
});

test("legacy Listening questions upgrade to canonical Open Response geometry and new visual fields round-trip deterministically", () => {
  const { publicDocument } = pair();
  const normalizedLegacy = normalizeNativeActivityPublic(publicDocument, { normalizeInteraction: normalizeNativeListeningInteraction, expectedKind: "listening" });
  const canonical = structuredClone(normalizedLegacy);
  canonical.parts[0].interaction.questions[0].promptArea = { x: 48.125, y: 35.5, width: 700.25, height: 55.75 };
  canonical.parts[0].interaction.questions[0].responseRegion.area = { x: 110.5, y: 160.25, width: 760, height: 140 };
  canonical.parts[0].interaction.questions[0].responseRegion.presentation.lineWidth = 736;
  const roundTrip = normalizeNativeActivityPublic(canonical, { normalizeInteraction: normalizeNativeListeningInteraction, expectedKind: "listening" });
  assert.deepEqual(roundTrip, normalizeNativeActivityPublic(roundTrip, { normalizeInteraction: normalizeNativeListeningInteraction, expectedKind: "listening" }));
  assert.deepEqual(roundTrip.parts[0].interaction.questions[0].promptArea, canonical.parts[0].interaction.questions[0].promptArea);
  assert.equal(roundTrip.parts[0].interaction.cues[0].startMs, 0);
  const malformed = structuredClone(roundTrip); malformed.parts[0].interaction.questions[0].promptArea.x = 1_000;
  assert.throws(() => normalizeNativeActivityPublic(malformed, { normalizeInteraction: normalizeNativeListeningInteraction, expectedKind: "listening" }), /logical surface/);
});

test("Listening hotspot MP3 is a strict managed optional reference and old hotspots remain compatible", () => {
  const legacy = pair().publicDocument;
  const normalizedLegacy = normalizeNativeActivityPublic(legacy, { normalizeInteraction: normalizeNativeListeningInteraction, expectedKind: "listening" });
  assert.equal(normalizedLegacy.parts[0].interaction.snippetHotspots[0].audioAssetSlot, "");
  const current = pair().publicDocument;
  current.assets.push(hotspotAudio);
  current.parts[0].interaction.snippetHotspots[0].audioAssetSlot = hotspotAudio.slot;
  const normalized = normalizeNativeActivityPublic(current, { normalizeInteraction: normalizeNativeListeningInteraction, expectedKind: "listening" });
  assert.equal(normalized.parts[0].interaction.snippetHotspots[0].audioAssetSlot, hotspotAudio.slot);
  assert.equal(nativeListeningAssetRequirements(normalized).at(-1).slot, hotspotAudio.slot);
  const dangling = structuredClone(current); dangling.parts[0].interaction.snippetHotspots[0].audioAssetSlot = "missing-audio";
  assert.throws(() => normalizeNativeActivityPublic(dangling, { normalizeInteraction: normalizeNativeListeningInteraction, expectedKind: "listening" }), /managed asset|managed native audio/);
});

test("Listening rejects overlapping, reversed, duplicate, and unknown cue mappings", () => {
  const { publicDocument } = pair();
  publicDocument.parts[0].interaction.cues[1].startMs = 2_999;
  assert.throws(() => normalizeNativeListeningInteraction(publicDocument.parts[0].interaction, { assets: publicDocument.assets }), /ordered and non-overlapping/);
  publicDocument.parts[0].interaction.cues[1].startMs = 4_000;
  publicDocument.parts[0].interaction.cues[1].endMs = 3_999;
  assert.throws(() => normalizeNativeListeningInteraction(publicDocument.parts[0].interaction, { assets: publicDocument.assets }), /end after/);
  publicDocument.parts[0].interaction.cues[1].endMs = 8_000;
  publicDocument.parts[0].interaction.snippetHotspots[0].cueIds = [child("cue", "9")];
  assert.throws(() => normalizeNativeListeningInteraction(publicDocument.parts[0].interaction, { assets: publicDocument.assets }), /cueIds/);
});

test("SRT import is strict, multiline, text-only, ordered, and produces canonical integer milliseconds", () => {
  let index = 4;
  const cues = parseNativeListeningSrt("1\r\n00:00:01,250 --> 00:00:03,500\r\nHello <b>literal</b>\r\nsecond line\r\n\r\n2\r\n00:00:04.000 --> 00:00:06.010\r\nGoodbye", { createId: () => child("cue", String(index++)) });
  assert.deepEqual(cues.map(({ startMs, endMs, text }) => ({ startMs, endMs, text })), [
    { startMs: 1_250, endMs: 3_500, text: "Hello <b>literal</b>\nsecond line" },
    { startMs: 4_000, endMs: 6_010, text: "Goodbye" },
  ]);
  assert.throws(() => parseNativeListeningSrt("00:00:04,000 --> 00:00:03,000\nBad", { createId: () => child("cue", "6") }), /end after/);
  assert.throws(() => parseNativeListeningSrt("00:00:01,000 --> 00:00:04,000\nA\n\n00:00:03,000 --> 00:00:05,000\nB", { createId: () => child("cue", "7") }), /overlaps/);
  assert.throws(() => parseNativeListeningSrt("00:61:01,000 --> 00:61:04,000\nBad", { createId: () => child("cue", "8") }), /malformed/);
  assert.throws(() => parseNativeListeningSrt("00:00:01,000 --> 00:00:02,000\n   ", { createId: () => child("cue", "8") }), /text/);
  assert.throws(() => parseNativeListeningSrt("00:00:04,000 --> 00:00:05,000\nLater\n\n00:00:01,000 --> 00:00:02,000\nEarlier", { createId: () => child("cue", "8") }), /order/);
  assert.throws(() => parseNativeListeningSrt("not a timestamp\nText", { createId: () => child("cue", "8") }), /timing/);
  const deterministicSource = "1\n00:00:00,000 --> 00:00:01,000\nExact";
  assert.deepEqual(parseNativeListeningSrt(deterministicSource, { createId: () => child("cue", "9") }), parseNativeListeningSrt(deterministicSource, { createId: () => child("cue", "9") }));
});

test("Listening synchronization is deterministic at all boundaries and seeks", () => {
  const cues = pair().publicDocument.parts[0].interaction.cues;
  assert.equal(findNativeListeningCue(cues, -1), null);
  assert.equal(findNativeListeningCue(cues, 0)?.id, cues[0].id);
  assert.equal(findNativeListeningCue(cues, 2_999)?.id, cues[0].id);
  assert.equal(findNativeListeningCue(cues, 3_000), null);
  assert.equal(findNativeListeningCue(cues, 4_000)?.id, cues[1].id);
  assert.equal(findNativeListeningCue(cues, 8_000), null);
  assert.equal(findNativeListeningCue(cues, 4_500)?.id, cues[1].id);
  assert.equal(findNativeListeningCue(cues, 1_000)?.id, cues[0].id);
  assert.equal(formatNativeListeningTime(3_723_999), "62:03");
  assert.equal(parseNativeListeningDisplayTime("62:03"), 3_723_000);
  assert.equal(formatNativeListeningTime(88_999), "01:28");
  assert.doesNotMatch(formatNativeListeningTime(88_999), /\.\d{3}/);
});

test("reference cue focus is explicit until playback takes authority", () => {
  const interaction = pair().publicDocument.parts[0].interaction;
  const mapped = interaction.snippetHotspots[0].cueIds;
  assert.deepEqual(resolveNativeListeningHighlightedCueIds({ cues: interaction.cues, milliseconds: 4_500, focusMode: "reference", focusedCueIds: mapped }), mapped);
  assert.deepEqual(resolveNativeListeningHighlightedCueIds({ cues: interaction.cues, milliseconds: 4_500, focusMode: "playback", focusedCueIds: mapped }), [interaction.cues[1].id]);
  assert.deepEqual(resolveNativeListeningHighlightedCueIds({ cues: interaction.cues, milliseconds: 3_500, focusMode: "playback", focusedCueIds: mapped }), []);
});

test("Listening transcript scrolling preserves a comfort zone and clamps bounds", () => {
  assert.equal(transcriptScrollTarget({ cueTop: 160, cueBottom: 180, scrollTop: 100, viewportHeight: 300, scrollHeight: 1_000 }), 100);
  assert.equal(transcriptScrollTarget({ cueTop: 600, cueBottom: 640, scrollTop: 100, viewportHeight: 300, scrollHeight: 1_000 }), 546);
  assert.equal(transcriptScrollTarget({ cueTop: 980, cueBottom: 1_010, scrollTop: 700, viewportHeight: 300, scrollHeight: 1_000 }), 700);
});

test("Listening renders imported markup in one stable full stage without an HTML execution sink", async () => {
  const [source, css, player, editor, questionAuthoring, transcriptAuthoring, responseControls, responseFonts] = await Promise.all([
    readFile(new URL("../src/components/native-listening/NativeListeningSurface.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/native-listening/nativeListening.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/listening-player/LegacyListeningPlayer.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/book-builder/hosted/NativeListeningEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/book-builder/hosted/NativeListeningQuestionAuthoring.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/book-builder/hosted/NativeListeningTranscriptAuthoring.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/book-builder/hosted/NativeOpenResponseResponseControls.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/book-builder/hosted/useNativeListeningResponseFonts.js", import.meta.url), "utf8"),
  ]);
  assert.match(source, /\{cue\.text\}/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/);
  assert.match(source, /NativeOpenResponseStudentSurface/);
  assert.match(source, /setView\("transcript"\)/);
  assert.match(source, /node\.focus\?\.\(\{ preventScroll: true \}\)/);
  assert.match(source, /focusMode === "playback"/);
  assert.doesNotMatch(source, /native-listening-panel-tabs|role="tablist"/);
  assert.match(source, /panelCount: interaction\.panels\.length/);
  assert.match(source, /command\.type === "previous-panel"/);
  assert.match(source, /command\.type === "next-panel"/);
  assert.match(source, /command\.type === "toggle-text"/);
  assert.match(source, /pendingAutoplay/);
  assert.match(player, /Stop Listening audio/);
  assert.match(player, /Mute Listening audio/);
  assert.match(css, /native-listening-player-anchor \{ position: absolute; z-index: 120; right: 24px; bottom: 18px/);
  assert.match(css, /native-listening-transcript p\.is-active \{ background: rgb\(250 204 21 \/ 28%\); \}/);
  assert.doesNotMatch(css, /native-listening-transcript p\.is-active[^}]*box-shadow|native-listening-transcript p\.is-active[^}]*font-weight|native-listening-transcript p\.is-active[^}]*outline|native-listening-transcript p\.is-active[^}]*border/);
  assert.match(css, /native-listening-transcript p\.is-reference[^}]*outline/);
  assert.match(source, /native-listening-activity-stage/);
  assert.match(css, /native-listening-activity-stage[^}]*100cqw[^}]*100cqh/);
  assert.match(css, /native-listening-transcript-stage[^}]*width: 100%; height: 100%/);
  assert.doesNotMatch(css, /padding[^;}]*118px|padding-bottom:\s*96px/);
  assert.match(editor, /NativeListeningTranscriptAuthoring/);
  assert.match(transcriptAuthoring, /<StageGeometryControls[\s\S]*Listening transcript region/);
  assert.match(questionAuthoring, /<StageGeometryControls/);
  assert.match(questionAuthoring, /<NativeOpenResponseResponseControls/);
  for (const label of ["Accessibility label", "Padding X", "Padding Y", "Line count", "Line width", "Line spacing", "Auto-fit minimum", "Requested answer size", "Answer text color", "Answer align"]) assert.match(responseControls, new RegExp(label));
  assert.match(responseControls, /NativeActivityFontControls/);
  assert.match(responseControls, /fitNativeOpenResponseRuntimeAnswer/);
  assert.match(responseFonts, /useBuilderFontLibrary/);
  assert.match(await readFile("src/apps/book-builder/hosted/useBuilderFontLibrary.js", "utf8"), /getBuilderFontLibrary/);
  assert.match(responseFonts, /mergeNativeManagedAssetReference/);
  assert.match(editor, /nativeFontPreviewUrl/);
  for (const type of ["prompt", "response", "artwork", "snippet"]) assert.match(questionAuthoring, new RegExp(type));
  assert.doesNotMatch(css, /720px/);
  assert.doesNotMatch(css, /position:fixed/);
});

test("Replacing audio with a shorter duration keeps cues invalid instead of clamping them", () => {
  const { publicDocument, teacherDocument } = pair();
  publicDocument.parts[0].interaction.audioDurationMs = 7_000;
  const readiness = assessNativeListeningReadiness(publicDocument, teacherDocument);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.issues.includes("Transcript cue 2 exceeds the audio duration."));
  assert.equal(publicDocument.parts[0].interaction.cues[1].endMs, 8_000);
});

test("Listening readiness diagnoses invalid authored cue and hotspot state before save", () => {
  const { publicDocument, teacherDocument } = pair();
  const interaction = publicDocument.parts[0].interaction;
  interaction.cues[0].text = " ";
  interaction.cues[1].startMs = 2_000;
  interaction.snippetHotspots[0].cueIds = [child("cue", "9")];
  interaction.snippetHotspots[0].label = " ";
  const readiness = assessNativeListeningReadiness(publicDocument, teacherDocument);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.issues.includes("Transcript cue 1 needs text."));
  assert.ok(readiness.issues.includes("Transcript cue 2 overlaps or is out of order."));
  assert.ok(readiness.issues.includes("Transcript hotspot 1 needs an accessible label."));
  assert.ok(readiness.issues.includes("Transcript hotspot 1 needs valid transcript cues."));
});

test("Listening compiles through publication v2 with managed MP3/background and private Teacher projection", () => {
  const sources = createPublicationV2FixtureSources();
  const { publicDocument, teacherDocument } = pair();
  publicDocument.assets.push(hotspotAudio);
  publicDocument.parts[0].interaction.snippetHotspots[0].audioAssetSlot = hotspotAudio.slot;
  const entry = { activityId: publicDocument.activityId, kind: "listening", placement: { pageId: "ub2-sb-unit-1-part-1" }, sortOrder: 4 };
  publicDocument.placement = { pageId: entry.placement.pageId };
  const source = (payload) => ({ payload, revision: 1, sha256: builderDocumentSha256(payload) });
  sources.native.index.payload.activities.push(entry); sources.native.index.sha256 = builderDocumentSha256(sources.native.index.payload);
  sources.native.activities[entry.activityId] = { index: entry, public: source(publicDocument), teacher: source(teacherDocument) };
  sources.documents.hotspots.payload.pages[entry.placement.pageId].push({ id: "hotspot-native-listening", unitNumber: 1, pageId: entry.placement.pageId, pageNumber: 5, left: 52, top: 4, width: 12, height: 12, label: "Native Listening", actionType: "normalized_activity", activityKey: entry.activityId });
  sources.documents.hotspots.sha256 = builderDocumentSha256(sources.documents.hotspots.payload);
  sources.native.assetRows.push(
    { id: audio.assetId, checksum_sha256: audio.checksumSha256, asset_role: audio.role, object_key: "builder-native-assets/listening.mp3", storage_profile: "private", storage_bucket: "private", mime_type: "audio/mpeg", byte_size: 1_000, width: null, height: null, publication_status: "draft", access_level: "internal", source_metadata: { native_activity_id: entry.activityId, asset_slot: audio.slot } },
    { id: background.assetId, checksum_sha256: background.checksumSha256, asset_role: background.role, object_key: "builder-native-assets/listening.png", storage_profile: "private", storage_bucket: "private", mime_type: "image/png", byte_size: 2_000, width: 1000, height: 1800, publication_status: "draft", access_level: "internal", source_metadata: { native_activity_id: entry.activityId, asset_slot: background.slot } },
    { id: hotspotAudio.assetId, checksum_sha256: hotspotAudio.checksumSha256, asset_role: hotspotAudio.role, object_key: "builder-native-assets/listening-hotspot.mp3", storage_profile: "private", storage_bucket: "private", mime_type: "audio/mpeg", byte_size: 800, width: null, height: null, publication_status: "draft", access_level: "internal", source_metadata: { native_activity_id: entry.activityId, asset_slot: hotspotAudio.slot } },
  );
  const compiled = compileUltimateB2ComponentReleaseV2(sources);
  assert.equal(compiled.publicProjection.nativeActivities[entry.activityId].kind, "listening");
  assert.equal(compiled.assetManifest.some((asset) => asset.mediaType === "audio/mpeg"), true);
  assert.equal(compiled.assetManifest.filter((asset) => asset.mediaType === "audio/mpeg").length >= 2, true);
  assert.doesNotMatch(JSON.stringify(compiled.publicProjection), /Teacher secret answer|modelAnswers/);
  assert.match(JSON.stringify(compiled.teacherProjection.nativeActivities[entry.activityId]), /Teacher secret answer/);
});
