import { useEffect, useMemo, useRef, useState } from "react";
import { Music } from "lucide-react";
import { publishedUnitExtraAudioUrl, usePublishedComponentRelease } from "virtual:component-publication";

import { unitExtraAudiosForPage } from "../../../data/ultimate-b2/unitExtras.js";
import "./BookUnitExtraAudios.css";

export function BookUnitExtraAudiosForPublication({ publication, unitNumber, pageId, hidden = false }) {
  const audios = useMemo(() => unitExtraAudiosForPage(publication, { unitNumber, pageId }), [pageId, publication, unitNumber]);
  const [activeId, setActiveId] = useState("");
  const audioRef = useRef(null);
  const active = audios.find((entry) => entry.id === activeId) || audios[0] || null;

  useEffect(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    setActiveId("");
  }, [hidden, pageId, publication?.releaseId, publication?.revision, unitNumber]);
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  if (hidden || !active) return null;
  return <section className="book-page-extra-audios" aria-label="Extra Audio">
    <header><Music aria-hidden="true" /><strong>{active.title}</strong></header>
    {audios.length > 1 ? <label><span>Audio track</span><select value={active.id} onChange={(event) => { audioRef.current?.pause(); setActiveId(event.target.value); }} aria-label="Extra Audio track">{audios.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label> : null}
    {active.readiness === "missing-media" ? <p role="status">Not ready: MP3 required</p> : <audio ref={audioRef} controls preload="metadata" src={publishedUnitExtraAudioUrl(publication, active.audio.asset)} aria-label={`${active.title} Extra Audio player`} />}
  </section>;
}

export function BookUnitExtraAudios(props) {
  const publication = usePublishedComponentRelease();
  return <BookUnitExtraAudiosForPublication {...props} publication={publication} />;
}
