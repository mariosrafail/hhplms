import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { HostedViewerPreview } from "./HostedViewerPreview.jsx";
import { hostedBuilderReviewHash } from "./hostedBuilderRouter.js";
import { resolveUnifiedReviewIntent } from "./builderReviewModel.js";

const BuilderReviewContext = createContext(null);
const defaultToolContext = Object.freeze({ view: "page", dirty: false, refreshKey: 0, release: null });
const sameContext = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function useBuilderReview() {
  const value = useContext(BuilderReviewContext);
  if (!value) throw new Error("Builder Review must be used inside HostedPackageReview.");
  return value;
}

const pageLabel = (page) => `Unit ${page.unitNumber} · ${page.pageLabel} · ${page.sectionTitle}`;

export function HostedPackageReview({ tool, pages, selectedPageId = "", bookSlug, componentSlug, children }) {
  const normalizedPages = useMemo(() => [...(pages || [])], [pages]);
  const [toolContexts, setToolContexts] = useState({});
  const [lastPages, setLastPages] = useState({});
  const [session, setSession] = useState({ sourceMode: "draft", toolContext: defaultToolContext, pageId: "" });
  const [viewerStarted, setViewerStarted] = useState(false);
  const launcherRef = useRef(null);
  const dialogRef = useRef(null);
  const contextKey = `${componentSlug}/${tool}`;

  const registerToolContext = useCallback((toolId, nextContext) => {
    const key = `${componentSlug}/${toolId}`;
    setToolContexts((current) => sameContext(current[key], nextContext) ? current : { ...current, [key]: nextContext });
  }, [componentSlug]);
  const rememberPage = useCallback((pageId) => {
    if (normalizedPages.some((page) => page.pageId === pageId)) setLastPages((current) => ({ ...current, [componentSlug]: pageId }));
  }, [componentSlug, normalizedPages]);

  useEffect(() => {
    setLastPages((current) => {
      const remembered = current[componentSlug];
      const next = selectedPageId && normalizedPages.some((page) => page.pageId === selectedPageId)
        ? selectedPageId
        : normalizedPages.some((page) => page.pageId === remembered) ? remembered : normalizedPages[0]?.pageId || "";
      return remembered === next ? current : { ...current, [componentSlug]: next };
    });
  }, [componentSlug, normalizedPages, selectedPageId]);

  const lastPageId = lastPages[componentSlug] || normalizedPages[0]?.pageId || "";
  const lastPage = normalizedPages.find((page) => page.pageId === lastPageId) || normalizedPages[0] || null;
  const currentContext = toolContexts[contextKey] || defaultToolContext;
  const memberAvailable = useCallback((release) => !release?.members || release.members.some((member) => member.componentSlug === componentSlug && member.status === "included"), [componentSlug]);
  const nextSession = useCallback(() => {
    const sourceMode = tool === "publication" && currentContext.release && memberAvailable(currentContext.release) ? "release" : "draft";
    const candidates = sourceMode === "release" ? currentContext.release.reviewPages?.[componentSlug] || normalizedPages : normalizedPages;
    const contextPage = candidates.find((page) => page.pageId === currentContext.pageId) || candidates.find((page) => page.pageId === lastPage?.pageId) || candidates[0];
    return { sourceMode, toolContext: currentContext, pageId: contextPage?.pageId || "" };
  }, [componentSlug, currentContext, lastPage, memberAvailable, normalizedPages, tool]);
  const openReview = useCallback(() => {
    setSession(nextSession());
    setViewerStarted(true);
    if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, [nextSession]);
  const closeReview = useCallback(() => {
    if (dialogRef.current?.open) dialogRef.current.close();
    globalThis.requestAnimationFrame?.(() => launcherRef.current?.focus());
  }, []);
  useEffect(() => { if (dialogRef.current?.open) setSession(nextSession()); }, [bookSlug, componentSlug, contextKey, nextSession]);

  const reviewPages = session.sourceMode === "release" ? session.toolContext?.release?.reviewPages?.[componentSlug] || normalizedPages : normalizedPages;
  const selectedPage = reviewPages.find((page) => page.pageId === session.pageId) || reviewPages[0] || null;
  const release = session.toolContext?.release || null;
  const releaseMemberAvailable = memberAvailable(release);
  const releaseMember = release?.members?.find((candidate) => candidate.componentSlug === componentSlug) || null;
  const intent = session.sourceMode === "draft" || selectedPage ? resolveUnifiedReviewIntent({ sourceMode: session.sourceMode, toolContext: session.toolContext, page: selectedPage, release }) : null;
  const sourceTitle = session.sourceMode === "release" && release ? `Review · Release #${release.number} · Immutable` : "Review · Saved Draft";
  const value = useMemo(() => ({ lastPage, pages: normalizedPages, launcherRef, openReview, registerToolContext, rememberPage }), [lastPage, normalizedPages, openReview, registerToolContext, rememberPage]);

  return <BuilderReviewContext.Provider value={value}>
    {children}
    <button className="unified-builder-review-launcher" data-unified-review-launcher="true" ref={launcherRef} type="button" onClick={openReview}>Review</button>
    <dialog className="unified-builder-review-dialog" ref={dialogRef} aria-modal="true" aria-labelledby="unified-builder-review-title" onCancel={(event) => { event.preventDefault(); closeReview(); }}>
      <div className="unified-builder-review-panel">
        <header><div><span>Canonical deployed Viewer</span><h2 id="unified-builder-review-title">{sourceTitle}</h2></div><button type="button" onClick={closeReview}>Close Review</button></header>
        <div className="unified-builder-review-controls">
          <div role="group" aria-label="Review source"><button type="button" aria-pressed={session.sourceMode === "draft"} onClick={() => setSession((current) => ({ ...current, sourceMode: "draft" }))}>Saved Draft</button><button type="button" aria-pressed={session.sourceMode === "release"} disabled={!release || !releaseMemberAvailable} title={release && !releaseMemberAvailable ? `This component was not included in historical Release #${release.number}.` : undefined} onClick={() => setSession((current) => ({ ...current, sourceMode: "release" }))}>{release ? releaseMemberAvailable ? `Release #${release.number} · Immutable` : `Unavailable in Release #${release.number}` : "No release prepared"}</button></div>
          {session.sourceMode === "release" && intent?.view === "page" ? <label>Review page<select value={selectedPage?.pageId || ""} onChange={(event) => { const pageId = event.target.value; rememberPage(pageId); setSession((current) => ({ ...current, pageId })); }}>{reviewPages.map((page) => <option key={page.pageId} value={page.pageId}>{pageLabel(page)}</option>)}</select></label> : null}
        </div>
        <div className="unified-builder-review-messages">
          {session.toolContext.dirty && session.sourceMode === "draft" ? <p className="unified-builder-review-notice" role="status">Unsaved changes are not included in Review. Save them first.</p> : null}
          {release && !releaseMemberAvailable ? <p className="unified-builder-review-notice" role="status">{releaseMember?.unavailableReason === "not_in_legacy_release" ? `This component was not included in historical Release #${release.number}.` : `This component is unavailable in Release #${release.number}.`}</p> : null}
          {session.sourceMode === "release" && release?.state === "stale" ? <p className="unified-builder-review-notice" role="status">Release #{release.number} is immutable and older than the current saved draft.</p> : null}
          {session.sourceMode === "release" && release?.state !== "stale" ? <p className="unified-builder-review-immutable" role="status">This is the exact immutable release projection. Later Builder saves cannot change it.</p> : null}
        </div>
        {intent ? <HostedViewerPreview active={viewerStarted} intent={intent} bookSlug={bookSlug} componentSlug={componentSlug} openPlayerHref={hostedBuilderReviewHash({ bookSlug, componentSlug, intent })} refreshKey={`${session.toolContext.refreshKey || 0}:${session.sourceMode === "release" ? session.pageId : "product-library"}:${session.sourceMode}`} title={sourceTitle} description={session.sourceMode === "release" ? "Pinned to the exact selected release." : "Opens the package Viewer with the latest successfully saved Builder state."} /> : <p role="status">No pages are available for Review in this component.</p>}
      </div>
    </dialog>
  </BuilderReviewContext.Provider>;
}

export const UnifiedBuilderReview = HostedPackageReview;
export default HostedPackageReview;
