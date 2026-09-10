import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { createServer } from "./_vite-test-server.mjs";

import { buildUltimateB2TeacherSolutionPayload } from "../netlify/functions/_ultimate-b2-teacher-solutions.js";
import { ultimateB2Page5BuilderPlugin } from "../scripts/ultimate-b2/page5-builder-vite-plugin.mjs";
import { buildUltimateB2ActivityNavigation } from "../src/apps/ultimate-b2-builder/activityBuilderNavigation.js";
import { ultimateB2ActivityEditorMetadata } from "../src/apps/ultimate-b2-builder/activityEditorMetadata.js";
import imageActivity from "../src/data/ultimate-b2/authoring/unit-01-page-5-exercise-2.image.json" with { type: "json" };
import openResponse from "../src/data/ultimate-b2/authoring/unit-01-page-5-exercise-1.open-response.json" with { type: "json" };
import { ultimateB2StudentsBookAuthoringActivities } from "../src/data/ultimate-b2/studentsBookAuthoringCatalog.js";
import {
  normalizeUltimateB2Page5ImageAuthoring,
  normalizeUltimateB2Page5OpenResponseAuthoring,
  normalizeUltimateB2Page5TeacherAnswers,
} from "../src/data/ultimate-b2/page5AuthoringSchema.js";
import { projectUltimateB2Page5OpenResponseRuntime } from "../src/data/ultimate-b2/page5RuntimeProjection.js";
import teacherAnswers from "../netlify/functions/_ultimate-b2-unit1-opener-model-answers.json" with { type: "json" };
import { publisherSourceEvidenceOptions } from "./_publisher-source-test-helper.js";

const openResponseId = "ultimate-b2-sb-u1-p1-o1";
const imageActivityId = "ultimate-b2-sb-u1-p1-o2";
const page5PublisherSourceDirectory = path.resolve("tmp/page5-open-response-source");
const page5PublisherEvidence = publisherSourceEvidenceOptions(page5PublisherSourceDirectory);

async function fixtureServer() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hhplms-page5-authoring-"));
  const openResponsePath = path.join(directory, "open-response.json");
  const imagePath = path.join(directory, "image.json");
  const teacherAnswersPath = path.join(directory, "teacher-answers.json");
  const imageAssetPath = path.join(directory, "custom-image.svg");
  await Promise.all([
    writeFile(openResponsePath, `${JSON.stringify(openResponse, null, 2)}\n`),
    writeFile(imagePath, `${JSON.stringify(imageActivity, null, 2)}\n`),
    writeFile(teacherAnswersPath, `${JSON.stringify(teacherAnswers, null, 2)}\n`),
    writeFile(imageAssetPath, "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"/>\n"),
  ]);
  // These HTTP persistence tests read files explicitly; HMR is not under test.
  // Avoid a repository-wide watcher scan racing fixture teardown under load.
  const server = await createServer({ configFile: false, appType: "custom", logLevel: "silent", plugins: [ultimateB2Page5BuilderPlugin({ openResponsePath, imagePath, teacherAnswersPath, imageAssetPath, publisherSourceDirectory: page5PublisherSourceDirectory })], server: { watch: null, host: "127.0.0.1", port: 0 } });
  await server.listen();
  return { directory, server, base: `http://127.0.0.1:${server.httpServer.address().port}`, openResponsePath, imagePath, imageAssetPath, teacherAnswersPath };
}

test("Activity Builder navigation follows authoritative Unit to Page to Exercise order", () => {
  const groups = buildUltimateB2ActivityNavigation(ultimateB2StudentsBookAuthoringActivities, ultimateB2ActivityEditorMetadata);
  assert.deepEqual(groups.map((unit) => unit.label), ["Unit 1", "Unit 2"]);
  const unit1 = groups[0];
  assert.equal(unit1.pages[0].pageLabel, "Page 5");
  assert.deepEqual(unit1.pages[0].activities.map((activity) => activity.activityKey), [openResponseId, imageActivityId]);
  const reading = unit1.pages.find((page) => page.pageSpread === "6-7" && page.sectionTitle === "Reading");
  assert.deepEqual(reading.activities.slice(0, 5).map((activity) => activity.editorLabel), ["Video", "Listening", "Multiple Choice", "Complete the Sentences", "Open Response"]);
  assert.ok(reading.activities.slice(0, 5).every((activity) => activity.configurable));
});

