import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { nativeChildIdFromUuid } from "../src/data/native-activities/nativeChildIdentity.js";
import { ultimateB2StudentsBookAuthoringPages } from "../src/data/ultimate-b2/studentsBookAuthoringCatalog.js";
import {
  createEmptyUltimateB2UnitExtras,
  normalizePublishedUltimateB2UnitExtras,
  normalizeUltimateB2UnitExtrasDocument,
  projectUltimateB2UnitExtrasForPublication,
  unitExtraAudiosForPage,
} from "../src/data/ultimate-b2/unitExtras.js";

const videoA = nativeChildIdFromUuid("video", "10000000-0000-4000-8000-000000000001");
const videoB = nativeChildIdFromUuid("video", "10000000-0000-4000-8000-000000000002");
const cueA = nativeChildIdFromUuid("cue", "10000000-0000-4000-8000-000000000003");
const assetA = "10000000-0000-4000-8000-000000000004";
const audioA = nativeChildIdFromUuid("audio", "10000000-0000-4000-8000-000000000005");
const audioAssetA = "10000000-0000-4000-8000-000000000006";
const pageA = ultimateB2StudentsBookAuthoringPages.find((page) => page.unitNumber === 1);
const pageB = ultimateB2StudentsBookAuthoringPages.find((page) => page.unitNumber === 1 && page.id !== pageA.id);

function video(id, overrides = {}) {
  return {
    id,
    title: id === videoA ? "Welcome video" : "Extension video",
    assetSlot: id,
    asset: { assetId: assetA, checksumSha256: "a".repeat(64), role: "unit_extra_video", slot: id },
    fileName: "welcome.mp4",
    byteSize: 12_345,
    durationMs: 8_000,
    cues: [],
    ...overrides,
  };
}

function audio(id = audioA, overrides = {}) {
  return { id, title: "Pronunciation extra", assetSlot: id, asset: { assetId: audioAssetA, checksumSha256: "b".repeat(64), role: "unit_extra_audio", slot: id }, fileName: "pronunciation.mp3", byteSize: 4_321, ...overrides };
}

function document(videos = [video(videoA)], pages = []) {
  return {
    schemaVersion: "1.0",
    units: [{ unitId: "unit-1", unitNumber: 1, categories: { videos } }],
    pages,
  };
}

test("Unit Extras accepts legacy absence, empty collections, and a required MP4 without SRT", () => {
  assert.deepEqual(normalizeUltimateB2UnitExtrasDocument(createEmptyUltimateB2UnitExtras()), createEmptyUltimateB2UnitExtras());
  const normalized = normalizeUltimateB2UnitExtrasDocument(document());
  assert.deepEqual(normalized.units[0].categories.videos[0].cues, []);
  assert.doesNotThrow(() => projectUltimateB2UnitExtrasForPublication(normalized));
  assert.throws(() => projectUltimateB2UnitExtrasForPublication(document([video(videoA, { asset: null, fileName: "", byteSize: null, durationMs: null })])), /requires a managed MP4/);
});

test("Unit Extras keeps stable authored order and validates one, many, duplicate, and malformed identities", () => {
  const many = normalizeUltimateB2UnitExtrasDocument(document([video(videoB), video(videoA)]));
  assert.deepEqual(many.units[0].categories.videos.map((entry) => entry.id), [videoB, videoA]);
  assert.deepEqual(normalizeUltimateB2UnitExtrasDocument(structuredClone(many)), many);
  assert.throws(() => normalizeUltimateB2UnitExtrasDocument(document([video(videoA), video(videoA)])), /identities must be unique/);
  assert.throws(() => normalizeUltimateB2UnitExtrasDocument({ ...document(), units: [{ unitId: "unit-2", unitNumber: 1, categories: { videos: [] } }] }), /identity is invalid/);
  assert.throws(() => normalizeUltimateB2UnitExtrasDocument({ ...document(), unexpected: true }), /unsupported fields/);
});

