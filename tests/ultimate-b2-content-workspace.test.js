import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "./_vite-test-server.mjs";

import {
  assertStudentSafe,
  copyFileIfMissingOrIdentical,
  normalizeWorkspaceRelativePath,
  repositoryFileTarget,
  resolveInsideWorkspace,
  resolveUltimateB2ContentRoot,
  sha256,
  studentPrivateFieldFindings,
  verifyFileRecord,
  writeAuthoringJson,
} from "../scripts/ultimate-b2/content-workspace.mjs";
import { ultimateB2ListeningBuilderPlugin } from "../scripts/ultimate-b2/listening-builder-vite-plugin.mjs";
import listeningAuthoring from "../src/data/ultimate-b2/authoring/unit-01-reading-exercise-2.listening.json" with { type: "json" };

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hhplms-b2-workspace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("workspace root is server-side, absolute, non-UNC, and optional for repository-only development", () => {
  const nativeAbsolutePath = process.platform === "win32" ? "C:\\content\\B2" : "/content/B2";
  assert.equal(resolveUltimateB2ContentRoot({}), null);
  assert.equal(resolveUltimateB2ContentRoot({ ULTIMATE_B2_CONTENT_ROOT: nativeAbsolutePath }), path.resolve(nativeAbsolutePath));
  assert.throws(() => resolveUltimateB2ContentRoot({ ULTIMATE_B2_CONTENT_ROOT: "relative/B2" }), /absolute local path/);
  assert.throws(() => resolveUltimateB2ContentRoot({ ULTIMATE_B2_CONTENT_ROOT: "\\\\server\\share\\B2" }), /UNC/);
});

test("workspace relative paths reject traversal, absolute paths, UNC paths, and empty segments", () => {
  assert.equal(normalizeWorkspaceRelativePath("students-book/pages/unit-01/page.png"), "students-book/pages/unit-01/page.png");
  for (const unsafe of ["../secret", "pages/../secret", "C:\\secret", "/secret", "//server/share", "pages//file"]) {
    assert.throws(() => normalizeWorkspaceRelativePath(unsafe), /workspace-relative|unsafe path segment/i);
  }
});

test("workspace resolution rejects a symlink escape", async (t) => {
  const parent = await temporaryRoot(t);
  const root = path.join(parent, "workspace");
  const outside = path.join(parent, "outside");
  await mkdir(root); await mkdir(outside);
  await symlink(outside, path.join(root, "escape"), "junction");
  await assert.rejects(resolveInsideWorkspace(root, "escape/private.json", { allowMissing: true }), /symlink outside/);
});

test("student projections recursively reject authoritative solution concepts", () => {
  assert.deepEqual(studentPrivateFieldFindings({ runtime: { prompt: "Answer this", attempt: { feedback: "Try again" } } }), []);
  for (const value of [
    { acceptedAnswers: ["x"] }, { nested: { correctOptionId: "b" } }, { modelAnswers: {} }, { teacherSolutions: [] }, { option: { isCorrect: true } },
    { source: { kind: "private" } }, { revealedWord: "secret" }, { revealText: "secret" }, { iwbSha256: "secret" },
  ]) assert.throws(() => assertStudentSafe(value), /private solution fields/);
});

test("copy is idempotent and refuses to overwrite different canonical bytes", async (t) => {
  const root = await temporaryRoot(t);
  const source = path.join(root, "source.txt");
  const destination = path.join(root, "workspace", "copy.txt");
  await writeFile(source, "canonical");
  assert.equal((await copyFileIfMissingOrIdentical(source, destination)).copied, true);
  assert.equal((await copyFileIfMissingOrIdentical(source, destination)).copied, false);
  await writeFile(source, "different");
  await assert.rejects(copyFileIfMissingOrIdentical(source, destination), /Refusing to overwrite/);
});

