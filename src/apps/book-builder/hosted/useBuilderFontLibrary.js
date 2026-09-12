import { useCallback, useEffect, useRef, useState } from "react";
import { getBuilderFontLibrary } from "./builderNativeActivityApi.js";

export function useBuilderFontLibrary({ bookSlug, componentSlug, onMessage }) {
  const scope = `${bookSlug}/${componentSlug}`;
  const message = useRef(onMessage);
  message.current = onMessage;
  const [library, setLibrary] = useState({ scope, fonts: [] });
  useEffect(() => {
    const controller = new AbortController();
    setLibrary({ scope, fonts: [] });
    getBuilderFontLibrary({ bookSlug, componentSlug }, { signal: controller.signal }).then((fonts) => {
      if (!controller.signal.aborted) setLibrary((current) => ({ scope,
        fonts: [...new Map([...fonts, ...(current.scope === scope ? current.fonts : [])].map((font) => [font.assetId, font])).values()],
      }));
    }).catch(() => { if (!controller.signal.aborted) message.current?.("Font library could not be loaded."); });
    return () => controller.abort();
  }, [bookSlug, componentSlug, scope]);
  const recordUploadedFont = useCallback((font) => setLibrary((current) => ({ scope,
    fonts: [...(current.scope === scope ? current.fonts : []).filter((entry) => entry.assetId !== font.assetId), font],
  })), [scope]);
  return { fonts: library.scope === scope ? library.fonts : [], recordUploadedFont };
}
