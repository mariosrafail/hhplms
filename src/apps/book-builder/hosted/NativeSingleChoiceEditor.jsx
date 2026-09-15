import { compositeEditorContent, compositeEditorTabs, useCompositeEditorBinding } from "./nativeCompositeEditorBinding.js";
import { useEffect, useMemo, useState } from "react";
import { BookOpenText, Eye, FileText, Film, KeyRound, LayoutPanelTop, Music } from "lucide-react";

import { StudioField, StudioSaveBar, StudioTabWorkspace } from "../../../components/builder-studio/StudioControls.jsx";
import { NativeSingleChoiceStudentSurface } from "../../../components/native-single-choice/NativeSingleChoiceStudentSurface.jsx";
import { NativeSingleChoiceTeacherSurface } from "../../../components/native-single-choice/NativeSingleChoiceTeacherSurface.jsx";
import { NativeReadableTextPresentation } from "../../../components/native-readable-text/NativeReadableTextPresentation.jsx";
import { createNativeChildId } from "../../../data/native-activities/nativeChildIdentity.js";
import { generateNativeBulkCandidate } from "../../../data/native-activities/nativeBulkAuthoring.js";
import { mergeNativeManagedAssetReference, removeNativeManagedAssetReferenceIfUnused } from "../../../data/native-activities/nativeActivityPublic.js";
import { NATIVE_SINGLE_CHOICE_LIMITS, assessNativeSingleChoiceReadiness, nativeSingleChoiceCorrectOptionIds } from "../../../data/native-activities/nativeSingleChoice.js";
import { generateNativeSingleChoiceHotspotImportCandidate } from "../../../data/native-activities/nativeSingleChoiceHotspotBulkAuthoring.js";
import {
  addUnansweredNativeSingleChoiceQuestion,
  alignNativeSingleChoiceAnswers,
  createNativeSingleChoiceHotspotArea,
  createNativeSingleChoiceVisualPanel,
  enableNativeSingleChoiceVisualPresentation,
  findNextUnusedNativeSingleChoiceBinding,
  removeNativeSingleChoiceOption,
  removeNativeSingleChoiceQuestion,
  removeNativeSingleChoiceVisualPresentation,
  setNativeSingleChoiceHotspotArea,
  setNativeSingleChoiceCorrectAnswers,
} from "../../../data/native-activities/nativeSingleChoiceAuthoring.js";
import { getBuilderContent as getRemoteBuilderContent } from "./builderContentApi.js";
import { saveNativeActivityPair, uploadNativeActivityAsset } from "./builderNativeActivityApi.js";
import { projectNativeActivityPublicForAuthoring } from "./nativeActivityAuthoringProjection.js";
import { NativeReadableTextEditor } from "./NativeReadableTextEditor.jsx";
import { NativeSupplementalAudioEditor } from "./NativeSupplementalAudioEditor.jsx";
import { NativeVideoEditor } from "./NativeVideoEditor.jsx";
import { NativeSingleChoiceQuestionAuthoring } from "./NativeSingleChoiceQuestionAuthoring.jsx";
import { NativeSingleChoiceVisualAuthoring } from "./NativeSingleChoiceVisualAuthoring.jsx";

const clone = (value) => structuredClone(value);
const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);
const tabs = [
  { id: "content", label: "Content", icon: FileText },
  { id: "visual", label: "Visual", icon: LayoutPanelTop },
  { id: "answer-key", label: "Answer Key", icon: KeyRound },
  { id: "readable-text", label: "Readable Text", icon: BookOpenText },
  { id: "video", label: "Video", icon: Film },
  { id: "supplemental-audio", label: "Supplemental MP3", icon: Music },
  { id: "preview", label: "Local Preview", icon: Eye },
];
const previewRoot = (bookSlug, componentSlug, activityId, assetId) => `/builder/api/native-activities/books/${encodeURIComponent(bookSlug)}/components/${encodeURIComponent(componentSlug)}/activities/${encodeURIComponent(activityId)}/assets/${encodeURIComponent(assetId)}/preview`;
const bindingValue = (questionId, optionId) => `${questionId}:${optionId}`;

