import { NativeMultiPartStudentSurface } from "../../../native-multi-part/NativeMultiPartStudentSurface.jsx";
import { NativeMarkWordsStudentSurface } from "../../../native-mark-words/NativeMarkWordsStudentSurface.jsx";
import { NativeImageLearnerContent, NativeImagePresentation } from "../../../native-image/NativeImageSurface.jsx";
import { NativeOpenResponseStudentSurface } from "../../../native-open-response/NativeOpenResponseStudentSurface.jsx";
import { NativeSingleChoiceStudentSurface } from "../../../native-single-choice/NativeSingleChoiceStudentSurface.jsx";
import { NativeCompleteSentencesStudentSurface } from "../../../native-complete-sentences/NativeCompleteSentencesSurface.jsx";
import { NativeReadableTextPresentation } from "../../../native-readable-text/NativeReadableTextPresentation.jsx";
import "./nativeActivityText.css";
import { NativeListeningStudentSurface } from "../../../native-listening/NativeListeningSurface.jsx";
import { NativeOldschoolListeningStudentSurface } from "../../../native-oldschool-listening/NativeOldschoolListeningStudentSurface.jsx";
import { NativeDragDropStudentSurface } from "../../../native-drag-drop/NativeDragDropSurface.jsx";
import { publishedNativeAssetUrl } from "virtual:component-publication";

export function PublishedNativeStudentActivityRunner({ entry, publication, responses = null, initialResponses = null, onResponsesChange = null, readOnly = false, showMetadataHeader = true, presentation = null }) {
  const document = entry.document;
  const assetUrl = (assetId) => {
    const reference = document.assets.find((asset) => asset.assetId === assetId);
    return publishedNativeAssetUrl(publication, reference);
  };
  return <NativeReadableTextPresentation document={document} assetUrl={assetUrl} presentation={presentation}>{(activityPresentation, audioHotspotPresentation) => <article className="published-native-activity" data-native-kind={entry.kind} data-release-id={publication.releaseId} data-native-metadata={showMetadataHeader || undefined}>
    {showMetadataHeader ? <header><h2>{document.metadata.title}</h2>{document.metadata.visibleInstructionText ? <p className="native-activity-visible-instruction">{document.metadata.visibleInstructionText}</p> : null}</header> : null}
    {entry.kind === "multi-part" ? <NativeMultiPartStudentSurface presentation={activityPresentation} audioHotspotPresentation={audioHotspotPresentation} document={document} assetUrl={assetUrl} identity={publication.releaseId} responses={responses} initialResponses={initialResponses} onResponsesChange={onResponsesChange} readOnly={readOnly} /> : null}
    {entry.kind === "mark-the-words" ? <NativeMarkWordsStudentSurface audioHotspotPresentation={audioHotspotPresentation} document={document} assetUrl={assetUrl} identity={publication.releaseId} responses={responses} initialResponses={initialResponses} onResponsesChange={onResponsesChange} readOnly={readOnly} /> : null}
    {entry.kind === "image" ? <NativeImagePresentation document={document} assetUrl={assetUrl} className="native-runtime-surface" audioHotspotPresentation={audioHotspotPresentation} /> : null}
    {entry.kind === "image" && showMetadataHeader ? <NativeImageLearnerContent document={document} /> : null}
    {entry.kind === "open-response" ? <NativeOpenResponseStudentSurface document={document} assetUrl={assetUrl} responses={responses} initialResponses={initialResponses} onResponsesChange={onResponsesChange} readOnly={readOnly} audioHotspotPresentation={audioHotspotPresentation} /> : null}
    {entry.kind === "single-choice" ? <NativeSingleChoiceStudentSurface document={document} assetUrl={assetUrl} responses={responses} initialResponses={initialResponses} onResponsesChange={onResponsesChange} readOnly={readOnly} audioHotspotPresentation={audioHotspotPresentation} /> : null}
    {entry.kind === "complete-sentences" ? <NativeCompleteSentencesStudentSurface document={document} assetUrl={assetUrl} responses={responses} initialResponses={initialResponses} onResponsesChange={onResponsesChange} readOnly={readOnly} audioHotspotPresentation={audioHotspotPresentation} /> : null}
    {entry.kind === "listening" ? <NativeListeningStudentSurface document={document} assetUrl={assetUrl} responses={responses} initialResponses={initialResponses} onResponsesChange={onResponsesChange} readOnly={readOnly} presentation={activityPresentation} /> : null}
    {entry.kind === "oldschool-listening" ? <NativeOldschoolListeningStudentSurface audioHotspotPresentation={audioHotspotPresentation} document={document} assetUrl={assetUrl} responses={responses} initialResponses={initialResponses} onResponsesChange={onResponsesChange} readOnly={readOnly} presentation={activityPresentation} /> : null}
    {entry.kind === "drag-drop" ? <NativeDragDropStudentSurface audioHotspotPresentation={audioHotspotPresentation} document={document} assetUrl={assetUrl} responses={responses} initialResponses={initialResponses} onResponsesChange={onResponsesChange} readOnly={readOnly} /> : null}
  </article>}</NativeReadableTextPresentation>;
}

export { PublishedNativeStudentActivityRunner as PublishedNativeActivityRunner };
