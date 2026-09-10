import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";
import { createServer } from "./_vite-test-server.mjs";

import { buildUltimateB2TeacherSolutionPayload } from "../netlify/functions/_ultimate-b2-teacher-solutions.js";
import authoring from "../src/data/ultimate-b2/authoring/unit-01-reading-exercise-2.listening.json" with { type: "json" };
import { validateUltimateB2ListeningAuthoring } from "../src/data/ultimate-b2/listeningAuthoringSchema.js";
import { LISTENING_IWB_XOR_KEY, decodeListeningIwb, extractListeningAuthoring } from "../scripts/ultimate-b2/extract-listening-authoring.mjs";
import { ultimateB2ListeningBuilderPlugin } from "../scripts/ultimate-b2/listening-builder-vite-plugin.mjs";
import { findListeningCue, findListeningScrollEntry } from "../src/components/lms/activities/ultimate-b2/listeningRuntime.js";

const sectionNames = ["Overview", "Question Segments", "Karaoke Timeline", "Preview"];

function encodeIwb(xml) {
  const bytes = Buffer.from(xml, "utf8");
  const key = Buffer.from(LISTENING_IWB_XOR_KEY, "utf8");
  for (let index = 0; index < bytes.length; index += 1) bytes[index] ^= key[index % key.length];
  return bytes.toString("base64");
}

function fixtureDocuments() {
  const timings = Array.from({ length: 37 }, (_, index) => index === 0
    ? [26629, 30790]
    : index === 36
      ? [269339, 279001]
      : [32629 + (index - 1) * 6000, 37629 + (index - 1) * 6000]);
  const fragmentCounts = [...Array(36).fill(2), 26];
  let fragmentId = 0;
  const fragments = timings.flatMap(([start, end], cueIndex) => Array.from({ length: fragmentCounts[cueIndex] }, (_, withinCue) => {
    fragmentId += 1;
    const text = fragmentId === 3 ? "Safe <i>italic</i> title" : `Fragment ${fragmentId}`;
    return `<text id="${fragmentId}" x="${10 + withinCue}" y="${658 + cueIndex * 31}" width="200" height="31" times="${start}-${end}"><![CDATA[${text}]]></text>`;
  })).join("");
  const questions = ["What is one?", "What is two?", "What is three?"]
    .map((question, index) => `<text x="164"><![CDATA[<b>${index + 1}</b>  ${question}]]></text>`).join("");
  const answers = ["Model one", "Model two", "Model three"]
    .map((answer, index) => `<sentence id="${index + 1}"><text fontColor="14942339"><![CDATA[${answer}]]></text></sentence>`).join("");
  const scroll = [
    [0, "0-22930-300001"], [365, "22930-51547"], [876, "51547-82891"], [1127, "82891-148724"],
    [610, "148724-173318"], [881, "173318-214279"], [1334, "214279-237810"], [1427, "237810-279001"],
  ].map(([value, times]) => `<scrollValue value="${value}" times="${times}"/>`).join("");
  const body = (clickable, showText) => `<params>
    <notifications>${showText ? '<notification type="showText"/>' : ''}<notification type="audioPlayer"/></notifications>
    <images><image name="image_1" x="0" y="350"/></images><texts>${questions}</texts>
    <exercises><exercise type="write"><sentences>${answers}</sentences></exercise></exercises>
    <exercises><exercise type="karaokeScroll" clickableTexts="${clickable}"><texts>${fragments}</texts><scrollValues>${scroll}</scrollValues></exercise></exercises>
    <scroller x="7" y="7" width="1008" height="568" contentWidth="1010" contentHeight="2151"/>
  </params>`;
  const quad = (id, audioID, x, y) => `<quad id="${id}" audioID="${audioID}" x="${x}" y="${y}" width="100" height="19" color="16711935" alpha="0.3"/>`;
  const highlight = `<params><buttons><button id="1" url="10,11,12"/><button id="2" url="1,2,3,4,5,6,7"/><button id="3" url="8,9"/></buttons><highlights autoScroll="true">${[1,2,3,4,5,6,7].map((id) => quad(id,2,80,id*21)).join("")}${[8,9].map((id) => quad(id,3,516,id*21)).join("")}${[10,11,12].map((id) => quad(id,1,516,id*21)).join("")}</highlights></params>`;
  return { teacher: body("true", true), ebook: body("false", false), highlight };
}