test("Page visibility is independently Unit-bound and legacy Pages default off", () => {
  const firstOnly = normalizeUltimateB2UnitExtrasDocument(document([video(videoA)], [
    { pageId: pageA.id, unitId: "unit-1", extrasVisibility: { videos: true } },
    { pageId: pageB.id, unitId: "unit-1", extrasVisibility: { videos: false } },
  ]));
  assert.equal(firstOnly.pages[0].extrasVisibility.videos, true);
  assert.equal(firstOnly.pages[1].extrasVisibility.videos, false);
  assert.equal(normalizeUltimateB2UnitExtrasDocument(document()).pages.length, 0);
  assert.throws(() => normalizeUltimateB2UnitExtrasDocument(document([video(videoA)], [
    { pageId: pageA.id, unitId: "unit-2", extrasVisibility: { videos: true } },
  ])), /does not belong to its Unit/);
});

test("standalone Unit Extra MP3 normalizes, publishes, and uses independent page visibility", () => {
  const legacy = normalizeUltimateB2UnitExtrasDocument(document());
  assert.deepEqual(legacy.units[0].categories.audios, []);
  assert.equal(legacy.pages.length, 0);
  const authored = document();
  authored.units[0].categories.audios = [audio()];
  authored.pages = [{ pageId: pageA.id, unitId: "unit-1", extrasVisibility: { videos: false, audios: true } }];
  const published = projectUltimateB2UnitExtrasForPublication(authored);
  assert.deepEqual(published.units[0].categories.audios[0], { id: audioA, title: "Pronunciation extra", audio: { assetSlot: audioA, asset: audio().asset } });
  assert.deepEqual(normalizePublishedUltimateB2UnitExtras(published), published);
  assert.deepEqual(unitExtraAudiosForPage({ kind: "published", projection: { unitExtras: published } }, { unitNumber: 1, pageId: pageA.id }).map((entry) => entry.id), [audioA]);
  assert.throws(() => projectUltimateB2UnitExtrasForPublication({ ...authored, units: [{ ...authored.units[0], categories: { ...authored.units[0].categories, audios: [audio(audioA, { asset: null, fileName: "", byteSize: null })] } }] }), /requires a managed MP3/);
  assert.throws(() => normalizeUltimateB2UnitExtrasDocument({ ...authored, units: [{ ...authored.units[0], categories: { ...authored.units[0].categories, audios: [audio(audioA, { asset: { ...audio().asset, role: "unit_extra_video" } })] } }] }), /asset is invalid/);
});

test("optional normalized SRT is accepted and invalid or out-of-duration cues fail closed", () => {
  const cue = { id: cueA, startMs: 500, endMs: 2_000, text: "Welcome." };
  const projected = projectUltimateB2UnitExtrasForPublication(document([video(videoA, { cues: [cue] })]));
  assert.deepEqual(projected.units[0].categories.videos[0].video.cues, [cue]);
  assert.deepEqual(normalizePublishedUltimateB2UnitExtras(projected), projected);
  assert.throws(() => normalizeUltimateB2UnitExtrasDocument(document([video(videoA, { cues: [{ ...cue, endMs: 9_000 }] })])), /beyond the MP4 duration/);
  assert.throws(() => normalizeUltimateB2UnitExtrasDocument(document([video(videoA, { cues: [{ ...cue, text: "" }] })])), /required/);
});

test("native Activity Video still requires SRT while Unit Extra player hides captions without cues", async () => {
  const [editor, player] = await Promise.all([
    readFile(new URL("../src/apps/book-builder/hosted/NativeVideoEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/native-video/NativeVideoPlayer.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /video\?\.assetSlot && video\.cues\?\.length && video\.durationMs > 0/);
  assert.match(editor, /SRT subtitles required/);
  assert.match(player, /video\.cues\.length \? <button[^>]*className="native-video-captions"/);
  assert.match(player, /videoRef\.current\?\.play\(\)\.catch/);
});

test("Unit Extras modal owns one responsive inner scroll region", async () => {
  const [modal, editor, styles] = await Promise.all([
    readFile(new URL("../src/apps/book-builder/hosted/BuilderModal.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/ultimate-b2-builder/UnitExtrasEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/ultimate-b2-builder/hostedUltimateB2BuilderModern.css", import.meta.url), "utf8"),
  ]);
  assert.match(modal, /className=\{`builder-modal \$\{className\}`\.trim\(\)\}/);
  assert.match(editor, /className="builder-modal--unit-extras"/);
  assert.match(editor, /className="unit-extras-editor-scroll"/);
  assert.match(styles, /\.builder-modal\.builder-modal--unit-extras[^}]*max-height:calc\(100dvh - 40px\)[^}]*overflow:hidden/);
  assert.match(styles, /\.unit-extras-editor-scroll[^}]*min-height:0[^}]*overflow:auto/);
  assert.doesNotMatch(styles, /\.unit-extras-editor \{[^}]*min-width:min\(760px,82vw\)|\.unit-extras-editor \{[^}]*overflow:auto|\.unit-extras-editor > footer[^}]*position:sticky/);
  assert.match(styles, /unit-extra-video-card dd[^}]*overflow-wrap:anywhere/);
});

