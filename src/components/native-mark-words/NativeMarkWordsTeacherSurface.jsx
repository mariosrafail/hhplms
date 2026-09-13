import { isMarkWordsVisual, markWordsResponseGroups, markWordsAnswerGroups } from "../../data/native-activities/nativeMarkWordsVisualTargets.js";
import { useEffect, useRef, useState } from "react";
import { NativeMarkWordsPresentation } from "./NativeMarkWordsStudentSurface.jsx";
import { normalizeNativeRuntimeTeacherDocument } from "../../data/native-activities/nativeActivityRuntimeValidation.js";

function TeacherSession({ publicDocument, teacherDocument, assetUrl, presentation, embeddedCanvas = false }) {
  const [revealed, setRevealed] = useState([]); const [panelIndex, setPanelIndex] = useState(0);
  const lastCommand = useRef(presentation?.command?.token);
  const visual = isMarkWordsVisual(publicDocument.parts[0].interaction);
  const [selected, setSelected] = useState({});
  const groups = markWordsResponseGroups(publicDocument.parts[0].interaction);
  const correct = markWordsAnswerGroups(teacherDocument.parts[0].solution);
  const items = visual ? groups.flatMap((group) => (correct.get(group.id) || []).map((id) => ({ id, panelId: group.id }))) : publicDocument.parts[0].interaction.items;
  const panels = publicDocument.parts[0].interaction.presentation.kind !== "text" ? publicDocument.parts[0].interaction.presentation.panels : [];
  const showNext = () => { const next = items.find((item) => !revealed.includes(item.id) && !(visual && selected[item.panelId]?.includes(item.id))); if (next) { setRevealed((current) => [...current, next.id]); const panel = panels.findIndex((entry) => visual ? entry.id === next.panelId : entry.hotspots.some((hotspot) => hotspot.itemId === next.id)); if (panel >= 0) setPanelIndex(panel); } };
  const reset = () => { setRevealed([]); setSelected({}); setPanelIndex(0); };
  useEffect(() => {
    const command = presentation?.command;
    if (!command || command.token === lastCommand.current) return;
    lastCommand.current = command.token;
    if (command.type === "show-next") showNext();
    if (command.type === "show-all") setRevealed(items.map((item) => item.id));
    if (command.type === "reset-activity") reset();
    if (command.type === "previous-panel") setPanelIndex((index) => Math.max(0, index - 1));
    if (command.type === "next-panel") setPanelIndex((index) => Math.min(Math.max(0, panels.length - 1), index + 1));
  }, [presentation?.command]);
  useEffect(() => { presentation?.onStateChange?.({ panelIndex, panelCount: panels.length, reveal: { supported: true, total: items.length, revealed: visual ? items.filter((item) => revealed.includes(item.id) || selected[item.panelId]?.includes(item.id)).length : revealed.length, pristine: !revealed.length && !Object.values(selected).some((ids) => ids.length) && !panelIndex } }); }, [presentation?.onStateChange, panelIndex, panels.length, items.length, revealed, selected]);
  const responses = visual ? Object.fromEntries(groups.map((group) => [group.id, [...new Set([...(selected[group.id] || []), ...group.options.filter((id) => revealed.includes(id))])]])) : Object.fromEntries(teacherDocument.parts[0].solution.answers.filter((answer) => revealed.includes(answer.itemId)).map((answer) => [answer.itemId, answer.correctWordIds]));
  return <>
    {!presentation ? <div role="group" aria-label="Teacher presentation"><button type="button" onClick={showNext}>Reveal next</button><button type="button" onClick={() => setRevealed(items.map((item) => item.id))}>Reveal all</button><button type="button" onClick={reset}>Hide / reset</button></div> : null}
    <NativeMarkWordsPresentation document={publicDocument} assetUrl={assetUrl} embeddedCanvas={embeddedCanvas} responses={responses} panelIndex={panelIndex} onPanelChange={setPanelIndex} externalNavigation={Boolean(presentation)} onToggle={(itemId, targetId) => {
      if (!visual) return setRevealed((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
      const active = responses[itemId]?.includes(targetId);
      setRevealed((current) => current.filter((id) => id !== targetId));
      setSelected((current) => ({ ...current, [itemId]: active ? (current[itemId] || []).filter((id) => id !== targetId) : [...(current[itemId] || []), targetId] }));
    }} />
  </>;
}

export function NativeMarkWordsTeacherSurface({ publicDocument, teacherDocument, identity = "", ...props }) {
  try { normalizeNativeRuntimeTeacherDocument(teacherDocument, { activityId: publicDocument.activityId, kind: "mark-the-words", publicDocument }); }
  catch { return <p role="alert">Teacher answers are unavailable.</p>; }
  return <TeacherSession key={`${publicDocument.activityId}:${identity}`} {...{ publicDocument, teacherDocument }} {...props} />;
}
