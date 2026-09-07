// Keep the full captured/editorial label in the page authority and release.
// The standard canonical label repeats Unit and folio already shown by the Viewer.
export function studentsBookPageTitle(page) {
  return page.origin === "canonical" && page.sectionTitle && page.label === `${page.unitTitle} · ${page.sectionTitle} · ${page.printedLabel}`
    ? page.sectionTitle : page.label;
}
