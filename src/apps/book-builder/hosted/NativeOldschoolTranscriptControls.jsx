import { useRef, useState } from "react";
import { StudioField } from "../../../components/builder-studio/StudioControls.jsx";
import { NativeOldschoolExactTranscript, NativeOldschoolTranscriptFontStatus } from "../../../components/native-oldschool-listening/NativeOldschoolTranscript.jsx";
import { NATIVE_ACTIVITY_SYSTEM_FONT_FAMILIES } from "../../../data/native-activities/nativeActivityFont.js";
import { mergeNativeManagedAssetReference, removeNativeManagedAssetReferenceIfUnused } from "../../../data/native-activities/nativeActivityPublic.js";
import { normalizeOldschoolTypography, oldschoolTranscriptFontSlots } from "../../../data/native-activities/nativeOldschoolListeningTypography.js";
import { applyOldschoolTranscriptTypographyPreview, OLDSCHOOL_XML_MAXIMUM_BYTES, previewOldschoolTranscriptTypographyXml } from "../../../data/native-activities/nativeOldschoolListeningXml.js";
import { NativeActivityFontControls } from "./NativeCompleteSentencesFontControls.jsx";
import { useBuilderFontLibrary } from "./useBuilderFontLibrary.js";
import { nativeFontPreviewUrl } from "./builderNativeActivityApi.js";
import "../../../components/native-oldschool-listening/nativeOldschoolListening.css";

const reference = ({ assetId, checksumSha256, role, slot }) => ({ assetId, checksumSha256, role, slot });

