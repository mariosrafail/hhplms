import { isNativeChildId } from "./nativeChildIdentity.js";
import { normalizeNativePedagogicalText } from "./nativePedagogicalText.js";

const MAX_QUESTIONS = 20;
const MAX_OPTIONS = 10;
export const NATIVE_SINGLE_CHOICE_LIMITS = Object.freeze({
  questions: MAX_QUESTIONS,
  optionsMinimum: 2,
  optionsMaximum: MAX_OPTIONS,
  promptLength: 2_000,
  optionTextLength: 1_000,
  panels: 8,
  // A visual question requires exactly one hotspot for every option.
  hotspots: MAX_QUESTIONS * MAX_OPTIONS,
  sourceDimension: 16_384,
});
export const NATIVE_SINGLE_CHOICE_SELECTION_MODES = Object.freeze(["single", "multiple"]);

export function nativeSingleChoiceSelectionMode(question) {
  return question?.selectionMode === "multiple" ? "multiple" : "single";
}

export function nativeSingleChoiceCorrectOptionIds(answer) {
  return Array.isArray(answer?.correctOptionIds) ? answer.correctOptionIds : typeof answer?.correctOptionId === "string" ? [answer.correctOptionId] : [];
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

function positiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`${label} is invalid.`);
  return value;
}

function normalizeHotspotArea(value, panel, label) {
  exactKeys(value, ["x", "y", "width", "height"], label);
  const area = {
    x: Number(value.x),
    y: Number(value.y),
    width: Number(value.width),
    height: Number(value.height),
  };
  if (![area.x, area.y, area.width, area.height].every(Number.isSafeInteger)
    || area.x < 0 || area.y < 0 || area.width < 1 || area.height < 1
    || area.x + area.width > panel.sourceWidth || area.y + area.height > panel.sourceHeight) {
    throw new Error(`${label} is outside its source image.`);
  }
  return area;
}

function normalizeNativeSingleChoicePresentation(input, { questions, assets }) {
  const value = structuredClone(object(input, "Native Single Choice presentation"));
  exactKeys(value, ["kind", "panels"], "Native Single Choice presentation");
  if (value.kind !== "image-hotspot" || !Array.isArray(value.panels) || value.panels.length < 1 || value.panels.length > NATIVE_SINGLE_CHOICE_LIMITS.panels) {
    throw new Error("Native Single Choice presentation is invalid.");
  }
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const assetSlots = new Set((assets || []).map((asset) => asset.slot));
  const panelIds = new Set();
  const hotspotIds = new Set();
  return {
    kind: "image-hotspot",
    panels: value.panels.map((entry, panelIndex) => {
      const label = `Native Single Choice panels[${panelIndex}]`;
      exactKeys(entry, ["id", "backgroundAssetSlot", "sourceWidth", "sourceHeight", "hotspots"], label);
      if (!isNativeChildId(entry.id, "panel") || panelIds.has(entry.id) || !assetSlots.has(entry.backgroundAssetSlot) || !Array.isArray(entry.hotspots) || entry.hotspots.length > NATIVE_SINGLE_CHOICE_LIMITS.hotspots) {
        throw new Error(`${label} is invalid.`);
      }
      panelIds.add(entry.id);
      const panel = {
        id: entry.id,
        backgroundAssetSlot: entry.backgroundAssetSlot,
        sourceWidth: positiveInteger(entry.sourceWidth, `${label}.sourceWidth`, NATIVE_SINGLE_CHOICE_LIMITS.sourceDimension),
        sourceHeight: positiveInteger(entry.sourceHeight, `${label}.sourceHeight`, NATIVE_SINGLE_CHOICE_LIMITS.sourceDimension),
      };
      return {
        ...panel,
        hotspots: entry.hotspots.map((hotspot, hotspotIndex) => {
          const hotspotLabel = `${label}.hotspots[${hotspotIndex}]`;
          const hasHighlightArea = Object.hasOwn(hotspot, "highlightArea");
          exactKeys(hotspot, ["id", "questionId", "optionId", "area", ...(hasHighlightArea ? ["highlightArea"] : [])], hotspotLabel);
          const question = questionById.get(hotspot.questionId);
          if (!isNativeChildId(hotspot.id, "hot") || hotspotIds.has(hotspot.id) || !question || !question.options.some((option) => option.id === hotspot.optionId)) {
            throw new Error(`${hotspotLabel} has an invalid identity or semantic binding.`);
          }
          hotspotIds.add(hotspot.id);
          const normalizedArea = normalizeHotspotArea(hotspot.area, panel, `${hotspotLabel}.area`);
          const highlightArea = hasHighlightArea
            ? normalizeHotspotArea(hotspot.highlightArea, panel, `${hotspotLabel}.highlightArea`)
            : { ...normalizedArea };
          if (highlightArea.x < normalizedArea.x || highlightArea.y < normalizedArea.y
            || highlightArea.x + highlightArea.width > normalizedArea.x + normalizedArea.width
            || highlightArea.y + highlightArea.height > normalizedArea.y + normalizedArea.height) {
            throw new Error(`${hotspotLabel}.highlightArea must stay inside its click area.`);
          }
          return {
            id: hotspot.id,
            questionId: hotspot.questionId,
            optionId: hotspot.optionId,
            area: normalizedArea,
            ...(hasHighlightArea ? { highlightArea } : {}),
          };
        }),
      };
    }),
  };
}

