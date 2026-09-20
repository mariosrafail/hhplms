import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { inspectAndroidApk } from "../../scripts/android/inspect-apk.mjs";
import { runFixedProcess } from "../teacher-project-builder/fixed-process.js";
import { assertLocalPath, readPackFile, packFiles, verifyPackDirectory } from "./materialize.js";
import { digest, fail, PACK_WEB_ROOT } from "../../src/data/offline-editions/contract.js";

export async function hashFile(file) {
  const hash = createHash("sha256"); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest("hex");
}
export async function verifyEditionApk({ apkPath, webRoot, readbackRoot, identity, expectedPackHash, repositoryRoot, sdkRoot, java = "java", python = "python" }) {
  await assertLocalPath(apkPath); await assertLocalPath(readbackRoot);
  const inspect = await inspectAndroidApk(apkPath);
  for (const [key, value] of Object.entries({ applicationId: identity.applicationId, applicationLabel: identity.label, versionCode: identity.versionCode, versionName: identity.versionName, minSdk: identity.minSdk, targetSdk: identity.targetSdk })) if (inspect[key] !== value) fail("offline_apk_identity", key);
  if (inspect.permissions.includes("android.permission.INTERNET")) fail("offline_apk_internet");
  const tools = path.join(sdkRoot, "build-tools", "36.0.0");
  const manifest = await runFixedProcess(path.join(tools, process.platform === "win32" ? "aapt.exe" : "aapt"), ["dump", "xmltree", apkPath, "AndroidManifest.xml"]);
  const badging = await runFixedProcess(path.join(tools, process.platform === "win32" ? "aapt.exe" : "aapt"), ["dump", "badging", apkPath]);
  if (badging.stdout.match(/^launchable-activity: name='([^']+)'/m)?.[1] !== identity.mainActivity) fail("offline_apk_launcher_identity");
  if (!manifest.stdout.includes(`\"${identity.mainActivity}\"`) || !manifest.stdout.includes(`\"${identity.providerAuthority}\"`) || !manifest.stdout.includes("android:debuggable") || !/android:debuggable[^\n]*0xffffffff/.test(manifest.stdout)) fail("offline_apk_native_manifest");
  const signature = await runFixedProcess(java, ["-jar", path.join(tools, "lib", "apksigner.jar"), "verify", "--verbose", "--print-certs", apkPath]);
  if (!/Signer #1 certificate DN:.*CN=Android Debug/.test(signature.stdout) || /Signer #2 certificate DN:/.test(signature.stdout)) fail("offline_apk_debug_signature");
  const readback = await runFixedProcess(python, [path.join(repositoryRoot, "scripts/offline-editions/read-apk.py"), apkPath, readbackRoot], { maxOutputBytes: 16 * 1024 * 1024 });
  const archive = JSON.parse(readback.stdout);
  const nativeGenerated = new Set(["assets/capacitor.config.json", "assets/capacitor.plugins.json", "assets/native-bridge.js"]);
  if (Object.keys(archive.files).some((file) => file.startsWith("assets/") && !file.startsWith("assets/public/") && !nativeGenerated.has(file))) fail("offline_apk_unexpected_native_asset");
  const extracted = path.join(readbackRoot, "assets", "public");
  const webFiles = await packFiles(webRoot), packaged = Object.keys(archive.files).filter((file) => file.startsWith("assets/public/")).map((file) => file.slice(14));
  const extras = packaged.filter((file) => !webFiles.includes(file));
  if (extras.some((file) => !["cordova.js", "cordova_plugins.js"].includes(file))) fail("offline_apk_unexpected_content");
  for (const file of webFiles) {
    const value = archive.files[`assets/public/${file}`], bytes = await readPackFile(webRoot, file);
    if (!value || value.sha256 !== await digest(bytes) || value.byteSize !== bytes.length) fail("offline_apk_web_integrity", file);
  }
  const config = JSON.parse(await fs.readFile(path.join(readbackRoot, "assets", "capacitor.config.json"), "utf8"));
  if (config.appId !== identity.applicationId || config.appName !== identity.label || config.server?.url || config.server?.allowNavigation || config.server?.cleartext) fail("offline_apk_capacitor_configuration");
  const { manifest: pack, verification } = await verifyPackDirectory(path.join(extracted, PACK_WEB_ROOT), expectedPackHash);
  if (pack.selection.editionId !== (identity.applicationId.includes(".international.") ? "international" : "greek") || pack.selection.audience !== "teacher") fail("offline_apk_pack_identity");
  await verifyEditionWeb(extracted);
  return { status: "verified-offline-edition-debug-apk", apkSha256: await hashFile(apkPath), apkSizeBytes: (await fs.stat(apkPath)).size, identity,
    packSha256: pack.packSha256, source: pack.snapshot.source, archiveEntries: archive.entries, verifiedWebFiles: webFiles.length, capacitorGenerated: extras,
    verifiedPackFiles: verification.files.size, signatureVerified: true, signerCertificateSha256: signature.stdout.match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/)?.[1], readbackRoot: extracted };
}
export async function verifyEditionWeb(root) {
  const files = await packFiles(root);
  for (const file of files) {
    if (file.endsWith(".map")) fail("offline_sourcemap_forbidden");
    if (!/\.(json|html|js|css|xml|txt)$/.test(file)) continue;
    const text = (await readPackFile(root, file, 32 * 1024 * 1024)).toString("utf8");
    if (/builder-wordlist-audio\/|storage_bucket|storageBucket|object_key|objectKey|hh_builder_session|hh_session|\.netlify\/functions|\/builder\/api\/|\/preview\/content\/|sourceMappingURL|[A-Za-z]:[\\/]Users[\\/]/.test(text)) fail("offline_forbidden_content", file);
    const urls = text.match(/https?:\/\/[^\s"'<>`\\)]+/g) || [];
    if (urls.some((url) => !/^https?:\/\/(?:www\.w3\.org\/|react\.dev\/errors\/|localhost(?:\/|$))/.test(url))) fail("offline_external_url", file);
  }
  return { files: files.length };
}
