import { BookOpenCheck, Copy } from "lucide-react";
import { Card, Tag } from "../Shared.jsx";
import { BookCover } from "./BookCover.jsx";
import { buildBookPackageComponentHash, copyHashLink, getActiveExercises } from "./bookBrowserUtils.js";
import { getComponentRouteSlug } from "../../../utils/hashRoutes.js";

export function BookPackageComponentGrid({ bookPackage, mode, onSelectBook }) {
  const role = mode === "teacher" ? "teacher" : "student";

  return (
    <Card>
      <div className="card-heading">
        <div>
          <span className="eyebrow"><BookOpenCheck size={15} /> {bookPackage.level}</span>
          <h2>{bookPackage.packageLabel}</h2>
          <p>{bookPackage.publisher} digital book package for {bookPackage.demoSchool}.</p>
        </div>
        <Tag tone="green">{bookPackage.level} active</Tag>
      </div>

      <div className="book-component-grid book-card-grid">
        {bookPackage.components.map((component) => {
          const activeCount = getActiveExercises(component).length;
          const unitCount = component.units.length;
          const canonicalBookId = getComponentRouteSlug(component);

          return (
            <article key={component.id} className="book-component-card">
              <button type="button" onClick={() => onSelectBook(component.id)} data-sound-click="tab">
                <BookCover component={component} bookPackage={bookPackage} size="large" />
                <span>
                  <strong>{component.title}</strong>
                  <small>{component.subtitle}</small>
                  <em>
                    {component.legacyDiscoveryAllowed === false
                      ? "Open published Interactive"
                      : !unitCount
                      ? "Content will be added when the publisher files are available."
                      : component.catalogKind === "recovered-students-book"
                      ? `${unitCount} implemented units / ${activeCount} activities available`
                      : `${unitCount} units / ${activeCount} demo item${activeCount === 1 ? "" : "s"} active`}
                  </em>
                </span>
              </button>
              <button
                className="book-card-copy-link"
                type="button"
                aria-label={`Copy direct link for ${component.title}`}
                title="Copy direct link"
                onClick={() => copyHashLink(buildBookPackageComponentHash(role, bookPackage, canonicalBookId))}
                data-sound-click="tab"
              >
                <Copy size={15} />
              </button>
            </article>
          );
        })}
      </div>
    </Card>
  );
}
