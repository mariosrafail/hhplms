import { useEffect, useRef } from "react";

import audioHotspotActive from "../../assets/native-activities/audio-text-hotspot-active.svg";
import audioHotspotPressed from "../../assets/native-activities/audio-text-hotspot-pressed.svg";
import readableHotspotActive from "../../assets/native-activities/readable-text-hotspot-active.svg";
import readableHotspotPressed from "../../assets/native-activities/readable-text-hotspot-pressed.svg";
import { logicalAreaStyle } from "../builder-studio/stageGeometry.js";
import { nativeAudioTextFocusLayout, nativeAudioTextHighlightColor, nativeAudioTextReadableHighlightArea } from "../../data/native-activities/nativeAudioTextHotspots.js";
import { pauseSiblingNativeMedia } from "./nativeMediaArbitration.js";
import { NativeVerticalScrollViewport } from "./NativeVerticalScrollViewport.jsx";

export const nativeAudioHotspotArtwork = Object.freeze({ active: audioHotspotActive, pressed: audioHotspotPressed });
export const nativeReadableTextHotspotArtwork = Object.freeze({ active: readableHotspotActive, pressed: readableHotspotPressed });

export function nativeAudioTextHotspotArtwork(hotspot) {
  return hotspot?.audioAssetSlot ? nativeAudioHotspotArtwork : nativeReadableTextHotspotArtwork;
}

export function NativeAudioTextHotspotButtons({ panelId = null, surface, presentation = null }) {
  if (!presentation || !surface) return null;
  return presentation.hotspots.filter((hotspot) => hotspot.panelId === panelId).map((hotspot) => {
    const active = presentation.activeHotspotId === hotspot.id;
    const artwork = nativeAudioTextHotspotArtwork(hotspot);
    return <button
      key={hotspot.id}
      type="button"
      className="native-audio-text-hotspot"
      style={logicalAreaStyle(hotspot.activityArea, surface)}
      aria-label={hotspot.label}
      aria-pressed={active}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (["Enter", " "].includes(event.key)) event.stopPropagation(); }}
      onClick={(event) => { event.stopPropagation(); presentation.onToggle(hotspot.id); }}
    ><img src={active ? artwork.pressed : artwork.active} alt="" /></button>;
  });
}

export function NativeAudioTextFocusContent({ document, hotspot, assetUrl, autoPlay = false }) {
  const audioRef = useRef(null);
  const readableReference = document.assets.find((asset) => asset.slot === document.readableText?.assetSlot);
  const audioReference = hotspot?.audioAssetSlot ? document.assets.find((asset) => asset.slot === hotspot.audioAssetSlot) : null;
  useEffect(() => {
    if (!autoPlay || !audioRef.current) return;
    const audio = audioRef.current;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return () => { audio.pause(); audio.currentTime = 0; };
  }, [autoPlay, hotspot?.audioAssetSlot, hotspot?.id]);
  if (!hotspot || !readableReference) return null;
  const focus = hotspot.readableFocusArea;
  const focusLayout = nativeAudioTextFocusLayout(hotspot);
  const highlight = nativeAudioTextReadableHighlightArea(hotspot);
  const highlightStyle = highlight ? {
    left: `${(highlight.x - focus.x) / focus.width * 100}%`,
    top: `${(highlight.y - focus.y) / focus.height * 100}%`,
    width: `${highlight.width / focus.width * 100}%`,
    height: `${highlight.height / focus.height * 100}%`,
  } : null;
  const crop = <div
      className="native-audio-text-focus-crop"
      data-highlight-color={nativeAudioTextHighlightColor(hotspot.highlightColor)}
      style={{ aspectRatio: `${focus.width} / ${focus.height}` }}
    >
      <svg viewBox={`${focus.x} ${focus.y} ${focus.width} ${focus.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${document.readableText.altText}: ${hotspot.label}`}>
        <image href={assetUrl(readableReference.assetId)} x="0" y="0" width={document.readableText.sourceWidth} height={document.readableText.sourceHeight} preserveAspectRatio="xMidYMid meet" />
      </svg>
      {highlightStyle ? <span className="native-audio-text-focus-highlight" style={highlightStyle} aria-hidden="true" /> : null}
    </div>;
  return <section className="native-audio-text-focus" data-focus-layout={focusLayout} aria-label={`Focused readable text: ${hotspot.label}`}>
    {focusLayout === "natural-width" ? <NativeVerticalScrollViewport id={`${document.activityId}-${hotspot.id}-focus-scroll`} className="native-audio-text-focus-scroll" ariaLabel="Focused readable text vertical scroll" resetKey={hotspot.id}>{crop}</NativeVerticalScrollViewport> : crop}
    {audioReference ? <audio ref={audioRef} hidden autoPlay={autoPlay} preload="metadata" src={assetUrl(audioReference.assetId)} onPlay={(event) => pauseSiblingNativeMedia(event.currentTarget)} /> : null}
  </section>;
}