export function NativeSingleChoiceEditor({ compositeBinding = null, bookSlug, componentSlug, activityId, placementLabel, onDirtyChange = () => {}, onSaved = () => {} }) {
  const getBuilderContent = (request, options) => compositeEditorContent(compositeBinding, getRemoteBuilderContent, request, options);
  const [state, setState] = useState({ kind: "loading", publicRevision: 0, teacherRevision: 0, message: "" });
  const [publicDraft, setPublicDraft] = useState(null);
  const [teacherDraft, setTeacherDraft] = useState(null);
  const [mode, setMode] = useState("content");
  const [preview, setPreview] = useState("student");
  const [selectedQuestionId, setSelectedQuestionId] = useState(null);
  const [selectedPanelId, setSelectedPanelId] = useState(null);
  const [selectedHotspotId, setSelectedHotspotId] = useState(null);
  const [hotspotBinding, setHotspotBinding] = useState("");
  const [uploading, setUploading] = useState(false);
  const [readableTextIncomplete, setReadableTextIncomplete] = useState(false);
  const [videoIncomplete, setVideoIncomplete] = useState(false);
  const [supplementalAudioIncomplete, setSupplementalAudioIncomplete] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [dirty, setDirty] = useState(false);

  useCompositeEditorBinding(compositeBinding, publicDraft, teacherDraft, dirty, uploading, setPublicDraft);
  useEffect(() => {
    const controller = new AbortController();
    setMode("content"); setDirty(false); onDirtyChange(false);
    Promise.all([
      getBuilderContent({ bookSlug, componentSlug, resource: "native-activity-public", documentKey: activityId }, { signal: controller.signal }),
      getBuilderContent({ bookSlug, componentSlug, resource: "native-activity-teacher", documentKey: activityId }, { signal: controller.signal }),
    ]).then(([publicValue, teacherValue]) => {
      if (controller.signal.aborted) return;
      const interaction = publicValue.document.parts[0].interaction;
      setPublicDraft(projectNativeActivityPublicForAuthoring(publicValue.document));
      setTeacherDraft(teacherValue.document);
      setSelectedQuestionId(interaction.questions[0]?.id || null);
      setSelectedPanelId(interaction.presentation?.panels[0]?.id || null);
      setState({ kind: "ready", publicRevision: publicValue.revision, teacherRevision: teacherValue.revision, message: "Saved draft" });
    }).catch((error) => { if (!controller.signal.aborted) setState({ kind: "error", message: error.message }); });
    return () => controller.abort();
  }, [activityId, bookSlug, componentSlug]);
  const changed = () => { setDirty(true); onDirtyChange(true); };
  const mutatePublic = (mutator) => { setPublicDraft((current) => { const next = clone(current); mutator(next); return next; }); changed(); };
  const mutatePair = (mutator) => {
    const nextPublic = clone(publicDraft); const nextTeacher = clone(teacherDraft);
    mutator(nextPublic, nextTeacher);
    setPublicDraft(nextPublic); setTeacherDraft(nextTeacher); changed();
  };

  const interaction = publicDraft?.parts[0].interaction;
  const questions = interaction?.questions || [];
  const presentation = interaction?.presentation || null;
  const panels = presentation?.panels || [];
  const selected = questions.find((question) => question.id === selectedQuestionId) || null;
  const selectedPanel = panels.find((panel) => panel.id === selectedPanelId) || null;
  const selectedHotspot = selectedPanel?.hotspots.find((hotspot) => hotspot.id === selectedHotspotId) || null;
  const answer = teacherDraft?.parts[0].solution.correctAnswers.find((item) => item.questionId === selectedQuestionId) || null;
  const readiness = useMemo(() => publicDraft && teacherDraft ? assessNativeSingleChoiceReadiness(publicDraft, teacherDraft) : null, [publicDraft, teacherDraft]);
  const assetUrlForSlot = (slot) => {
    const reference = publicDraft.assets.find((asset) => asset.slot === slot);
    return reference ? previewRoot(bookSlug, componentSlug, activityId, reference.assetId) : "";
  };
  const assetUrl = (assetId) => previewRoot(bookSlug, componentSlug, activityId, assetId);

  const generateBulk = (source, options) => {
    const result = generateNativeBulkCandidate({ kind: "single-choice", source, publicDocument: publicDraft, teacherDocument: teacherDraft, ...options });
    setPublicDraft(result.publicDocument);
    setTeacherDraft(result.teacherDocument);
    setSelectedQuestionId(result.publicDocument.parts[0].interaction.questions[0]?.id || null);
    setSelectedHotspotId(null);
    changed();
    return result;
  };
  const importHotspots = (source, options) => {
    const result = generateNativeSingleChoiceHotspotImportCandidate({ source, publicDocument: publicDraft, ...options });
    setPublicDraft(result.publicDocument);
    setSelectedPanelId(result.selection.panelId);
    setSelectedHotspotId(result.selection.hotspotId);
    changed();
    return result;
  };

  const addQuestion = () => {
    let questionId;
    mutatePair((nextPublic, nextTeacher) => { ({ questionId } = addUnansweredNativeSingleChoiceQuestion(nextPublic, nextTeacher)); });
    setSelectedQuestionId(questionId);
    setState((current) => ({ ...current, message: "New question needs an explicit correct answer." }));
  };
  const deleteQuestion = (questionId) => {
    if (!globalThis.confirm("Delete this question, its private answer, and its hotspots?")) return;
    const index = questions.findIndex((question) => question.id === questionId);
    mutatePair((nextPublic, nextTeacher) => removeNativeSingleChoiceQuestion(nextPublic, nextTeacher, questionId));
    setSelectedQuestionId(questions[index + 1]?.id || questions[index - 1]?.id || null);
    setSelectedHotspotId(null);
  };
  const moveQuestion = (offset) => {
    const index = questions.findIndex((question) => question.id === selectedQuestionId); const target = index + offset;
    if (target < 0 || target >= questions.length) return;
    mutatePair((nextPublic, nextTeacher) => {
      const list = nextPublic.parts[0].interaction.questions;
      [list[index], list[target]] = [list[target], list[index]];
      alignNativeSingleChoiceAnswers(nextPublic, nextTeacher);
    });
  };
  const toggleAnswer = (optionId) => mutatePair((nextPublic, nextTeacher) => {
    const currentAnswer = nextTeacher.parts[0].solution.correctAnswers.find((item) => item.questionId === selectedQuestionId);
    const selectedIds = new Set(nativeSingleChoiceCorrectOptionIds(currentAnswer));
    if (selectedIds.has(optionId)) selectedIds.delete(optionId); else selectedIds.add(optionId);
    setNativeSingleChoiceCorrectAnswers(nextPublic, nextTeacher, selectedQuestionId, [...selectedIds]);
  });
  const addOption = () => mutatePublic((next) => {
    const options = next.parts[0].interaction.questions.find((question) => question.id === selectedQuestionId).options;
    if (options.length < NATIVE_SINGLE_CHOICE_LIMITS.optionsMaximum) options.push({ id: createNativeChildId("opt"), text: "" });
  });
  const deleteOption = (optionId) => mutatePair((nextPublic, nextTeacher) => removeNativeSingleChoiceOption(nextPublic, nextTeacher, selectedQuestionId, optionId));
  const moveOption = (optionId, offset) => mutatePair((next, nextTeacher) => {
    const list = next.parts[0].interaction.questions.find((question) => question.id === selectedQuestionId).options;
    const index = list.findIndex((option) => option.id === optionId); const target = index + offset;
    if (target >= 0 && target < list.length) [list[index], list[target]] = [list[target], list[index]];
    alignNativeSingleChoiceAnswers(next, nextTeacher);
  });

  const enableVisual = () => {
    const panelId = createNativeChildId("panel");
    mutatePublic((next) => enableNativeSingleChoiceVisualPresentation(next, () => panelId));
    setSelectedPanelId(panelId); setSelectedHotspotId(null); setMode("visual");
  };
  const disableVisual = () => {
    if (!globalThis.confirm("Remove the visual panels and hotspots? Semantic questions and private answers will remain.")) return;
    mutatePublic(removeNativeSingleChoiceVisualPresentation);
    setSelectedPanelId(null); setSelectedHotspotId(null);
  };
  const addPanel = () => {
    const panel = createNativeSingleChoiceVisualPanel();
    mutatePublic((next) => next.parts[0].interaction.presentation.panels.push(panel));
    setSelectedPanelId(panel.id); setSelectedHotspotId(null);
  };
  const movePanel = (offset) => mutatePublic((next) => {
    const list = next.parts[0].interaction.presentation.panels;
    const index = list.findIndex((panel) => panel.id === selectedPanelId); const target = index + offset;
    if (target >= 0 && target < list.length) [list[index], list[target]] = [list[target], list[index]];
  });
  const deletePanel = () => {
    if (!selectedPanel || !globalThis.confirm("Delete this visual panel and all of its hotspots?")) return;
    const index = panels.findIndex((panel) => panel.id === selectedPanel.id);
    mutatePublic((next) => {
      const slot = next.parts[0].interaction.presentation.panels.find((panel) => panel.id === selectedPanel.id)?.backgroundAssetSlot;
      next.parts[0].interaction.presentation.panels = next.parts[0].interaction.presentation.panels.filter((panel) => panel.id !== selectedPanel.id);
      if (slot) removeNativeManagedAssetReferenceIfUnused(next, slot);
    });
    setSelectedPanelId(panels[index + 1]?.id || panels[index - 1]?.id || null); setSelectedHotspotId(null);
  };
  const uploadBackground = async (file) => {
    if (!file || !selectedPanel) return;
    setUploading(true); setState((current) => ({ ...current, message: "Uploading panel background…" }));
    try {
      const uploaded = await uploadNativeActivityAsset({ bookSlug, componentSlug, activityId, assetSlot: createNativeChildId("asset"), file });
      if (!uploaded.metadata || !Number.isSafeInteger(uploaded.metadata.width) || !Number.isSafeInteger(uploaded.metadata.height)) throw new Error("Uploaded image dimensions are unavailable.");
      mutatePublic((next) => {
        const previousSlot = next.parts[0].interaction.presentation.panels.find((entry) => entry.id === selectedPanel.id)?.backgroundAssetSlot;
        next.assets = mergeNativeManagedAssetReference(next.assets, uploaded.reference);
        const panel = next.parts[0].interaction.presentation.panels.find((entry) => entry.id === selectedPanel.id);
        panel.backgroundAssetSlot = uploaded.reference.slot;
        panel.sourceWidth = uploaded.metadata.width;
        panel.sourceHeight = uploaded.metadata.height;
        panel.hotspots = [];
        if (previousSlot && previousSlot !== uploaded.reference.slot) removeNativeManagedAssetReferenceIfUnused(next, previousSlot);
      });
      setSelectedHotspotId(null); setState((current) => ({ ...current, message: "Background uploaded. Redraw hotspots for its intrinsic dimensions." }));
    } catch (error) { setState((current) => ({ ...current, message: error.message || "Background upload failed." })); }
    finally { setUploading(false); }
  };

  const createHotspot = () => {
    const binding = findNextUnusedNativeSingleChoiceBinding(questions, panels, hotspotBinding);
    if (!selectedPanel || !binding) {
      setState((current) => ({ ...current, message: "Every option already has a hotspot." }));
      return;
    }
    const hotspot = { id: createNativeChildId("hot"), questionId: binding.questionId, optionId: binding.optionId, area: createNativeSingleChoiceHotspotArea(selectedPanel.sourceWidth, selectedPanel.sourceHeight) };
    mutatePublic((next) => next.parts[0].interaction.presentation.panels.find((panel) => panel.id === selectedPanel.id).hotspots.push(hotspot));
    setSelectedHotspotId(hotspot.id); setHotspotBinding("");
  };
  const updateHotspot = (mutator) => mutatePublic((next) => {
    const hotspot = next.parts[0].interaction.presentation.panels.find((panel) => panel.id === selectedPanelId)?.hotspots.find((entry) => entry.id === selectedHotspotId);
    if (hotspot) mutator(hotspot);
  });
  const deleteHotspot = () => {
    if (!selectedHotspot) return;
    mutatePublic((next) => {
      const panel = next.parts[0].interaction.presentation.panels.find((entry) => entry.id === selectedPanelId);
      panel.hotspots = panel.hotspots.filter((hotspot) => hotspot.id !== selectedHotspotId);
    });
    setSelectedHotspotId(null);
  };
  const updateHotspotArea = (key, raw) => {
    const value = Math.round(Number(raw)); if (!Number.isFinite(value) || !selectedHotspot || !selectedPanel) return;
    updateHotspot((hotspot) => {
      const area = { ...hotspot.area };
      area[key] = key === "x" ? clamp(value, 0, selectedPanel.sourceWidth - hotspot.area.width)
        : key === "y" ? clamp(value, 0, selectedPanel.sourceHeight - hotspot.area.height)
          : key === "width" ? clamp(value, 1, selectedPanel.sourceWidth - hotspot.area.x)
            : clamp(value, 1, selectedPanel.sourceHeight - hotspot.area.y);
      setNativeSingleChoiceHotspotArea(hotspot, area);
    });
  };
  const updateHotspotGeometry = (area) => updateHotspot((hotspot) => setNativeSingleChoiceHotspotArea(hotspot, area));

  const save = async () => {
    if (compositeBinding) return;
    if (!readiness.ready) { setState((current) => ({ ...current, message: "Resolve all authoring issues before saving." })); return; }
    setState((current) => ({ ...current, saving: true, message: "Saving…" }));
    try {
      const value = await saveNativeActivityPair({ bookSlug, componentSlug, activityId, expectedPublicRevision: state.publicRevision, expectedTeacherRevision: state.teacherRevision, publicDocument: publicDraft, teacherDocument: teacherDraft });
      setPublicDraft(value.publicDocument); setTeacherDraft(value.teacherDocument); setDirty(false); onDirtyChange(false); onSaved(value.publicRevision);
      setState({ kind: "ready", publicRevision: value.publicRevision, teacherRevision: value.teacherRevision, saving: false, message: "Draft saved." });
    } catch (error) { setState((current) => ({ ...current, saving: false, message: error.status === 409 ? "This draft changed elsewhere. Reload before saving." : error.message })); }
  };

  if (state.kind === "loading") return <section className="native-activity-foundation" role="status">Loading native Multiple Choice…</section>;
  if (state.kind === "error" || !publicDraft || !teacherDraft) return <section className="native-activity-foundation" role="alert">{state.message}</section>;

  const mappedBindings = new Set(panels.flatMap((panel) => panel.hotspots.map((hotspot) => bindingValue(hotspot.questionId, hotspot.optionId))));
  const nextHotspotBinding = findNextUnusedNativeSingleChoiceBinding(questions, panels, hotspotBinding);
  const readinessIssues = [...readiness.issues, readableTextIncomplete ? "Upload a readable-text image." : "", videoIncomplete ? "Upload one MP4 and one valid SRT subtitle file." : "", supplementalAudioIncomplete ? "Complete the Supplemental MP3 setup." : ""].filter(Boolean);
  const readyToSave = readiness.ready && !readableTextIncomplete && !videoIncomplete && !supplementalAudioIncomplete;
  return <section className="native-activity-foundation native-single-choice-editor studio-editor">
    <header className="studio-editor-header"><div><span className="studio-eyebrow">{placementLabel} · Multiple Choice</span><h2>{publicDraft.metadata.title}</h2><p>{readiness.ready ? "Content complete" : `${readiness.issues.length} item${readiness.issues.length === 1 ? "" : "s"} need attention`}</p></div><details className="builder-technical-details"><summary>Technical details</summary><dl><div><dt>Stable ID</dt><dd><code>{activityId}</code></dd></div><div><dt>Revisions</dt><dd>Public {state.publicRevision} · Teacher {state.teacherRevision}</dd></div></dl></details></header>
    <StudioTabWorkspace id="native-single-choice-tabs" value={mode} onChange={setMode} tabs={compositeEditorTabs(compositeBinding, tabs)} label="Multiple Choice authoring modes">

    {["content", "visual", "answer-key", "preview"].includes(mode) ? <div className="native-single-choice-back" data-authoring-mode={mode}>
      {mode === "content" ? <section className="studio-content-panel"><header><div><span className="studio-section-icon"><FileText aria-hidden="true" /></span><div><h3>Activity content</h3><p>Edit the learner-facing title and questions.</p></div></div></header><div className="studio-form-grid"><StudioField label="Activity title"><input maxLength={300} value={publicDraft.metadata.title} onChange={(event) => mutatePublic((next) => { next.metadata.title = event.target.value; })} /></StudioField></div></section> : null}
      <NativeSingleChoiceQuestionAuthoring {...{ mode, questions, selected, answer, selectedQuestionId, setSelectedQuestionId, addQuestion, deleteQuestion, moveQuestion, addOption, deleteOption, moveOption, toggleAnswer, mutatePublic, generateBulk }} answeredQuestionIds={new Set(teacherDraft.parts[0].solution.correctAnswers.map((entry) => entry.questionId))} />

      {mode === "visual" ? <NativeSingleChoiceVisualAuthoring maximumPanels={compositeBinding ? 1 : undefined} sharedCanvas={compositeBinding?.sharedCanvas} {...{ presentation, panels, selectedPanel, selectedPanelId, setSelectedPanelId, selectedHotspot, selectedHotspotId, setSelectedHotspotId, questions, zoom, setZoom, uploading, hotspotBinding, setHotspotBinding, mappedBindings, nextHotspotBinding, assetUrlForSlot, enableVisual, disableVisual, importHotspots, addPanel, movePanel, deletePanel, uploadBackground, createHotspot, updateHotspot, updateHotspotArea, updateHotspotGeometry, deleteHotspot }} /> : null}
      {mode === "preview" ?
      <section className="native-or-preview"><div className="native-or-preview-toggle"><button type="button" aria-pressed={preview === "student"} onClick={() => setPreview("student")}>Student Preview</button><button type="button" aria-pressed={preview === "teacher"} onClick={() => setPreview("teacher")}>Teacher Preview</button></div><h3>{publicDraft.metadata.title}</h3><NativeReadableTextPresentation document={publicDraft} assetUrl={assetUrl}>{(presentation, audioHotspotPresentation) => preview === "student" ? <NativeSingleChoiceStudentSurface document={publicDraft} assetUrl={assetUrl} presentation={presentation} audioHotspotPresentation={audioHotspotPresentation} /> : <NativeSingleChoiceTeacherSurface publicDocument={publicDraft} teacherDocument={teacherDraft} assetUrl={assetUrl} presentation={presentation} audioHotspotPresentation={audioHotspotPresentation} />}</NativeReadableTextPresentation></section>
      : null}
    </div> : null}

    {mode === "readable-text" ? <NativeReadableTextEditor bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} publicDraft={publicDraft} mutatePublic={mutatePublic} previewUrl={assetUrl} onIncompleteChange={setReadableTextIncomplete} onIntentChange={changed} onStatusChange={(message) => setState((current) => ({ ...current, message }))} /> : null}
    {mode === "video" ? <NativeVideoEditor bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} publicDraft={publicDraft} mutatePublic={mutatePublic} onIncompleteChange={setVideoIncomplete} onIntentChange={changed} onStatusChange={(message) => setState((current) => ({ ...current, message }))} /> : null}
    {mode === "supplemental-audio" ? <NativeSupplementalAudioEditor bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} publicDraft={publicDraft} mutatePublic={mutatePublic} previewUrl={assetUrl} onIncompleteChange={setSupplementalAudioIncomplete} onIntentChange={changed} onStatusChange={(message) => setState((current) => ({ ...current, message }))} /> : null}
    </StudioTabWorkspace>
    <StudioSaveBar hidden={Boolean(compositeBinding)} dirty={dirty} saving={state.saving} message={state.message} ready={readyToSave} issues={readinessIssues} disabled={!dirty || state.saving || !readyToSave} reason={!dirty ? "No unsaved changes" : !readyToSave ? "Resolve all authoring issues before saving" : ""} onSave={save} />
  </section>;
}
