import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOldschoolModePair } from "../fixtures/oldschool-modes.js";
import { appendOldschoolTypographyPublication } from "../fixtures/oldschool-typography-publication.js";
import { createPublicationV2FixtureSources } from "../fixtures/publication-v2.js";
import { compileUltimateB2ComponentReleaseV2 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { prepareBuilderNativeAssetUpload, claimBuilderNativeAssetUpload, completeBuilderNativeAssetUpload } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activity-store.js";
import { createBuilderNativeActivitiesHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activities.js";
import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from "../../src/data/native-activities/nativeActivityRuntimeValidation.js";
import { nativeOldschoolListeningAssetRequirements } from "../../src/data/native-activities/nativeOldschoolListening.js";

export async function exerciseOldschoolModesPersistence({ pool, sql, actor, fontReference }) {
  const identity = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" };
  const event = (suffix, body) => ({ httpMethod: "POST", path: `/builder/api/native-activities/books/${identity.bookSlug}/components/${identity.componentSlug}/${suffix}`, headers: { host: "localhost:8888", origin: "http://localhost:8888", "content-type": "application/json" }, body: JSON.stringify(body) });
  const handler = createBuilderNativeActivitiesHandler({ getDatabase: () => sql, authorize: async () => ({ builderUser: { id: actor } }), logger: { error() {}, warn() {} } });
  for (const mode of ["open-response", "single-choice", "drag-drop"]) {
    const created = await handler(event("create", { kind: "oldschool-listening", title: `Isolated ${mode}`, pageId: "ub2-sb-unit-1-part-1", clientMutationId: randomUUID() }));
    assert.equal(created.statusCode, 200, created.body);
    const activityId = JSON.parse(created.body).activityId;
    let pair = createOldschoolModePair(mode, 4);
    pair.publicDocument.activityId = pair.teacherDocument.activityId = activityId;
    const interaction = pair.publicDocument.parts[0].interaction;
    if (mode === "open-response") interaction.questions[0].responseRegion.presentation.answerFontAssetSlot = fontReference.slot;
    if (mode === "drag-drop") interaction.questionInteraction.presentation.bankWordStyle.fontAssetSlot = fontReference.slot;
    pair.publicDocument.assets = pair.publicDocument.assets.map((asset) => asset.role === "activity_font" ? fontReference : asset);
    for (const asset of pair.publicDocument.assets.filter((asset) => asset.role !== "activity_font")) {
      const audio = asset.slot.includes("audio"); const type = audio ? "audio/mpeg" : "image/png"; const extension = audio ? "mp3" : "png";
      const dimensions = asset.slot === "transcript-page" ? [1018, 1509] : asset.slot === "readable-image" ? [1024, 1600] : [1024, 582];
      const uploadId = randomUUID(); const clientMutationId = randomUUID();
      await prepareBuilderNativeAssetUpload(sql, { ...identity, activityId, assetSlot: asset.slot, uploadId, clientMutationId, builderUserId: actor, requestSha256: asset.checksumSha256, fileDescriptor: { name: `fixture.${extension}`, size: 68, type, assetSlot: asset.slot, purpose: "native-asset" }, stagingObjectKey: `builder-native-assets/${identity.bookSlug}/${identity.componentSlug}/${activityId}/${uploadId}/staging/asset`, expiresAt: new Date(Date.now() + 600000).toISOString() });
      await claimBuilderNativeAssetUpload(sql, { uploadId, clientMutationId, builderUserId: actor });
      asset.assetId = await completeBuilderNativeAssetUpload(sql, { uploadId, builderUserId: actor, objectKey: `builder-native-assets/${identity.bookSlug}/${identity.componentSlug}/${activityId}/assets/${asset.checksumSha256}.${extension}`, storageBucket: "local-fixtures", mimeType: type, byteSize: 68, checksumSha256: asset.checksumSha256, width: audio ? null : dimensions[0], height: audio ? null : dimensions[1] });
    }
    const options = { activityId, kind: "oldschool-listening" };
    const publicDocument = normalizeNativeRuntimePublicDocument(pair.publicDocument, options);
    const teacherDocument = normalizeNativeRuntimeTeacherDocument(pair.teacherDocument, { ...options, publicDocument });
    pair = { publicDocument, teacherDocument };
    const revisions = (await pool.query("select document_type,revision from builder_component_documents where document_key=$1", [activityId])).rows;
    const input = { ...pair, expectedPublicRevision: Number(revisions.find((row) => row.document_type === "native_activity_public").revision), expectedTeacherRevision: Number(revisions.find((row) => row.document_type === "native_activity_teacher").revision), clientMutationId: randomUUID() };
    const saved = await handler(event(`activities/${activityId}/save`, input)); assert.equal(saved.statusCode, 200, saved.body);
    const reloaded = (await pool.query("select document_type,payload from builder_component_documents where document_key=$1", [activityId])).rows;
    assert.deepEqual(reloaded.find((row) => row.document_type === "native_activity_public").payload, publicDocument);
    assert.deepEqual(reloaded.find((row) => row.document_type === "native_activity_teacher").payload, teacherDocument);
    const assetRows = (await pool.query("select * from book_assets where id=any($1::uuid[])", [publicDocument.assets.map((asset) => asset.assetId)])).rows;
    const compiled = compileUltimateB2ComponentReleaseV2(appendOldschoolTypographyPublication(createPublicationV2FixtureSources(), pair, assetRows));
    assert.deepEqual(compiled.publicProjection.nativeActivities[activityId].document, publicDocument);
    const publicBytes = JSON.stringify(compiled.publicProjection.nativeActivities[activityId]);
    assert.doesNotMatch(publicBytes, /SYNTHETIC_PRIVATE_TRANSCRIPT_ANSWER|"mappings"|"correctAnswers"|"modelAnswers"/);
    assert(nativeOldschoolListeningAssetRequirements(publicDocument).some((requirement) => requirement.slot === "transcript-audio"));
    assert.equal((await handler(event(`activities/${activityId}/save`, { ...input, clientMutationId: randomUUID() }))).statusCode, 409);
  }
}
