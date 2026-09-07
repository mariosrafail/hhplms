import { MANAGED_DRAG_DROP_VERIFICATION_PROFILES, normalizeHistoricalManagedDragDropPublic, normalizeHistoricalManagedDragDropTeacher } from "./_managed-drag-drop-history.js";
import { nativeTeacherAnswerImages, nativeTeacherAnswerAssetDescriptors, usesNativeComposition } from "../../../src/data/native-activities/nativeImageSampleAnswer.js";
import { createEmptyNativeActivityIndex, NATIVE_ACTIVITY_INDEX_SCHEMA_VERSION, NATIVE_ACTIVITY_SCHEMA_VERSION } from "../../../src/data/native-activities/nativeActivityPublic.js";
import { createEmptyUltimateB2ActivityLifecycle } from "../../../src/data/ultimate-b2/activityLifecycle.js";
import { COMPONENT_PUBLICATION_ASSET_ROLES } from "../../../src/data/ultimate-b2/componentPublicationAssetRoles.js";
import { ULTIMATE_B2_HOTSPOT_SCHEMA_VERSION, createEmptyManagedComponentHotspotManifest, validateAndNormalizeManagedComponentHotspotManifest } from "../../../scripts/ultimate-b2/hotspot-manifest.js";
import { builderDocumentSha256, stableBuilderJson } from "./_builder-content-security.js";
import { resolveNativeActivityKind } from "./_native-activity-registry.js";
import { collectNativeEntriesForPublication, validateNativePublicationAssetRows } from "./_builder-publication-compiler-v2.js";
import { resolveNativeActivityAdapter } from "./_native-activity-adapters.js";

