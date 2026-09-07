import { STUDENTS_BOOK_V3_COMPILER, STUDENTS_BOOK_V3_SCHEMA, STUDENTS_BOOK_V3_COMPATIBILITY, normalizeStudentsBookV3Sources, normalizeStudentsBookV3Public, normalizeStudentsBookV3Teacher } from "../../../src/data/ultimate-b2/componentPublicationV3.js";
import { emptyStudentsBookCurrentHotspots, normalizeStudentsBookCurrentHotspots } from "../../../src/data/ultimate-b2/studentsBookCurrentHotspots.js";
import { createEmptyNativeActivityIndex } from "../../../src/data/native-activities/nativeActivityPublic.js";
import { createEmptyHostedTeacherUiDocument, normalizeHostedTeacherUiDocument, projectHostedTeacherUiPreview } from "../../../src/data/ultimate-b2/hostedTeacherUiDocument.js";
import { createEmptyUltimateB2UnitExtras, projectUltimateB2UnitExtrasForPublication } from "../../../src/data/ultimate-b2/unitExtras.js";
import { projectComponentActivityOrder } from "../../../src/data/native-activities/nativeActivityOrder.js";
import { builderDocumentSha256, stableBuilderJson } from "./_builder-content-security.js";
import { resolveStudentsBookPageAuthority, studentsBookPageScope } from "./_students-book-page-authority.js";
import { collectNativeEntriesForPublication, validateNativePublicationAssetRows, validateUnitExtraAssetRows, NativePublicationError } from "./_builder-publication-compiler-v2.js";

export const studentsBookV3Compatibility = builderDocumentSha256(STUDENTS_BOOK_V3_COMPATIBILITY);
const extensionByType = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const assetIdentity = (asset) => `${asset.sha256}.${asset.extension}.${asset.role}`;
const sortedAssets = (assets) => [...new Map(assets.map((asset) => [assetIdentity(asset), asset])).values()].sort((a, b) => assetIdentity(a).localeCompare(assetIdentity(b)));
const source = (document, baseline) => document ? { revision: document.revision, sha256: document.sha256 } : { revision: 0, sha256: builderDocumentSha256(baseline) };

export function studentsBookPublicationPages(stored) {
  const authority = resolveStudentsBookPageAuthority(stored);
  if (authority.units.length !== 10 || authority.pages.some((page) => !page.unitId)) throw new Error("students_book_page_expansion_required");
  const units = authority.units.map((unit) => ({ id: String(unit.id), slug: unit.slug, unitNumber: Number(unit.unit_number), title: unit.title, sortOrder: Number(unit.sort_order) }));
  const nativeAssetSources = []; const canonicalAssetSources = [];
  const pages = authority.pages.map((page) => {
    let image;
    if (page.imageRow) {
      const row = page.imageRow;
      if (!row.asset_id || row.book_slug !== studentsBookPageScope.bookSlug || row.component_slug !== studentsBookPageScope.componentSlug
        || row.asset_role !== "page_image" || row.publication_status !== "draft" || row.access_level !== "internal" || row.storage_profile !== "private"
        || !row.object_key || !extensionByType[row.mime_type]) throw new Error("students_book_page_asset_invalid");
      image = { sha256: row.checksum_sha256, extension: extensionByType[row.mime_type], mediaType: row.mime_type, role: "managed_page_image", byteSize: Number(row.byte_size), width: Number(row.width), height: Number(row.height) };
      const { byteSize, width, height, ...descriptor } = image;
      nativeAssetSources.push({ descriptor, row: { ...row, id: row.asset_id, source_metadata: { ...row.source_metadata, publication_page_id: page.id } } });
    } else {
      const baseline = page.image;
      image = { sha256: baseline.checksumSha256, extension: extensionByType[baseline.mimeType], mediaType: baseline.mimeType, role: "canonical_page_image", byteSize: baseline.byteSize, width: baseline.width, height: baseline.height };
      const { byteSize, width, height, ...descriptor } = image;
      canonicalAssetSources.push({ descriptor, pageId: page.id, path: baseline.url, byteSize, width, height });
    }
    return { id: page.id, stableKey: page.stableKey, origin: page.origin, unitId: page.unitId, unitNumber: page.unitNumber, unitTitle: page.unitTitle, sectionTitle: page.sectionTitle, partNumber: page.partNumber, printedPages: [...page.printedPages], printedLabel: page.printedLabel, label: page.label, sortOrder: page.sortOrder, image };
  });
  return { units, pages, retainedPageIds: new Set(authority.retained.map((page) => page.id)), nativeAssetSources, canonicalAssetSources };
}

