import { loadNativeEditorDocuments, compositeEditorContent, compositeEditorTabs, useCompositeEditorBinding } from "./nativeCompositeEditorBinding.js";
import { useEffect, useMemo, useState } from "react";
import { Eye, ImagePlus, KeyRound, LayoutPanelTop, Plus, Trash2, Upload } from "lucide-react";
import { StudioButton, StudioCanvasToolbar, StudioField, StudioSaveBar, StudioTabWorkspace } from "../../../components/builder-studio/StudioControls.jsx";
import { QuickNumber, StageGeometryControls } from "../../../components/builder-studio/StageGeometryControls.jsx";
import { NativeCompleteSentencesHotspotCanvas } from "../../../components/native-complete-sentences/NativeCompleteSentencesHotspotCanvas.jsx";
import { NativeCompleteSentencesStudentSurface, NativeCompleteSentencesTeacherSurface } from "../../../components/native-complete-sentences/NativeCompleteSentencesSurface.jsx";
import { NativeReadableTextPresentation } from "../../../components/native-readable-text/NativeReadableTextPresentation.jsx";
import { createNativeChildId } from "../../../data/native-activities/nativeChildIdentity.js";
import { generateNativeBulkCandidate } from "../../../data/native-activities/nativeBulkAuthoring.js";
import { mergeNativeManagedAssetReference, removeNativeManagedAssetReferenceIfUnused } from "../../../data/native-activities/nativeActivityPublic.js";
import { assessNativeCompleteSentencesReadiness, assessNativeCompleteSentencesSaveability, nativeCompleteSentencesAcceptedTexts, NATIVE_COMPLETE_SENTENCES_EXACT_EVALUATION_MODE, NATIVE_COMPLETE_SENTENCES_LIMITS, normalizeNativeCompleteSentencesInteraction } from "../../../data/native-activities/nativeCompleteSentences.js";
import { addNativeCompleteSentencesItem, addNextNativeCompleteSentencesHotspot, alignNativeCompleteSentencesAnswers, createNativeCompleteSentencesPanel, findNextUnusedNativeCompleteSentencesItemId, nativeCompleteSentencesMarkedSentence, parseNativeCompleteSentencesMarkedSentence, removeNativeCompleteSentencesItem, removeNativeCompleteSentencesPanel, replaceNativeCompleteSentencesBackground } from "../../../data/native-activities/nativeCompleteSentencesAuthoring.js";
import { generateNativeCompleteSentencesHotspotImportCandidate } from "../../../data/native-activities/nativeCompleteSentencesHotspotBulkAuthoring.js";
import { getBuilderContent as getRemoteBuilderContent } from "./builderContentApi.js";
import { getBuilderFontLibrary, nativeFontPreviewUrl, saveNativeActivityPair, uploadNativeActivityAsset } from "./builderNativeActivityApi.js";
import { NativeCompleteSentencesHotspotBulkImporter } from "./NativeCompleteSentencesHotspotBulkImporter.jsx";
import { NATIVE_COMPLETE_SENTENCES_TABS, NativeCompleteSentencesEditorHeader, NativeCompleteSentencesItemNavigation } from "./NativeCompleteSentencesEditorControls.jsx";
import { NativeCompleteSentencesFontControls } from "./NativeCompleteSentencesFontControls.jsx";
import { projectNativeActivityPublicForAuthoring } from "./nativeActivityAuthoringProjection.js";
import { NativeReadableTextEditor } from "./NativeReadableTextEditor.jsx";
import { NativeSupplementalAudioEditor } from "./NativeSupplementalAudioEditor.jsx";
import { NativeVideoEditor } from "./NativeVideoEditor.jsx";
import { NativeBulkGenerator } from "./NativeBulkGenerator.jsx";
const clone = (value) => structuredClone(value);
const previewRoot = (bookSlug, componentSlug, activityId, assetId) => `/builder/api/native-activities/books/${encodeURIComponent(bookSlug)}/components/${encodeURIComponent(componentSlug)}/activities/${encodeURIComponent(activityId)}/assets/${encodeURIComponent(assetId)}/preview`;
export function NativeCompleteSentencesEditor({ compositeBinding = null, bookSlug, componentSlug, activityId, placementLabel, onDirtyChange = () => {}, onSaved = () => {} }) {
  const getBuilderContent = (request, options) => compositeEditorContent(compositeBinding, getRemoteBuilderContent, request, options);
  const [state, setState] = useState({ kind: "loading", publicRevision: 0, teacherRevision: 0, message: "" });
  const [publicDraft, setPublicDraft] = useState(null);
  const [teacherDraft, setTeacherDraft] = useState(null);
  const [authoringSentences, setAuthoringSentences] = useState({});
  const [tab, setTab] = useState("content");
  const [preview, setPreview] = useState("student");
  const [dirty, setDirty] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [selectedPanelId, setSelectedPanelId] = useState(null);
  const [selectedHotspotId, setSelectedHotspotId] = useState(null);
  const [lockedHotspotIds, setLockedHotspotIds] = useState(() => new Set());
  const [drawItemId, setDrawItemId] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fonts, setFonts] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [readableIncomplete, setReadableIncomplete] = useState(false);
  const [videoIncomplete, setVideoIncomplete] = useState(false);
  const [supplementalAudioIncomplete, setSupplementalAudioIncomplete] = useState(false);
  useCompositeEditorBinding(compositeBinding, publicDraft, teacherDraft, dirty, uploading, setPublicDraft);
  useEffect(() => {
    const controller = new AbortController();
    setTab("content");
    setDirty(false);
    setLockedHotspotIds(new Set());
    onDirtyChange(false);
    loadNativeEditorDocuments(getBuilderContent, getBuilderFontLibrary, { bookSlug, componentSlug, activityId }, controller.signal)
      .then(([publicValue, teacherValue, fontLibrary]) => {
        if (controller.signal.aborted) return;
        const projected = projectNativeActivityPublicForAuthoring(publicValue.document);
        projected.parts[0].interaction = normalizeNativeCompleteSentencesInteraction(projected.parts[0].interaction, { assets: projected.assets });
        setPublicDraft(projected);
        setTeacherDraft(teacherValue.document);
        setFonts(fontLibrary);
        setSelectedItemId(projected.parts[0].interaction.items[0]?.id || null);
        setSelectedPanelId(projected.parts[0].interaction.presentation.panels[0]?.id || null);
        const answers = new Map(teacherValue.document.parts[0].solution.answers.map((entry) => [entry.itemId, entry.text]));
        setAuthoringSentences(Object.fromEntries(publicValue.document.parts[0].interaction.items.map((item) => [item.id, nativeCompleteSentencesMarkedSentence(item.prompt, answers.get(item.id) || "")])));
        setState({
          kind: "ready",
          publicRevision: publicValue.revision,
          teacherRevision: teacherValue.revision,
          message: "Saved draft",
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ kind: "error", message: error.message });
      });
    return () => controller.abort();
  }, [activityId, bookSlug, componentSlug]);

  const changed = () => {
    setDirty(true);
    onDirtyChange(true);
  };
  const mutatePublic = (mutator) => {
    setPublicDraft((current) => {
      const next = clone(current);
      mutator(next);
      return next;
    });
    changed();
  };
  const mutateTeacher = (mutator) => {
    setTeacherDraft((current) => {
      const next = clone(current);
      mutator(next);
      return next;
    });
    changed();
  };
  const mutatePair = (mutator) => {
    const nextPublic = clone(publicDraft);
    const nextTeacher = clone(teacherDraft);
    mutator(nextPublic, nextTeacher);
    setPublicDraft(nextPublic);
    setTeacherDraft(nextTeacher);
    changed();
  };
  const interaction = publicDraft?.parts[0].interaction;
  const items = interaction?.items || [];
  const presentation = interaction?.presentation;
  const panels = presentation?.panels || [];
  const answerStyle = presentation?.answerStyle;
  const mappedItemIds = new Set(panels.flatMap((panel) => panel.hotspots.map((hotspot) => hotspot.itemId)));
  const nextDrawItemId = findNextUnusedNativeCompleteSentencesItemId(items, panels, drawItemId);
  const selectedPanel = panels.find((panel) => panel.id === selectedPanelId) || panels[0] || null;
  const selectedItem = items.find((item) => item.id === selectedItemId) || null;
  const selectedAnswer = teacherDraft?.parts[0].solution.answers.find((entry) => entry.itemId === selectedItemId) || null;
  const selectedHotspot = selectedPanel?.hotspots.find((hotspot) => hotspot.id === selectedHotspotId) || null;
  const selectedHotspotLocked = selectedHotspot ? lockedHotspotIds.has(selectedHotspot.id) : false;
  const markedSentence = selectedItem ? (authoringSentences[selectedItem.id] ?? "") : "";
  const markedSentenceResult = selectedItem ? parseNativeCompleteSentencesMarkedSentence(markedSentence) : null;
  const authoringIssues = items.flatMap((item, index) => {
    const parsed = parseNativeCompleteSentencesMarkedSentence(authoringSentences[item.id] ?? "");
    return parsed.valid ? [] : [`Sentence ${index + 1}: ${parsed.error}`];
  });
  const readiness = useMemo(() => (publicDraft && teacherDraft ? assessNativeCompleteSentencesReadiness(publicDraft, teacherDraft) : null), [publicDraft, teacherDraft]);
  const saveability = useMemo(() => (publicDraft && teacherDraft ? assessNativeCompleteSentencesSaveability(publicDraft, teacherDraft) : null), [publicDraft, teacherDraft]);
  const assetUrl = (assetId) => previewRoot(bookSlug, componentSlug, activityId, assetId);
  const previewAssetUrl = (assetId) => publicDraft?.assets.find((asset) => asset.assetId === assetId)?.role === "activity_font" ? nativeFontPreviewUrl(bookSlug, componentSlug, assetId) : assetUrl(assetId);
  const backgroundReference = publicDraft?.assets.find((asset) => asset.slot === selectedPanel?.backgroundAssetSlot);
  const generateBulk = (source, options) => {
    const result = generateNativeBulkCandidate({ kind: "complete-sentences", source, publicDocument: publicDraft, teacherDocument: teacherDraft, ...options });
    setPublicDraft(result.publicDocument); setTeacherDraft(result.teacherDocument);
    const answers = new Map(result.teacherDocument.parts[0].solution.answers.map((answer) => [answer.itemId, answer.text]));
    setAuthoringSentences(Object.fromEntries(result.publicDocument.parts[0].interaction.items.map((item) => [item.id, nativeCompleteSentencesMarkedSentence(item.prompt, answers.get(item.id) || "")])));
    setSelectedItemId(result.publicDocument.parts[0].interaction.items[0]?.id || null); setSelectedHotspotId(null); changed();
    return result;
  };
  const importHotspots = (source, options) => {
    const result = generateNativeCompleteSentencesHotspotImportCandidate({ source, publicDocument: publicDraft, ...options });
    const retainedIds = new Set(result.publicDocument.parts[0].interaction.presentation.panels.flatMap((panel) => panel.hotspots.map((hotspot) => hotspot.id)));
    setPublicDraft(result.publicDocument); setSelectedPanelId(result.selection.panelId); setSelectedHotspotId(result.selection.hotspotId); setDrawing(false);
    setLockedHotspotIds((current) => new Set([...current].filter((id) => retainedIds.has(id))));
    changed();
    return result;
  };
  useEffect(() => {
    const next = nextDrawItemId || "";
    if (drawItemId === next) return;
    setDrawItemId(next);
    setDrawing(false);
  }, [drawItemId, nextDrawItemId]);
  const addItem = () => {
    let id;
    mutatePair((nextPublic, nextTeacher) => {
      id = addNativeCompleteSentencesItem(nextPublic, nextTeacher);
    });
    setAuthoringSentences((current) => ({ ...current, [id]: "" }));
    setSelectedItemId(id);
  };
  const removeItem = () => {
    if (!selectedItem || !globalThis.confirm("Delete this sentence, its private answer, and blank hotspot?")) return;
    const index = items.indexOf(selectedItem);
    mutatePair((nextPublic, nextTeacher) => removeNativeCompleteSentencesItem(nextPublic, nextTeacher, selectedItem.id));
    setSelectedItemId(items[index + 1]?.id || items[index - 1]?.id || null);
    setSelectedHotspotId(null);
  };
  const moveItem = (offset) =>
    mutatePair((nextPublic, nextTeacher) => {
      const list = nextPublic.parts[0].interaction.items;
      const index = list.findIndex((item) => item.id === selectedItemId);
      const target = index + offset;
      if (target >= 0 && target < list.length) [list[index], list[target]] = [list[target], list[index]];
      alignNativeCompleteSentencesAnswers(nextPublic, nextTeacher);
    });
  const addPanel = () => {
    const panel = createNativeCompleteSentencesPanel();
    mutatePublic((next) => next.parts[0].interaction.presentation.panels.push(panel));
    setSelectedPanelId(panel.id);
    setSelectedHotspotId(null);
  };
  const movePanel = (offset) => mutatePublic((next) => {
    const list = next.parts[0].interaction.presentation.panels;
    const index = list.findIndex((panel) => panel.id === selectedPanelId);
    const target = index + offset;
    if (index >= 0 && target >= 0 && target < list.length) [list[index], list[target]] = [list[target], list[index]];
  });
  const deletePanel = () => {
    if (!selectedPanel || panels.length <= 1 || !globalThis.confirm("Delete this panel, its background, and all of its hotspots?")) return;
    const index = panels.indexOf(selectedPanel);
    mutatePublic((next) => removeNativeCompleteSentencesPanel(next, selectedPanel.id));
    setSelectedPanelId(panels[index + 1]?.id || panels[index - 1]?.id || null);
    setSelectedHotspotId(null);
  };
  const updateMarkedSentence = (value) => {
    setAuthoringSentences((current) => ({ ...current, [selectedItem.id]: value }));
    const parsed = parseNativeCompleteSentencesMarkedSentence(value);
    if (!parsed.valid) { changed(); return; }
    mutatePair((nextPublic, nextTeacher) => {
      nextPublic.parts[0].interaction.items.find((item) => item.id === selectedItem.id).prompt = parsed.prompt;
      const answer = nextTeacher.parts[0].solution.answers.find((entry) => entry.itemId === selectedItem.id);
      const answerChanged = parsed.answer !== answer.text;
      answer.text = parsed.answer;
      if (Object.hasOwn(answer, "acceptedTexts") && answerChanged) answer.acceptedTexts = [parsed.answer];
    });
  };
  const updateAnswer = (value) => {
    setAuthoringSentences((current) => ({ ...current, [selectedItem.id]: nativeCompleteSentencesMarkedSentence(selectedItem.prompt, value) }));
    mutatePair((_nextPublic, nextTeacher) => { nextTeacher.parts[0].solution.answers.find((entry) => entry.itemId === selectedItem.id).text = value; });
  };
  const acceptedTexts = nativeCompleteSentencesAcceptedTexts(selectedAnswer);
  const mutateAcceptedTexts = (mutator) => mutateTeacher((nextTeacher) => {
    const answer = nextTeacher.parts[0].solution.answers.find((entry) => entry.itemId === selectedItem.id);
    const values = nativeCompleteSentencesAcceptedTexts(answer); mutator(values); answer.acceptedTexts = values;
  });
  const updateAcceptedText = (index, value) => mutateAcceptedTexts((values) => { values[index] = value; });
  const addAcceptedText = () => mutateAcceptedTexts((values) => values.push(""));
  const moveAcceptedText = (index, offset) => mutateAcceptedTexts((values) => { [values[index], values[index + offset]] = [values[index + offset], values[index]]; });
  const removeAcceptedText = (index) => mutateAcceptedTexts((values) => values.splice(index, 1));
  const uploadBackground = async (file) => {
    if (!file || !selectedPanel) return;
    setUploading(true);
    setState((current) => ({ ...current, message: "Uploading background…" }));
    try {
      const uploaded = await uploadNativeActivityAsset({
        bookSlug,
        componentSlug,
        activityId,
        assetSlot: createNativeChildId("asset"),
        file,
      });
      if (!Number.isSafeInteger(uploaded.metadata?.width) || !Number.isSafeInteger(uploaded.metadata?.height)) throw new Error("Uploaded image dimensions are unavailable.");
      const dimensionsChanged = selectedPanel.sourceWidth !== uploaded.metadata.width || selectedPanel.sourceHeight !== uploaded.metadata.height;
      mutatePublic((next) => {
        next.assets = mergeNativeManagedAssetReference(next.assets, uploaded.reference);
        replaceNativeCompleteSentencesBackground(next, selectedPanel.id, uploaded.reference, uploaded.metadata);
      });
      if (dimensionsChanged) setSelectedHotspotId(null);
      setState((current) => ({
        ...current,
        message: dimensionsChanged ? "Background dimensions changed. Redraw this panel's blank hotspots." : "Background replaced. Existing hotspot geometry was preserved.",
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        message: error.message || "Background upload failed.",
      }));
    } finally {
      setUploading(false);
    }
  };
  const setAnswerFont = (font) => {
    mutatePublic((next) => {
      const style = next.parts[0].interaction.presentation.answerStyle;
      const previousSlot = style.fontAssetSlot;
      if (font) {
        next.assets = mergeNativeManagedAssetReference(next.assets, { assetId: font.assetId, checksumSha256: font.checksumSha256, role: font.role, slot: font.slot });
        style.fontAssetSlot = font.slot;
      } else style.fontAssetSlot = null;
      if (previousSlot && previousSlot !== style.fontAssetSlot) removeNativeManagedAssetReferenceIfUnused(next, previousSlot);
      next.assets.filter((asset) => asset.role === "activity_font" && asset.slot !== style.fontAssetSlot)
        .map((asset) => asset.slot).forEach((slot) => removeNativeManagedAssetReferenceIfUnused(next, slot));
    });
  };
  const recordUploadedFont = (font) => setFonts((current) => [...current.filter((entry) => entry.assetId !== font.assetId), font]);
  const createHotspot = (area) => {
    const itemId = findNextUnusedNativeCompleteSentencesItemId(items, panels, drawItemId);
    if (!itemId || !selectedPanel) return;
    const hotspot = { id: createNativeChildId("hot"), itemId, area };
    mutatePublic((next) => next.parts[0].interaction.presentation.panels.find((panel) => panel.id === selectedPanel.id).hotspots.push(hotspot));
    setSelectedHotspotId(hotspot.id);
    setDrawing(false);
  };
  const createDefaultHotspot = () => {
    if (!selectedPanel || !backgroundReference) return;
    if (!nextDrawItemId) {
      setState((current) => ({ ...current, message: "Every sentence already has a hotspot." }));
      return;
    }
    let hotspot = null;
    mutatePublic((next) => { hotspot = addNextNativeCompleteSentencesHotspot(next, selectedPanel.id, drawItemId); });
    if (!hotspot) return;
    setSelectedHotspotId(hotspot.id);
    setDrawing(false);
    setState((current) => ({ ...current, message: "Centered blank hotspot created and selected." }));
  };
  const updateHotspot = (mutator) =>
    mutatePublic((next) => {
      const hotspot = next.parts[0].interaction.presentation.panels.find((panel) => panel.id === selectedPanelId)?.hotspots.find((entry) => entry.id === selectedHotspotId);
      if (hotspot) mutator(hotspot);
    });
  const updateHotspotArea = (area) => {
    if (!selectedHotspotLocked)
      updateHotspot((hotspot) => {
        hotspot.area = area;
      });
  };
  const deleteHotspot = () => {
    mutatePublic((next) => {
      const panel = next.parts[0].interaction.presentation.panels.find((entry) => entry.id === selectedPanelId);
      panel.hotspots = panel.hotspots.filter((entry) => entry.id !== selectedHotspotId);
    });
    setSelectedHotspotId(null);
  };
  const save = async () => {
    if (compositeBinding) return;
    if (!saveability.saveable || authoringIssues.length || readableIncomplete || videoIncomplete || supplementalAudioIncomplete)
      return setState((current) => ({
        ...current,
        message: "Resolve all authoring issues before saving.",
      }));
    setState((current) => ({ ...current, saving: true, message: "Saving…" }));
    try {
      const value = await saveNativeActivityPair({
        bookSlug,
        componentSlug,
        activityId,
        expectedPublicRevision: state.publicRevision,
        expectedTeacherRevision: state.teacherRevision,
        publicDocument: publicDraft,
        teacherDocument: teacherDraft,
      });
      setPublicDraft(value.publicDocument);
      setTeacherDraft(value.teacherDocument);
      setDirty(false);
      onDirtyChange(false);
      onSaved(value.publicRevision);
      setState({
        kind: "ready",
        publicRevision: value.publicRevision,
        teacherRevision: value.teacherRevision,
        saving: false,
        message: "Draft saved.",
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        saving: false,
        message: error.status === 409 ? "This draft changed elsewhere. Reload before saving." : error.message,
      }));
    }
  };
  if (state.kind === "loading")
    return (
      <section className="native-activity-foundation" role="status">
        Loading native Complete the Sentences…
      </section>
    );
  if (state.kind === "error" || !publicDraft || !teacherDraft)
    return (
      <section className="native-activity-foundation" role="alert">
        {state.message}
      </section>
    );
  const mapped = mappedItemIds;
  const readinessIssues = [...readiness.issues, ...authoringIssues, readableIncomplete ? "Complete the Readable Text setup." : "", videoIncomplete ? "Complete the Video setup." : "", supplementalAudioIncomplete ? "Complete the Supplemental MP3 setup." : ""].filter(Boolean);
  const readyToSave = saveability.saveable && !authoringIssues.length && !readableIncomplete && !videoIncomplete && !supplementalAudioIncomplete;

  return (
    <section className="native-activity-foundation native-single-choice-editor studio-editor">
      <NativeCompleteSentencesEditorHeader activityId={activityId} contentReady={readiness.ready} issueCount={readiness.issues.length} placementLabel={placementLabel} title={publicDraft.metadata.title} />
      <StudioTabWorkspace
        id="native-complete-sentences-tabs"
        value={tab}
        onChange={(value) => {
          setTab(value);
          setDrawing(false);
        }}
        tabs={compositeEditorTabs(compositeBinding, NATIVE_COMPLETE_SENTENCES_TABS)}
        label="Complete the Sentences authoring modes"
      >
        {tab === "content" ? (
          <div className="native-single-choice-back">
            <NativeBulkGenerator kind="complete-sentences" hasExistingContent={items.length > 0} onGenerate={generateBulk} />
            <section className="studio-content-panel">
              <StudioField label="Activity title">
                <input
                  value={publicDraft.metadata.title}
                  maxLength={300}
                  onChange={(event) =>
                    mutatePublic((next) => {
                      next.metadata.title = event.target.value;
                    })
                  }
                />
              </StudioField>
            </section>
            <div className="native-or-question-workspace">
              <NativeCompleteSentencesItemNavigation authoringSentences={authoringSentences} items={items} maximumItems={NATIVE_COMPLETE_SENTENCES_LIMITS.items} onAdd={addItem} onSelect={setSelectedItemId} selectedItemId={selectedItemId} />
              {selectedItem ? (
                <section className="native-or-question-editor">
                  <header>
                    <strong>Sentence {items.indexOf(selectedItem) + 1}</strong>
                    <div>
                      <button type="button" disabled={items.indexOf(selectedItem) === 0} onClick={() => moveItem(-1)}>
                        Move Up
                      </button>
                      <button type="button" disabled={items.indexOf(selectedItem) === items.length - 1} onClick={() => moveItem(1)}>
                        Move Down
                      </button>
                      <button type="button" onClick={removeItem}>
                        Delete
                      </button>
                    </div>
                  </header>
                  <StudioField label="Full sentence with one marked answer">
                    <textarea value={markedSentence} maxLength={NATIVE_COMPLETE_SENTENCES_LIMITS.promptLength + NATIVE_COMPLETE_SENTENCES_LIMITS.answerLength + 2} aria-invalid={!markedSentenceResult?.valid || undefined} aria-describedby={`${selectedItem.id}-marked-help`} onChange={(event) => updateMarkedSentence(event.target.value)} />
                  </StudioField>
                  <p id={`${selectedItem.id}-marked-help`} className={markedSentenceResult?.valid ? "studio-field-help" : "studio-field-error"} role={markedSentenceResult?.valid ? undefined : "alert"}>
                    {markedSentenceResult?.valid ? "The text inside *asterisks* is stored only in the private Teacher answer; students receive an explicit blank." : markedSentenceResult?.error}
                  </p>
                </section>
              ) : (
                <p>Add a sentence to begin.</p>
              )}
            </div>
          </div>
        ) : null}
        {tab === "visual" ? (
          <section className="native-single-choice-back">
            <div className="native-single-choice-visual-authoring">
              <header>
                <div>
                  <h3>Visual blanks</h3>
                  <p>Managed background with one source-pixel hotspot per sentence.</p>
                </div>
              </header>
              <NativeCompleteSentencesHotspotBulkImporter hasExistingHotspots={panels.some((panel) => panel.hotspots.length)} onImport={importHotspots} />
              <div className="studio-visual-workspace">
                <aside className="studio-navigator">
                  <header><div><LayoutPanelTop aria-hidden="true" /><div><h3>Panels</h3><p>Visual pages inside part-1.</p></div></div><span className="studio-count">{panels.length}</span></header>
                  <div className="studio-layer-list">
                    {panels.map((panel, index) => <button type="button" key={panel.id} aria-current={panel.id === selectedPanel?.id ? "true" : undefined} onClick={() => { setSelectedPanelId(panel.id); setSelectedHotspotId(null); setDrawing(false); }}><span><strong>Panel {index + 1}</strong><small>{panel.backgroundAssetSlot ? `${panel.sourceWidth} × ${panel.sourceHeight}` : "Needs background"}</small></span></button>)}
                  </div>
                  <StudioButton onClick={addPanel} disabled={panels.length >= (compositeBinding ? 1 : NATIVE_COMPLETE_SENTENCES_LIMITS.panels)}><Plus aria-hidden="true" />Add Panel</StudioButton>
                  {selectedPanel ? <>
                    <StudioButton onClick={() => movePanel(-1)} disabled={panels.indexOf(selectedPanel) === 0}>Move Up</StudioButton>
                    <StudioButton onClick={() => movePanel(1)} disabled={panels.indexOf(selectedPanel) === panels.length - 1}>Move Down</StudioButton>
                    <StudioButton variant="danger-ghost" onClick={deletePanel} disabled={panels.length <= 1}><Trash2 aria-hidden="true" />Delete Panel</StudioButton>
                  </> : null}
                </aside>
                <section className="studio-canvas-column">
                  <StudioCanvasToolbar zoom={zoom} onZoomChange={setZoom} />
                  <div className="studio-canvas-viewport">
                    <div className="studio-artboard-wrap" style={{ width: `${zoom * 100}%` }}>
                      {selectedPanel ? <NativeCompleteSentencesHotspotCanvas
                        presentation={selectedPanel}
                        assetUrl={backgroundReference ? assetUrl(backgroundReference.assetId) : ""}
                        items={items}
                        selectedHotspotId={selectedHotspotId}
                        locked={selectedHotspotLocked}
                        onSelect={(id) => {
                          setSelectedHotspotId(id);
                          setDrawing(false);
                        }}
                        onCreate={createHotspot}
                        onChange={updateHotspotArea}
                        onDelete={deleteHotspot}
                        drawingEnabled={drawing}
                      /> : <p>Select a panel.</p>}
                    </div>
                  </div>
                </section>
                <aside className="studio-inspector">
                  <header><span className="studio-section-icon"><ImagePlus aria-hidden="true" /></span><div><h3>{selectedHotspot ? "Hotspot properties" : "Panel properties"}</h3><p>{selectedPanel ? `Panel ${panels.indexOf(selectedPanel) + 1}` : "Select a panel."}</p></div></header>
                  {selectedPanel ? <>
                  <StudioField label="Sentence to map">
                    <select
                      value={drawItemId}
                      onChange={(event) => {
                        setDrawItemId(event.target.value);
                        setDrawing(false);
                      }}
                    >
                      <option value="">Choose a sentence</option>
                      {items.map((item, index) => (
                        <option key={item.id} value={item.id} disabled={mapped.has(item.id) && selectedHotspot?.itemId !== item.id}>
                          Sentence {index + 1}: {item.prompt || "Untitled"}
                        </option>
                      ))}
                    </select>
                  </StudioField>
                  <StudioButton variant="primary" disabled={!nextDrawItemId || !backgroundReference} reason={!backgroundReference ? "Upload a background first" : !nextDrawItemId ? "Every sentence already has a hotspot" : ""} onClick={createDefaultHotspot}>
                    New hotspot
                  </StudioButton>
                  <StudioButton selected={drawing} disabled={!drawItemId || !backgroundReference || Boolean(selectedHotspot) || mapped.has(drawItemId)} onClick={() => setDrawing((current) => !current)}>{drawing ? "Cancel custom drawing" : "Draw custom hotspot"}</StudioButton>
                  {selectedHotspot ? (
                    <>
                      <StudioField label="Hotspot binding">
                        <select
                          value={selectedHotspot.itemId}
                          onChange={(event) =>
                            updateHotspot((hotspot) => {
                              hotspot.itemId = event.target.value;
                            })
                          }
                        >
                          {items.map((item, index) => (
                            <option key={item.id} value={item.id} disabled={mapped.has(item.id) && item.id !== selectedHotspot.itemId}>
                              Sentence {index + 1}
                            </option>
                          ))}
                        </select>
                      </StudioField>
                      <label className="studio-quick-check">
                        <input
                          type="checkbox"
                          checked={selectedHotspotLocked}
                          onChange={(event) =>
                            setLockedHotspotIds((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(selectedHotspot.id);
                              else next.delete(selectedHotspot.id);
                              return next;
                            })
                          }
                        />
                        Lock hotspot position
                      </label>
                      <StageGeometryControls area={selectedHotspot.area} stage={{ width: selectedPanel.sourceWidth, height: selectedPanel.sourceHeight }} label="Complete Sentences hotspot" minWidth={4} minHeight={4} locked={selectedHotspotLocked} onChange={updateHotspotArea} />
                      <StudioButton variant="danger-ghost" onClick={deleteHotspot}>
                        <Trash2 />
                        Delete Hotspot
                      </StudioButton>
                    </>
                  ) : <p>Draw or select a hotspot to style its answer.</p>}
                  <fieldset className="studio-content-panel native-complete-sentences-answer-style">
                    <legend>Activity-wide answer style</legend>
                    <p>Applied to every Student answer and Teacher revealed answer on every panel.</p>
                    <QuickNumber
                      label="Answer font size"
                      value={answerStyle.fontSize}
                      minimum={NATIVE_COMPLETE_SENTENCES_LIMITS.fontSizeMinimum}
                      onChange={(value) => mutatePublic((next) => { const fontSize = Math.round(Number(value)); if (Number.isFinite(fontSize) && fontSize >= NATIVE_COMPLETE_SENTENCES_LIMITS.fontSizeMinimum) next.parts[0].interaction.presentation.answerStyle.fontSize = fontSize; })}
                    />
                    <NativeCompleteSentencesFontControls
                      bookSlug={bookSlug}
                      componentSlug={componentSlug}
                      fonts={fonts}
                      selectedSlot={answerStyle.fontAssetSlot}
                      onSelect={setAnswerFont}
                      onUploaded={recordUploadedFont}
                      onMessage={(message) => setState((current) => ({ ...current, message }))}
                    />
                    <StudioField label="Answer text color" className="studio-quick-field">
                      <input aria-label="Answer text color" type="color" value={answerStyle.color} onChange={(event) => mutatePublic((next) => { next.parts[0].interaction.presentation.answerStyle.color = event.target.value; })} />
                    </StudioField>
                  </fieldset>
                  <label className="studio-upload-action">
                    <Upload />
                    <span>
                      <strong>{uploading ? "Uploading…" : backgroundReference ? "Replace background" : "Upload background"}</strong>
                      <small>PNG, JPEG or WebP</small>
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={uploading || compositeBinding?.sharedCanvas}
                      onChange={(event) => {
                        uploadBackground(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  </> : <p>Select or add a panel.</p>}
                </aside>
              </div>
            </div>
          </section>
        ) : null}
        {tab === "answer-key" ? (
          <div className="native-single-choice-back">
            <section className="studio-content-panel">
              <header>
                <div>
                  <span className="studio-section-icon">
                    <KeyRound />
                  </span>
                  <div>
                    <h3>Private answer key</h3>
                    <p>Teacher-only answers remain outside the public activity document.</p>
                  </div>
                </div>
              </header>
            </section>
            <div className="native-or-question-workspace">
              <NativeCompleteSentencesItemNavigation authoringSentences={authoringSentences} items={items} maximumItems={NATIVE_COMPLETE_SENTENCES_LIMITS.items} onAdd={addItem} onSelect={setSelectedItemId} selectedItemId={selectedItemId} />
              {selectedItem ? (
                <section className="native-or-question-editor">
                  <strong>Sentence {items.indexOf(selectedItem) + 1}</strong>
                  <p>{selectedItem.prompt}</p>
                  <label><input type="checkbox" checked={interaction.evaluationMode === NATIVE_COMPLETE_SENTENCES_EXACT_EVALUATION_MODE} onChange={(event) => mutatePublic((next) => { if (event.target.checked) next.parts[0].interaction.evaluationMode = NATIVE_COMPLETE_SENTENCES_EXACT_EVALUATION_MODE; else delete next.parts[0].interaction.evaluationMode; })} /> Exact-answer evaluation</label>
                  <StudioField label="Teacher display text">
                    <input value={selectedAnswer?.text || ""} maxLength={NATIVE_COMPLETE_SENTENCES_LIMITS.answerLength} onChange={(event) => updateAnswer(event.target.value)} />
                  </StudioField>
                  <fieldset><legend>Accepted typed answers</legend>{acceptedTexts.map((acceptedText, index) => <div className="native-complete-accepted-answer" key={index}><input aria-label={`Accepted answer ${index + 1}`} value={acceptedText} maxLength={NATIVE_COMPLETE_SENTENCES_LIMITS.answerLength} onChange={(event) => updateAcceptedText(index, event.target.value)} /><button type="button" aria-label={`Move accepted answer ${index + 1} up`} disabled={!index} onClick={() => moveAcceptedText(index, -1)}>↑</button><button type="button" aria-label={`Move accepted answer ${index + 1} down`} disabled={index === acceptedTexts.length - 1} onClick={() => moveAcceptedText(index, 1)}>↓</button><button type="button" disabled={acceptedTexts.length <= 1} onClick={() => removeAcceptedText(index)}>Remove</button></div>)}</fieldset>
                  <StudioButton disabled={acceptedTexts.length >= NATIVE_COMPLETE_SENTENCES_LIMITS.acceptedTextMaximum} onClick={addAcceptedText}><Plus aria-hidden="true" />Add accepted answer</StudioButton>
                </section>
              ) : (
                <p>Add a sentence to begin.</p>
              )}
            </div>
          </div>
        ) : null}
        {tab === "readable-text" ? <NativeReadableTextEditor bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} publicDraft={publicDraft} mutatePublic={mutatePublic} previewUrl={assetUrl} onIncompleteChange={setReadableIncomplete} onIntentChange={changed} onStatusChange={(message) => setState((current) => ({ ...current, message }))} /> : null}
        {tab === "video" ? <NativeVideoEditor bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} publicDraft={publicDraft} mutatePublic={mutatePublic} onIncompleteChange={setVideoIncomplete} onIntentChange={changed} onStatusChange={(message) => setState((current) => ({ ...current, message }))} /> : null}
        {tab === "supplemental-audio" ? <NativeSupplementalAudioEditor bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} publicDraft={publicDraft} mutatePublic={mutatePublic} previewUrl={assetUrl} onIncompleteChange={setSupplementalAudioIncomplete} onIntentChange={changed} onStatusChange={(message) => setState((current) => ({ ...current, message }))} /> : null}
        {tab === "preview" ? (
          <div className="studio-preview-panel">
            <header>
              <Eye />
              <div>
                <h3>Local Preview</h3>
                <p>Preview includes the current unsaved draft. Review remains pinned to saved state.</p>
              </div>
            </header>
            <div className="native-or-preview-toggle">
              <button type="button" aria-pressed={preview === "student"} onClick={() => setPreview("student")}>
                Student Preview
              </button>
              <button type="button" aria-pressed={preview === "teacher"} onClick={() => setPreview("teacher")}>
                Teacher Preview
              </button>
            </div>
            <NativeReadableTextPresentation document={publicDraft} assetUrl={previewAssetUrl}>{(presentation, audioHotspotPresentation) => preview === "student" ? <NativeCompleteSentencesStudentSurface document={publicDraft} assetUrl={previewAssetUrl} presentation={presentation} audioHotspotPresentation={audioHotspotPresentation} /> : <NativeCompleteSentencesTeacherSurface publicDocument={publicDraft} teacherDocument={teacherDraft} assetUrl={previewAssetUrl} presentation={presentation} audioHotspotPresentation={audioHotspotPresentation} />}</NativeReadableTextPresentation>
          </div>
        ) : null}
      </StudioTabWorkspace>
      <StudioSaveBar hidden={Boolean(compositeBinding)} dirty={dirty} saving={state.saving} message={state.message} ready={readyToSave} issues={readinessIssues} disabled={!dirty || state.saving || !readyToSave} reason={!dirty ? "No unsaved changes" : !readyToSave ? "Resolve all authoring issues before saving" : ""} onSave={save} />
    </section>
  );
}
