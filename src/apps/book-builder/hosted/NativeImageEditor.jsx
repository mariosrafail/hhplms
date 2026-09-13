import { compositeEditorContent, compositeEditorTabs, useCompositeEditorBinding } from "./nativeCompositeEditorBinding.js";
import { NativeImageSampleAnswerControls } from "./NativeImageSampleAnswerControls.jsx";
import { NativeImageTeacherPresentation } from "../../../components/native-image/NativeImageTeacherPresentation.jsx";
import { useEffect, useMemo, useState } from "react";
import { Accessibility, BookOpenText, Copy, Eye, FileText, Film, ImagePlus, Layers3, LayoutPanelTop, LockKeyhole, Music, Trash2, Upload } from "lucide-react";

import { StageSelectionFrame } from "../../../components/builder-studio/StageSelectionFrame.jsx";
import { StudioButton, StudioCanvasToolbar, StudioField, StudioSaveBar, StudioTabWorkspace } from "../../../components/builder-studio/StudioControls.jsx";
import { NativeImagePresentation, NativeImageSurface } from "../../../components/native-image/NativeImageSurface.jsx";
import { NativeReadableTextPresentation } from "../../../components/native-readable-text/NativeReadableTextPresentation.jsx";
import { createNativeChildId } from "../../../data/native-activities/nativeChildIdentity.js";
import { mergeNativeManagedAssetReference } from "../../../data/native-activities/nativeActivityPublic.js";
import { assessNativeImageReadiness, duplicateNativeImage, NATIVE_IMAGE_LIMITS, removeNativeImage } from "../../../data/native-activities/nativeImage.js";
import { getBuilderContent as getRemoteBuilderContent } from "./builderContentApi.js";
import { saveNativeActivityPair, uploadNativeActivityAsset } from "./builderNativeActivityApi.js";
import { projectNativeActivityPublicForAuthoring } from "./nativeActivityAuthoringProjection.js";
import { NativeReadableTextEditor } from "./NativeReadableTextEditor.jsx";
import { NativeSupplementalAudioEditor } from "./NativeSupplementalAudioEditor.jsx";
import { NativeVideoEditor } from "./NativeVideoEditor.jsx";

const clone = (value) => structuredClone(value);
const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);
const tabs = [
  { id: "content", label: "Content", icon: FileText },
  { id: "layout", label: "Layout", icon: LayoutPanelTop },
  { id: "readable-text", label: "Readable Text", icon: BookOpenText },
  { id: "video", label: "Video", icon: Film },
  { id: "supplemental-audio", label: "Supplemental MP3", icon: Music },
  { id: "preview", label: "Local Preview", icon: Eye },
];
const previewRoot = (bookSlug, componentSlug, activityId, assetId) => `/builder/api/native-activities/books/${encodeURIComponent(bookSlug)}/components/${encodeURIComponent(componentSlug)}/activities/${encodeURIComponent(activityId)}/assets/${encodeURIComponent(assetId)}/preview`;

