import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Boxes, ChevronDown, ChevronLeft, ChevronRight, FileImage, ListChecks, MessageSquareText, MoveRight, Music, Plus, Search, Trash2, Video } from "lucide-react";

import { nativeActivityKindLabels } from "../../../data/native-activities/nativeActivityKinds.js";
import { BuilderModal } from "./BuilderModal.jsx";
import { createNativeActivity, deleteNativeActivity, getActivityLifecycle, getActivityOrder, reorderActivity, getNativeActivityCatalogResult, moveActivity, retireCanonicalActivity } from "./builderNativeActivityApi.js";
import { NativeActivityFoundationEditor } from "./NativeActivityFoundationEditor.jsx";
import { getBuilderPages } from "./builderPagesApi.js";
import { pageLibraryReviewNavigation } from "./pageLibraryReviewModel.js";
import { activityBuilderSourcePageId, activityBuilderTypeOptions, buildActivityBuilderNavigation, filterActivityBuilderNavigation, findActivityBuilderItem } from "./activityBuilderNavigation.js";
import { useBuilderReview } from "./HostedPackageReview.jsx";
import "../../ultimate-b2-builder/ultimateB2HotspotBuilder.css";
import "../../ultimate-b2-builder/hostedUltimateB2BuilderReview.css";
import "../../ultimate-b2-builder/hostedUltimateB2BuilderModern.css";
import "../../ultimate-b2-builder/studioAuthoring.css";

const kindIcons = { "multi-part": Boxes, "mark-the-words": ListChecks, "open-response": MessageSquareText, image: FileImage, "single-choice": ListChecks, "complete-sentences": ListChecks, listening: MessageSquareText, "oldschool-listening": FileImage, "drag-drop": Boxes };
const kindDescriptions = {
  "multi-part": "Combine typed sections on shared panels, with one activity and one submission.",
  "open-response": "Learners write a free response for Teacher review.",
  image: "Present an authored image with optional guidance.",
  "complete-sentences": "Learners type words or phrases into visual blanks; answers stay Teacher-only.",
  listening: "Learners listen, follow a synchronized transcript, and write responses for Teacher review.",
  "oldschool-listening": "Learners listen while timed highlights and scrolling follow a managed page image.",
  "mark-the-words": "Learners mark individual word occurrences in a passage; answers stay Teacher-only.",
  "single-choice": "Learners choose one answer; the key stays Teacher-only.",
  "drag-drop": "Learners place shared word-bank items onto visual targets; mappings stay Teacher-only.",
};

const EMPTY_UNITS = Object.freeze([]);
const neverEditable = () => false;

function firstAvailableActivityId(lifecycle, nativeActivities, excluded = "", canonicalUnits = EMPTY_UNITS) {
  const retired = lifecycle?.activities || {};
  const canonical = canonicalUnits.flatMap((unit) => (unit.lessons || []).flatMap((lesson) => lesson.exercises || []))
    .find((activity) => activity.stableActivityId !== excluded && retired[activity.stableActivityId]?.status !== "retired");
  return nativeActivities.find((activity) => activity.activityId !== excluded)?.activityId || canonical?.stableActivityId || "";
}

