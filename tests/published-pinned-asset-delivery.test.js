import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { publishedManagedBookFixture, publishedManagedPageBytes } from "./fixtures/published-managed-book.js";
import { publicationAssetPinFingerprint } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-pins.js";
import { componentPublicationCanonicalPrivateSourceObjectKey } from "../lib/book-assets/publication-asset-storage.js";
import { deliverPublishedPinnedAsset } from "../netlify/functions/_book-content/published-pinned-asset-delivery.js";
import { normalizePublishedBookLocator } from "../netlify/functions/_book-content/published-book-model.js";
import { verifiedPublicAssetPin } from "../netlify/functions/_book-content/published-asset-pin.js";

function fixture() {
  const { publicProjection: projection } = publishedManagedBookFixture();
  const row = { id: "10000000-0000-4000-8000-000000000099" };
  const asset = projection.assets.find((asset) => asset.role === "managed_page_image");
  const objectKey = componentPublicationCanonicalPrivateSourceObjectKey({ bookSlug: projection.bookSlug, componentSlug: projection.componentSlug, descriptor: asset, row: { source_metadata: { publication_page_id: "wb-page-1" } } });
  const pin = { component_release_id: row.id, book_asset_id: "30000000-0000-4000-8000-000000000001", asset_role: asset.role, source_asset_role: "page_image", checksum_sha256: asset.sha256, extension: asset.extension, media_type: asset.mediaType, byte_size: publishedManagedPageBytes.length, storage_profile: "private", storage_bucket: "private-assets", object_key: objectKey, source_owner_key: "wb-page-1", source_asset_slot: "page-image" };
  pin.pin_sha256 = createHash("sha256").update(publicationAssetPinFingerprint({ assetId: pin.book_asset_id, role: pin.asset_role, sourceAssetRole: pin.source_asset_role, checksumSha256: pin.checksum_sha256, extension: pin.extension, mediaType: pin.media_type, byteSize: pin.byte_size, storageProfile: pin.storage_profile, storageBucket: pin.storage_bucket, objectKey: pin.object_key, ownerKey: pin.source_owner_key, assetSlot: pin.source_asset_slot })).digest("hex");
  const calls = [];
  const storage = {
    bucket: () => "private-assets",
    head: async () => { calls.push("HEAD"); return { checksumSha256: asset.sha256, byteSize: pin.byte_size, contentType: asset.mediaType }; },
    openReadStream: async ({ objectKey: key, range }) => {
      assert.equal(key, objectKey);
      calls.push("GET");
      const bytes = range ? publishedManagedPageBytes.subarray(range.offset, range.offset + range.length) : publishedManagedPageBytes;
      return { byteSize: bytes.length, checksumSha256: asset.sha256, contentType: asset.mediaType, contentRange: range ? `bytes ${range.offset}-${range.offset + range.length - 1}/${pin.byte_size}` : null, body: new Response(bytes).body };
    },
  };
  const query = { bookSlug: projection.bookSlug, componentSlug: projection.componentSlug, releaseId: row.id, sha256: asset.sha256, extension: asset.extension };
  return { pin, calls, storage, deliver: (options = {}) => deliverPublishedPinnedAsset(async () => [pin], query, { row, projection, asset, storage, method: "GET", ...options }) };
}

