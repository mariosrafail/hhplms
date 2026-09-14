import { nativeActivityUsesManagedAssetSlot, mergeNativeManagedAssetReference, removeNativeManagedAssetReferenceIfUnused } from "./nativeActivityPublic.js";
import { nativeOldschoolListeningQuestionPublicDocument, nativeOldschoolListeningQuestionTeacherDocument, nativeOldschoolListeningQuestionMode } from "./nativeOldschoolListening.js";
import { oldschoolQuestionPanel } from "./nativeOldschoolQuestionSurface.js";
import { NATIVE_OPEN_RESPONSE_LEGACY_PANEL_ID, nativeOpenResponsePanelPromptIds, nativeOpenResponsePanelResponseIds } from "./nativeOpenResponse.js";

// Supporting content belongs to the outer activity. Child editors see only
// their own assets, so strict normalization also catches stale child references.
export function projectOldschoolQuestionPair(publicDocument, teacherDocument) {
  const publicChild = structuredClone(nativeOldschoolListeningQuestionPublicDocument(publicDocument));
  for (const key of ["readableText", "audioTextHotspots", "video", "supplementalAudio"]) delete publicChild[key];
  if (publicChild.kind === "open-response") publicChild.parts[0].interaction = {
    kind: "open-response", questions: structuredClone(publicDocument.parts[0].interaction.questions),
    presentation: { kind: "panels", panels: [oldschoolQuestionPanel(publicDocument.parts[0].interaction)] },
  };
  publicChild.assets = publicChild.assets.filter((asset) => nativeActivityUsesManagedAssetSlot(publicChild, asset.slot));
  return { publicDocument: publicChild, teacherDocument: structuredClone(nativeOldschoolListeningQuestionTeacherDocument(teacherDocument)) };
}

export function writeBackOldschoolQuestionPair(publicDocument, teacherDocument, child) {
  const mode = nativeOldschoolListeningQuestionMode(publicDocument.parts[0].interaction);
  if (child.publicDocument.activityId !== publicDocument.activityId || child.teacherDocument.activityId !== teacherDocument.activityId || child.publicDocument.kind !== mode || child.teacherDocument.kind !== mode) throw new Error("Oldschool question editor scope does not match its parent.");
  const previous = projectOldschoolQuestionPair(publicDocument, teacherDocument);
  const interaction = publicDocument.parts[0].interaction;
  const question = structuredClone(child.publicDocument.parts[0].interaction);
  const panel = mode === "drag-drop" ? question.panels?.[0] : question.presentation?.panels?.[0];
  if (mode !== "single-choice" && (!panel || (mode === "drag-drop" ? question.panels : question.presentation.panels).length !== 1)) throw new Error("Keep exactly one Oldschool question canvas.");
  if (mode === "open-response") {
    if (panel.id !== NATIVE_OPEN_RESPONSE_LEGACY_PANEL_ID) throw new Error("Oldschool Open Response panel identity cannot change.");
    interaction.questions = question.questions;
    interaction.artwork = panel.images.map((image) => ({ ...image, id: image.id.replace(/^img-/, "art-") }));
    interaction.questionSurface = { promptQuestionIds: nativeOpenResponsePanelPromptIds(panel), responseQuestionIds: nativeOpenResponsePanelResponseIds(panel) };
  } else if (mode === "drag-drop") interaction.questionInteraction = question;
  else {
    interaction.questions = question.questions;
    if (question.presentation) interaction.presentation = question.presentation; else delete interaction.presentation;
  }
  if (panel?.surface) {
    const outer = interaction.panels[0];
    if (outer.sourceWidth !== panel.surface.width || outer.sourceHeight !== panel.surface.height) {
      // Existing hotspots retain their source coordinates. Reject destructive
      // resizing instead of silently moving or dropping authored hotspots.
      const areas = [...interaction.snippetHotspots.map((hotspot) => hotspot.area), ...(publicDocument.audioTextHotspots?.hotspots || []).map((hotspot) => hotspot.activityArea)];
      if (areas.some((area) => area.x + area.width > panel.surface.width || area.y + area.height > panel.surface.height)) throw new Error("Move the listening/readable hotspots inside the new canvas before resizing.");
      outer.sourceWidth = panel.surface.width; outer.sourceHeight = panel.surface.height;
    }
  }
  const solution = structuredClone(child.teacherDocument.parts[0].solution);
  teacherDocument.parts[0].solution = { ...solution, kind: "oldschool-listening", questionMode: mode };
  for (const asset of child.publicDocument.assets) publicDocument.assets = mergeNativeManagedAssetReference(publicDocument.assets, asset);
  for (const asset of previous.publicDocument.assets) removeNativeManagedAssetReferenceIfUnused(publicDocument, asset.slot);
}
