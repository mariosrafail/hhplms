import { normalizeOldschoolTypography, normalizeOldschoolRuns, oldschoolTranscriptFontSlots, oldschoolQuestionAssets, validateOldschoolTranscriptBudget } from "./nativeOldschoolListeningTypography.js";
import { normalizeOldschoolQuestionSurface, oldschoolQuestionPanel } from "./nativeOldschoolQuestionSurface.js";
import { isNativeChildId } from "./nativeChildIdentity.js";
import {
  assessNativeOpenResponseReadiness,
  createNativeOpenResponseQuestion,
  initialNativeOpenResponseArtworkArea,
  nativeOpenResponseAssetRequirements,
  normalizeNativeOpenResponseInteraction,
  normalizeNativeOpenResponseSolution,
  validateNativeOpenResponseTopology,
} from "./nativeOpenResponse.js";
import {
  assessNativeSingleChoiceReadiness,
  nativeSingleChoicePresentationAssetRequirements,
  normalizeNativeSingleChoiceInteraction,
  normalizeNativeSingleChoiceSolution,
  validateNativeSingleChoiceTopology,
} from "./nativeSingleChoice.js";
import { normalizeNativePedagogicalText, normalizeNativeSingleLineText } from "./nativePedagogicalText.js";

import { normalizeNativeDragDropInteraction, normalizeNativeDragDropSolution, validateNativeDragDropTopology, assessNativeDragDropReadiness, nativeDragDropAssetRequirements } from "./nativeDragDrop.js";

export const NATIVE_OLDSCHOOL_LISTENING_LIMITS = Object.freeze({
  questions: 20,
  cues: 500,
  regionsPerCue: 24,
  regionsTotal: 4_000,
  snippets: 32,
  promptLength: 2_000,
  answerLength: 5_000,
  cueTextLength: 4_000,
  pageAltTextLength: 2_000,
  snippetLabelLength: 160,
  durationMs: 99 * 60 * 60 * 1_000,
  sourceDimension: 16_384,
});

export const NATIVE_OLDSCHOOL_LISTENING_PANEL_IDS = Object.freeze(["panel-1", "panel-2"]);
export const NATIVE_OLDSCHOOL_LISTENING_QUESTION_MODES = Object.freeze(["open-response", "single-choice", "drag-drop"]);

export function nativeOldschoolListeningQuestionMode(interaction) {
  const mode = interaction && Object.hasOwn(interaction, "questionMode") ? interaction.questionMode : "open-response";
  if (!NATIVE_OLDSCHOOL_LISTENING_QUESTION_MODES.includes(mode)) throw new Error("Oldschool Listening question mode is invalid.");
  return mode;
}

export function initialNativeOldschoolListeningArtworkArea(surface, metadata, artworkCount = 0) {
  if (artworkCount === 0 && metadata?.width === surface.width && metadata?.height === surface.height) return { x: 0, y: 0, width: surface.width, height: surface.height };
  return initialNativeOpenResponseArtworkArea(surface, metadata);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(object(value, label)).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} has missing or unknown fields.`);
}

function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} is invalid.`);
  return value;
}

function area(input, label, surface) {
  exactKeys(input, ["x", "y", "width", "height"], label);
  const value = Object.fromEntries(Object.entries(input).map(([key, entry]) => [key, integer(entry, `${label}.${key}`, key === "width" || key === "height" ? 1 : 0, key === "x" || key === "width" ? surface.width : surface.height)]));
  if (value.x + value.width > surface.width || value.y + value.height > surface.height) throw new Error(`${label} must stay inside its source surface.`);
  return value;
}

function normalizeLegacyQuestion(input, index) {
  const label = `Oldschool Listening questions[${index}]`;
  exactKeys(input, ["id", "prompt"], label);
  if (!isNativeChildId(input.id, "q")) throw new Error(`${label}.id is invalid.`);
  return { ...createNativeOpenResponseQuestion(input.id, index), prompt: normalizeNativePedagogicalText(input.prompt, `${label}.prompt`, NATIVE_OLDSCHOOL_LISTENING_LIMITS.promptLength, { forbidMarkup: false }) };
}

