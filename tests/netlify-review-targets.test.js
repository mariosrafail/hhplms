import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { BUILD_PROFILE_IDS, buildProfiles, resolveBuildProfile } from "../src/config/buildProfiles.js";
import { reviewBuildPolicy, reviewTargets } from "../scripts/netlify/build-review-target.mjs";
import { deploymentBuildPolicy } from "../scripts/netlify-build.mjs";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

function tomlString(configuration, section, key) {
  const header = `[${section}]`;
  const sectionStart = configuration.indexOf(header);
  if (sectionStart < 0) return undefined;
  const remainder = configuration.slice(sectionStart + header.length);
  const nextSection = remainder.search(/^\[/m);
  const sectionBody = nextSection < 0 ? remainder : remainder.slice(0, nextSection);
  return sectionBody.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"\\s*$`, "m"))?.[1];
}

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...await filesUnder(child));
    else if (entry.isFile()) files.push(entry.name);
  }
  return files;
}

test("dedicated Builder site package isolates build output and Netlify Functions", async () => {
  const [builderNetlify, rootNetlify] = await Promise.all([
    read("netlify-sites/ultimate-b2-builder/netlify.toml"),
    read("netlify.toml"),
  ]);
  const configuredFunctionsDirectory = tomlString(builderNetlify, "functions", "directory");
  const functionFiles = await filesUnder(new URL(`../${configuredFunctionsDirectory}/`, import.meta.url));
  const serverFiles = await filesUnder(new URL("../netlify-sites/ultimate-b2-builder/server/", import.meta.url));
  const supportedSource = /\.(?:[cm]?[jt]sx?|go)$/i;
  const [builderAuthEntry, builderContentEntry, builderImportEntry, builderPreviewEntry, builderUiAssetsEntry, builderPublicationEntry, nativeEntry, nativePreviewEntry, previewAuthorizationEntry, unitExtraAssetsEntry, pagesEntry] = await Promise.all([
    read(`${configuredFunctionsDirectory}/builder-auth.js`),
    read(`${configuredFunctionsDirectory}/builder-content.js`),
    read(`${configuredFunctionsDirectory}/builder-open-response-import.js`),
    read(`${configuredFunctionsDirectory}/builder-preview.js`),
    read(`${configuredFunctionsDirectory}/builder-teacher-ui-assets.js`),
    read(`${configuredFunctionsDirectory}/builder-publication.js`),
    read(`${configuredFunctionsDirectory}/builder-native-activities.js`),
    read(`${configuredFunctionsDirectory}/builder-native-preview.js`),
    read(`${configuredFunctionsDirectory}/builder-preview-authorization.js`),
    read(`${configuredFunctionsDirectory}/builder-unit-extra-assets.js`),
    read(`${configuredFunctionsDirectory}/builder-pages.js`),
  ]);

  assert.equal(tomlString(builderNetlify, "build", "command"), "npm run build:netlify:ultimate-b2-builder");
  assert.equal(tomlString(builderNetlify, "build", "publish"), "dist-netlify/ultimate-b2-builder");
  assert.equal(tomlString(builderNetlify, "build.environment", "HHPLMS_NETLIFY_REVIEW_TARGET"), "ultimate-b2-builder");
  assert.equal(configuredFunctionsDirectory, "netlify-sites/ultimate-b2-builder/functions");
  assert.doesNotMatch(builderNetlify, /(?:^|["/])netlify\/functions(?:["/]|$)/m);
  assert.match(builderNetlify, /from = "\/builder\/api\/auth"[\s\S]*to = "\/\.netlify\/functions\/builder-auth"/);
  assert.match(builderNetlify, /from = "\/builder\/preview\/content\/\*"[\s\S]*to = "\/\.netlify\/functions\/builder-preview\/:splat"[\s\S]*status = 200[\s\S]*force = true/);
  assert.match(builderNetlify, /from = "\/builder\/api\/open-response-import\/\*"[\s\S]*to = "\/\.netlify\/functions\/builder-open-response-import\/:splat"/);
  assert.match(builderNetlify, /from = "\/\*"[\s\S]*to = "\/ultimate-b2-builder\.html"/);
  assert.doesNotMatch(builderNetlify, /DATABASE_URL|BUILDER_AUTH_RATE_LIMIT_SALT|ULTIMATE_B2_CONTENT_ROOT|AUTH_RATE_LIMIT_SALT|PLATFORM_ADMIN_RATE_LIMIT_SALT|HHPLMS_STAGING_QA_PASSWORD|neon\.tech|__hhplms/i);
  assert.deepEqual(functionFiles.filter((file) => supportedSource.test(file)).sort(), ["builder-auth.js", "builder-content.js", "builder-native-activities.js", "builder-native-preview.js", "builder-open-response-import.js", "builder-pages.js", "builder-preview-authorization.js", "builder-preview.js", "builder-publication.js", "builder-teacher-ui-assets.js", "builder-unit-extra-assets.js"]);
  assert.deepEqual(serverFiles.filter((file) => supportedSource.test(file)).sort(), [
    "_builder-activity-order.js", "_builder-auth.js", "_builder-canonical-release-assets.js", "_builder-component-registry.js", "_builder-content-registry.js", "_builder-content-security.js",
    "_builder-content-store.js", "_builder-content.js", "_builder-login-rate-limit.js", "_builder-managed-publication-compiler.js", "_builder-native-activities.js", "_builder-native-activity-store.js", "_builder-native-answer-delivery.js", "_builder-native-preview.js", "_builder-native-teacher-assets.js", "_builder-native-upload-descriptor.js",
    "_builder-open-response-import-store.js", "_builder-open-response-import.js", "_builder-page-catalog.js", "_builder-pages-store.js", "_builder-pages.js", "_builder-preview-authorization-handler.js", "_builder-preview-authorization.js", "_builder-preview.js", "_builder-private-font-response.js",
    "_builder-product-publication-domain.js", "_builder-product-publication-store.js", "_builder-product-publication.js", "_builder-publication-assets.js", "_builder-publication-compiler-v2.js", "_builder-publication-compiler-v3.js", "_builder-publication-compiler.js", "_builder-publication-compilers.js", "_builder-publication-pins.js", "_builder-publication-sources-v3.js", "_builder-publication-store.js", "_builder-publication.js",
    "_builder-related-context.js", "_builder-release-source-delivery.js", "_builder-teacher-ui-assets-store.js", "_builder-teacher-ui-assets.js", "_builder-teacher-ui-document.js", "_builder-unit-extra-assets-store.js", "_builder-unit-extra-assets.js", "_canonical-release-page-delivery.js", "_managed-native-activity-adapter.js", "_native-activity-adapters.js", "_native-activity-registry.js", "_native-catalog-failure.js", "_students-book-native-activity-adapter.js", "_students-book-page-authority.js",
  ]);
  assert.match(builderAuthEntry, /export const handler = createBuilderAuthHandler\(\)/);
  assert.match(builderContentEntry, /export const handler = createBuilderContentHandler\(\)/);
  assert.match(builderImportEntry, /export const handler = createBuilderOpenResponseImportHandler\(\)/);
  assert.match(builderPreviewEntry, /export const handler = createBuilderPreviewHandler\(\)/);
  assert.match(builderUiAssetsEntry, /export const handler = createBuilderTeacherUiAssetsHandler\(\)/);
  assert.match(builderPublicationEntry, /parseBuilderProductPublicationRoute\(event\)[\s\S]*productHandler\(event, context\)[\s\S]*componentHandler\(event, context\)/);
  assert.match(nativeEntry, /export const handler = createBuilderNativeActivitiesHandler\(\)/);
  assert.match(nativePreviewEntry, /export const handler = createBuilderNativePreviewHandler\(\)/);
  assert.match(previewAuthorizationEntry, /export const handler = createBuilderPreviewAuthorizationHandler\(\)/);
  assert.match(unitExtraAssetsEntry, /export const handler = createBuilderUnitExtraAssetsHandler\(\)/);
  assert.match(pagesEntry, /export const handler = createBuilderPagesHandler\(\)/);
  assert.doesNotMatch(`${builderAuthEntry}\n${builderContentEntry}\n${builderImportEntry}\n${builderPreviewEntry}\n${builderUiAssetsEntry}`, /function\s+handler\s*\([^)]*\)\s*\{[^}]*404/is);
  assert.match(builderNetlify, /from = "\/builder\/api\/content\/\*"[\s\S]*to = "\/\.netlify\/functions\/builder-content\/:splat"/);
  assert.match(builderNetlify, /from = "\/builder\/api\/ui-assets\/\*"[\s\S]*to = "\/\.netlify\/functions\/builder-teacher-ui-assets\/:splat"/);
  assert.match(builderNetlify, /from = "\/builder\/preview\/ui-assets-v2\/\*"[\s\S]*to = "\/\.netlify\/functions\/builder-teacher-ui-assets\/preview\/ui-assets-v2\/:splat"/);
  assert.match(builderNetlify, /from = "\/builder\/api\/publication\/\*"[\s\S]*to = "\/\.netlify\/functions\/builder-publication\/:splat"/);
  assert.match(builderNetlify, /from = "\/builder\/api\/native-activities\/\*"[\s\S]*to = "\/\.netlify\/functions\/builder-native-activities\/:splat"/);
  assert.match(builderNetlify, /from = "\/builder\/preview\/native-activities\/\*"[\s\S]*to = "\/\.netlify\/functions\/builder-native-preview\/:splat"/);
  assert.match(builderNetlify, /from = "\/builder\/preview\/pages\/\*"[\s\S]*to = "\/\.netlify\/functions\/builder-pages\/preview\/pages\/:splat"/);
  assert.match(builderNetlify, /from = "\/builder\/preview\/authorization\/exchange"[\s\S]*to = "\/\.netlify\/functions\/builder-preview-authorization\/preview\/authorization\/exchange"/);
  assert.match(builderNetlify, /from = "\/builder\/api\/preview-authorization"[\s\S]*to = "\/\.netlify\/functions\/builder-preview-authorization"/);
  assert.match(builderNetlify, /from = "\/builder\/api\/unit-extras\/\*"[\s\S]*to = "\/\.netlify\/functions\/builder-unit-extra-assets\/:splat"/);
  assert.match(builderNetlify, /from = "\/builder\/preview\/unit-extras\/\*"[\s\S]*to = "\/\.netlify\/functions\/builder-unit-extra-assets\/preview\/unit-extras\/:splat"/);
  assert.match(builderNetlify, /from = "\/builder\/api\/pages\/\*"[\s\S]*to = "\/\.netlify\/functions\/builder-pages\/:splat"/);
  assert.doesNotMatch(builderNetlify, /platform-admin|auth-signin|book-builder|__hhplms/i);

  assert.equal(tomlString(rootNetlify, "build", "command"), "npm run deploy:build");
  assert.equal(tomlString(rootNetlify, "build", "publish"), "dist");
  assert.equal(tomlString(rootNetlify, "build", "functions"), "netlify/functions");
  assert.match(rootNetlify, /from = "\/platform-admin\/api\/auth"/);
});

