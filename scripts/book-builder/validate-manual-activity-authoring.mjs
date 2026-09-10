import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";
import { createServer } from "../../tests/_vite-test-server.mjs";

import { isPathWithin } from "../../lib/book-builder/path-safety.js";
import { rescanProject } from "../../lib/book-builder/scanner-service.js";
import { bookBuilderReviewStudioPlugin } from "./review-studio-api.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const projectFiles = {
  studentCandidates: "profiles/ultimate-air-v2/student-activity-candidates.json",
  teacherCandidates: "profiles/ultimate-air-v2/internal/teacher-solution-candidates.json",
  hierarchy: "profiles/ultimate-air-v2/component-hierarchy.json",
  reviewQueue: "review-queue.json",
};

function args(argv) { const out = {}; for (let index = 0; index < argv.length; index += 1) { const item = argv[index]; if (!item.startsWith("--")) throw new Error(`Unexpected argument: ${item}`); const [key, inline] = item.slice(2).split("=", 2); out[key] = inline ?? argv[++index]; } return out; }
async function json(file) { return JSON.parse(await fs.readFile(file, "utf8")); }
async function sha(file) { const value = await fs.readFile(file).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error)); return value ? createHash("sha256").update(value).digest("hex") : null; }
async function hashes(root, files) { return Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relative]) => [key, await sha(path.join(root, relative))]))); }
function nodeId(prefix) { return `${prefix}_${randomUUID()}`; }
function mutationId(label) { return `${label}_${randomUUID()}`; }

async function projects(workspace) {
  const root = path.join(workspace, "projects"); const output = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) if (entry.isDirectory() && !entry.isSymbolicLink()) { const project = await json(path.join(root, entry.name, "book-project.json")).catch(() => null); if (project) output.push({ id: project.projectId, directory: path.join(root, entry.name), project }); }
  const b1plus = output.find((item) => /B1\+/i.test(item.project.sourceDescriptor?.label || ""));
  const b2 = output.find((item) => /\bB2\b/i.test(item.project.sourceDescriptor?.label || ""));
  const b1 = output.find((item) => /\bB1\b/i.test(item.project.sourceDescriptor?.label || "") && item !== b1plus);
  if (!b1plus || !b2 || !b1) throw new Error("Validation workspace must contain B1+, B2 and held-out B1 projects");
  return { b1plus, b2, b1 };
}

async function sourceProtection(project) {
  const binding = await json(path.join(project.directory, "local-source-binding.json")); const root = binding.canonicalApplicationRealPath;
  const pages = await json(path.join(project.directory, "profiles/ultimate-air-v2/page-candidates.json")); const media = await json(path.join(project.directory, "profiles/ultimate-air-v2/media-candidates.json"));
  const page = pages.spreads.flatMap((spread) => spread.variants || [])[0]?.sourceRelativePath; const audio = media.candidates.find((item) => item.type === "audio")?.sourceRelativePath; const video = media.candidates.find((item) => item.type === "video")?.sourceRelativePath;
  const relative = { applicationXml: project.project.sourceDescriptor.descriptorPath, mainSwf: project.project.sourceDescriptor.mainSwfPath, representativePage: page, representativeAudio: audio, representativeVideo: video };
  return { root, relative, hashes: await hashes(root, relative) };
}

