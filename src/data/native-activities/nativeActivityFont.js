export const NATIVE_ACTIVITY_SYSTEM_FONT_FAMILIES = Object.freeze(["Arial", "Georgia", "Verdana"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function nativeActivityFontFamilyAlias(assetId) {
  const normalized = String(assetId || "").toLowerCase();
  if (!UUID.test(normalized)) throw new Error("Native activity font asset ID is invalid.");
  return `hh-native-font-${normalized.replaceAll("-", "")}`;
}

export function nativeActivityFontReference(document, slot) {
  if (!slot) return null;
  return document?.assets?.find((asset) => asset.slot === slot && asset.role === "activity_font") || null;
}

export function nativeActivityFontFamily(document, slot, fallback = "Arial") {
  const reference = nativeActivityFontReference(document, slot);
  return reference ? `${nativeActivityFontFamilyAlias(reference.assetId)}, ${fallback}, sans-serif` : fallback;
}
