import { nativeDefinition } from "./componentPublicationV2.js";
import { assertStudentSafeReleaseProjection } from "./componentPublication.js";
import { normalizePublishedUltimateB2UnitExtras } from "./unitExtras.js";
import { normalizeHostedTeacherUiPreview } from "./hostedTeacherUiDocument.js";
import { normalizeComponentActivityOrder } from "../native-activities/nativeActivityOrder.js";

export const STUDENTS_BOOK_V3_COMPILER = "ultimate-b2-students-book-v3";
export const STUDENTS_BOOK_V3_SCHEMA = "3.0";
export const STUDENTS_BOOK_V3_COMPATIBILITY_SHA256 = "e7b80ea67f4d36cd2055a99cb1dd390c871658fd29c513b6552ef8a4bdb214e2";
export const STUDENTS_BOOK_V3_NATIVE_KINDS = Object.freeze(["complete-sentences", "drag-drop", "image", "listening", "mark-the-words", "multi-part", "oldschool-listening", "open-response", "single-choice"]);
export const STUDENTS_BOOK_V3_COMPATIBILITY = Object.freeze({ compilerId: STUDENTS_BOOK_V3_COMPILER, schemaVersion: STUDENTS_BOOK_V3_SCHEMA, sourcePolicy: "native-only-after-publication", pages: "canonical-and-managed-snapshot-v1", inclusion: "authored-hotspots-ready-native-v1", nativeKinds: STUDENTS_BOOK_V3_NATIVE_KINDS, nativeComposition: "v1", unitExtras: "audio-video-v1", teacherUi: "v1" });
const safeId = /^[a-z0-9][a-z0-9-]{0,127}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha = /^[a-f0-9]{64}$/;
const media = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", mp3: "audio/mpeg", mp4: "video/mp4", pdf: "application/pdf", ttf: "font/ttf" };
const publicRoles = new Set(["canonical_page_image", "managed_page_image", "activity_artwork", "activity_font", "unit_extra_audio", "unit_extra_video"]);
const exact = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) throw new Error(`Invalid Students Book v3 ${label}.`);
};
const integer = (value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error("Invalid Students Book v3 integer."); return value; };
const text = (value, maximum = 240) => { if (typeof value !== "string" || value.length > maximum) throw new Error("Invalid Students Book v3 text."); return value; };
const identity = (asset) => `${asset.sha256}.${asset.extension}.${asset.role}`;
function source(value) {
  exact(value, ["revision", "sha256"], "source identity"); integer(value.revision);
  if (!sha.test(value.sha256)) throw new Error("Invalid Students Book v3 source checksum.");
  return { ...value };
}
function asset(value, roles = publicRoles) {
  exact(value, ["sha256", "extension", "mediaType", "role"], "asset");
  if (!sha.test(value.sha256) || media[value.extension] !== value.mediaType || !roles.has(value.role)) throw new Error("Invalid Students Book v3 asset identity.");
  return { ...value };
}

export function normalizeStudentsBookV3Sources(value) {
  exact(value, ["schemaVersion", "pages", "hotspots", "nativeIndex", "nativeActivities", "unitExtras", "teacherUi"], "source snapshot");
  if (value.schemaVersion !== STUDENTS_BOOK_V3_SCHEMA) throw new Error("Invalid Students Book v3 source version.");
  exact(value.nativeActivities, Object.keys(value.nativeActivities || {}), "native sources");
  const nativeActivities = {};
  for (const id of Object.keys(value.nativeActivities).sort()) {
    if (!safeId.test(id)) throw new Error("Invalid Students Book v3 native identity.");
    const entry = value.nativeActivities[id]; exact(entry, ["kind", "public", "teacher"], "native source");
    nativeDefinition(entry.kind, STUDENTS_BOOK_V3_NATIVE_KINDS);
    nativeActivities[id] = { kind: entry.kind, public: source(entry.public), teacher: source(entry.teacher) };
  }
  return { schemaVersion: STUDENTS_BOOK_V3_SCHEMA, pages: source(value.pages), hotspots: source(value.hotspots), nativeIndex: source(value.nativeIndex), nativeActivities, unitExtras: source(value.unitExtras), teacherUi: source(value.teacherUi) };
}

