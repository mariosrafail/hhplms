import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { managedPageRouteIds, publishedManagedBookFixture, publishedManagedBookSources } from "./fixtures/published-managed-book.js";
import { publishedManagedUiFixture, componentReleaseRow as row } from "./fixtures/published-managed-ui.js";
import { compileManagedUiReleaseV2 } from "../netlify-sites/ultimate-b2-builder/server/_builder-managed-ui-publication-compiler.js";
import { verifyImmutableComponentRelease, resolvePublicationCompiler } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { builderDocumentSha256 as hash } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { verifyProductReleaseEnvelope, productReleaseMemberSha256, productReleaseSourceSha256, productReleaseSha256 } from "../netlify-sites/ultimate-b2-builder/server/_builder-product-publication-domain.js";
import { findPublicationProduct } from "../src/data/publicationRegistry.js";
import { componentPublicationAssetStorageTarget as target } from "../lib/book-assets/publication-asset-storage.js";
import { verifyManagedPublicationUiAssets } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-ui-assets.js";

const golden = JSON.parse(await readFile(new URL("./fixtures/b1-publication-v1.json", import.meta.url), "utf8"));
const refresh = (c) => ({ ...c, sourceSnapshotSha256: hash(c.sourceSnapshot), publicProjectionSha256: hash(c.publicProjection), teacherProjectionSha256: hash(c.teacherProjection),
  releaseSha256: hash({ compatibility: c.compatibility, sourceSnapshot: c.sourceSnapshot, publicProjection: c.publicProjection, teacherProjection: c.teacherProjection }) });

