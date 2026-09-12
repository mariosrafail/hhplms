import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { HostedTeacherUiController } from "../../src/apps/ultimate-b2-builder/HostedTeacherUiController.jsx";
import { HostedPackageReview } from "../../src/apps/book-builder/hosted/HostedPackageReview.jsx";
import { NativeActivityFontControls } from "../../src/apps/book-builder/hosted/NativeCompleteSentencesFontControls.jsx";
import { useNativeListeningResponseFonts } from "../../src/apps/book-builder/hosted/useNativeListeningResponseFonts.js";
import "../../src/apps/book-builder/hosted/hostedBuilder.css";
import "../../src/apps/ultimate-b2-builder/ultimateB2TeacherAppBuilder.css";
import "../../src/apps/ultimate-b2-builder/hostedUltimateB2BuilderReview.css";
import "../../src/apps/ultimate-b2-builder/hostedUltimateB2BuilderModern.css";
import "../../src/apps/ultimate-b2-builder/studioAuthoring.css";

function ActivityFont({ bookSlug, componentSlug }) {
  const [message, setMessage] = useState("");
  const [font, setFont] = useState(null);
  const library = useNativeListeningResponseFonts({ bookSlug, componentSlug, onMessage: setMessage, mutatePublic: () => {}, selectedQuestionId: "fixture" });
  return <section><h1>Existing activity font control</h1><NativeActivityFontControls {...library} bookSlug={bookSlug} componentSlug={componentSlug} selectedSlot={font?.slot} onSelect={setFont} onUploaded={library.recordUploadedFont} onMessage={setMessage} /><p>{message}</p></section>;
}
function App() {
  const [bookSlug, setBook] = useState("ultimate-b1"), [view, setView] = useState("activity");
  const componentSlug = `${bookSlug}-students-book`;
  return <><nav>{["ultimate-b1", "ultimate-b1-plus", "ultimate-b2"].map((book) => <button key={book} onClick={() => setBook(book)}>{book}</button>)}<button onClick={() => setView("activity")}>Activity selector</button><button onClick={() => setView("ui")}>Overview selector</button></nav>
    {view === "activity" ? <ActivityFont key={bookSlug} bookSlug={bookSlug} componentSlug={componentSlug} />
      : <HostedPackageReview tool="ui" pages={[]} bookSlug={bookSlug} componentSlug={componentSlug}><HostedTeacherUiController bookSlug={bookSlug} componentSlug={componentSlug} bookTitle={bookSlug} /></HostedPackageReview>}
  </>;
}
createRoot(document.getElementById("root")).render(<App />);
