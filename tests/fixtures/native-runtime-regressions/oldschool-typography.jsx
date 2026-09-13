import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { NativeOldschoolListeningEditor } from "../../../src/apps/book-builder/hosted/NativeOldschoolListeningEditor.jsx";
import { NativeOldschoolListeningStudentSurface } from "../../../src/components/native-oldschool-listening/NativeOldschoolListeningStudentSurface.jsx";
import { NativeOldschoolListeningTeacherSurface } from "../../../src/components/native-oldschool-listening/NativeOldschoolListeningTeacherSurface.jsx";
import { PublishedNativeStudentActivityRunner } from "../../../src/components/lms/activities/ultimate-b2/PublishedNativeStudentActivityRunner.jsx";
import { PublishedNativeTeacherActivityRunner } from "../../../src/components/lms/activities/ultimate-b2/PublishedNativeTeacherActivityRunner.jsx";
import { createOldschoolTypographyPair } from "../oldschool-typography.js";
import "../../../src/apps/book-builder/styles/reviewStudio.css";
import "../../../src/apps/book-builder/hosted/hostedBuilder.css";
import "../../../src/apps/book-builder/hosted/hostedBuilderModern.css";
import "../../../src/apps/ultimate-b2-builder/studioAuthoring.css";

const original = createOldschoolTypographyPair();
function App() {
  const [mode, setMode] = useState("builder"); const [scale, setScale] = useState(1); const [pair, setPair] = useState(original);
  const [command, setCommand] = useState(null); const [fontMode, setFontMode] = useState("loaded");
  const assetUrl = (id) => `/typography-assets/${id}?mode=${fontMode}`;
  globalThis.typographyFixture = { setMode, setScale, setPair, setFontMode, assetUrl, pair, showPage: () => setCommand({ type: "next-panel", token: crypto.randomUUID() }) };
  const props = { assetUrl, presentation: { command } };
  return <main style={{ width: "100%" }}>{mode === "builder" ? <NativeOldschoolListeningEditor bookSlug="ultimate-b2" componentSlug="ultimate-b2-students-book" activityId={original.publicDocument.activityId} />
    : <div id="runtime-stage" style={{ width: "min(1018px, 100%)", transform: `scale(${scale})`, transformOrigin: "top left" }}>
      {mode === "student" ? <NativeOldschoolListeningStudentSurface document={pair.publicDocument} {...props} /> : null}
      {mode === "teacher" ? <NativeOldschoolListeningTeacherSurface {...pair} {...props} /> : null}
      {mode === "published-student" ? <PublishedNativeStudentActivityRunner entry={{ kind: "oldschool-listening", document: pair.publicDocument }} publication={{ releaseId: "frozen-typography-release" }} showMetadataHeader={false} presentation={props.presentation} /> : null}
      {mode === "published-teacher" ? <PublishedNativeTeacherActivityRunner entry={{ kind: "oldschool-listening", document: pair.publicDocument }} publication={{ releaseId: "frozen-typography-release" }} showMetadataHeader={false} presentation={props.presentation} /> : null}
    </div>}</main>;
}
createRoot(document.getElementById("root")).render(<App />);
