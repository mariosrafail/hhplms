import { createUltimateB2HostedOpenResponseSeed } from "../data/ultimate-b2/hostedOpenResponseDraft.js";
import { ULTIMATE_B2_OPEN_RESPONSE_ACTIVITY_IDS } from "../data/ultimate-b2/openResponseActivityRegistry.js";
import { normalizeUltimateB2PublicReleaseProjection, ULTIMATE_B2_COMPONENT_RELEASE_COMPILER_ID, ULTIMATE_B2_COMPONENT_RELEASE_SCHEMA_VERSION } from "../data/ultimate-b2/componentPublication.js";
import { normalizeUltimateB2PublicReleaseV2Projection, ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPILER_ID, ULTIMATE_B2_COMPONENT_RELEASE_V2_SCHEMA_VERSION } from "../data/ultimate-b2/componentPublicationV2.js";
import { findStudentsBookImplementation } from "../data/ultimate-b2/studentsBookCatalog.js";
import { STUDENTS_BOOK_V3_COMPILER, STUDENTS_BOOK_V3_SCHEMA, normalizeStudentsBookV3Public } from "../data/ultimate-b2/componentPublicationV3.js";

class PublicationServiceError extends Error {
  constructor(message, code) { super(message); this.name = "PublicationServiceError"; this.code = code; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

function canonicalSeeds() {
  return Object.fromEntries(ULTIMATE_B2_OPEN_RESPONSE_ACTIVITY_IDS.map((activityId) => [activityId, createUltimateB2HostedOpenResponseSeed(findStudentsBookImplementation(activityId))]));
}

export function normalizeComponentPublicationEnvelope(payload) {
  const keys = Object.keys(payload || {}).sort();
  if (keys.join("\0") !== ["compatibility", "compilerId", "projection", "releaseId", "releaseNumber", "releaseSchemaVersion", "releaseSha256"].sort().join("\0")
    || !UUID.test(String(payload.releaseId || "")) || !Number.isSafeInteger(payload.releaseNumber) || payload.releaseNumber < 1
    || !SHA256.test(String(payload.releaseSha256 || "")) || !SHA256.test(String(payload.compatibility || ""))) throw new Error("invalid_publication_envelope");
  let projection;
  if (payload.compilerId === ULTIMATE_B2_COMPONENT_RELEASE_COMPILER_ID && payload.releaseSchemaVersion === ULTIMATE_B2_COMPONENT_RELEASE_SCHEMA_VERSION) projection = normalizeUltimateB2PublicReleaseProjection(payload.projection, canonicalSeeds());
  else if (payload.compilerId === ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPILER_ID && payload.releaseSchemaVersion === ULTIMATE_B2_COMPONENT_RELEASE_V2_SCHEMA_VERSION) projection = normalizeUltimateB2PublicReleaseV2Projection(payload.projection, canonicalSeeds());
  else if (payload.compilerId === STUDENTS_BOOK_V3_COMPILER && payload.releaseSchemaVersion === STUDENTS_BOOK_V3_SCHEMA) projection = normalizeStudentsBookV3Public(payload.projection);
  else throw new Error("unsupported_publication_compiler");
  if (projection.compatibility !== payload.compatibility) throw new Error("publication_compatibility_mismatch");
  return { kind: "published", ...payload, projection };
}

export async function getActiveComponentPublication({ bookSlug = "ultimate-b2", componentSlug = "ultimate-b2-students-book", signal } = {}) {
  const response = await fetch(`/.netlify/functions/book-content?action=active-component-release&bookSlug=${encodeURIComponent(bookSlug)}&componentSlug=${encodeURIComponent(componentSlug)}`, { method: "GET", credentials: "same-origin", cache: "no-store", signal });
  if (response.status === 404) {
    const payload = await response.json().catch(() => null);
    if (payload?.error === "no_publication") return { kind: "none" };
  }
  if (!response.ok) throw new PublicationServiceError("Published content could not be verified. Refresh and try again.", "publication_unavailable");
  try { return normalizeComponentPublicationEnvelope(await response.json()); }
  catch { throw new PublicationServiceError("Published content could not be verified. Refresh and try again.", "publication_unavailable"); }
}

export async function getPublishedNativeTeacherDocument({ bookSlug = "ultimate-b2", componentSlug = "ultimate-b2-students-book", releaseId, activityId, signal } = {}) {
  const response = await fetch(`/.netlify/functions/book-content?action=published-native-teacher&bookSlug=${encodeURIComponent(bookSlug)}&componentSlug=${encodeURIComponent(componentSlug)}&releaseId=${encodeURIComponent(releaseId)}&activityId=${encodeURIComponent(activityId)}`, { method: "GET", credentials: "same-origin", cache: "no-store", signal });
  if (!response.ok) throw new PublicationServiceError("Teacher model answers are unavailable.", response.status === 403 ? "forbidden" : "teacher_publication_unavailable");
  return response.json();
}
