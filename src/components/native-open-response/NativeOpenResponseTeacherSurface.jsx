import { useEffect, useRef, useState } from "react";

import { nativeActivitySelectedFontState, useNativeActivityFonts } from "../native-activity-assets/useNativeActivityFonts.js";
import { logicalAreaStyle, NativeOpenResponseFontSurface, nativeOpenResponseResponseAriaLabel } from "./NativeOpenResponseSurface.jsx";
import { fitNativeOpenResponseRuntimeAnswer } from "./nativeOpenResponseRuntimeFit.js";
import { nextNativeOpenResponseReveal, updateNativeOpenResponseReveals } from "./nativeOpenResponseTeacherRuntime.js";
import { nativeOpenResponseAnswerFontFamily, nativeOpenResponseModelAnswerTexts, nativeOpenResponsePanelResponseIds, nativeOpenResponsePanels } from "../../data/native-activities/nativeOpenResponse.js";

function TeacherAnswer({ publicDocument, fontState, panel, question, texts, visible, onToggle, onOverflow }) {
  const { responseRegion } = question;
  const { presentation } = responseRegion;
  const fontFamily = nativeOpenResponseAnswerFontFamily(publicDocument, presentation);
  const selectedFont = nativeActivitySelectedFontState(fontState, publicDocument, presentation.answerFontAssetSlot);
  const presentationText = texts.filter((text) => String(text).trim()).join(" / ");
  const fit = fitNativeOpenResponseRuntimeAnswer({ text: presentationText, responseRegion, fontFamily, fontStatus: selectedFont.status });
  useEffect(() => { if (!fit.fits) onOverflow(question.id, fit.overflowReason); }, [fit.fits, fit.overflowReason, onOverflow, question.id]);
  return <button type="button" className="native-or-answer-layer" style={logicalAreaStyle(responseRegion.area, panel.surface)} aria-label={`${visible ? "Hide" : "Reveal"} model answer${texts.filter((text) => String(text).trim()).length > 1 ? "s" : ""} for ${nativeOpenResponseResponseAriaLabel(question)}`} aria-pressed={visible} onClick={onToggle} data-fit={fit.fits ? "true" : "false"} data-requested-font-size={presentation.answerFontSizeMax} data-effective-font-size={fit.fontSize} data-font-status={selectedFont.status} data-overflow-reason={fit.overflowReason || undefined}>
    {visible ? fit.lines.slice(0, fit.baselines.length).map((line, index) => <span key={index} className="native-or-answer-line" style={{ left: `${(presentation.paddingX / responseRegion.area.width) * 100}%`, top: `${((fit.baselines[index] - responseRegion.area.y) / responseRegion.area.height) * 100}%`, width: `${(presentation.lineWidth / responseRegion.area.width) * 100}%`, fontFamily, fontSize: `${(fit.fontSize / panel.surface.width) * 100}cqw`, color: presentation.color, textAlign: presentation.align }}>{line}</span>) : null}
  </button>;
}

function NativeOpenResponseTeacherSession({ publicDocument, teacherDocument, assetUrl, onOverflow, presentation, audioHotspotPresentation, embeddedCanvas }) {
  const [revealed, setRevealed] = useState(() => new Set());
  const [panelIndex, setPanelIndex] = useState(0);
  const interaction = publicDocument.parts[0].interaction;
  const panels = nativeOpenResponsePanels(interaction);
  const panel = panels[panelIndex] || panels[0];
  const fontState = useNativeActivityFonts(publicDocument, assetUrl);
  const answers = new Map(teacherDocument.parts[0].solution.modelAnswers.map((answer) => [answer.questionId, nativeOpenResponseModelAnswerTexts(answer)]));
  const responseMembership = new Set(panels.flatMap(nativeOpenResponsePanelResponseIds));
  const questionIds = interaction.questions.map((question) => question.id).filter((questionId) => responseMembership.has(questionId));
  const lastCommandToken = useRef(presentation?.command?.token);
  const onStateChange = presentation?.onStateChange;

  useEffect(() => {
    const command = presentation?.command;
    if (!command || command.token === lastCommandToken.current) return;
    lastCommandToken.current = command.token;
    if (command.type === "previous-panel") setPanelIndex((current) => Math.max(0, current - 1));
    else if (command.type === "next-panel") setPanelIndex((current) => Math.min(panels.length - 1, current + 1));
    else {
      if (command.type === "reset-activity") setPanelIndex(0);
      if (command.type === "show-next") {
        const next = nextNativeOpenResponseReveal(revealed, questionIds, panels);
        if (next.panelIndex >= 0) setPanelIndex(next.panelIndex);
      }
      setRevealed((current) => updateNativeOpenResponseReveals(current, questionIds, command.type));
    }
  }, [panels, presentation?.command, questionIds.join("\u0000"), revealed]);

  useEffect(() => {
    onStateChange?.({
      panelIndex,
      panelCount: panels.length,
      reveal: { supported: true, total: questionIds.length, revealed: revealed.size, pristine: revealed.size === 0 },
    });
  }, [onStateChange, panelIndex, panels.length, questionIds.length, revealed]);

  useEffect(() => { if (panel) audioHotspotPresentation?.onPanelChange?.(panel.legacy ? null : panel.id); }, [audioHotspotPresentation, panel]);

  const toggle = (questionId) => setRevealed((current) => { const next = new Set(current); if (next.has(questionId)) next.delete(questionId); else next.add(questionId); return next; });
  if (!panel) return <p role="status">This Open Response activity has no panels yet.</p>;
  const visibleResponseIds = nativeOpenResponsePanelResponseIds(panel);
  const visibleQuestions = interaction.questions.filter((question) => visibleResponseIds.includes(question.id));
  return <section className="native-or-panel-session" data-embedded-surface={embeddedCanvas || undefined}>{fontState.failures.length ? <p className="native-activity-font-fallback" role="alert">Selected font could not be loaded; using the default font.</p> : null}<NativeOpenResponseFontSurface document={publicDocument} panel={panel} assetUrl={assetUrl} audioHotspotPresentation={audioHotspotPresentation} embeddedCanvas={embeddedCanvas}>
    {visibleQuestions.map((question) => <TeacherAnswer key={question.id} publicDocument={publicDocument} fontState={fontState} panel={panel} question={question} texts={answers.get(question.id) || []} visible={revealed.has(question.id)} onToggle={() => toggle(question.id)} onOverflow={onOverflow} />)}
  </NativeOpenResponseFontSurface>{!presentation && panels.length > 1 ? <nav className="native-or-panel-navigation" aria-label="Open Response panels"><button type="button" disabled={panelIndex === 0} onClick={() => setPanelIndex((current) => Math.max(0, current - 1))}>Previous</button><span>Panel {panelIndex + 1} of {panels.length}</span><button type="button" disabled={panelIndex === panels.length - 1} onClick={() => setPanelIndex((current) => Math.min(panels.length - 1, current + 1))}>Next</button></nav> : null}</section>;
}

export function NativeOpenResponseTeacherSurface({ publicDocument, teacherDocument, assetUrl = () => "", onOverflow = () => {}, presentation = null, audioHotspotPresentation = null, embeddedCanvas = false }) {
  return <NativeOpenResponseTeacherSession key={publicDocument.activityId} publicDocument={publicDocument} teacherDocument={teacherDocument} assetUrl={assetUrl} onOverflow={onOverflow} presentation={presentation} audioHotspotPresentation={audioHotspotPresentation} embeddedCanvas={embeddedCanvas} />;
}
