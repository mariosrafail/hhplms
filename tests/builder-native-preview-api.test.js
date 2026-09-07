import { studentsBookPageSql, currentStudentsBookSources, canonicalStudentsBookPages } from "./fixtures/students-book-current.js";
import assert from "node:assert/strict";
import test from "node:test";

import { createBuilderNativePreviewHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-native-preview.js";
import { inspectBuilderPreviewAuthorizationScope, issueBuilderPreviewAuthorization } from "../netlify-sites/ultimate-b2-builder/server/_builder-preview-authorization.js";
import { createPublicationV2FixtureSources, publicationV2Fixture } from "./fixtures/publication-v2.js";
import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { createNativeOpenResponseQuestion } from "../src/data/native-activities/nativeOpenResponse.js";
import { nativeChildIdFromUuid } from "../src/data/native-activities/nativeChildIdentity.js";

const environment = { BUILDER_PREVIEW_AUTH_SECRET: "test-only-preview-secret-with-at-least-thirty-two-bytes" };
const now = Date.parse("2026-08-15T12:00:00Z");
const root = "/builder/preview/native-activities/books/ultimate-b2/components/ultimate-b2-students-book/activities";

function tokenFor(overrides = {}) {
  return issueBuilderPreviewAuthorization({
    bookSlug: "ultimate-b2",
    componentSlug: "ultimate-b2-students-book",
    view: "page",
    pageId: publicationV2Fixture.pageId,
    activityId: null,
    releaseId: null,
    ...overrides,
  }, { environment, now, nonce: "abcdefghijklmnopQRSTUV" }).token;
}

function request(activityId, suffix, token = tokenFor(), method = "GET") {
  return {
    httpMethod: method,
    path: `${root}/${activityId}/${suffix}`,
    headers: {},
    queryStringParameters: { previewAuthorization: token },
  };
}

function harness({ sources = createPublicationV2FixtureSources(), asset = undefined, authorizationNow = now + 1_000 } = {}) {
  const documents = sources.native.activities;
  return createBuilderNativePreviewHandler({
    environment,
    getDatabase: () => studentsBookPageSql(),
    inspectAuthorization: (event, scope) => inspectBuilderPreviewAuthorizationScope(event, scope, { environment, now: authorizationNow }),
    loadDocument: async (_sql, resource) => {
      if (resource.documentType === "native_activity_index") return { revision: sources.native.index.revision, document: sources.native.index.payload };
      const selected = documents[resource.documentKey];
      const source = resource.documentType === "native_activity_teacher" ? selected?.teacher : selected?.public;
      return source ? { revision: source.revision, document: source.payload } : null;
    },
    loadAsset: async () => asset === undefined ? sources.native.assetRows[0] : asset,
    storage: () => ({ signedGetUrl: async () => "https://private-assets.example/signed/native.png?signature=opaque" }),
    logger: { error() {} },
  });
}

function oldschoolPreviewSources() {
  const sources = createPublicationV2FixtureSources();
  const activityId = "ultimate-b2-sb-u1-p1-o95";
  const kind = resolveNativeActivityKind("oldschool-listening");
  const publicDocument = kind.createBlankPublic({ activityId, title: "Oldschool Listening preview", placement: { pageId: publicationV2Fixture.pageId } });
  const teacherDocument = kind.createBlankTeacher({ activityId });
  const questionId = nativeChildIdFromUuid("q", "20000000-0000-4000-8000-000000000001");
  const audio = { assetId: "20000000-0000-4000-8000-000000000002", checksumSha256: "d".repeat(64), role: "activity_artwork", slot: "preview-audio" };
  const page = { assetId: "20000000-0000-4000-8000-000000000003", checksumSha256: "e".repeat(64), role: "activity_artwork", slot: "preview-page" };
  publicDocument.assets = [audio, page];
  Object.assign(publicDocument.parts[0].interaction, { audioAssetSlot: audio.slot, audioDurationMs: 2_000, questions: [{ ...createNativeOpenResponseQuestion(questionId), prompt: "What did you hear?" }], cues: [{ id: nativeChildIdFromUuid("cue", "20000000-0000-4000-8000-000000000004"), startMs: 0, endMs: 2_000, text: "A safe public cue", highlightRegions: [{ id: nativeChildIdFromUuid("region", "20000000-0000-4000-8000-000000000005"), x: 10, y: 20, width: 300, height: 60 }], scrollY: 20 }] });
  Object.assign(publicDocument.parts[0].interaction.panels[1], { pageAssetSlot: page.slot, sourceWidth: 1000, sourceHeight: 1800, altText: "Preview page" });
  teacherDocument.parts[0].solution.modelAnswers = [{ questionId, text: "OLDSCHOOL_PREVIEW_TEACHER_PRIVATE" }];
  const entry = { activityId, kind: "oldschool-listening", placement: { pageId: publicationV2Fixture.pageId }, sortOrder: 99 };
  sources.native.index.payload.activities.push(entry);
  sources.native.activities[activityId] = { index: entry, public: { revision: 1, payload: publicDocument }, teacher: { revision: 1, payload: teacherDocument } };
  return { sources, activityId };
}

test("native draft public and teacher endpoints enforce audience separation", async () => {
  const handler = harness();
  const publicResponse = await handler(request(publicationV2Fixture.openResponseId, "public"));
  assert.equal(publicResponse.statusCode, 200);
  assert.equal(publicResponse.headers["Cache-Control"], "private, no-store");
  const publicEnvelope = JSON.parse(publicResponse.body);
  assert.equal(publicEnvelope.audience, "public");
  assert.equal(publicEnvelope.kind, "open-response");
  assert.equal(publicEnvelope.document.activityId, publicationV2Fixture.openResponseId);
  assert.doesNotMatch(publicResponse.body, new RegExp(publicationV2Fixture.teacherSentinel));

  const teacherResponse = await handler(request(publicationV2Fixture.openResponseId, "teacher"));
  assert.equal(teacherResponse.statusCode, 200);
  assert.equal(JSON.parse(teacherResponse.body).audience, "teacher");
  assert.match(teacherResponse.body, new RegExp(publicationV2Fixture.teacherSentinel));

  const choicePublicResponse = await handler(request(publicationV2Fixture.singleChoiceId, "public"));
  assert.equal(choicePublicResponse.statusCode, 200);
  assert.equal(JSON.parse(choicePublicResponse.body).kind, "single-choice");
  assert.doesNotMatch(choicePublicResponse.body, /correctAnswers|correctOptionId/);

  const choiceTeacherResponse = await handler(request(publicationV2Fixture.singleChoiceId, "teacher"));
  assert.equal(choiceTeacherResponse.statusCode, 200);
  const choiceTeacherEnvelope = JSON.parse(choiceTeacherResponse.body);
  assert.equal(choiceTeacherEnvelope.audience, "teacher");
  assert.equal(choiceTeacherEnvelope.kind, "single-choice");
  assert.deepEqual(
    choiceTeacherEnvelope.document,
    createPublicationV2FixtureSources().native.activities[publicationV2Fixture.singleChoiceId].teacher.payload,
  );
  assert.equal(choiceTeacherEnvelope.document.parts[0].solution.correctAnswers.length, 2);
  assert.equal((await handler(request(publicationV2Fixture.imageId, "teacher"))).statusCode, 200);
});

test("Oldschool Listening preview returns its public page mapping and keeps model answers Teacher-only", async () => {
  const fixture = oldschoolPreviewSources();
  const handler = harness({ sources: fixture.sources });
  const publicResponse = await handler(request(fixture.activityId, "public"));
  assert.equal(publicResponse.statusCode, 200);
  assert.equal(JSON.parse(publicResponse.body).document.parts[0].interaction.cues[0].highlightRegions.length, 1);
  assert.doesNotMatch(publicResponse.body, /OLDSCHOOL_PREVIEW_TEACHER_PRIVATE/);
  const teacherResponse = await handler(request(fixture.activityId, "teacher"));
  assert.equal(teacherResponse.statusCode, 200);
  assert.match(teacherResponse.body, /OLDSCHOOL_PREVIEW_TEACHER_PRIVATE/);
});

test("page and activity scopes stay narrow while a component-scoped library token supports in-book activity launch", async () => {
  const handler = harness();
  const activityToken = tokenFor({ view: "activity", pageId: null, activityId: publicationV2Fixture.openResponseId });
  assert.equal((await handler(request(publicationV2Fixture.openResponseId, "public", activityToken))).statusCode, 200);
  assert.equal((await handler(request(publicationV2Fixture.imageId, "public", activityToken))).statusCode, 401);
  assert.equal((await handler(request(publicationV2Fixture.singleChoiceId, "teacher", activityToken))).statusCode, 401);
  assert.equal((await handler(request(publicationV2Fixture.openResponseId, "public", tokenFor({ pageId: "ub2-sb-unit-1-part-2" })))).statusCode, 401);
  assert.equal((await handler(request(publicationV2Fixture.openResponseId, "public", tokenFor({ view: "library", pageId: null })))).statusCode, 200);
  assert.equal((await handler(request(publicationV2Fixture.openResponseId, "public", tokenFor({ componentSlug: "ultimate-b2-workbook" })))).statusCode, 401);
  assert.equal((await handler(request(publicationV2Fixture.openResponseId, "public", tokenFor({ bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-students-book" })))).statusCode, 401);
  assert.equal((await harness({ authorizationNow: now + 301_000 })(request(publicationV2Fixture.openResponseId, "public"))).statusCode, 401);
  assert.equal((await handler(request(publicationV2Fixture.openResponseId, "public", "malformed"))).statusCode, 401);
});

test("native draft assets require a current public reference and exact private draft ownership", async () => {
  const handler = harness();
  const response = await handler(request(publicationV2Fixture.imageId, `assets/${publicationV2Fixture.assetId}`));
  assert.equal(response.statusCode, 302);
  assert.match(response.headers.Location, /^https:\/\/private-assets\.example\/signed\//);
  assert.equal(response.headers["Cache-Control"], "private, no-store");
  assert.doesNotMatch(JSON.stringify(response), /builder-native-assets\/source\.png/);

  const otherId = "10000000-0000-4000-8000-000000000099";
  assert.equal((await handler(request(publicationV2Fixture.imageId, `assets/${otherId}`))).statusCode, 404);
  const mismatched = { ...createPublicationV2FixtureSources().native.assetRows[0], source_metadata: { native_activity_id: publicationV2Fixture.openResponseId, asset_slot: "composition-artwork" } };
  assert.equal((await harness({ asset: mismatched })(request(publicationV2Fixture.imageId, `assets/${publicationV2Fixture.assetId}`))).statusCode, 404);
});

test("native draft endpoint fails closed for missing and inconsistent authoritative state", async () => {
  const missing = createPublicationV2FixtureSources();
  delete missing.native.activities[publicationV2Fixture.openResponseId];
  assert.equal((await harness({ sources: missing })(request(publicationV2Fixture.openResponseId, "public"))).statusCode, 404);

  const inconsistent = createPublicationV2FixtureSources();
  inconsistent.native.activities[publicationV2Fixture.openResponseId].public.payload.placement.pageId = "ub2-sb-unit-1-part-2";
  assert.equal((await harness({ sources: inconsistent })(request(publicationV2Fixture.openResponseId, "public"))).statusCode, 500);
  const malformedPair = createPublicationV2FixtureSources();
  malformedPair.native.activities[publicationV2Fixture.openResponseId].teacher.payload.activityId = publicationV2Fixture.imageId;
  assert.equal((await harness({ sources: malformedPair })(request(publicationV2Fixture.openResponseId, "teacher"))).statusCode, 500);

  const missingChoiceTeacher = createPublicationV2FixtureSources();
  delete missingChoiceTeacher.native.activities[publicationV2Fixture.singleChoiceId].teacher;
  assert.equal((await harness({ sources: missingChoiceTeacher })(request(publicationV2Fixture.singleChoiceId, "teacher"))).statusCode, 404);

  const invalidChoiceTopology = createPublicationV2FixtureSources();
  invalidChoiceTopology.native.activities[publicationV2Fixture.singleChoiceId].teacher.payload.parts[0].solution.correctAnswers[0].correctOptionId = "opt-10000000000040008000000000000026";
  const invalidChoiceResponse = await harness({ sources: invalidChoiceTopology })(request(publicationV2Fixture.singleChoiceId, "teacher"));
  assert.equal(invalidChoiceResponse.statusCode, 500);
  assert.doesNotMatch(invalidChoiceResponse.body, /correctAnswers|correctOptionId/);
  assert.equal((await harness()(request(publicationV2Fixture.openResponseId, "public", tokenFor(), "POST"))).statusCode, 405);
});


test("saved order respects library, page and single-activity authorization scopes", async () => {
  const sources = currentStudentsBookSources();
  sources.native.index.payload.activities.push({ activityId: "ultimate-b2-sb-u1-p2-o9000", kind: "open-response", placement: { pageId: canonicalStudentsBookPages[1].id }, sortOrder: 9000 });
  const handler = harness({ sources });
  const query = (token) => ({ httpMethod: "GET", path: root.replace(/\/activities$/, "/order"), headers: {}, queryStringParameters: { previewAuthorization: token } });
  const library = await handler(query(tokenFor({ view: "library", pageId: null })));
  assert.equal(library.statusCode, 200);
  assert.ok(Object.keys(JSON.parse(library.body).pages).length > 1);
  const page = await handler(query(tokenFor()));
  assert.equal(page.statusCode, 200);
  assert.deepEqual(Object.keys(JSON.parse(page.body).pages), [publicationV2Fixture.pageId]);
  assert.ok(JSON.parse(page.body).pages[publicationV2Fixture.pageId].includes(publicationV2Fixture.imageId));
  const single = await handler(query(tokenFor({ view: "activity", pageId: null, activityId: publicationV2Fixture.imageId })));
  assert.equal(single.statusCode, 200);
  assert.deepEqual(Object.values(JSON.parse(single.body).pages).flat(), [publicationV2Fixture.imageId]);
  assert.equal((await handler(query("malformed"))).statusCode, 401);
  assert.equal((await handler(query(tokenFor({ componentSlug: "ultimate-b2-workbook" })))).statusCode, 401);
  assert.doesNotMatch(library.body, /modelAnswers|TEACHER_SENTINEL|correctAnswers/);
});
