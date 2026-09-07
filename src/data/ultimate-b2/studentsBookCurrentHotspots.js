import { validateAndNormalizeManagedComponentHotspotManifest } from "../../../scripts/ultimate-b2/hotspot-manifest.js";
import runtime from "./generated/students-book.runtime.json" with { type: "json" };

const canonicalIds = new Set(runtime.units.flatMap((unit) => unit.pages.map((page) => page.id)));
const managedId = /^sb-page-[a-f0-9]{32}$/;
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));

// Preserve the saved Students Book document identity and historical pageNumber
// fields while validating the mutable page universe independently of v1/v2.
export function normalizeStudentsBookCurrentHotspots(input, { pages = null, activities = null, requireActivityPage = false } = {}) {
  if (!exactKeys(input, ["schemaVersion", "packageSlug", "componentSlug", "pages"]) || input?.packageSlug !== "ultimate-b2" || input?.componentSlug !== "students-book") throw new Error("Students Book hotspot identity is invalid.");
  if (!input.pages || typeof input.pages !== "object" || Array.isArray(input.pages)) throw new Error("Students Book hotspot pages are invalid.");
  for (const [pageId, hotspots] of Object.entries(input.pages)) {
    if (!canonicalIds.has(pageId) && !managedId.test(pageId)) throw new Error(`Unknown Students Book page id: ${pageId}`);
    if (!Array.isArray(hotspots)) throw new Error("Students Book hotspots must be an array.");
    for (const hotspot of hotspots) {
      if (!exactKeys(hotspot, ["id", "unitNumber", "pageId", "pageNumber", "left", "top", "width", "height", "label", "actionType", "activityKey"])) throw new Error("Students Book hotspot has unsupported fields.");
      if (typeof hotspot.label !== "string" || hotspot.label.length > 200 || ["unitNumber", "left", "top", "width", "height"].some((key) => typeof hotspot[key] !== "number")) throw new Error("Students Book hotspot fields are invalid.");
    }
  }
  const normalized = validateAndNormalizeManagedComponentHotspotManifest({ ...input, componentSlug: "ultimate-b2-students-book" }, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", pages, activities, requireActivityPage });
  const original = new Map(Object.values(input.pages).flat().map((hotspot) => [hotspot.id, hotspot]));
  const pageById = pages && new Map(pages.map((page) => [page.id, page]));
  for (const hotspots of Object.values(normalized.pages)) for (const hotspot of hotspots) {
    const source = original.get(hotspot.id);
    if (Object.hasOwn(source, "pageNumber")) {
      if (!Number.isInteger(source.pageNumber) || source.pageNumber < 1) throw new Error("Students Book hotspot page number is invalid.");
      const page = pageById?.get(hotspot.pageId);
      const expected = page?.printedPages?.[0] ?? page?.pageNumber;
      if (expected !== undefined && expected !== null && source.pageNumber !== expected) throw new Error("Students Book hotspot page number does not match its page.");
      hotspot.pageNumber = source.pageNumber;
    }
  }
  // Validation must not erase empty page entries, trim editorial labels, round
  // geometry or rewrite a stored document through generic managed normalization.
  // Dynamic managed membership is checked separately using the scoped authority.
  return structuredClone(input);
}

export const emptyStudentsBookCurrentHotspots = () => ({ schemaVersion: "1.0", packageSlug: "ultimate-b2", componentSlug: "students-book", pages: {} });

export function pruneStudentsBookCurrentHotspots(input, activityId) {
  const manifest = normalizeStudentsBookCurrentHotspots(input);
  let removedCount = 0;
  const pages = {};
  for (const [id, hotspots] of Object.entries(manifest.pages)) {
    const retained = hotspots.filter((hotspot) => hotspot.activityKey !== activityId);
    removedCount += hotspots.length - retained.length;
    if (retained.length) pages[id] = retained;
  }
  return { manifest: { ...manifest, pages }, removedCount };
}
