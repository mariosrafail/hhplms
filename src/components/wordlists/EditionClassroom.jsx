import { useEffect, useMemo, useState } from "react";
import { loadEditionClassroom } from "../../data/wordlists/classroom.js";
import { loadWordList, wordListAudioUrl } from "../../data/wordlists/loader.js";
import { stableJson } from "../../data/wordlists/portable.js";
import { SharedEditionClassroom } from "./SharedEditionClassroom.jsx";
const noOp = () => {};
export function EditionClassroom({ context, teacherMode = false, onClose = noOp }) {
  const rootIdentity = stableJson(context);
  const [selection, setSelection] = useState(null);
  if (selection?.root === rootIdentity && selection.component !== context.componentSlug) {
    const { targetSource: _source, sourcePageIds: _pages, ...base } = context;
    context = { ...base, componentSlug: selection.component };
  }
  const identity = stableJson(context); const [attempt, setAttempt] = useState(0); const [state, setState] = useState(null);
  useEffect(() => {
    const controller = new AbortController(); setState(null);
    loadEditionClassroom(JSON.parse(identity), { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setState({ identity, value }); })
      .catch((error) => { if (!controller.signal.aborted) setState({ identity, error: error.message }); });
    return () => controller.abort();
  }, [identity, attempt]);
  const current = state?.identity === identity ? state : null;
  return <section className="edition-classroom-host" aria-label="Edition classroom">
    <header><strong>{context.editionId === "greek" ? "Greek" : "International"} · {context.kind === "draft" ? "Saved draft" : context.kind === "candidate" ? "Immutable candidate" : "Published edition"}</strong><button type="button" onClick={onClose}>Close classroom</button></header>
    {!current ? <p role="status">Loading verified classroom…</p> : current.error ? <p role="alert">{current.error} <button onClick={() => setAttempt((value) => value + 1)}>Retry classroom</button></p>
      : <LoadedClassroom key={identity} data={current.value} teacherMode={teacherMode} onClose={onClose} onComponentSwitch={(component) => setSelection({ root: rootIdentity, component })} />}
  </section>;
}
function LoadedClassroom(props) {
  const provider = useMemo(() => ({ context: props.data.context, load: loadWordList, audioUrl: wordListAudioUrl }), [props.data]);
  return <SharedEditionClassroom {...props} wordListProvider={provider} />;
}
