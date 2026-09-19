// Shared portable contract. Pure data; safe in browser and Worker graphs.
export const WORDLIST_SCHEMA = "portable-wordlist.v1";
export const WORDLIST_LIMITS = Object.freeze({ json: 8 * 1024 * 1024, file: 4 * 1024 * 1024,
  total: 128 * 1024 * 1024, files: 4096, entries: 10000 });
export class WordListError extends Error { constructor(code) { super(code); this.code = code; } }
export const reject = (code) => { throw new WordListError(code); };
export function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) reject("wordlist_contract_invalid");
}
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function wordListHash(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((n) => n.toString(16).padStart(2, "0")).join("");
}
export const shaPattern = /^[a-f0-9]{64}$/;
const slug = /^[a-z0-9][a-z0-9-]{0,99}$/;
export function safeAudioPath(value) {
  if (typeof value !== "string" || !/^audio\/[a-f0-9]{64}\.mp3$/.test(value)) reject("wordlist_audio_path_invalid");
  return value;
}
function text(value, limit = 12000) {
  if (typeof value !== "string" || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
    || /<\/?[a-z][^>]*>|(?:https?:\/\/|file:\/\/|[a-z]:\\|\\\\)/i.test(value)) reject("wordlist_text_invalid");
}
export function validatePortableShape(value) {
  exact(value, ["schemaVersion", "datasetKey", "datasetSha256", "bookSlug", "languages", "provenance", "entries", "audio"]);
  if (value.schemaVersion !== WORDLIST_SCHEMA || !slug.test(value.bookSlug) || !slug.test(value.datasetKey)
    || !shaPattern.test(value.datasetSha256)) reject("wordlist_identity_invalid");
  if (!Array.isArray(value.languages) || !value.languages.includes("en") || new Set(value.languages).size !== value.languages.length
    || value.languages.some((language) => !/^[a-z]{2}$/.test(language))) reject("wordlist_languages_invalid");
  exact(value.provenance, ["format", "edition", "sourceSha256", "rawJsonSha256"]);
  if (value.provenance.format !== "swf-wordlist-json" || !slug.test(value.provenance.edition)
    || !shaPattern.test(value.provenance.sourceSha256) || !shaPattern.test(value.provenance.rawJsonSha256)) reject("wordlist_provenance_invalid");
  if (!Array.isArray(value.audio) || !value.audio.length || value.audio.length > WORDLIST_LIMITS.files
    || !Array.isArray(value.entries) || !value.entries.length || value.entries.length > WORDLIST_LIMITS.entries) reject("wordlist_count_invalid");
  const audio = new Map(); let total = 0;
  for (const item of value.audio) {
    exact(item, ["path", "sha256", "byteSize", "mediaType"]); safeAudioPath(item.path);
    if (!shaPattern.test(item.sha256) || item.path !== `audio/${item.sha256}.mp3` || audio.has(item.path)
      || item.mediaType !== "audio/mpeg" || !Number.isSafeInteger(item.byteSize) || item.byteSize < 1
      || item.byteSize > WORDLIST_LIMITS.file) reject("wordlist_audio_descriptor_invalid");
    total += item.byteSize; audio.set(item.path, item);
  }
  if (total > WORDLIST_LIMITS.total) reject("wordlist_aggregate_limit");
  const ids = new Set(); const used = new Set();
  for (const [index, item] of value.entries.entries()) {
    exact(item, ["id", "order", "originalId", "displayNumber", "english", "translations", "source", "memberships", "audioPath"]);
    if (!/^entry-[0-9]{6}$/.test(item.id) || ids.has(item.id) || item.order !== index
      || !Number.isSafeInteger(item.originalId) || !Number.isSafeInteger(item.displayNumber)) reject("wordlist_occurrence_invalid");
    ids.add(item.id);
    exact(item.english, ["word", "partOfSpeech", "pronunciation", "definition", "example"]);
    // Publisher lexical values include JSON booleans. Preserve them without guessing corrections.
    for (const [key, field] of Object.entries(item.english)) if (!(key === "word" && typeof field === "boolean")) text(field);
    exact(item.translations, value.languages.filter((language) => language !== "en"));
    Object.values(item.translations).forEach((field) => text(field));
    exact(item.source, ["unit", "part", "unitPrefix", "belong", "sound", "image"]);
    for (const key of ["unit", "belong", "sound", "image"]) text(item.source[key]);
    if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(item.source.sound) || item.source.image !== "") reject("wordlist_source_path_invalid");
    if (!Number.isSafeInteger(item.source.part) || !(Number.isSafeInteger(item.source.unitPrefix) || typeof item.source.unitPrefix === "string")) reject("wordlist_source_invalid");
    if (typeof item.source.unitPrefix === "string") text(item.source.unitPrefix);
    if (!Array.isArray(item.memberships) || item.memberships.length > 100 || !item.memberships.length) reject("wordlist_membership_invalid");
    for (const membership of item.memberships) {
      exact(membership, ["group", "component"]); text(membership.group, 100);
      if (!["students-book", "workbook", "unsupported"].includes(membership.component)) reject("wordlist_membership_invalid");
    }
    if (!audio.has(item.audioPath)) reject("wordlist_audio_missing"); used.add(item.audioPath);
  }
  if (used.size !== audio.size) reject("wordlist_unreferenced_audio");
  if (new TextEncoder().encode(stableJson(value)).length > WORDLIST_LIMITS.json) reject("wordlist_json_limit");
  return value;
}
export function datasetIdentity(value) {
  const { provenance: _provenance, datasetSha256: _hash, ...semantic } = value;
  return semantic;
}
export async function verifyPortable(value) {
  validatePortableShape(value);
  if (await wordListHash(stableJson(datasetIdentity(value))) !== value.datasetSha256) reject("wordlist_dataset_integrity");
  return value;
}
export function componentGroups(dataset, componentSlug) {
  const component = componentSlug.slice(dataset.bookSlug.length + 1);
  return [...new Set(dataset.entries.flatMap((entry) => entry.memberships.filter((m) => m.component === component).map((m) => m.group)))];
}
export function portableDiff(previous, next) {
  const old = new Map((previous?.entries || []).map((entry) => [entry.id, entry]));
  const current = new Map(next.entries.map((entry) => [entry.id, entry]));
  return { added: next.entries.filter((entry) => !old.has(entry.id)).length,
    changed: next.entries.filter((entry) => old.has(entry.id) && stableJson(old.get(entry.id)) !== stableJson(entry)).length,
    omitted: [...old.keys()].filter((id) => !current.has(id)).length,
    unchanged: next.entries.filter((entry) => old.has(entry.id) && stableJson(old.get(entry.id)) === stableJson(entry)).length };
}
