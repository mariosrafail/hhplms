import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileUp, Music, Plus, Save, Trash2, Upload, Video, VolumeX } from "lucide-react";

import { createNativeChildId } from "../../data/native-activities/nativeChildIdentity.js";
import { parseTimedTextSrt } from "../../data/timed-media/timedText.js";
import { getBuilderPages } from "../book-builder/hosted/builderPagesApi.js";
import { createEmptyUltimateB2UnitExtras, validateCurrentUnitExtrasStructure } from "../../data/ultimate-b2/unitExtras.js";
import { BuilderModal } from "../book-builder/hosted/BuilderModal.jsx";
import { getBuilderContent } from "../book-builder/hosted/builderContentApi.js";
import { saveUnitExtrasDocument, uploadUnitExtraAudio, uploadUnitExtraVideo } from "../book-builder/hosted/builderUnitExtrasApi.js";

const identity = Object.freeze({ bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", resource: "unit-extras" });

function bytes(value, empty = "No media") { return Number.isFinite(value) ? `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 1 : 2)} MiB` : empty; }
function duration(value) { const seconds = Math.round(Number(value || 0) / 1_000); return value ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "--:--"; }

function withUnit(document, unitNumber) {
  const next = structuredClone(document);
  const unitId = `unit-${unitNumber}`;
  if (!next.units.some((unit) => unit.unitId === unitId)) next.units.push({ unitId, unitNumber, categories: { videos: [], audios: [] } });
  return next;
}

function mutateUnit(document, unitNumber, mutation) {
  const next = withUnit(document, unitNumber);
  mutation(next.units.find((unit) => unit.unitNumber === unitNumber), next);
  return next;
}

export function UnitExtrasEditor({ open, unit, category = "videos", onClose, returnFocusRef }) {
  const generation = useRef(0);
  const [catalog, setCatalog] = useState(null);
  const [loadedUnit, setLoadedUnit] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState(createEmptyUltimateB2UnitExtras);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadingId, setUploadingId] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const unitNumber = Number(unit?.unitNumber || 0);
  const unitId = `unit-${unitNumber}`;
  const ready = open && loadedUnit === unitNumber && !loading && !loadError;
  const unitDraft = ready ? draft.units.find((entry) => entry.unitNumber === unitNumber) : null;
  const videos = unitDraft?.categories.videos || [];
  const audios = unitDraft?.categories.audios || [];
  const pages = useMemo(() => ready ? catalog.pages.filter((page) => page.unitNumber === unitNumber) : [], [catalog, ready, unitNumber]);

  useEffect(() => {
    if (!open || !unitNumber) { setLoadedUnit(null); return undefined; }
    const controller = new AbortController();
    const session = ++generation.current;
    const active = () => !controller.signal.aborted && session === generation.current;
    setLoading(true); setLoadError(""); setMessage(""); setSaving(false); setUploadingId("");
    Promise.all([getBuilderContent(identity, { signal: controller.signal }), getBuilderPages(identity, { signal: controller.signal })]).then(([result, library]) => {
      if (!active()) return;
      if (library.component?.bookSlug !== identity.bookSlug || library.component?.componentSlug !== identity.componentSlug || !Array.isArray(library.pages)) throw new Error("Page library identity is invalid.");
      const document = validateCurrentUnitExtrasStructure(result.document);
      setRevision(result.revision); setDraft(document); setCatalog(library); setLoadedUnit(unitNumber); setDirty(false);
    }).catch((error) => { if (active()) setLoadError(error.message || "Unit Extras and Pages could not be loaded."); }).finally(() => { if (active()) setLoading(false); });
    return () => { controller.abort(); generation.current += 1; };
  }, [open, unitNumber]);

  const change = (mutation) => { if (!ready || saving || uploadingId) return; setDraft((current) => mutateUnit(current, unitNumber, mutation)); setDirty(true); setMessage(""); };
  const persist = async (candidate = draft, session = generation.current) => {
    const result = await saveUnitExtrasDocument({ ...identity, expectedRevision: revision, document: validateCurrentUnitExtrasStructure(candidate) });
    if (session !== generation.current) throw new DOMException("Selection changed", "AbortError");
    const document = validateCurrentUnitExtrasStructure(result.document);
    setRevision(result.revision); setDraft(document); setDirty(false); return result;
  };
  const save = async () => {
    if (!ready) return;
    const session = generation.current;
    setSaving(true); setMessage("");
    try { await persist(draft, session); setMessage("Unit Extras saved."); } catch (error) { if (session === generation.current) setMessage(error.message || "Unit Extras could not be saved."); }
    finally { if (session === generation.current) setSaving(false); }
  };
  const addVideo = () => change((target) => { const id = createNativeChildId("video"); target.categories.videos.push({ id, title: "Extra Video", assetSlot: id, asset: null, fileName: "", byteSize: null, durationMs: null, cues: [] }); });
  const addAudio = () => change((target) => { const id = createNativeChildId("audio"); (target.categories.audios ||= []).push({ id, title: "Extra Audio", assetSlot: id, asset: null, fileName: "", byteSize: null }); });

  const uploadMp4 = async (videoId, file) => {
    if (!file || !ready || saving || uploadingId) return;
    const session = generation.current;
    setUploadingId(videoId); setUploadProgress(0); setMessage("Saving the Unit Extra placeholder…");
    try {
      let candidate = structuredClone(draft);
      candidate = mutateUnit(candidate, unitNumber, (target) => { const video = target.categories.videos.find((entry) => entry.id === videoId); video.assetSlot = video.id; });
      const saved = await persist(candidate, session);
      setMessage("Uploading and validating MP4…");
      const result = await uploadUnitExtraVideo({ ...identity, unitSlug: unitId, itemId: videoId, expectedRevision: saved.revision, file, onProgress: (progress) => { if (session === generation.current) setUploadProgress(progress); } });
      if (session !== generation.current) return;
      setDraft((current) => mutateUnit(current, unitNumber, (target) => {
        const video = target.categories.videos.find((entry) => entry.id === videoId);
        video.assetSlot = video.id; video.asset = result.reference; video.fileName = file.name;
        video.byteSize = result.metadata.byteSize; video.durationMs = result.metadata.durationMs;
        if (video.cues.some((cue) => cue.endMs > video.durationMs)) video.cues = [];
      }));
      setDirty(true); setMessage("MP4 validated. Save Unit Extras to attach it.");
    } catch (error) { if (session === generation.current) setMessage(error.message || "MP4 upload failed."); }
    finally { if (session === generation.current) { setUploadingId(""); setUploadProgress(0); } }
  };

  const uploadMp3 = async (audioId, file) => {
    if (!file || !ready || saving || uploadingId) return;
    const session = generation.current;
    setUploadingId(audioId); setUploadProgress(0); setMessage("Saving the Unit Extra Audio placeholder…");
    try {
      let candidate = structuredClone(draft);
      candidate = mutateUnit(candidate, unitNumber, (target) => { target.categories.audios.find((entry) => entry.id === audioId).assetSlot = audioId; });
      const saved = await persist(candidate, session);
      setMessage("Uploading and validating MP3…");
      const result = await uploadUnitExtraAudio({ ...identity, unitSlug: unitId, itemId: audioId, expectedRevision: saved.revision, file, onProgress: (progress) => { if (session === generation.current) setUploadProgress(progress); } });
      if (session !== generation.current) return;
      setDraft((current) => mutateUnit(current, unitNumber, (target) => {
        const audio = target.categories.audios.find((entry) => entry.id === audioId);
        audio.assetSlot = audio.id; audio.asset = result.reference; audio.fileName = file.name; audio.byteSize = result.metadata.byteSize;
      }));
      setDirty(true); setMessage("MP3 validated. Save Unit Extras to attach it.");
    } catch (error) { if (session === generation.current) setMessage(error.message || "MP3 upload failed."); }
    finally { if (session === generation.current) { setUploadingId(""); setUploadProgress(0); } }
  };

  const importSrt = async (videoId, file) => {
    if (!file || !ready || saving || uploadingId) return;
    const session = generation.current;
    try {
      const cues = parseTimedTextSrt(await file.text(), { createId: () => createNativeChildId("cue"), label: "Unit Extra Video SRT" });
      if (session !== generation.current) return;
      const video = videos.find((entry) => entry.id === videoId);
      if (video?.durationMs && cues.some((cue) => cue.endMs > video.durationMs)) throw new Error("Unit Extra Video SRT contains a cue beyond the MP4 duration.");
      change((target) => { target.categories.videos.find((entry) => entry.id === videoId).cues = cues; });
      setMessage(`${cues.length} subtitle cue${cues.length === 1 ? "" : "s"} imported.`);
    } catch (error) { if (session === generation.current) setMessage(error.message || "SRT import failed."); }
  };

  const togglePage = (pageId, category, checked) => change((_target, next) => {
    const existing = next.pages.find((page) => page.pageId === pageId);
    if (existing) existing.extrasVisibility[category] = checked;
    else next.pages.push({ pageId, unitId, extrasVisibility: { videos: false, audios: false, [category]: checked } });
  });

  return <BuilderModal className="builder-modal--unit-extras" open={open} title={`${unit?.title || `Unit ${unitNumber}`} Extras`} description="Manage Unit-owned Extras and choose which Pages expose them." busy={saving || Boolean(uploadingId)} onClose={onClose} returnFocusRef={returnFocusRef}>
    <div className="unit-extras-editor">
      <header><div><span>Unit Extras</span>{category === "audios" ? <><h3><Music aria-hidden="true" /> Audio</h3><p>Standalone MP3 files; no Listening activity, transcript, or cues required.</p></> : <><h3><Video aria-hidden="true" /> Videos</h3><p>MP4 is required. SRT subtitles are optional.</p></>}</div><button className="hosted-builder-action" type="button" onClick={category === "audios" ? addAudio : addVideo} disabled={!ready || saving || Boolean(uploadingId)}><Plus aria-hidden="true" /> Add {category === "audios" ? "Audio" : "Video"}</button></header>
      <div className="unit-extras-editor-scroll">
      {loading ? <p role="status">Loading Unit Extras…</p> : null}
      {loadError ? <p role="alert">{loadError}</p> : null}
      {category === "videos" ? <>
      {ready && !videos.length ? <p className="unit-extras-empty">No Extra Videos in this Unit.</p> : null}
      <div className="unit-extra-video-list">{videos.map((video, index) => <section key={video.id} className="unit-extra-video-card">
        <div className="unit-extra-video-order"><button type="button" aria-label={`Move ${video.title} up`} disabled={index === 0 || Boolean(uploadingId)} onClick={() => change((target) => { const list = target.categories.videos; [list[index - 1], list[index]] = [list[index], list[index - 1]]; })}><ArrowUp /></button><button type="button" aria-label={`Move ${video.title} down`} disabled={index === videos.length - 1 || Boolean(uploadingId)} onClick={() => change((target) => { const list = target.categories.videos; [list[index], list[index + 1]] = [list[index + 1], list[index]]; })}><ArrowDown /></button></div>
        <label><span>Title</span><input value={video.title} maxLength="160" disabled={!ready || saving || Boolean(uploadingId)} onChange={(event) => change((target) => { target.categories.videos[index].title = event.target.value; })} /></label>
        <dl><div><dt>MP4</dt><dd>{video.asset ? video.fileName : "Required"}</dd></div><div><dt>Duration</dt><dd>{duration(video.durationMs)}</dd></div><div><dt>Size</dt><dd>{bytes(video.byteSize, "No MP4")}</dd></div><div><dt>Subtitles</dt><dd>{video.cues.length ? `${video.cues.length} subtitle cues` : "No subtitles"}</dd></div></dl>
        <div className="unit-extra-video-actions"><label className="studio-upload-action"><Upload aria-hidden="true" /><span><strong>{uploadingId === video.id ? `Uploading ${uploadProgress}%` : video.asset ? "Replace MP4" : "Upload MP4"}</strong><small>MP4 · maximum 100 MiB</small></span><input type="file" accept="video/mp4,.mp4" disabled={!ready || saving || Boolean(uploadingId)} onChange={(event) => { uploadMp4(video.id, event.target.files?.[0]); event.target.value = ""; }} /></label><label className="studio-upload-action"><FileUp aria-hidden="true" /><span><strong>{video.cues.length ? "Replace SRT" : "Upload SRT"}</strong><small>Optional timed subtitles</small></span><input type="file" accept=".srt,application/x-subrip,text/plain" disabled={!ready || saving || Boolean(uploadingId)} onChange={(event) => { importSrt(video.id, event.target.files?.[0]); event.target.value = ""; }} /></label>{video.cues.length ? <button type="button" onClick={() => change((target) => { target.categories.videos[index].cues = []; })}>Remove SRT</button> : null}<button className="builder-danger-action" type="button" disabled={!ready || saving || Boolean(uploadingId)} onClick={() => change((target) => { target.categories.videos.splice(index, 1); })}><Trash2 aria-hidden="true" /> Delete Video</button></div>
      </section>)}</div>
      </> : <>
      {ready && !audios.length ? <p className="unit-extras-empty">No Extra Audio in this Unit.</p> : null}
      <div className="unit-extra-video-list unit-extra-audio-list">{audios.map((audio, index) => <section key={audio.id} className="unit-extra-video-card unit-extra-audio-card">
        <div className="unit-extra-video-order"><button type="button" aria-label={`Move ${audio.title} up`} disabled={index === 0 || Boolean(uploadingId)} onClick={() => change((target) => { const list = target.categories.audios; [list[index - 1], list[index]] = [list[index], list[index - 1]]; })}><ArrowUp /></button><button type="button" aria-label={`Move ${audio.title} down`} disabled={index === audios.length - 1 || Boolean(uploadingId)} onClick={() => change((target) => { const list = target.categories.audios; [list[index], list[index + 1]] = [list[index + 1], list[index]]; })}><ArrowDown /></button></div>
        <label><span>Title</span><input value={audio.title} maxLength="160" disabled={!ready || saving || Boolean(uploadingId)} onChange={(event) => change((target) => { target.categories.audios[index].title = event.target.value; })} /></label>
        <dl><div><dt>MP3</dt><dd>{audio.asset ? audio.fileName : "Required"}</dd></div><div><dt>Size</dt><dd>{bytes(audio.byteSize, "No MP3")}</dd></div></dl>
        <div className="unit-extra-video-actions"><label className="studio-upload-action"><Upload aria-hidden="true" /><span><strong>{uploadingId === audio.id ? `Uploading ${uploadProgress}%` : audio.asset ? "Replace MP3" : "Upload MP3"}</strong><small>MP3 · maximum 50 MiB</small></span><input type="file" accept="audio/mpeg,.mp3" disabled={!ready || saving || Boolean(uploadingId)} onChange={(event) => { uploadMp3(audio.id, event.target.files?.[0]); event.target.value = ""; }} /></label>{audio.asset ? <button type="button" disabled={!ready || saving || Boolean(uploadingId)} onClick={() => change((target) => { const targetAudio = target.categories.audios[index]; targetAudio.asset = null; targetAudio.fileName = ""; targetAudio.byteSize = null; })}><VolumeX aria-hidden="true" /> Remove MP3 assignment</button> : null}<button className="builder-danger-action" type="button" disabled={!ready || saving || Boolean(uploadingId)} onClick={() => change((target) => { target.categories.audios.splice(index, 1); })}><Trash2 aria-hidden="true" /> Delete Audio</button></div>
      </section>)}</div>
      </>}
      <section className="unit-extra-page-visibility"><h3>Page visibility</h3><p>Choose the Pages that show Extra {category === "audios" ? "Audio" : "Videos"}.</p>{ready && !pages.length ? <p>No active Pages in this Unit.</p> : null}<div>{pages.map((page) => <label key={page.id}><input type="checkbox" data-page-id={page.id} checked={draft.pages.find((entry) => entry.pageId === page.id)?.extrasVisibility[category] || false} disabled={!ready || saving || Boolean(uploadingId)} onChange={(event) => togglePage(page.id, category, event.target.checked)} /><span><strong>{page.label}</strong><small>{page.printedLabel}</small></span><em>Show Extra {category === "audios" ? "Audio" : "Videos"}</em></label>)}</div></section>
      {message ? <p className="builder-inline-status" role="status">{message}</p> : null}
      </div>
      <footer><button type="button" disabled={saving || Boolean(uploadingId)} onClick={onClose}>Close</button><button className="hosted-builder-action" type="button" disabled={!ready || !dirty || saving || Boolean(uploadingId)} onClick={save}><Save aria-hidden="true" /> {saving ? "Saving…" : "Save Unit Extras"}</button></footer>
    </div>
  </BuilderModal>;
}
