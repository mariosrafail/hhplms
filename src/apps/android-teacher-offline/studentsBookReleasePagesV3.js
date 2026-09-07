import { studentsBookPageTitle } from "./studentsBookPageTitle.js";
import { normalizeComponentPublicationEnvelope } from "../../services/componentPublicationApi.js";
import { STUDENTS_BOOK_V3_COMPILER } from "../../data/ultimate-b2/componentPublicationV3.js";
import { hostedReleasePath } from "./hostedReleasePreview.js";

export function studentsBookPageUnitsFromV3Release(envelope, context) {
  const release = normalizeComponentPublicationEnvelope(envelope);
  if (release.compilerId !== STUDENTS_BOOK_V3_COMPILER || release.releaseId !== context.releaseId) throw new Error("Students Book release identity is invalid.");
  const projection = release.projection;
  return Object.freeze(projection.units.map((unit) => Object.freeze({ id: unit.slug, number: unit.unitNumber, title: unit.title,
    pages: Object.freeze(projection.pages.filter((page) => page.unitId === unit.id).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)).map((page) => Object.freeze({
      id: page.id, title: studentsBookPageTitle(page), label: page.printedLabel ? `pg ${page.printedLabel}` : page.label, unitNumber: page.unitNumber, sectionTitle: page.sectionTitle, partNumber: page.partNumber, pageNumber: page.printedPages[0] || null,
      pageNumbers: Object.freeze([...page.printedPages]), spreadNumber: page.printedLabel, navigationOrder: page.sortOrder, sortOrder: page.sortOrder,
      imageWidth: page.image.width, imageHeight: page.image.height,
      images: Object.freeze([hostedReleasePath(context, projection, `assets/${page.image.sha256}.${page.image.extension}`)]),
      activities: Object.freeze([]), actions: Object.freeze([]), media: Object.freeze([]), continuesToVideo: false,
    }))),
  })));
}
