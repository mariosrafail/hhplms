import { useEffect, useMemo, useRef, useState } from "react";
import { contentEditionBooks, editionLabels } from "../../../data/contentEditions.js";
import { PublishedNativeTeacherActivityRunner } from "../../../components/lms/activities/ultimate-b2/PublishedNativeTeacherActivityRunner.jsx";
import "./hostedEditions.css";
import { HostedWordListWorkspace } from "./HostedWordListWorkspace.jsx";

const pathFor = (bookSlug, editionId) => `/builder/api/publication/editions/books/${bookSlug}/editions/${editionId}`;
async function request(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options });
  const value = await response.json();
  if (!response.ok) throw new Error(value.detail || value.error || "Edition content is unavailable.");
  return value;
}
function EditionReview({ bookSlug, editionId, release }) {
  const [componentSlug, setComponent] = useState(`${bookSlug}-students-book`);
  const [pageId, setPage] = useState(""); const [activityId, setActivity] = useState("");
  const base = `${pathFor(bookSlug, editionId)}/releases/${release.id}`;
  const member = release.members.find((entry) => entry.reference.componentSlug === componentSlug);
  const projection = member.publicProjection;
  const page = projection.pages.find((entry) => entry.id === pageId) || projection.pages[0];
  const assetPath = (asset) => `${base}?${new URLSearchParams({ componentSlug, assetSha256: asset.sha256,
    assetRole: asset.role, extension: asset.extension })}`;
  const delivery = useMemo(() => ({
    async loadTeacher(_publication, id, { signal }) {
      const value = await request(`${base}?${new URLSearchParams({ componentSlug, teacherActivityId: id })}`, { signal });
      if (value.releaseId !== release.id || value.edition.editionId !== editionId || value.edition.bookSlug !== bookSlug) throw new Error("Edition review identity mismatch.");
      return value.document;
    },
    assetUrl(_publication, reference) {
      const descriptor = projection.assets.find((asset) => asset.sha256 === reference?.checksumSha256 && asset.role === reference.role);
      return descriptor ? assetPath(descriptor) : "";
    },
    teacherAssetUrl(_publication, id, sectionId) {
      return `${base}?${new URLSearchParams({ componentSlug, teacherAssetActivityId: id, ...(sectionId ? { sectionId } : {}) })}`;
    },
  }), [base, componentSlug, projection, release.id, editionId, bookSlug]);
  const activity = projection.nativeActivities[activityId];
  const publication = useMemo(() => ({ kind: "published", releaseId: release.id, projection }), [release.id, projection]);
  return <section className="edition-review" aria-label="Immutable edition review">
    <h3>{editionLabels[editionId]} · Release {release.number} · Immutable</h3>
    <label>Review component<select aria-label="Review component" value={componentSlug} onChange={(event) => { setComponent(event.target.value); setPage(""); setActivity(""); }}>
      {release.members.map((entry) => <option key={entry.reference.componentSlug}>{entry.reference.componentSlug}</option>)}
    </select></label>
    <label>Review page<select aria-label="Review page" value={page?.id || ""} onChange={(event) => { setPage(event.target.value); setActivity(""); }}>
      {projection.pages.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
    </select></label>
    {activity ? <><button onClick={() => setActivity("")}>Back to page</button>
      <PublishedNativeTeacherActivityRunner key={`${editionId}/${release.id}/${componentSlug}/${activityId}`} entry={activity} publication={publication} delivery={delivery} />
    </> : page ? <div className="edition-review-page" style={{ aspectRatio: `${page.image.width} / ${page.image.height}`, width: `min(100%, ${75 * page.image.width / page.image.height}vh)` }}>
      <img src={assetPath(page.image)} alt={page.label} />
      {(projection.hotspots.pages[page.id] || []).map((hotspot) => <button key={hotspot.id} title={hotspot.label} aria-label={hotspot.label}
        style={{ left: `${hotspot.left}%`, top: `${hotspot.top}%`, width: `${hotspot.width}%`, height: `${hotspot.height}%` }}
        onClick={() => setActivity(hotspot.activityKey)} />)}
    </div> : <p>No page was included in this release.</p>}
  </section>;
}
function SourceEditor({ record, busy, onDirty, onSave }) {
  const [inputs, setInputs] = useState(() => structuredClone(record.source.inputs));
  const rows = inputs.pages?.rows || [];
  const edit = (index, field, value) => {
    setInputs((current) => ({ ...current, pages: { ...current.pages, rows: current.pages.rows.map((row, position) => position === index
      ? field === "label" ? { ...row, label: value } : { ...row, source_metadata: { ...row.source_metadata, section_title: value } } : row) } }));
    onDirty(true);
  };
  return <div className="edition-source-editor">
    <p>{record.reference.scope.kind === "shared" ? "Shared source — edits affect future candidates for both International and Greek. Published releases stay unchanged." : "Edition-only source — edits affect this edition’s future candidates."}</p>
    <p>Saved revision {record.reference.revision}</p>
    {rows.map((row, index) => <fieldset key={row.stable_key} disabled={busy}><legend>{row.label}</legend>
      <label>Page label<input value={row.label || ""} onChange={(event) => edit(index, "label", event.target.value)} /></label>
      <label>Section title<input value={row.source_metadata?.section_title || ""} onChange={(event) => edit(index, "section", event.target.value)} /></label>
    </fieldset>)}
    {!rows.length ? <p>This source contains canonical pages. Its captured activities and page geometry are preserved.</p> : null}
    <button disabled={busy} onClick={() => onSave(inputs)}>Save source revision</button>
  </div>;
}
function EditionWorkspace({ book, editionId, busy, dirty, setBusy, setDirty }) {
  const [status, setStatus] = useState(null); const [error, setError] = useState("");
  const [component, setComponent] = useState(`${book.slug}-students-book`);
  const [scope, setScope] = useState("edition"); const [sourceId, setSource] = useState("");
  const [review, setReview] = useState(null); const mounted = useRef(true);
  const [wordListDirty, setWordListDirty] = useState(false);
  const sourceDirty = useRef(false);
  const markSourceDirty = (value) => { sourceDirty.current = value; setDirty(value || wordListDirty); };
  const markWordListDirty = (value) => { setWordListDirty(value); setDirty(value || sourceDirty.current); };
  const clearDirty = () => { sourceDirty.current = false; setWordListDirty(false); setDirty(false); };
  const base = pathFor(book.slug, editionId);
  const load = async () => { const value = await request(base); if (mounted.current) setStatus(value); };
  useEffect(() => { mounted.current = true; const controller = new AbortController();
    request(base, { signal: controller.signal }).then(setStatus).catch((err) => { if (err.name !== "AbortError") setError(err.message); });
    return () => { mounted.current = false; controller.abort(); };
  }, [base]);
  const run = async (action, body, after = null) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await request(`${base}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientMutationId: crypto.randomUUID(), ...body }) });
      if (mounted.current) { clearDirty(); await load(); after?.(result); }
    } catch (err) { if (mounted.current) setError(err.message); }
    finally { if (mounted.current) setBusy(false); }
  };
  const applicable = status?.sources.filter((entry) => entry.reference.componentSlug === component) || [];
  const selected = applicable.find((entry) => entry.reference.sourceId === (sourceId || status?.associations[component]));
  const identity = { componentSlug: component };
  return <section className="edition-workspace">
    <h2>{book.title} · {editionLabels[editionId]}</h2>
    <p>Content edition is independent of interface language, Teacher/Student role and temporary translation visibility.</p>
    {error ? <p role="alert">{error}</p> : null}
    {!status ? <p role="status">{error ? "Edition sources are unavailable." : "Loading edition sources…"}</p> : <>
      <ul>{status.readiness.map((entry) => <li key={entry.componentSlug}>{entry.componentSlug}: {entry.ready ? `${entry.source.scope.kind} source · revision ${entry.source.revision}` : "Not configured — required source missing"}</li>)}</ul>
      <fieldset disabled={busy}><legend>Source association</legend>
        <label>Component<select aria-label="Component" value={component} onChange={(event) => { if (!window.confirm("Discard any unsaved source edits and change component?")) return; setComponent(event.target.value); setSource(""); clearDirty(); }}>
          {contentEditionBooks[book.slug].components.map((slug) => <option key={slug}>{slug}</option>)}
        </select></label>
        <label>Source<select aria-label="Source" value={selected?.reference.sourceId || ""} onChange={(event) => { if (!window.confirm("Discard any unsaved source edits and select this source?")) return; setSource(event.target.value); clearDirty(); }}>
          <option value="">No source selected</option>{applicable.map((entry) => <option key={entry.reference.sourceId} value={entry.reference.sourceId}>{entry.reference.scope.kind} · {entry.reference.sourceId} · revision {entry.reference.revision}</option>)}
        </select></label>
        <button disabled={!selected || dirty} onClick={() => run("associate", { ...identity, sourceId: selected.reference.sourceId, expectedRevision: status.selectionRevision })}>Associate selected source</button>
        <label>New source scope<select aria-label="New source scope" value={scope} onChange={(event) => setScope(event.target.value)}><option value="edition">{editionLabels[editionId]} only</option><option value="shared">Shared: International and Greek</option></select></label>
        <p>Capture explicitly copies the current unclassified component draft into a new source. It does not change the existing draft or associate it automatically.</p>
        <button disabled={dirty} onClick={() => run("capture", { ...identity, sourceId: crypto.randomUUID(), expectedRevision: 0,
          scope: scope === "shared" ? { kind: "shared", editionIds: ["international", "greek"] } : { kind: "edition", editionIds: [editionId] } }, (result) => setSource(result.sourceId))}>Capture current component draft</button>
      </fieldset>
      {selected ? <SourceEditor key={`${selected.reference.sourceId}/${selected.reference.revision}`} record={selected} busy={busy || wordListDirty} onDirty={markSourceDirty}
        onSave={(inputs) => run("save-source", { ...identity, sourceId: selected.reference.sourceId, scope: selected.reference.scope, expectedRevision: selected.reference.revision, inputs })} /> : null}
      <fieldset disabled={busy || dirty}><legend>Edition publication</legend>
        <button disabled={status.readiness.some((entry) => !entry.ready)} onClick={() => run("prepare", { expectedRevision: status.selectionRevision })}>Prepare {editionLabels[editionId]} candidate</button>
        {status.releases.map((release) => <div key={release.id}><span>Release {release.number}{status.publishedReleaseId === release.id ? " · Published" : " · Candidate"}</span>
          <button onClick={() => setReview(release)}>Review immutable release {release.number}</button>
          <button onClick={() => run("publish", { expectedRevision: status.headRevision, releaseId: release.id })}>Publish release {release.number}</button>
        </div>)}
      </fieldset>
      {!component.endsWith("grammar-book") && status.associations[component] ? <HostedWordListWorkspace
        key={`${editionId}/${component}/${status.associations[component]}`} bookSlug={book.slug} editionId={editionId} componentSlug={component}
        busy={busy || sourceDirty.current} setBusy={setBusy} setDirty={markWordListDirty} /> : null}
      {review ? <EditionReview key={review.id} bookSlug={book.slug} editionId={editionId} release={review} /> : null}
    </>}
  </section>;
}
export function HostedEditionSelection({ book, children, canSelect = true }) {
  const [editionId, setEdition] = useState(""); const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { const guard = (event) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty, busy]);
  if (!contentEditionBooks[book.slug]) return children;
  return <><div className="edition-selection"><label>Content edition<select aria-label="Content edition" value={editionId} disabled={busy || !editionId && !canSelect} onChange={(event) => {
    if (dirty && !window.confirm("Discard unsaved source changes and change content edition?")) return;
    setDirty(false); setEdition(event.target.value);
  }}><option value="">Existing content · Unclassified</option>{contentEditionBooks[book.slug].editions.map((id) => <option key={id} value={id}>{editionLabels[id]}</option>)}</select></label>
    {busy ? <span role="status">Saving current edition…</span> : !editionId && !canSelect ? <span>Save your work and return to the book to select a content edition.</span> : null}</div>
    {editionId ? <EditionWorkspace key={`${book.slug}/${editionId}`} book={book} editionId={editionId} busy={busy} dirty={dirty} setBusy={setBusy} setDirty={setDirty} /> : children}</>;
}
