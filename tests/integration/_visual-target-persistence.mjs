import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sharedFive, sharedFiveTeacher } from "../fixtures/native-runtime-regressions/shared-five-data.js";
import { dragDropImprovementsPair } from "../fixtures/native-runtime-regressions/drag-drop-improvements-data.js";
import { projectNativeMultiPartChild } from "../../src/data/native-activities/nativeMultiPart.js";
import { prepareBuilderNativeAssetUpload, claimBuilderNativeAssetUpload, completeBuilderNativeAssetUpload } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activity-store.js";
import { validateNativePublicationAssetRows } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from "../../src/data/native-activities/nativeActivityRuntimeValidation.js";

export async function exerciseVisualTargetPersistence({ pool, sql, handler, event, actor, identity }) {
  for (const kind of ["multi-part", "mark-the-words", "drag-drop"]) {
    const created = await handler(event("create", { kind, title: "Visual persistence", pageId: "ub2-sb-unit-1-part-1", clientMutationId: randomUUID() }));
    assert.equal(created.statusCode, 200, created.body);
    const activityId = JSON.parse(created.body).activityId;
    const pair = kind === "drag-drop" ? dragDropImprovementsPair() : kind === "multi-part" ? structuredClone({ publicDocument: sharedFive, teacherDocument: sharedFiveTeacher }) : structuredClone(projectNativeMultiPartChild(sharedFive, sharedFive.parts[0].interaction.sections.find((entry) => entry.kind === kind), sharedFiveTeacher));
    pair.publicDocument.activityId = pair.teacherDocument.activityId = activityId;
    if (kind === "multi-part") pair.publicDocument.parts[0].interaction.sections.find((section) => section.kind === "drag-drop").interaction.randomize = false;
    const rows = [];
    for (const reference of pair.publicDocument.assets) {
      const uploadId = randomUUID(); const clientMutationId = randomUUID();
      const dimensions = ({ graphic: { width: 120, height: 3 }, item: { width: 120, height: 60 }, overlay: { width: 150, height: 100 }, readable: { width: 1000, height: 1800 }, audio: { width: null, height: null } })[reference.slot] || { width: 1024, height: 582 };
      const mimeType = reference.slot === "audio" ? "audio/mpeg" : "image/png";
      const extension = reference.slot === "audio" ? "mp3" : "png";
      await prepareBuilderNativeAssetUpload(sql, { ...identity, activityId, assetSlot: reference.slot, uploadId, clientMutationId, builderUserId: actor, requestSha256: reference.checksumSha256, fileDescriptor: { name: `fixture.${extension}`, size: 68, type: mimeType, assetSlot: reference.slot, purpose: "native-asset" }, stagingObjectKey: `builder-native-assets/${identity.bookSlug}/${identity.componentSlug}/${activityId}/${uploadId}/staging/asset`, expiresAt: new Date(Date.now() + 600000).toISOString() });
      await claimBuilderNativeAssetUpload(sql, { uploadId, clientMutationId, builderUserId: actor });
      reference.assetId = await completeBuilderNativeAssetUpload(sql, { uploadId, builderUserId: actor, objectKey: `builder-native-assets/${identity.bookSlug}/${identity.componentSlug}/${activityId}/assets/${reference.checksumSha256}.${extension}`, storageBucket: "local-fixtures", mimeType, byteSize: 68, checksumSha256: reference.checksumSha256, ...dimensions });
      rows.push((await pool.query("select * from book_assets where id=$1", [reference.assetId])).rows[0]);
    }
    pair.publicDocument = normalizeNativeRuntimePublicDocument(pair.publicDocument, { activityId, kind });
    const existing = (await pool.query("select document_type,revision from builder_component_documents where document_key=$1", [activityId])).rows;
    const input = { ...pair, expectedPublicRevision: Number(existing.find((entry) => entry.document_type === "native_activity_public").revision), expectedTeacherRevision: Number(existing.find((entry) => entry.document_type === "native_activity_teacher").revision), clientMutationId: randomUUID() };
    const response = await handler(event(`activities/${activityId}/save`, input));
    assert.equal(response.statusCode, 200, response.body);
    const saved = (await pool.query("select document_type,payload from builder_component_documents where document_key=$1", [activityId])).rows;
    const pub = saved.find((entry) => entry.document_type === "native_activity_public").payload;
    const teacher = saved.find((entry) => entry.document_type === "native_activity_teacher").payload;
    assert.deepEqual(pub, pair.publicDocument); assert.deepEqual(teacher, normalizeNativeRuntimeTeacherDocument(pair.teacherDocument, { activityId, kind, publicDocument: pub }));
    normalizeNativeRuntimePublicDocument(pub, { activityId, kind });
    normalizeNativeRuntimeTeacherDocument(teacher, { activityId, kind, publicDocument: pub });
    const manifest = validateNativePublicationAssetRows([[activityId, { publicDocument: pub, teacherDocument: teacher }]], rows);
    assert.equal(manifest.length, kind === "drag-drop" ? 5 : 2);
    const invalidRows = rows.map((row) => row.source_metadata.asset_slot === (kind === "drag-drop" ? "item" : "graphic") ? { ...row, mime_type: "audio/mpeg", file_extension: "mp3" } : row);
    assert.throws(() => validateNativePublicationAssetRows([[activityId, { publicDocument: pub, teacherDocument: teacher }]], invalidRows));
    assert.doesNotMatch(JSON.stringify(pub), /correctTargetIds|correctWordIds|isCorrect/);
    assert.equal((await handler(event(`activities/${activityId}/save`, { ...input, clientMutationId: randomUUID() }))).statusCode, 409);
  }
}
