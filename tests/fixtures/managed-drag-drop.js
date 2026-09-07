// Synthetic, deterministic inputs shared with the recorded historical Git compilers.
import { buildBuilderPageAssetObjectKey } from "../../lib/book-assets/object-keys.js";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { resolveNativeActivityKind } from "../../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { nativeChildIdFromUuid } from "../../src/data/native-activities/nativeChildIdentity.js";
const bookSlug = "ultimate-b2", componentSlug = "ultimate-b2-grammar-book", pageId = "synthetic-page-one", checksum = "a".repeat(64), privateBucket = "synthetic-private";
function sources(requestedComponentSlug = componentSlug, requestedPageId = pageId) {
  const units = Array.from({ length: 10 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    slug: `unit-${index + 1}`,
    title: `Unit ${index + 1}`,
    unit_number: index + 1,
    sort_order: index + 1,
  }));
  return {
    pages: {
      revision: 1,
      units,
      rows: [{
        id: "20000000-0000-4000-8000-000000000001",
        stable_key: `${requestedComponentSlug}/pages/${requestedPageId}`,
        label: "Workbook page one",
        sort_order: 1,
        source_metadata: { is_active: true, section_title: "Vocabulary", printed_label: "4" },
        unit_id: units[0].id,
        unit_slug: units[0].slug,
        unit_title: units[0].title,
        unit_number: 1,
        unit_sort_order: 1,
        asset_id: "30000000-0000-4000-8000-000000000001",
        asset_role: "page_image",
        object_key: buildBuilderPageAssetObjectKey({ bookSlug, componentSlug: requestedComponentSlug, pageId: requestedPageId, checksum, extension: ".png" }),
        storage_profile: "private",
        storage_bucket: privateBucket,
        publication_status: "draft",
        access_level: "internal",
        mime_type: "image/png",
        byte_size: 68,
        checksum_sha256: checksum,
        width: 1,
        height: 1,
      }],
    },
    documents: { hotspots: null, activityLifecycle: null },
    native: { index: null, activities: {}, assetRows: [] },
  };
}


export function managedDragDropSources(component = componentSlug, { font = false, multiline = false } = {}) {
  const input = sources(component, pageId);
  const activityId = `ultimate-b2-${component.endsWith("grammar-book") ? "gb" : "wb"}-unit-1-page-1-o1`;
  const child = (prefix, n) => nativeChildIdFromUuid(prefix, `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  const kind = resolveNativeActivityKind("drag-drop");
  const pub = kind.createBlankPublic({ activityId, title: "Synthetic historical drag and drop", placement: { pageId } });
  const teacher = kind.createBlankTeacher({ activityId });
  pub.assets = [{ assetId: "20000000-0000-4000-8000-000000000041", checksumSha256: "b".repeat(64), role: "activity_artwork", slot: "synthetic-panel" }];
  const interaction = pub.parts[0].interaction;
  interaction.words = [{ id: child("word", 1), text: multiline ? "Synthetic first line\nSynthetic second line" : "Synthetic word" }, { id: child("word", 2), text: "Synthetic distractor" }];
  interaction.panels = [{ id: child("panel", 11), surface: { width: 1000, height: 600 }, images: [{ id: child("img", 21), assetSlot: "synthetic-panel", area: { x: 0, y: 0, width: 1000, height: 600 }, order: 0, altText: "Synthetic illustration", decorative: false, fit: "contain", locked: false }], dropTargets: [{ id: child("target", 31), area: { x: 80, y: 420, width: 220, height: 80 }, accessibleLabel: "Synthetic blank" }] }];
  if (font) {
    const slot = "font-20000000000040008000000000000043";
    pub.assets.push({ assetId: "20000000-0000-4000-8000-000000000043", checksumSha256: "d".repeat(64), role: "activity_font", slot });
    interaction.presentation.bankWordStyle.fontAssetSlot = slot;
    interaction.presentation.bankWordStyle.color = "#123abc";
    interaction.presentation.placedAnswerStyle.fontFamily = "Georgia";
  }
  teacher.parts[0].solution.mappings = [{ targetId: child("target", 31), wordId: child("word", 1) }];
  const source = (payload, revision) => ({ payload, revision, sha256: builderDocumentSha256(payload) });
  const publicDocument = kind.normalizePublic(pub, activityId);
  const teacherDocument = kind.normalizeTeacher(teacher, activityId);
  kind.validatePair(publicDocument, teacherDocument);
  const entry = { activityId, kind: "drag-drop", placement: { pageId }, sortOrder: 1 };
  input.native.index = source({ schemaVersion: "1.0", activities: [entry] }, 2);
  input.native.activities = { [activityId]: { index: entry, public: source(publicDocument, 4), teacher: source(teacherDocument, 4) } };
  input.native.assetRows = pub.assets.map((asset) => ({ id: asset.assetId, checksum_sha256: asset.checksumSha256, asset_role: asset.role, object_key: `synthetic-only/${asset.slot}`, storage_profile: "private", storage_bucket: "synthetic-private", mime_type: asset.role === "activity_font" ? "font/ttf" : "image/png", byte_size: 68, width: 1000, height: 600, publication_status: "draft", access_level: "internal", source_metadata: asset.role === "activity_font" ? { font_library_scope: "component" } : { native_activity_id: activityId, asset_slot: asset.slot } }));
  input.documents.hotspots = source({ schemaVersion: "1.0", packageSlug: bookSlug, componentSlug: component, pages: { [pageId]: [{ id: "synthetic-activity-hotspot", unitNumber: 1, pageId, left: 4, top: 4, width: 12, height: 12, label: "Synthetic activity", actionType: "normalized_activity", activityKey: activityId }] } }, 3);
  return input;
}
export function managedDragDropReleaseRow(compiled) {
  return {
    compiler_id: compiled.compilerId,
    release_schema_version: compiled.releaseSchemaVersion,
    runtime_compatibility_sha256: compiled.compatibility,
    source_snapshot: compiled.sourceSnapshot,
    source_snapshot_sha256: compiled.sourceSnapshotSha256,
    public_projection: compiled.publicProjection,
    public_projection_sha256: compiled.publicProjectionSha256,
    teacher_projection: compiled.teacherProjection,
    teacher_projection_sha256: compiled.teacherProjectionSha256,
    asset_manifest: compiled.assetManifest,
    release_sha256: compiled.releaseSha256,
  };
}
