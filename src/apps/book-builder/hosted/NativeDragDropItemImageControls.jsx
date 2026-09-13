import { useEffect, useRef, useState } from "react";
import { createNativeChildId } from "../../../data/native-activities/nativeChildIdentity.js";
import { mergeNativeManagedAssetReference, removeNativeManagedAssetReferenceIfUnused } from "../../../data/native-activities/nativeActivityPublic.js";
import { NATIVE_DRAG_DROP_LIMITS } from "../../../data/native-activities/nativeDragDrop.js";
import { NativeDragDropItemContent } from "../../../components/native-drag-drop/NativeDragDropItemContent.jsx";
import { uploadNativeActivityAsset } from "./builderNativeActivityApi.js";
import { StudioButton } from "../../../components/builder-studio/StudioControls.jsx";

export function NativeDragDropItemImageControls({ word, document, bookSlug, componentSlug, activityId, assetUrl, mutatePublic, onPendingChange }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const operation = useRef(null);
  const pendingCallback = useRef(onPendingChange);
  pendingCallback.current = onPendingChange;
  useEffect(() => {
    setPending(false);
    return () => {
      if (operation.current) pendingCallback.current(false);
      operation.current = null;
    };
  }, [bookSlug, componentSlug, activityId, word.id]);
  const upload = async (file) => {
    if (!file || operation.current) return;
    const token = {}; operation.current = token;
    setPending(true); onPendingChange(true); setMessage("Uploading image…");
    try {
      const uploaded = await uploadNativeActivityAsset({ bookSlug, componentSlug, activityId, assetSlot: createNativeChildId("asset"), file });
      if (operation.current !== token) return;
      const { width, height } = uploaded.metadata || {};
      if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0 && value <= NATIVE_DRAG_DROP_LIMITS.itemImageDimension)) throw new Error("Unsupported image dimensions.");
      mutatePublic((next) => {
        const current = next.parts[0].interaction.words.find((item) => item.id === word.id);
        if (!current || next.activityId !== activityId) return;
        const oldSlot = current.image?.assetSlot;
        next.assets = mergeNativeManagedAssetReference(next.assets, uploaded.reference);
        current.image = { assetSlot: uploaded.reference.slot, sourceWidth: width, sourceHeight: height, displayWidth: current.image?.displayWidth || 64, displayHeight: current.image?.displayHeight || 64, ...(current.image?.caption !== undefined ? { caption: current.image.caption } : {}) };
        if (oldSlot) removeNativeManagedAssetReferenceIfUnused(next, oldSlot);
      });
      setMessage("Image ready. Save Draft to keep this change.");
    } catch {
      if (operation.current === token) setMessage("Image upload failed. The previous item is preserved.");
    } finally {
      if (operation.current === token) { operation.current = null; setPending(false); onPendingChange(false); }
    }
  };
  const changeImage = (mutator) => mutatePublic((next) => {
    const item = next.parts[0].interaction.words.find((entry) => entry.id === word.id);
    if (item?.image) mutator(item, next);
  });
  return <fieldset className="native-drag-drop-item-image-controls" disabled={pending}>
    <legend>Item image · {word.shortLabel}</legend>
    <p>The item text is its accessible description. Add a visible caption only if needed.</p>
    <label className="native-drag-drop-item-upload">{word.image ? "Replace item image" : "Upload item image"}<input aria-label={`Upload image for ${word.shortLabel}`} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ""; }} /></label>
    {word.image ? <>
      <div className="native-drag-drop-item-thumbnail"><NativeDragDropItemContent word={word} document={document} assetUrl={assetUrl} /></div>
      <div className="native-drag-drop-item-dimensions">
      <label>Display width<input aria-label={`Image width for ${word.shortLabel}`} type="number" min={16} max={256} value={word.image.displayWidth} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 16 && value <= 256) changeImage((item) => { item.image.displayWidth = value; }); }} /></label>
      <label>Display height<input aria-label={`Image height for ${word.shortLabel}`} type="number" min={16} max={256} value={word.image.displayHeight} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 16 && value <= 256) changeImage((item) => { item.image.displayHeight = value; }); }} /></label>
      </div>
      <label>Visible caption (optional)<input aria-label={`Image caption for ${word.shortLabel}`} maxLength={300} value={word.image.caption || ""} onChange={(event) => changeImage((item) => { if (event.target.value) item.image.caption = event.target.value; else delete item.image.caption; })} /></label>
      <StudioButton variant="danger-ghost" onClick={() => changeImage((item, next) => { const slot = item.image.assetSlot; delete item.image; removeNativeManagedAssetReferenceIfUnused(next, slot); })}>Remove item image</StudioButton>
    </> : null}
    {message ? <p role="status">{message}</p> : null}
  </fieldset>;
}
