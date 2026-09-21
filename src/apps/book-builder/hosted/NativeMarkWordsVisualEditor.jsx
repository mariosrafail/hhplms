import { NativeMarkWordsMarkerControls } from "./NativeMarkWordsMarkerControls.jsx";
import { NativeMarkWordsMarker } from "../../../components/native-mark-words/NativeMarkWordsMarker.jsx";
import { DEFAULT_MARK_WORDS_MARKER, markWordsMarkerArea, markWordsTargetMarker, normalizeMarkWordsMarker, isOutlineCategoryMode, outlineCategory, outlineCategoryPresets } from "../../../data/native-activities/nativeMarkWordsMarkers.js";
import { isMarkWordsVisual, createEmptyMarkWordsVisualInteraction, createEmptyMarkWordsVisualSolution } from "../../../data/native-activities/nativeMarkWordsVisualTargets.js";
import { alignVisualTargetAnswers, addVisualTarget, removeVisualTarget, setVisualTargetCorrect, enableOutlineCategories } from "../../../data/native-activities/nativeMarkWordsVisualAuthoring.js";
import { useEffect, useRef, useState } from "react";
import { StudioButton, StudioCanvasToolbar, StudioField } from "../../../components/builder-studio/StudioControls.jsx";
import { StageSelectionFrame } from "../../../components/builder-studio/StageSelectionFrame.jsx";
import { StageGeometryControls } from "../../../components/builder-studio/StageGeometryControls.jsx";
import { clientPointToStage, logicalAreaStyle } from "../../../components/builder-studio/stageGeometry.js";
import { NATIVE_MARK_WORDS_LIMITS } from "../../../data/native-activities/nativeMarkWords.js";
import { createNativeMarkWordsPanel, nextNativeMarkWordsBinding } from "../../../data/native-activities/nativeMarkWordsAuthoring.js";
import { createNativeChildId } from "../../../data/native-activities/nativeChildIdentity.js";
import { mergeNativeManagedAssetReference, removeNativeManagedAssetReferenceIfUnused } from "../../../data/native-activities/nativeActivityPublic.js";
import { getBuilderFontLibrary, uploadNativeActivityAsset } from "./builderNativeActivityApi.js";
import { NativeActivityFontControls } from "./NativeCompleteSentencesFontControls.jsx";

