import { isMarkWordsVisual } from "../../../data/native-activities/nativeMarkWordsVisualTargets.js";
import { compositeEditorContent, compositeEditorTabs, useCompositeEditorBinding } from "./nativeCompositeEditorBinding.js";
import { useEffect, useRef, useState } from "react";
import { BookOpenText, Eye, FileText, Film, KeyRound, LayoutPanelTop, Music } from "lucide-react";
import { StudioButton, StudioField, StudioSaveBar, StudioTabWorkspace } from "../../../components/builder-studio/StudioControls.jsx";
import { NativeMarkWordsPassage, NativeMarkWordsStudentSurface } from "../../../components/native-mark-words/NativeMarkWordsStudentSurface.jsx";
import { NativeMarkWordsTeacherSurface } from "../../../components/native-mark-words/NativeMarkWordsTeacherSurface.jsx";
import { NativeReadableTextPresentation } from "../../../components/native-readable-text/NativeReadableTextPresentation.jsx";
import { assessNativeMarkWordsReadiness, NATIVE_MARK_WORDS_LIMITS } from "../../../data/native-activities/nativeMarkWords.js";
import { addNativeMarkWordsPassage, alignNativeMarkWordsAnswers, rebuildNativeMarkWordsPassage, removeNativeMarkWordsPassage, setNativeMarkWordsAnswers, validateMarkWordsAuthoringPair } from "../../../data/native-activities/nativeMarkWordsAuthoring.js";
import { generateNativeMarkWordsBulkCandidate } from "../../../data/native-activities/nativeMarkWordsBulkAuthoring.js";
import { getBuilderContent as getRemoteBuilderContent } from "./builderContentApi.js";
import { nativeFontPreviewUrl, saveNativeActivityPair } from "./builderNativeActivityApi.js";
import { projectNativeActivityPublicForAuthoring } from "./nativeActivityAuthoringProjection.js";
import { NativeBulkGenerator } from "./NativeBulkGenerator.jsx";
import { NativeReadableTextEditor } from "./NativeReadableTextEditor.jsx";
import { NativeVideoEditor } from "./NativeVideoEditor.jsx";
import { NativeSupplementalAudioEditor } from "./NativeSupplementalAudioEditor.jsx";
import { NativeMarkWordsVisualEditor } from "./NativeMarkWordsVisualEditor.jsx";

const tabs = [{ id: "content", label: "Content", icon: FileText }, { id: "visual", label: "Visual", icon: LayoutPanelTop }, { id: "answer-key", label: "Answer Key", icon: KeyRound }, { id: "readable-text", label: "Readable Text", icon: BookOpenText }, { id: "video", label: "Video", icon: Film }, { id: "supplemental-audio", label: "Supplemental MP3", icon: Music }, { id: "preview", label: "Local Preview", icon: Eye }];