// Every active index entry is accounted for, including incomplete and retained
// placements. Diagnostics contain identities/reasons, never Teacher documents.
export function reconcileStudentsBookPublication(sources, pages, hotspots) {
  const linkedIds = new Set(Object.values(hotspots.pages).flat().map((hotspot) => hotspot.activityKey));
  const pageIds = new Set(pages.map((page) => page.id));
  return (sources.native?.index?.payload.activities || []).map((entry) => {
    const linked = linkedIds.has(entry.activityId); const placed = pageIds.has(entry.placement.pageId);
    let ready = false; let readinessReason = null;
    try {
      const selected = collectNativeEntriesForPublication(sources, { pages: { assessment: [{ activityKey: entry.activityId }] } });
      if (selected.length !== 1) throw new NativePublicationError("native_activity_not_found", entry.activityId);
      validateNativePublicationAssetRows(selected, sources.native?.assetRows || []);
      ready = true;
    } catch (error) { readinessReason = error instanceof NativePublicationError ? error.code : "native_activity_pair_invalid"; }
    const included = linked && placed && ready;
    return { activityId: entry.activityId, kind: entry.kind, pageId: entry.placement.pageId, linked, unplaced: !placed, ready, included, reason: !placed ? "placement_unavailable" : !ready ? readinessReason : !linked ? "no_authored_hotspot" : "included", readinessReason };
  });
}

