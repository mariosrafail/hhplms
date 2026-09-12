import { useLayoutEffect } from "react";

// Fit the actual artwork, not just its card. Every image in a row shares the
// largest height that fits all its cards, including grouped single pages.
export function useOverviewThumbnailSizing(panelRef, entries) {
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    const images = [...panel.querySelectorAll(".teacher-unit-page-thumb img")];
    const size = () => {
      const maximum = parseFloat(getComputedStyle(panel).getPropertyValue("--teacher-unit-overview-thumbnail-height"));
      for (const row of [1, 2]) {
        const cards = [...panel.querySelectorAll(`[data-overview-row="${row}"]`)];
        const heights = cards.map((card) => {
          const thumb = card.querySelector(".teacher-unit-page-thumb");
          const artwork = [...thumb.querySelectorAll("img")];
          if (artwork.some((image) => !image.naturalWidth || !image.naturalHeight)) return maximum;
          const ratio = artwork.reduce((sum, image) => sum + image.naturalWidth / image.naturalHeight, 0);
          const gap = parseFloat(getComputedStyle(thumb).columnGap) || 0;
          const padding = parseFloat(getComputedStyle(card).paddingBottom) || 0;
          return Math.min(maximum, (thumb.clientWidth - gap * (artwork.length - 1)) / ratio,
            card.clientHeight - card.querySelector(".teacher-unit-page-copy").offsetHeight - padding);
        });
        if (heights.length) panel.style.setProperty(`--overview-row-${row}-height`, `${Math.max(0, Math.min(...heights))}px`);
      }
    };
    const observer = new ResizeObserver(size);
    observer.observe(panel);
    for (const card of panel.querySelectorAll(".teacher-unit-page-card")) observer.observe(card);
    images.forEach((image) => image.addEventListener("load", size));
    size();
    return () => { observer.disconnect(); images.forEach((image) => image.removeEventListener("load", size)); };
  }, [panelRef, entries]);
}