export function NativeMarkWordsEditor({ compositeBinding = null, bookSlug, componentSlug, activityId, placementLabel, onDirtyChange, onSaved }) {
  const getBuilderContent = (request, options) => compositeEditorContent(compositeBinding, getRemoteBuilderContent, request, options);
  const [pair, setPair] = useState(null); const pairRef = useRef(null);
  const [state, setState] = useState({ kind: "loading", message: "", saving: false });
  const [dirty, setDirty] = useState(false); const [mode, setMode] = useState("content"); const [preview, setPreview] = useState("student");
  const [drawingDefaults, setDrawingDefaults] = useState(null);
  const [textEdits, setTextEdits] = useState({}); const [uploading, setUploading] = useState(false);
  const [readableIncomplete, setReadableIncomplete] = useState(false); const [videoIncomplete, setVideoIncomplete] = useState(false); const [audioIncomplete, setAudioIncomplete] = useState(false);
  useCompositeEditorBinding(compositeBinding, pair?.publicDocument, pair?.teacherDocument, dirty, uploading, (publicDocument) => setPair((current) => ({ ...current, publicDocument })));
  const alive = useRef(false);
  const scope = { bookSlug, componentSlug, activityId };
  const message = (value) => { if (alive.current) setState((current) => ({ ...current, message: value })); };
  const changed = () => { if (alive.current) { setDirty(true); onDirtyChange?.(true); } };
  const install = (next) => { pairRef.current = next; setPair(next); };
  useEffect(() => {
    alive.current = true; const controller = new AbortController();
    Promise.all(["public", "teacher"].map((role) => getBuilderContent({ ...scope, resource: `native-activity-${role}`, documentKey: activityId }, { signal: controller.signal }))).then(([pub, teacher]) => {
      if (controller.signal.aborted) return;
      validateMarkWordsAuthoringPair(pub.document, teacher.document);
      install({ publicDocument: projectNativeActivityPublicForAuthoring(pub.document), teacherDocument: teacher.document });
      if (isMarkWordsVisual(pub.document.parts[0].interaction) || !pub.document.parts[0].interaction.items?.length) setMode("visual");
      setState({ kind: "ready", message: "Saved draft", publicRevision: pub.revision, teacherRevision: teacher.revision, saving: false });
    }).catch((error) => { if (!controller.signal.aborted) setState({ kind: "error", message: error.message }); });
    return () => { alive.current = false; controller.abort(); };
  }, []);
  const mutatePair = (mutator) => {
    if (!alive.current || !pairRef.current) return;
    const next = structuredClone(pairRef.current);
    try { mutator(next.publicDocument, next.teacherDocument); install(next); changed(); }
    catch (error) { message(error.message); }
  };
  const mutatePublic = (mutator) => mutatePair((pub) => mutator(pub));
  if (state.kind === "loading") return <p role="status">Loading Mark the Words…</p>;
  if (!pair || state.kind === "error") return <p role="alert">{state.message}</p>;
  const { publicDocument: publicDraft, teacherDocument: teacherDraft } = pair;
  const { items = [], presentation } = publicDraft.parts[0].interaction;
  const readiness = assessNativeMarkWordsReadiness(publicDraft, teacherDraft);
  const pendingText = items.some((item) => Object.hasOwn(textEdits, item.id) && textEdits[item.id] !== item.text);
  const issues = [...readiness.issues, ...(pendingText ? ["Apply or discard pending passage text edits."] : []), ...([readableIncomplete, videoIncomplete, audioIncomplete].some(Boolean) ? ["Complete the enabled media setup before saving."] : []), ...(uploading ? ["Wait for the asset upload to finish."] : [])];
  const assetUrl = (assetId) => publicDraft.assets.find((asset) => asset.assetId === assetId)?.role === "activity_font" ? nativeFontPreviewUrl(bookSlug, componentSlug, assetId) : `/builder/api/native-activities/books/${encodeURIComponent(bookSlug)}/components/${encodeURIComponent(componentSlug)}/activities/${encodeURIComponent(activityId)}/assets/${encodeURIComponent(assetId)}/preview`;
  const generate = (source, options) => {
    if (pendingText) throw new Error("Apply or discard pending passage edits before bulk generation.");
    if (options.replaceExisting && items.length && !globalThis.confirm("Replace all passages? Their private answers and word hotspots will be removed. Panel backgrounds and common media remain.")) throw new Error("Replacement cancelled; neither draft changed.");
    const result = generateNativeMarkWordsBulkCandidate({ source, ...options, ...pairRef.current, confirmed: true });
    install({ publicDocument: result.publicDocument, teacherDocument: result.teacherDocument }); setTextEdits({}); changed(); return result;
  };
  const save = async () => {
    if (compositeBinding) return;
    if (issues.length || state.saving || !dirty) return;
    setState((current) => ({ ...current, saving: true, message: "Saving…" }));
    try {
      const value = await saveNativeActivityPair({ ...scope, expectedPublicRevision: state.publicRevision, expectedTeacherRevision: state.teacherRevision, ...pairRef.current });
      if (!alive.current) return;
      install({ publicDocument: value.publicDocument, teacherDocument: value.teacherDocument }); setDirty(false); onDirtyChange?.(false); onSaved?.(value.publicRevision);
      setState({ kind: "ready", message: "Draft saved.", saving: false, publicRevision: value.publicRevision, teacherRevision: value.teacherRevision });
    } catch (error) { if (alive.current) setState((current) => ({ ...current, saving: false, message: error.status === 409 ? "This draft changed elsewhere. Reload before saving." : error.message })); }
  };
  const mediaProps = { ...scope, publicDraft, mutatePublic, previewUrl: assetUrl, onIntentChange: changed, onStatusChange: message, onUploadStateChange: setUploading };
  return <section className="native-activity-foundation native-mark-words-editor studio-editor">
    <header className="studio-editor-header"><div><span className="studio-eyebrow">{placementLabel} · Mark the Words</span><h2>{publicDraft.metadata.title}</h2></div></header>
    <fieldset disabled={state.saving || uploading} style={{ border: 0, padding: 0, minWidth: 0 }}>
      <StudioTabWorkspace id="native-mark-words-tabs" value={mode} onChange={setMode} tabs={compositeEditorTabs(compositeBinding, isMarkWordsVisual(publicDraft.parts[0].interaction) ? tabs.filter((tab) => tab.id !== "content") : tabs)} label="Mark the Words authoring modes">
        {mode === "content" && !isMarkWordsVisual(publicDraft.parts[0].interaction) ? <><StudioField label="Activity title"><input maxLength={300} value={publicDraft.metadata.title} onChange={(event) => mutatePublic((next) => { next.metadata.title = event.target.value; })} /></StudioField><NativeBulkGenerator kind="mark-the-words" hasExistingContent={items.length > 0} onGenerate={generate} /><StudioButton disabled={items.length >= NATIVE_MARK_WORDS_LIMITS.passages} onClick={() => mutatePair(addNativeMarkWordsPassage)}>Add passage</StudioButton></> : null}
        {["content", "answer-key"].includes(mode) ? items.map((item, index) => <section key={item.id} className="studio-content-panel"><h3>Passage {index + 1}</h3>
          {mode === "content" && !isMarkWordsVisual(publicDraft.parts[0].interaction) ? <><StudioField label={`Passage ${index + 1} text`}><textarea rows={4} maxLength={NATIVE_MARK_WORDS_LIMITS.text} value={textEdits[item.id] ?? item.text} onChange={(event) => { setTextEdits((current) => ({ ...current, [item.id]: event.target.value })); changed(); }} /></StudioField>
            <StudioButton disabled={!Object.hasOwn(textEdits, item.id) || textEdits[item.id] === item.text} onClick={() => {
              if (!globalThis.confirm("Rebuild this passage's words? Its private answers and word hotspots will be cleared. Other passages remain unchanged.")) return;
              mutatePair((pub, teacher) => rebuildNativeMarkWordsPassage(pub, teacher, item.id, textEdits[item.id], { confirmed: true }));
            }}>Rebuild passage words</StudioButton><StudioButton onClick={() => setTextEdits((current) => ({ ...current, [item.id]: item.text }))}>Discard text edit</StudioButton>
            {[-1, 1].map((offset) => <StudioButton key={offset} disabled={index + offset < 0 || index + offset >= items.length} onClick={() => mutatePair((pub, teacher) => { const list = pub.parts[0].interaction.items; [list[index], list[index + offset]] = [list[index + offset], list[index]]; alignNativeMarkWordsAnswers(pub, teacher); })}>{offset < 0 ? "Move up" : "Move down"}</StudioButton>)}
            <StudioButton variant="danger-ghost" onClick={() => { if (globalThis.confirm("Remove this passage, its answers and word hotspots?")) mutatePair((pub, teacher) => removeNativeMarkWordsPassage(pub, teacher, item.id)); }}>Remove passage</StudioButton>
          </> : <p>Click each correct occurrence. Repeated words are independent.</p>}
          <div className="native-mark-words" data-marking={presentation.marking}><NativeMarkWordsPassage item={item} itemNumber={index + 1} readOnly={mode !== "answer-key"} selected={mode === "answer-key" ? teacherDraft.parts[0].solution.answers.find((answer) => answer.itemId === item.id)?.correctWordIds || [] : []} onToggle={(itemId, wordId) => mutatePair((pub, teacher) => { const current = teacher.parts[0].solution.answers.find((answer) => answer.itemId === itemId).correctWordIds; setNativeMarkWordsAnswers(pub, teacher, itemId, current.includes(wordId) ? current.filter((id) => id !== wordId) : [...current, wordId]); })} /></div>
        </section>) : null}
        {mode === "visual" || (mode === "answer-key" && isMarkWordsVisual(publicDraft.parts[0].interaction)) ? <NativeMarkWordsVisualEditor {...scope} publicDraft={publicDraft} teacherDraft={teacherDraft} mutatePair={mutatePair} sharedCanvas={compositeBinding?.sharedCanvas} drawingDefaults={drawingDefaults} onDrawingDefaultsChange={setDrawingDefaults} mutatePublic={mutatePublic} assetUrl={assetUrl} onMessage={message} onUploading={setUploading} isActive={() => alive.current} /> : null}
        <div hidden={mode !== "readable-text"}><NativeReadableTextEditor {...mediaProps} onIncompleteChange={setReadableIncomplete} /></div>
        <div hidden={mode !== "video"}><NativeVideoEditor {...mediaProps} onIncompleteChange={setVideoIncomplete} /></div>
        <div hidden={mode !== "supplemental-audio"}><NativeSupplementalAudioEditor {...mediaProps} onIncompleteChange={setAudioIncomplete} /></div>
        {mode === "preview" ? <><div role="group" aria-label="Preview role"><StudioButton onClick={() => setPreview("student")} selected={preview === "student"}>Student Preview</StudioButton><StudioButton onClick={() => setPreview("teacher")} selected={preview === "teacher"}>Teacher Preview</StudioButton></div><NativeReadableTextPresentation document={publicDraft} assetUrl={assetUrl}>{(controls, audioHotspotPresentation) => preview === "student" ? <NativeMarkWordsStudentSurface document={publicDraft} assetUrl={assetUrl} audioHotspotPresentation={audioHotspotPresentation} /> : <NativeMarkWordsTeacherSurface publicDocument={publicDraft} teacherDocument={teacherDraft} assetUrl={assetUrl} presentation={controls} audioHotspotPresentation={audioHotspotPresentation} />}</NativeReadableTextPresentation></> : null}
      </StudioTabWorkspace>
    </fieldset>
    {dirty && state.message ? <p role="status">{state.message}</p> : null}
    <StudioSaveBar hidden={Boolean(compositeBinding)} dirty={dirty} saving={state.saving} message={state.message} ready={!issues.length} issues={issues} disabled={!dirty || state.saving || issues.length > 0} onSave={save} reason={issues.length ? "Resolve authoring issues before saving" : "No unsaved changes"} />
  </section>;
}
