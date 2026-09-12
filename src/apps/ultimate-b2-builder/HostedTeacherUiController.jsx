import { AlertTriangle, RotateCcw, Save, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { getBuilderContent, newBuilderClientMutationId } from "../book-builder/hosted/builderContentApi.js";
import {
  finalizeTeacherUiAssets,
  prepareTeacherUiAssets,
  saveTeacherUiDocument,
  uploadTeacherUiAsset,
} from "../book-builder/hosted/builderTeacherUiAssetApi.js";
import {
  HOSTED_EDITABLE_UI_BINDINGS,
  HOSTED_TEACHER_UI_CATEGORY_LABELS,
  HOSTED_TEACHER_UI_TITLE_BINDING_IDS,
} from "../../data/ultimate-b2/hostedTeacherUiBindingCatalog.js";
import { HOSTED_OVERVIEW_FONT_FAMILIES, independentHostedPartsAssets, hostedTeacherUiAssetPath, normalizeHostedTeacherUiDocument } from "../../data/ultimate-b2/hostedTeacherUiDocument.js";
import { resolveUltimateB2BuilderVisualAssetUrl } from "../../data/ultimate-b2/ultimateB2BuilderVisualAssetUrls.js";
import { ultimateB2TeacherAppAuthoring } from "../../data/ultimate-b2/teacherAppAuthoring.js";
import { useBuilderReview } from "../book-builder/hosted/HostedPackageReview.jsx";

const titleIds = new Set(HOSTED_TEACHER_UI_TITLE_BINDING_IDS);

function accept(binding) {
  if (binding.mediaFamily === "audio") return ".mp3,.wav,audio/mpeg,audio/wav";
  if (binding.mediaFamily === "gaf") return ".gaf,application/x-gaf,application/octet-stream";
  if (binding.mediaFamily === "png") return ".png,image/png";
  return ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";
}

function applyChanges(savedAssets, changes) {
  const assets = { ...savedAssets };
  for (const [id, value] of Object.entries(changes)) {
    if (value) assets[id] = value;
    else delete assets[id];
  }
  return assets;
}

function stateLabel(bindingId, savedAssets, changes) {
  if (Object.hasOwn(changes, bindingId)) return changes[bindingId] ? "Unsaved replacement" : "Unsaved revert";
  return savedAssets[bindingId] ? "Saved override" : "Canonical";
}

function metadataLabel(asset) {
  if (!asset) return "Tracked canonical artwork";
  const dimensions = asset.width && asset.height ? ` - ${asset.width} x ${asset.height}` : "";
  const name = asset.originalFilename || String(asset.repositoryPath || "").split("/").pop() || asset.mediaType || "Canonical artwork";
  const size = Number.isSafeInteger(asset.sizeBytes) ? ` - ${Math.ceil(asset.sizeBytes / 1024)} KB` : "";
  return `${name}${asset.mediaType ? ` · ${asset.mediaType}` : ""}${size}${dimensions}`;
}

function effectiveAsset(binding, savedAssets, changes, previewUrls, identity) {
  if (previewUrls[binding.id]) return { url: previewUrls[binding.id], metadata: changes[binding.id] };
  if (changes[binding.id] === null) return { url: resolveUltimateB2BuilderVisualAssetUrl(binding.id), metadata: ultimateB2TeacherAppAuthoring.assets[binding.id] };
  const saved = changes[binding.id] || savedAssets[binding.id];
  if (saved) return { url: hostedTeacherUiAssetPath(saved, identity), metadata: saved };
  return { url: resolveUltimateB2BuilderVisualAssetUrl(binding.id), metadata: ultimateB2TeacherAppAuthoring.assets[binding.id] };
}

function AssetSlot({ binding, savedAssets, changes, previewUrls, identity, activity, onReplace, onRevert }) {
  const current = effectiveAsset(binding, savedAssets, changes, previewUrls, identity);
  const state = stateLabel(binding.id, savedAssets, changes);
  return <article className="b2-hosted-ui-slot" data-binding-id={binding.id} data-binding-state={state.toLowerCase().replaceAll(" ", "-")}>
    <div className="b2-hosted-ui-slot-preview">{current.url && binding.mediaFamily !== "gaf" ? <img src={current.url} alt={`${binding.label} effective asset`} /> : <Upload aria-hidden="true" />}</div>
    <div className="b2-hosted-ui-slot-copy"><strong>{binding.label}</strong><code>{binding.id}</code><span>{state}</span><small>{metadataLabel(current.metadata)}</small>{activity?.error ? <em><AlertTriangle /> {activity.error}</em> : null}</div>
    <div className="b2-hosted-ui-slot-actions">
      <label><input type="file" accept={accept(binding)} disabled={activity?.busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onReplace(binding, file); }} /><Upload size={15} /> {activity?.busy ? activity.label : "Browse / Replace"}</label>
      {(savedAssets[binding.id] || changes[binding.id]) ? <button type="button" onClick={() => onRevert(binding.id)} disabled={activity?.busy}><RotateCcw size={15} /> Revert to canonical</button> : null}
    </div>
  </article>;
}

