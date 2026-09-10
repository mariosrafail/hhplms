import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";
import { createServer } from "./_vite-test-server.mjs";

import { validateAndNormalizeUltimateB2HotspotManifest } from "../scripts/ultimate-b2/hotspot-manifest.mjs";
import { ultimateB2ImageBuilderPlugin } from "../scripts/ultimate-b2/image-builder-vite-plugin.mjs";
import { ultimateB2PublisherActivityBuilderPlugin } from "../scripts/ultimate-b2/publisher-activity-builder-vite-plugin.mjs";
import { projectUltimateB2PublisherActivity } from "../scripts/ultimate-b2/publisher-activity-projection.mjs";
import { mergeUltimateB2StudentsBookAuthoringActivities, ultimateB2StudentsBookAuthoringActivities, ultimateB2StudentsBookAuthoringPages } from "../src/data/ultimate-b2/studentsBookAuthoringCatalog.js";
import {
  createUltimateB2PublisherActivityRecord,
  nextUltimateB2PublisherActivityId,
  normalizeUltimateB2PublisherActivityRegistry,
} from "../src/data/ultimate-b2/publisherCreatedActivities.js";
import { normalizeUltimateB2ImageAuthoring } from "../src/data/ultimate-b2/imageAuthoringSchema.js";

const page = ultimateB2StudentsBookAuthoringPages.find((candidate) => candidate.id === "ub2-sb-unit-1-part-1");

function fakeDatabase({ priorMutationSlug = null } = {}) {
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql: String(sql), parameters });
      const normalized = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
      if (normalized.includes("from lessons l")) return { rows: [{ id: "lesson-1" }] };
      if (normalized.startsWith("select slug from activities where lesson_id=$1 and content_json")) return { rows: priorMutationSlug ? [{ slug: priorMutationSlug }] : [] };
      if (normalized.startsWith("select slug from activities where lesson_id=$1 and slug like")) return { rows: [{ slug: "ultimate-b2-sb-u1-p1-o1" }, { slug: "ultimate-b2-sb-u1-p1-o2" }] };
      if (normalized.includes("insert into activities")) return { rows: [{ id: "activity-1", slug: parameters[1] }] };
      if (normalized.includes("insert into questions")) return { rows: [{ id: `00000000-0000-4000-8000-00000000000${parameters[1]}` }] };
      return { rows: [] };
    },
  };
  return { client, calls };
}

test("publisher activity IDs use the next canonical page ordinal and registry records are strict", () => {
  assert.equal(nextUltimateB2PublisherActivityId(page, ["ultimate-b2-sb-u1-p1-o1", "ultimate-b2-sb-u1-p1-o4", "ultimate-b2-sb-u2-p1-o99"]), "ultimate-b2-sb-u1-p1-o5");
  const record = createUltimateB2PublisherActivityRecord({ activityId: "ultimate-b2-sb-u1-p1-o5", page, authoringKind: "image", title: "Publisher diagram" });
  assert.deepEqual(record.runtime, { activityType: "image", implementationMode: "reading-content", scoringMode: "unscored" });
  assert.equal(record.ownership, "official-publisher");
  assert.deepEqual(normalizeUltimateB2PublisherActivityRegistry({ schemaVersion: 1, activities: [record] }).activities, [record]);
  assert.throws(() => normalizeUltimateB2PublisherActivityRegistry({ schemaVersion: 1, activities: [{ ...record, arbitrary: true }] }), /missing or unknown fields/);
});

test("generic Image authoring binds a digest-named WebP inside only its activity directory", () => {
  const activityId = "ultimate-b2-sb-u1-p1-o3";
  const sha256 = "a".repeat(64);
  const source = { schemaVersion: 2, activityId, visualCapabilities: { instructionImage: null, showText: { enabled: false, showTextImage: null } }, instructionImageAlt: "", mainImage: { binding: `image.${activityId}.main.${sha256.slice(0, 12)}`, repositoryPath: `src/assets/books/ultimate-b2/authoring/image/${activityId}/${sha256}.webp`, sha256, mimeType: "image/webp", naturalSize: { width: 640, height: 360 } }, mainImageAlt: "Accessible publisher image" };
  assert.deepEqual(normalizeUltimateB2ImageAuthoring(source, activityId), source);
  assert.throws(() => normalizeUltimateB2ImageAuthoring({ ...source, mainImage: { ...source.mainImage, repositoryPath: `src/assets/books/ultimate-b2/authoring/image/${activityId}/${"b".repeat(64)}.webp` } }, activityId), /does not match its digest/);
});

test("fresh trusted records are available to navigation and hotspot validation in the same session", () => {
  const record = createUltimateB2PublisherActivityRecord({ activityId: "ultimate-b2-sb-u1-p1-o3", page, authoringKind: "open-response", title: "Publisher reflection" });
  const activities = mergeUltimateB2StudentsBookAuthoringActivities([record]);
  const projected = activities.find((activity) => activity.activityKey === record.activityId);
  assert.equal(projected.pageId, page.id);
  assert.equal(projected.authoringKind, "open-response");
  const manifest = validateAndNormalizeUltimateB2HotspotManifest({
    schemaVersion: "1.0",
    packageSlug: "ultimate-b2",
    componentSlug: "students-book",
    pages: { [page.id]: [{ id: "publisher-created-hotspot", unitNumber: 1, pageId: page.id, pageNumber: page.pageNumber, left: 10, top: 10, width: 20, height: 20, label: "", actionType: "normalized_activity", activityKey: record.activityId }] },
  }, activities);
  assert.equal(manifest.pages[page.id][0].label, record.title);
  assert.throws(() => validateAndNormalizeUltimateB2HotspotManifest(manifest, ultimateB2StudentsBookAuthoringActivities), /unavailable activityKey/);
});

