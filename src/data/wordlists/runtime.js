import { contentEdition, normalizeContentSourceReference, requireEditionUuid, requireEditionComponent } from "../contentEditions.js";
import { exact, reject, shaPattern, stableJson, WORDLIST_LIMITS } from "./portable.js";

export function validateWordListContext(context, { source = false } = {}) {
  if (!context || !["draft", "candidate", "published"].includes(context.kind)) reject("wordlist_context_invalid");
  const edition = contentEdition(context.bookSlug, context.editionId);
  requireEditionComponent(context.bookSlug, context.componentSlug);
  if (!["students-book", "workbook", "grammar-book"].some((name) => context.componentSlug === `${context.bookSlug}-${name}`)) reject("wordlist_context_invalid");
  if (context.kind !== "draft") requireEditionUuid(context.releaseId);
  if (source || context.targetSource) normalizeContentSourceReference(context.targetSource, { edition, componentSlug: context.componentSlug });
  if (context.pageIds && (!Array.isArray(context.pageIds) || context.pageIds.length > 2 || new Set(context.pageIds).size !== context.pageIds.length
    || !Array.isArray(context.sourcePageIds) || context.pageIds.some((id) => !context.sourcePageIds.includes(id)))) reject("wordlist_page_context_invalid");
  return context;
}
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const text = (value) => typeof value === "string" && value.length <= 12000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
export function validateRuntimeWordList(wordlist, context) {
  validateWordListContext(context);
  exact(wordlist, ["schemaVersion", "sourceId", "revision", "sourceSha256", "datasetSha256", "mappingRevision", "targetSource", "policy", "mappings", "entries", "audio"]);
  requireEditionUuid(wordlist.sourceId);
  normalizeContentSourceReference(wordlist.targetSource, { edition: contentEdition(context.bookSlug, context.editionId), componentSlug: context.componentSlug });
  if (wordlist.schemaVersion !== "runtime-wordlist.v1" || !positive(wordlist.revision) || !positive(wordlist.mappingRevision)
    || !shaPattern.test(wordlist.sourceSha256) || !shaPattern.test(wordlist.datasetSha256)
    || context.targetSource && stableJson(context.targetSource) !== stableJson(wordlist.targetSource)) reject("wordlist_source_mismatch");
  const greek = context.editionId === "greek";
  if (stableJson(wordlist.policy) !== stableJson({ id: greek ? "english-greek.v1" : "english-only.v1", languages: greek ? ["en", "el"] : ["en"], audioLanguage: "en" })) reject("wordlist_policy_invalid");
  if (!Array.isArray(wordlist.audio) || wordlist.audio.length > WORDLIST_LIMITS.files || !Array.isArray(wordlist.entries)
    || wordlist.entries.length > WORDLIST_LIMITS.entries || !Array.isArray(wordlist.mappings) || wordlist.mappings.length > WORDLIST_LIMITS.entries) reject("wordlist_contract_invalid");
  const audio = new Set(); let bytes = 0;
  for (const item of wordlist.audio) {
    exact(item, ["assetId", "sha256", "byteSize", "mediaType", "role"]); requireEditionUuid(item.assetId);
    if (!shaPattern.test(item.sha256) || audio.has(item.sha256) || !positive(item.byteSize) || item.byteSize > WORDLIST_LIMITS.file
      || item.mediaType !== "audio/mpeg" || item.role !== "wordlist_audio") reject("wordlist_audio_invalid");
    bytes += item.byteSize; audio.add(item.sha256);
  }
  if (bytes > WORDLIST_LIMITS.total) reject("wordlist_audio_invalid");
  const groups = new Set();
  for (const mapping of wordlist.mappings) {
    exact(mapping, ["group", "pageIds"]);
    if (!text(mapping.group) || !mapping.group || groups.has(mapping.group) || !Array.isArray(mapping.pageIds)
      || new Set(mapping.pageIds).size !== mapping.pageIds.length || mapping.pageIds.some((id) => !text(id) || !id
        || context.sourcePageIds && !context.sourcePageIds.includes(id))) reject("wordlist_page_context_invalid");
    groups.add(mapping.group);
  }
  const ids = new Set(); let order = -1;
  for (const entry of wordlist.entries) {
    exact(entry, ["id", "order", "displayNumber", "english", "translations", "groups", "audioSha256"]);
    exact(entry.english, ["word", "partOfSpeech", "pronunciation", "definition", "example"]);
    exact(entry.translations, greek ? ["el"] : []);
    if (!/^entry-[0-9]{6}$/.test(entry.id) || ids.has(entry.id) || !Number.isSafeInteger(entry.order) || entry.order <= order
      || !Number.isSafeInteger(entry.displayNumber) || !audio.has(entry.audioSha256)
      || !Array.isArray(entry.groups) || !entry.groups.length || entry.groups.some((group) => !groups.has(group))
      || Object.entries(entry.english).some(([key, value]) => !(key === "word" && typeof value === "boolean") && !text(value))
      || Object.values(entry.translations).some((value) => !text(value))) reject("wordlist_entry_invalid");
    ids.add(entry.id); order = entry.order;
  }
  return wordlist;
}

export function wordListContextKey(context, wordlist = null) {
  validateWordListContext(context, { source: true });
  return stableJson([context.kind, context.bookSlug, context.editionId, context.componentSlug, context.releaseId || null,
    context.targetSource, context.pageIds, wordlist && [wordlist.sourceId, wordlist.revision, wordlist.sourceSha256, wordlist.mappingRevision]]);
}
