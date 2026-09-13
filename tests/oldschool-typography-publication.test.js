import assert from "node:assert/strict";
import test from "node:test";
import { createPublicationV2FixtureSources } from "./fixtures/publication-v2.js";
import { appendOldschoolTypographyPublication, enrichedOldschoolTypographyPair, oldschoolTypographyAssetRows } from "./fixtures/oldschool-typography-publication.js";
import { compileUltimateB2ComponentReleaseV2, validateNativePublicationAssetRows } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { freezeComponentPublicationAssetPins } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-pins.js";
import { normalizeNativeRuntimePublicDocument } from "../src/data/native-activities/nativeActivityRuntimeValidation.js";

test("immutable compilation preserves transcript styles, private answers and exact managed font dependencies", async () => {
  const pair = enrichedOldschoolTypographyPair(); const id = pair.publicDocument.activityId;
  const compiled = compileUltimateB2ComponentReleaseV2(appendOldschoolTypographyPublication(createPublicationV2FixtureSources(), pair));
  const frozen = compiled.publicProjection.nativeActivities[id].document;
  assert.deepEqual(frozen.parts[0].interaction.cues, pair.publicDocument.parts[0].interaction.cues);
  assert.deepEqual(normalizeNativeRuntimePublicDocument(frozen, { activityId: id, kind: "oldschool-listening" }), frozen);
  assert.doesNotMatch(JSON.stringify(compiled.publicProjection), /SYNTHETIC_PRIVATE_TRANSCRIPT_ANSWER/);
  assert.match(JSON.stringify(compiled.teacherProjection), /SYNTHETIC_PRIVATE_TRANSCRIPT_ANSWER/);
  const font = compiled.nativeAssetSources.find((source) => source.descriptor.role === "activity_font");
  assert.ok(font); assert.ok(compiled.assetManifest.some((entry) => entry.sha256 === font.descriptor.sha256));
  const storage = { bucket: () => "local-fixtures", head: async () => ({ checksumSha256: font.row.checksum_sha256, byteSize: font.row.byte_size, contentType: font.row.mime_type }) };
  const args = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", assetManifest: [font.descriptor], nativeAssetSources: [font] };
  const pins = await freezeComponentPublicationAssetPins(storage, args);
  assert.equal(pins[0].assetId, font.row.id); assert.equal(pins[0].checksumSha256, font.row.checksum_sha256);
  await assert.rejects(freezeComponentPublicationAssetPins({ ...storage, head: async () => ({ checksumSha256: "0".repeat(64), byteSize: font.row.byte_size, contentType: "font/ttf" }) }, args));
  for (const patch of [{ asset_role: "activity_artwork" }, { source_metadata: { native_activity_id: "foreign" } }, { checksum_sha256: "0".repeat(64) }, { mime_type: "audio/mpeg" }]) {
    const rows = oldschoolTypographyAssetRows(pair).map((row) => row.id === font.row.id ? { ...row, ...patch } : row);
    assert.throws(() => validateNativePublicationAssetRows([[id, pair]], rows));
  }
  const original = JSON.stringify(frozen); pair.publicDocument.parts[0].interaction.cues[0].highlightRegions[0].typography.fontSize = 50;
  assert.equal(JSON.stringify(frozen), original, "immutable projection never consults a changed draft");
  const baseline = createPublicationV2FixtureSources();
  assert.deepEqual(compileUltimateB2ComponentReleaseV2(baseline), compileUltimateB2ComponentReleaseV2(structuredClone(baseline)), "legacy documents remain deterministic");
});