async function start(workspace, writeEnabled) {
  const server = await createServer({ root: repositoryRoot, configFile: path.join(repositoryRoot, "vite.config.js"), appType: "mpa", logLevel: "error", plugins: [bookBuilderReviewStudioPlugin({ workspace, writeEnabled })], server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await server.listen(); return { server, origin: `http://127.0.0.1:${server.httpServer.address().port}` };
}

async function session(origin) { const response = await fetch(`${origin}/__hhplms/book-builder/bootstrap`, { headers: { Origin: origin } }); assert.equal(response.status, 200); return response.json(); }
function client(origin, auth) {
  const headers = { Origin: origin, "X-HHPLMS-Book-Builder-Session": auth.sessionToken, ...(auth.writeCapability ? { "X-HHPLMS-Book-Builder-Write-Capability": auth.writeCapability } : {}) };
  return async (method, pathname, body, expected = 200) => { const response = await fetch(`${origin}/__hhplms/book-builder${pathname}`, { method, headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const payload = await response.json().catch(() => null); assert.equal(response.status, expected, `${method} ${pathname}: ${JSON.stringify(payload)}`); return payload; };
}

function base(type, hierarchy, title, content, assetReferences = []) { const now = new Date().toISOString(); return { schemaVersion: "1.0", activityId: nodeId("manual_activity"), status: "draft", sourceMode: "manual", hierarchy, type, title, instructions: "Publisher validation activity.", content, presentation: { viewportMode: type === "scrollable_panel" ? "vertical_scroll" : "fit", viewportSizeMode: "responsive", backgroundReviewRequired: type === "image_backed" }, assetReferences, dependencyFactIds: [], dependencyEvidenceHashes: {}, stale: false, staleReasons: [], createdAt: now, updatedAt: now }; }
function reference(asset) { return { assetId: asset.assetId, role: asset.role, mimeType: asset.mimeType, sourceRelativeIdentity: asset.sourceRelativeIdentity, digest: asset.digest, stale: asset.stale }; }

async function context(call, id) { const activities = await call("GET", `/projects/${id}/manual-activities`); const assets = await call("GET", `/projects/${id}/manual-assets`); const component = activities.hierarchyOptions.find((item) => item.groups.length) || activities.hierarchyOptions[0]; const group = component.groups[0]; return { revision: activities.revision, activities, assets: assets.items, hierarchy: { sourceBookRootKey: component.sourceBookRootKey, componentKey: component.componentKey, effectiveComponentRole: component.effectiveComponentRole, unitGroupKey: group.unitGroupKey, unitGroupNumber: group.unitGroupNumber, part: null, hotspotCandidateIds: [] } }; }
async function create(call, id, activity, revision) { const preview = await call("POST", `/projects/${id}/manual-activities/preview`, { activity }); assert.equal(preview.validation.valid, true, JSON.stringify(preview.validation)); return call("POST", `/projects/${id}/manual-activities/create`, { activity, expectedRevision: revision, clientMutationId: mutationId("create") }); }

async function authorB1Plus(call, project) {
  let current = await context(call, project.id); const created = [];
  const questionId = nodeId("question"), firstOption = nodeId("option"), secondOption = nodeId("option");
  const multipleChoice = base("multiple_choice", current.hierarchy, "4D1 Multiple choice", { questions: [{ id: questionId, prompt: "Which option completes the validation?", options: [{ id: firstOption, text: "First" }, { id: secondOption, text: "Second" }] }] });
  let result = await create(call, project.id, multipleChoice, current.revision); current.revision = result.revision; created.push(multipleChoice.activityId);
  const solution = { schemaVersion: "1.0", activityId: multipleChoice.activityId, type: "multiple_choice", solutions: { questions: [{ questionId, correctOptionId: secondOption }] }, updatedAt: new Date().toISOString() };
  result = await call("POST", `/projects/${project.id}/manual-solutions/update`, { activityId: multipleChoice.activityId, solution, expectedRevision: current.revision, clientMutationId: mutationId("solution") }); current.revision = result.revision;
  multipleChoice.status = "approved"; result = await call("POST", `/projects/${project.id}/manual-activities/update`, { activity: multipleChoice, expectedRevision: current.revision, clientMutationId: mutationId("approve") }); current.revision = result.revision;

  const gapId = nodeId("item"), responseFieldId = nodeId("field"); const typed = base("typed_gap_fill", current.hierarchy, "4D1 Typed gap", { items: [{ id: gapId, prompt: "Complete: Publisher ____.", responseFieldId, displayGuidance: { case: "case insensitive", punctuation: "ignore trailing punctuation" } }] });
  result = await create(call, project.id, typed, current.revision); current.revision = result.revision; created.push(typed.activityId);
  const open = base("open_answer", current.hierarchy, "4D1 Open answer", { prompt: "Explain the learning objective.", responseGuidance: "Use one sentence." }); result = await create(call, project.id, open, current.revision); current.revision = result.revision; created.push(open.activityId);

  const audio = current.assets.find((item) => item.role === "audio"); const background = current.assets.find((item) => item.role === "background"); assert.ok(audio, "verified detected audio is required"); assert.ok(background, "page raster is required");
  const audioActivity = base("media_audio", current.hierarchy, "4D1 Existing audio", { assetId: audio.assetId, transcript: "Existing detected audio for validation." }, [reference(audio)]); result = await create(call, project.id, audioActivity, current.revision); current.revision = result.revision; created.push(audioActivity.activityId);
  const scroll = base("scrollable_panel", current.hierarchy, "4D1 Scrollable image and text", { blocks: [{ id: nodeId("block"), kind: "text", text: "Scrollable Publisher-authored content." }, { id: nodeId("block"), kind: "image", assetId: background.assetId, altText: "Existing page raster" }], linkedAudioAssetId: audio.assetId }, [reference(background), reference(audio)]); result = await create(call, project.id, scroll, current.revision); current.revision = result.revision; created.push(scroll.activityId);
  const choiceField = nodeId("field"), textField = nodeId("field"), mediaField = nodeId("field"); const image = base("image_backed", current.hierarchy, "4D1 Image-backed", { backgroundAssetId: background.assetId, fields: [{ id: choiceField, kind: "single_choice", geometry: { x: .08, y: .1, width: .36, height: .12 }, prompt: "Choose", options: [{ id: nodeId("option"), text: "A" }, { id: nodeId("option"), text: "B" }] }, { id: textField, kind: "text_input", geometry: { x: .08, y: .3, width: .36, height: .1 }, prompt: "Type" }, { id: mediaField, kind: "media_trigger", geometry: { x: .6, y: .1, width: .15, height: .12 }, assetId: audio.assetId }] }, [reference(background), reference(audio)]); result = await create(call, project.id, image, current.revision); current.revision = result.revision; created.push(image.activityId);

  const raster = current.activities.detectedCandidates.find((item) => item.rasterGap); assert.ok(raster, "detected raster-gap candidate is required"); const prefill = await call("POST", `/projects/${project.id}/manual-activities/prefill`, { activityCandidateId: raster.activityCandidateId }); const prefilled = prefill.activity; const preview = await call("POST", `/projects/${project.id}/manual-activities/preview`, { activity: prefilled }); assert.equal(prefilled.status, "draft"); assert.equal(prefilled.sourceMode, "detected_candidate_prefill"); assert.equal(preview.validation.warnings.length > 0, true); assert.doesNotMatch(JSON.stringify(prefilled), /correctOptionId|acceptedValues|teacherSolution/); result = await call("POST", `/projects/${project.id}/manual-activities/create`, { activity: prefilled, expectedRevision: current.revision, clientMutationId: mutationId("prefill") }); current.revision = result.revision; created.push(prefilled.activityId);

  const clone = await call("POST", `/projects/${project.id}/manual-activities/clone`, { activityId: multipleChoice.activityId, expectedRevision: current.revision, clientMutationId: mutationId("clone") }); current.revision = clone.revision;
  const archived = await call("POST", `/projects/${project.id}/manual-activities/archive`, { activityId: clone.activity.activityId, expectedRevision: current.revision, clientMutationId: mutationId("archive") }); current.revision = archived.revision;
  const conflict = await call("POST", `/projects/${project.id}/manual-activities/archive`, { activityId: typed.activityId, expectedRevision: current.revision - 1, clientMutationId: mutationId("conflict") }, 409); assert.equal(conflict.error.code, "project_revision_conflict");
  return { created, approved: multipleChoice.activityId, revision: current.revision, conflict: conflict.error.code, audio: audio.sourceRelativeIdentity, background: background.sourceRelativeIdentity };
}

async function smoke(call, project) { const current = await context(call, project.id); const activity = base("open_answer", current.hierarchy, `4D1 ${project.project.sourceDescriptor.label} smoke`, { prompt: "Confirm cross-title manual creation.", responseGuidance: "" }); const result = await create(call, project.id, activity, current.revision); return { activityId: activity.activityId, revision: result.revision }; }

async function main() {
  const options = args(process.argv.slice(2)); if (!options.workspace || !options["reference-root"]) throw new Error("Use --workspace <validation-root> --reference-root <original-projects-root>");
  const workspace = await fs.realpath(path.resolve(options.workspace)); const referenceRoot = await fs.realpath(path.resolve(options["reference-root"])); assert.equal(isPathWithin(repositoryRoot, workspace), false, "Validation workspace must be outside the repository"); assert.notEqual(workspace, referenceRoot);
  const selected = await projects(workspace); const referenceDirectory = path.join(referenceRoot, path.basename(selected.b1plus.directory)); const originalBefore = { revision: (await json(path.join(referenceDirectory, "book-project.json"))).revision, hash: await sha(path.join(referenceDirectory, "book-project.json")) };
  const sourceBefore = await sourceProtection(selected.b1plus); const generatedBefore = await hashes(selected.b1plus.directory, projectFiles); const validationBefore = { revision: selected.b1plus.project.revision, hash: await sha(path.join(selected.b1plus.directory, "book-project.json")) };
  let studio = await start(workspace, true); let workflow; try { const call = client(studio.origin, await session(studio.origin)); workflow = await authorB1Plus(call, selected.b1plus); workflow.b2 = await smoke(call, selected.b2); workflow.b1 = await smoke(call, selected.b1); } finally { await studio.server.close(); }
  const rescan = await rescanProject({ projectDirectory: selected.b1plus.directory, repositoryRoot }); assert.equal(rescan.diff.added.length + rescan.diff.changed.length + rescan.diff.removed.length, 0);
  studio = await start(workspace, true); try { const call = client(studio.origin, await session(studio.origin)); const persisted = await call("GET", `/projects/${selected.b1plus.id}/manual-activities`); assert.equal(persisted.items.length >= 8, true); assert.equal(persisted.items.some((item) => item.activityId === workflow.approved), true); workflow.restartCount = persisted.items.length; workflow.revisionAfterRescan = persisted.revision; } finally { await studio.server.close(); }
  studio = await start(workspace, false); let browser; try { const auth = await session(studio.origin); const call = client(studio.origin, auth); const readonly = await call("GET", `/projects/${selected.b1plus.id}/manual-activities`); assert.equal(readonly.readOnly, true); assert.deepEqual(readonly.items.map((item) => item.activityId), [workflow.approved]); await call("GET", `/projects/${selected.b1plus.id}/manual-solutions/${workflow.approved}`, null, 403); browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); await page.goto(`${studio.origin}/builder.html#/projects/${selected.b1plus.id}/manual`, { waitUntil: "domcontentloaded" }); await page.getByText("Approved Student view").waitFor(); await page.getByRole("button", { name: /4D1 Multiple choice/ }).click(); await page.getByText("Read-only Student preview").waitFor(); assert.equal(await page.locator(".studio-teacher-boundary").count(), 0); workflow.readOnly = { visibleApproved: readonly.items.length, teacherRouteStatus: 403, studentPreview: true }; } finally { await browser?.close(); await studio.server.close(); }
  const studentText = await fs.readFile(path.join(selected.b1plus.directory, "authoring/manual-activities.json"), "utf8"); const teacherText = await fs.readFile(path.join(selected.b1plus.directory, "internal/manual-activity-solutions.json"), "utf8"); assert.doesNotMatch(studentText, /correctOptionId|acceptedValues/); assert.match(teacherText, /correctOptionId/);
  const sourceAfter = await sourceProtection({ ...selected.b1plus, project: await json(path.join(selected.b1plus.directory, "book-project.json")) }); const generatedAfter = await hashes(selected.b1plus.directory, projectFiles); const originalAfter = { revision: (await json(path.join(referenceDirectory, "book-project.json"))).revision, hash: await sha(path.join(referenceDirectory, "book-project.json")) }; assert.deepEqual(originalAfter, originalBefore); assert.deepEqual(sourceAfter.hashes, sourceBefore.hashes); assert.deepEqual(generatedAfter, generatedBefore);
  const finalProject = await json(path.join(selected.b1plus.directory, "book-project.json")); const report = { schemaVersion: "1.0", status: "manual-activity-authoring-real-validation-safe", workspaceLabel: path.basename(workspace), projects: { b1plus: selected.b1plus.id, b2: selected.b2.id, b1: selected.b1.id }, before: { original: originalBefore, validation: validationBefore, source: sourceBefore.hashes, generated: generatedBefore }, workflow, after: { original: originalAfter, validation: { revision: finalProject.revision, hash: await sha(path.join(selected.b1plus.directory, "book-project.json")), studentHash: await sha(path.join(selected.b1plus.directory, "authoring/manual-activities.json")), teacherHash: await sha(path.join(selected.b1plus.directory, "internal/manual-activity-solutions.json")) }, source: sourceAfter.hashes, generated: generatedAfter }, protection: { originalUnchanged: true, sourceUnchanged: true, generatedArtifactsUnchanged: true, studentTeacherSeparated: true, rescanUnchanged: true } };
  const reportPath = path.join(workspace, "manual-activity-authoring-validation-report.json"); await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" }); process.stdout.write(`${JSON.stringify({ ...report, reportPath }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