export function HostedActivityWorkspace({
  nativeActivities,
  bookSlug,
  componentSlug,
  bookTitle,
  componentTitle,
  canonicalUnits: configuredCanonicalUnits = EMPTY_UNITS,
  isCanonicalEditable = neverEditable,
  CanonicalEditor = null,
  UnitExtras = null,
}) {
  const { registerToolContext } = useBuilderReview();
  const managed = nativeActivities?.managed === true;
  const [managedNavigation, setManagedNavigation] = useState({ units: [], placements: [] });
  const [activePageIds, setActivePageIds] = useState(null);
  const configuredPlacements = managed ? managedNavigation.placements : nativeActivities?.placements || [];
  const nativePlacements = useMemo(() => activePageIds ? configuredPlacements.filter((placement) => activePageIds.includes(placement.pageId)) : configuredPlacements, [activePageIds, configuredPlacements]);
  const canonicalUnits = managed ? managedNavigation.units : configuredCanonicalUnits;
  const nativeKinds = nativeActivities?.kinds || [];
  const nativeKindsKey = nativeKinds.join("\0");
  const firstId = managed ? "" : configuredCanonicalUnits[0]?.lessons?.[0]?.exercises?.[0]?.stableActivityId || "";
  const initialExpandedPageId = managed ? "" : nativeActivities?.placements?.[0]?.pageId || configuredCanonicalUnits[0]?.lessons?.[0]?.id || "";
  const scopeKey = `${bookSlug}:${componentSlug}`;
  const componentLabel = componentTitle;
  const [selectedId, setSelectedId] = useState(firstId);
  const [dirty, setDirty] = useState(false);
  const [viewerRefresh, setViewerRefresh] = useState(0);
  const [nativeCatalog, setNativeCatalog] = useState([]);
  const [catalogDiagnostics, setCatalogDiagnostics] = useState([]);
  const [catalogReload, setCatalogReload] = useState(0);
  const [lifecycle, setLifecycle] = useState({ schemaVersion: "1.0", activities: {} });
  const [activityOrder, setActivityOrder] = useState(null);
  const [reorderState, setReorderState] = useState({ busy: false, error: "" });
  const [catalogState, setCatalogState] = useState({ status: "loading", error: "" });
  const [addOpen, setAddOpen] = useState(false);
  const [deleteState, setDeleteState] = useState({ open: false, saving: false, error: "" });
  const [moveState, setMoveState] = useState({ open: false, pageId: "", saving: false, error: "", placementRequired: false });
  const [switchTarget, setSwitchTarget] = useState("");
  const [query, setQuery] = useState("");
  const [access, setAccess] = useState("all");
  const [type, setType] = useState("all");
  const [expandedUnits, setExpandedUnits] = useState(() => new Set(managed ? [] : [configuredCanonicalUnits[0]?.id]));
  const [expandedPages, setExpandedPages] = useState(() => new Set([nativePlacements[0]?.pageId || configuredCanonicalUnits[0]?.lessons?.[0]?.id]));
  const [navigationExpanded, setNavigationExpanded] = useState(true);
  const [autoHideNavigation, setAutoHideNavigation] = useState(false);
  const [createState, setCreateState] = useState({ kind: nativeKinds[0] || "", pageId: nativePlacements[0]?.pageId || "", title: "", saving: false, error: "" });
  const [extrasUnit, setExtrasUnit] = useState(null);
  const addTriggerRef = useRef(null);
  const extrasTriggerRef = useRef(null);
  const deleteTriggerRef = useRef(null);
  const navigationShellRef = useRef(null);
  const activityWorkspaceRef = useRef(null);
  const navigationCloseTimerRef = useRef(null);
  const manualNavigationCollapseRef = useRef(false);
  const scopeGenerationRef = useRef(0);
  const model = useMemo(() => buildActivityBuilderNavigation({ units: canonicalUnits, nativeActivities: nativeCatalog, placements: nativePlacements, lifecycle, activePageIds, activityOrder: activityOrder?.pages, isEditable: managed ? neverEditable : isCanonicalEditable }), [activityOrder, activePageIds, canonicalUnits, isCanonicalEditable, lifecycle, managed, nativeCatalog, nativePlacements]);
  const filtered = useMemo(() => filterActivityBuilderNavigation(model, { query, access, type }), [access, model, query, type]);
  const selection = findActivityBuilderItem(model, selectedId);
  const filteredSelection = findActivityBuilderItem(filtered, selectedId);
  const selected = selection?.item && !selection.item.native ? selection.item : null;
  const nativeSelected = selection?.item?.native ? selection.item : null;
  const nativeSelectedPlacement = nativeSelected ? nativePlacements.find((page) => page.pageId === nativeSelected.placement?.pageId) : null;
  const supported = !managed && !nativeSelected && isCanonicalEditable(selectedId);
  const placementFor = (pageId) => nativePlacements.find((page) => page.pageId === pageId);

  useEffect(() => {
    registerToolContext("activities", { view: "activity", activityId: selectedId, ...(nativeSelectedPlacement ? { pageId: nativeSelectedPlacement.pageId, unitNumber: nativeSelectedPlacement.unitNumber } : {}), dirty, refreshKey: viewerRefresh, release: null });
  }, [dirty, nativeSelectedPlacement, registerToolContext, selectedId, viewerRefresh]);
  const loadCatalogs = useCallback(async (signal, generation = scopeGenerationRef.current, requestedScope = scopeKey) => {
    const [nativeResult, currentLifecycle, pageLibrary, currentOrder] = await Promise.all([
      getNativeActivityCatalogResult({ bookSlug, componentSlug }, { signal }),
      getActivityLifecycle({ bookSlug, componentSlug }, { signal }),
      getBuilderPages({ bookSlug, componentSlug }, { signal }),
      getActivityOrder({ bookSlug, componentSlug }, { signal }),
    ]);
    if (signal?.aborted || generation !== scopeGenerationRef.current || requestedScope !== scopeKey) return null;
    if (pageLibrary) {
      const navigation = pageLibraryReviewNavigation(pageLibrary, { bookSlug, componentSlug });
      if (managed) setManagedNavigation(navigation);
      setActivePageIds(pageLibrary.pages.map((page) => page.id));
    }
    setNativeCatalog(nativeResult.activities); setCatalogDiagnostics(nativeResult.invalidActivities);
    setActivityOrder(currentOrder);
    setLifecycle(currentLifecycle.document); return { native: nativeResult.activities, lifecycle: currentLifecycle.document };
  }, [bookSlug, componentSlug, managed, scopeKey]);
  useEffect(() => {
    const controller = new AbortController();
    const generation = scopeGenerationRef.current + 1;
    scopeGenerationRef.current = generation;
    setManagedNavigation({ units: [], placements: [] }); setActivePageIds(null);
    setNativeCatalog([]); setCatalogDiagnostics([]); setActivityOrder(null); setReorderState({ busy: false, error: "" }); setLifecycle({ schemaVersion: "1.0", activities: {} }); setSelectedId(firstId);
    setDirty(false); setViewerRefresh(0); setAddOpen(false); setDeleteState({ open: false, saving: false, error: "" });
    setMoveState({ open: false, pageId: "", saving: false, error: "", placementRequired: false }); setSwitchTarget("");
    setQuery(""); setAccess("all"); setType("all"); setExpandedUnits(new Set(managed ? [] : [configuredCanonicalUnits[0]?.id]));
    setExpandedPages(new Set(initialExpandedPageId ? [initialExpandedPageId] : [])); setCreateState({ kind: nativeKinds[0] || "", pageId: "", title: "", saving: false, error: "" });
    setExtrasUnit(null); setCatalogState({ status: "loading", error: "" });
    loadCatalogs(controller.signal, generation, scopeKey).then((result) => {
      if (result) setCatalogState({ status: "ready", error: "" });
    }).catch(() => {
      if (!controller.signal.aborted && generation === scopeGenerationRef.current) {
        setCatalogState({ status: "error", error: `${componentLabel} activities could not be loaded.` });
      }
    });
    return () => controller.abort();
  }, [catalogReload, componentLabel, firstId, initialExpandedPageId, loadCatalogs, managed, nativeKindsKey, scopeKey]);
  useEffect(() => {
    const query = globalThis.matchMedia?.("(hover: hover) and (pointer: fine)");
    if (!query) return undefined;
    const update = () => { setAutoHideNavigation(query.matches); if (!query.matches) setNavigationExpanded(true); };
    update(); query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  useEffect(() => () => globalThis.clearTimeout(navigationCloseTimerRef.current), []);
  useEffect(() => {
    if (catalogState.status === "ready" && !findActivityBuilderItem(model, selectedId)) {
      const first = firstAvailableActivityId(lifecycle, nativeCatalog, "", canonicalUnits);
      setSelectedId(first);
      const location = findActivityBuilderItem(model, first);
      if (componentSlug === "ultimate-b2-students-book" && location?.unit && location.page) {
        setExpandedUnits((current) => new Set(current).add(location.unit.id));
        setExpandedPages((current) => new Set(current).add(location.page.id));
      }
    }
  }, [canonicalUnits, catalogState.status, componentSlug, lifecycle, model, nativeCatalog, selectedId]);
  useEffect(() => {
    if (nativePlacements.length && !nativePlacements.some((page) => page.pageId === createState.pageId)) setCreateState((current) => ({ ...current, pageId: nativePlacements[0].pageId }));
  }, [createState.pageId, nativePlacements]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    globalThis.addEventListener("beforeunload", warn);
    return () => globalThis.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const selectActivity = (nextId) => {
    if (nextId === selectedId) return;
    if (dirty) { setSwitchTarget(nextId); return; }
    setDirty(false); setSelectedId(nextId);
  };
  const openCreate = () => {
    const currentPageId = activityBuilderSourcePageId(selection);
    setCreateState((current) => ({ ...current, pageId: nativePlacements.some((page) => page.pageId === currentPageId) ? currentPageId : current.pageId, error: "" }));
    setAddOpen(true);
  };
  const submitNativeActivity = async (event) => {
    event.preventDefault(); setCreateState((current) => ({ ...current, saving: true, error: "" }));
    try {
      const generation = scopeGenerationRef.current;
      const created = await createNativeActivity({ bookSlug, componentSlug, kind: createState.kind, pageId: createState.pageId, title: createState.title });
      const refreshed = await loadCatalogs(undefined, generation, scopeKey);
      if (!refreshed) return;
      const createdPlacement = placementFor(createState.pageId);
      const createdUnit = canonicalUnits.find((unit) => unit.unitNumber === createdPlacement?.unitNumber);
      setExpandedPages((current) => new Set(current).add(createState.pageId));
      if (createdUnit) setExpandedUnits((current) => new Set(current).add(createdUnit.id));
      setSelectedId(created.activityId); setQuery(""); setAccess("all"); setType("all"); setAddOpen(false);
      setCreateState((current) => ({ ...current, title: "", saving: false, error: "" }));
    } catch (error) { setCreateState((current) => ({ ...current, saving: false, error: error.message })); }
  };
  const confirmDeleteActivity = async () => {
    if (!selection?.item) return;
    setDeleteState((current) => ({ ...current, saving: true, error: "" }));
    try {
      const generation = scopeGenerationRef.current;
      const identity = { bookSlug, componentSlug, activityId: selection.item.id };
      if (nativeSelected) await deleteNativeActivity(identity);
      else await retireCanonicalActivity({ ...identity, sourcePageId: activityBuilderSourcePageId(selection) });
      const remaining = await loadCatalogs(undefined, generation, scopeKey);
      if (!remaining) return;
      setDirty(false);
      setViewerRefresh((value) => value + 1);
      setSelectedId(firstAvailableActivityId(remaining.lifecycle, remaining.native, selection.item.id, canonicalUnits));
      setDeleteState({ open: false, saving: false, error: "" });
    } catch (error) {
      setDeleteState((current) => ({ ...current, saving: false, error: error.message || "Activity deletion failed." }));
    }
  };
  const confirmMoveActivity = async (event) => {
    event.preventDefault();
    if (!selection?.item) return;
    setMoveState((current) => ({ ...current, saving: true, error: "", placementRequired: false }));
    try {
      const generation = scopeGenerationRef.current;
      await moveActivity({
        bookSlug, componentSlug, activityId: selection.item.id,
        sourcePageId: activityBuilderSourcePageId(selection), destinationPageId: moveState.pageId,
      });
      const refreshed = await loadCatalogs(undefined, generation, scopeKey);
      if (!refreshed) return;
      const destinationPlacement = placementFor(moveState.pageId);
      const destinationUnit = canonicalUnits.find((unit) => unit.unitNumber === destinationPlacement?.unitNumber);
      setExpandedPages((current) => new Set(current).add(moveState.pageId));
      if (destinationUnit) setExpandedUnits((current) => new Set(current).add(destinationUnit.id));
      setDirty(false); setViewerRefresh((value) => value + 1);
      setMoveState((current) => ({ ...current, open: false, saving: false, error: "", placementRequired: true }));
    } catch (error) { setMoveState((current) => ({ ...current, saving: false, error: error.message || "Activity move failed." })); }
  };
  const toggleSet = (setter, id) => setter((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const typeOptions = activityBuilderTypeOptions(model);
  const changeActivityOrder = async (activity, direction) => {
    if (!activityOrder || dirty || reorderState.busy) return;
    setReorderState({ busy: true, error: "" });
    try {
      await reorderActivity({ bookSlug, componentSlug, activityId: activity.id, pageId: activity.placement.pageId, direction, expectedIndexRevision: activityOrder.indexRevision, expectedLifecycleRevision: activityOrder.lifecycleRevision });
      await loadCatalogs(); setViewerRefresh((value) => value + 1);
      setReorderState({ busy: false, error: "" });
    } catch (error) {
      setReorderState({ busy: false, error: error.message });
      try { await loadCatalogs(); } catch { setCatalogState({ status: "error", error: "Activity order could not be reloaded." }); }
    }
  };
  const revealNavigation = () => { manualNavigationCollapseRef.current = false; globalThis.clearTimeout(navigationCloseTimerRef.current); setNavigationExpanded(true); };
  const revealNavigationFromPointer = () => {
    if (manualNavigationCollapseRef.current) return;
    revealNavigation();
  };
  const scheduleNavigationCollapse = () => {
    globalThis.clearTimeout(navigationCloseTimerRef.current);
    if (!autoHideNavigation) return;
    navigationCloseTimerRef.current = globalThis.setTimeout(() => {
      if (!navigationShellRef.current?.contains(globalThis.document?.activeElement)) setNavigationExpanded(false);
    }, 250);
  };
  const toggleNavigation = () => {
    globalThis.clearTimeout(navigationCloseTimerRef.current);
    if (navigationExpanded) {
      manualNavigationCollapseRef.current = true;
      setNavigationExpanded(false);
      activityWorkspaceRef.current?.focus({ preventScroll: true });
    } else setNavigationExpanded(true);
  };

  return <main className="activity-builder-shell b2-hosted-activity-review">
    <header className="activity-builder-header"><div><span>{bookTitle} · Activity Builder</span><h1>Activity authoring</h1><p>Find, edit, and preview activities in their book placement.</p></div><div className="activity-builder-header-actions"><button ref={addTriggerRef} className="hosted-builder-action" type="button" disabled={catalogState.status !== "ready" || !nativePlacements.length} onClick={openCreate}><Plus aria-hidden="true" /> Add Activity</button></div></header>
    {catalogState.status === "ready" && catalogDiagnostics.length ? <section className="native-catalog-warning" role="alert" aria-live="polite"><div><strong>{catalogDiagnostics.length} {componentLabel} {catalogDiagnostics.length === 1 ? "activity" : "activities"} could not be loaded and {catalogDiagnostics.length === 1 ? "needs" : "need"} repair.</strong><p>Other activities remain available.</p><ul>{catalogDiagnostics.map((diagnostic) => <li key={diagnostic.activityId}><code>{diagnostic.activityId}</code><span>{nativeActivityKindLabels[diagnostic.kind] || diagnostic.kind} · {diagnostic.code}</span></li>)}</ul></div><button type="button" onClick={() => setCatalogReload((value) => value + 1)}>Retry</button></section> : null}

    <BuilderModal open={addOpen} title="Add activity" description={`Choose an activity type and its location in the ${componentLabel}.`} busy={createState.saving} onClose={() => setAddOpen(false)} returnFocusRef={addTriggerRef}><form className="native-activity-create" onSubmit={submitNativeActivity}>
      <fieldset><legend>Activity type</legend><div className="native-activity-kind-cards">{nativeKinds.map((kind) => { const Icon = kindIcons[kind] || Boxes; return <label key={kind} data-selected={createState.kind === kind || undefined}><input type="radio" name="activity-kind" value={kind} checked={createState.kind === kind} onChange={() => setCreateState((current) => ({ ...current, kind }))} /><Icon aria-hidden="true" /><strong>{nativeActivityKindLabels[kind]}</strong><span>{kindDescriptions[kind]}</span></label>; })}</div></fieldset>
      <label><span>Placement</span><select autoFocus value={createState.pageId} onChange={(event) => setCreateState((current) => ({ ...current, pageId: event.target.value }))}>{[...new Set(nativePlacements.map((page) => page.unitNumber))].map((unitNumber) => <optgroup key={unitNumber} label={`Unit ${unitNumber}`}>{nativePlacements.filter((page) => page.unitNumber === unitNumber).map((page) => <option key={page.pageId} value={page.pageId}>{`${page.pageLabel} · ${page.sectionTitle}`}</option>)}</optgroup>)}</select></label>
      <label><span>Initial title <small>Optional</small></span><input value={createState.title} maxLength={300} onChange={(event) => setCreateState((current) => ({ ...current, title: event.target.value }))} placeholder={`New ${nativeActivityKindLabels[createState.kind] || "activity"}`} /></label>
      {createState.error ? <p className="builder-inline-error" role="alert" aria-live="assertive">{createState.error}</p> : null}<footer><button type="button" disabled={createState.saving} onClick={() => setAddOpen(false)}>Cancel</button><button className="hosted-builder-action" type="submit" disabled={createState.saving || !createState.kind || !createState.pageId}>{createState.saving ? "Creating…" : "Create activity"}</button></footer>
    </form></BuilderModal>
    {bookSlug === "ultimate-b2" && componentSlug === "ultimate-b2-students-book" && UnitExtras ? <UnitExtras open={Boolean(extrasUnit)} unit={extrasUnit?.unit} category={extrasUnit?.category} onClose={() => setExtrasUnit(null)} returnFocusRef={extrasTriggerRef} /> : null}
    <BuilderModal open={Boolean(switchTarget)} title="Discard unsaved changes?" description="Opening another activity will discard the changes in this editor." onClose={() => setSwitchTarget("")}><div className="builder-confirm-actions"><button type="button" autoFocus onClick={() => setSwitchTarget("")}>Keep editing</button><button className="builder-danger-action" type="button" onClick={() => { setDirty(false); setSelectedId(switchTarget); setSwitchTarget(""); }}>Discard changes and open activity</button></div></BuilderModal>
    <BuilderModal open={deleteState.open} title="Delete activity?" description={`This logically retires the activity and removes every ${componentLabel} page hotspot that opens it.`} busy={deleteState.saving} onClose={() => setDeleteState({ open: false, saving: false, error: "" })} returnFocusRef={deleteTriggerRef}><div className="native-activity-delete-confirm"><p><strong>{selection?.item?.title}</strong></p><code>{selection?.item?.id}</code><p>Canonical source, revision history, managed assets, and immutable historical releases will not be changed.</p>{dirty ? <p><strong>Unsaved changes in this editor will be discarded.</strong></p> : null}{deleteState.error ? <p className="builder-inline-error" role="alert">{deleteState.error}</p> : null}<div className="builder-confirm-actions"><button type="button" autoFocus disabled={deleteState.saving} onClick={() => setDeleteState({ open: false, saving: false, error: "" })}>Cancel</button><button className="builder-danger-action" type="button" disabled={deleteState.saving} onClick={confirmDeleteActivity}>{deleteState.saving ? "Deleting…" : "Delete Activity"}</button></div></div></BuilderModal>
    <BuilderModal open={moveState.open} title="Move activity" description="Choose a destination. Existing launch hotspots will be removed; place one deliberately on the destination page." busy={moveState.saving} onClose={() => setMoveState((current) => ({ ...current, open: false, error: "" }))}><form className="native-activity-create" onSubmit={confirmMoveActivity}><label><span>Destination</span><select autoFocus value={moveState.pageId} onChange={(event) => setMoveState((current) => ({ ...current, pageId: event.target.value }))}>{[...new Set(nativePlacements.map((page) => page.unitNumber))].map((unitNumber) => <optgroup key={unitNumber} label={`Unit ${unitNumber}`}>{nativePlacements.filter((page) => page.unitNumber === unitNumber && page.pageId !== activityBuilderSourcePageId(selection)).map((page) => <option key={page.pageId} value={page.pageId}>{`${page.pageLabel} · ${page.sectionTitle}`}</option>)}</optgroup>)}</select></label>{moveState.error ? <p className="builder-inline-error" role="alert">{moveState.error}</p> : null}<footer><button type="button" disabled={moveState.saving} onClick={() => setMoveState((current) => ({ ...current, open: false, error: "" }))}>Cancel</button><button className="hosted-builder-action" type="submit" disabled={moveState.saving || !moveState.pageId || moveState.pageId === activityBuilderSourcePageId(selection)}>{moveState.saving ? "Moving…" : "Move Activity"}</button></footer></form></BuilderModal>

    <div className={`b2-hosted-activity-layout ${navigationExpanded ? "is-navigation-expanded" : "is-navigation-collapsed"}`} data-navigation-expanded={navigationExpanded}>
      <div ref={navigationShellRef} className="activity-builder-navigation-shell" onPointerEnter={revealNavigationFromPointer} onPointerLeave={() => { manualNavigationCollapseRef.current = false; scheduleNavigationCollapse(); }} onFocusCapture={revealNavigation} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) scheduleNavigationCollapse(); }}>
      <aside id="activity-builder-book-navigation" className="activity-builder-sidebar" aria-label="Activity Builder book navigation">
        <div className="activity-builder-search"><label><span className="sr-only">Search activities</span><Search aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, type, or ID" /></label><div><label><span>Access</span><select value={access} onChange={(event) => setAccess(event.target.value)}><option value="all">All</option><option value="editable">Editable</option><option value="native">Native</option><option value="read-only">Read-only</option></select></label><label><span>Type</span><select value={type} onChange={(event) => setType(event.target.value)}><option value="all">All types</option>{typeOptions.map((value) => <option key={value} value={value}>{nativeActivityKindLabels[value] || value.replaceAll("-", " ")}</option>)}</select></label></div></div>
        {!filteredSelection && selection ? <p className="activity-filter-notice" role="status">The selected activity is hidden by the current filters. It remains open for editing.</p> : null}
        {reorderState.error ? <p role="alert">{reorderState.error}</p> : null}
        <ActivityTree {...{ filtered, expandedUnits, expandedPages, selectedId, selectActivity, toggleSet, setExpandedUnits, setExpandedPages }} order={activityOrder?.pages} reorderDisabled={dirty || reorderState.busy} onReorder={changeActivityOrder} allowExtras={bookSlug === "ultimate-b2" && componentSlug === "ultimate-b2-students-book"} onOpenExtras={(nextUnit, category, trigger) => { extrasTriggerRef.current = trigger; setExtrasUnit({ unit: nextUnit, category }); }} />
      </aside>
      <button className="activity-builder-navigation-toggle" type="button" aria-controls="activity-builder-book-navigation" aria-expanded={navigationExpanded} aria-label={navigationExpanded ? "Collapse activity navigation" : "Show activity navigation"} title={navigationExpanded ? "Collapse navigation" : "Show navigation"} onFocus={revealNavigation} onClick={toggleNavigation}>{navigationExpanded ? <ChevronLeft aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</button>
      </div>
      <div ref={activityWorkspaceRef} className="b2-hosted-activity-preview" tabIndex={-1}>
        {moveState.placementRequired ? <p className="activity-filter-notice" role="status">Activity moved. Open the destination page in Hotspots and place one deliberate launch hotspot.</p> : null}
        <div className="b2-hosted-preview-identity"><div><strong>{nativeSelected?.title || selected?.title}</strong><span>{nativeSelected ? "Native draft" : supported ? "Editable canonical activity" : "Read-only canonical activity"}</span></div><div className="native-activity-identity-actions"><details><summary>Technical details</summary><code>{selectedId}</code></details>{selection?.item?.movable ? <button type="button" disabled={dirty} title={dirty ? "Save or discard changes before moving this activity." : undefined} onClick={() => { const sourcePageId = activityBuilderSourcePageId(selection); const destination = nativePlacements.find((page) => page.pageId !== sourcePageId)?.pageId || ""; setMoveState({ open: true, pageId: destination, saving: false, error: "", placementRequired: false }); }}><MoveRight aria-hidden="true" /> Move Activity</button> : null}{selection?.item?.retirable ? <button ref={deleteTriggerRef} className="builder-danger-action" type="button" onClick={() => setDeleteState({ open: true, saving: false, error: "" })}><Trash2 aria-hidden="true" /> Delete Activity</button> : null}</div></div>
        {catalogState.status === "loading" ? <section className="b2-hosted-unsupported-activity" role="status"><strong>Loading {componentLabel} activities…</strong></section> : catalogState.status === "error" ? <section className="b2-hosted-unsupported-activity" role="alert"><strong>{catalogState.error}</strong><p>Reload this workspace to try again. No activity from another component will be shown.</p></section> : nativeSelected ? <NativeActivityFoundationEditor key={`${scopeKey}:${selectedId}:${nativeSelected.placement?.pageId}`} bookSlug={bookSlug} componentSlug={componentSlug} activityId={selectedId} kind={nativeSelected.kind} placementLabel={placementFor(nativeSelected.placement?.pageId)?.pageLabel || nativeSelected.placement?.pageId} onDirtyChange={setDirty} onSaved={() => setViewerRefresh((value) => value + 1)} /> : supported && CanonicalEditor ? <CanonicalEditor key={`${scopeKey}:${selectedId}`} activityId={selectedId} onDirtyChange={setDirty} onSaved={() => setViewerRefresh((value) => value + 1)} /> : selection ? <section className="b2-hosted-unsupported-activity" role="status"><strong>Read-only canonical activity</strong><p>This activity family has no hosted mutation capability. Use Review for the deployed Viewer runtime.</p></section> : <section className="b2-hosted-unsupported-activity" role="status"><strong>No activities yet</strong><p>{nativePlacements.length ? "Add the first native activity to this component page library." : "Add and assign a page before creating an activity."}</p></section>}
      </div>
    </div>
  </main>;
}

function ActivityTree({ filtered, expandedUnits, expandedPages, selectedId, selectActivity, toggleSet, setExpandedUnits, setExpandedPages, allowExtras = true, onOpenExtras, order, reorderDisabled, onReorder }) {
  const itemButton = (activity) => {
    const ids = order?.[activity.placement?.pageId] || []; const index = ids.indexOf(activity.id);
    return <div key={activity.id} className="activity-tree-item-row"><button type="button" aria-current={selectedId === activity.id ? "true" : undefined} title={activity.id} onClick={() => selectActivity(activity.id)}><strong>{activity.title}</strong><small>{activity.native ? "Native" : activity.editable ? "Editable" : "Read-only"} · {nativeActivityKindLabels[activity.kind] || activity.kind.replaceAll("-", " ")}</small><code>{activity.id}</code></button><div role="group" aria-label={`Order ${activity.title}`}><button type="button" aria-label={`Move Up: ${activity.title}`} disabled={reorderDisabled || activity.assignment?.state === "unassigned" || index <= 0} onClick={() => onReorder(activity, "up")}>Move Up</button><button type="button" aria-label={`Move Down: ${activity.title}`} disabled={reorderDisabled || activity.assignment?.state === "unassigned" || index < 0 || index === ids.length - 1} onClick={() => onReorder(activity, "down")}>Move Down</button></div></div>;
  };
  return <div className="activity-navigation-tree">{filtered.units.map((unit) => { const unitOpen = expandedUnits.has(unit.id); return <section key={unit.id}><div className="activity-tree-unit-row"><button className="activity-tree-toggle" type="button" aria-expanded={unitOpen} onClick={() => toggleSet(setExpandedUnits, unit.id)}>{unitOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}<strong>{unit.title}</strong><span>{unit.pages.reduce((count, page) => count + page.activities.length, 0)}</span></button>{allowExtras ? <details className="activity-tree-extras"><summary aria-label={`Add extras to ${unit.title}`} title={`Add extras to ${unit.title}`}><Plus aria-hidden="true" /></summary><div><strong>Add Extras</strong><button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onOpenExtras(unit, "videos", event.currentTarget); }}><Video aria-hidden="true" /> Videos</button><button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onOpenExtras(unit, "audios", event.currentTarget); }}><Music aria-hidden="true" /> Audio</button></div></details> : null}</div>{unitOpen ? unit.pages.map((page) => { const pageOpen = expandedPages.has(page.id); return <div className="activity-tree-page" key={page.id}><button className="activity-tree-toggle" type="button" aria-expanded={pageOpen} onClick={() => toggleSet(setExpandedPages, page.id)}>{pageOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}<span><strong>{page.title}</strong><small>{page.pageLabel}</small></span><span>{page.activities.length}</span></button>{pageOpen ? <div className="activity-tree-items">{page.activities.map(itemButton)}</div> : null}</div>; }) : null}</section>; })}{filtered.unassigned?.length ? <section><h2>Unassigned</h2><p className="activity-filter-notice">These activities are preserved but cannot launch until moved to an active page.</p>{filtered.unassigned.map(itemButton)}</section> : null}</div>;
}

export default HostedActivityWorkspace;
