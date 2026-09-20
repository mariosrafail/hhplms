import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { NativeScrollControlsHost } from "../native-readable-text/NativeScrollControlsHost.jsx";
import { NativeAudioTextHotspotButtons } from "../native-readable-text/NativeAudioTextHotspots.jsx";
import { NativeVerticalScrollViewport } from "../native-readable-text/NativeVerticalScrollViewport.jsx";
import { logicalAreaStyle } from "../builder-studio/stageGeometry.js";
import { nativeActivitySelectedFontState, useNativeActivityFonts } from "../native-activity-assets/useNativeActivityFonts.js";
import {
  NATIVE_DRAG_DROP_DEFAULT_PRESENTATION,
  nativeDragDropTextFontFamily,
  normalizeNativeDragDropResponses,
  placeNativeDragDropWord,
  removeNativeDragDropResponse,
  shuffleNativeDragDropWordIds,
  visibleNativeDragDropWordIds,
} from "../../data/native-activities/nativeDragDrop.js";
import { NativeDragDropItemContent } from "./NativeDragDropItemContent.jsx";
import "./nativeDragDrop.css";

const DRAG_MOVEMENT_THRESHOLD = 5;
const DRAG_RETURN_MS = 160;
const FITTED_CONTENT_MIN_FONT_PX = 8;
const FITTED_CONTENT_TOLERANCE_PX = 1;

function PanelArtwork({ document, panel, assetUrl, textMode, children, embeddedCanvas = null }) {
  const assets = new Map(document.assets.map((asset) => [asset.slot, asset]));
  return <div className="native-drag-drop-stage-slot" style={textMode ? { aspectRatio: `${panel.surface.width} / ${panel.surface.height}` } : undefined}><div className="native-drag-drop-stage" style={!textMode && !embeddedCanvas ? { aspectRatio: `${panel.surface.width} / ${panel.surface.height}` } : undefined} data-surface-width={panel.surface.width} data-surface-height={panel.surface.height}>
    {(embeddedCanvas ? [] : panel.images).map((image) => {
      const reference = assets.get(image.assetSlot);
      return <div key={image.id} className="native-drag-drop-artwork" style={{ ...logicalAreaStyle(image.area, panel.surface), zIndex: image.order + 1 }}>
        {reference ? <img src={assetUrl(reference.assetId)} alt={image.decorative ? "" : image.altText} style={{ objectFit: image.fit }} /> : null}
      </div>;
    })}
    {children}
  </div></div>;
}

function PanelNavigation({ panels, panelIndex, setPanelIndex }) {
  if (panels.length < 2) return null;
  return <nav className="native-drag-drop-panel-navigation" aria-label="Activity panels">
    <button type="button" disabled={panelIndex === 0} onClick={() => setPanelIndex((current) => Math.max(0, current - 1))}>Previous</button>
    <span>Panel {panelIndex + 1} of {panels.length}</span>
    <button type="button" disabled={panelIndex === panels.length - 1} onClick={() => setPanelIndex((current) => Math.min(panels.length - 1, current + 1))}>Next</button>
  </nav>;
}

function closestDropTarget(clientX, clientY, owner) {
  const target = globalThis.document?.elementFromPoint?.(clientX, clientY)?.closest?.("[data-drag-drop-target-id]");
  return target && owner?.contains(target) ? target.dataset.dragDropTargetId : null;
}

function previewComputedStyle(element) {
  const style = globalThis.getComputedStyle?.(element);
  if (!style) return {};
  return {
    appearance: style.appearance, display: style.display, alignItems: style.alignItems, justifyContent: style.justifyContent,
    boxSizing: style.boxSizing, verticalAlign: style.verticalAlign,
    fontFamily: style.fontFamily, fontSize: style.fontSize, fontStyle: style.fontStyle, fontStretch: style.fontStretch,
    fontVariant: style.fontVariant, fontWeight: style.fontWeight, lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing, wordSpacing: style.wordSpacing, textTransform: style.textTransform,
    textDecoration: style.textDecoration, textIndent: style.textIndent, textRendering: style.textRendering,
    whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap, wordBreak: style.wordBreak,
    paddingTop: style.paddingTop, paddingRight: style.paddingRight, paddingBottom: style.paddingBottom, paddingLeft: style.paddingLeft,
    borderTopWidth: style.borderTopWidth, borderTopStyle: style.borderTopStyle, borderTopColor: style.borderTopColor,
    borderRightWidth: style.borderRightWidth, borderRightStyle: style.borderRightStyle, borderRightColor: style.borderRightColor,
    borderBottomWidth: style.borderBottomWidth, borderBottomStyle: style.borderBottomStyle, borderBottomColor: style.borderBottomColor,
    borderLeftWidth: style.borderLeftWidth, borderLeftStyle: style.borderLeftStyle, borderLeftColor: style.borderLeftColor,
    borderTopLeftRadius: style.borderTopLeftRadius, borderTopRightRadius: style.borderTopRightRadius,
    borderBottomRightRadius: style.borderBottomRightRadius, borderBottomLeftRadius: style.borderBottomLeftRadius,
    background: style.background, color: style.color, textAlign: style.textAlign,
  };
}

