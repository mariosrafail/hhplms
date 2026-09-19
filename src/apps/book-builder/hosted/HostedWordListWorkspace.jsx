import { useEffect, useRef, useState } from "react";
import { componentGroups, portableDiff, WORDLIST_LIMITS } from "../../../data/wordlists/portable.js";
import { readWordListZip, validateWordListFiles } from "../../../data/wordlists/archive.js";
import { loadWordList, wordListAudioUrl } from "../../../data/wordlists/loader.js";

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || "wordlist_unavailable"); return result;
}
const post = (url, body, signal) => api(url, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export function HostedWordListWorkspace({ bookSlug, editionId, componentSlug, busy, setBusy, setDirty }) {
  const [status, setStatus] = useState(null); const [preview, setPreview] = useState(null); const [error, setError] = useState("");
  const [progress, setProgress] = useState(""); const [review, setReview] = useState(null);
  const selected = useRef({ package: null, audio: [] }); const run = useRef(null); const alive = useRef(true); const pending = useRef(null);
  const validationSequence = useRef(0);
  const base = `/builder/api/publication/wordlists/books/${bookSlug}/editions/${editionId}`;
  const componentBase = `${base}/components/${componentSlug}`;
  const refresh = async () => { const value = await api(componentBase); if (alive.current) setStatus(value); };
  useEffect(() => {
    alive.current = true; const controller = new AbortController();
    api(componentBase, { signal: controller.signal }).then(setStatus).catch((err) => { if (err.name !== "AbortError") setError(err.message); });
    return () => { alive.current = false; validationSequence.current++; controller.abort(); run.current?.abort(); };
  }, [componentBase]);
  const validate = async () => {
    const sequence = ++validationSequence.current;
    setError(""); setPreview(null); pending.current = null;
    try {
      const file = selected.current.package; if (!file) return;
      if (file.size > WORDLIST_LIMITS.total + WORDLIST_LIMITS.json + 1024 * 1024) throw new Error("Package exceeds import limits.");
      const files = file.name.toLowerCase().endsWith(".zip") ? await readWordListZip(await file.arrayBuffer())
        : new Map([["wordlist.json", new Uint8Array(await file.arrayBuffer())]]);
      if (selected.current.audio.length > WORDLIST_LIMITS.files) throw new Error("Too many audio files.");
      let total = 0;
      for (const audio of selected.current.audio) {
        total += audio.size;
        if (audio.size > WORDLIST_LIMITS.file || total > WORDLIST_LIMITS.total) throw new Error("Audio exceeds import limits.");
        const path = `audio/${audio.name}`; if (files.has(path)) throw new Error("Duplicate audio path.");
        files.set(path, new Uint8Array(await audio.arrayBuffer()));
      }
      const checked = await validateWordListFiles(files, { allowMissing: true });
      if (checked.dataset.bookSlug !== bookSlug) throw new Error("The selected package belongs to another book.");
      const groups = componentGroups(checked.dataset, componentSlug);
      const existing = status.record?.mappings || [];
      const mappings = groups.map((group) => ({ group, pageIds: existing.find((mapping) => mapping.group === group)?.pageIds || [] }));
      const component = componentSlug.slice(bookSlug.length + 1);
      const used = new Set(checked.dataset.entries.filter((entry) => entry.memberships.some((m) => m.component === component)).map((entry) => entry.audioPath));
      const bindings = status.record?.bindings || [];
      const missing = checked.missing.filter((path) => used.has(path) && !bindings.some((binding) => binding.path === path && binding.sourceId === status.sourceId));
      if (alive.current && sequence === validationSequence.current) { setPreview({ ...checked, files, missing, mappings, used, diff: portableDiff(status.record?.dataset, checked.dataset) }); setDirty(true); }
    } catch (err) { if (alive.current && sequence === validationSequence.current) setError(err.message); }
  };
  const save = async () => {
    if (!preview || busy || preview.missing.length || preview.diff.omitted) return;
    if (!pending.current && !window.confirm("Confirm Word List import and the reviewed page mappings? Only Word List records and pronunciation audio will be saved.")) return;
    const controller = new AbortController(); run.current = controller; setBusy(true); setError("");
    try {
      const plan = pending.current ||= { id: crypto.randomUUID(), finalizeId: crypto.randomUUID(), sourceId: status.sourceId || crypto.randomUUID(),
        body: { expectedRevision: status.revision, targetSource: status.target.reference, dataset: preview.dataset, mappings: preview.mappings }, uploads: new Map() };
      const begin = await post(`${componentBase}/begin`, { ...plan.body, sourceId: plan.sourceId, clientMutationId: plan.id }, controller.signal);
      plan.sessionId = begin.sessionId;
      const session = await api(`${componentBase}/session/${plan.sessionId}`, { signal: controller.signal });
      if (session.state !== "complete") {
        const audio = preview.dataset.audio.filter((entry) => preview.used.has(entry.path));
        for (const [index, descriptor] of audio.entries()) {
          controller.signal.throwIfAborted(); if (!alive.current) return;
          setProgress(`Verified upload ${index + 1} of ${audio.length}`);
          if (session.uploaded.includes(descriptor.sha256)) continue;
          const bytes = preview.files.get(descriptor.path); if (!bytes) throw new Error("Required audio must be selected again.");
          if (!plan.uploads.has(descriptor.sha256)) plan.uploads.set(descriptor.sha256, crypto.randomUUID());
          await api(`${componentBase}/upload/${plan.sessionId}?${new URLSearchParams({ sha256: descriptor.sha256, clientMutationId: plan.uploads.get(descriptor.sha256) })}`,
            { method: "POST", signal: controller.signal, headers: { "Content-Type": "audio/mpeg" }, body: bytes });
        }
        controller.signal.throwIfAborted();
        await post(`${componentBase}/finalize/${plan.sessionId}`, { clientMutationId: plan.finalizeId }, controller.signal);
      }
      if (alive.current) { setProgress("Word List saved. Page readiness is evaluated separately."); setPreview(null); setDirty(false); pending.current = null; await refresh(); }
    } catch (err) { if (alive.current) setError(err.name === "AbortError" ? "Upload paused. Retry checks the saved session before continuing." : `${err.message}. Retry checks the same session; no partial list is active.`); }
    finally { if (alive.current) setBusy(false); run.current = null; }
  };
  const editMapping = (group, pageIds) => {
    if (pageIds.length > 2) { setError("Select at most two stable page IDs per group."); return; }
    pending.current = null; setDirty(true); setPreview((value) => ({ ...value, mappings: value.mappings.map((mapping) => mapping.group === group ? { ...mapping, pageIds } : mapping) }));
  };
  const editSaved = () => {
    const dataset = status.record.dataset;
    setPreview({ dataset, files: new Map(), missing: [], used: new Set(status.record.bindings.map((binding) => binding.path)),
      mappings: structuredClone(status.record.mappings), diff: portableDiff(dataset, dataset) }); setDirty(true); pending.current = null;
  };
  const publication = async (action, body) => {
    setBusy(true); setError("");
    try { await post(`${base}/${action}`, { clientMutationId: crypto.randomUUID(), ...body }); await refresh(); }
    catch (err) { if (alive.current) setError(err.message); } finally { if (alive.current) setBusy(false); }
  };
  const openReview = async (context) => {
    try { const value = await loadWordList(context); setReview({ ...value, context }); } catch (err) { setError(err.message); }
  };
  return <section aria-label="Word Lists" className="edition-workspace">
    <h3>Word Lists</h3>
    <p>{bookSlug} · {componentSlug} · {editionId}. English audio only. This area does not change activities or pages.</p>
    {error && <p role="alert">{error}</p>}{progress && <p role="status">{progress}</p>}
    {!status ? <p>Word List source is unavailable or loading. Associate an explicit component source first.</p> : <>
      <fieldset disabled={busy}><legend>Local package preview</legend>
        <label>Word List package<input aria-label="Word List package" type="file" accept=".zip,.json" onChange={(event) => { selected.current.package = event.target.files[0]; validate(); }} /></label>
        <label>Separate audio files<input aria-label="Separate audio files" type="file" accept=".mp3" multiple onChange={(event) => { selected.current.audio = [...event.target.files]; validate(); }} /></label>
        <p>Selecting files validates locally. Upload starts only after confirmation.</p>
        {status.record && <><button onClick={editSaved}>Edit saved Word List mappings</button>
          <button onClick={() => openReview({ kind: "draft", bookSlug, editionId, componentSlug })}>Review Word List draft</button></>}
      </fieldset>
      {preview && <fieldset disabled={busy}><legend>Review import and mappings</legend>
        <p>{preview.dataset.entries.length} entries · Languages: {preview.dataset.languages.join(", ")} · Missing audio: {preview.missing.length}</p>
        <p>Proposed membership: {preview.dataset.entries.filter((entry) => entry.memberships.some((m) => m.component === "students-book")).length} Students Book,
          {" "}{preview.dataset.entries.filter((entry) => entry.memberships.some((m) => m.component === "workbook")).length} Workbook. These are source groups, not page mappings.</p>
        <p>New: {preview.diff.added} · Changed: {preview.diff.changed} · Unchanged: {preview.diff.unchanged} · Omitted: {preview.diff.omitted} (omissions block import)</p>
        <p>Duplicate original IDs retained: {preview.dataset.entries.length - new Set(preview.dataset.entries.map((entry) => entry.originalId)).size}.
          Unsupported memberships retained: {new Set(preview.dataset.entries.flatMap((entry) => entry.memberships.filter((m) => m.component === "unsupported").map((m) => m.group))).size}.</p>
        <p>Unresolved required groups: {preview.mappings.filter((mapping) => !mapping.pageIds.length).length}. Saved manual mappings are preserved; no page labels are used as identities.</p>
        <div style={{ maxHeight: "22rem", overflow: "auto" }}>{preview.mappings.map((mapping) => <label key={mapping.group} style={{ display: "block" }}>{mapping.group}
          <select multiple aria-label={`Pages for ${mapping.group}`} value={mapping.pageIds} onChange={(event) => editMapping(mapping.group, [...event.target.selectedOptions].map((option) => option.value))}>
            {status.target.pages.map((page) => <option key={page.id} value={page.id}>{page.label} · {page.id}</option>)}
          </select></label>)}</div>
        <p>Confirmation saves this dataset, component-owned audio bindings and the mappings shown above. Incomplete mappings stay a draft.</p>
        <button disabled={preview.missing.length > 0 || preview.diff.omitted > 0} onClick={save}>{pending.current ? "Retry confirmed import" : "Confirm Word List import"}</button>
        <button onClick={() => { setPreview(null); pending.current = null; setDirty(false); }}>Discard local preview</button>
      </fieldset>}
      {busy && run.current && <button onClick={() => run.current.abort()}>Pause uploads</button>}
      {!busy && pending.current?.sessionId && <button onClick={async () => {
        setBusy(true);
        try { await post(`${componentBase}/cancel/${pending.current.sessionId}`, { clientMutationId: crypto.randomUUID() });
          if (alive.current) { pending.current = null; setPreview(null); setDirty(false); setProgress("Staged import cancelled. Existing content is unchanged."); }
        } catch (err) { if (alive.current) setError(err.message); } finally { if (alive.current) setBusy(false); }
      }}>Cancel staged import</button>}
      <fieldset disabled={busy || Boolean(preview)}><legend>Edition candidate with Word Lists (v2)</legend>
        <button onClick={() => publication("prepare", { expectedRevision: status.selectionRevision })}>Prepare edition with Word Lists</button>
        {status.releases.map((release) => <div key={release.id}><span>v2 release {release.number}{status.publishedReleaseId === release.id ? " · Published" : " · Candidate"}</span>
          <button onClick={() => openReview({ kind: "candidate", bookSlug, editionId, componentSlug, releaseId: release.id })}>Review immutable Word List {release.number}</button>
          <button onClick={() => publication("publish", { expectedRevision: status.headRevision, releaseId: release.id })}>Publish Word List edition {release.number}</button>
        </div>)}
      </fieldset>
      {review && <section aria-label="Word List data review"><h4>{review.context.kind} · {review.state}</h4>
        <div style={{ maxHeight: "20rem", overflow: "auto" }}><table><tbody>{review.wordlist?.entries.map((entry) => <tr key={entry.id}>
          <td>{entry.displayNumber}</td><td>{String(entry.english.word)}</td><td>{entry.translations.el || ""}</td>
          <td><audio controls preload="none" src={wordListAudioUrl(review.context, entry.audioSha256)} /></td>
        </tr>)}</tbody></table></div></section>}
    </>}
  </section>;
}
