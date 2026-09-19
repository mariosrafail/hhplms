import { useEffect, useId, useRef, useState } from "react";
import { Eye, EyeOff, Volume2, X } from "lucide-react";
import { registerClassroomLayer } from "./classroomLayers.js";
import { pauseSiblingNativeMedia } from "../native-readable-text/nativeMediaArbitration.js";
import "./wordList.css";

export function WordListOverlay({ model, frameRef, subtitle }) {
  const { open, entries, wordlist } = model;
  const [hidden, setHidden] = useState({ en: new Set(), el: new Set() });
  const [playback, setPlayback] = useState({ id: "", state: "idle" });
  const dialog = useRef(null);
  const player = useRef(null); const epoch = useRef(0); const live = useRef(false); const latest = useRef(model); latest.current = model;
  const titleId = useId();
  const stop = () => { epoch.current++; const audio = player.current; if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); } setPlayback({ id: "", state: "idle" }); };
  useEffect(() => {
    live.current = open;
    if (!open) { stop(); return undefined; }
    const frame = frameRef.current; const previousFocus = document.activeElement;
    // The frame is the media scope, so unrelated application frames are untouched.
    pauseSiblingNativeMedia(player.current);
    dialog.current?.querySelector("button")?.focus();
    const close = () => latest.current.close();
    const unregister = registerClassroomLayer(frame, close);
    const key = (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
      if (event.key === "Tab") {
        const controls = [...dialog.current.querySelectorAll("button:not(:disabled)")];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
    };
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener("keydown", key, true); document.addEventListener("visibilitychange", hide);
    return () => {
      live.current = false; stop(); unregister();
      document.removeEventListener("keydown", key, true); document.removeEventListener("visibilitychange", hide);
      if (previousFocus?.isConnected && frame?.contains(previousFocus)) previousFocus.focus();
    };
  }, [open, frameRef]);
  const play = async (entry) => {
    stop(); const token = epoch.current; const audio = player.current;
    setPlayback({ id: entry.id, state: "loading" });
    try {
      audio.src = latest.current.audioUrl(entry.audioSha256); pauseSiblingNativeMedia(audio);
      await audio.play();
      if (!live.current) { audio.pause(); return; }
      if (epoch.current === token) setPlayback({ id: entry.id, state: "playing" });
    } catch { if (live.current && epoch.current === token) setPlayback({ id: entry.id, state: "error" }); }
  };
  const toggle = (language, id) => setHidden((current) => {
    const values = new Set(current[language]); values.has(id) ? values.delete(id) : values.add(id);
    return { ...current, [language]: values };
  });
  const all = (language) => setHidden((current) => ({ ...current, [language]: entries.some((entry) => current[language].has(entry.id)) ? new Set() : new Set(entries.map((entry) => entry.id)) }));
  const languages = wordlist.policy.id === "english-greek.v1" ? ["en", "el"] : ["en"];
  return <section ref={dialog} hidden={!open} className="word-list-overlay" role="dialog" aria-modal="false" aria-labelledby={titleId}
    data-word-list-overlay="" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
    <header className="word-list-title"><div><h2 id={titleId}>Word List</h2><p>{subtitle}</p></div>
      <button type="button" aria-label="Close Word List" onClick={model.close}><X aria-hidden="true" /></button></header>
    <div className="word-list-scroll">
      <div className={`word-list-columns ${languages.length === 1 ? "word-list-columns--english" : ""}`}>
        <div className="word-list-headings">{languages.map((language) => {
          const someHidden = entries.some((entry) => hidden[language].has(entry.id)); const label = language === "en" ? "English" : "Greek";
          return <div key={language}><h3>{label}</h3><button type="button" aria-label={`${someHidden ? "Show" : "Hide"} all ${label} words`} onClick={() => all(language)}>
            {someHidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button></div>;
        })}</div>
        {entries.map((entry) => <div className="word-list-row" data-word-list-entry={entry.id} key={entry.id}>
          {languages.map((language) => <div className="word-list-cell" lang={language} key={language}>
            {language === "en" && <button type="button" className="word-list-speaker" aria-label={`Play English pronunciation ${entry.displayNumber}`} aria-pressed={playback.id === entry.id && playback.state === "playing"}
              data-playback={playback.id === entry.id ? playback.state : "idle"} onClick={() => play(entry)}><Volume2 aria-hidden="true" /></button>}
            <button type="button" className="word-list-number" aria-label={`Toggle ${language === "en" ? "English" : "Greek"} ${entry.displayNumber}`} aria-pressed={!hidden[language].has(entry.id)} onClick={() => toggle(language, entry.id)}>{entry.displayNumber}</button>
            <span className="word-list-word" style={{ visibility: hidden[language].has(entry.id) ? "hidden" : "visible" }} aria-hidden={hidden[language].has(entry.id)}>{String(language === "en" ? entry.english.word : entry.translations.el)}</span>
          </div>)}
        </div>)}
      </div>
    </div>
    <footer aria-live="polite">{playback.state === "loading" ? "Loading pronunciation…" : playback.state === "playing" ? "Playing English pronunciation" : playback.state === "error" ? "Pronunciation could not play. Select the speaker to retry." : "English pronunciation · Tap a number to show or hide its word"}</footer>
    <audio ref={player} preload="none" onEnded={() => setPlayback({ id: "", state: "idle" })}
      onError={() => { if (live.current && player.current?.getAttribute("src")) setPlayback((current) => ({ ...current, state: "error" })); }} />
  </section>;
}
