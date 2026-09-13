import { useEffect, useRef, useState } from "react";

import { nativeDragDropMappingWordIds, updateNativeDragDropRevealState } from "../../data/native-activities/nativeDragDrop.js";
import { NativeDragDropStudentSurface } from "./NativeDragDropSurface.jsx";

export function NativeDragDropTeacherSurface({ publicDocument, teacherDocument, assetUrl = () => "", presentation = null, embeddedCanvas = null, audioHotspotPresentation = null }) {
  const interaction = publicDocument.parts[0].interaction;
  const targetIds = interaction.panels.flatMap((panel) => panel.dropTargets.map((target) => target.id));
  const wordById = new Map(interaction.words.map((word) => [word.id, word]));
  const wordIdsByTarget = new Map(teacherDocument.parts[0].solution.mappings.map((mapping) => [mapping.targetId, nativeDragDropMappingWordIds(mapping)]));
  const [panelIndex, setPanelIndex] = useState(0);
  const [revealed, setRevealed] = useState(() => new Set());
  const [resetToken, setResetToken] = useState(null);
  const lastCommand = useRef(presentation?.command?.token);

  useEffect(() => {
    const command = presentation?.command;
    if (!command || command.token === lastCommand.current) return;
    lastCommand.current = command.token;
    if (command.type === "previous-panel") setPanelIndex((current) => Math.max(0, current - 1));
    else if (command.type === "next-panel") setPanelIndex((current) => Math.min(interaction.panels.length - 1, current + 1));
    else {
      if (command.type === "reset-activity") { setPanelIndex(0); setResetToken(command.token); }
      if (command.type === "show-next") {
        const nextTargetId = targetIds.find((targetId) => !revealed.has(targetId));
        const nextPanelIndex = interaction.panels.findIndex((entry) => entry.dropTargets.some((target) => target.id === nextTargetId));
        if (nextPanelIndex >= 0) setPanelIndex(nextPanelIndex);
      }
      setRevealed((current) => updateNativeDragDropRevealState(current, targetIds, command.type));
    }
  }, [interaction.panels, presentation?.command, revealed, targetIds.join("\0")]);
  useEffect(() => presentation?.onStateChange?.({ panelIndex, panelCount: interaction.panels.length, reveal: { supported: true, total: targetIds.length, revealed: revealed.size, pristine: revealed.size === 0 } }), [interaction.panels.length, panelIndex, presentation?.onStateChange, revealed, targetIds.length]);

  const revealedWords = new Map([...revealed].map((targetId) => [targetId, (wordIdsByTarget.get(targetId) || []).map((wordId) => wordById.get(wordId)).filter(Boolean)]).filter(([, words]) => words.length));
  return <NativeDragDropStudentSurface
    document={publicDocument}
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