export function normalizeStudentsBookV3Public(value, expectedCompatibility = STUDENTS_BOOK_V3_COMPATIBILITY_SHA256) {
  exact(value, ["schemaVersion", "bookSlug", "componentSlug", "compatibility", "units", "pages", "hotspots", "nativeActivities", "activityOrder", "unitExtras", "assets"], "public projection");
  if (value.schemaVersion !== STUDENTS_BOOK_V3_SCHEMA || value.bookSlug !== "ultimate-b2" || value.componentSlug !== "ultimate-b2-students-book" || !sha.test(value.compatibility) || expectedCompatibility && value.compatibility !== expectedCompatibility) throw new Error("Invalid Students Book v3 public identity.");
  if (!Array.isArray(value.units) || value.units.length !== 10 || !Array.isArray(value.pages)) throw new Error("Invalid Students Book v3 page library.");
  const unitIds = new Set(); const numbers = new Set();
  const units = value.units.map((unit) => {
    exact(unit, ["id", "slug", "unitNumber", "title", "sortOrder"], "Unit");
    integer(unit.unitNumber, 1, 10); integer(unit.sortOrder, -100000);
    if (!uuid.test(unit.id) || unit.slug !== `unit-${unit.unitNumber}` || unitIds.has(unit.id) || numbers.has(unit.unitNumber)) throw new Error("Invalid Students Book v3 Unit identity.");
    unitIds.add(unit.id); numbers.add(unit.unitNumber); text(unit.title);
    return { ...unit };
  });
  const pageIds = new Set();
  const imageIdentities = new Map();
  const pages = value.pages.map((page) => {
    exact(page, ["id", "stableKey", "origin", "unitId", "unitNumber", "unitTitle", "sectionTitle", "partNumber", "printedPages", "printedLabel", "label", "sortOrder", "image"], "page");
    const unit = units.find((entry) => entry.id === page.unitId);
    if (!safeId.test(page.id) || pageIds.has(page.id) || page.stableKey !== `${value.componentSlug}/pages/${page.id}` || !["canonical", "managed"].includes(page.origin) || !unit || unit.unitNumber !== page.unitNumber || unit.title !== page.unitTitle) throw new Error("Invalid Students Book v3 page ownership.");
    if (page.origin === "managed" && !/^sb-page-[a-f0-9]{32}$/.test(page.id)) throw new Error("Invalid Students Book v3 managed identity.");
    pageIds.add(page.id); integer(page.sortOrder, -999999999); text(page.label); text(page.printedLabel, 80); text(page.sectionTitle);
    if (page.partNumber !== null) integer(page.partNumber, 1, 100);
    if (!Array.isArray(page.printedPages)) throw new Error("Invalid Students Book v3 folios.");
    page.printedPages.forEach((number) => integer(number, 1, 10000));
    exact(page.image, ["sha256", "extension", "mediaType", "role", "byteSize", "width", "height"], "page image");
    const { byteSize, width, height, ...descriptor } = page.image;
    asset(descriptor, new Set(page.origin === "canonical" ? ["canonical_page_image", "managed_page_image"] : ["managed_page_image"]));
    if (!descriptor.mediaType.startsWith("image/")) throw new Error("Invalid Students Book v3 image type.");
    integer(byteSize, 1, 40 * 1024 * 1024); integer(width, 1, 8192); integer(height, 1, 8192);
    const imageKey = `${descriptor.sha256}.${descriptor.extension}`;
    const dimensions = `${byteSize}:${width}:${height}`;
    if (imageIdentities.has(imageKey) && imageIdentities.get(imageKey) !== dimensions) throw new Error("Invalid Students Book v3 conflicting image dimensions.");
    imageIdentities.set(imageKey, dimensions);
    return structuredClone(page);
  });
  exact(value.nativeActivities, Object.keys(value.nativeActivities || {}), "native map");
  const nativeActivities = {};
  for (const id of Object.keys(value.nativeActivities).sort()) {
    if (!/^ultimate-b2-sb-[a-z0-9-]+-o\d+$/.test(id)) throw new Error("Invalid Students Book v3 native ownership.");
    const entry = value.nativeActivities[id]; exact(entry, ["kind", "document"], "native entry");
    const document = nativeDefinition(entry.kind, STUDENTS_BOOK_V3_NATIVE_KINDS).normalizePublic(entry.document, id);
    if (!pageIds.has(document.placement.pageId)) throw new Error("Invalid Students Book v3 native placement.");
    nativeActivities[id] = { kind: entry.kind, document };
  }
  exact(value.hotspots, ["schemaVersion", "packageSlug", "componentSlug", "pages"], "hotspots");
  if (value.hotspots.schemaVersion !== "1.0" || value.hotspots.packageSlug !== "ultimate-b2" || value.hotspots.componentSlug !== "students-book") throw new Error("Invalid Students Book v3 hotspot identity.");
  exact(value.hotspots.pages, Object.keys(value.hotspots.pages || {}), "hotspot pages");
  const hotspotIds = new Set(); const linked = new Set();
  for (const [id, hotspots] of Object.entries(value.hotspots.pages)) {
    if (!pageIds.has(id) || !Array.isArray(hotspots)) throw new Error("Invalid Students Book v3 hotspot page.");
    const page = pages.find((entry) => entry.id === id);
    for (const hotspot of hotspots) {
      exact(hotspot, ["id", "pageId", "unitNumber", "left", "top", "width", "height", "label", "actionType", "activityKey", ...(Object.hasOwn(hotspot, "pageNumber") ? ["pageNumber"] : [])], "hotspot");
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(hotspot.id) || hotspotIds.has(hotspot.id) || hotspot.pageId !== id || hotspot.unitNumber !== page.unitNumber || hotspot.actionType !== "normalized_activity" || nativeActivities[hotspot.activityKey]?.document.placement.pageId !== id) throw new Error("Invalid Students Book v3 hotspot target.");
      const { left, top, width, height } = hotspot;
      if (![left, top, width, height].every(Number.isFinite) || left < 0 || top < 0 || width <= 0 || height <= 0 || left + width > 100 || top + height > 100) throw new Error("Invalid Students Book v3 hotspot geometry.");
      if (Object.hasOwn(hotspot, "pageNumber") && hotspot.pageNumber !== page.printedPages[0]) throw new Error("Invalid Students Book v3 hotspot folio.");
      text(hotspot.label, 200); hotspotIds.add(hotspot.id); linked.add(hotspot.activityKey);
    }
  }
  if (Object.keys(nativeActivities).some((id) => !linked.has(id))) throw new Error("Students Book v3 includes an unlinked activity.");
  // The media schema is shared; placement is verified against this release's
  // captured pages, never the mutable authoring catalog used by v1/v2.
  const unitExtras = normalizeStudentsBookV3UnitExtras(value.unitExtras, pages);
  if (!Array.isArray(value.assets)) throw new Error("Invalid Students Book v3 assets.");
  const assets = value.assets.map((entry) => asset(entry));
  const expected = new Set([
    ...pages.map((page) => `${page.image.sha256}.${page.image.role}`),
    ...Object.values(nativeActivities).flatMap((entry) => entry.document.assets.map((reference) => `${reference.checksumSha256}.${reference.role}`)),
    ...unitExtras.units.flatMap((unit) => [...unit.categories.videos.map((entry) => entry.video.asset), ...(unit.categories.audios || []).map((entry) => entry.audio.asset)].map((reference) => `${reference.checksumSha256}.${reference.role}`)),
  ]);
  if (new Set(assets.map(identity)).size !== assets.length || assets.length !== expected.size || assets.some((entry) => !expected.has(`${entry.sha256}.${entry.role}`))) throw new Error("Invalid Students Book v3 asset graph.");
  const activityOrder = normalizeComponentActivityOrder(value.activityOrder, { pageIds, activityIds: new Set(Object.keys(nativeActivities)), nativeActivities });
  if (Object.values(activityOrder).flat().length !== Object.keys(nativeActivities).length) throw new Error("Invalid Students Book v3 activity order coverage.");
  const normalized = { schemaVersion: STUDENTS_BOOK_V3_SCHEMA, bookSlug: value.bookSlug, componentSlug: value.componentSlug, compatibility: value.compatibility, units, pages, hotspots: structuredClone(value.hotspots), nativeActivities, activityOrder, unitExtras, assets };
  assertStudentSafeReleaseProjection(normalized);
  return normalized;
}

