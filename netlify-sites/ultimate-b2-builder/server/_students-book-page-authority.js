import { canonicalStudentsBookPages } from "./_builder-page-catalog.js";
import { loadBuilderPages } from "./_builder-pages-store.js";

export const studentsBookPageScope = Object.freeze({ bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" });
export const managedStudentsBookPageId = /^sb-page-[a-f0-9]{32}$/;
const prefix = `${studentsBookPageScope.componentSlug}/pages/`;

// Mutable authoring projection only. Historical release verification continues
// to use its frozen canonical contracts. This resolver never writes bootstrap data.
export function resolveStudentsBookPageAuthority(stored) {
  if (!stored || !Array.isArray(stored.rows) || !Array.isArray(stored.units)) throw new Error("students_book_page_catalog_unavailable");
  const units = new Map();
  for (const unit of stored.units) {
    const number = Number(unit.unit_number);
    if (!Number.isInteger(number) || number < 1 || number > 10 || unit.slug !== `unit-${number}` || units.has(number)) throw new Error("students_book_unit_identity_conflict");
    units.set(number, unit);
  }
  const rows = new Map();
  for (const row of stored.rows) {
    if (!String(row.stable_key).startsWith(prefix) || rows.has(row.stable_key)) throw new Error("students_book_page_identity_conflict");
    rows.set(row.stable_key, row);
  }
  const inactive = (row) => row?.source_metadata?.is_deleted === true || row?.source_metadata?.is_permanently_deleted === true;
  const pages = [];
  const retained = [];
  for (const canonical of canonicalStudentsBookPages) {
    const row = rows.get(canonical.stableKey);
    rows.delete(canonical.stableKey);
    const unit = units.get(canonical.unitNumber);
    if (row?.unit_id && row.unit_id !== unit?.id) throw new Error("students_book_canonical_unit_conflict");
    const metadata = row?.source_metadata || {};
    const imageOverride = metadata.has_image_override === true || metadata.is_override === true && Boolean(row?.asset_id);
    if (!inactive(row) && imageOverride && !row?.asset_id) throw new Error("students_book_page_image_unavailable");
    const page = {
      ...canonical,
      origin: "canonical",
      unitId: unit?.id || null,
      unitSlug: unit?.slug || `unit-${canonical.unitNumber}`,
      unitTitle: unit?.title || canonical.unitTitle,
      label: metadata.has_metadata_override === true ? row.label : canonical.label,
      printedLabel: metadata.has_metadata_override === true ? metadata.printed_label || "" : canonical.printedLabel,
      sortOrder: metadata.has_metadata_override === true ? Number(row.sort_order) : canonical.sortOrder,
      source: imageOverride ? "override" : metadata.has_metadata_override === true ? "metadata-override" : canonical.source,
      imageRow: imageOverride ? row : null,
      storedRow: row || null,
    };
    (inactive(row) ? retained : pages).push(page);
  }
  for (const row of rows.values()) {
    const id = row.stable_key.slice(prefix.length);
    if (!managedStudentsBookPageId.test(id)) throw new Error("students_book_managed_page_identity_conflict");
    const unit = units.get(Number(row.unit_number));
    if (!unit || row.unit_id !== unit.id) throw new Error("students_book_managed_unit_conflict");
    if (!inactive(row) && (row.source_metadata?.is_active !== true || !row.asset_id)) throw new Error("students_book_page_image_unavailable");
    const page = { id, stableKey: row.stable_key, componentSlug: studentsBookPageScope.componentSlug, origin: "managed", source: "managed", unitId: unit.id, unitSlug: unit.slug, unitNumber: Number(unit.unit_number), unitTitle: unit.title, sectionTitle: row.source_metadata?.section_title || "", partNumber: null, printedPages: [], printedLabel: row.source_metadata?.printed_label || "", label: row.label, sortOrder: Number(row.sort_order), imageRow: row, storedRow: row };
    (inactive(row) ? retained : pages).push(page);
  }
  pages.sort((a, b) => a.unitNumber - b.unitNumber || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  return { revision: stored.revision, units: [...units.values()], pages, retained };
}

export async function loadStudentsBookPageAuthority(sql) {
  return resolveStudentsBookPageAuthority(await loadBuilderPages(sql, studentsBookPageScope));
}
