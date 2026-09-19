import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { contentEdition } from "../src/data/contentEditions.js";
import { editionFixtureInput } from "./fixtures/content-editions.js";
import { createEmptyHostedTeacherUiDocument } from "../src/data/ultimate-b2/hostedTeacherUiDocument.js";
import { builderDocumentSha256 } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { freezeEditionSource, prepareEditionRelease, verifyEditionRelease } from "../netlify-sites/ultimate-b2-builder/server/_builder-edition-domain.js";
import { editionClassroomUiRead } from "../netlify-sites/ultimate-b2-builder/server/_builder-editions.js";
import { WordListR2Storage } from "../lib/book-assets/wordlist-storage.js";
import { componentPublicationAssetStorageTarget } from "../lib/book-assets/publication-asset-storage.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFgAI/ScL4WQAAAABJRU5ErkJggg==", "base64");
const sha = createHash("sha256").update(png).digest("hex");
test("classroom UI reads all three frozen SB-owned artwork states for WB without exposing Teacher solutions", async () => {
  const source = editionFixtureInput("students-book");
  const document = structuredClone(createEmptyHostedTeacherUiDocument());
  for (const state of ["active", "disabled", "pressed"]) document.assets[`navibar.vocabulary.${state}`] = {
    sha256: sha, extension: "png", mediaType: "image/png", sizeBytes: png.length, width: 1, height: 1, originalFilename: `${state}.png`,
  };
  source.inputs.documents.teacherUi = { payload: document, revision: 1, sha256: builderDocumentSha256(document) };
  const sources = [source, editionFixtureInput("workbook"), editionFixtureInput("grammar-book", "greek")].map(freezeEditionSource);
  const release = prepareEditionRelease({ id: randomUUID(), number: 1, edition: contentEdition("ultimate-b2", "greek"), sources });
  const original = JSON.stringify(release); const owner = sources[0].reference;
  const result = JSON.parse((await editionClassroomUiRead(release, { componentSlug: "ultimate-b2-workbook" })).body);
  assert.deepEqual(result.ownerSource, owner); assert.equal(result.ui.assets["navibar.vocabulary.active"].sha256, sha);
  assert(!JSON.stringify(result).includes("nativeActivities")); assert(!JSON.stringify(result).includes("solutions"));
  const target = componentPublicationAssetStorageTarget({ bookSlug: owner.bookSlug, componentSlug: owner.componentSlug, role: "teacher_ui", sha256: sha, extension: "png" });
  const storage = { async download(reference) { assert.deepEqual(reference, target); return png; } };
  for (const state of ["active", "disabled", "pressed"]) {
    const response = await editionClassroomUiRead(release, { componentSlug: "ultimate-b2-workbook", uiBindingId: `navibar.vocabulary.${state}`, uiOwnerSha256: owner.sha256 }, storage);
    assert.equal(response.statusCode, 200); assert.deepEqual(Buffer.from(response.body, "base64"), png);
  }
  await assert.rejects(editionClassroomUiRead(release, { uiBindingId: "navibar.vocabulary.active", uiOwnerSha256: "f".repeat(64) }, storage), /owner_changed/);
  await assert.rejects(editionClassroomUiRead(release, { uiBindingId: "navibar.vocabulary.active" }, { async download() { return Buffer.alloc(png.length); } }), /integrity/);
  assert.equal((await editionClassroomUiRead(release, { uiBindingId: "undeclared-secret" }, storage)).statusCode, 404);
  document.assets["navibar.vocabulary.active"].sha256 = "f".repeat(64);
  assert.equal(JSON.stringify(verifyEditionRelease(release)), original, "Later draft replacements cannot change the frozen release");
});
test("Worker UI adapter is read-only and rejects foreign namespaces, absent or oversized bytes", async () => {
  const target = componentPublicationAssetStorageTarget({ bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", role: "teacher_ui", sha256: sha, extension: "png" });
  const options = { binding: { async head() {} }, privateBucket: "isolated-wordlists", publicUiBinding: { async get() { return { size: png.length, body: new Response(png).body }; } } };
  assert.deepEqual(await new WordListR2Storage(options).download(target), png);
  for (const objectKey of [target.objectKey.replace("ultimate-b2-students-book", "ultimate-b2-workbook"), "arbitrary-private-key", target.objectKey.replace(sha, "..")] ) {
    await assert.rejects(new WordListR2Storage(options).download({ profile: "public", objectKey }), /scope/);
  }
  for (const object of [null, { size: 17 * 1024 * 1024, body: new Response(png).body }, { size: 1, body: new Response(png).body }]) {
    await assert.rejects(new WordListR2Storage({ ...options, publicUiBinding: { async get() { return object; } } }).download(target), /limit/);
  }
});
