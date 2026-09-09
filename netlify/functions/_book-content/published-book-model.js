import { canonicalStudentsBookPages } from "../../../netlify-sites/ultimate-b2-builder/server/_builder-page-catalog.js";
import studentsBookRuntime from "../../../src/data/ultimate-b2/generated/students-book.runtime.json" with { type: "json" };
import { STUDENTS_BOOK_V3_COMPILER, STUDENTS_BOOK_V3_SCHEMA, STUDENTS_BOOK_V3_COMPATIBILITY_SHA256 } from "../../../src/data/ultimate-b2/componentPublicationV3.js";

import { publicationComponents, findPublicationComponent } from "../../../src/data/publicationRegistry.js";
export const LMS_PUBLISHED_COMPONENTS = Object.freeze(publicationComponents.map((entry) => entry.componentSlug));

const canonicalPageImages = new Map(studentsBookRuntime.units.flatMap((unit) => unit.pages.map((page) => [page.id, page.pageImage.identity])));

export function supportedPublishedBook(bookSlug, componentSlug) {
  return Boolean(findPublicationComponent(bookSlug, componentSlug));
}

export function normalizePublishedBookLocator(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !["pageId", "hotspotId", "productReleaseId"].includes(key))
    || typeof value.pageId !== "string" || typeof value.hotspotId !== "string"
    || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(String(value.pageId || ""))
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(String(value.hotspotId || ""))
    || (value.productReleaseId !== undefined && (typeof value.productReleaseId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.productReleaseId)))) throw new Error("publication_locator_invalid");
  return { pageId: value.pageId, hotspotId: value.hotspotId, ...(value.productReleaseId ? { productReleaseId: value.productReleaseId.toLowerCase() } : {}) };
}

function orderWorkbookPages(pages, units) {
  if (!Array.isArray(units)) throw new Error("publication_page_unit_mismatch");
  // Match the canonical Builder Unit order; page positions are local to a Unit.
  const unitOrder = new Map([...units].sort((left, right) => left.sortOrder - right.sortOrder
    || left.unitNumber - right.unitNumber || left.slug.localeCompare(right.slug))
    .map((unit, index) => [unit.id, index]));
  if (pages.some((page) => !unitOrder.has(page.unitId))) throw new Error("publication_page_unit_mismatch");
  return pages.sort((left, right) => unitOrder.get(left.unitId) - unitOrder.get(right.unitId)
    || left.sortOrder - right.sortOrder || left.stableKey.localeCompare(right.stableKey));
}

