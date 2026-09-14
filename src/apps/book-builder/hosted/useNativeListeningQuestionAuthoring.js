import { projectOldschoolQuestionPair, writeBackOldschoolQuestionPair } from "../../../data/native-activities/nativeOldschoolQuestionBinding.js";
import { resizeNativeDragDropAudioTextHotspots } from "../../../data/native-activities/nativeDragDrop.js";
import { useState } from "react";

import { createNativeChildId } from "../../../data/native-activities/nativeChildIdentity.js";
import { generateNativeBulkCandidate } from "../../../data/native-activities/nativeBulkAuthoring.js";
import { mergeNativeManagedAssetReference, removeNativeManagedAssetReferenceIfUnused } from "../../../data/native-activities/nativeActivityPublic.js";
import { nativeOldschoolListeningQuestionMode } from "../../../data/native-activities/nativeOldschoolListening.js";
import { switchNativeOldschoolListeningQuestionMode } from "../../../data/native-activities/nativeOldschoolListeningAuthoring.js";
import { createNativeOpenResponseQuestion } from "../../../data/native-activities/nativeOpenResponse.js";
import { createNativeSingleChoiceQuestion, nativeSingleChoiceCorrectOptionIds } from "../../../data/native-activities/nativeSingleChoice.js";
import { generateNativeSingleChoiceHotspotImportCandidate } from "../../../data/native-activities/nativeSingleChoiceHotspotBulkAuthoring.js";
import { alignNativeSingleChoiceAnswers, createNativeSingleChoiceHotspotArea, enableNativeSingleChoiceVisualPresentation, findNextUnusedNativeSingleChoiceBinding, removeNativeSingleChoiceOption, removeNativeSingleChoiceQuestion, removeNativeSingleChoiceVisualPresentation, setNativeSingleChoiceCorrectAnswers, setNativeSingleChoiceHotspotArea } from "../../../data/native-activities/nativeSingleChoiceAuthoring.js";
import { uploadNativeActivityAsset } from "./builderNativeActivityApi.js";

const clone = (value) => structuredClone(value);
const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

function mutateProjectedSingleChoice(nextPublic, nextTeacher, mutator) {
  const projected = projectOldschoolQuestionPair(nextPublic, nextTeacher);
  mutator(projected.publicDocument, projected.teacherDocument);
  writeBackOldschoolQuestionPair(nextPublic, nextTeacher, projected);
}

