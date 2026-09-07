import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { materializeCanonicalReleaseAssets, canonicalPublicationAssetFetcher } from "../netlify-sites/ultimate-b2-builder/server/_builder-canonical-release-assets.js";
import { deliverCanonicalReleasePageAsset } from "../netlify-sites/ultimate-b2-builder/server/_canonical-release-page-delivery.js";
import { CloudflareR2ReleaseStorage } from "../lib/book-assets/cloudflare-r2-release-storage.js";
import { componentPublicationAssetStorageTarget } from "../lib/book-assets/publication-asset-storage.js";

async function fixture() {
  const bytes = new Uint8Array(await sharp({ create: { width: 24, height: 32, channels: 3, background: "blue" } }).png().toBuffer());
  const descriptor = { sha256: createHash("sha256").update(bytes).digest("hex"), extension: "png", mediaType: "image/png", role: "canonical_page_image" };
  const bookSlug = "ultimate-b2", componentSlug = "ultimate-b2-students-book", pageId = "ub2-sb-unit-3-part-1";
  const source = { descriptor, pageId, path: `/page-library/${bookSlug}/${componentSlug}/${pageId}.png`, byteSize: bytes.length, width: 24, height: 32 };
  const publicProjection = { bookSlug, componentSlug, pages: [{ id: pageId, origin: "canonical", image: { ...descriptor, byteSize: bytes.length, width: 24, height: 32 } }] };
  const objects = new Map(); const calls = [];
  const binding = {
    async head(key) { return objects.get(key)?.metadata || null; },
    async put(key, body, options) {
      calls.push({ key, options }); assert.deepEqual(options.onlyIf, { etagDoesNotMatch: "*" });
      if (objects.has(key)) return null;
      objects.set(key, { bytes: new Uint8Array(body), metadata: { size: body.byteLength, customMetadata: options.customMetadata, httpMetadata: options.httpMetadata, etag: "synthetic" } });
      return objects.get(key).metadata;
    },
    async get(key) {
      const object = objects.get(key); if (!object) return null;
      return { ...object.metadata, body: new Response(object.bytes).body, arrayBuffer: async () => object.bytes.slice().buffer };
    },
  };
  const storage = new CloudflareR2ReleaseStorage({ binding, privateBucket: "synthetic-private" });
  const input = { bookSlug, componentSlug, canonicalAssetSources: [source], assetManifest: [descriptor], publicProjection, fetchAsset: async (path) => { assert.equal(path, source.path); return new Response(bytes, { headers: { "Content-Type": "image/png" } }); } };
  const objectKey = componentPublicationAssetStorageTarget({ bookSlug, componentSlug, ...descriptor }).objectKey;
  return { bytes, descriptor, source, objects, calls, binding, storage, input, objectKey };
}

test("canonical release materialization verifies exact bytes, stores create-only private copies and preserves historical delivery", async () => {
  const f = await fixture();
  await materializeCanonicalReleaseAssets(f.storage, f.input);
  const saved = f.objects.get(f.objectKey); const before = saved.bytes.slice();
  await materializeCanonicalReleaseAssets(f.storage, f.input);
  assert.equal(f.objects.size, 1); assert.deepEqual(saved.bytes, before);
  f.input.fetchAsset = async () => new Response("latest page is different", { headers: { "Content-Type": "image/png" } });
  const response = await deliverCanonicalReleasePageAsset({ projection: f.input.publicProjection, asset: f.descriptor, binding: f.binding });
  assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), f.bytes);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Cross-Origin-Resource-Policy"), "same-origin");
  const head = await deliverCanonicalReleasePageAsset({ projection: f.input.publicProjection, asset: f.descriptor, binding: f.binding, method: "HEAD" });
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
  assert.equal(head.headers.get("Content-Length"), String(f.bytes.length));
});

test("canonical release bytes fail closed for SPA/html, redirects, wrong size/hash and forged manifest/scope", async () => {
  for (const response of [new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }), new Response(null, { status: 302, headers: { Location: "https://foreign.invalid" } }), new Response(new Uint8Array(3), { headers: { "Content-Type": "image/png" } })]) {
    const f = await fixture(); f.input.fetchAsset = async () => response;
    await assert.rejects(materializeCanonicalReleaseAssets(f.storage, f.input)); assert.equal(f.calls.length, 0);
  }
  for (const mutate of [(f) => { f.input.componentSlug = "ultimate-b2-workbook"; }, (f) => { f.source.path = "https://foreign.invalid/secret"; }, (f) => { f.source.width++; }, (f) => { f.input.assetManifest = []; }]) {
    const f = await fixture(); mutate(f);
    f.input.fetchAsset = async () => assert.fail("Invalid sources must be rejected before fetching");
    await assert.rejects(materializeCanonicalReleaseAssets(f.storage, f.input)); assert.equal(f.calls.length, 0);
  }
});

test("an existing corrupt immutable image is never repaired/replaced and cannot be delivered", async () => {
  const f = await fixture(); await materializeCanonicalReleaseAssets(f.storage, f.input);
  const object = f.objects.get(f.objectKey); object.bytes[25] ^= 1; const corrupt = object.bytes.slice();
  await assert.rejects(materializeCanonicalReleaseAssets(f.storage, f.input));
  assert.deepEqual(object.bytes, corrupt);
  const response = await deliverCanonicalReleasePageAsset({ projection: f.input.publicProjection, asset: f.descriptor, binding: f.binding });
  assert.equal(response.status, 409);
  assert.equal((await deliverCanonicalReleasePageAsset({ projection: f.input.publicProjection, asset: { ...f.descriptor, role: "native_teacher_answer" }, binding: f.binding })).status, 409);
});

test("matching hashes cannot disguise forged raster dimensions or malformed image structures", async () => {
  const f = await fixture();
  f.source.width++; f.input.publicProjection.pages[0].image.width++;
  await assert.rejects(materializeCanonicalReleaseAssets(f.storage, f.input));
  assert.equal(f.calls.length, 0);
  const malformed = await fixture();
  malformed.bytes[25] ^= 1;
  malformed.descriptor.sha256 = createHash("sha256").update(malformed.bytes).digest("hex");
  malformed.input.publicProjection.pages[0].image.sha256 = malformed.descriptor.sha256;
  await assert.rejects(materializeCanonicalReleaseAssets(malformed.storage, malformed.input));
  assert.equal(malformed.calls.length, 0);
});

test("canonical fetch uses a server binding or trusted deployment URL, never request headers or authored origins", async () => {
  let url;
  const fetchAsset = canonicalPublicationAssetFetcher({ cloudflare: { staticAssets: { fetch: async (request) => { url = request.url; return new Response("synthetic"); } } } });
  await fetchAsset("/page-library/synthetic.png");
  assert.equal(url, "https://builder-assets.invalid/page-library/synthetic.png");
  for (const deployment of ["", "http://example.test", "https://user:password@example.test", "https://example.test/foreign", "https://example.test/?key=x"]) assert.throws(() => canonicalPublicationAssetFetcher({}, deployment));
});
