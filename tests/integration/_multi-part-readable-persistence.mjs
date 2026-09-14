import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { multiPartReadablePair } from "../fixtures/native-runtime-regressions/runtime-corrections-data.js";
import { appendMultiPartPublicationFixture } from "../fixtures/native-multi-part-publication.js";
import { createPublicationV2FixtureSources } from "../fixtures/publication-v2.js";
import { compileUltimateB2ComponentReleaseV2 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { prepareBuilderNativeAssetUpload, claimBuilderNativeAssetUpload, completeBuilderNativeAssetUpload } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activity-store.js";
import { createBuilderNativeActivitiesHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activities.js";
import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from "../../src/data/native-activities/nativeActivityRuntimeValidation.js";
import { nativeAudioTextHotspotTargets } from "../../src/data/native-activities/nativeAudioTextHotspots.js";

export async function exerciseMultiPartReadablePersistence({ pool, sql, actor }) {
  const identity = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" };
  const event = (suffix, body) => ({ httpMethod: "POST", path: `/builder/api/native-activities/books/${identity.bookSlug}/components/${identity.componentSlug}/${suffix}`, headers: { host: "localhost:8888", origin: "http://localhost:8888", "content-type": "application/json" }, body: JSON.stringify(body) });
  const handler = createBuilderNativeActivitiesHandler({ getDatabase: () => sql, authorize: async () => ({ builderUser: { id: actor } }), logger: { error() {}, warn() {} } });
  for (const audioEnabled of [false, true]) {
    const created = await handler(event("create", { kind: "multi-part", title: `Multi-Part readable ${audioEnabled}`, pageId: "ub2-sb-unit-1-part-1", clientMutationId: randomUUID() }));
    assert.equal(created.statusCode, 200, created.body);
    const activityId = JSON.parse(created.body).activityId;
    let pair = multiPartReadablePair(audioEnabled);
    pair.publicDocument.activityId = pair.teacherDocument.activityId = activityId;
    for (const asset of pair.publicDocument.assets.filter((asset) => asset.role !== "activity_font")) {
      const audio = asset.slot.includes("audio"); const type = audio ? "audio/mpeg" : "image/png"; const extension = audio ? "mp3" : "png";
      const dimensions = asset.slot === "readable" ? [1000, 1800] : asset.slot === "overlay" ? [150, 100] : asset.slot === "item" ? [120, 60] : [1024, 582];
      const uploadId = randomUUID(); const clientMutationId = randomUUID();
      await prepareBuilderNativeAssetUpload(sql, { ...identity, activityId, assetSlot: asset.slot, uploadId, clientMutationId, builderUserId: actor, requestSha256: asset.checksumSha256, fileDescriptor: { name: `fixture.${extension}`, size: 68, type, assetSlot: asset.slot, purpose: "native-asset" }, stagingObjectKey: `builder-native-assets/${identity.bookSlug}/${identity.componentSlug}/${activityId}/${uploadId}/staging/asset`, expiresAt: new Date(Date.now() + 600000).toISOString() });
      await claimBuilderNativeAssetUpload(sql, { uploadId, clientMutationId, builderUserId: actor });
      asset.assetId = await completeBuilderNativeAssetUpload(sql, { uploadId, builderUserId: actor, objectKey: `builder-native-assets/${identity.bookSlug}/${identity.componentSlug}/${activityId}/assets/${asset.checksumSha256}.${extension}`, storageBucket: "local-fixtures", mimeType: type, byteSize: 68, checksumSha256: asset.checksumSha256, width: audio ? null : dimensions[0], height: audio ? null : dimensions[1] });
    }
    const options = { activityId, kind: "multi-part" };
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
    const sources = appendMultiPartPublicationFixture(createPublicationV2FixtureSources(), pair);
    sources.native.assetRows = sources.native.assetRows.filter((row) => row.source_metadata?.native_activity_id !== activityId).concat(assetRows);
    const compiled = compileUltimateB2ComponentReleaseV2(sources);
    assert.deepEqual(compiled.publicProjection.nativeActivities[activityId].document, publicDocument);
    const publicBytes = JSON.stringify(compiled.publicProjection.nativeActivities[activityId]);
    assert.doesNotMatch(publicBytes, /Synthetic private explanation|"mappings"|"correctAnswers"|"modelAnswers"/);
    assert.equal(nativeAudioTextHotspotTargets(publicDocument).length, 6);
    const frozen = JSON.stringify(compiled);
    const reordered = structuredClone(pair); reordered.publicDocument.parts[0].interaction.panels.reverse(); reordered.publicDocument.parts[0].interaction.sections.reverse();
    const reorderedSave = await handler(event(`activities/${activityId}/save`, { ...reordered, expectedPublicRevision: JSON.parse(saved.body).publicRevision, expectedTeacherRevision: JSON.parse(saved.body).teacherRevision, clientMutationId: randomUUID() }));
    assert.equal(reorderedSave.statusCode, 200, reorderedSave.body);
    assert.deepEqual(JSON.parse(reorderedSave.body).publicDocument.audioTextHotspots, publicDocument.audioTextHotspots);
    assert.equal(JSON.stringify(compiled), frozen, "later draft edits never mutate the compiled publication");
    assert.equal((await handler(event(`activities/${activityId}/save`, { ...input, clientMutationId: randomUUID() }))).statusCode, 409);
  }
}
