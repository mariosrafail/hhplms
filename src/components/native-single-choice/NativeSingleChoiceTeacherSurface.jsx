import { useEffect, useRef, useState } from "react";

import { NativeSingleChoicePresentation } from "./NativeSingleChoicePresentation.jsx";
import { createNativeSingleChoiceTeacherSession, nativeSingleChoiceTeacherPresentationState, updateNativeSingleChoiceTeacherSession } from "./nativeSingleChoiceTeacherRuntime.js";
import { nativeSingleChoiceCorrectOptionIds } from "../../data/native-activities/nativeSingleChoice.js";
import { selectNativeSingleChoiceResponse } from "../../data/native-activities/nativeSingleChoiceRuntime.js";

function NativeSingleChoiceTeacherSession({ publicDocument, teacherDocument, assetUrl, presentation, audioHotspotPresentation, embeddedCanvas, navigationMode }) {
  const [session, setSession] = useState(createNativeSingleChoiceTeacherSession);
  const [announcement, setAnnouncement] = useState("");
  const lastCommandToken = useRef(presentation?.command?.token);
  const onStateChange = presentation?.onStateChange;

  useEffect(() => {
    const command = presentation?.command;
    if (!command || command.token === lastCommandToken.current) return;
    lastCommandToken.current = command.token;
    setSession((current) => updateNativeSingleChoiceTeacherSession(current, publicDocument, teacherDocument, command));
  }, [presentation?.command, publicDocument, teacherDocument]);

  useEffect(() => {
    onStateChange?.(nativeSingleChoiceTeacherPresentationState(session, publicDocument, teacherDocument));
  }, [onStateChange, publicDocument, session, teacherDocument]);

  const choose = ({ questionId, optionId }) => {
    if (session.solvedQuestionIds.has(questionId)) return;
    const question = publicDocument.parts[0].interaction.questions.find((entry) => entry.id === questionId);
    const correctOptionIds = nativeSingleChoiceCorrectOptionIds(teacherDocument.parts[0].solution.correctAnswers.find((answer) => answer.questionId === questionId));
    const nextResponses = selectNativeSingleChoiceResponse(session.responses, questionId, optionId, question);
    const selectedOptionIds = question?.selectionMode === "multiple" ? nextResponses[questionId] || [] : [nextResponses[questionId]].filter(Boolean);
    const correct = selectedOptionIds.length === correctOptionIds.length && selectedOptionIds.every((id) => correctOptionIds.includes(id));
    setSession((current) => updateNativeSingleChoiceTeacherSession(current, publicDocument, teacherDocument, { type: "select", questionId, optionId }));
    const questionNumber = publicDocument.parts[0].interaction.questions.findIndex((question) => question.id === questionId) + 1;
    setAnnouncement(`Question ${questionNumber}: ${correct ? "correct" : question?.selectionMode === "multiple" ? "selection updated" : "incorrect"}.`);
  };
  return <>
    <NativeSingleChoicePresentation
      document={publicDocument}
      embeddedCanvas={embeddedCanvas}
      assetUrl={assetUrl}
      responses={session.responses}
      onSelect={choose}
      optionStates={session.optionStates}
      disabledQuestionIds={session.solvedQuestionIds}
      navigationMode={navigationMode ?? (presentation ? "external" : "inline")}
      panelIndex={session.panelIndex}
      className="native-single-choice-teacher"
      audioHotspotPresentation={audioHotspotPresentation}
    />
    <span className="native-single-choice-sr-only" role="status" aria-live="polite">{announcement}</span>
  </>;
}

export function NativeSingleChoiceTeacherSurface({ publicDocument, teacherDocument, assetUrl = () => "", presentation = null, audioHotspotPresentation = null, embeddedCanvas = false, navigationMode = null }) {
  return <NativeSingleChoiceTeacherSession embeddedCanvas={embeddedCanvas} key={publicDocument.activityId} publicDocument={publicDocument} teacherDocument={teacherDocument} assetUrl={assetUrl} presentation={presentation} audioHotspotPresentation={audioHotspotPresentation} navigationMode={navigationMode} />;
}
