import { multiPartReadablePair, adaptiveBankPair } from "./runtime-corrections-data.js";
import { dndId } from "./drag-drop-improvements-data.js";
import { nativeAudioTextHotspotTargets } from "../../../src/data/native-activities/nativeAudioTextHotspots.js";
import { normalizeNativeMultiPartInteraction, validateNativeMultiPartTopology } from "../../../src/data/native-activities/nativeMultiPart.js";
import { pruneMultiPartAssetRoots } from "../../../src/apps/book-builder/hosted/nativeMultiPartAuthoring.js";

// Synthetic equivalent only: these are not the reported hosted document's IDs or words.
export function secondFlowBankPair() {
  const pair = multiPartReadablePair();
  const pub = pair.publicDocument;
  const interaction = pub.parts[0].interaction;
  const drag = adaptiveBankPair();
  const flowId = interaction.panels[1].id;
  interaction.sections = [interaction.sections.find((section) => section.id === dndId("section", 3)), {
    id: dndId("section", 24), kind: "drag-drop", title: "Second panel text exercise", panelId: flowId, bankRegion: null,
    interaction: drag.publicDocument.parts[0].interaction,
  }];
  pair.teacherDocument.parts[0].solution.sections = [pair.teacherDocument.parts[0].solution.sections.find((section) => section.id === dndId("section", 3)), {
    id: dndId("section", 24), kind: "drag-drop", solution: drag.teacherDocument.parts[0].solution,
  }];
  const target = nativeAudioTextHotspotTargets(pub).find((entry) => entry.sectionId === dndId("section", 24));
  pub.audioTextHotspots.hotspots = [{ ...pub.audioTextHotspots.hotspots[0], panelId: target.panelId, label: "Second panel excerpt", activityArea: { x: 930, y: 20, width: 60, height: 60 } }];
  pruneMultiPartAssetRoots(pub);
  pub.parts[0].interaction = normalizeNativeMultiPartInteraction(interaction, { assets: pub.assets, commonAssetSlots: new Set(["readable"]) });
  validateNativeMultiPartTopology(pub, pair.teacherDocument);
  return pair;
}
