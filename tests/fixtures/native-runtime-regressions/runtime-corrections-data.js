import { publicDocument, teacherDocument } from "./multi-part-data.js";
import { dragDropImprovementsPair, dndId } from "./drag-drop-improvements-data.js";
import { nativeAudioTextHotspotTargets } from "../../../src/data/native-activities/nativeAudioTextHotspots.js";
import { pruneMultiPartAssetRoots } from "../../../src/apps/book-builder/hosted/nativeMultiPartAuthoring.js";

export function multiPartReadablePair(audio = false) {
  const pair = structuredClone({ publicDocument, teacherDocument });
  const pub = pair.publicDocument; const interaction = pub.parts[0].interaction;
  const drag = dragDropImprovementsPair();
  pub.readableText = drag.publicDocument.readableText;
  pub.assets.push(...drag.publicDocument.assets.map((asset) => ({ ...asset, assetId: asset.assetId.replace(/^1/, "2") })));
  const flowId = interaction.panels.find((panel) => panel.layout === "flow").id;
  for (const n of [20, 21]) {
    const child = structuredClone(drag.publicDocument.parts[0].interaction); child.panels = [child.panels[0]];
    interaction.sections.push({ id: dndId("section", n), kind: "drag-drop", title: `Visual section ${n}`, panelId: flowId, bankRegion: null, interaction: child });
    pair.teacherDocument.parts[0].solution.sections.push({ id: dndId("section", n), kind: "drag-drop", solution: { kind: "drag-drop", mappings: drag.teacherDocument.parts[0].solution.mappings.filter((mapping) => mapping.targetId !== dndId("target", 2)) } });
  }
  const targets = nativeAudioTextHotspotTargets(pub);
  pub.audioTextHotspots = { hotspots: targets.map((target, i) => ({
    id: dndId("aud", i + 1), panelId: target.panelId,
    activityArea: { x: 80, y: 90, width: 48, height: 48 },
    readableFocusArea: { x: 20, y: 100 + i * 60, width: 900, height: 300 },
    readableHighlightArea: { x: 60, y: 160 + i * 60, width: 650, height: 45 },
    focusLayout: "natural-width", highlightColor: "cyan", audioAssetSlot: audio ? "audio" : "", label: `Excerpt ${i + 1}`,
  })) };
  pruneMultiPartAssetRoots(pub);
  return pair;
}

export function adaptiveBankPair(layoutMode = "text", images = false) {
  const pair = dragDropImprovementsPair(); const pub = pair.publicDocument; const interaction = pub.parts[0].interaction;
  delete pub.readableText; delete pub.audioTextHotspots;
  interaction.layoutMode = layoutMode; interaction.answerBankHeightPx = 240; interaction.textPanelHeightPx = 300;
  interaction.panels = [interaction.panels[0]];
  interaction.panels[0].surface.height = 1100;
  interaction.panels[0].images[0].area.height = 1100;
  interaction.panels[0].dropTargets = [{ id: dndId("target", 1), area: { x: 70, y: 80, width: 860, height: 170 }, capacity: 12, accessibleLabel: "All answers" }];
  interaction.words = Array.from({ length: 12 }, (_, i) => ({ id: dndId("word", i + 1), text: `Phrase ${i + 1}: a thoughtful answer`, shortLabel: String.fromCharCode(65 + i), reusable: false,
    ...(images && i % 2 === 0 ? { image: { assetSlot: "item", sourceWidth: 120, sourceHeight: 60, displayWidth: 170, displayHeight: 85 } } : {}) }));
  pair.teacherDocument.parts[0].solution.mappings = [{ targetId: dndId("target", 1), wordIds: interaction.words.map((word) => word.id) }];
  const used = new Set(["background", "overlay", ...(images ? ["item"] : [])]); pub.assets = pub.assets.filter((asset) => used.has(asset.slot));
  return pair;
}