export function normalizeStudentsBookV3UnitExtras(value, pages) {
  exact(value, ["schemaVersion", "units", "pages"], "Unit Extras");
  if (!Array.isArray(value.pages)) throw new Error("Invalid Students Book v3 Unit Extra pages.");
  const normalized = normalizePublishedUltimateB2UnitExtras({ ...value, pages: [] });
  const seen = new Set();
  normalized.pages = value.pages.map((entry) => {
    exact(entry, ["pageId", "unitId", "extrasVisibility"], "Unit Extra page");
    exact(entry.extrasVisibility, ["videos", ...(Object.hasOwn(entry.extrasVisibility || {}, "audios") ? ["audios"] : [])], "Unit Extra visibility");
    const page = pages.find((candidate) => candidate.id === entry.pageId);
    if (!page || entry.unitId !== `unit-${page.unitNumber}` || seen.has(entry.pageId)
      || Object.values(entry.extrasVisibility).some((visible) => typeof visible !== "boolean")) throw new Error("Invalid Students Book v3 Unit Extra placement.");
    seen.add(entry.pageId);
    return structuredClone(entry);
  });
  return normalized;
}

export function normalizeStudentsBookV3Teacher(value, publicProjection) {
  exact(value, ["schemaVersion", "bookSlug", "componentSlug", "nativeActivities", "ui"], "Teacher projection");
  if (value.schemaVersion !== STUDENTS_BOOK_V3_SCHEMA || value.bookSlug !== "ultimate-b2" || value.componentSlug !== "ultimate-b2-students-book") throw new Error("Invalid Students Book v3 Teacher identity.");
  exact(value.nativeActivities, Object.keys(publicProjection.nativeActivities), "Teacher native map");
  const nativeActivities = {};
  for (const [id, publicEntry] of Object.entries(publicProjection.nativeActivities)) {
    const entry = value.nativeActivities[id]; exact(entry, ["kind", "document"], "Teacher native entry");
    if (entry.kind !== publicEntry.kind) throw new Error("Invalid Students Book v3 Teacher kind.");
    const definition = nativeDefinition(entry.kind, STUDENTS_BOOK_V3_NATIVE_KINDS);
    const document = definition.normalizeTeacher(entry.document, id); definition.validate(publicEntry.document, document);
    nativeActivities[id] = { kind: entry.kind, document };
  }
  return { schemaVersion: STUDENTS_BOOK_V3_SCHEMA, bookSlug: value.bookSlug, componentSlug: value.componentSlug, nativeActivities, ui: normalizeHostedTeacherUiPreview(value.ui) };
}
