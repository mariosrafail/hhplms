import { compositeEditorContent, compositeEditorTabs, useCompositeEditorBinding } from "./nativeCompositeEditorBinding.js";
import { useEffect, useMemo, useState } from "react";
import { BookOpenText, Eye, Film, ImagePlus, Layers3, Music, Plus, Trash2 } from "lucide-react";

import { StudioButton, StudioCanvasToolbar, StudioField, StudioSaveBar, StudioTabWorkspace } from "../../../components/builder-studio/StudioControls.jsx";
import { QuickNumber, StageGeometryControls } from "../../../components/builder-studio/StageGeometryControls.jsx";
import { NativeDragDropAuthoringCanvas } from "../../../components/native-drag-drop/NativeDragDropAuthoringCanvas.jsx";
import { NativeDragDropStudentSurface } from "../../../components/native-drag-drop/NativeDragDropSurface.jsx";
import { NativeDragDropTeacherSurface } from "../../../components/native-drag-drop/NativeDragDropTeacherSurface.jsx";
import { NativeReadableTextPresentation } from "../../../components/native-readable-text/NativeReadableTextPresentation.jsx";
import { createNativeChildId } from "../../../data/native-activities/nativeChildIdentity.js";
import { generateNativeBulkCandidate } from "../../../data/native-activities/nativeBulkAuthoring.js";
import { mergeNativeManagedAssetReference, normalizeNativeActivityPublic, removeNativeManagedAssetReferenceIfUnused } from "../../../data/native-activities/nativeActivityPublic.js";
import {
  assessNativeDragDropReadiness,
  nativeDragDropMappingWordIds,
  nativeDragDropShortLabel,
  NATIVE_DRAG_DROP_DEFAULT_LAYOUT,
  NATIVE_DRAG_DROP_DEFAULT_SURFACE,
  NATIVE_DRAG_DROP_FONT_FAMILIES,
  NATIVE_DRAG_DROP_LIMITS,
  normalizeNativeDragDropInteraction,
  normalizeNativeDragDropSolution,
  removeNativeDragDropImage,
  removeNativeDragDropPanel,
  removeNativeDragDropWord,
  validateNativeDragDropTopology,
} from "../../../data/native-activities/nativeDragDrop.js";
import { generateNativeDragDropHotspotImportCandidate } from "../../../data/native-activities/nativeDragDropHotspotBulkAuthoring.js";
import { getBuilderContent as getRemoteBuilderContent } from "./builderContentApi.js";
import { getBuilderFontLibrary, saveNativeActivityPair, uploadNativeActivityAsset } from "./builderNativeActivityApi.js";
import { NativeActivityFontControls } from "./NativeCompleteSentencesFontControls.jsx";
import { projectNativeActivityPublicForAuthoring } from "./nativeActivityAuthoringProjection.js";
import { NativeBulkGenerator } from "./NativeBulkGenerator.jsx";
import { NativeDragDropHotspotBulkImporter } from "./NativeDragDropHotspotBulkImporter.jsx";
import { NativeReadableTextEditor } from "./NativeReadableTextEditor.jsx";
import { NativeSupplementalAudioEditor } from "./NativeSupplementalAudioEditor.jsx";
import { NativeVideoEditor } from "./NativeVideoEditor.jsx";
import { NativeDragDropItemImageControls } from "./NativeDragDropItemImageControls.jsx";
import "./nativeDragDropEditor.css";

const clone = (value) => structuredClone(value);
const tabs = [{ id: "content", label: "Content" }, { id: "layout", label: "Layout" }, { id: "answer-key", label: "Answer Key" }, { id: "readable-text", label: "Readable Text", icon: BookOpenText }, { id: "video", label: "Video", icon: Film }, { id: "supplemental-audio", label: "Supplemental MP3", icon: Music }, { id: "preview", label: "Local Preview", icon: Eye }];
const previewRoot = (bookSlug, componentSlug, activityId, assetId) => `/builder/api/native-activities/books/${encodeURIComponent(bookSlug)}/components/${encodeURIComponent(componentSlug)}/activities/${encodeURIComponent(activityId)}/assets/${encodeURIComponent(assetId)}/preview`;

function moveInArray(list, index, delta) {
  const target = Math.max(0, Math.min(list.length - 1, index + delta));
  if (target === index) return;
  const [entry] = list.splice(index, 1); list.splice(target, 0, entry);
}

function scaleArea(area, from, to) {
  const x = Math.min(to.width - 1, Math.max(0, Math.round(area.x * to.width / from.width)));
  const y = Math.min(to.height - 1, Math.max(0, Math.round(area.y * to.height / from.height)));
  const right = Math.min(to.width, Math.max(x + 1, Math.round((area.x + area.width) * to.width / from.width)));
  const bottom = Math.min(to.height, Math.max(y + 1, Math.round((area.y + area.height) * to.height / from.height)));
  return {
    x, y, width: right - x, height: bottom - y,
  };
}

