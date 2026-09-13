import "../../../src/apps/ultimate-b2-builder/studioAuthoring.css";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { NativeMultiPartStudentSurface } from "../../../src/components/native-multi-part/NativeMultiPartStudentSurface.jsx";
import { NativeMultiPartTeacherSurface } from "../../../src/components/native-multi-part/NativeMultiPartTeacherSurface.jsx";
import { NativeMarkWordsStudentSurface } from "../../../src/components/native-mark-words/NativeMarkWordsStudentSurface.jsx";
import { NativeMarkWordsTeacherSurface } from "../../../src/components/native-mark-words/NativeMarkWordsTeacherSurface.jsx";
import { NativeMultiPartEditor } from "../../../src/apps/book-builder/hosted/NativeMultiPartEditor.jsx";
import "../../../src/apps/book-builder/hosted/hostedBuilder.css";
import "../../../src/apps/book-builder/hosted/hostedBuilderModern.css";
import { NativeMarkWordsEditor } from "../../../src/apps/book-builder/hosted/NativeMarkWordsEditor.jsx";
import { projectNativeMultiPartChild } from "../../../src/data/native-activities/nativeMultiPart.js";
import { sharedFive, sharedFiveTeacher } from "./shared-five-data.js";
const child = projectNativeMultiPartChild(sharedFive, sharedFive.parts[0].interaction.sections.find((entry) => entry.kind === "mark-the-words"), sharedFiveTeacher);
function Fixture() {
 const [responses, setResponses] = useState({}); const [teacher, setTeacher] = useState(false); const [readOnly, setReadOnly] = useState(false); const [standalone, setStandalone] = useState(false); const [editor, setEditor] = useState(false); const [pair, setPair] = useState(child);
 globalThis.fiveFixture = { responses, setResponses, setTeacher, setReadOnly, setStandalone, setEditor, pair };
 const assetUrl = (id) => id.endsWith("2") ? "/graphic.png" : "/synthetic-shared.png";
 return <><button onClick={() => document.getElementById("five-host").requestFullscreen()}>Fullscreen fixture</button><div id="five-host" style={{ width: "100vw", height: "80vh", overflow: "hidden" }}><div className="published-native-activity" data-native-kind={standalone ? "mark-the-words" : "multi-part"}>
 {editor ? <NativeMarkWordsEditor bookSlug="ultimate-b2" componentSlug="ultimate-b2-students-book" activityId={pair.publicDocument.activityId} compositeBinding={{ ...pair, onPairChange: setPair }} /> : standalone ? teacher ? <NativeMarkWordsTeacherSurface {...child} assetUrl={assetUrl} /> : <NativeMarkWordsStudentSurface document={child.publicDocument} assetUrl={assetUrl} responses={responses} onResponsesChange={setResponses} readOnly={readOnly} /> : teacher ? <NativeMultiPartTeacherSurface publicDocument={sharedFive} teacherDocument={sharedFiveTeacher} assetUrl={assetUrl} /> : <NativeMultiPartStudentSurface document={sharedFive} assetUrl={assetUrl} responses={responses} onResponsesChange={setResponses} readOnly={readOnly} />}
 </div></div></>;
}
createRoot(document.getElementById("root")).render(location.search.includes("parent-editor") ? <NativeMultiPartEditor bookSlug="ultimate-b2" componentSlug="ultimate-b2-students-book" activityId={sharedFive.activityId} placementLabel="Five types" /> : <Fixture />);
