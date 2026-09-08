import { useEffect, useMemo, useRef, useState } from "react";
import { Video, X } from "lucide-react";
import { publishedUnitExtraVideoUrl, usePublishedComponentRelease } from "virtual:component-publication";
import { unitExtrasForPage } from "../../../data/ultimate-b2/unitExtras.js";
import { NativeVideoPlayer } from "../../native-video/NativeVideoPlayer.jsx";
import "./BookUnitExtraVideos.css";

export function BookUnitExtraVideos({ unitNumber, pageId, hidden = false }) {
  const publication = usePublishedComponentRelease();
  const videos = useMemo(
    () => unitExtrasForPage(publication, { unitNumber, pageId }),
    [pageId, publication, unitNumber],
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeVideo, setActiveVideo] = useState(null);
  const rootRef = useRef(null);
  const launcherRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    setMenuOpen(false);
    setActiveVideo(null);
  }, [hidden, pageId, unitNumber]);

  useEffect(() => {
    if (!menuOpen && !activeVideo) return undefined;

    const closeMenu = (event) => {
      if (menuOpen && !rootRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMenuOpen(false);
      setActiveVideo(null);
      launcherRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeVideo, menuOpen]);

  useEffect(() => {
    if (activeVideo) closeRef.current?.focus();
  }, [activeVideo]);

  if (hidden || !videos.length) return null;

  const closePlayer = () => {
    setActiveVideo(null);
    launcherRef.current?.focus();
  };
  const selectVideo = (entry) => {
    if (entry.readiness === "missing-media") return;
    document.querySelectorAll("audio,video").forEach((media) => media.pause());
    setMenuOpen(false);
    setActiveVideo(entry);
  };

  return (
    <>
      <div ref={rootRef} className="book-page-extra-videos">
        {menuOpen ? (
          <div className="book-page-extra-video-menu" role="menu" aria-label="Extra Videos">
            <strong>Extra Videos</strong>
            {videos.map((entry) => (
              <button key={entry.id} type="button" role="menuitem" disabled={entry.readiness === "missing-media"} onClick={() => selectVideo(entry)}>{entry.title}{entry.readiness === "missing-media" ? " - Not ready: MP4 required" : ""}</button>
            ))}
          </div>
        ) : null}
        <button ref={launcherRef} className="book-page-extra-video-launcher" type="button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)}>
          <Video aria-hidden="true" /> Extra Videos
        </button>
      </div>
      {activeVideo ? (
        <div className="book-page-extra-video-overlay" role="dialog" aria-modal="true" aria-labelledby="book-page-extra-video-title" onPointerDown={(event) => { if (event.target === event.currentTarget) closePlayer(); }}>
          <section>
            <header>
              <div><span>Extra Videos</span><h3 id="book-page-extra-video-title">{activeVideo.title}</h3></div>
              <button ref={closeRef} type="button" aria-label="Close Extra Video" onClick={closePlayer}><X aria-hidden="true" /></button>
            </header>
            <div className="book-page-extra-video-player">
              <NativeVideoPlayer video={activeVideo.video} src={publishedUnitExtraVideoUrl(publication, activeVideo.video.asset)} autoPlayAttemptKey={activeVideo.id} ariaLabel={`${activeVideo.title} Extra Video player`} />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
