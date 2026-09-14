import { NativeMultiPartStudentSurface } from "../../../native-multi-part/NativeMultiPartStudentSurface.jsx";
import { NativeMultiPartTeacherSurface } from "../../../native-multi-part/NativeMultiPartTeacherSurface.jsx";
import { NativeImageTeacherPresentation } from "../../../native-image/NativeImageTeacherPresentation.jsx";
import { NativeMarkWordsStudentSurface } from "../../../native-mark-words/NativeMarkWordsStudentSurface.jsx";
import { NativeMarkWordsTeacherSurface } from "../../../native-mark-words/NativeMarkWordsTeacherSurface.jsx";
import { NativeImageLearnerContent, NativeImagePresentation } from "../../../native-image/NativeImageSurface.jsx";
import { NativeOpenResponseStudentSurface } from "../../../native-open-response/NativeOpenResponseStudentSurface.jsx";
import { NativeOpenResponseTeacherSurface } from "../../../native-open-response/NativeOpenResponseTeacherSurface.jsx";
import { NativeSingleChoiceStudentSurface } from "../../../native-single-choice/NativeSingleChoiceStudentSurface.jsx";
import { NativeSingleChoiceTeacherSurface } from "../../../native-single-choice/NativeSingleChoiceTeacherSurface.jsx";
import { NativeCompleteSentencesStudentSurface, NativeCompleteSentencesTeacherSurface } from "../../../native-complete-sentences/NativeCompleteSentencesSurface.jsx";
import { NativeReadableTextPresentation } from "../../../native-readable-text/NativeReadableTextPresentation.jsx";
import "./nativeActivityText.css";
import { NativeListeningStudentSurface, NativeListeningTeacherSurface } from "../../../native-listening/NativeListeningSurface.jsx";
import { NativeOldschoolListeningStudentSurface } from "../../../native-oldschool-listening/NativeOldschoolListeningStudentSurface.jsx";
import { NativeOldschoolListeningTeacherSurface } from "../../../native-oldschool-listening/NativeOldschoolListeningTeacherSurface.jsx";
import { NativeDragDropStudentSurface } from "../../../native-drag-drop/NativeDragDropSurface.jsx";
import { NativeDragDropTeacherSurface } from "../../../native-drag-drop/NativeDragDropTeacherSurface.jsx";
import { hostedNativeDraftAssetUrl, hostedNativeDraftTeacherAssetUrl } from "virtual:hosted-native-drafts";

