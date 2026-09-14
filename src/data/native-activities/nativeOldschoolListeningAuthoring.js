import { createNativeChildId } from "./nativeChildIdentity.js";
import { removeNativeManagedAssetReferenceIfUnused } from "./nativeActivityPublic.js";
import { NATIVE_OLDSCHOOL_LISTENING_QUESTION_MODES, nativeOldschoolListeningQuestionMode } from "./nativeOldschoolListening.js";

import { createEmptyNativeDragDropInteraction } from "./nativeDragDrop.js";

export function switchNativeOldschoolListeningQuestionMode(publicDocument, teacherDocument, requestedMode) {
  if (!NATIVE_OLDSCHOOL_LISTENING_QUESTION_MODES.includes(requestedMode)) throw new Error("Oldschool Listening question mode is invalid.");
  const interaction = publicDocument?.parts?.[0]?.interaction;
  const solution = teacherDocument?.parts?.[0]?.solution;
  if (interaction?.kind !== "oldschool-listening" || solution?.kind !== "oldschool-listening") throw new Error("Oldschool Listening document pair is required.");
  if (nativeOldschoolListeningQuestionMode(interaction) === requestedMode) return false;
  const incompatibleSlots = publicDocument.assets.map((asset) => asset.slot);
  interaction.questionMode = requestedMode;
  delete interaction.questions;
  delete interaction.artwork;
  delete interaction.presentation;
  delete interaction.questionSurface;
  delete interaction.questionInteraction;
  if (requestedMode === "drag-drop") {
    interaction.questionInteraction = createEmptyNativeDragDropInteraction();
    interaction.questionInteraction.panels = [{ id: createNativeChildId("panel"), surface: { width: interaction.panels[0].sourceWidth, height: interaction.panels[0].sourceHeight }, images: [], dropTargets: [] }];
  } else {
    interaction.questions = [];
    if (requestedMode === "open-response") interaction.artwork = [];
  }
  teacherDocument.parts[0].solution = { kind: "oldschool-listening", questionMode: requestedMode, [requestedMode === "drag-drop" ? "mappings" : requestedMode === "open-response" ? "modelAnswers" : "correctAnswers"]: [] };
  incompatibleSlots.filter(Boolean).forEach((slot) => removeNativeManagedAssetReferenceIfUnused(publicDocument, slot));
  return true;
}

export function addNativeOldschoolListeningCue(interaction, cue, { createId = () => createNativeChildId("cue") } = {}) {
  const created = {
    id: createId(),
    startMs: Math.round(cue.startMs),
    endMs: Math.round(cue.endMs),
    text: String(cue.text || ""),
    highlightRegions: [],
    scrollY: null,
  };
  interaction.cues.push(created);
  interaction.cues.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs || left.id.localeCompare(right.id));
  return created;
}

export function removeNativeOldschoolListeningCue(interaction, cueId) {
  const index = interaction.cues.findIndex((entry) => entry.id === cueId);
  if (index < 0) throw new Error("Oldschool Listening cue does not exist.");
  const [removed] = interaction.cues.splice(index, 1);
  interaction.snippetHotspots?.forEach((hotspot) => { hotspot.cueIds = hotspot.cueIds.filter((id) => id !== cueId); });
  if (interaction.snippetHotspots) interaction.snippetHotspots = interaction.snippetHotspots.filter((hotspot) => hotspot.cueIds.length);
  return removed;
}

export function addNativeOldschoolListeningRegion(cue, area, { createId = () => createNativeChildId("region") } = {}) {
  const region = { id: createId(), ...Object.fromEntries(Object.entries(area).map(([key, value]) => [key, Math.round(value)])) };
  cue.highlightRegions.push(region);
  return region;
}

export function updateNativeOldschoolListeningRegion(cue, regionId, area) {
  const region = cue.highlightRegions.find((entry) => entry.id === regionId);
  if (!region) throw new Error("Oldschool Listening highlight region does not exist.");
  Object.assign(region, Object.fromEntries(Object.entries(area).map(([key, value]) => [key, Math.round(value)])));
  return region;
}

export function removeNativeOldschoolListeningRegion(cue, regionId) {
  const index = cue.highlightRegions.findIndex((entry) => entry.id === regionId);
  if (index < 0) throw new Error("Oldschool Listening highlight region does not exist.");
  return cue.highlightRegions.splice(index, 1)[0];
}

export function clearNativeOldschoolListeningMappings(interaction) {
  interaction.cues.forEach((cue) => { cue.highlightRegions = []; cue.scrollY = null; });
}
