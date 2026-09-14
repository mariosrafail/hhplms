import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createOldschoolModePair } from "../oldschool-modes.js";
import { NativeReadableTextPresentation } from "../../../src/components/native-readable-text/NativeReadableTextPresentation.jsx";
import { NativeOldschoolListeningStudentSurface } from "../../../src/components/native-oldschool-listening/NativeOldschoolListeningStudentSurface.jsx";
import { NativeOldschoolListeningTeacherSurface } from "../../../src/components/native-oldschool-listening/NativeOldschoolListeningTeacherSurface.jsx";
import { NativeOldschoolListeningEditor } from "../../../src/apps/book-builder/hosted/NativeOldschoolListeningEditor.jsx";
import { NativeOldschoolQuestionEditor } from "../../../src/apps/book-builder/hosted/NativeOldschoolQuestionEditor.jsx";
import { NativeOpenResponseEditor } from "../../../src/apps/book-builder/hosted/NativeOpenResponseEditor.jsx";
import { HostedNativeDraftActivityRunner } from "../../../src/components/lms/activities/ultimate-b2/HostedNativeDraftActivityRunner.jsx";
import { PublishedNativeStudentActivityRunner } from "../../../src/components/lms/activities/ultimate-b2/PublishedNativeStudentActivityRunner.jsx";
import { PublishedNativeTeacherActivityRunner } from "../../../src/components/lms/activities/ultimate-b2/PublishedNativeTeacherActivityRunner.jsx";
import "../../../src/apps/book-builder/styles/reviewStudio.css";
import "../../../src/apps/book-builder/hosted/hostedBuilder.css";
import "../../../src/apps/book-builder/hosted/hostedBuilderModern.css";
import "../../../src/apps/ultimate-b2-builder/studioAuthoring.css";

function BindingLifecycle() {
  const pair = useMemo(() => createOldschoolModePair("open-response", 4), []);
  const [mounted, setMounted] = useState(true); const [message, setMessage] = useState("");
  return <><button onClick={() => setMounted(false)}>Unmount rejected editor</button>{message ? <p role="alert">{message}</p> : null}{mounted ? <NativeOldschoolQuestionEditor {...pair} bookSlug="ultimate-b2" componentSlug="ultimate-b2-students-book" activityId={pair.publicDocument.activityId} authoringTab="content" mutatePair={() => { throw new Error("Rejected parent canvas resize"); }} onStatusChange={setMessage} /> : null}</>;
}

function App() {
  const [config, configure] = useState({ mode: "open-response", supporting: 0, path: "student", shell: true, session: 0 });
  const [responses, setResponses] = useState({});
  const [command, setCommand] = useState(null); const [state, setState] = useState(null);
  const pair = useMemo(() => createOldschoolModePair(config.mode, config.supporting, config), [config.mode, config.supporting, config.session]);
  const assetUrl = (id) => `/oldschool-mode-assets/${id}`;
  globalThis.oldschoolModes = { configure: (next) => { setResponses({}); setCommand(null); configure((current) => ({ ...current, ...next, session: current.session + 1 })); return config.session + 1; }, pair, assetUrl, state, responses, command: (type) => setCommand({ type, token: crypto.randomUUID() }) };
  const presentation = config.shell ? { command, onStateChange: setState } : null;
  const editorProps = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", activityId: pair.publicDocument.activityId };
  const entry = { kind: "oldschool-listening", document: pair.publicDocument };
  return <main data-session={config.session} style={{ maxWidth: 1024, margin: "0 auto" }} key={config.session}>
    {config.path === "binding-lifecycle" ? <BindingLifecycle /> : config.path === "builder" ? <NativeOldschoolListeningEditor {...editorProps} /> : config.path === "standalone" ? <NativeOpenResponseEditor {...editorProps} /> : <>
      {config.shell ? <nav aria-label="Fixture shell">{["previous-panel", "next-panel", "toggle-text", "show-next", "show-all", "reset-activity"].filter((type) => type !== "toggle-text" || state?.readableTextAvailable).map((type) => <button key={type} onClick={() => globalThis.oldschoolModes.command(type)}>{type}</button>)}</nav> : null}
      {config.path.startsWith("draft-") ? <HostedNativeDraftActivityRunner activityId={pair.publicDocument.activityId} state={{ kind: "ready", entry, teacher: { kind: "ready", entry: { document: pair.teacherDocument } } }} teacherMode={config.path === "draft-teacher"} presentation={presentation} showMetadataHeader={false} /> : config.path.startsWith("published") ? config.path === "published-student" ? <PublishedNativeStudentActivityRunner entry={entry} publication={{ releaseId: "isolated-oldschool-release" }} presentation={presentation} showMetadataHeader={false} /> : <PublishedNativeTeacherActivityRunner entry={entry} publication={{ releaseId: "isolated-oldschool-release" }} presentation={presentation} showMetadataHeader={false} /> : <NativeReadableTextPresentation document={pair.publicDocument} assetUrl={assetUrl} presentation={presentation}>{(activityPresentation, audioHotspotPresentation) => config.path === "teacher" ? <NativeOldschoolListeningTeacherSurface {...pair} assetUrl={assetUrl} presentation={activityPresentation} audioHotspotPresentation={audioHotspotPresentation} /> : <NativeOldschoolListeningStudentSurface responses={config.controlled ? responses : null} onResponsesChange={config.controlled ? setResponses : null} readOnly={Boolean(config.readOnly)} document={pair.publicDocument} assetUrl={assetUrl} presentation={activityPresentation} audioHotspotPresentation={audioHotspotPresentation} />}</NativeReadableTextPresentation>}
    </>}
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);
