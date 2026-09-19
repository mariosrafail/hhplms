import {
  CONTENT_SOURCE_SCHEMA, EDITION_COMPOSITION_SCHEMA, ContentEditionError,
  contentEditionBooks, editionExact, freezeEditionValue, normalizeContentEdition,
  normalizeContentSourceReference, normalizeEditionComposition, requireEditionUuid,
  requireEditionRevision, requireEditionSha,
} from "../../../src/data/contentEditions.js";
import { publicationProductsV1 } from "../../../src/data/publicationRegistry.js";
import { builderDocumentSha256 } from "./_builder-content-security.js";
import { resolvePublicationCompiler, verifyImmutableComponentRelease } from "./_builder-publication-compilers.js";

export const EDITION_RELEASE_SCHEMA = "edition-release.v1";
export const EDITION_RELEASE_COMPILER = "ultimate-b2-edition-composition-v1";
const hash = (namespace, value) => builderDocumentSha256({ namespace, value });
const sourceKeys = ["schemaVersion", "sourceId", "bookSlug", "componentSlug", "scope", "revision", "inputs"];
const compiledKeys = ["compilerId", "releaseSchemaVersion", "compatibility", "sourceSnapshot", "sourceSnapshotSha256",
  "publicProjection", "publicProjectionSha256", "teacherProjection", "teacherProjectionSha256", "assetManifest", "releaseSha256"];

function sourceIdentity(source, sha256) {
  const { inputs: _inputs, ...identity } = source;
  return normalizeContentSourceReference({ ...identity, sha256 });
}
function compilerFor(componentSlug) {
  const member = publicationProductsV1.find((entry) => entry.bookSlug === "ultimate-b2").members.find((entry) => entry.componentSlug === componentSlug);
  const compiler = member && resolvePublicationCompiler(member.compilerId, member.releaseSchemaVersion);
  if (!compiler) throw new ContentEditionError("edition_source_compiler_invalid");
  return compiler;
}
function assertDurableJson(value, depth = 0) {
  if (depth > 60 || typeof value === "number" && !Number.isFinite(value)
    || ["undefined", "function", "symbol", "bigint"].includes(typeof value)) throw new ContentEditionError("edition_source_invalid");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:authorization|previewauthorization|token|sessiontoken|password|secret|credentials|databaseurl)$/i.test(key.replace(/[^a-z]/gi, ""))) throw new ContentEditionError("edition_source_transient_data");
    assertDurableJson(child, depth + 1);
  }
}
function compilerRow(compiled) {
  return {
    compiler_id: compiled.compilerId, release_schema_version: compiled.releaseSchemaVersion,
    runtime_compatibility_sha256: compiled.compatibility,
    source_snapshot: compiled.sourceSnapshot, source_snapshot_sha256: compiled.sourceSnapshotSha256,
    public_projection: compiled.publicProjection, public_projection_sha256: compiled.publicProjectionSha256,
    teacher_projection: compiled.teacherProjection, teacher_projection_sha256: compiled.teacherProjectionSha256,
    asset_manifest: compiled.assetManifest, release_sha256: compiled.releaseSha256,
  };
}

// Private authoring input. Persistence must additionally authorize and bind all
// asset sources before calling this domain function; a checksum is not a grant.
export function freezeEditionSource(value) {
  assertDurableJson(value);
  editionExact(value, sourceKeys, "edition_source_invalid");
  if (value.schemaVersion !== CONTENT_SOURCE_SCHEMA || !value.inputs || typeof value.inputs !== "object" || Array.isArray(value.inputs)) throw new ContentEditionError("edition_source_invalid");
  const sha256 = hash(CONTENT_SOURCE_SCHEMA, value);
  const reference = sourceIdentity(value, sha256);
  const compiled = compilerFor(reference.componentSlug).compile(structuredClone(value.inputs));
  if (!compiled.publicProjection.pages?.length) throw new ContentEditionError("edition_required_sources_missing", reference.componentSlug);
  const content = Object.fromEntries(compiledKeys.map((key) => [key, compiled[key]]));
  verifyImmutableComponentRelease(compilerRow(content));
  return freezeEditionValue({ reference, source: value, content });
}

