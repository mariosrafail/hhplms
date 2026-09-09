import { useEffect, useMemo, useState } from "react";
import { ultimateB2Package } from "../../../data/ultimateB2DemoData.js";
import { BookPackageComponentGrid } from "./BookPackageComponentGrid.jsx";
import { BookComponentDetail } from "./BookComponentDetail.jsx";
import { PublishedBookInteractive } from "./PublishedBookInteractive.jsx";
import { getComponentRouteSlug, getPackageRouteSlug } from "../../../utils/hashRoutes.js";
import { findBookComponentById, isBookMatch, getExerciseActivityKey } from "./bookBrowserUtils.js";
import { filterPhaseOneComponents, isPhaseOneComponentVisible } from "../../../config/bookCatalogVisibility.js";

export function BookPackageBrowser({
  mode = "student",
  onStartExercise,
  onPreviewExercise,
  onPresentExercise,
  completedActivities = {},
  classOptions = ultimateB2Package.classes,
  classes = [],
  currentUser = null,
  bookPackage = ultimateB2Package,
  selectedComponentId: controlledSelectedComponentId,
  selectedSubview = null,
  selectedPageUnitId = null,
  selectedPageId = null,
  selectedPageNumber = null,
  initialSelectedComponentId = null,
  onSelectComponent,
  onSelectBookPage,
  onSelectSubview,
  onBackToBooks,
  highlightedActivityKey = null,
  disableHighlightedActivityLaunch = false,
}) {
  const activePackage = useMemo(() => filterPhaseOneComponents(bookPackage || ultimateB2Package), [bookPackage]);
  const [uncontrolledSelectedComponentId, setUncontrolledSelectedComponentId] = useState(initialSelectedComponentId);
  const selectedComponentId = controlledSelectedComponentId !== undefined ? controlledSelectedComponentId : uncontrolledSelectedComponentId;
  const selectedComponent = useMemo(() => findBookComponentById(activePackage, selectedComponentId), [activePackage, selectedComponentId]);
  const componentRouteSlug = getComponentRouteSlug(selectedComponent || {});
  const publishedComponentSlug = selectedComponent?.slug?.startsWith("ultimate-b2-") ? selectedComponent.slug
    : componentRouteSlug.startsWith("ultimate-b2-") ? componentRouteSlug : `ultimate-b2-${componentRouteSlug}`;
  const publishedInteractive = !String(import.meta.env.VITE_APP_MODE || "web").includes("offline")
    && getPackageRouteSlug(activePackage) === "ultimate-b2"
    && isPhaseOneComponentVisible(activePackage, selectedComponent || {})
    && ["ultimate-b2-students-book", "ultimate-b2-workbook"].includes(publishedComponentSlug);

  const selectComponent = (componentId) => {
    if (controlledSelectedComponentId === undefined) {
      setUncontrolledSelectedComponentId(componentId);
    }
    onSelectComponent?.(componentId);
  };

  const backToBooks = () => {
    if (controlledSelectedComponentId === undefined) {
      setUncontrolledSelectedComponentId(null);
    }
    onBackToBooks?.();
  };

  useEffect(() => {
    if (controlledSelectedComponentId !== undefined) return;
    setUncontrolledSelectedComponentId(initialSelectedComponentId);
  }, [controlledSelectedComponentId, initialSelectedComponentId]);

  useEffect(() => {
    if (selectedComponentId && !activePackage.components.some((component) => isBookMatch(component, selectedComponentId))) {
      selectComponent(null);
    }
  }, [activePackage, selectedComponentId]);

  return (
    <section className={`book-package-browser ${mode === "teacher" ? "teacher-mode" : "student-mode"}`}>
      {selectedComponent && publishedInteractive ? (
        <PublishedBookInteractive bookSlug={getPackageRouteSlug(activePackage)} componentSlug={publishedComponentSlug} currentUser={currentUser} mode={mode}
          onLegacyActivity={selectedComponent.legacyDiscoveryAllowed === false ? undefined : (activityId) => {
            const exercise = selectedComponent.units.flatMap((unit) => unit.lessons.flatMap((lesson) => lesson.exercises)).find((item) => getExerciseActivityKey(item) === activityId);
            const launch = mode === "teacher" ? onPreviewExercise : onStartExercise;
            if (!exercise || exercise.locked || (mode !== "teacher" && !exercise.availableToStudent) || !launch) return false;
            launch(exercise);
            return true;
          }}
          pageId={selectedPageId} pageNumber={selectedPageNumber} onSelectBookPage={onSelectBookPage} />
      ) : selectedComponent ? (
        <BookComponentDetail
          component={selectedComponent}
          bookPackage={activePackage}
          mode={mode}
          onStartExercise={onStartExercise}
          onPreviewExercise={onPreviewExercise}
          onPresentExercise={onPresentExercise}
          classOptions={classOptions}
          classes={classes}
          currentUser={currentUser}
          completedActivities={completedActivities}
          selectedSubview={selectedSubview}
          selectedPageUnitId={selectedPageUnitId}
          selectedPageId={selectedPageId}
          selectedPageNumber={selectedPageNumber}
          onSelectBookPage={onSelectBookPage}
          onSelectSubview={onSelectSubview}
          highlightedActivityKey={highlightedActivityKey}
          disableHighlightedActivityLaunch={disableHighlightedActivityLaunch}
        />
      ) : (
        <BookPackageComponentGrid
          bookPackage={activePackage}
          mode={mode}
          onSelectBook={(componentId) => {
            const component = activePackage.components.find((item) => item.id === componentId);
            selectComponent(component ? getComponentRouteSlug(component) : componentId);
          }}
        />
      )}
    </section>
  );
}

export { BookSubpageNavigation } from "./BookSubpageNavigation.jsx";
export { findBookComponentById, buildBookPackageComponentHash } from "./bookBrowserUtils.js";
export { coverAssets } from "./bookCoverAssets.js";
