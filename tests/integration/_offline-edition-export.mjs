import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { loadWordListEdition } from "../../netlify-sites/ultimate-b2-builder/server/_builder-wordlist-store.js";
import { readPublishedEdition } from "../../netlify/functions/_book-content/edition-read.js";
import { createCollectionClient, materializeEdition, verifyPackDirectory } from "../../lib/offline-editions/materialize.js";
import { buildEditionApk } from "../../lib/offline-editions/build.js";
import { projectOfflineEdition } from "../../lib/offline-editions/snapshot.js";
import { verifyOfflineEditionRuntime } from "../../scripts/offline-editions/runtime-acceptance.mjs";
import { launchExporter } from "../../scripts/offline-editions/launcher.mjs";
import { chromium, expect } from "@playwright/test";
import { localPlaywrightLaunchOptions } from "../../scripts/android-teacher/playwright-launch-options.mjs";
import { hashFile, verifyEditionApk } from "../../lib/offline-editions/verify-apk.js";
import { runFixedProcess } from "../../lib/teacher-project-builder/fixed-process.js";

export async function exerciseOfflineEditionExport({ sql, handler, storage, token, releases, student }) {
  const output = path.resolve(process.env.OFFLINE_EDITION_OUTPUT || "artifacts/offline-editions");
  await fs.mkdir(output, { recursive: true });
  const methods = [];
  const server = createServer(async (request, response) => {
    try {
      methods.push(request.method); const url = new URL(request.url, "http://localhost");
      const result = await handler({ path: url.pathname, httpMethod: request.method, headers: request.headers, queryStringParameters: Object.fromEntries(url.searchParams) });
      response.writeHead(result.statusCode, result.headers); response.end(result.isBase64Encoded ? Buffer.from(result.body, "base64") : result.body);
    } catch { response.writeHead(500); response.end("fixture read failed"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const controller = new AbortController();
  const collect = createCollectionClient({ origin, credential: `hh_builder_session=${token}`, signal: controller.signal });
  const packs = {};
  try {
    const launcher = await launchExporter({ repositoryRoot: process.cwd(), output: path.join(output, "launcher") });
    const browser = await chromium.launch(localPlaywrightLaunchOptions());
    try {
      const page = await browser.newPage(); const localOrigin = `http://127.0.0.1:${launcher.address().port}`;
      assert.equal((await fetch(`${localOrigin}/status`)).status, 403);
      await page.goto(localOrigin);
      await page.getByLabel("Server origin").fill(origin);
      await page.getByLabel("Published release ID").fill(releases.greek);
      await page.getByLabel("Session cookie").fill(`hh_builder_session=${token}`);
      await page.getByRole("button", { name: "Inspect selected release" }).click();
      await expect(page.getByRole("button", { name: "Build verified debug APK" })).toBeEnabled();
      await expect(page.getByLabel("Session cookie")).toHaveValue("");
      assert(!(await page.getByRole("status").innerText()).includes(token));
      await page.screenshot({ path: path.join(output, "launcher-selected.png") });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
    } finally { await browser.close(); launcher.closeAllConnections(); await new Promise((resolve) => launcher.close(resolve)); }
    for (const editionId of ["greek", "international"]) {
      const release = await loadWordListEdition(sql, { bookSlug: "ultimate-b2", editionId, releaseId: releases[editionId], publishedOnly: true });
      const selection = { bookSlug: "ultimate-b2", editionId, audience: "teacher", releaseId: release.id, contract: release.schemaVersion, releaseSha256: release.releaseSha256, compositionSha256: release.compositionSha256 };
      const unauthorized = createCollectionClient({ origin, credential: "hh_builder_session=unrecognized" });
      await assert.rejects(unauthorized(selection, { offline: "1", audience: "teacher" }), /HTTP 401/);
      await assert.rejects(collect({ ...selection, releaseId: randomUUID() }, { offline: "1", audience: "teacher" }), /HTTP 404/);
      await assert.rejects(collect(selection, { offline: "1", audience: "student" }), /HTTP 403/);
      assert.equal((await readPublishedEdition(sql, student, { action: "edition-release", contract: selection.contract, bookSlug: selection.bookSlug, editionId, releaseId: release.id, offline: "1", audience: "teacher" }, { storage: () => storage })).statusCode, 403);
      const publicProjection = projectOfflineEdition(release, { ...selection, audience: "student", teacherAuthorized: false });
      assert(publicProjection.members.every((member) => !Object.keys(member.teacherDocuments).length && member.assets.every((asset) => asset.role !== "native_teacher_answer" && asset.role !== "teacher_ui")));
      packs[editionId] = await materializeEdition({ selection, collect, repositoryRoot: process.cwd(), output: path.join(output, `${editionId}-pack`) });
      const text = JSON.stringify(packs[editionId].manifest);
      assert(!text.includes("provenance") && !text.includes("objectKey") && !text.includes(token));
      if (editionId === "international") assert(!text.includes("λέξη") && !text.includes("μια μεγάλη ελληνική"));
      console.log(`Verified ${editionId} pack ${packs[editionId].manifest.packSha256}`);
    }
    // Reverse materialization independently exercises physical byte isolation.
    const reverse = await materializeEdition({ selection: packs.greek.manifest.selection, collect, repositoryRoot: process.cwd(), output: path.join(output, "greek-reverse-pack") });
    assert.equal(reverse.manifest.packSha256, packs.greek.manifest.packSha256);
    await verifyPackDirectory(packs.international.root, packs.international.manifest.packSha256);
    assert(methods.every((method) => method === "GET"));
  } finally { controller.abort(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  // Failures are exercised against independently copied complete packs.
  const failures = [];
  for (const [name, choose] of [["audio", (a) => a.role === "wordlist_audio"], ["font", (a) => a.role === "activity_font"], ["image", (a) => a.role === "managed_page_image" || a.role === "canonical_page_image"]]) {
    const root = path.join(output, `damaged-${name}`); await fs.cp(packs.greek.root, root, { recursive: true });
    const asset = packs.greek.manifest.assets.find(choose); assert(asset, name);
    await fs.writeFile(path.join(root, asset.path), "corrupt"); await assert.rejects(verifyPackDirectory(root)); failures.push(`corrupt-${name}`);
    await fs.unlink(path.join(root, asset.path)); await assert.rejects(verifyPackDirectory(root)); failures.push(`missing-${name}`);
  }
  const unexpected = path.join(output, "unexpected-pack"); await fs.cp(packs.greek.root, unexpected, { recursive: true });
  await fs.writeFile(path.join(unexpected, "unexpected.txt"), "stale"); await assert.rejects(verifyPackDirectory(unexpected), /unexpected_file/);
  const cancelled = path.join(output, "cancelled-apk"), cancellation = new AbortController();
  await assert.rejects(buildEditionApk({ repositoryRoot: process.cwd(), packRoot: packs.greek.root, output: cancelled,
    signal: cancellation.signal, onStage: (stage) => { if (stage === "npm-ci") setTimeout(() => cancellation.abort(), 30); } }), { name: "AbortError" });
  assert(cancellation.signal.aborted);
  assert.equal(await fs.stat(cancelled).catch(() => null), null); failures.push("interrupted-real-process-no-artifact");
  // Collection server is gone before native builds and runtime acceptance.
  const artifacts = {};
  for (const editionId of ["greek", "international"]) {
    artifacts[editionId] = await buildEditionApk({ repositoryRoot: process.cwd(), packRoot: packs[editionId].root, output: path.join(output, `${editionId}-apk`),
      sdkRoot: process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME, onStage: (stage) => console.log(`${editionId}: ${stage}`) });
  }
  const internationalBefore = await hashFile(artifacts.international.apkPath);
  const reverse = await buildEditionApk({ repositoryRoot: process.cwd(), packRoot: packs.greek.root, output: path.join(output, "greek-reverse-apk"),
    onStage: (stage) => console.log(`greek-reverse: ${stage}`) });
  assert.equal(reverse.receipt.packSha256, artifacts.greek.receipt.packSha256);
  assert.equal(reverse.receipt.codeTree, artifacts.greek.receipt.codeTree);
  assert.equal(reverse.receipt.codeTree, artifacts.international.receipt.codeTree);
  assert.equal(await hashFile(artifacts.international.apkPath), internationalBefore);
  const retained = await hashFile(artifacts.greek.apkPath);
  await assert.rejects(buildEditionApk({ repositoryRoot: process.cwd(), packRoot: packs.international.root, output: path.join(output, "greek-apk") }), /output_exists/);
  assert.equal(await hashFile(artifacts.greek.apkPath), retained); failures.push("stale-output-preserved-and-rejected");
  const tampered = path.join(output, "tampered.apk"); await fs.copyFile(artifacts.greek.apkPath, tampered);
  await runFixedProcess("python", ["-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],'a'); z.writestr('assets/public/unexpected.txt',b'tampered'); z.close()", tampered]);
  await assert.rejects(verifyEditionApk({ apkPath: tampered, webRoot: path.join(artifacts.greek.stage, "source/dist"), readbackRoot: path.join(output, "tampered-readback"),
    identity: artifacts.greek.receipt.verification.identity, expectedPackHash: packs.greek.manifest.packSha256, repositoryRoot: process.cwd(), sdkRoot: process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME }));
  failures.push("tampered-final-apk");
  await fs.writeFile(path.join(output, "isolation-receipt.json"), JSON.stringify({ failures, directions: ["greek-international", "international-greek"], reverse: reverse.receipt.verification }, null, 2));
  await fs.writeFile(path.join(output, "fixture-artifacts.json"), JSON.stringify(artifacts, null, 2));
  for (const editionId of ["greek", "international"]) await verifyOfflineEditionRuntime({ webRoot: artifacts[editionId].receipt.verification.readbackRoot, output: path.join(output, `${editionId}-runtime`) });
}