function normalizeRegion(input, cueIndex, regionIndex, surface, assets) {
  const label = `Oldschool Listening cues[${cueIndex}].highlightRegions[${regionIndex}]`;
  const hasText = Object.hasOwn(input, "text");
  exactKeys(input, ["id", "x", "y", "width", "height", ...(hasText ? ["text"] : []), ...["typography", "runs"].filter((key) => Object.hasOwn(input, key))], label);
  if (!isNativeChildId(input.id, "region")) throw new Error(`${label}.id is invalid.`);
  const text = hasText ? normalizeNativePedagogicalText(input.text, `${label}.text`, NATIVE_OLDSCHOOL_LISTENING_LIMITS.cueTextLength, { required: true, forbidMarkup: false }) : null;
  if (!hasText && (Object.hasOwn(input, "typography") || Object.hasOwn(input, "runs"))) throw new Error(`${label} typography requires exact region text.`);
  return { id: input.id, ...area({ x: input.x, y: input.y, width: input.width, height: input.height }, label, surface), ...(hasText ? { text } : {}),
    ...(Object.hasOwn(input, "typography") ? { typography: normalizeOldschoolTypography(input.typography, { assets, label }) } : {}),
    ...(Object.hasOwn(input, "runs") ? { runs: normalizeOldschoolRuns(input.runs, text, assets, label) } : {}),
  };
}

function normalizeCue(input, index, surface, assets) {
  const label = `Oldschool Listening cues[${index}]`;
  exactKeys(input, ["id", "startMs", "endMs", "text", "highlightRegions", "scrollY"], label);
  if (!isNativeChildId(input.id, "cue")) throw new Error(`${label}.id is invalid.`);
  const startMs = integer(input.startMs, `${label}.startMs`, 0, NATIVE_OLDSCHOOL_LISTENING_LIMITS.durationMs);
  const endMs = integer(input.endMs, `${label}.endMs`, 1, NATIVE_OLDSCHOOL_LISTENING_LIMITS.durationMs);
  if (endMs <= startMs) throw new Error(`${label} must end after it starts.`);
  if (!Array.isArray(input.highlightRegions) || input.highlightRegions.length > NATIVE_OLDSCHOOL_LISTENING_LIMITS.regionsPerCue) throw new Error(`${label}.highlightRegions count is invalid.`);
  const regions = input.highlightRegions.map((region, regionIndex) => normalizeRegion(region, index, regionIndex, surface, assets));
  if (regions.some((region) => region.typography || region.runs) && !regions.every((region) => typeof region.text === "string")) throw new Error(`${label} typography requires exact text in every region; partial mappings retain the legacy fallback.`);
  if (new Set(regions.map((region) => region.id)).size !== regions.length) throw new Error(`${label}.highlightRegions identities must be unique.`);
  const scrollY = input.scrollY === null ? null : integer(input.scrollY, `${label}.scrollY`, 0, surface.height);
  return { id: input.id, startMs, endMs, text: normalizeNativePedagogicalText(input.text, `${label}.text`, NATIVE_OLDSCHOOL_LISTENING_LIMITS.cueTextLength, { required: true, forbidMarkup: false }), highlightRegions: regions, scrollY };
}

function normalizeSnippet(input, index, cueIds, surface, assetSlots) {
  const label = `Oldschool Listening snippetHotspots[${index}]`;
  exactKeys(input, ["id", "area", "cueIds", "label", "audioAssetSlot"], label);
  if (!isNativeChildId(input.id, "aud")) throw new Error(`${label}.id is invalid.`);
  if (!Array.isArray(input.cueIds) || !input.cueIds.length || input.cueIds.some((id) => !cueIds.has(id)) || new Set(input.cueIds).size !== input.cueIds.length) throw new Error(`${label}.cueIds are invalid.`);
  const audioAssetSlot = normalizeNativeSingleLineText(input.audioAssetSlot, `${label}.audioAssetSlot`, 128, { forbidMarkup: false });
  if (audioAssetSlot && !assetSlots.has(audioAssetSlot)) throw new Error(`${label}.audioAssetSlot must reference managed native audio.`);
  return { id: input.id, area: area(input.area, `${label}.area`, surface), cueIds: [...input.cueIds], label: normalizeNativeSingleLineText(input.label, `${label}.label`, NATIVE_OLDSCHOOL_LISTENING_LIMITS.snippetLabelLength, { required: true, forbidMarkup: false }), audioAssetSlot };
}

