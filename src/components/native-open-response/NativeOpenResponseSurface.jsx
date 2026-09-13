import "./nativeOpenResponseSurface.css";
import { logicalAreaStyle } from "../builder-studio/stageGeometry.js";
import { useNativeActivityFonts } from "../native-activity-assets/useNativeActivityFonts.js";
import { NativeAudioTextHotspotButtons } from "../native-readable-text/NativeAudioTextHotspots.jsx";
import { nativeOpenResponsePanelPromptIds, nativeOpenResponsePanelResponseIds, nativeOpenResponsePanels } from "../../data/native-activities/nativeOpenResponse.js";

export { logicalAreaStyle };

export function nativeOpenResponseResponseAriaLabel(question) {
  return question.prompt ? `${question.responseRegion.ariaLabel}: ${question.prompt}` : question.responseRegion.ariaLabel;
}

function ResponseLines({ question, surface, onActivate, selected }) {
  const region = question.responseRegion;
  const { presentation } = region;
  const style = logicalAreaStyle(region.area, surface);
  const content = <>{presentation.linePositions.map((position, index) => <span key={index} className="native-or-line" style={{ left: `${(presentation.paddingX / region.area.width) * 100}%`, top: `${(position / region.area.height) * 100}%`, width: `${(presentation.lineWidth / region.area.width) * 100}%` }} />)}</>;
  if (!onActivate) return <div className="native-or-response" style={style} aria-hidden="true">{content}</div>;
  return <button type="button" className={`native-or-response native-or-selectable ${selected ? "is-selected" : ""}`} style={style} aria-label={region.ariaLabel} onClick={onActivate}>{content}</button>;
}

export function NativeOpenResponseSurface({ document, panel: selectedPanel = null, assetUrl = () => "", onSelect = null, selected = null, children = null, className = "", audioHotspotPresentation = null, embeddedCanvas = false }) {
  const interaction = document.parts[0].interaction;
  const panel = selectedPanel || nativeOpenResponsePanels(interaction)[0];
  if (!panel) return <p role="status">This Open Response activity has no panels yet.</p>;
  const { surface } = panel;
  const promptIds = nativeOpenResponsePanelPromptIds(panel);
  const responseIds = nativeOpenResponsePanelResponseIds(panel);
  const prompts = interaction.questions.filter((question) => promptIds.includes(question.id));
  const responses = interaction.questions.filter((question) => responseIds.includes(question.id));
  const assets = new Map(document.assets.map((asset) => [asset.slot, asset]));
  const staticLayer = !onSelect;
  return <div className={`native-or-surface ${className}`.trim()} style={{ aspectRatio: `${surface.width} / ${surface.height}` }} data-embedded-canvas={embeddedCanvas || undefined} data-studio-stage data-native-or-presentation={staticLayer ? "runtime" : "authoring"} data-surface-width={surface.width} data-surface-height={surface.height} onClick={(event) => { if (event.button === 0 && event.target === event.currentTarget) onSelect?.(null); }}>
    {!embeddedCanvas && panel.images.map((item) => {
      const reference = assets.get(item.assetSlot);
      const authoringLocked = Boolean(onSelect && item.locked);
      const content = reference ? <img src={assetUrl(reference.assetId)} alt={item.decorative ? "" : item.altText} style={{ objectFit: item.fit }} /> : null;
      const props = { className: `native-or-artwork native-or-selectable ${staticLayer ? "native-or-static" : ""} ${selected?.type === "artwork" && selected.id === item.id ? "is-selected" : ""}`.trim(), style: { ...logicalAreaStyle(item.area, surface), zIndex: item.order + 1, pointerEvents: staticLayer || authoringLocked ? "none" : undefined }, "data-locked": authoringLocked || undefined };
      if (staticLayer) return <div key={item.id} {...props}>{content}</div>;
      return <button key={item.id} {...props} type="button" aria-label={`${item.decorative ? "Decorative artwork" : item.altText || "Artwork"}${authoringLocked ? " (locked)" : ""}`} onClick={() => onSelect({ type: "artwork", id: item.id })}>{content}</button>;
    })}
    {!embeddedCanvas && prompts.map((question) => staticLayer
      ? <div key={`prompt-${question.id}`} className="native-or-prompt native-or-selectable native-or-static" style={{ ...logicalAreaStyle(question.promptArea, surface), fontFamily: question.promptStyle.fontFamily, fontSize: `${(question.promptStyle.fontSize / surface.width) * 100}cqw`, color: question.promptStyle.color, textAlign: question.promptStyle.align, pointerEvents: "none" }}>{question.prompt || "Prompt"}</div>
      : <button key={`prompt-${question.id}`} type="button" className={`native-or-prompt native-or-selectable ${selected?.type === "prompt" && selected.id === question.id ? "is-selected" : ""}`} style={{ ...logicalAreaStyle(question.promptArea, surface), fontFamily: question.promptStyle.fontFamily, fontSize: `${(question.promptStyle.fontSize / surface.width) * 100}cqw`, color: question.promptStyle.color, textAlign: question.promptStyle.align }} onClick={() => onSelect({ type: "prompt", id: question.id })}>{question.prompt || "Prompt"}</button>)}
    {!embeddedCanvas && responses.map((question) => <ResponseLines key={`response-${question.id}`} question={question} surface={surface} selected={selected?.type === "response" && selected.id === question.id} onActivate={onSelect ? () => onSelect({ type: "response", id: question.id }) : null} />)}
    <NativeAudioTextHotspotButtons panelId={panel.legacy ? null : panel.id} surface={surface} presentation={audioHotspotPresentation} />
    {children}
  </div>;
}

export function NativeOpenResponseFontSurface(props) {
  useNativeActivityFonts(props.document, props.assetUrl || (() => ""));
  return <NativeOpenResponseSurface {...props} />;
}
