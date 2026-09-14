import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nativeMultiPartAudioTextPresentation } from "../../data/native-activities/nativeAudioTextHotspots.js";
import { NativeMultiPartLayout } from "./NativeMultiPartLayout.jsx";
import { NativeDragDropTeacherSurface } from "../native-drag-drop/NativeDragDropTeacherSurface.jsx";
import { NativeSingleChoiceTeacherSurface } from "../native-single-choice/NativeSingleChoiceTeacherSurface.jsx";
import { NativeCompleteSentencesTeacherSurface } from "../native-complete-sentences/NativeCompleteSentencesSurface.jsx";
import { NativeOpenResponseTeacherSurface } from "../native-open-response/NativeOpenResponseTeacherSurface.jsx";
import { NativeMarkWordsTeacherSurface } from "../native-mark-words/NativeMarkWordsTeacherSurface.jsx";
import { NativeImageTeacherPresentation } from "../native-image/NativeImageTeacherPresentation.jsx";

function Session({ publicDocument: document, teacherDocument, assetUrl = () => "", teacherAssetUrl, presentation = null, audioHotspotPresentation = null }) {
  const [panelIndex, setPanelIndex] = useState(0);
  const [states, setStates] = useState({});
  const [commands, setCommands] = useState({});
  const lastCommand = useRef(presentation?.command?.token);
  const sequence = useRef(0);
  const interaction = document.parts[0].interaction;
  const onChildState = useMemo(() => Object.fromEntries(interaction.sections.map((section) => [section.id, (state) => setStates((current) => JSON.stringify(current[section.id]) === JSON.stringify(state) ? current : { ...current, [section.id]: state })])), [interaction.sections]);
  const command = useCallback((type) => {
    if (type === "previous-panel") return setPanelIndex((index) => Math.max(0, index - 1));
    if (type === "next-panel") return setPanelIndex((index) => Math.min(interaction.panels.length - 1, index + 1));
    const ordered = interaction.panels.flatMap((panel) => interaction.sections.filter((section) => section.panelId === panel.id));
    const next = ordered.find((section) => states[section.id]?.reveal?.revealed < states[section.id]?.reveal?.total);
    if (type === "show-next" && !next) return;
    if (type === "show-next") setPanelIndex(interaction.panels.findIndex((panel) => panel.id === next.panelId));
    if (type === "reset-activity") setPanelIndex(0);
    const token = ++sequence.current;
    setCommands((current) => ({ ...current, ...Object.fromEntries((type === "show-next" ? [next] : ordered).map((section) => [section.id, { type, token }])) }));
  }, [interaction, states]);
  useEffect(() => {
    if (!presentation?.command || presentation.command.token === lastCommand.current) return;
    lastCommand.current = presentation.command.token; command(presentation.command.type);
  }, [presentation?.command, command]);
  useEffect(() => {
    const reveal = Object.values(states).reduce((sum, state) => ({ supported: sum.supported || state.reveal?.supported === true, total: sum.total + (state.reveal?.total || 0), revealed: sum.revealed + (state.reveal?.revealed || 0) }), { supported: false, total: 0, revealed: 0 });
    presentation?.onStateChange?.({ panelIndex, panelCount: interaction.panels.length, reveal: { ...reveal, pristine: Object.values(states).every((state) => state.reveal?.pristine !== false) } });
  }, [states, panelIndex, interaction.panels.length, presentation?.onStateChange]);
  const controls = !presentation ? <div className="native-multi-part-controls" role="group" aria-label="Multi-Part Teacher presentation"><button type="button" onClick={() => command("show-next")}>Show next</button><button type="button" onClick={() => command("show-all")}>Show all</button><button type="button" onClick={() => command("reset-activity")}>Reset activity</button></div> : null;
  return <NativeMultiPartLayout controls={controls} {...{ document, teacherDocument, assetUrl, panelIndex, setPanelIndex }} audioHotspotPresentation={audioHotspotPresentation} externalNavigation={Boolean(presentation)} renderSection={(section, child, embeddedCanvas, visible) => {
      const props = { audioHotspotPresentation: nativeMultiPartAudioTextPresentation(document, audioHotspotPresentation, section.id), ...child, assetUrl, presentation: { command: commands[section.id], onStateChange: onChildState[section.id] } };
      if (section.kind === "drag-drop") return <NativeDragDropTeacherSurface {...props} embeddedCanvas={embeddedCanvas} />;
      if (section.kind === "single-choice") return <NativeSingleChoiceTeacherSurface {...props} embeddedCanvas={Boolean(embeddedCanvas)} />;
      if (section.kind === "complete-sentences") return <NativeCompleteSentencesTeacherSurface {...props} embeddedCanvas={Boolean(embeddedCanvas)} />;
      if (section.kind === "open-response") return <NativeOpenResponseTeacherSurface {...props} embeddedCanvas={Boolean(embeddedCanvas)} />;
      if (section.kind === "mark-the-words") return <NativeMarkWordsTeacherSurface {...props} embeddedCanvas={Boolean(embeddedCanvas)} />;
      if (section.kind === "image") return <NativeImageTeacherPresentation audioHotspotPresentation={props.audioHotspotPresentation} document={child.publicDocument} teacherDocument={visible ? child.teacherDocument : null} assetUrl={assetUrl} teacherAssetUrl={teacherAssetUrl ? (assetId) => teacherAssetUrl(assetId, section.id) : undefined} identity={section.id} />;
      throw new Error("Unsupported Multi-Part Teacher section.");
    }} />;
}
export function NativeMultiPartTeacherSurface({ identity = "", ...props }) {
  return <Session key={`${props.publicDocument.activityId}:${identity}`} {...props} />;
}
