import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "./_vite-test-server.mjs";

import { completeSentencesPublisherImportEndpoint, debateClubPublisherImportEndpoint, ultimateB2ReadingExerciseBuilderPlugin } from "../scripts/ultimate-b2/reading-exercise-builder-vite-plugin.mjs";
import completeSentences from "../src/data/ultimate-b2/authoring/unit-01-reading-exercise-4.complete-sentences.json" with { type: "json" };
import debateClub from "../src/data/ultimate-b2/authoring/unit-01-reading-debate-club.open-answer.json" with { type: "json" };
import completeSentencesRuntime from "../src/data/ultimate-b2/runtime/unit-01-reading-exercise-4.complete-sentences.json" with { type: "json" };
import debateClubRuntime from "../src/data/ultimate-b2/runtime/unit-01-reading-debate-club.open-answer.json" with { type: "json" };
import completeSentencesTeacherSolution from "../netlify/functions/_ultimate-b2-reading-exercise-4-solution.json" with { type: "json" };
import debateClubTeacherSolution from "../netlify/functions/_ultimate-b2-reading-debate-club-solution.json" with { type: "json" };
import { normalizeUltimateB2ExerciseVisualCapabilities, ultimateB2ExercisePresentationFeatures } from "../src/data/ultimate-b2/exerciseVisualCapabilities.js";
import {
  normalizeUltimateB2CompleteSentencesAuthoring,
  normalizeUltimateB2DebateClubAuthoring,
  ULTIMATE_B2_COMPLETE_SENTENCES_ID,
  ULTIMATE_B2_DEBATE_CLUB_ID,
} from "../src/data/ultimate-b2/readingExerciseAuthoringSchema.js";
import { projectStudentReadingActivity, projectTeacherReadingSolution } from "../src/data/ultimate-b2/readingExerciseProjections.js";
import { assertStudentSafe } from "../scripts/ultimate-b2/content-workspace.mjs";
import { publisherSourceEvidenceOptions } from "./_publisher-source-test-helper.js";

const completeSentencesPublisherSourceFile = path.resolve("tmp/complete-sentences/obj_params.xml");
const debateClubPublisherSourceDirectory = path.resolve("tmp/debateclub");
const completeSentencesPublisherEvidence = publisherSourceEvidenceOptions(completeSentencesPublisherSourceFile);
const debateClubPublisherEvidence = publisherSourceEvidenceOptions(debateClubPublisherSourceDirectory);

async function fixtureServer() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hhplms-reading-authoring-"));
  const completePath = path.join(directory, "complete.json");
  const debatePath = path.join(directory, "debate.json");
  await Promise.all([
    writeFile(completePath, `${JSON.stringify(completeSentences, null, 2)}\n`),
    writeFile(debatePath, `${JSON.stringify(debateClub, null, 2)}\n`),
  ]);
  const server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    plugins: [ultimateB2ReadingExerciseBuilderPlugin({ authoringPaths: { [ULTIMATE_B2_COMPLETE_SENTENCES_ID]: completePath, [ULTIMATE_B2_DEBATE_CLUB_ID]: debatePath } })],
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  return {
    directory,
    server,
    base: `http://127.0.0.1:${server.httpServer.address().port}`,
    completePath,
    debatePath,
    completeStudentPath: `${completePath}.student-runtime.json`,
    completeTeacherPath: `${completePath}.teacher-private.json`,
    debateStudentPath: `${debatePath}.student-runtime.json`,
    debateTeacherPath: `${debatePath}.teacher-private.json`,
  };
}

test("reusable exercise visual capabilities support optional instruction and optional Show Text images", () => {
  const allowlist = { instructionImages: ["instruction"], showTextImages: ["show-text"] };
  assert.deepEqual(normalizeUltimateB2ExerciseVisualCapabilities({ instructionImage: null, showText: { enabled: false, showTextImage: null } }, allowlist), { instructionImage: null, showText: { enabled: false, showTextImage: null } });
  assert.deepEqual(normalizeUltimateB2ExerciseVisualCapabilities({ instructionImage: "instruction", showText: { enabled: true, showTextImage: "show-text" } }, allowlist), { instructionImage: "instruction", showText: { enabled: true, showTextImage: "show-text" } });
  assert.throws(() => normalizeUltimateB2ExerciseVisualCapabilities({ instructionImage: "../../escape", showText: { enabled: false, showTextImage: null } }, allowlist), /unknown image binding/);
  assert.throws(() => normalizeUltimateB2ExerciseVisualCapabilities({ instructionImage: null, showText: { enabled: true, showTextImage: null } }, allowlist), /requires/);
  assert.throws(() => normalizeUltimateB2ExerciseVisualCapabilities({ instructionImage: null, showText: { enabled: false, showTextImage: "show-text" } }, allowlist), /must be null/);
  assert.equal(ultimateB2ExercisePresentationFeatures({ visualCapabilities: { showText: { enabled: true } } }).showTextEnabled, true);
  assert.equal(ultimateB2ExercisePresentationFeatures({ visualCapabilities: { showText: { enabled: false } } }).showTextEnabled, false);
});

