import { NATIVE_ACTIVITY_SYSTEM_FONT_FAMILIES } from "../native-activities/nativeActivityFont.js";
import { normalizeNativeManagedAssetReference } from "../native-activities/nativeActivityPublic.js";
import {
  HOSTED_EDITABLE_UI_BINDINGS_BY_ID,
  HOSTED_TEACHER_UI_MEDIA_POLICIES,
  HOSTED_TEACHER_UI_PACKAGE_ID,
  HOSTED_TEACHER_UI_SCHEMA_VERSION,
  HOSTED_TEACHER_UI_TITLE_BINDING_IDS,
} from "./hostedTeacherUiBindingCatalog.js";

export const HOSTED_OVERVIEW_FONT_FAMILIES = NATIVE_ACTIVITY_SYSTEM_FONT_FAMILIES;

export function normalizeOverviewCaptionFontAsset(value) {
  const reference = normalizeNativeManagedAssetReference(value);
  if (reference.role !== "activity_font" || reference.slot !== `font-${reference.assetId.replaceAll("-", "")}`) throw new Error("Invalid overview caption font reference.");
  return Object.freeze(reference);
}

export function overviewCaptionFontManifest(ui) {
  if (!ui?.overviewCaptionFontAsset) return [];
  const reference = normalizeOverviewCaptionFontAsset(ui.overviewCaptionFontAsset);
  return [{ sha256: reference.checksumSha256, extension: "ttf", mediaType: "font/ttf", role: "activity_font" }];
}

function optionalSettings(candidate) {
  const settings = {};
  if (!candidate || typeof candidate !== "object") return settings;
  if (Object.hasOwn(candidate, "overviewCaptionFontAsset")) {
    if (Object.hasOwn(candidate, "overviewCaptionFontFamily")) throw new Error("Overview font selections conflict.");
    settings.overviewCaptionFontAsset = normalizeOverviewCaptionFontAsset(candidate.overviewCaptionFontAsset);
  }
  if (Object.hasOwn(candidate, "overviewCaptionFontFamily")) {
    if (!HOSTED_OVERVIEW_FONT_FAMILIES.includes(candidate.overviewCaptionFontFamily)) throw new Error("Invalid overview caption font family.");
    settings.overviewCaptionFontFamily = candidate.overviewCaptionFontFamily;
  }
  if (Object.hasOwn(candidate, "independentPartsBackgrounds")) {
    if (candidate.independentPartsBackgrounds !== true) throw new Error("Invalid independent parts backgrounds setting.");
    settings.independentPartsBackgrounds = true;
  }
  return settings;
}

