import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import configure from "../vite.config.js";

test("Unit Extras status resolves and emits only the supported profile dependency graph", async () => {
  const app = await readFile(new URL("../src/apps/android-teacher-offline/TeacherOfflineApp.jsx", import.meta.url), "utf8");
  assert.match(app, /import \{ HostedUnitExtrasDraftStatus \} from "virtual:unit-extras-draft-status"/);
  const modes = ["android-teacher-offline", "android-offline", "android-teacher-project", "web", "netlify-book-builder-review", "netlify-ultimate-b2-interactive-review"];
  const previousMode = process.env.VITE_APP_MODE, previousProfile = process.env.HHPLMS_BUILD_PROFILE;
  try {
    delete process.env.HHPLMS_BUILD_PROFILE;
    for (const mode of modes) {
      process.env.VITE_APP_MODE = mode;
      const config = configure({ mode: "test" });
      const selected = config.resolve.alias.find(entry => entry.find === "virtual:unit-extras-draft-status").replacement;
      const hosted = mode === "netlify-ultimate-b2-interactive-review";
      assert.ok(selected.replaceAll("\\", "/").endsWith(hosted ? "/HostedUnitExtrasDraftStatus.jsx" : "/NoUnitExtrasDraftStatus.js"), mode);
      const result = await build({
        configFile: false, envFile: false, logLevel: "silent", plugins: [react()], resolve: config.resolve,
        build: { write: false, lib: { entry: selected, formats: ["es"] },
          rolldownOptions: { external: ["react", "react/jsx-runtime"] } },
      });
      const outputs = (Array.isArray(result) ? result : [result]).flatMap(value => value.output);
      const chunks = outputs.filter(value => value.type === "chunk");
      assert.ok(chunks.length, mode);
      const modules = chunks.flatMap(chunk => Object.keys(chunk.modules));
      const emitted = chunks.map(chunk => chunk.code).join("\n");
      if (hosted) {
        assert.ok(modules.some(id => id.endsWith("/hostedComponentReleaseProvider.js")));
        assert.match(emitted, /\/preview\/content\/books\//);
        assert.match(emitted, /Saved Draft Unit Extras are unavailable/);
      } else {
        assert.ok(modules.every(id => !/hostedComponentReleaseProvider|HostedUnitExtrasDraftStatus\.jsx/.test(id)), mode);
        assert.doesNotMatch(emitted, /\/preview\/|fetch\s*\(|XMLHttpRequest|WebSocket/, mode);
        const namespace = await import(`data:text/javascript,${encodeURIComponent(emitted)}`);
        assert.equal(namespace.HostedUnitExtrasDraftStatus(), null, mode);
      }
    }
  } finally {
    if (previousMode === undefined) delete process.env.VITE_APP_MODE; else process.env.VITE_APP_MODE = previousMode;
    if (previousProfile === undefined) delete process.env.HHPLMS_BUILD_PROFILE; else process.env.HHPLMS_BUILD_PROFILE = previousProfile;
  }
});
