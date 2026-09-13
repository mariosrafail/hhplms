import assert from "node:assert/strict";
import test from "node:test";
import { createOldschoolTypographyPair, typographyFont, typographyId, typographyXml } from "./fixtures/oldschool-typography.js";
import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { previewOldschoolTranscriptTypographyXml, applyOldschoolTranscriptTypographyPreview } from "../src/data/native-activities/nativeOldschoolListeningXml.js";
import { nativeOldschoolListeningAssetRequirements, normalizeNativeOldschoolListeningInteraction } from "../src/data/native-activities/nativeOldschoolListening.js";
import { nativeActivityUsesManagedAssetSlot, removeNativeManagedAssetReferenceIfUnused } from "../src/data/native-activities/nativeActivityPublic.js";
import { switchNativeOldschoolListeningQuestionMode } from "../src/data/native-activities/nativeOldschoolListeningAuthoring.js";
import { parseNativeOldschoolListeningJson, serializeNativeOldschoolListeningJson } from "../src/data/native-activities/nativeOldschoolListeningJson.js";
import { nativeOldschoolListeningFragmentFontSize, nativeOldschoolListeningTranscriptFragments } from "../src/components/native-oldschool-listening/nativeOldschoolListeningRuntime.js";
import { projectNativeActivityPublicForAuthoring } from "../src/apps/book-builder/hosted/nativeActivityAuthoringProjection.js";

const definition = resolveNativeActivityKind("oldschool-listening");
function enriched() {
  const pair = createOldschoolTypographyPair(); const interaction = pair.publicDocument.parts[0].interaction;
  const preview = previewOldschoolTranscriptTypographyXml(typographyXml, interaction, { assets: pair.publicDocument.assets });
  applyOldschoolTranscriptTypographyPreview(interaction, preview);
  return pair;
}

test("typography-only XML import is atomic, uniquely matched and preserves every non-typography field", () => {
  const pair = createOldschoolTypographyPair(); const before = structuredClone(pair); const value = pair.publicDocument.parts[0].interaction;
  const result = previewOldschoolTranscriptTypographyXml(typographyXml, value, { assets: pair.publicDocument.assets });
  assert.deepEqual(pair, before, "preview never mutates the draft");
  assert.equal(result.changes.length, 3); applyOldschoolTranscriptTypographyPreview(value, result);
  const restored = structuredClone(pair); restored.publicDocument.parts[0].interaction.cues.forEach((cue) => cue.highlightRegions.forEach((r) => { delete r.typography; delete r.runs; }));
  assert.deepEqual(restored, before);
  const [first, second, literal] = value.cues.map((cue) => cue.highlightRegions[0]);
  assert.deepEqual(first.typography, { fontFamily: "Arial", fontSize: 18, fontWeight: 400, color: "#000000", align: "left" });
  assert.equal(second.typography.fontFamily, "Georgia"); assert.equal(second.typography.fontSize, 24);
  assert.equal(second.text, "Two lines\nUnicode: Ω & café.");
  assert.deepEqual(first.runs.map((r) => r.text), ["Normal ", "bold", " ", "italic", " ", "underlined", "."]);
  assert.equal(first.runs[1].typography.fontWeight, 700); assert.equal(first.runs[3].typography.italic, true); assert.equal(first.runs[5].typography.underline, true);
  assert.equal(literal.text, "Literal <i>text</i>."); assert.equal(literal.runs, undefined);
  assert.equal(first.typography.lineHeight, undefined, "source box height is not line-height");
  assert.equal(definition.validatePair(definition.normalizePublic(pair.publicDocument), pair.teacherDocument), true);
});

test("styles and runs survive canonical JSON, authoring projection and idempotent runtime normalization", () => {
  const { publicDocument, teacherDocument } = enriched(); const context = { assets: publicDocument.assets };
  const value = publicDocument.parts[0].interaction;
  const restored = parseNativeOldschoolListeningJson(serializeNativeOldschoolListeningJson(value, context), context);
  assert.deepEqual(restored, value);
  const normalized = definition.normalizePublic(publicDocument); assert.deepEqual(normalized, definition.normalizePublic(normalized));
  assert.deepEqual(projectNativeActivityPublicForAuthoring(normalized), normalized);
  const fragments = nativeOldschoolListeningTranscriptFragments(restored.cues);
  assert.deepEqual(fragments.map(nativeOldschoolListeningFragmentFontSize), [18, 24, 18]); assert.deepEqual(fragments[0].runs, value.cues[0].highlightRegions[0].runs);
  assert.equal(definition.validatePair(normalized, definition.normalizeTeacher(teacherDocument)), true);
});

