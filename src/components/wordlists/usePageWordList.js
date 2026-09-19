import { useEffect, useMemo, useState } from "react";
import { wordListForPages, wordListPageCapability } from "../../data/wordlists/pageScope.js";
import { validateRuntimeWordList, validateWordListContext, wordListContextKey } from "../../data/wordlists/runtime.js";
import { stableJson } from "../../data/wordlists/portable.js";

// An offline provider can implement load/audioUrl with verified materialized
// bytes. The same source, projection, page and release validation still applies.
export function usePageWordList({ provider, pageIds, surface }) {
  const contextJson = provider ? stableJson({ ...provider.context, pageIds }) : "null";
  const context = useMemo(() => JSON.parse(contextJson), [contextJson]);
  const supported = Boolean(context && /-(students-book|workbook)$/.test(context.componentSlug) && pageIds.length && ["page", "activity"].includes(surface));
  const [attempt, setAttempt] = useState(0); const [result, setResult] = useState(null); const [openKey, setOpenKey] = useState("");
  useEffect(() => {
    setOpenKey(""); setResult(null);
    if (!supported) return undefined;
    const abort = new AbortController();
    Promise.resolve().then(() => {
      validateWordListContext(context, { source: true });
      return provider.load ? provider.load(context, { signal: abort.signal }) : { state: "unavailable", wordlist: null };
    }).then((value) => {
      if (abort.signal.aborted) return;
      if (value.wordlist) validateRuntimeWordList(value.wordlist, context);
      const capability = value.wordlist ? wordListPageCapability({ wordlist: value.wordlist, componentSlug: context.componentSlug, pageIds: context.pageIds, surface, context }) : { state: "unavailable" };
      setResult({ key: contextJson, state: capability.state, wordlist: value.wordlist });
    }).catch(() => { if (!abort.signal.aborted) setResult({ key: contextJson, state: "error", wordlist: null }); });
    return () => abort.abort();
  }, [context, contextJson, supported, attempt, provider]);
  const current = result?.key === contextJson ? result : null;
  const state = supported ? current?.state || "loading" : "unavailable";
  const wordlist = current?.wordlist || null;
  const key = wordlist ? wordListContextKey(context, wordlist) : "";
  return { supported, state, context, wordlist, key, open: Boolean(key && openKey === key),
    entries: wordlist ? wordListForPages(wordlist, pageIds) : [],
    close: () => setOpenKey(""), toggle: () => setOpenKey((value) => value === key ? "" : key),
    retry: () => { setResult(null); setAttempt((value) => value + 1); },
    audioUrl: (sha) => { if (!provider.audioUrl) throw new Error("wordlist_audio_provider_required"); return provider.audioUrl(context, sha); } };
}