for (const book of ["ultimate-b1", "ultimate-b1-plus"]) {
  test(`${book} preserves exact pre-v2 historical component and product fixtures`, async () => {
    for (const suffix of ["students-book", "workbook"]) {
      const slug = `${book}-${suffix}`;
      const { nativeAssetSources, ...actual } = publishedManagedBookFixture(slug, { pageIds: await managedPageRouteIds(slug) });
      assert.deepEqual(actual, golden.components[slug], "Every durable field and historical hash must remain identical");
      verifyImmutableComponentRelease(row(golden.components[slug]));
      assert.equal(Object.hasOwn(actual.teacherProjection, "ui"), false);
      for (const field of ["teacherProjection", "sourceSnapshot"]) {
        const forged = structuredClone(actual); forged[field][field === "teacherProjection" ? "ui" : "teacherUi"] = {};
        assert.throws(() => verifyImmutableComponentRelease(row(refresh(forged))));
      }
    }
    assert.deepEqual(verifyProductReleaseEnvelope(golden.products[book]), golden.products[book]);
  });

  test(`${book} freezes graphics and all interface sounds, isolates namespaces and rejects forged durable state`, async () => {
    const slug = `${book}-students-book`, ui = await publishedManagedUiFixture(slug);
    const sources = publishedManagedBookSources(slug, { pageIds: await managedPageRouteIds(slug) });
    sources.documents.teacherUi = ui;
    const compiled = compileManagedUiReleaseV2(sources, slug), frozen = structuredClone(compiled);
    assert.equal(compiled.compilerId, `${slug}-v2`); assert.equal(compiled.releaseSchemaVersion, "2.0");
    assert.deepEqual(compiled.sourceSnapshot.teacherUi, { revision: 1, sha256: ui.sha256 });
    assert.equal(compiled.teacherProjection.ui.packageId, slug);
    assert.equal(compiled.assetManifest.filter((a) => a.role === "teacher_ui").length, 5, "Graphics deduplicate; four distinct sound bindings retain their identities");
    assert.equal(compiled.publicProjection.assets.some((a) => a.role === "teacher_ui"), false);
    for (const asset of Object.values(compiled.teacherProjection.ui.assets)) assert.equal(Object.hasOwn(asset, "originalFilename"), false);
    verifyImmutableComponentRelease(row(compiled));
    assert.equal(resolvePublicationCompiler(compiled.compilerId, "1.0"), null);
    const storage = { head: async ({ objectKey }) => ui.heads.get(objectKey) };
    await verifyManagedPublicationUiAssets(storage, compiled, { bookSlug: book, componentSlug: slug });
    const privateStorage = { head() { throw new Error("Public UI must not inspect private storage"); } };
    await verifyManagedPublicationUiAssets(privateStorage, compiled, { bookSlug: book, componentSlug: slug }, { publicUiAssets: { head: async (key) => {
      const head = ui.heads.get(key); return head && { size: head.byteSize, customMetadata: { sha256: head.checksumSha256 }, httpMetadata: { contentType: head.contentType } };
    } } });
    await assert.rejects(verifyManagedPublicationUiAssets(privateStorage, compiled, { bookSlug: book, componentSlug: slug }, {}));
    for (const change of [() => undefined, (h) => ({ ...h, contentType: "audio/mpeg" }), (h) => ({ ...h, checksumSha256: "0".repeat(64) }), (h) => ({ ...h, byteSize: h.byteSize + 1 })]) {
      await assert.rejects(verifyManagedPublicationUiAssets({ head: async (input) => change(await storage.head(input)) }, compiled, { bookSlug: book, componentSlug: slug }));
    }
    for (const mutate of [
      (c) => { c.teacherProjection.ui.packageId = "ultimate-b2-students-book"; },
      (c) => { c.teacherProjection.ui.assets["sound.correct"].mediaType = "audio/mpeg"; },
      (c) => { c.teacherProjection.ui.assets["sound.correct"].sha256 = "invalid"; },
      (c) => { c.teacherProjection.ui.assets["sound.correct"].sizeBytes = 0; },
      (c) => { c.teacherProjection.ui.previewAuthorization = "forged"; },
      (c) => { c.assetManifest.pop(); },
      (c) => { c.assetManifest.push({ ...c.assetManifest[0] }); },
      (c) => { c.publicProjection.assets.push(c.assetManifest.find((a) => a.role === "teacher_ui")); },
      (c) => { c.sourceSnapshot.teacherUi.revision = 0; },
      (c) => { delete c.publicProjection.activityOrder; },
    ]) { const c = structuredClone(compiled); mutate(c); assert.throws(() => verifyImmutableComponentRelease(row(refresh(c)))); }
    sources.documents.teacherUi = { ...await publishedManagedUiFixture(slug, 1), revision: 2 };
    const changed = compileManagedUiReleaseV2(sources, slug);
    assert.notEqual(changed.sourceSnapshotSha256, compiled.sourceSnapshotSha256); assert.notEqual(changed.releaseSha256, compiled.releaseSha256);
    assert.deepEqual(compiled, frozen); verifyImmutableComponentRelease(row(compiled));
    sources.documents.teacherUi = null;
    const empty = compileManagedUiReleaseV2(sources, slug); assert.equal(empty.sourceSnapshot.teacherUi.revision, 0);
    assert.deepEqual(empty.teacherProjection.ui.assets, {}); verifyImmutableComponentRelease(row(empty));
    const mp3 = structuredClone(ui); for (const [id, asset] of Object.entries(mp3.payload.assets)) if (id.startsWith("sound.")) { asset.extension = "mp3"; asset.mediaType = "audio/mpeg"; }
    mp3.sha256 = hash(mp3.payload); sources.documents.teacherUi = mp3;
    assert.ok(compileManagedUiReleaseV2(sources, slug).assetManifest.some((a) => a.extension === "mp3" && a.role === "teacher_ui"));
    const product = structuredClone(golden.products[book]); product.compilerId = findPublicationProduct(book).compilerId;
    Object.assign(product.members[0], { compilerId: compiled.compilerId, releaseSchemaVersion: compiled.releaseSchemaVersion, releaseSha256: compiled.releaseSha256, compatibility: compiled.compatibility });
    product.members[0].memberSha256 = productReleaseMemberSha256(product.members[0]);
    product.sourceSnapshotSha256 = productReleaseSourceSha256({ ...product, releaseNumber: product.number });
    product.releaseSha256 = productReleaseSha256({ ...product, releaseNumber: product.number }); verifyProductReleaseEnvelope(product);
    for (const forgedCompiler of [`${book}-product-v1`, "ultimate-b2-product-v1"]) assert.throws(() => verifyProductReleaseEnvelope({ ...product, compilerId: forgedCompiler }));
    const mixed = structuredClone(product); mixed.members[1].compilerId = `${book}-workbook-v2`; assert.throws(() => verifyProductReleaseEnvelope(mixed));
  });
}

test("same-checksum UI targets preserve book ownership and the historical B2 path", () => {
  const asset = { sha256: "a".repeat(64), extension: "wav", role: "teacher_ui" };
  const paths = ["ultimate-b1", "ultimate-b1-plus", "ultimate-b2"].map((bookSlug) => target({ bookSlug, componentSlug: `${bookSlug}-students-book`, ...asset }));
  assert.equal(new Set(paths.map((p) => p.objectKey)).size, 3);
  for (const [i, book] of ["ultimate-b1", "ultimate-b1-plus"].entries()) { assert.ok(paths[i].objectKey.includes(`books/${book}/`)); assert.ok(paths[i].publicPath.includes(`/books/${book}/components/${book}-students-book/`)); }
  assert.equal(paths[2].publicPath, `/preview/ui-assets-v2/${asset.sha256}.wav`);
});