function Canvas({ panel, url, graphicUrl, selected, field, drawing, onSelect, onChange, onCreate, onDelete }) {
  const drag = useRef(null); const [draft, setDraft] = useState(null);
  const stage = { width: panel.sourceWidth, height: panel.sourceHeight };
  const bounds = (event) => clientPointToStage(event, event.currentTarget.getBoundingClientRect(), stage);
  const finish = (event, cancelled = false) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const area = drag.current.area; drag.current = null; setDraft(null);
    if (!cancelled && area?.width >= 2 && area?.height >= 2) onCreate(area);
  };
  return <div className="native-mark-words-canvas" data-studio-stage style={{ aspectRatio: `${stage.width}/${stage.height}`, touchAction: drawing ? "none" : "auto" }}
    onPointerDown={(event) => { if (!drawing || event.button !== 0) return; event.preventDefault(); const point = bounds(event); drag.current = { start: point, pointerId: event.pointerId }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={(event) => { const current = drag.current; if (!current || current.pointerId !== event.pointerId) return; const point = bounds(event); const x = Math.max(0, Math.round(Math.min(current.start.x, point.x))); const y = Math.max(0, Math.round(Math.min(current.start.y, point.y))); current.area = { x, y, width: Math.max(1, Math.min(stage.width - x, Math.round(Math.abs(point.x - current.start.x)))), height: Math.max(1, Math.min(stage.height - y, Math.round(Math.abs(point.y - current.start.y)))) }; setDraft(current.area); }}
    onPointerUp={finish} onPointerCancel={(event) => finish(event, true)}>
    {url ? <img src={url} alt="Panel background" draggable={false} /> : <p>Upload a panel background.</p>}
    {panel.hotspots.map((hotspot, index) => <span key={hotspot.id}><button type="button" className="native-mark-words-authoring-hit" style={{ ...logicalAreaStyle(hotspot.area, stage), pointerEvents: drawing ? "none" : undefined }} onPointerDown={(event) => event.stopPropagation()} onClick={() => onSelect(hotspot.id)} aria-label={`Word hotspot ${index + 1}`}>{index + 1}</button><NativeMarkWordsMarker hotspot={hotspot} stage={stage} graphicUrl={graphicUrl} /></span>)}
    {draft ? <span className="native-mark-words-authoring-hit" style={{ ...logicalAreaStyle(draft, stage), pointerEvents: "none" }} /> : null}
    {selected && !drawing ? <StageSelectionFrame geometry={selected[field]} stage={stage} label={field === "area" ? "Click area" : "Marking area"} minWidth={1} minHeight={1} onChange={onChange} onDelete={onDelete} onClear={() => onSelect(null)} /> : null}
  </div>;
}

export function NativeMarkWordsVisualEditor({ bookSlug, componentSlug, activityId, publicDraft, teacherDraft, mutatePair, sharedCanvas = false, drawingDefaults = null, onDrawingDefaultsChange = null, mutatePublic, assetUrl, onMessage, onUploading, isActive }) {
  const [panelId, setPanelId] = useState(null); const [hotspotId, setHotspotId] = useState(null); const [field, setField] = useState("area");
  const [localDefaults, setLocalDefaults] = useState(() => { const interaction = publicDraft.parts[0].interaction; const { id, ...marker } = (isOutlineCategoryMode(interaction) ? outlineCategoryPresets(interaction)[0] : interaction.presentation.markerPresets?.at(-1)) || DEFAULT_MARK_WORDS_MARKER; return { correct: true, marker }; });
  const inheritedDefaults = drawingDefaults || localDefaults;
  const outlineFallback = isOutlineCategoryMode(publicDraft.parts[0].interaction) && !outlineCategory(inheritedDefaults.marker) ? outlineCategoryPresets(publicDraft.parts[0].interaction)[0] : null;
  const defaults = outlineFallback ? { ...inheritedDefaults, marker: Object.fromEntries(Object.entries(outlineFallback).filter(([key]) => key !== "id")) } : inheritedDefaults;
  const setDefaults = (value) => { const next = typeof value === "function" ? value(defaults) : value; if (onDrawingDefaultsChange) onDrawingDefaultsChange(next); else setLocalDefaults(next); };
  const [zoom, setZoom] = useState(1); const [drawing, setDrawing] = useState(false); const [fonts, setFonts] = useState([]);
  useEffect(() => { const controller = new AbortController(); getBuilderFontLibrary({ bookSlug, componentSlug }, { signal: controller.signal }).then((value) => { if (!controller.signal.aborted) setFonts(value); }).catch((error) => { if (!controller.signal.aborted) onMessage(error.message); }); return () => controller.abort(); }, [bookSlug, componentSlug]);
  const interaction = publicDraft.parts[0].interaction; const presentation = interaction.presentation; const panels = presentation.panels;
  const panel = panels.find((entry) => entry.id === panelId) || panels[0];
  const selected = panel?.hotspots.find((hotspot) => hotspot.id === hotspotId);
  const visual = isMarkWordsVisual(interaction);
  const grouped = isOutlineCategoryMode(interaction);
  const categoryMarker = (targetId) => outlineCategoryPresets(interaction).find((preset) => outlineCategory(preset) === teacherDraft.parts[0].solution.answers.find((answer) => answer.panelId === panel.id)?.categories?.[targetId]) || outlineCategoryPresets(interaction)[0];
  const selectedMarker = grouped && selected ? categoryMarker(selected.targetId) : selected ? markWordsTargetMarker(selected) : null;
  const selectedMarkerStyle = selectedMarker ? Object.fromEntries(Object.entries(selectedMarker).filter(([key]) => key !== "id")) : null;
  const next = panel && !visual ? nextNativeMarkWordsBinding(interaction, panel.id) : null;
  const stage = panel ? { width: panel.sourceWidth, height: panel.sourceHeight } : null;
  const changeStyle = (key, value) => mutatePublic((doc) => { doc.parts[0].interaction.presentation.textStyle[key] = value; });
  const setFont = (font) => mutatePublic((doc) => {
    const style = doc.parts[0].interaction.presentation.textStyle; const previousSlot = style.fontAssetSlot;
    if (font) doc.assets = mergeNativeManagedAssetReference(doc.assets, { assetId: font.assetId, checksumSha256: font.checksumSha256, role: font.role, slot: font.slot });
    style.fontAssetSlot = font?.slot || null;
    if (previousSlot) removeNativeManagedAssetReferenceIfUnused(doc, previousSlot);
  });
  const addPanel = () => { const value = createNativeMarkWordsPanel(); mutatePair((doc, teacher) => { doc.parts[0].interaction.presentation.panels.push(value); if (visual) alignVisualTargetAnswers(doc, teacher); }); setPanelId(value.id); setHotspotId(null); };
  const upload = async (file) => {
    if (!file || !panel) return;
    if (!visual && panel.backgroundAssetSlot && !globalThis.confirm("Replace this background and clear its word hotspots? Remap the printed words using the new image's intrinsic dimensions.")) return;
    onUploading(true);
    try {
      const uploaded = await uploadNativeActivityAsset({ bookSlug, componentSlug, activityId, assetSlot: createNativeChildId("asset"), file });
      if (!isActive()) return;
      if (![uploaded.metadata?.width, uploaded.metadata?.height].every((value) => Number.isSafeInteger(value) && value > 0 && value <= NATIVE_MARK_WORDS_LIMITS.sourceDimension)) throw new Error("Image dimensions are unavailable or exceed 16,384 pixels.");
      mutatePublic((doc) => {
        const target = doc.parts[0].interaction.presentation.panels.find((entry) => entry.id === panel.id);
        if (!target) throw new Error("Panel was removed before upload completed.");
        const previousSlot = target.backgroundAssetSlot;
        doc.assets = mergeNativeManagedAssetReference(doc.assets, uploaded.reference);
        Object.assign(target, { backgroundAssetSlot: uploaded.reference.slot, sourceWidth: uploaded.metadata.width, sourceHeight: uploaded.metadata.height, hotspots: visual ? target.hotspots : [] });
        if (previousSlot) removeNativeManagedAssetReferenceIfUnused(doc, previousSlot);
      });
      setHotspotId(null); onMessage("Background uploaded. Existing visual target coordinates are retained; review bounds after a dimension change.");
    } catch (error) { if (isActive()) onMessage(error.message); }
    finally { if (isActive()) onUploading(false); }
  };
  const createHotspot = (area) => {
    if (visual) { try { normalizeMarkWordsMarker(defaults.marker, publicDraft.assets); if (grouped && !outlineCategory(defaults.marker)) throw new Error("Choose an outline color before drawing grouped targets."); } catch (error) { onMessage(error.message); return; } mutatePair((pub, teacher) => { rememberPreset(pub, defaults.marker); setHotspotId(addVisualTarget(pub, teacher, panel.id, area, createNativeChildId, defaults)); }); return; }
    if (!next) { setDrawing(false); return; }
    const hotspot = { id: createNativeChildId("hot"), ...next, area: { ...area }, markArea: { ...area } };
    mutatePublic((doc) => doc.parts[0].interaction.presentation.panels.find((entry) => entry.id === panel.id).hotspots.push(hotspot));
    setHotspotId(hotspot.id);
  };
  const removeHotspot = () => { if (visual) { mutatePair((pub, teacher) => removeVisualTarget(pub, teacher, panel.id, hotspotId)); setHotspotId(null); return; } mutatePublic((doc) => { const current = doc.parts[0].interaction.presentation.panels.find((entry) => entry.id === panel.id); current.hotspots = current.hotspots.filter((entry) => entry.id !== hotspotId); }); setHotspotId(null); };
  const changeGeometry = (raw) => mutatePublic((doc) => {
    const hotspot = doc.parts[0].interaction.presentation.panels.find((entry) => entry.id === panel.id).hotspots.find((entry) => entry.id === hotspotId);
    const area = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Math.round(value)]));
    if (grouped) { hotspot.area = area; hotspot.markArea = { ...area }; return; }
    if (field === "area" && area.width === hotspot.area.width && area.height === hotspot.area.height) { hotspot.markArea.x += area.x - hotspot.area.x; hotspot.markArea.y += area.y - hotspot.area.y; }
    hotspot[field] = area;
    if (hotspot.marker) {
      if (field === "markArea") hotspot.marker.alignment = "manual";
      else if (hotspot.marker.alignment === "bottom") hotspot.markArea = markWordsMarkerArea(area, hotspot.marker);
    }
  });
  const rememberPreset = (pub, marker) => {
    normalizeMarkWordsMarker(marker, pub.assets);
    const list = pub.parts[0].interaction.presentation.markerPresets ||= [];
    const categoryPreset = isOutlineCategoryMode(pub.parts[0].interaction) && list.find((preset) => outlineCategory(marker) && outlineCategory(preset) === outlineCategory(marker));
    if (categoryPreset) { Object.assign(categoryPreset, marker); return; }
    if (!list.some(({ id, ...style }) => (outlineCategory(marker) ? outlineCategory(style) === outlineCategory(marker) : JSON.stringify(style) === JSON.stringify(marker)))) {
      if (list.length >= 32) throw new Error("The marker palette supports at most 32 presets.");
      list.push({ id: createNativeChildId("marker"), ...marker });
    }
  };
  const changeDefaultMarker = (marker) => {
    setDefaults((current) => ({ ...current, marker }));
    if (marker.kind !== "graphic" || marker.graphicAssetSlot) mutatePublic((pub) => rememberPreset(pub, marker));
  };
  const changeSelectedMarker = (marker, reference = null) => mutatePair((pub, teacher) => {
    const target = pub.parts[0].interaction.presentation.panels.find((entry) => entry.id === panel.id)?.hotspots.find((entry) => entry.id === selected.id);
    if (!target) return;
    if (reference) pub.assets = mergeNativeManagedAssetReference(pub.assets, reference);
    if (marker.kind === "graphic" && !marker.graphicAssetSlot) { onMessage("Select or upload a graphic before applying Graphic."); return; }
    rememberPreset(pub, marker);
    if (isOutlineCategoryMode(pub.parts[0].interaction)) {
      if (!outlineCategory(marker)) throw new Error("Choose an outline category in grouped mode.");
      const answer = teacher.parts[0].solution.answers.find((entry) => entry.panelId === panel.id);
      if (answer.correctTargetIds.includes(target.targetId)) answer.categories[target.targetId] = outlineCategory(marker);
      return;
    }
    target.marker = marker; target.graphicAssetSlot = marker.graphicAssetSlot;
    if (marker.alignment === "bottom") target.markArea = markWordsMarkerArea(target.area, marker);
  });
  const uploadGraphic = async (file, forDefault = true) => {
    if (!file) return;
    if (grouped) { onMessage("Grouped answers use outline colors."); return; }
    const ownerPanelId = panel?.id; const ownerTargetId = selected?.id;
    const initialMarker = forDefault ? defaults.marker : markWordsTargetMarker(selected);
    onUploading(true);
    try {
      const result = await uploadNativeActivityAsset({ bookSlug, componentSlug, activityId, assetSlot: createNativeChildId("asset"), file });
      if (!isActive()) return;
      const marker = { ...initialMarker, kind: "graphic", graphicAssetSlot: result.reference.slot };
      mutatePublic((pub) => {
        const owner = pub.parts[0].interaction.presentation.panels.find((entry) => entry.id === ownerPanelId);
        if (!owner) throw new Error("Panel was removed during upload.");
        const target = forDefault ? null : owner.hotspots.find((entry) => entry.id === ownerTargetId);
        if (!forDefault && !target) throw new Error("Target was removed during upload.");
        pub.assets = mergeNativeManagedAssetReference(pub.assets, result.reference);
        rememberPreset(pub, marker);
        if (target) { target.marker = marker; target.graphicAssetSlot = marker.graphicAssetSlot; if (marker.alignment === "bottom") target.markArea = markWordsMarkerArea(target.area, marker); }
      });
      if (forDefault) setDefaults((current) => ({ ...current, marker }));
    } catch (error) { if (isActive()) onMessage(error.message); }
    finally { if (isActive()) onUploading(false); }
  };
  const graphicSlots = new Set([...(presentation.markerPresets || []).map((marker) => marker.graphicAssetSlot), ...panels.flatMap((entry) => entry.hotspots.map((hotspot) => hotspot.graphicAssetSlot))].filter(Boolean));
  const graphics = publicDraft.assets.filter((asset) => graphicSlots.has(asset.slot));
  const mapped = new Set(panels.flatMap((entry) => entry.hotspots.map((hotspot) => hotspot.wordId)));
  const nextItem = (interaction.items || []).find((item) => item.id === next?.itemId); const nextWord = nextItem?.words.find((word) => word.id === next?.wordId);
  return <section className="studio-content-panel">
    {visual ? <label><input type="checkbox" checked={grouped} onChange={(event) => { if (!event.target.checked && !globalThis.confirm("Disable category grading and discard all private target category assignments? Correct target selections and the palette stay unchanged. Re-enabling starts correct targets with the first outline color; previous categories cannot be recovered. Cancel keeps this activity unchanged.")) return; if (event.target.checked && !outlineCategoryPresets(interaction).length) { onMessage("Add an outline color to the palette first."); return; } try { mutatePair((pub, teacher) => enableOutlineCategories(pub, teacher, event.target.checked, { confirmed: true })); if (event.target.checked) { const { id, ...marker } = outlineCategoryPresets(interaction)[0]; setDefaults({ ...defaults, marker }); setField("area"); } } catch (error) { onMessage(error.message); } }} />Grade outline categories by color (Teacher-only target answers)</label> : null}
    {visual ? <StudioField label="Activity title"><input maxLength={300} value={publicDraft.metadata.title} onChange={(event) => mutatePublic((doc) => { doc.metadata.title = event.target.value; })} /></StudioField> : null}
    {!visual && !interaction.items.length && !panels.length ? <StudioButton onClick={() => mutatePair((pub, teacher) => { pub.parts[0].interaction = createEmptyMarkWordsVisualInteraction(); teacher.parts[0].solution = createEmptyMarkWordsVisualSolution(); })}>Create image targets without passage</StudioButton> : null}
    {!visual ? <div className="studio-form-grid"><StudioField label="Presentation"><select aria-label="Presentation" value={presentation.kind} onChange={(event) => mutatePublic((doc) => { doc.parts[0].interaction.presentation.kind = event.target.value; })}><option value="text">Real text</option><option value="image-hotspot">Publisher image with word hotspots</option></select></StudioField>
      <StudioField label="Marking style"><select aria-label="Marking style" value={presentation.marking} onChange={(event) => mutatePublic((doc) => { doc.parts[0].interaction.presentation.marking = event.target.value; })}><option value="underline">Underline</option><option value="highlight">Highlight</option></select></StudioField>
      <StudioField label="Font size"><input type="number" min={12} max={72} value={presentation.textStyle.fontSize} onChange={(event) => changeStyle("fontSize", Number(event.target.value))} /></StudioField>
      <StudioField label="Text color"><input type="color" value={presentation.textStyle.color} onChange={(event) => changeStyle("color", event.target.value)} /></StudioField>
      <StudioField label="Line spacing (%)"><input type="number" min={120} max={240} value={presentation.textStyle.lineSpacing} onChange={(event) => changeStyle("lineSpacing", Number(event.target.value))} /></StudioField>
      <NativeActivityFontControls {...{ bookSlug, componentSlug, fonts }} selectedSlot={presentation.textStyle.fontAssetSlot} onSelect={setFont} onUploaded={(font) => setFonts((current) => [...current.filter((entry) => entry.assetId !== font.assetId), font])} onMessage={onMessage} label="Passage font" onUploadStateChange={onUploading} />
    </div> : <p>Upload a background, choose drawing defaults, then draw targets. Each target keeps its own answer and marker.</p>}
    {presentation.kind !== "text" ? <>
      {!visual ? <p>Draw around each printed word. Enlarge its click area separately when needed; the marking area sets the underline position. All words in a passage must stay on one panel.</p> : null}
      <StudioButton onClick={addPanel} disabled={sharedCanvas || panels.length >= NATIVE_MARK_WORDS_LIMITS.panels}>Add panel</StudioButton>
      {panels.map((entry, index) => <StudioButton key={entry.id} selected={entry.id === panel?.id} onClick={() => { setPanelId(entry.id); setHotspotId(null); setDrawing(false); }}>Panel {index + 1}</StudioButton>)}
      {panel ? <>
        <label className="studio-upload-action">{panel.backgroundAssetSlot ? "Replace background" : "Upload background"}<input disabled={sharedCanvas} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ""; }} /></label>
        {[-1, 1].map((offset) => <StudioButton key={offset} disabled={panels.indexOf(panel) + offset < 0 || panels.indexOf(panel) + offset >= panels.length} onClick={() => mutatePair((doc, teacher) => { const list = doc.parts[0].interaction.presentation.panels; const index = list.findIndex((entry) => entry.id === panel.id); [list[index], list[index + offset]] = [list[index + offset], list[index]]; if (visual) alignVisualTargetAnswers(doc, teacher); })}>Move panel {offset < 0 ? "up" : "down"}</StudioButton>)}
        <StudioButton disabled={sharedCanvas} onClick={() => { if (!globalThis.confirm("Delete this panel and its word hotspots? Passage text and answers remain.")) return; mutatePair((doc, teacher) => { if (visual) { for (const hotspot of [...panel.hotspots]) removeVisualTarget(doc, teacher, panel.id, hotspot.id); } doc.parts[0].interaction.presentation.panels = doc.parts[0].interaction.presentation.panels.filter((entry) => entry.id !== panel.id); if (visual) alignVisualTargetAnswers(doc, teacher); if (panel.backgroundAssetSlot) removeNativeManagedAssetReferenceIfUnused(doc, panel.backgroundAssetSlot); }); setPanelId(null); setHotspotId(null); setDrawing(false); }}>Delete panel</StudioButton>
        {visual ? <><label>New target answer<select aria-label="New target answer" value={defaults.correct ? "correct" : "incorrect"} onChange={(event) => setDefaults((current) => ({ ...current, correct: event.target.value === "correct" }))}><option value="correct">Correct</option><option value="incorrect">Incorrect</option></select></label><NativeMarkWordsMarkerControls outlineOnly={grouped} label="Drawing marker" marker={defaults.marker} onChange={changeDefaultMarker} graphics={graphics} onUpload={uploadGraphic} /></> : null}
        <p role="status">{visual ? `${interaction.targets.length} authored targets` : nextWord ? `Next unmapped: passage ${interaction.items.indexOf(nextItem) + 1}, word ${nextItem.words.indexOf(nextWord) + 1}: ${nextItem.text.slice(nextWord.start, nextWord.end)}` : "No unmapped word is available on this panel."}</p>
        <StudioButton selected={drawing} disabled={!panel.backgroundAssetSlot || (!visual && !next && !drawing)} onClick={() => setDrawing(!drawing)}>{drawing ? "Finish drawing" : visual ? "Draw target" : "Draw next word hotspot"}</StudioButton>
        <StudioCanvasToolbar zoom={zoom} onZoomChange={setZoom} />
        <div className="studio-canvas-viewport"><div style={{ width: `${zoom * 100}%` }}><Canvas graphicUrl={(slot) => assetUrl(publicDraft.assets.find((asset) => asset.slot === slot)?.assetId || "")} key={panel.id} panel={grouped ? { ...panel, hotspots: panel.hotspots.map((hotspot) => ({ ...hotspot, marker: categoryMarker(hotspot.targetId) })) } : panel} url={panel.backgroundAssetSlot ? assetUrl(publicDraft.assets.find((asset) => asset.slot === panel.backgroundAssetSlot)?.assetId || "") : null} {...{ selected, field, drawing }} onSelect={setHotspotId} onCreate={createHotspot} onChange={changeGeometry} onDelete={removeHotspot} /></div></div>
        {selected && visual ? <div className="studio-form-grid">
          <StudioField label="Target label"><input value={interaction.targets.find((target) => target.id === selected.targetId)?.label || ""} onChange={(event) => mutatePublic((pub) => { pub.parts[0].interaction.targets.find((target) => target.id === selected.targetId).label = event.target.value; })} /></StudioField>
          <StudioField label="Answer"><select aria-label="Answer" value={teacherDraft.parts[0].solution.answers.find((answer) => answer.panelId === panel.id)?.correctTargetIds.includes(selected.targetId) ? "correct" : "incorrect"} onChange={(event) => mutatePair((pub, teacher) => setVisualTargetCorrect(pub, teacher, panel.id, selected.targetId, event.target.value === "correct"))}><option value="incorrect">Incorrect</option><option value="correct">Correct</option></select></StudioField>
          <NativeMarkWordsMarkerControls outlineOnly={grouped} label="Selected marker" marker={selectedMarkerStyle} onChange={changeSelectedMarker} graphics={graphics} onUpload={(file) => uploadGraphic(file, false)} />
        </div> : null}
        {selected ? <><StudioField label="Geometry to edit"><select aria-label="Geometry to edit" value={field} onChange={(event) => { setField(event.target.value); setDrawing(false); }}><option value="area">Click area</option>{!grouped ? <option value="markArea">Marking area</option> : null}</select></StudioField><StageGeometryControls area={selected[field]} stage={stage} minWidth={1} minHeight={1} label={field === "area" ? "Click area" : "Marking area"} onChange={changeGeometry} /><StudioButton onClick={removeHotspot}>Remove word hotspot</StudioButton></> : null}
      </> : null}
      {!visual ? <details><summary>Unmapped word occurrences</summary>{(interaction.items || []).map((item, index) => <p key={item.id}>Passage {index + 1}: {item.words.flatMap((word, position) => mapped.has(word.id) ? [] : [`${item.text.slice(word.start, word.end)} (word ${position + 1})`]).join(", ") || "All mapped"}</p>)}</details> : null}
    </> : null}
  </section>;
}
