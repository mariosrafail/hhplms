import "./entry.css";
import { Component, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@capacitor/app";
import { SharedEditionClassroom } from "../../components/wordlists/SharedEditionClassroom.jsx";
import { consumeClassroomBack } from "../../components/wordlists/classroomLayers.js";
import { installPack, offlineClassroom } from "./provider.js";
import { installTeacherOfflineNetworkGuard } from "../android-teacher-offline/teacherOfflineNetworkGuard.js";

class Boundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main role="alert">Offline content could not open. Rebuild this edition from its verified release.</main> : this.props.children; }
}
function Classroom({ manifest }) {
  const [component, setComponent] = useState("ultimate-b2-students-book");
  const data = useMemo(() => component ? offlineClassroom(component) : null, [component]);
  return <section className="edition-classroom-host"><header><strong>Ultimate B2 · {manifest.editionId === "greek" ? "Greek" : "International"} Edition · Teacher</strong><span>Offline debug review build</span></header>
    {data ? <SharedEditionClassroom key={component} data={data} teacherMode={true} wordListProvider={data.wordListProvider} onComponentSwitch={setComponent} onClose={() => setComponent(null)} />
      : <main aria-label="Offline book library"><h1>Choose a book</h1>{[["students-book", "Students Book"], ["workbook", "Workbook"], ["grammar-book", "Grammar Book"]].map(([id, label]) => <button key={id} onClick={() => setComponent(`ultimate-b2-${id}`)}>{label}</button>)}</main>}
  </section>;
}
function OfflineEdition() {
  const [state, setState] = useState({ progress: "Verifying offline edition…" });
  useEffect(() => { let active = true;
    installPack(__OFFLINE_PACK_SHA256__, (count, total) => { if (active) setState({ progress: `Verifying content ${count}/${total}…` }); })
      .then((manifest) => { if (active) setState({ manifest: manifest.snapshot }); }).catch(() => { if (active) setState({ error: true }); });
    const listener = App.addListener("backButton", () => { if (consumeClassroomBack()) return; document.querySelector('[aria-label="Back"]')?.click(); });
    return () => { active = false; listener.then((handle) => handle.remove()); };
  }, []);
  if (state.error) return <main role="alert">Offline edition is missing or damaged. Rebuild this exact edition pack.</main>;
  return state.manifest ? <Classroom manifest={state.manifest} /> : <main role="status">{state.progress}</main>;
}
document.documentElement.dataset.appMode = "android-teacher-edition";
installTeacherOfflineNetworkGuard();
createRoot(document.getElementById("root")).render(<Boundary><OfflineEdition /></Boundary>);