export function useNativeListeningQuestionAuthoring({ oldschool, publicDraft, teacherDraft, setPublicDraft, setTeacherDraft, mutatePublic, mutatePair, changed, interaction, questions, selectedQuestion, selectedQuestionId, setSelectedQuestionId, setQuestionSelection, bookSlug, componentSlug, activityId, uploading, setUploading, setState, previewAssetUrl }) {
  const [selectedPanelId, setSelectedPanelId] = useState(null);
  const [selectedHotspotId, setSelectedHotspotId] = useState(null);
  const [hotspotBinding, setHotspotBinding] = useState("");
  const [zoom, setZoom] = useState(1);
  const questionMode = oldschool ? nativeOldschoolListeningQuestionMode(interaction) : "open-response";
  const presentation = questionMode === "single-choice" ? interaction?.presentation || null : null;
  const panels = presentation?.panels || [];
  const selectedPanel = panels.find((panel) => panel.id === selectedPanelId) || panels[0] || null;
  const selectedHotspot = selectedPanel?.hotspots.find((hotspot) => hotspot.id === selectedHotspotId) || null;

  const addQuestion = () => {
    const id = createNativeChildId("q");
    mutatePair((nextPublic, nextTeacher) => {
      const current = nextPublic.parts[0].interaction;
      if (questionMode === "single-choice") {
        current.questions.push(createNativeSingleChoiceQuestion(id, [createNativeChildId("opt"), createNativeChildId("opt")]));
        mutateProjectedSingleChoice(nextPublic, nextTeacher, alignNativeSingleChoiceAnswers);
      } else {
        current.questions.push(createNativeOpenResponseQuestion(id, current.questions.length));
        if (current.questionSurface) { current.questionSurface.promptQuestionIds.push(id); current.questionSurface.responseQuestionIds.push(id); }
        nextTeacher.parts[0].solution.modelAnswers.push({ questionId: id, text: "" });
      }
    });
    setSelectedQuestionId(id); setQuestionSelection(questionMode === "open-response" ? { type: "prompt", id } : null);
  };
  const removeQuestion = () => {
    if (!selectedQuestion || !globalThis.confirm(questionMode === "single-choice" ? "Delete this question, its private answer, and its hotspots?" : "Delete this question and its Teacher model answer?")) return;
    const index = questions.indexOf(selectedQuestion);
    mutatePair((nextPublic, nextTeacher) => {
      if (questionMode === "single-choice") mutateProjectedSingleChoice(nextPublic, nextTeacher, (projectedPublic, projectedTeacher) => removeNativeSingleChoiceQuestion(projectedPublic, projectedTeacher, selectedQuestion.id));
      else {
        nextPublic.parts[0].interaction.questions = nextPublic.parts[0].interaction.questions.filter((entry) => entry.id !== selectedQuestion.id);
        nextTeacher.parts[0].solution.modelAnswers = nextTeacher.parts[0].solution.modelAnswers.filter((entry) => entry.questionId !== selectedQuestion.id);
        const membership = nextPublic.parts[0].interaction.questionSurface;
        if (membership) for (const key of ["promptQuestionIds", "responseQuestionIds"]) membership[key] = membership[key].filter((id) => id !== selectedQuestion.id);
      }
    });
    setSelectedQuestionId(questions[index + 1]?.id || questions[index - 1]?.id || null); setQuestionSelection(null);
  };
  const moveQuestion = (offset) => mutatePair((nextPublic, nextTeacher) => {
    const publicItems = nextPublic.parts[0].interaction.questions;
    const teacherItems = questionMode === "single-choice" ? nextTeacher.parts[0].solution.correctAnswers : nextTeacher.parts[0].solution.modelAnswers;
    const index = publicItems.findIndex((entry) => entry.id === selectedQuestionId); const target = index + offset;
    if (target < 0 || target >= publicItems.length) return;
    [publicItems[index], publicItems[target]] = [publicItems[target], publicItems[index]];
    if (questionMode === "single-choice") nextTeacher.parts[0].solution.correctAnswers = publicItems.flatMap((question) => teacherItems.find((answer) => answer.questionId === question.id) || []);
    else nextTeacher.parts[0].solution.modelAnswers = publicItems.map((question) => teacherItems.find((answer) => answer.questionId === question.id));
  });
  const switchQuestionMode = (requestedMode) => {
    if (!oldschool || requestedMode === questionMode) return;
    const authored = interaction.questionInteraction?.words.length > 0 || interaction.questionInteraction?.panels.some((panel) => panel.images.length || panel.dropTargets.length) || questions.length > 0 || (questionMode === "open-response" ? (interaction.artwork?.length || teacherDraft.parts[0].solution.modelAnswers?.length) : (interaction.presentation || teacherDraft.parts[0].solution.correctAnswers?.length));
    if (authored && !globalThis.confirm(`Switch Panel 1 to ${requestedMode === "drag-drop" ? "Drag & Drop" : requestedMode === "single-choice" ? "Multiple Choice" : "Open Response"}? This replaces all Panel 1 questions, visual question content, and private answers. Audio, timeline cues, page mappings, listening and readable-text hotspots, and supporting content will be preserved.`)) return;
    mutatePair((nextPublic, nextTeacher) => switchNativeOldschoolListeningQuestionMode(nextPublic, nextTeacher, requestedMode));
    setSelectedQuestionId(null); setQuestionSelection(null); setSelectedPanelId(null); setSelectedHotspotId(null);
    setState((current) => ({ ...current, message: `Panel 1 changed to ${requestedMode === "drag-drop" ? "Drag & Drop" : requestedMode === "single-choice" ? "Multiple Choice" : "Open Response"}; incompatible question data was reset.` }));
  };
  const generateBulk = oldschool ? (source, options) => {
    const projected = projectOldschoolQuestionPair(publicDraft, teacherDraft);
    const result = generateNativeBulkCandidate({ kind: questionMode, source, ...projected, ...options });
    const nextPublic = clone(publicDraft); const nextTeacher = clone(teacherDraft);
    writeBackOldschoolQuestionPair(nextPublic, nextTeacher, result);
    setPublicDraft(nextPublic); setTeacherDraft(nextTeacher); setSelectedQuestionId(nextPublic.parts[0].interaction.questions[0]?.id || null); setQuestionSelection(null); changed();
    return result;
  } : null;

  const answer = questionMode === "single-choice" ? teacherDraft?.parts[0].solution.correctAnswers.find((entry) => entry.questionId === selectedQuestionId) || null : null;
  const addOption = () => mutatePublic((next) => next.parts[0].interaction.questions.find((question) => question.id === selectedQuestionId).options.push({ id: createNativeChildId("opt"), text: "" }));
  const deleteOption = (optionId) => mutatePair((nextPublic, nextTeacher) => mutateProjectedSingleChoice(nextPublic, nextTeacher, (projectedPublic, projectedTeacher) => removeNativeSingleChoiceOption(projectedPublic, projectedTeacher, selectedQuestionId, optionId)));
  const moveOption = (optionId, offset) => mutatePublic((next) => { const list = next.parts[0].interaction.questions.find((question) => question.id === selectedQuestionId).options; const index = list.findIndex((option) => option.id === optionId); const target = index + offset; if (target >= 0 && target < list.length) [list[index], list[target]] = [list[target], list[index]]; });
  const toggleAnswer = (optionId) => mutatePair((nextPublic, nextTeacher) => mutateProjectedSingleChoice(nextPublic, nextTeacher, (projectedPublic, projectedTeacher) => { const currentAnswer = projectedTeacher.parts[0].solution.correctAnswers.find((entry) => entry.questionId === selectedQuestionId); const selectedIds = new Set(nativeSingleChoiceCorrectOptionIds(currentAnswer)); if (selectedIds.has(optionId)) selectedIds.delete(optionId); else selectedIds.add(optionId); setNativeSingleChoiceCorrectAnswers(projectedPublic, projectedTeacher, selectedQuestionId, [...selectedIds]); }));
  const enableVisual = () => { const panelId = createNativeChildId("panel"); mutatePublic((next) => enableNativeSingleChoiceVisualPresentation(next, () => panelId)); setSelectedPanelId(panelId); setSelectedHotspotId(null); };
  const disableVisual = () => { if (!globalThis.confirm("Remove the Multiple Choice visual background and hotspots? Semantic questions and private answers will remain.")) return; mutatePublic(removeNativeSingleChoiceVisualPresentation); setSelectedPanelId(null); setSelectedHotspotId(null); };
  const uploadBackground = async (file) => {
    if (!file || !selectedPanel) return;
    setUploading("choice-background");
    try {
      const uploaded = await uploadNativeActivityAsset({ bookSlug, componentSlug, activityId, assetSlot: createNativeChildId("asset"), file });
      if (!uploaded.metadata || !Number.isSafeInteger(uploaded.metadata.width) || !Number.isSafeInteger(uploaded.metadata.height)) throw new Error("Uploaded image dimensions are unavailable.");
      mutatePublic((next) => {
        const current = next.parts[0].interaction; const panel = current.presentation.panels.find((entry) => entry.id === selectedPanel.id); const previousSlot = panel.backgroundAssetSlot;
        next.assets = mergeNativeManagedAssetReference(next.assets, uploaded.reference);
        const panelOne = current.panels[0]; const scaleX = uploaded.metadata.width / panelOne.sourceWidth; const scaleY = uploaded.metadata.height / panelOne.sourceHeight;
        current.snippetHotspots.forEach((hotspot) => { hotspot.area = { x: Math.round(hotspot.area.x * scaleX), y: Math.round(hotspot.area.y * scaleY), width: Math.max(1, Math.round(hotspot.area.width * scaleX)), height: Math.max(1, Math.round(hotspot.area.height * scaleY)) }; });
        resizeNativeDragDropAudioTextHotspots(next, "panel-1", { width: panelOne.sourceWidth, height: panelOne.sourceHeight }, { width: uploaded.metadata.width, height: uploaded.metadata.height });
        panelOne.sourceWidth = uploaded.metadata.width; panelOne.sourceHeight = uploaded.metadata.height; panel.backgroundAssetSlot = uploaded.reference.slot; panel.sourceWidth = uploaded.metadata.width; panel.sourceHeight = uploaded.metadata.height; panel.hotspots = [];
        if (previousSlot && previousSlot !== uploaded.reference.slot) removeNativeManagedAssetReferenceIfUnused(next, previousSlot);
      });
      setSelectedHotspotId(null); setState((current) => ({ ...current, message: "Multiple Choice background uploaded. Redraw hotspots for its intrinsic dimensions." }));
    } catch (error) { setState((current) => ({ ...current, message: error.message || "Background upload failed." })); } finally { setUploading(""); }
  };
  const importHotspots = (source, options) => { const result = generateNativeSingleChoiceHotspotImportCandidate({ source, publicDocument: projectOldschoolQuestionPair(publicDraft, teacherDraft).publicDocument, ...options }); const next = clone(publicDraft); next.parts[0].interaction.presentation = result.publicDocument.parts[0].interaction.presentation; setPublicDraft(next); setSelectedPanelId(result.selection.panelId); setSelectedHotspotId(result.selection.hotspotId); changed(); return result; };
  const updateHotspot = (mutator) => mutatePublic((next) => { const hotspot = next.parts[0].interaction.presentation?.panels.find((panel) => panel.id === selectedPanel?.id)?.hotspots.find((entry) => entry.id === selectedHotspotId); if (hotspot) mutator(hotspot); });
  const mappedBindings = new Set(questionMode === "single-choice" ? panels.flatMap((panel) => panel.hotspots.map((hotspot) => `${hotspot.questionId}:${hotspot.optionId}`)) : []);
  const nextHotspotBinding = questionMode === "single-choice" ? findNextUnusedNativeSingleChoiceBinding(questions, panels, hotspotBinding) : null;
  const createHotspot = () => { const binding = nextHotspotBinding; if (!selectedPanel || !binding) return setState((current) => ({ ...current, message: "Every option already has a hotspot." })); const hotspot = { id: createNativeChildId("hot"), questionId: binding.questionId, optionId: binding.optionId, area: createNativeSingleChoiceHotspotArea(selectedPanel.sourceWidth, selectedPanel.sourceHeight) }; mutatePublic((next) => next.parts[0].interaction.presentation.panels.find((panel) => panel.id === selectedPanel.id).hotspots.push(hotspot)); setSelectedHotspotId(hotspot.id); setHotspotBinding(""); };
  const deleteHotspot = () => { if (!selectedHotspot) return; mutatePublic((next) => { const panel = next.parts[0].interaction.presentation.panels.find((entry) => entry.id === selectedPanel.id); panel.hotspots = panel.hotspots.filter((hotspot) => hotspot.id !== selectedHotspot.id); }); setSelectedHotspotId(null); };
  const updateHotspotArea = (key, raw) => { const value = Math.round(Number(raw)); if (!Number.isFinite(value) || !selectedHotspot || !selectedPanel) return; updateHotspot((hotspot) => { const area = { ...hotspot.area }; area[key] = key === "x" ? clamp(value, 0, selectedPanel.sourceWidth - hotspot.area.width) : key === "y" ? clamp(value, 0, selectedPanel.sourceHeight - hotspot.area.height) : key === "width" ? clamp(value, 1, selectedPanel.sourceWidth - hotspot.area.x) : clamp(value, 1, selectedPanel.sourceHeight - hotspot.area.y); setNativeSingleChoiceHotspotArea(hotspot, area); }); };

  return {
    questionMode, addQuestion, removeQuestion, moveQuestion, switchQuestionMode, generateBulk,
    questionProps: { mode: null, questions, selected: selectedQuestion, answer, answeredQuestionIds: new Set(teacherDraft?.parts[0].solution.correctAnswers?.map((entry) => entry.questionId) || []), selectedQuestionId, setSelectedQuestionId, addQuestion, deleteQuestion: removeQuestion, moveQuestion, addOption, deleteOption, moveOption, toggleAnswer, mutatePublic, generateBulk },
    visualProps: { presentation, panels, selectedPanel, selectedPanelId: selectedPanel?.id || null, setSelectedPanelId, selectedHotspot, selectedHotspotId, setSelectedHotspotId, questions, zoom, setZoom, uploading: uploading === "choice-background", hotspotBinding, setHotspotBinding, mappedBindings, nextHotspotBinding, assetUrlForSlot: (slot) => { const reference = publicDraft?.assets.find((asset) => asset.slot === slot); return reference ? previewAssetUrl(reference.assetId) : ""; }, enableVisual, disableVisual, importHotspots, addPanel: () => {}, movePanel: () => {}, deletePanel: () => {}, uploadBackground, createHotspot, updateHotspot, updateHotspotArea, updateHotspotGeometry: (area) => updateHotspot((hotspot) => setNativeSingleChoiceHotspotArea(hotspot, area)), deleteHotspot, maximumPanels: 1 },
  };
}
