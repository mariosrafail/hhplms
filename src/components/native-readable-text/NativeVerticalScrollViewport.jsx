import { useCallback, useContext, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";

import { createPortal } from "react-dom";
import { NativeScrollControlsContext } from "./NativeScrollControlsHost.jsx";

export function NativeVerticalScrollViewport({ id, className, style, ariaLabel, resetKey, children, apiRef = null, onViewportReady = null, onManualScrollStateChange = null }) {
  const controlsHost = useContext(NativeScrollControlsContext);
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const dragRef = useRef(null);
  const measureFrame = useRef(null);
  const [state, setState] = useState({ overflowing: false, top: 0, maximum: 0, viewport: 0, content: 0 });

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setState({
      overflowing: viewport.scrollHeight > viewport.clientHeight + 2,
      top: viewport.scrollTop,
      maximum: Math.max(0, viewport.scrollHeight - viewport.clientHeight),
      viewport: viewport.clientHeight,
      content: viewport.scrollHeight,
    });
  }, []);

  const scrollTo = useCallback((request) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const options = typeof request === "number" ? { top: request } : request || {};
    const top = Math.min(Math.max(0, Number(options.top) || 0), Math.max(0, viewport.scrollHeight - viewport.clientHeight));
    viewport.scrollTo({ top, behavior: options.behavior || "auto" });
    cancelAnimationFrame(measureFrame.current);
    measureFrame.current = requestAnimationFrame(measure);
  }, [measure]);

  useImperativeHandle(apiRef, () => ({ get viewport() { return viewportRef.current; }, scrollTo, remeasure: measure }), [measure, scrollTo]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    measure();
    viewport.addEventListener("scroll", measure, { passive: true });
    globalThis.addEventListener("resize", measure);
    if (typeof ResizeObserver === "undefined") return () => { viewport.removeEventListener("scroll", measure); globalThis.removeEventListener("resize", measure); };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    return () => { observer.disconnect(); viewport.removeEventListener("scroll", measure); globalThis.removeEventListener("resize", measure); };
  }, [measure]);

  useLayoutEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    measure();
  }, [measure, resetKey]);
  useLayoutEffect(() => { onViewportReady?.({ viewport: viewportRef.current, scrollTo, remeasure: measure }); }, [measure, onViewportReady, scrollTo]);
  useLayoutEffect(() => () => cancelAnimationFrame(measureFrame.current), []);

  const manualStep = () => { onManualScrollStateChange?.(true); onManualScrollStateChange?.(false); };

  const keyDown = (event) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const increments = { ArrowUp: -40, ArrowDown: 40, PageUp: -viewport.clientHeight * 0.85, PageDown: viewport.clientHeight * 0.85 };
    if (["Home", "End", ...Object.keys(increments)].includes(event.key)) manualStep();
    if (event.key === "Home") { event.preventDefault(); scrollTo(0); }
    else if (event.key === "End") { event.preventDefault(); scrollTo(state.maximum); }
    else if (Object.hasOwn(increments, event.key)) { event.preventDefault(); scrollTo(viewport.scrollTop + increments[event.key]); }
  };
  const scrollFromTrackPoint = (clientY, grabRatio = 0.5) => {
    const track = trackRef.current;
    if (!track || !state.maximum) return;
    const rect = track.getBoundingClientRect();
    const thumbRatio = Math.min(1, Math.max(0.34, state.viewport / Math.max(1, state.content)));
    const thumbPixels = Math.max(24, rect.height * thumbRatio);
    scrollTo(((clientY - rect.top - thumbPixels * grabRatio) / Math.max(1, rect.height - thumbPixels)) * state.maximum);
  };
  const beginDrag = (event) => {
    event.preventDefault(); event.stopPropagation();
    const thumb = event.currentTarget.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, grabRatio: Math.min(1, Math.max(0, (event.clientY - thumb.top) / Math.max(1, thumb.height))) };
    onManualScrollStateChange?.(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveDrag = (event) => { if (dragRef.current?.pointerId === event.pointerId) scrollFromTrackPoint(event.clientY, dragRef.current.grabRatio); };
  const endDrag = (event) => { if (dragRef.current?.pointerId === event.pointerId) { dragRef.current = null; onManualScrollStateChange?.(false); } };

  const renderControl = (control) => controlsHost ? createPortal(control, controlsHost) : control;
  return <>
    <div id={id} ref={viewportRef} style={style} className={className} tabIndex={0} data-overflowing={state.overflowing || undefined} onLoadCapture={measure} onWheel={manualStep} onKeyDown={keyDown} onTouchStart={() => onManualScrollStateChange?.(true)} onTouchEnd={() => onManualScrollStateChange?.(false)} onTouchCancel={() => onManualScrollStateChange?.(false)}>{children}</div>
    {state.overflowing ? renderControl(<div ref={trackRef} className="native-readable-text-scroll-control" role="scrollbar" aria-label={ariaLabel} aria-controls={id} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={Math.round(state.maximum)} aria-valuenow={Math.round(state.top)} tabIndex={0} onKeyDown={keyDown} onPointerDown={(event) => { if (event.target === event.currentTarget) { manualStep(); scrollFromTrackPoint(event.clientY); } }}><span className="native-readable-text-scroll-thumb" style={{ "--scroll-thumb-size": `${Math.max(0.34, state.viewport / Math.max(1, state.content)) * 100}%`, "--scroll-progress": `${state.maximum ? state.top / state.maximum : 0}` }} onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} /></div>) : null}
  </>;
}
