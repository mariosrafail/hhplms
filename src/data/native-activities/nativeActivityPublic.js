import { oldschoolTranscriptFontSlots } from "./nativeOldschoolListeningTypography.js";
import { candidateNativeAudioTextAssetSlots, normalizeNativeAudioTextHotspots } from "./nativeAudioTextHotspots.js";
import { normalizeTimedTextCues, TIMED_TEXT_LIMITS } from "../timed-media/timedText.js";
import { normalizeNativePedagogicalText, normalizeNativeSingleLineText } from "./nativePedagogicalText.js";
import { supportsNativeSupplementalAudio } from "./nativeActivityKinds.js";

export const NATIVE_ACTIVITY_SCHEMA_VERSION = "1.0";
export const NATIVE_ACTIVITY_INDEX_SCHEMA_VERSION = "1.0";
export const NATIVE_ACTIVITY_PART_ID = "part-1";
export const NATIVE_READABLE_TEXT_MAXIMUM_DIMENSION = 8_192;
export const NATIVE_READABLE_TEXT_ALT_TEXT_MAXIMUM = 300;
export const NATIVE_VIDEO_FILE_NAME_MAXIMUM = 180;
export const NATIVE_VIDEO_MAXIMUM_BYTES = 100 * 1024 * 1024;
export const NATIVE_VIDEO_WORKSHEET_MAXIMUM_BYTES = 25 * 1024 * 1024;

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const SAFE_ASSET_ROLE = /^[a-z][a-z0-9_]{1,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(object(value, label)).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} has missing or unknown fields.`);
}

function safeId(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

export function normalizeNativeManagedAssetReference(input) {
  const value = structuredClone(object(input, "Native managed asset reference"));
  exactKeys(value, ["assetId", "checksumSha256", "role", "slot"], "Native managed asset reference");
  if (!UUID.test(String(value.assetId || ""))) throw new Error("Native managed asset ID is invalid.");
  if (!SHA256.test(String(value.checksumSha256 || ""))) throw new Error("Native managed asset checksum is invalid.");
  if (!SAFE_ASSET_ROLE.test(String(value.role || ""))) throw new Error("Native managed asset role is invalid.");
  return { assetId: value.assetId.toLowerCase(), checksumSha256: value.checksumSha256, role: value.role, slot: safeId(value.slot, "Native managed asset slot") };
}

function sameManagedAssetReference(left, right) {
  return left.assetId === right.assetId
    && left.checksumSha256 === right.checksumSha256
    && left.role === right.role
    && left.slot === right.slot;
}

export function mergeNativeManagedAssetReference(inputAssets, inputReference) {
  if (!Array.isArray(inputAssets)) throw new Error("Native public assets must be an array.");
  const assets = inputAssets.map(normalizeNativeManagedAssetReference);
  const reference = normalizeNativeManagedAssetReference(inputReference);
  const assetIds = new Set();
  const assetSlots = new Set();
  for (const asset of assets) {
    if (assetIds.has(asset.assetId) || assetSlots.has(asset.slot)) throw new Error("Native managed asset references must be unique by ID and slot.");
    assetIds.add(asset.assetId);
    assetSlots.add(asset.slot);
  }
  const matchingId = assets.find((asset) => asset.assetId === reference.assetId);
  const matchingSlot = assets.find((asset) => asset.slot === reference.slot);
  if (!matchingId && !matchingSlot) return [...assets, reference];
  if (!matchingId || !matchingSlot || matchingId !== matchingSlot || !sameManagedAssetReference(matchingId, reference)) {
    throw new Error("Native managed asset reference conflicts with an existing ID or slot.");
  }
  return assets;
}

export function normalizeNativeActivityPlacement(input) {
  const value = structuredClone(object(input, "Native activity placement"));
  exactKeys(value, ["pageId"], "Native activity placement");
  return { pageId: safeId(value.pageId, "Native activity page ID") };
}

export function normalizeNativeReadableText(input, assets) {
  const value = structuredClone(object(input, "Native readable text"));
  exactKeys(value, ["kind", "assetSlot", "sourceWidth", "sourceHeight", "altText"], "Native readable text");
  if (value.kind !== "image") throw new Error("Native readable text kind is invalid.");
  const reference = assets.find((asset) => asset.slot === value.assetSlot);
  if (!reference || reference.role !== "activity_artwork") throw new Error("Native readable text must reference managed activity artwork.");
  for (const [key, label] of [["sourceWidth", "width"], ["sourceHeight", "height"]]) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > NATIVE_READABLE_TEXT_MAXIMUM_DIMENSION) {
      throw new Error(`Native readable text ${label} is invalid.`);
    }
  }
  return {
    kind: "image",
    assetSlot: reference.slot,
    sourceWidth: value.sourceWidth,
    sourceHeight: value.sourceHeight,
    altText: normalizeNativePedagogicalText(value.altText, "Native readable text alt text", NATIVE_READABLE_TEXT_ALT_TEXT_MAXIMUM, { required: true, forbidMarkup: false }),
  };
}

export function nativeReadableTextAssetRequirements(publicDocument) {
  const readableText = publicDocument?.readableText;
  return readableText ? [{ slot: readableText.assetSlot, width: readableText.sourceWidth, height: readableText.sourceHeight, label: "Readable Text" }] : [];
}

export function normalizeNativeVideo(input, assets) {
  const value = structuredClone(object(input, "Native video companion"));
  const hasWorksheet = Object.hasOwn(value, "worksheet");
  exactKeys(value, ["kind", "assetSlot", "fileName", "byteSize", "durationMs", "cues", ...(hasWorksheet ? ["worksheet"] : [])], "Native video companion");
  if (value.kind !== "managed-mp4") throw new Error("Native video companion kind is invalid.");
  const reference = assets.find((asset) => asset.slot === value.assetSlot);
  if (!reference || reference.role !== "activity_artwork") throw new Error("Native video companion must reference a managed native asset.");
  const fileName = normalizeNativeSingleLineText(value.fileName, "Native video file name", NATIVE_VIDEO_FILE_NAME_MAXIMUM, { required: true, forbidMarkup: false });
  if (!/^[A-Za-z0-9][A-Za-z0-9._() -]*\.mp4$/i.test(fileName)) throw new Error("Native video file name is invalid.");
  if (!Number.isSafeInteger(value.byteSize) || value.byteSize < 1 || value.byteSize > NATIVE_VIDEO_MAXIMUM_BYTES) throw new Error("Native video byte size is invalid.");
  if (!Number.isSafeInteger(value.durationMs) || value.durationMs < 1 || value.durationMs > TIMED_TEXT_LIMITS.durationMs) throw new Error("Native video duration is invalid.");
  const cues = normalizeTimedTextCues(value.cues, { label: "Native video subtitles" });
  if (cues.some((cue) => cue.endMs > value.durationMs)) throw new Error("Native video subtitle cue exceeds the video duration.");
  const normalized = { kind: "managed-mp4", assetSlot: reference.slot, fileName, byteSize: value.byteSize, durationMs: value.durationMs, cues };
  if (hasWorksheet) {
    exactKeys(value.worksheet, ["assetSlot", "fileName", "byteSize"], "Native video worksheet");
    const worksheetReference = assets.find((asset) => asset.slot === value.worksheet.assetSlot);
    if (!worksheetReference || worksheetReference.role !== "activity_artwork" || worksheetReference.slot === reference.slot) throw new Error("Native video worksheet must reference a distinct managed native asset.");
    const worksheetFileName = normalizeNativeSingleLineText(value.worksheet.fileName, "Native video worksheet file name", NATIVE_VIDEO_FILE_NAME_MAXIMUM, { required: true, forbidMarkup: false });
    if (!/^[A-Za-z0-9][A-Za-z0-9._() -]*\.pdf$/i.test(worksheetFileName)) throw new Error("Native video worksheet file name is invalid.");
    if (!Number.isSafeInteger(value.worksheet.byteSize) || value.worksheet.byteSize < 1 || value.worksheet.byteSize > NATIVE_VIDEO_WORKSHEET_MAXIMUM_BYTES) throw new Error("Native video worksheet byte size is invalid.");
    normalized.worksheet = { assetSlot: worksheetReference.slot, fileName: worksheetFileName, byteSize: value.worksheet.byteSize };
  }
  return normalized;
}

export function nativeVideoAssetRequirements(publicDocument) {
  const video = publicDocument?.video;
  return video ? [{ slot: video.assetSlot, mediaType: "video/mp4", byteSize: video.byteSize, label: "Video MP4" }, ...(video.worksheet ? [{ slot: video.worksheet.assetSlot, mediaType: "application/pdf", byteSize: video.worksheet.byteSize, label: "Video Worksheet PDF" }] : [])] : [];
}

export function normalizeNativeSupplementalAudio(input, assets) {
  const value = structuredClone(object(input, "Native supplemental audio"));
  const hasReference = Object.hasOwn(value, "reference");
  exactKeys(value, ["assetSlot", "durationMs", ...(hasReference ? ["reference"] : [])], "Native supplemental audio");
  const audioReference = assets.find((asset) => asset.slot === value.assetSlot);
  if (!audioReference || audioReference.role !== "activity_artwork") throw new Error("Native supplemental audio must reference a managed native asset.");
  if (!Number.isSafeInteger(value.durationMs) || value.durationMs < 1 || value.durationMs > TIMED_TEXT_LIMITS.durationMs) throw new Error("Native supplemental audio duration is invalid.");
  const normalized = { assetSlot: audioReference.slot, durationMs: value.durationMs };
  if (hasReference) {
    exactKeys(value.reference, ["assetSlot", "sourceWidth", "sourceHeight", "altText"], "Native supplemental audio reference");
    const imageReference = assets.find((asset) => asset.slot === value.reference.assetSlot);
    if (!imageReference || imageReference.role !== "activity_artwork" || imageReference.slot === audioReference.slot) throw new Error("Native supplemental audio reference must use distinct managed activity artwork.");
    for (const [key, label] of [["sourceWidth", "width"], ["sourceHeight", "height"]]) {
      if (!Number.isSafeInteger(value.reference[key]) || value.reference[key] < 1 || value.reference[key] > NATIVE_READABLE_TEXT_MAXIMUM_DIMENSION) throw new Error(`Native supplemental audio reference ${label} is invalid.`);
    }
    normalized.reference = {
      assetSlot: imageReference.slot,
      sourceWidth: value.reference.sourceWidth,
      sourceHeight: value.reference.sourceHeight,
      altText: normalizeNativePedagogicalText(value.reference.altText, "Native supplemental audio reference alt text", NATIVE_READABLE_TEXT_ALT_TEXT_MAXIMUM, { required: true, forbidMarkup: false }),
    };
  }
  return normalized;
}

export function nativeSupplementalAudioAssetRequirements(publicDocument) {
  const supplementalAudio = publicDocument?.supplementalAudio;
  return supplementalAudio ? [
    { slot: supplementalAudio.assetSlot, mediaType: "audio/mpeg", label: "Supplemental MP3" },
    ...(supplementalAudio.reference ? [{ slot: supplementalAudio.reference.assetSlot, width: supplementalAudio.reference.sourceWidth, height: supplementalAudio.reference.sourceHeight, label: "Supplemental audio reference" }] : []),
  ] : [];
}

export function nativeActivityUsesManagedAssetSlot(publicDocument, slot) {
  const interaction = publicDocument?.parts?.[0]?.interaction;
  if (interaction?.kind === "multi-part" && (interaction.panels.some((panel) => panel.background?.assetSlot === slot) || interaction.sections.some((section) => nativeActivityUsesManagedAssetSlot({ parts: [{ interaction: section.interaction }] }, slot)))) return true;
  if (interaction?.kind === "oldschool-listening" && interaction.questionInteraction && nativeActivityUsesManagedAssetSlot({ parts: [{ interaction: interaction.questionInteraction }] }, slot)) return true;
  return (interaction?.kind === "oldschool-listening" && oldschoolTranscriptFontSlots(interaction).has(slot))
    || publicDocument?.readableText?.assetSlot === slot
    || publicDocument?.video?.assetSlot === slot
    || publicDocument?.video?.worksheet?.assetSlot === slot
    || publicDocument?.supplementalAudio?.assetSlot === slot
    || publicDocument?.supplementalAudio?.reference?.assetSlot === slot
    || Boolean(slot && publicDocument?.audioTextHotspots?.hotspots?.some((hotspot) => hotspot.audioAssetSlot === slot))
    || Boolean(interaction?.artwork?.some((item) => item.assetSlot === slot))
    || Boolean(interaction?.images?.some((item) => item.assetSlot === slot))
    || Boolean(interaction?.words?.some((item) => item.image?.assetSlot === slot))
    || Boolean(interaction?.panels?.some((panel) => panel.images?.some((item) => item.assetSlot === slot)))
    || interaction?.presentation?.bankWordStyle?.fontAssetSlot === slot
    || interaction?.presentation?.textStyle?.fontAssetSlot === slot
    || interaction?.presentation?.placedAnswerStyle?.fontAssetSlot === slot
    || interaction?.presentation?.backgroundAssetSlot === slot
    || Boolean(interaction?.presentation?.markerPresets?.some((marker) => marker.graphicAssetSlot === slot))
    || Boolean(interaction?.presentation?.panels?.some((panel) => panel.hotspots?.some((hotspot) => (hotspot.presentation?.fontAssetSlot === slot || hotspot.graphicAssetSlot === slot))))
    || Boolean(interaction?.questions?.some((question) => question.responseRegion?.presentation?.answerFontAssetSlot === slot))
    || Boolean(interaction?.presentation?.panels?.some((panel) => panel.images?.some((item) => item.assetSlot === slot)))
    || Boolean(interaction?.presentation?.panels?.some((panel) => panel.backgroundAssetSlot === slot))
    || interaction?.audioAssetSlot === slot
    || Boolean(interaction?.snippetHotspots?.some((hotspot) => hotspot.audioAssetSlot === slot))
    || Boolean(interaction?.panels?.some((panel) => panel.pageAssetSlot === slot))
    || Boolean(interaction?.panels?.some((panel) => panel.backgroundAssetSlot === slot));
}

export function removeNativeManagedAssetReferenceIfUnused(publicDocument, slot) {
  if (!nativeActivityUsesManagedAssetSlot(publicDocument, slot)) publicDocument.assets = publicDocument.assets.filter((asset) => asset.slot !== slot);
}

export function normalizeNativeActivityPublic(input, { normalizeInteraction, expectedActivityId = null, expectedKind = null } = {}) {
  if (typeof normalizeInteraction !== "function") throw new Error("Native public interaction normalizer is required.");
  if (input?.kind === "multi-part" && (new TextEncoder().encode(JSON.stringify(input)).length > 262144 || !Array.isArray(input.assets) || input.assets.length > 128)) throw new Error("Multi-Part aggregate content budget exceeded.");
  const value = structuredClone(object(input, "Native public activity"));
  const hasReadableText = Object.hasOwn(value, "readableText");
  const hasVideo = Object.hasOwn(value, "video");
  const hasAudioTextHotspots = Object.hasOwn(value, "audioTextHotspots");
  const hasSupplementalAudio = Object.hasOwn(value, "supplementalAudio");
  const optionalKeys = [...(hasReadableText ? ["readableText"] : []), ...(hasVideo ? ["video"] : []), ...(hasAudioTextHotspots ? ["audioTextHotspots"] : []), ...(hasSupplementalAudio ? ["supplementalAudio"] : [])];
  exactKeys(value, ["schemaVersion", "activityId", "kind", "metadata", "placement", "assets", "parts", ...optionalKeys], "Native public activity");
  if (value.schemaVersion !== NATIVE_ACTIVITY_SCHEMA_VERSION) throw new Error("Unsupported native public activity schema version.");
  const activityId = safeId(value.activityId, "Native activity ID");
  const kind = safeId(value.kind, "Native activity kind");
  if (hasSupplementalAudio && !supportsNativeSupplementalAudio(kind)) throw new Error("Native supplemental audio is not supported for this activity kind.");
  if (expectedActivityId && activityId !== expectedActivityId) throw new Error("Native public activity identity does not match its resource.");
  if (expectedKind && kind !== expectedKind) throw new Error("Native public activity kind is immutable.");
  exactKeys(value.metadata, ["title", "visibleInstructionText"], "Native public metadata");
  if (!Array.isArray(value.assets)) throw new Error("Native public assets must be an array.");
  const assets = value.assets.map(normalizeNativeManagedAssetReference);
  if (assets.some((asset) => asset.role === "native_teacher_answer")) throw new Error("Teacher answer assets cannot enter a public document.");
  const assetIds = new Set();
  const assetSlots = new Set();
  for (const asset of assets) {
    if (assetIds.has(asset.assetId) || assetSlots.has(asset.slot)) throw new Error("Native managed asset references must be unique by ID and slot.");
    assetIds.add(asset.assetId); assetSlots.add(asset.slot);
  }
  if (!Array.isArray(value.parts) || value.parts.length !== 1) throw new Error("Native activity schema v1 requires exactly one Part.");
  const part = structuredClone(object(value.parts[0], "Native activity Part"));
  exactKeys(part, ["id", "interaction"], "Native activity Part");
  if (part.id !== NATIVE_ACTIVITY_PART_ID) throw new Error("Native activity schema v1 requires stable Part ID part-1.");
  const readableText = hasReadableText ? normalizeNativeReadableText(value.readableText, assets) : null;
  const video = hasVideo ? normalizeNativeVideo(value.video, assets) : null;
  const supplementalAudio = hasSupplementalAudio ? normalizeNativeSupplementalAudio(value.supplementalAudio, assets) : null;
  const commonAssetSlots = new Set([
    ...(readableText ? [readableText.assetSlot] : []),
    ...(video ? [video.assetSlot] : []),
    ...(video?.worksheet ? [video.worksheet.assetSlot] : []),
    ...(supplementalAudio ? [supplementalAudio.assetSlot] : []),
    ...(supplementalAudio?.reference ? [supplementalAudio.reference.assetSlot] : []),
    ...(hasAudioTextHotspots ? candidateNativeAudioTextAssetSlots(value.audioTextHotspots) : []),
  ]);
  const interaction = normalizeInteraction(part.interaction, { assets, commonAssetSlots });
  const normalized = {
    schemaVersion: NATIVE_ACTIVITY_SCHEMA_VERSION,
    activityId,
    kind,
    metadata: {
      title: normalizeNativeSingleLineText(value.metadata.title, "Native activity title", 300, { required: true, forbidMarkup: false }),
      visibleInstructionText: normalizeNativePedagogicalText(value.metadata.visibleInstructionText, "Native activity instruction", 2_000, { forbidMarkup: false }),
    },
    placement: normalizeNativeActivityPlacement(value.placement),
    assets,
    parts: [{ id: NATIVE_ACTIVITY_PART_ID, interaction }],
  };
  if (readableText) normalized.readableText = readableText;
  if (video) normalized.video = video;
  if (supplementalAudio) normalized.supplementalAudio = supplementalAudio;
  if (hasAudioTextHotspots) normalized.audioTextHotspots = normalizeNativeAudioTextHotspots(value.audioTextHotspots, normalized);
  return normalized;
}

export function normalizeNativeActivityIndex(input, { allowedKinds = null } = {}) {
  const value = structuredClone(object(input, "Native activity index"));
  exactKeys(value, ["schemaVersion", "activities"], "Native activity index");
  if (value.schemaVersion !== NATIVE_ACTIVITY_INDEX_SCHEMA_VERSION || !Array.isArray(value.activities)) throw new Error("Unsupported native activity index.");
  const ids = new Set();
  const activities = value.activities.map((entry, index) => {
    const item = structuredClone(object(entry, `Native activity index entry ${index + 1}`));
    exactKeys(item, ["activityId", "kind", "placement", "sortOrder"], `Native activity index entry ${index + 1}`);
    const activityId = safeId(item.activityId, "Native activity index ID");
    const kind = safeId(item.kind, "Native activity index kind");
    if (allowedKinds && !allowedKinds.includes(kind)) throw new Error("Native activity index kind is not registered.");
    if (ids.has(activityId)) throw new Error("Native activity index IDs must be unique.");
    ids.add(activityId);
    if (!Number.isSafeInteger(item.sortOrder) || item.sortOrder < 0 || item.sortOrder > 10_000_000) throw new Error("Native activity index sort order is invalid.");
    return { activityId, kind, placement: normalizeNativeActivityPlacement(item.placement), sortOrder: item.sortOrder };
  });
  activities.sort((left, right) => left.sortOrder - right.sortOrder || left.activityId.localeCompare(right.activityId, undefined, { numeric: true }));
  return { schemaVersion: NATIVE_ACTIVITY_INDEX_SCHEMA_VERSION, activities };
}

export function createEmptyNativeActivityIndex() {
  return { schemaVersion: NATIVE_ACTIVITY_INDEX_SCHEMA_VERSION, activities: [] };
}

export function appendNativeActivityIndexEntry(index, entry, options) {
  return normalizeNativeActivityIndex({ ...structuredClone(index), activities: [...index.activities, entry] }, options);
}

export function removeNativeActivityIndexEntry(index, activityId, options) {
  const normalized = normalizeNativeActivityIndex(index, options);
  if (!normalized.activities.some((entry) => entry.activityId === activityId)) return { index: normalized, removed: false };
  return {
    index: normalizeNativeActivityIndex({
      ...normalized,
      activities: normalized.activities.filter((entry) => entry.activityId !== activityId),
    }, options),
    removed: true,
  };
}
