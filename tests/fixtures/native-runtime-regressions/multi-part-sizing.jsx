import "../../../src/apps/android-teacher-offline/teacherOfflinePageViewer.css";
import "../../../src/apps/android-teacher-offline/teacherFixedStage.css";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { NativeMultiPartStudentSurface } from "../../../src/components/native-multi-part/NativeMultiPartStudentSurface.jsx";
import { NativeMultiPartTeacherSurface } from "../../../src/components/native-multi-part/NativeMultiPartTeacherSurface.jsx";
import { publicDocument, teacherDocument } from "./multi-part-data.js";
const document = structuredClone(publicDocument);
const interaction = document.parts[0].interaction;
const dd = interaction.sections[0]; const cts = interaction.sections.find((section) => section.kind === "complete-sentences");
const flow = interaction.panels[1];
const teacherDoc = structuredClone(teacherDocument); teacherDoc.parts[0].solution.sections = teacherDoc.parts[0].solution.sections.filter((entry) => [dd.id, cts.id].includes(entry.id));
dd.bankRegion = null; dd.panelId = flow.id; cts.panelId = flow.id;
dd.interaction.panels[0].images = [{ id: "img-00000000000000000000000000000001", assetSlot: "shared", area: { x: 0, y: 0, width: 1024, height: 582 }, order: 0, altText: "Worksheet", decorative: true, fit: "contain", locked: true }];
cts.interaction.presentation.panels[0].hotspots[0].area.y = 530;
interaction.sections = [dd, cts]; interaction.panels = [flow];
function Fixture() {
 const [teacher, setTeacher] = useState(false);
 const [split, setSplit] = useState(false); const [open, setOpen] = useState(true); const [responses, setResponses] = useState({});
 globalThis.sizingFixture = { setSplit, setOpen, setTeacher, responses };
 const doc = structuredClone(document);
 if (split) { const next = { ...flow, id: "panel-00000000000000000000000000000009" }; doc.parts[0].interaction.panels.push(next); doc.parts[0].interaction.sections[1].panelId = next.id; }
 return <><button onClick={() => globalThis.document.getElementById("sizing-host").requestFullscreen()}>Fullscreen fixture</button><div id="sizing-host" style={{ width: "100vw", height: "70vh", overflow: "hidden" }}><div className="teacher-offline-embedded-activity"><div className="teacher-offline-embedded-activity-content"><div className="published-native-activity" data-native-kind="multi-part">{open ? teacher ? <NativeMultiPartTeacherSurface publicDocument={doc} teacherDocument={teacherDoc} assetUrl={() => "/synthetic-shared.png"} /> : <NativeMultiPartStudentSurface document={doc} assetUrl={() => "/synthetic-shared.png"} responses={responses} onResponsesChange={setResponses} /> : null}</div></div></div></div></>;
}
globalThis.document.documentElement.dataset.appMode = "android-teacher-offline";
createRoot(globalThis.document.getElementById("root")).render(<Fixture />);
