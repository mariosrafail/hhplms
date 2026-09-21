import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { alternativesPair, outlinePair, sharedTextPair } from "../native-builder-options.js";
import { NativeDragDropStudentSurface } from "../../../src/components/native-drag-drop/NativeDragDropSurface.jsx";
import { NativeDragDropTeacherSurface } from "../../../src/components/native-drag-drop/NativeDragDropTeacherSurface.jsx";
import { NativeMarkWordsStudentSurface } from "../../../src/components/native-mark-words/NativeMarkWordsStudentSurface.jsx";
import { NativeMarkWordsTeacherSurface } from "../../../src/components/native-mark-words/NativeMarkWordsTeacherSurface.jsx";
import { NativeMultiPartStudentSurface } from "../../../src/components/native-multi-part/NativeMultiPartStudentSurface.jsx";
import { NativeMultiPartTeacherSurface } from "../../../src/components/native-multi-part/NativeMultiPartTeacherSurface.jsx";
import { NativeDragDropEditor } from "../../../src/apps/book-builder/hosted/NativeDragDropEditor.jsx";
import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from "../../../src/data/native-activities/nativeActivityRuntimeValidation.js";
const assetUrl = () => "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="582"><rect width="1024" height="582" fill="#e4eff9"/><path d="M0 370H1024M0 150H1024" stroke="#246"/><text x="45" y="340" font-size="28">Text image left</text><text x="557" y="340" font-size="28">Text image right</text></svg>');
function normalize(pair) {
  const options = { activityId: pair.publicDocument.activityId, kind: pair.publicDocument.kind };
  const publicDocument = normalizeNativeRuntimePublicDocument(pair.publicDocument, options);
  return { publicDocument, teacherDocument: normalizeNativeRuntimeTeacherDocument(pair.teacherDocument, { ...options, publicDocument }) };
}
function Fixture() {
  const [pair, setPair] = useState(() => normalize(alternativesPair()));
  const [mode, setMode] = useState("student"), [responses, setResponses] = useState({}), [version, setVersion] = useState(0), [command, setCommand] = useState(null), [scale, setScale] = useState(1);
  globalThis.optionsFixture = { pair, responses, setPair: (pair) => setPair(normalize(pair)), setMode, setScale,
    load: (kind) => { setPair(normalize(kind === "mark" ? outlinePair() : kind === "multi" ? sharedTextPair() : alternativesPair())); setResponses({}); setVersion((n) => n + 1); },
    command: (type) => setCommand({ type, token: `${Date.now()}-${Math.random()}` }),
    reload: () => { setPair(normalize(JSON.parse(JSON.stringify(pair)))); setResponses(JSON.parse(JSON.stringify(responses))); setVersion((n) => n + 1); },
  };
  const presentation = { command }, pub = pair.publicDocument, props = { assetUrl, presentation }, student = { ...props, document: pub, responses, onResponsesChange: setResponses };
  if (mode === "editor") return <NativeDragDropEditor key={version} bookSlug="ultimate-b2" componentSlug="ultimate-b2-students-book" activityId={pub.activityId} compositeBinding={{ ...pair, onPairChange: setPair }} />;
  return <div key={`${version}-${mode}`} data-mode={mode} className="hosted-native-draft-activity" data-native-kind={pub.kind} style={{ width: 1024, height: 582, transform: `scale(${scale})`, transformOrigin: "top left" }}>
    {pub.kind === "drag-drop" ? mode === "teacher" ? <NativeDragDropTeacherSurface {...pair} {...props} /> : <NativeDragDropStudentSurface {...student} /> : pub.kind === "multi-part" ? mode === "teacher" ? <NativeMultiPartTeacherSurface {...pair} {...props} /> : <NativeMultiPartStudentSurface {...student} /> : mode === "teacher" ? <NativeMarkWordsTeacherSurface {...pair} {...props} /> : <NativeMarkWordsStudentSurface {...student} />}
  </div>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
