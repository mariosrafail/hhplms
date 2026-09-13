import { createOldschoolTypographyPair, typographyFont, typographyXml } from "./oldschool-typography.js";
import { previewOldschoolTranscriptTypographyXml, applyOldschoolTranscriptTypographyPreview } from "../../src/data/native-activities/nativeOldschoolListeningXml.js";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { buildBuilderFontLibraryObjectKey, buildNativeActivityAssetObjectKey } from "../../lib/book-assets/object-keys.js";

export function enrichedOldschoolTypographyPair() {
  const pair = createOldschoolTypographyPair(); const interaction = pair.publicDocument.parts[0].interaction;
  applyOldschoolTranscriptTypographyPreview(interaction, previewOldschoolTranscriptTypographyXml(typographyXml, interaction, { assets: pair.publicDocument.assets }));
  pair.publicDocument.assets.push(structuredClone(typographyFont));
  interaction.cues[0].highlightRegions[0].runs[1].typography = { fontWeight: 700, fontAssetSlot: typographyFont.slot, fontSize: 20 };
  return pair;
}

export function oldschoolTypographyAssetRows(pair) {
  const bookSlug = "ultimate-b2"; const componentSlug = "ultimate-b2-students-book";
  return pair.publicDocument.assets.map((asset) => {
    const isFont = asset.role === "activity_font"; const isAudio = asset.slot === "transcript-audio";
    const extension = isFont ? ".ttf" : isAudio ? ".mp3" : ".png";
    return { id: asset.assetId, book_slug: bookSlug, component_slug: componentSlug, checksum_sha256: asset.checksumSha256, asset_role: asset.role, mime_type: isFont ? "font/ttf" : isAudio ? "audio/mpeg" : "image/png", byte_size: isFont ? 21768 : 68, width: isFont || isAudio ? null : 1018, height: isFont || isAudio ? null : 1509, duration_seconds: isAudio ? 8 : null,
      object_key: isFont ? buildBuilderFontLibraryObjectKey({ bookSlug, componentSlug, checksum: asset.checksumSha256 }) : buildNativeActivityAssetObjectKey({ bookSlug, componentSlug, activityId: pair.publicDocument.activityId, assetSlot: asset.slot, checksum: asset.checksumSha256, extension }),
      storage_profile: "private", storage_bucket: "local-fixtures", publication_status: "draft", access_level: "internal", source_metadata: isFont ? { font_library_scope: "component" } : { native_activity_id: pair.publicDocument.activityId, asset_slot: asset.slot },
    };
  });
}

export function appendOldschoolTypographyPublication(sources, pair = enrichedOldschoolTypographyPair(), assetRows = oldschoolTypographyAssetRows(pair)) {
  const { activityId, placement } = pair.publicDocument;
  const source = (payload) => ({ payload, revision: 1, sha256: builderDocumentSha256(payload) });
  const entry = { activityId, kind: "oldschool-listening", placement, sortOrder: sources.native.index.payload.activities.length + 1 };
  sources.native.index.payload.activities.push(entry); sources.native.index.sha256 = builderDocumentSha256(sources.native.index.payload);
  sources.native.activities[activityId] = { index: entry, public: source(pair.publicDocument), teacher: source(pair.teacherDocument) };
  sources.documents.hotspots.payload.pages[placement.pageId].push({ id: "hotspot-transcript-typography", unitNumber: 1, pageId: placement.pageId, pageNumber: 5, left: 70, top: 30, width: 12, height: 12, label: "Transcript typography", actionType: "normalized_activity", activityKey: activityId });
  sources.documents.hotspots.sha256 = builderDocumentSha256(sources.documents.hotspots.payload);
  sources.native.assetRows.push(...assetRows);
  return sources;
}
