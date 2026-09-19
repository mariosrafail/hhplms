// Task 3 shared loader. No second lexicon or mutable fallback is needed.
export function wordListUrl(context, parameters = {}) {
  const { kind, bookSlug, editionId, componentSlug, releaseId } = context;
  const params = new URLSearchParams({ componentSlug, ...parameters });
  if (kind === "published") return `/.netlify/functions/book-content?${new URLSearchParams({ action: "edition-release", contract: "edition-release.v2", bookSlug, editionId, releaseId, ...Object.fromEntries(params) })}`;
  const base = `/builder/api/publication/wordlists/books/${encodeURIComponent(bookSlug)}/editions/${encodeURIComponent(editionId)}`;
  if (kind === "draft") return `${base}/components/${encodeURIComponent(componentSlug)}/draft?${params}`;
  if (kind === "candidate") return `${base}/releases/${encodeURIComponent(releaseId)}?${params}`;
  throw new Error("wordlist_context_invalid");
}
export async function loadWordList(context, { signal } = {}) {
  const response = await fetch(wordListUrl(context), { signal, credentials: "same-origin", cache: "no-store" });
  if ([403, 404, 409].includes(response.status)) return { state: "unavailable", wordlist: null };
  if (!response.ok) throw new Error("wordlist_load_failed");
  const result = await response.json(); const wordlist = result.wordlist;
  if (result.edition.bookSlug !== context.bookSlug || result.edition.editionId !== context.editionId
    || context.kind !== "draft" && result.releaseId !== context.releaseId
    || wordlist.targetSource.componentSlug !== context.componentSlug) throw new Error("wordlist_context_mismatch");
  return { state: wordlist.entries.length ? "ready" : "empty", wordlist };
}
export function wordListForPages(wordlist, pageIds) {
  const groups = new Set(wordlist.mappings.filter((mapping) => mapping.pageIds.some((id) => pageIds.includes(id))).map((mapping) => mapping.group));
  return wordlist.entries.filter((entry) => entry.groups.some((group) => groups.has(group)));
}
export const wordListAudioUrl = (context, sha256) => wordListUrl(context, { audioSha256: sha256 });
export function wordListPageCapability({ wordlist, componentSlug, pageIds, surface }) {
  if (!wordlist || !["page", "activity"].includes(surface) || !/-(students-book|workbook)$/.test(componentSlug)
    || wordlist.targetSource.componentSlug !== componentSlug || !pageIds?.length) return { available: false, state: "unavailable" };
  const entries = wordListForPages(wordlist, pageIds);
  return { available: entries.length > 0, state: entries.length ? "ready" : "empty" };
}
