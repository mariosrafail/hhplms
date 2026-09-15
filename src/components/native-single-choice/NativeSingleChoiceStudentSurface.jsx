import { NativeSingleChoicePresentation } from "./NativeSingleChoicePresentation.jsx";

export function NativeSingleChoiceStudentSurface({ document, assetUrl = () => "", responses: controlledResponses = null, initialResponses = null, onResponsesChange = null, readOnly = false, audioHotspotPresentation = null, navigationMode = "inline" }) {
  return <NativeSingleChoicePresentation
    document={document}
    assetUrl={assetUrl}
    responses={controlledResponses}
    initialResponses={initialResponses}
    onResponsesChange={onResponsesChange}
    readOnly={readOnly}
    className="native-single-choice-student"
    audioHotspotPresentation={audioHotspotPresentation}
    navigationMode={navigationMode}
  />;
}
