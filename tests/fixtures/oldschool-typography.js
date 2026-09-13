import { createNativeOpenResponseQuestion } from "../../src/data/native-activities/nativeOpenResponse.js";

export const typographyFont = { assetId: "10000000-0000-4000-8000-000000000073", checksumSha256: "b719ecb31c5b21fc573c03f6421c74ac63c271a5a3ff841e34f9705fb94b8448", role: "activity_font", slot: "font-10000000000040008000000000000073" };
export const typographyId = (prefix, n) => `${prefix}-${String(n).padStart(32, "0")}`;
export const typographyXml = `<params><exercises><exercise type="karaokeScroll"><texts>
<text id="1" name="text_1" x="40" y="440" width="900" height="24" fontName="Arial" fontSize="18" fontColor="0" fontBold="false" align="left" isHTML="true" times="1000-3000">Normal &lt;b&gt;bold&lt;/b&gt; &lt;i&gt;italic&lt;/i&gt; &lt;u&gt;underlined&lt;/u&gt;.</text>
<text id="2" name="text_2" x="40" y="480" width="900" height="36" fontName="Georgia" fontSize="24" fontColor="3368601" fontBold="true" align="left" isHTML="true" times="3000-5000">Two lines&lt;br/&gt;Unicode: Ω &amp;amp; café.</text>
<text id="3" name="text_3" x="40" y="580" width="900" height="24" fontName="Arial" fontSize="18" fontColor="0" fontBold="false" align="left" isHTML="false" times="5000-7000">Literal &lt;i&gt;text&lt;/i&gt;.</text>
</texts></exercise></exercises></params>`;

export function createOldschoolTypographyPair() {
  const activityId = "ultimate-b2-sb-u1-p1-o973";
  const question = createNativeOpenResponseQuestion(typographyId("q", 1)); question.prompt = "Describe the scene.";
  const assets = [
    { assetId: "10000000-0000-4000-8000-000000000071", checksumSha256: "7".repeat(64), role: "activity_artwork", slot: "transcript-audio" },
    { assetId: "10000000-0000-4000-8000-000000000072", checksumSha256: "8".repeat(64), role: "activity_artwork", slot: "transcript-page" },
  ];
  const publicDocument = { schemaVersion: "1.0", activityId, kind: "oldschool-listening", metadata: { title: "Synthetic transcript typography", visibleInstructionText: "" }, placement: { pageId: "ub2-sb-unit-1-part-1" }, assets, parts: [{ id: "part-1", interaction: {
    kind: "oldschool-listening", questionMode: "open-response", audioAssetSlot: assets[0].slot, audioDurationMs: 8000,
    panels: [{ id: "panel-1", kind: "questions", sourceWidth: 1024, sourceHeight: 582 }, { id: "panel-2", kind: "synchronized-page", pageAssetSlot: assets[1].slot, sourceWidth: 1018, sourceHeight: 1509, altText: "Synthetic blank transcript sheet" }],
    artwork: [], questions: [question],
    cues: ["Normal bold italic underlined.", "Two lines\nUnicode: Ω & café.", "Literal <i>text</i>."].map((text, i) => ({ id: typographyId("cue", i + 1), startMs: i * 2000 + 1000, endMs: i * 2000 + 3000, text, highlightRegions: [{ id: typographyId("region", i + 1), x: 40, y: [40, 80, 180][i], width: 900, height: [24, 64, 24][i], text }], scrollY: null })),
    snippetHotspots: [{ id: typographyId("aud", 1), area: { x: 10, y: 10, width: 30, height: 30 }, cueIds: [typographyId("cue", 1)], label: "Opening", audioAssetSlot: "" }],
  } }] };
  const teacherDocument = { schemaVersion: "1.0", activityId, kind: "oldschool-listening", parts: [{ id: "part-1", solution: { kind: "oldschool-listening", questionMode: "open-response", modelAnswers: [{ questionId: question.id, text: "SYNTHETIC_PRIVATE_TRANSCRIPT_ANSWER" }] } }] };
  return { publicDocument, teacherDocument };
}
