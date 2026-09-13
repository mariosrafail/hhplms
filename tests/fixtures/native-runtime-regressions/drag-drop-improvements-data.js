import { nativeDocumentPair } from "../../../scripts/book-builder/hosted-native-activity-document-fixtures.mjs";

export const dndId = (prefix, n) => `${prefix}-${String(n).padStart(32, "0")}`;
export function dragDropImprovementsPair() {
  const pair = nativeDocumentPair("drag-drop-improvements", "drag-drop", "ub2-sb-unit-1-part-1", "Drag & Drop improvements");
  const pub = pair.publicDocument;
  pub.assets = ["background", "overlay", "item", "readable", "audio"].map((slot, index) => ({ slot, assetId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, checksumSha256: String(index + 1).repeat(64), role: "activity_artwork" }));
  pub.parts[0].interaction = {
    ...pub.parts[0].interaction, randomize: false, layoutMode: "standard",
    words: [
      { id: dndId("word", 1), text: "Reusable picture", reusable: true, shortLabel: "C", image: { assetSlot: "item", sourceWidth: 120, sourceHeight: 60, displayWidth: 120, displayHeight: 78, caption: "Picture X" } },
      { id: dndId("word", 2), text: "Longer target label", reusable: false, shortLabel: "A" },
      { id: dndId("word", 3), text: "Same text", reusable: false, shortLabel: "B" },
      { id: dndId("word", 4), text: "Same text", reusable: false, shortLabel: "D" },
    ],
    panels: [1, 2].map((n) => ({ id: dndId("panel", n), surface: { width: 1024, height: 582 }, images: [
      { id: dndId("img", n * 10), assetSlot: "background", area: { x: 0, y: 0, width: 1024, height: 582 }, order: 0, altText: "Panel background", decorative: false, fit: "contain", locked: true },
      { id: dndId("img", n * 10 + 1), assetSlot: "overlay", area: { x: n * 300, y: 240, width: 150, height: 100 }, order: 1, altText: `Overlay ${n}`, decorative: false, fit: "contain", locked: false },
    ], dropTargets: n === 1 ? [
      { id: dndId("target", 1), area: { x: 80, y: 90, width: 260, height: 86 }, capacity: 2, accessibleLabel: "Target X and Y" },
      { id: dndId("target", 3), area: { x: 480, y: 90, width: 105, height: 32 }, capacity: 1, accessibleLabel: "Small word target" },
    ] : [{ id: dndId("target", 2), area: { x: 80, y: 90, width: 110, height: 70 }, capacity: 1, accessibleLabel: "Target X again" }] })),
  };
  pub.readableText = { kind: "image", assetSlot: "readable", sourceWidth: 1000, sourceHeight: 1800, altText: "Readable passage" };
  pub.audioTextHotspots = { hotspots: [1, 2].map((n) => ({ id: dndId("aud", n), panelId: dndId("panel", n), activityArea: { x: 820, y: 80, width: 48, height: 48 }, readableFocusArea: { x: 60, y: 200, width: 880, height: 400 }, readableHighlightArea: { x: 100, y: 260, width: 600, height: 70 }, focusLayout: "natural-width", highlightColor: "cyan", audioAssetSlot: n === 2 ? "audio" : "", label: `Open excerpt ${n}` })) };
  pair.teacherDocument.parts[0].solution.mappings = [
    { targetId: dndId("target", 1), wordIds: [dndId("word", 1), dndId("word", 2)] },
    { targetId: dndId("target", 2), wordIds: [dndId("word", 1)] },
    { targetId: dndId("target", 3), wordIds: [dndId("word", 3)] },
  ];
  return { publicDocument: pub, teacherDocument: pair.teacherDocument };
}
