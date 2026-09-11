import { LegacyClassroomIcon, useTeacherRuntimeUiAssets } from "./legacyClassroomAssets.js";
import TeacherBookNavigationCore from "./TeacherBookNavigationCore.jsx";

const noOp = () => {};

export default function TeacherBookNavigation({
  onHome,
  onBack,
  onPrevious = noOp,
  onNext = noOp,
  previousDisabled = true,
  nextDisabled = true,
  navigationMode = "page",
  contextAction = null,
  contextActions = null,
  internalNavigation = null,
  selectedBookId = "students-book",
  onBookSwitch = noOp,
  unavailableBookIds = new Set(),
  unavailableBookMessages = new Map(),
  unavailableBookLabels = new Map(),
}) {
  const runtimeUiAssets = useTeacherRuntimeUiAssets();
  return <TeacherBookNavigationCore
    navigationMode={navigationMode}
    {...{ onHome, onBack, onPrevious, onNext, previousDisabled, nextDisabled, contextAction, contextActions, internalNavigation, selectedBookId, onBookSwitch, unavailableBookIds, unavailableBookMessages, unavailableBookLabels }}
    bookSwitches={runtimeUiAssets.classroom.bookSwitches}
    renderIcon={(name) => <LegacyClassroomIcon name={name} />}
    renderContextIcon={(action) => action.artwork ? <span className="teacher-book-navigation-context-icon-set" aria-hidden="true"><img data-icon-state="active" src={action.artwork.active} alt="" draggable="false" /><img data-icon-state="pressed" src={action.artwork.pressed} alt="" draggable="false" /><img data-icon-state="disabled" src={action.artwork.disabled} alt="" draggable="false" /></span> : null}
    renderBookSwitch={(item) => <img className="teacher-book-navigation-book-switch-image" src={item.source} alt="" draggable="false" />}
  />;
}
