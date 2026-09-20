export function unitExtrasForPage(publication, { unitNumber, pageId } = {}) {
  const extras = ["published", "draft"].includes(publication?.kind) ? publication.projection?.unitExtras : null;
  if (!extras) return [];
  const page = extras.pages.find((entry) => entry.pageId === pageId && entry.unitId === `unit-${unitNumber}`);
  if (!page?.extrasVisibility.videos) return [];
  return extras.units.find((unit) => unit.unitNumber === unitNumber)?.categories.videos || [];
}

export function unitExtraAudiosForPage(publication, { unitNumber, pageId } = {}) {
  const extras = ["published", "draft"].includes(publication?.kind) ? publication.projection?.unitExtras : null;
  if (!extras) return [];
  const page = extras.pages.find((entry) => entry.pageId === pageId && entry.unitId === `unit-${unitNumber}`);
  if (!page?.extrasVisibility.audios) return [];
  return extras.units.find((unit) => unit.unitNumber === unitNumber)?.categories.audios || [];
}
