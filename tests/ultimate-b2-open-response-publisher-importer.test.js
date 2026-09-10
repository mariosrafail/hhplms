import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";
import { createServer } from "./_vite-test-server.mjs";

import {
  OPEN_RESPONSE_IMPORT_LIMITS,
  importUltimateB2OpenResponsePublisherBundle,
} from "../scripts/ultimate-b2/open-response-publisher-importer.js";
import { ultimateB2OpenResponseBuilderPlugin } from "../scripts/ultimate-b2/open-response-builder-vite-plugin.mjs";
import { buildUltimateB2ActivityNavigation } from "../src/apps/ultimate-b2-builder/activityBuilderNavigation.js";
import { ultimateB2ActivityEditorMetadata } from "../src/apps/ultimate-b2-builder/activityEditorMetadata.js";
import { ultimateB2StudentsBookAuthoringActivities } from "../src/data/ultimate-b2/studentsBookAuthoringCatalog.js";
import { publisherSourceEvidenceOptions } from "./_publisher-source-test-helper.js";

const unit1Id = "ultimate-b2-sb-u1-p1-o1";
const unit2Id = "ultimate-b2-sb-u2-p1-o1";
const page5SourceRoot = path.resolve("tmp/page5-open-response-source");
const page5PublisherEvidence = publisherSourceEvidenceOptions(page5SourceRoot);

test("Unit 2 opener is explicitly registered for the reusable Open Response editor", async () => {
  assert.deepEqual(ultimateB2ActivityEditorMetadata[unit2Id], { kind: "open-response", label: "Open Response", variant: "publisher-source-question-list", status: "Configurable" });
  const groups = buildUltimateB2ActivityNavigation(ultimateB2StudentsBookAuthoringActivities, ultimateB2ActivityEditorMetadata);
  const unit2Activity = groups.find((unit) => unit.unitNumber === 2).pages.flatMap((page) => page.activities).find((activity) => activity.activityKey === unit2Id);
  assert.equal(unit2Activity.configurable, true);
  assert.equal(unit2Activity.editorLabel, "Open Response");
  const [registry, builder, runtime] = await Promise.all([
    readFile("src/apps/ultimate-b2-builder/activityEditorRegistry.js", "utf8"),
    readFile("src/apps/ultimate-b2-builder/UltimateB2OpenResponseBuilder.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/NormalizedStudentsBookActivity.jsx", "utf8"),
  ]);
  assert.match(registry, new RegExp(`${unit2Id.replaceAll("-", "\\-")}.*UltimateB2OpenResponseBuilder`));
  assert.match(builder, /activityId = defaultActivityId/);
  assert.match(builder, /type="file" multiple/);
  assert.match(builder, /Validate and Import Publisher Source/);
  assert.match(runtime, /hasUltimateB2OpenResponseAuthoring/);
});

function publisherXml({ canvas = [640, 420], images = 3, questions = 2, ebook = false, promptSuffix = "", forbidden = "" } = {}) {
  const imageElements = Array.from({ length: images }, (_, index) => `<image x="${20 + index * 70}" y="20" name="image_${index + 1}" scale="1" textureName="image_${index + 1}"/>`).join("");
  const promptElements = Array.from({ length: questions }, (_, index) => {
    const y = 100 + index * 130;
    return `<text x="30" y="${y}" width="500" height="28" name="prompt_${index + 1}" fontName="Fira Sans" fontSize="21" fontColor="0" align="left"><![CDATA[<b>${index + 1}</b> Question ${index + 1}${promptSuffix}?]]></text>`;
  }).join("");
  const lineElements = Array.from({ length: questions }, (_, questionIndex) => Array.from({ length: questionIndex + 2 }, (_, lineIndex) => {
    const y = 130 + questionIndex * 130 + lineIndex * 24;
    return `<text x="50" y="${y}" width="500" height="24" name="line_${questionIndex + 1}_${lineIndex + 1}" fontName="Myriad Pro" fontSize="21" fontColor="0" align="left"><![CDATA[________________________________________]]></text>`;
  }).join("")).join("");
  const sentences = Array.from({ length: questions }, (_, index) => {
    const lineCount = index + 2;
    const lines = Array.from({ length: lineCount }, (_, lineIndex) => `Model response ${index + 1}.${lineIndex + 1}`);
    const answer = ebook ? lines.join(" ") : lines.join("<br>");
    const y = 130 + index * 130;
    const height = lineCount * 24;
    const ebookMetadata = ebook ? ` maxLines="${lineCount}" multiline="true"` : "";
    return `<sentence id="${index + 1}"><text x="50" y="${y}" width="500" height="${height}" name="answer_${index + 1}" fontName="ITC Flora Std Medium" fontSize="21" fontColor="14942339" align="left" wordWrap="true" vAlign="top"${ebookMetadata}><![CDATA[${answer}]]></text></sentence>`;
  }).join("");
  return `${forbidden}<params><navigator viewport="0,0,${canvas[0]},${canvas[1]}"/><images>${imageElements}</images><texts>${promptElements}${lineElements}</texts><exercises><exercise type="write"><sentences>${sentences}</sentences></exercise></exercises></params>`;
}

