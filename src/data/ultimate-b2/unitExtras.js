import { isNativeChildId } from "../native-activities/nativeChildIdentity.js";
import { normalizeTimedTextCues } from "../timed-media/timedText.js";
import { ultimateB2StudentsBookAuthoringPages } from "./studentsBookAuthoringCatalog.js";

export const ULTIMATE_B2_UNIT_EXTRAS_SCHEMA_VERSION = "1.0";
export const ULTIMATE_B2_UNIT_EXTRA_LIMITS = Object.freeze({ units: 10, videosPerUnit: 24, audiosPerUnit: 24, pages: 180, titleLength: 160 });

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_UNIT_ID = /^unit-[1-9][0-9]?$/;
const SAFE_FILENAME = /^[^\u0000-\u001f\u007f/\\]{1,180}$/;

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} has unsupported fields.`);
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label} is invalid.`);
  return value;
}

function unitIdentity(unitId, unitNumber, label) {
  if (!SAFE_UNIT_ID.test(String(unitId || "")) || unitId !== `unit-${unitNumber}` || !Number.isSafeInteger(unitNumber) || unitNumber < 1 || unitNumber > ULTIMATE_B2_UNIT_EXTRA_LIMITS.units) throw new Error(`${label} identity is invalid.`);
  return { unitId, unitNumber };
}

