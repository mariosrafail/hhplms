import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hostedBuilderHash } from "../book-builder/hosted/hostedBuilderRouter.js";
import { publicationReadinessPresentation } from "../book-builder/hosted/builderReviewModel.js";
import { useBuilderReview } from "../book-builder/hosted/HostedPackageReview.jsx";

import { findProductBook } from "../../data/bookProductCatalog.js";

async function request(endpoint, path = "", options = {}) {
  const response = await fetch(`${endpoint}${path}`, { credentials: "same-origin", cache: "no-store", ...options, headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload.error || "Publication request failed."); error.code = payload.error; error.payload = payload; throw error; }
  return payload;
}

const short = (value) => value ? String(value).slice(0, 12) : "—";
const date = (value) => value ? new Date(value).toLocaleString() : "—";

function ActivityInclusion({ entries }) {
  if (!Array.isArray(entries)) return null;
  const reason = (entry) => ({ included: "Included", no_authored_hotspot: "No authored hotspot", placement_unavailable: "Page unavailable", native_activity_not_found: "Public or Teacher document missing" }[entry.reason] || entry.reason.replaceAll("_", " "));
  return <section className="publication-history" aria-label="Students Book activity inclusion"><h2>Saved Draft activity inclusion</h2><p>Every active activity is listed. Only ready activities linked by authored hotspots enter the next preview.</p>{entries.length ? <table><thead><tr><th>Activity</th><th>Page</th><th>Hotspot</th><th>Next preview</th><th>Reason</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.activityId}><td>{entry.activityId}</td><td>{entry.unplaced ? "Unavailable placement" : entry.pageId}</td><td>{entry.linked ? "Linked" : "Unlinked"}</td><td>{entry.included ? "Included" : "Excluded"}</td><td>{reason(entry)}</td></tr>)}</tbody></table> : <p>No active native activities.</p>}</section>;
}