const responseIds = (value) => Array.isArray(value) ? value : value ? [value] : [];

function containedContentMeasurement(element, { containChildren = false, tolerance = FITTED_CONTENT_TOLERANCE_PX } = {}) {
  const bounds = element.getBoundingClientRect();
  const scrollFits = element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight;
  const childrenContained = !containChildren || [...element.children].every((child) => {
    const box = child.getBoundingClientRect();
    return box.left >= bounds.left - tolerance && box.right <= bounds.right + tolerance && box.top >= bounds.top - tolerance && box.bottom <= bounds.bottom + tolerance;
  });
  return { fits: scrollFits && childrenContained, scrollFits, childrenContained };
}

function fitContainedContent(element, { property, sampleSelector = null, containChildren = false }) {
  if (!element || element.clientWidth < 1 || element.clientHeight < 1) return;
  element.style.setProperty(property, "1");
  const sample = sampleSelector ? element.querySelector(sampleSelector) : element;
  const baseFontSize = Number.parseFloat(globalThis.getComputedStyle?.(sample || element)?.fontSize || "0");
  const minimumScale = baseFontSize > FITTED_CONTENT_MIN_FONT_PX ? FITTED_CONTENT_MIN_FONT_PX / baseFontSize : 1;
  const fits = () => containedContentMeasurement(element, { containChildren }).fits;
  let scale = 1;
  if (!fits()) {
    scale = minimumScale;
    element.style.setProperty(property, String(scale));
    if (fits()) {
      let lower = minimumScale;
      let upper = 1;
      for (let iteration = 0; iteration < 8; iteration += 1) {
        const candidate = (lower + upper) / 2;
        element.style.setProperty(property, String(candidate));
        if (fits()) lower = candidate;
        else upper = candidate;
      }
      scale = lower;
    }
  }
  const committedScale = Math.max(minimumScale, Math.floor(scale * 10_000) / 10_000);
  element.style.setProperty(property, String(committedScale));
  element.dataset.fitScale = committedScale.toFixed(4);
  element.dataset.fitStatus = fits() ? "fit" : "overflow";
}

function useContainedContentFit(ref, { enabled, property, sampleSelector = null, containChildren = false, dependency }) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return undefined;
    let frame = null;
    const fit = () => {
      if (frame !== null) globalThis.cancelAnimationFrame?.(frame);
      element.dataset.fitStatus = "pending";
      frame = globalThis.requestAnimationFrame?.(() => { frame = null; fitContainedContent(element, { property, sampleSelector, containChildren }); }) ?? null;
      if (frame === null) fitContainedContent(element, { property, sampleSelector, containChildren });
    };
    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    if (element.parentElement) observer?.observe(element.parentElement);
    globalThis.document?.fonts?.ready?.then(fit);
    globalThis.document?.fonts?.addEventListener?.("loadingdone", fit);
    globalThis.addEventListener?.("resize", fit);
    return () => {
      if (frame !== null) globalThis.cancelAnimationFrame?.(frame);
      observer?.disconnect();
      globalThis.document?.fonts?.removeEventListener?.("loadingdone", fit);
      globalThis.removeEventListener?.("resize", fit);
    };
  }, [containChildren, dependency, enabled, property, ref, sampleSelector]);
}

function TargetItems({ children, textMode, fontState, style, dependency }) {
  const ref = useRef(null);
  useContainedContentFit(ref, { enabled: textMode, property: "--native-drag-drop-target-fit-scale", containChildren: true, dependency });
  return <span ref={ref} className="native-drag-drop-target-items" data-font-status={fontState.status} style={style}>{children}</span>;
}