test("matching uses timing/text and validated identities, not DOM or array order", () => {
  const { publicDocument } = createOldschoolTypographyPair(); const value = publicDocument.parts[0].interaction;
  const reversed = typographyXml.replace(/(<text\b[^]*?<\/text>)\s*(<text\b[^]*?<\/text>)\s*(<text\b[^]*?<\/text>)/, "$3$2$1");
  assert.deepEqual(previewOldschoolTranscriptTypographyXml(reversed, value, { assets: publicDocument.assets }).cues, previewOldschoolTranscriptTypographyXml(typographyXml, value, { assets: publicDocument.assets }).cues);
  value.cues.forEach((cue, i) => { cue.highlightRegions[0].id = typographyId("region", i + 100); });
  assert.equal(previewOldschoolTranscriptTypographyXml(typographyXml, value, { assets: publicDocument.assets }).changes.length, 3);
  const result = previewOldschoolTranscriptTypographyXml(typographyXml, value, { assets: publicDocument.assets }); value.cues[0].scrollY = 10;
  assert.throws(() => applyOldschoolTranscriptTypographyPreview(value, result), /changed after XML preview/);
});

test("XML mismatch, duplicate identities, unsupported styles and dangerous input fail without partial changes", () => {
  const { publicDocument } = createOldschoolTypographyPair(); const value = publicDocument.parts[0].interaction; const before = structuredClone(value);
  const inputs = [typographyXml.replace('id="2"', 'id="1"'), typographyXml.replace('name="text_2"', 'name="text_1"'), typographyXml.replace("1000-3000", "1001-3000"), typographyXml.replace("Normal ", "Other "), typographyXml.replace('fontSize="18"', 'fontSize="180"'), typographyXml.replace('fontColor="0"', 'fontColor="url(x)"'), typographyXml.replace('fontBold="false"', 'fontBold="no"'), typographyXml.replace("&lt;b&gt;", "&lt;script&gt;"), typographyXml.replace("&lt;b&gt;", '&lt;b onclick="bad()"&gt;'), typographyXml.replace("&lt;b&gt;", '&lt;span style="font-size:12px"&gt;'), '<!DOCTYPE params [<!ENTITY x SYSTEM "file:///private">]>'+typographyXml, '<?fetch href="https://example.invalid"?>'+typographyXml, "<a>".repeat(34)+"</a>".repeat(34), "x".repeat(1024*1024+1)];
  for (const xml of inputs) { assert.throws(() => previewOldschoolTranscriptTypographyXml(xml, value, { assets: publicDocument.assets })); assert.deepEqual(value, before); }
  for (const prefix of ['<params><x:script/>', '<params x:onload="bad()">', '<params href="&#x68;ttps://example.invalid">']) assert.throws(() => previewOldschoolTranscriptTypographyXml(typographyXml.replace('<params>', prefix), value, { assets: publicDocument.assets }), /forbids/);
  assert.throws(() => previewOldschoolTranscriptTypographyXml('<a label="/>">'.repeat(34) + '</a>'.repeat(34), value, { assets: publicDocument.assets }), /nesting limit/);
  const duplicate = typographyXml.replace('</texts>', typographyXml.match(/<text\b[^]*?<\/text>/)[0].replace('id="1"', 'id="4"').replace('name="text_1"', 'name="text_4"')+'</texts>');
  const anonymous = structuredClone(value); anonymous.cues[0].highlightRegions[0].id = typographyId("region", 100);
  assert.throws(() => previewOldschoolTranscriptTypographyXml(duplicate, anonymous, { assets: publicDocument.assets }), /ambiguous/);
  assert.throws(() => previewOldschoolTranscriptTypographyXml(typographyXml.replace('id="1"', 'id="4"').replace('id="2"', 'id="1"'), value, { assets: publicDocument.assets }), /identity mismatch/);
});

test("canonical contract rejects invalid styles, mismatched runs, partial enrichment and aggregate budgets", () => {
  const { publicDocument } = enriched();
  const invalid = [null, { fontSize: 0 }, { fontSize: 12.5 }, { fontSize: 97 }, { lineHeight: 193 }, { fontWeight: 650 }, { italic: "false" }, { underline: 1 }, { color: "red" }, { color: "#fff" }, { align: "justify" }, { css: "font-size:18px" }, { fontFamily: "url(x)" }, { fontAssetSlot: "absent" }];
  for (const typography of invalid) { const doc = structuredClone(publicDocument); doc.parts[0].interaction.cues[0].highlightRegions[0].typography = typography; assert.throws(() => definition.normalizePublic(doc)); }
  for (const runs of [[{ text: "different" }], [{ text: "Normal bold italic underlined.", html: true }], Array.from({length:129},()=>({text:"a"})), [{text:"Normal bold italic underlined.",typography:{align:"left"}}]]) { const doc=structuredClone(publicDocument); doc.parts[0].interaction.cues[0].highlightRegions[0].runs=runs; assert.throws(()=>definition.normalizePublic(doc)); }
  const partial = structuredClone(publicDocument); partial.parts[0].interaction.cues[0].highlightRegions.push({ id: typographyId("region", 9), x: 0, y: 300, width: 20, height: 20 }); assert.throws(()=>definition.normalizePublic(partial),/partial mappings/);
  const oversized = structuredClone(publicDocument.parts[0].interaction); oversized.cues = Array.from({length:100},(_,i)=>({ ...oversized.cues[0], id: typographyId("cue",i+1), startMs:i*1000,endMs:(i+1)*1000,text:"a".repeat(4000),highlightRegions:[] })); oversized.audioDurationMs=100000;
  assert.throws(()=>normalizeNativeOldschoolListeningInteraction(oversized,{assets:publicDocument.assets}),/aggregate/);
});