test("tracked Listening authoring is strict, answer-free, and preserves recovered source facts", () => {
  assert.deepEqual(validateUltimateB2ListeningAuthoring(authoring), { ok: true, errors: [] });
  assert.deepEqual(authoring.questionSegments.map((segment) => segment.regions.length), [3, 7, 2]);
  assert.equal(authoring.staticText.highlightColor, "#FF00FF");
  assert.equal(authoring.staticText.highlightAlpha, 0.3);
  assert.equal(authoring.karaoke.fragments.length, 98);
  assert.equal(authoring.karaoke.cues.length, 37);
  assert.equal(authoring.karaoke.cues[0].startMs, 26629);
  assert.equal(authoring.karaoke.cues.at(-1).endMs, 279001);
  const serialized = JSON.stringify(authoring);
  assert.doesNotMatch(serialized, /acceptedAnswers|model answer|binge-watching many episodes|They both allow viewers to identify with characters and situations/i);
});

test("karaoke lookup recomputes cues and source scroll on forward/backward seeks", () => {
  assert.equal(findListeningCue(authoring.karaoke.cues, 26000), null);
  assert.equal(findListeningCue(authoring.karaoke.cues, 26629)?.id, "cue-1");
  assert.equal(findListeningCue(authoring.karaoke.cues, 279001), null);
  assert.equal(findListeningScrollEntry(authoring.karaoke.scrollTimeline, 23000)?.scrollY, 365);
  assert.equal(findListeningScrollEntry(authoring.karaoke.scrollTimeline, 150000)?.scrollY, 610);
  assert.equal(findListeningScrollEntry(authoring.karaoke.scrollTimeline, 60000)?.scrollY, 876);
});

