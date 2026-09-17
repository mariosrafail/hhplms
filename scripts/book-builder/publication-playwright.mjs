import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import { chromium, expect } from "@playwright/test";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { canonicalStudentsBookPages } from "../../netlify-sites/ultimate-b2-builder/server/_builder-page-catalog.js";
import { compileUltimateB2ManagedComponentRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-managed-publication-compiler.js";
import { productReleaseMemberSha256, productReleaseSha256, productReleaseSourceSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication-domain.js";
import { createBuilderPreviewAuthorizationHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-preview-authorization-handler.js";
import { classifyBuilderPreviewAuthorization, inspectBuilderPreviewAuthorizationScope, issueBuilderPreviewAuthorization, issueBuilderReleaseMemberAuthorization } from "../../netlify-sites/ultimate-b2-builder/server/_builder-preview-authorization.js";
import { compileUltimateB2ComponentReleaseV2 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { createBuilderPublicationHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication.js";
import { createBuilderProductPublicationHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication.js";
import { servePinnedReleaseSourceAsset } from "../../netlify-sites/ultimate-b2-builder/server/_builder-release-source-delivery.js";
import { componentPublicationCanonicalPrivateSourceObjectKey } from "../../lib/book-assets/publication-asset-storage.js";
import { resolveNativeActivityKind } from "../../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { createNativeOpenResponseQuestion } from "../../src/data/native-activities/nativeOpenResponse.js";
import { nativeChildIdFromUuid } from "../../src/data/native-activities/nativeChildIdentity.js";
import { createPublicationV2FixtureSources, publicationV2Fixture } from "../../tests/fixtures/publication-v2.js";
import { localPlaywrightLaunchOptions } from "../android-teacher/playwright-launch-options.mjs";

const builderRoot = path.resolve("dist-netlify/ultimate-b2-builder");
const viewerRoot = path.resolve("dist-netlify/ultimate-b2-interactive");
const activityId = publicationV2Fixture.openResponseId;
const imageActivityId = publicationV2Fixture.imageId;
const dragDropActivityId = publicationV2Fixture.dragDropId;
const listeningActivityId = "ultimate-b2-sb-u1-p1-o95";
const listeningAudio = { assetId: "10000000-0000-4000-8000-000000000051", checksumSha256: "e".repeat(64), role: "activity_artwork", slot: "publication-listening-audio" };
const listeningBackground = { assetId: "10000000-0000-4000-8000-000000000052", checksumSha256: "f".repeat(64), role: "activity_artwork", slot: "publication-listening-background" };
const managedActivityIds = Object.freeze({
  "ultimate-b2-workbook": "ultimate-b2-wb-unit-1-page-1-o1",
  "ultimate-b2-grammar-book": "ultimate-b2-gb-unit-1-page-1-o1",
});
const managedTeacherSentinels = Object.freeze({
  "ultimate-b2-workbook": "WORKBOOK_PUBLICATION_PRIVATE_TEACHER_SENTINEL",
  "ultimate-b2-grammar-book": "GRAMMAR_PUBLICATION_PRIVATE_TEACHER_SENTINEL",
});
const unitExtraMp4 = await readFile(path.resolve("src/assets/books/ultimate-b2/teacher-offline-media/ultimate-b2-startup-intro.mp4"));
const releaseIds = ["10000000-0000-4000-8000-000000000091", "10000000-0000-4000-8000-000000000092"];
const productReleaseIds = ["20000000-0000-4000-8000-000000000091", "20000000-0000-4000-8000-000000000092"];
const publication = "/builder/api/publication/books/ultimate-b2";
const builderPages = "/builder/api/pages/books/ultimate-b2/components/ultimate-b2-students-book";
const mime = { ".css": "text/css", ".gaf": "application/octet-stream", ".html": "text/html", ".jpg": "image/jpeg", ".js": "text/javascript", ".json": "application/json", ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".pdf": "application/pdf", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
let savedPrompt = "Draft version A";
let sourceVersion = 1;
let headRevision = 0;
let activeReleaseId = null;
let publicationFailure = null;
let preparedUuidQueue = [];
let copyObjectCalls = 0;
const releases = [];
const legacyReleases = [];
const viewerReleaseRequests = [];
const releaseMemberExchangeRequests = [];
const rawStorageRequests = [];
const immutableViewerRequests = [];
const previewEnvironment = { BUILDER_PREVIEW_AUTH_SECRET: "product-publication-browser-secret-with-at-least-thirty-two-bytes" };
const lifecycleState = {
  cleanupStarted: false,
  browserDisconnected: false,
  contextClosed: false,
  pages: new Map(),
};

function lifecyclePhase() {
  return lifecycleState.cleanupStarted ? "expected-cleanup" : "unexpected-runtime";
}

function safeDiagnosticText(value) {
  return String(value ?? "")
    .replaceAll(publicationV2Fixture.teacherSentinel, "[teacher-private-redacted]")
    .replace(/v[123]\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[token]")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[A-Za-z]:\\[^\s)]+/g, "[path]")
    .replace(/\/(?:home|Users|tmp)\/[^\s)]+/g, "[path]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 240);
}

function lifecycle(event, fields = {}) {
  const details = Object.entries(fields)
    .map(([key, value]) => `${key}=${safeDiagnosticText(value)}`)
    .join(" ");
  process.stderr.write(`[publication-lifecycle] ${new Date().toISOString()} ${event}${details ? ` ${details}` : ""}\n`);
}

function observePage(page, label) {
  const state = { closed: false, crashed: false };
  lifecycleState.pages.set(label, state);
  page.on("close", () => {
    state.closed = true;
    lifecycle("page-close", { page: label, phase: lifecyclePhase() });
  });
  page.on("crash", () => {
    state.crashed = true;
    lifecycle("page-crash", { page: label, phase: lifecyclePhase() });
  });
  page.on("pageerror", (error) => lifecycle("page-error", {
    page: label,
    phase: lifecyclePhase(),
    name: error?.name || "Error",
    message: error?.message || "unknown",
  }));
  lifecycle("page-created", { page: label });
  return page;
}

process.on("uncaughtExceptionMonitor", (error, origin) => lifecycle("process-uncaught-exception", {
  origin,
  name: error?.name || "Error",
  message: error?.message || "unknown",
}));
process.on("exit", (code) => lifecycle("process-exit", { code, phase: lifecyclePhase() }));
lifecycle("process-start", { platform: process.platform, arch: process.arch, node: process.version });

function projection(prompt) {
  const sources = createPublicationV2FixtureSources({ prompt });
  const questionId = `q-${"5".repeat(32)}`; const cueOne = `cue-${"6".repeat(32)}`; const cueTwo = `cue-${"7".repeat(32)}`;
  const publicDocument = {
    schemaVersion: "1.0", activityId: listeningActivityId, kind: "listening", metadata: { title: "Published Listening Panels", visibleInstructionText: "" }, placement: { pageId: publicationV2Fixture.pageId }, assets: [listeningAudio, listeningBackground],
    parts: [{ id: "part-1", interaction: { kind: "listening", audioAssetSlot: listeningAudio.slot, audioDurationMs: 12_000, panels: [{ id: "panel-1", kind: "questions", sourceWidth: 1024, sourceHeight: 582 }, { id: "panel-2", kind: "synchronized-transcript", backgroundAssetSlot: listeningBackground.slot, sourceWidth: 1000, sourceHeight: 1800, transcriptArea: { x: 100, y: 120, width: 800, height: 1500 } }], questions: [{ id: questionId, prompt: "Published listening question" }], cues: [{ id: cueOne, startMs: 0, endMs: 3_000, text: "Published transcript first line" }, { id: cueTwo, startMs: 4_000, endMs: 8_000, text: "Published transcript second line" }], snippetHotspots: [{ id: `aud-${"8".repeat(32)}`, area: { x: 900, y: 30, width: 48, height: 48 }, cueIds: [cueOne], label: "Open published transcript" }] } }],
  };
  const teacherDocument = { schemaVersion: "1.0", activityId: listeningActivityId, kind: "listening", parts: [{ id: "part-1", solution: { kind: "listening", modelAnswers: [{ questionId, text: "Published listening teacher answer" }] } }] };
  const entry = { activityId: listeningActivityId, kind: "listening", placement: { pageId: publicationV2Fixture.pageId }, sortOrder: 5 };
  const source = (payload, revision = 1) => ({ payload, revision, sha256: builderDocumentSha256(payload) });
  sources.native.index.payload.activities.push(entry); sources.native.index = source(sources.native.index.payload, sources.native.index.revision);
  sources.native.activities[listeningActivityId] = { index: entry, public: source(publicDocument), teacher: source(teacherDocument) };
  sources.documents.hotspots.payload.pages[publicationV2Fixture.pageId].push({ id: "hotspot-native-listening", unitNumber: 1, pageId: publicationV2Fixture.pageId, pageNumber: 5, left: 68, top: 4, width: 12, height: 12, label: "Published Listening Panels", actionType: "normalized_activity", activityKey: listeningActivityId });
  sources.documents.hotspots = source(sources.documents.hotspots.payload, sources.documents.hotspots.revision);
  sources.native.assetRows.push(
    { id: listeningAudio.assetId, checksum_sha256: listeningAudio.checksumSha256, asset_role: listeningAudio.role, object_key: "builder-native-assets/publication-listening.mp3", storage_profile: "private", storage_bucket: "private", mime_type: "audio/mpeg", byte_size: 32_000, duration_seconds: 12, width: null, height: null, publication_status: "draft", access_level: "internal", source_metadata: { native_activity_id: listeningActivityId, asset_slot: listeningAudio.slot } },
    { id: listeningBackground.assetId, checksum_sha256: listeningBackground.checksumSha256, asset_role: listeningBackground.role, object_key: "builder-native-assets/publication-listening.png", storage_profile: "private", storage_bucket: "private", mime_type: "image/png", byte_size: 68, width: 1000, height: 1800, publication_status: "draft", access_level: "internal", source_metadata: { native_activity_id: listeningActivityId, asset_slot: listeningBackground.slot } },
  );
  return canonicalizeCompiled(compileUltimateB2ComponentReleaseV2(sources), "ultimate-b2-students-book");
}
function sourceSha() { return `${sourceVersion}`.repeat(64).slice(0, 64); }

function managedProjection(componentSlug, version) {
  const componentTitle = componentSlug === "ultimate-b2-workbook" ? "Workbook" : "Grammar Book";
  const componentNumber = componentSlug === "ultimate-b2-workbook" ? 5 : 6;
  const pageId = `${componentSlug}-unit-1-page-1`;
  const activityId = managedActivityIds[componentSlug];
  const units = Array.from({ length: 10 }, (_, index) => ({
    id: `${componentNumber}0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    slug: `unit-${index + 1}`,
    title: `Unit ${index + 1}`,
    unit_number: index + 1,
    sort_order: index + 1,
  }));
  const imageChecksum = createHash("sha256").update(`${componentSlug}:version:${version}`).digest("hex");
  const kind = resolveNativeActivityKind("open-response");
  const questionId = nativeChildIdFromUuid("q", `${componentNumber}3000000-0000-4000-8000-000000000001`);
  const publicDocument = kind.createBlankPublic({ activityId, title: `${componentTitle} component activity`, placement: { pageId } });
  publicDocument.parts[0].interaction.questions = [{ ...createNativeOpenResponseQuestion(questionId), prompt: `${componentTitle} immutable activity version ${version}` }];
  const teacherDocument = kind.createBlankTeacher({ activityId });
  teacherDocument.parts[0].solution.modelAnswers = [{ questionId, text: managedTeacherSentinels[componentSlug] }];
  const indexEntry = { activityId, kind: "open-response", placement: { pageId }, sortOrder: 1 };
  const source = (payload, revision = version) => ({ payload, revision, sha256: builderDocumentSha256(payload) });
  const hotspotPayload = {
    schemaVersion: "1.0", packageSlug: "ultimate-b2", componentSlug,
    pages: { [pageId]: [{ id: `${componentSlug}-publication-activity`, unitNumber: 1, pageId, left: 4, top: 4, width: 12, height: 12, label: `${componentTitle} component activity`, actionType: "normalized_activity", activityKey: activityId }] },
  };
  return canonicalizeCompiled(compileUltimateB2ManagedComponentRelease({
    pages: {
      revision: version,
      units,
      rows: [{
        id: `${componentNumber}1000000-0000-4000-8000-000000000001`,
        stable_key: `${componentSlug}/pages/${pageId}`,
        label: `${componentTitle} immutable version ${version}`,
        sort_order: 10,
        source_metadata: { is_active: true, section_title: "Acceptance", printed_label: "1" },
        unit_id: units[0].id,
        unit_slug: units[0].slug,
        unit_title: units[0].title,
        unit_number: 1,
        unit_sort_order: 1,
        asset_id: `${componentNumber}2000000-0000-4000-8000-000000000001`,
        asset_role: "page_image",
        object_key: `managed-pages/${componentSlug}/version-${version}.png`,
        storage_profile: "private",
        storage_bucket: "private",
        publication_status: "draft",
        access_level: "internal",
        mime_type: "image/png",
        byte_size: 68,
        checksum_sha256: imageChecksum,
        width: 1,
        height: 1,
      }],
    },
    documents: { hotspots: source(hotspotPayload), activityLifecycle: null },
    native: {
      index: source({ schemaVersion: "1.0", activities: [indexEntry] }),
      activities: { [activityId]: { index: indexEntry, public: source(publicDocument), teacher: source(teacherDocument) } },
      assetRows: [],
    },
  }, componentSlug), componentSlug);
}

function canonicalizeCompiled(compiled, componentSlug) {
  for (const source of compiled.nativeAssetSources || []) {
    source.row.book_slug = "ultimate-b2";
    source.row.component_slug = componentSlug;
    source.row.storage_bucket = "private";
    source.row.object_key = componentPublicationCanonicalPrivateSourceObjectKey({ bookSlug: "ultimate-b2", componentSlug, descriptor: source.descriptor, row: source.row });
  }
  return compiled;
}

function componentReleaseRow({ id, number, componentSlug, compiled }) {
  return {
    id,
    release_number: number,
    book_slug: "ultimate-b2",
    component_slug: componentSlug,
    compiler_id: compiled.compilerId || "ultimate-b2-students-book-v2",
    release_schema_version: compiled.releaseSchemaVersion || "2.0",
    runtime_compatibility_sha256: compiled.compatibility,
    source_snapshot: compiled.sourceSnapshot,
    source_snapshot_sha256: compiled.sourceSnapshotSha256 || builderDocumentSha256(compiled.sourceSnapshot),
    public_projection: compiled.publicProjection,
    public_projection_sha256: compiled.publicProjectionSha256 || builderDocumentSha256(compiled.publicProjection),
    teacher_projection: compiled.teacherProjection,
    teacher_projection_sha256: compiled.teacherProjectionSha256 || builderDocumentSha256(compiled.teacherProjection),
    asset_manifest: compiled.assetManifest || [
      ...compiled.publicProjection.assets,
      ...Object.values(compiled.teacherProjection.ui.assets).map((asset) => ({ sha256: asset.sha256, extension: asset.extension, mediaType: asset.mediaType, role: "teacher_ui" })),
    ].sort((left, right) => `${left.sha256}.${left.extension}.${left.role}`.localeCompare(`${right.sha256}.${right.extension}.${right.role}`)),
    release_sha256: compiled.releaseSha256,
    asset_storage_mode: "pinned-source-v1",
    releasePins: [],
  };
}

function buildProductRelease(number) {
  const students = projection(savedPrompt);
  const workbook = managedProjection("ultimate-b2-workbook", sourceVersion);
  const grammar = managedProjection("ultimate-b2-grammar-book", sourceVersion);
  const ids = {
    "ultimate-b2-students-book": releaseIds[number - 1],
    "ultimate-b2-workbook": `30000000-0000-4000-8000-00000000009${number}`,
    "ultimate-b2-grammar-book": `40000000-0000-4000-8000-00000000009${number}`,
  };
  const compiledByComponent = { "ultimate-b2-students-book": students, "ultimate-b2-workbook": workbook, "ultimate-b2-grammar-book": grammar };
  const componentReleases = Object.fromEntries(Object.entries(compiledByComponent).map(([componentSlug, compiled]) => [componentSlug, componentReleaseRow({ id: ids[componentSlug], number, componentSlug, compiled })]));
  const members = Object.entries(componentReleases).map(([componentSlug, row], index) => {
    const member = { componentSlug, order: index + 1, status: "included", componentReleaseId: row.id, compilerId: row.compiler_id, releaseSchemaVersion: row.release_schema_version, releaseSha256: row.release_sha256, compatibility: row.runtime_compatibility_sha256, unavailableReason: null };
    return { ...member, memberSha256: productReleaseMemberSha256(member) };
  });
  const productSourceSha256 = productReleaseSourceSha256({ bookSlug: "ultimate-b2", releaseNumber: number, members });
  const productSha256 = productReleaseSha256({ compilerId: "ultimate-b2-product-v1", releaseSchemaVersion: "1.0", bookSlug: "ultimate-b2", releaseNumber: number, sourceSnapshotSha256: productSourceSha256, releaseNote: "", members });
  return {
    id: ids["ultimate-b2-students-book"], productReleaseId: productReleaseIds[number - 1], number,
    sourceSha: sourceSha(), createdAt: `2026-08-14T10:0${number}:00Z`, ...students,
    componentReleases, members, studentsMemberSha256: members[0].memberSha256, productSourceSha256, productSha256,
  };
}

function buildLegacyProductRelease(studentsRelease) {
  const studentsRow = { ...studentsRelease.componentReleases["ultimate-b2-students-book"], asset_storage_mode: "materialized-v1", releasePins: [] };
  const included = { componentSlug: "ultimate-b2-students-book", order: 1, status: "included", componentReleaseId: studentsRow.id, compilerId: studentsRow.compiler_id, releaseSchemaVersion: studentsRow.release_schema_version, releaseSha256: studentsRow.release_sha256, compatibility: studentsRow.runtime_compatibility_sha256, unavailableReason: null };
  const unavailable = (componentSlug, order) => ({ componentSlug, order, status: "unavailable", componentReleaseId: null, compilerId: null, releaseSchemaVersion: null, releaseSha256: null, compatibility: null, unavailableReason: "not_in_legacy_release" });
  const members = [included, unavailable("ultimate-b2-workbook", 2), unavailable("ultimate-b2-grammar-book", 3)].map((member) => ({ ...member, memberSha256: productReleaseMemberSha256(member) }));
  const number = 11;
  const productSourceSha256 = productReleaseSourceSha256({ bookSlug: "ultimate-b2", releaseNumber: number, members });
  const productSha256 = productReleaseSha256({ compilerId: "ultimate-b2-product-legacy-v1", releaseSchemaVersion: "1.0", bookSlug: "ultimate-b2", releaseNumber: number, sourceSnapshotSha256: productSourceSha256, releaseNote: "", members });
  return {
    productReleaseId: "90000000-0000-4000-8000-000000000011", number, createdAt: studentsRelease.createdAt,
    productCompilerId: "ultimate-b2-product-legacy-v1", productSourceSha256, productSha256, members,
    componentReleases: { "ultimate-b2-students-book": studentsRow },
  };
}

function productMembers(release) {
  return release.members.map((member) => ({ ...member, sourceSnapshotSha256: release.componentReleases[member.componentSlug].source_snapshot_sha256, assetStorageMode: release.componentReleases[member.componentSlug].asset_storage_mode }));
}
function metadata(release) { return { id: release.productReleaseId, number: release.number, compilerId: "ultimate-b2-product-v1", releaseSchemaVersion: "1.0", releaseSha256: release.productSha256, sourceSnapshotSha256: release.productSourceSha256, assetStorageMode: "pinned-source-v1", createdAt: release.createdAt, current: activeReleaseId === release.productReleaseId, publishedAt: activeReleaseId === release.productReleaseId ? "2026-08-14T10:05:00Z" : null, state: release.sourceSha === sourceSha() ? "current" : "stale", members: productMembers(release) }; }
function sendJson(response, statusCode, value) { const body = Buffer.from(JSON.stringify(value)); response.writeHead(statusCode, { "Cache-Control": "no-store", "Content-Length": body.length, "Content-Type": "application/json" }); response.end(body); }
async function staticResponse(root, pathname, response, fallback) { const relative = pathname === "/" ? fallback : decodeURIComponent(pathname).replace(/^\/+/, ""); let file = path.resolve(root, relative); let details = file.startsWith(`${root}${path.sep}`) ? await stat(file).catch(() => null) : null; if (!details?.isFile()) { file = path.join(root, fallback); details = await stat(file); } response.writeHead(200, { "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream", "Content-Length": details.size }); createReadStream(file).pipe(response); }

async function measureDragDrop(locator, { context: measuredContext, viewport }) {
  await locator.evaluate(async (surface) => {
    let previousSignature = "";
    let stableFrames = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const visualRect = surface.querySelector(".native-drag-drop-visual-region")?.getBoundingClientRect();
      const workspaceRect = surface.querySelector(".native-drag-drop-workspace")?.getBoundingClientRect();
      const stageRect = surface.querySelector(".native-drag-drop-stage")?.getBoundingClientRect();
      if (!visualRect || !workspaceRect || !stageRect) continue;
      const signature = [visualRect.width, visualRect.height, workspaceRect.height, stageRect.width, stageRect.height].map((value) => value.toFixed(2)).join(":");
      const stageInsideVisual = stageRect.left >= visualRect.left - 1 && stageRect.right <= visualRect.right + 1 && stageRect.top >= visualRect.top - 1 && stageRect.bottom <= visualRect.bottom + 1;
      stableFrames = stageInsideVisual && signature === previousSignature ? stableFrames + 1 : 0;
      previousSignature = signature;
      if (stableFrames >= 2) return;
    }
  });
  const measurement = await locator.evaluate((surface, context) => {
    const snapshot = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
      return { element: element.tagName.toLowerCase(), className: typeof element.className === "string" ? element.className : "", width: Math.round(rect.width * 100) / 100, height: Math.round(rect.height * 100) / 100, minWidth: style.minWidth, minHeight: style.minHeight, maxWidth: style.maxWidth, maxHeight: style.maxHeight, display: style.display, gridTemplateRows: style.gridTemplateRows, alignSelf: style.alignSelf, overflow: style.overflow, overflowX: style.overflowX, overflowY: style.overflowY };
    };
    const visualElement = surface.querySelector(".native-drag-drop-visual-region"); const workspaceElement = surface.querySelector(".native-drag-drop-workspace"); const stageSlotElement = surface.querySelector(".native-drag-drop-stage-slot"); const stageElement = surface.querySelector(".native-drag-drop-stage"); const bankElement = surface.querySelector(".native-drag-drop-bank"); const bankItemsElement = surface.querySelector(".native-drag-drop-bank-items");
    const root = snapshot(surface); const visual = snapshot(visualElement); const workspace = snapshot(workspaceElement); const stageSlot = snapshot(stageSlotElement); const stage = snapshot(stageElement); const bank = snapshot(bankElement);
    const ancestors = []; for (let current = surface.parentElement, depth = 0; current && depth < 9; current = current.parentElement, depth += 1) ancestors.push(snapshot(current));
    const stageRect = stageElement.getBoundingClientRect(); const stageSlotRect = stageSlotElement.getBoundingClientRect(); const workspaceRect = workspaceElement.getBoundingClientRect(); const visualRect = visualElement.getBoundingClientRect(); const bankRect = bankElement.getBoundingClientRect(); const activityHost = snapshot(surface.closest(".native-readable-text-activity-view"));
    return { context, viewport: { width: innerWidth, height: innerHeight }, root, visual, workspace, stageSlot, stage, bank, activityHost, ancestors, activityHostFillRatio: root.height / activityHost.height, visualRootRatio: visual.height / root.height, bankRootRatio: bank.height / root.height, usableVisualRatio: stageSlot.height / workspace.height, usableBankRatio: bank.height / stage.height, bankTopRatio: (bankRect.top - stageRect.top) / stageRect.height, bankInsideStage: bankRect.left >= stageRect.left - 1 && bankRect.right <= stageRect.right + 1 && bankRect.top >= stageRect.top - 1 && bankRect.bottom <= stageRect.bottom + 1, bankOverlapsStage: bankRect.left < stageRect.right - 1 && bankRect.right > stageRect.left + 1 && bankRect.top < stageRect.bottom - 1 && bankRect.bottom > stageRect.top + 1, bankItemRows: new Set([...bankItemsElement.children].map((item) => Math.round(item.getBoundingClientRect().top))).size, bankItemsScrollable: bankItemsElement.scrollHeight > bankItemsElement.clientHeight + 1, stageAspectRatio: stage.width / stage.height, sourceAspectRatio: Number(stageElement.dataset.surfaceWidth) / Number(stageElement.dataset.surfaceHeight), stageInsideVisual: stageRect.left >= visualRect.left - 1 && stageRect.right <= visualRect.right + 1 && stageRect.top >= visualRect.top - 1 && stageRect.bottom <= visualRect.bottom + 1, stageInsideSlot: stageRect.left >= stageSlotRect.left - 1 && stageRect.right <= stageSlotRect.right + 1 && stageRect.top >= stageSlotRect.top - 1 && stageRect.bottom <= stageSlotRect.bottom + 1, horizontalOverflow: document.documentElement.scrollWidth - innerWidth, activityScrollOverflow: { x: surface.scrollWidth - surface.clientWidth, y: surface.scrollHeight - surface.clientHeight } };
  }, measuredContext);
  process.stdout.write(`[drag-drop-geometry] ${JSON.stringify({ requestedViewport: viewport, ...measurement })}\n`);
  return measurement;
}

async function dragBetween(page, source, target) {
  await source.scrollIntoViewIfNeeded();
  const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  assert.ok(sourceBox && targetBox);
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down(); await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 }); await page.mouse.up();
}

async function exerciseValidatedDragDrop(page, surface, publicDocument, teacherDocument) {
  const target = surface.locator("[data-drag-drop-target-id]").first(); const targetId = await target.getAttribute("data-drag-drop-target-id");
  const mapping = teacherDocument.parts[0].solution.mappings.find((entry) => entry.targetId === targetId);
  const correctWordId = mapping?.wordIds?.[0] || mapping?.wordId;
  const wrongWordId = publicDocument.parts[0].interaction.words.find((word) => word.id !== correctWordId)?.id;
  assert.ok(correctWordId && wrongWordId);
  const wrongWord = surface.locator(`[data-drag-drop-word-id="${wrongWordId}"]`);
  await dragBetween(page, wrongWord, target); await expect(target).toHaveAttribute("data-incorrect", "true"); assert.equal(await target.getAttribute("data-occupied"), null); assert.equal(await wrongWord.count(), 1); await expect(surface.getByRole("status")).toContainText("does not belong"); assert.doesNotMatch(await target.getAttribute("aria-label"), /incorrect|wrong/i); assert.equal(await target.evaluate((element) => getComputedStyle(element).borderColor), "rgb(185, 28, 28)");
  const correctWord = surface.locator(`[data-drag-drop-word-id="${correctWordId}"]`); await dragBetween(page, correctWord, target); await expect(target).toHaveAttribute("data-occupied", "true"); assert.equal(await target.getAttribute("data-incorrect"), null); assert.equal(await correctWord.count(), 0, "a correctly placed word leaves the bank");
  return target;
}

function familyFromRelease(release) {
  return {
    id: release.productReleaseId,
    number: release.number,
    bookSlug: "ultimate-b2",
    compilerId: release.productCompilerId || "ultimate-b2-product-v1",
    releaseSchemaVersion: "1.0",
    sourceSnapshotSha256: release.productSourceSha256,
    releaseSha256: release.productSha256,
    releaseNote: "",
    createdAt: release.createdAt,
    members: release.members,
  };
}

function findComponentRelease({ productReleaseId, componentSlug, releaseId }) {
  const release = [...releases, ...legacyReleases].find((candidate) => (!productReleaseId || candidate.productReleaseId === productReleaseId)
    && (!releaseId || Object.values(candidate.componentReleases).some((row) => row.id === releaseId)));
  const row = release?.componentReleases?.[componentSlug] || null;
  return row && (!releaseId || row.id === releaseId) ? row : null;
}

const previewAuthorizationHandler = createBuilderPreviewAuthorizationHandler({
  getDatabase: () => null,
  authorize: async () => ({ builderUser: { id: "task-9" } }),
  inspect: (event, scope) => inspectBuilderPreviewAuthorizationScope(event, scope, { environment: previewEnvironment }),
  issue: (input) => issueBuilderPreviewAuthorization(input, { environment: previewEnvironment }),
  issueReleaseMember: (input) => issueBuilderReleaseMemberAuthorization(input, { environment: previewEnvironment }),
  loadProductRelease: async (_sql, identity) => {
    const release = [...releases, ...legacyReleases].find((candidate) => candidate.productReleaseId === identity.productReleaseId);
    return release ? familyFromRelease(release) : null;
  },
  loadComponentRelease: async (_sql, identity) => findComponentRelease(identity),
  logger: { error() {} },
});

let compiledPrepareMembers = [];
const productPublicationHandler = createBuilderProductPublicationHandler({
  getDatabase: () => null,
  authorize: async () => ({ builderUser: { id: "task-9" } }),
  ready: async () => true,
  pinReady: async () => true,
  compileProduct: async () => {
    compiledPrepareMembers = [
      { componentSlug: "ultimate-b2-students-book", compiled: projection(savedPrompt) },
      { componentSlug: "ultimate-b2-workbook", compiled: managedProjection("ultimate-b2-workbook", sourceVersion) },
      { componentSlug: "ultimate-b2-grammar-book", compiled: managedProjection("ultimate-b2-grammar-book", sourceVersion) },
    ];
    return compiledPrepareMembers;
  },
  storage: () => ({
    bucket: () => "private",
    async head({ objectKey }) {
      const source = compiledPrepareMembers.flatMap((entry) => entry.compiled.nativeAssetSources || []).find((candidate) => candidate.row.object_key === objectKey);
      if (!source) throw new Error("source missing");
      return { checksumSha256: source.row.checksum_sha256, byteSize: Number(source.row.byte_size), contentType: source.row.mime_type };
    },
    async copyVerifiedImmutable() { copyObjectCalls += 1; throw new Error("CopyObject forbidden in pinned acceptance"); },
  }),
  randomUuid: () => {
    const value = preparedUuidQueue.shift();
    if (!value) throw new Error("deterministic release UUID queue exhausted");
    return value;
  },
  create: async (_sql, input) => {
    const release = buildProductRelease(releases.length + 1);
    assert.equal(input.productReleaseId, release.productReleaseId);
    for (const member of input.members) {
      const row = release.componentReleases[member.componentSlug];
      assert.equal(member.releaseId, row.id);
      assert.equal(member.assetStorageMode, "pinned-source-v1");
      row.releasePins = member.assetPins.map((pin) => ({
        component_release_id: row.id, book_asset_id: pin.assetId, asset_role: pin.role, source_asset_role: pin.sourceAssetRole,
        checksum_sha256: pin.checksumSha256, byte_size: pin.byteSize, media_type: pin.mediaType, extension: pin.extension,
        storage_profile: pin.storageProfile, storage_bucket: pin.storageBucket, object_key: pin.objectKey,
        source_owner_key: pin.ownerKey, source_asset_slot: pin.assetSlot, pin_sha256: pin.pinSha256,
      }));
    }
    releases.push(release);
    return { outcome: "created", productReleaseId: release.productReleaseId, releaseNumber: release.number, releaseSha256: release.productSha256, sourceSnapshotSha256: release.productSourceSha256, members: release.members };
  },
  loadRelease: async (_sql, { productReleaseId }) => {
    const release = releases.find((candidate) => candidate.productReleaseId === productReleaseId);
    return release ? { ...metadata(release), bookSlug: "ultimate-b2", releaseNote: "" } : null;
  },
  loadAssetModes: async (_sql, { productReleaseId }) => {
    const release = releases.find((candidate) => !productReleaseId || candidate.productReleaseId === productReleaseId);
    return release ? release.members.map((member) => ({ product_release_id: release.productReleaseId, component_slug: member.componentSlug, asset_storage_mode: "pinned-source-v1" })) : [];
  },
  verifyCandidate: async () => true,
  logger: { error() {} },
});

function pinFor(identity) {
  return findComponentRelease(identity)?.releasePins?.find((pin) => pin.checksum_sha256 === identity.sha256 && pin.extension === identity.extension && pin.asset_role === identity.role) || null;
}

function pinnedBytes(pin) {
  if (pin.media_type === "video/mp4") return unitExtraMp4;
  if (pin.media_type === "image/png") return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  return Buffer.alloc(Math.min(Number(pin.byte_size), 32_000));
}

const releaseSourceBucket = {
  async head(key) {
    const pin = [...releases].flatMap((release) => Object.values(release.componentReleases)).flatMap((row) => row.releasePins || []).find((candidate) => candidate.object_key === key);
    return pin ? { size: Number(pin.byte_size) } : null;
  },
  async get(key, options) {
    const pin = [...releases].flatMap((release) => Object.values(release.componentReleases)).flatMap((row) => row.releasePins || []).find((candidate) => candidate.object_key === key);
    if (!pin) return null;
    const bytes = pinnedBytes(pin);
    const selected = options?.range ? bytes.subarray(options.range.offset, options.range.offset + options.range.length) : bytes;
    return { size: Number(pin.byte_size), body: new ReadableStream({ start(controller) { controller.enqueue(selected); controller.close(); } }) };
  },
};

const publicationPreviewHandler = createBuilderPublicationHandler({
  getDatabase: () => null,
  authorizePreview: async (event, _sql, scope) => classifyBuilderPreviewAuthorization(event, scope, { environment: previewEnvironment }).authorized,
  loadRelease: async (_sql, identity) => findComponentRelease(identity),
  loadAssetPin: async (_sql, identity) => pinFor(identity),
  servePinnedAsset: servePinnedReleaseSourceAsset,
  storage: () => ({ signedGetUrl: async () => "https://private-storage.invalid/release-asset" }),
  logger: { error() {} },
});

function netlifyEvent({ path: pathname, method = "GET", headers = {}, query = {}, body = "" }) {
  return { path: pathname, httpMethod: method, headers, queryStringParameters: query, multiValueQueryStringParameters: null, body, isBase64Encoded: false };
}

function sendNetlify(response, result) {
  const body = result.body || "";
  response.writeHead(result.statusCode, { ...(result.headers || {}), "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/builder/api/auth" && url.searchParams.get("action") === "me") return sendJson(response, 200, { authenticated: true, builderUser: { id: "task-9", full_name: "Task 9 Browser", role: "developer", status: "active" } });
  if (url.pathname === builderPages && request.method === "GET") return sendJson(response, 200, { revision: 0, hotspotRevision: 0, component: { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", kind: "students-book", title: "Students Book" }, units: [], pages: canonicalStudentsBookPages, deletedPages: [] });
  if (url.pathname === "/builder/api/preview-authorization" && request.method === "POST") {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    return sendNetlify(response, await previewAuthorizationHandler(netlifyEvent({
      path: "/builder/preview/authorization",
      method: request.method,
      headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : String(value || "")])),
      body: Buffer.concat(chunks).toString("utf8"),
    })));
  }
  if (url.pathname === "/test/publication-block/open-response" && request.method === "POST") { publicationFailure = { error: "native_activity_not_ready", activityId, issues: ["Question 1 needs a model answer."] }; return sendJson(response, 200, { ok: true }); }
  if (url.pathname === "/test/publication-block/image" && request.method === "POST") { publicationFailure = { error: "native_activity_not_ready", activityId: imageActivityId, issues: ["Image 1 needs alt text or must be marked decorative."] }; return sendJson(response, 200, { ok: true }); }
  if (url.pathname === "/test/publication-block/clear" && request.method === "POST") { publicationFailure = null; return sendJson(response, 200, { ok: true }); }
  if (url.pathname === publication && request.method === "GET" && publicationFailure) return sendJson(response, 409, publicationFailure);
  if (url.pathname === publication && request.method === "GET") return sendJson(response, 200, { bookSlug: "ultimate-b2", compilerId: "ultimate-b2-product-v1", releaseSchemaVersion: "1.0", headRevision, components: ["ultimate-b2-students-book", "ultimate-b2-workbook", "ultimate-b2-grammar-book"].map((componentSlug) => ({ componentSlug, currentSourceSha256: sourceSha() })), published: activeReleaseId ? metadata(releases.find((release) => release.productReleaseId === activeReleaseId)) : null, releases: [...releases].reverse().map(metadata) });
  if (url.pathname === `${publication}/prepare` && request.method === "POST") {
    const number = releases.length + 1;
    preparedUuidQueue = [releaseIds[number - 1], `30000000-0000-4000-8000-00000000009${number}`, `40000000-0000-4000-8000-00000000009${number}`, productReleaseIds[number - 1]];
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    return sendNetlify(response, await productPublicationHandler(netlifyEvent({
      path: url.pathname,
      method: request.method,
      headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : String(value || "")])),
      body: Buffer.concat(chunks).toString("utf8"),
    })));
  }
  if (url.pathname === `${publication}/publish` && request.method === "POST") {
    const chunks = []; for await (const chunk of request) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks).toString("utf8")); const release = releases.find((item) => item.productReleaseId === body.productReleaseId);
    if (!release || release.sourceSha !== sourceSha()) return sendJson(response, 409, { error: "stale_release_preview" });
    if (body.expectedHeadRevision !== headRevision) return sendJson(response, 409, { error: "head_conflict" });
    activeReleaseId = release.productReleaseId; headRevision += 1; return sendJson(response, 200, { outcome: "published", productReleaseId: release.productReleaseId, releaseNumber: release.number, headRevision });
  }
  return staticResponse(builderRoot, url.pathname, response, "index.html");
});
server.on("close", () => lifecycle("server-close", { phase: lifecyclePhase() }));
server.on("error", (error) => {
  lifecycle("server-error", { phase: lifecyclePhase(), code: error?.code || "unknown", message: error?.message || "unknown" });
  throw error;
});
lifecycle("server-listen-start");
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
lifecycle("server-ready");

let browser;
let context;
try {
  lifecycle("browser-launch-start");
  browser = await chromium.launch(localPlaywrightLaunchOptions());
  lifecycle("browser-launched", { version: browser.version() });
  browser.on("disconnected", () => {
    lifecycleState.browserDisconnected = true;
    lifecycle("browser-disconnected", { phase: lifecyclePhase() });
  });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname.includes("private-storage") || url.hostname.includes("r2.cloudflarestorage")) rawStorageRequests.push(url.href);
  });
  lifecycle("context-created");
  context.on("close", () => {
    lifecycleState.contextClosed = true;
    lifecycle("context-close", { phase: lifecyclePhase() });
  });
  await context.route("https://hhplms-viewer.netlify.app/**", async (route) => {
    const browserRequest = route.request();
    const url = new URL(browserRequest.url());
    const query = Object.fromEntries(url.searchParams.entries());
    const event = netlifyEvent({ path: url.pathname, method: browserRequest.method(), headers: browserRequest.headers(), query, body: browserRequest.postData() || "" });
    if (url.pathname.startsWith("/preview/authorization/")) {
      if (url.pathname.endsWith("release-member-exchange")) releaseMemberExchangeRequests.push(JSON.parse(browserRequest.postData() || "{}"));
      const result = await previewAuthorizationHandler(event);
      return route.fulfill({ status: result.statusCode, headers: result.headers, body: result.body || "" });
    }
    const match = url.pathname.match(/^\/preview\/releases\/books\/ultimate-b2\/components\/([^/]+)\/([0-9a-f-]+)\/(public|teacher-ui|teacher-solution|native-teacher|assets)(?:\/(.*))?$/);
    if (match) {
      viewerReleaseRequests.push({ pathname: url.pathname, componentSlug: match[1], componentReleaseId: match[2], action: match[3], authorization: url.searchParams.get("previewAuthorization") });
      const compatibleRequest = new Request(url, { method: browserRequest.method(), headers: browserRequest.headers() });
      const result = await publicationPreviewHandler(
        { ...event, path: url.pathname.replace(/^\/preview\/releases/, "/builder/preview/releases") },
        { cloudflare: { request: compatibleRequest, releaseSourceAssets: releaseSourceBucket } },
      );
      if (result instanceof Response) {
        const responseHeaders = Object.fromEntries(result.headers);
        delete responseHeaders["content-length"];
        if (result.status >= 400) lifecycle("release-response-error", { path: url.pathname, status: result.status, body: "bounded" });
        return route.fulfill({ status: result.status, headers: responseHeaders, body: Buffer.from(await result.arrayBuffer()) });
      }
      if (result.statusCode >= 400) lifecycle("release-response-error", { path: url.pathname, status: result.statusCode, body: result.body });
      if (result.statusCode === 302) {
        return route.fulfill((match[4] || "").endsWith(".mp4")
          ? { status: 200, contentType: "video/mp4", body: unitExtraMp4 }
          : { status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
      }
      return route.fulfill({ status: result.statusCode, headers: result.headers, body: result.body || "" });
    }
    if (url.hostname.includes("storage") || url.hostname.includes("r2")) rawStorageRequests.push(url.href);
    const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, ""); let file = path.resolve(viewerRoot, relative); let details = file.startsWith(`${viewerRoot}${path.sep}`) ? await stat(file).catch(() => null) : null; if (!details?.isFile()) file = path.join(viewerRoot, "index.html");
    return route.fulfill({ status: 200, contentType: mime[path.extname(file).toLowerCase()] || "application/octet-stream", body: await readFile(file) });
  });
  const page = observePage(await context.newPage(), "builder"); page.setDefaultTimeout(60_000); page.on("dialog", (dialog) => dialog.accept());
  lifecycle("builder-navigation-start");
  await page.goto(`${origin}/#/books/ultimate-b2/components/ultimate-b2-students-book/publication`, { waitUntil: "domcontentloaded" });
  lifecycle("builder-navigation-complete");
  await page.getByRole("heading", { name: "Publication", exact: true }).waitFor();
  await page.getByText("No release published yet", { exact: true }).waitFor();
  lifecycle("builder-publication-ready");
  await page.request.post(`${origin}/test/publication-block/open-response`); await page.reload({ waitUntil: "domcontentloaded" }); await page.getByRole("heading", { name: "Publication blocked", exact: true }).waitFor(); await page.getByText(activityId, { exact: true }).waitFor(); await page.getByText("Question 1 needs a model answer.", { exact: true }).waitFor(); assert.equal(releases.length, 0);
  await page.request.post(`${origin}/test/publication-block/image`); await page.reload({ waitUntil: "domcontentloaded" }); await page.getByText(imageActivityId, { exact: true }).waitFor(); await page.getByText("Image 1 needs alt text or must be marked decorative.", { exact: true }).waitFor(); assert.equal(releases.length, 0);
  await page.request.post(`${origin}/test/publication-block/clear`); await page.reload({ waitUntil: "domcontentloaded" }); await page.getByRole("heading", { name: "Publication", exact: true }).waitFor();
  await page.getByRole("button", { name: "Prepare Preview" }).click();
  await page.getByText("Release 1 · Current", { exact: true }).waitFor();
  legacyReleases.push(buildLegacyProductRelease(releases[0]));
  lifecycle("preview-one-prepared");
  assert.equal(await page.locator(".hosted-viewer-preview iframe").count(), 1);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("heading", { name: "Review · Release #1 · Immutable", exact: true }).waitFor();
  await page.locator(".unified-builder-review-dialog iframe").waitFor();
  assert.equal(await page.locator(".unified-builder-review-dialog iframe").count(), 1);
  const frameUrl = new URL(await page.locator(".unified-builder-review-dialog iframe").getAttribute("src"));
  assert.equal(frameUrl.searchParams.get("releaseId"), releaseIds[0]);
  assert.equal(frameUrl.searchParams.get("productReleaseId"), productReleaseIds[0]);
  assert.equal(frameUrl.searchParams.get("memberSha256"), releases[0].studentsMemberSha256);
  assert.equal(frameUrl.searchParams.get("view"), "page");
  await page.getByRole("button", { name: "Saved Draft", exact: true }).click();
  await page.getByRole("heading", { name: "Review · Saved Draft", exact: true }).waitFor();
  await page.getByRole("button", { name: "Release #1 · Immutable", exact: true }).click();
  const immutableReviewFrame = page.locator(".unified-builder-review-dialog iframe");
  const immutableReview = page.frameLocator(".unified-builder-review-dialog iframe");
  await immutableReview.getByRole("button", { name: "Home", exact: true }).click();
  await immutableReview.locator(".teacher-offline-library").waitFor();
  await immutableReview.getByRole("button", { name: "Workbook", exact: true }).click();
  await immutableReview.getByRole("button", { name: /^Open Unit 1:/ }).click();
  await immutableReview.getByRole("button", { name: /^Open Workbook immutable version 1,/ }).click();
  await immutableReview.getByAltText("Workbook immutable version 1").waitFor();
  assert.equal(await immutableReviewFrame.count(), 1, "Workbook switch retains one resident Viewer iframe");
  await immutableReview.getByRole("button", { name: "Home", exact: true }).click();
  await immutableReview.locator(".teacher-offline-library").waitFor();
  assert.equal(await immutableReview.getByRole("button", { name: "Workbook", exact: true }).getAttribute("aria-pressed"), "true");
  await immutableReview.getByRole("button", { name: "Grammar Book", exact: true }).click();
  await immutableReview.getByRole("button", { name: /^Open Unit 1:/ }).click();
  await immutableReview.getByRole("button", { name: /^Open Grammar Book immutable version 1,/ }).click();
  await immutableReview.getByAltText("Grammar Book immutable version 1").waitFor();
  assert.equal(await immutableReviewFrame.count(), 1, "Grammar switch retains one resident Viewer iframe");
  await immutableReview.getByRole("button", { name: "Home", exact: true }).click();
  await immutableReview.locator(".teacher-offline-library").waitFor();
  await immutableReview.getByRole("button", { name: "Students Book", exact: true }).click();
  assert.equal(await immutableReviewFrame.count(), 1, "Students switch retains one resident Viewer iframe");
  assert.equal(releaseMemberExchangeRequests.some((request) => request.intent?.componentSlug === "ultimate-b2-workbook"), true);
  assert.equal(releaseMemberExchangeRequests.some((request) => request.intent?.componentSlug === "ultimate-b2-grammar-book"), true);
  assert.equal(viewerReleaseRequests.some((request) => request.componentSlug === "ultimate-b2-workbook" && request.action === "public"), true);
  assert.equal(viewerReleaseRequests.some((request) => request.componentSlug === "ultimate-b2-grammar-book" && request.action === "public"), true);
  await page.getByRole("button", { name: "Close Review" }).click();
  assert.equal(await page.locator(".unified-builder-review-dialog iframe").count(), 1);

  const legacyRelease = legacyReleases[0];
  const legacyMember = legacyRelease.members[0];
  const legacyAuthorization = issueBuilderReleaseMemberAuthorization({
    intent: { bookSlug: "ultimate-b2", componentSlug: legacyMember.componentSlug, productReleaseId: legacyRelease.productReleaseId, releaseId: null, view: "library", pageId: null, activityId: null },
    productReleaseId: legacyRelease.productReleaseId,
    componentReleaseId: legacyMember.componentReleaseId,
    memberSha256: legacyMember.memberSha256,
  }, { environment: previewEnvironment }).token;
  const legacyViewer = observePage(await context.newPage(), "legacy-viewer");
  const legacyTargetRequestStart = viewerReleaseRequests.length;
  await legacyViewer.goto(`https://hhplms-viewer.netlify.app/?builderPreview=1&bookSlug=ultimate-b2&componentSlug=${legacyMember.componentSlug}&productReleaseId=${legacyRelease.productReleaseId}&releaseId=${legacyMember.componentReleaseId}&memberSha256=${legacyMember.memberSha256}&view=library&previewAuthorization=${encodeURIComponent(legacyAuthorization)}`, { waitUntil: "domcontentloaded" });
  await legacyViewer.locator(".teacher-offline-library").waitFor();
  const legacyWorkbook = legacyViewer.getByRole("button", { name: "Workbook unavailable in this release", exact: true });
  const legacyGrammar = legacyViewer.getByRole("button", { name: "Grammar Book unavailable in this release", exact: true });
  assert.equal(await legacyWorkbook.isDisabled(), true);
  assert.equal(await legacyGrammar.isDisabled(), true);
  assert.equal(await legacyWorkbook.getAttribute("title"), "Workbook was not included in Release #11.");
  assert.equal(await legacyGrammar.getAttribute("title"), "Grammar Book was not included in Release #11.");
  assert.equal(viewerReleaseRequests.slice(legacyTargetRequestStart).some((request) => request.componentSlug !== "ultimate-b2-students-book"), false, "legacy unavailable members never issue target content requests");
  assert.equal(await legacyViewer.getByText(/Refresh.*try again/i).count(), 0);
  await legacyViewer.close();

  const viewer = observePage(await context.newPage(), "preview-viewer");
  viewer.on("request", (request) => immutableViewerRequests.push(request.url()));
  const pagePreviewUrl = (release) => {
    const member = release.members[0];
    const authorization = issueBuilderReleaseMemberAuthorization({
      intent: { bookSlug: "ultimate-b2", componentSlug: member.componentSlug, productReleaseId: release.productReleaseId, releaseId: null, view: "page", pageId: publicationV2Fixture.pageId, activityId: null },
      productReleaseId: release.productReleaseId,
      componentReleaseId: member.componentReleaseId,
      memberSha256: member.memberSha256,
    }, { environment: previewEnvironment }).token;
    return `https://hhplms-viewer.netlify.app/?builderPreview=1&bookSlug=ultimate-b2&componentSlug=${member.componentSlug}&productReleaseId=${release.productReleaseId}&releaseId=${member.componentReleaseId}&memberSha256=${member.memberSha256}&view=page&unitNumber=1&pageId=${publicationV2Fixture.pageId}&previewAuthorization=${encodeURIComponent(authorization)}`;
  };
  lifecycle("preview-viewer-navigation-start");
  await viewer.goto(pagePreviewUrl(releases[0]), { waitUntil: "domcontentloaded" });
  lifecycle("preview-viewer-navigation-complete");
  lifecycle("open-response-click-start", { attempt: 1 });
  await viewer.getByRole("button", { name: "Native Open Response" }).click();
  lifecycle("open-response-click-complete", { attempt: 1 });
  await viewer.getByText("Draft version A", { exact: true }).waitFor();
  await viewer.getByRole("button", { name: /Reveal model answer/ }).waitFor();
  assert.equal(await viewer.getByText(publicationV2Fixture.teacherSentinel, { exact: true }).count(), 0);
  await viewer.getByRole("button", { name: /Reveal model answer/ }).click();
  await viewer.getByText(publicationV2Fixture.teacherSentinel, { exact: true }).waitFor();
  await viewer.getByRole("button", { name: "Next activity part", exact: true }).click(); await viewer.getByText("Draft version A", { exact: true }).waitFor({ state: "detached" }); assert.equal(await viewer.getByText("Draft version A", { exact: true }).count(), 0, "published response-only composition hides its prompt"); assert.equal(await viewer.getByText(publicationV2Fixture.teacherSentinel, { exact: true }).count(), 1, "duplicate presentation shares one canonical reveal identity");
  assert.ok(viewerReleaseRequests.some((request) => request.action === "native-teacher" && request.pathname.endsWith(`/${activityId}`)), "Teacher reveal must load the protected native Teacher document.");
  assert.ok(viewerReleaseRequests.every((request) => /^v3\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(request.authorization || "")), "Every release projection request must carry exact v3 member authorization.");
  savedPrompt = "Draft version B"; sourceVersion = 2;
  lifecycle("preview-viewer-reload-start");
  await viewer.reload({ waitUntil: "domcontentloaded" });
  lifecycle("preview-viewer-reload-complete");
  await viewer.getByRole("button", { name: "Home", exact: true }).click();
  await viewer.locator(".teacher-offline-library").waitFor();
  await viewer.getByRole("button", { name: "Workbook", exact: true }).click();
  await viewer.getByRole("button", { name: /^Open Unit 1:/ }).click();
  await viewer.getByRole("button", { name: /^Open Workbook immutable version 1,/ }).click();
  await viewer.getByAltText("Workbook immutable version 1").waitFor();
  await viewer.getByRole("button", { name: "Home", exact: true }).click();
  await viewer.getByRole("button", { name: "Grammar Book", exact: true }).click();
  await viewer.getByRole("button", { name: /^Open Unit 1:/ }).click();
  await viewer.getByRole("button", { name: /^Open Grammar Book immutable version 1,/ }).click();
  await viewer.getByAltText("Grammar Book immutable version 1").waitFor();
  await viewer.getByRole("button", { name: "Home", exact: true }).click();
  await viewer.getByRole("button", { name: "Students Book", exact: true }).click();
  await viewer.getByRole("button", { name: /^Open Unit 1:/ }).click();
  await viewer.locator(".teacher-unit-page-card").first().locator(".teacher-unit-page-open").first().click();
  await viewer.locator(".teacher-offline-page-stage").waitFor();
  lifecycle("open-response-click-start", { attempt: 2 });
  await viewer.getByRole("button", { name: "Native Open Response" }).click();
  lifecycle("open-response-click-complete", { attempt: 2 });
  await viewer.getByText("Draft version A", { exact: true }).waitFor();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Release 1 · Stale", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Publish Preview" }).isDisabled(), true);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByText("Release #1 is immutable and older than the current saved draft.", { exact: true }).waitFor();
  await page.waitForFunction((releaseId) => new URL(document.querySelector(".unified-builder-review-dialog iframe")?.src || "about:blank").searchParams.get("releaseId") === releaseId, releaseIds[0]);
  const staleFrameUrl = new URL(await page.locator(".unified-builder-review-dialog iframe").getAttribute("src"));
  assert.equal(staleFrameUrl.searchParams.get("releaseId"), releaseIds[0]);
  assert.equal(staleFrameUrl.searchParams.get("productReleaseId"), productReleaseIds[0]);
  await page.getByRole("button", { name: "Close Review" }).click();
  const direct = await page.evaluate(async ({ publication, id }) => { const response = await fetch(`${publication}/publish`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productReleaseId: id, expectedHeadRevision: 0, clientMutationId: crypto.randomUUID() }) }); return { status: response.status, body: await response.json() }; }, { publication, id: productReleaseIds[0] });
  assert.deepEqual(direct, { status: 409, body: { error: "stale_release_preview" } });

  await page.getByRole("button", { name: "Prepare Preview" }).click();
  await page.getByText("Release 2 · Current", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("heading", { name: "Review · Release #2 · Immutable", exact: true }).waitFor();
  await page.waitForFunction((releaseId) => new URL(document.querySelector(".unified-builder-review-dialog iframe")?.src || "about:blank").searchParams.get("releaseId") === releaseId, releaseIds[1]);
  const currentFrameUrl = new URL(await page.locator(".unified-builder-review-dialog iframe").getAttribute("src"));
  assert.equal(currentFrameUrl.searchParams.get("releaseId"), releaseIds[1]);
  assert.equal(currentFrameUrl.searchParams.get("productReleaseId"), productReleaseIds[1]);
  await page.getByRole("button", { name: "Close Review" }).click();
  await page.getByRole("button", { name: "Publish Preview" }).click();
  await page.getByText("Product Release 2 is now published.", { exact: true }).waitFor();
  await page.getByText("Release 2", { exact: true }).first().waitFor();
  const publishedViewer = observePage(await context.newPage(), "published-viewer");
  publishedViewer.on("request", (request) => immutableViewerRequests.push(request.url()));
  lifecycle("published-viewer-navigation-start");
  await publishedViewer.goto(pagePreviewUrl(releases[1]), { waitUntil: "domcontentloaded" });
  lifecycle("published-viewer-navigation-complete");
  const extraVideoLauncher = publishedViewer.getByRole("button", { name: "Extra Videos", exact: true });
  await extraVideoLauncher.waitFor(); await extraVideoLauncher.click();
  await publishedViewer.getByRole("menuitem", { name: "Captioned extra", exact: true }).click();
  const captionedExtraDialog = publishedViewer.getByRole("dialog", { name: "Captioned extra" }); await captionedExtraDialog.waitFor();
  await captionedExtraDialog.locator("video").waitFor(); await captionedExtraDialog.getByRole("button", { name: "Turn subtitles off" }).waitFor();
  assert.match(await captionedExtraDialog.locator("video").getAttribute("src"), new RegExp(`${publicationV2Fixture.unitExtraAssetChecksum}\\.mp4`));
  await captionedExtraDialog.getByRole("button", { name: "Close Extra Video" }).click(); await captionedExtraDialog.waitFor({ state: "detached" });
  await extraVideoLauncher.click(); await publishedViewer.getByRole("menuitem", { name: "No captions extra", exact: true }).click();
  const noCaptionsExtraDialog = publishedViewer.getByRole("dialog", { name: "No captions extra" }); await noCaptionsExtraDialog.waitFor();
  assert.equal(await noCaptionsExtraDialog.getByRole("button", { name: /subtitles/i }).count(), 0); await noCaptionsExtraDialog.getByRole("button", { name: "Close Extra Video" }).click();
  await publishedViewer.getByRole("button", { name: "Native Drag and Drop" }).click();
  const immutableDragDrop = publishedViewer.locator(".published-native-activity .native-drag-drop-teacher"); await immutableDragDrop.waitFor();
  assert.equal(await extraVideoLauncher.count(), 0, "Unit Extra launcher is suppressed while an activity is open");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 900 }]) {
    await publishedViewer.setViewportSize(viewport); await immutableDragDrop.waitFor();
    const geometry = await measureDragDrop(immutableDragDrop, { context: "immutable-published-viewer-teacher", viewport });
    assert.ok(geometry.activityHostFillRatio > .95 && geometry.activityHostFillRatio < 1.05, JSON.stringify(geometry));
    assert.ok(geometry.usableVisualRatio > .98 && geometry.usableVisualRatio < 1.02, JSON.stringify(geometry));
    assert.ok(geometry.usableBankRatio > .18 && geometry.usableBankRatio < .22, JSON.stringify(geometry));
    assert.ok(geometry.bankInsideStage && geometry.bankOverlapsStage && geometry.bankTopRatio > .78 && geometry.bankTopRatio < .82, JSON.stringify(geometry));
    assert.ok(geometry.stageInsideVisual && geometry.stageInsideSlot, JSON.stringify(geometry));
    assert.ok(geometry.horizontalOverflow <= 1, JSON.stringify(geometry));
    assert.ok(geometry.activityScrollOverflow.x <= 1 && geometry.activityScrollOverflow.y <= 1, JSON.stringify(geometry));
  }
  await publishedViewer.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await immutableDragDrop.locator(".native-drag-drop-artwork img").evaluate((image) => getComputedStyle(image).objectFit), "contain");
  const publishedDragPublic = releases[1].publicProjection.nativeActivities[dragDropActivityId].document; const publishedDragTeacher = releases[1].teacherProjection.nativeActivities[dragDropActivityId].document;
  const immutableTarget = await exerciseValidatedDragDrop(publishedViewer, immutableDragDrop, publishedDragPublic, publishedDragTeacher); await immutableTarget.click(); await expect(immutableTarget).not.toHaveAttribute("data-occupied", "true"); await immutableTarget.click(); await expect(immutableTarget).toHaveAttribute("data-revealed", "true");
  await publishedViewer.getByRole("button", { name: "Back", exact: true }).click(); await extraVideoLauncher.waitFor();
  await extraVideoLauncher.click(); await publishedViewer.getByRole("menuitem", { name: "Captioned extra", exact: true }).click(); await captionedExtraDialog.waitFor(); await publishedViewer.keyboard.press("Escape"); await captionedExtraDialog.waitFor({ state: "detached" });
  await publishedViewer.getByRole("button", { name: "Next page", exact: true }).click(); assert.equal(await extraVideoLauncher.count(), 0); await publishedViewer.getByRole("button", { name: "Previous page", exact: true }).click(); await extraVideoLauncher.waitFor();
  lifecycle("image-composition-click-start");
  await publishedViewer.getByRole("button", { name: "Native Image Composition" }).click();
  lifecycle("image-composition-click-complete");
  await publishedViewer.locator(".native-image-surface img").first().waitFor();
  assert.equal(await publishedViewer.getByText("Native Image Composition", { exact: true }).count(), 0);
  assert.equal(await publishedViewer.getByText("Inspect both composed image layers.", { exact: true }).count(), 0);
  assert.equal(await publishedViewer.locator(".native-image-surface img").count(), 2);
  assert.deepEqual(await publishedViewer.locator(".native-image-surface img").evaluateAll((images) => images.map((image) => image.style.objectFit)), ["contain", "cover"]);
  await publishedViewer.getByRole("button", { name: "Back", exact: true }).click();
  await publishedViewer.getByRole("button", { name: "Published Listening Panels", exact: true }).click();
  const publishedListening = publishedViewer.locator('.published-native-activity[data-native-kind="listening"] .native-listening'); await publishedListening.waitFor();
  await publishedListening.getByText("Published listening question", { exact: true }).waitFor();
  const previousListeningPanel = publishedViewer.getByRole("button", { name: "Previous activity part", exact: true }); const nextListeningPanel = publishedViewer.getByRole("button", { name: "Next activity part", exact: true }); await previousListeningPanel.waitFor(); await nextListeningPanel.waitFor(); assert.equal(await previousListeningPanel.isDisabled(), true); assert.equal(await nextListeningPanel.isDisabled(), false);
  await nextListeningPanel.click(); await publishedListening.getByText("Published transcript first line", { exact: true }).waitFor(); assert.equal(await publishedListening.getAttribute("data-view"), "transcript"); assert.equal(await previousListeningPanel.isDisabled(), false); assert.equal(await nextListeningPanel.isDisabled(), true);
  await previousListeningPanel.click(); await publishedListening.getByText("Published listening question", { exact: true }).waitFor(); assert.equal(await publishedListening.getAttribute("data-view"), "questions");
  assert.equal(activeReleaseId, productReleaseIds[1]);
  assert.equal(releases[0].publicProjection.nativeActivities[activityId].document.parts[0].interaction.questions[0].prompt, "Draft version A");
  assert.equal(releases[1].publicProjection.nativeActivities[activityId].document.parts[0].interaction.questions[0].prompt, "Draft version B");
  assert.doesNotMatch(JSON.stringify(releases[1].publicProjection), new RegExp(publicationV2Fixture.teacherSentinel));
  assert.equal(releases[1].publicProjection.nativeActivities[imageActivityId].document.parts[0].interaction.images.length, 2);
  assert.equal(releases[1].publicProjection.nativeActivities[listeningActivityId].document.parts[0].interaction.panels.length, 2);
  assert.equal(releases[0].componentReleases["ultimate-b2-workbook"].public_projection.pages[0].label, "Workbook immutable version 1");
  assert.equal(releases[1].componentReleases["ultimate-b2-workbook"].public_projection.pages[0].label, "Workbook immutable version 2");
  assert.equal(releases[0].componentReleases["ultimate-b2-grammar-book"].public_projection.pages[0].label, "Grammar Book immutable version 1");
  assert.equal(releases[1].componentReleases["ultimate-b2-grammar-book"].public_projection.pages[0].label, "Grammar Book immutable version 2");
  for (const release of releases) {
    const studentsPublic = release.componentReleases["ultimate-b2-students-book"].public_projection;
    const workbookPublic = release.componentReleases["ultimate-b2-workbook"].public_projection;
    const grammarPublic = release.componentReleases["ultimate-b2-grammar-book"].public_projection;
    assert.ok(studentsPublic.nativeActivities[publicationV2Fixture.openResponseId]);
    assert.deepEqual(Object.keys(workbookPublic.nativeActivities), [managedActivityIds["ultimate-b2-workbook"]]);
    assert.deepEqual(Object.keys(grammarPublic.nativeActivities), [managedActivityIds["ultimate-b2-grammar-book"]]);
    assert.equal(studentsPublic.nativeActivities[managedActivityIds["ultimate-b2-workbook"]], undefined);
    assert.equal(studentsPublic.nativeActivities[managedActivityIds["ultimate-b2-grammar-book"]], undefined);
    assert.equal(workbookPublic.nativeActivities[publicationV2Fixture.openResponseId], undefined);
    assert.equal(workbookPublic.nativeActivities[managedActivityIds["ultimate-b2-grammar-book"]], undefined);
    assert.equal(grammarPublic.nativeActivities[publicationV2Fixture.openResponseId], undefined);
    assert.equal(grammarPublic.nativeActivities[managedActivityIds["ultimate-b2-workbook"]], undefined);
    for (const publicProjection of [studentsPublic, workbookPublic, grammarPublic]) {
      const publicJson = JSON.stringify(publicProjection);
      assert.equal(publicJson.includes(publicationV2Fixture.teacherSentinel), false);
      assert.equal(publicJson.includes(managedTeacherSentinels["ultimate-b2-workbook"]), false);
      assert.equal(publicJson.includes(managedTeacherSentinels["ultimate-b2-grammar-book"]), false);
    }
  }
  assert.equal(copyObjectCalls, 0, "pinned-source-v1 product Prepare never invokes CopyObject");
  assert.ok(releases.every((release) => Object.values(release.componentReleases).every((row) => row.asset_storage_mode === "pinned-source-v1")));
  assert.ok(releases.every((release) => Object.values(release.componentReleases).some((row) => row.releasePins.length > 0)), "each accepted product family freezes exact private source pins");
  assert.equal(immutableViewerRequests.some((request) => new URL(request).pathname.startsWith("/preview/content/")), false, "immutable Review never falls back to mutable Draft content");
  assert.deepEqual(rawStorageRequests, [], "immutable Review never requests a raw private storage host");
  lifecycle("acceptance-complete");
  process.stdout.write("Immutable publication acceptance passed for Unit Extras, Drag & Drop geometry, Open Response/Image, Listening panels, stale blocking, exact publish, and private Teacher reveal.\n");
} catch (error) {
  lifecycle("test-error", {
    name: error?.name || "Error",
    message: error?.message || "unknown",
    browserConnected: browser?.isConnected() ?? false,
    browserDisconnected: lifecycleState.browserDisconnected,
    contextClosed: lifecycleState.contextClosed,
    pages: [...lifecycleState.pages.entries()].map(([label, state]) => `${label}:${state.crashed ? "crashed" : state.closed ? "closed" : "open"}`).join(","),
  });
  throw error;
} finally {
  lifecycleState.cleanupStarted = true;
  lifecycle("cleanup-begin");
  lifecycle("browser-close-start");
  await browser?.close();
  lifecycle("browser-close-complete");
  lifecycle("server-close-start");
  await new Promise((resolve) => server.close(resolve));
  lifecycle("server-close-complete");
  lifecycle("cleanup-complete");
}
