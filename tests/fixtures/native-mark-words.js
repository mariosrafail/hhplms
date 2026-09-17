import { createLegacyNativeMarkWordsInteraction } from "../../src/data/native-activities/nativeMarkWords.js";
import { resolveNativeActivityKind } from "../../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { generateNativeMarkWordsBulkCandidate } from "../../src/data/native-activities/nativeMarkWordsBulkAuthoring.js";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";

export function legacyMarkWordsPair(pair) {
  pair.publicDocument.parts[0].interaction = createLegacyNativeMarkWordsInteraction();
  pair.teacherDocument.parts[0].solution = { kind: "mark-the-words", answers: [] };
  return pair;
}
export const markWordsFixtureId = "ultimate-b2-sb-u1-p1-o95";
export function createMarkWordsFixture({ activityId = markWordsFixtureId, pageId = "ub2-sb-unit-1-part-1", source = "1. I *watch* films while my watch *charges*.\n2. They *have been working* all morning." } = {}) {
  const kind = resolveNativeActivityKind("mark-the-words"); let sequence = 0;
  const pair = legacyMarkWordsPair({ publicDocument: kind.createBlankPublic({ activityId, title: "Mark the Words fixture", placement: { pageId } }), teacherDocument: kind.createBlankTeacher({ activityId }) });
  return generateNativeMarkWordsBulkCandidate({ source, ...pair, createId: (prefix) => `${prefix}-${String(++sequence).padStart(32, "0")}` });
}

export function appendMarkWordsPublicationFixture(sources) {
  const pair = createMarkWordsFixture(); const pageId = pair.publicDocument.placement.pageId;
  const source = (payload) => ({ payload, revision: 1, sha256: builderDocumentSha256(payload) });
  const entry = { activityId: markWordsFixtureId, kind: "mark-the-words", placement: { pageId }, sortOrder: sources.native.index.payload.activities.length + 1 };
  sources.native.index.payload.activities.push(entry); sources.native.index.sha256 = builderDocumentSha256(sources.native.index.payload);
  sources.native.activities[markWordsFixtureId] = { index: entry, public: source(pair.publicDocument), teacher: source(pair.teacherDocument) };
  sources.documents.hotspots.payload.pages[pageId].push({ id: "hotspot-native-mark-words", unitNumber: 1, pageId, pageNumber: 5, left: 70, top: 4, width: 12, height: 12, label: "Mark the Words", actionType: "normalized_activity", activityKey: markWordsFixtureId });
  sources.documents.hotspots.sha256 = builderDocumentSha256(sources.documents.hotspots.payload);
  return sources;
}
