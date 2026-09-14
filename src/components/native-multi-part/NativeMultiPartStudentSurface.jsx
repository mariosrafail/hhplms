import { useEffect, useRef, useState } from "react";
import { nativeMultiPartAudioTextPresentation } from "../../data/native-activities/nativeAudioTextHotspots.js";
import { NativeMultiPartLayout } from "./NativeMultiPartLayout.jsx";
import { NativeDragDropStudentSurface } from "../native-drag-drop/NativeDragDropSurface.jsx";
import { NativeSingleChoicePresentation } from "../native-single-choice/NativeSingleChoicePresentation.jsx";
import { NativeCompleteSentencesStudentSurface } from "../native-complete-sentences/NativeCompleteSentencesSurface.jsx";
import { NativeOpenResponseStudentSurface } from "../native-open-response/NativeOpenResponseStudentSurface.jsx";
import { NativeMarkWordsStudentSurface } from "../native-mark-words/NativeMarkWordsStudentSurface.jsx";
import { NativeImagePresentation } from "../native-image/NativeImageSurface.jsx";

function Session({ document, assetUrl = () => "", responses: controlled = null, initialResponses = null, onResponsesChange, readOnly = false, presentation = null, audioHotspotPresentation = null }) {
  const [local, setLocal] = useState(initialResponses || {});
  const [panelIndex, setPanelIndex] = useState(0);
  const responses = controlled || local;
  const lastCommand = useRef(presentation?.command?.token);
  const callbacks = useRef({ onResponsesChange, readOnly }); callbacks.current = { onResponsesChange, readOnly };
  const panelCount = document.parts[0].interaction.panels.length;
  useEffect(() => {
    const command = presentation?.command;
    if (!command || command.token === lastCommand.current) return;
    lastCommand.current = command.token;
    if (command.type === "previous-panel") setPanelIndex((index) => Math.max(0, index - 1));
    if (command.type === "next-panel") setPanelIndex((index) => Math.min(panelCount - 1, index + 1));
    if (command.type === "reset-activity") { setPanelIndex(0); if (!callbacks.current.readOnly) { setLocal({}); callbacks.current.onResponsesChange?.({}); } }
  }, [presentation?.command, panelCount]);
  useEffect(() => { presentation?.onStateChange?.({ panelIndex, panelCount, reveal: { supported: false, total: 0, revealed: 0, pristine: true } }); }, [panelIndex, panelCount, presentation?.onStateChange]);
  const change = (id, values) => {
    if (readOnly) return;
    const next = { ...responses, [id]: values };
    if (!controlled) setLocal(next);
    onResponsesChange?.(next);
  };
  return <NativeMultiPartLayout {...{ document, assetUrl, panelIndex, setPanelIndex }} audioHotspotPresentation={audioHotspotPresentation} externalNavigation={Boolean(presentation)} renderSection={(section, child, embeddedCanvas) => {
    const props = { audioHotspotPresentation: nativeMultiPartAudioTextPresentation(document, audioHotspotPresentation, section.id), document: child.publicDocument, assetUrl, responses: responses[section.id] || {}, onResponsesChange: (values) => change(section.id, values), readOnly };
    if (section.kind === "drag-drop") return <NativeDragDropStudentSurface {...props} embeddedCanvas={embeddedCanvas} />;
    if (section.kind === "single-choice") return <NativeSingleChoicePresentation {...props} navigationMode="external" embeddedCanvas={Boolean(embeddedCanvas)} />;
    if (section.kind === "complete-sentences") return <NativeCompleteSentencesStudentSurface {...props} embeddedCanvas={Boolean(embeddedCanvas)} />;
    if (section.kind === "open-response") return <NativeOpenResponseStudentSurface {...props} embeddedCanvas={Boolean(embeddedCanvas)} />;
    if (section.kind === "mark-the-words") return <NativeMarkWordsStudentSurface {...props} embeddedCanvas={Boolean(embeddedCanvas)} />;
    if (section.kind === "image") return <NativeImagePresentation {...props} />;
    throw new Error("Unsupported Multi-Part section.");
  }} />;
}
export function NativeMultiPartStudentSurface({ identity = "", ...props }) {
  return <Session key={`${props.document.activityId}:${identity}`} {...props} />;
}
