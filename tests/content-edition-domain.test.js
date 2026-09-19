import assert from "node:assert/strict";
import test from "node:test";
import { contentEdition } from "../src/data/contentEditions.js";
import { builderDocumentSha256 } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { freezeEditionSource, verifyEditionRelease, editionReleasePublicEnvelope } from "../netlify-sites/ultimate-b2-builder/server/_builder-edition-domain.js";
import { editionFixtureInput, editionFixtureSources, editionFixtureRelease } from "./fixtures/content-editions.js";

test("versioned edition compositions freeze shared sources and distinct localized image geometry", () => {
  const international = editionFixtureRelease("international");
  const greek = editionFixtureRelease("greek");
  assert.deepEqual(international.composition.members.slice(0, 2), greek.composition.members.slice(0, 2));
  assert.notEqual(international.compositionSha256, greek.compositionSha256);
  assert.notEqual(international.releaseSha256, greek.releaseSha256);
  assert.equal(international.members[2].content.publicProjection.pages[0].image.width, 1);
  assert.equal(greek.members[2].content.publicProjection.pages[0].image.width, 2);
  assert.deepEqual(verifyEditionRelease(greek, contentEdition("ultimate-b2", "greek")), greek);
  assert.throws(() => verifyEditionRelease(greek, contentEdition("ultimate-b2", "international")), { code: "edition_release_context_mismatch" });
});
test("shared and edition-only edits create new source revisions without changing old release bytes", () => {
  const sources = editionFixtureSources("greek");
  const release = editionFixtureRelease("greek", sources);
  const before = JSON.stringify(release);
  const sharedEdit = editionFixtureInput("workbook", "shared", 2);
  sharedEdit.inputs.pages.rows[0].label = "Future candidates only";
  const futureShared = freezeEditionSource(sharedEdit);
  assert.notEqual(futureShared.reference.sha256, sources[1].reference.sha256);
  const localizedEdit = editionFixtureInput("grammar-book", "greek", 2);
  localizedEdit.inputs.pages.rows[0].label = "Greek-only revised geometry";
  const future = editionFixtureRelease("greek", [sources[0], futureShared, freezeEditionSource(localizedEdit)]);
  assert.notEqual(future.releaseSha256, release.releaseSha256);
  assert.equal(JSON.stringify(verifyEditionRelease(release)), before);
  assert.equal(editionFixtureRelease("international").members[2].source.revision, 1);
});
test("integrity rejects changed source revisions, localized replay and substituted content", () => {
  const original = editionFixtureRelease("greek");
  for (const tamper of [
    (value) => { value.composition.edition.editionId = "international"; },
    (value) => { value.composition.members[1].revision++; },
    (value) => { value.members[2].source.inputs.pages.rows[0].width = 900; },
    (value) => { value.members[2].content.publicProjection.pages[0].image.width = 900; },
    (value) => { value.members[2] = editionFixtureSources("international")[2]; },
  ]) { const candidate = structuredClone(original); tamper(candidate); assert.throws(() => verifyEditionRelease(candidate)); }
  const sources = editionFixtureSources("international");
  sources[2] = original.members[2];
  assert.throws(() => editionFixtureRelease("international", sources), { code: "edition_source_owner_mismatch" });
  assert.throws(() => editionFixtureRelease("greek", sources.slice(0, 2)), { code: "edition_required_sources_missing" });
});
test("public edition projection excludes private input snapshots and Teacher documents", () => {
  const release = editionFixtureRelease("greek");
  const projection = editionReleasePublicEnvelope(release);
  assert.equal(JSON.stringify(projection).includes("PHASE_5_PRIVATE_TEACHER_SENTINEL"), false);
  assert.equal(JSON.stringify(projection).includes('"teacherProjection"'), false);
  assert.equal(JSON.stringify(projection).includes('"inputs"'), false);
  assert.equal(projection.releaseSha256, release.releaseSha256);
  assert.equal(builderDocumentSha256(projection), builderDocumentSha256(editionReleasePublicEnvelope(release)));
});