test("workspace-first authoring writes the same deterministic repository projection and never deletes unknown files", async (t) => {
  const root = await temporaryRoot(t);
  const workspace = path.join(root, "workspace");
  const repository = path.join(root, "repository");
  await mkdir(workspace); await mkdir(repository);
  const unknown = path.join(repository, "unknown.bin");
  await writeFile(unknown, "preserve");
  const target = repositoryFileTarget(path.join(repository, "hotspots.json"), workspace, "students-book/hotspots/hotspots.json");
  await writeAuthoringJson(target, { schemaVersion: "1.0", pages: {} }, { workspaceRoot: workspace, operation: "test" });
  assert.equal(await readFile(target.canonicalPath, "utf8"), await readFile(target.projectionPath, "utf8"));
  assert.equal(await readFile(unknown, "utf8"), "preserve");
});

test("a real Builder endpoint reads canonical workspace state and writes its repository projection", async (t) => {
  const root = await temporaryRoot(t);
  const workspace = path.join(root, "workspace");
  const repositoryProjection = path.join(root, "repository", "listening.json");
  const canonical = path.join(workspace, "students-book", "activities", "unit-01", "ultimate-b2-sb-u1-p2-o2", "source-private", "authoring", "unit-01-reading-exercise-2.listening.json");
  await mkdir(path.dirname(canonical), { recursive: true });
  await mkdir(path.dirname(repositoryProjection), { recursive: true });
  await writeFile(canonical, `${JSON.stringify(listeningAuthoring, null, 2)}\n`);
  await writeFile(repositoryProjection, "{}\n");
  const server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    plugins: [ultimateB2ListeningBuilderPlugin({ listeningPath: repositoryProjection, environment: { ULTIMATE_B2_CONTENT_ROOT: workspace } })],
    server: { host: "127.0.0.1", port: 0 },
  });
  t.after(() => server.close());
  await server.listen();
  const address = server.httpServer.address();
  const endpoint = `http://127.0.0.1:${address.port}/__hhplms/ultimate-b2-listening-authoring`;
  const loaded = await fetch(endpoint).then((response) => response.json());
  assert.equal(loaded.activityId, listeningAuthoring.activityId);
  const edited = structuredClone(loaded);
  edited.karaoke.cues[0].startMs += 1;
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edited) });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(await readFile(canonical, "utf8")), edited);
  assert.deepEqual(JSON.parse(await readFile(repositoryProjection, "utf8")), edited);
});

test("manifest records validate by size and SHA-256", async (t) => {
  const root = await temporaryRoot(t);
  const file = path.join(root, "student-runtime", "activity.json");
  await mkdir(path.dirname(file), { recursive: true });
  const bytes = Buffer.from('{"activityId":"ultimate-b2-sb-u1-p1-o1"}\n');
  await writeFile(file, bytes);
  const record = { workspacePath: "student-runtime/activity.json", sizeBytes: bytes.length, sha256: sha256(bytes) };
  assert.equal(await verifyFileRecord(root, record), true);
  await writeFile(file, "changed");
  await assert.rejects(verifyFileRecord(root, record), /checksum mismatch/);
});

test("student offline aliases retain null solutions and no Teacher answer UI", async () => {
  const vite = await readFile(new URL("../vite.config.js", import.meta.url), "utf8");
  const noSolutions = await readFile(new URL("../src/apps/android-teacher-offline/noOfflineSolutions.js", import.meta.url), "utf8");
  const bundleVerifier = await readFile(new URL("../scripts/android/verify-student-bundle.mjs", import.meta.url), "utf8");
  assert.match(vite, /android-offline\/NoTeacherAnswerUi\.jsx/);
  assert.match(vite, /android-teacher-offline\/noOfflineSolutions\.js/);
  assert.match(noSolutions, /return null/);
  assert.doesNotMatch(noSolutions, /teacher-solutions\.json|acceptedAnswers|correctOptionId/);
  assert.match(bundleVerifier, /decoded-publisher-iwb\|iwbSha256/);
  assert.match(bundleVerifier, /Complete Sentences authoritative answer map/);
  assert.match(bundleVerifier, /Debate Club publisher model response/);
});