test("Page 5 schemas keep stable identities, allowlisted bindings, and exact fields", () => {
  assert.deepEqual(normalizeUltimateB2Page5OpenResponseAuthoring(openResponse), openResponse);
  assert.deepEqual(normalizeUltimateB2Page5ImageAuthoring(imageActivity), imageActivity);
  assert.deepEqual(normalizeUltimateB2Page5TeacherAnswers(teacherAnswers), teacherAnswers);
  assert.throws(() => normalizeUltimateB2Page5OpenResponseAuthoring({ ...openResponse, arbitraryPath: "C:/escape" }), /unknown fields/);
  assert.throws(() => normalizeUltimateB2Page5ImageAuthoring({ ...imageActivity, mainImage: "../../escape.png" }), /Unknown/);
  assert.throws(() => normalizeUltimateB2Page5ImageAuthoring({ ...imageActivity, bullets: [] }), /unknown fields/);
  assert.throws(() => normalizeUltimateB2Page5TeacherAnswers({ ...teacherAnswers, modelAnswers: [] }), /three model answers/);
  const outside = structuredClone(openResponse);
  outside.questions[0].responseRegion.area.x = 1000;
  outside.questions[0].responseRegion.area.width = 100;
  assert.throws(() => normalizeUltimateB2Page5OpenResponseAuthoring(outside), /inside the authored canvas/);
});

test("Page 5 public runtime keeps learner response labels", () => {
  const runtime = projectUltimateB2Page5OpenResponseRuntime(openResponse);
  assert.deepEqual(runtime.questions.map((question) => question.responseRegion.ariaLabel), [
    "Write a response for question 1",
    "Write a response for question 2",
    "Write a response for question 3",
  ]);
});