test("dedicated Viewer site package isolates the Interactive output and Netlify Functions", async () => {
  const [viewerNetlify, builderNetlify] = await Promise.all([
    read("netlify-sites/viewer/netlify.toml"),
    read("netlify-sites/ultimate-b2-builder/netlify.toml"),
  ]);
  const functionFiles = await filesUnder(new URL("../netlify-sites/viewer/functions/", import.meta.url));

  assert.equal(tomlString(viewerNetlify, "build", "command"), "npm run build:netlify:ultimate-b2-interactive");
  assert.equal(tomlString(viewerNetlify, "build", "publish"), "dist-netlify/ultimate-b2-interactive");
  assert.equal(tomlString(viewerNetlify, "build.environment", "HHPLMS_NETLIFY_REVIEW_TARGET"), "viewer");
  assert.equal(tomlString(viewerNetlify, "functions", "directory"), "netlify-sites/viewer/functions");
  assert.doesNotMatch(viewerNetlify, /(?:^|["/])netlify\/functions(?:["/]|$)/m);
  assert.match(viewerNetlify, /from = "\/preview\/content\/\*"[\s\S]*to = "https:\/\/hhplms-builder\.netlify\.app\/builder\/preview\/content\/:splat"[\s\S]*status = 200[\s\S]*force = true/);
  assert.match(viewerNetlify, /from = "\/preview\/open-response-import\/\*"[\s\S]*builder\/preview\/open-response-import\/:splat/);
  assert.match(viewerNetlify, /from = "\/preview\/open-response-teacher\/\*"[\s\S]*builder\/preview\/open-response-teacher\/:splat/);
  assert.match(viewerNetlify, /from = "\/preview\/open-response-assets\/\*"[\s\S]*builder\/preview\/open-response-assets\/:splat/);
  assert.match(viewerNetlify, /from = "\/preview\/ui-assets-v2\/\*"[\s\S]*builder\/preview\/ui-assets-v2\/:splat/);
  assert.match(viewerNetlify, /from = "\/preview\/ui-assets\/\*"[\s\S]*builder\/preview\/ui-assets\/:splat/);
  assert.match(viewerNetlify, /from = "\/preview\/native-activities\/\*"[\s\S]*builder\/preview\/native-activities\/:splat/);
  assert.match(viewerNetlify, /from = "\/preview\/pages\/\*"[\s\S]*builder\/preview\/pages\/:splat/);
  assert.match(viewerNetlify, /from = "\/preview\/authorization\/exchange"[\s\S]*builder\/preview\/authorization\/exchange/);
  assert.match(viewerNetlify, /from = "\/preview\/releases\/\*"[\s\S]*builder\/preview\/releases\/:splat/);
  assert.equal([...viewerNetlify.matchAll(/https?:\/\//g)].length, 10);
  assert.doesNotMatch(viewerNetlify, /\/builder\/api\/(?:auth|content)|\/\.netlify\/functions|DATABASE_URL|ULTIMATE_B2_CONTENT_ROOT|AUTH_RATE_LIMIT_SALT|PLATFORM_ADMIN_RATE_LIMIT_SALT|HHPLMS_STAGING_QA_PASSWORD|neon\.tech|__hhplms/i);
  assert.deepEqual(functionFiles.filter((file) => /\.(?:[cm]?[jt]sx?|go)$/i.test(file)), []);

  assert.equal(tomlString(builderNetlify, "build", "command"), "npm run build:netlify:ultimate-b2-builder");
  assert.equal(tomlString(builderNetlify, "build.environment", "HHPLMS_NETLIFY_REVIEW_TARGET"), "ultimate-b2-builder");
  assert.equal(tomlString(builderNetlify, "functions", "directory"), "netlify-sites/ultimate-b2-builder/functions");
});

test("Netlify review targets have explicit isolated profiles and outputs", () => {
  assert.deepEqual(Object.keys(reviewTargets), ["lms", "ultimate-b2-builder", "ultimate-b2-interactive"]);
  assert.deepEqual(new Set(Object.values(reviewTargets).map((target) => target.outDir)), new Set([
    "dist-netlify/lms", "dist-netlify/ultimate-b2-builder", "dist-netlify/ultimate-b2-interactive",
  ]));
  assert.equal(resolveBuildProfile(BUILD_PROFILE_IDS.BUILDER_LOCAL_AUTHORING).builderMutations, true);
  assert.equal(resolveBuildProfile(BUILD_PROFILE_IDS.BUILDER_LOCAL_AUTHORING).builderReadOnly, false);
  assert.equal(resolveBuildProfile(BUILD_PROFILE_IDS.BUILDER_HOSTED_REVIEW).builderMutations, false);
  assert.equal(resolveBuildProfile(BUILD_PROFILE_IDS.BUILDER_HOSTED_REVIEW).builderReadOnly, true);
  assert.deepEqual(resolveBuildProfile(BUILD_PROFILE_IDS.BUILDER_HOSTED_REVIEW).hostedDocumentWrites, ["hotspots", "open-response", "ui-controller", "unit-extras", "native-activity-public", "native-activity-teacher"]);
  assert.equal(BUILD_PROFILE_IDS.BUILDER_HOSTED_REVIEW, "book-builder-hosted-review");
  assert.equal(reviewTargets["ultimate-b2-builder"].appMode, "netlify-book-builder-review");
  assert.equal(reviewTargets["ultimate-b2-interactive"].profile, BUILD_PROFILE_IDS.INTERACTIVE_HOSTED_REVIEW);
  assert.equal(resolveBuildProfile(BUILD_PROFILE_IDS.INTERACTIVE_HOSTED_REVIEW).teacherSolutions, false);
  assert.equal(resolveBuildProfile(BUILD_PROFILE_IDS.INTERACTIVE_HOSTED_REVIEW).teacherPresentation, true);
  assert.equal(resolveBuildProfile(BUILD_PROFILE_IDS.INTERACTIVE_HOSTED_REVIEW).authorizedTeacherPreview, true);
  assert.equal(resolveBuildProfile(BUILD_PROFILE_IDS.ANDROID_TEACHER_OFFLINE).teacherSolutions, true);
  assert.equal(resolveBuildProfile(BUILD_PROFILE_IDS.ANDROID_TEACHER_OFFLINE).teacherPresentation, true);
  assert.equal(resolveBuildProfile(BUILD_PROFILE_IDS.ANDROID_STUDENT_OFFLINE).teacherSolutions, false);
  assert.equal(resolveBuildProfile(BUILD_PROFILE_IDS.ANDROID_STUDENT_OFFLINE).teacherPresentation, false);
  assert.equal(resolveBuildProfile(BUILD_PROFILE_IDS.WEB_LMS).teacherPresentation, false);
  assert.equal(resolveBuildProfile(BUILD_PROFILE_IDS.BUILDER_HOSTED_REVIEW).teacherPresentation, false);
  assert.equal(Object.keys(buildProfiles).length, 7);
});

test("dedicated public Viewer build does not generate or package Teacher solutions", async () => {
  const buildScript = await read("scripts/netlify/build-review-target.mjs");
  assert.doesNotMatch(buildScript, /generateTeacherReviewSolutions|scripts\/android-teacher\/build-pack\.mjs|teacher-solutions/);
});

test("review build policy allows local and review contexts", () => {
  assert.equal(reviewBuildPolicy("ultimate-b2-builder", {}).context, "local");
  assert.equal(reviewBuildPolicy("ultimate-b2-builder", { NETLIFY: "true", CONTEXT: "branch-deploy", BRANCH: "dev" }).context, "branch-deploy");
  assert.equal(reviewBuildPolicy("ultimate-b2-interactive", { NETLIFY: "true", CONTEXT: "deploy-preview", BRANCH: "feature" }).context, "deploy-preview");
});

test("only the explicitly marked dedicated Builder site may use production context on dev", () => {
  const production = { NETLIFY: "true", CONTEXT: "production", COMMIT_REF: "abc" };
  const marker = { HHPLMS_NETLIFY_REVIEW_TARGET: "ultimate-b2-builder" };
  assert.deepEqual(reviewBuildPolicy("ultimate-b2-builder", { ...production, BRANCH: "dev", ...marker }), {
    context: "production", runProductionPreflight: false,
  });

  assert.throws(() => reviewBuildPolicy("ultimate-b2-builder", { ...production, BRANCH: "dev" }), /must use branch main/);
  assert.throws(() => reviewBuildPolicy("ultimate-b2-builder", { ...production, BRANCH: "dev", HHPLMS_NETLIFY_REVIEW_TARGET: "wrong-target" }), /must use branch main/);
  assert.throws(() => reviewBuildPolicy("ultimate-b2-builder", { ...production, BRANCH: "main", ...marker }), /cannot be built/);
  assert.throws(() => reviewBuildPolicy("ultimate-b2-builder", { ...production, BRANCH: "feature", ...marker }), /must use branch main/);
  assert.throws(() => reviewBuildPolicy("ultimate-b2-interactive", { ...production, BRANCH: "dev", ...marker }), /must use branch main/);
  assert.throws(() => reviewBuildPolicy("arbitrary-review", { ...production, BRANCH: "main", ...marker }), /cannot be built/);

  assert.equal(deploymentBuildPolicy({ ...production, BRANCH: "main" }).runProductionPreflight, true);
  assert.throws(() => deploymentBuildPolicy({ ...production, BRANCH: "dev", ...marker }), /must use branch main/);
});

test("only the explicitly marked dedicated Viewer site may use production context on dev", () => {
  const production = { NETLIFY: "true", CONTEXT: "production", COMMIT_REF: "abc" };
  const marker = { HHPLMS_NETLIFY_REVIEW_TARGET: "viewer" };
  assert.deepEqual(reviewBuildPolicy("ultimate-b2-interactive", { ...production, BRANCH: "dev", ...marker }), {
    context: "production", runProductionPreflight: false,
  });

  assert.throws(() => reviewBuildPolicy("ultimate-b2-interactive", { ...production, BRANCH: "dev" }), /must use branch main/);
  assert.throws(() => reviewBuildPolicy("ultimate-b2-interactive", { ...production, BRANCH: "dev", HHPLMS_NETLIFY_REVIEW_TARGET: "wrong-target" }), /must use branch main/);
  assert.throws(() => reviewBuildPolicy("ultimate-b2-interactive", { ...production, BRANCH: "main", ...marker }), /cannot be built/);
  assert.throws(() => reviewBuildPolicy("ultimate-b2-interactive", { ...production, BRANCH: "feature", ...marker }), /must use branch main/);
  assert.throws(() => reviewBuildPolicy("ultimate-b2-builder", { ...production, BRANCH: "dev", ...marker }), /must use branch main/);
  assert.throws(() => reviewBuildPolicy("arbitrary-review", { ...production, BRANCH: "main", ...marker }), /cannot be built/);

  assert.equal(deploymentBuildPolicy({ ...production, BRANCH: "main" }).runProductionPreflight, true);
  assert.throws(() => deploymentBuildPolicy({ ...production, BRANCH: "dev", ...marker }), /must use branch main/);
});

test("hosted Builder graph is slim, canonical-Viewer backed, authenticated, and exposes only registered public document mutations", async () => {
  const [hosted, hostedActivity, unifiedReview, hostedHotspots, hostedHotspotCore, hostedOpenResponse, hostedUi, contentClient, importClient, uiAssetClient, local, entry, hostedRoot, shell, vite, html] = await Promise.all([
    read("src/apps/ultimate-b2-builder/HostedUltimateB2BuilderApp.jsx"),
    read("src/apps/book-builder/hosted/HostedActivityWorkspace.jsx"),
    read("src/apps/book-builder/hosted/HostedPackageReview.jsx"),
    read("src/apps/ultimate-b2-builder/HostedUltimateB2HotspotBuilder.jsx"),
    read("src/apps/book-builder/hosted/HostedHotspotBuilder.jsx"),
    read("src/apps/ultimate-b2-builder/HostedOpenResponseEditor.jsx"),
    read("src/apps/ultimate-b2-builder/HostedTeacherUiController.jsx"),
    read("src/apps/book-builder/hosted/builderContentApi.js"),
    read("src/apps/book-builder/hosted/builderOpenResponseImportApi.js"),
    read("src/apps/book-builder/hosted/builderTeacherUiAssetApi.js"),
    read("src/apps/ultimate-b2-builder/UltimateB2BuilderApp.jsx"),
    read("src/apps/book-builder/hosted/hostedBuilderEntry.jsx"),
    read("src/apps/book-builder/hosted/HostedAuthenticatedBookBuilderApp.jsx"),
    read("src/apps/book-builder/hosted/HostedBookBuilderApp.jsx"),
    read("vite.config.js"),
    read("ultimate-b2-builder.html"),
  ]);
  assert.deepEqual([...shell.matchAll(/\{ id: "(hotspots|activities|publication)", label: "(Hotspot Builder|Activity Builder|Publication)"/g)].map((match) => match[2]), ["Hotspot Builder", "Activity Builder", "Publication"]);
  assert.doesNotMatch(hosted, /HostedTeacherUiController/);
  assert.match(hosted, /HostedUltimateB2HotspotBuilder/);
  assert.doesNotMatch(hosted, /UnifiedBuilderReview/);
  assert.match(unifiedReview, /HostedViewerPreview/);
  assert.doesNotMatch(hosted, /NormalizedStudentsBookActivity|TeacherOfflineLibrary|android-teacher-offline|ACTIVITY_MODES/);
  assert.doesNotMatch(hosted, /__hhplms|\bfetch\s*\(|FormData|method\s*:\s*["']POST|onPublisherActivityCreated/);
  assert.match(hostedActivity, /Add Activity/);
  assert.match(hostedActivity, /NativeActivityFoundationEditor/);
  assert.match(`${hostedHotspots}\n${hostedHotspotCore}`, /EditableHotspotLayer/);
  assert.match(hostedOpenResponse, /expectedRevision: revision/);
  assert.match(contentClient, /\/builder\/api\/content/);
  assert.match(contentClient, /method: "PUT"/);
  assert.match(importClient, /\/builder\/api\/open-response-import/);
  assert.match(importClient, /XMLHttpRequest/);
  assert.doesNotMatch(importClient, /@aws-sdk|secretAccessKey|base64|FormData/);
  assert.match(hostedUi, /Unsaved replacement/);
  assert.match(hostedUi, /Save UI draft/);
  assert.match(uiAssetClient, /\/builder\/api\/ui-assets/);
  assert.match(uiAssetClient, /XMLHttpRequest/);
  assert.doesNotMatch(uiAssetClient, /@aws-sdk|secretAccessKey|base64|FormData/);
  assert.doesNotMatch(`${hostedHotspots}\n${hostedOpenResponse}\n${hostedUi}\n${contentClient}\n${importClient}\n${uiAssetClient}`, /__hhplms|repositoryFileTarget|write-capability/);
  assert.match(local, /__hhplms\/ultimate-b2-publisher-activities/);
  assert.match(local, /fetch\(publisherActivityEndpoint/);
  assert.match(entry, /HostedAuthenticatedBookBuilderApp/);
  assert.doesNotMatch(entry, /virtual:book-builder-app|activityBuilderEntry|Teacher|Listening|MultipleChoice/);
  assert.match(html, /src\/apps\/book-builder\/hosted\/hostedBuilderEntry\.jsx/);
  assert.doesNotMatch(html, /activityBuilderEntry/);
  assert.match(hostedRoot, /BuilderAuthGate/);
  assert.match(vite, /netlify-book-builder-review/);
  assert.match(vite, /ultimateB2PageAssets\.hosted-builder\.js/);
  assert.match(vite, /isHostedBuilderReview[\s\S]*\? false[\s\S]*isAndroidTeacherProject/);
  assert.match(vite, /virtual:book-builder-app/);
  assert.doesNotMatch(vite, /netlify-ultimate-b2-builder-review|virtual:ultimate-b2-builder-app/);
});

test("Interactive provider split keeps Viewer answers remote and Android Teacher answers packaged", async () => {
  const [app, startup, review, reviewProvider, reviewValidation, hostedSolutions, teacher, studentSolutions, validation, vite, embedded, networkGuard, registry] = await Promise.all([
    read("src/apps/android-teacher-offline/TeacherOfflineApp.jsx"),
    read("src/apps/android-teacher-offline/interactiveStartupAssets.js"),
    read("src/apps/android-teacher-offline/reviewPackProvider.js"),
    read("src/apps/android-teacher-offline/reviewContentPackProvider.js"),
    read("src/apps/android-teacher-offline/reviewPackValidation.js"),
    read("src/apps/android-teacher-offline/hostedAuthorizedTeacherSolutions.js"),
    read("src/apps/android-teacher-offline/generatedPackProvider.js"),
    read("src/apps/android-teacher-offline/noOfflineSolutions.js"),
    read("src/apps/android-teacher-offline/packValidation.js"),
    read("vite.config.js"),
    read("src/apps/android-teacher-offline/TeacherOfflineEmbeddedActivity.jsx"),
    read("src/apps/android-teacher-offline/teacherOfflineNetworkGuard.js"),
    read("src/apps/android-teacher-offline/reviewComponentRegistry.js"),
  ]);
  assert.match(registry, /virtual:ultimate-b2-interactive-pack-provider/);
  assert.match(registry, /prepareUltimateB2StudentsBookHotspots/);
  assert.match(app, /reviewComponentRegistry/);
  assert.match(app, /runInteractiveViewerStartup/);
  assert.match(app, /Live preview content could not be loaded\. Check the connection and try again\./);
  assert.match(startup, /Promise\.all\(\[loadContentPack\(\), prepareHotspots\(\), loadUiManifest/);
  assert.match(startup, /preloadBlocking[\s\S]*status: "ready"[\s\S]*preloadBackground/);
  assert.match(review, /interactiveStartupAssets/);
  assert.doesNotMatch(review, /import teacherSolutions/);
  assert.doesNotMatch(review, /teacher-solutions\.json/);
  assert.doesNotMatch(reviewProvider, /teacherSolutions|teacher-solutions\.json/);
  assert.match(reviewProvider, /validateReviewContentPack/);
  assert.doesNotMatch(reviewValidation, /teacherSolutions|teacher-solutions\.json|acceptedAnswers|correctOptionId|modelAnswer|revealText/i);
  assert.match(hostedSolutions, /hostedReleasePath[\s\S]*teacher-solution/);
  assert.doesNotMatch(hostedSolutions, /teacher-solutions\.json|acceptedAnswers|correctOptionId|modelAnswer|revealText/i);
  assert.match(teacher, /import teacherSolutions/);
  assert.match(teacher, /getOfflineTeacherSolution/);
  assert.doesNotMatch(studentSolutions, /teacher-solutions\.json|acceptedAnswers/);
  assert.match(validation, /requireTeacherSolutions/);
  assert.match(validation, /validateReviewContentPack/);
  assert.match(validation, /validateTeacherContentPack/);
  assert.match(vite, /isHostedInteractiveReview/);
  assert.match(vite, /buildProfile\.teacherPresentation \|\| buildProfile\.authorizedTeacherPreview[\s\S]*TeacherAnswerUi\.jsx[\s\S]*NoTeacherAnswerUi\.jsx/);
  assert.match(vite, /isHostedInteractiveReview[\s\S]*hostedAuthorizedTeacherSolutions\.js/);
  assert.doesNotMatch(vite, /hostedReviewTeacherSolutions|teacher-solutions\.json/);
  assert.match(vite, /delete authoring\.source/);
  assert.match(embedded, /runtimeContext \|\| resolveHostedViewerRuntimeContext\(\)[\s\S]*activeBuildProfile\.authorizedTeacherPreview[\s\S]*effectiveRuntimeContext\.teacherPreview[\s\S]*TEACHER_PRESENTATION_OFFLINE/);
  assert.doesNotMatch(vite, /hostname|window\.location|Netlify URL/i);
  assert.match(networkGuard, /\.netlify\\\/functions\|api\\\/\|auth\\\//);
});

test("review documentation preserves the three-site matrix and existing production boundary", async () => {
  const documentation = await read("docs/netlify-review-targets.md");
  assert.match(documentation, /dist-netlify\/lms/);
  assert.match(documentation, /dist-netlify\/ultimate-b2-builder/);
  assert.match(documentation, /dist-netlify\/ultimate-b2-interactive/);
  assert.match(documentation, /Step 4: configure the dedicated Builder site/i);
  assert.match(documentation, /Production branch[^\n]*`dev`/);
  assert.match(documentation, /no branch-deploy configuration is required/i);
  assert.match(documentation, /Package directory[^\n]*`netlify-sites\/ultimate-b2-builder`/);
  assert.match(documentation, /https:\/\/<builder-site-name>\.netlify\.app/);
  assert.match(documentation, /main-only production rule/);
  assert.match(documentation, /HHPLMS_NETLIFY_REVIEW_TARGET[^\n]*ultimate-b2-builder/);
  assert.match(documentation, /dedicated Viewer site/i);
  assert.match(documentation, /Project name[^\n]*`hhplms-viewer`/);
  assert.match(documentation, /Package directory[^\n]*`netlify-sites\/viewer`/);
  assert.match(documentation, /HHPLMS_NETLIFY_REVIEW_TARGET=viewer/);
  assert.match(documentation, /https:\/\/hhplms-viewer\.netlify\.app/);
  assert.match(documentation, /ULTIMATE_B2_CONTENT_ROOT.*local publisher configuration/);
});
