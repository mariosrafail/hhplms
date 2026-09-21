import { useEffect, useRef, useId } from "react";
import { NativeAudioTextHotspotButtons } from "../native-readable-text/NativeAudioTextHotspots.jsx";
import { nativeAudioTextHotspotTargets } from "../../data/native-activities/nativeAudioTextHotspots.js";
import { projectNativeMultiPartChild } from "../../data/native-activities/nativeMultiPart.js";
import "./nativeMultiPart.css";

export function NativeMultiPartLayout({ document, teacherDocument = null, assetUrl, panelIndex, setPanelIndex, renderSection, externalNavigation = false, controls = null, audioHotspotPresentation = null }) {
  const clipId = useId().replace(/:/g, "");
  const interaction = document.parts[0].interaction;
  const currentPanelId = interaction.panels[panelIndex]?.id;
  const hotspotRef = useRef(audioHotspotPresentation); hotspotRef.current = audioHotspotPresentation;
  useEffect(() => {
    const presentation = hotspotRef.current;
    const active = presentation?.hotspots.find((hotspot) => hotspot.id === presentation.activeHotspotId);
    const target = nativeAudioTextHotspotTargets(document).find((entry) => entry.panelId === active?.panelId);
    if (active && target?.parentPanelId !== currentPanelId) presentation.onPanelChange(currentPanelId);
  }, [currentPanelId, document]);
  return <section className="native-multi-part" aria-label={document.metadata.title}>
    {controls || (!externalNavigation && interaction.panels.length > 1) ? <div className="native-multi-part-toolbar">{controls}
    {!externalNavigation && interaction.panels.length > 1 ? <nav aria-label="Multi-Part panels"><button type="button" disabled={panelIndex === 0} onClick={() => setPanelIndex(panelIndex - 1)}>Previous panel</button><span>Panel {panelIndex + 1} of {interaction.panels.length}</span><button type="button" disabled={panelIndex >= interaction.panels.length - 1} onClick={() => setPanelIndex(panelIndex + 1)}>Next panel</button></nav> : null}
    </div> : null}
    <div className="native-multi-part-body">{interaction.panels.map((panel, index) => {
      const inRegion = (hotspot, region) => hotspot.panelId === panel.id && hotspot.activityArea.x >= region.x && hotspot.activityArea.y >= region.y && hotspot.activityArea.x + hotspot.activityArea.width <= region.x + region.width && hotspot.activityArea.y + hotspot.activityArea.height <= region.y + region.height;
      const textRegions = interaction.sections.filter((section) => section.panelId === panel.id && section.textRegion).map((section) => section.textRegion);
      const background = document.assets.find((asset) => asset.slot === panel.background?.assetSlot);
      return <section key={panel.id} hidden={index !== panelIndex} className={`native-multi-part-panel native-multi-part-panel--${panel.layout}`} aria-label={panel.title || `Panel ${index + 1}`} style={panel.layout === "canvas" ? { aspectRatio: `${panel.surface.width} / ${panel.surface.height}`, "--native-multi-part-ratio": panel.surface.width / panel.surface.height } : undefined}>
        {panel.layout === "canvas" && background ? textRegions.length ? <svg className="native-multi-part-background" viewBox={`0 0 ${panel.surface.width} ${panel.surface.height}`} role="img" aria-label={panel.background.altText}><defs><mask id={`${clipId}-${panel.id}`}><rect width={panel.surface.width} height={panel.surface.height} fill="white" />{textRegions.map((region, i) => <rect key={i} {...region} fill="black" />)}</mask></defs><image href={assetUrl(background.assetId)} width={panel.surface.width} height={panel.surface.height} mask={`url(#${clipId}-${panel.id})`} /></svg> : <img className="native-multi-part-background" src={assetUrl(background.assetId)} alt={panel.background.altText} draggable={false} /> : null}
        {interaction.sections.filter((section) => section.panelId === panel.id).map((section) => <section key={section.id} className="native-multi-part-section" data-section-id={section.id} data-section-kind={section.kind} aria-label={section.title || section.kind}>
          {panel.layout === "flow" && section.title ? <h3>{section.title}</h3> : null}
          {renderSection(section, projectNativeMultiPartChild(document, section, teacherDocument), panel.layout === "canvas" ? { bankRegion: section.bankRegion, ...(section.textRegion ? { textRegion: section.textRegion, backgroundUrl: background ? assetUrl(background.assetId) : "", audioHotspotPresentation: audioHotspotPresentation ? { ...audioHotspotPresentation, hotspots: audioHotspotPresentation.hotspots.filter((hotspot) => inRegion(hotspot, section.textRegion)).map((hotspot) => ({ ...hotspot, panelId: section.interaction.panels[0].id })), onPanelChange() {} } : null } : {}) } : null, index === panelIndex)}
        </section>)}
        {panel.layout === "canvas" ? <NativeAudioTextHotspotButtons panelId={panel.id} surface={panel.surface} presentation={audioHotspotPresentation ? { ...audioHotspotPresentation, hotspots: audioHotspotPresentation.hotspots.filter((hotspot) => !textRegions.some((region) => inRegion(hotspot, region))) } : null} /> : null}
      </section>;
    })}</div>
  </section>;
}