function DragDropTextStyleControls({ heading, style, fonts, bookSlug, componentSlug, onStyleChange, onFontSelect, onFontUploaded, onMessage }) {
  return <fieldset className="native-drag-drop-typography"><legend>{heading}</legend>
    <StudioField label={`${heading} family`}><select value={style.fontFamily} onChange={(event) => onStyleChange("fontFamily", event.target.value)}>{NATIVE_DRAG_DROP_FONT_FAMILIES.map((family) => <option key={family} value={family}>{family}</option>)}</select></StudioField>
    <QuickNumber label={`${heading} size`} value={style.fontSize} minimum={NATIVE_DRAG_DROP_LIMITS.fontSizeMinimum} maximum={NATIVE_DRAG_DROP_LIMITS.fontSizeMaximum} onChange={(value) => onStyleChange("fontSize", Math.round(Number(value)))} />
    <StudioField label={`${heading} color`}><input aria-label={`${heading} color`} type="color" value={style.color} onChange={(event) => onStyleChange("color", event.target.value)} /></StudioField>
    <NativeActivityFontControls bookSlug={bookSlug} componentSlug={componentSlug} fonts={fonts} selectedSlot={style.fontAssetSlot} onSelect={onFontSelect} onUploaded={onFontUploaded} onMessage={onMessage} label={`${heading} managed font`} />
  </fieldset>;
}

