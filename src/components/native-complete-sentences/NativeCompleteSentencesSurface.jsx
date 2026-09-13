import { useEffect, useMemo, useRef, useState } from "react";

import { logicalAreaStyle } from "../builder-studio/stageGeometry.js";
import { nativeActivitySelectedFontState, useNativeActivityFonts } from "../native-activity-assets/useNativeActivityFonts.js";
import { NativeAudioTextHotspotButtons } from "../native-readable-text/NativeAudioTextHotspots.jsx";
import { nativeCompleteSentencesFontFamilyAlias, nativeCompleteSentencesPromptParts, normalizeNativeCompleteSentencesHotspotPresentation, updateNativeCompleteSentencesRevealState } from "../../data/native-activities/nativeCompleteSentences.js";
import "./nativeCompleteSentences.css";

function SentencePrompt({ prompt }) {
  const parts = nativeCompleteSentencesPromptParts(prompt);
  return parts.structured ? <>{parts.before}<span className="native-complete-sentences-inline-blank" aria-label="blank">______</span>{parts.after}</> : prompt;
}

function PanelNavigation({ panelIndex, panelCount, onPrevious, onNext }) {
  if (panelCount <= 1 || (!onPrevious && !onNext)) return null;
  return <nav className="native-complete-sentences-panel-navigation" aria-label="Complete the Sentences panels">
    <button type="button" disabled={panelIndex === 0} onClick={onPrevious}>Previous</button>
    <span role="status">Panel {panelIndex + 1} of {panelCount}</span>
    <button type="button" disabled={panelIndex >= panelCount - 1} onClick={onNext}>Next</button>
  </nav>;
}

function Presentation({ document, assetUrl, responses, onChange, readOnly, panelIndex = 0, onPrevious = null, onNext = null, revealed = new Set(), answers = new Map(), onTeacherReveal = null, audioHotspotPresentation = null, embeddedCanvas = false }) {
  const interaction = document.parts[0].interaction;
  const panels = interaction.presentation.panels;
  const normalizedIndex = Math.min(Math.max(Number.isSafeInteger(panelIndex) ? panelIndex : 0, 0), Math.max(0, panels.length - 1));
  const panel = panels[normalizedIndex];
  const answerStyle = normalizeNativeCompleteSentencesHotspotPresentation(interaction.presentation.answerStyle);
  const fontState = useNativeActivityFonts(document, assetUrl);
  useEffect(() => { audioHotspotPresentation?.onPanelChange(panel?.id || null); }, [audioHotspotPresentation, panel?.id]);
  if (!panel) return <p role="status">No Complete the Sentences panel is available.</p>;
  const reference = document.assets.find((asset) => asset.slot === panel.backgroundAssetSlot);
  return <>{fontState.failures.length ? <p className="native-activity-font-fallback" role="alert">Selected font could not be loaded; using the default font.</p> : null}<article data-embedded-canvas={embeddedCanvas || undefined} className="native-complete-sentences" aria-label={document.metadata.title}>
    <PanelNavigation panelIndex={normalizedIndex} panelCount={panels.length} onPrevious={onPrevious} onNext={onNext} />
    <div className="native-complete-sentences-stage" data-panel-id={panel.id} style={{ aspectRatio: `${panel.sourceWidth} / ${panel.sourceHeight}`, "--native-complete-sentences-ratio": panel.sourceWidth / panel.sourceHeight }}>
      {!embeddedCanvas && reference ? <img src={assetUrl(reference.assetId)} alt="" /> : !embeddedCanvas ? <p role="status">Panel background is unavailable.</p> : null}
      {panel.hotspots.map((hotspot, index) => {
        const item = interaction.items.find((candidate) => candidate.id === hotspot.itemId);
        const fontReference = answerStyle.fontAssetSlot ? document.assets.find((asset) => asset.slot === answerStyle.fontAssetSlot && asset.role === "activity_font") : null;
        const selectedFont = nativeActivitySelectedFontState(fontState, document, answerStyle.fontAssetSlot);
        const hotspotStyle = {
          ...logicalAreaStyle(hotspot.area, { width: panel.sourceWidth, height: panel.sourceHeight }),
          "--native-complete-answer-font-size": `${(answerStyle.fontSize / panel.sourceWidth) * 100}cqw`,
          "--native-complete-answer-color": answerStyle.color,
          "--native-complete-answer-font-family": fontReference ? nativeCompleteSentencesFontFamilyAlias(fontReference.assetId) : "system-ui, sans-serif",
        };
        const teacherAnswer = revealed.has(hotspot.itemId) ? answers.get(hotspot.itemId) || "" : null;
        if (onTeacherReveal) return <button key={hotspot.id} type="button" className="native-complete-sentences-blank native-complete-sentences-teacher-target" style={hotspotStyle} data-font-status={selectedFont.status} data-revealed={teacherAnswer !== null || undefined} aria-label={`${teacherAnswer === null ? "Reveal" : "Revealed"} answer for sentence ${interaction.items.indexOf(item) + 1}`} onClick={() => onTeacherReveal(hotspot.itemId)}>
          <span className="native-complete-sentences-sr-only">{item?.prompt || `Sentence ${index + 1}`}</span>
          <span className="native-complete-sentences-teacher-answer" aria-live="polite">{teacherAnswer ?? ""}</span>
        </button>;
        return <label key={hotspot.id} className="native-complete-sentences-blank" style={hotspotStyle} data-font-status={selectedFont.status}>
          <span className="native-complete-sentences-sr-only">{item?.prompt || `Sentence ${index + 1}`}</span>
          <input type="text" value={teacherAnswer ?? responses[hotspot.itemId] ?? ""} readOnly={readOnly || teacherAnswer !== null} aria-label={`Answer for sentence ${interaction.items.indexOf(item) + 1}`} onChange={(event) => onChange?.(hotspot.itemId, event.target.value)} />
        </label>;
      })}
      <NativeAudioTextHotspotButtons panelId={panel.id} surface={{ width: panel.sourceWidth, height: panel.sourceHeight }} presentation={audioHotspotPresentation} />
    </div>
    <ol className="native-complete-sentences-prompts">{interaction.items.map((item) => <li key={item.id}><SentencePrompt prompt={item.prompt} /></li>)}</ol>
  </article></>;
}

