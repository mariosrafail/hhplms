import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/apps/ultimate-b2-builder/studioAuthoring.css";
import { NativeDragDropEditor } from "../../../src/apps/book-builder/hosted/NativeDragDropEditor.jsx";
import { NativeDragDropStudentSurface } from "../../../src/components/native-drag-drop/NativeDragDropSurface.jsx";
import { NativeDragDropTeacherSurface } from "../../../src/components/native-drag-drop/NativeDragDropTeacherSurface.jsx";
import { NativeReadableTextPresentation } from "../../../src/components/native-readable-text/NativeReadableTextPresentation.jsx";
import { dragDropImprovementsPair } from "./drag-drop-improvements-data.js";

function Fixture() {
  const [pair, setPair] = useState(dragDropImprovementsPair);
  const [responses, setResponses] = useState({});
  const [readOnly, setReadOnly] = useState(false);
  const [teacher, setTeacher] = useState(false);
  const [scale, setScale] = useState(1);
  const [resetToken, setResetToken] = useState(0);
  const [, rerender] = useState(0);
  globalThis.dnd = { pair, responses, setPair, setResponses, setReadOnly, setTeacher, setScale, reset: () => setResetToken((n) => n + 1), rerender: () => rerender((n) => n + 1) };
  const pub = pair.publicDocument;
  const assetUrl = (id) => `/dnd-fixture/${pub.assets.find((a) => a.assetId === id)?.slot}`;
  if (location.search.includes("editor")) return <NativeDragDropEditor bookSlug="ultimate-b2" componentSlug="ultimate-b2-students-book" activityId={pub.activityId} placementLabel="Local fixture" />;
  return <div style={{ width: "100%", maxWidth: 1024, height: 670, transform: `scale(${scale})`, transformOrigin: "top left" }}>
    <NativeReadableTextPresentation document={pub} assetUrl={assetUrl}>{(presentation, audioHotspotPresentation) => teacher
      ? <NativeDragDropTeacherSurface publicDocument={pub} teacherDocument={pair.teacherDocument} assetUrl={assetUrl} presentation={presentation} audioHotspotPresentation={audioHotspotPresentation} />
      : <NativeDragDropStudentSurface document={pub} assetUrl={assetUrl} responses={responses} onResponsesChange={setResponses} readOnly={readOnly} presentation={presentation} audioHotspotPresentation={audioHotspotPresentation} resetToken={resetToken} />
    }</NativeReadableTextPresentation>
  </div>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
