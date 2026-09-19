import { useEffect, useMemo, useRef, useState } from "react";
import { TeacherClassroomPages } from "../../apps/android-teacher-offline/TeacherClassroomPages.jsx";
import { EmbeddedActivityFrame } from "../../apps/android-teacher-offline/EmbeddedActivityFrame.jsx";
import { PublishedNativeActivityRunner } from "virtual:published-native-activity-runner";
import { ClassroomToolsProvider } from "../../apps/android-teacher-offline/ClassroomToolsContext.jsx";
import { TeacherRuntimeUiAssetsProvider } from "../../apps/android-teacher-offline/legacyClassroomAssets.js";
import { createTeacherRuntimeUiAssetModel } from "../../apps/android-teacher-offline/teacherRuntimeUiAssetModel.js";
import { ultimateB2TeacherAppAuthoring } from "../../data/ultimate-b2/teacherAppAuthoring.js";
import { resolveUltimateB2AuthoredAssetUrl } from "../../data/ultimate-b2/ultimateB2AuthoredAssetUrls.js";
import { loadWordList, wordListAudioUrl } from "../../data/wordlists/loader.js";
import { loadEditionClassroom } from "../../data/wordlists/classroom.js";
import { stableJson } from "../../data/wordlists/portable.js";
import { consumeClassroomBack } from "./classroomLayers.js";
import "../../apps/android-teacher-offline/teacherOffline.css";
import "../../apps/android-teacher-offline/classroomTools.css";
import "../../apps/android-teacher-offline/legacyTeacherToolbar.css";
import "./editionClassroom.css";

