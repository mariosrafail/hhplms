import { removeNativeMultiPartOwnedHotspots } from "../../../data/native-activities/nativeAudioTextHotspots.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { StudioButton, StudioField, StudioSaveBar, StudioTabWorkspace } from "../../../components/builder-studio/StudioControls.jsx";
import { StageGeometryControls } from "../../../components/builder-studio/StageGeometryControls.jsx";
import { NativeReadableTextPresentation } from "../../../components/native-readable-text/NativeReadableTextPresentation.jsx";
import { NativeMultiPartStudentSurface } from "../../../components/native-multi-part/NativeMultiPartStudentSurface.jsx";
import { NativeMultiPartTeacherSurface } from "../../../components/native-multi-part/NativeMultiPartTeacherSurface.jsx";
import { normalizeNativeActivityPublic, mergeNativeManagedAssetReference } from "../../../data/native-activities/nativeActivityPublic.js";
import { createNativeChildId } from "../../../data/native-activities/nativeChildIdentity.js";
import { normalizeNativeMultiPartInteraction, normalizeNativeMultiPartSolution, validateNativeMultiPartTopology, assessNativeMultiPartReadiness, duplicateNativeMultiPartSection, NATIVE_MULTI_PART_CHILD_KINDS, NATIVE_MULTI_PART_CANVAS_KINDS, NATIVE_MULTI_PART_CANVAS_VERSION } from "../../../data/native-activities/nativeMultiPart.js";
import { nativeActivityKindLabels } from "../../../data/native-activities/nativeActivityKinds.js";
import { getBuilderContent } from "./builderContentApi.js";
import { saveNativeActivityPair, uploadNativeActivityAsset } from "./builderNativeActivityApi.js";
import { createMultiPartSection, multiPartSectionAuthoringProjection, pruneMultiPartAssetRoots, SHARED_CANVAS_AUTHORING_IMAGE_ID, updateMultiPartSharedBackground } from "./nativeMultiPartAuthoring.js";
import { NativeDragDropEditor } from "./NativeDragDropEditor.jsx";
import { NativeSingleChoiceEditor } from "./NativeSingleChoiceEditor.jsx";
import { NativeCompleteSentencesEditor } from "./NativeCompleteSentencesEditor.jsx";
import { NativeOpenResponseEditor } from "./NativeOpenResponseEditor.jsx";
import { NativeMarkWordsEditor } from "./NativeMarkWordsEditor.jsx";
import { NativeImageEditor } from "./NativeImageEditor.jsx";
import { NativeReadableTextEditor } from "./NativeReadableTextEditor.jsx";
import { NativeSupplementalAudioEditor } from "./NativeSupplementalAudioEditor.jsx";
import { NativeVideoEditor } from "./NativeVideoEditor.jsx";

const editors = { "drag-drop": NativeDragDropEditor, "single-choice": NativeSingleChoiceEditor, "complete-sentences": NativeCompleteSentencesEditor, "open-response": NativeOpenResponseEditor, "mark-the-words": NativeMarkWordsEditor, image: NativeImageEditor };
const moveSection = (list, id, delta) => { const current = list.find((entry) => entry.id === id); const siblings = list.filter((entry) => entry.panelId === current.panelId); const target = siblings[siblings.indexOf(current) + delta]; if (!target) return; const from = list.indexOf(current); const to = list.indexOf(target); [list[from], list[to]] = [list[to], list[from]]; };
const move = (list, id, delta) => { const index = list.findIndex((entry) => entry.id === id); if (index < 0 || index + delta < 0 || index + delta >= list.length) return; [list[index], list[index + delta]] = [list[index + delta], list[index]]; };

