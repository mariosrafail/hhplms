import { NativeDragDropStudentSurface } from "../native-drag-drop/NativeDragDropSurface.jsx";
import { NativeOpenResponseStudentSurface } from "../native-open-response/NativeOpenResponseStudentSurface.jsx";
import { NativeSingleChoiceStudentSurface } from "../native-single-choice/NativeSingleChoiceStudentSurface.jsx";
import { nativeOldschoolListeningQuestionMode, nativeOldschoolListeningQuestionPublicDocument } from "../../data/native-activities/nativeOldschoolListening.js";
import { NativeOldschoolListeningSurface } from "./NativeOldschoolListeningSurface.jsx";

export function NativeOldschoolListeningStudentSurface({ document, assetUrl = () => "", responses = null, initialResponses = null, onResponsesChange = null, readOnly = false, ...props }) {
  const questionMode = nativeOldschoolListeningQuestionMode(document.parts[0].interaction);
  const questionPublic = nativeOldschoolListeningQuestionPublicDocument(document);
  return <NativeOldschoolListeningSurface key={`${document.activityId}:${questionMode}`} publicDocument={document} assetUrl={assetUrl} {...props} renderQuestions={({ audioHotspotPresentation, presentation, resetToken }) => questionMode === "drag-drop"
    ? <NativeDragDropStudentSurface document={questionPublic} assetUrl={assetUrl} responses={responses} initialResponses={initialResponses} onResponsesChange={onResponsesChange} readOnly={readOnly} presentation={presentation} resetToken={resetToken} audioHotspotPresentation={audioHotspotPresentation} />
    : questionMode === "single-choice"
    ? <NativeSingleChoiceStudentSurface document={questionPublic} assetUrl={assetUrl} responses={responses} initialResponses={initialResponses} onResponsesChange={onResponsesChange} readOnly={readOnly} audioHotspotPresentation={audioHotspotPresentation} />
    : <NativeOpenResponseStudentSurface document={questionPublic} assetUrl={assetUrl} responses={responses} initialResponses={initialResponses} onResponsesChange={onResponsesChange} readOnly={readOnly} audioHotspotPresentation={audioHotspotPresentation} />} />;
}
