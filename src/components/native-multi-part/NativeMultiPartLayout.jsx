import { projectNativeMultiPartChild } from "../../data/native-activities/nativeMultiPart.js";
import "./nativeMultiPart.css";

export function NativeMultiPartLayout({ document, teacherDocument = null, assetUrl, panelIndex, setPanelIndex, renderSection, externalNavigation = false, controls = null }) {
  const interaction = document.parts[0].interaction;
  return <section className="native-multi-part" aria-label={document.metadata.title}>
    {controls || (!externalNavigation && interaction.panels.length > 1) ? <div className="native-multi-part-toolbar">{controls}
    {!externalNavigation && interaction.panels.length > 1 ? <nav aria-label="Multi-Part panels"><button type="button" disabled={panelIndex === 0} onClick={() => setPanelIndex(panelIndex - 1)}>Previous panel</button><span>Panel {panelIndex + 1} of {interaction.panels.length}</span><button type="button" disabled={panelIndex >= interaction.panels.length - 1} onClick={() => setPanelIndex(panelIndex + 1)}>Next panel</button></nav> : null}
    </div> : null}
    <div className="native-multi-part-body">{interaction.panels.map((panel, index) => {
      const background = document.assets.find((asset) => asset.slot === panel.background?.assetSlot);
      return <section key={panel.id} hidden={index !== panelIndex} className={`native-multi-part-panel native-multi-part-panel--${panel.layout}`} aria-label={panel.title || `Panel ${index + 1}`} style={panel.layout === "canvas" ? { aspectRatio: `${panel.surface.width} / ${panel.surface.height}`, "--native-multi-part-ratio": panel.surface.width / panel.surface.height } : undefined}>
        {panel.layout === "canvas" && background ? <img className="native-multi-part-background" src={assetUrl(background.assetId)} alt={panel.background.altText} draggable={false} /> : null}
        {interaction.sections.filter((section) => section.panelId === panel.id).map((section) => <section key={section.id} className="native-multi-part-section" data-section-id={section.id} data-section-kind={section.kind} aria-label={section.title || section.kind}>
          {panel.layout === "flow" && section.title ? <h3>{section.title}</h3> : null}
          {renderSection(section, projectNativeMultiPartChild(document, section, teacherDocument), panel.layout === "canvas" ? { bankRegion: section.bankRegion } : null, index === panelIndex)}
        </section>)}
      </section>;
    })}</div>
  </section>;
}