function TitleGroup({ bindings, savedAssets, changes, previewUrls, identity, activity, onValidate, onRevert }) {
  const [files, setFiles] = useState({});
  const complete = bindings.every(({ id }) => files[id]);
  return <section className="b2-hosted-ui-title-group" data-atomic-group="title-animation">
    <header><div><h3>Atomic title animation package</h3><p>The GAF and all current SD/HD atlas slots validate and save as one package. Partial replacement is never accepted.</p></div>{bindings.some(({ id }) => savedAssets[id] || changes[id]) ? <button type="button" onClick={onRevert}><RotateCcw size={15} /> Revert complete title package</button> : null}</header>
    {bindings.map((binding) => { const effective = effectiveAsset(binding, savedAssets, changes, previewUrls, identity); return <article className="b2-hosted-ui-title-file" key={binding.id}><div><strong>{binding.label}</strong><code>{binding.id}</code><small>{files[binding.id]?.name || `${stateLabel(binding.id, savedAssets, changes)} · ${metadataLabel(effective.metadata)}`}</small>{binding.mediaFamily === "gaf" ? <span>Binary GAF · member of atomic title animation package</span> : null}</div><label><input type="file" accept={accept(binding)} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) setFiles((current) => ({ ...current, [binding.id]: file })); }} />Choose file</label>{effective.url && binding.mediaFamily !== "gaf" ? <img src={effective.url} alt={`${binding.label} effective atlas`} /> : null}</article>; })}
    {activity?.error ? <p className="b2-hosted-ui-error"><AlertTriangle /> {activity.error}</p> : null}
    <button type="button" className="b2-hosted-ui-validate-title" disabled={!complete || activity?.busy} onClick={async () => { const succeeded = await onValidate(bindings.map(({ id }) => ({ bindingId: id, file: files[id] }))); if (succeeded) setFiles({}); }}><Upload size={16} /> {activity?.busy ? activity.label : "Validate complete title package"}</button>
  </section>;
}