export function normalizeNativeOldschoolListeningInteraction(input, { assets = [], commonAssetSlots = new Set() } = {}) {
  object(input, "Oldschool Listening interaction");
  if (new TextEncoder().encode(JSON.stringify(input)).length > 1024 * 1024) throw new Error("Oldschool Listening document exceeds 1 MiB.");
  const value = structuredClone(input);
  const hasQuestionMode = Object.hasOwn(value, "questionMode");
  const questionMode = hasQuestionMode ? value.questionMode : "open-response";
  if (!NATIVE_OLDSCHOOL_LISTENING_QUESTION_MODES.includes(questionMode)) throw new Error("Oldschool Listening question mode is invalid.");
  const legacyQuestions = questionMode === "open-response" && !Object.hasOwn(value, "artwork");
  const hasQuestionSurface = questionMode === "open-response" && Object.hasOwn(value, "questionSurface");
  const hasPresentation = questionMode === "single-choice" && Object.hasOwn(value, "presentation");
  if (hasPresentation && (!Array.isArray(value.presentation?.panels) || value.presentation.panels.length !== 1)) throw new Error("Oldschool Listening Multiple Choice visual presentation must use the fixed Panel 1 surface.");
  exactKeys(value, ["kind", ...(hasQuestionMode ? ["questionMode"] : []), "audioAssetSlot", "audioDurationMs", "panels", ...(questionMode === "open-response" && !legacyQuestions ? ["artwork"] : []), ...(questionMode === "drag-drop" ? ["questionInteraction"] : ["questions"]), ...(hasQuestionSurface ? ["questionSurface"] : []), ...(hasPresentation ? ["presentation"] : []), "cues", "snippetHotspots"], "Oldschool Listening interaction");
  if (value.kind !== "oldschool-listening") throw new Error("Oldschool Listening interaction kind is invalid.");
  if (questionMode !== "drag-drop" && (!Array.isArray(value.questions) || value.questions.length > NATIVE_OLDSCHOOL_LISTENING_LIMITS.questions)) throw new Error("Oldschool Listening question count is invalid.");
  if (!Array.isArray(value.cues) || value.cues.length > NATIVE_OLDSCHOOL_LISTENING_LIMITS.cues) throw new Error("Oldschool Listening cue count is invalid.");
  if (!Array.isArray(value.snippetHotspots) || value.snippetHotspots.length > NATIVE_OLDSCHOOL_LISTENING_LIMITS.snippets) throw new Error("Oldschool Listening snippet count is invalid.");
  if (!Array.isArray(value.panels) || value.panels.length !== 2) throw new Error("Oldschool Listening requires exactly Panel 1 and Panel 2.");
  const assetSlots = new Set(assets.map((asset) => asset.slot));
  if (value.audioAssetSlot && !assetSlots.has(value.audioAssetSlot)) throw new Error("Oldschool Listening audio must reference a managed asset.");
  const audioDurationMs = integer(value.audioDurationMs, "Oldschool Listening audio duration", 0, NATIVE_OLDSCHOOL_LISTENING_LIMITS.durationMs);
  const panelOne = structuredClone(object(value.panels[0], "Oldschool Listening Panel 1"));
  const panelTwo = structuredClone(object(value.panels[1], "Oldschool Listening Panel 2"));
  exactKeys(panelOne, ["id", "kind", "sourceWidth", "sourceHeight"], "Oldschool Listening Panel 1");
  exactKeys(panelTwo, ["id", "kind", "pageAssetSlot", "sourceWidth", "sourceHeight", "altText"], "Oldschool Listening Panel 2");
  if (panelOne.id !== "panel-1" || panelOne.kind !== "questions" || panelTwo.id !== "panel-2" || panelTwo.kind !== "synchronized-page") throw new Error("Oldschool Listening panel identity or order is invalid.");
  const normalizeSurface = (panel, label) => ({ width: integer(panel.sourceWidth, `${label}.sourceWidth`, 1, NATIVE_OLDSCHOOL_LISTENING_LIMITS.sourceDimension), height: integer(panel.sourceHeight, `${label}.sourceHeight`, 1, NATIVE_OLDSCHOOL_LISTENING_LIMITS.sourceDimension) });
  const surfaceOne = normalizeSurface(panelOne, "Oldschool Listening Panel 1");
  const surfaceTwo = normalizeSurface(panelTwo, "Oldschool Listening Panel 2");
  if (panelTwo.pageAssetSlot && !assetSlots.has(panelTwo.pageAssetSlot)) throw new Error("Oldschool Listening page must reference a managed asset.");
  const sharedAssetSlots = new Set([...commonAssetSlots, value.audioAssetSlot, panelTwo.pageAssetSlot, ...value.snippetHotspots.map((hotspot) => hotspot?.audioAssetSlot)].filter(Boolean));
  const cues = value.cues.map((cue, index) => normalizeCue(cue, index, surfaceTwo, assets));
  validateOldschoolTranscriptBudget({ cues });
  const questionAssets = oldschoolQuestionAssets({ ...value, cues }, assets);
  const questionSurface = questionMode === "drag-drop"
    ? normalizeNativeDragDropInteraction(value.questionInteraction, { assets: questionAssets, commonAssetSlots: sharedAssetSlots })
    : questionMode === "open-response"
    ? normalizeNativeOpenResponseInteraction({ kind: "open-response", surface: surfaceOne, artwork: legacyQuestions ? [] : value.artwork, questions: legacyQuestions ? value.questions.map(normalizeLegacyQuestion) : value.questions }, { assets: questionAssets, commonAssetSlots: sharedAssetSlots })
    : normalizeNativeSingleChoiceInteraction({ kind: "single-choice", questions: value.questions, ...(hasPresentation ? { presentation: value.presentation } : {}) }, { assets: questionAssets, commonAssetSlots: sharedAssetSlots });
  if (questionMode === "drag-drop" && (questionSurface.panels.length !== 1 || questionSurface.panels[0].surface.width !== surfaceOne.width || questionSurface.panels[0].surface.height !== surfaceOne.height)) throw new Error("Oldschool Listening Drag & Drop requires one question canvas matching Panel 1 dimensions.");
  const cueIds = cues.map((cue) => cue.id);
  if (new Set(cueIds).size !== cueIds.length) throw new Error("Oldschool Listening cue identities must be unique.");
  const regionIds = cues.flatMap((cue) => cue.highlightRegions.map((region) => region.id));
  if (regionIds.length > NATIVE_OLDSCHOOL_LISTENING_LIMITS.regionsTotal || new Set(regionIds).size !== regionIds.length) throw new Error("Oldschool Listening highlight region identities are invalid or exceed the limit.");
  cues.forEach((cue, index) => {
    if (index && cue.startMs < cues[index - 1].endMs) throw new Error("Oldschool Listening cues must be ordered and non-overlapping.");
    if (audioDurationMs && cue.endMs > audioDurationMs) throw new Error("Oldschool Listening cue exceeds the audio duration.");
  });
  const cueIdSet = new Set(cueIds);
  const snippets = value.snippetHotspots.map((entry, index) => normalizeSnippet(entry, index, cueIdSet, surfaceOne, assetSlots));
  if (new Set(snippets.map((entry) => entry.id)).size !== snippets.length) throw new Error("Oldschool Listening snippet identities must be unique.");
  return {
    kind: "oldschool-listening",
    questionMode,
    audioAssetSlot: value.audioAssetSlot,
    audioDurationMs,
    panels: [
      { id: "panel-1", kind: "questions", sourceWidth: surfaceOne.width, sourceHeight: surfaceOne.height },
      { id: "panel-2", kind: "synchronized-page", pageAssetSlot: panelTwo.pageAssetSlot, sourceWidth: surfaceTwo.width, sourceHeight: surfaceTwo.height, altText: normalizeNativePedagogicalText(panelTwo.altText, "Oldschool Listening page alt text", NATIVE_OLDSCHOOL_LISTENING_LIMITS.pageAltTextLength, { required: Boolean(panelTwo.pageAssetSlot), forbidMarkup: false }) },
    ],
    ...(questionMode === "open-response" ? { artwork: questionSurface.artwork } : {}),
    ...(questionMode === "drag-drop" ? { questionInteraction: questionSurface } : { questions: questionSurface.questions }),
    ...(hasQuestionSurface ? { questionSurface: normalizeOldschoolQuestionSurface(value.questionSurface, questionSurface.questions) } : {}),
    ...(questionMode === "single-choice" && questionSurface.presentation ? { presentation: questionSurface.presentation } : {}),
    cues,
    snippetHotspots: snippets,
  };
}

