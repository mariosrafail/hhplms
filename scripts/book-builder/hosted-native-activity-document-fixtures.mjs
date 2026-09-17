import { createEmptyMarkWordsVisualSolution } from "../../src/data/native-activities/nativeMarkWordsVisualTargets.js";
import { createEmptyNativeMarkWordsInteraction } from "../../src/data/native-activities/nativeMarkWords.js";

export function nativeDocumentPair(activityId, kind, pageId, title) {
  const interaction = kind === "multi-part" ? { kind, schemaVersion: "multi-part.v1", panels: [], sections: [] } : kind === "mark-the-words" ? createEmptyNativeMarkWordsInteraction() : kind === "open-response" ? { kind, surface: { width: 1024, height: 582 }, artwork: [], questions: [] }
    : kind === "image" ? { kind, surface: { width: 1024, height: 582 }, images: [] }
      : kind === "complete-sentences" ? { kind, items: [], presentation: { kind: "image-hotspot", panels: [{ id: `panel-${"0".repeat(31)}1`, backgroundAssetSlot: "", sourceWidth: 1024, sourceHeight: 582, hotspots: [] }] } }
        : kind === "listening" ? { kind, audioAssetSlot: "", audioDurationMs: 0, panels: [{ id: "panel-1", kind: "questions", sourceWidth: 1024, sourceHeight: 582 }, { id: "panel-2", kind: "synchronized-transcript", backgroundAssetSlot: "", sourceWidth: 1024, sourceHeight: 1801, transcriptArea: { x: 72, y: 120, width: 880, height: 1500 } }], artwork: [], questions: [], cues: [], snippetHotspots: [] }
          : kind === "oldschool-listening" ? { kind, audioAssetSlot: "", audioDurationMs: 0, panels: [{ id: "panel-1", kind: "questions", sourceWidth: 1024, sourceHeight: 582 }, { id: "panel-2", kind: "synchronized-page", pageAssetSlot: "", sourceWidth: 1024, sourceHeight: 1400, altText: "" }], artwork: [], questions: [], cues: [], snippetHotspots: [] }
          : kind === "drag-drop" ? { kind, words: [], presentation: { bankWordStyle: { fontFamily: "Arial", fontSize: 18, color: "#172033", fontAssetSlot: null }, placedAnswerStyle: { fontFamily: "Arial", fontSize: 21, color: "#172033", fontAssetSlot: null } }, panels: [] }
        : { kind, questions: [] };
  const solution = kind === "multi-part" ? { kind, schemaVersion: "multi-part.v1", sections: [] } : kind === "mark-the-words" ? createEmptyMarkWordsVisualSolution() : kind === "open-response" || kind === "listening" || kind === "oldschool-listening" ? { kind, modelAnswers: [] } : kind === "single-choice" ? { kind, correctAnswers: [] } : kind === "complete-sentences" ? { kind, answers: [] } : kind === "drag-drop" ? { kind, mappings: [] } : { kind };
  const publicDocument = { schemaVersion: "1.0", activityId, kind, metadata: { title, visibleInstructionText: "" }, placement: { pageId }, assets: [], parts: [{ id: "part-1", interaction }] };
  const teacherDocument = { schemaVersion: "1.0", activityId, kind, parts: [{ id: "part-1", solution }] };
  return { publicRevision: 1, teacherRevision: 1, publicDocument, teacherDocument };
}
export function managedHotspots(componentSlug) {
  return {
    bookSlug: "ultimate-b2", componentSlug, resource: "hotspots", documentKey: "default", schemaVersion: "1.0", revision: 0, source: "repository",
    document: { schemaVersion: "1.0", packageSlug: "ultimate-b2", componentSlug, pages: {} },
  };
}
