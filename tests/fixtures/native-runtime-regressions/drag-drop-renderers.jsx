import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { HostedNativeDraftActivityRunner } from "../../../src/components/lms/activities/ultimate-b2/HostedNativeDraftActivityRunner.jsx";
import { PublishedNativeStudentActivityRunner } from "../../../src/components/lms/activities/ultimate-b2/PublishedNativeStudentActivityRunner.jsx";
import { PublishedNativeTeacherActivityRunner } from "../../../src/components/lms/activities/ultimate-b2/PublishedNativeTeacherActivityRunner.jsx";
import { dragDropImprovementsPair } from "./drag-drop-improvements-data.js";

function Fixture() {
  const [pair, setPair] = useState(dragDropImprovementsPair);
  const [teacher, setTeacher] = useState(false);
  const [scale, setScale] = useState(1);
  const published = new URLSearchParams(location.search).get("runtime") === "published";
  const entry = { kind: "drag-drop", document: pair.publicDocument };
  globalThis.dnd = { pair, setPair, setTeacher, setScale };
  // Existing localProviders replaces data delivery only, never the renderers.
  globalThis.nativePresentationFixture = { choice: pair, assetUrl: (id) => `/dnd-fixture/${pair.publicDocument.assets.find((asset) => asset.assetId === id)?.slot}` };
  return <div style={{ width: "100%", maxWidth: 1024, height: 670, transform: `scale(${scale})`, transformOrigin: "top left" }}>
    {published ? teacher
      ? <PublishedNativeTeacherActivityRunner entry={entry} publication={{ releaseId: "isolated-dnd-release" }} showMetadataHeader={false} />
      : <PublishedNativeStudentActivityRunner entry={entry} publication={{ releaseId: "isolated-dnd-release" }} showMetadataHeader={false} />
      : <HostedNativeDraftActivityRunner activityId={pair.publicDocument.activityId} state={{ kind: "ready", entry, teacher: { kind: "ready", entry: { document: pair.teacherDocument } } }} teacherMode={teacher} showMetadataHeader={false} />}
  </div>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