function useAdaptiveBankLayout(ref, { textMode, embeddedCanvas, complete, dependency }) {
  useLayoutEffect(() => {
    const items = ref.current;
    const bank = items?.parentElement;
    const root = bank?.closest(".native-drag-drop");
    if (!root) return undefined;
    let active = true;
    let frame = null;
    const measure = () => {
      if (!active || !root.clientWidth || !root.clientHeight) return;
      bank.dataset.empty = String(!items.children.length);
      bank.style.removeProperty("padding-right");
      const player = root.closest("[data-native-media-scope]")?.querySelector(":scope > .native-supplemental-audio-anchor");
      const playerBounds = player?.getBoundingClientRect();
      const bankBounds = bank.getBoundingClientRect();
      if (items.children.length && playerBounds?.width && bankBounds.width) {
        const reserve = (bankBounds.right - playerBounds.left) * bank.offsetWidth / bankBounds.width + 8;
        if (reserve > 0 && reserve < bank.offsetWidth) bank.style.paddingRight = `${reserve}px`;
      }
      const stage = bank.closest(".native-drag-drop-stage");
      const configured = embeddedCanvas
        ? root.clientHeight * embeddedCanvas.bankRegion.height / Number(root.dataset.sourceHeight)
        : parseFloat(getComputedStyle(root).getPropertyValue("--native-drag-drop-bank-height")) || (textMode ? 180 : stage.clientHeight * .2);
      // Measure in the authored budget, independently of the last runtime height.
      // Temporary styles are removed in the same frame; no runtime value is saved.
      bank.style.height = `${configured}px`;
      const css = getComputedStyle(bank);
      const inset = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) + parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
      items.style.height = `${Math.max(1, configured - inset)}px`;
      if (textMode && !root.hasAttribute("data-image-items")) fitContainedContent(items, { property: "--native-drag-drop-bank-fit-scale", sampleSelector: ".native-drag-drop-word", containChildren: true });
      else items.style.removeProperty("--native-drag-drop-bank-fit-scale");
      // Preserve subpixel row extents before shrinking the fitted bank. Integer
      // offsets can lose enough height to reintroduce a scrollbar after fitting.
      const bankScale = bank.getBoundingClientRect().height / configured;
      const itemsTop = items.getBoundingClientRect().top;
      const contentHeight = [...items.children].reduce((height, child) => Math.max(height, (child.getBoundingClientRect().bottom - itemsTop) / bankScale), 0);
      const height = complete && items.children.length ? configured : Math.min(configured, Math.max(24, Math.ceil(contentHeight + inset)));
      const value = complete && items.children.length && !embeddedCanvas ? "" : `${height}px`;
      if (!value) root.style.removeProperty("--native-drag-drop-runtime-bank-height");
      else if (root.style.getPropertyValue("--native-drag-drop-runtime-bank-height") !== value) root.style.setProperty("--native-drag-drop-runtime-bank-height", value);
      bank.style.removeProperty("height");
      items.style.removeProperty("height");
    };
    const schedule = () => {
      if (!active) return;
      cancelAnimationFrame(frame); frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(root);
    if (!textMode && bank.closest(".native-drag-drop-stage")) observer?.observe(bank.closest(".native-drag-drop-stage"));
    bank.addEventListener("load", schedule, true);
    globalThis.document.fonts?.ready.then(schedule);
    globalThis.document.fonts?.addEventListener("loadingdone", schedule);
    globalThis.addEventListener("resize", schedule);
    return () => {
      active = false; cancelAnimationFrame(frame); observer?.disconnect();
      bank.removeEventListener("load", schedule, true);
      globalThis.document.fonts?.removeEventListener("loadingdone", schedule);
      globalThis.removeEventListener("resize", schedule);
      root.style.removeProperty("--native-drag-drop-runtime-bank-height");
      bank.style.removeProperty("padding-right");
      items.style.removeProperty("--native-drag-drop-bank-fit-scale");
    };
  }, [dependency, textMode, complete, embeddedCanvas?.bankRegion?.height, ref]);
}

