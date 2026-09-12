import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readFile, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import manifest from "../../src/data/ultimate-b2/generated/students-book-page-assets.json" with { type: "json" };
import { studentsBookPublicationPages } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v3.js";
import { studentsBookUnits } from "../../tests/fixtures/students-book-current.js";
import { verifyImageBytes } from "../../lib/book-assets/verified-image-bytes.js";
import { componentPublicationAssetStorageTarget } from "../../lib/book-assets/publication-asset-storage.js";

const root = process.cwd();
const directory = await mkdtemp(path.join(tmpdir(), "hhplms-fullbook-worker-"));
const assetDirectory = path.join(directory, "assets");
const scope = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" };
const catalog = studentsBookPublicationPages({ revision: 0, units: studentsBookUnits, rows: [] });
const input = { ...scope, canonicalAssetSources: catalog.canonicalAssetSources, assetManifest: catalog.canonicalAssetSources.map((source) => source.descriptor), publicProjection: { pages: catalog.pages } };
assert.equal(manifest.pages.length, 110);
const tracked = new Set(execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0"));
for (const page of manifest.pages) {
  assert(tracked.has(page.repositoryPath), "Every canonical input must be tracked");
  const source = input.canonicalAssetSources.find((entry) => entry.pageId === page.pageId);
  await verifyImageBytes(new Uint8Array(await readFile(page.repositoryPath)), { ...source.descriptor, byteSize: source.byteSize, width: source.width, height: source.height });
  const target = path.join(assetDirectory, source.path);
  await mkdir(path.dirname(target), { recursive: true });
  // Isolated test inputs; Windows file symlinks require extra OS privileges.
  if (process.platform === "win32") await copyFile(path.resolve(page.repositoryPath), target);
  else await symlink(path.resolve(page.repositoryPath), target, "file");
}
const unique = new Set(input.assetManifest.map((asset) => asset.sha256));
assert.equal(unique.size, 110, "The real manifest contains 110 distinct images");
const totalBytes = manifest.pages.reduce((sum, page) => sum + page.byteSize, 0);
const bundle = await build({ entryPoints: ["tests/fixtures/students-book-fullbook-worker.mjs"], bundle: true, write: false, format: "esm", platform: "node", target: "es2022", external: ["node:*"] });
let outbound = 0;
const runtime = new Miniflare(convertV4MiniflareOptions({ name: "fullbook", modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-08-18", compatibilityFlags: ["nodejs_compat"], assets: { routerConfig: { has_user_worker: true }, directory: assetDirectory, binding: "ASSETS", run_worker_first: true }, r2Buckets: ["RELEASE_SOURCE_ASSETS"], outboundService: () => { outbound++; throw new Error("Unexpected outbound request is forbidden"); } }));
const results = [];
await runtime.ready;
// Linux process accounting covers workerd and its local binding simulators,
// not a single Worker isolate. Never label these values as isolate metrics.
const workerdPid = process.platform === "linux" ? execFileSync("ps", ["-eo", "pid,ppid,comm"], { encoding: "utf8" }).trim().split("\n").slice(1).map((line) => line.trim().split(/\s+/)).find(([, parent, command]) => Number(parent) === process.pid && command === "workerd")?.[0] : null;
const ticksPerSecond = workerdPid ? Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" })) : null;
const runtimeProcess = async () => {
  if (!workerdPid) return null;
  const stat = (await readFile(`/proc/${workerdPid}/stat`, "utf8")).replace(/^.*\) /, "").split(" ");
  const status = await readFile(`/proc/${workerdPid}/status`, "utf8");
  return { cpuTicks: Number(stat[11]) + Number(stat[12]), peakRssKiB: Number(status.match(/^VmHWM:\s+(\d+)/m)?.[1]) };
};
const run = async (name, options = {}) => {
  const wall = performance.now(); const cpu = process.cpuUsage(); const runtimeBefore = await runtimeProcess();
  const response = await runtime.dispatchFetch("http://isolated.invalid/acceptance", { method: "POST", body: JSON.stringify({ input, ...options }) });
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  const runtimeAfter = await runtimeProcess();
  results.push({ name, ...result, workerdProcessCpuMs: runtimeAfter ? (runtimeAfter.cpuTicks - runtimeBefore.cpuTicks) * 1000 / ticksPerSecond : "not measured: no Linux child process accounting", workerdProcessPeakRssKiB: runtimeAfter?.peakRssKiB ?? "not measured", workerdProcessMeasurement: "Linux /proc utime+stime delta and VmHWM; includes local ASSETS/R2 runtime, not per-isolate; concurrent samples overlap", harnessWallMs: performance.now() - wall, nodeHarnessCpuMicroseconds: process.cpuUsage(cpu), nodeHarnessMaxRssKiB: process.resourceUsage().maxRSS });
  return result;
};
try {
  const bucket = await runtime.getR2Bucket("RELEASE_SOURCE_ASSETS");
  assert.equal((await bucket.list()).objects.length, 0);
  for (const name of ["cold", "reuse"]) {
    const result = await run(name); assert.equal(result.error, null);
    assert.deepEqual(result.counts, { assetsFetch: 110, put: 110, head: 220, get: 110, readbackBytes: totalBytes, putBytes: totalBytes, maxConcurrentAssets: 1 });
    assert.equal((await bucket.list()).objects.length, 110);
  }
  const concurrent = await Promise.all([run("concurrent-a", { namespace: "race" }), run("concurrent-b", { namespace: "race" })]);
  concurrent.forEach((result) => { assert.equal(result.error, null); assert.equal(result.counts.maxConcurrentAssets, 1); });
  assert.equal((await bucket.list({ prefix: "race/" })).objects.length, 110);
  const latency = await run("simulated-2ms-per-binding-operation", { delayMs: 2 }); assert.equal(latency.error, null);
  for (const failAt of [1, 55, 110]) {
    assert.notEqual((await run(`failure-${failAt}`, { failAt, namespace: `failure-${failAt}` })).error, null);
    assert.equal((await bucket.list({ prefix: `failure-${failAt}/` })).objects.length, failAt - 1);
    assert.equal((await run(`retry-${failAt}`, { namespace: `failure-${failAt}` })).error, null);
  }
  const first = input.canonicalAssetSources[0];
  const key = componentPublicationAssetStorageTarget({ ...scope, ...first.descriptor }).objectKey;
  const original = new Uint8Array(await (await bucket.get(key)).arrayBuffer());
  const corrupt = original.slice(); corrupt[30] ^= 1;
  for (const [name, bytes, metadata] of [
    ["wrong-bytes-correct-metadata", corrupt, { contentType: first.descriptor.mediaType, sha256: first.descriptor.sha256 }],
    ["wrong-metadata", original, { contentType: "image/jpeg", sha256: "f".repeat(64) }],
    ["wrong-size", original.subarray(0, 40), { contentType: first.descriptor.mediaType, sha256: first.descriptor.sha256 }],
  ]) {
    // Deliberate corruption of disposable test storage, outside production APIs.
    await bucket.put(key, bytes, { httpMetadata: { contentType: metadata.contentType }, customMetadata: { sha256: metadata.sha256 } });
    assert.notEqual((await run(name)).error, null);
    assert.deepEqual(new Uint8Array(await (await bucket.get(key)).arrayBuffer()), bytes, "Failed verification must never overwrite the corrupt object");
  }
  assert.equal(outbound, 0);
  const report = { runtime: "local Miniflare/workerd with actual local ASSETS and R2 bindings", node: process.version, wrangler: JSON.parse(await readFile("node_modules/wrangler/package.json", "utf8")).version, miniflare: JSON.parse(await readFile("node_modules/miniflare/package.json", "utf8")).version, canonicalPages: 110, uniqueCanonicalImages: unique.size, totalBytes, maxImageBytes: Math.max(...manifest.pages.map((page) => page.byteSize)), externalFetches: outbound, database: "not exercised at this layer; actual PostgreSQL Prepare is a separate integration gate", results };
  if (process.env.SB_FULLBOOK_METRICS_PATH) await writeFile(process.env.SB_FULLBOOK_METRICS_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await runtime.dispose();
  assert(directory.startsWith(path.join(tmpdir(), "hhplms-fullbook-worker-")));
  await rm(directory, { recursive: true });
}
