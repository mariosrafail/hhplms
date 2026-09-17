import { useLayoutEffect, useRef } from "react";

export function nativeHotspotCropOffset(area, surface, viewportHeight, scale) {
  const height = surface.height * scale;
  if (height <= viewportHeight) return 0;
  return Math.min(height - viewportHeight, Math.max(0, (area.y + area.height / 2) * scale - viewportHeight / 2));
}

// Mounted once by the owner of the actual hotspot buttons. A shared canvas owns
// its complete coordinate system; flow children only own their local stage.
export function useNativeHotspotAnchor(surface, presentation, panelId) {
  const ref = useRef(null);
  const active = presentation?.hotspots.find((hotspot) => hotspot.id === presentation.activeHotspotId && hotspot.panelId === panelId);
  useLayoutEffect(() => {
    const stage = ref.current?.parentElement;
    const view = stage?.closest(".native-readable-text-activity-view.is-audio-focus");
    if (!active || !surface || !stage || !view) return undefined;
    const changed = [];
    const set = (node, key, value) => {
      if (!changed.some((entry) => entry.node === node && entry.key === key)) changed.push({ node, key, value: node.style.getPropertyValue(key), priority: node.style.getPropertyPriority(key) });
      node.style.setProperty(key, value, "important");
    };
    const ancestors = [];
    for (let node = stage.parentElement; node && view.contains(node); node = node.parentElement) { ancestors.push(node); if (node === view) break; }
    for (const node of ancestors) { set(node, "overflow-y", "hidden"); set(node, "touch-action", "none"); }
    set(stage, "max-height", "none"); set(stage, "min-height", "0"); set(stage, "flex-shrink", "0");
    set(stage, "touch-action", "none");
    stage.dataset.hotspotAnchored = active.id;
    let frame = null;
    const measure = () => {
      // client dimensions ignore outer Teacher/fullscreen transforms.
      const width = Math.min(...ancestors.map((node) => node.clientWidth).filter((value) => value > 0));
      if (!Number.isFinite(width) || !width) return;
      set(stage, "width", `${width}px`); set(stage, "height", `${width * surface.height / surface.width}px`);
      set(stage, "max-width", "none"); set(stage, "transform", "none");
      const rect = stage.getBoundingClientRect();
      let top = view.getBoundingClientRect().top; let bottom = view.getBoundingClientRect().bottom;
      for (const node of ancestors) { const bounds = node.getBoundingClientRect(); if (bounds.height > 0) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); } }
      const viewport = Math.max(1, bottom - top);
      const offset = nativeHotspotCropOffset(active.activityArea, surface, viewport, rect.width / surface.width);
      const displayScale = rect.width / Math.max(1, stage.offsetWidth);
      const adjustment = rect.height <= viewport ? 0 : (top - rect.top - offset) / displayScale;
      set(stage, "transform", `translateY(${adjustment}px)`);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const stopScroll = (event) => { event.preventDefault(); };
    const stopKeys = (event) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key) && !event.target.matches("input,textarea")) event.preventDefault(); };
    stage.addEventListener("wheel", stopScroll, { passive: false }); stage.addEventListener("touchmove", stopScroll, { passive: false }); stage.addEventListener("keydown", stopKeys);
    const observer = new ResizeObserver(schedule); ancestors.forEach((node) => observer.observe(node));
    globalThis.addEventListener("resize", schedule); stage.addEventListener("load", schedule, true);
    measure(); schedule();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); globalThis.removeEventListener("resize", schedule); stage.removeEventListener("load", schedule, true);
      stage.removeEventListener("wheel", stopScroll); stage.removeEventListener("touchmove", stopScroll); stage.removeEventListener("keydown", stopKeys);
      delete stage.dataset.hotspotAnchored;
      for (const entry of changed) { if (entry.value) entry.node.style.setProperty(entry.key, entry.value, entry.priority); else entry.node.style.removeProperty(entry.key); }
    };
  }, [active?.id, active?.activityArea, surface?.width, surface?.height]);
  return ref;
}