test("optional exercise images and Show Text controls render only from enabled capabilities", async () => {
  const [visuals, pages] = await Promise.all([
    readFile("src/components/lms/activities/ultimate-b2/UltimateB2ExerciseVisuals.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflinePages.jsx", "utf8"),
  ]);
  assert.match(visuals, /return source \? <img/);
  assert.match(visuals, /showText\?\.enabled/);
  assert.match(visuals, /overflow: auto|ultimate-b2-show-text-viewport/);
  assert.match(pages, /multipleChoiceAvailable \|\| showTextAvailable/);
});

test("Complete the Sentences matches the Object 4 source contract and exact eight click-reveal blanks", () => {
  assert.deepEqual(normalizeUltimateB2CompleteSentencesAuthoring(completeSentences), completeSentences);
  assert.equal(completeSentences.source.objectNumber, 4);
  assert.equal(completeSentences.schemaVersion, 2);
  assert.equal(completeSentences.source.files[0].name, "obj_params.xml");
  assert.deepEqual(completeSentences.surface, { width: 1024, height: 582 });
  assert.equal(completeSentences.example.exampleText, "On-demand");
  assert.deepEqual(completeSentences.blanks.map((blank) => blank.revealedWord), ["binge-watching", "season", "franchise", "episodes", "genre", "sub-plots", "Tuning in", "Media streaming"]);
  assert.equal(completeSentences.visualCapabilities.showText.enabled, true);
  assert.deepEqual(completeSentences.instruction.area, { x: 93, y: 18, width: 873, height: 34 });
  assert.ok(completeSentences.blanks.every((blank) => blank.style.color === "#e40083"));
  assert.ok(completeSentences.blanks.every((blank) => blank.area.height === 27), "publisher-authored blank visuals remain exactly 27px high");
  assert.throws(() => normalizeUltimateB2CompleteSentencesAuthoring({ ...completeSentences, blanks: completeSentences.blanks.slice(1) }), /exactly eight blanks/);
  assert.throws(() => normalizeUltimateB2CompleteSentencesAuthoring({ ...completeSentences, arbitraryPath: "C:/escape" }), /unknown fields/);
});

test("Complete the Sentences projections separate eight interactive blanks from the exact Teacher mapping", () => {
  const student = projectStudentReadingActivity(completeSentences);
  const teacher = projectTeacherReadingSolution(completeSentences);
  assert.deepEqual(student, completeSentencesRuntime);
  assert.deepEqual(teacher, completeSentencesTeacherSolution);
  assert.equal(student.blanks.length, 8);
  assert.equal(student.sentences.length, 8);
  assert.equal(student.wordBank.length, 8);
  assert.deepEqual(student.surface, completeSentences.surface);
  assertStudentSafe(student);
  assert.doesNotMatch(JSON.stringify(student), /revealedWord|iwbSha256|decoded-publisher-iwb|source/i);
  assert.deepEqual(teacher.blanks, Object.fromEntries(completeSentences.blanks.map((blank) => [blank.id, blank.revealedWord])));
  assert.notStrictEqual(student, teacher);
});

