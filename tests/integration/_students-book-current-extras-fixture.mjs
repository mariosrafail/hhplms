import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";
import { taggedDatabase, seedUnificationActors, syntheticPageStorage } from "./_students-book-unification-fixture.mjs";
import { createBuilderPagesHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-pages.js";
import { createBuilderContentHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content.js";
import { createBuilderPreviewHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-preview.js";
import { createBuilderUnitExtraAssetsHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-unit-extra-assets.js";
import media from "../fixtures/students-book-synthetic-media.json" with { type: "json" };
import { createBuilderNativeActivitiesHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activities.js";
import { createNativeOpenResponseQuestion } from "../../src/data/native-activities/nativeOpenResponse.js";
import { HOSTED_EDITABLE_UI_BINDINGS } from "../../src/data/ultimate-b2/hostedTeacherUiBindingCatalog.js";
import { normalizeHostedTeacherUiDocument } from "../../src/data/ultimate-b2/hostedTeacherUiDocument.js";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";

export const extrasScope = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" };
export const extrasRoute = (kind) => `/builder/api/${kind}/books/${extrasScope.bookSlug}/components/${extrasScope.componentSlug}`;
export const responseJson = (response, status = 200) => { assert.equal(response.statusCode, status, response.body); return JSON.parse(response.body); };

export async function currentExtrasFixture(t) {
  const base = new URL(process.env.TEST_DATABASE_URL);
  assert(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname));
  assert.equal(process.env.TEST_DATABASE_CONFIRMATION, "isolated-test-database");
  const schema = `sb_extras_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Pool({ connectionString: base.toString(), max: 1 });
  await admin.query(`create schema "${schema}"`);
  base.searchParams.set("options", `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: base.toString(), max: 4 });
  t.after(async () => { await pool.end(); await admin.query(`drop schema "${schema}" cascade`); await admin.end(); });
  await applyCanonicalProductionMigrations(pool);
  const actors = await seedUnificationActors(pool);
  const sql = taggedDatabase(pool);
  const local = await syntheticPageStorage(t);
  const event = (path, httpMethod = "GET", body) => ({ path, httpMethod, headers: { host: "builder.example", origin: "https://builder.example", cookie: actors.builderCookie, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const dependencies = { getDatabase: () => sql, storage: () => local.storage };
  const pages = createBuilderPagesHandler(dependencies);
  const content = createBuilderContentHandler(dependencies);
  const extras = createBuilderUnitExtraAssetsHandler(dependencies);
  const preview = createBuilderPreviewHandler({ getDatabase: () => sql, authorizePreview: async () => ({ authorized: true }) });
  const read = () => content(event(`${extrasRoute("content")}/unit-extras`)).then(responseJson);
  const save = (document, expectedRevision, clientMutationId = randomUUID()) => extras(event(`${extrasRoute("unit-extras")}/save`, "POST", { document, expectedRevision, clientMutationId }));
  const catalog = () => pages(event(extrasRoute("pages"))).then(responseJson);
  const addManaged = async ({ replacePageId = "" } = {}) => {
    const current = await catalog();
    const existing = current.pages.find((page) => page.id === replacePageId);
    const bytes = await sharp({ create: { width: existing?.image.width || 240, height: existing?.image.height || 320, channels: 3, background: "orange" } }).png().toBuffer();
    const clientMutationId = randomUUID();
    const prepared = responseJson(await pages(event(`${extrasRoute("pages")}/assets/prepare`, "POST", { mode: replacePageId ? "replace" : "create", pageId: replacePageId, expectedRevision: current.revision, clientMutationId, metadata: { ...(!replacePageId ? { unitId: current.units.find((unit) => unit.unitNumber === 10).id } : {}), label: "Synthetic Extras Unit 10", printedLabel: "Test 10", sortOrder: 999 }, file: { name: "synthetic.png", size: bytes.length, type: "image/png" } })));
    assert.equal((await fetch(prepared.authorization.url, { method: "PUT", headers: prepared.authorization.headers, body: bytes })).status, 200);
    responseJson(await pages(event(`${extrasRoute("pages")}/assets/finalize`, "POST", { uploadId: prepared.uploadId, expectedRevision: current.revision, clientMutationId })));
    return prepared.pageId;
  };
  const attach = async (unitNumber, kind) => {
    const current = await read();
    const document = current.document;
    const id = `${kind === "videos" ? "video" : "audio"}-${randomUUID().replaceAll("-", "")}`;
    let unit = document.units.find((entry) => entry.unitNumber === unitNumber);
    if (!unit) { unit = { unitNumber, unitId: `unit-${unitNumber}`, categories: { videos: [], audios: [] } }; document.units.push(unit); }
    (unit.categories[kind] ||= []).push({ id, assetSlot: id, title: `Synthetic ${kind} ${unitNumber}`, asset: null, fileName: "", byteSize: null, ...(kind === "videos" ? { durationMs: null, cues: [] } : {}) });
    const saved = responseJson(await save(document, current.revision));
    const name = kind === "videos" ? "color.mp4" : "tone.mp3";
    const bytes = Buffer.from(media.files[name].base64, "base64");
    const type = kind === "videos" ? "video/mp4" : "audio/mpeg";
    const baseRoute = `${extrasRoute("unit-extras")}/units/unit-${unitNumber}/${kind}/${id}/assets`;
    const clientMutationId = randomUUID();
    const prepared = responseJson(await extras(event(`${baseRoute}/prepare`, "POST", { expectedRevision: saved.revision, clientMutationId, file: { name, size: bytes.length, type, assetSlot: id } })));
    assert.equal((await fetch(prepared.authorization.url, { method: "PUT", headers: prepared.authorization.headers, body: bytes })).status, 200);
    const finalize = { uploadId: prepared.uploadId, expectedRevision: saved.revision, clientMutationId };
    const finalized = responseJson(await extras(event(`${baseRoute}/finalize`, "POST", finalize)));
    assert.equal(responseJson(await extras(event(`${baseRoute}/finalize`, "POST", finalize))).idempotent, true);
    const item = saved.document.units.find((entry) => entry.unitNumber === unitNumber).categories[kind].find((entry) => entry.id === id);
    Object.assign(item, { asset: finalized.reference, fileName: name, byteSize: finalized.metadata.byteSize }, kind === "videos" ? { durationMs: finalized.metadata.durationMs, cues: [{ id: `cue-${randomUUID().replaceAll("-", "")}`, startMs: 0, endMs: Math.min(100, finalized.metadata.durationMs), text: "Synthetic subtitle" }] } : {});
    responseJson(await save(saved.document, saved.revision));
    return item;
  };
  const addNative = async (pageId, unitNumber) => {
    const native = createBuilderNativeActivitiesHandler({ getDatabase: () => sql });
    const created = responseJson(await native(event(`${extrasRoute("native-activities")}/create`, "POST", { kind: "open-response", pageId, title: "Synthetic full-book activity", clientMutationId: randomUUID() })));
    const publicState = responseJson(await content(event(`${extrasRoute("content")}/native-activity-public/${created.activityId}`)));
    const teacherState = responseJson(await content(event(`${extrasRoute("content")}/native-activity-teacher/${created.activityId}`)));
    const questionId = `q-${randomUUID().replaceAll("-", "")}`;
    publicState.document.metadata.visibleInstructionText = "Explain your answer.";
    publicState.document.parts[0].interaction.questions = [{ ...createNativeOpenResponseQuestion(questionId), prompt: "Synthetic full-book prompt" }];
    teacherState.document.parts[0].solution.modelAnswers = [{ questionId, text: "Synthetic protected model" }];
    responseJson(await native(event(`${extrasRoute("native-activities")}/activities/${created.activityId}/save`, "POST", { expectedPublicRevision: publicState.revision, expectedTeacherRevision: teacherState.revision, publicDocument: publicState.document, teacherDocument: teacherState.document, clientMutationId: randomUUID() })));
    const hotspots = responseJson(await content(event(`${extrasRoute("content")}/hotspots`)));
    hotspots.document.pages[pageId] = [{ id: "fullbook-synthetic-hotspot", pageId, unitNumber, left: 4, top: 8, width: 30, height: 20, label: "Synthetic exercise", actionType: "normalized_activity", activityKey: created.activityId }];
    responseJson(await content(event(`${extrasRoute("content")}/hotspots`, "PUT", { document: hotspots.document, expectedRevision: hotspots.revision, clientMutationId: randomUUID() })));
    return created.activityId;
  };
  const seedTeacherUi = async () => {
    const bytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: "#345678" } }).png().toBuffer();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const binding = HOSTED_EDITABLE_UI_BINDINGS.find((entry) => entry.mediaFamily === "raster" && !entry.atomicGroup);
    const document = normalizeHostedTeacherUiDocument({ schemaVersion: "1.0", packageId: "ultimate-b2-students-book", assets: { [binding.id]: { sha256, extension: "png", mediaType: "image/png", sizeBytes: bytes.length, width: 12, height: 12, originalFilename: "synthetic-ui.png" } } });
    // Explicit synthetic source setup through the real SQL persistence contract.
    const result = await pool.query("select * from save_builder_component_document('ultimate-b2','ultimate-b2-students-book','teacher_ui','default','1.0',0,$1::jsonb,$2,$3::uuid,$4::uuid)", [JSON.stringify(document), builderDocumentSha256(document), actors.actor, randomUUID()]);
    assert.equal(result.rows[0].outcome, "saved");
    return { document, bytes, sha256 };
  };
  return { ...local, pool, sql, actors, event, pages, content, extras, preview, read, save, catalog, addManaged, attach, addNative, seedTeacherUi };
}