// Materialize only the legacy inherited choices when an old draft is first edited.
// Immutable readers never add defaults, preserving historical document bytes/hashes.
export function independentHostedPartsAssets(document) {
  const assets = { ...document.assets };
  if (!document.independentPartsBackgrounds && assets["background.students-book-parts"]) {
    for (const id of ["background.workbook-parts", "background.grammar-book-parts"]) assets[id] ||= assets["background.students-book-parts"];
  }
  return assets;
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._() -]{0,179}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{1,79}$/;
const LEGACY_IDENTITY = Object.freeze({ bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" });

function exactObject(value, keys, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(message);
}

function normalizeAsset(bindingId, value, { publicProjection = false } = {}) {
  const binding = HOSTED_EDITABLE_UI_BINDINGS_BY_ID[bindingId];
  if (!binding) throw new Error(`Unsupported hosted Teacher UI binding: ${bindingId}`);
  const keys = ["sha256", "extension", "mediaType", "sizeBytes", "width", "height", ...(publicProjection ? [] : ["originalFilename"])];
  exactObject(value, keys, `Invalid hosted Teacher UI asset metadata: ${bindingId}`);
  const policy = HOSTED_TEACHER_UI_MEDIA_POLICIES[binding.mediaFamily];
  const sha256 = String(value.sha256 || "");
  const extension = String(value.extension || "").toLowerCase();
  const mediaType = String(value.mediaType || "").toLowerCase();
  if (!SHA256.test(sha256) || !policy.extensions.includes(extension) || !policy.mediaTypes.includes(mediaType)) throw new Error(`Invalid hosted Teacher UI asset identity: ${bindingId}`);
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 1 || value.sizeBytes > policy.maximumBytes) throw new Error(`Invalid hosted Teacher UI asset size: ${bindingId}`);
  const raster = mediaType.startsWith("image/");
  if (raster && ![value.width, value.height].every((dimension) => Number.isSafeInteger(dimension) && dimension > 0 && dimension <= 32_768)) throw new Error(`Invalid hosted Teacher UI raster dimensions: ${bindingId}`);
  if (!raster && (value.width !== null || value.height !== null)) throw new Error(`Invalid hosted Teacher UI non-raster dimensions: ${bindingId}`);
  const normalized = { sha256, extension, mediaType, sizeBytes: value.sizeBytes, width: value.width, height: value.height };
  if (!publicProjection) {
    const originalFilename = String(value.originalFilename || "");
    if (!SAFE_FILENAME.test(originalFilename) || originalFilename === "." || originalFilename === "..") throw new Error(`Invalid hosted Teacher UI filename: ${bindingId}`);
    normalized.originalFilename = originalFilename;
  }
  return Object.freeze(normalized);
}

function assertAtomicTitle(assets) {
  const present = HOSTED_TEACHER_UI_TITLE_BINDING_IDS.filter((id) => assets[id]);
  if (present.length && present.length !== HOSTED_TEACHER_UI_TITLE_BINDING_IDS.length) throw new Error("The hosted title animation must be saved or reverted as one complete GAF/atlas group.");
}

export function createEmptyHostedTeacherUiDocument(packageId = HOSTED_TEACHER_UI_PACKAGE_ID) {
  if (!SAFE_ID.test(packageId)) throw new Error("Invalid hosted Teacher UI package identity.");
  return Object.freeze({ schemaVersion: HOSTED_TEACHER_UI_SCHEMA_VERSION, packageId, assets: Object.freeze({}) });
}

export function normalizeHostedTeacherUiDocument(candidate, { packageId = HOSTED_TEACHER_UI_PACKAGE_ID } = {}) {
  exactObject(candidate, ["schemaVersion", "packageId", "assets", ...Object.keys(optionalSettings(candidate))], "Invalid hosted Teacher UI document.");
  if (!SAFE_ID.test(packageId) || candidate.schemaVersion !== HOSTED_TEACHER_UI_SCHEMA_VERSION || candidate.packageId !== packageId) throw new Error("Unsupported hosted Teacher UI document identity.");
  exactObject(candidate.assets, Object.keys(candidate.assets || {}), "Invalid hosted Teacher UI asset map.");
  const assets = Object.fromEntries(Object.entries(candidate.assets).map(([id, value]) => [id, normalizeAsset(id, value)]));
  assertAtomicTitle(assets);
  return Object.freeze({ schemaVersion: candidate.schemaVersion, packageId: candidate.packageId, ...optionalSettings(candidate), assets: Object.freeze(assets) });
}

export function projectHostedTeacherUiPreview(candidate, options) {
  const document = normalizeHostedTeacherUiDocument(candidate, options);
  const assets = Object.fromEntries(Object.entries(document.assets).map(([id, value]) => [id, normalizeAsset(id, {
    sha256: value.sha256,
    extension: value.extension,
    mediaType: value.mediaType,
    sizeBytes: value.sizeBytes,
    width: value.width,
    height: value.height,
  }, { publicProjection: true })]));
  return Object.freeze({ schemaVersion: document.schemaVersion, packageId: document.packageId, ...optionalSettings(document), assets: Object.freeze(assets) });
}

export function normalizeHostedTeacherUiPreview(candidate, { packageId = HOSTED_TEACHER_UI_PACKAGE_ID } = {}) {
  exactObject(candidate, ["schemaVersion", "packageId", "assets", ...Object.keys(optionalSettings(candidate))], "Invalid hosted Teacher UI preview.");
  if (!SAFE_ID.test(packageId) || candidate.schemaVersion !== HOSTED_TEACHER_UI_SCHEMA_VERSION || candidate.packageId !== packageId) throw new Error("Unsupported hosted Teacher UI preview identity.");
  exactObject(candidate.assets, Object.keys(candidate.assets || {}), "Invalid hosted Teacher UI preview asset map.");
  const assets = Object.fromEntries(Object.entries(candidate.assets).map(([id, value]) => [id, normalizeAsset(id, value, { publicProjection: true })]));
  assertAtomicTitle(assets);
  return Object.freeze({ schemaVersion: candidate.schemaVersion, packageId: candidate.packageId, ...optionalSettings(candidate), assets: Object.freeze(assets) });
}

export function hostedTeacherUiAssetPath(asset, identity = LEGACY_IDENTITY) {
  const { bookSlug, componentSlug } = identity || {};
  if (!SAFE_ID.test(bookSlug) || !SAFE_ID.test(componentSlug)) throw new Error("Invalid hosted Teacher UI asset identity.");
  const parameters = new URLSearchParams(globalThis.location?.search || "");
  const releaseIds = parameters.getAll("releaseId");
  if (releaseIds.length === 1 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(releaseIds[0])) {
    return `/preview/releases/books/${bookSlug}/components/${componentSlug}/${releaseIds[0].toLowerCase()}/assets/${asset.sha256}.${asset.extension}`;
  }
  return bookSlug === LEGACY_IDENTITY.bookSlug && componentSlug === LEGACY_IDENTITY.componentSlug
    ? `/preview/ui-assets-v2/${asset.sha256}.${asset.extension}`
    : `/preview/ui-assets-v2/books/${bookSlug}/components/${componentSlug}/${asset.sha256}.${asset.extension}`;
}
