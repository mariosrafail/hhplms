import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Volume2, VolumeX } from "lucide-react";
import { readTeacherOfflineLocation, writeTeacherOfflineLocation } from "./teacherOfflineStorage.js";
import TeacherOfflineBook from "./TeacherOfflineBook.jsx";
import TeacherOfflineLibrary from "./TeacherOfflineLibrary.jsx";
import { createTeacherEditionControls } from "./teacherEditionControls.js";
import { HostedUnitExtrasDraftStatus } from "virtual:unit-extras-draft-status";
import TeacherOfflineMedia from "./TeacherOfflineMedia.jsx";
import TeacherViewportDiagnostics from "./TeacherViewportDiagnostics.jsx";
import { recordTeacherOfflineNavigation } from "./teacherOfflineDiagnostics.js";
import { useTeacherViewportProfile } from "./viewportProfiles.js";
import { useLegacyClassroomSound } from "./legacyClassroomSound.js";
import { ClassroomToolsProvider } from "./ClassroomToolsContext.jsx";
import TeacherOfflineSettingsDialog from "./TeacherOfflineSettingsDialog.jsx";
import TeacherStartupIntro from "./TeacherStartupIntro.jsx";
import TeacherFixedStage from "./TeacherFixedStage.jsx";
import TeacherShellChrome from "./TeacherShellChrome.jsx";
import TeacherViewerStartupStatus from "./TeacherViewerStartupStatus.jsx";
import { runInteractiveViewerStartup } from "./interactiveStartupAssets.js";
import { ACTIVE_TEACHER_THEME, useTeacherOfflineSettings } from "./teacherOfflineSettings.js";
import { resolveTeacherBookMenuSkin } from "./teacherBookMenuSkins.js";
import { teacherLibraryUnitMetadata } from "./teacherOfflineUnitMetadata.js";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion.js";
import {
  createUltimateB2TeacherRuntimeUiAssets,
  TeacherRuntimeUiAssetsProvider,
} from "./legacyClassroomAssets.js";
import bookMenuSkinSelections from "../../config/bookMenuSkinSelections.json";
import { selectedBookMenuSkinId } from "../../config/bookMenuSkins.js";
import { VIEWER_EXIT_FULLSCREEN_MESSAGE } from "../../shared/viewerPresentationProtocol.js";
import {
  isTeacherOfflinePageLocation,
  resolveTeacherOfflineActivityLocation,
} from "./teacherOfflineActivityLocation.js";
import {
  exchangeHostedPreviewComponentAuthorization,
  HOSTED_VIEWER_RUNTIME_MODES,
  loadHostedReleaseFamily,
  resolveHostedViewerRuntimeContext,
} from "./hostedReleasePreview.js";
import { createHostedPreviewComponentAuthorizationSession } from "./hostedPreviewComponentAuthorizationSession.js";
import { createHostedComponentPreparation, markUnavailableReleaseMembers } from "./hostedComponentPreparation.js";
import {
  isHostedViewerPreviewRequest,
  resolveHostedViewerComponentRequest,
  resolveHostedViewerPreviewIntent,
} from "./hostedViewerPreviewIntent.js";
import {
  getDefaultReviewComponent,
  resolveTeacherEditionComponent,
  reviewComponentRegistry,
} from "./reviewComponentRegistry.js";
const defaultLocation = { unitNumber: 1, tab: "pages", pageId: "" };
const initialPackState = Object.freeze({
  status: "loading",
  phase: "validating",
  progress: null,
  pack: null,
  uiManifest: null,
  error: null,
  message: "",
});

function startupErrorMessage(error, hosted) {
  if (error?.code === "LIVE_PREVIEW_UNAVAILABLE") {
    return "Live preview content could not be loaded. Check the connection and try again.";
  }
  if (error?.code === "VIEWER_ASSET_LOAD_FAILED" || error?.code === "VIEWER_ASSET_PLAN_INVALID") {
    return "A required page, interface or audio asset could not be prepared. Check the connection and try again.";
  }
  return hosted
    ? "The verified Viewer content could not be prepared. Try again."
    : "Reinstall the verified classroom application.";
}

