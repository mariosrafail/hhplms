import { NATIVE_COMPLETE_SENTENCES_DEFAULT_ANSWER_STYLE } from "../../../data/native-activities/nativeCompleteSentences.js";
import { createEmptyMarkWordsVisualInteraction, createEmptyMarkWordsVisualSolution } from "../../../data/native-activities/nativeMarkWordsVisualTargets.js";
import { nativeOpenResponsePanels } from "../../../data/native-activities/nativeOpenResponse.js";
import { createNativeChildId } from "../../../data/native-activities/nativeChildIdentity.js";
import { createEmptyNativeDragDropInteraction } from "../../../data/native-activities/nativeDragDrop.js";
import { nativeMultiPartAssetSlots, projectNativeMultiPartChild } from "../../../data/native-activities/nativeMultiPart.js";

export const SHARED_CANVAS_AUTHORING_IMAGE_ID = "img-00000000000000000000000000000000";
export function createMultiPartSection(kind, panel) {
  const surface = { ...panel.surface };
  const visualPanel = () => ({ id: createNativeChildId("panel"), backgroundAssetSlot: panel.background?.assetSlot || "", sourceWidth: surface.width, sourceHeight: surface.height, hotspots: [] });
  const blanks = {
    "drag-drop": () => ({ interaction: { ...createEmptyNativeDragDropInteraction(), panels: [{ id: createNativeChildId("panel"), surface, images: [], dropTargets: [] }] }, solution: { kind, mappings: [] } }),
    "single-choice": () => ({ interaction: { kind, questions: [], ...(panel.layout === "canvas" ? { presentation: { kind: "image-hotspot", panels: [visualPanel()] } } : {}) }, solution: { kind, correctAnswers: [] } }),
    "complete-sentences": () => ({ interaction: { kind, items: [], presentation: { kind: "image-hotspot", answerStyle: { ...NATIVE_COMPLETE_SENTENCES_DEFAULT_ANSWER_STYLE }, panels: [visualPanel()] } }, solution: { kind, answers: [] } }),
    "open-response": () => ({ interaction: { kind, surface, artwork: [], questions: [] }, solution: { kind, modelAnswers: [] } }),
    "mark-the-words": () => ({ interaction: panel.layout === "canvas" ? { ...createEmptyMarkWordsVisualInteraction(), presentation: { kind: "visual-target", panels: [visualPanel()] } } : createEmptyMarkWordsVisualInteraction(), solution: panel.layout === "canvas" ? { ...createEmptyMarkWordsVisualSolution(), answers: [] } : createEmptyMarkWordsVisualSolution() }),
    image: () => ({ interaction: { kind, surface, images: [] }, solution: { kind } }),
  };
  const { interaction, solution } = blanks[kind]();
  if (panel.layout === "canvas" && kind === "mark-the-words") solution.answers = [{ panelId: interaction.presentation.panels[0].id, correctTargetIds: [] }];
  if (panel.layout === "canvas" && kind === "open-response") interaction.artwork = [{ id: createNativeChildId("art"), assetSlot: panel.background?.assetSlot || "", area: { x: 0, y: 0, ...surface }, order: 0, altText: panel.background?.altText || "", decorative: true, fit: "contain", locked: true }];
  const id = createNativeChildId("section");
  return { section: { id, kind, title: "", panelId: panel.id, bankRegion: panel.layout === "canvas" && kind === "drag-drop" ? { x: 0, y: Math.floor(surface.height * 0.8), width: surface.width, height: surface.height - Math.floor(surface.height * 0.8) } : null, interaction }, privateSection: { id, kind, solution } };
}

export function multiPartSectionAuthoringProjection(pair, section) {
  const child = structuredClone(projectNativeMultiPartChild(pair.publicDocument, section, pair.teacherDocument));
  const panel = pair.publicDocument.parts[0].interaction.panels.find((entry) => entry.id === section.panelId);
  if (panel.layout === "canvas" && panel.background && section.kind === "drag-drop") {
    const reference = pair.publicDocument.assets.find((asset) => asset.slot === panel.background.assetSlot);
    if (!child.publicDocument.assets.some((asset) => asset.slot === reference.slot)) child.publicDocument.assets.push(reference);
    child.publicDocument.parts[0].interaction.panels[0].images.unshift({ id: SHARED_CANVAS_AUTHORING_IMAGE_ID, assetSlot: reference.slot, area: { x: 0, y: 0, ...panel.surface }, order: 0, altText: panel.background.altText, decorative: true, fit: "contain", locked: true });
  }
  return { ...child, sharedCanvas: panel.layout === "canvas" };
}

export function pruneMultiPartAssetRoots(document) {
  const slots = nativeMultiPartAssetSlots(document.parts[0].interaction);
  for (const field of ["readableText", "video", "supplementalAudio", "audioTextHotspots"]) nativeMultiPartAssetSlots(document[field], slots);
  document.assets = document.assets.filter((asset) => slots.has(asset.slot));
}

// Retain authored coordinates on replacement. Normalizers report anything outside
// the new image instead of silently moving or deleting targets.
export function updateMultiPartSharedBackground(document, panelId, reference, surface) {
  const interaction = document.parts[0].interaction;
  const panel = interaction.panels.find((entry) => entry.id === panelId);
  if (!panel) return;
  panel.surface = { ...surface }; panel.background = { assetSlot: reference.slot, altText: panel.background?.altText || "" };
  for (const section of interaction.sections.filter((entry) => entry.panelId === panelId)) {
    const child = section.interaction;
    if (section.kind === "drag-drop") child.panels[0].surface = { ...surface };
    else if (section.kind === "open-response") {
      const overlay = nativeOpenResponsePanels(child)[0];
      overlay.surface.width = surface.width; overlay.surface.height = surface.height;
      const image = overlay.images[0]; if (image) { image.assetSlot = reference.slot; image.area = { x: 0, y: 0, ...surface }; }
    } else Object.assign(child.presentation.panels[0], { backgroundAssetSlot: reference.slot, sourceWidth: surface.width, sourceHeight: surface.height });
  }
}