export function HostedTeacherUiController({ bookSlug = "ultimate-b2", componentSlug = "ultimate-b2-students-book", bookTitle = "Ultimate B2" }) {
  const { registerToolContext } = useBuilderReview();
  const identity = useMemo(() => ({ bookSlug, componentSlug, resource: "ui-controller" }), [bookSlug, componentSlug]);
  const documentIdentity = useMemo(() => ({ packageId: componentSlug }), [componentSlug]);
  const [loaded, setLoaded] = useState(null);
  const [fontChoice, setFontChoice] = useState(undefined);
  const [changes, setChanges] = useState({});
  const [candidateUploads, setCandidateUploads] = useState({});
  const [previewUrls, setPreviewUrls] = useState({});
  const [activity, setActivity] = useState({});
  const [section, setSection] = useState("overview");
  const [status, setStatus] = useState("Loading");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [viewerRefresh, setViewerRefresh] = useState(0);
  const previewUrlsRef = useRef(previewUrls);
  previewUrlsRef.current = previewUrls;
  const dirty = Object.keys(changes).length > 0 || fontChoice !== undefined;
  useEffect(() => {
    registerToolContext("ui", {
      view: "page",
      dirty,
      refreshKey: viewerRefresh,
      release: null,
    });
  }, [dirty, registerToolContext, viewerRefresh]);

  const load = async ({ preserveChanges = false } = {}) => {
    setStatus("Loading"); setError("");
    try {
      const payload = await getBuilderContent(identity);
      setLoaded({ revision: payload.revision, document: normalizeHostedTeacherUiDocument(payload.document, documentIdentity) });
      if (!preserveChanges) { setChanges({}); setFontChoice(undefined); setCandidateUploads({}); }
      setConflict(false); setStatus(preserveChanges && dirty ? "Unsaved changes" : "Ready");
    } catch (reason) { setError(reason.message); setStatus("Load failed"); }
  };

  useEffect(() => { load(); }, [identity]);
  useEffect(() => {
    const warn = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    globalThis.addEventListener("beforeunload", warn);
    return () => globalThis.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => () => Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url)), []);

  const savedAssets = useMemo(() => loaded ? independentHostedPartsAssets(loaded.document) : {}, [loaded]);
  const draftAssets = useMemo(() => applyChanges(savedAssets, changes), [savedAssets, changes]);
  const visualBindings = useMemo(() => HOSTED_EDITABLE_UI_BINDINGS.filter(({ category, mediaFamily }) => category !== "sounds" && mediaFamily !== "audio"), []);
  const categories = useMemo(() => [...new Set(visualBindings.map(({ category }) => category))], [visualBindings]);

  const validateFiles = async (files) => {
    if (!loaded) return false;
    const ids = files.map(({ bindingId }) => bindingId);
    const activityKey = ids.length > 1 ? "title-animation" : ids[0];
    const clientMutationId = newBuilderClientMutationId();
    setActivity((current) => ({ ...current, [activityKey]: { busy: true, label: "Preparing...", error: "" } }));
    try {
      const prepared = await prepareTeacherUiAssets({ bookSlug, componentSlug, expectedRevision: loaded.revision, clientMutationId, files });
      for (const upload of prepared.uploads) {
        const selected = files.find(({ bindingId }) => bindingId === upload.bindingId);
        await uploadTeacherUiAsset(selected.file, upload, (progress) => setActivity((current) => ({ ...current, [activityKey]: { busy: true, label: `Uploading ${progress}%`, error: "" } })));
      }
      setActivity((current) => ({ ...current, [activityKey]: { busy: true, label: "Validating...", error: "" } }));
      const finalized = await finalizeTeacherUiAssets({ bookSlug, componentSlug, uploadId: prepared.uploadId, expectedRevision: loaded.revision, clientMutationId });
      setChanges((current) => ({ ...current, ...finalized.candidates }));
      setCandidateUploads((current) => ({ ...current, ...Object.fromEntries(Object.keys(finalized.candidates).map((id) => [id, prepared.uploadId])) }));
      setPreviewUrls((current) => {
        const next = { ...current };
        for (const { bindingId, file } of files) {
          if (!file.type.startsWith("image/")) continue;
          if (next[bindingId]) URL.revokeObjectURL(next[bindingId]);
          next[bindingId] = URL.createObjectURL(file);
        }
        return next;
      });
      setActivity((current) => ({ ...current, [activityKey]: { busy: false, label: "Validated", error: "" } }));
      setStatus("Unsaved changes");
      return true;
    } catch (reason) {
      setActivity((current) => ({ ...current, [activityKey]: { busy: false, label: "Validation failed", error: reason.message } }));
      if (reason.status === 409) setConflict(true);
      return false;
    }
  };

  const revert = (ids) => {
    const bindingIds = Array.isArray(ids) ? ids : [ids];
    setChanges((current) => {
      const next = { ...current };
      for (const id of bindingIds) {
        if (savedAssets[id]) next[id] = null;
        else delete next[id];
      }
      return next;
    });
    setCandidateUploads((current) => {
      const next = { ...current }; bindingIds.forEach((id) => delete next[id]); return next;
    });
    setPreviewUrls((current) => {
      const next = { ...current }; bindingIds.forEach((id) => { if (next[id]) URL.revokeObjectURL(next[id]); delete next[id]; }); return next;
    });
    setStatus("Unsaved changes");
  };

  const save = async () => {
    if (!dirty || !loaded) return;
    setStatus("Saving"); setError("");
    try {
      const independent = loaded.document.independentPartsBackgrounds || ["background.students-book-parts", "background.workbook-parts", "background.grammar-book-parts"].some((id) => Object.hasOwn(changes, id));
      const assets = { ...draftAssets };
      // An unrelated legacy edit must not opt into the new parts contract.
      if (!independent) for (const id of ["background.workbook-parts", "background.grammar-book-parts"]) {
        if (!Object.hasOwn(loaded.document.assets, id)) delete assets[id];
      }
      const candidate = { ...loaded.document, ...(independent ? { independentPartsBackgrounds: true } : {}), assets };
      const selectedFont = fontChoice ?? loaded.document.overviewCaptionFontFamily;
      if (selectedFont) candidate.overviewCaptionFontFamily = selectedFont;
      else delete candidate.overviewCaptionFontFamily;
      const document = normalizeHostedTeacherUiDocument(candidate, documentIdentity);
      const candidateUploadIds = [...new Set(Object.keys(changes).filter((id) => changes[id]).map((id) => candidateUploads[id]).filter(Boolean))];
      const payload = await saveTeacherUiDocument({ bookSlug, componentSlug, expectedRevision: loaded.revision, clientMutationId: newBuilderClientMutationId(), document, candidateUploadIds });
      Object.values(previewUrls).forEach((url) => URL.revokeObjectURL(url));
      setPreviewUrls({}); setCandidateUploads({}); setChanges({}); setFontChoice(undefined); setConflict(false);
      setLoaded({ revision: payload.revision, document: normalizeHostedTeacherUiDocument(payload.document, documentIdentity) });
      setStatus("Saved"); setViewerRefresh((value) => value + 1);
    } catch (reason) {
      setError(reason.message);
      if (reason.status === 409) { setConflict(true); setStatus("Conflict"); }
      else setStatus("Save failed");
    }
  };

  if (!loaded) return <main className="b2-teacher-app-builder b2-hosted-ui-editor"><p role="status">{error || status}</p></main>;
  const titleBindings = visualBindings.filter(({ id }) => titleIds.has(id));
  const visibleBindings = visualBindings.filter(({ category, id }) => category === section && !titleIds.has(id));

  return <main className="b2-teacher-app-builder b2-hosted-ui-editor">
    <header className="b2-teacher-app-header"><div><span>{bookTitle} package tools</span><h1>Page UI Controller</h1><p>Edit approved shared graphics for stable, runtime-wired Teacher interface bindings across all package components.</p></div><div className="b2-hosted-ui-save-state" role="status"><strong>{status}</strong><span>Revision {loaded.revision}</span>{error ? <small>{error}</small> : null}<button type="button" onClick={save} disabled={!dirty || status === "Saving"}><Save size={16} /> Save UI draft</button>{conflict ? <button type="button" onClick={() => load({ preserveChanges: true })}>Reload latest and keep local choices</button> : null}</div></header>
    <div className="b2-hosted-ui-workspace">
      <nav aria-label="UI Controller sections"><button type="button" aria-current={section === "overview" ? "page" : undefined} onClick={() => setSection("overview")}>Overview</button>{categories.map((id) => <button key={id} type="button" aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>{HOSTED_TEACHER_UI_CATEGORY_LABELS[id]}</button>)}</nav>
      <section className="b2-hosted-ui-editor-panel">
        {section === "overview" ? <div className="b2-hosted-ui-overview"><h2>Bound Teacher interface graphics</h2><dl><div><dt>Editable visual bindings</dt><dd>{visualBindings.length}</dd></div><div><dt>Saved overrides</dt><dd>{Object.keys(savedAssets).filter((id) => !id.startsWith("sound.")).length}</dd></div><div><dt>Unsaved changes</dt><dd>{Object.keys(changes).length}</dd></div></dl><p>Stable control IDs, actions, labels, routing, layout, accessibility semantics, and existing sound overrides remain canonical.</p></div> : null}
        {section === "shell-background" ? <label className="b2-hosted-ui-slot">Page overview captions font family<select aria-label="Page overview captions font family" value={fontChoice ?? loaded.document.overviewCaptionFontFamily ?? ""} onChange={(event) => { setFontChoice(event.target.value); setStatus("Unsaved changes"); }}><option value="">Default (existing appearance)</option>{HOSTED_OVERVIEW_FONT_FAMILIES.map((family) => <option key={family} value={family}>{family}</option>)}</select></label> : null}
        {section === "branding-title" ? <TitleGroup bindings={titleBindings} savedAssets={savedAssets} changes={changes} previewUrls={previewUrls} identity={identity} activity={activity["title-animation"]} onValidate={validateFiles} onRevert={() => revert(HOSTED_TEACHER_UI_TITLE_BINDING_IDS)} /> : null}
        {section !== "overview" ? <div className="b2-hosted-ui-slots">{visibleBindings.map((binding) => <AssetSlot key={binding.id} binding={binding} savedAssets={savedAssets} changes={changes} previewUrls={previewUrls} identity={identity} activity={activity[binding.id]} onReplace={(selected, file) => validateFiles([{ bindingId: selected.id, file }])} onRevert={revert} />)}</div> : null}
      </section>
    </div>
  </main>;
}