// Only verified public projections enter this adapter. Drafts and Teacher
// documents are deliberately absent from its input and output contracts.
export function publishedBookReadModel(row, projection, capabilities = {}, productReleaseId = null) {
  const bookSlug = row.package_slug || projection.bookSlug;
  const componentSlug = row.component_slug || projection.componentSlug;
  if (!supportedPublishedBook(bookSlug, componentSlug)
    || projection.bookSlug !== bookSlug || projection.componentSlug !== componentSlug) throw new Error("publication_identity_mismatch");
  const activePageIds = projection.activePageIds ? new Set(projection.activePageIds) : null;
  const unifiedStudentsBook = row.compiler_id === STUDENTS_BOOK_V3_COMPILER && row.release_schema_version === STUDENTS_BOOK_V3_SCHEMA
    && projection.schemaVersion === STUDENTS_BOOK_V3_SCHEMA && projection.compatibility === STUDENTS_BOOK_V3_COMPATIBILITY_SHA256;
  if (componentSlug === "ultimate-b2-students-book" && (row.compiler_id === STUDENTS_BOOK_V3_COMPILER || projection.schemaVersion === STUDENTS_BOOK_V3_SCHEMA) && !unifiedStudentsBook) throw new Error("publication_contract_mismatch");
  const legacyStudentsBook = componentSlug === "ultimate-b2-students-book" && !unifiedStudentsBook;
  const sourcePages = legacyStudentsBook ? canonicalStudentsBookPages : projection.pages;
  if (!Array.isArray(sourcePages)) throw new Error("publication_pages_unavailable");
  const sourceIds = new Set(sourcePages.map((page) => page.id));
  if (activePageIds && [...activePageIds].some((id) => !sourceIds.has(id))) throw new Error("publication_page_identity_mismatch");
  const selectedPages = sourcePages.filter((page) => !activePageIds || activePageIds.has(page.id));
  const orderedPages = componentSlug === "ultimate-b2-workbook" || bookSlug !== "ultimate-b2"
    ? orderWorkbookPages(selectedPages, projection.units)
    : selectedPages.sort((left, right) => left.sortOrder - right.sortOrder);
  const pages = orderedPages.map((page) => ({
    id: page.id,
    unitId: page.unitSlug || `unit-${page.unitNumber}`,
    unitTitle: page.unitTitle,
    unitNumber: page.unitNumber,
    title: page.sectionTitle || page.label,
    printedLabel: page.printedLabel,
    sortOrder: page.sortOrder,
    image: legacyStudentsBook
      ? { source: "canonical-published-page", logicalKey: canonicalPageImages.get(page.id), checksumSha256: page.image.checksumSha256, width: page.image.width, height: page.image.height }
      : { ...page.image },
    hotspots: [],
  }));
  const pagesById = new Map(pages.map((page) => [page.id, page]));
  for (const page of pages) {
    const extrasPage = projection.unitExtras?.pages.find((entry) => entry.pageId === page.id && entry.unitId === page.unitId);
    const extras = projection.unitExtras?.units.find((unit) => unit.unitId === page.unitId);
    page.media = ["videos", "audios"].flatMap((category) => !extrasPage?.extrasVisibility[category] ? [] : (extras?.categories[category] || []).map((entry) => {
      const kind = category === "videos" ? "video" : "audio";
      const media = entry[kind];
      const asset = projection.assets.find((item) => item.sha256 === media.asset.checksumSha256 && item.role === media.asset.role);
      if (!asset) throw new Error("publication_media_unavailable");
      return { id: entry.id, title: entry.title, kind, asset: { sha256: asset.sha256, extension: asset.extension }, ...(kind === "video" ? { video: media } : {}) };
    }));
  }
  const activities = Object.entries(projection.nativeActivities || {}).map(([nativeActivityId, entry]) => ({
    target: { kind: "published_native", releaseId: row.id, nativeActivityId },
    title: entry.document.metadata.title,
    type: entry.kind,
    assignable: capabilities[nativeActivityId]?.assignable === true,
    submittable: capabilities[nativeActivityId]?.submittable === true,
    placements: [],
  }));
  const byActivity = new Map(activities.map((activity) => [activity.target.nativeActivityId, activity]));
  for (const [pageId, hotspots] of Object.entries(projection.hotspots?.pages || {})) {
    const page = pagesById.get(pageId);
    if (!page) {
      if (hotspots.length) throw new Error("publication_hotspot_page_mismatch");
      continue;
    }
    for (const hotspot of hotspots) {
      const activity = byActivity.get(hotspot.activityKey);
      const locator = { pageId, hotspotId: hotspot.id, ...(productReleaseId ? { productReleaseId } : {}) };
      page.hotspots.push({
        id: hotspot.id, pageId, activityId: hotspot.activityKey,
        title: activity?.title || hotspot.label,
        type: activity?.type || "legacy_activity",
        left: hotspot.left, top: hotspot.top, width: hotspot.width, height: hotspot.height,
        target: activity ? { ...activity.target, locator } : null,
        assignable: activity?.assignable === true,
        submittable: activity?.submittable === true,
      });
      activity?.placements.push({ ...locator, unitId: page.unitId, unitTitle: page.unitTitle, printedLabel: page.printedLabel });
    }
  }
  return {
    bookSlug, componentSlug, packageId: row.book_package_id,
    packageTitle: row.package_title || "Ultimate B2", componentTitle: row.component_title || componentSlug,
    releaseId: row.id, releaseNumber: Number(row.release_number), productReleaseId,
    pages, activities,
  };
}

export function resolvePublishedBookLocator(book, nativeActivityId, requested = null) {
  const activity = book.activities.find((entry) => entry.target.nativeActivityId === nativeActivityId);
  if (!activity) throw new Error("publication_activity_not_found");
  if (requested) {
    const placement = activity.placements.find((entry) => entry.pageId === requested.pageId && entry.hotspotId === requested.hotspotId);
    if (!placement || (requested.productReleaseId && requested.productReleaseId !== book.productReleaseId)) throw new Error("publication_locator_mismatch");
    return placement;
  }
  return activity.placements.length === 1 ? activity.placements[0] : null;
}
