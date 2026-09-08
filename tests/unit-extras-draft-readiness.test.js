import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { incompleteExtrasFixture } from "./fixtures/unit-extras-draft.js";
import { studentsBookPageSql } from "./fixtures/students-book-current.js";
import { resolveBuilderContentResource } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-registry.js";
import { createBuilderPreviewHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-preview.js";
import { issueBuilderPreviewAuthorization, authorizeBuilderPreviewRequestWithDiagnostic } from "../netlify-sites/ultimate-b2-builder/server/_builder-preview-authorization.js";
import { builderDocumentSha256 } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { validateUnitExtraAssetRows } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { normalizeCurrentPublishedUnitExtras, projectUltimateB2UnitExtrasForPublication } from "../src/data/ultimate-b2/unitExtras.js";
import { loadHostedDraftUnitExtras, publishedUnitExtraAudioUrl, publishedUnitExtraVideoUrl } from "../src/apps/android-teacher-offline/hostedComponentReleaseProvider.js";
import { HOSTED_VIEWER_RUNTIME_MODES } from "../src/apps/android-teacher-offline/hostedReleasePreview.js";

const identity = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" };
async function preview(document, { authorized = true, foreignScope = false, dependencyFailure = false } = {}) {
  const environment = { BUILDER_PREVIEW_AUTH_SECRET: randomBytes(48).toString("hex") };
  const issued = issueBuilderPreviewAuthorization({ ...identity, componentSlug: foreignScope ? "ultimate-b2-workbook" : identity.componentSlug, view: "library", pageId: null, activityId: null, releaseId: null }, { environment });
  const sql = studentsBookPageSql({ otherSql: async () => [{ schema_version: "1.0", revision: 1, payload: document, payload_sha256: builderDocumentSha256(document) }] });
  const handler = createBuilderPreviewHandler({ getDatabase: () => { if (dependencyFailure) throw new Error("synthetic database unavailable"); return sql; }, authorizePreview: (e, s, q) => authorizeBuilderPreviewRequestWithDiagnostic(e, s, q, { environment }), logger: { error() {}, warn() {} } });
  const response = await handler({ path: `/builder/preview/content/books/${identity.bookSlug}/components/${identity.componentSlug}/unit-extras`, httpMethod: "GET", headers: {}, queryStringParameters: authorized ? { previewAuthorization: issued.token } : {} });
  return { response, context: { kind: HOSTED_VIEWER_RUNTIME_MODES.BUILDER_PREVIEW, authorization: issued.token }, sql };
}

test("real Saved Draft handler and client retain unfinished video/audio without playable media", async () => {
  const document = incompleteExtrasFixture(), before = structuredClone(document);
  const { response, context } = await preview(document);
  assert.equal(response.statusCode, 200, response.body);
  const publication = await loadHostedDraftUnitExtras({ identity, context, fetchImpl: async () => ({ ok: true, status: 200, json: async () => JSON.parse(response.body) }) });
  const extras = publication.projection.unitExtras;
  for (const [category, kind] of [["videos", "video"], ["audios", "audio"]]) {
    const entry = extras.units[0].categories[category][0];
    assert.equal(entry.id, document.units[0].categories[category][0].id);
    assert.equal(entry.title, document.units[0].categories[category][0].title);
    assert.equal(entry.readiness, "missing-media");
    assert.equal(entry[kind], null);
  }
  assert.deepEqual(extras.pages, document.pages);
  assert.deepEqual(document, before);
  assert.equal(publishedUnitExtraVideoUrl(publication, null), "");
  assert.equal(publishedUnitExtraAudioUrl(publication, null), "");
  assert.throws(() => normalizeCurrentPublishedUnitExtras(extras));
  assert.throws(() => projectUltimateB2UnitExtrasForPublication(document), /requires a managed MP4/);
  assert.throws(() => validateUnitExtraAssetRows(document, []), e => e.code === "unit_extra_video_not_ready");
  document.units[0].categories.videos = [];
  assert.throws(() => validateUnitExtraAssetRows(document, []), e => e.code === "unit_extra_audio_not_ready");
  assert.doesNotMatch(response.body, /objectKey|bucket|fileName|byteSize|teacher|answer|secret/i);
});

test("unfinished state does not recover malformed data, foreign ownership or dependency/auth failures", async () => {
  const document = incompleteExtrasFixture();
  assert.equal((await preview(document, { authorized: false })).response.statusCode, 401);
  assert.equal((await preview(document, { foreignScope: true })).response.statusCode, 401);
  assert.equal((await preview(document, { dependencyFailure: true })).response.statusCode, 500);
  for (const corrupt of [
    d => { d.units[0].categories.videos[0].durationMs = 5; },
    d => { d.units[0].categories.videos[0].cues = [{ invalid: true }]; },
    d => { d.pages[0].unitId = "unit-2"; },
    d => { d.units[0].categories.audios[0].asset = { role: "teacher" }; },
    d => { d.teacherAnswers = ["protected"]; },
  ]) { const value = structuredClone(document); corrupt(value); assert.equal((await preview(value)).response.statusCode, 500); }
});

test("mixed draft keeps ready ordering and strict complete publication bytes", async () => {
  const document = incompleteExtrasFixture();
  for (const [category, kind] of [["videos", "video"], ["audios", "audio"]]) {
    const list = document.units[0].categories[category], entry = structuredClone(list[0]);
    entry.id = `${kind}-${"3".repeat(32)}`; entry.assetSlot = entry.id; entry.title = `Ready ${kind}`;
    entry.asset = { assetId: "10000000-0000-4000-8000-000000000001", checksumSha256: "a".repeat(64), role: `unit_extra_${kind}`, slot: entry.id };
    entry.fileName = kind === "video" ? "ready.mp4" : "ready.mp3"; entry.byteSize = 100;
    if (kind === "video") entry.durationMs = 1000;
    list.push(entry);
  }
  const before = structuredClone(document), { response, context } = await preview(document);
  assert.equal(response.statusCode, 200, response.body);
  const publication = await loadHostedDraftUnitExtras({ identity, context, fetchImpl: async () => ({ ok: true, status: 200, json: async () => JSON.parse(response.body) }) });
  for (const [category, kind, url] of [["videos", "video", publishedUnitExtraVideoUrl], ["audios", "audio", publishedUnitExtraAudioUrl]]) {
    const entries = publication.projection.unitExtras.units[0].categories[category];
    assert.deepEqual(entries.map(e => e.id), document.units[0].categories[category].map(e => e.id));
    assert.match(url(publication, entries[1][kind].asset), /previewAuthorization=/);
    document.units[0].categories[category].shift();
  }
  const resource = await resolveBuilderContentResource(identity.bookSlug, identity.componentSlug, "unit-extras");
  const projection = await resource.projectPreview(document, { sql: studentsBookPageSql() });
  assert.deepEqual(projection, projectUltimateB2UnitExtrasForPublication(document));
  assert.deepEqual(before.units[0].categories.videos[0], incompleteExtrasFixture().units[0].categories.videos[0]);
});
