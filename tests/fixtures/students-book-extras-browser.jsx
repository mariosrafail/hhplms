import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { UnitExtrasEditor } from "../../src/apps/ultimate-b2-builder/UnitExtrasEditor.jsx";
import { loadHostedDraftUnitExtras } from "../../src/apps/android-teacher-offline/hostedComponentReleaseProvider.js";
import { HOSTED_VIEWER_RUNTIME_MODES } from "../../src/apps/android-teacher-offline/hostedReleasePreview.js";
import { BookUnitExtraVideos } from "../../src/components/lms/books/BookUnitExtraVideos.jsx";
import { BookUnitExtraAudios } from "../../src/components/lms/books/BookUnitExtraAudios.jsx";
import { ExtrasPreviewContext } from "./students-book-extras-preview-provider.js";
import "../../src/apps/book-builder/hosted/hostedBuilder.css";

function Acceptance() {
  const [selection, select] = useState(null);
  const [publication, setPublication] = useState({ kind: "none" });
  const [page, setPage] = useState(null);
  const config = window.extrasFixture;
  // Test-only controller permits deterministic selection changes while requests
  // are pending. The editor, API clients and media components are production code.
  window.selectExtrasFixture = select;
  const preview = async (unitNumber) => {
    setPublication(await loadHostedDraftUnitExtras({ context: { kind: HOSTED_VIEWER_RUNTIME_MODES.BUILDER_PREVIEW, authorization: config.authorization } }));
    setPage({ unitNumber, pageId: unitNumber === 3 ? config.canonicalId : config.managedId });
  };
  return <main><h1>Synthetic Unit Extras acceptance</h1>
    {[3, 10].map((unitNumber) => <section key={unitNumber}><h2>Unit {unitNumber}</h2>
      {["videos", "audios"].map((category) => <button key={category} onClick={() => select({ unit: { unitNumber, title: `Unit ${unitNumber}` }, category })}>Edit Unit {unitNumber} {category}</button>)}
      <button onClick={() => preview(unitNumber)}>Saved Draft Unit {unitNumber}</button>
    </section>)}
    <UnitExtrasEditor open={Boolean(selection)} unit={selection?.unit} category={selection?.category} onClose={() => select(null)} />
    <ExtrasPreviewContext.Provider value={publication}>{page ? <section aria-label="Saved Draft media" style={{ position: "relative", minHeight: 180 }}><BookUnitExtraVideos {...page} /><BookUnitExtraAudios {...page} /></section> : null}</ExtrasPreviewContext.Provider>
  </main>;
}
createRoot(document.getElementById("root")).render(<Acceptance />);
