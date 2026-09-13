import { publicDocument, teacherDocument } from "./native-runtime-regressions/multi-part-data.js";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";

export function appendMultiPartPublicationFixture(sources, pair = { publicDocument, teacherDocument }) {
  const { publicDocument, teacherDocument } = pair;
  const activityId = publicDocument.activityId; const pageId = publicDocument.placement.pageId;
  const source = (payload) => ({ payload: structuredClone(payload), revision: 1, sha256: builderDocumentSha256(payload) });
  const index = { activityId, kind: "multi-part", placement: { pageId }, sortOrder: sources.native.index.payload.activities.length + 1 };
  sources.native.index.payload.activities.push(index); sources.native.index.sha256 = builderDocumentSha256(sources.native.index.payload);
  sources.native.activities[activityId] = { index, public: source(publicDocument), teacher: source(teacherDocument) };
  for (const reference of publicDocument.assets) sources.native.assetRows.push({ ...sources.native.assetRows[0], id: reference.assetId, checksum_sha256: reference.checksumSha256, width: reference.slot === "graphic" ? 120 : 1024, height: reference.slot === "graphic" ? 3 : 582, object_key: `builder-native-assets/ultimate-b2/ultimate-b2-students-book/${activityId}/assets/${reference.checksumSha256}.png`, source_metadata: { native_activity_id: activityId, asset_slot: reference.slot } });
  sources.documents.hotspots.payload.pages[pageId].push({ id: "hotspot-native-composition", unitNumber: 1, pageId, pageNumber: 5, left: 84, top: 4, width: 12, height: 12, label: "Multi-Part", actionType: "normalized_activity", activityKey: activityId });
  sources.documents.hotspots.sha256 = builderDocumentSha256(sources.documents.hotspots.payload);
  return sources;
}
