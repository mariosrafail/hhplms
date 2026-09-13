import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, Trash2, Upload, VolumeX } from "lucide-react";

import { NativeImageSurface } from "../../../components/native-image/NativeImageSurface.jsx";
import { NativeOpenResponseFontSurface } from "../../../components/native-open-response/NativeOpenResponseSurface.jsx";
import { NativeAudioTextFocusContent, nativeAudioTextHotspotArtwork } from "../../../components/native-readable-text/NativeAudioTextHotspots.jsx";
import { StageSelectionFrame } from "../../../components/builder-studio/StageSelectionFrame.jsx";
import { StageGeometryControls, StageIntegerPosition } from "../../../components/builder-studio/StageGeometryControls.jsx";
import { logicalAreaStyle, normalizeStageGeometryAspectRatio, roundStageValue } from "../../../components/builder-studio/stageGeometry.js";
import { NATIVE_AUDIO_TEXT_DEFAULT_HIGHLIGHT_COLOR, NATIVE_AUDIO_TEXT_FIXED_FOCUS_ASPECT_RATIO, NATIVE_AUDIO_TEXT_HIGHLIGHT_COLORS, nativeAudioTextFocusLayout, nativeAudioTextHighlightColor, nativeAudioTextHotspotTargets, nativeAudioTextReadableHighlightArea, normalizeNativeAudioTextHotspots } from "../../../data/native-activities/nativeAudioTextHotspots.js";
import { mergeNativeManagedAssetReference, removeNativeManagedAssetReferenceIfUnused } from "../../../data/native-activities/nativeActivityPublic.js";
import { createNativeChildId } from "../../../data/native-activities/nativeChildIdentity.js";
import { uploadNativeActivityAsset } from "./builderNativeActivityApi.js";
import "./nativeAudioTextHotspotEditor.css";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const OUTER_FOCUS_ASPECT_RATIO = NATIVE_AUDIO_TEXT_FIXED_FOCUS_ASPECT_RATIO;

function defaultActivityArea(target) {
  const size = clamp(Math.round(Math.min(target.width, target.height) * 0.08), 24, 96);
  return { x: Math.round((target.width - size) / 2), y: Math.round((target.height - size) / 2), width: size, height: size };
}

function defaultFocusArea(readableText) {
  const width = Math.max(16, Math.round(readableText.sourceWidth * 0.88));
  const height = Math.max(16, Math.round(Math.min(readableText.sourceHeight * 0.24, width * 0.7)));
  return { x: Math.round((readableText.sourceWidth - width) / 2), y: 0, width, height };
}

function containedArea(area, outer) {
  const width = Math.min(outer.width, Math.max(1, roundStageValue(area.width)));
  const height = Math.min(outer.height, Math.max(1, roundStageValue(area.height)));
  return {
    x: roundStageValue(clamp(area.x, outer.x, outer.x + outer.width - width)),
    y: roundStageValue(clamp(area.y, outer.y, outer.y + outer.height - height)),
    width,
    height,
  };
}

function pointInSource(event, source) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * source.width, 0, source.width),
    y: clamp(((event.clientY - rect.top) / rect.height) * source.height, 0, source.height),
  };
}

function ActivityCanvas({ document, target, hotspot, assetUrl, onPlace }) {
  const interaction = document.parts[0].interaction;
  const marker = hotspot ? <span className="native-audio-hotspot-authoring-marker" style={logicalAreaStyle(hotspot.activityArea, target)}><img src={nativeAudioTextHotspotArtwork(hotspot).active} alt="" /></span> : null;
  let content = null;
  if (document.kind === "image") content = <NativeImageSurface document={document} assetUrl={assetUrl} />;
  else if (document.kind === "drag-drop") {
    const panel = interaction.panels.find((entry) => entry.id === target.panelId);
    content = panel ? <NativeImageSurface document={{ ...document, parts: [{ id: "part-1", interaction: { kind: "image", surface: panel.surface, images: panel.images } }] }} assetUrl={assetUrl} /> : null;
  }
  else if (document.kind === "open-response") {
    const panel = interaction.presentation?.panels?.find((entry) => entry.id === target.panelId) || null;
    content = <NativeOpenResponseFontSurface document={document} panel={panel} assetUrl={assetUrl} />;
  }
  else if (document.kind === "complete-sentences") {
    const panel = interaction.presentation?.panels?.find((entry) => entry.id === target.panelId);
    const reference = document.assets.find((asset) => asset.slot === panel?.backgroundAssetSlot);
    content = reference ? <img className="native-audio-hotspot-panel-image" src={assetUrl(reference.assetId)} alt={`Complete the Sentences panel ${interaction.presentation.panels.indexOf(panel) + 1}`} /> : null;
  }
  else {
    const panel = interaction.presentation?.panels?.find((entry) => entry.id === target.panelId);
    const reference = document.assets.find((asset) => asset.slot === panel?.backgroundAssetSlot);
    content = reference ? <img className="native-audio-hotspot-panel-image" src={assetUrl(reference.assetId)} alt={`Panel ${interaction.presentation.panels.indexOf(panel) + 1}`} /> : null;
  }
  return <div className="native-audio-hotspot-authoring-stage" style={{ aspectRatio: `${target.width} / ${target.height}` }} onClick={(event) => onPlace(pointInSource(event, target))} onKeyDown={(event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    onPlace({ x: target.width / 2, y: target.height / 2 });
  }} role="button" tabIndex={0} aria-label="Place readable-text hotspot on activity">
    <div className="native-audio-hotspot-authoring-stage-content" aria-hidden="true">{content}</div>
    {marker}
  </div>;
}

