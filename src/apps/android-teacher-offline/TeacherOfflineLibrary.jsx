import { useState } from "react";

import ClassroomStageTransform from "./ClassroomStageTransform.jsx";
import ClassroomToolOverlay from "./ClassroomToolOverlay.jsx";
import ClassroomToolbar from "./UltimateB2ClassroomToolbar.jsx";
import LegacyMenuTitleAnimation from "./LegacyMenuTitleAnimation.jsx";

function LegacyMenuArtwork({ artwork }) {
  return (
    <span className="legacy-menu-button-art" aria-hidden="true">
      <img className="normal" src={artwork.normal} alt="" draggable="false" />
      <img className="hover-pressed" src={artwork.hoverPressed} alt="" draggable="false" />
    </span>
  );
}

function UnitColumn({ label, items, artwork, editionId, onOpenUnit, position, availableUnits }) {
  return (
    <div className={`legacy-home-unit-column is-${position}`} aria-label={label}>
      {items.map((unit) => { const available = availableUnits?.has(unit.number) ?? unit.available; return (
        <button
          key={unit.number}
          type="button"
          className={`legacy-home-unit${available ? " available" : ""}`}
          aria-disabled={available ? undefined : "true"}
          aria-label={available ? `Open Unit ${unit.number}: ${unit.title}` : `Unit ${unit.number}: ${unit.title}`}
          onClick={available ? () => onOpenUnit?.(editionId, unit.number) : undefined}
        >
          <LegacyMenuArtwork artwork={artwork[unit.number - 1]} />
        </button>
      ); })}
    </div>
  );
}

function ExtrasColumn({ label, items, position }) {
  return (
    <div className={`legacy-home-extras-column is-${position}`} aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="legacy-home-extra-button"
          data-teacher-control-id={item.controlId}
          data-sound-category="button"
          aria-disabled={item.destination ? undefined : "true"}
          aria-label={item.label}
        >
          <LegacyMenuArtwork artwork={item} />
        </button>
      ))}
    </div>
  );
}

export default function TeacherOfflineLibrary({ menuSkin, units = [], onOpenUnit, animationsActive, unitAvailabilityByEdition = {}, initialEditionId = "students-book", onSelectEdition, unavailableEditionIds = new Set(), unavailableEditionMessages = new Map(), unavailableEditionLabels = new Map() }) {
  const [selectedEdition, setSelectedEdition] = useState(initialEditionId);
  if (!menuSkin) return <main className="teacher-offline-status damaged" role="alert"><h1>Book menu unavailable</h1><p>Reinstall the verified classroom application.</p></main>;
  const surfaceKey = menuSkin.surfaceKey;
  const extrasSelected = selectedEdition === "extras";
  const extrasLeft = menuSkin.extras.filter((item) => item.column === "left").sort((left, right) => left.order - right.order);
  const extrasRight = menuSkin.extras.filter((item) => item.column === "right").sort((left, right) => left.order - right.order);

  return (
    <main className="teacher-offline-library has-classroom-tools" data-book-menu-skin={menuSkin.id} data-selected-edition={selectedEdition} style={{ "--legacy-classroom-background": `url(${menuSkin.background})` }}>
      <header className="legacy-home-floating-chrome">
        <img className="legacy-home-publisher-logo" src={menuSkin.publisherLogo} alt={menuSkin.publisherLogoAlt} />
      </header>

      <section className="legacy-home-classroom-surface" data-classroom-surface-id={surfaceKey} tabIndex={-1} aria-label={`${menuSkin.title.accessibleLabel} classroom launcher`}>
        <ClassroomStageTransform surfaceKey={surfaceKey}>
          <div className="legacy-home-launcher">
            {!extrasSelected ? <UnitColumn label="Units 1 to 5" position="left" items={units.slice(0, 5)} artwork={menuSkin.units} editionId={selectedEdition} onOpenUnit={onOpenUnit} availableUnits={unitAvailabilityByEdition[selectedEdition]} />
              : <ExtrasColumn label="Extras left column" position="left" items={extrasLeft} />}
            {menuSkin.title.kind === "legacy-gaf" && <LegacyMenuTitleAnimation animate={animationsActive} label={menuSkin.title.animationLabel} />}
            {!extrasSelected ? <UnitColumn label="Units 6 to 10" position="right" items={units.slice(5)} artwork={menuSkin.units} editionId={selectedEdition} onOpenUnit={onOpenUnit} availableUnits={unitAvailabilityByEdition[selectedEdition]} />
              : <ExtrasColumn label="Extras right column" position="right" items={extrasRight} />}

            <div className="legacy-home-book-row" aria-label="Book editions">
              {menuSkin.editions.map((edition) => { const unavailable = unavailableEditionIds.has(edition.id); return (
                <button key={edition.id} type="button" className="legacy-home-book-button" data-teacher-control-id={edition.controlId} data-sound-category="button" aria-label={unavailable ? unavailableEditionLabels.get(edition.id) || `${edition.label} unavailable in this release` : edition.label} aria-pressed={!unavailable && selectedEdition === edition.id} title={unavailable ? unavailableEditionMessages.get(edition.id) || `${edition.label} was not included in this release.` : edition.label} disabled={unavailable} onClick={() => { if (unavailable || onSelectEdition?.(edition.id) === false) return; setSelectedEdition(edition.id); }}>
                  <LegacyMenuArtwork artwork={edition} />
                </button>
              ); })}
            </div>
          </div>
          <ClassroomToolOverlay surfaceKey={surfaceKey} />
        </ClassroomStageTransform>
      </section>

      <ClassroomToolbar surfaceKey={surfaceKey} />
    </main>
  );
}