test("font pins retain their exact released source paths without accepting foreign or arbitrary paths", () => {
  const row = { id: "10000000-0000-4000-8000-000000000099" };
  const projection = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-workbook" };
  const asset = { sha256: "a".repeat(64), extension: "ttf", mediaType: "font/ttf", role: "activity_font" };
  const canonical = `builder-font-library/ultimate-b2/ultimate-b2-workbook/assets/${asset.sha256}.ttf`;
  const historical = `builder-font-library/ultimate-b2/ultimate-b2-workbook/${asset.sha256}.ttf`;
  const sign = (objectKey) => {
    const pin = { component_release_id: row.id, book_asset_id: "30000000-0000-4000-8000-000000000001", asset_role: asset.role, source_asset_role: asset.role, checksum_sha256: asset.sha256, extension: "ttf", media_type: "font/ttf", byte_size: 1234, storage_profile: "private", storage_bucket: "private-assets", object_key: objectKey, source_owner_key: "component", source_asset_slot: "" };
    pin.pin_sha256 = createHash("sha256").update(publicationAssetPinFingerprint({ assetId: pin.book_asset_id, role: pin.asset_role, sourceAssetRole: pin.source_asset_role, checksumSha256: pin.checksum_sha256, byteSize: pin.byte_size, mediaType: pin.media_type, extension: pin.extension, storageProfile: pin.storage_profile, storageBucket: pin.storage_bucket, objectKey, ownerKey: pin.source_owner_key, assetSlot: "" })).digest("hex");
    return pin;
  };
  for (const key of [canonical, historical]) assert.equal(verifiedPublicAssetPin({ row, projection, asset, pin: sign(key) }), key);
  for (const key of [canonical.replace("workbook", "grammar-book"), historical.replace(asset.sha256, "b".repeat(64)), `arbitrary/${asset.sha256}.ttf`, canonical.replace("assets/", "assets/../")]) {
    assert.throws(() => verifiedPublicAssetPin({ row, projection, asset, pin: sign(key) }), /release_pin_integrity_failed/);
  }
  const corrupt = sign(historical); corrupt.pin_sha256 = "0".repeat(64);
  assert.throws(() => verifiedPublicAssetPin({ row, projection, asset, pin: corrupt }), /release_pin_integrity_failed/);
});

test("private immutable page streams bytes and ranges without redirecting or exposing source identity", async () => {
  const { deliver } = fixture();
  const full = await deliver();
  assert.ok(full instanceof Response);
  assert.equal(full.status, 200);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), publishedManagedPageBytes);
  assert.equal(full.headers.get("cache-control"), "private, no-store");
  assert.equal(full.headers.get("vary"), "Cookie");
  assert.equal(full.headers.get("location"), null);
  assert.doesNotMatch(JSON.stringify([...full.headers]), /private-assets|builder-pages|X-Amz/);
  const partial = await deliver({ rangeHeader: "bytes=2-7" });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), `bytes 2-7/${publishedManagedPageBytes.length}`);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), publishedManagedPageBytes.subarray(2, 8));
});

test("HEAD reads metadata only and rejects unsatisfiable ranges before storage access", async () => {
  const { deliver, calls } = fixture();
  const head = await deliver({ method: "HEAD" });
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, "");
  assert.deepEqual(calls, ["HEAD"]);
  const invalid = await deliver({ rangeHeader: "bytes=9999-10000" });
  assert.equal(invalid.statusCode, 416);
  assert.deepEqual(calls, ["HEAD"]);
});

test("changed pin, bucket, or stored metadata fail closed before public bytes escape", async () => {
  for (const field of ["component_release_id", "book_asset_id", "source_owner_key", "source_asset_slot", "object_key", "checksum_sha256", "pin_sha256"]) {
    const { deliver, pin, calls } = fixture();
    pin[field] = "changed";
    assert.equal((await deliver()).statusCode, 409, field);
    assert.deepEqual(calls, []);
  }
  const mismatchedBucket = fixture();
  mismatchedBucket.storage.bucket = () => "other-private-assets";
  assert.equal((await mismatchedBucket.deliver()).statusCode, 503);
  const mismatchedBytes = fixture();
  mismatchedBytes.storage.head = async () => ({ checksumSha256: "b".repeat(64), byteSize: 3, contentType: "text/plain" });
  assert.equal((await mismatchedBytes.deliver({ method: "HEAD" })).statusCode, 409);
});

test("locator types and allowed fields cannot be coerced into trusted publication identities", () => {
  const valid = { pageId: "wb-page-1", hotspotId: "wb-hotspot-1" };
  assert.deepEqual(normalizePublishedBookLocator(valid), valid);
  assert.equal(normalizePublishedBookLocator(undefined), null);
  for (const invalid of [[], "page", { ...valid, pageId: 1 }, { ...valid, hotspotId: 123 }, { ...valid, productReleaseId: null }, { ...valid, productReleaseId: 3 }, { ...valid, other: "value" }]) assert.throws(() => normalizePublishedBookLocator(invalid), /publication_locator_invalid/);
});
