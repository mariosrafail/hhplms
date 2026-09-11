import ClassroomStageTransform from "./ClassroomStageTransform.jsx";
import ClassroomToolOverlay from "./ClassroomToolOverlay.jsx";
import ClassroomToolbar from "./UltimateB2ClassroomToolbar.jsx";
import TeacherBookNavigation from "./TeacherBookNavigation.jsx";
import { buildTeacherUnitOverviewEntries } from "./studentsBookOverviewLayout.js";

export default function TeacherOfflineUnitOverview({ unit, onSelectPage, onBackToLibrary, selectedBookId = "students-book", onBookSwitch, unavailableBookIds, unavailableBookMessages, unavailableBookLabels, componentIdentity }) {
  const entries = buildTeacherUnitOverviewEntries({ unit, selectedBookId, componentIdentity });
  const unitNumber = Number(unit.number);
  const surfaceKey = `${selectedBookId}:overview:unit-${unitNumber}`;

  return (
    <section className="teacher-offline-pages teacher-offline-unit-overview-screen" aria-label={`Unit ${unit.number} page overview`}>
      <header className="legacy-page-heading legacy-overview-heading">
        <div aria-hidden="true" />
        <div><h2>Unit {unit.number}</h2></div>
        <div aria-hidden="true" />
      </header>

      <div className="teacher-unit-overview-stage">
        <div id="teacher-unit-overview-panel" className={`teacher-offline-unit-overview legacy-overview-unit-${unitNumber}`} data-classroom-surface-id={surfaceKey} data-overview-book={selectedBookId} tabIndex={-1}>
          <ClassroomStageTransform surfaceKey={surfaceKey}>
          <div className="teacher-unit-overview-grid">
            {entries.length ? entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="teacher-unit-page-card"
                data-overview-entry={entry.id}
                data-overview-row={entry.row}
                data-overview-weight={entry.physicalWeight}
                data-overview-column-start={entry.columnStart || undefined}
                data-overview-column-span={entry.columnSpan || undefined}
                data-page-ids={entry.pageIds.join(",")}
                style={entry.columnSpan ? { "--overview-column-start": entry.columnStart, "--overview-column-span": entry.columnSpan } : undefined}
                onClick={() => onSelectPage(entry.pageIds[0])}
                aria-label={`Open ${entry.label || "Unit opener"}, ${entry.pageLabel}`}
              >
                <span className="teacher-unit-page-copy">
                  {entry.label && <strong>{entry.label}</strong>}
                  <b>{entry.pageLabel}</b>
                </span>
                <span className={`teacher-unit-page-thumb ${entry.pages.length > 1 ? "grouped" : ""}`}>
                  {entry.pages.map((candidate) => (
                    <img key={candidate.id} src={candidate.images?.[0]} alt="" loading="eager" decoding="async" draggable="false" />
                  ))}
                </span>
              </button>
            )) : <p className="teacher-unit-overview-empty" role="status">No pages are available for this Unit yet.</p>}
          </div>
          <ClassroomToolOverlay surfaceKey={surfaceKey} />
          </ClassroomStageTransform>
        </div>
      </div>

      <TeacherBookNavigation onHome={onBackToLibrary} onBack={onBackToLibrary} selectedBookId={selectedBookId} onBookSwitch={onBookSwitch} unavailableBookIds={unavailableBookIds} unavailableBookMessages={unavailableBookMessages} unavailableBookLabels={unavailableBookLabels} />
      <ClassroomToolbar surfaceKey={surfaceKey} />
    </section>
  );
}
