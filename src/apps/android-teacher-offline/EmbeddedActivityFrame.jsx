import { useLayoutEffect, useRef, useState } from "react";
import { resolveEmbeddedActivityFit } from "./embeddedActivityFit.js";

const sourceAuthoredCanvases = Object.freeze({
  "ultimate-b2-sb-u1-p2-o2": Object.freeze({ width: 1280, height: 728 }),
  "ultimate-b2-sb-u1-p2-o3": Object.freeze({ width: 1280, height: 728 }),
  "ultimate-b2-sb-u1-p2-o4": Object.freeze({ width: 1024, height: 582 }),
  "ultimate-b2-sb-u1-p2-o5": Object.freeze({ width: 1024, height: 582 }),
});

export function EmbeddedActivityFrame({ activityId, title, children, overlay = null }) {
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const [fit, setFit] = useState({ mode: "scale", scale: 1 });
  const authoredCanvas = sourceAuthoredCanvases[activityId] || null;
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return undefined;
    let active = true;
    let refreshFrame = 0;
    const update = () => {
      if (!active) return;
      const style = getComputedStyle(viewport);
      const availableWidth = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const availableHeight = viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const activity = content.firstElementChild;
      const controls = [...content.querySelectorAll("button, input, textarea, audio, video")]
        .filter((element) => {
          const controlStyle = getComputedStyle(element);
          return controlStyle.display !== "none"
            && controlStyle.visibility !== "hidden"
            && !element.matches('input[type="radio"], input[type="checkbox"]');
        });
      const minimumTargetSize = controls.length
        ? Math.min(...controls.map((element) => Math.min(element.offsetWidth, element.offsetHeight)))
        : undefined;
      const measuredFit = resolveEmbeddedActivityFit({
        availableWidth,
        availableHeight,
        contentWidth: authoredCanvas?.width || Math.max(content.offsetWidth, content.scrollWidth, activity?.scrollWidth || 0),
        contentHeight: authoredCanvas?.height || Math.max(content.offsetHeight, content.scrollHeight, activity?.scrollHeight || 0),
        minimumTargetSize,
        allowUpscale: Boolean(authoredCanvas),
      });
      const next = measuredFit;
      setFit((current) => (
        current.mode === next.mode && Math.abs(current.scale - next.scale) < 0.001 ? current : next
      ));
    };
    update();
    const refresh = () => {
      cancelAnimationFrame(refreshFrame);
      refreshFrame = requestAnimationFrame(() => {
        update();
        refreshFrame = requestAnimationFrame(update);
      });
    };
    refresh();
    document.fonts?.ready.then(refresh);
    content.addEventListener("load", refresh, true);
    globalThis.addEventListener("resize", refresh);
    if (typeof ResizeObserver === "undefined") {
      return () => {
        active = false;
        cancelAnimationFrame(refreshFrame);
        content.removeEventListener("load", refresh, true);
        globalThis.removeEventListener("resize", refresh);
      };
    }
    const observer = new ResizeObserver(refresh);
    observer.observe(viewport);
    observer.observe(content);
    if (content.firstElementChild) observer.observe(content.firstElementChild);
    return () => {
      active = false;
      cancelAnimationFrame(refreshFrame);
      observer.disconnect();
      content.removeEventListener("load", refresh, true);
      globalThis.removeEventListener("resize", refresh);
    };
  }, [activityId, authoredCanvas]);

  return (
    <div
      ref={viewportRef}
      className="teacher-offline-embedded-activity"
      data-embedded-activity-id={activityId}
      data-fit-mode={fit.mode}
      data-fit-scale={fit.scale.toFixed(4)}
      data-fit-policy={authoredCanvas ? "source-authored-canvas" : "standard-contain"}
      aria-label={title || "Students Book activity"}
    >
      <div
        ref={contentRef}
        className="teacher-offline-embedded-activity-content"
        style={{
          "--embedded-activity-scale": fit.scale,
          ...(authoredCanvas ? { width: authoredCanvas.width, height: authoredCanvas.height } : {}),
        }}
      >
        {children}
      </div>
      {overlay}
    </div>
  );
}
