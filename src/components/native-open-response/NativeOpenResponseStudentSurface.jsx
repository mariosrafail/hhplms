import { useEffect, useState } from "react";
import { nativeOpenResponseAnswerFontFamily, nativeOpenResponsePanelResponseIds, nativeOpenResponsePanels } from "../../data/native-activities/nativeOpenResponse.js";
import { nativeActivitySelectedFontState, useNativeActivityFonts } from "../native-activity-assets/useNativeActivityFonts.js";

import { logicalAreaStyle, NativeOpenResponseFontSurface, nativeOpenResponseResponseAriaLabel } from "./NativeOpenResponseSurface.jsx";
import { fitNativeOpenResponseRuntimeAnswer } from "./nativeOpenResponseRuntimeFit.js";

function StudentResponse({ document, fontState, panel, question, value, readOnly, onChange }) {
  const { responseRegion } = question;
  const { presentation } = responseRegion;
  const fontFamily = nativeOpenResponseAnswerFontFamily(document, presentation);
  const selectedFont = nativeActivitySelectedFontState(fontState, document, presentation.answerFontAssetSlot);
  const fit = fitNativeOpenResponseRuntimeAnswer({ text: value, responseRegion, fontFamily, fontStatus: selectedFont.status });
  return <textarea
    className="native-or-student-response"
    style={{
      ...logicalAreaStyle(responseRegion.area, panel.surface),
      padding: `${(presentation.paddingY / panel.surface.width) * 100}cqw ${(presentation.paddingX / panel.surface.width) * 100}cqw`,
      fontFamily,
      fontSize: `${(fit.fontSize / panel.surface.width) * 100}cqw`,
      lineHeight: `${(presentation.lineSpacing / panel.surface.width) * 100}cqw`,
      color: presentation.color,
      textAlign: presentation.align,
    }}
    aria-label={nativeOpenResponseResponseAriaLabel(question)}
    value={value}
    readOnly={readOnly}
    data-requested-font-size={presentation.answerFontSizeMax}
    data-effective-font-size={fit.fontSize}
    data-fit={fit.fits ? "true" : "false"}
    data-font-status={selectedFont.status}
    data-overflow-reason={fit.overflowReason || undefined}
    onChange={(event) => onChange(event.target.value)}
  />;
}

export function NativeOpenResponseStudentSurface({
  document,
  assetUrl = () => "",
  responses: controlledResponses = null,
  initialResponses = null,
  onResponsesChange = null,
  readOnly = false,
  audioHotspotPresentation = null,
  embeddedCanvas = false,
}) {
  const [localResponses, setLocalResponses] = useState(() => new Map(Object.entries(initialResponses || {})));
  const [panelIndex, setPanelIndex] = useState(0);
  const responses = controlledResponses instanceof Map
    ? controlledResponses
    : controlledResponses && typeof controlledResponses === "object"
      ? new Map(Object.entries(controlledResponses))
      : localResponses;
  const updateResponse = (questionId, value) => {
    if (readOnly) return;
    const next = new Map(responses).set(questionId, value);
    if (controlledResponses === null) setLocalResponses(next);
    onResponsesChange?.(Object.fromEntries(next));
  };
  const interaction = document.parts[0].interaction;
  const panels = nativeOpenResponsePanels(interaction);
  const panel = panels[panelIndex] || panels[0];
  const fontState = useNativeActivityFonts(document, assetUrl);
  useEffect(() => { if (panel) audioHotspotPresentation?.onPanelChange?.(panel.legacy ? null : panel.id); }, [audioHotspotPresentation, panel]);
  if (!panel) return <p role="status">This Open Response activity has no panels yet.</p>;
  const responseIds = nativeOpenResponsePanelResponseIds(panel);
  const visibleQuestions = interaction.questions.filter((question) => responseIds.includes(question.id));
  return <section className="native-or-panel-session" data-embedded-surface={embeddedCanvas || undefined}>{fontState.failures.length ? <p className="native-activity-font-fallback" role="alert">Selected font could not be loaded; using the default font.</p> : null}<NativeOpenResponseFontSurface document={document} panel={panel} assetUrl={assetUrl} audioHotspotPresentation={audioHotspotPresentation} embeddedCanvas={embeddedCanvas}>
    {visibleQuestions.map((question) => <StudentResponse key={question.id} document={document} fontState={fontState} panel={panel} question={question} value={responses.get(question.id) || ""} readOnly={readOnly} onChange={(value) => updateResponse(question.id, value)} />)}
  </NativeOpenResponseFontSurface>{panels.length > 1 ? <nav className="native-or-panel-navigation" aria-label="Open Response panels"><button type="button" disabled={panelIndex === 0} onClick={() => setPanelIndex((current) => Math.max(0, current - 1))}>Previous</button><span>Panel {panelIndex + 1} of {panels.length}</span><button type="button" disabled={panelIndex === panels.length - 1} onClick={() => setPanelIndex((current) => Math.min(panels.length - 1, current + 1))}>Next</button></nav> : null}</section>;
}