function FocusCanvas({ readableText, imageUrl, hotspot, onFocusArea, onFocusLayout, onHighlightArea, onDeleteHighlight }) {
  const gesture = useRef(null);
  const [selectedRegion, setSelectedRegion] = useState(nativeAudioTextReadableHighlightArea(hotspot) ? "highlight" : "focus");
  const [drawRegion, setDrawRegion] = useState(null);
  const keepAspectRatio = nativeAudioTextFocusLayout(hotspot) === "fixed-aspect";
  const bounds = { width: readableText.sourceWidth, height: readableText.sourceHeight };
  const highlight = nativeAudioTextReadableHighlightArea(hotspot);
  const select = (region) => { gesture.current = null; setSelectedRegion(region); setDrawRegion(null); };
  const armDraw = (region) => { gesture.current = null; setSelectedRegion(region); setDrawRegion(region); };
  const beginDraw = (event) => {
    if (!drawRegion) return;
    gesture.current = { pointerId: event.pointerId, region: drawRegion, hotspotId: hotspot.id, start: pointInSource(event, bounds), focusArea: { ...hotspot.readableFocusArea } };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const finishDraw = (event, cancelled = false) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (cancelled || active.hotspotId !== hotspot.id) return;
    const end = pointInSource(event, bounds);
    const area = { x: Math.round(Math.min(active.start.x, end.x)), y: Math.round(Math.min(active.start.y, end.y)), width: Math.round(Math.abs(active.start.x - end.x)), height: Math.round(Math.abs(active.start.y - end.y)) };
    if (area.width < 16 || area.height < 16) return;
    if (active.region === "focus") onFocusArea(keepAspectRatio ? normalizeStageGeometryAspectRatio(area, bounds, { aspectRatio: OUTER_FOCUS_ASPECT_RATIO, minWidth: 16, minHeight: 16 }) : area);
    else onHighlightArea(containedArea(area, active.focusArea));
    setSelectedRegion(active.region);
    setDrawRegion(null);
  };
  return <div className="native-audio-hotspot-focus-authoring">
    <div className="native-audio-hotspot-focus-tools" aria-label="Readable text rectangle tools">
      <button type="button" className="studio-button" aria-pressed={selectedRegion === "focus" && !drawRegion} onClick={() => select("focus")}>Select outer focus</button>
      <button type="button" className="studio-button" aria-pressed={drawRegion === "focus"} onClick={() => armDraw("focus")}>Redraw outer focus</button>
      <label className="studio-quick-check"><input type="checkbox" checked={keepAspectRatio} onChange={(event) => { const checked = event.target.checked; onFocusLayout(checked ? "fixed-aspect" : "natural-width"); if (checked) onFocusArea(normalizeStageGeometryAspectRatio(hotspot.readableFocusArea, bounds, { aspectRatio: OUTER_FOCUS_ASPECT_RATIO, minWidth: 16, minHeight: 16 })); }} /> Keep aspect ratio</label>
      {highlight ? <><button type="button" className="studio-button" aria-pressed={selectedRegion === "highlight" && !drawRegion} onClick={() => select("highlight")}>Select inner highlight</button><button type="button" className="studio-button" aria-pressed={drawRegion === "highlight"} onClick={() => armDraw("highlight")}>Redraw inner highlight</button><button type="button" className="studio-button studio-button--danger-ghost" onClick={() => { gesture.current = null; onDeleteHighlight(); setSelectedRegion("focus"); setDrawRegion(null); }}>Delete inner highlight</button></> : <button type="button" className="studio-button" onClick={() => { gesture.current = null; onHighlightArea(nativeAudioTextReadableHighlightArea({ readableFocusArea: hotspot.readableFocusArea })); setSelectedRegion("highlight"); }}>Add inner highlight</button>}
    </div>
    <div
      className={`native-audio-hotspot-focus-editor${drawRegion ? " is-drawing" : ""}`}
      style={{ aspectRatio: `${bounds.width} / ${bounds.height}` }}
      data-studio-stage
      data-highlight-color={nativeAudioTextHighlightColor(hotspot?.highlightColor)}
      data-selected-region={selectedRegion}
      onPointerDown={beginDraw}
      onPointerUp={(event) => finishDraw(event)}
      onPointerCancel={(event) => finishDraw(event, true)}
      role="group"
      aria-label="Readable text focus and highlight regions"
    >
      <img src={imageUrl} alt={readableText.altText} draggable="false" />
      {hotspot ? <>
        <button type="button" className="native-audio-hotspot-focus-box" style={logicalAreaStyle(hotspot.readableFocusArea, bounds)} aria-label="Select outer focus" onPointerDown={(event) => event.stopPropagation()} onClick={() => select("focus")} />
        {highlight ? <button type="button" className="native-audio-hotspot-highlight-box" style={logicalAreaStyle(highlight, bounds)} aria-label="Select inner highlight" onPointerDown={(event) => event.stopPropagation()} onClick={() => select("highlight")} /> : null}
        {!drawRegion && selectedRegion === "focus" ? <StageSelectionFrame geometry={hotspot.readableFocusArea} stage={bounds} label="Outer readable text focus" minWidth={16} minHeight={16} preserveAspectRatio={keepAspectRatio} aspectRatio={keepAspectRatio ? OUTER_FOCUS_ASPECT_RATIO : null} onChange={onFocusArea} /> : null}
        {!drawRegion && selectedRegion === "highlight" && highlight ? <StageSelectionFrame geometry={highlight} stage={bounds} label="Inner colored highlight" minWidth={Math.min(16, hotspot.readableFocusArea.width)} minHeight={Math.min(16, hotspot.readableFocusArea.height)} onChange={(area) => onHighlightArea(containedArea(area, hotspot.readableFocusArea))} onDelete={onDeleteHighlight} zIndex={100} /> : null}
      </> : null}
    </div>
    {selectedRegion === "focus" && !drawRegion ? <StageGeometryControls area={hotspot.readableFocusArea} stage={bounds} label="Outer readable text focus" minWidth={16} minHeight={16} aspectRatio={keepAspectRatio ? OUTER_FOCUS_ASPECT_RATIO : null} onChange={onFocusArea} /> : null}
  </div>;
}

