import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { wordListMp3, wordListSha } from "../../tests/fixtures/wordlists.js";
import { wordListObjectKey } from "../../netlify-sites/ultimate-b2-builder/server/_builder-wordlist-domain.js";
const bundle = await build({ entryPoints: ["tests/fixtures/wordlist-worker.mjs"], bundle: true, write: false, format: "esm", platform: "node", target: "es2022", external: ["node:*"] });
let outbound = 0;
const runtime = new Miniflare(convertV4MiniflareOptions({ name: "wordlists", modules: true, script: bundle.outputFiles[0].text,
  compatibilityDate: "2026-08-18", compatibilityFlags: ["nodejs_compat"], r2Buckets: ["RELEASE_SOURCE_ASSETS"],
  outboundService: () => { outbound++; throw new Error("Network forbidden"); } }));
await runtime.ready;
try {
  const bucket = await runtime.getR2Bucket("RELEASE_SOURCE_ASSETS");
  const bindings = ["students-book", "workbook"].map((component) => {
    const identity = { bookSlug: "ultimate-b2", componentSlug: `ultimate-b2-${component}`, sourceId: randomUUID(), sha256: wordListSha };
    return { ...identity, assetId: randomUUID(), path: `audio/${wordListSha}.mp3`, objectKey: wordListObjectKey(identity), storageBucket: "isolated-wordlists", role: "wordlist_audio", mediaType: "audio/mpeg", byteSize: wordListMp3.length };
  });
  const call = (binding, bytes) => runtime.dispatchFetch("http://isolated.invalid/audio", { method: "POST", body: JSON.stringify({ binding, bytes }) });
  for (const binding of bindings) for (const attempt of [1, 2]) {
    const response = await call(binding, wordListMp3.toString("base64")); assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).byteSize, wordListMp3.length);
  }
  assert.equal((await bucket.list()).objects.length, 2);
  assert.equal((await call({ ...bindings[0], storageBucket: "foreign-bucket" })).status, 409);
  assert.equal((await call(bindings[0], Buffer.alloc(417).toString("base64"))).status, 409);
  await bucket.put(bindings[0].objectKey, Buffer.alloc(417), { customMetadata: { sha256: wordListSha }, httpMetadata: { contentType: "audio/mpeg" } });
  assert.equal((await call(bindings[0])).status, 409, "Correct metadata cannot disguise corrupt bytes");
  assert.equal((await call(bindings[1])).status, 200, "Other component binding remains intact");
  assert.equal(outbound, 0); console.log("Word List local Worker/R2: MP3 bytes, create-only objects, independent component ownership, corruption checks; zero outbound fetches.");
} finally { await runtime.dispose(); }
