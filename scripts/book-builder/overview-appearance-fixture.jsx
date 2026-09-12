import React from "react";
import { createRoot } from "react-dom/client";
import TeacherOfflineUnitOverview from "../../src/apps/android-teacher-offline/TeacherOfflineUnitOverview.jsx";
import { ClassroomToolsProvider } from "../../src/apps/android-teacher-offline/ClassroomToolsContext.jsx";
import { TeacherRuntimeUiAssetsProvider, createUltimateB2TeacherRuntimeUiAssets } from "../../src/apps/android-teacher-offline/legacyClassroomAssets.js";
import TeacherFixedStage from "../../src/apps/android-teacher-offline/TeacherFixedStage.jsx";
import "../../src/apps/android-teacher-offline/teacherOfflineRoot.css";
document.documentElement.dataset.appMode = "android-teacher-offline";
import runtime from "../../src/data/ultimate-b2/generated/students-book.runtime.json";

const root = createRoot(document.getElementById("root"));
const image = (spread) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${spread ? 1180 : 581}" height="794"><rect width="100%" height="100%" fill="#fffdf1"/><rect x="10" y="10" width="${spread ? 1160 : 561}" height="774" fill="none" stroke="#155f80" stroke-width="10"/><text x="45" y="110" font-size="42">${spread ? "Two pages" : "One page"}</text>${spread ? '<path d="M590 0V794" stroke="#155f80" stroke-width="5"/>' : ""}</svg>`)}`;
window.renderOverview = ({ bookSlug = "ultimate-b1", component = "students-book", dense = false, ui = null } = {}) => {
  const canonical = bookSlug === "ultimate-b2" && component === "students-book";
  const unit = canonical ? { ...runtime.units[0], pages: runtime.units[0].pages.map((page) => ({ ...page, images: [image(page.pageNumbers.length > 1)] })) } : { number: 1, pages: Array.from({ length: dense ? 10 : 4 }, (_, index) => {
    const spread = index % 2 === 1;
    return { id: `fixture-${index}`, title: `internal-page-${index}`, label: `Section ${index + 1}`, spreadNumber: String(6 + index * 2) + (spread ? `-${7 + index * 2}` : ""), pageNumbers: [], imageWidth: spread ? 1180 : 581, imageHeight: 794, images: [image(spread)] };
  }) };
  const identity = { bookSlug, componentSlug: `${bookSlug}-${component}` };
  const assets = createUltimateB2TeacherRuntimeUiAssets(ui, { kind: "builder-preview" }, { bookSlug, componentSlug: `${bookSlug}-students-book` });
  const viewport = { width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0, displayScale: Math.min(innerWidth / 1920, innerHeight / 1080) };
  root.render(<TeacherRuntimeUiAssetsProvider value={assets}><ClassroomToolsProvider><TeacherFixedStage viewport={viewport}><main className="teacher-offline-settings-surface" data-teacher-theme="modern"><div className="teacher-offline-book unit-overview-active" style={{ height: "100%", "--legacy-classroom-background": `url(${assets.classroom.backgrounds.classroomGlacier})`, "--legacy-students-book-parts-background": `url(${assets.classroom.backgrounds.studentsBookPartsBackground})` }}><TeacherOfflineUnitOverview unit={unit} selectedBookId={component} componentIdentity={identity} onSelectPage={(id) => { window.selectedPage = id; }} /></div></main></TeacherFixedStage></ClassroomToolsProvider></TeacherRuntimeUiAssetsProvider>);
};
window.renderOverview();
