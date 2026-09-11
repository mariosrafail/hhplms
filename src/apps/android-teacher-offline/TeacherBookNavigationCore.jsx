const noOp = () => {};

export default function TeacherBookNavigationCore({
  renderIcon,
  renderContextIcon = null,
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
  bookSwitches = [],
  selectedBookId = "students-book",
  onBookSwitch = noOp,
  unavailableBookIds = new Set(),
  unavailableBookMessages = new Map(),
  unavailableBookLabels = new Map(),
  renderBookSwitch = null,
}) {
  const actions = contextActions || (contextAction ? [contextAction] : []);
  return (
    <nav className="teacher-book-navigation" aria-label="Book navigation" data-teacher-book-navigation="">
      <button type="button" onClick={onHome} aria-label="Home" title="Home">{renderIcon("home")}</button>
      <button type="button" onClick={onBack} aria-label="Back" title="Back">{renderIcon("back")}</button>
      <button type="button" disabled={previousDisabled} onClick={onPrevious} aria-label={`Previous ${navigationMode}`} title={`Previous ${navigationMode}`}>{renderIcon("previous")}</button>
      <button type="button" disabled={nextDisabled} onClick={onNext} aria-label={`Next ${navigationMode}`} title={`Next ${navigationMode}`}>{renderIcon("next")}</button>
      {internalNavigation && <>
        <button type="button" className="teacher-book-navigation-internal" disabled={internalNavigation.previousDisabled} onClick={internalNavigation.onPrevious} aria-label="Previous activity part" title="Previous activity part">{renderIcon(internalNavigation.previousDisabled ? "previousInternalDisabled" : "previousInternal")}</button>
        <button type="button" className="teacher-book-navigation-internal" disabled={internalNavigation.nextDisabled} onClick={internalNavigation.onNext} aria-label="Next activity part" title="Next activity part">{renderIcon(internalNavigation.nextDisabled ? "nextInternalDisabled" : "nextInternal")}</button>
      </>}
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={`teacher-book-navigation-context teacher-book-navigation-context--${action.id}`}
          data-teacher-control-id={action.controlId}
          disabled={Boolean(action.disabled)}
          onClick={action.onClick}
          aria-label={action.ariaLabel || action.label}
          aria-pressed={typeof action.active === "boolean" ? action.active : undefined}
          title={action.title || action.label}
        >{renderContextIcon?.(action) || renderIcon(action.activeIconName && action.active ? action.activeIconName : action.iconName)}</button>
      ))}
      {bookSwitches.map((item) => { const unavailable = unavailableBookIds.has(item.id); return (
        <button
          key={item.id}
          type="button"
          className="teacher-book-navigation-book-switch"
          data-teacher-control-id={item.controlId}
          data-book-id={item.id}
          aria-label={unavailable ? unavailableBookLabels.get(item.id) || `${item.label} unavailable in this release` : item.label}
          aria-current={!unavailable && selectedBookId === item.id ? "page" : undefined}
          title={unavailable ? unavailableBookMessages.get(item.id) || `${item.label} was not included in this release.` : item.label}
          disabled={unavailable}
          onClick={() => { if (!unavailable) onBookSwitch(item.id); }}
        >{renderBookSwitch?.(item)}</button>
      ); })}
    </nav>
  );
}