export function HostedNativeDraftActivityRunner({ activityId, state, teacherMode = false, showMetadataHeader = true, presentation = null, runtimeContext, identity }) {
  if (state.kind === "loading") return <p role="status">Loading native activity draft…</p>;
  if (state.kind === "unavailable") return <p role="alert">Native activity draft was not found.</p>;
  if (state.kind === "error") return <p role="alert">Native activity draft could not be loaded.</p>;
  if (state.kind !== "ready" || !state.entry) return null;
  const { kind, document } = state.entry;
  const assetUrl = (assetId) => hostedNativeDraftAssetUrl(activityId, assetId, runtimeContext, identity);
  return <NativeReadableTextPresentation document={document} assetUrl={assetUrl} presentation={presentation}>{(activityPresentation, audioHotspotPresentation) => <article className="hosted-native-draft-activity" data-native-kind={kind} data-native-draft="true" data-native-metadata={showMetadataHeader || undefined}>
    {showMetadataHeader ? <header><h2>{document.metadata.title}</h2>{document.metadata.visibleInstructionText ? <p className="native-activity-visible-instruction">{document.metadata.visibleInstructionText}</p> : null}</header> : null}
    {kind === "multi-part" && !teacherMode ? <NativeMultiPartStudentSurface audioHotspotPresentation={audioHotspotPresentation} document={document} assetUrl={assetUrl} presentation={activityPresentation} /> : null}
    {kind === "multi-part" && teacherMode && state.teacher.entry ? <NativeMultiPartTeacherSurface audioHotspotPresentation={audioHotspotPresentation} publicDocument={document} teacherDocument={state.teacher.entry.document} assetUrl={assetUrl} teacherAssetUrl={(assetId) => hostedNativeDraftTeacherAssetUrl(activityId, assetId, runtimeContext, identity)} presentation={activityPresentation} /> : null}
    {kind === "mark-the-words" && !teacherMode ? <NativeMarkWordsStudentSurface audioHotspotPresentation={audioHotspotPresentation} document={document} assetUrl={assetUrl} /> : null}
    {kind === "mark-the-words" && teacherMode && state.teacher.kind === "loading" ? <p role="status">Loading Teacher answers…</p> : null}
    {kind === "mark-the-words" && teacherMode && !["ready", "loading"].includes(state.teacher.kind) ? <p role="alert">Teacher answers are unavailable.</p> : null}
    {kind === "mark-the-words" && teacherMode && state.teacher.kind === "ready" && state.teacher.entry ? <NativeMarkWordsTeacherSurface audioHotspotPresentation={audioHotspotPresentation} publicDocument={document} teacherDocument={state.teacher.entry.document} assetUrl={assetUrl} presentation={activityPresentation} /> : null}
    {kind === "image" && teacherMode ? <NativeImageTeacherPresentation key={`${activityId}:${state.teacher.entry?.revision || 0}`} teacherDocument={state.teacher.entry?.document} teacherAssetUrl={(assetId) => hostedNativeDraftTeacherAssetUrl(activityId, assetId, runtimeContext, identity)} document={document} assetUrl={assetUrl} className="native-runtime-surface" audioHotspotPresentation={audioHotspotPresentation} /> : null}
    {kind === "image" && !teacherMode ? <NativeImagePresentation document={document} assetUrl={assetUrl} className="native-runtime-surface" audioHotspotPresentation={audioHotspotPresentation} /> : null}
    {kind === "image" && showMetadataHeader ? <NativeImageLearnerContent document={document} /> : null}
    {kind === "open-response" && (!teacherMode || state.teacher.kind !== "ready") ? <NativeOpenResponseStudentSurface document={document} assetUrl={assetUrl} audioHotspotPresentation={audioHotspotPresentation} /> : null}
    {kind === "open-response" && teacherMode && state.teacher.kind === "loading" ? <p role="status">Loading Teacher model answers…</p> : null}
    {kind === "open-response" && teacherMode && state.teacher.kind === "error" ? <p role="alert">Teacher model answers are unavailable.</p> : null}
    {kind === "open-response" && teacherMode && state.teacher.entry ? <NativeOpenResponseTeacherSurface publicDocument={document} teacherDocument={state.teacher.entry.document} assetUrl={assetUrl} presentation={activityPresentation} audioHotspotPresentation={audioHotspotPresentation} /> : null}
    {kind === "single-choice" && !teacherMode ? <NativeSingleChoiceStudentSurface document={document} assetUrl={assetUrl} audioHotspotPresentation={audioHotspotPresentation} /> : null}
    {kind === "single-choice" && teacherMode && state.teacher.kind === "loading" ? <p role="status">Loading Teacher answers…</p> : null}
    {kind === "single-choice" && teacherMode && state.teacher.kind === "error" ? <p role="alert">Teacher answers are unavailable.</p> : null}
    {kind === "single-choice" && teacherMode && state.teacher.entry ? <NativeSingleChoiceTeacherSurface publicDocument={document} teacherDocument={state.teacher.entry.document} assetUrl={assetUrl} presentation={activityPresentation} audioHotspotPresentation={audioHotspotPresentation} /> : null}
    {kind === "complete-sentences" && !teacherMode ? <NativeCompleteSentencesStudentSurface document={document} assetUrl={assetUrl} audioHotspotPresentation={audioHotspotPresentation} /> : null}
    {kind === "complete-sentences" && teacherMode && state.teacher.kind === "loading" ? <p role="status">Loading Teacher answers…</p> : null}
    {kind === "complete-sentences" && teacherMode && state.teacher.kind === "error" ? <p role="alert">Teacher answers are unavailable.</p> : null}
    {kind === "complete-sentences" && teacherMode && state.teacher.entry ? <NativeCompleteSentencesTeacherSurface publicDocument={document} teacherDocument={state.teacher.entry.document} assetUrl={assetUrl} presentation={activityPresentation} audioHotspotPresentation={audioHotspotPresentation} /> : null}
    {kind === "listening" && !teacherMode ? <NativeListeningStudentSurface document={document} assetUrl={assetUrl} presentation={activityPresentation} /> : null}
    {kind === "listening" && teacherMode && state.teacher.kind === "loading" ? <p role="status">Loading Teacher model answers…</p> : null}
    {kind === "listening" && teacherMode && state.teacher.kind === "error" ? <p role="alert">Teacher model answers are unavailable.</p> : null}
    {kind === "listening" && teacherMode && state.teacher.entry ? <NativeListeningTeacherSurface publicDocument={document} teacherDocument={state.teacher.entry.document} assetUrl={assetUrl} presentation={activityPresentation} /> : null}
    {kind === "oldschool-listening" && !teacherMode ? <NativeOldschoolListeningStudentSurface audioHotspotPresentation={audioHotspotPresentation} document={document} assetUrl={assetUrl} presentation={activityPresentation} /> : null}
    {kind === "oldschool-listening" && teacherMode && state.teacher.kind === "loading" ? <p role="status">Loading Teacher model answers…</p> : null}
    {kind === "oldschool-listening" && teacherMode && state.teacher.kind === "error" ? <p role="alert">Teacher model answers are unavailable.</p> : null}
    {kind === "oldschool-listening" && teacherMode && state.teacher.entry ? <NativeOldschoolListeningTeacherSurface audioHotspotPresentation={audioHotspotPresentation} publicDocument={document} teacherDocument={state.teacher.entry.document} assetUrl={assetUrl} presentation={activityPresentation} /> : null}
    {kind === "drag-drop" && !teacherMode ? <NativeDragDropStudentSurface audioHotspotPresentation={audioHotspotPresentation} document={document} assetUrl={assetUrl} /> : null}
    {kind === "drag-drop" && teacherMode && state.teacher.kind === "loading" ? <p role="status">Loading Teacher answers…</p> : null}
    {kind === "drag-drop" && teacherMode && state.teacher.kind === "error" ? <p role="alert">Teacher answers are unavailable.</p> : null}
    {kind === "drag-drop" && teacherMode && state.teacher.entry ? <NativeDragDropTeacherSurface audioHotspotPresentation={audioHotspotPresentation} publicDocument={document} teacherDocument={state.teacher.entry.document} assetUrl={assetUrl} presentation={activityPresentation} /> : null}
  </article>}</NativeReadableTextPresentation>;
}