test("inline font overrides, CRLF, boundary spaces and significant breaks have explicit semantics", () => {
  const pair = createOldschoolTypographyPair(); const value = pair.publicDocument.parts[0].interaction;
  const source = typographyXml.replace("&lt;b&gt;bold&lt;/b&gt;", '&lt;font face="Verdana" size="20" color="#123ABC"&gt;&lt;b&gt;bold&lt;/b&gt;&lt;/font&gt;');
  const preview = previewOldschoolTranscriptTypographyXml(source, value, { assets: pair.publicDocument.assets });
  assert.deepEqual(preview.cues[0].highlightRegions[0].runs[1].typography, { fontFamily: "Verdana", fontSize: 20, fontWeight: 700, color: "#123abc" });
  assert.throws(() => previewOldschoolTranscriptTypographyXml(typographyXml.replace('>Normal ', '>&lt;br/&gt;Normal '), value, { assets: pair.publicDocument.assets }), /mismatch/);
  const outerSpaces = previewOldschoolTranscriptTypographyXml(typographyXml.replace('>Normal ', '>  Normal '), value, { assets: pair.publicDocument.assets });
  assert.equal(outerSpaces.cues[0].highlightRegions[0].runs.map((r) => r.text).join(""), value.cues[0].text);
  const region = preview.cues[1].highlightRegions[0]; region.runs = [{ text: "Two lines\r\n" }, { text: "Unicode: Ω & café.", typography: { italic: false, underline: false, fontWeight: 400 } }];
  const normalized = normalizeNativeOldschoolListeningInteraction({ ...value, cues: preview.cues }, { assets: pair.publicDocument.assets });
  assert.equal(normalized.cues[1].highlightRegions[0].runs[0].text, "Two lines\n");
});

test("transcript-only managed fonts survive Panel 1 switching and answer-font cleanup with strict roles", () => {
  const { publicDocument, teacherDocument } = enriched(); publicDocument.assets.push(typographyFont);
  const value = publicDocument.parts[0].interaction; value.cues[0].highlightRegions[0].runs[1].typography.fontAssetSlot = typographyFont.slot;
  assert.equal(nativeActivityUsesManagedAssetSlot(publicDocument, typographyFont.slot),true);
  assert.ok(nativeOldschoolListeningAssetRequirements(publicDocument).some(r=>r.slot===typographyFont.slot&&r.mediaType==='font/ttf'));
  assert.doesNotThrow(()=>definition.normalizePublic(publicDocument));
  value.questions[0].responseRegion.presentation.answerFontAssetSlot=typographyFont.slot;
  delete value.questions[0].responseRegion.presentation.answerFontAssetSlot; removeNativeManagedAssetReferenceIfUnused(publicDocument,typographyFont.slot); assert.equal(publicDocument.assets.length,3);
  for(const mode of ['single-choice','open-response']) { switchNativeOldschoolListeningQuestionMode(publicDocument,teacherDocument,mode); assert.doesNotThrow(()=>definition.normalizePublic(publicDocument)); assert.equal(publicDocument.assets.length,3); }
  const wrong=structuredClone(publicDocument);wrong.assets.at(-1).role='activity_artwork';assert.throws(()=>definition.normalizePublic(wrong),/managed component font/);
  const xml=typographyXml.replaceAll('fontName="Arial"','fontName="Source Custom"');
  const legacy=createOldschoolTypographyPair(); assert.throws(()=>previewOldschoolTranscriptTypographyXml(xml,legacy.publicDocument.parts[0].interaction,{assets:legacy.publicDocument.assets}),/explicit.*binding/);
  assert.equal(previewOldschoolTranscriptTypographyXml(xml,legacy.publicDocument.parts[0].interaction,{assets:[...legacy.publicDocument.assets,typographyFont],fontBindings:{'Source Custom':{fontAssetSlot:typographyFont.slot}}}).cues[0].highlightRegions[0].typography.fontAssetSlot,typographyFont.slot);
});