export function normalizeNativeOldschoolListeningSolution(input) {
  const value = structuredClone(object(input, "Oldschool Listening Teacher solution"));
  const hasQuestionMode = Object.hasOwn(value, "questionMode");
  const questionMode = hasQuestionMode ? value.questionMode : "open-response";
  if (!NATIVE_OLDSCHOOL_LISTENING_QUESTION_MODES.includes(questionMode)) throw new Error("Oldschool Listening Teacher question mode is invalid.");
  exactKeys(value, ["kind", ...(hasQuestionMode ? ["questionMode"] : []), questionMode === "drag-drop" ? "mappings" : questionMode === "open-response" ? "modelAnswers" : "correctAnswers"], "Oldschool Listening Teacher solution");
  if (value.kind !== "oldschool-listening") throw new Error("Oldschool Listening Teacher solution is invalid.");
  const normalized = questionMode === "drag-drop"
    ? normalizeNativeDragDropSolution({ kind: "drag-drop", mappings: value.mappings })
    : questionMode === "open-response"
    ? normalizeNativeOpenResponseSolution({ kind: "open-response", modelAnswers: value.modelAnswers })
    : normalizeNativeSingleChoiceSolution({ kind: "single-choice", correctAnswers: value.correctAnswers });
  return { kind: "oldschool-listening", questionMode, ...(questionMode === "drag-drop" ? { mappings: normalized.mappings } : questionMode === "open-response" ? { modelAnswers: normalized.modelAnswers } : { correctAnswers: normalized.correctAnswers }) };
}

