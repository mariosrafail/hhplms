import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runFixedProcess } from "../teacher-project-builder/fixed-process.js";
import { assertLocalPath, verifyPackDirectory } from "./materialize.js";
import { androidIdentity } from "./android.js";
import { verifyEditionApk, hashFile } from "./verify-apk.js";
import { semanticHash, fail } from "../../src/data/offline-editions/contract.js";
import { stableJson } from "../../src/data/wordlists/portable.js";
import { TEACHER_ANDROID_APPLICATION_ID } from "../teacher-project-builder/android-contract.js";

export function buildEnvironment() {
  const permitted = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "JAVA_HOME", "ANDROID_HOME", "ANDROID_SDK_ROOT", "LANG", "LC_ALL", "CI"];
  return Object.fromEntries(permitted.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
}
export async function buildEditionApk({ repositoryRoot, packRoot, output, versionCode = 1, versionName = "1.0", sdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME, java = "java", python = "python", onStage = () => {}, signal }) {
  await assertLocalPath(repositoryRoot); await assertLocalPath(packRoot); const destination = await assertLocalPath(output);
  if (!sdkRoot) fail("offline_android_sdk_required"); await assertLocalPath(sdkRoot);
  if (await fs.lstat(destination).catch(() => null)) fail("offline_output_exists");
  const { manifest } = await verifyPackDirectory(packRoot);
  const identity = androidIdentity(manifest.selection, versionCode, versionName);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const stage = `${destination}.partial-${randomUUID()}`; await fs.mkdir(stage); await fs.writeFile(path.join(stage, ".task-owned"), "offline-editions.v1");
  const sourceRoot = path.join(stage, "source"), webRoot = path.join(sourceRoot, "dist"), artifactRoot = path.join(stage, "artifact");
  await fs.mkdir(sourceRoot); await fs.mkdir(artifactRoot);
  const env = { ...buildEnvironment(), ANDROID_HOME: sdkRoot, ANDROID_SDK_ROOT: sdkRoot };
  const execute = async (name, command, args, cwd = sourceRoot) => {
    signal?.throwIfAborted(); onStage(name);
    try { const result = await runFixedProcess(command, args, { cwd, env, signal, timeout: 45 * 60 * 1000, maxOutputBytes: 16 * 1024 * 1024 });
      await fs.writeFile(path.join(stage, `${name}.log`), result.stdout + result.stderr); signal?.throwIfAborted(); return result;
    } catch (error) { if (error.result) await fs.writeFile(path.join(stage, `${name}.log`), error.result.stdout + error.result.stderr); throw error; }
  };
  onStage("stage-tracked-source");
  try { await runFixedProcess("git", ["diff", "--quiet"], { cwd: repositoryRoot }); } catch { fail("offline_source_unstaged", "Stage or commit the reviewed source before exporting."); }
  const codeTree = (await runFixedProcess("git", ["write-tree"], { cwd: repositoryRoot })).stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(codeTree)) fail("offline_code_tree_invalid");
  const archive = path.join(stage, "tracked-source.tar");
  await runFixedProcess("git", ["archive", "--format=tar", `--output=${archive}`, codeTree], { cwd: repositoryRoot });
  await execute("source-extract", python, [path.join(repositoryRoot, "scripts/offline-editions/stage-source.py"), archive, sourceRoot]);
  await fs.writeFile(path.join(sourceRoot, ".offline-build-owned"), "offline-editions.v1");
  const codeSha256 = await semanticHash({ codeTree, buildContract: "offline-edition-build.v1" });
  const npmCli = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  const fallbackNpm = path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
  const npm = await fs.stat(npmCli).then(() => npmCli).catch(() => fallbackNpm);
  await execute("npm-ci", process.execPath, [npm, "ci"]);
  const frozenPack = path.join(stage, "pack"); await fs.cp(packRoot, frozenPack, { recursive: true, force: false, errorOnExist: true });
  await verifyPackDirectory(frozenPack, manifest.packSha256);
  await execute("web", process.execPath, [path.join(sourceRoot, "scripts/offline-editions/build-web.mjs"), frozenPack, webRoot]);
  // All native changes are confined to the positively identified isolated copy.
  await fs.unlink(path.join(sourceRoot, "capacitor.config.ts"));
  await fs.writeFile(path.join(sourceRoot, "capacitor.config.json"), stableJson({ appId: identity.applicationId, appName: identity.label, webDir: "dist", server: { androidScheme: "https" } }));
  const gradleFile = path.join(sourceRoot, "android/app/build.gradle");
  let gradle = await fs.readFile(gradleFile, "utf8");
  gradle = gradle.replace(`applicationId "${TEACHER_ANDROID_APPLICATION_ID}"`, `applicationId "${identity.applicationId}"`)
    .replace(/manifestPlaceholders = \[[\s\S]*?\]/, `manifestPlaceholders = [appLabel: "${identity.label}"]`)
    .replace("versionCode 1", `versionCode ${identity.versionCode}`).replace('versionName "1.0"', `versionName "${identity.versionName}"`);
  await fs.writeFile(gradleFile, gradle);
  const nativeManifest = path.join(sourceRoot, "android/app/src/main/AndroidManifest.xml");
  await fs.writeFile(nativeManifest, (await fs.readFile(nativeManifest, "utf8")).replace('android:name=".MainActivity"', `android:name="${identity.mainActivity}"`));
  await execute("capacitor", process.execPath, [path.join(sourceRoot, "node_modules/@capacitor/cli/bin/capacitor"), "sync", "android"]);
  await fs.writeFile(path.join(sourceRoot, "android/local.properties"), `sdk.dir=${sdkRoot.replaceAll("\\", "\\\\").replace(":", "\\:")}\n`);
  await execute("gradle", java, ["-classpath", path.join(sourceRoot, "android/gradle/wrapper/gradle-wrapper.jar"), "org.gradle.wrapper.GradleWrapperMain", "--no-daemon", "assembleDebug"], path.join(sourceRoot, "android"));
  const apkPath = path.join(artifactRoot, `ultimate-b2-${manifest.selection.editionId}-teacher-debug.apk`);
  await fs.copyFile(path.join(sourceRoot, "android/app/build/outputs/apk/debug/app-debug.apk"), apkPath);
  const verification = await verifyEditionApk({ apkPath, webRoot, readbackRoot: path.join(stage, "readback"), identity, expectedPackHash: manifest.packSha256, repositoryRoot: sourceRoot, sdkRoot, java, python });
  signal?.throwIfAborted();
  const receipt = { schemaVersion: "offline-edition-build.v1", kind: "debug-local-review", builtAt: new Date().toISOString(), codeSha256, codeTree,
    lockfileSha256: await hashFile(path.join(sourceRoot, "package-lock.json")), node: process.versions.node, packSha256: manifest.packSha256, selection: manifest.selection, verification };
  await fs.writeFile(path.join(artifactRoot, "build-receipt.json"), stableJson(receipt), { flag: "wx" });
  await fs.rename(artifactRoot, destination);
  onStage("complete"); return { apkPath: path.join(destination, path.basename(apkPath)), receipt, stage };
}
