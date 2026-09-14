import { NativeOldschoolExactTranscript, NativeOldschoolTranscriptFontStatus } from "./NativeOldschoolTranscript.jsx";
import { NATIVE_OPEN_RESPONSE_LEGACY_PANEL_ID } from "../../data/native-activities/nativeOpenResponse.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LegacyListeningPlayer } from "../listening-player/LegacyListeningPlayer.jsx";
import { NativeScrollControlsHost } from "../native-readable-text/NativeScrollControlsHost.jsx";
import { NativeVerticalScrollViewport } from "../native-readable-text/NativeVerticalScrollViewport.jsx";
import { NativeAudioTextHotspotButtons } from "../native-readable-text/NativeAudioTextHotspots.jsx";
import { formatNativeListeningTime } from "../native-listening/nativeListeningRuntime.js";
import { nativeListeningPlayerAssets } from "../native-listening/nativeListeningPlayerAssets.js";
import { pauseSiblingNativeMedia } from "../native-readable-text/nativeMediaArbitration.js";
import { nativeOldschoolListeningQuestionMode } from "../../data/native-activities/nativeOldschoolListening.js";
import { findNativeOldschoolListeningCue, nativeOldschoolListeningCueScrollY, nativeOldschoolListeningFragmentFontSize, nativeOldschoolListeningRegionStyle, nativeOldschoolListeningScrollTarget, nativeOldschoolListeningTranscriptFragments } from "./nativeOldschoolListeningRuntime.js";
import "../native-readable-text/nativeReadableText.css";
import "./nativeOldschoolListening.css";

function referenceForSlot(document, slot) { return document.assets.find((asset) => asset.slot === slot) || null; }

function OldschoolPage({ document, interaction, assetUrl, highlightedCueIds, viewportApiRef, pageCanvasRef, onManualScrollStateChange }) {
  const panel = interaction.panels[1];
  const pageReference = referenceForSlot(document, panel.pageAssetSlot);
  const highlighted = new Set(highlightedCueIds);
  const highlightedCues = interaction.cues.filter((cue) => highlighted.has(cue.id));
  const transcriptFragments = nativeOldschoolListeningTranscriptFragments(interaction.cues);
  const exactRegionIds = new Set(transcriptFragments.filter((fragment) => fragment.exact).map((fragment) => fragment.regionId));
  return <section className="native-oldschool-listening-page-panel" aria-label="Synchronized listening page">
    <NativeVerticalScrollViewport id={`${document.activityId}-oldschool-page`} apiRef={viewportApiRef} className="native-oldschool-listening-page-viewport" ariaLabel="Synchronized listening page scroll position" resetKey={`${document.activityId}:${panel.pageAssetSlot}`} onManualScrollStateChange={onManualScrollStateChange}>
      <div ref={pageCanvasRef} className="native-oldschool-listening-page-canvas" style={{ aspectRatio: `${panel.sourceWidth}/${panel.sourceHeight}` }}>
        {pageReference ? <img src={assetUrl(pageReference.assetId)} alt={panel.altText} draggable="false" /> : <p role="alert">Listening page image is unavailable.</p>}
        <svg className="native-oldschool-listening-transcript" viewBox={`0 0 ${panel.sourceWidth} ${panel.sourceHeight}`} preserveAspectRatio="none" aria-hidden="true">
          {transcriptFragments.filter((fragment) => fragment.text && !fragment.exact).map((fragment) => <foreignObject key={fragment.regionId} x={fragment.x} y={fragment.y} width={fragment.width} height={fragment.height} className="native-oldschool-listening-transcript-fragment" data-cue-id={fragment.cueId} data-region-id={fragment.regionId} data-exact="false" data-highlighted="false"><div xmlns="http://www.w3.org/1999/xhtml" style={{ fontSize: `${nativeOldschoolListeningFragmentFontSize(fragment)}px` }}>{fragment.text}</div></foreignObject>)}
        </svg>
        <NativeOldschoolExactTranscript document={document} highlightedCueIds={highlightedCueIds} />
        {highlightedCues.flatMap((cue) => cue.highlightRegions.filter((region) => !exactRegionIds.has(region.id)).map((region) => <div key={region.id} className="native-oldschool-listening-highlight" style={nativeOldschoolListeningRegionStyle(region, { width: panel.sourceWidth, height: panel.sourceHeight })} data-cue-id={cue.id} data-region-id={region.id} aria-hidden="true" />))}
      </div>
    </NativeVerticalScrollViewport>
    <NativeOldschoolTranscriptFontStatus document={document} assetUrl={assetUrl} />
    <p className="native-oldschool-listening-live" aria-live="polite">{highlightedCues.map((cue) => cue.text).join(" ")}</p>
  </section>;
}

