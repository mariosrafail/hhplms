import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { editionFixtureSources } from "./fixtures/content-editions.js";
import { lexicalFixture, wordListSha } from "./fixtures/wordlists.js";
import { contentEdition } from "../src/data/contentEditions.js";
import { freezeWordList, wordListObjectKey, prepareWordListEdition } from "../netlify-sites/ultimate-b2-builder/server/_builder-wordlist-domain.js";
import { projectOfflineEdition } from "../lib/offline-editions/snapshot.js";
import { PACK_SCHEMA, PACK_RUNTIME, assertSnapshot, requiredAssets, logicalAssetKey, semanticHash, verifyPack, safePackPath } from "../src/data/offline-editions/contract.js";
import { androidIdentity } from "../lib/offline-editions/android.js";
import { assertLocalPath, createCollectionClient } from "../lib/offline-editions/materialize.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { launchExporter } from "../scripts/offline-editions/launcher.mjs";
import { TEACHER_ANDROID_APPLICATION_ID } from "../lib/teacher-project-builder/android-contract.js";
import { runFixedProcess } from "../lib/teacher-project-builder/fixed-process.js";

const sources = editionFixtureSources("greek");
const records = sources.slice(0, 2).map((target) => {
  const dataset = lexicalFixture(), sourceId = randomUUID();
  const identity = { sourceId, bookSlug: target.reference.bookSlug, componentSlug: target.reference.componentSlug, sha256: wordListSha };
  return freezeWordList({ sourceId, revision: 1, mappingRevision: 1, target, dataset,
    bindings: [{ ...dataset.audio[0], ...identity, assetId: randomUUID(), role: "wordlist_audio", storageBucket: "isolated-wordlists", objectKey: wordListObjectKey(identity) }],
    mappings: [{ group: identity.componentSlug.endsWith("workbook") ? "work1_1" : "unit1_1", pageIds: [target.content.publicProjection.pages[0].id] }] });
});
const release = prepareWordListEdition({ id: randomUUID(), number: 1, edition: contentEdition("ultimate-b2", "greek"), sources, wordlists: records });
const selection = { bookSlug: "ultimate-b2", editionId: "greek", audience: "teacher", releaseId: release.id, contract: release.schemaVersion, releaseSha256: release.releaseSha256, compositionSha256: release.compositionSha256 };
const snapshot = projectOfflineEdition(release, { ...selection, teacherAuthorized: true });
const clone = () => structuredClone(snapshot);