async function raster(name, format = "png") {
  const pipeline = sharp({ create: { width: 30, height: 20, channels: 4, background: "#2f6db2" } });
  const bytes = format === "jpeg" ? await pipeline.jpeg().toBuffer() : await pipeline.png().toBuffer();
  return { name, bytes };
}

async function bundle({ images = 3, questions = 2, primary = {}, ebook = {}, extra = [] } = {}) {
  const files = [
    { name: "obj_params.xml", bytes: Buffer.from(publisherXml({ images, questions, ...primary })) },
    { name: "ebook_obj_params.xml", bytes: Buffer.from(publisherXml({ images, questions, ebook: true, ...ebook })) },
  ];
  for (let index = 0; index < images; index += 1) files.push(await raster(`image_${index + 1}.png`));
  return [...files, ...extra];
}

test("generic importer preserves the proven Page 5 semantic and geometry contract", page5PublisherEvidence, async () => {
  const names = ["obj_params.xml", "ebook_obj_params.xml", "image_1.png", "image_2.png"];
  const files = await Promise.all(names.map(async (name) => ({ name, bytes: await readFile(path.join(page5SourceRoot, name)) })));
  const first = await importUltimateB2OpenResponsePublisherBundle({ activityId: unit1Id, files });
  const second = await importUltimateB2OpenResponsePublisherBundle({ activityId: unit1Id, files });
  assert.deepEqual(second, first);
  assert.deepEqual(first.publicAuthoring.questions.map((question) => question.responseRegion.area), [
    { x: 73, y: 117, width: 605, height: 73 },
    { x: 73, y: 253, width: 605, height: 96 },
    { x: 73, y: 410, width: 601, height: 96 },
  ]);
  assert.deepEqual(first.publicAuthoring.questions.map((question) => question.responseRegion.presentation.linePositions), [[23, 47, 69], [21, 46, 69, 91], [23, 46, 69, 92]]);
  assert.equal(first.publicAuthoring.artworkLayers.length, 2);
  assert.doesNotMatch(JSON.stringify(first.publicAuthoring), /Films are an art form which involve many artistic processes/);
  assert.doesNotMatch(JSON.stringify(first.report), /Films are an art form which involve many artistic processes/);
});

test("generic importer derives variable image and question counts from source declarations", async () => {
  const files = await bundle({ images: 3, questions: 2, extra: [await raster("unused.png")] });
  const imported = await importUltimateB2OpenResponsePublisherBundle({ activityId: unit2Id, files });
  assert.equal(imported.publicAuthoring.artworkLayers.length, 3);
  assert.equal(imported.publicAuthoring.questions.length, 2);
  assert.deepEqual(imported.report.imagesReferenced, ["image_1", "image_2", "image_3"]);
  assert.deepEqual(imported.report.unreferencedImages, ["unused.png"]);
  assert.equal(imported.report.warnings.length, 1);
  assert.equal(imported.teacherAuthoring.modelAnswers.length, 2);
  assert.doesNotMatch(JSON.stringify(imported.publicAuthoring), /Model response/);
  assert.doesNotMatch(JSON.stringify(imported.report), /Model response/);
});

