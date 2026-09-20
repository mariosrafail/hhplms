// Content identity is independent of interface language, role and display state.
// Absence of an edition remains unclassified; callers must opt in explicitly.
export const CONTENT_EDITION_SCHEMA = "content-edition.v1";
export const CONTENT_SOURCE_SCHEMA = "content-source.v1";
export const EDITION_COMPOSITION_SCHEMA = "edition-composition.v1";

const b2Components = Object.freeze([
  "ultimate-b2-students-book", "ultimate-b2-workbook", "ultimate-b2-grammar-book",
]);
// B1 editions retain the existing published Students Book/Workbook membership.
const managedEditionBook = (bookSlug) => Object.freeze({
  editions: Object.freeze(["international", "greek"]),
  components: Object.freeze([`${bookSlug}-students-book`, `${bookSlug}-workbook`]),
  uiOwnerComponentSlug: `${bookSlug}-students-book`, wordListOperational: true,
});
export const contentEditionBooks = Object.freeze({
  "ultimate-b1": managedEditionBook("ultimate-b1"),
  "ultimate-b1-plus": managedEditionBook("ultimate-b1-plus"),
  "ultimate-b2": Object.freeze({
    editions: Object.freeze(["international", "greek"]),
    components: b2Components,
    uiOwnerComponentSlug: "ultimate-b2-students-book",
    wordListOperational: true,
  }),
});
export const editionLabels = Object.freeze({ international: "International", greek: "Greek" });
export const findContentEditionBook = (bookSlug) => Object.hasOwn(contentEditionBooks, bookSlug) ? contentEditionBooks[bookSlug] : null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[a-f0-9]{64}$/;

export class ContentEditionError extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ContentEditionError";
    this.code = code;
  }
}
export function editionExact(value, keys, code = "edition_contract_invalid") {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) throw new ContentEditionError(code);
}
export function requireEditionUuid(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new ContentEditionError("edition_identifier_invalid");
  return value;
}
export function requireEditionSha(value) {
  if (typeof value !== "string" || !SHA.test(value)) throw new ContentEditionError("edition_fingerprint_invalid");
  return value;
}
export function requireEditionRevision(value, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new ContentEditionError("edition_revision_invalid");
  return value;
}
export function freezeEditionValue(value) {
  const copy = structuredClone(value);
  const visit = (item) => {
    if (item && typeof item === "object") { Object.values(item).forEach(visit); Object.freeze(item); }
    return item;
  };
  return visit(copy);
}
export function normalizeContentEdition(value) {
  editionExact(value, ["schemaVersion", "bookSlug", "editionId"]);
  if (value.schemaVersion !== CONTENT_EDITION_SCHEMA
    || !findContentEditionBook(value.bookSlug)?.editions.includes(value.editionId)) throw new ContentEditionError("content_edition_unavailable");
  return Object.freeze({ ...value });
}
export function contentEdition(bookSlug, editionId) {
  return normalizeContentEdition({ schemaVersion: CONTENT_EDITION_SCHEMA, bookSlug, editionId });
}
export function requireEditionComponent(bookSlug, componentSlug) {
  if (!findContentEditionBook(bookSlug)?.components.includes(componentSlug)) throw new ContentEditionError("edition_component_mismatch");
  return componentSlug;
}

// A scope is an explicit ownership declaration, never inferred from bytes.
export function normalizeContentSourceScope(value) {
  editionExact(value, ["kind", "editionIds"]);
  if (!Array.isArray(value.editionIds)) throw new ContentEditionError("edition_source_scope_invalid");
  const ids = value.editionIds;
  if (value.kind === "shared") {
    if (ids.join("\0") !== "international\0greek") throw new ContentEditionError("edition_source_scope_invalid");
  } else if (value.kind !== "edition" || ids.length !== 1 || !["international", "greek"].includes(ids[0])) {
    throw new ContentEditionError("edition_source_scope_invalid");
  }
  return freezeEditionValue(value);
}
export function normalizeContentSourceReference(value, requested = null) {
  editionExact(value, ["schemaVersion", "sourceId", "bookSlug", "componentSlug", "scope", "revision", "sha256"]);
  if (value.schemaVersion !== CONTENT_SOURCE_SCHEMA) throw new ContentEditionError("edition_source_version_invalid");
  requireEditionUuid(value.sourceId);
  requireEditionComponent(value.bookSlug, value.componentSlug);
  requireEditionRevision(value.revision);
  requireEditionSha(value.sha256);
  const scope = normalizeContentSourceScope(value.scope);
  if (requested) {
    const edition = normalizeContentEdition(requested.edition);
    if (edition.bookSlug !== value.bookSlug || requested.componentSlug !== value.componentSlug
      || !scope.editionIds.includes(edition.editionId)) throw new ContentEditionError("edition_source_owner_mismatch");
  }
  return freezeEditionValue({ ...value, scope });
}

// Whole component revisions are selected. Images, geometry and activities are
// never composed through a deep merge or a missing-edition fallback.
export function normalizeEditionComposition(value) {
  editionExact(value, ["schemaVersion", "edition", "members"]);
  if (value.schemaVersion !== EDITION_COMPOSITION_SCHEMA) throw new ContentEditionError("edition_composition_version_invalid");
  const edition = normalizeContentEdition(value.edition);
  const required = contentEditionBooks[edition.bookSlug].components;
  if (!Array.isArray(value.members) || value.members.length !== required.length) throw new ContentEditionError("edition_required_sources_missing");
  const members = required.map((componentSlug, index) => {
    const reference = value.members[index];
    if (!reference) throw new ContentEditionError("edition_required_sources_missing", componentSlug);
    return normalizeContentSourceReference(reference, { edition, componentSlug });
  });
  if (new Set(members.map((entry) => entry.sourceId)).size !== members.length) throw new ContentEditionError("edition_source_owner_mismatch");
  return freezeEditionValue({ schemaVersion: EDITION_COMPOSITION_SCHEMA, edition, members });
}

// Closed compiler choices; historical verification never consults a mutable
// current-product registry. B2 retains its original v3/v1/v1 source contract.
export function editionSourceCompilerContract(bookSlug, componentSlug) {
  requireEditionComponent(bookSlug, componentSlug);
  const version = componentSlug.endsWith("-students-book") ? (bookSlug === "ultimate-b2" ? 3 : 2) : 1;
  return Object.freeze({ compilerId: `${componentSlug}-v${version}`, releaseSchemaVersion: `${version}.0` });
}
export function editionWriterCompilerId(bookSlug, version = 1) {
  if (!findContentEditionBook(bookSlug) || ![1, 2].includes(version)) throw new ContentEditionError("edition_release_version_invalid");
  return `${bookSlug}-edition-composition-v${version}`;
}
