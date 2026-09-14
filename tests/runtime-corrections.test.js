import "../src/data/native-activities/nativeOpenResponse.js";
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { multiPartReadablePair, adaptiveBankPair } from "./fixtures/native-runtime-regressions/runtime-corrections-data.js";
import { nativeAudioTextHotspotTargets, nativeMultiPartAudioTextPresentation, removeNativeMultiPartOwnedHotspots } from "../src/data/native-activities/nativeAudioTextHotspots.js";
import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from "../src/data/native-activities/nativeActivityRuntimeValidation.js";
import { duplicateNativeMultiPartSection } from "../src/data/native-activities/nativeMultiPart.js";
import { pruneMultiPartAssetRoots, updateMultiPartSharedBackground } from "../src/apps/book-builder/hosted/nativeMultiPartAuthoring.js";
import { ultimateB2TeacherAppDefaultAssets } from "../src/data/ultimate-b2/teacherAppAuthoring.js";
const normalize = (doc) => normalizeNativeRuntimePublicDocument(doc, { activityId: doc.activityId, kind: "multi-part" });

for (const audio of [false, true]) test(`Multi-Part readable ownership and persistence, audio=${audio}`, () => {
  const pair = multiPartReadablePair(audio); const pub = normalize(pair.publicDocument);
  normalizeNativeRuntimeTeacherDocument(pair.teacherDocument, { activityId: pub.activityId, kind: pub.kind, publicDocument: pub });
  const targets = nativeAudioTextHotspotTargets(pub); const flow = targets.filter((target) => target.sectionId);
  assert.equal(targets.length, 6); assert.equal(new Set(targets.map((target) => target.panelId)).size, 6);
  assert.equal(targets[0].panelId, pub.parts[0].interaction.panels[0].id);
  assert.equal(flow.at(-1).childPanelId, flow.at(-2).childPanelId);
  assert.notEqual(flow.at(-1).panelId, flow.at(-2).panelId);
  const presentation = { hotspots: pub.audioTextHotspots.hotspots, onToggle() {}, onPanelChange() {} };
  for (const target of flow) {
    const child = nativeMultiPartAudioTextPresentation(pub, presentation, target.sectionId);
    assert.equal(child.hotspots.length, 1); assert.equal(child.hotspots[0].panelId, target.childPanelId);
  }
  assert.equal(nativeMultiPartAudioTextPresentation(pub, presentation, pub.parts[0].interaction.sections[0].id).hotspots.length, 0);
  const before = structuredClone(pub.audioTextHotspots);
  pub.parts[0].interaction.panels.reverse(); pub.parts[0].interaction.sections.reverse();
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(pub))).audioTextHotspots, before);
  const section = pub.parts[0].interaction.sections.find((section) => section.id === flow.at(-1).sectionId);
  const copied = duplicateNativeMultiPartSection(section, pair.teacherDocument.parts[0].solution.sections.find((entry) => entry.id === section.id));
  pub.parts[0].interaction.sections.push(copied.section);
  assert.deepEqual(normalize(pub).audioTextHotspots, before, "duplication cannot rebind existing hotspots");
  removeNativeMultiPartOwnedHotspots(pub, { sectionIds: [section.id] });
  pub.parts[0].interaction.sections = pub.parts[0].interaction.sections.filter((entry) => entry.id !== section.id);
  pruneMultiPartAssetRoots(pub); assert.equal(normalize(pub).audioTextHotspots.hotspots.length, 5);
  assert.doesNotMatch(JSON.stringify(pub), /correctAnswers|modelAnswers|mappings|native_teacher_answer/);
});

test("Multi-Part rejects forged owners, source geometry and assets; replacement retains coordinates", () => {
  for (const mutate of [
    (pub) => { pub.audioTextHotspots.hotspots[1].panelId = pub.parts[0].interaction.panels[1].id; },
    (pub) => { pub.audioTextHotspots.hotspots[1].panelId += "/forged"; },
    (pub) => { pub.audioTextHotspots.hotspots[0].activityArea.x = 1024; },
    (pub) => { pub.audioTextHotspots.hotspots[0].audioAssetSlot = "foreign-audio"; },
  ]) { const pub = multiPartReadablePair().publicDocument; mutate(pub); assert.throws(() => normalize(pub)); }
  const pub = multiPartReadablePair().publicDocument; const panel = pub.parts[0].interaction.panels[0];
  const before = structuredClone(pub.audioTextHotspots);
  updateMultiPartSharedBackground(pub, panel.id, pub.assets[0], { width: 1024, height: 582 });
  assert.deepEqual(normalize(pub).audioTextHotspots, before);
  pub.audioTextHotspots.hotspots[0].activityArea.y = 560;
  assert.throws(() => normalize(pub), /source image/);
});

test("Video Worksheet uses distinct tracked document artwork under the independent binding", async () => {
  const video = ultimateB2TeacherAppDefaultAssets["navigation.video"];
  const worksheet = ultimateB2TeacherAppDefaultAssets["navigation.videoWorksheet"];
  assert.notEqual(video.repositoryPath, worksheet.repositoryPath);
  assert.notDeepEqual(await readFile(video.repositoryPath), await readFile(worksheet.repositoryPath));
  assert.equal(worksheet.mediaType, "image/png");
  await promisify(execFile)(process.execPath, ["scripts/book-builder/generate-video-worksheet-artwork.mjs", "--check"]);
});

for (const layout of ["standard", "text"]) for (const images of [false, true]) test(`Adaptive bank fixture uses the canonical contract: ${layout}, images=${images}`, () => {
  const pair = adaptiveBankPair(layout, images);
  const options = { activityId: pair.publicDocument.activityId, kind: "drag-drop" };
  const publicDocument = normalizeNativeRuntimePublicDocument(pair.publicDocument, options);
  normalizeNativeRuntimeTeacherDocument(pair.teacherDocument, { ...options, publicDocument });
  assert.equal(publicDocument.parts[0].interaction.panels[0].surface.height, 1100);
  assert.equal(publicDocument.parts[0].interaction.panels[0].dropTargets[0].capacity, 12);
});