export function normalizeNativeSingleChoiceInteraction(input, { assets = [] } = {}) {
  const value = structuredClone(object(input, "Native Single Choice interaction"));
  const hasPresentation = Object.hasOwn(value, "presentation");
  exactKeys(value, hasPresentation ? ["kind", "questions", "presentation"] : ["kind", "questions"], "Native Single Choice interaction");
  if (value.kind !== "single-choice" || !Array.isArray(value.questions) || value.questions.length > NATIVE_SINGLE_CHOICE_LIMITS.questions) throw new Error("Native Single Choice interaction is invalid.");
  const questionIds = new Set();
  const normalized = {
    kind: "single-choice",
    questions: value.questions.map((entry, questionIndex) => {
      const label = `Native Single Choice questions[${questionIndex}]`;
      const hasSelectionMode = Object.hasOwn(entry, "selectionMode");
      exactKeys(entry, ["id", "prompt", "options", ...(hasSelectionMode ? ["selectionMode"] : [])], label);
      if (!isNativeChildId(entry.id, "q") || questionIds.has(entry.id) || !Array.isArray(entry.options) || entry.options.length > NATIVE_SINGLE_CHOICE_LIMITS.optionsMaximum) throw new Error(`${label} is invalid.`);
      if (hasSelectionMode && !NATIVE_SINGLE_CHOICE_SELECTION_MODES.includes(entry.selectionMode)) throw new Error(`${label}.selectionMode is invalid.`);
      questionIds.add(entry.id);
      const optionIds = new Set();
      return {
        id: entry.id,
        ...(hasSelectionMode ? { selectionMode: entry.selectionMode } : {}),
        prompt: normalizeNativePedagogicalText(entry.prompt, `${label}.prompt`, NATIVE_SINGLE_CHOICE_LIMITS.promptLength),
        options: entry.options.map((option, optionIndex) => {
          const optionLabel = `${label}.options[${optionIndex}]`;
          exactKeys(option, ["id", "text"], optionLabel);
          if (!isNativeChildId(option.id, "opt") || optionIds.has(option.id)) throw new Error(`${optionLabel}.id is invalid or duplicate.`);
          optionIds.add(option.id);
          return { id: option.id, text: normalizeNativePedagogicalText(option.text, `${optionLabel}.text`, NATIVE_SINGLE_CHOICE_LIMITS.optionTextLength) };
        }),
      };
    }),
  };
  if (hasPresentation) normalized.presentation = normalizeNativeSingleChoicePresentation(value.presentation, { questions: normalized.questions, assets });
  return normalized;
}

export function normalizeNativeSingleChoiceSolution(input) {
  const value = structuredClone(object(input, "Native Single Choice Teacher solution"));
  exactKeys(value, ["kind", "correctAnswers"], "Native Single Choice Teacher solution");
  if (value.kind !== "single-choice" || !Array.isArray(value.correctAnswers) || value.correctAnswers.length > NATIVE_SINGLE_CHOICE_LIMITS.questions) throw new Error("Native Single Choice Teacher solution is invalid.");
  const ids = new Set();
  return { kind: "single-choice", correctAnswers: value.correctAnswers.map((answer, index) => {
    const label = `Native Single Choice correctAnswers[${index}]`;
    const collectionShape = Object.hasOwn(answer, "correctOptionIds");
    exactKeys(answer, ["questionId", collectionShape ? "correctOptionIds" : "correctOptionId"], label);
    if (!isNativeChildId(answer.questionId, "q") || ids.has(answer.questionId)) throw new Error(`${label} is invalid or duplicate.`);
    const correctOptionIds = collectionShape ? answer.correctOptionIds : [answer.correctOptionId];
    if (!Array.isArray(correctOptionIds) || !correctOptionIds.length || correctOptionIds.length > NATIVE_SINGLE_CHOICE_LIMITS.optionsMaximum || correctOptionIds.some((id) => !isNativeChildId(id, "opt")) || new Set(correctOptionIds).size !== correctOptionIds.length) throw new Error(`${label} is invalid or duplicate.`);
    ids.add(answer.questionId);
    return collectionShape ? { questionId: answer.questionId, correctOptionIds } : { questionId: answer.questionId, correctOptionId: answer.correctOptionId };
  }) };
}

