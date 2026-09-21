import { nativeDragDropAnswerAllocation } from "../../data/native-activities/nativeDragDropAnswers.js";
import { useCallback, useEffect, useRef, useState } from "react";

import { nativeDragDropMappingWordIds, normalizeNativeDragDropResponses, updateNativeDragDropRevealState } from "../../data/native-activities/nativeDragDrop.js";
import { NativeDragDropStudentSurface } from "./NativeDragDropSurface.jsx";

export function NativeDragDropTeacherSurface({ publicDocument, teacherDocument, assetUrl = () => "", presentation = null, embeddedCanvas = null, audioHotspotPresentation = null }) {
  const interaction = publicDocument.parts[0].interaction;
  const targetIds = interaction.panels.flatMap((panel) => panel.dropTargets.map((target) => target.id));
  const wordById = new Map(interaction.words.map((word) => [word.id, word]));
  const wordIdsByTarget = new Map(teacherDocument.parts[0].solution.mappings.map((mapping) => [mapping.targetId, nativeDragDropMappingWordIds(mapping)]));
  const [panelIndex, setPanelIndex] = useState(0);
  const [responses, setResponses] = useState(() => ({}));
  const [revealed, setRevealed] = useState(() => new Set());
  const [resetToken, setResetToken] = useState(null);
  const lastCommand = useRef(presentation?.command?.token);
  const hasManualResponses = Object.keys(normalizeNativeDragDropResponses(responses, publicDocument)).length > 0;
  const onResponsesChange = useCallback((value) => {
    const next = normalizeNativeDragDropResponses(value, publicDocument);
    // The owner clears responses with the command; the child's reset notification
    // also clears transient interaction state and may report the same empty value.
    setResponses((current) => !Object.keys(current).length && !Object.keys(next).length ? current : next);
  }, [publicDocument]);

  useEffect(() => {
    const command = presentation?.command;
    if (!command || command.token === lastCommand.current) return;
    lastCommand.current = command.token;
    if (command.type === "previous-panel") setPanelIndex((current) => Math.max(0, current - 1));
    else if (command.type === "next-panel") setPanelIndex((current) => Math.min(interaction.panels.length - 1, current + 1));
    else {
      if (command.type === "reset-activity") {
        setPanelIndex(0); setResponses({}); setRevealed(new Set()); setResetToken(command.token);
        return;
      }
      if (command.type === "show-next") {
        const nextTargetId = targetIds.find((targetId) => !revealed.has(targetId));
        const nextPanelIndex = interaction.panels.findIndex((entry) => entry.dropTargets.some((target) => target.id === nextTargetId));
        if (nextPanelIndex >= 0) setPanelIndex(nextPanelIndex);
      }
      setRevealed((current) => updateNativeDragDropRevealState(current, targetIds, command.type));
    }
  }, [interaction.panels, presentation?.command, revealed, targetIds.join("\0")]);
  useEffect(() => presentation?.onStateChange?.({ panelIndex, panelCount: interaction.panels.length, reveal: { supported: true, total: targetIds.length, revealed: revealed.size, pristine: panelIndex === 0 && revealed.size === 0 && !hasManualResponses } }), [hasManualResponses, interaction.panels.length, panelIndex, presentation?.onStateChange, revealed, targetIds.length]);

  const allocation = nativeDragDropAnswerAllocation(interaction, teacherDocument.parts[0].solution.mappings) || new Map();
  const revealedWords = new Map([...revealed].map((targetId) => [targetId, (allocation.get(targetId) || []).map((wordId) => wordById.get(wordId)).filter(Boolean)]).filter(([, words]) => words.length));
  const revealedIds = new Set([...revealedWords.values()].flat().filter((word) => !word.reusable).map((word) => word.id));
  const visibleResponses = Object.fromEntries(Object.entries(responses).map(([id, words]) => [id, words.filter((wordId) => revealedWords.has(id) ? revealedWords.get(id).some((word) => word.id === wordId) : !revealedIds.has(wordId))]).filter(([, words]) => words.length));
  return <NativeDragDropStudentSurface
    document={publicDocument}
    responses={visibleResponses}
    onResponsesChange={onResponsesChange}
    embeddedCanvas={embeddedCanvas}
    audioHotspotPresentation={audioHotspotPresentation}
    assetUrl={assetUrl}
    evaluatePlacement={(targetId, wordId) => (wordIdsByTarget.get(targetId) || []).includes(wordId)}
    targetWordOverrides={revealedWords}
    onEmptyTargetActivate={(targetId) => setRevealed((current) => updateNativeDragDropRevealState(current, targetIds, { targetId }))}
    panelIndex={panelIndex}
    onPanelIndexChange={setPanelIndex}
    presentation={presentation}
    resetToken={resetToken}
    presentationMode
  />;
}
