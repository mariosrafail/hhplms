import { markWordsMarkerArea, markWordsTargetMarker } from "../../data/native-activities/nativeMarkWordsMarkers.js";
import { logicalAreaStyle } from "../builder-studio/stageGeometry.js";

export function NativeMarkWordsMarker({ hotspot, stage, marker = null, graphicUrl }) {
  const style = marker || markWordsTargetMarker(hotspot);
  const area = style.alignment === "manual" && style.kind !== "outline" ? hotspot.markArea : markWordsMarkerArea(hotspot.area, style);
  if (style.kind === "graphic") return <img className="native-mark-words-graphic" src={graphicUrl(style.graphicAssetSlot)} alt="" aria-hidden="true" style={logicalAreaStyle(area, stage)} />;
  const stroke = Math.min(style.thickness, area.width, area.height);
  return <svg className="native-mark-words-marker" data-marker-kind={style.kind} style={logicalAreaStyle(area, stage)} viewBox={`0 0 ${area.width} ${area.height}`} preserveAspectRatio="none" aria-hidden="true">{style.kind === "outline" ? <rect x={stroke / 2} y={stroke / 2} width={area.width - stroke} height={area.height - stroke} fill="none" stroke={style.color} strokeWidth={stroke} /> : <line x1="0" x2={area.width} y1={area.height - stroke / 2} y2={area.height - stroke / 2} stroke={style.color} strokeWidth={stroke} />}</svg>;
}
