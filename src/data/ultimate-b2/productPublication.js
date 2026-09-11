import { resolvePublicationProductContract } from "../publicationRegistry.js";
export const ULTIMATE_B2_PRODUCT_RELEASE_SCHEMA_VERSION = "1.0";
export const ULTIMATE_B2_PRODUCT_RELEASE_COMPILER_ID = "ultimate-b2-product-v1";
export const ULTIMATE_B2_LEGACY_PRODUCT_RELEASE_COMPILER_ID = "ultimate-b2-product-legacy-v1";

export const ULTIMATE_B2_PRODUCT_RELEASE_COMPONENTS = Object.freeze([
  Object.freeze({ componentSlug: "ultimate-b2-students-book", order: 1 }),
  Object.freeze({ componentSlug: "ultimate-b2-workbook", order: 2 }),
  Object.freeze({ componentSlug: "ultimate-b2-grammar-book", order: 3 }),
]);

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const MEMBER_STATUSES = new Set(["included", "unavailable"]);

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} has unsupported fields.`);
}

export function normalizeProductReleaseMember(value, expected = null) {
  exact(value, ["componentSlug", "order", "status", "componentReleaseId", "compilerId", "releaseSchemaVersion", "releaseSha256", "compatibility", "memberSha256", "unavailableReason"], "Product release member");
  if (!SAFE_ID.test(String(value.componentSlug || "")) || !Number.isSafeInteger(value.order) || value.order < 1 || !MEMBER_STATUSES.has(value.status)) throw new Error("Product release member identity is invalid.");
  if (expected && (value.componentSlug !== expected.componentSlug || value.order !== expected.order)) throw new Error("Product release member order is invalid.");
  const included = value.status === "included";
  if (included) {
    if (!UUID.test(String(value.componentReleaseId || "")) || !SAFE_ID.test(String(value.compilerId || "")) || !/^\d+\.\d+$/.test(String(value.releaseSchemaVersion || "")) || !SHA256.test(String(value.releaseSha256 || "")) || !SHA256.test(String(value.compatibility || "")) || value.unavailableReason !== null) throw new Error("Included product release member is invalid.");
  } else if (value.componentReleaseId !== null || value.compilerId !== null || value.releaseSchemaVersion !== null || value.releaseSha256 !== null || value.compatibility !== null || !/^[a-z0-9][a-z0-9_]{2,63}$/.test(String(value.unavailableReason || ""))) {
    throw new Error("Unavailable product release member is invalid.");
  }
  const member = {
    componentSlug: value.componentSlug,
    order: value.order,
    status: value.status,
    componentReleaseId: included ? value.componentReleaseId.toLowerCase() : null,
    compilerId: included ? value.compilerId : null,
    releaseSchemaVersion: included ? value.releaseSchemaVersion : null,
    releaseSha256: included ? value.releaseSha256 : null,
    compatibility: included ? value.compatibility : null,
    unavailableReason: included ? null : value.unavailableReason,
  };
  if (!SHA256.test(String(value.memberSha256 || ""))) throw new Error("Product release member fingerprint is invalid.");
  return Object.freeze({ ...member, memberSha256: value.memberSha256 });
}

function normalizedMembers(values, contract) {
  if (!Array.isArray(values) || values.length !== contract.members.length) throw new Error("Product release member set is incomplete.");
  const members = values.map((value, index) => normalizeProductReleaseMember(value, contract.members[index]));
  if (contract.bookSlug !== "ultimate-b2" && members.some((member, index) => member.compilerId !== contract.members[index].compilerId || member.releaseSchemaVersion !== contract.members[index].releaseSchemaVersion)) throw new Error("Product release member compiler is invalid.");
  if (new Set(members.map((member) => member.componentSlug)).size !== members.length) throw new Error("Product release members must be unique.");
  return Object.freeze(members);
}

export function normalizeProductReleaseEnvelope(value) {
  exact(value, ["id", "number", "bookSlug", "compilerId", "releaseSchemaVersion", "sourceSnapshotSha256", "releaseSha256", "releaseNote", "createdAt", "members"], "Product release");
  const contract = resolvePublicationProductContract(value.bookSlug, value.compilerId);
  if (!UUID.test(String(value.id || "")) || !contract || !Number.isSafeInteger(value.number) || value.number < 1
    || !(value.compilerId === contract.compilerId || value.bookSlug === "ultimate-b2" && value.compilerId === ULTIMATE_B2_LEGACY_PRODUCT_RELEASE_COMPILER_ID)
    || value.releaseSchemaVersion !== ULTIMATE_B2_PRODUCT_RELEASE_SCHEMA_VERSION || !SHA256.test(String(value.sourceSnapshotSha256 || ""))
    || !SHA256.test(String(value.releaseSha256 || "")) || typeof value.releaseNote !== "string" || value.releaseNote.length > 240
    || !Number.isFinite(Date.parse(value.createdAt || ""))) throw new Error("Product release identity is invalid.");
  const members = normalizedMembers(value.members, contract);
  if (value.compilerId === contract.compilerId && members.some((member) => member.status !== "included")) throw new Error("Current product releases require every member.");
  return Object.freeze({ ...value, id: value.id.toLowerCase(), members });
}
