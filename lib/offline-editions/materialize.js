import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertNoSymlinkPath, isPathWithin } from "../book-builder/path-safety.js";
import { ultimateB2TeacherAppAuthoring } from "../../src/data/ultimate-b2/teacherAppAuthoring.js";
import { createTeacherRuntimeUiAssetModel } from "../../src/apps/android-teacher-offline/teacherRuntimeUiAssetModel.js";
import { PACK_SCHEMA, PACK_RUNTIME, PACK_LIMITS, assertSnapshot, validateSelection, digest, semanticHash, logicalAssetKey, requiredAssets, verifyPack, safePackPath, fail } from "../../src/data/offline-editions/contract.js";
import { stableJson } from "../../src/data/wordlists/portable.js";

export async function assertLocalPath(target) {
  const absolute = path.resolve(target);
  await assertNoSymlinkPath(path.parse(absolute).root, absolute);
  return absolute;
}
export async function readPackFile(root, relative, maximum = PACK_LIMITS.file) {
  safePackPath(relative); const target = path.join(root, relative); await assertLocalPath(target);
  if (!isPathWithin(root, target)) fail("offline_path_unsafe");
  const info = await fs.stat(target);
  if (!info.isFile() || info.size > maximum) fail("offline_file_limit", relative);
  return fs.readFile(target);
}
export async function packFiles(root, prefix = "") {
  await assertLocalPath(root); const result = [];
  for (const item of await fs.readdir(root, { withFileTypes: true })) {
    if (item.isSymbolicLink()) fail("offline_path_unsafe");
    if (item.isDirectory()) result.push(...await packFiles(path.join(root, item.name), `${prefix}${item.name}/`));
    else if (item.isFile()) result.push(`${prefix}${item.name}`);
    else fail("offline_path_unsafe");
  }
  return result.sort();
}
export async function verifyPackDirectory(root, expectedPackHash) {
  const manifest = JSON.parse(await readPackFile(root, "manifest.json", PACK_LIMITS.metadata));
  const verification = await verifyPack(manifest, { expectedPackHash, readBytes: (file, size) => readPackFile(root, file, size) });
  const actual = await packFiles(root), expected = ["manifest.json", ...verification.files.keys()].sort();
  if (stableJson(actual) !== stableJson(expected)) fail("offline_pack_unexpected_file");
  return { manifest, verification };
}
export function canonicalUiBindings() {
  const bindings = new Map();
  createTeacherRuntimeUiAssetModel({ authoring: ultimateB2TeacherAppAuthoring, runtimeContext: { kind: "offline" },
    resolveCanonicalAssetUrl(binding) { if (!binding?.id || !binding.repositoryPath) fail("offline_canonical_binding_invalid"); bindings.set(binding.id, binding); return binding.id; } });
  return [...bindings.values()].sort((a, b) => a.id.localeCompare(b.id, "en"));
}
export function createCollectionClient({ origin, access = "builder", credential, fetchImpl = fetch, signal }) {
  const base = new URL(origin);
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/" || !["https:", "http:"].includes(base.protocol)
    || base.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) fail("offline_origin_invalid");
  if (!["builder", "entitled"].includes(access) || typeof credential !== "string" || !credential || /[\r\n]/.test(credential)) fail("offline_auth_required");
  return async (selection, query = {}, limit = PACK_LIMITS.metadata) => {
    if (selection.releaseSha256) validateSelection(selection);
    else validateSelection({ ...selection, releaseSha256: "0".repeat(64), compositionSha256: "0".repeat(64) });
    const route = access === "builder" ? `/builder/api/publication/wordlists/books/${selection.bookSlug}/editions/${selection.editionId}/releases/${selection.releaseId}` : "/.netlify/functions/book-content";
    const parameters = access === "builder" ? query : { action: "edition-release", bookSlug: selection.bookSlug, editionId: selection.editionId, releaseId: selection.releaseId, contract: selection.contract, ...query };
    const url = new URL(route, base); url.search = new URLSearchParams(parameters).toString();
    const abort = AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])]);
    const response = await fetchImpl(url, { method: "GET", redirect: "error", cache: "no-store", signal: abort, headers: { Cookie: credential } });
    if (!response.ok) { await response.body?.cancel(); fail("offline_collection_failed", `HTTP ${response.status}`); }
    const declared = Number(response.headers.get("content-length"));
    if (declared > limit) { await response.body?.cancel(); fail("offline_response_limit"); }
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); fail("offline_response_limit"); } chunks.push(value); } }
    finally { reader.releaseLock(); }
    return Buffer.concat(chunks, size);
  };
}
export async function selectPublishedRelease({ bookSlug = "ultimate-b2", editionId, releaseId, collect }) {
  const target = { bookSlug, editionId, releaseId, contract: "edition-release.v2", audience: "teacher" };
  const snapshot = JSON.parse(await collect(target, { offline: "1", audience: "teacher" }));
  const selection = { ...target, releaseSha256: snapshot.source?.releaseSha256, compositionSha256: snapshot.source?.compositionSha256 };
  assertSnapshot(snapshot, selection);
  return { selection, counts: snapshot.members.map((member) => ({ componentSlug: member.reference.componentSlug, pages: member.projection.pages.length, activities: Object.keys(member.projection.nativeActivities).length, occurrences: member.wordlist?.entries.length || 0 })) };
}
export async function materializeEdition({ selection, collect, output, repositoryRoot, signal, onProgress = () => {} }) {
  validateSelection(selection); const destination = await assertLocalPath(output);
  if (await fs.lstat(destination).catch(() => null)) fail("offline_output_exists");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.partial-${randomUUID()}`;
  await fs.mkdir(temporary); await fs.writeFile(path.join(temporary, ".task-owned"), "offline-editions.v1");
  try {
    signal?.throwIfAborted();
    const snapshot = JSON.parse(await collect(selection, { offline: "1", audience: selection.audience }));
    assertSnapshot(snapshot, selection);
    const assets = [], canonicalUi = {}; const written = new Set(); let total = 0;
    await fs.mkdir(path.join(temporary, "assets"));
    const add = async (descriptor, bytes) => {
      signal?.throwIfAborted();
      if (!bytes.length || bytes.length > PACK_LIMITS.file || await digest(bytes) !== descriptor.sha256) fail("offline_collected_asset_integrity", logicalAssetKey(descriptor));
      const relative = `assets/${descriptor.sha256}.${descriptor.extension}`; safePackPath(relative);
      if (!written.has(relative)) {
        total += bytes.length; if (total > PACK_LIMITS.total) fail("offline_pack_limit");
        await fs.writeFile(path.join(temporary, relative), bytes, { flag: "wx" }); written.add(relative);
      }
      assets.push({ ...descriptor, byteSize: bytes.length, path: relative });
      onProgress({ stage: "collect", completed: assets.length });
    };
    // Authenticate and verify logical ownership for every registration, including
    // identical SB/WB audio, before deduplicating physical bytes.
    for (const descriptor of requiredAssets(snapshot)) {
      const query = { componentSlug: descriptor.componentSlug, ...(descriptor.role === "wordlist_audio" ? { audioSha256: descriptor.sha256 }
        : { content: "1", assetSha256: descriptor.sha256, assetRole: descriptor.role, extension: descriptor.extension }) };
      await add(descriptor, await collect(selection, query, PACK_LIMITS.file));
    }
    const owner = snapshot.uiOwner.reference;
    for (const binding of canonicalUiBindings()) {
      const bytes = await readPackFile(repositoryRoot, binding.repositoryPath);
      const descriptor = { componentSlug: owner.componentSlug, sourceSha256: owner.sha256, role: "canonical_ui", sha256: await digest(bytes), extension: path.extname(binding.repositoryPath).slice(1).toLowerCase(), mediaType: binding.mediaType };
      canonicalUi[binding.id] = logicalAssetKey(descriptor);
      if (!assets.some((asset) => logicalAssetKey(asset) === canonicalUi[binding.id])) await add(descriptor, bytes);
    }
    assets.sort((a, b) => logicalAssetKey(a).localeCompare(logicalAssetKey(b), "en"));
    const identity = { schemaVersion: PACK_SCHEMA, runtime: PACK_RUNTIME, selection, snapshot, canonicalUi, assets };
    const manifest = { ...identity, packSha256: await semanticHash(identity) };
    await verifyPack(manifest, { readBytes: (file, size) => readPackFile(temporary, file, size) });
    await fs.writeFile(path.join(temporary, "manifest.json"), stableJson(manifest), { flag: "wx" });
    await fs.unlink(path.join(temporary, ".task-owned"));
    await verifyPackDirectory(temporary, manifest.packSha256);
    await fs.rename(temporary, destination);
    return { root: destination, manifest };
  } catch (error) {
    // Retain identified partial work for diagnosis; it is never a valid output.
    throw error;
  }
}