export function NativeMultiPartEditor({ bookSlug, componentSlug, activityId, placementLabel, onDirtyChange = () => {}, onSaved = () => {} }) {
  const [pair, setPair] = useState(null);
  const [revisions, setRevisions] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panelId, setPanelId] = useState(null);
  const [sectionId, setSectionId] = useState(null);
  const [sectionKind, setSectionKind] = useState("drag-drop");
  const [mode, setMode] = useState("compose");
  const [teacherPreview, setTeacherPreview] = useState(false);
  const [mediaIncomplete, setMediaIncomplete] = useState({});
  const [backgroundRevision, setBackgroundRevision] = useState(0);
  const uploadToken = useRef(null);
  const mediaCallbacks = useMemo(() => Object.fromEntries(["readable", "audio", "video"].map((key) => [key, (value) => setMediaIncomplete((current) => current[key] === value ? current : { ...current, [key]: value })])), []);
  const scope = { bookSlug, componentSlug, activityId };
  useEffect(() => {
    const controller = new AbortController(); setPair(null); setDirty(false);
    Promise.all(["public", "teacher"].map((role) => getBuilderContent({ ...scope, resource: `native-activity-${role}`, documentKey: activityId }, { signal: controller.signal }))).then(([pub, teacher]) => {
      if (controller.signal.aborted) return;
      setPair({ publicDocument: pub.document, teacherDocument: teacher.document }); setRevisions({ publicRevision: pub.revision, teacherRevision: teacher.revision });
      setPanelId(pub.document.parts[0].interaction.panels[0]?.id || null); setSectionId(null); setMessage("Draft saved.");
    }).catch((error) => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => { controller.abort(); uploadToken.current = null; };
  }, [bookSlug, componentSlug, activityId]);
  const mutate = (fn) => { setPair((current) => { if (!current) return current; const next = structuredClone(current); fn(next); return next; }); setDirty(true); onDirtyChange(true); };
  const mutatePublic = (fn) => mutate((next) => fn(next.publicDocument));
  if (!pair) return <p role="status">{message || "Loading Multi-Part…"}</p>;
  const document = pair.publicDocument;
  const interaction = document.parts[0].interaction;
  const panel = interaction.panels.find((entry) => entry.id === panelId);
  const section = interaction.sections.find((entry) => entry.id === sectionId);
  const assetUrl = (assetId) => `/builder/api/native-activities/books/${bookSlug}/components/${componentSlug}/activities/${activityId}/assets/${assetId}/preview`;
  let issues;
  let previewDocument = document;
  try { previewDocument = normalizeNativeActivityPublic(document, { normalizeInteraction: normalizeNativeMultiPartInteraction, expectedKind: "multi-part" }); validateNativeMultiPartTopology(previewDocument, pair.teacherDocument); issues = assessNativeMultiPartReadiness(previewDocument, pair.teacherDocument).issues; }
  catch (error) { issues = [error.message]; }
  const addPanel = (layout) => {
    const id = createNativeChildId("panel");
    mutatePublic((next) => next.parts[0].interaction.panels.push({ id, title: `Panel ${interaction.panels.length + 1}`, layout, surface: { width: 1024, height: 582 }, background: null }));
    setPanelId(id); setSectionId(null);
  };
  const remove = (type, id) => {
    if (!globalThis.confirm(type === "panel" ? "Delete this panel, its sections and their readable-text hotspots?" : "Delete this section, its answers and its readable-text hotspots?")) return;
    mutate((next) => {
      const current = next.publicDocument.parts[0].interaction;
      const removed = new Set(current.sections.filter((entry) => type === "panel" ? entry.panelId === id : entry.id === id).map((entry) => entry.id));
      removeNativeMultiPartOwnedHotspots(next.publicDocument, { panelId: type === "panel" ? id : null, sectionIds: [...removed] });
      current.sections = current.sections.filter((entry) => !removed.has(entry.id));
      if (type === "panel") current.panels = current.panels.filter((entry) => entry.id !== id);
      next.teacherDocument.parts[0].solution.sections = next.teacherDocument.parts[0].solution.sections.filter((entry) => !removed.has(entry.id));
      pruneMultiPartAssetRoots(next.publicDocument);
    }); setSectionId(null); if (type === "panel") setPanelId(null);
  };
  const installChild = (id, child) => mutate((next) => {
    const selected = next.publicDocument.parts[0].interaction.sections.find((entry) => entry.id === id);
    if (!selected || child.publicDocument.activityId !== activityId || selected.kind !== child.publicDocument.kind) return;
    const authored = structuredClone(child.publicDocument.parts[0].interaction);
    if (selected.kind === "drag-drop") for (const childPanel of authored.panels) childPanel.images = childPanel.images.filter((image) => image.id !== SHARED_CANVAS_AUTHORING_IMAGE_ID).map((image, order) => ({ ...image, order }));
    selected.interaction = authored;
    if (selected.bankRegion && authored.layoutMode === "text") {
      const parent = next.publicDocument.parts[0].interaction.panels.find((entry) => entry.id === selected.panelId);
      selected.textRegion ||= { x: selected.bankRegion.x, y: 0, width: Math.min(selected.bankRegion.width, parent.surface.width - selected.bankRegion.x), height: Math.max(1, selected.bankRegion.y) };
    } else delete selected.textRegion;
    next.teacherDocument.parts[0].solution.sections.find((entry) => entry.id === id).solution = structuredClone(child.teacherDocument.parts[0].solution);
    for (const reference of child.publicDocument.assets) next.publicDocument.assets = mergeNativeManagedAssetReference(next.publicDocument.assets, reference);
    pruneMultiPartAssetRoots(next.publicDocument);
  });
  const uploadBackground = async (file) => {
    if (!file || !panel || busy) return;
    const token = {}; uploadToken.current = token; setBusy(true);
    try {
      const result = await uploadNativeActivityAsset({ ...scope, assetSlot: createNativeChildId("asset"), file });
      if (uploadToken.current !== token) return;
      mutatePublic((next) => {
        const current = next.parts[0].interaction.panels.find((entry) => entry.id === panel.id); if (!current) return;
        updateMultiPartSharedBackground(next, panel.id, result.reference, { width: result.metadata.width, height: result.metadata.height });
        next.assets = mergeNativeManagedAssetReference(next.assets, result.reference);
        pruneMultiPartAssetRoots(next);
      }); setBackgroundRevision((value) => value + 1); setMessage("Shared background uploaded. Existing geometry is retained; review its bounds before saving.");
    } catch { setMessage("Background upload failed; the previous background is preserved."); }
    finally { if (uploadToken.current === token) { uploadToken.current = null; setBusy(false); } }
  };
  const save = async () => {
    if (busy || saving) return;
    try {
      const pub = normalizeNativeActivityPublic(document, { normalizeInteraction: normalizeNativeMultiPartInteraction, expectedKind: "multi-part" });
      const teacher = structuredClone(pair.teacherDocument); teacher.parts[0].solution = normalizeNativeMultiPartSolution(teacher.parts[0].solution);
      validateNativeMultiPartTopology(pub, teacher);
      setSaving(true);
      const saved = await saveNativeActivityPair({ ...scope, expectedPublicRevision: revisions.publicRevision, expectedTeacherRevision: revisions.teacherRevision, publicDocument: pub, teacherDocument: teacher });
      setPair({ publicDocument: saved.publicDocument, teacherDocument: saved.teacherDocument }); setRevisions(saved); setDirty(false); onDirtyChange(false); onSaved(saved.publicRevision); setMessage("Draft saved.");
    } catch (error) { setMessage(error.status === 409 ? "This draft changed elsewhere. Your edits remain here." : error.message); }
    finally { setSaving(false); }
  };
  const mediaProps = { ...scope, publicDraft: document, mutatePublic, previewUrl: assetUrl, onIntentChange: () => { setDirty(true); onDirtyChange(true); }, onStatusChange: setMessage, onUploadStateChange: setBusy };
  return <section className="studio-editor native-multi-part-editor">
    <h2>{placementLabel} · Multi-Part</h2>
    <StudioField label="Activity title"><input disabled={saving} value={document.metadata.title} onChange={(event) => mutatePublic((next) => { next.metadata.title = event.target.value; })} /></StudioField>
    <StudioTabWorkspace id="multi-part-authoring" value={mode} onChange={(value) => { if (!busy && !saving) setMode(value); }} tabs={[{ id: "compose", label: "Compose" }, { id: "media", label: "Shared media" }, { id: "preview", label: "Preview whole activity" }]} label="Multi-Part authoring">
    {mode === "compose" ? <>
      <p>Shared canvas: different exercises on the same image. Flow: consecutive exercises inside a panel. Select a panel, then a section to edit its content. Shared media belongs to the whole activity.</p>
      <fieldset className="studio-content-panel" disabled={busy || saving}><legend>Panels</legend>
        {interaction.panels.map((entry, index) => <div className="native-multi-part-authoring-row" key={entry.id}><StudioButton variant="ghost" type="button" selected={panelId === entry.id} onClick={() => { setPanelId(entry.id); setSectionId(null); if (entry.layout === "canvas" && !NATIVE_MULTI_PART_CANVAS_KINDS.includes(sectionKind)) setSectionKind("drag-drop"); }}>{entry.title || `Panel ${index + 1}`} · {entry.layout}</StudioButton><StudioButton type="button" aria-label={`Move panel ${index + 1} earlier`} disabled={index === 0} onClick={() => mutatePublic((next) => move(next.parts[0].interaction.panels, entry.id, -1))}>↑</StudioButton><StudioButton type="button" aria-label={`Move panel ${index + 1} later`} disabled={index === interaction.panels.length - 1} onClick={() => mutatePublic((next) => move(next.parts[0].interaction.panels, entry.id, 1))}>↓</StudioButton><StudioButton variant="danger-ghost" type="button" onClick={() => remove("panel", entry.id)}>Delete panel</StudioButton></div>)}
        <StudioButton type="button" disabled={interaction.panels.length >= 12} onClick={() => addPanel("flow")}>Add flow panel</StudioButton><StudioButton type="button" disabled={interaction.panels.length >= 12} onClick={() => addPanel("canvas")}>Add shared canvas</StudioButton>
      </fieldset>
      {panel ? <fieldset className="studio-content-panel" disabled={busy || saving}><legend>Panel settings / {panel.title} / {panel.layout === "canvas" ? "Shared canvas" : "Flow"}</legend><StudioField label="Panel title"><input value={panel.title} onChange={(event) => mutatePublic((next) => { next.parts[0].interaction.panels.find((entry) => entry.id === panel.id).title = event.target.value; })} /></StudioField>
        {panel.layout === "canvas" ? <label className="studio-upload-action">Shared background<input aria-label="Shared background" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { uploadBackground(event.target.files?.[0]); event.target.value = ""; }} /></label> : null}
        <StudioField label="Section type"><select aria-label="Section type" value={sectionKind} onChange={(event) => setSectionKind(event.target.value)}>{NATIVE_MULTI_PART_CHILD_KINDS.filter((kind) => panel.layout === "flow" || NATIVE_MULTI_PART_CANVAS_KINDS.includes(kind)).map((kind) => <option key={kind} value={kind}>{nativeActivityKindLabels[kind]}</option>)}</select></StudioField>
        <StudioButton type="button" disabled={interaction.sections.length >= 24 || panel.layout === "canvas" && (!panel.background || !NATIVE_MULTI_PART_CANVAS_KINDS.includes(sectionKind))} onClick={() => { const added = createMultiPartSection(sectionKind, panel); mutate((next) => { if (panel.layout === "canvas" && !["drag-drop", "single-choice"].includes(sectionKind)) { next.publicDocument.parts[0].interaction.schemaVersion = NATIVE_MULTI_PART_CANVAS_VERSION; next.teacherDocument.parts[0].solution.schemaVersion = NATIVE_MULTI_PART_CANVAS_VERSION; } next.publicDocument.parts[0].interaction.sections.push(added.section); next.teacherDocument.parts[0].solution.sections.push(added.privateSection); }); setSectionId(added.section.id); }}>Add Section</StudioButton>
        {interaction.sections.filter((entry) => entry.panelId === panel.id).map((entry, sectionIndex, siblings) => <div className="native-multi-part-authoring-row" key={entry.id}><StudioButton variant="ghost" type="button" selected={entry.id === sectionId} onClick={() => setSectionId(entry.id)}>{entry.title || nativeActivityKindLabels[entry.kind]}</StudioButton><StudioButton type="button" disabled={sectionIndex === 0} onClick={() => mutatePublic((next) => moveSection(next.parts[0].interaction.sections, entry.id, -1))}>Move section earlier</StudioButton><StudioButton type="button" disabled={sectionIndex === siblings.length - 1} onClick={() => mutatePublic((next) => moveSection(next.parts[0].interaction.sections, entry.id, 1))}>Move section later</StudioButton><StudioButton type="button" disabled={interaction.sections.length >= 24} onClick={() => { const copied = duplicateNativeMultiPartSection(entry, pair.teacherDocument.parts[0].solution.sections.find((item) => item.id === entry.id)); mutate((next) => { next.publicDocument.parts[0].interaction.sections.push(copied.section); next.teacherDocument.parts[0].solution.sections.push(copied.privateSection); }); setSectionId(copied.section.id); }}>Duplicate section</StudioButton><StudioButton variant="danger-ghost" type="button" onClick={() => remove("section", entry.id)}>Delete section</StudioButton></div>)}
      </fieldset> : null}
      {section ? <><StudioField label="Section title"><input disabled={saving} value={section.title} onChange={(event) => mutatePublic((next) => { next.parts[0].interaction.sections.find((entry) => entry.id === section.id).title = event.target.value; })} /></StudioField>
        {panel.layout === "canvas" && !issues.length ? <details><summary>Shared canvas overview</summary><NativeMultiPartStudentSurface document={{ ...previewDocument, parts: [{ id: "part-1", interaction: { ...previewDocument.parts[0].interaction, panels: [panel], sections: previewDocument.parts[0].interaction.sections.filter((entry) => entry.panelId === panel.id) } }] }} assetUrl={assetUrl} readOnly /></details> : null}
        {section.textRegion ? <fieldset><legend>Scrolling text image region (parent source coordinates)</legend><StageGeometryControls area={section.textRegion} stage={panel.surface} onChange={(area) => mutatePublic((next) => { next.parts[0].interaction.sections.find((entry) => entry.id === section.id).textRegion = area; })} /></fieldset> : null}
        {section.bankRegion ? <StageGeometryControls area={section.bankRegion} stage={panel.surface} onChange={(area) => mutatePublic((next) => { next.parts[0].interaction.sections.find((entry) => entry.id === section.id).bankRegion = area; })} /> : null}

      </> : null}
    </> : null}
    {interaction.sections.map((entry) => { const Editor = editors[entry.kind]; return <fieldset className="native-multi-part-child-editor" disabled={saving} key={entry.id} hidden={mode !== "compose" || entry.id !== sectionId}><Editor {...scope} placementLabel={entry.title || nativeActivityKindLabels[entry.kind]} compositeBinding={{ backgroundRevision, ...multiPartSectionAuthoringProjection(pair, entry), onPairChange: (child) => installChild(entry.id, child), onBusyChange: setBusy }} /></fieldset>; })}
    <fieldset className="native-multi-part-child-editor" disabled={saving} hidden={mode !== "media"}><NativeReadableTextEditor {...mediaProps} onIncompleteChange={mediaCallbacks.readable} /><NativeSupplementalAudioEditor {...mediaProps} onIncompleteChange={mediaCallbacks.audio} /><NativeVideoEditor {...mediaProps} onIncompleteChange={mediaCallbacks.video} /></fieldset>
    {mode === "preview" ? <><label><input type="checkbox" checked={teacherPreview} onChange={(event) => setTeacherPreview(event.target.checked)} />Teacher preview</label>{issues.length ? <p role="status">Resolve the listed issues to preview the complete activity.</p> : <NativeReadableTextPresentation document={document} assetUrl={assetUrl}>{(presentation, audioHotspotPresentation) => teacherPreview ? <NativeMultiPartTeacherSurface presentation={presentation} audioHotspotPresentation={audioHotspotPresentation} publicDocument={document} teacherDocument={pair.teacherDocument} assetUrl={assetUrl} teacherAssetUrl={assetUrl} /> : <NativeMultiPartStudentSurface presentation={presentation} audioHotspotPresentation={audioHotspotPresentation} document={document} assetUrl={assetUrl} />}</NativeReadableTextPresentation>}</> : null}
    </StudioTabWorkspace>
    <StudioSaveBar dirty={dirty} saving={saving} message={message} ready={!issues.length} issues={issues} disabled={!dirty || busy || saving || Object.values(mediaIncomplete).some(Boolean)} onSave={save} />
    {dirty && message && message !== "Draft saved." ? <p role="status">{message}</p> : null}
  </section>;
}
