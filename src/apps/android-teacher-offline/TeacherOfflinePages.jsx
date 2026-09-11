import {
  Move,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useTeacherRuntimeUiAssets } from "./legacyClassroomAssets.js";
import ClassroomStageTransform from "./ClassroomStageTransform.jsx";
import ClassroomToolOverlay from "./ClassroomToolOverlay.jsx";
import ClassroomToolbar from "./UltimateB2ClassroomToolbar.jsx";
import TeacherBookNavigation from "./TeacherBookNavigation.jsx";
import TeacherOfflineEmbeddedActivity from "./TeacherOfflineEmbeddedActivity.jsx";
import TeacherOfflineUnitOverview from "./TeacherOfflineUnitOverview.jsx";
import { useTeacherStage } from "./TeacherFixedStage.jsx";
import { renderedDeltaToTeacherStage } from "./teacherStageGeometry.js";
import { useTeacherOfflineSettings } from "./teacherOfflineSettings.js";
import { normalizeTeacherActivityPresentationState } from "./teacherActivityPresentation.js";
import { getUltimateB2ReadingExercisePresentationFeatures } from "../../data/ultimate-b2/readingExerciseRuntimeData.js";
import { unitExtrasForPage } from "../../data/ultimate-b2/unitExtras.js";
import { BookUnitExtraAudiosForPublication } from "../../components/lms/books/BookUnitExtraAudios.jsx";
import { NativeVideoPlayer } from "../../components/native-video/NativeVideoPlayer.jsx";
import { publishedUnitExtraVideoUrl, usePublishedComponentRelease } from "virtual:component-publication";

const minimumZoom = 1;
const maximumZoom = 4;

function enabledActivities(page) {
  return (page?.activities || []).filter((activity) => activity.availability === "enabled");
}

function activityIdForAction(page, action, getAuthoredActivityKey) {
  const authoredActivityKey = getAuthoredActivityKey(action);
  if (authoredActivityKey) return authoredActivityKey;
  const activities = enabledActivities(page);
  const direct = activities.find((activity) => (
    activity.id === action.activityKey || activity.activityKey === action.activityKey
  ));
  if (direct) return direct.id || direct.activityKey;
  const ordinal = action.target === "text-audio"
    ? 2
    : Number(String(action.target || "").match(/^exercise-(\d+)$/)?.[1]);
  if (ordinal) {
    return activities.find((activity) => String(activity.id).endsWith(`-o${ordinal}`))?.id || null;
  }
  return null;
}