export function validateNativeSingleChoiceTopology(publicDocument, teacherDocument) {
  const questions = publicDocument.parts[0].interaction.questions;
  const answers = teacherDocument.parts[0].solution.correctAnswers;
  if (questions.length !== answers.length || questions.some((question, index) => {
    const answer = answers[index];
    const correctOptionIds = nativeSingleChoiceCorrectOptionIds(answer);
    const mode = nativeSingleChoiceSelectionMode(question);
    const canonicalOptionIds = question.options.map((option) => option.id).filter((optionId) => correctOptionIds.includes(optionId));
    return question.id !== answer?.questionId
      || correctOptionIds.some((optionId) => !question.options.some((option) => option.id === optionId))
      || canonicalOptionIds.some((optionId, optionIndex) => correctOptionIds[optionIndex] !== optionId)
      || (mode === "single" ? correctOptionIds.length !== 1 : correctOptionIds.length < 2);
  })) {
    throw new Error("Native Single Choice answers must exactly match public question identity, order, and options.");
  }
  const presentation = publicDocument.parts[0].interaction.presentation;
  if (presentation) {
    const expectedBindings = new Set(questions.flatMap((question) => question.options.map((option) => `${question.id}\0${option.id}`)));
    const actualBindings = new Set();
    const questionPanels = new Map();
    for (const panel of presentation.panels) {
      for (const hotspot of panel.hotspots) {
        const binding = `${hotspot.questionId}\0${hotspot.optionId}`;
        if (actualBindings.has(binding)) throw new Error("Native Single Choice visual options must have exactly one hotspot.");
        actualBindings.add(binding);
        const existingPanel = questionPanels.get(hotspot.questionId);
        if (existingPanel && existingPanel !== panel.id) throw new Error("Native Single Choice questions cannot span visual panels.");
        questionPanels.set(hotspot.questionId, panel.id);
      }
    }
    if (actualBindings.size !== expectedBindings.size || [...expectedBindings].some((binding) => !actualBindings.has(binding))) {
      throw new Error("Native Single Choice visual options must have exactly one hotspot.");
    }
  }
  return true;
}

