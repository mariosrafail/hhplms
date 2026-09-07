import assert from "node:assert/strict";
import test from "node:test";

import artifact from "./fixtures/historical-v1-pre-video-worksheet-release.json" with { type: "json" };
import { builderDocumentSha256, stableBuilderJson } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { compileUltimateB2ComponentRelease, ultimateB2PublicationCompatibility, ultimateB2PublicationCompatibilityBeforeVideoWorksheetBinding } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler.js";
import { ReleaseCompatibilityVariantError, ReleaseIntegrityError, verifyImmutableComponentRelease } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";

// Emitted and verified by 6a7e3e60, before the videoWorksheet binding existed.
// See fixtures/historical-v1-pre-video-worksheet.md; never refresh with current code.
const historicalCompatibility = "0864cd57203cf9f9bb5a3faef64d767ac150f701290b1a1e82d9fc8b684d0ef2";
const historicalReleaseHash = "7a024dd8d6be028bce8bbfb1345e4ad07da0258eaca307971d42dc06a8516c44";
const historical = () => structuredClone(artifact);
const aggregate = (row) => builderDocumentSha256({ compatibility: row.runtime_compatibility_sha256, sourceSnapshot: row.source_snapshot, publicProjection: row.public_projection, teacherProjection: row.teacher_projection });

test("frozen v1 fixture and independent historical reconstruction retain their original identities", () => {
  assert.equal(builderDocumentSha256(artifact), "9bfa4fcae11cb38b7f9b0e7b7e49b58ec15a0e6df2cfe7cfa5ac55570bafee9e");
  assert.equal(artifact.runtime_compatibility_sha256, historicalCompatibility);
  assert.equal(artifact.public_projection.compatibility, historicalCompatibility);
  assert.equal(ultimateB2PublicationCompatibilityBeforeVideoWorksheetBinding(), historicalCompatibility);
  assert.notEqual(ultimateB2PublicationCompatibility(), historicalCompatibility);
  assert.equal(aggregate(artifact), historicalReleaseHash);
});

test("new v1 compilation remains current-only and verifies without modifying input", () => {
  const compiled = compileUltimateB2ComponentRelease();
  const row = { compiler_id: compiled.compilerId, release_schema_version: compiled.sourceSnapshot.schemaVersion, runtime_compatibility_sha256: compiled.compatibility, source_snapshot: compiled.sourceSnapshot, source_snapshot_sha256: compiled.sourceSnapshotSha256, public_projection: compiled.publicProjection, public_projection_sha256: compiled.publicProjectionSha256, teacher_projection: compiled.teacherProjection, teacher_projection_sha256: compiled.teacherProjectionSha256, asset_manifest: compiled.assetManifest, release_sha256: compiled.releaseSha256 };
  const before = stableBuilderJson(row);
  assert.equal(compiled.compatibility, ultimateB2PublicationCompatibility());
  assert.equal(compiled.publicProjection.compatibility, compiled.compatibility);
  assert.equal(verifyImmutableComponentRelease(row).compatibility, compiled.compatibility);
  assert.equal(stableBuilderJson(row), before);
});

test("historical v1 verification preserves all canonical documents and the historical aggregate", () => {
  const row = historical();
  const before = stableBuilderJson(row);
  const verified = verifyImmutableComponentRelease(row);
  assert.equal(verified.compatibility, historicalCompatibility);
  for (const [normalized, stored, checksum] of [["sourceSnapshot", "source_snapshot", "source_snapshot_sha256"], ["publicProjection", "public_projection", "public_projection_sha256"], ["teacherProjection", "teacher_projection", "teacher_projection_sha256"]]) {
    assert.equal(stableBuilderJson(verified[normalized]), stableBuilderJson(row[stored]));
    assert.equal(builderDocumentSha256(verified[normalized]), row[checksum]);
  }
  assert.equal(builderDocumentSha256({ compatibility: verified.compatibility, sourceSnapshot: verified.sourceSnapshot, publicProjection: verified.publicProjection, teacherProjection: verified.teacherProjection }), historicalReleaseHash);
  assert.equal(row.release_sha256, historicalReleaseHash);
  assert.equal(stableBuilderJson(row), before);
});

test("unknown v1 compatibility fails closed even with self-consistent forged hashes", () => {
  const row = historical();
  row.runtime_compatibility_sha256 = row.public_projection.compatibility = "f".repeat(64);
  row.public_projection_sha256 = builderDocumentSha256(row.public_projection);
  row.release_sha256 = aggregate(row);
  assert.throws(() => verifyImmutableComponentRelease(row), ReleaseCompatibilityVariantError);
});

for (const [name, change, expected] of [
  ["source snapshot", (row) => { row.source_snapshot.hotspots.revision++; }, "sourceSnapshotMatches"],
  ["public projection", (row) => { Object.values(row.public_projection.activities)[0].authoring.questions[0].prompt = "Altered public prompt"; }, "publicProjectionMatches"],
  ["Teacher projection", (row) => {
    const [activityId, entry] = Object.entries(row.public_projection.activities)[0];
    row.teacher_projection.solutions[activityId] = { schemaVersion: "1.0", activityId, answers: entry.authoring.questions.map((question) => ({ questionId: question.id, text: "Altered Teacher answer" })) };
  }, "teacherProjectionMatches"],
  ["aggregate hash", (row) => { row.release_sha256 = "0".repeat(64); }, "releaseHashMatches"],
]) test(`historical v1 rejects tampered ${name}`, () => {
  const row = historical(); change(row);
  assert.throws(() => verifyImmutableComponentRelease(row), (error) => {
    assert.ok(error instanceof ReleaseIntegrityError);
    assert.equal(error.integrityChecks.compatibilityMatches, true);
    assert.equal(error.integrityChecks[expected], false);
    assert.equal(error.integrityChecks.releaseHashMatches, false);
    return true;
  });
});

test("historical v1 rejects an asset manifest that disagrees with the projections", () => {
  const row = historical();
  row.asset_manifest.push({ sha256: "a".repeat(64), extension: "png", mediaType: "image/png", role: "teacher_ui" });
  assert.throws(() => verifyImmutableComponentRelease(row), /release_integrity_failed/);
});

for (const runtimeIsHistorical of [true, false]) test(`v1 rejects rehashed embedded compatibility mismatch (historical runtime: ${runtimeIsHistorical})`, () => {
  const row = historical();
  row.runtime_compatibility_sha256 = runtimeIsHistorical ? historicalCompatibility : ultimateB2PublicationCompatibility();
  row.public_projection.compatibility = runtimeIsHistorical ? ultimateB2PublicationCompatibility() : historicalCompatibility;
  row.public_projection_sha256 = builderDocumentSha256(row.public_projection);
  row.release_sha256 = aggregate(row);
  assert.throws(() => verifyImmutableComponentRelease(row), /release_integrity_failed/);
});

test("historical v1 cannot bypass compiler or release schema boundaries", () => {
  for (const changes of [{ compiler_id: "unknown-v1" }, { release_schema_version: "2.0" }]) {
    assert.throws(() => verifyImmutableComponentRelease({ ...historical(), ...changes }), /publication_compiler_mismatch/);
  }
});