const classroomBackdropGradients = Object.freeze({
  contents: "linear-gradient(rgba(21, 79, 120, 0.08), rgba(81, 35, 119, 0.12))",
  "unit-overview": "linear-gradient(180deg, rgba(2, 89, 132, 0.06), rgba(88, 35, 127, 0.1))",
  page: "linear-gradient(180deg, rgba(2, 89, 132, 0.08), rgba(88, 35, 127, 0.08))",
});

function resolveViewportBackdrop({ startupIntroPending, navigation, classroomBackground }) {
  if (startupIntroPending) return { name: "intro", color: "#fefefe", image: "none" };
  if (navigation.view === "library") {
    return {
      name: "library",
      color: "#064968",
      image: classroomBackground ? `url("${classroomBackground}")` : "none",
    };
  }
  if (navigation.view === "media") {
    return {
      name: "media",
      color: "#7abbd7",
      image: "linear-gradient(145deg, #e7f7ff, #b9deef 54%, #7abbd7)",
    };
  }

  const location = navigation.location || defaultLocation;
  const name = location.tab === "exercises" ? "contents" : location.pageId ? "page" : "unit-overview";
  const gradient = classroomBackdropGradients[name] || classroomBackdropGradients.contents;
  return {
    name,
    color: "#064968",
    image: classroomBackground ? `${gradient}, url("${classroomBackground}")` : gradient,
  };
}

function componentIdentity(runtime) {
  return { bookSlug: runtime.bookSlug, componentSlug: runtime.componentSlug };
}

function libraryState(runtime) {
  return { teacherOffline: true, ...componentIdentity(runtime), view: "library" };
}

function emptyComponentState(status = "idle") {
  return { status, phase: status, progress: null, pack: null, error: null, message: "" };
}

