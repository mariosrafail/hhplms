import { NativeOldschoolQuestionEditor } from "./NativeOldschoolQuestionEditor.jsx";
import { useEffect, useMemo, useState } from "react";
import { StudioField, StudioSaveBar, StudioTabWorkspace } from "../../../components/builder-studio/StudioControls.jsx";
import { NativeListeningStudentSurface, NativeListeningTeacherSurface } from "../../../components/native-listening/NativeListeningSurface.jsx";
import { NativeReadableTextPresentation } from "../../../components/native-readable-text/NativeReadableTextPresentation.jsx";
import { formatNativeListeningTime, parseNativeListeningDisplayTime, parseNativeListeningSrt } from "../../../components/native-listening/nativeListeningRuntime.js";
import { NativeOldschoolListeningStudentSurface } from "../../../components/native-oldschool-listening/NativeOldschoolListeningStudentSurface.jsx";
import { NativeOldschoolListeningTeacherSurface } from "../../../components/native-oldschool-listening/NativeOldschoolListeningTeacherSurface.jsx";
import { parseNativeOldschoolListeningSrt } from "../../../components/native-oldschool-listening/nativeOldschoolListeningRuntime.js";
import { createNativeChildId } from "../../../data/native-activities/nativeChildIdentity.js";
import { mergeNativeManagedAssetReference, removeNativeManagedAssetReferenceIfUnused } from "../../../data/native-activities/nativeActivityPublic.js";
import { assessNativeListeningReadiness, initialNativeListeningArtworkArea } from "../../../data/native-activities/nativeListening.js";
import { assessNativeOldschoolListeningReadiness, initialNativeOldschoolListeningArtworkArea } from "../../../data/native-activities/nativeOldschoolListening.js";
import { clearNativeOldschoolListeningMappings } from "../../../data/native-activities/nativeOldschoolListeningAuthoring.js";
import { removeNativeOpenResponseArtwork, resizeNativeOpenResponseRegion } from "../../../data/native-activities/nativeOpenResponse.js";
import { getBuilderContent } from "./builderContentApi.js";
import { nativeFontPreviewUrl, saveNativeActivityPair, uploadNativeActivityArtwork, uploadNativeActivityAsset } from "./builderNativeActivityApi.js";
import { projectNativeActivityPublicForAuthoring } from "./nativeActivityAuthoringProjection.js";
import { NativeReadableTextEditor } from "./NativeReadableTextEditor.jsx";
import { NativeSupplementalAudioEditor } from "./NativeSupplementalAudioEditor.jsx";
import { NativeListeningQuestionAuthoring } from "./NativeListeningQuestionAuthoring.jsx";
import { NativeSingleChoiceQuestionAuthoring } from "./NativeSingleChoiceQuestionAuthoring.jsx";
import { NativeSingleChoiceVisualAuthoring } from "./NativeSingleChoiceVisualAuthoring.jsx";
import { NativeListeningTranscriptAuthoring } from "./NativeListeningTranscriptAuthoring.jsx";
import { NativeOldschoolListeningPageMappingAuthoring, NativeOldschoolListeningTimelineAuthoring } from "./NativeOldschoolListeningAuthoring.jsx";
import { NativeVideoEditor } from "./NativeVideoEditor.jsx";
import { createOldschoolJsonActions, createOldschoolMappingActions, nativeListeningEditorTabs, nativeListeningMediaDuration, nativeListeningPreviewRoot, nativeOldschoolListeningEditorTabs, replaceNativeListeningAsset } from "./nativeListeningEditorSupport.js";
import { useNativeListeningQuestionAuthoring } from "./useNativeListeningQuestionAuthoring.js";
const clone = (value) => structuredClone(value);
export function NativeListeningEditor({ bookSlug, componentSlug, activityId, placementLabel, onDirtyChange = () => {}, onSaved = () => {}, activityKind = "listening" }) {
  const oldschool = activityKind === "oldschool-listening";
  const [state, setState] = useState({
    kind: "loading",
    publicRevision: 0,
    teacherRevision: 0,
    saving: false,
    message: "",
  });
  const [publicDraft, setPublicDraft] = useState(null);
  const [teacherDraft, setTeacherDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState("content");
  const [preview, setPreview] = useState("author");
  const [selectedQuestionId, setSelectedQuestionId] = useState(null);
  const [questionSelection, setQuestionSelection] = useState(null);
  const [selectedCueId, setSelectedCueId] = useState(null);
  const [selectedSnippetId, setSelectedSnippetId] = useState(null);
  const [selectedRegionId, setSelectedRegionId] = useState(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [questionBusy, setQuestionBusy] = useState(false);
  const [questionError, setQuestionError] = useState("");
  const [uploading, setUploading] = useState("");
  const [readableTextIncomplete, setReadableTextIncomplete] = useState(false);
  const [videoIncomplete, setVideoIncomplete] = useState(false);
  const [supplementalAudioIncomplete, setSupplementalAudioIncomplete] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setState({
      kind: "loading",
      publicRevision: 0,
      teacherRevision: 0,
      saving: false,
      message: "",
    });
    setPublicDraft(null);
    setTeacherDraft(null);
    setTab("content");
    setDirty(false);
    onDirtyChange(false);
    Promise.all([
      getBuilderContent(
        {
          bookSlug,
          componentSlug,
          resource: "native-activity-public",
          documentKey: activityId,
        },
        { signal: controller.signal },
      ),
      getBuilderContent(
        {
          bookSlug,
          componentSlug,
          resource: "native-activity-teacher",
          documentKey: activityId,
        },
        { signal: controller.signal },
      ),
    ])
      .then(([publicValue, teacherValue]) => {
        if (controller.signal.aborted) return;
        setPublicDraft(projectNativeActivityPublicForAuthoring(publicValue.document));
        setTeacherDraft(teacherValue.document);
        setState({
          kind: "ready",
          publicRevision: publicValue.revision,
          teacherRevision: teacherValue.revision,
          saving: false,
          message: "Saved draft",
        });
        setSelectedQuestionId(publicValue.document.parts[0].interaction.questions?.[0]?.id || null);
        setSelectedCueId(publicValue.document.parts[0].interaction.cues[0]?.id || null);
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
  const questions = interaction?.questions || [];
  const cues = interaction?.cues || [];
  const snippets = interaction?.snippetHotspots || [];
  const selectedQuestion = questions.find((entry) => entry.id === selectedQuestionId) || null;
  const selectedArtwork = questionSelection?.type === "artwork" ? interaction?.artwork?.find((entry) => entry.id === questionSelection.id) || null : null;
  const selectedCue = cues.find((entry) => entry.id === selectedCueId) || null;
  const selectedSnippet = snippets.find((entry) => entry.id === selectedSnippetId) || null;
  const readiness = useMemo(() => (publicDraft && teacherDraft ? (oldschool ? assessNativeOldschoolListeningReadiness(publicDraft, teacherDraft) : assessNativeListeningReadiness(publicDraft, teacherDraft)) : null), [oldschool, publicDraft, teacherDraft]);
  const assetUrl = (assetId) => nativeListeningPreviewRoot(bookSlug, componentSlug, activityId, assetId);
  const previewAssetUrl = (assetId) => publicDraft?.assets.find((asset) => asset.assetId === assetId)?.role === "activity_font" ? nativeFontPreviewUrl(bookSlug, componentSlug, assetId) : assetUrl(assetId);
  const questionAuthoring = useNativeListeningQuestionAuthoring({ oldschool, publicDraft, teacherDraft, setPublicDraft, setTeacherDraft, mutatePublic, mutatePair, changed, interaction, questions, selectedQuestion, selectedQuestionId, setSelectedQuestionId, setQuestionSelection, bookSlug, componentSlug, activityId, uploading, setUploading, setState, previewAssetUrl });
  const { questionMode, addQuestion, removeQuestion, moveQuestion, switchQuestionMode, generateBulk: generateQuestionBulk, questionProps: singleChoiceQuestionProps, visualProps: singleChoiceVisualProps } = questionAuthoring;
  const audioReference = publicDraft?.assets.find((asset) => asset.slot === interaction?.audioAssetSlot);
  const backgroundReference = publicDraft?.assets.find((asset) => asset.slot === interaction?.panels[1].backgroundAssetSlot);
  const pageReference = publicDraft?.assets.find((asset) => asset.slot === interaction?.panels[1].pageAssetSlot);
  const selectedSnippetAudioReference = publicDraft?.assets.find((asset) => asset.slot === selectedSnippet?.audioAssetSlot) || null;
  const addCue = () => {
    const id = createNativeChildId("cue");
    const startMs = cues.at(-1)?.endMs || 0;
    mutatePublic((next) =>
      next.parts[0].interaction.cues.push({
        id,
        startMs,
        endMs: startMs + 1_000,
        text: oldschool ? "New listening cue" : "New transcript cue",
        ...(oldschool ? { highlightRegions: [], scrollY: null } : {}),
      }),
    );
    setSelectedCueId(id);
  };
  const removeCue = () => {
    if (!selectedCue) return;
    const index = cues.indexOf(selectedCue);
    mutatePublic((next) => {
      next.parts[0].interaction.cues = next.parts[0].interaction.cues.filter((entry) => entry.id !== selectedCue.id);
      const previousHotspots = next.parts[0].interaction.snippetHotspots;
      next.parts[0].interaction.snippetHotspots = previousHotspots
        .map((hotspot) => ({
          ...hotspot,
          cueIds: hotspot.cueIds.filter((id) => id !== selectedCue.id),
        }))
        .filter((hotspot) => hotspot.cueIds.length);
      previousHotspots
        .map((hotspot) => hotspot.audioAssetSlot)
        .filter(Boolean)
        .forEach((slot) => removeNativeManagedAssetReferenceIfUnused(next, slot));
    });
    setSelectedCueId(cues[index + 1]?.id || cues[index - 1]?.id || null);
  };
  const moveCue = (offset) =>
    mutatePublic((next) => {
      const list = next.parts[0].interaction.cues;
      const index = list.findIndex((entry) => entry.id === selectedCueId);
      const target = index + offset;
      if (target >= 0 && target < list.length) [list[index], list[target]] = [list[target], list[index]];
    });
  const setCueTime = (key, value) => {
    try {
      if (typeof value !== "number" && selectedCue && String(value).trim() === formatNativeListeningTime(selectedCue[key])) return;
      const milliseconds = typeof value === "number" ? value : parseNativeListeningDisplayTime(value);
      mutatePublic((next) => {
        next.parts[0].interaction.cues.find((entry) => entry.id === selectedCueId)[key] = milliseconds;
      });
    } catch (error) {
      setState((current) => ({ ...current, message: error.message }));
    }
  };
  const importSrt = async (file) => {
    if (!file) return;
    if (oldschool && cues.some((cue) => cue.highlightRegions.length) && !globalThis.confirm("Importing this SRT replaces every cue and clears all existing page mappings. Continue?")) return;
    try {
      const imported = (oldschool ? parseNativeOldschoolListeningSrt : parseNativeListeningSrt)(await file.text(), {
        createId: () => createNativeChildId("cue"),
      });
      mutatePublic((next) => {
        const audioSlots = next.parts[0].interaction.snippetHotspots.map((hotspot) => hotspot.audioAssetSlot).filter(Boolean);
        next.parts[0].interaction.cues = imported;
        next.parts[0].interaction.snippetHotspots = [];
        audioSlots.forEach((slot) => removeNativeManagedAssetReferenceIfUnused(next, slot));
      });
      setSelectedCueId(imported[0]?.id || null);
      setSelectedSnippetId(null);
      setState((current) => ({
        ...current,
        message: `${imported.length} SRT cues imported${oldschool ? "; page mappings are intentionally empty" : ""}.`,
      }));
    } catch (error) {
      setState((current) => ({ ...current, message: error.message }));
    }
  };
  const uploadAudio = async (file) => {
    if (!file) return;
    setUploading("audio");
    try {
      const durationMs = await nativeListeningMediaDuration(file);
      const uploaded = await uploadNativeActivityAsset({
        bookSlug,
        componentSlug,
        activityId,
        assetSlot: createNativeChildId("asset"),
        file,
      });
      mutatePublic((next) => {
        const current = next.parts[0].interaction;
        const previousSlot = current.audioAssetSlot;
        replaceNativeListeningAsset(next, uploaded, previousSlot);
        current.audioAssetSlot = uploaded.reference.slot;
        current.audioDurationMs = durationMs;
        if (previousSlot) removeNativeManagedAssetReferenceIfUnused(next, previousSlot);
      });
      setState((current) => ({
        ...current,
        message: cues.some((cue) => cue.endMs > durationMs) ? "MP3 replaced; existing cues exceed its duration and must be corrected." : `${oldschool ? "Oldschool Listening" : "Listening"} MP3 uploaded.`,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        message: error.message || "MP3 upload failed.",
      }));
    } finally {
      setUploading("");
    }
  };
  const uploadBackground = async (file) => {
    if (!file) return;
    setUploading("background");
    try {
      const uploaded = await uploadNativeActivityAsset({
        bookSlug,
        componentSlug,
        activityId,
        assetSlot: createNativeChildId("asset"),
        file,
      });
      if (!uploaded.metadata?.width || !uploaded.metadata?.height) throw new Error("Background dimensions are unavailable.");
      mutatePublic((next) => {
        const panelTwo = next.parts[0].interaction.panels[1];
        const previousSlot = panelTwo.backgroundAssetSlot;
        replaceNativeListeningAsset(next, uploaded, previousSlot);
        panelTwo.backgroundAssetSlot = uploaded.reference.slot;
        panelTwo.sourceWidth = uploaded.metadata.width;
        panelTwo.sourceHeight = uploaded.metadata.height;
        panelTwo.transcriptArea = {
          x: Math.round(uploaded.metadata.width * 0.08),
          y: Math.round(uploaded.metadata.height * 0.08),
          width: Math.round(uploaded.metadata.width * 0.84),
          height: Math.round(uploaded.metadata.height * 0.84),
        };
        if (previousSlot) removeNativeManagedAssetReferenceIfUnused(next, previousSlot);
      });
      setState((current) => ({
        ...current,
        message: "Background uploaded; transcript region reset for its intrinsic dimensions.",
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        message: error.message || "Background upload failed.",
      }));
    } finally {
      setUploading("");
    }
  };
  const { exportJson: exportOldschoolJson, importJson: importOldschoolJson } = createOldschoolJsonActions({ activityId, interaction, assets: publicDraft?.assets || [], cues, mutatePublic, setSelectedCueId, setSelectedRegionId, setMessage: (message) => setState((current) => ({ ...current, message })) });
  const uploadPage = async (file) => {
    if (!file) return;
    const hasMappings = cues.some((cue) => cue.highlightRegions.length || cue.scrollY !== null);
    if (hasMappings && !globalThis.confirm("Replacing the page image changes its source-pixel coordinate system and clears every cue mapping. Continue?")) return;
    setUploading("page");
    try {
      const uploaded = await uploadNativeActivityAsset({ bookSlug, componentSlug, activityId, assetSlot: createNativeChildId("asset"), file });
      if (!uploaded.metadata?.width || !uploaded.metadata?.height) throw new Error("Page image dimensions are unavailable.");
      mutatePublic((next) => {
        const current = next.parts[0].interaction; const panel = current.panels[1]; const previousSlot = panel.pageAssetSlot;
        replaceNativeListeningAsset(next, uploaded, previousSlot);
        panel.pageAssetSlot = uploaded.reference.slot;
        panel.sourceWidth = uploaded.metadata.width;
        panel.sourceHeight = uploaded.metadata.height;
        clearNativeOldschoolListeningMappings(current);
        if (previousSlot) removeNativeManagedAssetReferenceIfUnused(next, previousSlot);
      });
      setSelectedRegionId(null);
      setState((current) => ({ ...current, message: hasMappings ? "Page image replaced; all cue mappings were explicitly cleared." : "Page image uploaded at its intrinsic dimensions." }));
    } catch (error) {
      setState((current) => ({ ...current, message: error.message || "Page image upload failed." }));
    } finally { setUploading(""); }
  };
  const uploadSnippetAudio = async (file) => {
    if (!file || !selectedSnippet) return;
    setUploading("snippet-audio");
    try {
      const uploaded = await uploadNativeActivityAsset({
        bookSlug,
        componentSlug,
        activityId,
        assetSlot: createNativeChildId("asset"),
        file,
      });
      mutatePublic((next) => {
        const hotspot = next.parts[0].interaction.snippetHotspots.find((entry) => entry.id === selectedSnippet.id);
        const previousSlot = hotspot.audioAssetSlot;
        next.assets = mergeNativeManagedAssetReference(next.assets, uploaded.reference);
        hotspot.audioAssetSlot = uploaded.reference.slot;
        if (previousSlot) removeNativeManagedAssetReferenceIfUnused(next, previousSlot);
      });
      setState((current) => ({ ...current, message: "Hotspot MP3 assigned." }));
    } catch (error) {
      setState((current) => ({
        ...current,
        message: error.message || "Hotspot MP3 upload failed.",
      }));
    } finally {
      setUploading("");
    }
  };
  const removeSnippetAudio = () => {
    if (!selectedSnippet?.audioAssetSlot) return;
    mutatePublic((next) => {
      const hotspot = next.parts[0].interaction.snippetHotspots.find((entry) => entry.id === selectedSnippet.id);
      const previousSlot = hotspot.audioAssetSlot;
      hotspot.audioAssetSlot = "";
      removeNativeManagedAssetReferenceIfUnused(next, previousSlot);
    });
  };
  const uploadArtwork = async (file) => {
    if (!file) return;
    setUploading("artwork");
    try {
      const uploaded = await uploadNativeActivityArtwork({
        bookSlug,
        componentSlug,
        activityId,
        assetSlot: createNativeChildId("asset"),
        file,
      });
      const artworkId = createNativeChildId("art");
      mutatePublic((next) => {
        next.assets = mergeNativeManagedAssetReference(next.assets, uploaded.reference);
        const current = next.parts[0].interaction;
        current.artwork.push({
          id: artworkId,
          assetSlot: uploaded.reference.slot,
          area: (oldschool ? initialNativeOldschoolListeningArtworkArea : initialNativeListeningArtworkArea)(
            {
              width: current.panels[0].sourceWidth,
              height: current.panels[0].sourceHeight,
            },
            uploaded.metadata,
            current.artwork.length,
          ),
          order: current.artwork.length,
          altText: "",
          decorative: false,
          fit: "contain",
          locked: false,
        });
      });
      setQuestionSelection({ type: "artwork", id: artworkId });
      setState((current) => ({
        ...current,
        message: "Question artwork uploaded; add alt text or mark it decorative.",
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        message: error.message || "Artwork upload failed.",
      }));
    } finally {
      setUploading("");
    }
  };
  const removeArtwork = () => {
    if (!selectedArtwork || !globalThis.confirm("Remove this artwork from the Listening question surface?")) return;
    mutatePublic((next) => removeNativeOpenResponseArtwork(next, selectedArtwork.id));
    setQuestionSelection(null);
  };
  const questionSurface = {
    width: interaction?.panels[0].sourceWidth || 1024,
    height: interaction?.panels[0].sourceHeight || 582,
  };
  const selectedArea = (() => {
    if (!questionSelection) return null;
    if (questionSelection.type === "artwork") return interaction.artwork.find((entry) => entry.id === questionSelection.id)?.area || null;
    if (questionSelection.type === "snippet") return snippets.find((entry) => entry.id === questionSelection.id)?.area || null;
    const question = questions.find((entry) => entry.id === questionSelection.id);
    return questionSelection.type === "prompt" ? question?.promptArea : question?.responseRegion.area;
  })();
  const commitQuestionArea = (geometry) =>
    mutatePublic((next) => {
      const current = next.parts[0].interaction;
      if (questionSelection.type === "artwork") current.artwork.find((entry) => entry.id === questionSelection.id).area = geometry;
      else if (questionSelection.type === "snippet") current.snippetHotspots.find((entry) => entry.id === questionSelection.id).area = Object.fromEntries(Object.entries(geometry).map(([key, value]) => [key, Math.round(value)]));
      else {
        const question = current.questions.find((entry) => entry.id === questionSelection.id);
        if (questionSelection.type === "prompt") question.promptArea = geometry;
        else resizeNativeOpenResponseRegion(question.responseRegion, geometry);
      }
    });

  const addSnippet = () => {
    if (!cues.length) return;
    const id = createNativeChildId("aud");
    mutatePublic((next) => {
      const current = next.parts[0].interaction;
      const index = current.snippetHotspots.length;
      current.snippetHotspots.push({
        id,
        area: {
          x: Math.max(0, current.panels[0].sourceWidth - 144 - (index % 4) * 56),
          y: 36 + Math.floor(index / 4) * 58,
          width: 48,
          height: 48,
        },
        cueIds: [current.cues[0].id],
        label: `Transcript excerpt ${index + 1}`,
        audioAssetSlot: "",
      });
    });
    setSelectedSnippetId(id);
    setQuestionSelection({ type: "snippet", id });
  };
  const removeSnippet = () => {
    if (!selectedSnippet) return;
    mutatePublic((next) => {
      const removed = next.parts[0].interaction.snippetHotspots.find((entry) => entry.id === selectedSnippet.id);
      next.parts[0].interaction.snippetHotspots = next.parts[0].interaction.snippetHotspots.filter((entry) => entry.id !== selectedSnippet.id);
      if (removed?.audioAssetSlot) removeNativeManagedAssetReferenceIfUnused(next, removed.audioAssetSlot);
    });
    setSelectedSnippetId(null);
    setQuestionSelection(null);
  };
  const { addRegion: addPageRegion, updateRegion: updatePageRegion, removeRegion: removePageRegion, clearMappings: clearPageMappings, clearCueMappings: clearSelectedCueMappings } = createOldschoolMappingActions({ selectedCue, selectedRegionId, mutatePublic, setSelectedRegionId });
  const save = async () => {
    if (oldschool && (uploading || questionBusy || questionError)) return;
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
      const conflict = error?.status === 409 || /conflict|revision/i.test(String(error?.message || ""));
      setState((current) => ({
        ...current,
        saving: false,
        message: conflict ? "Save conflict: this activity changed elsewhere. Reload the activity, review the newer revision, and reapply your edits." : error.message || "Save failed.",
      }));
    }
  };

  if (state.kind === "loading")
    return (
      <section className="native-activity-foundation" role="status">
        Loading {oldschool ? "Oldschool Listening" : "Listening"} draft…
      </section>
    );
  if (state.kind === "error" || !publicDraft || !teacherDraft)
    return (
      <section className="native-activity-foundation" role="alert">
        {state.message}
      </section>
    );
  const panelTwo = interaction.panels[1];
  const transcriptSurface = { width: panelTwo.sourceWidth, height: panelTwo.sourceHeight };
  const commitTranscriptArea = (geometry) =>
    mutatePublic((next) => {
      next.parts[0].interaction.panels[1].transcriptArea = Object.fromEntries(Object.entries(geometry).map(([key, value]) => [key, Math.round(value)]));
    });
  const readinessIssues = [...readiness.issues, questionError, readableTextIncomplete ? "Upload a readable-text image." : "", videoIncomplete ? "Upload one MP4 and one valid SRT subtitle file." : "", !oldschool && supplementalAudioIncomplete ? "Complete the Supplemental MP3 setup." : ""].filter(Boolean);
  const readyToSave = readiness.ready && !questionBusy && !questionError && !readableTextIncomplete && !videoIncomplete && (oldschool || !supplementalAudioIncomplete);
  return (
    <section className={`native-activity-foundation native-listening-editor ${oldschool ? "native-oldschool-listening-editor" : ""} studio-editor studio-open-response`}>
      <header className="studio-editor-header">
        <div>
          <span className="studio-eyebrow">{placementLabel} · {oldschool ? "Oldschool Listening" : "Listening"}</span>
          <h2>{publicDraft.metadata.title}</h2>
          <p>{readiness.ready ? "Content complete" : `${readiness.issues.length} items need attention`}</p>
        </div>
        <details className="builder-technical-details">
          <summary>Technical details</summary>
          <code>{activityId}</code>
        </details>
      </header>
      <StudioTabWorkspace id={oldschool ? "native-oldschool-listening-tabs" : "native-listening-tabs"} value={tab} onChange={setTab} tabs={oldschool ? nativeOldschoolListeningEditorTabs : nativeListeningEditorTabs} label={`${oldschool ? "Oldschool Listening" : "Listening"} authoring modes`}>
        {tab === "content" ? (
          <section className="studio-content-panel">
            <div className="studio-form-grid">
              {oldschool ? <StudioField label="Panel 1 activity type"><select aria-label="Panel 1 activity type" disabled={questionBusy || Boolean(uploading)} value={questionMode} onChange={(event) => switchQuestionMode(event.target.value)}><option value="open-response">Open Response</option><option value="single-choice">Multiple Choice</option><option value="drag-drop">Drag &amp; Drop</option></select></StudioField> : null}
              <StudioField label="Activity title">
                <input
                  value={publicDraft.metadata.title}
                  maxLength="300"
                  onChange={(event) =>
                    mutatePublic((next) => {
                      next.metadata.title = event.target.value;
                    })
                  }
                />
              </StudioField>
            </div>
          </section>
        ) : null}
        {!oldschool && ["content", "visual", "answer-key"].includes(tab) && questionMode === "open-response" ? (
          <NativeListeningQuestionAuthoring
            mode={tab}
            {...{
              publicDraft,
              teacherDraft,
              interaction,
              questions,
              cues,
              snippets,
              selectedQuestion,
              selectedArtwork,
              selectedSnippet,
              selectedSnippetAudioReference,
              selection: questionSelection,
              selectedArea,
              surface: questionSurface,
              assetUrl: previewAssetUrl,
              uploading,
              setUploading,
              setSelectedQuestionId,
              setSelectedSnippetId,
              setSelection: setQuestionSelection,
              mutatePublic,
              mutateTeacher,
              addQuestion,
              removeQuestion,
              moveQuestion,
              uploadArtwork,
              uploadSnippetAudio,
              removeSnippetAudio,
              addSnippet,
              removeSnippet,
              removeArtwork,
              commitArea: commitQuestionArea,
              bookSlug,
              componentSlug,
              onMessage: (message) => setState((current) => ({ ...current, message })),
              generateBulk: generateQuestionBulk,
            }}
          />
        ) : null}
        {oldschool && questionMode !== "single-choice" ? <div hidden={!["content", "visual", "answer-key"].includes(tab)}><NativeOldschoolQuestionEditor authoringTab={tab} key={`${activityId}:${questionMode}`} publicDocument={publicDraft} teacherDocument={teacherDraft} mutatePair={mutatePair} onBusyChange={setQuestionBusy} onStatusChange={setQuestionError} onMessage={(message) => setState((current) => ({ ...current, message }))} bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} placementLabel="Panel 1" /></div> : null}
        {["content", "answer-key"].includes(tab) && questionMode === "single-choice" ? <NativeSingleChoiceQuestionAuthoring {...singleChoiceQuestionProps} mode={tab} /> : null}
        {tab === "visual" && questionMode === "single-choice" ? <NativeSingleChoiceVisualAuthoring {...singleChoiceVisualProps} /> : null}
        {!oldschool && tab === "audio-transcript" ? <NativeListeningTranscriptAuthoring panel={panelTwo} backgroundReference={backgroundReference} audioReference={audioReference} assetUrl={assetUrl} uploading={uploading} uploadAudio={uploadAudio} uploadBackground={uploadBackground} transcriptSurface={transcriptSurface} commitTranscriptArea={commitTranscriptArea} importSrt={importSrt} interaction={interaction} cues={cues} selectedCue={selectedCue} selectedCueId={selectedCueId} setSelectedCueId={setSelectedCueId} setPlayheadMs={setPlayheadMs} addCue={addCue} mutatePublic={mutatePublic} setCueTime={setCueTime} playheadMs={playheadMs} moveCue={moveCue} removeCue={removeCue} /> : null}
        {oldschool && tab === "audio-timeline" ? <NativeOldschoolListeningTimelineAuthoring interaction={interaction} audioReference={audioReference} pageReference={pageReference} assetUrl={assetUrl} uploading={uploading} uploadAudio={uploadAudio} uploadPage={uploadPage} importSrt={importSrt} importJson={importOldschoolJson} exportJson={exportOldschoolJson} cues={cues} selectedCue={selectedCue} selectedCueId={selectedCueId} setSelectedCueId={(id) => { setSelectedCueId(id); setSelectedRegionId(null); }} playheadMs={playheadMs} setPlayheadMs={setPlayheadMs} addCue={addCue} removeCue={removeCue} moveCue={moveCue} mutatePublic={mutatePublic} setCueTime={setCueTime} /> : null}
        {oldschool && tab === "page-mapping" ? <NativeOldschoolListeningPageMappingAuthoring publicDocument={publicDraft} bookSlug={bookSlug} componentSlug={componentSlug} interaction={interaction} pageReference={pageReference} assetUrl={previewAssetUrl} selectedCue={selectedCue} selectedCueId={selectedCueId} setSelectedCueId={setSelectedCueId} selectedRegionId={selectedRegionId} setSelectedRegionId={setSelectedRegionId} mutatePublic={mutatePublic} addRegion={addPageRegion} updateRegion={updatePageRegion} removeRegion={removePageRegion} clearCueMappings={clearSelectedCueMappings} clearMappings={clearPageMappings} /> : null}
        {tab === "preview" ? (
          <section className="native-or-preview">
            <p>
              <strong>Local Preview</strong> includes the current unsaved draft. Review remains pinned to saved state.
            </p>
            <div className="native-or-preview-toggle">
              <button type="button" aria-pressed={preview === "student"} onClick={() => setPreview("student")}>
                Student Preview
              </button>
              <button type="button" aria-pressed={preview === "teacher"} onClick={() => setPreview("teacher")}>
                Teacher Preview
              </button>
            </div>
            <NativeReadableTextPresentation document={publicDraft} assetUrl={previewAssetUrl}>{(presentation, audioHotspotPresentation) => preview === "student" ? (oldschool ? <NativeOldschoolListeningStudentSurface audioHotspotPresentation={audioHotspotPresentation} document={publicDraft} assetUrl={previewAssetUrl} presentation={presentation} /> : <NativeListeningStudentSurface document={publicDraft} assetUrl={previewAssetUrl} presentation={presentation} />) : (oldschool ? <NativeOldschoolListeningTeacherSurface audioHotspotPresentation={audioHotspotPresentation} publicDocument={publicDraft} teacherDocument={teacherDraft} assetUrl={previewAssetUrl} presentation={presentation} /> : <NativeListeningTeacherSurface publicDocument={publicDraft} teacherDocument={teacherDraft} assetUrl={previewAssetUrl} presentation={presentation} />)}</NativeReadableTextPresentation>
          </section>
        ) : null}
        {tab === "readable-text" ? <NativeReadableTextEditor bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} publicDraft={publicDraft} mutatePublic={mutatePublic} previewUrl={assetUrl} onIncompleteChange={setReadableTextIncomplete} onIntentChange={changed} onStatusChange={(message) => setState((current) => ({ ...current, message }))} /> : null}
        {tab === "video" ? <NativeVideoEditor bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} publicDraft={publicDraft} mutatePublic={mutatePublic} onIncompleteChange={setVideoIncomplete} onIntentChange={changed} onStatusChange={(message) => setState((current) => ({ ...current, message }))} /> : null}
        {!oldschool && tab === "supplemental-audio" ? <NativeSupplementalAudioEditor bookSlug={bookSlug} componentSlug={componentSlug} activityId={activityId} publicDraft={publicDraft} mutatePublic={mutatePublic} previewUrl={assetUrl} onIncompleteChange={setSupplementalAudioIncomplete} onIntentChange={changed} onStatusChange={(message) => setState((current) => ({ ...current, message }))} /> : null}
        {dirty && state.message ? (
          <p className="native-listening-editor-status" role="status">
            {state.message}
          </p>
        ) : null}
      </StudioTabWorkspace>
      <StudioSaveBar dirty={dirty} saving={state.saving} message={state.message} ready={readyToSave} issues={readinessIssues} disabled={!dirty || state.saving || !readyToSave || oldschool && uploading === "question-image"} reason={!dirty ? "No unsaved changes" : !readyToSave ? "Resolve all authoring issues before saving" : ""} onSave={save} />
    </section>
  );
}
