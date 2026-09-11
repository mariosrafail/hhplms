import TeacherBookNavigation from "./TeacherBookNavigation.jsx";
import TeacherOfflineActivityList from "./TeacherOfflineActivityList.jsx";
import TeacherOfflinePages from "./TeacherOfflinePages.jsx";
import { useTeacherRuntimeUiAssets } from "./legacyClassroomAssets.js";

export default function TeacherOfflineBook({
  pack,
  pageUnits,
  location,
  activityId,
  onLocationChange,
  onOpenActivity,
  onCloseActivity,
  onOpenMedia,
  onBackToLibrary,
  viewportProfile,
  selectedBookId,
  onBookSwitch,
  unavailableBookIds,
  unavailableBookMessages,
  unavailableBookLabels,
  hotspotProvider,
  runtimeContext,
  componentIdentity,
}) {
  const runtimeUiAssets = useTeacherRuntimeUiAssets();
  const availableUnitNumbers = (pageUnits || [])
    .map((unit) => Number(unit.number))
    .filter((number) => Number.isInteger(number))
    .sort((left, right) => left - right);
  const requestedUnitNumber = Number(location.unitNumber);
  const unitNumber = availableUnitNumbers.includes(requestedUnitNumber)
    ? requestedUnitNumber
    : availableUnitNumbers[0] || 1;
  const tab = location.tab === "exercises" ? "exercises" : "pages";
  const pageViewerActive = tab === "pages" && Boolean(location.pageId);
  const unitOverviewActive = tab === "pages" && !location.pageId;
  const activeActivity = pack.activities.activities.find((activity) => activity.stableActivityId === activityId) || null;
  const update = (patch, options) => onLocationChange({ ...location, ...patch }, options);

  return (
    <main
      className={`teacher-offline-book ${pageViewerActive ? "page-viewer-active" : ""} ${unitOverviewActive ? "unit-overview-active" : ""} ${tab === "exercises" ? "contents-active" : ""}`.trim()}
      style={{
        "--legacy-classroom-background": `url(${runtimeUiAssets.classroom.backgrounds.classroomGlacier})`,
        "--legacy-students-book-parts-background": `url(${runtimeUiAssets.classroom.backgrounds.studentsBookPartsBackground})`,
      }}
    >
      {tab === "pages" ? (
        <TeacherOfflinePages
          unit={pageUnits.find((candidate) => Number(candidate.number) === unitNumber)}
          selectedPageId={location.pageId}
          onSelectPage={(pageId, options) => update({ pageId }, options)}
          activeActivity={activeActivity}
          activeActivityId={activityId}
          onOpenActivity={(nextActivityId) => onOpenActivity(nextActivityId, { unitNumber, tab: "pages", pageId: location.pageId })}
          onCloseActivity={onCloseActivity}
          onOpenMedia={onOpenMedia}
          onBackToLibrary={onBackToLibrary}
          viewportProfile={viewportProfile}
          selectedBookId={selectedBookId}
          onBookSwitch={onBookSwitch}
          unavailableBookIds={unavailableBookIds}
          unavailableBookMessages={unavailableBookMessages}
          unavailableBookLabels={unavailableBookLabels}
          hotspotProvider={hotspotProvider}
          runtimeContext={runtimeContext}
          componentIdentity={componentIdentity}
        />
      ) : (
        <>
          <TeacherOfflineActivityList
            unit={pack.catalog.units.find((candidate) => Number(candidate.unitNumber) === unitNumber)}
            onOpenActivity={onOpenActivity}
          />
          <TeacherBookNavigation
            onHome={onBackToLibrary}
            onBack={() => update({ tab: "pages", pageId: "" })}
            selectedBookId={selectedBookId}
            onBookSwitch={onBookSwitch}
            unavailableBookIds={unavailableBookIds}
            unavailableBookMessages={unavailableBookMessages}
            unavailableBookLabels={unavailableBookLabels}
          />
        </>
      )}
    </main>
  );
}