export function NativeOldschoolTranscriptControls({ publicDocument, bookSlug, componentSlug, assetUrl, selectedCue, selectedRegion, mutatePublic }) {
  const [message, setMessage] = useState(""); const [preview, setPreview] = useState(null);
  const [sourceName, setSourceName] = useState(""); const [sourceFont, setSourceFont] = useState(""); const [bindings, setBindings] = useState({});
  const lastXml = useRef(""); const fileVersion = useRef(0);
  const { fonts, recordUploadedFont } = useBuilderFontLibrary({ bookSlug, componentSlug, onMessage: setMessage });
  const interaction = publicDocument.parts[0].interaction;
  const style = selectedRegion?.typography || {};
  const update = (patch, managedFont = null) => {
    if (!selectedCue || !selectedRegion) return;
    try {
      const assets = managedFont ? mergeNativeManagedAssetReference(publicDocument.assets, reference(managedFont)) : publicDocument.assets;
      const nextStyle = { ...style, ...patch };
      Object.keys(nextStyle).forEach((key) => { if (nextStyle[key] === undefined) delete nextStyle[key]; });
      const normalized = normalizeOldschoolTypography(nextStyle, { assets });
      mutatePublic((next) => {
        const previous = oldschoolTranscriptFontSlots(next.parts[0].interaction);
        if (managedFont) next.assets = mergeNativeManagedAssetReference(next.assets, reference(managedFont));
        next.parts[0].interaction.cues.find((cue) => cue.id === selectedCue.id).highlightRegions.find((region) => region.id === selectedRegion.id).typography = normalized;
        previous.forEach((slot) => removeNativeManagedAssetReferenceIfUnused(next, slot));
      });
      setPreview(null); setMessage("Region typography updated in the local draft. Inline overrides are retained.");
    } catch (error) { setMessage(error.message); }
  };
  const prepare = (xml, explicitBindings = bindings) => {
    setPreview(null);
    try {
      let assets = publicDocument.assets;
      for (const binding of Object.values(explicitBindings)) {
        const font = fonts.find((entry) => entry.slot === binding.fontAssetSlot);
        if (font) assets = mergeNativeManagedAssetReference(assets, reference(font));
      }
      const result = previewOldschoolTranscriptTypographyXml(xml, interaction, { assets, commonAssetSlots: new Set(assets.map((asset) => asset.slot)), fontBindings: explicitBindings });
      setPreview(result); setMessage("XML matched uniquely. Review the typography preview before applying to the local draft.");
    } catch (error) { setMessage(error.message); }
  };
  const importXml = async (file) => {
    if (!file) return;
    const version = ++fileVersion.current; setPreview(null); lastXml.current = "";
    if (file.size > OLDSCHOOL_XML_MAXIMUM_BYTES) { setMessage("Transcript XML exceeds 1 MiB."); return; }
    try { const xml = await file.text(); if (version !== fileVersion.current) return; lastXml.current = xml; prepare(xml); }
    catch (error) { setMessage(error.message || "Transcript XML could not be read."); }
  };
  const apply = () => {
    if (!preview) return;
    try {
      const checked = structuredClone(interaction); applyOldschoolTranscriptTypographyPreview(checked, preview);
      mutatePublic((next) => {
        const previous = oldschoolTranscriptFontSlots(next.parts[0].interaction);
        applyOldschoolTranscriptTypographyPreview(next.parts[0].interaction, preview);
        const slots = oldschoolTranscriptFontSlots(checked);
        for (const asset of preview.assets.filter((asset) => slots.has(asset.slot))) next.assets = mergeNativeManagedAssetReference(next.assets, asset);
        previous.forEach((slot) => removeNativeManagedAssetReferenceIfUnused(next, slot));
      });
      setPreview(null); setMessage(`${preview.changes.length} regions enriched in the local draft. Save the activity to persist the changes.`);
    } catch (error) { setPreview(null); setMessage(error.message); }
  };
  const previewDocument = preview ? { ...publicDocument, assets: preview.assets, parts: [{ ...publicDocument.parts[0], interaction: { ...interaction, cues: preview.cues } }] } : publicDocument;
  const transcriptAssetUrl = (assetId) => previewDocument.assets.some((asset) => asset.assetId === assetId && asset.role === "activity_font") ? nativeFontPreviewUrl(bookSlug, componentSlug, assetId) : assetUrl(assetId);
  const pageReference = publicDocument.assets.find((asset) => asset.slot === interaction.panels[1].pageAssetSlot);
  return <section className="studio-content-panel native-oldschool-typography-controls" aria-label="Transcript typography">
    <h3>Transcript typography</h3>
    <label className="studio-upload-action"><span><strong>Import transcript typography from XML</strong><small>Original karaokeScroll XML · local file · maximum 1 MiB</small></span><input type="file" accept=".xml,text/xml,application/xml" onChange={(event) => { importXml(event.target.files?.[0]); event.target.value = ""; }} /></label>
    <details><summary>Bind a source font</summary><p>For a source family outside the system list, explicitly select its component font or a replacement system family.</p>
      <StudioField label="XML source font name"><input value={sourceName} maxLength={128} onChange={(event) => setSourceName(event.target.value)} /></StudioField>
      <StudioField label="XML font binding"><select aria-label="XML font binding" value={sourceFont} onChange={(event) => setSourceFont(event.target.value)}><option value="">Choose a font</option>{NATIVE_ACTIVITY_SYSTEM_FONT_FAMILIES.map((family) => <option key={family}>{family}</option>)}{fonts.map((font) => <option key={font.slot} value={font.slot}>{font.displayLabel}</option>)}</select></StudioField>
      <button type="button" disabled={!sourceName || !sourceFont} onClick={() => { const next = { ...bindings, [sourceName]: NATIVE_ACTIVITY_SYSTEM_FONT_FAMILIES.includes(sourceFont) ? { fontFamily: sourceFont } : { fontAssetSlot: sourceFont } }; setBindings(next); if (lastXml.current) prepare(lastXml.current, next); }}>Bind font and preview XML again</button>
    </details>
    {message ? <p role="status">{message}</p> : null}
    {preview ? <div aria-label="XML typography preview"><p>{preview.changes.length} regions · {preview.sourceCueCount} timing groups · {preview.changes.filter((change) => change.inlineRuns).length} fragments with inline formatting. Coordinates, text and bindings are retained.</p>
      <details><summary>Review region changes</summary><ul>{preview.changes.map((change) => <li key={change.regionId}>Source {change.sourceId}: {change.typography.fontFamily || "managed font"}, {change.typography.fontSize}px, weight {change.typography.fontWeight}, {change.typography.color}, {change.inlineRuns} inline runs</li>)}</ul></details>
      <button type="button" onClick={apply}>Apply typography to local draft</button><button type="button" onClick={() => setPreview(null)}>Cancel typography import</button>
    </div> : null}
    <div className="native-oldschool-typography-preview" aria-label={preview ? "XML transcript preview" : "Local transcript preview"}>
      <div className="native-oldschool-listening-page-canvas" style={{ aspectRatio: `${interaction.panels[1].sourceWidth}/${interaction.panels[1].sourceHeight}` }}>
        {pageReference ? <img src={assetUrl(pageReference.assetId)} alt={interaction.panels[1].altText} draggable="false" /> : null}
        <NativeOldschoolExactTranscript document={previewDocument} highlightedCueIds={selectedCue ? [selectedCue.id] : []} />
        <NativeOldschoolTranscriptFontStatus document={previewDocument} assetUrl={transcriptAssetUrl} />
      </div>
    </div>
    {selectedRegion && selectedCue.highlightRegions.every((region) => typeof region.text === "string") ? <fieldset><legend>Selected region typography</legend>
      <p>{selectedRegion.text}</p>
      <NativeActivityFontControls {...{ bookSlug, componentSlug, fonts }} selectedSlot={style.fontAssetSlot} selectedFamily={style.fontFamily} systemFamilies={NATIVE_ACTIVITY_SYSTEM_FONT_FAMILIES} onSelectFamily={(fontFamily) => update({ fontFamily, fontAssetSlot: undefined })} onSelect={(font) => update({ fontAssetSlot: font?.slot }, font)} onUploaded={recordUploadedFont} onMessage={setMessage} label="Transcript region font" />
      <StudioField label="Transcript font size (source px)"><input type="number" min={8} max={96} value={style.fontSize ?? ""} placeholder="Legacy 21" onChange={(event) => update({ fontSize: event.target.value === "" ? undefined : Number(event.target.value) })} /></StudioField>
      <StudioField label="Transcript line height (source px)"><input type="number" min={8} max={192} value={style.lineHeight ?? ""} placeholder="Automatic: largest font × 4/3" onChange={(event) => update({ lineHeight: event.target.value === "" ? undefined : Number(event.target.value) })} /></StudioField>
      <StudioField label="Transcript weight"><select value={style.fontWeight ?? 400} onChange={(event) => update({ fontWeight: Number(event.target.value) })}>{[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => <option key={weight} value={weight}>{weight === 400 ? "Normal (400)" : weight === 700 ? "Bold (700)" : weight}</option>)}</select></StudioField>
      <label><input type="checkbox" checked={style.italic || false} onChange={(event) => update({ italic: event.target.checked })} />Italic</label>
      <label><input type="checkbox" checked={style.underline || false} onChange={(event) => update({ underline: event.target.checked })} />Underline</label>
      <StudioField label="Transcript color"><input type="color" value={style.color || "#20242b"} onChange={(event) => update({ color: event.target.value })} /></StudioField>
      <StudioField label="Transcript alignment"><select value={style.align || "left"} onChange={(event) => update({ align: event.target.value })}>{["left", "center", "right"].map((align) => <option key={align}>{align}</option>)}</select></StudioField>
      <p>Inline overrides from XML remain attached to their text. Explicit line breaks are retained; text is never shrunk to fit a region.</p>
    </fieldset> : <p>Select a region in a cue with exact text to edit its typography.</p>}
  </section>;
}