export function verifyEditionSource(value, requested = null) {
  editionExact(value, ["reference", "source", "content"], "edition_source_invalid");
  const reference = normalizeContentSourceReference(value.reference, requested);
  editionExact(value.source, sourceKeys, "edition_source_invalid");
  if (hash(CONTENT_SOURCE_SCHEMA, value.source) !== reference.sha256
    || builderDocumentSha256(sourceIdentity(value.source, reference.sha256)) !== builderDocumentSha256(reference)) throw new ContentEditionError("edition_source_integrity_failed");
  editionExact(value.content, compiledKeys, "edition_source_invalid");
  const compiler = compilerFor(reference.componentSlug);
  if (value.content.compilerId !== compiler.compilerId || value.content.releaseSchemaVersion !== compiler.releaseSchemaVersion) throw new ContentEditionError("edition_source_compiler_invalid");
  verifyImmutableComponentRelease(compilerRow(value.content));
  // These inputs are captured within the source revision, never recollected
  // from mutable authoring stores during a historical read.
  const rebuilt = freezeEditionSource(value.source);
  if (builderDocumentSha256(rebuilt.content) !== builderDocumentSha256(value.content)) throw new ContentEditionError("edition_source_integrity_failed");
  return freezeEditionValue(value);
}

export function prepareEditionRelease({ id, number, edition: requestedEdition, sources }) {
  requireEditionUuid(id); requireEditionRevision(number);
  const edition = normalizeContentEdition(requestedEdition);
  const required = contentEditionBooks[edition.bookSlug].components;
  if (!Array.isArray(sources)) throw new ContentEditionError("edition_required_sources_missing");
  const members = required.map((componentSlug) => {
    const matches = sources.filter((entry) => entry?.reference?.componentSlug === componentSlug);
    if (matches.length !== 1) throw new ContentEditionError("edition_required_sources_missing", componentSlug);
    return verifyEditionSource(matches[0], { edition, componentSlug });
  });
  if (sources.length !== members.length) throw new ContentEditionError("edition_source_owner_mismatch");
  const composition = normalizeEditionComposition({ schemaVersion: EDITION_COMPOSITION_SCHEMA, edition, members: members.map((entry) => entry.reference) });
  const payload = {
    schemaVersion: EDITION_RELEASE_SCHEMA, compilerId: EDITION_RELEASE_COMPILER,
    id, number, composition, compositionSha256: hash(EDITION_COMPOSITION_SCHEMA, composition), members,
  };
  return freezeEditionValue({ ...payload, releaseSha256: hash(EDITION_RELEASE_SCHEMA, payload) });
}

export function verifyEditionRelease(value, expectedEdition = null) {
  editionExact(value, ["schemaVersion", "compilerId", "id", "number", "composition", "compositionSha256", "members", "releaseSha256"], "edition_release_invalid");
  if (value.schemaVersion !== EDITION_RELEASE_SCHEMA || value.compilerId !== EDITION_RELEASE_COMPILER) throw new ContentEditionError("edition_release_version_invalid");
  requireEditionSha(value.releaseSha256); requireEditionSha(value.compositionSha256);
  const composition = normalizeEditionComposition(value.composition);
  if (expectedEdition && builderDocumentSha256(normalizeContentEdition(expectedEdition)) !== builderDocumentSha256(composition.edition)) throw new ContentEditionError("edition_release_context_mismatch");
  const rebuilt = prepareEditionRelease({ id: value.id, number: value.number, edition: composition.edition, sources: value.members });
  if (builderDocumentSha256(rebuilt) !== builderDocumentSha256(value)) throw new ContentEditionError("edition_release_integrity_failed");
  return rebuilt;
}

export function editionReleasePublicEnvelope(value, expectedEdition = null) {
  const release = verifyEditionRelease(value, expectedEdition);
  return freezeEditionValue({
    schemaVersion: release.schemaVersion, compilerId: release.compilerId,
    id: release.id, number: release.number, composition: release.composition,
    compositionSha256: release.compositionSha256, releaseSha256: release.releaseSha256,
    members: release.members.map(({ reference, content }) => ({ reference, compilerId: content.compilerId,
      releaseSchemaVersion: content.releaseSchemaVersion, releaseSha256: content.releaseSha256,
      publicProjection: content.publicProjection })),
  });
}