function isPositionedAction(action) {
  return [action.top, action.left, action.width, action.height].every(Boolean);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export default function TeacherOfflinePages({
  unit,
  selectedPageId,
  onSelectPage,
  activeActivity,
  activeActivityId,
  onOpenActivity,
  onCloseActivity,
  onOpenMedia,
  onBackToLibrary,
  selectedBookId,
  onBookSwitch,
  unavailableBookIds,
  unavailableBookMessages,
  unavailableBookLabels,
  hotspotProvider,
  runtimeContext,
  componentIdentity,
}) {
  const publication = usePublishedComponentRelease({ runtimeContext, identity: componentIdentity });
  const runtimeUiAssets = useTeacherRuntimeUiAssets();
  const legacyClassroomAssets = runtimeUiAssets.classroom;
  const pages = unit?.pages || [];
  const getAuthoredActivityKey = hotspotProvider?.getActivityKey || (() => null);
  const settings = useTeacherOfflineSettings();
  const { scale: teacherStageScale } = useTeacherStage();
  const showLeftNavigation = settings.content.showNavbarLeft || (!settings.content.showNavbarLeft && !settings.content.showNavbarRight);
  const selectedIndex = pages.findIndex((page) => page.id === selectedPageId);
  const page = selectedIndex >= 0 ? pages[selectedIndex] : null;
  const pageContext = page?.title || "";
  const embeddedActivityId = activeActivity?.stableActivityId || activeActivityId || "";
  const activityActive = Boolean(embeddedActivityId);
  const legacyVideoAvailable = activityActive && Boolean(activeActivity?.mediaDependencies?.some(
    (dependency) => dependency.type === "video" && dependency.logicalKey,
  ));
  const listeningAvailable = embeddedActivityId === "ultimate-b2-sb-u1-p2-o2";
  const multipleChoiceAvailable = embeddedActivityId === "ultimate-b2-sb-u1-p2-o3";
  const readingPresentationFeatures = getUltimateB2ReadingExercisePresentationFeatures(embeddedActivityId);
  const showTextAvailable = readingPresentationFeatures.showTextEnabled;
  const classroomSurfaceKey = activityActive
    ? `${selectedBookId}:activity:${embeddedActivityId}`
    : page ? `${selectedBookId}:page:${page.id}` : `${selectedBookId}:overview`;
  const stageRef = useRef(null);
  const viewerRef = useRef(null);
  const pointerState = useRef(new Map());
  const gestureState = useRef(null);
  const gestureFrame = useRef(0);
  const didPan = useRef(false);
  const [assetError, setAssetError] = useState("");
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0, paddingX: 0, paddingY: 0 });
  const fitMode = "fit-page";
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [extraMenuOpen, setExtraMenuOpen] = useState(false);
  const [activeExtraVideo, setActiveExtraVideo] = useState(null);
  const extraMenuRef = useRef(null);
  const extraLauncherRef = useRef(null);
  const extraCloseRef = useRef(null);
  const [activityVideoOpen, setActivityVideoOpen] = useState(false);
  const [listeningView, setListeningView] = useState("questions");
  const [listeningShowTextCommand, setListeningShowTextCommand] = useState(0);
  const [activityPresentationState, setActivityPresentationState] = useState({ view: "questions", panelIndex: 0, panelCount: 0, panelNavigationActive: false, reveal: null, readableTextAvailable: false, videoAvailable: false, audioFocusActive: false });
  const [activityPresentationCommand, setActivityPresentationCommand] = useState(null);
  const [activityWorksheetAction, setActivityWorksheetAction] = useState(null);
  const [activitySessionEpoch, setActivitySessionEpoch] = useState(0);
  const pageExtraVideos = useMemo(() => unitExtrasForPage(publication, { unitNumber: unit?.number, pageId: page?.id }), [page?.id, publication, unit?.number]);
  const onActivityPresentationStateChange = useCallback((state) => {
    const next = normalizeTeacherActivityPresentationState(state);
    setActivityPresentationState((current) => (
      current.view === next.view
      && current.panelIndex === next.panelIndex
      && current.panelCount === next.panelCount
      && current.panelNavigationActive === next.panelNavigationActive
      && current.readableTextAvailable === next.readableTextAvailable
      && current.videoAvailable === next.videoAvailable
      && current.audioFocusActive === next.audioFocusActive
      && current.reveal?.supported === next.reveal?.supported
      && current.reveal?.total === next.reveal?.total
      && current.reveal?.revealed === next.reveal?.revealed
      && current.reveal?.pristine === next.reveal?.pristine
    ) ? current : next);
  }, []);

  useLayoutEffect(() => {
    setAssetError("");
    setNaturalSize({ width: 0, height: 0 });
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setExtraMenuOpen(false);
    setActiveExtraVideo(null);
    setActivityVideoOpen(false);
    setListeningView("questions");
    setListeningShowTextCommand(0);
    setActivityPresentationState({
      view: "questions",
      panelIndex: 0,
      panelCount: embeddedActivityId === "ultimate-b2-sb-u1-p2-o3" ? 2 : readingPresentationFeatures.internalPartCount,
      panelNavigationActive: false,
      reveal: null,
      readableTextAvailable: false,
      videoAvailable: false,
      audioFocusActive: false,
    });
    setActivityPresentationCommand(null);
    setActivityWorksheetAction(null);
    setActivitySessionEpoch(0);
  }, [activityActive, embeddedActivityId, page?.id, readingPresentationFeatures.internalPartCount, selectedPageId]);

  useEffect(() => {
    if (!extraMenuOpen && !activeExtraVideo) return undefined;
    const closeMenu = (event) => { if (extraMenuOpen && !extraMenuRef.current?.contains(event.target) && event.target !== extraLauncherRef.current) setExtraMenuOpen(false); };
    const escape = (event) => {
      if (event.key !== "Escape") return;
      setExtraMenuOpen(false); setActiveExtraVideo(null); extraLauncherRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeMenu); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", closeMenu); document.removeEventListener("keydown", escape); };
  }, [activeExtraVideo, extraMenuOpen]);

  useEffect(() => { if (activeExtraVideo) extraCloseRef.current?.focus(); }, [activeExtraVideo]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const update = () => {
      const style = getComputedStyle(stage);
      const next = {
        width: stage.clientWidth,
        height: stage.clientHeight,
        paddingX: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
        paddingY: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
      };
      setStageSize((current) => (
        current.width === next.width
        && current.height === next.height
        && current.paddingX === next.paddingX
        && current.paddingY === next.paddingY
      ) ? current : next);
    };
    if (typeof ResizeObserver === "undefined") {
      globalThis.addEventListener("resize", update);
      update();
      return () => globalThis.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    update();
    return () => observer.disconnect();
  }, [activityActive, embeddedActivityId, page?.id]);

  useEffect(() => () => cancelAnimationFrame(gestureFrame.current), []);

  const actions = useMemo(() => [
    ...(page?.actions || []),
    ...(hotspotProvider?.getActions?.({
      pageId: page?.id,
      pageNumber: page?.pageNumber,
      unitNumber: unit?.number,
    }) || []),
  ].filter((action) => {
    if (action.availability !== "enabled") return false;
    if (action.logicalKey) return true;
    return Boolean(activityIdForAction(page, action, getAuthoredActivityKey));
  }), [getAuthoredActivityKey, hotspotProvider, page, unit?.number]);
  const fallbackExtraVideoActions = useMemo(() => publication.kind !== "none" || pageExtraVideos.length ? [] : actions.filter((action) => (
    action.classification === "video" && /\bextra video\b/i.test(action.label)
  )), [actions, pageExtraVideos.length, publication.kind]);
  const pageActivityIds = ["loading", "error"].includes(publication.kind) ? [] : publication.projection?.activityOrder
    ? publication.projection.activityOrder[page?.id] || []
    : [...new Set([...enabledActivities(page).map((activity) => activity.stableActivityId || activity.id || activity.activityKey), ...actions.filter((action) => !action.logicalKey).map((action) => activityIdForAction(page, action, getAuthoredActivityKey))].filter(Boolean))];
  const activeIndex = pageActivityIds.indexOf(embeddedActivityId);
  const navigateActivity = (delta) => {
    const id = activeIndex < 0 ? null : pageActivityIds[activeIndex + delta];
    if (id) onOpenActivity(id);
  };

  const image = page?.images?.[0] || null;
  const openAction = (action) => {
    const activityId = activityIdForAction(page, action, getAuthoredActivityKey);
    if (activityId) {
      onOpenActivity(activityId);
      return;
    }
    if (action.logicalKey) {
      onOpenMedia({
        logicalKey: action.logicalKey,
        type: action.mediaType || action.classification,
        label: action.label,
      });
    }
  };

  const availableWidth = Math.max(0, stageSize.width - stageSize.paddingX);
  const availableHeight = Math.max(0, stageSize.height - stageSize.paddingY);
  const pageScale = naturalSize.width && naturalSize.height
    ? Math.min(availableWidth / naturalSize.width, availableHeight / naturalSize.height)
    : 0;
  const renderedWidth = Math.round(naturalSize.width * pageScale * zoom);
  const renderedHeight = Math.round(naturalSize.height * pageScale * zoom);
  const maxPan = {
    x: Math.max(0, (renderedWidth - availableWidth) / 2),
    y: Math.max(0, (renderedHeight - availableHeight) / 2),
  };
  const boundedPan = {
    x: clamp(pan.x, -maxPan.x, maxPan.x),
    y: clamp(pan.y, -maxPan.y, maxPan.y),
  };
  const canPan = maxPan.x > 2 || maxPan.y > 2;

  useEffect(() => {
    if (!page || !naturalSize.width || !stageSize.width) return;
    globalThis.dispatchEvent(new CustomEvent("teacher:page-metrics", {
      detail: {
        pageId: page.id,
        fitMode,
        zoomPercent: Math.round(zoom * 100),
        stageWidth: stageSize.width,
        stageHeight: stageSize.height,
        renderedWidth,
        renderedHeight,
      },
    }));
  }, [fitMode, naturalSize, page?.id, renderedHeight, renderedWidth, stageSize, zoom]);

  const changeZoom = (nextZoom) => {
    setZoom(clamp(nextZoom, minimumZoom, maximumZoom));
    if (nextZoom <= minimumZoom && fitMode === "fit-page") setPan({ x: 0, y: 0 });
  };
  const updatePan = (next) => setPan({
    x: clamp(next.x, -maxPan.x, maxPan.x),
    y: clamp(next.y, -maxPan.y, maxPan.y),
  });

  const onPointerDown = (event) => {
    if (event.target.closest?.(".teacher-offline-page-hotspot")) return;
    didPan.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointerState.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointerState.current.values()];
    if (points.length === 1) {
      gestureState.current = { type: "pan", start: points[0], pan: boundedPan };
    } else if (points.length === 2) {
      gestureState.current = {
        type: "pinch",
        distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
        zoom,
      };
    }
  };
  const onPointerMove = (event) => {
    if (!pointerState.current.has(event.pointerId)) return;
    pointerState.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const latestPoints = [...pointerState.current.values()];
    if (latestPoints.length > 1 || (
      latestPoints.length === 1
      && gestureState.current?.start
      && Math.hypot(
        latestPoints[0].x - gestureState.current.start.x,
        latestPoints[0].y - gestureState.current.start.y,
      ) > 6
    )) {
      didPan.current = true;
    }
    if (gestureFrame.current) return;
    gestureFrame.current = requestAnimationFrame(() => {
      gestureFrame.current = 0;
      const points = [...pointerState.current.values()];
      if (points.length === 2 && gestureState.current?.type === "pinch") {
        const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        changeZoom(gestureState.current.zoom * distance / Math.max(1, gestureState.current.distance));
      } else if (points.length === 1 && gestureState.current?.type === "pan" && canPan) {
        updatePan({
          x: gestureState.current.pan.x + renderedDeltaToTeacherStage(points[0].x - gestureState.current.start.x, teacherStageScale),
          y: gestureState.current.pan.y + renderedDeltaToTeacherStage(points[0].y - gestureState.current.start.y, teacherStageScale),
        });
      }
    });
  };
  const onPointerEnd = (event) => {
    pointerState.current.delete(event.pointerId);
    gestureState.current = null;
  };
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || activityActive) return undefined;
    const onWheel = (event) => {
      if (!event.ctrlKey && Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
      event.preventDefault();
      changeZoom(zoom + (event.deltaY < 0 ? 0.2 : -0.2));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [activityActive, page?.id, zoom]);
  const pageGestureHandlers = activityActive ? {} : {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
  };
  const sendActivityCommand = (type) => setActivityPresentationCommand((current) => ({ type, token: (current?.token || 0) + 1 }));
  const revealState = activityPresentationState.reveal;
  const revealSupported = revealState?.supported === true;
  const resetActivity = () => {
    setActivityVideoOpen(false);
    setActivityPresentationState((current) => ({
      view: "questions",
      panelIndex: 0,
      panelCount: current.panelCount,
      reveal: current.reveal ? { ...current.reveal, revealed: 0, pristine: true } : null,
      readableTextAvailable: current.readableTextAvailable,
      videoAvailable: current.videoAvailable,
      audioFocusActive: false,
    }));
    setActivitySessionEpoch((current) => current + 1);
    sendActivityCommand("reset-activity");
  };
  const revealActions = activityActive ? [
    { id: "reload", controlId: "reveal:reload", label: "Reload", disabled: revealSupported && revealState.pristine && activityPresentationState.view === "questions" && !activityPresentationState.audioFocusActive, artwork: legacyClassroomAssets.revealControls.reload, onClick: resetActivity },
    { id: "show-all", controlId: "reveal:show-all", label: "Show All", disabled: !revealSupported || revealState.total === 0 || revealState.revealed >= revealState.total, artwork: legacyClassroomAssets.revealControls["show-all"], onClick: () => sendActivityCommand("show-all") },
    { id: "show-next", controlId: "reveal:show-next", label: "Show Next", disabled: !revealSupported || revealState.total === 0 || revealState.revealed >= revealState.total, artwork: legacyClassroomAssets.revealControls["show-next"], onClick: () => sendActivityCommand("show-next") },
  ] : [];
  const nativeVideoAvailable = activityPresentationState.videoAvailable;
  const videoAvailable = legacyVideoAvailable || nativeVideoAvailable;
  const standardContextActions = [...(videoAvailable ? [{
    id: "video",
    label: "Video",
    title: "Video",
    ariaLabel: nativeVideoAvailable ? (activityPresentationState.view === "video" ? "Return to questions" : "Open activity video") : activityVideoOpen ? "Close activity video" : "Open activity video",
    active: nativeVideoAvailable ? activityPresentationState.view === "video" : activityVideoOpen,
    iconName: "video",
    onClick: () => nativeVideoAvailable ? sendActivityCommand("toggle-video") : setActivityVideoOpen((open) => !open),
  }] : []), ...(activityWorksheetAction ? [{ ...activityWorksheetAction, controlId: "navigation:video-worksheet" }] : []), ...(!videoAvailable && listeningAvailable ? [{
    id: "show-text",
    label: "Show Text",
    title: "Show Text",
    ariaLabel: listeningView === "questions" ? "Show Text" : "Return to questions",
    active: listeningView !== "questions",
    iconName: "showText",
    activeIconName: "showTextPressed",
    onClick: () => setListeningShowTextCommand((command) => command + 1),
  }] : []), ...(!listeningAvailable && (activityPresentationState.readableTextAvailable || (!legacyVideoAvailable && (multipleChoiceAvailable || showTextAvailable))) ? [{
    id: "show-text",
    label: "Show Text",
    title: "Show Text",
    ariaLabel: activityPresentationState.view === "text" ? "Return to questions" : "Show Text",
    active: activityPresentationState.view === "text",
    iconName: "showText",
    activeIconName: "showTextPressed",
    onClick: () => sendActivityCommand("toggle-text"),
  }] : [])];
  const contextActions = [...revealActions, ...standardContextActions];
  const internalNavigation = activityActive && activityPresentationState.panelCount > 1 ? {
    previousDisabled: (!activityPresentationState.panelNavigationActive && activityPresentationState.view !== "questions") || activityPresentationState.panelIndex <= 0,
    nextDisabled: (!activityPresentationState.panelNavigationActive && activityPresentationState.view !== "questions") || activityPresentationState.panelIndex >= activityPresentationState.panelCount - 1,
    onPrevious: () => sendActivityCommand("previous-panel"),
    onNext: () => sendActivityCommand("next-panel"),
  } : null;

  if (!page) return (
    <TeacherOfflineUnitOverview
      key={`unit-overview-${unit.number}`}
      unit={unit}
      onSelectPage={onSelectPage}
      onBackToLibrary={onBackToLibrary}
      selectedBookId={selectedBookId}
      onBookSwitch={onBookSwitch}
      unavailableBookIds={unavailableBookIds}
      unavailableBookMessages={unavailableBookMessages}
      unavailableBookLabels={unavailableBookLabels}
      componentIdentity={componentIdentity}
    />
  );

  return (
    <section ref={viewerRef} className="teacher-offline-pages teacher-offline-pages-viewer">
      <header className="legacy-page-heading">
        <div aria-hidden="true" />
        {showLeftNavigation ? <div data-navbar-side="left">
          <h2>Unit {unit.number}</h2>
          <strong>{pageContext}</strong>
        </div> : <div data-navbar-side="left" data-navbar-hidden="true" />}
        <div aria-hidden="true" />
      </header>

      <div className={`teacher-offline-page-reader ${activityActive ? "has-embedded-activity" : ""}`.trim()}>
        <div
          ref={stageRef}
          className={`teacher-offline-page-stage ${!activityActive && canPan ? "can-pan" : ""} ${activityActive ? "has-embedded-activity" : ""}`.trim()}
          data-classroom-surface-id={classroomSurfaceKey}
          data-active-activity-id={embeddedActivityId || undefined}
          {...pageGestureHandlers}
          tabIndex={-1}
        >
          <ClassroomStageTransform surfaceKey={classroomSurfaceKey}>
          {activityActive ? (
            <TeacherOfflineEmbeddedActivity
              key={`${embeddedActivityId}:${activitySessionEpoch}`}
              activityId={embeddedActivityId}
              title={activeActivity?.title}
              videoOpen={activityVideoOpen}
              onCloseVideo={() => setActivityVideoOpen(false)}
              listeningShowTextCommand={listeningShowTextCommand}
              onListeningStateChange={setListeningView}
              activityPresentationCommand={activityPresentationCommand}
              onActivityPresentationStateChange={onActivityPresentationStateChange}
              onVideoWorksheetActionChange={setActivityWorksheetAction}
              runtimeContext={runtimeContext}
              componentIdentity={componentIdentity}
            />
          ) : image && !assetError ? (
            <div
              className="teacher-offline-page-image"
              data-fit-mode={fitMode}
              data-zoom={zoom.toFixed(2)}
              style={{
                width: `${renderedWidth}px`,
                height: `${renderedHeight}px`,
                transform: `translate3d(${boundedPan.x}px, ${boundedPan.y}px, 0)`,
              }}
            >
              <img
                key={page.id}
                src={image}
                alt={`${unit.title}, ${page.title}, ${page.label}`}
                draggable="false"
                loading="eager"
                decoding="async"
                onLoad={(event) => setNaturalSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })}
                onError={() => setAssetError("This required page asset is unavailable.")}
              />
              {actions.filter(isPositionedAction).map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className="teacher-offline-page-hotspot"
                  style={{ top: action.top, left: action.left, width: action.width, height: action.height, "--legacy-hotspot": `url(${legacyClassroomAssets.controls.activityHotspot})` }}
                  onClick={(event) => {
                    if (didPan.current) {
                      event.preventDefault();
                      event.stopPropagation();
                      return;
                    }
                    openAction(action);
                  }}
                  aria-label={action.ariaLabel || action.label}
                >
                  <span>{action.label}</span>
                </button>
              ))}
              {canPan && <span className="teacher-page-pan-indicator" aria-hidden="true"><Move size={18} /></span>}
            </div>
          ) : (
            <div className="teacher-offline-asset-error" role="alert">{assetError || "This required page asset is unavailable."}</div>
          )}
          <ClassroomToolOverlay surfaceKey={classroomSurfaceKey} />
          </ClassroomStageTransform>
        </div>

        {!activityActive && (pageExtraVideos.length || fallbackExtraVideoActions.length) ? <div className="teacher-unit-extra-videos">
          {extraMenuOpen ? <div ref={extraMenuRef} className="teacher-unit-extra-menu" role="menu" aria-label="Extra Videos"><strong>Extra Videos</strong>{pageExtraVideos.map((entry) => <button key={entry.id} type="button" role="menuitem" disabled={entry.readiness === "missing-media"} onClick={() => { if (entry.readiness === "missing-media") return; document.querySelectorAll("audio,video").forEach((media) => media.pause()); setExtraMenuOpen(false); setActiveExtraVideo(entry); }}>{entry.title}{entry.readiness === "missing-media" ? " - Not ready: MP4 required" : ""}</button>)}{fallbackExtraVideoActions.map((action) => <button key={action.id} type="button" role="menuitem" onClick={() => { document.querySelectorAll("audio,video").forEach((media) => media.pause()); setExtraMenuOpen(false); openAction(action); }}>{action.label}</button>)}</div> : null}
          <button ref={extraLauncherRef} type="button" className="teacher-unit-extra-launcher" aria-haspopup="menu" aria-expanded={extraMenuOpen} onClick={() => setExtraMenuOpen((current) => !current)}><Video aria-hidden="true" /> Extra Videos</button>
        </div> : null}
        {activeExtraVideo ? <div className="teacher-unit-extra-overlay" role="dialog" aria-modal="true" aria-labelledby="teacher-unit-extra-title" onPointerDown={(event) => { if (event.target === event.currentTarget) { setActiveExtraVideo(null); extraLauncherRef.current?.focus(); } }}><section><header><div><span>Extra Videos</span><h2 id="teacher-unit-extra-title">{activeExtraVideo.title}</h2></div><button ref={extraCloseRef} type="button" aria-label="Close Extra Video" onClick={() => { setActiveExtraVideo(null); extraLauncherRef.current?.focus(); }}><X /></button></header><div><NativeVideoPlayer video={activeExtraVideo.video} src={publishedUnitExtraVideoUrl(publication, activeExtraVideo.video.asset)} autoPlayAttemptKey={activeExtraVideo.id} ariaLabel={`${activeExtraVideo.title} Extra Video player`} /></div></section></div> : null}
        <BookUnitExtraAudiosForPublication publication={publication} unitNumber={unit?.number} pageId={page?.id} hidden={activityActive || Boolean(activeExtraVideo)} />
      </div>

      <TeacherBookNavigation
        onHome={onBackToLibrary}
        onBack={activityActive ? onCloseActivity : () => onSelectPage("")}
        navigationMode={activityActive ? "activity" : "page"}
        onPrevious={() => activityActive ? navigateActivity(-1) : onSelectPage(pages[selectedIndex - 1].id)}
        onNext={() => activityActive ? navigateActivity(1) : onSelectPage(pages[selectedIndex + 1].id)}
        previousDisabled={activityActive ? activeIndex <= 0 : selectedIndex <= 0}
        nextDisabled={activityActive ? activeIndex < 0 || activeIndex >= pageActivityIds.length - 1 : selectedIndex < 0 || selectedIndex >= pages.length - 1}
        contextActions={contextActions}
        internalNavigation={internalNavigation}
        selectedBookId={selectedBookId}
        onBookSwitch={onBookSwitch}
        unavailableBookIds={unavailableBookIds}
        unavailableBookMessages={unavailableBookMessages}
        unavailableBookLabels={unavailableBookLabels}
      />

      <ClassroomToolbar surfaceKey={classroomSurfaceKey} />
    </section>
  );
}