function PublicationBlocked({ failure, bookSlug, componentSlug }) {
  if (!failure) return null;
  return <section className="publication-blocked" role="alert">
    <span>Saved content is incomplete</span>
    <h2>{failure.title}</h2>
    {failure.activityId ? <p>Activity: <code>{failure.activityId}</code></p> : null}
    <h3>Issues</h3>
    <ul>{failure.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
    <ActivityInclusion entries={failure.reconciliation} />
    <a className="hosted-builder-action" href={hostedBuilderHash({ bookSlug, componentSlug, tool: "activities" })}>Open in Activity Builder</a>
  </section>;
}

const componentTitle = (slug) => slug.endsWith("-students-book") ? "Students Book" : slug.endsWith("-workbook") ? "Workbook" : slug.endsWith("-grammar-book") ? "Grammar Book" : slug;

function ReleaseMembers({ release }) {
  return <div className="publication-member-grid">{release.members.map((member) => <section key={member.componentSlug} data-member-status={member.status}>
    <span>{componentTitle(member.componentSlug)}</span>
    {member.status === "included" ? <><strong>Included exactly</strong><small>{member.assetStorageMode === "pinned-source-v1" ? "Frozen from Saved Draft" : "Immutable materialized asset set"}</small><small>{member.compilerId} · schema {member.releaseSchemaVersion}</small><code>{short(member.releaseSha256)}</code></> : <><strong>Unavailable</strong><small>{member.unavailableReason === "not_in_legacy_release" ? `Not included in historical Release #${release.number}` : member.unavailableReason}</small></>}
  </section>)}</div>;
}

export function HostedPublicationWorkspace({ bookSlug = "ultimate-b2", componentSlug = "ultimate-b2-students-book" }) {
  return <PublicationWorkspace key={bookSlug + "/" + componentSlug} bookSlug={bookSlug} componentSlug={componentSlug} />;
}

function PublicationWorkspace({ bookSlug, componentSlug }) {
  const endpoint = "/builder/api/publication/books/" + encodeURIComponent(bookSlug);
  const bookTitle = findProductBook(bookSlug)?.title || bookSlug;
  const lifetime = useRef(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  const call = useCallback((path = "", options = {}) => request(endpoint, path, { ...options, signal: lifetime.current?.signal }), [endpoint]);
  const { registerToolContext } = useBuilderReview();
  const [status, setStatus] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [publicationFailure, setPublicationFailure] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const next = await call();
      setStatus(next); setPublicationFailure(null);
      setSelectedId((current) => current && next.releases.some((release) => release.id === current) ? current : next.releases[0]?.id || "");
    } catch (error) {
      const failure = publicationReadinessPresentation(error);
      setPublicationFailure(failure && { ...failure, reconciliation: error.payload?.reconciliation });
      if (!failure && error.name !== "AbortError") setMessage(error.code === "publication_schema_unavailable" ? "Publication is waiting for the required database schema. No release is available to prepare or publish." : error.message);
      throw error;
    }
  }, [call]);
  useEffect(() => { refresh().catch(() => {}); }, [refresh]);
  const selected = useMemo(() => status?.releases.find((release) => release.id === selectedId) || null, [selectedId, status]);
  useEffect(() => {
    registerToolContext("publication", {
      view: "page",
      dirty: false,
      refreshKey: status?.components?.map((component) => component.currentSourceSha256).join(":") || 0,
      release: selected ? {
        id: selected.id,
        productReleaseId: selected.id,
        number: selected.number,
        state: selected.state,
        sourceSnapshotSha256: selected.sourceSnapshotSha256,
        members: selected.members,
        reviewPages: selected.reviewPages,
      } : null,
    });
  }, [registerToolContext, selected, status?.components]);
  const prepare = async () => {
    setBusy("prepare"); setMessage(""); setPublicationFailure(null);
    try {
      const result = await call("/prepare", { method: "POST", body: JSON.stringify({ clientMutationId: crypto.randomUUID(), releaseNote: "" }) });
      setMessage(`Product preview release ${result.releaseNumber} prepared with ${status.components.length} required components.`);
      await refresh(); setSelectedId(result.productReleaseId);
    } catch (error) {
      if (error.code === "release_asset_unavailable") setMessage("A referenced immutable asset could not be verified. No release was created.");
      else if (error.code === "release_pin_schema_unavailable") setMessage("Publication Freeze v2 is waiting for migration 049. Saved Draft and historical Review remain available.");
      else if (["release_pin_conflict", "release_pin_integrity_failed"].includes(error.code)) setMessage("Saved Draft assets could not be frozen consistently. No release was created.");
      else if (error.code?.startsWith("native_activity_") || error.code === "placement_unavailable") { const failure = publicationReadinessPresentation(error); setPublicationFailure(failure && { ...failure, reconciliation: error.payload?.reconciliation }); }
      else if (error.code === "managed_page_not_ready") setMessage("A page in the saved product is incomplete. No product release was created.");
      else if (error.code === "publication_schema_unavailable") setMessage("Product publication is waiting for the required database schema. No release was created.");
      else setMessage(error.message);
    }
    finally { setBusy(""); }
  };
  const publish = async () => {
    if (!selected || selected.state !== "current" || selected.compilerId !== status.compilerId) return;
    if (!globalThis.confirm(`Publish ${bookTitle} product release ${selected.number}? ${status.components.map((entry) => componentTitle(entry.componentSlug)).join(", ")} will move together to this exact immutable preview.`)) return;
    setBusy("publish"); setMessage("");
    try {
      await call("/publish", { method: "POST", body: JSON.stringify({ productReleaseId: selected.id, expectedHeadRevision: status.headRevision, clientMutationId: crypto.randomUUID() }) });
      setMessage(`Product Release ${selected.number} is now published.`); await refresh();
    } catch (error) { setMessage(error.code === "stale_release_preview" ? "This preview is stale. Prepare and review a new preview before publishing." : error.message); await refresh().catch(() => {}); }
    finally { setBusy(""); }
  };
  if (!status) return <main className="publication-workspace">{publicationFailure ? <PublicationBlocked failure={publicationFailure} bookSlug={bookSlug} componentSlug={componentSlug} /> : <p role="status">{message || "Loading publication state…"}</p>}</main>;
  return <main className="publication-workspace">
    <header><span>{bookTitle} · Product</span><h1>Publication</h1><p>{status.components.map((entry) => componentTitle(entry.componentSlug)).join(", ")} are required and move together in one immutable product release.</p></header>
    <div className="publication-summary">
      <section><h2>Current saved product</h2><strong>{status.published?.state === "current" ? "Matches published release" : "Contains unpublished changes"}</strong><span>{status.components.length} required components</span></section>
      <section><h2>Current published</h2>{status.published ? <><strong>Release {status.published.number}</strong><span>{date(status.published.publishedAt)}</span><code>{short(status.published.releaseSha256)}</code></> : <strong>No release published yet</strong>}</section>
      <section><h2>Preview release</h2>{selected ? <><strong>Release {selected.number} · {selected.state === "current" ? "Current" : "Stale"}</strong><span>{selected.compilerId} · schema {selected.releaseSchemaVersion}</span><span>{date(selected.createdAt)}</span><code>{short(selected.releaseSha256)}</code></> : <strong>No preview prepared</strong>}</section>
    </div>
    {selected ? <section className="publication-members"><h2>Exact release members</h2><ReleaseMembers release={selected} /></section> : null}
    <ActivityInclusion entries={status.components.find((component) => component.componentSlug === "ultimate-b2-students-book")?.reconciliation} />
    <section aria-label="Required component readiness">{status.components.map((entry) => <p key={entry.componentSlug}><strong>{componentTitle(entry.componentSlug)}:</strong> {entry.ready === false ? entry.blocker.message : "Saved content ready for preparation"}</p>)}</section>
    <div className="publication-actions"><button type="button" disabled={Boolean(busy) || status.components.some((entry) => entry.ready === false)} onClick={prepare}>{busy === "prepare" ? "Preparing…" : "Prepare Preview"}</button><button type="button" disabled={!selected || selected.state !== "current" || selected.compilerId !== status.compilerId || Boolean(busy)} onClick={publish}>{busy === "publish" ? "Publishing…" : "Publish Preview"}</button>{message ? <p role="status">{message}</p> : null}</div>
    <PublicationBlocked failure={publicationFailure} bookSlug={bookSlug} componentSlug={componentSlug} />
    <section className="publication-history"><h2>Product release history</h2><table><thead><tr><th>Release</th><th>Members</th><th>Fingerprint</th><th>Created</th><th>Status</th></tr></thead><tbody>{status.releases.map((release) => <tr key={release.id}><td><button type="button" onClick={() => setSelectedId(release.id)}>#{release.number}</button></td><td>{release.members.map((member) => `${componentTitle(member.componentSlug)}: ${member.status}`).join(" · ")}</td><td><code>{short(release.releaseSha256)}</code></td><td>{date(release.createdAt)}</td><td>{release.current ? "Published" : release.state === "current" ? "Preview current" : release.state === "historical" ? "Historical" : "Stale"}</td></tr>)}</tbody></table></section>
  </main>;
}
