import { nativeActivityFontFamily } from "../../data/native-activities/nativeActivityFont.js";
import { oldschoolTranscriptFontSlots } from "../../data/native-activities/nativeOldschoolListeningTypography.js";
import { nativeActivitySelectedFontState, useNativeActivityFonts } from "../native-activity-assets/useNativeActivityFonts.js";
import { nativeOldschoolListeningFragmentFontSize, nativeOldschoolListeningRegionStyle, nativeOldschoolListeningTranscriptFragments } from "./nativeOldschoolListeningRuntime.js";

export function oldschoolTranscriptTextStyle(typography, document, sourceWidth) {
  const style = {};
  if (typography.fontFamily || typography.fontAssetSlot) style.fontFamily = nativeActivityFontFamily(document, typography.fontAssetSlot, typography.fontFamily || "Arial");
  if (typography.fontSize !== undefined) style.fontSize = `${typography.fontSize / sourceWidth * 100}cqw`;
  if (typography.fontWeight !== undefined) style.fontWeight = typography.fontWeight;
  if (typography.italic !== undefined) style.fontStyle = typography.italic ? "italic" : "normal";
  if (typography.underline !== undefined) style.textDecoration = typography.underline ? "underline" : "none";
  if (typography.color !== undefined) style.color = typography.color;
  return style;
}

function runTypography(base, override = {}) {
  const inherited = { ...base };
  if (override.fontFamily && !override.fontAssetSlot) delete inherited.fontAssetSlot;
  return { ...inherited, ...override };
}

export function NativeOldschoolTranscriptFontStatus({ document, assetUrl }) {
  const fonts = useNativeActivityFonts(document, assetUrl);
  const slots = [...oldschoolTranscriptFontSlots(document?.parts?.[0]?.interaction)];
  const states = slots.map((slot) => nativeActivitySelectedFontState(fonts, document, slot));
  const failed = states.some((font) => ["error", "unsupported"].includes(font.status));
  const loading = states.some((font) => ["idle", "loading"].includes(font.status));
  return failed ? <p className="native-oldschool-font-status" role="alert">Transcript font unavailable. A fallback is shown; source typography is not exact.</p>
    : loading ? <p className="native-oldschool-font-status" role="status">Loading transcript fonts… Layout may change when the fonts are ready.</p> : null;
}

export function NativeOldschoolExactTranscript({ document, highlightedCueIds = [] }) {
  const interaction = document.parts[0].interaction; const panel = interaction.panels[1];
  const highlighted = new Set(highlightedCueIds);
  const hasAuthoredTypography = interaction.cues.some((cue) => cue.highlightRegions.some((region) => region.typography || region.runs));
  return <div className="native-oldschool-listening-transcript native-oldschool-listening-exact-transcript" data-authored-typography={hasAuthoredTypography ? "true" : undefined} aria-hidden="true">
    {nativeOldschoolListeningTranscriptFragments(interaction.cues).filter((fragment) => fragment.text && fragment.exact).map((fragment) => {
      const active = highlighted.has(fragment.cueId); const typography = fragment.typography || {};
      const authored = Boolean(fragment.typography || fragment.runs);
      const fontSize = nativeOldschoolListeningFragmentFontSize(fragment);
      // The XML box height is geometry, never an inferred line-height field.
      // Authored text without explicit lineHeight uses 4/3 of its largest font.
      const largestFont = Math.max(fontSize, ...(fragment.runs || []).map((run) => run.typography?.fontSize || fontSize));
      const lineHeight = typography.lineHeight ?? (authored ? largestFont * 4 / 3 : 31);
      const style = { fontSize: `${fontSize / panel.sourceWidth * 100}cqw`, lineHeight: `${lineHeight / panel.sourceWidth * 100}cqw`, ...(authored ? { height: "auto", textAlign: typography.align || "left", whiteSpace: "pre" } : { height: `${31 / panel.sourceWidth * 100}cqw` }), ...oldschoolTranscriptTextStyle({ ...typography, underline: undefined }, document, panel.sourceWidth) };
      return <div key={fragment.regionId} className="native-oldschool-listening-transcript-fragment" style={nativeOldschoolListeningRegionStyle(fragment, { width: panel.sourceWidth, height: panel.sourceHeight })} data-cue-id={fragment.cueId} data-region-id={fragment.regionId} data-exact="true" data-authored={authored ? "true" : undefined} data-highlighted={active ? "true" : "false"}>
        <div style={style}><span className={`native-oldschool-listening-exact-text${active ? " is-active" : ""}`}>
          {fragment.runs ? fragment.runs.map((run, index) => <span key={index} data-transcript-run={index} style={oldschoolTranscriptTextStyle(runTypography(typography, run.typography), document, panel.sourceWidth)}>{run.text}</span>) : <span style={{ textDecoration: typography.underline ? "underline" : "none" }}>{fragment.text}</span>}
        </span></div>
      </div>;
    })}
  </div>;
}