export function NativeAudioTextHotspotEditor({ bookSlug, componentSlug, activityId, publicDraft, mutatePublic, previewUrl, onIncompleteChange, onStatusChange }) {
  const targets = nativeAudioTextHotspotTargets(publicDraft);
  const hotspots = publicDraft.audioTextHotspots?.hotspots || [];
  const [selectedId, setSelectedId] = useState(hotspots[0]?.id || null);
  const [uploading, setUploading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => { setSelectedId(publicDraft.audioTextHotspots?.hotspots?.[0]?.id || null); setPreviewing(false); }, [activityId]);
  const selected = hotspots.find((hotspot) => hotspot.id === selectedId) || hotspots[0] || null;
  const selectedTarget = targets.find((target) => target.panelId === selected?.panelId) || targets[0] || null;
  const readableReference = publicDraft.assets.find((asset) => asset.slot === publicDraft.readableText?.assetSlot);
  const incomplete = useMemo(() => {
    if (!publicDraft.audioTextHotspots) return false;
    try { normalizeNativeAudioTextHotspots(publicDraft.audioTextHotspots, publicDraft); return false; } catch { return true; }
  }, [publicDraft]);
  useEffect(() => { onIncompleteChange(incomplete || uploading); }, [incomplete, uploading, onIncompleteChange]);

  if (!publicDraft.readableText || !readableReference) return <section className="native-audio-hotspot-editor" aria-disabled="true"><h3>Audio / Text Hotspots</h3><p>Enable and upload Readable Text before adding audio hotspots.</p></section>;

  const updateSelected = (mutator) => mutatePublic((next) => {
    const hotspot = next.audioTextHotspots?.hotspots?.find((entry) => entry.id === selected.id);
    if (hotspot) mutator(hotspot, next);
  });
  const add = () => {
    if (!targets.length || hotspots.length >= 16) return;
    const id = createNativeChildId("aud");
    const target = targets[0];
    mutatePublic((next) => {
      next.audioTextHotspots ||= { hotspots: [] };
      const readableFocusArea = defaultFocusArea(next.readableText);
      next.audioTextHotspots.hotspots.push({
        id,
        panelId: target.panelId,
        activityArea: defaultActivityArea(target),
        readableFocusArea,
        focusLayout: "natural-width",
        readableHighlightArea: nativeAudioTextReadableHighlightArea({ readableFocusArea }),
        audioAssetSlot: "",
        label: `Open readable excerpt ${next.audioTextHotspots.hotspots.length + 1}`,
      });
    });
    setSelectedId(id);
    onStatusChange("Place the hotspot and draw its readable-text focus region. An MP3 is optional.");
  };
  const remove = () => mutatePublic((next) => {
    const removed = next.audioTextHotspots.hotspots.find((hotspot) => hotspot.id === selected.id);
    next.audioTextHotspots.hotspots = next.audioTextHotspots.hotspots.filter((hotspot) => hotspot.id !== selected.id);
    if (!next.audioTextHotspots.hotspots.length) delete next.audioTextHotspots;
    if (removed?.audioAssetSlot) removeNativeManagedAssetReferenceIfUnused(next, removed.audioAssetSlot);
    setSelectedId(next.audioTextHotspots?.hotspots?.[0]?.id || null);
    setPreviewing(false);
  });
  const uploadAudio = async (file) => {
    if (!file || !selected) return;
    setUploading(true);
    onStatusChange("Uploading hotspot MP3…");
    try {
      const uploaded = await uploadNativeActivityAsset({ bookSlug, componentSlug, activityId, assetSlot: createNativeChildId("asset"), file });
      if (uploaded.metadata?.mimeType !== "audio/mpeg") throw new Error("Uploaded hotspot audio is not an MP3.");
      updateSelected((hotspot, next) => {
        const previousSlot = hotspot.audioAssetSlot;
        next.assets = mergeNativeManagedAssetReference(next.assets, uploaded.reference);
        hotspot.audioAssetSlot = uploaded.reference.slot;
        if (previousSlot) removeNativeManagedAssetReferenceIfUnused(next, previousSlot);
      });
      onStatusChange("Hotspot MP3 uploaded; save the draft to attach it.");
    } catch (error) {
      onStatusChange(error.message || "Hotspot MP3 upload failed.");
    } finally { setUploading(false); }
  };
  const removeAudio = () => updateSelected((hotspot, next) => {
    const previousSlot = hotspot.audioAssetSlot;
    hotspot.audioAssetSlot = "";
    if (previousSlot) removeNativeManagedAssetReferenceIfUnused(next, previousSlot);
    setPreviewing(false);
    onStatusChange("MP3 removed. The readable-text hotspot remains ready to save.");
  });
  const audioReference = selected ? publicDraft.assets.find((asset) => asset.slot === selected.audioAssetSlot) : null;

  return <section className="native-audio-hotspot-editor" aria-labelledby={`${activityId}-audio-hotspots-heading`}>
    <header><span className="studio-section-icon"><BookOpenText aria-hidden="true" /></span><div><h3 id={`${activityId}-audio-hotspots-heading`}>Readable-Text Hotspots</h3><p>Place a readable-text cue, focus an excerpt, and optionally attach one MP3.</p></div></header>
    {!targets.length ? <p role="alert">This text-only activity has no safe visual stage for readable-text hotspots.</p> : <button type="button" className="studio-button studio-button--primary" disabled={hotspots.length >= 16} onClick={add}>Add readable-text hotspot</button>}
    {hotspots.length ? <div className="native-audio-hotspot-list" role="tablist" aria-label="Readable-text hotspots">{hotspots.map((hotspot, index) => <button key={hotspot.id} type="button" role="tab" aria-selected={hotspot.id === selected?.id} onClick={() => { setSelectedId(hotspot.id); setPreviewing(false); }}>Hotspot {index + 1}</button>)}</div> : <p>No readable-text hotspots added.</p>}
    {selected && selectedTarget ? <div className="native-audio-hotspot-authoring">
      {targets.length > 1 ? <label className="studio-field"><span>Activity panel</span><select value={selected.panelId || ""} onChange={(event) => {
        const target = targets.find((entry) => entry.panelId === event.target.value);
        updateSelected((hotspot) => { hotspot.panelId = target.panelId; hotspot.activityArea = defaultActivityArea(target); });
      }}>{targets.map((target, index) => <option key={target.panelId} value={target.panelId}>Panel {index + 1}</option>)}</select></label> : null}
      <div><h4>1. Place on activity</h4><ActivityCanvas document={publicDraft} target={selectedTarget} hotspot={selected} assetUrl={previewUrl} onPlace={(point) => updateSelected((hotspot) => {
        hotspot.activityArea.x = clamp(Math.round(point.x - hotspot.activityArea.width / 2), 0, Math.floor(selectedTarget.width - hotspot.activityArea.width));
        hotspot.activityArea.y = clamp(Math.round(point.y - hotspot.activityArea.height / 2), 0, Math.floor(selectedTarget.height - hotspot.activityArea.height));
      })} /><div key={`${selected.id}:${selected.panelId}`} className="studio-number-grid" role="group" aria-label="Activity hotspot position">{["x", "y"].map((axis) => <StageIntegerPosition key={axis} axis={axis.toUpperCase()} value={selected.activityArea[axis]} maximum={selectedTarget[axis === "x" ? "width" : "height"] - selected.activityArea[axis === "x" ? "width" : "height"]} onChange={(value) => updateSelected((hotspot) => { hotspot.activityArea[axis] = value; })} />)}</div></div>
      <div><h4>2. Set transparent focus and colored highlight</h4><FocusCanvas readableText={publicDraft.readableText} imageUrl={previewUrl(readableReference.assetId)} hotspot={selected} onFocusArea={(area) => updateSelected((hotspot) => { hotspot.readableFocusArea = area; if (hotspot.readableHighlightArea) hotspot.readableHighlightArea = containedArea(hotspot.readableHighlightArea, area); })} onFocusLayout={(focusLayout) => updateSelected((hotspot) => { hotspot.focusLayout = focusLayout; })} onHighlightArea={(area) => updateSelected((hotspot) => { hotspot.readableHighlightArea = containedArea(area, hotspot.readableFocusArea); })} onDeleteHighlight={() => updateSelected((hotspot) => { hotspot.readableHighlightArea = null; })} /></div>
      <fieldset className="native-audio-hotspot-highlight-colors">
        <legend>Highlight color</legend>
        {NATIVE_AUDIO_TEXT_HIGHLIGHT_COLORS.map((color) => <label key={color} data-highlight-color={color}>
          <input
            type="radio"
            name={`${activityId}-${selected.id}-highlight-color`}
            value={color}
            checked={nativeAudioTextHighlightColor(selected.highlightColor) === color}
            onChange={() => updateSelected((hotspot) => { hotspot.highlightColor = color; })}
          />
          <span aria-hidden="true" />
          {color[0].toUpperCase() + color.slice(1)}{color === NATIVE_AUDIO_TEXT_DEFAULT_HIGHLIGHT_COLOR && !Object.hasOwn(selected, "highlightColor") ? " (default)" : ""}
        </label>)}
      </fieldset>
      <label className="studio-field"><span>Hotspot accessible label</span><input value={selected.label} maxLength={160} onChange={(event) => updateSelected((hotspot) => { hotspot.label = event.target.value; })} /></label>
      <p className="native-audio-hotspot-audio-status" data-audio-attached={Boolean(audioReference) || undefined}>{audioReference ? "MP3 attached" : "No MP3 attached (optional)"}</p>
      <label className="studio-upload-action"><Upload aria-hidden="true" /><span><strong>{uploading ? "Uploading…" : audioReference ? "Replace MP3" : "Upload MP3"}</strong><small>MP3, up to 50 MB</small></span><input type="file" accept="audio/mpeg,.mp3" disabled={uploading} onChange={(event) => { uploadAudio(event.target.files?.[0]); event.target.value = ""; }} /></label>
      {audioReference ? <audio controls preload="metadata" src={previewUrl(audioReference.assetId)} aria-label={`Preview ${selected.label}`} /> : null}
      <div className="native-audio-hotspot-actions"><button type="button" className="studio-button" onClick={() => setPreviewing((value) => !value)}>{previewing ? "Close hotspot preview" : "Test hotspot"}</button>{audioReference ? <button type="button" className="studio-button studio-button--danger-ghost" onClick={removeAudio}><VolumeX aria-hidden="true" />Remove MP3</button> : null}<button type="button" className="studio-button studio-button--danger-ghost" onClick={remove}><Trash2 aria-hidden="true" />Remove hotspot</button></div>
      {previewing ? <div className="native-audio-hotspot-authoring-preview"><NativeAudioTextFocusContent document={publicDraft} hotspot={selected} assetUrl={previewUrl} autoPlay /><ActivityCanvas document={publicDraft} target={selectedTarget} hotspot={selected} assetUrl={previewUrl} onPlace={() => {}} /></div> : null}
    </div> : null}
  </section>;
}
