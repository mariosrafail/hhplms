import { validateWordListContext, validateRuntimeWordList } from "./runtime.js";

export function wordListForPages(wordlist, pageIds) {
  const groups = new Set(wordlist.mappings.filter((mapping) => mapping.pageIds.some((id) => pageIds.includes(id))).map((mapping) => mapping.group));
  return wordlist.entries.filter((entry) => entry.groups.some((group) => groups.has(group)));
}
export function wordListPageCapability({ wordlist, componentSlug, pageIds, surface, context = null }) {
  if (!wordlist || !["page", "activity"].includes(surface) || !/-(students-book|workbook)$/.test(componentSlug)
    || wordlist.targetSource.componentSlug !== componentSlug || !pageIds?.length) return { available: false, state: "unavailable" };
  if (context) { validateWordListContext({ ...context, pageIds }, { source: true }); validateRuntimeWordList(wordlist, context); }
  const entries = wordListForPages(wordlist, pageIds);
  return { available: entries.length > 0, state: entries.length ? "ready" : "empty" };
}