test("generic importer fails closed for missing, duplicate, ambiguous, or invalid raster input", async () => {
  const missing = await bundle({ images: 3 });
  missing.splice(missing.findIndex((file) => file.name === "image_2.png"), 1);
  await assert.rejects(importUltimateB2OpenResponsePublisherBundle({ activityId: unit2Id, files: missing }), /image_2 is missing/);

  const duplicate = await bundle();
  duplicate.push({ ...duplicate.find((file) => file.name === "image_1.png"), name: "IMAGE_1.PNG" });
  await assert.rejects(importUltimateB2OpenResponsePublisherBundle({ activityId: unit2Id, files: duplicate }), /duplicate filenames/);

  const ambiguous = await bundle();
  ambiguous.push(await raster("image_1.jpg", "jpeg"));
  await assert.rejects(importUltimateB2OpenResponsePublisherBundle({ activityId: unit2Id, files: ambiguous }), /ambiguous raster names/);

  const invalid = await bundle();
  invalid.find((file) => file.name === "image_1.png").bytes = Buffer.from("not a png");
  await assert.rejects(importUltimateB2OpenResponsePublisherBundle({ activityId: unit2Id, files: invalid }));
});

test("generic importer rejects structural conflicts and unsafe XML", async () => {
  await assert.rejects(importUltimateB2OpenResponsePublisherBundle({ activityId: unit2Id, files: await bundle({ ebook: { canvas: [641, 420] } }) }), /conflict on viewport/);
  await assert.rejects(importUltimateB2OpenResponsePublisherBundle({ activityId: unit2Id, files: await bundle({ ebook: { promptSuffix: " changed" } }) }), /conflict on prompt/);

  const malformed = await bundle();
  malformed[1].bytes = Buffer.from("<params><broken></params>");
  await assert.rejects(importUltimateB2OpenResponsePublisherBundle({ activityId: unit2Id, files: malformed }), /malformed XML/);

  const dtd = await bundle({ primary: { forbidden: "<!DOCTYPE params [<!ENTITY x 'unsafe'>]>" } });
  await assert.rejects(importUltimateB2OpenResponsePublisherBundle({ activityId: unit2Id, files: dtd }), /forbidden XML declaration/);
});

test("generic importer rejects traversal, raw IWB without safe context, and oversized XML", async () => {
  const traversal = await bundle();
  traversal[2].name = "../image_1.png";
  await assert.rejects(importUltimateB2OpenResponsePublisherBundle({ activityId: unit2Id, files: traversal }), /safe basename/);

  const iwb = await bundle();
  iwb[0].name = "obj_params.iwb";
  await assert.rejects(importUltimateB2OpenResponsePublisherBundle({ activityId: unit2Id, files: iwb }), /provide decoded obj_params\.xml/);

  const oversized = await bundle();
  oversized[0].bytes = Buffer.alloc(OPEN_RESPONSE_IMPORT_LIMITS.xmlBytes + 1, 0x20);
  await assert.rejects(importUltimateB2OpenResponsePublisherBundle({ activityId: unit2Id, files: oversized }), /XML size limit/);
});

test("failed endpoint import leaves existing public and Teacher-private authoring untouched", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hhplms-open-response-transaction-test-"));
  const publicPath = path.join(directory, "public.json");
  const teacherRegistryPath = path.join(directory, "teacher-registry.json");
  const publicBefore = "{\"sentinel\":\"public\"}\n";
  const teacherBefore = "{\"sentinel\":\"private\"}\n";
  await Promise.all([writeFile(publicPath, publicBefore), writeFile(teacherRegistryPath, teacherBefore)]);
  const targets = {
    [unit2Id]: {
      publicPath,
      teacherRegistryPath,
      assetDirectory: path.resolve(`src/assets/books/ultimate-b2/authoring/open-response/${unit2Id}`),
    },
  };
  const server = await createServer({ configFile: false, appType: "custom", logLevel: "silent", plugins: [ultimateB2OpenResponseBuilderPlugin({ targets })], server: { host: "127.0.0.1", port: 0 } });
  try {
    await server.listen();
    const files = await bundle();
    files.splice(files.findIndex((file) => file.name === "image_2.png"), 1);
    const body = { activityId: unit2Id, files: files.map((file) => ({ name: file.name, type: "", base64: file.bytes.toString("base64") })) };
    const response = await fetch(`http://127.0.0.1:${server.httpServer.address().port}/__hhplms/ultimate-b2-open-response-publisher-import?activityId=${unit2Id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 400);
    assert.deepEqual(await Promise.all([readFile(publicPath, "utf8"), readFile(teacherRegistryPath, "utf8")]), [publicBefore, teacherBefore]);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
