import { NativeMultiPartTeacherSurface } from "../../../native-multi-part/NativeMultiPartTeacherSurface.jsx";
import { NativeImageTeacherPresentation } from "../../../native-image/NativeImageTeacherPresentation.jsx";
import { NativeMarkWordsTeacherSurface } from "../../../native-mark-words/NativeMarkWordsTeacherSurface.jsx";
import { useEffect, useState } from "react";

import { NativeImageLearnerContent, NativeImagePresentation } from "../../../native-image/NativeImageSurface.jsx";
import { NativeOpenResponseTeacherSurface } from "../../../native-open-response/NativeOpenResponseTeacherSurface.jsx";
import { NativeSingleChoiceTeacherSurface } from "../../../native-single-choice/NativeSingleChoiceTeacherSurface.jsx";
import { NativeCompleteSentencesTeacherSurface } from "../../../native-complete-sentences/NativeCompleteSentencesSurface.jsx";
import { NativeReadableTextPresentation } from "../../../native-readable-text/NativeReadableTextPresentation.jsx";
import "./nativeActivityText.css";
import { NativeListeningTeacherSurface } from "../../../native-listening/NativeListeningSurface.jsx";
import { NativeOldschoolListeningTeacherSurface } from "../../../native-oldschool-listening/NativeOldschoolListeningTeacherSurface.jsx";
import { NativeDragDropTeacherSurface } from "../../../native-drag-drop/NativeDragDropTeacherSurface.jsx";
import { loadPublishedNativeTeacherDocument, publishedNativeAssetUrl, publishedNativeTeacherAssetUrl } from "virtual:component-publication";

const teacherDocumentKinds = new Set(["multi-part", "image", "open-response", "single-choice", "complete-sentences", "listening", "oldschool-listening", "drag-drop", "mark-the-words"]);

export function PublishedNativeTeacherActivityRunner({ entry, publication, showMetadataHeader = true, presentation = null }) {
  const [teacherState, setTeacherState] = useState({ kind: "idle", document: null });
  const document = entry.document;
  useEffect(() => {
    setTeacherState({ kind: "idle", document: null });
    if (!teacherDocumentKinds.has(entry.kind)) return undefined;
    const controller = new AbortController();
    setTeacherState({ kind: "loading", document: null });
    loadPublishedNativeTeacherDocument(publication, document.activityId, { signal: controller.signal })
      .then((teacherDocument) => { if (!controller.signal.aborted) setTeacherState({ kind: "ready", document: teacherDocument, releaseId: publication.releaseId }); })
      .catch(() => { if (!controller.signal.aborted) setTeacherState({ kind: "error", document: null }); });
    return () => controller.abort();
  }, [document.activityId, entry.kind, publication.releaseId]);
  const currentTeacher = teacherState.releaseId === publication.releaseId && teacherState.document?.activityId === document.activityId ? teacherState.document : null;
  const assetUrl = (assetId) => {
    const reference = document.assets.find((asset) => asset.assetId === assetId);
    return publishedNativeAssetUrl(publication, reference);
  };
  const loadingLabel = ["open-response", "listening", "oldschool-listening"].includes(entry.kind) ? "Loading Teacher model answers…" : "Loading Teacher answers…";
  const errorLabel = ["open-response", "listening", "oldschool-listening"].includes(entry.kind) ? "Teacher model answers are unavailable." : "Teacher answers are unavailable.";
  return <NativeReadableTextPresentation document={document} assetUrl={assetUrl} presentation={presentation}>{(activityPresentation, audioHotspotPresentation) => <article className="published-native-activity" data-native-kind={entry.kind} data-release-id={publication.releaseId} data-native-metadata={showMetadataHeader || undefined}>
    {showMetadataHeader ? <header><h2>{document.metadata.title}</h2>{document.metadata.visibleInstructionText ? <p className="native-activity-visible-instruction">{document.metadata.visibleInstructionText}</p> : null}</header> : null}
    {entry.kind === "multi-part" && currentTeacher ? <NativeMultiPartTeacherSurface publicDocument={document} teacherDocument={currentTeacher} assetUrl={assetUrl} teacherAssetUrl={(_assetId, sectionId) => publishedNativeTeacherAssetUrl(publication, document.activityId, sectionId)} identity={publication.releaseId} presentation={activityPresentation} /> : null}
    {entry.kind === "mark-the-words" && currentTeacher ? <NativeMarkWordsTeacherSurface publicDocument={document} teacherDocument={currentTeacher} assetUrl={assetUrl} identity={publication.releaseId} presentation={activityPresentation} /> : null}
    {entry.kind === "image" ? <NativeImageTeacherPresentation key={`${document.activityId}:${publication.releaseId}`} teacherDocument={currentTeacher} teacherAssetUrl={() => publishedNativeTeacherAssetUrl(publication, document.activityId)} identity={publication.releaseId} document={document} assetUrl={assetUrl} className="native-runtime-surface" audioHotspotPresentation={audioHotspotPresentation} /> : null}
    {entry.kind === "image" && showMetadataHeader ? <NativeImageLearnerContent document={document} /> : null}
    {teacherDocumentKinds.has(entry.kind) && teacherState.kind === "loading" ? <p role="status">{loadingLabel}</p> : null}
    {teacherDocumentKinds.has(entry.kind) && teacherState.kind === "error" ? <p role="alert">{errorLabel}</p> : null}
    {entry.kind === "open-response" && currentTeacher ? <NativeOpenResponseTeacherSurface publicDocument={document} teacherDocument={currentTeacher} assetUrl={assetUrl} presentation={activityPresentation} audioHotspotPresentation={audioHotspotPresentation} /> : null}
    {entry.kind === "single-choice" && currentTeacher ? <NativeSingleChoiceTeacherSurface publicDocument={document} teacherDocument={currentTeacher} assetUrl={assetUrl} presentation={activityPresentation} audioHotspotPresentation={audioHotspotPresentation} /> : null}
    {entry.kind === "complete-sentences" && currentTeacher ? <NativeCompleteSentencesTeacherSurface publicDocument={document} teacherDocument={currentTeacher} assetUrl={assetUrl} presentation={activityPresentation} audioHotspotPresentation={audioHotspotPresentation} /> : null}
    {entry.kind === "listening" && currentTeacher ? <NativeListeningTeacherSurface publicDocument={document} teacherDocument={currentTeacher} assetUrl={assetUrl} presentation={activityPresentation} /> : null}
    {entry.kind === "oldschool-listening" && currentTeacher ? <NativeOldschoolListeningTeacherSurface publicDocument={document} teacherDocument={currentTeacher} assetUrl={assetUrl} presentation={activityPresentation} /> : null}
    {entry.kind === "drag-drop" && currentTeacher ? <NativeDragDropTeacherSurface audioHotspotPresentation={audioHotspotPresentation} publicDocument={document} teacherDocument={currentTeacher} assetUrl={assetUrl} presentation={activityPresentation} /> : null}
  </article>}</NativeReadableTextPresentation>;
}

export { PublishedNativeTeacherActivityRunner as PublishedNativeActivityRunner };
