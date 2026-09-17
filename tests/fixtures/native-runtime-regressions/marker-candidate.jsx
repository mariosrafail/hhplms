import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { nativeMarkerCandidate } from "../native-marker-candidate.js";
import { NativeMarkWordsStudentSurface } from "../../../src/components/native-mark-words/NativeMarkWordsStudentSurface.jsx";
import { NativeMarkWordsTeacherSurface } from "../../../src/components/native-mark-words/NativeMarkWordsTeacherSurface.jsx";
import { NativeMarkWordsVisualEditor } from "../../../src/apps/book-builder/hosted/NativeMarkWordsVisualEditor.jsx";
import { NativeAudioTextHotspotEditor } from "../../../src/apps/book-builder/hosted/NativeAudioTextHotspotEditor.jsx";
import { NativeReadableTextPresentation } from "../../../src/components/native-readable-text/NativeReadableTextPresentation.jsx";
const assetUrl = () => "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="582"><rect width="1024" height="582" fill="#d5e5ed"/><text x="60" y="370" font-size="28">First     Second     Distractor</text></svg>');
function Fixture() {
 const [pair, setPair] = useState(nativeMarkerCandidate); const [mode, setMode] = useState("student"); const [responses, setResponses] = useState({}); const [scale, setScale] = useState(1); const [version, setVersion] = useState(0);
 const mutatePair = (fn) => setPair((current) => { const next = structuredClone(current); fn(next.publicDocument, next.teacherDocument); return next; });
 const mutatePublic = (fn) => mutatePair((pub) => fn(pub));
 globalThis.markerFixture = { pair, responses, setPair, setMode, setScale, setResponses, reset: () => setVersion((n) => n + 1) };
 return mode === "hotspot-editor" ? <NativeAudioTextHotspotEditor bookSlug="ultimate-b2" componentSlug="ultimate-b2-students-book" activityId={pair.publicDocument.activityId} publicDraft={pair.publicDocument} mutatePublic={mutatePublic} previewUrl={assetUrl} onIncompleteChange={() => {}} onStatusChange={() => {}} /> : mode === "editor" ? <NativeMarkWordsVisualEditor bookSlug="ultimate-b2" componentSlug="ultimate-b2-students-book" activityId={pair.publicDocument.activityId} publicDraft={pair.publicDocument} teacherDraft={pair.teacherDocument} {...{ mutatePair, mutatePublic, assetUrl }} onMessage={() => {}} onUploading={() => {}} isActive={() => true} /> : <div style={{ width: 1024, height: 582, transform: `scale(${scale})`, transformOrigin: "top left" }}><NativeReadableTextPresentation key={version} document={pair.publicDocument} assetUrl={assetUrl}>{(presentation, audioHotspotPresentation) => mode === "teacher" ? <NativeMarkWordsTeacherSurface {...pair} {...{ assetUrl, presentation, audioHotspotPresentation }} /> : <NativeMarkWordsStudentSurface document={pair.publicDocument} {...{ assetUrl, responses, audioHotspotPresentation }} onResponsesChange={setResponses} readOnly={mode === "review"} />}</NativeReadableTextPresentation></div>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
