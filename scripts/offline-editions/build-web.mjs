import fs from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { verifyPackDirectory } from "../../lib/offline-editions/materialize.js";
import { verifyEditionWeb } from "../../lib/offline-editions/verify-apk.js";
import { ultimateB2TeacherAppAuthoring } from "../../src/data/ultimate-b2/teacherAppAuthoring.js";
import { PACK_WEB_ROOT } from "../../src/data/offline-editions/contract.js";

const [packRoot, outDir] = process.argv.slice(2);
const root = process.cwd();
if (await fs.readFile(path.join(root, ".offline-build-owned"), "utf8") !== "offline-editions.v1") throw new Error("offline_build_staging_required");
const { manifest } = await verifyPackDirectory(packRoot);
await fs.writeFile(path.join(root, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'"><title>Ultimate B2 Offline Teacher</title></head><body><div id="root"></div><script type="module" src="/src/apps/android-edition-offline/entry.jsx"></script></body></html>`);
const resolve = (relative) => path.join(root, relative);
const runtimeUi = JSON.parse(JSON.stringify({ schemaVersion: ultimateB2TeacherAppAuthoring.schemaVersion, packageId: ultimateB2TeacherAppAuthoring.packageId,
  shell: ultimateB2TeacherAppAuthoring.shell, assets: Object.fromEntries(Object.keys(manifest.canonicalUi).map((id) => [id, ultimateB2TeacherAppAuthoring.assets[id]])) }, (key, value) => key === "repositoryPath" ? undefined : value));
const uiProjection = { name: "offline-edition-ui-projection", resolveId(id) { if (id === "virtual:offline-classroom-ui") return "\0offline-classroom-ui"; },
  load(id) { if (id === "\0offline-classroom-ui") return `export const ultimateB2TeacherAppAuthoring=${JSON.stringify(runtimeUi)};`; },
  generateBundle() {
    for (const id of this.getModuleIds()) {
      const name = id.replaceAll("\\", "/");
      if (/\/src\/data\/ultimate-b2\/(?:authoring\/|runtime\/|generated\/|studentsBook(?:Authoring)?Catalog\.js)/.test(name)) throw new Error("offline_authoring_content_forbidden");
    }
  } };
await build({ configFile: false, envDir: false, root, base: "./", publicDir: false, plugins: [react(), uiProjection],
  define: { __OFFLINE_PACK_SHA256__: JSON.stringify(manifest.packSha256), __HHPLMS_BUILD_PROFILE__: JSON.stringify("android-teacher-edition"), "import.meta.env.VITE_APP_MODE": JSON.stringify("android-teacher-edition") },
  resolve: { alias: [
    { find: /^.*\/ultimateB2AuthoredAssetUrls\.js$/, replacement: resolve("src/apps/android-edition-offline/provider.js") },
    { find: /^.*\/teacherAppAuthoring\.js$/, replacement: "virtual:offline-classroom-ui" },
    { find: /^.*\/readingExerciseRuntimeData\.js$/, replacement: resolve("src/apps/android-edition-offline/legacyDisabled.js") },
    { find: /^.*\/hostedReleasePreview\.js$/, replacement: resolve("src/apps/android-edition-offline/hostedDisabled.js") },
    { find: /^.*\/teacherUiDelivery\.js$/, replacement: resolve("src/apps/android-edition-offline/hostedDisabled.js") },
    { find: "virtual:component-publication", replacement: resolve("src/apps/android-edition-offline/provider.js") },
    { find: "virtual:published-native-activity-runner", replacement: resolve("src/components/lms/activities/ultimate-b2/PublishedNativeTeacherActivityRunner.jsx") },
    { find: "virtual:teacher-listening-player-assets", replacement: resolve("src/apps/android-teacher-offline/TeacherListeningPlayerAssets.js") },
    { find: "virtual:teacher-answer-ui", replacement: resolve("src/components/lms/activities/ultimate-b2/TeacherAnswerUi.jsx") },
  ] },
  build: { outDir, emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0 },
});
await fs.cp(packRoot, path.join(outDir, PACK_WEB_ROOT), { recursive: true, errorOnExist: true, force: false });
await verifyPackDirectory(path.join(outDir, PACK_WEB_ROOT), manifest.packSha256);
await verifyEditionWeb(outDir);