test("Complete the Sentences publisher import endpoint is fixed-scope and persists the verified reconstruction", completeSentencesPublisherEvidence, async () => {
  const fixture = await fixtureServer();
  try {
    const url = `${fixture.base}${completeSentencesPublisherImportEndpoint}?activityId=${ULTIMATE_B2_COMPLETE_SENTENCES_ID}`;
    const response = await fetch(url, { method: "POST" });
    assert.equal(response.status, 200);
    const imported = await response.json();
    assert.deepEqual(imported.report.canvas, { width: 1024, height: 582 });
    assert.deepEqual({ example: imported.report.exampleDetected, sentences: imported.report.interactiveSentenceCount, answers: imported.report.revealAnswerCount }, { example: true, sentences: 8, answers: 8 });
    assert.deepEqual(JSON.parse(await readFile(fixture.completePath, "utf8")), imported.authoring);
    assert.deepEqual(JSON.parse(await readFile(fixture.completeStudentPath, "utf8")), projectStudentReadingActivity(imported.authoring));
    assert.deepEqual(JSON.parse(await readFile(fixture.completeTeacherPath, "utf8")), projectTeacherReadingSolution(imported.authoring));
  } finally { await fixture.server.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("Debate Club is an Open Response variant with exactly two internal parts and one response region each", () => {
  assert.deepEqual(normalizeUltimateB2DebateClubAuthoring(debateClub), debateClub);
  assert.equal(debateClub.source.objectNumber, 5);
  assert.equal(debateClub.schemaVersion, 2);
  assert.deepEqual(debateClub.source.partMapping.map((part) => part.pagesIndex), [1, 2]);
  assert.equal(debateClub.parts.length, 2);
  assert.ok(debateClub.parts.every((part) => part.responseRegion && !Array.isArray(part.responseRegion)));
  assert.ok(debateClub.parts.every((part) => part.responseRegion.revealText.length > 300));
  assert.throws(() => normalizeUltimateB2DebateClubAuthoring({ ...debateClub, parts: debateClub.parts.slice(0, 1) }), /exactly two/);
  const outside = structuredClone(debateClub);
  outside.parts[0].responseRegion.area.x = 1000;
  assert.throws(() => normalizeUltimateB2DebateClubAuthoring(outside), /inside the activity surface/);
});

test("Debate Club projections preserve both response layouts but isolate both publisher model responses", () => {
  const student = projectStudentReadingActivity(debateClub);
  const teacher = projectTeacherReadingSolution(debateClub);
  assert.deepEqual(student, debateClubRuntime);
  assert.deepEqual(teacher, debateClubTeacherSolution);
  assert.equal(student.parts.length, 2);
  assert.ok(student.parts.every((part) => part.responseRegion.area && part.responseRegion.presentation));
  assert.ok(student.parts.every((part) => part.visualObjects.photo && part.visualObjects.argument));
  assertStudentSafe(student);
  assert.doesNotMatch(JSON.stringify(student), /revealText|iwbSha256|decoded-publisher-iwb|source/i);
  assert.deepEqual(teacher.parts, Object.fromEntries(debateClub.parts.map((part) => [part.id, part.responseRegion.revealText])));
  assert.notStrictEqual(student, teacher);
});

test("Debate Club publisher import endpoint is fixed-scope and persists private Teacher presentation content", debateClubPublisherEvidence, async () => {
  const fixture = await fixtureServer();
  try {
    const url = `${fixture.base}${debateClubPublisherImportEndpoint}?activityId=${ULTIMATE_B2_DEBATE_CLUB_ID}`;
    const response = await fetch(url, { method: "POST" });
    assert.equal(response.status, 200);
    const imported = await response.json();
    assert.deepEqual(imported.report.canvas, { width: 1024, height: 582 });
    assert.deepEqual({ parts: imported.report.partCount, images: imported.report.imageCount, regions: imported.report.responseRegionCount, lines: imported.report.lineCounts }, { parts: 2, images: 6, regions: 2, lines: [10, 8] });
    assert.deepEqual(JSON.parse(await readFile(fixture.debatePath, "utf8")), imported.authoring);
    assert.ok(imported.authoring.parts.every((part) => part.responseRegion.revealText.length > 300), "reveal content remains canonical private authoring");
    assert.deepEqual(JSON.parse(await readFile(fixture.debateStudentPath, "utf8")), projectStudentReadingActivity(imported.authoring));
    assert.deepEqual(JSON.parse(await readFile(fixture.debateTeacherPath, "utf8")), projectTeacherReadingSolution(imported.authoring));
  } finally { await fixture.server.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("publisher import endpoints always reject noncanonical scope and methods", async () => {
  const fixture = await fixtureServer();
  try {
    for (const [endpoint, activityId] of [
      [completeSentencesPublisherImportEndpoint, ULTIMATE_B2_COMPLETE_SENTENCES_ID],
      [debateClubPublisherImportEndpoint, ULTIMATE_B2_DEBATE_CLUB_ID],
    ]) {
      const url = `${fixture.base}${endpoint}?activityId=${activityId}`;
      assert.equal((await fetch(`${url}&path=C:/escape`, { method: "POST" })).status, 404);
      assert.equal((await fetch(url)).status, 405);
    }
  } finally { await fixture.server.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("Reading authoring endpoint round-trips editable content and geometry while preserving source evidence", async () => {
  const fixture = await fixtureServer();
  try {
    const completeUrl = `${fixture.base}/__hhplms/ultimate-b2-reading-exercise-authoring?activityId=${ULTIMATE_B2_COMPLETE_SENTENCES_ID}`;
    const complete = await fetch(completeUrl).then((response) => response.json());
    const source = structuredClone(complete.source);
    complete.blanks[0].revealedWord = "binge-viewing";
    complete.blanks[0].area.x = 490;
    const response = await fetch(completeUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityId: ULTIMATE_B2_COMPLETE_SENTENCES_ID, authoring: complete }) });
    assert.equal(response.status, 200);
    const savedComplete = await response.json();
    assert.equal(savedComplete.blanks[0].revealedWord, "binge-viewing");
    assert.equal(savedComplete.blanks[0].area.x, 490);
    assert.deepEqual(savedComplete.source, source);
    assert.equal(JSON.stringify(JSON.parse(await readFile(fixture.completeStudentPath, "utf8"))).includes("binge-viewing"), true, "the visible word bank updates without adding a blank mapping");
    assert.equal(JSON.parse(await readFile(fixture.completeTeacherPath, "utf8")).blanks["blank-2"], "binge-viewing");

    const debateUrl = `${fixture.base}/__hhplms/ultimate-b2-reading-exercise-authoring?activityId=${ULTIMATE_B2_DEBATE_CLUB_ID}`;
    const debate = await fetch(debateUrl).then((result) => result.json());
    debate.parts[1].responseRegion.revealText += " Edited.";
    debate.parts[1].responseRegion.area.y = 225;
    assert.equal((await fetch(debateUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityId: ULTIMATE_B2_DEBATE_CLUB_ID, authoring: debate }) })).status, 200);
    const savedDebate = JSON.parse(await readFile(fixture.debatePath, "utf8"));
    assert.match(savedDebate.parts[1].responseRegion.revealText, /Edited\.$/);
    assert.equal(savedDebate.parts[1].responseRegion.area.y, 225);
    assert.doesNotMatch(JSON.stringify(JSON.parse(await readFile(fixture.debateStudentPath, "utf8"))), /Edited\.|revealText/);
    assert.match(JSON.parse(await readFile(fixture.debateTeacherPath, "utf8")).parts["part-2"], /Edited\.$/);

    assert.equal((await fetch(completeUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityId: ULTIMATE_B2_COMPLETE_SENTENCES_ID, authoring: complete, path: "C:/escape" }) })).status, 400);
    assert.equal((await fetch(completeUrl, { method: "POST", body: "{}" })).status, 415);
  } finally { await fixture.server.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("Teacher runtime exposes Show Text for Object 4 and two-part navigation for Object 5", async () => {
  const [pages, embedded, pilot, completeRuntime, debateRuntime] = await Promise.all([
    readFile("src/apps/android-teacher-offline/TeacherOfflinePages.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineEmbeddedActivity.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/UltimateB2LegacyPilotActivity.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/UltimateB2CompleteSentencesActivity.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/UltimateB2DebateClubActivity.jsx", "utf8"),
  ]);
  assert.match(pages, /showTextAvailable/);
  assert.match(pages, /panelCount: embeddedActivityId === "ultimate-b2-sb-u1-p2-o3" \? 2 : readingPresentationFeatures\.internalPartCount/);
  assert.match(pages, /activityPresentationState\.panelCount > 1/);
  assert.match(embedded, /ultimate-b2-sb-u1-p2-o4[\s\S]*1024[\s\S]*582/);
  assert.match(pilot, /UltimateB2CompleteSentencesActivity/);
  assert.match(pilot, /UltimateB2DebateClubActivity/);
  assert.match(completeRuntime, /revealedBlankIds/);
  assert.match(completeRuntime, /toggle-text/);
  assert.doesNotMatch(completeRuntime, /<textarea|updateAnswer|feedback/i);
  assert.match(debateRuntime, /previous-panel[\s\S]*next-panel/);
  assert.match(debateRuntime, /revealedPartIds/);
  assert.match(debateRuntime, /sourceAreaStyle/);
  assert.match(debateRuntime, /<textarea/);
  assert.match(debateRuntime, /studentSubmission\?\.replaceAnswers/);
  assert.doesNotMatch(debateRuntime, /readingExerciseAuthoringData|readingExerciseAuthoringSchema/);
});

test("Student runtime imports cannot reach full Reading authoring or Teacher-private projections", async () => {
  const [runtimeData, completeComponent, debateComponent, pilot] = await Promise.all([
    readFile("src/data/ultimate-b2/readingExerciseRuntimeData.js", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/UltimateB2CompleteSentencesActivity.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/UltimateB2DebateClubActivity.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/UltimateB2LegacyPilotActivity.jsx", "utf8"),
  ]);
  const studentGraph = [runtimeData, completeComponent, debateComponent, pilot].join("\n");
  assert.match(runtimeData, /\.\/runtime\/unit-01-reading-exercise-4/);
  assert.match(runtimeData, /\.\/runtime\/unit-01-reading-debate-club/);
  assert.doesNotMatch(studentGraph, /data\/ultimate-b2\/authoring\/unit-01-reading|_ultimate-b2-reading-.*-solution\.json|readingExerciseProjections/);
});
