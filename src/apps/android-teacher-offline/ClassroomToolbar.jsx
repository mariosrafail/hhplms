import { useEffect, useState } from "react";

import { CLASSROOM_COLORS, CLASSROOM_STROKES, DRAWING_TOOLS, useClassroomTools } from "./ClassroomToolsContext.jsx";

const UI_ONLY_TOOLS = new Set(["marker", "annotations", "url", "save", "load"]);
const ACTIVE_TOOL_TO_LEGACY_ID = Object.freeze({
  pointer: "mouse",
  pen: "pencil",
  eraser: "eraser",
  text: "text",
  cover: "hide",
  spotlight: "show",
  "zoom-region": "zoom",
});

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  return `${minutes}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function LegacyTeacherToolButton({ item, selected, onActivate }) {
  return (
    <button
      type="button"
      className="legacy-teacher-tool-button"
      data-teacher-tool={item.id}
      data-teacher-control-id={item.controlId}
      data-sound-category={item.controlId ? "toolbar" : undefined}
      aria-label={item.label}
      aria-pressed={selected}
      title={item.label}
      onClick={() => onActivate(item.id)}
    >
      <span className="legacy-teacher-tool-icon-stack" aria-hidden="true">
        <img className="legacy-teacher-tool-icon legacy-teacher-tool-icon-normal" src={item.normal} alt="" draggable="false" />
        <img className="legacy-teacher-tool-icon legacy-teacher-tool-icon-active" src={item.active} alt="" draggable="false" />
      </span>
    </button>
  );
}

export default function ClassroomToolbar({ surfaceKey, items, inert = false }) {
  const {
    activeTool,
    setActiveTool,
    color,
    setColor,
    strokeWidth,
    setStrokeWidth,
    getDrawingHistory,
    clearDrawing,
    undoDrawing,
    redoDrawing,
    getOverlays,
    clearCovers,
    setSpotlight,
    clearAllMarkup,
    getRegionZoom,
    resetRegionZoom,
    openPanel,
    setOpenPanel,
    requestKeyboard,
    message,
    setMessage,
    timer,
    setTimer,
    setTimerMinutes,
    scores,
    setScores,
  } = useClassroomTools();
  const [manualMinutes, setManualMinutes] = useState(5);
  const [uiOnlySelection, setUiOnlySelection] = useState("");
  const history = getDrawingHistory(surfaceKey);
  const overlays = getOverlays(surfaceKey);
  const regionZoom = getRegionZoom(surfaceKey);
  const drawingMode = DRAWING_TOOLS.has(activeTool);

  useEffect(() => {
    setActiveTool("pointer");
    setOpenPanel("");
    setUiOnlySelection("");
    resetRegionZoom(surfaceKey);
  }, [surfaceKey]);

  const focusStage = () => setTimeout(() => {
    document.querySelector(`[data-classroom-surface-id="${CSS.escape(surfaceKey)}"]`)?.focus({ preventScroll: true });
  }, 0);
  const selectMouse = ({ focus = true } = {}) => {
    setUiOnlySelection("");
    setActiveTool("pointer");
    setOpenPanel("");
    resetRegionZoom(surfaceKey);
    if (focus) focusStage();
  };
  const enterMode = (tool) => {
    setUiOnlySelection("");
    setOpenPanel("");
    resetRegionZoom(surfaceKey);
    setActiveTool(tool);
  };
  const togglePanel = (panel) => {
    if (openPanel === panel) {
      selectMouse();
      return;
    }
    setUiOnlySelection("");
    setActiveTool("pointer");
    resetRegionZoom(surfaceKey);
    setOpenPanel(panel);
  };
  const selectUiOnlyTool = (tool) => {
    setActiveTool("pointer");
    setOpenPanel("");
    resetRegionZoom(surfaceKey);
    setUiOnlySelection(tool);
  };
  const runClearAction = (kind) => {
    const labels = {
      drawing: "Clear drawings and text for this view?",
      covers: "Clear all covers for this view?",
      spotlight: "Clear the spotlight for this view?",
      all: "Clear all classroom markup for this view?",
    };
    if (!globalThis.confirm(labels[kind])) return;
    if (kind === "drawing") clearDrawing(surfaceKey);
    if (kind === "covers") clearCovers(surfaceKey);
    if (kind === "spotlight") setSpotlight(surfaceKey, null);
    if (kind === "all") clearAllMarkup(surfaceKey);
    selectMouse();
  };
  const printCurrentView = () => {
    const target = [...document.querySelectorAll("[data-classroom-surface-id]")]
      .find((element) => element.dataset.classroomSurfaceId === surfaceKey);
    if (!target || typeof globalThis.print !== "function") {
      setMessage("Printing is not available on this device.");
      return;
    }
    target.classList.add("classroom-stage-print-target");
    const cleanup = () => target.classList.remove("classroom-stage-print-target");
    globalThis.addEventListener("afterprint", cleanup, { once: true });
    try {
      globalThis.print();
    } catch {
      cleanup();
      setMessage("Printing is not available on this device.");
    }
    setTimeout(cleanup, 5000);
  };
  const resetScores = () => {
    if (globalThis.confirm("Reset both team scores?")) setScores({ a: 0, b: 0 });
  };
  const activateTool = (tool) => {
    if (UI_ONLY_TOOLS.has(tool)) {
      selectUiOnlyTool(tool);
      return;
    }
    if (tool === "mouse") selectMouse();
    if (tool === "pencil") enterMode("pen");
    if (tool === "eraser") enterMode("eraser");
    if (tool === "clear") togglePanel("clear");
    if (tool === "zoom") regionZoom ? selectMouse() : enterMode("zoom-region");
    if (tool === "hide") enterMode("cover");
    if (tool === "show") enterMode("spotlight");
    if (tool === "undo") undoDrawing(surfaceKey);
    if (tool === "redo") redoDrawing(surfaceKey);
    if (tool === "text") enterMode("text");
    if (tool === "timer") togglePanel("timer");
    if (tool === "score") togglePanel("scoreboard");
    if (tool === "print") printCurrentView();
  };

  const selectedTool = openPanel === "timer" ? "timer"
    : openPanel === "scoreboard" ? "score"
      : openPanel === "clear" ? "clear"
        : regionZoom ? "zoom"
          : uiOnlySelection || ACTIVE_TOOL_TO_LEGACY_ID[activeTool] || "mouse";
  const modeTitle = drawingMode ? "PEN MODE"
    : activeTool === "cover" ? "COVER MODE"
      : activeTool === "spotlight" ? "SPOTLIGHT MODE"
        : activeTool === "zoom-region" ? "ZOOM MODE" : "";

  return (
    <>
      {modeTitle && (
        <div inert={inert} className="classroom-mode-banner" role="status">
          <div>
            <strong>{modeTitle}</strong>
            {drawingMode && <span>{activeTool === "pen" ? "Pen" : activeTool === "eraser" ? "Eraser" : "Text"}</span>}
          </div>
          <button type="button" aria-label={`Exit ${modeTitle.toLowerCase()}`} title={`Exit ${modeTitle.toLowerCase()}`} onClick={() => selectMouse()}>×</button>
        </div>
      )}

      {drawingMode && (
        <div inert={inert} className="classroom-drawing-options-panel" role="group" aria-label="Drawing colour and size">
          <div className="classroom-tool-options">
            <span>Colour</span>
            {CLASSROOM_COLORS.map((option) => (
              <button key={option} type="button" className={`classroom-colour-choice ${color === option ? "selected" : ""}`} style={{ "--tool-color": option }} aria-label={`Use ${option} colour`} aria-pressed={color === option} onClick={() => setColor(option)} />
            ))}
            <span>Size</span>
            {CLASSROOM_STROKES.map((option) => (
              <button key={option} type="button" className={`classroom-size-choice ${strokeWidth === option ? "selected" : ""}`} aria-label={`Use ${option} pixel stroke`} aria-pressed={strokeWidth === option} onClick={() => setStrokeWidth(option)}><i style={{ width: option * 2, height: option * 2 }} /></button>
            ))}
            {activeTool === "text" && <button type="button" className="classroom-keyboard-request" aria-label="Show on-screen keyboard" onClick={requestKeyboard}>Keyboard</button>}
          </div>
        </div>
      )}

      <div inert={inert} className="legacy-classroom-viewer-toolbar classroom-teaching-toolbar" role="toolbar" aria-label="Classroom teaching tools" style={{ "--teacher-toolbar-slot-count": items.length }}>
        <div className="classroom-tool-primary legacy-teacher-tool-row">
          {items.map((item) => (
            <LegacyTeacherToolButton
              key={item.id}
              item={item}
              selected={selectedTool === item.id}
              onActivate={activateTool}
            />
          ))}
        </div>
      </div>

      {openPanel === "timer" && (
        <aside inert={inert} className="classroom-floating-panel classroom-timer-panel" aria-label="Classroom timer">
          <header><strong>Classroom timer</strong><button type="button" aria-label="Close timer" onClick={() => selectMouse()}>×</button></header>
          <output aria-live="polite">{formatTime(timer.remaining)}</output>
          <div className="classroom-timer-presets">{[1, 2, 5, 10].map((minutes) => <button key={minutes} type="button" onClick={() => setTimerMinutes(minutes)}>{minutes} min</button>)}</div>
          <label>Minutes <input type="number" inputMode="numeric" min="1" max="99" value={manualMinutes} onChange={(event) => setManualMinutes(event.target.value)} /></label>
          <div>
            <button type="button" onClick={() => setTimer((current) => ({ ...current, running: !current.running && current.remaining > 0 }))}>{timer.running ? "Pause" : "Start"}</button>
            <button type="button" onClick={() => setTimerMinutes(manualMinutes)}>Set</button>
            <button type="button" onClick={() => setTimer((current) => ({ ...current, remaining: current.duration, running: false }))}>Reset</button>
          </div>
        </aside>
      )}

      {openPanel === "scoreboard" && (
        <aside inert={inert} className="classroom-floating-panel classroom-scoreboard" aria-label="Two-team scoreboard">
          <header><strong>Scoreboard</strong><button type="button" aria-label="Close scoreboard" onClick={() => selectMouse()}>×</button></header>
          {[["a", "Team A"], ["b", "Team B"]].map(([key, label]) => (
            <section key={key}><strong>{label}</strong><output aria-label={`${label} score`}>{scores[key]}</output><div>
              <button type="button" aria-label={`Subtract point from ${label}`} onClick={() => setScores((current) => ({ ...current, [key]: Math.max(0, current[key] - 1) }))}>−1</button>
              <button type="button" aria-label={`Add point to ${label}`} onClick={() => setScores((current) => ({ ...current, [key]: current[key] + 1 }))}>+1</button>
            </div></section>
          ))}
          <button type="button" className="classroom-score-reset" onClick={resetScores}>Reset scoreboard</button>
        </aside>
      )}

      {openPanel === "clear" && (
        <aside inert={inert} className="classroom-floating-panel classroom-clear-panel" aria-label="Clear current view">
          <header><strong>Clear current view</strong><button type="button" aria-label="Close clear menu" onClick={() => selectMouse()}>×</button></header>
          <button type="button" disabled={!history.present.length} onClick={() => runClearAction("drawing")}>Drawings &amp; text</button>
          <button type="button" disabled={!overlays.covers.length} onClick={() => runClearAction("covers")}>Covers</button>
          <button type="button" disabled={!overlays.spotlight} onClick={() => runClearAction("spotlight")}>Spotlight</button>
          <button type="button" disabled={!history.present.length && !overlays.covers.length && !overlays.spotlight} onClick={() => runClearAction("all")}>All classroom markup</button>
        </aside>
      )}
      {message && <div inert={inert} className="classroom-tool-message" role="status">{message}</div>}
    </>
  );
}