export function NativeCompleteSentencesStudentSurface({ document, assetUrl = () => "", responses: controlled = null, initialResponses = null, onResponsesChange = null, readOnly = false, audioHotspotPresentation = null, embeddedCanvas = false }) {
  const [local, setLocal] = useState(() => ({ ...(initialResponses || {}) }));
  const [panelIndex, setPanelIndex] = useState(0);
  const responses = controlled && typeof controlled === "object" ? controlled : local;
  const change = (itemId, value) => {
    if (readOnly) return;
    const next = { ...responses, [itemId]: value };
    if (controlled === null) setLocal(next);
    onResponsesChange?.(next);
  };
  return <Presentation document={document} assetUrl={assetUrl} responses={responses} onChange={change} readOnly={readOnly} panelIndex={panelIndex} onPrevious={() => setPanelIndex((current) => Math.max(0, current - 1))} onNext={() => setPanelIndex((current) => Math.min(document.parts[0].interaction.presentation.panels.length - 1, current + 1))} audioHotspotPresentation={audioHotspotPresentation} embeddedCanvas={embeddedCanvas} />;
}

export function NativeCompleteSentencesTeacherSurface({ publicDocument, teacherDocument, assetUrl = () => "", presentation = null, audioHotspotPresentation = null, embeddedCanvas = false }) {
  const panels = publicDocument.parts[0].interaction.presentation.panels;
  const answers = useMemo(() => new Map(teacherDocument.parts[0].solution.answers.map((answer) => [answer.itemId, answer.text])), [teacherDocument]);
  const [session, setSession] = useState(() => ({ revealed: new Set(), panelIndex: 0 }));
  const lastToken = useRef(presentation?.command?.token);
  const visibleItemIds = panels[session.panelIndex]?.hotspots.map((hotspot) => hotspot.itemId) || [];
  useEffect(() => {
    const command = presentation?.command;
    if (!command || command.token === lastToken.current) return;
    lastToken.current = command.token;
    setSession((current) => {
      if (command.type === "reset-activity") return { revealed: new Set(), panelIndex: 0 };
      if (command.type === "previous-panel") return { ...current, panelIndex: Math.max(0, current.panelIndex - 1) };
      if (command.type === "next-panel") return { ...current, panelIndex: Math.min(panels.length - 1, current.panelIndex + 1) };
      const itemIds = panels[current.panelIndex]?.hotspots.map((hotspot) => hotspot.itemId) || [];
      return { ...current, revealed: updateNativeCompleteSentencesRevealState(current.revealed, itemIds, command.type) };
    });
  }, [panels, presentation?.command]);
  useEffect(() => presentation?.onStateChange?.({ panelIndex: session.panelIndex, panelCount: panels.length, reveal: { supported: true, total: visibleItemIds.length, revealed: visibleItemIds.filter((itemId) => session.revealed.has(itemId)).length, pristine: session.panelIndex === 0 && session.revealed.size === 0 } }), [panels.length, presentation?.onStateChange, session, visibleItemIds.join("\0")]);
  return <Presentation document={publicDocument} assetUrl={assetUrl} responses={{}} readOnly panelIndex={session.panelIndex} onPrevious={!presentation ? () => setSession((current) => ({ ...current, panelIndex: Math.max(0, current.panelIndex - 1) })) : null} onNext={!presentation ? () => setSession((current) => ({ ...current, panelIndex: Math.min(panels.length - 1, current.panelIndex + 1) })) : null} revealed={session.revealed} answers={answers} onTeacherReveal={(itemId) => setSession((current) => ({ ...current, revealed: updateNativeCompleteSentencesRevealState(current.revealed, panels[current.panelIndex]?.hotspots.map((hotspot) => hotspot.itemId) || [], { itemId }) }))} audioHotspotPresentation={audioHotspotPresentation} embeddedCanvas={embeddedCanvas} />;
}