function title(value, label) {
  if (typeof value !== "string" || value.length > ULTIMATE_B2_UNIT_EXTRA_LIMITS.titleLength || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} is invalid.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizeAssetReference(value, slot, role, label) {
  if (value === null) return null;
  exact(value, ["assetId", "checksumSha256", "role", "slot"], label);
  if (!UUID.test(String(value.assetId || "")) || !SHA256.test(String(value.checksumSha256 || "")) || value.role !== role || value.slot !== slot) throw new Error(`${label} is invalid.`);
  return { assetId: value.assetId.toLowerCase(), checksumSha256: value.checksumSha256, role: value.role, slot: value.slot };
}

function normalizeCues(value, durationMs, label) {
  if (!Array.isArray(value)) throw new Error(`${label} cues are invalid.`);
  if (!value.length) return [];
  const cues = normalizeTimedTextCues(value, { label, idPrefix: "cue" });
  if (durationMs && cues.some((cue) => cue.endMs > durationMs)) throw new Error(`${label} contains a cue beyond the MP4 duration.`);
  return cues;
}

function normalizeAuthoringVideo(value, label) {
  exact(value, ["id", "title", "assetSlot", "asset", "fileName", "byteSize", "durationMs", "cues"], label);
  if (!isNativeChildId(value.id, "video") || value.assetSlot !== value.id) throw new Error(`${label} identity is invalid.`);
  const hasAsset = value.asset !== null;
  const fileName = String(value.fileName || "");
  const byteSize = value.byteSize;
  const durationMs = value.durationMs;
  if (hasAsset) {
    if (!SAFE_FILENAME.test(fileName)) throw new Error(`${label} filename is invalid.`);
    integer(byteSize, `${label} byte size`, 1);
    integer(durationMs, `${label} duration`, 1);
  } else if (fileName !== "" || byteSize !== null || durationMs !== null) throw new Error(`${label} draft media metadata is inconsistent.`);
  return {
    id: value.id,
    title: title(value.title, `${label} title`),
    assetSlot: value.assetSlot,
    asset: normalizeAssetReference(value.asset, value.assetSlot, "unit_extra_video", `${label} asset`),
    fileName,
    byteSize,
    durationMs,
    cues: normalizeCues(value.cues, durationMs, `${label} subtitles`),
  };
}

function normalizeAuthoringAudio(value, label) {
  exact(value, ["id", "title", "assetSlot", "asset", "fileName", "byteSize"], label);
  if (!isNativeChildId(value.id, "audio") || value.assetSlot !== value.id) throw new Error(`${label} identity is invalid.`);
  const hasAsset = value.asset !== null;
  const fileName = String(value.fileName || "");
  if (hasAsset) { if (!SAFE_FILENAME.test(fileName)) throw new Error(`${label} filename is invalid.`); integer(value.byteSize, `${label} byte size`, 1); }
  else if (fileName !== "" || value.byteSize !== null) throw new Error(`${label} draft media metadata is inconsistent.`);
  return { id: value.id, title: title(value.title, `${label} title`), assetSlot: value.assetSlot, asset: normalizeAssetReference(value.asset, value.assetSlot, "unit_extra_audio", `${label} asset`), fileName, byteSize: value.byteSize };
}

function normalizeUnit(value, index) {
  const label = `Unit Extras units[${index}]`;
  exact(value, ["unitId", "unitNumber", "categories"], label);
  const identity = unitIdentity(value.unitId, value.unitNumber, label);
  const hasAudios = Object.hasOwn(value.categories, "audios");
  exact(value.categories, ["videos", ...(hasAudios ? ["audios"] : [])], `${label} categories`);
  if (!Array.isArray(value.categories.videos) || value.categories.videos.length > ULTIMATE_B2_UNIT_EXTRA_LIMITS.videosPerUnit) throw new Error(`${label} videos are invalid.`);
  const videos = value.categories.videos.map((video, videoIndex) => normalizeAuthoringVideo(video, `${label} videos[${videoIndex}]`));
  if (hasAudios && (!Array.isArray(value.categories.audios) || value.categories.audios.length > ULTIMATE_B2_UNIT_EXTRA_LIMITS.audiosPerUnit)) throw new Error(`${label} audios are invalid.`);
  const audios = (value.categories.audios || []).map((audio, audioIndex) => normalizeAuthoringAudio(audio, `${label} audios[${audioIndex}]`));
  if (new Set(videos.map((video) => video.id)).size !== videos.length) throw new Error(`${label} video identities must be unique.`);
  if (new Set(audios.map((audio) => audio.id)).size !== audios.length) throw new Error(`${label} audio identities must be unique.`);
  return { ...identity, categories: { videos, audios } };
}

function normalizePage(value, index, { audioDefaults, pageCatalog = ultimateB2StudentsBookAuthoringPages }) {
  const label = `Unit Extras pages[${index}]`;
  exact(value, ["pageId", "unitId", "extrasVisibility"], label);
  const hasAudios = Object.hasOwn(value.extrasVisibility, "audios");
  exact(value.extrasVisibility, ["videos", ...(hasAudios ? ["audios"] : [])], `${label} visibility`);
  if (typeof value.extrasVisibility.videos !== "boolean") throw new Error(`${label} video visibility is invalid.`);
  if (typeof value.pageId !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(value.pageId) || !/^unit-(?:[1-9]|10)$/.test(value.unitId)) throw new Error(`${label} identity is invalid.`);
  if (pageCatalog !== null) {
    const page = pageCatalog.find((candidate) => candidate.id === value.pageId);
    if (!page || value.unitId !== `unit-${page.unitNumber}`) throw new Error(`${label} does not belong to its Unit.`);
  }
  if (hasAudios && typeof value.extrasVisibility.audios !== "boolean") throw new Error(`${label} audio visibility is invalid.`);
  return { pageId: value.pageId, unitId: value.unitId, extrasVisibility: { videos: value.extrasVisibility.videos, ...(hasAudios || audioDefaults ? { audios: value.extrasVisibility.audios === true } : {}) } };
}

export function createEmptyUltimateB2UnitExtras() {
  return { schemaVersion: ULTIMATE_B2_UNIT_EXTRAS_SCHEMA_VERSION, units: [], pages: [] };
}

function normalizeAuthoringDocument(value, pageCatalog = ultimateB2StudentsBookAuthoringPages) {
  exact(value, ["schemaVersion", "units", "pages"], "Unit Extras");
  if (value.schemaVersion !== ULTIMATE_B2_UNIT_EXTRAS_SCHEMA_VERSION) throw new Error("Unit Extras schema version is invalid.");
  if (!Array.isArray(value.units) || value.units.length > ULTIMATE_B2_UNIT_EXTRA_LIMITS.units || !Array.isArray(value.pages) || value.pages.length > ULTIMATE_B2_UNIT_EXTRA_LIMITS.pages) throw new Error("Unit Extras collections are invalid.");
  const units = value.units.map(normalizeUnit);
  if (new Set(units.map((unit) => unit.unitId)).size !== units.length) throw new Error("Unit Extras Unit identities must be unique.");
  const pages = value.pages.map((page, index) => normalizePage(page, index, { audioDefaults: true, pageCatalog }));
  if (new Set(pages.map((page) => page.pageId)).size !== pages.length) throw new Error("Unit Extras Page identities must be unique.");
  return { schemaVersion: value.schemaVersion, units, pages };
}

export function normalizeUltimateB2UnitExtrasDocument(value) {
  return normalizeAuthoringDocument(value);
}

// Current storage validation is structural only. Server callers must also
// resolve current page membership. Never persist this normalizer's read model:
// whitespace, ordering and absent audio fields belong to the authored identity.
export function validateCurrentUnitExtrasStructure(value) {
  normalizeAuthoringDocument(value, null);
  for (const unit of value.units) for (const item of [...unit.categories.videos, ...(unit.categories.audios || [])]) {
    if (typeof item.fileName !== "string") throw new Error("Unit Extra filename is invalid.");
  }
  return structuredClone(value);
}

export function projectUltimateB2UnitExtrasForPublication(value) {
  return projectDocument(normalizeUltimateB2UnitExtrasDocument(value));
}

export function projectCurrentUnitExtras(value, { pages, retained = [] }) {
  validateCurrentUnitExtrasStructure(value);
  const document = normalizeAuthoringDocument(value, [...pages, ...retained]);
  const active = new Set(pages.map((page) => page.id));
  return { ...projectDocument(document), pages: structuredClone(value.pages.filter((page) => active.has(page.pageId))) };
}

function projectDocument(document) {
  const units = document.units.map((unit) => ({
    unitId: unit.unitId,
    unitNumber: unit.unitNumber,
    categories: {
      videos: unit.categories.videos.map((video) => {
        if (!video.asset || !video.durationMs) throw new Error(`Unit Extra Video ${video.id} requires a managed MP4.`);
        return { id: video.id, title: video.title, video: { assetSlot: video.assetSlot, asset: video.asset, durationMs: video.durationMs, cues: video.cues } };
      }),
      audios: unit.categories.audios.map((audio) => {
        if (!audio.asset) throw new Error(`Unit Extra Audio ${audio.id} requires a managed MP3.`);
        return { id: audio.id, title: audio.title, audio: { assetSlot: audio.assetSlot, asset: audio.asset } };
      }),
    },
  }));
  return { schemaVersion: document.schemaVersion, units, pages: document.pages };
}

export function normalizePublishedUltimateB2UnitExtras(value) {
  return normalizePublishedDocument(value);
}

// Draft envelopes are authorized and membership-checked by the current server.
// Immutable v1/v2 readers continue to use the historical default above.
export function normalizeCurrentPublishedUnitExtras(value) {
  return normalizePublishedDocument(value, null);
}

function normalizePublishedDocument(value, pageCatalog = ultimateB2StudentsBookAuthoringPages) {
  exact(value, ["schemaVersion", "units", "pages"], "Published Unit Extras");
  if (value.schemaVersion !== ULTIMATE_B2_UNIT_EXTRAS_SCHEMA_VERSION || !Array.isArray(value.units) || !Array.isArray(value.pages)) throw new Error("Published Unit Extras are invalid.");
  const units = value.units.map((unit, unitIndex) => {
    const label = `Published Unit Extras units[${unitIndex}]`;
    exact(unit, ["unitId", "unitNumber", "categories"], label);
    const identity = unitIdentity(unit.unitId, unit.unitNumber, label);
    const hasAudios = Object.hasOwn(unit.categories, "audios");
    exact(unit.categories, ["videos", ...(hasAudios ? ["audios"] : [])], `${label} categories`);
    if (!Array.isArray(unit.categories.videos) || unit.categories.videos.length > ULTIMATE_B2_UNIT_EXTRA_LIMITS.videosPerUnit) throw new Error(`${label} videos are invalid.`);
    const videos = unit.categories.videos.map((entry, videoIndex) => {
      const videoLabel = `${label} videos[${videoIndex}]`;
      exact(entry, ["id", "title", "video"], videoLabel);
      if (!isNativeChildId(entry.id, "video")) throw new Error(`${videoLabel} identity is invalid.`);
      exact(entry.video, ["assetSlot", "asset", "durationMs", "cues"], `${videoLabel} media`);
      if (entry.video.assetSlot !== entry.id) throw new Error(`${videoLabel} media identity is invalid.`);
      const durationMs = integer(entry.video.durationMs, `${videoLabel} duration`, 1);
      return { id: entry.id, title: title(entry.title, `${videoLabel} title`), video: { assetSlot: entry.video.assetSlot, asset: normalizeAssetReference(entry.video.asset, entry.video.assetSlot, "unit_extra_video", `${videoLabel} asset`), durationMs, cues: normalizeCues(entry.video.cues, durationMs, `${videoLabel} subtitles`) } };
    });
    if (hasAudios && (!Array.isArray(unit.categories.audios) || unit.categories.audios.length > ULTIMATE_B2_UNIT_EXTRA_LIMITS.audiosPerUnit)) throw new Error(`${label} audios are invalid.`);
    const audios = (unit.categories.audios || []).map((entry, audioIndex) => {
      const audioLabel = `${label} audios[${audioIndex}]`; exact(entry, ["id", "title", "audio"], audioLabel);
      if (!isNativeChildId(entry.id, "audio")) throw new Error(`${audioLabel} identity is invalid.`);
      exact(entry.audio, ["assetSlot", "asset"], `${audioLabel} media`);
      if (entry.audio.assetSlot !== entry.id) throw new Error(`${audioLabel} media identity is invalid.`);
      return { id: entry.id, title: title(entry.title, `${audioLabel} title`), audio: { assetSlot: entry.audio.assetSlot, asset: normalizeAssetReference(entry.audio.asset, entry.audio.assetSlot, "unit_extra_audio", `${audioLabel} asset`) } };
    });
    if (new Set(videos.map((video) => video.id)).size !== videos.length || videos.some((video) => !video.video.asset)) throw new Error(`${label} videos are invalid.`);
    if (new Set(audios.map((audio) => audio.id)).size !== audios.length || audios.some((audio) => !audio.audio.asset)) throw new Error(`${label} audios are invalid.`);
    // Absence is part of historical immutable identity; explicit audio fields
    // still undergo the same validation and must never be stripped.
    return { ...identity, categories: { videos, ...(hasAudios ? { audios } : {}) } };
  });
  if (new Set(units.map((unit) => unit.unitId)).size !== units.length) throw new Error("Published Unit identities must be unique.");
  const pages = value.pages.map((page, index) => normalizePage(page, index, { audioDefaults: false, pageCatalog }));
  if (new Set(pages.map((page) => page.pageId)).size !== pages.length) throw new Error("Published Page identities must be unique.");
  return { schemaVersion: value.schemaVersion, units, pages };
}

export function unitExtrasForPage(publication, { unitNumber, pageId } = {}) {
  const extras = ["published", "draft"].includes(publication?.kind) ? publication.projection?.unitExtras : null;
  if (!extras) return [];
  const page = extras.pages.find((entry) => entry.pageId === pageId && entry.unitId === `unit-${unitNumber}`);
  if (!page?.extrasVisibility.videos) return [];
  return extras.units.find((unit) => unit.unitNumber === unitNumber)?.categories.videos || [];
}

export function unitExtraAudiosForPage(publication, { unitNumber, pageId } = {}) {
  const extras = ["published", "draft"].includes(publication?.kind) ? publication.projection?.unitExtras : null;
  if (!extras) return [];
  const page = extras.pages.find((entry) => entry.pageId === pageId && entry.unitId === `unit-${unitNumber}`);
  if (!page?.extrasVisibility.audios) return [];
  return extras.units.find((unit) => unit.unitNumber === unitNumber)?.categories.audios || [];
}
