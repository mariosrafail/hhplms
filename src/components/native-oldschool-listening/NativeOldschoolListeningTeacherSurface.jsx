import { NativeDragDropTeacherSurface } from "../native-drag-drop/NativeDragDropTeacherSurface.jsx";
import { NativeOpenResponseTeacherSurface } from "../native-open-response/NativeOpenResponseTeacherSurface.jsx";
import { NativeSingleChoiceTeacherSurface } from "../native-single-choice/NativeSingleChoiceTeacherSurface.jsx";
import { nativeOldschoolListeningQuestionMode, nativeOldschoolListeningQuestionPublicDocument, nativeOldschoolListeningQuestionTeacherDocument } from "../../data/native-activities/nativeOldschoolListening.js";
import { NativeOldschoolListeningSurface } from "./NativeOldschoolListeningSurface.jsx";

export function NativeOldschoolListeningTeacherSurface({ publicDocument, teacherDocument, assetUrl = () => "", ...props }) {
  const questionMode = nativeOldschoolListeningQuestionMode(publicDocument.parts[0].interaction);
  const questionPublic = nativeOldschoolListeningQuestionPublicDocument(publicDocument);
  const questionTeacher = nativeOldschoolListeningQuestionTeacherDocument(teacherDocument);
  return <NativeOldschoolListeningSurface key={`${publicDocument.activityId}:${questionMode}`} publicDocument={publicDocument} assetUrl={assetUrl} teacherMode {...props} renderQuestions={({ audioHotspotPresentation, presentation }) => questionMode === "drag-drop"
    ? <NativeDragDropTeacherSurface publicDocument={questionPublic} teacherDocument={questionTeacher} assetUrl={assetUrl} presentation={presentation} audioHotspotPresentation={audioHotspotPresentation} />
    : questionMode === "single-choice"
    ? <NativeSingleChoiceTeacherSurface publicDocument={questionPublic} teacherDocument={questionTeacher} assetUrl={assetUrl} presentation={presentation} audioHotspotPresentation={audioHotspotPresentation} navigationMode="external" />
    : <NativeOpenResponseTeacherSurface publicDocument={questionPublic} teacherDocument={questionTeacher} assetUrl={assetUrl} presentation={presentation} audioHotspotPresentation={audioHotspotPresentation} />} />;
}