test("offline Teacher projection verifies private source before allowing runtime fields", () => {
  assertSnapshot(snapshot, selection);
  assert.throws(() => projectOfflineEdition(release, { ...selection, teacherAuthorized: false }), /teacher_required/);
  const publicValue = projectOfflineEdition(release, { ...selection, audience: "student", teacherAuthorized: false });
  assert(publicValue.members.every((member) => !Object.keys(member.teacherDocuments).length && member.assets.every((asset) => !["teacher_ui", "native_teacher_answer"].includes(asset.role))));
  assert(!JSON.stringify(publicValue).includes("PHASE_5_PRIVATE_TEACHER_SENTINEL"));
  assert(!JSON.stringify(snapshot).includes("provenance") && !JSON.stringify(snapshot).includes("objectKey"));
});
test("offline release selection and source ownership fail closed", () => {
  for (const mutate of [
    (value) => { value.source.id = randomUUID(); }, (value) => { value.source.state = "candidate"; },
    (value) => { value.editionId = "international"; }, (value) => { value.audience = "student"; },
    (value) => { value.members.pop(); }, (value) => { value.members[1].reference = value.members[0].reference; },
    (value) => { value.uiOwner.reference = value.members[1].reference; },
    (value) => { value.members[0].wordlist.mappings[0].pageIds = []; },
    (value) => { value.members[0].wordlist.targetSource = value.members[1].reference; },
    (value) => { value.members[0].assets = []; },
    (value) => { value.members[0].teacherDocuments = {}; },
    (value) => { value.source.composition.members[0] = value.members[1].reference; },
    (value) => { Object.values(value.members[0].projection.nativeActivities)[0].kind = "unregistered-legacy"; },
    (value) => { Object.values(value.members[0].projection.hotspots.pages)[0][0].actionType = "legacy-navigation"; },
  ]) { const value = clone(); mutate(value); assert.throws(() => assertSnapshot(value, selection)); }
});
test("local launcher refuses to adopt a nonempty unowned directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hhplms-offline-owner-"));
  try {
    await fs.writeFile(path.join(root, "existing.txt"), "preserve");
    await assert.rejects(launchExporter({ repositoryRoot: process.cwd(), output: root }), /unowned_nonempty/);
    assert.equal(await fs.readFile(path.join(root, "existing.txt"), "utf8"), "preserve");
  } finally { await fs.rm(root, { recursive: true }); }
});
test("output paths reject real directory symlink or junction escape", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hhplms-offline-symlink-"));
  try {
    const target = path.join(root, "target"), link = path.join(root, "link"); await fs.mkdir(target);
    await fs.symlink(target, link, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(assertLocalPath(path.join(link, "output")));
  } finally { await fs.rm(root, { recursive: true }); }
});
test("independent APK readback rejects traversal and Windows device paths before extraction", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hhplms-offline-archive-"));
  try {
    for (const [index, name] of ["../escape", "assets/public/CON.txt", "assets/public/name.", "assets/public/x\\y", "assets/public/a:b"].entries()) {
      const apk = path.join(root, `${index}.apk`), output = path.join(root, `readback-${index}`);
      await runFixedProcess("python", ["-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],'w'); i=zipfile.ZipInfo('entry'); i.filename=sys.argv[2]; i.orig_filename=sys.argv[2]; z.writestr(i,b'x'); z.close()", apk, name]);
      await assert.rejects(runFixedProcess("python", ["scripts/offline-editions/read-apk.py", apk, output]), (error) => /offline_apk_path_unsafe/.test(error.result?.stderr));
      assert.deepEqual(await fs.readdir(output), []);
    }
  } finally { await fs.rm(root, { recursive: true }); }
});
async function fixtureManifest() {
  const assets = requiredAssets(snapshot).map((asset) => ({ ...asset, path: `assets/${asset.sha256}.${asset.extension}`, byteSize: 1 }));
  const canonical = { componentSlug: snapshot.members[0].reference.componentSlug, sourceSha256: snapshot.members[0].reference.sha256,
    role: "canonical_ui", sha256: "e".repeat(64), extension: "png", mediaType: "image/png", byteSize: 1, path: `assets/${"e".repeat(64)}.png` };
  assets.push(canonical);
  const identity = { schemaVersion: PACK_SCHEMA, runtime: PACK_RUNTIME, selection, snapshot,
    canonicalUi: Object.fromEntries(["active", "disabled", "pressed"].map((state) => [`navibar.vocabulary.${state}`, logicalAssetKey(canonical)])), assets };
  return { ...identity, packSha256: await semanticHash(identity) };
}
test("pack identity, logical ownership, bytes and exact dependency inventory are independently checked", async () => {
  const manifest = await fixtureManifest(); await verifyPack(manifest);
  await assert.rejects(verifyPack(manifest, { expectedPackHash: "f".repeat(64) }), /pack_integrity/);
  await assert.rejects(verifyPack(manifest, { readBytes: async () => new Uint8Array([1]) }), /asset_integrity/);
  for (const mutate of [
    (value) => { value.assets.pop(); }, (value) => { value.assets[0].sourceSha256 = "f".repeat(64); },
    (value) => { value.assets[0].path = "../escape.png"; }, (value) => { value.assets[0].byteSize = 0; },
    (value) => { value.assets.push({ ...value.assets[0], sha256: "f".repeat(64), path: `assets/${"f".repeat(64)}.png` }); },
  ]) {
    const value = structuredClone(manifest); mutate(value); const { packSha256: _hash, ...identity } = value; value.packSha256 = await semanticHash(identity);
    await assert.rejects(verifyPack(value));
  }
  assert.equal(manifest.packSha256, (await fixtureManifest()).packSha256);
});
test("native edition application identities and versions are stable and separate", () => {
  const greek = androidIdentity(selection), international = androidIdentity({ ...selection, editionId: "international" });
  assert.notEqual(greek.applicationId, international.applicationId); assert.notEqual(greek.applicationId, TEACHER_ANDROID_APPLICATION_ID);
  assert.equal(greek.mainActivity, `${TEACHER_ANDROID_APPLICATION_ID}.MainActivity`);
  assert.deepEqual(androidIdentity({ ...selection, releaseId: randomUUID() }), greek);
  for (const value of [0, -1, NaN, 1.2, 2100000001]) assert.throws(() => androidIdentity(selection, value));
  assert.throws(() => androidIdentity(selection, 1, "1.0; command"));
  assert.throws(() => androidIdentity({ ...selection, audience: "student" }));
});
test("collection credentials are transient headers, GET-only, bounded and cancellable", async () => {
  const calls = [], controller = new AbortController();
  const client = createCollectionClient({ origin: "https://fixture.example", credential: "ephemeral-cookie", signal: controller.signal,
    fetchImpl: async (url, options) => { calls.push({ url: String(url), options }); return new Response("abc"); } });
  assert.equal((await client(selection, { offline: "1", audience: "teacher" })).toString(), "abc");
  assert.equal(calls[0].options.method, "GET"); assert.equal(calls[0].options.redirect, "error"); assert(!calls[0].url.includes("ephemeral-cookie"));
  await assert.rejects(client(selection, {}, 2), /response_limit/);
  controller.abort(); assert(calls[0].options.signal.aborted);
  for (const origin of ["http://foreign.example", "https://user:password@example.test", "https://example.test/?cookie=secret"]) assert.throws(() => createCollectionClient({ origin, credential: "test" }));
});
test("portable pack paths reject Windows devices, traversal and absolute paths", () => {
  for (const value of ["../a", "a/../b", "C:/a", "/a", "a\\b", "NUL.txt", "a//b", "a/CON"]) assert.throws(() => safePackPath(value));
  assert.equal(safePackPath("assets/a.png"), "assets/a.png");
});