export function NativeOldschoolListeningSurface({ publicDocument, assetUrl = () => "", presentation = null, teacherMode = false, audioHotspotPresentation = null, renderQuestions }) {
  const interaction = publicDocument.parts[0].interaction;
  const [view, setView] = useState("questions");
  const [currentMs, setCurrentMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [focusedCueIds, setFocusedCueIds] = useState([]);
  const [seekVersion, setSeekVersion] = useState(0);
  const [questionResetToken, setQuestionResetToken] = useState(null);
  const [revealState, setRevealState] = useState({ supported: teacherMode, total: interaction.questions?.length || interaction.questionInteraction?.panels.flatMap((panel) => panel.dropTargets).length || 0, revealed: 0, pristine: true });
  const audioRef = useRef(null); const viewportApiRef = useRef(null); const pageCanvasRef = useRef(null); const lastCommand = useRef(null); const raf = useRef(0); const lastSample = useRef(0); const manualScroll = useRef(false);
  const audioReference = referenceForSlot(publicDocument, interaction.audioAssetSlot);
  const audioUrl = audioReference ? assetUrl(audioReference.assetId) : "";
  const questionMode = nativeOldschoolListeningQuestionMode(interaction);
  const activeCue = useMemo(() => findNativeOldschoolListeningCue(interaction.cues, currentMs), [currentMs, interaction.cues]);
  const highlightedCueIds = focusedCueIds.length ? focusedCueIds : activeCue ? [activeCue.id] : [];
  const followCue = interaction.cues.find((entry) => entry.id === highlightedCueIds[0]);
  const followKey = `${followCue?.id || ""}:${seekVersion}`;
  const currentFollowKey = useRef(followKey);
  currentFollowKey.current = followKey;
  const manuallyPositionedCue = useRef(null);
  const onManualScrollStateChange = useCallback((active) => {
    manualScroll.current = active;
    manuallyPositionedCue.current = currentFollowKey.current;
    const pane = viewportApiRef.current?.viewport;
    if (active && pane) pane.scrollTo({ top: pane.scrollTop, behavior: "instant" });
  }, []);
  const followGeometry = JSON.stringify({ targetY: nativeOldschoolListeningCueScrollY(followCue), regions: followCue?.highlightRegions || [], sourceHeight: interaction.panels[1].sourceHeight });

  const selectSnippet = useCallback((id) => {
    const hotspot = interaction.snippetHotspots.find((entry) => entry.id === id);
    if (!hotspot) return;
    setFocusedCueIds(hotspot.cueIds); setView("page"); setSeekVersion((value) => value + 1);
    const first = interaction.cues.find((cue) => cue.id === hotspot.cueIds[0]);
    if (first && audioRef.current) { audioRef.current.currentTime = first.startMs / 1_000; setCurrentMs(first.startMs); }
  }, [interaction.cues, interaction.snippetHotspots]);
  const questionPanelId = questionMode === "drag-drop" ? interaction.questionInteraction.panels[0].id : questionMode === "single-choice" ? interaction.presentation?.panels[0]?.id || null : interaction.questionSurface ? NATIVE_OPEN_RESPONSE_LEGACY_PANEL_ID : null;
  const hotspotPresentation = useMemo(() => ({
    hotspots: [
      ...interaction.snippetHotspots.map((hotspot) => ({ ...hotspot, id: `listening:${hotspot.id}`, panelId: questionPanelId, activityArea: hotspot.area })),
      ...(audioHotspotPresentation?.hotspots || []).map((hotspot) => ({ ...hotspot, id: `readable:${hotspot.id}`, panelId: questionPanelId })),
    ],
    activeHotspotId: audioHotspotPresentation?.activeHotspotId ? `readable:${audioHotspotPresentation.activeHotspotId}` : null,
    onToggle(id) { if (id.startsWith("listening:")) selectSnippet(id.slice(10)); else audioHotspotPresentation?.onToggle(id.slice(9)); },
    onPanelChange() {},
  }), [interaction.snippetHotspots, questionPanelId, audioHotspotPresentation, selectSnippet]);
  const onQuestionState = useCallback((state) => { if (state?.reveal) setRevealState(state.reveal); }, []);
  const questionPresentation = useMemo(() => presentation ? { command: ["previous-panel", "next-panel", "toggle-text"].includes(presentation.command?.type) ? null : presentation.command, onStateChange: onQuestionState } : null, [onQuestionState, presentation?.command]);

  useEffect(() => {
    if (!playing) return undefined;
    const sample = (timestamp) => {
      if (timestamp - lastSample.current >= 32 && audioRef.current) { lastSample.current = timestamp; setCurrentMs(Math.round(audioRef.current.currentTime * 1_000)); }
      raf.current = requestAnimationFrame(sample);
    };
    raf.current = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(raf.current);
  }, [playing]);

  useEffect(() => {
    if (view !== "page" || !highlightedCueIds.length || !viewportApiRef.current || !pageCanvasRef.current || manualScroll.current) return undefined;
    const { targetY, sourceHeight } = JSON.parse(followGeometry);
    let cancelled = false; let frame = 0; let observer;
    const follow = () => {
      if (cancelled || manualScroll.current || manuallyPositionedCue.current === followKey) return;
      const pane = viewportApiRef.current?.viewport; const canvas = pageCanvasRef.current;
      if (!pane || !canvas || !(pane.clientHeight > 0) || !(canvas.offsetHeight > 0)) { frame = requestAnimationFrame(follow); return; }
      const target = nativeOldschoolListeningScrollTarget({ targetY, sourceHeight, renderedHeight: canvas.offsetHeight, scrollTop: pane.scrollTop, viewportHeight: pane.clientHeight });
      if (Math.abs(target - pane.scrollTop) > 1) viewportApiRef.current.scrollTo({ top: target, behavior: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth" });
    };
    frame = requestAnimationFrame(follow);
    if (typeof ResizeObserver !== "undefined") { observer = new ResizeObserver(follow); observer.observe(pageCanvasRef.current); observer.observe(viewportApiRef.current.viewport); }
    return () => { cancelled = true; cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [followKey, followGeometry, view]);

  const reset = useCallback(() => {
    audioRef.current?.pause(); if (audioRef.current) audioRef.current.currentTime = 0;
    setPlaying(false); setCurrentMs(0); setView("questions"); setFocusedCueIds([]);
    manualScroll.current = false; manuallyPositionedCue.current = null;
  }, []);

  useEffect(() => { reset(); }, [interaction.audioAssetSlot, publicDocument.activityId, reset]);
  useEffect(() => {
    const command = presentation?.command;
    if (!command || command.token === lastCommand.current) return;
    lastCommand.current = command.token;
    if (command.type === "reset-activity") { reset(); setQuestionResetToken(command.token); }
    if (command.type === "previous-panel") { setView("questions"); setFocusedCueIds([]); }
    if (command.type === "next-panel") { setView("page"); setFocusedCueIds([]); }

  }, [presentation?.command, reset]);
  useEffect(() => { presentation?.onStateChange?.({ view: "questions", readableTextAvailable: false, panelNavigationActive: true, panelIndex: view === "page" ? 1 : 0, panelCount: 2, reveal: teacherMode ? revealState : { supported: false, total: 0, revealed: 0, pristine: true } }); }, [presentation?.onStateChange, revealState, teacherMode, view]);

  const play = () => { if (!audioRef.current || !audioUrl) return; setView("page"); setFocusedCueIds([]); if (audioRef.current.ended || currentMs >= interaction.audioDurationMs) { audioRef.current.currentTime = 0; setCurrentMs(0); } setAudioError(false); audioRef.current.play().catch(() => setAudioError(true)); };
  const pause = () => audioRef.current?.pause();
  const seek = (nextMs) => { if (!audioRef.current || !Number.isFinite(nextMs)) return; audioRef.current.currentTime = nextMs / 1_000; setCurrentMs(nextMs); setSeekVersion((value) => value + 1); setView("page"); setFocusedCueIds([]); };
  const toggleMute = () => { const next = !muted; setMuted(next); if (audioRef.current) audioRef.current.muted = next; };

  return <NativeScrollControlsHost className="native-oldschool-listening" data-panel={view === "questions" ? 1 : 2} data-view={view} data-question-mode={questionMode}>
    <div className="native-oldschool-listening-local-stage">
      <div className="native-oldschool-listening-activity-stage" style={{ aspectRatio: `${interaction.panels[0].sourceWidth}/${interaction.panels[0].sourceHeight}` }}>
        <div className="native-oldschool-question-session" hidden={view !== "questions"}>{renderQuestions({ audioHotspotPresentation: hotspotPresentation, presentation: questionPresentation, resetToken: questionResetToken })}</div>
        {view === "questions" && questionMode === "single-choice" && !interaction.presentation ? <NativeAudioTextHotspotButtons panelId={null} surface={{ width: interaction.panels[0].sourceWidth, height: interaction.panels[0].sourceHeight }} presentation={hotspotPresentation} /> : null}
        {view === "page" ? <OldschoolPage document={publicDocument} interaction={interaction} assetUrl={assetUrl} highlightedCueIds={highlightedCueIds} viewportApiRef={viewportApiRef} pageCanvasRef={pageCanvasRef} onManualScrollStateChange={onManualScrollStateChange} /> : null}
        <div className="native-oldschool-listening-player-anchor" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}><LegacyListeningPlayer assets={nativeListeningPlayerAssets} currentMs={currentMs} durationMs={interaction.audioDurationMs} playing={playing} muted={muted} disabled={!audioUrl} formatTime={formatNativeListeningTime} onPlay={play} onPause={pause} onStop={reset} onSeek={seek} onToggleMute={toggleMute} /></div>
      </div>
    </div>
    {!presentation ? <nav aria-label="Listening panels"><button type="button" disabled={view === "questions"} onClick={() => setView("questions")}>Previous</button><span>Panel {view === "questions" ? 1 : 2} of 2</span><button type="button" disabled={view === "page"} onClick={() => setView("page")}>Next</button></nav> : null}
    {!audioUrl ? <p className="native-oldschool-listening-error" role="alert">Listening audio is unavailable.</p> : null}
    {audioError ? <p className="native-oldschool-listening-error" role="alert">Listening audio could not be played.</p> : null}
    <audio ref={audioRef} hidden preload="metadata" src={audioUrl} onPlay={(event) => { pauseSiblingNativeMedia(event.currentTarget); setPlaying(true); }} onPause={() => setPlaying(false)} onTimeUpdate={() => { if (audioRef.current) setCurrentMs(Math.round(audioRef.current.currentTime * 1_000)); }} onSeeked={() => { if (audioRef.current) { setCurrentMs(Math.round(audioRef.current.currentTime * 1_000)); setSeekVersion((value) => value + 1); } }} onEnded={reset} onError={() => setAudioError(true)} />
  </NativeScrollControlsHost>;
}
