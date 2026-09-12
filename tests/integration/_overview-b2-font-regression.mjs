import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prepareBuilderFontUpload, claimBuilderFontUpload, completeBuilderFontUpload } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activity-store.js";
import { createBuilderTeacherUiAssetsHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-teacher-ui-assets.js";
import { collectStudentsBookPublicationV3Sources } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-sources-v3.js";
import { compileStudentsBookReleaseV3 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v3.js";
import { createComponentRelease, publishComponentRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-store.js";
import { verifyImmutableComponentRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";

export async function verifyB2OverviewFont({ pool, sql, actor }) {
  const bookSlug = "ultimate-b2", componentSlug = "ultimate-b2-students-book", uploadId = randomUUID(), clientMutationId = randomUUID();
  const checksumSha256 = "b719ecb31c5b21fc573c03f6421c74ac63c271a5a3ff841e34f9705fb94b8448";
  const input = { bookSlug, componentSlug, uploadId, clientMutationId, builderUserId: actor, requestSha256: "a".repeat(64), fileDescriptor: { name: "Ahem.ttf", size: 21768, type: "font/ttf", displayLabel: "Ahem" }, stagingObjectKey: `local-font/${uploadId}`, expiresAt: new Date(Date.now() + 600000).toISOString() };
  assert.equal((await prepareBuilderFontUpload(sql, input)).outcome, "prepared"); assert.equal((await claimBuilderFontUpload(sql, input)).outcome, "claimed");
  const assetId = await completeBuilderFontUpload(sql, { ...input, checksumSha256, objectKey: `builder-font-library/${bookSlug}/${componentSlug}/assets/${checksumSha256}.ttf`, storageBucket: "private-test", mimeType: "font/ttf", byteSize: 21768, displayLabel: "Ahem", originalFilename: "Ahem.ttf" });
  const document = { schemaVersion: "1.0", packageId: componentSlug, assets: {}, overviewCaptionFontAsset: { assetId, checksumSha256, role: "activity_font", slot: `font-${assetId.replaceAll("-", "")}` } };
  const handler = createBuilderTeacherUiAssetsHandler({ getDatabase: () => sql, authorize: async () => ({ builderUser: { id: actor } }) });
  const saved = await handler({ path: `/builder/api/ui-assets/books/${bookSlug}/components/${componentSlug}/save`, httpMethod: "POST", headers: { host: "builder.example", origin: "https://builder.example", "content-type": "application/json" }, body: JSON.stringify({ document, expectedRevision: 0, clientMutationId: randomUUID(), candidateUploadIds: [] }) });
  assert.equal(saved.statusCode, 200, saved.body);
  const sources = await collectStudentsBookPublicationV3Sources(sql), compiled = compileStudentsBookReleaseV3(sources);
  assert.equal(compiled.publicProjection.assets.some((asset) => asset.sha256 === checksumSha256), false);
  assert.equal(compiled.nativeAssetSources.filter((entry) => entry.descriptor.sha256 === checksumSha256).length, 1);
  const created = await createComponentRelease(sql, { ...compiled, bookSlug, componentSlug, requestSha256: compiled.releaseSha256, releaseNote: "B2 managed overview font", clientMutationId: randomUUID(), builderUserId: actor });
  assert.equal(created.outcome, "created");
  const row = (await pool.query("select * from book_component_releases where id=$1", [created.releaseId])).rows[0]; verifyImmutableComponentRelease(row);
  const revision = Number((await pool.query("select head_revision from book_component_publication_heads where book_component_id=$1", [row.book_component_id])).rows[0]?.head_revision || 0);
  const published = await publishComponentRelease(sql, { bookSlug, componentSlug, releaseId: created.releaseId, expectedHeadRevision: revision, requestSha256: "c".repeat(64), builderUserId: actor, clientMutationId: randomUUID() });
  assert.equal(published.outcome, "published");
  assert.deepEqual(row.teacher_projection.ui.overviewCaptionFontAsset, document.overviewCaptionFontAsset);
}