export function assessNativeSingleChoiceReadiness(publicDocument, teacherDocument) {
  const interaction = publicDocument.parts[0].interaction;
  const questions = interaction.questions;
  const answers = new Map(teacherDocument.parts[0].solution.correctAnswers.map((answer) => [answer.questionId, nativeSingleChoiceCorrectOptionIds(answer)]));
  const issues = [];
  if (!questions.length) issues.push("Add at least one question.");
  questions.forEach((question, index) => {
    if (!question.prompt) issues.push(`Question ${index + 1} needs a prompt.`);
    if (question.options.length < NATIVE_SINGLE_CHOICE_LIMITS.optionsMinimum) issues.push(`Question ${index + 1} needs at least two options.`);
    question.options.forEach((option, optionIndex) => { if (!option.text) issues.push(`Question ${index + 1}, option ${optionIndex + 1} needs text.`); });
    const correctOptionIds = answers.get(question.id) || [];
    if (!correctOptionIds.length || correctOptionIds.some((optionId) => !question.options.some((option) => option.id === optionId))) issues.push(`Question ${index + 1} needs a correct option.`);
    else if (nativeSingleChoiceSelectionMode(question) === "multiple" ? correctOptionIds.length < 2 : correctOptionIds.length !== 1) issues.push(`Question ${index + 1} selection mode must match its correct options.`);
  });
  const presentation = interaction.presentation;
  if (presentation) {
    if (presentation.kind !== "image-hotspot") issues.push("Choose a supported visual presentation mode.");
    if (!Array.isArray(presentation.panels) || !presentation.panels.length) issues.push("Add at least one visual panel.");
    const assets = new Map((publicDocument.assets || []).map((asset) => [asset.slot, asset]));
    const questionById = new Map(questions.map((question) => [question.id, question]));
    const bindings = new Map();
    const ids = new Set();
    const questionPanels = new Map();
    for (const [panelIndex, panel] of (presentation.panels || []).entries()) {
      const panelLabel = `Panel ${panelIndex + 1}`;
      if (!isNativeChildId(panel?.id, "panel")) issues.push(`${panelLabel} needs a stable identity.`);
      else if (ids.has(panel.id)) issues.push(`${panelLabel} duplicates another panel identity.`);
      else ids.add(panel.id);
      if (!assets.has(panel?.backgroundAssetSlot)) issues.push(`${panelLabel} needs a managed background image.`);
      if (![panel?.sourceWidth, panel?.sourceHeight].every((dimension) => Number.isSafeInteger(dimension) && dimension > 0 && dimension <= NATIVE_SINGLE_CHOICE_LIMITS.sourceDimension)) issues.push(`${panelLabel} needs valid source image dimensions.`);
      if (!Array.isArray(panel?.hotspots)) issues.push(`${panelLabel} needs a hotspot list.`);
      for (const [hotspotIndex, hotspot] of (panel?.hotspots || []).entries()) {
        const hotspotLabel = `${panelLabel}, hotspot ${hotspotIndex + 1}`;
        if (!isNativeChildId(hotspot?.id, "hot")) issues.push(`${hotspotLabel} needs a stable identity.`);
        else if (ids.has(hotspot.id)) issues.push(`${hotspotLabel} duplicates another identity.`);
        else ids.add(hotspot.id);
        const question = questionById.get(hotspot?.questionId);
        if (!question || !question.options.some((option) => option.id === hotspot?.optionId)) issues.push(`${hotspotLabel} needs a valid question and option binding.`);
        const area = hotspot?.area;
        if (![area?.x, area?.y, area?.width, area?.height].every(Number.isSafeInteger)
          || area.x < 0 || area.y < 0 || area.width < 1 || area.height < 1
          || area.x + area.width > panel.sourceWidth || area.y + area.height > panel.sourceHeight) issues.push(`${hotspotLabel} must stay inside its source image.`);
        const highlightArea = hotspot?.highlightArea || area;
        if (![highlightArea?.x, highlightArea?.y, highlightArea?.width, highlightArea?.height].every(Number.isSafeInteger)
          || highlightArea.x < area?.x || highlightArea.y < area?.y || highlightArea.width < 1 || highlightArea.height < 1
          || highlightArea.x + highlightArea.width > area?.x + area?.width
          || highlightArea.y + highlightArea.height > area?.y + area?.height) issues.push(`${hotspotLabel} highlight must stay inside its click area.`);
        if (question) {
          const binding = `${hotspot.questionId}\0${hotspot.optionId}`;
          bindings.set(binding, (bindings.get(binding) || 0) + 1);
          const existingPanel = questionPanels.get(hotspot.questionId);
          if (existingPanel && existingPanel !== panel.id) issues.push(`Question ${questions.indexOf(question) + 1} cannot span visual panels.`);
          questionPanels.set(hotspot.questionId, panel.id);
        }
      }
    }
    questions.forEach((question, questionIndex) => question.options.forEach((option, optionIndex) => {
      const count = bindings.get(`${question.id}\0${option.id}`) || 0;
      if (count !== 1) issues.push(`Question ${questionIndex + 1}, option ${optionIndex + 1} needs exactly one hotspot.`);
    }));
  }
  return { ready: issues.length === 0, issues };
}

export function nativeSingleChoicePresentationAssetRequirements(publicDocument) {
  const presentation = publicDocument?.parts?.[0]?.interaction?.presentation;
  if (!presentation || presentation.kind !== "image-hotspot" || !Array.isArray(presentation.panels)) return [];
  return presentation.panels.map((panel) => ({ slot: panel.backgroundAssetSlot, width: panel.sourceWidth, height: panel.sourceHeight }));
}

export function createNativeSingleChoiceQuestion(questionId, optionIds) {
  if (!isNativeChildId(questionId, "q") || !Array.isArray(optionIds) || optionIds.length < 2 || optionIds.some((id) => !isNativeChildId(id, "opt"))) throw new Error("Native Single Choice child identities are invalid.");
  return { id: questionId, prompt: "", options: optionIds.map((id) => ({ id, text: "" })) };
}
