import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";

import { StudioField } from "../../../components/builder-studio/StudioControls.jsx";
import { uploadBuilderFont } from "./builderNativeActivityApi.js";

export function NativeActivityFontControls({ bookSlug, componentSlug, fonts, selectedSlot, onSelect, onUploaded, onMessage, label = "Answer font", onUploadStateChange, systemFamilies = [], selectedFamily = "", onSelectFamily, disabled = false }) {
  const [uploading, setUploading] = useState(false);
  const scope = `${bookSlug}/${componentSlug}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => { currentScope.current = scope; setUploading(false); return () => { currentScope.current = null; }; }, [scope]);
  useEffect(() => { onUploadStateChange?.(uploading); return () => onUploadStateChange?.(false); }, [uploading, onUploadStateChange]);
  const selectedFont = fonts.find((font) => font.slot === selectedSlot) || null;

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    onMessage("Uploading TrueType font…");
    try {
      const value = await uploadBuilderFont({ bookSlug, componentSlug, file });
      if (currentScope.current !== scope) return;
      onUploaded(value.font);
      onSelect(value.font);
      onMessage(value.idempotent ? "Existing component font selected." : "Font uploaded to this component's library and selected.");
    } catch (error) {
      if (currentScope.current !== scope) return;
      onMessage(error.message || "Font upload failed.");
    } finally {
      if (currentScope.current === scope) setUploading(false);
    }
  };

  return <>
    <StudioField label={label}>
      <select aria-label={label} disabled={disabled || uploading} value={selectedSlot || selectedFamily || ""} onChange={(event) => systemFamilies.includes(event.target.value) ? onSelectFamily?.(event.target.value) : onSelect(fonts.find((font) => font.slot === event.target.value) || null)}>
        <option value="">Default application font</option>
        <optgroup label="Book fonts">{fonts.map((font) => <option key={font.assetId} value={font.slot}>{font.displayLabel}</option>)}</optgroup>
        {systemFamilies.length ? <optgroup label="System fonts">{systemFamilies.map((family) => <option key={family} value={family}>{family}</option>)}</optgroup> : null}
      </select>
      <small role="status">{selectedFont ? `${selectedFont.displayLabel} · ${Math.ceil(selectedFont.byteSize / 1024)} KB · shared component font` : "Default application font · no managed font attached"}</small>
    </StudioField>
    <label className="studio-upload-action">
      <Upload aria-hidden="true" />
      <span><strong>{uploading ? "Uploading…" : "Upload TTF"}</strong><small>Reusable TrueType font, component-scoped</small></span>
      <input type="file" accept=".ttf,font/ttf" disabled={disabled || uploading} onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ""; }} />
    </label>
  </>;
}

export const NativeCompleteSentencesFontControls = NativeActivityFontControls;