export function nativeOldschoolListeningQuestionPublicDocument(publicDocument) {
  const interaction = publicDocument.parts[0].interaction;
  const questionMode = nativeOldschoolListeningQuestionMode(interaction);
  return {
    ...publicDocument,
    assets: oldschoolQuestionAssets(interaction, publicDocument.assets || []),
    kind: questionMode,
    parts: [{ ...publicDocument.parts[0], interaction: questionMode === "drag-drop" ? interaction.questionInteraction : questionMode === "open-response"
      ? interaction.questionSurface
        ? { kind: "open-response", questions: interaction.questions, presentation: { kind: "panels", panels: [oldschoolQuestionPanel(interaction)] } }
        : { kind: "open-response", surface: { width: interaction.panels[0].sourceWidth, height: interaction.panels[0].sourceHeight }, artwork: interaction.artwork || [], questions: interaction.questions }
      : { kind: "single-choice", questions: interaction.questions, ...(interaction.presentation ? { presentation: interaction.presentation } : {}) } }],
  };
}

export function nativeOldschoolListeningQuestionTeacherDocument(teacherDocument) {
  if (!teacherDocument) return null;
  const solution = teacherDocument.parts[0].solution;
  const questionMode = nativeOldschoolListeningQuestionMode(solution);
  return { ...teacherDocument, kind: questionMode, parts: [{ ...teacherDocument.parts[0], solution: questionMode === "drag-drop" ? { kind: "drag-drop", mappings: solution.mappings } : questionMode === "open-response" ? { kind: "open-response", modelAnswers: solution.modelAnswers } : { kind: "single-choice", correctAnswers: solution.correctAnswers } }] };
}

export function validateNativeOldschoolListeningTopology(publicDocument, teacherDocument) {
  const publicMode = nativeOldschoolListeningQuestionMode(publicDocument.parts[0].interaction);
  const teacherMode = nativeOldschoolListeningQuestionMode(teacherDocument.parts[0].solution);
  if (publicMode !== teacherMode) throw new Error("Oldschool Listening public and Teacher question modes must match.");
  const projectedPublic = nativeOldschoolListeningQuestionPublicDocument(publicDocument);
  const projectedTeacher = nativeOldschoolListeningQuestionTeacherDocument(teacherDocument);
  return publicMode === "drag-drop" ? validateNativeDragDropTopology(projectedPublic, projectedTeacher) : publicMode === "open-response" ? validateNativeOpenResponseTopology(projectedPublic, projectedTeacher) : validateNativeSingleChoiceTopology(projectedPublic, projectedTeacher);
}

