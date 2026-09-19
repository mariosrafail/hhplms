import { createHash } from "node:crypto";
import { componentGroups, datasetIdentity, exact, reject, stableJson, validatePortableShape } from "../../../src/data/wordlists/portable.js";
import { normalizeContentSourceReference, requireEditionUuid } from "../../../src/data/contentEditions.js";
import { prepareEditionRelease, verifyEditionRelease, editionReleasePublicEnvelope } from "./_builder-edition-domain.js";

export const hashWordList = (value) => createHash("sha256").update(stableJson(value)).digest("hex");
export function verifyWordListDataset(dataset) {
  validatePortableShape(dataset);
  if (hashWordList(datasetIdentity(dataset)) !== dataset.datasetSha256) reject("wordlist_dataset_integrity");
  return dataset;
}
export function requiredWordListAudio(dataset, componentSlug) {
  const component = componentSlug.slice(dataset.bookSlug.length + 1);
  if (!["students-book", "workbook"].includes(component)) reject("wordlist_component_unavailable");
  const paths = new Set(dataset.entries.filter((entry) => entry.memberships.some((m) => m.component === component)).map((entry) => entry.audioPath));
  return dataset.audio.filter((audio) => paths.has(audio.path));
}
export function wordListObjectKey({ bookSlug, componentSlug, sourceId, sha256 }) {
  requireEditionUuid(sourceId);
  if (!/^[a-z0-9-]+$/.test(bookSlug) || !componentSlug.startsWith(`${bookSlug}-`)
    || !/^[a-z0-9-]+$/.test(componentSlug) || !/^[a-f0-9]{64}$/.test(sha256)) reject("wordlist_audio_owner");
  return `builder-wordlist-audio/${bookSlug}/${componentSlug}/${sourceId}/${sha256}.mp3`;
}
export function validateWordListMappings(dataset, target, mappings, { ready = false } = {}) {
  const groups = componentGroups(dataset, target.reference.componentSlug);
  const pages = new Set(target.content.publicProjection.pages.map((page) => page.id));
  if (!Array.isArray(mappings) || mappings.length !== groups.length) reject("wordlist_mapping_groups");
  for (const [index, mapping] of mappings.entries()) {
    exact(mapping, ["group", "pageIds"]);
    if (mapping.group !== groups[index] || !Array.isArray(mapping.pageIds) || mapping.pageIds.length > 2
      || new Set(mapping.pageIds).size !== mapping.pageIds.length || mapping.pageIds.some((id) => !pages.has(id))) reject("wordlist_mapping_page_context");
    if (ready && !mapping.pageIds.length) reject("wordlist_mapping_unresolved");
  }
  if (ready && !groups.length) reject("wordlist_component_empty");
  return mappings;
}
export function freezeWordList({ sourceId, revision, mappingRevision, dataset, target, mappings, bindings }, { ready = false } = {}) {
  requireEditionUuid(sourceId); verifyWordListDataset(dataset);
  if (!Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(mappingRevision) || mappingRevision < 1
    || dataset.bookSlug !== target.reference.bookSlug) reject("wordlist_context_invalid");
  const targetSource = normalizeContentSourceReference(target.reference);
  validateWordListMappings(dataset, target, mappings, { ready });
  const expected = requiredWordListAudio(dataset, targetSource.componentSlug);
  if (!Array.isArray(bindings) || bindings.length !== expected.length) reject("wordlist_audio_missing");
  for (const [index, binding] of bindings.entries()) {
    exact(binding, ["path", "sha256", "byteSize", "mediaType", "role", "sourceId", "componentSlug", "bookSlug", "objectKey", "storageBucket", "assetId"]);
    const descriptor = expected[index]; requireEditionUuid(binding.assetId);
    if (binding.path !== descriptor.path || binding.sha256 !== descriptor.sha256 || binding.byteSize !== descriptor.byteSize
      || binding.mediaType !== "audio/mpeg" || binding.role !== "wordlist_audio" || binding.sourceId !== sourceId
      || binding.bookSlug !== dataset.bookSlug || binding.componentSlug !== targetSource.componentSlug
      || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(binding.storageBucket)
      || binding.objectKey !== wordListObjectKey(binding)) reject("wordlist_audio_owner");
  }
  const payload = { schemaVersion: "wordlist-source.v1", sourceId, revision, mappingRevision, targetSource, dataset, mappings, bindings };
  return { ...payload, sha256: hashWordList(payload) };
}
export function verifyWordList(record, target, options) {
  exact(record, ["schemaVersion", "sourceId", "revision", "mappingRevision", "targetSource", "dataset", "mappings", "bindings", "sha256"]);
  if (record.schemaVersion !== "wordlist-source.v1" || stableJson(record.targetSource) !== stableJson(target.reference)) reject("wordlist_target_source_changed");
  const rebuilt = freezeWordList({ ...record, target }, options);
  if (stableJson(rebuilt) !== stableJson(record)) reject("wordlist_source_integrity");
  return record;
}
export function projectWordList(record, editionId) {
  const component = record.targetSource.componentSlug.slice(record.dataset.bookSlug.length + 1);
  if (!record.targetSource.scope.editionIds.includes(editionId)) reject("wordlist_edition_mismatch");
  const languages = editionId === "international" ? ["en"] : ["en", "el"];
  if (languages.some((language) => !record.dataset.languages.includes(language))) reject("wordlist_language_unavailable");
  const audioByPath = new Map(record.bindings.map((binding) => [binding.path, binding.sha256]));
  return { schemaVersion: "runtime-wordlist.v1", sourceId: record.sourceId, revision: record.revision, sourceSha256: record.sha256,
    datasetSha256: record.dataset.datasetSha256, mappingRevision: record.mappingRevision, targetSource: record.targetSource,
    policy: { id: editionId === "international" ? "english-only.v1" : "english-greek.v1", languages, audioLanguage: "en" },
    mappings: record.mappings,
    entries: record.dataset.entries.filter((entry) => entry.memberships.some((m) => m.component === component)).map((entry) => ({
      id: entry.id, order: entry.order, displayNumber: entry.displayNumber, english: entry.english,
      translations: editionId === "greek" ? { el: entry.translations.el } : {},
      groups: entry.memberships.filter((m) => m.component === component).map((m) => m.group),
      audioSha256: audioByPath.get(entry.audioPath),
    })),
    audio: record.bindings.map(({ assetId, sha256, byteSize, mediaType, role }) => ({ assetId, sha256, byteSize, mediaType, role })),
  };
}
export function prepareWordListEdition({ id, number, edition, sources, wordlists }) {
  const content = prepareEditionRelease({ id, number, edition, sources });
  if (!Array.isArray(wordlists) || wordlists.length !== 2) reject("wordlist_required_sources_missing");
  const members = content.members.slice(0, 2).map((target, index) => verifyWordList(wordlists[index], target, { ready: true }));
  const composition = { schemaVersion: "edition-composition.v2", edition: content.composition.edition,
    members: content.composition.members, wordlists: members.map((record) => ({ sourceId: record.sourceId, revision: record.revision,
      sha256: record.sha256, mappingRevision: record.mappingRevision, projectionSha256: hashWordList(projectWordList(record, edition.editionId)) })) };
  const payload = { schemaVersion: "edition-release.v2", compilerId: "ultimate-b2-edition-composition-v2", id, number,
    composition, compositionSha256: hashWordList(composition), content, wordlists: members };
  return { ...payload, releaseSha256: hashWordList(payload) };
}
export function verifyWordListEdition(release, edition) {
  exact(release, ["schemaVersion", "compilerId", "id", "number", "composition", "compositionSha256", "content", "wordlists", "releaseSha256"]);
  verifyEditionRelease(release.content, edition);
  const rebuilt = prepareWordListEdition({ id: release.id, number: release.number, edition, sources: release.content.members, wordlists: release.wordlists });
  if (stableJson(rebuilt) !== stableJson(release)) reject("wordlist_release_integrity");
  return release;
}
export function wordListEditionPublic(release, edition) {
  verifyWordListEdition(release, edition);
  const { wordlists, content, ...envelope } = release;
  return { ...envelope, content: editionReleasePublicEnvelope(content, edition), wordlists: wordlists.map((record) => projectWordList(record, edition.editionId)) };
}