export function NativeImageEditor({ compositeBinding = null, bookSlug, componentSlug, activityId, placementLabel, onDirtyChange = () => {}, onSaved = () => {} }) {
  const getBuilderContent = (request, options) => compositeEditorContent(compositeBinding, getRemoteBuilderContent, request, options);
  const [state, setState] = useState({ kind: "loading", message: "" });
  const [publicDraft, setPublicDraft] = useState(null);
  const [teacherDraft, setTeacherDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [answerUploading, setAnswerUploading] = useState(false);
  const [teacherPreview, setTeacherPreview] = useState(false);
  const [tab, setTab] = useState("content");
  const [selectedId, setSelectedId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [readableTextIncomplete, setReadableTextIncomplete] = useState(false);
  const [videoIncomplete, setVideoIncomplete] = useState(false);
  const [supplementalAudioIncomplete, setSupplementalAudioIncomplete] = useState(false);

  useCompositeEditorBinding(compositeBinding, publicDraft, teacherDraft, dirty, uploading || answerUploading, setPublicDraft);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading", message: "" });
    setPublicDraft(null); setTeacherDraft(null); setTab("content"); setDirty(false); setSelectedId(null); onDirtyChange(false);
    Promise.all([
      getBuilderContent({ bookSlug, componentSlug, resource: "native-activity-public", documentKey: activityId }, { signal: controller.signal }),
      getBuilderContent({ bookSlug, componentSlug, resource: "native-activity-teacher", documentKey: activityId }, { signal: controller.signal }),
    ]).then(([publicValue, teacherValue]) => {
      if (controller.signal.aborted) return;
      setPublicDraft(projectNativeActivityPublicForAuthoring(publicValue.document)); setTeacherDraft(teacherValue.document);
      setSelectedId(publicValue.document.parts[0].interaction.images[0]?.id || null);
      setState({ kind: "ready", publicRevision: publicValue.revision, teacherRevision: teacherValue.revision, message: "Draft saved" });
    }).catch((error) => { if (!controller.signal.aborted) setState({ kind: "error", message: error.message }); });
    return () => controller.abort();
  }, [activityId, bookSlug, componentSlug]);

  const interaction = publicDraft?.parts[0].interaction;
  const selectedImage = interaction?.images.find((item) => item.id === selectedId) || null;
  const readiness = useMemo(() => publicDraft ? assessNativeImageReadiness(publicDraft, teacherDraft) : null, [publicDraft, teacherDraft]);
  const mutate = (mutator) => {
    setPublicDraft((current) => { const next = clone(current); mutator(next); return next; });
    setDirty(true); onDirtyChange(true);
  };
  const updateSelected = (mutator) => mutate((next) => {
    const item = next.parts[0].interaction.images.find((entry) => entry.id === selectedId);
    if (item) mutator(item);
  });

  const upload = async (file) => {
    if (!file || interaction.images.length >= NATIVE_IMAGE_LIMITS.images) return;
    setUploading(true); setState((current) => ({ ...current, message: "Uploading image…" }));
    try {
      const requestedSlot = createNativeChildId("asset");
      const uploaded = await uploadNativeActivityAsset({ bookSlug, componentSlug, activityId, assetSlot: requestedSlot, file });
      const imageId = createNativeChildId("img");
      mutate((next) => {
        const current = next.parts[0].interaction;
        next.assets = mergeNativeManagedAssetReference(next.assets, uploaded.reference);
        current.images.push({ id: imageId, assetSlot: uploaded.reference.slot, area: { x: 160, y: 120, width: 320, height: 220 }, order: current.images.length, altText: "", decorative: false, fit: "contain", locked: false });
      });
      setSelectedId(imageId); setTab("layout");
      setState((current) => ({ ...current, message: "Image uploaded; save the draft to attach it." }));
    } catch {
      setState((current) => ({ ...current, message: "Upload failed. Check the file and try again." }));
    } finally { setUploading(false); }
  };

  const updateArea = (key, raw) => {
    const value = Math.round(Number(raw));
    if (!Number.isFinite(value) || !selectedImage || selectedImage.locked) return;
    updateSelected((item) => {
      const surface = interaction.surface;
      item.area[key] = key === "x" ? clamp(value, 0, surface.width - item.area.width)
        : key === "y" ? clamp(value, 0, surface.height - item.area.height)
          : key === "width" ? clamp(value, 1, surface.width - item.area.x)
            : clamp(value, 1, surface.height - item.area.y);
    });
  };

  const duplicate = () => {
    if (!selectedImage || interaction.images.length >= NATIVE_IMAGE_LIMITS.images) return;
    const duplicateId = createNativeChildId("img");
    mutate((next) => duplicateNativeImage(next.parts[0].interaction, selectedId, duplicateId));
    setSelectedId(duplicateId);
  };

  const remove = () => {
    if (!selectedImage) return;
    const currentIndex = interaction.images.findIndex((entry) => entry.id === selectedId);
    const nextId = interaction.images[currentIndex + 1]?.id || interaction.images[currentIndex - 1]?.id || null;
    mutate((next) => removeNativeImage(next, selectedId));
    setSelectedId(nextId); setConfirmingRemove(false);
  };

  const moveOrder = (where) => {
    if (!selectedImage) return;
    mutate((next) => {
      const list = next.parts[0].interaction.images;
      const item = list.find((entry) => entry.id === selectedId);
      const index = list.indexOf(item);
      const target = where === "back" ? 0 : where === "front" ? list.length - 1 : clamp(index + where, 0, list.length - 1);
      if (index === target) return;
      list.splice(index, 1); list.splice(target, 0, item); list.forEach((entry, order) => { entry.order = order; });
    });
  };

  const save = async () => {
    if (compositeBinding) return;
    if (uploading || answerUploading) return;
    setState((current) => ({ ...current, saving: true, message: "Saving…" }));
    try {
      const value = await saveNativeActivityPair({ bookSlug, componentSlug, activityId, expectedPublicRevision: state.publicRevision, expectedTeacherRevision: state.teacherRevision, publicDocument: publicDraft, teacherDocument: teacherDraft });
      setPublicDraft(value.publicDocument); setTeacherDraft(value.teacherDocument); setDirty(false); onDirtyChange(false);
      setState({ kind: "ready", publicRevision: value.publicRevision, teacherRevision: value.teacherRevision, saving: false, message: "Draft saved." });
      onSaved(value.publicRevision);
    } catch (error) {
      setState((current) => ({ ...current, saving: false, message: error.status === 409 ? "This draft changed elsewhere. Reload before saving; your edits are preserved." : "Save failed. Your edits are still here." }));
    }
  };

  if (state.kind === "loading") return <section className="native-activity-foundation studio-loading" role="status">Loading Image editor…</section>;
  if (state.kind === "error" || !publicDraft || !teacherDraft) return <section className="native-activity-foundation studio-error" role="alert">{state.message || "Native draft is unavailable."}</section>;

  const assetUrl = (assetId) => previewRoot(bookSlug, componentSlug, activityId, assetId);
  const readinessIssues = [...readiness.issues, readableTextIncomplete ? "Upload a readable-text image." : "", videoIncomplete ? "Upload one MP4 and one valid SRT subtitle file." : "", supplementalAudioIncomplete ? "Complete the Supplemental MP3 setup." : ""].filter(Boolean);
  const readyToSave = readiness.ready && !readableTextIncomplete && !videoIncomplete && !supplementalAudioIncomplete;
  return <section className="native-activity-foundation native-image-editor native-or-editor studio-editor">
    <header className="studio-editor-header">
      <div><span className="studio-eyebrow">{placementLabel} · Image</span><h2>{publicDraft.metadata.title}</h2><p>{readiness.ready ? "Content complete" : <><span>Content incomplete</span> · {readiness.issues.length} item{readiness.issues.length === 1 ? "" : "s"} need attention</>}</p></div>
      <details className="builder-technical-details"><summary>Technical details</summary><dl><div><dt>Stable ID</dt><dd><code>{activityId}</code></dd></div><div><dt>Revisions</dt><dd>Public {state.publicRevision} · Teacher {state.teacherRevision}</dd></div></dl></details>
    </header>
    <StudioTabWorkspace id="native-image-tabs" value={tab} onChange={setTab} tabs={compositeEditorTabs(compositeBinding, tabs)} label="Image authoring modes">

    {tab === "content" ? <div className="studio-content-panel">
      <header><div><span className="studio-section-icon"><FileText aria-hidden="true" /></span><div><h3>Activity content</h3><p>Set the title and learner-facing content.</p></div></div></header>
      <div className="studio-form-grid">
        <StudioField label="Activity title"><input value={publicDraft.metadata.title} maxLength={300} onChange={(event) => mutate((next) => { next.metadata.title = event.target.value; })} /></StudioField>
        <StudioField className="studio-field--wide" label="Content" hint="This learner-facing text is retained for LMS reading support. It is not displayed inside the Interactive image stage."><textarea value={interaction.contentText || ""} maxLength={NATIVE_IMAGE_LIMITS.contentTextLength} rows={7} onChange={(event) => mutate((next) => {
          const value = event.target.value;
          if (value) next.parts[0].interaction.contentText = value;
          else delete next.parts[0].interaction.contentText;
        })} /></StudioField>
      </div>
      <NativeImageSampleAnswerControls bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} solution={teacherDraft.parts[0].solution} onPendingChange={setAnswerUploading} onChange={(sample) => { setTeacherDraft((current) => { const next = clone(current); next.parts[0].solution.sampleAnswer = sample; return next; }); setDirty(true); onDirtyChange(true); }} />
      <div className="studio-content-summary"><Layers3 aria-hidden="true" /><strong>{interaction.images.length} image layer{interaction.images.length === 1 ? "" : "s"}</strong><span>Use Layout to position and resize them.</span></div>
    </div> : null}

    {tab === "layout" ? <div className="studio-visual-workspace" role="tabpanel">
      <aside className="studio-navigator" aria-label="Image layers">
        <header><div><Layers3 aria-hidden="true" /><div><h3>Image layers</h3><p>Front layers appear first.</p></div></div><span className="studio-count">{interaction.images.length}</span></header>
        <div className="studio-layer-list native-or-layers">
          {[...interaction.images].sort((left, right) => right.order - left.order).map((item, index) => {
            const reference = publicDraft.assets.find((asset) => asset.slot === item.assetSlot);
            return <button type="button" key={item.id} aria-current={selectedId === item.id ? "true" : undefined} onClick={() => { setSelectedId(item.id); setConfirmingRemove(false); }}>
              <span className="studio-layer-thumb">{reference ? <img src={assetUrl(reference.assetId)} alt="" /> : <ImagePlus aria-hidden="true" />}</span>
              <span><strong>{item.altText || (item.decorative ? "Decorative image" : `Image ${interaction.images.length - index}`)}</strong><small>{item.locked ? "Locked · " : ""}{item.decorative ? "Decorative" : "Meaningful image"}</small></span>
              {item.locked ? <LockKeyhole aria-label="Locked" /> : null}
            </button>;
          })}
        </div>
        {!interaction.images.length ? <div className="studio-empty-state"><ImagePlus aria-hidden="true" /><strong>No images yet</strong><p>Upload an image to begin your composition.</p></div> : null}
        <label className="studio-upload-action native-or-upload"><Upload aria-hidden="true" /><span><strong>{uploading ? "Uploading…" : "Add image"}</strong><small>PNG, JPEG or WebP</small></span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading || interaction.images.length >= NATIVE_IMAGE_LIMITS.images} onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ""; }} /></label>
      </aside>

      <section className="studio-canvas-column" aria-label="Image canvas">
        <StudioCanvasToolbar zoom={zoom} onZoomChange={setZoom} />
        <div className="studio-canvas-viewport"><div className="studio-artboard-wrap" style={{ width: `${zoom * 100}%` }}>
          <NativeImageSurface document={publicDraft} assetUrl={assetUrl} selectedId={selectedId} onSelect={setSelectedId} className="studio-artboard">
            {selectedImage ? <StageSelectionFrame geometry={selectedImage.area} stage={interaction.surface} label={selectedImage.altText || "Image"} locked={selectedImage.locked} minWidth={24} minHeight={24} onChange={(area) => updateSelected((item) => { item.area = area; })} onClear={() => setSelectedId(null)} onDelete={() => setConfirmingRemove(true)} /> : null}
          </NativeImageSurface>
        </div></div>
        <p className="studio-canvas-hint">Drag to move · Resize from any corner · Arrow keys nudge · Shift + arrows move 10 units</p>
      </section>

      <aside className="studio-inspector" aria-label="Image properties">
        <header><span className="studio-section-icon"><LayoutPanelTop aria-hidden="true" /></span><div><h3>{selectedImage ? "Image properties" : "Nothing selected"}</h3><p>{selectedImage ? "Changes apply to the selected layer." : "Select a layer or canvas object to edit it."}</p></div></header>
        {selectedImage ? <>
          <section className="studio-inspector-section"><h4>Transform</h4><div className="studio-number-grid">{["x", "y", "width", "height"].map((key) => <StudioField key={key} label={key[0].toUpperCase() + key.slice(1)}><input type="number" min={["width", "height"].includes(key) ? 1 : 0} step="1" value={selectedImage.area[key]} disabled={selectedImage.locked} onChange={(event) => updateArea(key, event.target.value)} /></StudioField>)}</div><label className="studio-check"><input type="checkbox" checked={selectedImage.locked} onChange={(event) => updateSelected((item) => { item.locked = event.target.checked; })} /><span><LockKeyhole aria-hidden="true" />Lock position and size</span></label><p className="studio-help">Width and height resize independently.</p></section>
          <section className="studio-inspector-section"><h4><Accessibility aria-hidden="true" /> Accessibility</h4><StudioField label="Alt text" hint={selectedImage.decorative ? "Decorative images are ignored by assistive technology." : "Describe the image’s meaning or purpose."}><textarea value={selectedImage.altText} disabled={selectedImage.decorative} maxLength={2000} rows={3} onChange={(event) => updateSelected((item) => { item.altText = event.target.value; })} /></StudioField><label className="studio-check"><input type="checkbox" checked={selectedImage.decorative} onChange={(event) => updateSelected((item) => { item.decorative = event.target.checked; })} /><span>Mark as decorative</span></label></section>
          <section className="studio-inspector-section"><h4>Appearance & arrange</h4><StudioField label="Fit"><select value={selectedImage.fit} onChange={(event) => updateSelected((item) => { item.fit = event.target.value; })}><option value="contain">Contain</option><option value="cover">Cover</option></select></StudioField><div className="studio-arrange-grid"><StudioButton disabled={selectedImage.order === 0} reason="Already at back" onClick={() => moveOrder("back")}>Send to Back</StudioButton><StudioButton disabled={selectedImage.order === 0} reason="Already at back" onClick={() => moveOrder(-1)}>Send Backward</StudioButton><StudioButton disabled={selectedImage.order === interaction.images.length - 1} reason="Already at front" onClick={() => moveOrder(1)}>Bring Forward</StudioButton><StudioButton disabled={selectedImage.order === interaction.images.length - 1} reason="Already at front" onClick={() => moveOrder("front")}>Bring to Front</StudioButton></div></section>
          <section className="studio-inspector-section studio-object-actions"><StudioButton aria-label="Duplicate image" onClick={duplicate} disabled={interaction.images.length >= NATIVE_IMAGE_LIMITS.images} reason="Maximum image count reached"><Copy aria-hidden="true" />Duplicate</StudioButton>{confirmingRemove ? <div className="studio-confirm-row" role="group" aria-label="Confirm image removal"><StudioButton variant="danger" onClick={remove}><Trash2 aria-hidden="true" />Confirm remove</StudioButton><StudioButton variant="ghost" onClick={() => setConfirmingRemove(false)}>Cancel</StudioButton></div> : <StudioButton variant="danger-ghost" onClick={() => setConfirmingRemove(true)}><Trash2 aria-hidden="true" />Remove image</StudioButton>}</section>
        </> : <div className="studio-empty-state"><Layers3 aria-hidden="true" /><strong>Select an image</strong><p>Choose a layer on the left or click an object on the canvas.</p></div>}
      </aside>
    </div> : null}

    {tab === "preview" ? <div className="studio-preview-panel"><header><Eye aria-hidden="true" /><div><h3>Local Preview</h3><p>Preview includes unsaved editor changes. Shared Review shows the last saved Viewer state.</p></div></header><h3>{publicDraft.metadata.title}</h3><label><input type="checkbox" checked={teacherPreview} onChange={(event) => setTeacherPreview(event.target.checked)} />Teacher preview</label><NativeReadableTextPresentation document={publicDraft} assetUrl={assetUrl}>{teacherPreview ? <NativeImageTeacherPresentation document={publicDraft} teacherDocument={teacherDraft} teacherAssetUrl={assetUrl} assetUrl={assetUrl} /> : <NativeImagePresentation document={publicDraft} assetUrl={assetUrl} />}</NativeReadableTextPresentation></div> : null}
    {tab === "readable-text" ? <NativeReadableTextEditor bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} publicDraft={publicDraft} mutatePublic={mutate} previewUrl={assetUrl} onIncompleteChange={setReadableTextIncomplete} onIntentChange={() => { setDirty(true); onDirtyChange(true); }} onStatusChange={(message) => setState((current) => ({ ...current, message }))} /> : null}
    {tab === "video" ? <NativeVideoEditor bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} publicDraft={publicDraft} mutatePublic={mutate} onIncompleteChange={setVideoIncomplete} onIntentChange={() => { setDirty(true); onDirtyChange(true); }} onStatusChange={(message) => setState((current) => ({ ...current, message }))} /> : null}
    {tab === "supplemental-audio" ? <NativeSupplementalAudioEditor bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} publicDraft={publicDraft} mutatePublic={mutate} previewUrl={assetUrl} onIncompleteChange={setSupplementalAudioIncomplete} onIntentChange={() => { setDirty(true); onDirtyChange(true); }} onStatusChange={(message) => setState((current) => ({ ...current, message }))} /> : null}
    </StudioTabWorkspace>
    <StudioSaveBar hidden={Boolean(compositeBinding)} dirty={dirty} saving={state.saving} message={state.message} ready={readyToSave} issues={readinessIssues} disabled={!dirty || state.saving || uploading || answerUploading || !publicDraft.metadata.title.trim() || readableTextIncomplete || videoIncomplete || supplementalAudioIncomplete} reason={!dirty ? "No unsaved changes" : readableTextIncomplete ? "Upload a readable-text image before saving" : videoIncomplete ? "Complete the Video setup before saving" : supplementalAudioIncomplete ? "Complete the Supplemental MP3 setup before saving" : "Add an activity title before saving"} onSave={save} />
  </section>;
}