test("official projection is transactional, idempotent by mutation, and never uses book_activities", async () => {
  const first = fakeDatabase();
  const created = await projectUltimateB2PublisherActivity({
    page,
    authoringKind: "open-response",
    title: "Publisher reflection",
    occupiedActivityIds: ["ultimate-b2-sb-u1-p1-o1", "ultimate-b2-sb-u1-p1-o2"],
    questions: [{ id: "q1", prompt: "What do you think?" }],
    client: first.client,
    clientMutationId: "draft:publisher-test-0001",
  });
  assert.equal(created.record.activityId, "ultimate-b2-sb-u1-p1-o3");
  const sql = first.calls.map((call) => call.sql).join("\n");
  assert.match(sql, /insert into activities/);
  assert.match(sql, /ownership_type/);
  assert.match(sql, /insert into questions/);
  assert.doesNotMatch(sql, /book_activities/);
  const lessonLookup = first.calls.find((call) => call.sql.includes("from lessons l"));
  assert.deepEqual(lessonLookup.parameters, ["unit-1", "recovered-students-book-activities"]);
  const activityUpsert = first.calls.find((call) => call.sql.includes("insert into activities"));
  assert.equal(activityUpsert.parameters[1], created.record.activityId);
  assert.equal(activityUpsert.parameters[5].publisherSourceActivityId, created.record.activityId);
  assert.equal(activityUpsert.parameters[5].stableNormalizedId, created.record.activityId);
  assert.ok(first.calls.some((call) => call.sql.trim().toLowerCase() === "commit"));

  const retry = fakeDatabase({ priorMutationSlug: created.record.activityId });
  const replayed = await projectUltimateB2PublisherActivity({ page, authoringKind: "open-response", title: created.record.title, occupiedActivityIds: [], questions: [], client: retry.client, clientMutationId: "draft:publisher-test-0001" });
  assert.equal(replayed.record.activityId, created.record.activityId);
});

test("publisher projection fails closed before connecting without explicit isolated DB confirmation", async () => {
  await assert.rejects(projectUltimateB2PublisherActivity({ page, authoringKind: "image", title: "Blocked save", occupiedActivityIds: [], clientMutationId: "draft:publisher-test-0002", environment: {} }), /requires ULTIMATE_B2_PUBLISHER_AUTHORING_DB_MODE=test or staging/);
});

test("local creation endpoint surfaces missing safe DB and leaves the canonical registry/files untouched", async () => {
  const registryPath = path.resolve("src/data/ultimate-b2/authoring/publisher-created-activities.json");
  const registryBefore = await readFile(registryPath, "utf8");
  const stored = normalizeUltimateB2PublisherActivityRegistry(JSON.parse(registryBefore));
  const predictedActivityId = nextUltimateB2PublisherActivityId(page, [...ultimateB2StudentsBookAuthoringActivities.map((activity) => activity.activityKey), ...stored.activities.map((activity) => activity.activityId)]);
  const authoringPath = path.resolve(`src/data/ultimate-b2/authoring/publisher-created/${predictedActivityId}.image.json`);
  await assert.rejects(access(authoringPath));
  const raster = await sharp({ create: { width: 32, height: 32, channels: 4, background: "#23518d" } }).png().toBuffer();
  const server = await createServer({ configFile: false, appType: "custom", logLevel: "silent", plugins: [ultimateB2PublisherActivityBuilderPlugin(), ultimateB2ImageBuilderPlugin()], server: { host: "127.0.0.1", port: 0 } });
  try {
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const response = await fetch(`${base}/__hhplms/ultimate-b2-publisher-activities/create`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: { pageId: page.id, authoringKind: "image", title: "Must not persist", clientMutationId: "draft:missing-safe-db-0001", predictedActivityId }, source: { type: "image/png", base64: raster.toString("base64"), mainImageAlt: "Safe test image" } }) });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /requires ULTIMATE_B2_PUBLISHER_AUTHORING_DB_MODE=test or staging/);
    assert.equal((await fetch(`${base}/__hhplms/ultimate-b2-image-authoring?activityId=${predictedActivityId}`)).status, 404);
    assert.equal(await readFile(registryPath, "utf8"), registryBefore);
    await assert.rejects(access(authoringPath));
  } finally {
    await server.close();
  }
});

test("Activity Builder exposes one separate accessible add control and only the two trusted creation types", async () => {
  const [navigation, builderPlugin, openResponseData, imageData] = await Promise.all([
    readFile("src/apps/ultimate-b2-builder/UltimateB2ActivityNavigation.jsx", "utf8"),
    readFile("scripts/ultimate-b2/publisher-activity-builder-vite-plugin.mjs", "utf8"),
    readFile("src/data/ultimate-b2/openResponseAuthoringData.js", "utf8"),
    readFile("src/data/ultimate-b2/imageAuthoringData.js", "utf8"),
  ]);
  assert.match(navigation, /aria-label={`Add activity to \$\{page\.pageLabel\}`}/);
  assert.match(navigation, /aria-haspopup="menu"/);
  assert.equal((navigation.match(/role="menuitem"/g) || []).length, 2);
  assert.match(navigation, />Image<\/button>/);
  assert.match(navigation, />Open Response<\/button>/);
  assert.match(builderPlugin, /await projectActivity[\s\S]*await transactionalPublisherAuthoringWrite/);
  assert.match(openResponseData, /authoring\/\*\*\/\*\.open-response\.json/);
  assert.match(imageData, /authoring\/\*\*\/\*\.image\.json/);
});
