import React, { Profiler, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import TeacherOfflineEmbeddedActivity from "../../../src/apps/android-teacher-offline/TeacherOfflineEmbeddedActivity.jsx";
import { HostedNativeDraftActivityRunner } from "../../../src/components/lms/activities/ultimate-b2/HostedNativeDraftActivityRunner.jsx";
import { NativeDragDropEditor } from "../../../src/apps/book-builder/hosted/NativeDragDropEditor.jsx";
import { NativeSingleChoiceEditor } from "../../../src/apps/book-builder/hosted/NativeSingleChoiceEditor.jsx";
import { NativeDragDropStudentSurface } from "../../../src/components/native-drag-drop/NativeDragDropSurface.jsx";
import { NativeDragDropTeacherSurface } from "../../../src/components/native-drag-drop/NativeDragDropTeacherSurface.jsx";
import { NativeReadableTextPresentation } from "../../../src/components/native-readable-text/NativeReadableTextPresentation.jsx";
import { fixedAspectSingleChoicePair, presentationPair } from "./presentation-documents.js";
import "../../../src/apps/android-teacher-offline/teacherOfflinePageViewer.css";

const pair = presentationPair();
const fixedFocus = new URLSearchParams(location.search).has("fixed-focus");
const choice = fixedFocus ? fixedAspectSingleChoicePair() : presentationPair("single-choice");
const choiceState = { kind: "ready", entry: { kind: "single-choice", document: choice.publicDocument }, teacher: { kind: "ready", entry: { document: choice.teacherDocument } } };
globalThis.nativePresentationFixture = { pair, choice, commits: [], states: [], assetUrl: (id) => `/native-fixture-assets/${id}` };
function Fixture() {
  const [mode, setMode] = useState(fixedFocus ? "choice" : "student");
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ width: 1024, height: 582 });
  const [command, setCommand] = useState(null);
  const [version, setVersion] = useState(0);
  const [, setFontVersion] = useState(0);
  globalThis.nativePresentationFixture.loadFont = () => {
    const document = structuredClone(pair.publicDocument);
    document.assets.push({ slot: "font", assetId: "10000000-0000-4000-8000-000000000004", checksumSha256: "b".repeat(64), role: "activity_font" });
    document.parts[0].interaction.presentation.bankWordStyle.fontAssetSlot = "font";
    pair.publicDocument = document;
    setFontVersion((value) => value + 1);
  };
  const stateChange = useCallback((state) => { globalThis.nativePresentationFixture.states.push(state); }, []);
  Object.assign(globalThis.nativePresentationFixture, { setMode, setScale, setConsumable: () => { Object.assign(pair, presentationPair("drag-drop", false)); pair.publicDocument.parts[0].interaction.words.pop(); setVersion((value) => value + 1); }, reset: () => setCommand({ type: "reset-activity", token: performance.now() }), command: (type) => setCommand({ type, token: performance.now() }), rerender: () => setVersion((value) => value + 1) });
  const presentation = { command, onStateChange: stateChange };
  globalThis.nativePresentationFixture.setSize = setSize;
  const assetUrl = globalThis.nativePresentationFixture.assetUrl;
  return <Profiler id="activity" onRender={(_, phase, duration) => globalThis.nativePresentationFixture.commits.push({ phase, duration, at: performance.now() })}>
    <div data-fixture-stage style={{ width: mode.endsWith("editor") ? 1100 : size.width, height: mode.endsWith("editor") ? "auto" : size.height, transform: `scale(${scale})`, transformOrigin: "top left", position: "relative" }} data-version={version}>
      {mode === "choice-student" ? <HostedNativeDraftActivityRunner activityId={choice.publicDocument.activityId} state={choiceState} teacherMode={false} showMetadataHeader={false} /> :
      mode === "choice-editor" ? <NativeSingleChoiceEditor bookSlug="ultimate-b2" componentSlug="ultimate-b2-students-book" activityId={choice.publicDocument.activityId} /> :
      mode === "editor" ? <NativeDragDropEditor key={version} bookSlug="ultimate-b2" componentSlug="ultimate-b2-students-book" activityId={pair.publicDocument.activityId} /> : mode === "choice" ? <TeacherOfflineEmbeddedActivity activityId={choice.publicDocument.activityId} title="Choice regression" runtimeContext={{ kind: "builder-preview", teacherPreview: true }} activityPresentationCommand={command} onActivityPresentationStateChange={stateChange} /> : <NativeReadableTextPresentation document={pair.publicDocument} assetUrl={assetUrl} presentation={presentation}>{(childPresentation) => mode === "teacher" ? <NativeDragDropTeacherSurface publicDocument={pair.publicDocument} teacherDocument={pair.teacherDocument} assetUrl={assetUrl} presentation={childPresentation} /> : <NativeDragDropStudentSurface key={version} document={pair.publicDocument} assetUrl={assetUrl} resetToken={command?.token} />}</NativeReadableTextPresentation>}
    </div>
  </Profiler>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