export default function TeacherOfflineApp() {
  const viewport = useTeacherViewportProfile();
  const defaultRuntime = useMemo(() => getDefaultReviewComponent(), []);
  const hosted = defaultRuntime.startupAssets.hosted;
  const componentRequest = useMemo(() => resolveHostedViewerComponentRequest({
    search: globalThis.location?.search || "",
    hosted,
    registry: reviewComponentRegistry,
  }), [hosted]);
  const initialRuntime = useMemo(() => (
    componentRequest.kind === "installed" ? componentRequest.runtime
      : componentRequest.kind === "none" ? defaultRuntime
        : null
  ), [componentRequest, defaultRuntime]);
  const packageRuntimes = useMemo(() => [...reviewComponentRegistry.installed.values()]
    .filter((runtime) => runtime.bookSlug === (initialRuntime || defaultRuntime).bookSlug), [defaultRuntime, initialRuntime]);
  const initialRuntimeContext = useMemo(() => resolveHostedViewerRuntimeContext(), []);
  const [activeRuntime, setActiveRuntime] = useState(initialRuntime);
  const [productState, setProductState] = useState(initialPackState);
  const [componentStates, setComponentStates] = useState(() => Object.fromEntries(
    packageRuntimes.map((runtime) => [runtime.key, emptyComponentState()]),
  ));
  const componentStatesRef = useRef(componentStates);
  const componentPreparationRef = useRef(new Map());
  const prepareComponentRef = useRef(async () => null);
  const authorizationSessionRef = useRef(null);
  const [authorizationRevision, setAuthorizationRevision] = useState(0);
  const runtimeUiIdentity = initialRuntime?.uiOwnerIdentity || componentIdentity(initialRuntime || defaultRuntime);
  useEffect(() => {
    if (hosted) document.title = `${initialRuntime?.book.title || componentRequest.bookTitle || "Hamilton House"} Viewer`;
  }, [componentRequest.bookTitle, hosted, initialRuntime]);
  const updateComponentState = useCallback((runtime, state) => {
    const current = componentStatesRef.current[runtime.key] || emptyComponentState();
    const next = typeof state === "function" ? state(current) : state;
    componentStatesRef.current = { ...componentStatesRef.current, [runtime.key]: next };
    setComponentStates(componentStatesRef.current);
  }, []);
  const runtimeUiContext = useMemo(() => {
    void authorizationRevision;
    return authorizationSessionRef.current?.contextFor(runtimeUiIdentity) || initialRuntimeContext;
  }, [authorizationRevision, initialRuntimeContext, runtimeUiIdentity.bookSlug, runtimeUiIdentity.componentSlug]);
  const runtimeUiAssets = useMemo(
    () => createUltimateB2TeacherRuntimeUiAssets(productState.uiManifest, runtimeUiContext, runtimeUiIdentity),
    [productState.uiManifest, runtimeUiContext, runtimeUiIdentity.bookSlug, runtimeUiIdentity.componentSlug],
  );
  const classroomSound = useLegacyClassroomSound(runtimeUiAssets);
  const settings = useTeacherOfflineSettings();
  const prefersReducedMotion = usePrefersReducedMotion();
  const animationsActive = settings.graphics.motionEnabled && !prefersReducedMotion;
  const hostedPreviewRequested = isHostedViewerPreviewRequest(globalThis.location?.search || "", hosted);
  const [startupIntroPending, setStartupIntroPending] = useState(animationsActive && !hostedPreviewRequested);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [navigation, setNavigation] = useState(() => libraryState(initialRuntime || defaultRuntime));
  const [componentFeedback, setComponentFeedback] = useState("");
  const navigationRef = useRef(navigation);
  const settingsOpenRef = useRef(settingsOpen);
  const startupIntroPendingRef = useRef(startupIntroPending);
  const initialPreviewAppliedRef = useRef(false);
  navigationRef.current = navigation;
  settingsOpenRef.current = settingsOpen;
  startupIntroPendingRef.current = startupIntroPending;

  useEffect(() => {
    if (!animationsActive || hostedPreviewRequested) setStartupIntroPending(false);
  }, [animationsActive, hostedPreviewRequested]);

  useEffect(() => {
    const previous = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = `${16 * settings.graphics.interfaceScale / 100}px`;
    return () => { document.documentElement.style.fontSize = previous; };
  }, [settings.graphics.interfaceScale]);

  useEffect(() => {
    if (!initialRuntime) {
      setProductState({ ...initialPackState, status: "unavailable" });
      return undefined;
    }
    const controller = new AbortController();
    authorizationSessionRef.current?.dispose();
    componentPreparationRef.current = new Map();
    initialPreviewAppliedRef.current = false;
    setActiveRuntime(initialRuntime);
    setProductState(initialPackState);
    const resetStates = Object.fromEntries(packageRuntimes.map((runtime) => [runtime.key, emptyComponentState()]));
    componentStatesRef.current = resetStates;
    setComponentStates(resetStates);
    const authorizationSession = createHostedPreviewComponentAuthorizationSession({
      initialContext: initialRuntimeContext,
      initialIdentity: componentIdentity(initialRuntime),
      exchange: (options) => exchangeHostedPreviewComponentAuthorization({ ...options, signal: controller.signal }),
      onChange: () => setAuthorizationRevision((revision) => revision + 1),
      onError: (identity) => setComponentFeedback(`${identity.componentSlug} authorization expired. Refresh Review to continue.`),
    });
    authorizationSessionRef.current = authorizationSession;
    const preparationCounts = new Map(), unavailableReleaseMembers = new Map();
    const recordPreparation = (runtime) => {
      const count = (preparationCounts.get(runtime.componentSlug) || 0) + 1;
      preparationCounts.set(runtime.componentSlug, count);
      globalThis.dispatchEvent?.(new CustomEvent("teacher:component-prepared", { detail: { componentSlug: runtime.componentSlug, count } }));
    };

    const prepareMetadata = createHostedComponentPreparation({ authorizationSession, componentIdentity,
      preparationCache: componentPreparationRef.current, recordPreparation, signal: controller.signal,
      startupErrorMessage, unavailableReleaseMembers, updateComponentState, emptyComponentState });
    prepareComponentRef.current = prepareMetadata;

    const start = async () => {
      const runtimeContext = await authorizationSession.ensure(componentIdentity(initialRuntime));
      if (runtimeContext.kind === HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW) {
        const family = await loadHostedReleaseFamily({ runtimeContext, identity: componentIdentity(initialRuntime), signal: controller.signal });
        markUnavailableReleaseMembers({ family, registry: reviewComponentRegistry, unavailableReleaseMembers, updateComponentState, emptyComponentState });
      }
      const shellIdentity = initialRuntime.uiOwnerIdentity || componentIdentity(initialRuntime);
      const shellContext = await authorizationSession.ensure(shellIdentity);
      recordPreparation(initialRuntime);
      globalThis.dispatchEvent?.(new CustomEvent("teacher:product-startup", { detail: { count: 1 } }));
      const pending = runInteractiveViewerStartup({
        loadContentPack: () => initialRuntime.contentPackProvider.load({ runtimeContext, signal: controller.signal }),
        loadUiManifest: ({ signal }) => initialRuntime.uiManifestProvider?.load?.({ runtimeContext: shellContext, signal }) || Promise.resolve(null),
        prepareHotspots: () => initialRuntime.hotspotProvider?.prepare?.({ runtimeContext, signal: controller.signal }) || Promise.resolve(),
        startupAssets: initialRuntime.startupAssets, assetRuntimeContext: shellContext,
        getContentRuntimeContext: () => authorizationSession.contextFor(componentIdentity(initialRuntime)),
        signal: controller.signal,
        onState: (state) => {
          const normalized = {
            ...state,
            message: state.status === "error" ? startupErrorMessage(state.error, initialRuntime.startupAssets.hosted) : "",
          };
          setProductState(normalized);
          updateComponentState(initialRuntime, { ...normalized, uiManifest: undefined });
        },
      });
      componentPreparationRef.current.set(initialRuntime.key, pending.then((result) => ({
        status: "ready", phase: "ready", progress: null, pack: result.pack, error: null, message: "",
      })));
      await componentPreparationRef.current.get(initialRuntime.key);
      const result = await pending;
      updateComponentState(initialRuntime, { status: "ready", phase: "ready", progress: null, pack: result.pack, error: null, message: "" });
      setProductState((current) => ({ ...current, status: "ready", phase: "ready", pack: null, uiManifest: result.uiManifest, error: null, message: "" }));
      if (initialRuntimeContext.kind === HOSTED_VIEWER_RUNTIME_MODES.BUILDER_PREVIEW) {
        for (const runtime of packageRuntimes) {
          if (runtime.key !== initialRuntime.key) void prepareMetadata(runtime).catch(() => {});
        }
      }
    };
    start().catch((error) => {
      if (controller.signal.aborted) return;
      const failed = {
        ...emptyComponentState("error"),
        error,
        message: startupErrorMessage(error, initialRuntime.startupAssets.hosted),
      };
      setProductState(failed);
      updateComponentState(initialRuntime, failed);
      if (import.meta.env.DEV) console.error("Teacher product startup failed", error);
    });
    return () => {
      controller.abort();
      authorizationSession.dispose();
      if (authorizationSessionRef.current === authorizationSession) authorizationSessionRef.current = null;
    };
  }, [initialRuntime, initialRuntimeContext, packageRuntimes, startupAttempt, updateComponentState]);

  useEffect(() => {
    recordTeacherOfflineNavigation(navigation.view);
  }, [navigation.view]);

  useEffect(() => {
    const initial = libraryState(activeRuntime || defaultRuntime);
    window.history.replaceState(initial, "", "#library");
    const onPopState = (event) => setNavigation(event.state?.teacherOffline ? event.state : initial);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [defaultRuntime]);

  const navigate = (state, { replace = false, runtime = activeRuntime } = {}) => {
    const next = { teacherOffline: true, ...componentIdentity(runtime), ...state };
    setNavigation(next);
    const method = replace ? "replaceState" : "pushState";
    window.history[method](next, "", `#${next.view}`);
  };
  const openBook = (unitNumber = null, runtime = activeRuntime) => {
    const storedLocation = readTeacherOfflineLocation(runtime) || defaultLocation;
    const location = unitNumber
      ? { ...storedLocation, unitNumber, tab: "pages", pageId: "" }
      : storedLocation;
    writeTeacherOfflineLocation(location, runtime);
    navigate({ view: "book", location }, { runtime });
  };
  const closeApplication = useCallback(async () => {
    if (Capacitor.isNativePlatform()) await App.exitApp();
  }, []);
  const minimizeApplication = useCallback(async () => {
    if (Capacitor.isNativePlatform()) {
      await App.minimizeApp();
      return;
    }
    if (hosted && globalThis.parent && globalThis.parent !== globalThis) {
      globalThis.parent.postMessage(VIEWER_EXIT_FULLSCREEN_MESSAGE, "*");
    }
  }, [hosted]);
  const updateBookLocation = (location, options) => {
    writeTeacherOfflineLocation(location, activeRuntime);
    navigate({ view: "book", location }, { ...options, replace: true });
  };
  const replaceBookNavigation = (location) => {
    const next = { teacherOffline: true, ...componentIdentity(activeRuntime), view: "book", location };
    writeTeacherOfflineLocation(location, activeRuntime);
    navigationRef.current = next;
    setNavigation(next);
    window.history.replaceState(next, "", "#book");
  };
  const returnToBookPage = () => {
    const location = navigationRef.current.location || defaultLocation;
    replaceBookNavigation({ ...location, tab: "pages" });
  };
  const returnToUnitOverview = () => {
    const location = navigationRef.current.location || defaultLocation;
    replaceBookNavigation({ ...location, tab: "pages", pageId: "" });
  };
  const returnToLibrary = () => {
    const next = libraryState(activeRuntime);
    navigationRef.current = next;
    setNavigation(next);
    window.history.replaceState(next, "", "#library");
  };

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let disposed = false;
    let backHandle;
    const register = async () => {
      backHandle = await App.addListener("backButton", async () => {
        if (startupIntroPendingRef.current) {
          return;
        }
        if (settingsOpenRef.current) {
          setSettingsOpen(false);
          return;
        }
        if (document.fullscreenElement) {
          await document.exitFullscreen().catch(() => {});
          return;
        }
        const current = navigationRef.current;
        if (current.view === "library") {
          await App.exitApp();
          return;
        }
        if (current.view === "book" && current.activityId) {
          returnToBookPage();
          return;
        }
        if (current.view === "book") {
          if (current.location?.pageId || current.location?.tab === "exercises") returnToUnitOverview();
          else returnToLibrary();
          return;
        }
        if (current.view === "media") returnToBookPage();
      });
      if (disposed) await backHandle.remove();
    };
    register();
    return () => {
      disposed = true;
      backHandle?.remove();
    };
  }, []);

  const activeComponentState = activeRuntime ? componentStates[activeRuntime.key] || emptyComponentState() : emptyComponentState("unavailable");
  const pack = activeComponentState.pack;
  const packReady = activeComponentState.status === "ready" && Boolean(pack);
  const activeRuntimeContext = useMemo(() => {
    void authorizationRevision;
    return activeRuntime
      ? authorizationSessionRef.current?.contextFor(componentIdentity(activeRuntime)) || initialRuntimeContext
      : initialRuntimeContext;
  }, [activeRuntime, authorizationRevision, initialRuntimeContext]);
  const pageUnits = useMemo(() => {
    const prepared = pack?.pageUnits || activeRuntime?.pageUnits || [];
    return activeRuntime?.authorizePageUnits && activeRuntimeContext.kind === HOSTED_VIEWER_RUNTIME_MODES.BUILDER_PREVIEW
      ? activeRuntime.authorizePageUnits(prepared, activeRuntimeContext.authorization)
      : prepared;
  }, [activeRuntime, activeRuntimeContext, pack]);
  const initialComponentState = initialRuntime ? componentStates[initialRuntime.key] || emptyComponentState() : emptyComponentState("unavailable");
  const initialPageUnits = initialComponentState.pack?.pageUnits || initialRuntime?.pageUnits || [];
  const hostedPreviewIntent = useMemo(() => resolveHostedViewerPreviewIntent({
    search: globalThis.location?.search || "",
    hosted,
    activities: initialComponentState.pack?.activities?.activities || [],
    pageUnits: initialPageUnits,
    registry: reviewComponentRegistry,
  }), [hosted, initialComponentState.pack, initialPageUnits]);

  useEffect(() => {
    if (initialComponentState.status !== "ready" || hostedPreviewIntent.kind !== "valid" || initialPreviewAppliedRef.current) return;
    initialPreviewAppliedRef.current = true;
    const next = { teacherOffline: true, ...componentIdentity(initialRuntime), ...hostedPreviewIntent.navigation };
    navigationRef.current = next;
    setNavigation(next);
    const hash = next.activityId ? `#book/activity/${encodeURIComponent(next.activityId)}` : `#${next.view}`;
    window.history.replaceState(next, "", hash);
  }, [hostedPreviewIntent, initialComponentState.status, initialRuntime]);

  const productPackageId = runtimeUiIdentity.componentSlug;
  const selectedMenuSkinId = productState.status === "ready" ? selectedBookMenuSkinId(bookMenuSkinSelections, productPackageId) : "";
  const menuSkin = productState.status === "ready" ? resolveTeacherBookMenuSkin(productPackageId, selectedMenuSkinId, runtimeUiAssets) : null;
  const openBookActivity = (activityId, originLocation = null) => {
    if (!packReady) return;
    const resolved = resolveTeacherOfflineActivityLocation({
      activityId,
      activities: pack.activities.activities,
      pageUnits,
      originLocation,
    });
    const nativeHotspotLocation = !resolved && originLocation?.pageId
      ? { unitNumber: Number(originLocation.unitNumber), tab: "pages", pageId: originLocation.pageId }
      : null;
    const activityLocation = resolved?.location || nativeHotspotLocation;
    if (!activityLocation) return;
    const pageState = { teacherOffline: true, ...componentIdentity(activeRuntime), view: "book", location: activityLocation };
    writeTeacherOfflineLocation(activityLocation, activeRuntime);
    if (navigationRef.current.view !== "book"
      || !isTeacherOfflinePageLocation(navigationRef.current.location, activityLocation)) {
      window.history.pushState(pageState, "", "#book");
    }
    const activityState = { ...pageState, activityId };
    setNavigation(activityState);
    window.history.pushState(activityState, "", `#book/activity/${encodeURIComponent(activityId)}`);
  };
  const { allowTeacherEdition, unavailableEditionIds, unavailableEditionMessages, unavailableEditionLabels } = createTeacherEditionControls({
    bookSlug: (activeRuntime || initialRuntime)?.bookSlug, packageRuntimes, componentStates,
    readComponentStates: () => componentStatesRef.current, onUnavailable: setComponentFeedback,
  });
  const switchTeacherEdition = async (teacherEditionId, requestedUnitNumber = null) => {
    if (!allowTeacherEdition(teacherEditionId)) return false;
    const resolution = resolveTeacherEditionComponent((activeRuntime || initialRuntime).bookSlug, teacherEditionId);
    if (resolution.kind !== "installed") {
      const title = resolution.registration?.component?.title || "The requested component";
      setComponentFeedback(`${title} content is registered but not installed for Teacher Review.`);
      return false;
    }
    if (resolution.runtime.key === activeRuntime?.key) {
      setComponentFeedback("");
      try {
        await prepareComponentRef.current(resolution.runtime);
        openBook(requestedUnitNumber, resolution.runtime);
      } catch {
        setComponentFeedback("The selected component could not be prepared for Builder Review. Refresh the review and try again.");
        return false;
      }
      return true;
    }
    const nextRuntime = resolution.runtime;
    setActiveRuntime(nextRuntime);
    setComponentFeedback("");
    try {
      await prepareComponentRef.current(nextRuntime);
      openBook(requestedUnitNumber, nextRuntime);
      return true;
    } catch {
      setComponentFeedback("The selected component could not be authorized or prepared for Builder Review. Refresh the review and try again.");
      return false;
    }
  };
  const selectTeacherEdition = (teacherEditionId) => {
    if (!allowTeacherEdition(teacherEditionId)) return false;
    // Extras belongs to the launcher, not to a component runtime.
    if (teacherEditionId === "extras") return true;
    const resolution = resolveTeacherEditionComponent((activeRuntime || initialRuntime).bookSlug, teacherEditionId);
    if (resolution.kind !== "installed") return;
    const nextRuntime = resolution.runtime;
    setActiveRuntime(nextRuntime);
    const next = libraryState(nextRuntime);
    navigationRef.current = next;
    setNavigation(next);
    window.history.replaceState(next, "", "#library");
    setComponentFeedback("");
    void prepareComponentRef.current(nextRuntime).catch(() => {
      setComponentFeedback("The selected component could not be authorized or prepared for Builder Review. Refresh the review and try again.");
    });
    return true;
  };
  const unitAvailabilityByEdition = Object.fromEntries(packageRuntimes.map((runtime) => [
    runtime.component.teacherEditionId,
    new Set(((componentStates[runtime.key]?.pack?.pageUnits) || runtime.pageUnits || []).map((unit) => Number(unit.number))),
  ]));
  const packageStudentsRuntime = packageRuntimes.find((runtime) => runtime.component.teacherEditionId === "students-book");
  const packageUnitMetadata = teacherLibraryUnitMetadata(packageStudentsRuntime?.bookSlug, componentStates[packageStudentsRuntime?.key]?.pack?.pageUnits || packageStudentsRuntime?.pageUnits || []);
  let content;
  if (startupIntroPending) {
    content = <TeacherStartupIntro onFinish={() => setStartupIntroPending(false)} />;
  } else if (componentRequest.kind === "invalid" || componentRequest.kind === "unavailable") {
    content = <main className="teacher-viewer-preview-invalid" role="alert"><h1>Preview unavailable</h1><p>{componentRequest.message}</p></main>;
  } else if (productState.status === "loading") {
    content = initialRuntime.startupAssets.hosted
      ? <TeacherViewerStartupStatus state={productState} hosted bookTitle={initialRuntime.book.title} />
      : <div className="teacher-offline-pack-wait" aria-hidden="true" />;
  } else if (productState.status === "error") {
    content = <TeacherViewerStartupStatus state={productState} hosted={initialRuntime.startupAssets.hosted} bookTitle={initialRuntime.book.title} onRetry={() => setStartupAttempt((attempt) => attempt + 1)} />;
  } else if (!initialPreviewAppliedRef.current && (hostedPreviewIntent.kind === "invalid" || hostedPreviewIntent.kind === "unavailable")) {
    content = <main className="teacher-viewer-preview-invalid" role="alert"><h1>Preview unavailable</h1><p>{hostedPreviewIntent.message}</p></main>;
  } else if (activeComponentState.status === "loading" || activeComponentState.status === "idle") {
    content = <main className="teacher-offline-component-status" role="status"><h1>Preparing {activeRuntime.component.title}</h1><p>The {activeRuntime.book.title} interface remains ready while this book is prepared.</p></main>;
  } else if (activeComponentState.status === "error") {
    content = <main className="teacher-offline-component-status damaged" role="alert"><h1>{activeRuntime.component.title} could not be prepared</h1><p>{activeComponentState.message}</p></main>;
  } else if (navigation.view === "media") {
    content = (
      <TeacherOfflineMedia
        media={navigation.media}
        onBack={returnToBookPage}
        onHome={returnToLibrary}
      />
    );
  } else if (navigation.view === "book") {
    content = (
      <TeacherOfflineBook
        pack={pack}
        pageUnits={pageUnits}
        location={navigation.location || defaultLocation}
        activityId={navigation.activityId || ""}
        onLocationChange={updateBookLocation}
        onOpenActivity={openBookActivity}
        onCloseActivity={returnToBookPage}
        onOpenMedia={(media) => navigate({ view: "media", media, location: navigation.location || defaultLocation })}
        onBackToLibrary={returnToLibrary}
        viewportProfile={viewport.profile}
        selectedBookId={activeRuntime.component.teacherEditionId}
        onBookSwitch={switchTeacherEdition}
        unavailableBookIds={unavailableEditionIds}
        unavailableBookMessages={unavailableEditionMessages}
        unavailableBookLabels={unavailableEditionLabels}
        hotspotProvider={activeRuntime.hotspotProvider}
        runtimeContext={activeRuntimeContext}
        componentIdentity={componentIdentity(activeRuntime)}
      />
    );
  } else {
    content = (
      <TeacherOfflineLibrary
        menuSkin={menuSkin}
        units={packageUnitMetadata}
        unitAvailabilityByEdition={unitAvailabilityByEdition}
        onOpenUnit={(editionId, unitNumber) => switchTeacherEdition(editionId, unitNumber)}
        animationsActive={animationsActive}
        initialEditionId={activeRuntime.component.teacherEditionId}
        onSelectEdition={selectTeacherEdition}
        unavailableEditionIds={unavailableEditionIds}
        unavailableEditionMessages={unavailableEditionMessages}
        unavailableEditionLabels={unavailableEditionLabels}
      />
    );
  }
  const userInterfaceScale = settings.graphics.interfaceScale / 100;
  const effectiveUiScale = Math.min(1.1, Math.max(0.9, userInterfaceScale));
  const startupSurfacePending = startupIntroPending || productState.status === "loading";
  const activeView = startupIntroPending
    ? "intro"
    : productState.status === "loading" ? "pack-wait"
    : productState.status === "error" ? "pack-error"
      : activeComponentState.status === "loading" || activeComponentState.status === "idle" ? "component-wait"
        : activeComponentState.status === "error" ? "component-error"
      : hostedPreviewIntent.kind === "invalid" ? "preview-invalid"
        : navigation.view;
  const viewportBackdrop = resolveViewportBackdrop({
    startupIntroPending: startupSurfacePending,
    navigation,
    classroomBackground: menuSkin?.background,
  });
  return (
    <TeacherRuntimeUiAssetsProvider value={runtimeUiAssets}>
    <ClassroomToolsProvider>
      <TeacherFixedStage
        viewport={viewport}
        viewportBackdrop={viewportBackdrop}
      >
      <div
        className={`teacher-offline-settings-surface ${settings.graphics.effectsEnabled ? "" : "teacher-effects-off"}`.trim()}
        data-teacher-theme={ACTIVE_TEACHER_THEME}
        data-teacher-motion={animationsActive ? "on" : "off"}
        data-teacher-motion-preference={settings.graphics.motionEnabled ? "on" : "off"}
        data-teacher-reduced-motion={prefersReducedMotion ? "reduce" : "no-preference"}
        data-teacher-display-scale={String(Number(viewport.displayScale.toFixed(3)))}
        data-teacher-display-profile={viewport.profile}
        style={{
          "--teacher-colour-intensity": 0.7 + settings.graphics.colourIntensity * 0.003,
          "--teacher-display-scale": viewport.displayScale,
          "--teacher-user-ui-scale": userInterfaceScale,
          "--teacher-ui-scale": effectiveUiScale,
        }}
      >
        <div key={activeView} className="teacher-offline-view-transition" data-teacher-view={activeView} data-book-activity={navigation.activityId || undefined}>
          {content}
        </div>
        {componentFeedback ? <p className="teacher-component-feedback" role="status">{componentFeedback}</p> : null}
        {!startupIntroPending && packReady && activeRuntimeContext?.kind === HOSTED_VIEWER_RUNTIME_MODES.BUILDER_PREVIEW && activeRuntime.componentSlug === "ultimate-b2-students-book" ? <HostedUnitExtrasDraftStatus runtimeContext={activeRuntimeContext} identity={componentIdentity(activeRuntime)} /> : null}
        {!startupIntroPending && packReady && (
          <TeacherShellChrome
            menuSkin={menuSkin}
            onOpenSettings={() => setSettingsOpen(true)}
            onMinimize={minimizeApplication}
            onClose={closeApplication}
          />
        )}
        {!startupIntroPending && packReady && navigation.view === "media" && <button
          type="button"
          className="legacy-classroom-sound-toggle"
          aria-label={classroomSound.enabled ? "Mute classroom interface sounds" : "Enable classroom interface sounds"}
          aria-pressed={classroomSound.enabled}
          title={classroomSound.enabled ? "Mute interface sounds" : "Enable interface sounds"}
          onClick={() => classroomSound.setEnabled(!classroomSound.enabled)}
        >
          {classroomSound.enabled ? <Volume2 size={22} /> : <VolumeX size={22} />}
        </button>}
        <TeacherOfflineSettingsDialog open={settingsOpen} onClose={closeSettings} />
        {import.meta.env.DEV && packReady && !startupIntroPending ? <TeacherViewportDiagnostics /> : null}
      </div>
      </TeacherFixedStage>
    </ClassroomToolsProvider>
    </TeacherRuntimeUiAssetsProvider>
  );
}