export const ULTIMATE_B2_MANAGED_COMPONENT_RELEASE_SCHEMA_VERSION = "1.0";
export const ULTIMATE_B2_MANAGED_COMPONENT_COMPILERS = Object.freeze({
  "ultimate-b2-workbook": "ultimate-b2-workbook-v1",
  "ultimate-b2-grammar-book": "ultimate-b2-grammar-book-v1",
});

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const extensionByMediaType = Object.freeze({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" });

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} has unsupported fields.`);
}

function integer(value, minimum, maximum, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) throw new Error(`${label} is invalid.`);
  return normalized;
}

function source(value, label) {
  exact(value, ["revision", "sha256"], label);
  return { revision: integer(value.revision, 0, Number.MAX_SAFE_INTEGER, `${label} revision`), sha256: SHA256.test(String(value.sha256 || "")) ? value.sha256 : (() => { throw new Error(`${label} checksum is invalid.`); })() };
}

function componentIdentity(componentSlug) {
  const compilerId = ULTIMATE_B2_MANAGED_COMPONENT_COMPILERS[componentSlug];
  if (!compilerId) throw new Error("Managed publication component is unsupported.");
  return { bookSlug: "ultimate-b2", componentSlug, compilerId, releaseSchemaVersion: ULTIMATE_B2_MANAGED_COMPONENT_RELEASE_SCHEMA_VERSION };
}

function normalizeAssetDescriptor(value, expectedRole = null) {
  exact(value, ["sha256", "extension", "mediaType", "role"], "Managed release asset");
  const extension = String(value.extension || "").toLowerCase();
  if (!SHA256.test(String(value.sha256 || "")) || !["png", "jpg", "webp", "mp3", "mp4", "pdf", "ttf"].includes(extension)
    || !String(value.mediaType || "").includes("/") || (expectedRole && value.role !== expectedRole)) throw new Error("Managed release asset identity is invalid.");
  return { sha256: value.sha256, extension, mediaType: value.mediaType, role: value.role };
}

function normalizePage(value, componentSlug) {
  exact(value, ["id", "stableKey", "unitId", "unitSlug", "unitNumber", "unitTitle", "sectionTitle", "printedLabel", "sortOrder", "label", "image"], "Managed release page");
  if (!SAFE_ID.test(String(value.id || "")) || value.stableKey !== `${componentSlug}/pages/${value.id}` || !UUID.test(String(value.unitId || ""))
    || value.unitSlug !== `unit-${value.unitNumber}` || typeof value.unitTitle !== "string" || typeof value.sectionTitle !== "string"
    || typeof value.printedLabel !== "string" || typeof value.label !== "string") throw new Error("Managed release page identity is invalid.");
  const unitNumber = integer(value.unitNumber, 1, 10, "Managed release page Unit");
  const sortOrder = integer(value.sortOrder, 0, Number.MAX_SAFE_INTEGER, "Managed release page order");
  exact(value.image, ["sha256", "extension", "mediaType", "role", "byteSize", "width", "height"], "Managed release page image");
  const descriptor = normalizeAssetDescriptor({ sha256: value.image.sha256, extension: value.image.extension, mediaType: value.image.mediaType, role: value.image.role }, COMPONENT_PUBLICATION_ASSET_ROLES.MANAGED_PAGE_IMAGE);
  if (extensionByMediaType[descriptor.mediaType] !== descriptor.extension) throw new Error("Managed release page media type is invalid.");
  const image = { ...descriptor, byteSize: integer(value.image.byteSize, 1, Number.MAX_SAFE_INTEGER, "Managed release page byte size"), width: integer(value.image.width, 1, 16384, "Managed release page width"), height: integer(value.image.height, 1, 16384, "Managed release page height") };
  return { id: value.id, stableKey: value.stableKey, unitId: value.unitId.toLowerCase(), unitSlug: value.unitSlug, unitNumber, unitTitle: value.unitTitle.slice(0, 200), sectionTitle: value.sectionTitle.slice(0, 200), printedLabel: value.printedLabel.slice(0, 80), sortOrder, label: value.label.slice(0, 200), image };
}

function normalizeUnit(value) {
  exact(value, ["id", "slug", "title", "unitNumber", "sortOrder"], "Managed release Unit");
  const unitNumber = integer(value.unitNumber, 1, 10, "Managed release Unit number");
  if (!UUID.test(String(value.id || "")) || value.slug !== `unit-${unitNumber}` || typeof value.title !== "string") throw new Error("Managed release Unit identity is invalid.");
  return { id: value.id.toLowerCase(), slug: value.slug, title: value.title.slice(0, 200), unitNumber, sortOrder: integer(value.sortOrder, 0, Number.MAX_SAFE_INTEGER, "Managed release Unit order") };
}

function normalizeNativeMaps(publicValues, teacherValues = null, profile = "current") {
  exact(publicValues, Object.keys(publicValues || {}), "Managed native public map");
  if (teacherValues) exact(teacherValues, Object.keys(teacherValues || {}), "Managed native Teacher map");
  const publicActivities = {};
  const teacherActivities = {};
  for (const activityId of Object.keys(publicValues).sort()) {
    if (!SAFE_ID.test(activityId)) throw new Error("Managed native activity identity is invalid.");
    const publicEntry = publicValues[activityId];
    exact(publicEntry, ["kind", "document"], "Managed native public activity");
    const kind = resolveNativeActivityKind(publicEntry.kind);
    if (!kind) throw new Error("Managed native activity kind is unsupported.");
    const historical = profile !== "current" && publicEntry.kind === "drag-drop";
    const publicDocument = historical ? normalizeHistoricalManagedDragDropPublic(publicEntry.document, activityId, kind, profile) : kind.normalizePublic(publicEntry.document, activityId);
    publicActivities[activityId] = { kind: publicEntry.kind, document: publicDocument };
    if (teacherValues) {
      const teacherEntry = teacherValues[activityId];
      if (!teacherEntry) throw new Error("Managed native Teacher map is incomplete.");
      exact(teacherEntry, ["kind", "document"], "Managed native Teacher activity");
      if (teacherEntry.kind !== publicEntry.kind) throw new Error("Managed native activity kinds do not match.");
      const teacherDocument = historical ? normalizeHistoricalManagedDragDropTeacher(teacherEntry.document, activityId, kind) : kind.normalizeTeacher(teacherEntry.document, activityId);
      kind.validatePair(publicDocument, teacherDocument);
      teacherActivities[activityId] = { kind: teacherEntry.kind, document: teacherDocument };
    }
  }
  if (teacherValues && Object.keys(teacherValues).sort().join("\0") !== Object.keys(publicValues).sort().join("\0")) throw new Error("Managed native Teacher map has unsupported entries.");
  return { publicActivities, teacherActivities };
}

export function normalizeManagedReleaseSourceSnapshot(value, componentSlug) {
  componentIdentity(componentSlug);
  exact(value, ["schemaVersion", "pages", "hotspots", "activityLifecycle", "nativeIndex", "nativeActivities"], "Managed release source snapshot");
  if (value.schemaVersion !== ULTIMATE_B2_MANAGED_COMPONENT_RELEASE_SCHEMA_VERSION) throw new Error("Managed release source schema is invalid.");
  exact(value.nativeActivities, Object.keys(value.nativeActivities || {}), "Managed native source map");
  const nativeActivities = {};
  for (const activityId of Object.keys(value.nativeActivities).sort()) {
    const entry = value.nativeActivities[activityId];
    exact(entry, ["kind", "public", "teacher"], "Managed native source");
    if (!SAFE_ID.test(activityId) || !resolveNativeActivityKind(entry.kind)) throw new Error("Managed native source identity is invalid.");
    nativeActivities[activityId] = { kind: entry.kind, public: source(entry.public, "Managed native public source"), teacher: source(entry.teacher, "Managed native Teacher source") };
  }
  return { schemaVersion: value.schemaVersion, pages: source(value.pages, "Managed page source"), hotspots: source(value.hotspots, "Managed hotspot source"), activityLifecycle: source(value.activityLifecycle, "Managed lifecycle source"), nativeIndex: source(value.nativeIndex, "Managed native index source"), nativeActivities };
}

export function normalizeManagedPublicProjection(value, componentSlug, expectedCompatibility = null) {
  return normalizePublicProjection(value, componentSlug, expectedCompatibility);
}

function normalizePublicProjection(value, componentSlug, expectedCompatibility = null, profile = "current") {
  componentIdentity(componentSlug);
  exact(value, ["schemaVersion", "bookSlug", "componentSlug", "compatibility", "units", "pages", "hotspots", "nativeActivities", "assets", ...(Object.hasOwn(value, "activityOrder") ? ["activityOrder"] : [])], "Managed public release");
  if (value.schemaVersion !== ULTIMATE_B2_MANAGED_COMPONENT_RELEASE_SCHEMA_VERSION || value.bookSlug !== "ultimate-b2" || value.componentSlug !== componentSlug
    || !SHA256.test(String(value.compatibility || "")) || (expectedCompatibility && value.compatibility !== expectedCompatibility)) throw new Error("Managed public release identity is invalid.");
  const units = Array.isArray(value.units) ? value.units.map(normalizeUnit) : null;
  const pages = Array.isArray(value.pages) ? value.pages.map((page) => normalizePage(page, componentSlug)) : null;
  if (!units || units.length !== 10 || !pages || new Set(units.map((unit) => unit.id)).size !== units.length || new Set(pages.map((page) => page.id)).size !== pages.length) throw new Error("Managed release page topology is invalid.");
  const unitIds = new Set(units.map((unit) => unit.id));
  if (pages.some((page) => !unitIds.has(page.unitId))) throw new Error("Managed release page Unit is invalid.");
  const { publicActivities } = normalizeNativeMaps(value.nativeActivities, null, profile);
  const hotspots = validateAndNormalizeManagedComponentHotspotManifest(value.hotspots, { componentSlug, pages, activities: Object.values(publicActivities).map((entry) => ({ activityId: entry.document.activityId, title: entry.document.metadata.title })) });
  const assets = Array.isArray(value.assets) ? value.assets.map((asset) => normalizeAssetDescriptor(asset)) : null;
  if (!assets || new Set(assets.map((asset) => `${asset.sha256}.${asset.extension}.${asset.role}`)).size !== assets.length) throw new Error("Managed release assets are invalid.");
  const expectedPageAssets = [...new Set(pages.map((page) => `${page.image.sha256}.${page.image.extension}.${page.image.role}`))].sort();
  const actualPageAssets = assets.filter((asset) => asset.role === COMPONENT_PUBLICATION_ASSET_ROLES.MANAGED_PAGE_IMAGE).map((asset) => `${asset.sha256}.${asset.extension}.${asset.role}`).sort();
  const expectedNativeAssets = [...new Set(Object.values(publicActivities).flatMap((entry) => entry.document.assets.map((asset) => `${asset.checksumSha256}.${asset.role}`)))].sort();
  const actualNativeAssets = assets.filter((asset) => [COMPONENT_PUBLICATION_ASSET_ROLES.ACTIVITY_ARTWORK, COMPONENT_PUBLICATION_ASSET_ROLES.ACTIVITY_FONT].includes(asset.role)).map((asset) => `${asset.sha256}.${asset.role}`).sort();
  if (expectedPageAssets.join("\0") !== actualPageAssets.join("\0") || expectedNativeAssets.join("\0") !== actualNativeAssets.join("\0")
    || assets.some((asset) => ![COMPONENT_PUBLICATION_ASSET_ROLES.MANAGED_PAGE_IMAGE, COMPONENT_PUBLICATION_ASSET_ROLES.ACTIVITY_ARTWORK, COMPONENT_PUBLICATION_ASSET_ROLES.ACTIVITY_FONT].includes(asset.role))) throw new Error("Managed release asset manifest is inconsistent.");
  return { schemaVersion: value.schemaVersion, bookSlug: value.bookSlug, componentSlug, compatibility: value.compatibility, units, pages, hotspots, nativeActivities: publicActivities, ...(Object.hasOwn(value, "activityOrder") ? { activityOrder: normalizeComponentActivityOrder(value.activityOrder, { pageIds: new Set(pages.map((page) => page.id)), activityIds: new Set(Object.keys(publicActivities)), nativeActivities: publicActivities }) } : {}), assets };
}

export function normalizeManagedTeacherProjection(value, componentSlug, publicProjection) {
  return normalizeTeacherProjection(value, componentSlug, publicProjection);
}

function normalizeTeacherProjection(value, componentSlug, publicProjection, profile = "current") {
  exact(value, ["schemaVersion", "bookSlug", "componentSlug", "nativeActivities"], "Managed Teacher release");
  if (value.schemaVersion !== ULTIMATE_B2_MANAGED_COMPONENT_RELEASE_SCHEMA_VERSION || value.bookSlug !== "ultimate-b2" || value.componentSlug !== componentSlug) throw new Error("Managed Teacher release identity is invalid.");
  return { schemaVersion: value.schemaVersion, bookSlug: value.bookSlug, componentSlug, nativeActivities: normalizeNativeMaps(publicProjection.nativeActivities, value.nativeActivities, profile).teacherActivities };
}

function publicationPages(sources, componentSlug) {
  const units = (sources.pages?.units || []).map((row) => normalizeUnit({ id: String(row.id), slug: row.slug, title: row.title, unitNumber: Number(row.unit_number), sortOrder: Number(row.sort_order) }));
  const activeRows = (sources.pages?.rows || []).filter((row) => row.source_metadata?.is_active === true);
  const pages = [];
  const assetSources = new Map();
  const prefix = `${componentSlug}/pages/`;
  for (const row of activeRows) {
    const pageId = String(row.stable_key || "").startsWith(prefix) ? String(row.stable_key).slice(prefix.length) : "";
    const extension = extensionByMediaType[row.mime_type];
    if (!pageId || !row.asset_id || !row.unit_id || !extension || row.asset_role !== undefined && row.asset_role !== "page_image"
      || row.publication_status !== undefined && row.publication_status !== "draft" || row.access_level !== undefined && row.access_level !== "internal"
      || row.storage_profile !== undefined && row.storage_profile !== "private" || !SHA256.test(String(row.checksum_sha256 || ""))) throw new Error("managed_page_not_ready");
    const image = { sha256: row.checksum_sha256, extension, mediaType: row.mime_type, role: COMPONENT_PUBLICATION_ASSET_ROLES.MANAGED_PAGE_IMAGE, byteSize: Number(row.byte_size), width: Number(row.width), height: Number(row.height) };
    pages.push(normalizePage({ id: pageId, stableKey: row.stable_key, unitId: String(row.unit_id), unitSlug: row.unit_slug, unitNumber: Number(row.unit_number), unitTitle: row.unit_title || "", sectionTitle: row.source_metadata?.section_title || "", printedLabel: row.source_metadata?.printed_label || "", sortOrder: Number(row.sort_order), label: row.label, image }, componentSlug));
    const identity = `${image.sha256}.${image.extension}.${image.role}`;
    if (!assetSources.has(identity)) assetSources.set(identity, { descriptor: normalizeAssetDescriptor({ sha256: image.sha256, extension: image.extension, mediaType: image.mediaType, role: image.role }, COMPONENT_PUBLICATION_ASSET_ROLES.MANAGED_PAGE_IMAGE), row: { ...row, id: row.asset_id, asset_role: "page_image", source_metadata: { ...row.source_metadata, publication_page_id: pageId } } });
  }
  return { units, pages, assetSources: [...assetSources.values()].sort((left, right) => left.descriptor.sha256.localeCompare(right.descriptor.sha256)) };
}

function compatibility(componentSlug, nativeKinds, composition = false) {
  return builderDocumentSha256({ compilerId: componentIdentity(componentSlug).compilerId, releaseSchemaVersion: ULTIMATE_B2_MANAGED_COMPONENT_RELEASE_SCHEMA_VERSION, hotspotSchemaVersion: ULTIMATE_B2_HOTSPOT_SCHEMA_VERSION, nativeActivitySchemaVersion: NATIVE_ACTIVITY_SCHEMA_VERSION, nativeIndexSchemaVersion: NATIVE_ACTIVITY_INDEX_SCHEMA_VERSION, nativeKinds: [...nativeKinds].sort(), ...(composition ? { nativeComposition: "multi-part.v1" } : {}), releaseAssetDescriptorSchemaVersion: "1.0" });
}

export function compileUltimateB2ManagedComponentRelease(sources, componentSlug) {
  const identity = componentIdentity(componentSlug);
  const adapter = resolveNativeActivityAdapter(identity.bookSlug, componentSlug);
  if (!adapter || (sources.native?.index?.payload?.activities || []).some((entry) => !adapter.ownsActivityId?.(entry.activityId))) {
    throw new Error("Managed native activity identity is outside its component.");
  }
  const normalizedPages = publicationPages(sources, componentSlug);
  const nativeActivities = sources.native?.activities || {};
  const hotspotSource = sources.documents?.hotspots || null;
  const activityCatalog = Object.values(nativeActivities).filter((entry) => entry.public).map((entry) => ({ activityId: entry.index.activityId, title: entry.public.payload.metadata.title }));
  const hotspots = validateAndNormalizeManagedComponentHotspotManifest(hotspotSource?.payload || createEmptyManagedComponentHotspotManifest(componentSlug), { componentSlug, pages: normalizedPages.pages, activities: activityCatalog });
  const selectedNative = collectNativeEntriesForPublication(sources, hotspots);
  const nativeAssetSources = validateNativePublicationAssetRows(selectedNative, sources.native?.assetRows || []);
  const nativeKinds = new Set(selectedNative.map(([, entry]) => entry.publicDocument.kind));
  const compatibilitySha256 = compatibility(componentSlug, nativeKinds, selectedNative.some(([, entry]) => usesNativeComposition(entry.publicDocument, entry.teacherDocument)));
  const publicNative = Object.fromEntries(selectedNative.map(([activityId, entry]) => [activityId, { kind: entry.publicDocument.kind, document: entry.publicDocument }]));
  const teacherNative = Object.fromEntries(selectedNative.map(([activityId, entry]) => [activityId, { kind: entry.teacherDocument.kind, document: entry.teacherDocument }]));
  const pageSourceSha256 = builderDocumentSha256({ units: normalizedPages.units, pages: normalizedPages.pages });
  const sourceSnapshot = normalizeManagedReleaseSourceSnapshot({
    schemaVersion: ULTIMATE_B2_MANAGED_COMPONENT_RELEASE_SCHEMA_VERSION,
    pages: { revision: Number(sources.pages?.revision || 0), sha256: pageSourceSha256 },
    hotspots: hotspotSource ? { revision: hotspotSource.revision, sha256: hotspotSource.sha256 } : { revision: 0, sha256: builderDocumentSha256(createEmptyManagedComponentHotspotManifest(componentSlug)) },
    activityLifecycle: sources.documents?.activityLifecycle ? { revision: sources.documents.activityLifecycle.revision, sha256: sources.documents.activityLifecycle.sha256 } : { revision: 0, sha256: builderDocumentSha256(createEmptyUltimateB2ActivityLifecycle()) },
    nativeIndex: sources.native?.index ? { revision: sources.native.index.revision, sha256: sources.native.index.sha256 } : { revision: 0, sha256: builderDocumentSha256(createEmptyNativeActivityIndex()) },
    nativeActivities: Object.fromEntries(selectedNative.map(([activityId, entry]) => [activityId, { kind: entry.publicDocument.kind, public: { revision: entry.source.public.revision, sha256: entry.source.public.sha256 }, teacher: { revision: entry.source.teacher.revision, sha256: entry.source.teacher.sha256 } }])),
  }, componentSlug);
  const assets = [...normalizedPages.assetSources.map((sourceEntry) => sourceEntry.descriptor), ...nativeAssetSources.map((sourceEntry) => sourceEntry.descriptor)].sort((left, right) => `${left.sha256}.${left.role}`.localeCompare(`${right.sha256}.${right.role}`));
  const publicProjection = normalizeManagedPublicProjection({ bookSlug: identity.bookSlug, componentSlug, schemaVersion: identity.releaseSchemaVersion, compatibility: compatibilitySha256, units: normalizedPages.units, pages: normalizedPages.pages, hotspots, nativeActivities: publicNative, activityOrder: projectComponentActivityOrder(componentActivityOrderEntries([], { activities: Object.values(sources.native?.activities || {}).map((entry) => entry.index) }, createEmptyUltimateB2ActivityLifecycle()), new Set(Object.keys(publicNative))), assets: assets.filter((asset) => asset.role !== "native_teacher_answer") }, componentSlug, compatibilitySha256);
  const teacherProjection = normalizeManagedTeacherProjection({ schemaVersion: identity.releaseSchemaVersion, bookSlug: identity.bookSlug, componentSlug, nativeActivities: teacherNative }, componentSlug, publicProjection);
  const assetManifest = assets;
  return {
    compilerId: identity.compilerId,
    releaseSchemaVersion: identity.releaseSchemaVersion,
    compatibility: compatibilitySha256,
    sourceSnapshot,
    publicProjection,
    teacherProjection,
    assetManifest,
    nativeAssetSources: [...normalizedPages.assetSources, ...nativeAssetSources],
    sourceSnapshotSha256: builderDocumentSha256(sourceSnapshot),
    publicProjectionSha256: builderDocumentSha256(publicProjection),
    teacherProjectionSha256: builderDocumentSha256(teacherProjection),
    releaseSha256: builderDocumentSha256({ compatibility: compatibilitySha256, sourceSnapshot, publicProjection, teacherProjection }),
    stableJson: stableBuilderJson({ compatibility: compatibilitySha256, sourceSnapshot, publicProjection, teacherProjection }),
  };
}

export function verifyUltimateB2ManagedComponentRelease(release, componentSlug) {
  const identity = componentIdentity(componentSlug);
  if (release.compiler_id !== identity.compilerId || release.release_schema_version !== identity.releaseSchemaVersion) throw new Error("publication_compiler_mismatch");
  // Identity is checked before attempting the finite canonical representations.
  let entries;
  try {
    const native = release.public_projection?.nativeActivities;
    exact(native, Object.keys(native || {}), "Managed declared native map");
    entries = Object.entries(native);
    for (const [, entry] of entries) {
      exact(entry, ["kind", "document"], "Managed declared native entry");
      if (!resolveNativeActivityKind(entry.kind)) throw new Error("Unknown declared native kind.");
    }
  } catch { throw new Error("release_integrity_failed"); }
  const kinds = new Set(entries.map(([, entry]) => entry.kind));
  const expectedCompatibility = compatibility(componentSlug, kinds, entries.some(([id, entry]) => usesNativeComposition(entry.document, release.teacher_projection?.nativeActivities?.[id]?.document)));
  if (release.public_projection?.compatibility !== expectedCompatibility || release.runtime_compatibility_sha256 !== expectedCompatibility) throw new Error("release_integrity_failed");
  if (!kinds.has("drag-drop")) return verifyManagedRepresentation(release, componentSlug, expectedCompatibility);

  const matches = [];
  for (const profile of MANAGED_DRAG_DROP_VERIFICATION_PROFILES) {
    try {
      const verified = verifyManagedRepresentation(release, componentSlug, expectedCompatibility, profile);
      // A stored immutable representation must itself be canonical for this profile.
      // This rejects partial defaults and mixed public/Teacher/activity epochs, even
      // when an attacker recomputes hashes using current authoring normalization.
      if (stableBuilderJson(verified.publicProjection) !== stableBuilderJson(release.public_projection)
        || stableBuilderJson(verified.teacherProjection) !== stableBuilderJson(release.teacher_projection)) continue;
      const adapter = resolveNativeActivityAdapter(identity.bookSlug, componentSlug);
      if (entries.some(([id]) => !adapter.ownsActivityId(id))) continue;
      matches.push(verified);
    } catch {
      // A profile matches only after every structural, pairing and integrity gate.
    }
  }
  if (matches.length !== 1) throw new Error("release_integrity_failed");
  return matches[0];
}

function verifyManagedRepresentation(release, componentSlug, expectedCompatibility, profile = "current") {
  const publicProjection = normalizePublicProjection(release.public_projection, componentSlug, expectedCompatibility, profile);
  const sourceSnapshot = normalizeManagedReleaseSourceSnapshot(release.source_snapshot, componentSlug);
  const teacherProjection = normalizeTeacherProjection(release.teacher_projection, componentSlug, publicProjection, profile);
  const expectedManifest = [...publicProjection.assets, ...[...new Map(Object.values(teacherProjection.nativeActivities).flatMap((entry) => nativeTeacherAnswerAssetDescriptors(entry.document)).map((asset) => [`${asset.sha256}.${asset.extension}.${asset.role}`, asset])).values()]].sort((left, right) => `${left.sha256}.${left.role}`.localeCompare(`${right.sha256}.${right.role}`));
  if (stableBuilderJson(release.asset_manifest) !== stableBuilderJson(expectedManifest)
    || builderDocumentSha256(sourceSnapshot) !== release.source_snapshot_sha256
    || builderDocumentSha256(publicProjection) !== release.public_projection_sha256
    || builderDocumentSha256(teacherProjection) !== release.teacher_projection_sha256
    || builderDocumentSha256({ compatibility: expectedCompatibility, sourceSnapshot, publicProjection, teacherProjection }) !== release.release_sha256) throw new Error("release_integrity_failed");
  return { compatibility: expectedCompatibility, sourceSnapshot, publicProjection, teacherProjection };
}
import { componentActivityOrderEntries, projectComponentActivityOrder, normalizeComponentActivityOrder } from "../../../src/data/native-activities/nativeActivityOrder.js";