test("Page 5 endpoint saves and reloads open-response public prompts and Teacher-private answers", async () => {
  const fixture = await fixtureServer();
  try {
    const url = `${fixture.base}/__hhplms/ultimate-b2-page-5-authoring?activityId=${openResponseId}`;
    const loaded = await fetch(url).then((response) => response.json());
    const ids = loaded.publicAuthoring.questions.map((question) => question.id);
    loaded.publicAuthoring.questions[0].prompt = "Edited isolated question?";
    loaded.publicAuthoring.questions[0].responseRegion.area.x = 75;
    loaded.teacherAuthoring.modelAnswers[0].text = "Edited isolated Teacher model answer.";
    assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(loaded) })).status, 200);
    const reloaded = await fetch(url).then((response) => response.json());
    assert.equal(reloaded.publicAuthoring.questions[0].prompt, "Edited isolated question?");
    assert.equal(reloaded.publicAuthoring.questions[0].responseRegion.area.x, 75);
    assert.equal(reloaded.teacherAuthoring.modelAnswers[0].text, "Edited isolated Teacher model answer.");
    assert.deepEqual(reloaded.publicAuthoring.questions.map((question) => question.id), ids);
    assert.equal(JSON.parse(await readFile(fixture.teacherAnswersPath, "utf8")).modelAnswers[0].text, "Edited isolated Teacher model answer.");
    assert.equal((await fetch(url, { method: "PUT" })).status, 405);
    assert.equal((await fetch(url, { method: "POST", body: JSON.stringify(loaded) })).status, 415);
    assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...loaded, path: "C:/escape" }) })).status, 400);
  } finally { await fixture.server.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("Page 5 Exercise 2 is a generic image activity with no bullet authoring", async () => {
  const fixture = await fixtureServer();
  try {
    const url = `${fixture.base}/__hhplms/ultimate-b2-page-5-authoring?activityId=${imageActivityId}`;
    const loaded = await fetch(url).then((response) => response.json());
    loaded.publicAuthoring.mainImageAlt = "Edited discussion prompt image description.";
    assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(loaded) })).status, 200);
    const reloaded = await fetch(url).then((response) => response.json());
    assert.equal(reloaded.publicAuthoring.mainImageAlt, "Edited discussion prompt image description.");
    assert.equal(reloaded.publicAuthoring.mainImage, "unit1.page5.exercise2.main-content");
    assert.equal("bullets" in reloaded.publicAuthoring, false);
    assert.deepEqual(JSON.parse(await readFile(fixture.imagePath, "utf8")), reloaded.publicAuthoring);
  } finally { await fixture.server.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("Page 5 publisher import endpoint is fixed-scope and persists the public/private split", page5PublisherEvidence, async () => {
  const fixture = await fixtureServer();
  try {
    const url = `${fixture.base}/__hhplms/ultimate-b2-page-5-publisher-import?activityId=${openResponseId}`;
    const response = await fetch(url, { method: "POST" });
    assert.equal(response.status, 200);
    const imported = await response.json();
    assert.deepEqual(imported.report, {
      sourceFilesFound: ["obj_params.xml", "ebook_obj_params.xml", "image_1.png", "image_2.png"],
      canvas: { width: 1024, height: 582 },
      questionCount: 3,
      responseRegionCount: 3,
      imageCount: 2,
      lineCounts: [3, 4, 4],
      validation: "valid",
    });
    assert.deepEqual(JSON.parse(await readFile(fixture.openResponsePath, "utf8")), imported.publicAuthoring);
    assert.deepEqual(JSON.parse(await readFile(fixture.teacherAnswersPath, "utf8")), imported.teacherAuthoring);
  } finally { await fixture.server.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("Page 5 publisher import endpoint always rejects noncanonical scope and methods", async () => {
  const fixture = await fixtureServer();
  try {
    const url = `${fixture.base}/__hhplms/ultimate-b2-page-5-publisher-import?activityId=${openResponseId}`;
    assert.equal((await fetch(`${url}&path=C:/escape`, { method: "POST" })).status, 404);
    assert.equal((await fetch(url)).status, 405);
  } finally { await fixture.server.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("Image activity accepts a local raster upload, normalizes it to the managed asset, and rejects unsafe formats", async () => {
  const fixture = await fixtureServer();
  try {
    const imageBytes = await sharp({ create: { width: 640, height: 360, channels: 4, background: "#3467a3" } }).jpeg().toBuffer();
    const assetUrl = `${fixture.base}/__hhplms/ultimate-b2-page-5-image-asset?activityId=${imageActivityId}`;
    const upload = await fetch(assetUrl, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: imageBytes });
    assert.equal(upload.status, 200);
    const result = await upload.json();
    assert.equal(result.binding, "unit1.page5.exercise2.main-content");
    assert.deepEqual([result.width, result.height, result.mimeType], [640, 360, "image/webp"]);
    const stored = await readFile(fixture.imageAssetPath, "utf8");
    assert.match(stored, /^<svg[^>]+width="640"[^>]+height="360"/);
    assert.match(stored, /data:image\/webp;base64,/);
    assert.equal((await fetch(`${assetUrl}&path=C:/escape`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: imageBytes })).status, 404);
    assert.equal((await fetch(assetUrl, { method: "POST", headers: { "Content-Type": "image/svg+xml" }, body: "<svg/>" })).status, 415);
    assert.equal((await fetch(assetUrl, { method: "POST", headers: { "Content-Type": "image/png" }, body: imageBytes })).status, 400);
    assert.equal((await fetch(assetUrl, { method: "POST", headers: { "Content-Type": "image/png" }, body: "not-an-image" })).status, 400);
  } finally { await fixture.server.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("Page 5 model answers stay in Teacher payload and out of public authoring", async () => {
  const distinctive = "Films are an art form which involve many artistic processes";
  const sources = await Promise.all([
    readFile("src/data/ultimate-b2/authoring/unit-01-page-5-exercise-1.open-response.json", "utf8"),
    readFile("src/data/ultimate-b2/authoring/unit-01-page-5-exercise-2.image.json", "utf8"),
    readFile("src/data/ultimate-b2/generated/students-book.runtime.json", "utf8"),
    readFile("src/data/ultimate-b2/page5AuthoringData.js", "utf8"),
  ]);
  assert.match(JSON.stringify(buildUltimateB2TeacherSolutionPayload(openResponseId)), new RegExp(distinctive));
  for (const source of sources) assert.doesNotMatch(source, new RegExp(distinctive));
});

test("Builder registry exposes focused Page 5 and Reading editors", async () => {
  const [registry, metadata, openBuilder, imageBuilder, completeBuilder, debateBuilder] = await Promise.all([
    readFile("src/apps/ultimate-b2-builder/activityEditorRegistry.js", "utf8"),
    readFile("src/apps/ultimate-b2-builder/activityEditorMetadata.js", "utf8"),
    readFile("src/apps/ultimate-b2-builder/UltimateB2OpenResponseBuilder.jsx", "utf8"),
    readFile("src/apps/ultimate-b2-builder/UltimateB2ImageBuilder.jsx", "utf8"),
    readFile("src/apps/ultimate-b2-builder/UltimateB2CompleteSentencesBuilder.jsx", "utf8"),
    readFile("src/apps/ultimate-b2-builder/UltimateB2DebateClubBuilder.jsx", "utf8"),
  ]);
  for (const label of ["Open Response", "Image", "Video", "Listening", "Multiple Choice", "Complete the Sentences"]) assert.match(metadata, new RegExp(label));
  assert.doesNotMatch(metadata, /Open Answer|kind: "open-answer"/);
  assert.match(openBuilder, /Content[\s\S]*Response Regions[\s\S]*Preview/);
  assert.match(openBuilder, /Import Publisher Source/);
  assert.match(openBuilder, /EditableResponseRegionLayer[\s\S]*Text shown after click/);
  assert.match(imageBuilder, /type="file"[\s\S]*image\/png,image\/jpeg,image\/webp/);
  assert.match(imageBuilder, /ultimate-b2-page-5-image-asset/);
  assert.match(imageBuilder, /Recommended main image: 16:9 landscape/);
  assert.match(imageBuilder, /createImageBitmap/);
  assert.match(imageBuilder, /This image is not 16:9[\s\S]*contain/);
  assert.doesNotMatch(imageBuilder, /bullet/i);
  assert.match(completeBuilder, /Content[\s\S]*Blanks[\s\S]*Preview/);
  assert.match(debateBuilder, /Response Regions[\s\S]*Preview/);
  assert.match(registry, /UltimateB2CompleteSentencesBuilder[\s\S]*UltimateB2DebateClubBuilder/);
});

test("shared Response Regions keep visible writing lines before and after reveal", async () => {
  const [component, styles] = await Promise.all([
    readFile("src/components/lms/activities/ultimate-b2/ResponseRegion.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/responseRegion.css", "utf8"),
  ]);
  assert.match(component, /data-response-region-id/);
  assert.match(component, /aria-pressed/);
  assert.match(component, /revealed \? revealText : ""/);
  assert.match(styles, /repeating-linear-gradient/);
  assert.match(styles, /border: 2px solid rgb\(100 116 139 \/ 42%\)/);
  assert.match(styles, /overflow: auto/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.doesNotMatch(styles, /\.response-region\.is-revealed[^}]*background-image:\s*none/s);
});