test("Base64/XOR extraction validates a deterministic 98-fragment, 37-cue fixture", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hhplms-listening-extract-"));
  try {
    const fixture = fixtureDocuments();
    await Promise.all([
      writeFile(path.join(directory, "obj_params.iwb"), encodeIwb(fixture.teacher)),
      writeFile(path.join(directory, "ebook_obj_params.iwb"), encodeIwb(fixture.ebook)),
      writeFile(path.join(directory, "highlight_params.iwb"), encodeIwb(fixture.highlight)),
      sharp({ create: { width: 1020, height: 1801, channels: 4, background: "white" } }).png().toFile(path.join(directory, "image_1.png")),
      sharp({ create: { width: 1000, height: 1219, channels: 4, background: "white" } }).png().toFile(path.join(directory, "showText.png")),
    ]);
    assert.equal(decodeListeningIwb(encodeIwb("<params></params>")), "<params></params>");
    assert.throws(() => decodeListeningIwb(encodeIwb("<!DOCTYPE x><params></params>")), /forbidden DTD/);
    const extracted = await extractListeningAuthoring({ source: directory, enforceKnownHashes: false });
    assert.deepEqual(extracted.authoring.questionSegments.map((segment) => segment.regions.length), [3, 7, 2]);
    assert.equal(extracted.authoring.karaoke.fragments.length, 98);
    assert.equal(extracted.authoring.karaoke.cues.length, 37);
    assert.deepEqual(extracted.authoring.karaoke.fragments[2].runs, [{ text: "Safe " }, { text: "italic", style: "italic" }, { text: " title" }]);
    assert.deepEqual(extracted.authoring.karaoke.scrollTimeline[0].sourceTimingParts, [0, 22930, 300001]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local Listening endpoint validates, atomically saves, and reloads isolated timing and region edits", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hhplms-listening-endpoint-"));
  const listeningPath = path.join(directory, "listening.json");
  await writeFile(listeningPath, `${JSON.stringify(authoring, null, 2)}\n`);
  const server = await createServer({ configFile: false, appType: "custom", logLevel: "silent", plugins: [ultimateB2ListeningBuilderPlugin({ listeningPath })], server: { host: "127.0.0.1", port: 0 } });
  try {
    await server.listen();
    const address = server.httpServer.address();
    const base = `http://127.0.0.1:${address.port}`;
    const edited = structuredClone(authoring);
    edited.karaoke.cues[0].startMs += 1;
    edited.questionSegments[0].regions[0].x += 1;
    const save = await fetch(`${base}/__hhplms/ultimate-b2-listening-authoring`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edited) });
    assert.equal(save.status, 200);
    const reload = await fetch(`${base}/__hhplms/ultimate-b2-listening-authoring`).then((response) => response.json());
    assert.equal(reload.karaoke.cues[0].startMs, authoring.karaoke.cues[0].startMs + 1);
    assert.equal(reload.questionSegments[0].regions[0].x, authoring.questionSegments[0].regions[0].x + 1);
    assert.deepEqual(JSON.parse(await readFile(listeningPath, "utf8")), reload);
    const rejected = await fetch(`${base}/__hhplms/ultimate-b2-listening-authoring`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...edited, arbitraryPath: "C:/escape" }) });
    assert.equal(rejected.status, 400);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Builder shell keeps Hotspot authoring separate and exposes Listening editor sections", async () => {
  const [entry, shell, activityBuilder, registry, listeningBuilder] = await Promise.all([
    readFile("src/apps/ultimate-b2-builder/activityBuilderEntry.jsx", "utf8"),
    readFile("src/apps/ultimate-b2-builder/UltimateB2BuilderApp.jsx", "utf8"),
    readFile("src/apps/ultimate-b2-builder/UltimateB2ActivityBuilder.jsx", "utf8"),
    readFile("src/apps/ultimate-b2-builder/activityEditorRegistry.js", "utf8"),
    readFile("src/apps/ultimate-b2-builder/UltimateB2ListeningBuilder.jsx", "utf8"),
  ]);
  assert.match(entry, /virtual:book-builder-app/);
  assert.match(shell, /Hotspot Builder[\s\S]*Activity Builder/);
  assert.match(shell, /UltimateB2HotspotBuilder/);
  assert.match(activityBuilder, /ultimateB2ActivityEditorRegistry/);
  assert.match(registry, /Listening/);
  for (const section of sectionNames) assert.match(listeningBuilder, new RegExp(section));
  assert.match(listeningBuilder, /Unsaved changes/);
  assert.match(listeningBuilder, /beforeunload/);
  assert.match(listeningBuilder, /Set start to playhead/);
  assert.match(listeningBuilder, /EditableHotspotLayer/);
});

test("Teacher Listening runtime keeps static segments, karaoke, answers, and contextual navigation distinct", async () => {
  const [runtime, normalized, pages, navigation, css] = await Promise.all([
    readFile("src/components/lms/activities/ultimate-b2/TeacherLegacyListeningActivity.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/NormalizedStudentsBookActivity.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflinePages.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherBookNavigationCore.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/teacherLegacyListeningActivity.css", "utf8"),
  ]);
  const offlineSolutions = JSON.stringify(buildUltimateB2TeacherSolutionPayload("ultimate-b2-sb-u1-p2-o2"));
  assert.match(runtime, /VIEW_QUESTIONS[\s\S]*VIEW_STATIC[\s\S]*VIEW_KARAOKE/);
  assert.match(runtime, /segment\?\.regions\.map/);
  assert.match(runtime, /findListeningCue/);
  assert.match(runtime, /requestAnimationFrame/);
  assert.match(runtime, /onEnded=\{returnToQuestions\}/);
  assert.match(runtime, /stopSegment\(\)[\s\S]*setView\(VIEW_KARAOKE\)/);
  assert.match(runtime, /questionProps\.solutions\?\.questions/);
  assert.doesNotMatch(runtime, /on-demand series have become more popular|binge-watching many episodes/i);
  assert.match(normalized, /teacherOfflineListening[\s\S]*!teacherOfflineListening/);
  assert.match(pages, /listeningAvailable[\s\S]*id: "show-text"/);
  assert.match(navigation, /contextAction/);
  assert.match(css, /1024px[\s\S]*582px/);
  assert.match(css, /#e40083/i);
  assert.match(css, /rgb\(255 0 255 \/ 30%\)/);
  assert.match(offlineSolutions, /binge-watching many episodes at a time/);
});
