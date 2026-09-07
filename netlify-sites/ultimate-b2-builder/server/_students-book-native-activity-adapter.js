import { NATIVE_ACTIVITY_KINDS } from "../../../src/data/native-activities/nativeActivityKinds.js";
import { NativeActivityPlacementError } from "../../../src/data/native-activities/nativeActivityPlacementError.js";
import { nextUltimateB2PublisherActivityId } from "../../../src/data/ultimate-b2/publisherCreatedActivities.js";
import { ultimateB2StudentsBookAuthoringActivities } from "../../../src/data/ultimate-b2/studentsBookAuthoringCatalog.js";
import { loadStudentsBookPageAuthority, studentsBookPageScope } from "./_students-book-page-authority.js";

function pageId(input) {
  if (!input || Object.keys(input).join() !== "pageId" || typeof input.pageId !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(input.pageId)) throw new NativeActivityPlacementError("Students Book native placement is invalid.");
  return input.pageId;
}
async function placements(inputs, context, { allowUnavailable = false } = {}) {
  if (context?.bookSlug !== studentsBookPageScope.bookSlug || context?.componentSlug !== studentsBookPageScope.componentSlug || typeof context.sql !== "function" || !Array.isArray(inputs)) throw new NativeActivityPlacementError("Students Book native placement scope is invalid.");
  const ids = [...new Set(inputs.map((input, placementIndex) => {
    try { return pageId(input); }
    catch (error) { if (error instanceof NativeActivityPlacementError) error.placementIndex = placementIndex; throw error; }
  }))];
  if (!ids.length) return new Map();
  const catalog = await loadStudentsBookPageAuthority(context.sql);
  const active = new Map(catalog.pages.map((page) => [page.id, page]));
  const retained = new Map(catalog.retained.map((page) => [page.id, page]));
  return new Map(ids.map((id) => {
    const placementIndex = inputs.findIndex((input) => input.pageId === id);
    const page = active.get(id) || retained.get(id);
    if (!active.has(id) && !allowUnavailable) throw new NativeActivityPlacementError("Students Book native placement is inactive or unavailable.", { pageId: id, placementIndex });
    if (!page?.unitId && !allowUnavailable) throw new NativeActivityPlacementError("Students Book Unit infrastructure is unavailable.", { pageId: id, placementIndex });
    return [id, { pageId: id, sourcePageId: id, ...(page ? { origin: page.origin, unitId: page.unitId, unitNumber: page.unitNumber, unitTitle: page.unitTitle, partNumber: page.partNumber, pageNumber: page.printedPages?.[0] || null, pageLabel: page.printedLabel ? `Pages ${page.printedLabel}` : page.label, sectionTitle: page.sectionTitle, sortOrder: page.sortOrder } : {}), assignmentState: active.has(id) ? "assigned" : "unassigned", ...(!active.has(id) ? { unassignedReason: retained.has(id) ? "page-deleted" : "page-unavailable" } : {}) }];
  }));
}
async function placement(input, context, options) { return (await placements([input], context, options)).get(input.pageId); }

export const studentsBookCurrentNativeActivityAdapter = Object.freeze({
  id: "ultimate-b2-students-book-native-activities", ...studentsBookPageScope, kinds: NATIVE_ACTIVITY_KINDS,
  ownsActivityId(id) { return /^ultimate-b2-sb-[a-z0-9-]+-o\d+$/.test(String(id || "")); },
  normalizePlacement: placement,
  normalizeDestinationPlacement: placement,
  resolveExistingPlacement(input, context) { return placement(input, context, { allowUnavailable: true }); },
  resolveExistingPlacements(inputs, context) { return placements(inputs, context, { allowUnavailable: true }); },
  nextActivityId({ placement, nativeIndex, occupiedActivityIds = [] }) {
    const occupied = new Set([...ultimateB2StudentsBookAuthoringActivities.map((activity) => activity.activityKey), ...(nativeIndex?.activities || []).map((activity) => activity.activityId), ...occupiedActivityIds]);
    if (placement.origin === "canonical") return nextUltimateB2PublisherActivityId(placement, [...occupied]);
    const prefix = `ultimate-b2-sb-${placement.pageId.slice(-32)}-o`;
    for (let ordinal = 1; ordinal < 10000; ordinal += 1) if (!occupied.has(`${prefix}${ordinal}`)) return `${prefix}${ordinal}`;
    throw new Error("Students Book activity identity space is exhausted.");
  },
  sortOrder({ placement, nativeIndex }) {
    // Activity order is authored within its page. Multiplying editorial page
    // order by the Unit number overflowed the index contract in Unit 10.
    const siblings = (nativeIndex?.activities || []).filter((entry) => entry.placement.pageId === placement.pageId);
    const order = siblings.reduce((maximum, entry) => Math.max(maximum, entry.sortOrder), -1) + 1;
    if (order > 10_000_000) throw new Error("Students Book activity order space is exhausted.");
    return order;
  },
});
