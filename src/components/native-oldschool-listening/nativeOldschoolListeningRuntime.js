import { findTimedTextCue, parseTimedTextSrt } from "../../data/timed-media/timedText.js";

export function findNativeOldschoolListeningCue(cues, milliseconds) {
  return findTimedTextCue(cues, milliseconds);
}

export function parseNativeOldschoolListeningSrt(input, { createId } = {}) {
  return parseTimedTextSrt(input, { createId, label: "SRT" }).map((cue) => ({ ...cue, highlightRegions: [], scrollY: null }));
}

export function nativeOldschoolListeningRegionStyle(region, surface) {
  return {
    left: `${region.x / surface.width * 100}%`,
    top: `${region.y / surface.height * 100}%`,
    width: `${region.width / surface.width * 100}%`,
    height: `${region.height / surface.height * 100}%`,
  };
}

function splitCueTextAcrossRegions(text, regions) {
  const words = String(text || "").trim().match(/\S+/g) || [];
  if (!regions.length) return [];
  const weights = regions.map((region) => Math.max(1, region.width * region.height));
  let wordIndex = 0;
  let remainingWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return regions.map((region, index) => {
    const wordsLeft = words.length - wordIndex;
    const regionsLeft = regions.length - index;
    if (index === regions.length - 1) return words.slice(wordIndex).join(" ");
    const weighted = Math.round(wordsLeft * weights[index] / remainingWeight);
    const minimum = wordsLeft >= regionsLeft ? 1 : 0;
    const maximum = Math.max(0, wordsLeft - Math.max(0, regionsLeft - 1));
    const take = Math.max(minimum, Math.min(maximum, weighted));
    const fragment = words.slice(wordIndex, wordIndex + take).join(" ");
    wordIndex += take;
    remainingWeight -= weights[index];
    return fragment;
  });
}

export function nativeOldschoolListeningTranscriptFragments(cues) {
  return cues.flatMap((cue) => {
    const exact = cue.highlightRegions.length > 0 && cue.highlightRegions.every((region) => typeof region.text === "string");
    const fallback = exact ? [] : splitCueTextAcrossRegions(cue.text, cue.highlightRegions);
    return cue.highlightRegions.map((region, index) => ({
      cueId: cue.id,
      regionId: region.id,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      text: exact ? region.text : fallback[index],
      exact,
      ...(exact && region.typography ? { typography: region.typography } : {}),
      ...(exact && region.runs ? { runs: region.runs } : {}),
    }));
  });
}

export function nativeOldschoolListeningFragmentFontSize(fragment) {
  if (fragment.exact) return fragment.typography?.fontSize ?? 21;
  const contentLength = Math.max(1, fragment.text.length);
  let size = Math.max(6, Math.min(21, fragment.height * .68));
  while (size > 6) {
    const columns = Math.max(1, Math.floor(fragment.width / (size * .45)));
    const rows = Math.max(1, Math.floor(fragment.height / (size * 1.12)));
    if (columns * rows >= contentLength) break;
    size -= .5;
  }
  return Math.round(size * 100) / 100;
}

export function nativeOldschoolListeningCueScrollY(cue) {
  if (!cue) return null;
  if (Number.isSafeInteger(cue.scrollY)) return cue.scrollY;
  if (!cue.highlightRegions?.length) return null;
  const top = Math.min(...cue.highlightRegions.map((region) => region.y));
  const bottom = Math.max(...cue.highlightRegions.map((region) => region.y + region.height));
  return Math.round((top + bottom) / 2);
}

export function nativeOldschoolListeningScrollTarget({ targetY, sourceHeight, renderedHeight, scrollTop, viewportHeight }) {
  if (!Number.isFinite(targetY) || !(sourceHeight > 0) || !(renderedHeight > 0) || !(viewportHeight > 0)) return scrollTop;
  const renderedTarget = targetY * renderedHeight / sourceHeight;
  const comfortableTop = scrollTop + viewportHeight * .25;
  const comfortableBottom = scrollTop + viewportHeight * .7;
  if (renderedTarget >= comfortableTop && renderedTarget <= comfortableBottom) return scrollTop;
  return Math.max(0, Math.min(renderedHeight - viewportHeight, renderedTarget - viewportHeight * .35));
}

