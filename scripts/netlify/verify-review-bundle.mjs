import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scanWebBundle } from "../verify-web-bundle-safety.mjs";
import studentsBookPageAssets from "../../src/data/ultimate-b2/generated/students-book-page-assets.json" with { type: "json" };

const roots = Object.freeze({
  lms: "dist-netlify/lms",
  "ultimate-b2-builder": "dist-netlify/ultimate-b2-builder",
  "ultimate-b2-interactive": "dist-netlify/ultimate-b2-interactive",
});

const privateDataPatterns = [
  ["local Windows path", /[A-Za-z]:[\\/]Users[\\/]/g],
  ["local Nextcloud path", /\bNextcloud\b/gi],
  ["publisher application path", /Ultimate English B2\.app/gi],
  ["workspace variable", /ULTIMATE_B2_CONTENT_ROOT/g],
  ["source-private classification", /source-private/gi],
  ["teacher-private classification", /teacher-private/gi],
  ["Teacher solution file", /teacher-solutions\.json|_ultimate-b2-reading-(?:exercise-4|debate-club)-solution\.json/gi],
  ["serialized accepted answers", /["']acceptedAnswers["']\s*:/g],
  ["serialized correct option", /["']correctOptionIds?["']\s*:/g],
  ["Complete Sentences answer mapping", /revealedWord/gi],
  ["private reveal payload", /["']revealText["']\s*:/gi],
  ["model answer payload", /["']modelAnswers?["']\s*:/gi],
  ["publisher IWB provenance", /decoded-publisher-iwb|iwbSha256|decodedSha256/gi],
  ["Reading publisher response", /In my opinion, watching a film at home is better|Many people say that watching films at home is cheaper/gi],
  ["Open Response publisher model answer", /Films are an art form which involve many artistic processes/gi],
  ["database URL", /postgres(?:ql)?:\/\/[^\s"'`]+/gi],
  ["Neon hostname", /[a-z0-9.-]+\.neon\.tech\b/gi],
];

const targetPatterns = Object.freeze({
  "ultimate-b2-builder": [
    ...privateDataPatterns,
    ["local authoring endpoint", /__hhplms\//gi],
    ["hosted authoring mutation", /(?:authoring|workspace|write-capability|repositoryFileTarget)[\s\S]{0,120}method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/gi],
    ["unapproved destructive client", /method\s*:\s*["'](?:PATCH|DELETE)["']/gi],
    ["direct Function client", /["']\/\.netlify\/functions/gi],
    ["root API client", /["']\/api\//gi],
    ["Platform Admin API client", /["']\/platform-admin\//gi],
    ["Platform Admin bundle", /Platform Administration|platform-admin-root/gi],
  ],
  "ultimate-b2-interactive": [
    ...privateDataPatterns,
    ["Netlify runtime dependency", /["']\/\.netlify\/functions/gi],
    ["API runtime dependency", /["']\/api\//gi],
    ["auth runtime dependency", /["']\/auth\//gi],
    ["absolute Builder preview origin", /https:\/\/hhplms-builder\.netlify\.app/gi],
    ["external runtime service", /https?:\/\/(?:fonts\.(?:googleapis|gstatic)\.com|[^\s"']*(?:sentry|segment|google-analytics|googletagmanager)[^\s"']*)/gi],
    ["Platform Admin bundle", /Platform Administration|platform-admin-root/gi],
  ],
});

async function verifyBuilderMutationSources() {
  const contentClientPath = path.resolve("src/apps/book-builder/hosted/builderContentApi.js");
  const importClientPath = path.resolve("src/apps/book-builder/hosted/builderOpenResponseImportApi.js");
  const uiAssetClientPath = path.resolve("src/apps/book-builder/hosted/builderTeacherUiAssetApi.js");
  const nativeClientPath = path.resolve("src/apps/book-builder/hosted/builderNativeActivityApi.js");
  const unitExtrasClientPath = path.resolve("src/apps/book-builder/hosted/builderUnitExtrasApi.js");
  const pagesClientPath = path.resolve("src/apps/book-builder/hosted/builderPagesApi.js");
  const previewAuthorizationClientPath = path.resolve("src/apps/book-builder/hosted/builderPreviewAuthorizationApi.js");
  const [contentClient, importClient, uiAssetClient, nativeClient, unitExtrasClient, pagesClient, previewAuthorizationClient] = await Promise.all([readFile(contentClientPath, "utf8"), readFile(importClientPath, "utf8"), readFile(uiAssetClientPath, "utf8"), readFile(nativeClientPath, "utf8"), readFile(unitExtrasClientPath, "utf8"), readFile(pagesClientPath, "utf8"), readFile(previewAuthorizationClientPath, "utf8")]);
  assert.match(contentClient, /const builderContentApiRoot = ["']\/builder\/api\/content["']/);
  assert.match(contentClient, /method: ["']PUT["']/);
  assert.match(contentClient, /credentials: ["']same-origin["']/);
  assert.doesNotMatch(contentClient, /__hhplms|\/\.netlify\/functions|["']\/api\/|platform-admin|repositoryFileTarget|write-capability/i);
  assert.equal([...contentClient.matchAll(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/g)].length, 1);
  assert.match(importClient, /const root = ["']\/builder\/api\/open-response-import["']/);
  assert.match(importClient, /method: ["']POST["']/);
  assert.match(importClient, /XMLHttpRequest/);
  assert.match(importClient, /credentials: ["']same-origin["']/);
  assert.doesNotMatch(importClient, /@aws-sdk|accessKey|secretAccessKey|\.netlify\/functions|FormData|base64/i);
  assert.match(uiAssetClient, /const root = ["']\/builder\/api\/ui-assets["']/);
  assert.match(uiAssetClient, /XMLHttpRequest/);
  assert.match(uiAssetClient, /credentials: ["']same-origin["']/);
  assert.doesNotMatch(uiAssetClient, /@aws-sdk|accessKey|secretAccessKey|\.netlify\/functions|FormData|base64/i);
  assert.match(nativeClient, /const root = ["']\/builder\/api\/native-activities["']/);
  assert.match(nativeClient, /method: ["']POST["']/);
  assert.match(nativeClient, /credentials: ["']same-origin["']/);
  assert.doesNotMatch(nativeClient, /@aws-sdk|accessKey|secretAccessKey|\.netlify\/functions|FormData|localStorage|sessionStorage/i);
  assert.match(unitExtrasClient, /const root = ["']\/builder\/api\/unit-extras["']/);
  assert.match(unitExtrasClient, /XMLHttpRequest/);
  assert.match(unitExtrasClient, /credentials: ["']same-origin["']/);
  assert.doesNotMatch(unitExtrasClient, /@aws-sdk|accessKey|secretAccessKey|\.netlify\/functions|FormData|base64|localStorage|sessionStorage/i);
  assert.match(pagesClient, /const root = ["']\/builder\/api\/pages["']/);
  assert.match(pagesClient, /method: ["']POST["']/);
  assert.match(pagesClient, /XMLHttpRequest/);
  assert.match(pagesClient, /credentials: ["']same-origin["']/);
  assert.doesNotMatch(pagesClient, /@aws-sdk|accessKey|secretAccessKey|\.netlify\/functions|FormData|base64|localStorage|sessionStorage/i);
  assert.match(previewAuthorizationClient, /const endpoint = ["']\/builder\/api\/preview-authorization["']/);
  assert.match(previewAuthorizationClient, /method: ["']POST["']/);
  assert.match(previewAuthorizationClient, /credentials: ["']same-origin["']/);
  assert.doesNotMatch(previewAuthorizationClient, /localStorage|sessionStorage|document\.cookie|\.netlify\/functions/i);

  const hostedSources = [
    "src/apps/book-builder/hosted/hostedBuilderEntry.jsx",
    "src/apps/book-builder/hosted/HostedAuthenticatedBookBuilderApp.jsx",
    "src/apps/book-builder/hosted/HostedBookBuilderApp.jsx",
    "src/apps/book-builder/hosted/HostedBuilderReviewPage.jsx",
    "src/apps/book-builder/hosted/hostedBuilderAdapters.jsx",
    "src/apps/book-builder/hosted/HostedViewerPreview.jsx",
    "src/apps/book-builder/hosted/hostedViewerPreviewUrl.js",
    "src/apps/ultimate-b2-builder/HostedUltimateB2BuilderApp.jsx",
    "src/apps/ultimate-b2-builder/UnitExtrasEditor.jsx",
    "src/apps/ultimate-b2-builder/UnifiedBuilderReview.jsx",
    "src/apps/ultimate-b2-builder/builderReviewModel.js",
    "src/apps/ultimate-b2-builder/HostedUltimateB2HotspotBuilder.jsx",
  ];
  for (const sourcePath of hostedSources) {
    const source = await readFile(path.resolve(sourcePath), "utf8");
    assert.doesNotMatch(source, /__hhplms|\/\.netlify\/functions|["']\/api\/|platform-admin|repositoryFileTarget|write-capability/i);
    assert.doesNotMatch(source, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
  }

  const [html, hostedEntry, hostedWorkspace, reviewPage, reviewRouter, previewFrame, previewUrl] = await Promise.all([
    readFile(path.resolve("ultimate-b2-builder.html"), "utf8"),
    readFile(path.resolve("src/apps/book-builder/hosted/hostedBuilderEntry.jsx"), "utf8"),
    readFile(path.resolve("src/apps/ultimate-b2-builder/HostedUltimateB2BuilderApp.jsx"), "utf8"),
    readFile(path.resolve("src/apps/book-builder/hosted/HostedBuilderReviewPage.jsx"), "utf8"),
    readFile(path.resolve("src/apps/book-builder/hosted/hostedBuilderRouter.js"), "utf8"),
    readFile(path.resolve("src/apps/book-builder/hosted/HostedViewerPreview.jsx"), "utf8"),
    readFile(path.resolve("src/apps/book-builder/hosted/hostedViewerPreviewUrl.js"), "utf8"),
  ]);
  assert.match(html, /src\/apps\/book-builder\/hosted\/hostedBuilderEntry\.jsx/);
  assert.doesNotMatch(`${html}\n${hostedEntry}`, /activityBuilderEntry|TeacherOffline|NormalizedStudentsBookActivity|Listening|MultipleChoice|virtual:book-builder-app/);
  assert.doesNotMatch(hostedWorkspace, /NormalizedStudentsBookActivity|TeacherOfflineLibrary|ClassroomToolsProvider|android-teacher-offline|hostedReviewUiAssets|ACTIVITY_MODES/);
  assert.match(previewUrl, /https:\/\/hhplms-viewer\.netlify\.app/);
  assert.match(previewFrame, /referrerPolicy="no-referrer"/);
  assert.match(previewFrame, /createBuilderPreviewAuthorization/);
  assert.match(previewFrame, /target="_blank" rel="noopener noreferrer">Open Player/);
  assert.doesNotMatch(previewFrame, /href=\{src\}/);
  assert.match(reviewPage, /<HostedViewerPreview/);
  assert.doesNotMatch(`${reviewPage}\n${reviewRouter}`, /previewAuthorization/);
  assert.match(previewUrl, /previewAuthorization/);
  assert.doesNotMatch(`${previewFrame}\n${previewUrl}`, /document\.domain|document\.cookie|localStorage|sessionStorage/i);
}

async function verifyViewerExitFullscreenProtocol() {
  const [protocol, previewFrame, viewerApp] = await Promise.all([
    readFile(path.resolve("src/shared/viewerPresentationProtocol.js"), "utf8"),
    readFile(path.resolve("src/apps/book-builder/hosted/HostedViewerPreview.jsx"), "utf8"),
    readFile(path.resolve("src/apps/android-teacher-offline/TeacherOfflineApp.jsx"), "utf8"),
  ]);
  assert.match(protocol, /^export const VIEWER_EXIT_FULLSCREEN_MESSAGE = "HHPLMS_VIEWER_EXIT_FULLSCREEN_V1";\s*$/);
  assert.doesNotMatch(protocol, /previewAuthorization|token|session|book|component|activity|release|teacher|user|content|database/i);
  assert.match(viewerApp, /Capacitor\.isNativePlatform\(\)[\s\S]*App\.minimizeApp\(\)[\s\S]*return;/);
  assert.match(viewerApp, /globalThis\.parent\.postMessage\(VIEWER_EXIT_FULLSCREEN_MESSAGE, "\*"\)/);
  assert.equal((viewerApp.match(/\.postMessage\(/g) || []).length, 1);
  assert.match(previewFrame, /event\.data !== VIEWER_EXIT_FULLSCREEN_MESSAGE/);
  assert.match(previewFrame, /event\.origin !== HOSTED_VIEWER_ORIGIN/);
  assert.match(previewFrame, /event\.source !== iframeElement\.contentWindow/);
  assert.match(previewFrame, /document\.fullscreenElement !== iframeElement/);
  assert.doesNotMatch(previewFrame, /\.postMessage\(|contentWindow\.(?:document|location|localStorage|sessionStorage)|window\.parent\.document/i);

  const postMessageSources = [];
  const contentWindowSources = [];
  for (const sourcePath of await sourceFilesUnder(path.resolve("src"))) {
    const source = await readFile(path.resolve("src", sourcePath), "utf8");
    if (/\.postMessage\(/.test(source)) postMessageSources.push(sourcePath);
    if (/contentWindow/.test(source)) contentWindowSources.push(sourcePath);
  }
  assert.deepEqual(postMessageSources.sort(), ["apps/android-teacher-offline/TeacherOfflineApp.jsx"]);
  assert.deepEqual(contentWindowSources.sort(), ["apps/book-builder/hosted/HostedViewerPreview.jsx"]);
}

async function verifyPublicViewerSourcesAndArtifact(root) {
  const [profiles, vite, embedded, hostedSolutions, packagedSolutions, releaseProvider, previewProvider, nativeDraftProvider, disabledNativeDraftProvider, buildScript] = await Promise.all([
    readFile(path.resolve("src/config/buildProfiles.js"), "utf8"),
    readFile(path.resolve("vite.config.js"), "utf8"),
    readFile(path.resolve("src/apps/android-teacher-offline/TeacherOfflineEmbeddedActivity.jsx"), "utf8"),
    readFile(path.resolve("src/apps/android-teacher-offline/hostedAuthorizedTeacherSolutions.js"), "utf8"),
    readFile(path.resolve("src/apps/android-teacher-offline/generatedPackProvider.js"), "utf8"),
    readFile(path.resolve("src/apps/android-teacher-offline/hostedComponentReleaseProvider.js"), "utf8"),
    readFile(path.resolve("src/apps/android-teacher-offline/hostedOpenResponseDraftProvider.js"), "utf8"),
    readFile(path.resolve("src/apps/android-teacher-offline/hostedNativeDraftProvider.js"), "utf8"),
    readFile(path.resolve("src/apps/android-teacher-offline/noHostedNativeDraftProvider.js"), "utf8"),
    readFile(path.resolve("scripts/netlify/build-review-target.mjs"), "utf8"),
  ]);
  assert.match(profiles, /INTERACTIVE_HOSTED_REVIEW[\s\S]*teacherSolutions:\s*false[\s\S]*teacherPresentation:\s*false[\s\S]*authorizedTeacherPreview:\s*true/);
  assert.match(vite, /authorizedTeacherPreview[\s\S]*TeacherAnswerUi\.jsx/);
  assert.doesNotMatch(vite, /hostedReviewTeacherSolutions|teacher-solutions\.json/);
  assert.match(embedded, /runtimeContext \|\| resolveHostedViewerRuntimeContext\(\)[\s\S]*effectiveRuntimeContext\.teacherPreview/);
  assert.match(hostedSolutions, /hostedReleasePath[\s\S]*teacher-solution/);
  assert.doesNotMatch(hostedSolutions, /teacher-solutions\.json|acceptedAnswers|correctOptionId|modelAnswers?|revealText/i);
  assert.match(packagedSolutions, /teacher-solutions\.json[\s\S]*getOfflineTeacherSolution/);
  assert.match(releaseProvider, /native-teacher/);
  assert.match(previewProvider, /teacher-solution|open-response-teacher/);
  assert.match(vite, /virtual:hosted-native-drafts/);
  assert.match(nativeDraftProvider, /HOSTED_VIEWER_RUNTIME_MODES\.BUILDER_PREVIEW/);
  assert.match(nativeDraftProvider, /authorizedHostedPreviewPath\(`\/preview\/native-activities/);
  assert.match(nativeDraftProvider, /credentials:\s*"omit"/);
  assert.doesNotMatch(nativeDraftProvider, /localStorage|sessionStorage|document\.cookie|object_key|storage_bucket|BUILDER_PREVIEW_AUTH_SECRET/i);
  assert.doesNotMatch(disabledNativeDraftProvider, /fetch|preview\/native-activities|modelAnswers/i);
  assert.doesNotMatch(buildScript, /generateTeacherReviewSolutions|android-teacher\/build-pack/);

  const artifactText = (await Promise.all((await textFiles(root)).map((file) => readFile(file, "utf8")))).join("\n");
  assert.match(artifactText, /Ultimate B2 Viewer/);
  assert.match(artifactText, /previewAuthorization/);
  assert.doesNotMatch(artifactText, /Ultimate B2 Teacher Review|Films are an art form which involve many artistic processes|PHASE_5_PRIVATE_TEACHER_SENTINEL|BUILDER_PREVIEW_AUTH_SECRET|builder-native-assets\/source\.png|storage_bucket|object_key/);
  assert.doesNotMatch(artifactText, /builderContentApiRoot|\/builder\/api\/auth|\/builder\/api\/content/);
}

async function verifySlimBuilderArtifact(root) {
  const forbiddenExtensions = new Set([".aac", ".m4a", ".mp3", ".ogg", ".wav", ".m4v", ".mp4", ".webm", ".gaf"]);
  const forbidden = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && forbiddenExtensions.has(path.extname(entry.name).toLowerCase())) {
        forbidden.push(path.relative(root, absolute).replaceAll("\\", "/"));
      }
    }
  };
  await visit(root);
  assert.deepEqual(forbidden, [], `Builder emitted Viewer-only media/runtime assets:\n${forbidden.join("\n")}`);
}

async function sourceFilesUnder(root, relative = "") {
  const files = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFilesUnder(root, child));
    else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|go)$/i.test(entry.name)) files.push(child.replaceAll("\\", "/"));
  }
  return files;
}

async function verifyBuilderFunctionLayout() {
  const functionsRoot = path.resolve("netlify-sites/ultimate-b2-builder/functions");
  const serverRoot = path.resolve("netlify-sites/ultimate-b2-builder/server");
  assert.deepEqual((await sourceFilesUnder(functionsRoot)).sort(), ["builder-auth.js", "builder-content.js", "builder-native-activities.js", "builder-native-preview.js", "builder-open-response-import.js", "builder-pages.js", "builder-preview-authorization.js", "builder-preview.js", "builder-publication.js", "builder-teacher-ui-assets.js", "builder-unit-extra-assets.js"]);
  assert.deepEqual((await sourceFilesUnder(serverRoot)).sort(), [
    "_builder-activity-order.js", "_builder-auth.js", "_builder-canonical-release-assets.js", "_builder-component-registry.js", "_builder-content-registry.js", "_builder-content-security.js",
    "_builder-content-store.js", "_builder-content.js", "_builder-login-rate-limit.js", "_builder-managed-publication-compiler.js", "_builder-managed-ui-publication-compiler.js", "_builder-managed-ui-publication-sources.js", "_builder-native-activities.js", "_builder-native-activity-store.js", "_builder-native-answer-delivery.js", "_builder-native-preview.js", "_builder-native-teacher-assets.js", "_builder-native-upload-descriptor.js",
    "_builder-open-response-import-store.js", "_builder-open-response-import.js", "_builder-overview-ui-capability.js", "_builder-page-catalog.js", "_builder-pages-store.js", "_builder-pages.js", "_builder-preview-authorization-handler.js", "_builder-preview-authorization.js", "_builder-preview.js", "_builder-private-font-response.js",
    "_builder-product-publication-domain.js", "_builder-product-publication-store.js", "_builder-product-publication.js", "_builder-publication-assets.js", "_builder-publication-compiler-v2.js", "_builder-publication-compiler-v3.js", "_builder-publication-compiler.js", "_builder-publication-compilers.js", "_builder-publication-pins.js", "_builder-publication-sources-v3.js", "_builder-publication-store.js", "_builder-publication-ui-assets.js", "_builder-publication.js",
    "_builder-related-context.js", "_builder-release-source-delivery.js", "_builder-teacher-ui-assets-store.js", "_builder-teacher-ui-assets.js", "_builder-teacher-ui-document.js", "_builder-unit-extra-assets-store.js", "_builder-unit-extra-assets.js", "_canonical-release-page-delivery.js", "_managed-drag-drop-history.js", "_managed-native-activity-adapter.js", "_native-activity-adapters.js", "_native-activity-registry.js", "_native-catalog-failure.js", "_students-book-current-extras.js", "_students-book-native-activity-adapter.js", "_students-book-page-authority.js",
  ]);
  for (const entry of ["builder-auth.js", "builder-content.js", "builder-native-activities.js", "builder-native-preview.js", "builder-open-response-import.js", "builder-pages.js", "builder-preview-authorization.js", "builder-preview.js", "builder-publication.js", "builder-teacher-ui-assets.js", "builder-unit-extra-assets.js"]) {
    const source = await readFile(path.join(functionsRoot, entry), "utf8");
    if (entry === "builder-publication.js") {
      assert.match(source, /parseBuilderProductPublicationRoute\(event\)[\s\S]*productHandler\(event, context\)[\s\S]*componentHandler\(event, context\)/);
    } else {
      assert.match(source, /export const handler = createBuilder(?:Auth|Content|NativeActivities|NativePreview|OpenResponseImport|Pages|PreviewAuthorization|Preview|TeacherUiAssets|UnitExtraAssets)Handler\(\)/);
    }
  }
}

async function verifyBuilderPageAssets(root) {
  const pageRoot = path.join(root, "page-library/ultimate-b2/ultimate-b2-students-book");
  const files = (await readdir(pageRoot)).sort();
  const fileName = (page) => `${page.pageId}${page.mimeType === "image/jpeg" ? ".jpg" : page.mimeType === "image/webp" ? ".webp" : ".png"}`;
  const expected = studentsBookPageAssets.pages.map(fileName).sort();
  assert.deepEqual(files, expected);
  for (const page of studentsBookPageAssets.pages) {
    assert.equal((await stat(path.join(pageRoot, fileName(page)))).size, page.byteSize, `Builder page byte size mismatch: ${page.pageId}`);
  }
}

async function textFiles(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await textFiles(absolute));
    else if (entry.isFile() && [".html", ".js", ".css", ".json", ".txt", ".xml"].includes(path.extname(entry.name).toLowerCase())) output.push(absolute);
  }
  return output;
}

export async function verifyReviewBundle(targetName) {
  const relativeRoot = roots[targetName];
  if (!relativeRoot) throw new Error(`Unknown review bundle target: ${targetName}`);
  const root = path.resolve(relativeRoot);
  assert.ok((await stat(root).catch(() => null))?.isDirectory(), `${targetName} review output is missing.`);
  const publicViewer = targetName === "ultimate-b2-interactive";
  await verifyViewerExitFullscreenProtocol();
  const generic = await scanWebBundle(root);
  assert.deepEqual(generic.findings, [], `${targetName} failed generic web safety:\n${JSON.stringify(generic.findings, null, 2)}`);
  if (targetName === "ultimate-b2-builder") {
    await verifyBuilderFunctionLayout();
    await verifyBuilderPageAssets(root);
    await verifyBuilderMutationSources();
    await verifySlimBuilderArtifact(root);
  }
  if (publicViewer) { await verifyPublicViewerSourcesAndArtifact(root); await verifyBuilderPageAssets(root); }
  const findings = [];
  const builderApiRoutes = new Set();
  for (const file of await textFiles(root)) {
    const content = await readFile(file, "utf8");
    if (targetName === "ultimate-b2-builder") {
      for (const match of content.matchAll(/\/builder\/api\/[a-z0-9/_-]*/gi)) builderApiRoutes.add(match[0]);
    }
    for (const [label, pattern] of targetPatterns[targetName] || []) {
      if (label === "Teacher answer control" && path.extname(file).toLowerCase() === ".css") continue;
      pattern.lastIndex = 0;
      const count = [...content.matchAll(pattern)].length;
      if (count) findings.push({ file: path.relative(root, file).replaceAll("\\", "/"), label, count });
    }
  }
  if (targetName === "ultimate-b2-builder") {
    for (const route of builderApiRoutes) {
      if (!route.startsWith("/builder/api/auth") && !route.startsWith("/builder/api/content") && !route.startsWith("/builder/api/native-activities") && !route.startsWith("/builder/api/open-response-import") && !route.startsWith("/builder/api/pages") && !route.startsWith("/builder/api/preview-authorization") && !route.startsWith("/builder/api/ui-assets") && !route.startsWith("/builder/api/unit-extras") && !route.startsWith("/builder/api/publication")) {
        findings.push({ file: "<bundle>", label: "unapproved Builder API route", count: 1 });
      }
    }
    assert.ok([...builderApiRoutes].some((route) => route.startsWith("/builder/api/auth")), "Builder auth route is missing from bundle.");
    assert.ok([...builderApiRoutes].some((route) => route.startsWith("/builder/api/content")), "Builder content route is missing from bundle.");
    assert.ok([...builderApiRoutes].some((route) => route.startsWith("/builder/api/native-activities")), "Builder native activity route is missing from bundle.");
    assert.ok([...builderApiRoutes].some((route) => route.startsWith("/builder/api/preview-authorization")), "Builder preview authorization route is missing from bundle.");
    assert.ok([...builderApiRoutes].some((route) => route.startsWith("/builder/api/open-response-import")), "Builder source-import route is missing from bundle.");
    assert.ok([...builderApiRoutes].some((route) => route.startsWith("/builder/api/pages")), "Builder Pages route is missing from bundle.");
    assert.ok([...builderApiRoutes].some((route) => route.startsWith("/builder/api/ui-assets")), "Builder Teacher UI asset route is missing from bundle.");
    assert.ok([...builderApiRoutes].some((route) => route.startsWith("/builder/api/unit-extras")), "Builder Unit Extras route is missing from bundle.");
    assert.ok([...builderApiRoutes].some((route) => route.startsWith("/builder/api/publication")), "Builder publication route is missing from bundle.");
  }
  assert.deepEqual(findings, [], `${targetName} contains forbidden hosted-review content:\n${JSON.stringify(findings, null, 2)}`);
  return { target: targetName, filesScanned: generic.filesScanned, findings: 0, status: "safe" };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invoked) verifyReviewBundle(process.argv[2]).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