const noOp = () => {};
export function EditionClassroom({ context, teacherMode = false, onClose = noOp }) {
  const rootIdentity = stableJson(context);
  const [selection, setSelection] = useState(null);
  if (selection?.root === rootIdentity && selection.component !== context.componentSlug) {
    const { targetSource: _source, sourcePageIds: _pages, ...base } = context;
    context = { ...base, componentSlug: selection.component };
  }
  const identity = stableJson(context); const [attempt, setAttempt] = useState(0); const [state, setState] = useState(null);
  useEffect(() => {
    const controller = new AbortController(); setState(null);
    loadEditionClassroom(JSON.parse(identity), { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setState({ identity, value }); })
      .catch((error) => { if (!controller.signal.aborted) setState({ identity, error: error.message }); });
    return () => controller.abort();
  }, [identity, attempt]);
  const current = state?.identity === identity ? state : null;
  return <section className="edition-classroom-host" aria-label="Edition classroom">
    <header><strong>{context.editionId === "greek" ? "Greek" : "International"} · {context.kind === "draft" ? "Saved draft" : context.kind === "candidate" ? "Immutable candidate" : "Published edition"}</strong><button type="button" onClick={onClose}>Close classroom</button></header>
    {!current ? <p role="status">Loading verified classroom…</p> : current.error ? <p role="alert">{current.error} <button onClick={() => setAttempt((value) => value + 1)}>Retry classroom</button></p>
      : <LoadedClassroom key={identity} data={current.value} teacherMode={teacherMode} onClose={onClose} onComponentSwitch={(component) => setSelection({ root: rootIdentity, component })} />}
  </section>;
}
function LoadedClassroom({ data, teacherMode, onClose, onComponentSwitch }) {
  const [unitIndex, setUnit] = useState(0); const [pageIds, setPages] = useState([]); const [activityId, setActivity] = useState(""); const [uiError, setUiError] = useState(false); const [wordListOpen, setWordListOpen] = useState(false);
  const root = useRef(null);
  const uiAssets = useMemo(() => createTeacherRuntimeUiAssetModel({ authoring: ultimateB2TeacherAppAuthoring,
    resolveCanonicalAssetUrl: resolveUltimateB2AuthoredAssetUrl, hostedPreview: data.ui, identity: { bookSlug: data.context.bookSlug, componentSlug: data.ownerSource.componentSlug },
    runtimeContext: { kind: "edition-classroom" }, resolveFrozenAssetUrl: data.uiAssetUrl, resolveFrozenFontUrl: data.uiFontUrl }), [data]);
  const units = useMemo(() => data.projection.units.map((unit) => ({ id: unit.id, number: unit.unitNumber || unit.number, title: unit.title,
    pages: data.projection.pages.filter((page) => page.unitId === unit.id).map((page) => ({ ...page, title: page.label, overviewLabel: page.label,
      printedLabel: page.printedLabel || page.label, spreadNumber: page.printedLabel || page.label, imageWidth: page.image.width, imageHeight: page.image.height,
      images: [data.pageAssetUrl(page)], activities: (data.projection.activityOrder?.[page.id] || []).map((id) => ({ id, availability: "enabled" })),
      actions: (data.projection.hotspots.pages[page.id] || []).map((hotspot) => ({ ...hotspot, activityKey: hotspot.activityKey, availability: "enabled",
        top: `${hotspot.top}%`, left: `${hotspot.left}%`, width: `${hotspot.width}%`, height: `${hotspot.height}%` })) })) })), [data]);
  const unit = units[unitIndex] || units[0];
  const selectPage = (id) => { setActivity(""); setPages(id ? [id] : []); };
  const openActivity = (id) => { if (pageIds.some((pageId) => (data.projection.hotspots.pages[pageId] || []).some((hotspot) => hotspot.activityKey === id)) && data.projection.nativeActivities[id]) setActivity(id); };
  const provider = useMemo(() => ({ context: data.context, load: loadWordList, audioUrl: wordListAudioUrl }), [data]);
  const classroom = useMemo(() => ({ publication: data.publication, delivery: data.delivery, teacherMode, wordlist: provider, selectedPageIds: pageIds, onWordListOpenChange: setWordListOpen,
    pageSubtitle: pageIds.map((id) => data.projection.pages.find((page) => page.id === id)?.label).join(" / "),
    renderSpread: (onOpen) => <div className="edition-page-pair">{pageIds.map((id) => { const page = data.projection.pages.find((entry) => entry.id === id); return <div key={id} style={{ aspectRatio: `${page.image.width}/${page.image.height}` }}>
      <img src={data.pageAssetUrl(page)} alt={page.label} />{(data.projection.hotspots.pages[id] || []).map((hotspot) => <button type="button" key={hotspot.id} aria-label={hotspot.label}
        style={{ left: `${hotspot.left}%`, top: `${hotspot.top}%`, width: `${hotspot.width}%`, height: `${hotspot.height}%` }} onClick={() => onOpen(hotspot.activityKey)} />)}</div>; })}</div>,
  }), [data, pageIds, provider, teacherMode]);
  useEffect(() => {
    const key = (event) => { if (event.key !== "Escape" || !root.current?.contains(document.activeElement)) return;
      if (consumeClassroomBack()) { event.preventDefault(); return; }
      if (activityId) setActivity(""); else if (pageIds.length) setPages([]);
    };
    root.current?.addEventListener("keydown", key); const element = root.current;
    return () => element?.removeEventListener("keydown", key);
  }, [activityId, pageIds]);
  const component = data.context.componentSlug.slice(data.context.bookSlug.length + 1);
  if (!unit) return <p role="status">No pages are available in this source.</p>;
  return <TeacherRuntimeUiAssetsProvider value={uiAssets}><ClassroomToolsProvider><div ref={root} className="edition-classroom" data-edition-classroom={data.context.kind}
    onErrorCapture={(event) => { if (event.target.tagName === "IMG" && String(event.target.src).includes("uiBindingId=")) setUiError(true); }}>
    <div className="edition-classroom-controls" inert={wordListOpen}><label>Unit <select aria-label="Classroom unit" value={unitIndex} onChange={(event) => { setUnit(Number(event.target.value)); selectPage(""); }}>{units.map((entry, index) => <option key={entry.id} value={index}>{entry.title}</option>)}</select></label>
      {pageIds.length > 0 && !activityId && <label>Page pair <select aria-label="Classroom second page" value={pageIds[1] || ""} onChange={(event) => setPages(event.target.value ? [pageIds[0], event.target.value] : [pageIds[0]])}><option value="">Single page</option>{unit.pages.filter((page) => page.id !== pageIds[0]).map((page) => <option value={page.id} key={page.id}>{page.label}</option>)}</select></label>}
    </div>
    {uiError && <p role="alert">Frozen classroom artwork could not load. Close and retry this classroom.</p>}
    <TeacherClassroomPages ActivityRenderer={EditionActivity} publication={data.publication} unit={unit} selectedPageId={pageIds[0] || ""} onSelectPage={selectPage} activeActivityId={activityId}
      activeActivity={activityId ? { stableActivityId: activityId, title: data.projection.nativeActivities[activityId]?.document.metadata.title } : null}
      onOpenActivity={openActivity} onCloseActivity={() => setActivity("")} onOpenMedia={noOp} onBackToLibrary={onClose} selectedBookId={component}
      onBookSwitch={(id) => onComponentSwitch(`${data.context.bookSlug}-${id}`)}
      classroom={classroom} componentIdentity={{ bookSlug: data.context.bookSlug, componentSlug: data.context.componentSlug }} />
  </div></ClassroomToolsProvider></TeacherRuntimeUiAssetsProvider>;
}

function EditionActivity({ classroom, activityId, title, activityPresentationCommand, onActivityPresentationStateChange, onVideoWorksheetActionChange }) {
  const entry = classroom.publication.projection.nativeActivities[activityId];
  return <EmbeddedActivityFrame activityId={activityId} title={title}><PublishedNativeActivityRunner entry={entry} publication={classroom.publication} teacherMode={classroom.teacherMode} delivery={classroom.delivery} showMetadataHeader={false} presentation={{ command: activityPresentationCommand, onStateChange: onActivityPresentationStateChange, onWorksheetActionChange: onVideoWorksheetActionChange }} /></EmbeddedActivityFrame>;
}