export function NativeDragDropStudentSurface({
  document, assetUrl = () => "", responses: controlled = null, initialResponses = null, onResponsesChange = null,
  readOnly = false, evaluatePlacement = null, resolveWordForTarget = null, resolveWordsForTarget = null,
  targetWordOverrides = null, onEmptyTargetActivate = null, panelIndex: controlledPanelIndex = null,
  onPanelIndexChange = null, presentation = null, resetToken = null, presentationMode = false, embeddedCanvas = null, audioHotspotPresentation = null,
}) {
  const interaction = document.parts[0].interaction;
  const textMode = interaction.layoutMode === "text";
  const [local, setLocal] = useState(() => normalizeNativeDragDropResponses(initialResponses, document));
  const [localPanelIndex, setLocalPanelIndex] = useState(0);
  const [selectedWordId, setSelectedWordId] = useState(null);
  const [incorrectTargetId, setIncorrectTargetId] = useState(null);
  const [dragOverTargetId, setDragOverTargetId] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const [sessionWordIds, setSessionWordIds] = useState(() => shuffleNativeDragDropWordIds(interaction.words));
  const [dragPreview, setDragPreview] = useState(null);
  const dragRef = useRef(null);
  const bankItemsRef = useRef(null);
  const ownerRef = useRef(null);
  const hasImageItems = interaction.words.some((word) => word.image);
  const returnTimer = useRef(null);
  const suppressClickWordId = useRef(null);
  const lastResetToken = useRef(resetToken);
  const orderActivityId = useRef(document.activityId);
  const responses = useMemo(() => normalizeNativeDragDropResponses(controlled && typeof controlled === "object" ? controlled : local, document), [controlled, document, local]);
  const fontState = useNativeActivityFonts(document, assetUrl);
  const panelIndex = controlledPanelIndex ?? localPanelIndex;
  const panel = interaction.panels[panelIndex] || interaction.panels[0];
  const textPresentation = interaction.presentation || NATIVE_DRAG_DROP_DEFAULT_PRESENTATION;
  const bankWordStyle = textPresentation.bankWordStyle;
  const placedAnswerStyle = textPresentation.placedAnswerStyle;
  const bankFont = nativeDragDropTextFontFamily(document, bankWordStyle);
  const placedFont = nativeDragDropTextFontFamily(document, placedAnswerStyle);
  const bankFontState = nativeActivitySelectedFontState(fontState, document, bankWordStyle.fontAssetSlot);
  const placedFontState = nativeActivitySelectedFontState(fontState, document, placedAnswerStyle.fontAssetSlot);
  const wordById = new Map(interaction.words.map((word) => [word.id, word]));
  const visibilityWords = interaction.words;
  const visibleWordIds = visibleNativeDragDropWordIds(interaction.randomize === false ? interaction.words.map((word) => word.id) : sessionWordIds, responses, targetWordOverrides, visibilityWords);
  const visibleWords = visibleWordIds.map((wordId) => wordById.get(wordId)).filter(Boolean);
  useAdaptiveBankLayout(bankItemsRef, {
    textMode, embeddedCanvas, complete: visibleWords.length === interaction.words.length,
    dependency: `${document.activityId}|${panel?.surface.width}|${panel?.surface.height}|${panelIndex}|${hasImageItems}|${visibleWords.map((word) => `${word.id}\0${word.shortLabel}\0${word.text}\0${JSON.stringify(word.image || null)}`).join("\u0001")}|${bankFontState.status}|${bankFont}|${bankWordStyle.fontSize}|${JSON.stringify(embeddedCanvas?.bankRegion || null)}|${interaction.answerBankHeightPx || "default"}|${Boolean(document.supplementalAudio)}`,
  });
  const clearFeedback = () => setIncorrectTargetId(null);
  const clearReturnTimer = () => { if (returnTimer.current) globalThis.clearTimeout(returnTimer.current); returnTimer.current = null; };
  const clearDrag = () => { clearReturnTimer(); dragRef.current = null; setDragPreview(null); setDragOverTargetId(null); };

  const setPanelIndex = (value) => {
    const next = typeof value === "function" ? value(panelIndex) : value;
    if (controlledPanelIndex === null) setLocalPanelIndex(next);
    onPanelIndexChange?.(next); setSelectedWordId(null); clearDrag(); clearFeedback();
  };
  const commit = (next) => { if (!readOnly) { if (controlled === null) setLocal(next); onResponsesChange?.(next); } };
  const place = (targetId, wordId = selectedWordId) => {
    const word = wordById.get(wordId);
    const target = panel?.dropTargets.find((entry) => entry.id === targetId);
    if (!word || !target || readOnly) return false;
    const current = responseIds(responses[targetId]);
    if (current.includes(wordId)) { setAnnouncement(`${textMode && !word.image ? word.shortLabel : word.text} is already in ${target.accessibleLabel}.`); return false; }
    if (current.length >= target.capacity) { setAnnouncement(`${target.accessibleLabel} is full.`); return false; }
    const nextIds = [...current, wordId];
    if (evaluatePlacement && !evaluatePlacement(targetId, wordId, nextIds)) {
      setIncorrectTargetId(targetId); setAnnouncement(`${textMode && !word.image ? word.shortLabel : word.text} does not belong in ${target.accessibleLabel}.`);
      if (!word.reusable) setSelectedWordId(null);
      return false;
    }
    commit(placeNativeDragDropWord(responses, targetId, wordId, { capacity: target.capacity, reusable: word.reusable }));
    if (!word.reusable) setSelectedWordId(null);
    clearFeedback(); setAnnouncement(`${textMode && !word.image ? word.shortLabel : word.text} placed in ${target.accessibleLabel}.`);
    return true;
  };
  const remove = (target, word) => {
    commit(removeNativeDragDropResponse(responses, target.id, word.id)); clearFeedback();
    setAnnouncement(`${textMode && !word.image ? word.shortLabel : word.text} removed from ${target.accessibleLabel}.`);
  };
  const returnDragPreview = (active) => {
    const next = { ...active, clientX: active.sourceRect.left + active.offsetX, clientY: active.sourceRect.top + active.offsetY, returning: true };
    setDragPreview(next); clearReturnTimer();
    returnTimer.current = globalThis.setTimeout(() => { returnTimer.current = null; setDragPreview(null); }, DRAG_RETURN_MS);
  };
  const beginDrag = (event, wordId, sourceTarget = null) => {
    if (readOnly || event.button !== 0 || (sourceTarget ? !responseIds(responses[sourceTarget.id]).includes(wordId) : !visibleWordIds.includes(wordId))) return;
    event.stopPropagation(); suppressClickWordId.current = null;
    const source = textMode ? event.currentTarget.querySelector("[data-drag-drop-drag-handle]") || event.currentTarget : event.currentTarget;
    const sourceRect = source.getBoundingClientRect();
    const computed = globalThis.getComputedStyle(source);
    const extraWidth = computed.boxSizing === "border-box" ? 0 : parseFloat(computed.paddingLeft) + parseFloat(computed.paddingRight) + parseFloat(computed.borderLeftWidth) + parseFloat(computed.borderRightWidth);
    const extraHeight = computed.boxSizing === "border-box" ? 0 : parseFloat(computed.paddingTop) + parseFloat(computed.paddingBottom) + parseFloat(computed.borderTopWidth) + parseFloat(computed.borderBottomWidth);
    const logicalWidth = parseFloat(computed.width) + extraWidth || source.offsetWidth;
    const logicalHeight = parseFloat(computed.height) + extraHeight || source.offsetHeight;
    const active = {
      pointerId: event.pointerId, pointerType: event.pointerType, wordId, sourceTarget,
      startX: event.clientX, startY: event.clientY, clientX: event.clientX, clientY: event.clientY,
      offsetX: Math.min(sourceRect.width, Math.max(0, event.clientX - sourceRect.left)),
      offsetY: Math.min(sourceRect.height, Math.max(0, event.clientY - sourceRect.top)),
      sourceRect: { left: sourceRect.left, top: sourceRect.top, width: sourceRect.width, height: sourceRect.height },
      logicalWidth, logicalHeight, scaleX: sourceRect.width / logicalWidth, scaleY: sourceRect.height / logicalHeight,
      previewStyle: previewComputedStyle(source), moved: false, returning: false,
    };
    clearReturnTimer(); event.currentTarget.setPointerCapture?.(event.pointerId); dragRef.current = active; clearFeedback();
  };
  const moveDrag = (event) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const moved = active.moved || Math.hypot(event.clientX - active.startX, event.clientY - active.startY) >= DRAG_MOVEMENT_THRESHOLD;
    const next = { ...active, clientX: event.clientX, clientY: event.clientY, moved };
    dragRef.current = next;
    if (!moved) return;
    event.preventDefault(); setDragPreview(next);
    const targetId = closestDropTarget(event.clientX, event.clientY, ownerRef.current);
    setDragOverTargetId(panel?.dropTargets.some((target) => target.id === targetId) ? targetId : null);
  };
  const finishDrag = (event, cancelled = false) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    dragRef.current = null; setDragOverTargetId(null);
    if (cancelled || !active.moved) { if (cancelled && active.moved) suppressClickWordId.current = active.wordId; setDragPreview(null); return; }
    suppressClickWordId.current = active.wordId;
    // Suppress only the click synthesized by this pointer-up, never a later
    // deliberate click/keyboard selection when capture did not emit a click.
    globalThis.setTimeout(() => { if (suppressClickWordId.current === active.wordId) suppressClickWordId.current = null; }, 0);
    const targetId = closestDropTarget(event.clientX, event.clientY, ownerRef.current);
    const validTarget = panel?.dropTargets.some((target) => target.id === targetId) ? targetId : null;
    const droppedInBank = bankItemsRef.current?.parentElement.contains(globalThis.document.elementFromPoint(event.clientX, event.clientY));
    if (active.sourceTarget && droppedInBank) { remove(active.sourceTarget, wordById.get(active.wordId)); setDragPreview(null); }
    else if (!active.sourceTarget && validTarget && place(validTarget, active.wordId)) setDragPreview(null);
    else returnDragPreview({ ...active, clientX: event.clientX, clientY: event.clientY });
  };

  useEffect(() => {
    const currentIds = interaction.words.map((word) => word.id);
    setSessionWordIds((current) => {
      if (orderActivityId.current !== document.activityId) { orderActivityId.current = document.activityId; return shuffleNativeDragDropWordIds(interaction.words); }
      const available = new Set(currentIds); const retained = current.filter((wordId) => available.has(wordId)); const retainedSet = new Set(retained);
      return [...retained, ...currentIds.filter((wordId) => !retainedSet.has(wordId))];
    });
  }, [document.activityId, interaction.words.map((word) => word.id).join("\0")]);
  useEffect(() => { audioHotspotPresentation?.onPanelChange(panel?.id || null); }, [audioHotspotPresentation, panel?.id]);
  useEffect(() => { if (selectedWordId && !visibleWordIds.includes(selectedWordId)) setSelectedWordId(null); }, [selectedWordId, visibleWordIds.join("\0")]);
  useEffect(() => () => { clearReturnTimer(); dragRef.current = null; }, []);
  useEffect(() => { if (readOnly) { setSelectedWordId(null); clearDrag(); } }, [readOnly]);
  useEffect(() => {
    if (lastResetToken.current === resetToken) return;
    lastResetToken.current = resetToken;
    if (controlled === null) setLocal({});
    onResponsesChange?.({}); setSelectedWordId(null); clearDrag(); clearFeedback(); setAnnouncement("Activity reset. All items returned to the bank.");
  }, [controlled, onResponsesChange, resetToken]);

  if (!panel) return <p role="status">This Drag &amp; Drop activity has no panels yet.</p>;
  const previewWord = dragPreview ? wordById.get(dragPreview.wordId) : null;
  const bank = <div className="native-drag-drop-bank" aria-label={textMode ? "Phrase bank" : "Word bank"} data-font-status={bankFontState.status} style={{ zIndex: panel.images.length + 4, ...(embeddedCanvas?.bankRegion ? { ...logicalAreaStyle(embeddedCanvas.bankRegion, panel.surface), top: "auto", bottom: `${(panel.surface.height - embeddedCanvas.bankRegion.y - embeddedCanvas.bankRegion.height) / panel.surface.height * 100}%`, height: `min(var(--native-drag-drop-runtime-bank-height, 100%), ${embeddedCanvas.bankRegion.height / panel.surface.height * 100}%)` } : {}) }}>
    <div ref={bankItemsRef} className="native-drag-drop-bank-items">
      {visibleWords.map((word) => <button key={word.id} type="button" className={`native-drag-drop-word${textMode ? " native-drag-drop-phrase" : ""}`} style={{ fontFamily: bankFont, fontSize: textMode ? `calc(${(bankWordStyle.fontSize / panel.surface.width) * 100}cqw * var(--native-drag-drop-bank-fit-scale, 1))` : `${(bankWordStyle.fontSize / panel.surface.width) * 100}cqw`, color: bankWordStyle.color }} aria-label={textMode && !word.image ? `${word.shortLabel}, ${word.text}` : word.text} aria-pressed={selectedWordId === word.id} data-image-item={word.image ? "true" : undefined} data-drag-drop-word-id={word.id} data-dragging={dragPreview?.wordId === word.id && !dragPreview.returning || undefined} disabled={readOnly} onClick={(event) => { if (event.detail !== 0 && suppressClickWordId.current === word.id) { suppressClickWordId.current = null; return; } clearFeedback(); const next = selectedWordId === word.id ? null : word.id; setSelectedWordId(next); setAnnouncement(next ? `${textMode ? `${word.shortLabel}, ` : ""}${word.text} selected. Choose a target.` : "Selection cleared."); }} onPointerDown={(event) => beginDrag(event, word.id)} onPointerMove={moveDrag} onPointerUp={(event) => finishDrag(event)} onPointerCancel={(event) => finishDrag(event, true)} onLostPointerCapture={(event) => finishDrag(event, true)}>{word.image ? <NativeDragDropItemContent word={word} document={document} assetUrl={assetUrl} /> : textMode ? <><span className="native-drag-drop-short-label" data-drag-drop-drag-handle>{word.shortLabel}</span><span>{word.text}</span></> : word.text}</button>)}
    </div>
    <span className="native-drag-drop-status" role="status" aria-live="polite">{announcement || (selectedWordId ? `${textMode ? `${wordById.get(selectedWordId)?.shortLabel}, ${wordById.get(selectedWordId)?.text}` : wordById.get(selectedWordId)?.text || "Item"} selected. Choose a target.` : "")}</span>
  </div>;
  const targets = panel.dropTargets.map((target) => {
    const placedWords = responseIds(responses[target.id]).map((id) => wordById.get(id)).filter(Boolean);
    const overrideValue = targetWordOverrides?.get(target.id);
    const overrideWords = (Array.isArray(overrideValue) ? overrideValue : overrideValue ? [overrideValue] : []).filter(Boolean);
    const visibleWordsAtTarget = overrideWords.length ? overrideWords : placedWords;
    const full = placedWords.length >= target.capacity;
    const contents = visibleWordsAtTarget.length ? visibleWordsAtTarget.map((word) => textMode && !word.image ? word.shortLabel : word.text).join(", ") : "empty";
    const activate = () => {
      if (readOnly) return;
      if (selectedWordId) place(target.id);
      else if (placedWords.length === 1 && target.capacity === 1) remove(target, placedWords[0]);
      else if (placedWords.length < target.capacity) {
        const legacyId = resolveWordForTarget?.(target.id);
        const correctIds = resolveWordsForTarget?.(target.id) || (legacyId ? [legacyId] : []);
        const nextWordId = correctIds.find((id) => !placedWords.some((word) => word.id === id));
        if (nextWordId) place(target.id, nextWordId);
        else if (!placedWords.length && onEmptyTargetActivate) { onEmptyTargetActivate(target.id); clearFeedback(); }
      }
    };
    return <div key={target.id} role="button" tabIndex={readOnly ? -1 : 0} className={`native-drag-drop-target${presentationMode ? " native-drag-drop-teacher-target" : ""}`} style={{ ...logicalAreaStyle(target.area, panel.surface), zIndex: panel.images.length + 2 }} data-drag-drop-target-id={target.id} data-occupied={Boolean(placedWords.length) || undefined} data-full={full || undefined} data-revealed={Boolean(overrideWords.length) || undefined} data-incorrect={incorrectTargetId === target.id || undefined} data-drag-over={dragOverTargetId === target.id || undefined} aria-disabled={readOnly || undefined} aria-label={`${target.accessibleLabel}, contains ${contents}, ${placedWords.length} of ${target.capacity} places used`} onClick={activate} onKeyDown={(event) => {
      if ((event.key === "Enter" || event.key === " ") && !readOnly) { event.preventDefault(); activate(); }
      if ((event.key === "Delete" || event.key === "Backspace") && placedWords.length && !readOnly) { event.preventDefault(); remove(target, placedWords[placedWords.length - 1]); }
    }}><TargetItems textMode={!visibleWordsAtTarget.some((word) => word.image)} fontState={placedFontState} dependency={`${target.id}|${visibleWordsAtTarget.map((word) => word.id).join("\0")}|${placedFontState.status}|${placedAnswerStyle.fontSize}`} style={{ fontFamily: placedFont, fontSize: `calc(${(placedAnswerStyle.fontSize / panel.surface.width) * 100}cqw * var(--native-drag-drop-target-fit-scale, 1))`, color: placedAnswerStyle.color }}>{visibleWordsAtTarget.map((word) => overrideWords.length || readOnly ? <span key={word.id} className="native-drag-drop-target-text" data-image-item={word.image ? "true" : undefined} data-drag-drop-target-text aria-label={textMode && !word.image ? `${word.shortLabel}, ${word.text}` : word.text}><NativeDragDropItemContent word={word} document={document} assetUrl={assetUrl} shortLabel={textMode} /></span> : <button key={word.id} type="button" className="native-drag-drop-target-text" data-image-item={word.image ? "true" : undefined} data-drag-drop-target-text aria-label={`Remove ${textMode && !word.image ? `${word.shortLabel}, ${word.text}` : word.text} from ${target.accessibleLabel}`} onPointerDown={(event) => beginDrag(event, word.id, target)} onPointerMove={moveDrag} onPointerUp={(event) => finishDrag(event)} onPointerCancel={(event) => finishDrag(event, true)} onLostPointerCapture={(event) => finishDrag(event, true)} onClick={(event) => { event.stopPropagation(); if (event.detail && suppressClickWordId.current === word.id) { suppressClickWordId.current = null; return; } remove(target, word); }} onKeyDown={(event) => { if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); event.stopPropagation(); remove(target, word); } }}><NativeDragDropItemContent word={word} document={document} assetUrl={assetUrl} shortLabel={textMode} /></button>)}</TargetItems></div>;
  });
  const hotspotButtons = <NativeAudioTextHotspotButtons panelId={panel.id} surface={panel.surface} presentation={audioHotspotPresentation} />;
  const rootStyle = {
    ...(!textMode && !embeddedCanvas ? { aspectRatio: `${panel.surface.width} / ${panel.surface.height}` } : {}),
    ...(interaction.answerBankHeightPx ? { "--native-drag-drop-bank-height": `${interaction.answerBankHeightPx}px` } : {}),
    ...(interaction.textPanelHeightPx ? { "--native-drag-drop-text-panel-height": `${interaction.textPanelHeightPx}px` } : {}),
  };
  const preview = previewWord && dragPreview ? <span className={`${textMode && !previewWord.image ? "native-drag-drop-short-label" : "native-drag-drop-word"} native-drag-drop-drag-preview`} data-image-item={previewWord.image ? "true" : undefined} data-drag-drop-drag-preview data-returning={dragPreview.returning || undefined} aria-label={textMode ? `${previewWord.shortLabel}, ${previewWord.text}` : previewWord.text} style={{ left: dragPreview.clientX - dragPreview.offsetX, top: dragPreview.clientY - dragPreview.offsetY, width: dragPreview.logicalWidth, height: dragPreview.logicalHeight, minWidth: dragPreview.logicalWidth, maxWidth: "none", minHeight: dragPreview.logicalHeight, maxHeight: "none", ...dragPreview.previewStyle, boxSizing: "border-box", transformOrigin: "top left", transform: `scale(${dragPreview.scaleX}, ${dragPreview.scaleY})` }}><NativeDragDropItemContent word={previewWord} document={document} assetUrl={assetUrl} shortLabel={textMode} /></span> : null;
  return <NativeScrollControlsHost as="section" enabled={textMode} className={`native-drag-drop ${presentationMode ? "native-drag-drop-teacher" : "native-drag-drop-student"}`} aria-label={document.metadata.title} data-source-height={panel.surface.height} data-embedded-canvas={Boolean(embeddedCanvas) || undefined} data-layout-mode={textMode ? "text" : "standard"} data-image-items={hasImageItems || undefined} data-configured-bank-height={interaction.answerBankHeightPx ? "true" : undefined} data-read-only={readOnly || undefined} style={rootStyle}>
    <div ref={ownerRef} className="native-drag-drop-visual-region">
      {textMode ? <NativeVerticalScrollViewport id={`${document.activityId}-text-drag-scroll`} className="native-drag-drop-workspace" ariaLabel="Text Drag & Drop vertical scroll" resetKey={`${document.activityId}:${panel.id}`}><PanelArtwork embeddedCanvas={embeddedCanvas} document={document} panel={panel} assetUrl={assetUrl} textMode>{targets}{hotspotButtons}</PanelArtwork></NativeVerticalScrollViewport> : <div className="native-drag-drop-workspace"><PanelArtwork embeddedCanvas={embeddedCanvas} document={document} panel={panel} assetUrl={assetUrl} textMode={false}>{targets}{bank}{hotspotButtons}</PanelArtwork></div>}
      {textMode ? bank : null}
      {!presentation ? <PanelNavigation panels={interaction.panels} panelIndex={panelIndex} setPanelIndex={setPanelIndex} /> : null}
    </div>
    {preview && globalThis.document?.body ? createPortal(preview, globalThis.document.body) : preview}
  </NativeScrollControlsHost>;
}
