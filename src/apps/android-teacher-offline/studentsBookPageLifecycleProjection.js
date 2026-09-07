import { studentsBookPageTitle } from "./studentsBookPageTitle.js";
import { authorizedHostedPreviewPath } from "./hostedReleasePreview.js";

function projectActivePages(pageUnits, activePageIds, resolvePage) {
  const active = new Set(activePageIds);
  return Object.freeze(pageUnits.map((unit) => Object.freeze({
    ...unit,
    pages: Object.freeze(unit.pages.filter((page) => active.has(page.id)).map(resolvePage)),
  })));
}

export function studentsBookPageUnitsFromActivePageIds(pageUnits, activePageIds) {
  if (!Array.isArray(activePageIds) || activePageIds.some((id) => typeof id !== "string")) throw new Error("Students Book active page identities are invalid.");
  return projectActivePages(pageUnits, activePageIds, (page) => page);
}

export function studentsBookPageUnitsFromCatalog(pageUnits, payload, authorization) {
  if (payload?.component?.bookSlug !== "ultimate-b2" || payload.component.componentSlug !== "ultimate-b2-students-book" || payload.component.kind !== "students-book" || !Array.isArray(payload.pages)) throw new Error("Students Book page catalog identity is invalid.");
  const active = new Map(payload.pages.map((page) => [page.id, page]));
  return projectActivePages(pageUnits, [...active.keys()], (page) => {
    const catalogPage = active.get(page.id);
    if (catalogPage.source !== "override") return page;
    const url = new URL(catalogPage.image.url, "https://viewer.invalid");
    url.searchParams.delete("previewAuthorization");
    return Object.freeze({ ...page, images: Object.freeze([authorizedHostedPreviewPath(`${url.pathname}${url.search}`, authorization)]) });
  });
}

// Current Saved Draft uses the complete server authority. Historical release
// projections above remain frozen and never consult this mutable catalog.
export function studentsBookCurrentPageUnitsFromCatalog(payload, authorization) {
  if (payload?.component?.bookSlug !== "ultimate-b2" || payload.component.componentSlug !== "ultimate-b2-students-book" || payload.component.kind !== "students-book" || !Array.isArray(payload.units) || !Array.isArray(payload.pages)) throw new Error("Students Book current page catalog identity is invalid.");
  const units = new Map(); const ids = new Set();
  for (const unit of payload.units) {
    if (!Number.isInteger(unit.unitNumber) || unit.unitNumber < 1 || unit.unitNumber > 10 || unit.slug !== `unit-${unit.unitNumber}` || units.has(unit.unitNumber)) throw new Error("Students Book current Unit identity is invalid.");
    units.set(unit.unitNumber, { id: unit.slug, number: unit.unitNumber, title: unit.title, unit: unit.title, displayLabel: unit.title, pages: [], databaseId: unit.id });
  }
  for (const page of payload.pages) {
    if (!page || ids.has(page.id) || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(page.id) || page.componentSlug !== "ultimate-b2-students-book" || page.stableKey !== `ultimate-b2-students-book/pages/${page.id}` || !["canonical", "managed"].includes(page.origin)
      || !Number.isInteger(page.unitNumber) || page.unitNumber < 1 || page.unitNumber > 10 || !Number.isSafeInteger(page.sortOrder)
      || !Number.isSafeInteger(page.image?.width) || page.image.width < 1 || !Number.isSafeInteger(page.image?.height) || page.image.height < 1) throw new Error("Students Book current page topology is invalid.");
    ids.add(page.id);
    if (!units.has(page.unitNumber)) {
      if (page.origin !== "canonical" || page.unitId !== null) throw new Error("Students Book current Unit infrastructure is unavailable.");
      units.set(page.unitNumber, { id: `unit-${page.unitNumber}`, number: page.unitNumber, title: page.unitTitle, unit: page.unitTitle, displayLabel: page.unitTitle, pages: [], databaseId: null });
    }
    const unit = units.get(page.unitNumber);
    if (page.unitId !== unit.databaseId) throw new Error("Students Book current page Unit mismatch.");
    const url = new URL(page.image.url, "https://viewer.invalid");
    if (url.origin !== "https://viewer.invalid" || url.hash) throw new Error("Students Book current page image scope is invalid.");
    let image;
    if (page.image.source === "repository-baseline" && page.origin === "canonical") {
      if (!new RegExp(`^/page-library/ultimate-b2/ultimate-b2-students-book/${page.id}\\.(png|jpg|webp)$`).test(url.pathname) || url.search) throw new Error("Students Book canonical image scope is invalid.");
      image = url.pathname;
    } else {
      if (page.image.source !== "managed" || url.pathname !== `/preview/pages/books/ultimate-b2/components/ultimate-b2-students-book/pages/${page.id}/assets/${page.image.assetId}/preview`) throw new Error("Students Book managed image scope is invalid.");
      url.searchParams.delete("previewAuthorization");
      if (url.search) throw new Error("Students Book managed image parameters are invalid.");
      image = authorizedHostedPreviewPath(url.pathname, authorization);
    }
    unit.pages.push(Object.freeze({ id: page.id, sourcePageId: page.id, part: page.partNumber, title: studentsBookPageTitle(page), label: page.printedLabel ? `pg ${page.printedLabel}` : page.label,
      pageNumber: page.printedPages?.[0] || null, pageNumbers: Object.freeze([...(page.printedPages || [])]), spreadNumber: page.printedLabel,
      navigationOrder: page.sortOrder, sortOrder: page.sortOrder, imageWidth: page.image.width, imageHeight: page.image.height,
      images: Object.freeze([image]), activities: Object.freeze([]), actions: Object.freeze([]), media: Object.freeze([]), continuesToVideo: false }));
  }
  return Object.freeze([...units.values()].sort((a, b) => a.number - b.number).map(({ databaseId, ...unit }) => Object.freeze({ ...unit, pages: Object.freeze(unit.pages.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))) })));
}
