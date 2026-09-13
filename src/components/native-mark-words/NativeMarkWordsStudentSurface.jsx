import { isMarkWordsVisual } from "../../data/native-activities/nativeMarkWordsVisualTargets.js";
import { Fragment, useRef, useState } from "react";
import { logicalAreaStyle } from "../builder-studio/stageGeometry.js";
import { useNativeActivityFonts } from "../native-activity-assets/useNativeActivityFonts.js";
import { nativeActivityFontFamily } from "../../data/native-activities/nativeActivityFont.js";
import { restoreNativeMarkWordsResponses, toggleNativeMarkWordsResponse } from "../../data/native-activities/nativeMarkWordsRuntime.js";
import "./nativeMarkWords.css";

export function WordButton({ item, word, position, itemNumber, selected, readOnly, onToggle, style, visual = false, label = null }) {
  const pointer = useRef(null);
  return <button type="button" className={visual ? "native-mark-words-hit" : "native-mark-words-word"} style={style}
    aria-label={label || `Passage ${itemNumber}, word ${position + 1}: ${item.text.slice(word.start, word.end)}`} aria-pressed={selected}
    data-word-id={word.id} disabled={readOnly}
    onPointerDown={(event) => { pointer.current = { x: event.clientX, y: event.clientY, moved: false }; }}
    onPointerMove={(event) => { if (pointer.current && Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) > 6) pointer.current.moved = true; }}
    onPointerCancel={() => { if (pointer.current) pointer.current.moved = true; }}
    onClick={(event) => { const cancelled = pointer.current?.moved; pointer.current = null; if (!readOnly && !(event.detail && cancelled)) onToggle(item.id, word.id); }}>
    {visual ? null : item.text.slice(word.start, word.end)}
  </button>;
}

export function NativeMarkWordsPassage({ item, itemNumber, selected = [], readOnly = false, onToggle = () => {} }) {
  let cursor = 0;
  return <p className="native-mark-words-passage" aria-label={`Passage ${itemNumber}`}>{item.words.map((word, position) => {
    const gap = item.text.slice(cursor, word.start); cursor = word.end;
    return <Fragment key={word.id}>{gap}<WordButton {...{ item, word, position, itemNumber, readOnly, onToggle }} selected={selected.includes(word.id)} /></Fragment>;
  })}{item.text.slice(cursor)}</p>;
}

export function NativeMarkWordsPresentation({ document, assetUrl = () => "", responses = {}, onToggle = () => {}, readOnly = false, panelIndex: externalPanelIndex = null, onPanelChange = null, externalNavigation = false, embeddedCanvas = false }) {
  useNativeActivityFonts(document, assetUrl);
  const [localPanel, setLocalPanel] = useState(0);
  const { items, presentation } = document.parts[0].interaction;
  const visualTargets = isMarkWordsVisual(document.parts[0].interaction);
  const { panels, textStyle = {}, marking } = presentation;
  const panelIndex = Math.max(0, Math.min(panels.length - 1, externalPanelIndex ?? localPanel));
  const panel = panels[panelIndex];
  const changePanel = (next) => { setLocalPanel(next); onPanelChange?.(next); };
  const reference = panel && document.assets.find((asset) => asset.slot === panel.backgroundAssetSlot);
  const stage = panel ? { width: panel.sourceWidth, height: panel.sourceHeight } : null;
  return <div className="native-mark-words" data-embedded-canvas={embeddedCanvas || undefined} data-marking={marking} data-presentation={presentation.kind} style={{ fontFamily: nativeActivityFontFamily(document, textStyle.fontAssetSlot), fontSize: textStyle.fontSize, color: textStyle.color, lineHeight: textStyle.lineSpacing ? textStyle.lineSpacing / 100 : undefined }}>
    {presentation.kind === "text" ? items.map((item, index) => <NativeMarkWordsPassage key={item.id} item={item} itemNumber={index + 1} selected={responses[item.id] || []} {...{ readOnly, onToggle }} />) : <>
      {!embeddedCanvas && !externalNavigation && panels.length > 1 ? <nav className="native-mark-words-navigation" aria-label="Visual panel navigation"><button type="button" disabled={!panelIndex} onClick={() => changePanel(panelIndex - 1)}>Previous</button><span role="status">Panel {panelIndex + 1} of {panels.length}</span><button type="button" disabled={panelIndex >= panels.length - 1} onClick={() => changePanel(panelIndex + 1)}>Next</button></nav> : null}
      {panel ? <div className="native-mark-words-stage-slot"><div className="native-mark-words-stage" style={{ aspectRatio: `${stage.width} / ${stage.height}`, "--mark-words-ratio": stage.width / stage.height }} aria-label={`Panel ${panelIndex + 1}`}>
        {!embeddedCanvas && reference ? <img src={assetUrl(reference.assetId)} alt="" draggable={false} /> : !embeddedCanvas ? <p role="status">Panel background is unavailable.</p> : null}
        {panel.hotspots.map((hotspot) => {
          if (visualTargets) {
            const target = document.parts[0].interaction.targets.find((entry) => entry.id === hotspot.targetId);
            const selected = (responses[panel.id] || []).includes(target.id);
            const graphic = document.assets.find((asset) => asset.slot === hotspot.graphicAssetSlot);
            return <Fragment key={hotspot.id}>{selected && graphic ? <img className="native-mark-words-graphic" src={assetUrl(graphic.assetId)} alt="" aria-hidden="true" style={logicalAreaStyle(hotspot.markArea, stage)} /> : null}<WordButton item={{ id: panel.id }} word={{ id: target.id }} label={target.label || `Target ${panel.hotspots.indexOf(hotspot) + 1}`} {...{ selected, readOnly, onToggle }} visual style={logicalAreaStyle(hotspot.area, stage)} /></Fragment>;
          }
          const itemNumber = items.findIndex((item) => item.id === hotspot.itemId) + 1; const item = items[itemNumber - 1];
          const position = item.words.findIndex((word) => word.id === hotspot.wordId); const word = item.words[position];
          const selected = (responses[item.id] || []).includes(word.id);
          return <Fragment key={hotspot.id}><span className="native-mark-words-mark" style={logicalAreaStyle(hotspot.markArea, stage)} data-selected={selected || undefined} aria-hidden="true" /><WordButton {...{ item, word, position, itemNumber, selected, readOnly, onToggle }} visual style={logicalAreaStyle(hotspot.area, stage)} /></Fragment>;
        })}
      </div></div> : <p role="status">Add a visual panel.</p>}
    </>}
  </div>;
}

function StudentSession({ document, assetUrl, responses: controlled = null, initialResponses = null, onResponsesChange = null, readOnly = false, embeddedCanvas = false }) {
  const [local, setLocal] = useState(() => restoreNativeMarkWordsResponses(document, initialResponses));
  const responses = restoreNativeMarkWordsResponses(document, controlled ?? local);
  const onToggle = (itemId, wordId) => {
    if (readOnly) return;
    const next = toggleNativeMarkWordsResponse(document, responses, itemId, wordId);
    if (controlled === null) setLocal(next);
    onResponsesChange?.(next);
  };
  return <NativeMarkWordsPresentation {...{ document, assetUrl, responses, readOnly, onToggle, embeddedCanvas }} />;
}

export function NativeMarkWordsStudentSurface({ identity = "", ...props }) {
  return <StudentSession key={`${props.document.activityId}:${identity}`} {...props} />;
}
