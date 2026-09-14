import { useEffect, useMemo, useRef } from "react";
import { projectOldschoolQuestionPair, writeBackOldschoolQuestionPair } from "../../../data/native-activities/nativeOldschoolQuestionBinding.js";
import { NativeOpenResponseEditor } from "./NativeOpenResponseEditor.jsx";
import { NativeDragDropEditor } from "./NativeDragDropEditor.jsx";

export function NativeOldschoolQuestionEditor({ publicDocument, teacherDocument, mutatePair, onBusyChange, onStatusChange, onMessage, authoringTab, ...scope }) {
  const latest = useRef(); latest.current = { mutatePair, onStatusChange, onMessage };
  useEffect(() => { latest.current.onStatusChange(""); return () => latest.current.onStatusChange(""); }, []);
  // The mounted child owns its editing session. Parent updates are write-back
  // acknowledgements, not new documents to reload over that session.
  const binding = useMemo(() => ({
    ...projectOldschoolQuestionPair(publicDocument, teacherDocument), fixedPanel: true,
    onPairChange(pair) {
      try { latest.current.mutatePair((publicNext, teacherNext) => writeBackOldschoolQuestionPair(publicNext, teacherNext, pair)); latest.current.onStatusChange(""); }
      catch (error) { latest.current.onStatusChange(error.message); }
    },
    onBusyChange,
    onStatusChange(message) { latest.current.onMessage?.(message); },
  }), [publicDocument.activityId, publicDocument.parts[0].interaction.questionMode]);
  const Editor = publicDocument.parts[0].interaction.questionMode === "drag-drop" ? NativeDragDropEditor : NativeOpenResponseEditor;
  const activeTab = authoringTab === "visual" ? "layout" : authoringTab === "answer-key" && publicDocument.parts[0].interaction.questionMode === "drag-drop" ? "answer-key" : "content";
  return <Editor {...scope} compositeBinding={{ ...binding, activeTab }} />;
}