export function NativeDragDropEditor({ compositeBinding = null, bookSlug, componentSlug, activityId, placementLabel, onDirtyChange = () => {}, onSaved = () => {} }) {
  const getBuilderContent = (request, options) => compositeEditorContent(compositeBinding, getRemoteBuilderContent, request, options);
  const [state, setState] = useState({ kind: "loading", message: "" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [mappingIssue, setMappingIssue] = useState("");
  const [publicDraft, setPublicDraft] = useState(null);
  const [teacherDraft, setTeacherDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState("content");
  const [panelId, setPanelId] = useState(null);
  const [selection, setSelection] = useState(null);
  const [drawingTarget, setDrawingTarget] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingItemUploads, setPendingItemUploads] = useState(0);
  const [previewMode, setPreviewMode] = useState("student");
  const [fonts, setFonts] = useState([]);
  const [readableTextIncomplete, setReadableTextIncomplete] = useState(false);
  const [videoIncomplete, setVideoIncomplete] = useState(false);
  const [supplementalAudioIncomplete, setSupplementalAudioIncomplete] = useState(false);
  const [zoom, setZoom] = useState(1);

  useCompositeEditorBinding(compositeBinding, publicDraft, teacherDraft, dirty, uploading || pendingItemUploads > 0, setPublicDraft);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading", message: "" }); setPublicDraft(null); setTeacherDraft(null); setTab("content"); setDirty(false); onDirtyChange(false);
    Promise.all([
      getBuilderContent({ bookSlug, componentSlug, resource: "native-activity-public", documentKey: activityId }, { signal: controller.signal }),
      getBuilderContent({ bookSlug, componentSlug, resource: "native-activity-teacher", documentKey: activityId }, { signal: controller.signal }),
      getBuilderFontLibrary({ bookSlug, componentSlug }, { signal: controller.signal }),
    ]).then(([publicValue, teacherValue, fontLibrary]) => {
      if (controller.signal.aborted) return;
      const projected = normalizeNativeActivityPublic(projectNativeActivityPublicForAuthoring(publicValue.document), {
        normalizeInteraction: normalizeNativeDragDropInteraction, expectedActivityId: activityId, expectedKind: "drag-drop",
      });
      const teacherDocument = clone(teacherValue.document);
      teacherDocument.parts[0].solution = normalizeNativeDragDropSolution(teacherDocument.parts[0].solution);
      setMappingIssue(""); setPublicDraft(projected); setTeacherDraft(teacherDocument); setFonts(fontLibrary); setPanelId(projected.parts[0].interaction.panels[0]?.id || null);
      setState({ kind: "ready", publicRevision: publicValue.revision, teacherRevision: teacherValue.revision, message: "Draft saved." });
    }).catch((error) => { if (!controller.signal.aborted) setState({ kind: "error", message: error.message }); });
    return () => controller.abort();
  }, [activityId, bookSlug, componentSlug, loadAttempt]);

  const interaction = publicDraft?.parts[0].interaction;
  const panel = interaction?.panels.find((entry) => entry.id === panelId) || interaction?.panels[0] || null;
  const selectedImage = selection?.kind === "image" ? panel?.images.find((entry) => entry.id === selection.id) : null;
  const selectedTarget = selection?.kind === "target" ? panel?.dropTargets.find((entry) => entry.id === selection.id) : null;
  const readiness = useMemo(() => {
    if (!publicDraft || !teacherDraft) return null;
    const base = assessNativeDragDropReadiness(publicDraft, teacherDraft);
    const topology = [];
    if (base.ready) {
      try { validateNativeDragDropTopology(publicDraft, teacherDraft); }
      catch (error) { topology.push(error.message); }
    }
    const commonIssues = [readableTextIncomplete ? "Complete the Readable Text setup." : "", videoIncomplete ? "Complete the Video setup." : "", supplementalAudioIncomplete ? "Complete the Supplemental MP3 setup." : ""].filter(Boolean);
    return { ready: base.ready && !topology.length && !commonIssues.length, issues: [...base.issues, ...topology, ...commonIssues] };
  }, [publicDraft, readableTextIncomplete, supplementalAudioIncomplete, teacherDraft, videoIncomplete]);
  const mappings = new Map(teacherDraft?.parts[0].solution.mappings.map((mapping) => [mapping.targetId, nativeDragDropMappingWordIds(mapping)]) || []);
  const assetUrl = (assetId) => previewRoot(bookSlug, componentSlug, activityId, assetId);

  const markDirty = () => { setMappingIssue(""); setDirty(true); onDirtyChange(true); };
  const mutatePublic = (mutator) => { setPublicDraft((current) => { const next = clone(current); mutator(next); return next; }); markDirty(); };
  const mutatePair = (mutator) => {
    const nextPublic = clone(publicDraft); const nextTeacher = clone(teacherDraft); mutator(nextPublic, nextTeacher);
    setPublicDraft(nextPublic); setTeacherDraft(nextTeacher); markDirty();
  };

  const generateBulk = (source, options) => {
    const result = generateNativeBulkCandidate({ kind: "drag-drop", source, publicDocument: publicDraft, teacherDocument: teacherDraft, ...options });
    setPublicDraft(result.publicDocument); setTeacherDraft(result.teacherDocument); setSelection(null); setDrawingTarget(false); markDirty();
    return result;
  };

  const previewHotspotImport = (source, options) => generateNativeDragDropHotspotImportCandidate({ source, publicDocument: publicDraft, teacherDocument: teacherDraft, ...options });
  const applyHotspotImport = (source, options) => {
    const result = previewHotspotImport(source, options);
    setPublicDraft(result.publicDocument); setTeacherDraft(result.teacherDocument);
    setPanelId(result.selection?.panelId || panelId); setSelection(result.selection ? { kind: "target", id: result.selection.targetId } : null); setDrawingTarget(false); markDirty();
    return result;
  };

  const addWord = () => mutatePublic((next) => {
    const words = next.parts[0].interaction.words;
    words.push({ id: createNativeChildId("word"), text: `Word ${words.length + 1}`, reusable: false, shortLabel: nativeDragDropShortLabel(words.length) });
  });
  const deleteWord = (wordId) => {
    const isMapped = teacherDraft.parts[0].solution.mappings.some((mapping) => nativeDragDropMappingWordIds(mapping).includes(wordId));
    if (isMapped && !globalThis.confirm?.("Remove this word and its private target mapping? The activity will need a replacement mapping before it can be saved.")) return;
    mutatePair((nextPublic, nextTeacher) => removeNativeDragDropWord(nextPublic, nextTeacher, wordId));
  };
  const addPanel = () => {
    const id = createNativeChildId("panel");
    mutatePublic((next) => next.parts[0].interaction.panels.push({ id, surface: { ...NATIVE_DRAG_DROP_DEFAULT_SURFACE }, images: [], dropTargets: [] }));
    setPanelId(id); setSelection(null); setDrawingTarget(false);
  };
  const movePanel = (index, delta) => mutatePublic((next) => moveInArray(next.parts[0].interaction.panels, index, delta));
  const deletePanel = () => {
    if (!panel || !globalThis.confirm?.("Remove this panel, its targets, and its image layers?")) return;
    const nextId = interaction.panels.find((entry) => entry.id !== panel.id)?.id || null;
    mutatePair((nextPublic, nextTeacher) => removeNativeDragDropPanel(nextPublic, nextTeacher, panel.id));
    setPanelId(nextId); setSelection(null); setDrawingTarget(false);
  };
  const addTarget = (area) => {
    const used = new Set(teacherDraft.parts[0].solution.mappings.flatMap(nativeDragDropMappingWordIds));
    const word = interaction.words.find((entry) => entry.reusable || !used.has(entry.id));
    if (!word) { setState((current) => ({ ...current, message: "Add another word before drawing another target." })); setDrawingTarget(false); return; }
    const targetId = createNativeChildId("target");
    mutatePair((nextPublic, nextTeacher) => {
      const nextPanel = nextPublic.parts[0].interaction.panels.find((entry) => entry.id === panel.id);
      nextPanel.dropTargets.push({ id: targetId, area, accessibleLabel: `Drop target ${nextPanel.dropTargets.length + 1}`, capacity: 1 });
      nextTeacher.parts[0].solution.mappings.push({ targetId, wordIds: [word.id] });
    });
    setSelection({ kind: "target", id: targetId }); setDrawingTarget(false);
  };

  const setLayoutMode = (layoutMode) => {
    mutatePublic((next) => {
      const nextInteraction = next.parts[0].interaction; nextInteraction.layoutMode = layoutMode;
      if (!nextInteraction.answerBankHeightPx) nextInteraction.answerBankHeightPx = NATIVE_DRAG_DROP_DEFAULT_LAYOUT.answerBankHeightPx;
      if (!nextInteraction.textPanelHeightPx) nextInteraction.textPanelHeightPx = NATIVE_DRAG_DROP_DEFAULT_LAYOUT.textPanelHeightPx;
    });
  };

  const setReusable = (wordId, reusable) => {
    const mappedCount = teacherDraft.parts[0].solution.mappings.filter((mapping) => nativeDragDropMappingWordIds(mapping).includes(wordId)).length;
    if (!reusable && mappedCount > 1) { setMappingIssue("Remove this item's repeated correct mappings before turning reuse off."); return; }
    mutatePublic((next) => { next.parts[0].interaction.words.find((word) => word.id === wordId).reusable = reusable; });
  };

  const setMappingWords = (targetId, rawWordIds) => {
    const wordIds = [...new Set(rawWordIds)];
    const reusableWordIds = new Set(interaction.words.filter((word) => word.reusable).map((word) => word.id));
    const conflict = wordIds.map((wordId) => ({ wordId, mapping: teacherDraft.parts[0].solution.mappings.find((entry) => entry.targetId !== targetId && nativeDragDropMappingWordIds(entry).includes(wordId)) })).find(({ wordId, mapping }) => mapping && !reusableWordIds.has(wordId));
    if (conflict) {
      setMappingIssue("That item is already correct for another target. Turn on Reusable item first."); return;
    }
    mutatePair((nextPublic, nextTeacher) => {
      nextTeacher.parts[0].solution.mappings = nextTeacher.parts[0].solution.mappings.filter((entry) => entry.targetId !== targetId);
      if (wordIds.length) nextTeacher.parts[0].solution.mappings.push({ targetId, wordIds });
      const target = nextPublic.parts[0].interaction.panels.flatMap((entry) => entry.dropTargets).find((entry) => entry.id === targetId);
      target.capacity = Math.max(1, wordIds.length);
    });
  };
  const deleteSelection = () => {
    if (selectedImage) mutatePublic((next) => removeNativeDragDropImage(next, panel.id, selectedImage.id));
    if (selectedTarget) mutatePair((nextPublic, nextTeacher) => {
      const nextPanel = nextPublic.parts[0].interaction.panels.find((entry) => entry.id === panel.id);
      nextPanel.dropTargets = nextPanel.dropTargets.filter((entry) => entry.id !== selectedTarget.id);
      nextTeacher.parts[0].solution.mappings = nextTeacher.parts[0].solution.mappings.filter((entry) => entry.targetId !== selectedTarget.id);
    });
    setSelection(null);
  };

  const uploadImage = async (file, { background = false, replace = false } = {}) => {
    if (!file || !panel || uploading) return;
    setUploading(true); setState((current) => ({ ...current, message: "Uploading image…" }));
    try {
      const uploaded = await uploadNativeActivityAsset({ bookSlug, componentSlug, activityId, assetSlot: createNativeChildId("asset"), file });
      if (interaction.layoutMode === "text" && background && (!Number.isSafeInteger(uploaded.metadata?.width) || !Number.isSafeInteger(uploaded.metadata?.height) || uploaded.metadata.width < 1 || uploaded.metadata.height < 1 || uploaded.metadata.width > NATIVE_DRAG_DROP_LIMITS.surfaceMaximum || uploaded.metadata.height > NATIVE_DRAG_DROP_LIMITS.surfaceMaximum)) throw new Error("Uploaded text image dimensions are unavailable or exceed the supported surface size.");
      if (replace && selectedImage) {
        mutatePublic((next) => {
          const nextPanel = next.parts[0].interaction.panels.find((entry) => entry.id === panel.id);
          const nextImage = nextPanel.images.find((entry) => entry.id === selectedImage.id);
          const oldSlot = nextImage.assetSlot; next.assets = mergeNativeManagedAssetReference(next.assets, uploaded.reference); nextImage.assetSlot = uploaded.reference.slot;
          if (next.parts[0].interaction.layoutMode === "text" && nextPanel.images[0]?.id === nextImage.id && nextImage.locked && Number.isSafeInteger(uploaded.metadata?.width) && Number.isSafeInteger(uploaded.metadata?.height)) {
            const previous = { ...nextPanel.surface }; const dimensions = { width: uploaded.metadata.width, height: uploaded.metadata.height };
            nextPanel.images.forEach((entry) => { entry.area = scaleArea(entry.area, previous, dimensions); });
            nextPanel.dropTargets.forEach((entry) => { entry.area = scaleArea(entry.area, previous, dimensions); });
            nextPanel.surface = dimensions; nextImage.area = { x: 0, y: 0, ...dimensions };
          }
          removeNativeManagedAssetReferenceIfUnused(next, oldSlot);
        });
      } else {
        const imageId = createNativeChildId("img");
        mutatePublic((next) => {
          const nextPanel = next.parts[0].interaction.panels.find((entry) => entry.id === panel.id);
          next.assets = mergeNativeManagedAssetReference(next.assets, uploaded.reference);
          if (background && next.parts[0].interaction.layoutMode === "text") {
            const previous = { ...nextPanel.surface }; const dimensions = { width: uploaded.metadata.width, height: uploaded.metadata.height };
            nextPanel.images.forEach((entry) => { entry.area = scaleArea(entry.area, previous, dimensions); });
            nextPanel.dropTargets.forEach((entry) => { entry.area = scaleArea(entry.area, previous, dimensions); });
            nextPanel.surface = dimensions;
          }
          const image = { id: imageId, assetSlot: uploaded.reference.slot, area: background ? { x: 0, y: 0, ...nextPanel.surface } : { x: 160, y: 110, width: 360, height: 240 }, order: background ? 0 : nextPanel.images.length, altText: "", decorative: false, fit: "contain", locked: background };
          if (background) { nextPanel.images.unshift(image); nextPanel.images.forEach((entry, order) => { entry.order = order; }); } else nextPanel.images.push(image);
        });
        setSelection({ kind: "image", id: imageId });
      }
      setState((current) => ({ ...current, message: "Image uploaded; save to attach it." }));
    } catch { setState((current) => ({ ...current, message: "Image upload failed." })); }
    finally { setUploading(false); }
  };

  const changeTextStyle = (styleKey, key, value) => mutatePublic((next) => { next.parts[0].interaction.presentation[styleKey][key] = value; });
  const setTextFont = (styleKey, font) => mutatePublic((next) => {
    const style = next.parts[0].interaction.presentation[styleKey];
    const previousSlot = style.fontAssetSlot;
    if (font) {
      next.assets = mergeNativeManagedAssetReference(next.assets, { assetId: font.assetId, checksumSha256: font.checksumSha256, role: font.role, slot: font.slot });
      style.fontAssetSlot = font.slot;
    } else style.fontAssetSlot = null;
    if (previousSlot && previousSlot !== style.fontAssetSlot) removeNativeManagedAssetReferenceIfUnused(next, previousSlot);
  });
  const recordUploadedFont = (font) => setFonts((current) => [...current.filter((entry) => entry.assetId !== font.assetId), font]);
  const save = async () => {
    if (compositeBinding) return;
    if (pendingItemUploads) { setState((current) => ({ ...current, message: "Wait for item image uploads before saving." })); return; }
    setState((current) => ({ ...current, saving: true, message: "Saving…" }));
    try {
      const value = await saveNativeActivityPair({ bookSlug, componentSlug, activityId, expectedPublicRevision: state.publicRevision, expectedTeacherRevision: state.teacherRevision, publicDocument: publicDraft, teacherDocument: teacherDraft });
      setPublicDraft(projectNativeActivityPublicForAuthoring(value.publicDocument)); setTeacherDraft(value.teacherDocument); setDirty(false); onDirtyChange(false);
      setState({ kind: "ready", publicRevision: value.publicRevision, teacherRevision: value.teacherRevision, saving: false, message: "Draft saved." }); onSaved(value.publicRevision);
    } catch (error) { setState((current) => ({ ...current, saving: false, message: error.status === 409 ? "This draft changed elsewhere. Reload before saving." : "Save failed. Your edits are preserved." })); }
  };

  if (state.kind === "loading") return <section className="native-activity-foundation studio-loading" role="status">Loading Drag &amp; Drop editor…</section>;
  if (state.kind === "error" || !publicDraft || !teacherDraft) return <section className="native-activity-foundation studio-error" role="alert"><p>{state.message || "Native draft is unavailable."}</p><p>The saved activity is preserved. Reload after correcting the reported problem.</p><StudioButton onClick={() => setLoadAttempt((value) => value + 1)}>Reload draft</StudioButton></section>;

  return <section className="native-activity-foundation native-drag-drop-editor studio-editor">
    {mappingIssue ? <p className="builder-inline-error" role="alert">{mappingIssue}</p> : null}
    <header className="studio-editor-header"><div><span className="studio-eyebrow">{placementLabel} · Drag &amp; Drop</span><h2>{publicDraft.metadata.title}</h2><p>{readiness.ready ? "Content complete" : `${readiness.issues.length} item${readiness.issues.length === 1 ? "" : "s"} need attention`}</p></div><details className="builder-technical-details"><summary>Technical details</summary><code>{activityId}</code></details></header>
    <StudioTabWorkspace id="native-drag-drop-tabs" value={tab} onChange={(value) => { setTab(value); setDrawingTarget(false); }} tabs={compositeEditorTabs(compositeBinding, tabs)} label="Drag and Drop authoring modes">

    {tab === "content" ? <NativeBulkGenerator kind="drag-drop" hasExistingContent={interaction.words.length > 0} onGenerate={generateBulk} /> : null}

    {tab === "content" ? <div className="studio-content-panel native-drag-drop-content">
      <StudioField label="Activity title"><input value={publicDraft.metadata.title} maxLength="300" onChange={(event) => mutatePublic((next) => { next.metadata.title = event.target.value; })} /></StudioField>
      <fieldset className="native-drag-drop-layout-settings"><legend>Activity layout</legend>
        <label><input type="radio" name={`${activityId}-layout`} checked={interaction.layoutMode === "standard"} onChange={() => setLayoutMode("standard")} /> Standard drag-and-drop</label>
        <label><input type="radio" name={`${activityId}-layout`} disabled={compositeBinding?.sharedCanvas} checked={interaction.layoutMode === "text"} onChange={() => setLayoutMode("text")} /> Text drag-and-drop</label>
        <p>{interaction.layoutMode === "text" ? "The managed text image scrolls above the bottom phrase bank. Students drag only stable A/B/… labels; reusable items remain available for other targets." : "The answer bank overlays the bottom of the stable visual canvas; changing its height never moves the artwork or targets."}</p>
        <QuickNumber label="Answer bank height (px)" value={interaction.answerBankHeightPx ?? NATIVE_DRAG_DROP_DEFAULT_LAYOUT.answerBankHeightPx} minimum={NATIVE_DRAG_DROP_LIMITS.answerBankHeightMinimum} maximum={NATIVE_DRAG_DROP_LIMITS.answerBankHeightMaximum} onChange={(value) => mutatePublic((next) => { next.parts[0].interaction.answerBankHeightPx = Math.round(Number(value)); })} />
        {interaction.layoutMode === "text" ? <QuickNumber label="Upper text-image panel height (px)" value={interaction.textPanelHeightPx ?? NATIVE_DRAG_DROP_DEFAULT_LAYOUT.textPanelHeightPx} minimum={NATIVE_DRAG_DROP_LIMITS.textPanelHeightMinimum} maximum={NATIVE_DRAG_DROP_LIMITS.textPanelHeightMaximum} onChange={(value) => mutatePublic((next) => { next.parts[0].interaction.textPanelHeightPx = Math.round(Number(value)); })} /> : null}
      </fieldset>
      <section className="native-drag-drop-editor-list"><h3>{interaction.layoutMode === "text" ? "Labelled phrase bank" : "Shared word bank"}</h3><StudioButton onClick={addWord} disabled={interaction.words.length >= NATIVE_DRAG_DROP_LIMITS.words}><Plus aria-hidden="true" />Add word</StudioButton>{interaction.words.map((word, index) => <div className="native-drag-drop-word-row" key={word.id}><span className="native-drag-drop-editor-label" aria-label={`Stable label ${word.shortLabel}`}>{word.shortLabel}</span><textarea rows={2} aria-label={`Word ${index + 1}`} value={word.text} maxLength={NATIVE_DRAG_DROP_LIMITS.wordTextLength} onChange={(event) => mutatePublic((next) => { next.parts[0].interaction.words[index].text = event.target.value; })} /><NativeDragDropItemImageControls word={word} document={publicDraft} bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} assetUrl={assetUrl} mutatePublic={mutatePublic} onPendingChange={(value) => setPendingItemUploads((current) => Math.max(0, current + (value ? 1 : -1)))} /><label className="native-drag-drop-reusable"><input type="checkbox" checked={word.reusable} onChange={(event) => setReusable(word.id, event.target.checked)} /> Reusable item</label><button type="button" aria-label={`Move word ${index + 1} up`} disabled={!index} onClick={() => mutatePublic((next) => moveInArray(next.parts[0].interaction.words, index, -1))}>↑</button><button type="button" aria-label={`Move word ${index + 1} down`} disabled={index === interaction.words.length - 1} onClick={() => mutatePublic((next) => moveInArray(next.parts[0].interaction.words, index, 1))}>↓</button><button type="button" aria-label={`Remove word ${index + 1}`} disabled={pendingItemUploads > 0} onClick={() => deleteWord(word.id)}><Trash2 aria-hidden="true" /></button></div>)}</section>
      <p className="studio-field-help">Reusable items remain in the standard bank and may be placed in multiple different targets, but never twice in one target.</p>
      <section className="native-drag-drop-typography-grid" aria-label="Drag and Drop typography"><h3>Shared typography</h3><DragDropTextStyleControls heading="Bank words" style={interaction.presentation.bankWordStyle} fonts={fonts} bookSlug={bookSlug} componentSlug={componentSlug} onStyleChange={(key, value) => changeTextStyle("bankWordStyle", key, value)} onFontSelect={(font) => setTextFont("bankWordStyle", font)} onFontUploaded={recordUploadedFont} onMessage={(message) => setState((current) => ({ ...current, message }))} /><DragDropTextStyleControls heading="Placed answers" style={interaction.presentation.placedAnswerStyle} fonts={fonts} bookSlug={bookSlug} componentSlug={componentSlug} onStyleChange={(key, value) => changeTextStyle("placedAnswerStyle", key, value)} onFontSelect={(font) => setTextFont("placedAnswerStyle", font)} onFontUploaded={recordUploadedFont} onMessage={(message) => setState((current) => ({ ...current, message }))} /></section>
    </div> : null}
    {tab === "layout" ? <><NativeDragDropHotspotBulkImporter hasExistingTargets={interaction.panels.some((entry) => entry.dropTargets.length)} onPreview={previewHotspotImport} onApply={applyHotspotImport} /><div className="native-drag-drop-editor-grid">
      <aside className="native-drag-drop-editor-list"><h3>Panels</h3><StudioButton onClick={addPanel} disabled={interaction.panels.length >= (compositeBinding ? 1 : NATIVE_DRAG_DROP_LIMITS.panels)}><Plus aria-hidden="true" />Add panel</StudioButton>{interaction.panels.map((entry, index) => <div className="native-drag-drop-panel-row" key={entry.id}><button type="button" aria-current={panel?.id === entry.id ? "true" : undefined} onClick={() => { setPanelId(entry.id); setSelection(null); setDrawingTarget(false); }}>Panel {index + 1} · {entry.images.length} image{entry.images.length === 1 ? "" : "s"} · {entry.dropTargets.length} target{entry.dropTargets.length === 1 ? "" : "s"}</button><button type="button" aria-label={`Move panel ${index + 1} up`} disabled={!index} onClick={() => movePanel(index, -1)}>↑</button><button type="button" aria-label={`Move panel ${index + 1} down`} disabled={index === interaction.panels.length - 1} onClick={() => movePanel(index, 1)}>↓</button></div>)}
        {panel?.dropTargets.length ? <><h4>Targets</h4>{panel.dropTargets.map((target, index) => <button type="button" key={target.id} aria-current={selection?.kind === "target" && selection.id === target.id ? "true" : undefined} onClick={() => setSelection({ kind: "target", id: target.id })}>{index + 1}. {target.accessibleLabel} · {target.capacity} item{target.capacity === 1 ? "" : "s"}</button>)}</> : null}
      </aside>
      <section className="native-drag-drop-editor-canvas"><div className="native-drag-drop-editor-actions">
        <label><ImagePlus aria-hidden="true" />{interaction.layoutMode === "text" ? "Add Text Image" : "Add Background"}<input aria-label="Add Background" type="file" accept="image/png,image/jpeg,image/webp" disabled={compositeBinding?.sharedCanvas || !panel || uploading || panel?.images.length >= NATIVE_DRAG_DROP_LIMITS.imagesPerPanel || interaction.layoutMode === "text" && panel?.images.some((image) => image.locked && image.order === 0)} onChange={(event) => { uploadImage(event.target.files?.[0], { background: true }); event.target.value = ""; }} /></label>
        <label><Layers3 aria-hidden="true" />Add Image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={compositeBinding?.sharedCanvas || !panel || uploading || panel?.images.length >= NATIVE_DRAG_DROP_LIMITS.imagesPerPanel} onChange={(event) => { uploadImage(event.target.files?.[0]); event.target.value = ""; }} /></label>
        <StudioButton onClick={() => { setDrawingTarget((value) => !value); setSelection(null); }} disabled={!panel || !interaction.words.length}>{drawingTarget ? "Cancel drawing" : "Draw Drop Target"}</StudioButton>
        <StudioButton variant="danger-ghost" onClick={deletePanel} disabled={!panel}>Remove panel</StudioButton>
      </div><StudioCanvasToolbar zoom={zoom} onZoomChange={setZoom} />{panel ? <div className="studio-canvas-viewport"><div className="studio-artboard-wrap" style={{ width: `${zoom * 100}%` }}><NativeDragDropAuthoringCanvas document={publicDraft} panel={panel} assetUrl={assetUrl} selection={selection} onSelect={setSelection} drawingTarget={drawingTarget} onCreateTarget={addTarget} onChangeImage={(area) => mutatePublic((next) => { next.parts[0].interaction.panels.find((entry) => entry.id === panel.id).images.find((entry) => entry.id === selectedImage.id).area = area; })} onChangeTarget={(area) => mutatePublic((next) => { next.parts[0].interaction.panels.find((entry) => entry.id === panel.id).dropTargets.find((entry) => entry.id === selectedTarget.id).area = area; })} onDelete={deleteSelection} /></div></div> : <p>Add a panel to begin.</p>}</section>
      <aside className="native-drag-drop-editor-inspector">
        <h3>{selectedImage ? "Image layer" : selectedTarget ? "Drop target" : "Properties"}</h3>
        {selectedImage ? <>
          <StudioField label="Alt text"><textarea rows="3" value={selectedImage.altText} disabled={selectedImage.decorative} onChange={(event) => mutatePublic((next) => { next.parts[0].interaction.panels.find((entry) => entry.id === panel.id).images.find((entry) => entry.id === selectedImage.id).altText = event.target.value; })} /></StudioField>
          <label><input type="checkbox" checked={selectedImage.decorative} onChange={(event) => mutatePublic((next) => { next.parts[0].interaction.panels.find((entry) => entry.id === panel.id).images.find((entry) => entry.id === selectedImage.id).decorative = event.target.checked; })} /> Decorative</label>
          <label><input type="checkbox" checked={selectedImage.locked} onChange={(event) => mutatePublic((next) => { next.parts[0].interaction.panels.find((entry) => entry.id === panel.id).images.find((entry) => entry.id === selectedImage.id).locked = event.target.checked; })} /> Lock position and size</label>
          <StudioField label="Fit"><select value={selectedImage.fit} onChange={(event) => mutatePublic((next) => { next.parts[0].interaction.panels.find((entry) => entry.id === panel.id).images.find((entry) => entry.id === selectedImage.id).fit = event.target.value; })}><option value="contain">Contain</option><option value="cover">Cover</option></select></StudioField>
          <div className="native-drag-drop-editor-actions"><button type="button" disabled={selectedImage.order === 0} onClick={() => mutatePublic((next) => { const list = next.parts[0].interaction.panels.find((entry) => entry.id === panel.id).images; moveInArray(list, selectedImage.order, -1); list.forEach((entry, order) => { entry.order = order; }); })}>Send backward</button><button type="button" disabled={selectedImage.order === panel.images.length - 1} onClick={() => mutatePublic((next) => { const list = next.parts[0].interaction.panels.find((entry) => entry.id === panel.id).images; moveInArray(list, selectedImage.order, 1); list.forEach((entry, order) => { entry.order = order; }); })}>Bring forward</button></div>
          <label className="native-drag-drop-replace">Replace image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={(event) => { uploadImage(event.target.files?.[0], { replace: true }); event.target.value = ""; }} /></label>
          <StudioButton variant="danger-ghost" onClick={deleteSelection}>Remove image</StudioButton>
        </> : null}
        {selectedTarget ? <>
          <StudioField label="Accessible label"><input value={selectedTarget.accessibleLabel} maxLength={NATIVE_DRAG_DROP_LIMITS.targetLabelLength} onChange={(event) => mutatePublic((next) => { next.parts[0].interaction.panels.find((entry) => entry.id === panel.id).dropTargets.find((entry) => entry.id === selectedTarget.id).accessibleLabel = event.target.value; })} /></StudioField>
          <StudioField label="Correct word mapping (select one or more)"><select multiple size={Math.min(8, Math.max(3, interaction.words.length + 1))} value={mappings.get(selectedTarget.id) || []} onChange={(event) => setMappingWords(selectedTarget.id, [...event.currentTarget.selectedOptions].map((option) => option.value))}><option value="" disabled>Select one or more items</option>{interaction.words.map((word, wordIndex) => <option key={word.id} value={word.id}>{word.text} · word {wordIndex + 1}{interaction.layoutMode === "text" ? ` · label ${word.shortLabel}` : ""}{word.reusable ? " · reusable" : ""}</option>)}</select></StudioField>
          <p className="studio-field-help">{(mappings.get(selectedTarget.id) || []).length} expected item{(mappings.get(selectedTarget.id) || []).length === 1 ? "" : "s"}; public target capacity is {selectedTarget.capacity}. Use Ctrl/Command or Shift to select more than one.</p>
          <StageGeometryControls area={selectedTarget.area} stage={panel.surface} label={selectedTarget.accessibleLabel || "Drop target"} minWidth={8} minHeight={8} onChange={(area) => mutatePublic((next) => { next.parts[0].interaction.panels.find((entry) => entry.id === panel.id).dropTargets.find((entry) => entry.id === selectedTarget.id).area = area; })} />
          <StudioButton variant="danger-ghost" onClick={deleteSelection}>Remove target</StudioButton>
        </> : null}
      </aside>
    </div></> : null}

    {tab === "answer-key" ? <div className="native-drag-drop-mapping"><h3>Teacher-only correct mappings</h3><p>Select every item required by each target. Capacity is derived from the selected count; correct identities stay in the private Teacher document.</p>{interaction.panels.map((entry, panelIndex) => <section key={entry.id}><h4>Panel {panelIndex + 1}</h4>{entry.dropTargets.map((target, targetIndex) => { const currentWordIds = mappings.get(target.id) || []; return <StudioField key={target.id} label={`${targetIndex + 1}. ${target.accessibleLabel} · ${currentWordIds.length} expected`}><select multiple size={Math.min(8, Math.max(3, interaction.words.length + 1))} value={currentWordIds} onChange={(event) => setMappingWords(target.id, [...event.currentTarget.selectedOptions].map((option) => option.value))}><option value="" disabled>Select one or more items</option>{interaction.words.map((word, wordIndex) => <option key={word.id} value={word.id}>{word.text} · word {wordIndex + 1}{interaction.layoutMode === "text" ? ` · label ${word.shortLabel}` : ""}{word.reusable ? " · reusable" : ""}</option>)}</select></StudioField>; })}</section>)}</div> : null}
    {tab === "preview" ? <div className="studio-preview-panel"><div className="native-drag-drop-editor-actions"><button type="button" aria-pressed={previewMode === "student"} onClick={() => setPreviewMode("student")}>Student Preview</button><button type="button" aria-pressed={previewMode === "teacher"} onClick={() => setPreviewMode("teacher")}>Teacher Preview</button></div><NativeReadableTextPresentation document={publicDraft} assetUrl={assetUrl}>{(presentation) => previewMode === "student" ? <NativeDragDropStudentSurface document={publicDraft} assetUrl={assetUrl} evaluatePlacement={(targetId, wordId) => (mappings.get(targetId) || []).includes(wordId)} resolveWordsForTarget={(targetId) => mappings.get(targetId) || []} presentation={presentation} /> : <NativeDragDropTeacherSurface publicDocument={publicDraft} teacherDocument={teacherDraft} assetUrl={assetUrl} presentation={presentation} />}</NativeReadableTextPresentation></div> : null}
    {tab === "readable-text" ? <NativeReadableTextEditor bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} publicDraft={publicDraft} mutatePublic={mutatePublic} previewUrl={assetUrl} onIncompleteChange={setReadableTextIncomplete} onIntentChange={markDirty} onStatusChange={(message) => setState((current) => ({ ...current, message }))} /> : null}
    {tab === "video" ? <NativeVideoEditor bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} publicDraft={publicDraft} mutatePublic={mutatePublic} onIncompleteChange={setVideoIncomplete} onIntentChange={markDirty} onStatusChange={(message) => setState((current) => ({ ...current, message }))} /> : null}
    {tab === "supplemental-audio" ? <NativeSupplementalAudioEditor bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} publicDraft={publicDraft} mutatePublic={mutatePublic} previewUrl={assetUrl} onIncompleteChange={setSupplementalAudioIncomplete} onIntentChange={markDirty} onStatusChange={(message) => setState((current) => ({ ...current, message }))} /> : null}
    </StudioTabWorkspace>
    <StudioSaveBar hidden={Boolean(compositeBinding)} dirty={dirty} saving={state.saving} message={state.message} ready={readiness.ready} issues={readiness.issues} disabled={!dirty || state.saving || !readiness.ready || !publicDraft.metadata.title.trim()} reason={!readiness.ready ? "Complete every panel, target, and private mapping before saving" : !dirty ? "No unsaved changes" : ""} onSave={save} />
  </section>;
}