export function compileStudentsBookReleaseV3(sources) {
  const pageLibrary = studentsBookPublicationPages(sources.pages);
  const index = sources.native?.index?.payload || createEmptyNativeActivityIndex();
  const activities = sources.native?.activities || {};
  if (index.activities.some((entry) => !/^ultimate-b2-sb-[a-z0-9-]+-o\d+$/.test(entry.activityId))
    || Object.keys(activities).sort().join("\0") !== index.activities.map((entry) => entry.activityId).sort().join("\0")) throw new Error("students_book_native_index_mismatch");
  const storedHotspots = normalizeStudentsBookCurrentHotspots(sources.documents?.hotspots?.payload || emptyStudentsBookCurrentHotspots());
  const reconciliation = reconcileStudentsBookPublication(sources, pageLibrary.pages, storedHotspots);
  const blocked = reconciliation.find((entry) => entry.linked && !entry.included);
  if (blocked) throw Object.assign(new NativePublicationError(blocked.reason, blocked.activityId), { reconciliation });
  const hotspots = normalizeStudentsBookCurrentHotspots(storedHotspots, {
    pages: pageLibrary.pages, activities: index.activities, requireActivityPage: true,
  });
  const selected = collectNativeEntriesForPublication({ ...sources, native: { ...sources.native, activities } }, hotspots);
  const nativeAssets = validateNativePublicationAssetRows(selected, sources.native?.assetRows || []);
  const extrasSource = sources.unitExtras?.document;
  const extrasDocument = extrasSource?.payload || createEmptyUltimateB2UnitExtras();
  const extrasAssets = validateUnitExtraAssetRows(extrasDocument, sources.unitExtras?.assetRows || []);
  // Deleted-page settings remain in the authored source and its checksum. They
  // are dormant in this release; unknown/foreign pages still fail validation.
  const extrasPages = extrasDocument.pages.filter((page) => !pageLibrary.retainedPageIds.has(page.pageId));
  const unitExtras = { ...projectUltimateB2UnitExtrasForPublication({ ...extrasDocument, pages: [] }), pages: structuredClone(extrasPages) };
  const uiDocument = normalizeHostedTeacherUiDocument(sources.documents?.teacherUi?.payload || createEmptyHostedTeacherUiDocument());
  const ui = projectHostedTeacherUiPreview(uiDocument);
  const publicNative = Object.fromEntries(selected.map(([id, entry]) => [id, { kind: entry.publicDocument.kind, document: entry.publicDocument }]));
  const teacherNative = Object.fromEntries(selected.map(([id, entry]) => [id, { kind: entry.teacherDocument.kind, document: entry.teacherDocument }]));
  const nativeAssetSources = [...new Map([...pageLibrary.nativeAssetSources, ...nativeAssets, ...extrasAssets].map((entry) => [assetIdentity(entry.descriptor), entry])).values()];
  const allAssets = sortedAssets([...nativeAssetSources.map((entry) => entry.descriptor), ...pageLibrary.canonicalAssetSources.map((entry) => entry.descriptor), ...Object.values(ui.assets).map((asset) => ({ sha256: asset.sha256, extension: asset.extension, mediaType: asset.mediaType, role: "teacher_ui" }))]);
  const sourceSnapshot = normalizeStudentsBookV3Sources({
    schemaVersion: STUDENTS_BOOK_V3_SCHEMA,
    pages: { revision: sources.pages.revision, sha256: builderDocumentSha256({ units: pageLibrary.units, pages: pageLibrary.pages }) },
    hotspots: source(sources.documents?.hotspots, emptyStudentsBookCurrentHotspots()),
    nativeIndex: source(sources.native?.index, createEmptyNativeActivityIndex()),
    nativeActivities: Object.fromEntries(selected.map(([id, entry]) => [id, { kind: entry.publicDocument.kind, public: source(entry.source.public), teacher: source(entry.source.teacher) }])),
    unitExtras: source(extrasSource, createEmptyUltimateB2UnitExtras()), teacherUi: source(sources.documents?.teacherUi, createEmptyHostedTeacherUiDocument()),
  });
  const publicProjection = normalizeStudentsBookV3Public({ ...studentsBookPageScope, schemaVersion: STUDENTS_BOOK_V3_SCHEMA, compatibility: studentsBookV3Compatibility, units: pageLibrary.units, pages: pageLibrary.pages, hotspots, nativeActivities: publicNative,
    activityOrder: projectComponentActivityOrder(index.activities.map((entry) => ({ ...entry, pageId: entry.placement.pageId })), new Set(Object.keys(publicNative))), unitExtras,
    assets: allAssets.filter((asset) => !["native_teacher_answer", "teacher_ui"].includes(asset.role)),
  }, studentsBookV3Compatibility);
  const teacherProjection = normalizeStudentsBookV3Teacher({ ...studentsBookPageScope, schemaVersion: STUDENTS_BOOK_V3_SCHEMA, nativeActivities: teacherNative, ui }, publicProjection);
  const value = { compatibility: studentsBookV3Compatibility, sourceSnapshot, publicProjection, teacherProjection };
  return { ...value, compilerId: STUDENTS_BOOK_V3_COMPILER, releaseSchemaVersion: STUDENTS_BOOK_V3_SCHEMA, assetManifest: allAssets, nativeAssetSources, canonicalAssetSources: pageLibrary.canonicalAssetSources, reconciliation,
    sourceSnapshotSha256: builderDocumentSha256(sourceSnapshot), publicProjectionSha256: builderDocumentSha256(publicProjection), teacherProjectionSha256: builderDocumentSha256(teacherProjection), releaseSha256: builderDocumentSha256(value), stableJson: stableBuilderJson(value) };
}
