import React, { useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { multiPartReadablePair, adaptiveBankPair } from "./runtime-corrections-data.js";
import { NativeMultiPartStudentSurface } from "../../../src/components/native-multi-part/NativeMultiPartStudentSurface.jsx";
import { NativeMultiPartTeacherSurface } from "../../../src/components/native-multi-part/NativeMultiPartTeacherSurface.jsx";
import { NativeMultiPartEditor } from "../../../src/apps/book-builder/hosted/NativeMultiPartEditor.jsx";
import { NativeDragDropStudentSurface } from "../../../src/components/native-drag-drop/NativeDragDropSurface.jsx";
import { NativeDragDropTeacherSurface } from "../../../src/components/native-drag-drop/NativeDragDropTeacherSurface.jsx";
import { NativeReadableTextPresentation } from "../../../src/components/native-readable-text/NativeReadableTextPresentation.jsx";
import { NativeAudioTextHotspotEditor } from "../../../src/apps/book-builder/hosted/NativeAudioTextHotspotEditor.jsx";
import { HostedNativeDraftActivityRunner } from "../../../src/components/lms/activities/ultimate-b2/HostedNativeDraftActivityRunner.jsx";
import { PublishedNativeStudentActivityRunner } from "../../../src/components/lms/activities/ultimate-b2/PublishedNativeStudentActivityRunner.jsx";
import { PublishedNativeTeacherActivityRunner } from "../../../src/components/lms/activities/ultimate-b2/PublishedNativeTeacherActivityRunner.jsx";
import TeacherBookNavigation from "../../../src/apps/android-teacher-offline/TeacherBookNavigation.jsx";
import { TeacherRuntimeUiAssetsProvider, canonicalTeacherRuntimeUiAssets } from "../../../src/apps/android-teacher-offline/legacyClassroomAssets.js";
import "../../../src/apps/android-teacher-offline/teacherFixedStage.css";
import "../../../src/apps/ultimate-b2-builder/studioAuthoring.css";
import "../../../src/apps/book-builder/styles/reviewStudio.css";

function App() {
  const [config, setConfig] = useState({ kind: "multi", path: "student", audio: false, scale: 1, session: 0 });
  const [pair, setPair] = useState(() => multiPartReadablePair());
  const [responses, setResponses] = useState({}); const [command, setCommand] = useState(null);
  const [state, setState] = useState(null); const [worksheet, setWorksheet] = useState(null);
  const [resetToken, setResetToken] = useState(0);
  const [message, setMessage] = useState(""); const [incomplete, setIncomplete] = useState(false);
  const send = (type) => { setCommand((old) => ({ type, token: (old?.token || 0) + 1 })); if (type === "reset-activity") setResetToken((old) => old + 1); };
  const pub = pair.publicDocument;
  const assetUrl = (id) => `/correction-assets/${pub.assets.find((asset) => asset.assetId === id)?.slot}`;
  const changeWorksheet = useCallback((action) => setWorksheet(() => action), []);
  const presentation = useMemo(() => ({ command, onStateChange: setState, onWorksheetActionChange: changeWorksheet }), [command, changeWorksheet]);
  globalThis.corrections = { pair, responses, state, config, incomplete, assetUrl, setPair, send,
    configure: (values) => { const next = { ...config, ...values, session: config.session + 1 }; globalThis.document.documentElement.dataset.appMode=next.kind === "worksheet" ? "android-teacher-offline" : ""; setConfig(next); setResponses({}); setCommand(null); setState(null); setPair(next.kind === "multi" ? multiPartReadablePair(next.audio) : adaptiveBankPair(next.layout || "text", next.images)); },
    setCustom: (custom) => setConfig((old) => ({...old,custom})), setResponses, setScale: (scale) => setConfig((old) => ({ ...old, scale })), setReadOnly: (readOnly) => setConfig((old) => ({ ...old, readOnly })),
  };
  const shell = config.kind === "worksheet";
  const preview = config.path === "editor";
  let body;
  if (preview) body = <NativeAudioTextHotspotEditor bookSlug="ultimate-b2" componentSlug="ultimate-b2-students-book" activityId={pub.activityId} publicDraft={pub} mutatePublic={(mutator) => setPair((old) => { const next = structuredClone(old); mutator(next.publicDocument); return next; })} previewUrl={assetUrl} onIncompleteChange={setIncomplete} onStatusChange={setMessage} />;
  else if (config.path === "builder") body = <NativeMultiPartEditor bookSlug="ultimate-b2" componentSlug="ultimate-b2-students-book" activityId={pub.activityId} />;
  else if (config.path === "published-student") body = <PublishedNativeStudentActivityRunner entry={{ kind: pub.kind, document: pub }} publication={{ releaseId: "isolated-release", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" }} presentation={presentation} responses={responses} onResponsesChange={setResponses} readOnly={config.readOnly} showMetadataHeader={false} />;
  else if (config.path === "published-teacher") body = <PublishedNativeTeacherActivityRunner entry={{ kind: pub.kind, document: pub }} publication={{ releaseId: "isolated-release", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" }} presentation={presentation} showMetadataHeader={false} />;
  else if (config.path.startsWith("draft")) body = <HostedNativeDraftActivityRunner activityId={pub.activityId} state={{ kind: "ready", entry: { kind: pub.kind, document: pub }, teacher: { kind: "ready", entry: { document: pair.teacherDocument } } }} showMetadataHeader={false} teacherMode={config.path === "draft-teacher"} presentation={presentation} />;
  else body = <NativeReadableTextPresentation document={pub} assetUrl={assetUrl} presentation={presentation}>{(child, audioHotspotPresentation) => <article className="published-native-activity" data-native-kind={pub.kind}>
    {config.kind === "multi" ? config.path === "teacher" ? <NativeMultiPartTeacherSurface publicDocument={pub} teacherDocument={pair.teacherDocument} assetUrl={assetUrl} presentation={child} audioHotspotPresentation={audioHotspotPresentation} /> : <NativeMultiPartStudentSurface document={pub} assetUrl={assetUrl} responses={responses} onResponsesChange={setResponses} readOnly={config.readOnly} presentation={child} audioHotspotPresentation={audioHotspotPresentation} />
    : config.path === "teacher" ? <NativeDragDropTeacherSurface publicDocument={pub} teacherDocument={pair.teacherDocument} assetUrl={assetUrl} presentation={child} /> : <NativeDragDropStudentSurface document={pub} assetUrl={assetUrl} responses={responses} onResponsesChange={setResponses} readOnly={config.readOnly} resetToken={resetToken} />}
  </article>}</NativeReadableTextPresentation>;
  const ui = config.custom ? { ...canonicalTeacherRuntimeUiAssets, classroom: { ...canonicalTeacherRuntimeUiAssets.classroom, icons: { ...canonicalTeacherRuntimeUiAssets.classroom.icons, videoWorksheet: "/correction-assets/custom-worksheet" } } } : canonicalTeacherRuntimeUiAssets;
  return <><div style={{ display: "flex", gap: 8 }}>{["previous-panel", "next-panel", "toggle-text", "show-next", "show-all", "reset-activity"].map((type) => <button key={type} onClick={() => send(type)}>{type}</button>)}</div>
    {message ? <p role="status">{message}</p> : null}<main key={config.session} style={{ width: "min(100%, 1024px)", height: preview || config.path === "builder" ? "auto" : shell ? 790 : 700, "--teacher-presentation-screen-padding-bottom":"0px", "--teacher-fixed-classroom-toolbar-height":"0px", "--teacher-presentation-grid-gap":"0px", transform: `scale(${config.scale})`, transformOrigin: "top left", position: "relative" }}>{shell ? <div style={{height:700}}>{body}</div> : body}
    {shell ? <TeacherRuntimeUiAssetsProvider value={ui}><TeacherBookNavigation contextActions={[{ id: "video", label: "Video", ariaLabel: "Open Video", iconName: "video", active: state?.view === "video", onClick: () => send("toggle-video") }, ...(worksheet ? [worksheet] : [])]} /></TeacherRuntimeUiAssetsProvider> : null}</main>
  </>;
}
createRoot(document.getElementById("root")).render(<App />);