export function nativeOldschoolListeningAssetRequirements(publicDocument) {
  const interaction = publicDocument?.parts?.[0]?.interaction;
  if (interaction?.kind !== "oldschool-listening") return [];
  const panelTwo = interaction.panels[1];
  const questionDocument = nativeOldschoolListeningQuestionPublicDocument(publicDocument);
  return [
    ...[...oldschoolTranscriptFontSlots(interaction)].map((slot) => ({ slot, mediaType: "font/ttf", label: "Oldschool Listening transcript font" })),
    ...(interaction.audioAssetSlot ? [{ slot: interaction.audioAssetSlot, mediaType: "audio/mpeg", label: "Oldschool Listening MP3" }] : []),
    ...(panelTwo?.pageAssetSlot ? [{ slot: panelTwo.pageAssetSlot, width: panelTwo.sourceWidth, height: panelTwo.sourceHeight, label: "Oldschool Listening page image" }] : []),
    ...interaction.snippetHotspots.filter((hotspot) => hotspot.audioAssetSlot).map((hotspot, index) => ({ slot: hotspot.audioAssetSlot, mediaType: "audio/mpeg", label: `Oldschool Listening hotspot MP3 ${index + 1}` })),
    ...(nativeOldschoolListeningQuestionMode(interaction) === "drag-drop" ? nativeDragDropAssetRequirements(questionDocument) : nativeOldschoolListeningQuestionMode(interaction) === "open-response" ? nativeOpenResponseAssetRequirements(questionDocument) : nativeSingleChoicePresentationAssetRequirements(questionDocument)),
  ];
}

export function assessNativeOldschoolListeningReadiness(publicDocument, teacherDocument) {
  const issues = [];
  const interaction = publicDocument.parts[0].interaction;
  const panelTwo = interaction.panels[1];
  if (!interaction.audioAssetSlot) issues.push("Upload an Oldschool Listening MP3.");
  if (!interaction.audioDurationMs) issues.push("Listening audio duration is unavailable.");
  if (!panelTwo.pageAssetSlot) issues.push("Upload the Panel 2 page image.");
  if (panelTwo.pageAssetSlot && !panelTwo.altText.trim()) issues.push("Add accessible alt text for the Panel 2 page image.");
  if (!interaction.cues.length) issues.push("Add or import at least one timed cue.");
  interaction.cues.forEach((cue, index) => {
    if (!Number.isInteger(cue.startMs) || !Number.isInteger(cue.endMs) || cue.startMs < 0 || cue.endMs <= cue.startMs) issues.push(`Cue ${index + 1} needs a valid start and end time.`);
    if (index && cue.startMs < interaction.cues[index - 1].endMs) issues.push(`Cue ${index + 1} overlaps the previous cue.`);
    if (interaction.audioDurationMs && cue.endMs > interaction.audioDurationMs) issues.push(`Cue ${index + 1} extends beyond the listening audio.`);
    if (!cue.text.trim()) issues.push(`Cue ${index + 1} needs text.`);
    if (!cue.highlightRegions.length) issues.push(`Cue ${index + 1} needs at least one page highlight region.`);
    cue.highlightRegions.forEach((region, regionIndex) => {
      if (![region.x, region.y, region.width, region.height].every(Number.isInteger)
        || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
        || region.x + region.width > panelTwo.sourceWidth || region.y + region.height > panelTwo.sourceHeight) {
        issues.push(`Cue ${index + 1} highlight region ${regionIndex + 1} must stay inside the page image.`);
      }
    });
    if (cue.scrollY !== null && (cue.scrollY < 0 || cue.scrollY > panelTwo.sourceHeight)) issues.push(`Cue ${index + 1} has an invalid scroll target.`);
  });
  const questionDocument = nativeOldschoolListeningQuestionPublicDocument(publicDocument);
  const questionTeacher = nativeOldschoolListeningQuestionTeacherDocument(teacherDocument);
  const questionReadiness = nativeOldschoolListeningQuestionMode(interaction) === "drag-drop"
    ? assessNativeDragDropReadiness(questionDocument, questionTeacher)
    : nativeOldschoolListeningQuestionMode(interaction) === "open-response"
    ? assessNativeOpenResponseReadiness(questionDocument, questionTeacher)
    : assessNativeSingleChoiceReadiness(questionDocument, questionTeacher);
  issues.push(...questionReadiness.issues.map((issue) => issue === "Add at least one question." ? "Add at least one Panel 1 question." : issue));
  return { ready: issues.length === 0, issues };
}

export function createEmptyNativeOldschoolListeningInteraction() {
  return {
    kind: "oldschool-listening",
    questionMode: "open-response",
    audioAssetSlot: "",
    audioDurationMs: 0,
    panels: [
      { id: "panel-1", kind: "questions", sourceWidth: 1024, sourceHeight: 582 },
      { id: "panel-2", kind: "synchronized-page", pageAssetSlot: "", sourceWidth: 1024, sourceHeight: 1400, altText: "" },
    ],
    artwork: [],
    questions: [],
    cues: [],
    snippetHotspots: [],
  };
}
