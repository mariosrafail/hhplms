import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";
import { legacyFlashProofPlugin } from "./scripts/ultimate-b2/legacy-flash-vite-plugin.mjs";
import { unit2ProtectedMediaPlugin } from "./scripts/ultimate-b2/unit2-media-vite-plugin.mjs";
import { ultimateB2HotspotBuilderPlugin } from "./scripts/ultimate-b2/hotspot-builder-vite-plugin.mjs";
import { ultimateB2ListeningBuilderPlugin } from "./scripts/ultimate-b2/listening-builder-vite-plugin.mjs";
import { ultimateB2MultipleChoiceBuilderPlugin } from "./scripts/ultimate-b2/multiple-choice-builder-vite-plugin.mjs";
import { ultimateB2OpenResponseBuilderPlugin } from "./scripts/ultimate-b2/open-response-builder-vite-plugin.mjs";
import { ultimateB2ImageBuilderPlugin } from "./scripts/ultimate-b2/image-builder-vite-plugin.mjs";
import { ultimateB2PublisherActivityBuilderPlugin } from "./scripts/ultimate-b2/publisher-activity-builder-vite-plugin.mjs";
import { ultimateB2Page5BuilderPlugin } from "./scripts/ultimate-b2/page5-builder-vite-plugin.mjs";
import { ultimateB2ReadingExerciseBuilderPlugin } from "./scripts/ultimate-b2/reading-exercise-builder-vite-plugin.mjs";
import { ultimateB2TeacherAppBuilderPlugin } from "./scripts/ultimate-b2/teacher-app-builder-vite-plugin.mjs";
import { ultimateB2BuilderPageAssetsPlugin } from "./scripts/ultimate-b2/builder-page-assets-vite-plugin.mjs";
import { teacherProjectVitePlugin } from "./scripts/teacher-project-builder/vite-plugin.mjs";
import { committedHotspotVitePlugin } from "./scripts/netlify/committed-hotspot-vite-plugin.mjs";
import { resolveBuildProfile } from "./src/config/buildProfiles.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const serverEnvironment = { ...process.env, ...env };
  const appMode = env.VITE_APP_MODE || process.env.VITE_APP_MODE || "web";
  const isHostedBuilderReview = appMode === "netlify-book-builder-review";
  const isHostedInteractiveReview = appMode === "netlify-ultimate-b2-interactive-review";
  const isCloudflarePlayer = isHostedInteractiveReview
    && (env.VITE_CLOUDFLARE_PLAYER_MEDIA === "true" || process.env.VITE_CLOUDFLARE_PLAYER_MEDIA === "true");
  const isHostedReview = isHostedBuilderReview || isHostedInteractiveReview;
  const isAndroidTeacherProject = appMode === "android-teacher-project";
  const isAndroidTeacherOffline = appMode === "android-teacher-offline";
  const isTeacherRuntime = isAndroidTeacherOffline || isAndroidTeacherProject;
  const isAndroidOffline = appMode === "android-offline" || isTeacherRuntime;
  const isStaticBookRuntime = isAndroidOffline || isHostedReview;
  const isTeacherVisualRuntime = isAndroidTeacherOffline || isHostedInteractiveReview;
  const buildProfileId = process.env.HHPLMS_BUILD_PROFILE
    || (isHostedBuilderReview ? "book-builder-hosted-review"
      : isHostedInteractiveReview ? "ultimate-b2-interactive-review"
        : isAndroidTeacherOffline ? "android-teacher-offline"
          : isAndroidTeacherProject ? "android-teacher-project"
            : appMode === "android-offline" ? "android-student-offline"
              : "web-lms");
  const buildProfile = resolveBuildProfile(buildProfileId);
  const webInputs = {
    lms: path.resolve(process.cwd(), "index.html"),
    platformAdmin: path.resolve(process.cwd(), "platform-admin/index.html"),
  };
  const androidOfflineServiceStub = path.resolve(process.cwd(), "src/apps/android-offline/androidOfflineServiceStubs.js");
  const offlineDisabledBookTools = path.resolve(process.cwd(), "src/apps/android-offline/OfflineDisabledBookTools.jsx");
  const bookAuthoringTools = path.resolve(process.cwd(), "src/components/lms/books/BookAuthoringTools.jsx");
  const teacherAnswerUi = path.resolve(process.cwd(), !isStaticBookRuntime || buildProfile.teacherPresentation || buildProfile.authorizedTeacherPreview
    ? "src/components/lms/activities/ultimate-b2/TeacherAnswerUi.jsx"
    : "src/apps/android-offline/NoTeacherAnswerUi.jsx");
  const teacherListeningPlayerAssets = path.resolve(process.cwd(), buildProfile.teacherPresentation || buildProfile.authorizedTeacherPreview
    ? "src/apps/android-teacher-offline/TeacherListeningPlayerAssets.js"
    : "src/apps/android-offline/NoTeacherListeningPlayerAssets.js");
  const offlineSolutionProvider = path.resolve(
    process.cwd(),
    buildProfileId === "android-teacher-offline"
      ? "src/apps/android-teacher-offline/generatedPackProvider.js"
      : isHostedInteractiveReview
        ? "src/apps/android-teacher-offline/hostedAuthorizedTeacherSolutions.js"
        : "src/apps/android-teacher-offline/noOfflineSolutions.js",
  );
  const interactivePackProvider = path.resolve(process.cwd(), isHostedInteractiveReview
    ? "src/apps/android-teacher-offline/reviewPackProvider.js"
    : "src/apps/android-teacher-offline/generatedPackProvider.js");
  const managedReviewRuntime = path.resolve(process.cwd(), isHostedInteractiveReview
    ? "src/apps/android-teacher-offline/managedReviewRuntime.js"
    : "src/apps/android-teacher-offline/noManagedReviewRuntime.js");
  const hostedOpenResponseDraftProvider = path.resolve(process.cwd(), isHostedInteractiveReview
    ? "src/apps/android-teacher-offline/hostedOpenResponseDraftProvider.js"
    : "src/apps/android-teacher-offline/noHostedOpenResponseDraftProvider.js");
  const hostedNativeDraftProvider = path.resolve(process.cwd(), isHostedInteractiveReview
    ? "src/apps/android-teacher-offline/hostedNativeDraftProvider.js"
    : "src/apps/android-teacher-offline/noHostedNativeDraftProvider.js");
  const publishedComponentReleaseProvider = path.resolve(process.cwd(), buildProfileId === "web-lms"
    ? "src/services/publishedComponentReleaseProvider.js"
    : isHostedInteractiveReview
      ? "src/apps/android-teacher-offline/hostedComponentReleaseProvider.js"
      : "src/apps/android-offline/noPublishedComponentReleaseProvider.js");
  const publishedNativeActivityRunner = path.resolve(process.cwd(),
    appMode === "android-offline"
      ? "src/components/lms/activities/ultimate-b2/PublishedNativeStudentActivityRunner.jsx"
      : isTeacherRuntime || isHostedInteractiveReview
        ? "src/components/lms/activities/ultimate-b2/PublishedNativeTeacherActivityRunner.jsx"
        : "src/components/lms/activities/ultimate-b2/PublishedNativeActivityRunner.jsx");
  const multipleChoiceAuthoringPath = path.resolve(process.cwd(), "src/data/ultimate-b2/authoring/unit-01-reading-exercise-3.multiple-choice.json");
  const multipleChoicePresentationModuleId = "\0ultimate-b2-multiple-choice-presentation";
  const multipleChoicePresentationPlugin = {
    name: "ultimate-b2-multiple-choice-presentation",
    resolveId(id) {
      return id === "virtual:ultimate-b2-multiple-choice-presentation" ? multipleChoicePresentationModuleId : null;
    },
    load(id) {
      if (id !== multipleChoicePresentationModuleId) return null;
      if (!buildProfile.teacherPresentation) return "export default null;";
      const authoring = JSON.parse(readFileSync(multipleChoiceAuthoringPath, "utf8"));
      if (buildProfileId === "ultimate-b2-interactive-review") delete authoring.source;
      return `export default ${JSON.stringify(authoring)};`;
    },
  };
  const runtimeHotspots = path.resolve(process.cwd(), isHostedReview
    ? "src/data/ultimate-b2/hostedReviewHotspots.js"
    : "src/data/ultimate-b2/studentsBookHotspots.js");
  const builderApp = path.resolve(process.cwd(), isHostedBuilderReview
    ? "src/apps/book-builder/hosted/HostedAuthenticatedBookBuilderApp.jsx"
    : "src/apps/ultimate-b2-builder/UltimateB2BuilderApp.jsx");
  const bookAssetsService = path.resolve(process.cwd(), isStaticBookRuntime
    ? "src/apps/android-offline/androidOfflineServiceStubs.js"
    : "src/services/bookAssetsApi.js");
  const bookContentService = path.resolve(process.cwd(), isStaticBookRuntime
    ? "src/apps/android-offline/androidOfflineServiceStubs.js"
    : "src/services/bookContentApi.js");
  const ultimateB2PageAssets = path.resolve(process.cwd(), isHostedBuilderReview
    ? "src/data/ultimate-b2/ultimateB2PageAssets.hosted-builder.js"
    : isStaticBookRuntime
      ? isTeacherVisualRuntime
      ? "src/data/ultimate-b2/ultimateB2PageAssets.teacher-offline.js"
      : "src/data/ultimate-b2/ultimateB2PageAssets.offline.js"
    : "src/data/ultimate-b2/ultimateB2PageAssets.web.js");
  const ultimateB2MediaAssets = path.resolve(process.cwd(), isStaticBookRuntime
      ? isCloudflarePlayer
      ? "src/data/ultimate-b2/ultimateB2MediaAssets.cloudflare-player.js"
      : isTeacherVisualRuntime
      ? "src/data/ultimate-b2/ultimateB2MediaAssets.teacher-offline.js"
      : "src/data/ultimate-b2/ultimateB2MediaAssets.offline.js"
    : "src/data/ultimate-b2/ultimateB2MediaAssets.web.js");
  const ultimateB2CoverAssets = path.resolve(process.cwd(), isStaticBookRuntime
    ? "src/data/ultimate-b2/ultimateB2CoverAssets.offline.js"
    : "src/data/ultimate-b2/ultimateB2CoverAssets.web.js");
  const ultimateB2Unit1Part2LegacyPilotAudio = path.resolve(
    process.cwd(),
    isStaticBookRuntime
      ? "src/data/ultimate-b2/unit1Part2LegacyPilotAudio.offline.js"
      : "src/data/ultimate-b2/unit1Part2LegacyPilotAudio.web.js",
  );
  const ultimateB2LegacyContent = path.resolve(
    process.cwd(),
    "src/components/lms/activities/ultimate-b2/content/webContent.js",
  );
  const listeningAuthoringPath = path.resolve(
    process.cwd(),
    "src/data/ultimate-b2/authoring/unit-01-reading-exercise-2.listening.json",
  );
  const listeningAuthoringModuleId = "\0ultimate-b2-listening-authoring";
  const listeningAuthoringPlugin = {
    name: "ultimate-b2-listening-authoring",
    resolveId(id) {
      return id === "virtual:ultimate-b2-listening-authoring" ? listeningAuthoringModuleId : null;
    },
    load(id) {
      if (id !== listeningAuthoringModuleId) return null;
      const authoring = JSON.parse(readFileSync(listeningAuthoringPath, "utf8"));
      if (!isTeacherRuntime) delete authoring.source;
      return `export default ${JSON.stringify(authoring)};`;
    },
  };
  const hostedInteractiveTitlePlugin = {
    name: "hosted-interactive-title",
    transformIndexHtml(html) {
      return isHostedInteractiveReview
        ? html.replace("<title>Hamilton House LMS</title>", "<title>Ultimate B2 Viewer</title>")
        : html;
    },
  };
  return {
    server: {
      watch: {
        ignored: ["**/playwright-report/**", "**/test-results/**", "**/staging-artifacts/**"],
      },
    },
    build: {
      sourcemap: false,
      assetsInlineLimit: isAndroidTeacherOffline ? 0 : isAndroidTeacherProject ? 0 : 4096,
      rollupOptions: {
        input: isHostedBuilderReview
          ? path.resolve(process.cwd(), "ultimate-b2-builder.html")
          : (isAndroidOffline || isHostedInteractiveReview) ? path.resolve(process.cwd(), "index.html") : webInputs,
      },
    },
    publicDir: isHostedBuilderReview
      ? false
      : isAndroidTeacherProject
        ? path.resolve(env.TEACHER_PROJECT_PUBLIC_DIR || process.env.TEACHER_PROJECT_PUBLIC_DIR || ".teacher-project-build/missing-public")
        : undefined,
    plugins: [
      react(),
      hostedInteractiveTitlePlugin,
      listeningAuthoringPlugin,
      multipleChoicePresentationPlugin,
      committedHotspotVitePlugin({ enabled: isHostedReview }),
      ultimateB2BuilderPageAssetsPlugin({ enabled: isHostedReview }),
      isAndroidTeacherProject ? teacherProjectVitePlugin({ configPath: env.TEACHER_PROJECT_RUNTIME_CONFIG || process.env.TEACHER_PROJECT_RUNTIME_CONFIG }) : null,
      !isAndroidTeacherProject && !isHostedReview ? ultimateB2HotspotBuilderPlugin({ environment: serverEnvironment }) : null,
      !isAndroidTeacherProject && !isHostedReview ? ultimateB2ListeningBuilderPlugin({ environment: serverEnvironment }) : null,
      !isAndroidTeacherProject && !isHostedReview ? ultimateB2MultipleChoiceBuilderPlugin({ environment: serverEnvironment }) : null,
      !isAndroidTeacherProject && !isHostedReview ? ultimateB2OpenResponseBuilderPlugin({ environment: serverEnvironment }) : null,
      !isAndroidTeacherProject && !isHostedReview ? ultimateB2ImageBuilderPlugin({ environment: serverEnvironment }) : null,
      !isAndroidTeacherProject && !isHostedReview ? ultimateB2PublisherActivityBuilderPlugin({ environment: serverEnvironment }) : null,
      !isAndroidTeacherProject && !isHostedReview ? ultimateB2Page5BuilderPlugin({ environment: serverEnvironment }) : null,
      !isAndroidTeacherProject && !isHostedReview ? ultimateB2ReadingExerciseBuilderPlugin({ environment: serverEnvironment }) : null,
      !isAndroidTeacherProject && !isHostedReview ? ultimateB2TeacherAppBuilderPlugin({ environment: serverEnvironment }) : null,
      !isAndroidTeacherProject ? unit2ProtectedMediaPlugin({ androidOffline: isStaticBookRuntime }) : null,
      !isAndroidTeacherProject ? legacyFlashProofPlugin({ ...process.env, ...env }) : null,
    ].filter(Boolean),
    resolve: {
      alias: [
        {
          find: "virtual:ultimate-b2-page-assets",
          replacement: ultimateB2PageAssets,
        },
        {
          find: "virtual:ultimate-b2-media-assets",
          replacement: ultimateB2MediaAssets,
        },
        {
          find: "virtual:ultimate-b2-cover-assets",
          replacement: ultimateB2CoverAssets,
        },
        {
          find: "virtual:ultimate-b2-unit1-part2-legacy-pilot-audio",
          replacement: ultimateB2Unit1Part2LegacyPilotAudio,
        },
        {
          find: "virtual:ultimate-b2-legacy-content",
          replacement: ultimateB2LegacyContent,
        },
        {
          find: "virtual:teacher-listening-player-assets",
          replacement: teacherListeningPlayerAssets,
        },
        {
          find: "virtual:book-builder-app",
          replacement: builderApp,
        },
        {
          find: "virtual:ultimate-b2-interactive-pack-provider",
          replacement: interactivePackProvider,
        },
        {
          find: "virtual:managed-review-runtime",
          replacement: managedReviewRuntime,
        },
        {
          find: "virtual:ultimate-b2-runtime-hotspots",
          replacement: runtimeHotspots,
        },
        {
          find: "virtual:ultimate-b2-hosted-open-response-drafts",
          replacement: hostedOpenResponseDraftProvider,
        },
        {
          find: "virtual:hosted-native-drafts",
          replacement: hostedNativeDraftProvider,
        },
        {
          find: "virtual:component-publication",
          replacement: publishedComponentReleaseProvider,
        },
        {
          find: "virtual:published-native-activity-runner",
          replacement: publishedNativeActivityRunner,
        },
        {
          find: "virtual:app-entry",
          replacement: isAndroidTeacherProject
            ? "/src/apps/android-teacher-project/teacherProjectEntry.jsx"
            : (isAndroidTeacherOffline || isHostedInteractiveReview)
            ? "/src/apps/android-teacher-offline/teacherOfflineEntry.jsx"
            : isAndroidOffline
              ? "/src/apps/android-offline/offlineEntry.jsx"
              : "/src/webEntry.jsx",
        },
        {
          find: "virtual:app-styles",
          replacement: isAndroidTeacherProject
            ? "/src/apps/android-teacher-project/teacherProjectRoot.css"
            : (isAndroidTeacherOffline || isHostedInteractiveReview)
            ? "/src/apps/android-teacher-offline/teacherOfflineRoot.css"
            : isAndroidOffline
              ? "/src/apps/android-offline/offlineRoot.css"
              : "/src/styles/index.css",
        },
        {
          find: "virtual:teacher-offline-solutions",
          replacement: offlineSolutionProvider,
        },
        {
          find: "virtual:book-assets-service",
          replacement: bookAssetsService,
        },
        {
          find: "virtual:book-content-service",
          replacement: bookContentService,
        },
        {
          find: "virtual:book-authoring-tools",
          replacement: isStaticBookRuntime ? offlineDisabledBookTools : bookAuthoringTools,
        },
        {
          find: "virtual:teacher-answer-ui",
          replacement: teacherAnswerUi,
        },
        ...(isStaticBookRuntime
          ? [
              {
                find: "../../../services/bookActivitiesApi.js",
                replacement: androidOfflineServiceStub,
              },
              {
                find: "../../../../services/bookActivitiesApi.js",
                replacement: androidOfflineServiceStub,
              },
              {
                find: "../../../../services/bookMediaAssetsApi.js",
                replacement: androidOfflineServiceStub,
              },
              {
                find: "../../../../services/bookContentApi.js",
                replacement: androidOfflineServiceStub,
              },
              {
                find: "../../../services/bookPageHotspotsApi.js",
                replacement: androidOfflineServiceStub,
              },
              {
                find: "../../../services/bookAssetsApi.js",
                replacement: androidOfflineServiceStub,
              },
              {
                find: "../services/bookAssetsApi.js",
                replacement: androidOfflineServiceStub,
              },
            ]
          : []),
      ],
    },
    define: {
      __HHPLMS_BUILD_PROFILE__: JSON.stringify(buildProfileId),
    },
  };
});