test("migration 044 owns Unit Extra uploads without fake activities and extends exact source freshness", async () => {
  const migration = await readFile(new URL("../database/044_builder_unit_extra_asset_uploads.sql", import.meta.url), "utf8");
  assert.match(migration, /create table if not exists builder_unit_extra_asset_upload_sessions/);
  assert.match(migration, /foreign key \(unit_id, book_component_id\)[\s\S]*references units\(id, book_component_id\)/);
  assert.match(migration, /prepare_builder_unit_extra_asset_upload[\s\S]*role='developer'/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /claim_builder_unit_extra_asset_upload/);
  assert.match(migration, /complete_builder_unit_extra_asset_upload/);
  assert.match(migration, /fail_builder_unit_extra_asset_upload/);
  assert.match(migration, /session\.book_component_id[\s\S]*session\.unit_id[\s\S]*null,null/);
  assert.match(migration, /asset\.activity_id is not null or existing_asset\.page_id is not null|existing_asset\.activity_id is not null or existing_asset\.page_id is not null/);
  assert.match(migration, /source_snapshot \? 'unitExtras'/);
  assert.match(migration, /document_type='unit_extras' and document_key='default'/);
  assert.doesNotMatch(migration, /insert into activities|alter table book_assets|drop table|drop column/i);
});

test("Viewer renders accessible lower-right Unit Extra Audio without colliding with video controls", async () => {
  const [audioPlayer, audioCss, viewer, teacher] = await Promise.all([
    readFile(new URL("../src/components/lms/books/BookUnitExtraAudios.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/lms/books/BookUnitExtraAudios.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/lms/books/BookPageViewer.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/android-teacher-offline/TeacherClassroomPages.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(audioPlayer, /<audio ref=\{audioRef\} controls preload="metadata"/);
  assert.match(audioPlayer, /audioRef\.current\.pause\(\)/);
  assert.match(audioPlayer, /setActiveId\(""\)/);
  assert.match(audioPlayer, /audios\.length > 1/);
  assert.match(audioPlayer, /BookUnitExtraAudiosForPublication\(\{ publication,/);
  assert.match(audioPlayer, /BookUnitExtraAudiosForPublication \{\.\.\.props\} publication=\{publication\}/);
  assert.match(audioCss, /right:max\(20px,env\(safe-area-inset-right\)\); bottom:max\(18px,env\(safe-area-inset-bottom\)\)/);
  assert.match(audioCss, /book-page-extra-videos:has\(~ \.book-page-extra-audios\)/);
  assert.match(viewer, /<BookUnitExtraVideos[\s\S]*<BookUnitExtraAudios/);
  assert.match(teacher, /<BookUnitExtraAudiosForPublication publication=\{publication\}/);
});

test("migration 055 expands the existing fail-closed Unit Extra upload and pin contracts for MP3", async () => {
  const migration = await readFile(new URL("../database/055_builder_unit_extra_audio.sql", import.meta.url), "utf8");
  assert.match(migration, /\^\(video\|audio\)-\[a-f0-9\]\{32\}\$/);
  assert.match(migration, /category_name.*'audios'/s);
  assert.match(migration, /resolved_role.*'unit_extra_audio'/s);
  assert.match(migration, /requested_mime_type<>resolved_mime/);
  assert.match(migration, /asset_role in \('unit_extra_video','unit_extra_audio'\)/);
  assert.match(migration, /book_component_release_asset_pins/);
  assert.doesNotMatch(migration, /insert into activities|drop table|drop column/i);
});
