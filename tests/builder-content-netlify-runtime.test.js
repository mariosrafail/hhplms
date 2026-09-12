import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { rolldown } from "rolldown";
import * as canonicalManifest from "../scripts/ultimate-b2/hotspot-manifest.js";
import * as compatibilityManifest from "../scripts/ultimate-b2/hotspot-manifest.mjs";

const functionEntry = path.resolve("netlify-sites/ultimate-b2-builder/functions/builder-content.js");
const previewFunctionEntry = path.resolve("netlify-sites/ultimate-b2-builder/functions/builder-preview.js");
const registryPath = path.resolve("netlify-sites/ultimate-b2-builder/server/_builder-content-registry.js");

async function commonJsArtifact(input, plugins = []) {
  const bundle = await rolldown({ input, plugins });
  try {
    const generated = await bundle.generate({ format: "cjs", codeSplitting: false });
    return generated.output.find((output) => output.type === "chunk")?.code || "";
  } finally {
    await bundle.close();
  }
}

test("hotspot-manifest.mjs is a compatibility-only re-export of the canonical ESM implementation", async () => {
  const wrapper = await readFile("scripts/ultimate-b2/hotspot-manifest.mjs", "utf8");
  assert.equal(wrapper.trim(), 'export * from "./hotspot-manifest.js";');
  assert.equal(compatibilityManifest.validateAndNormalizeUltimateB2HotspotManifest, canonicalManifest.validateAndNormalizeUltimateB2HotspotManifest);
  assert.equal(compatibilityManifest.ULTIMATE_B2_HOTSPOT_SCHEMA_VERSION, canonicalManifest.ULTIMATE_B2_HOTSPOT_SCHEMA_VERSION);
});

test("deployed-style CommonJS artifacts bundle and execute the canonical hotspot validator graph", async () => {
  const registrySource = await readFile(registryPath, "utf8");
  assert.match(registrySource, /from ["']\.\.\/\.\.\/\.\.\/scripts\/ultimate-b2\/hotspot-manifest\.js["']/);
  assert.doesNotMatch(registrySource, /import\s*\(|hotspot-manifest\.mjs/);

  const functionArtifact = await commonJsArtifact(functionEntry);
  assert.ok(functionArtifact, "The deployed-style builder-content artifact was not generated.");
  assert.doesNotMatch(functionArtifact, /hotspot-manifest\.mjs|require\(["'][^"']*hotspot-manifest|import\(["'][^"']*hotspot-manifest/);
  assert.match(functionArtifact, /Students Book hotspot identity is invalid/);

  const previewFunctionArtifact = await commonJsArtifact(previewFunctionEntry);
  assert.ok(previewFunctionArtifact, "The deployed-style builder-preview artifact was not generated.");
  assert.doesNotMatch(previewFunctionArtifact, /hotspot-manifest\.mjs|require\(["'][^"']*hotspot-manifest|import\(["'][^"']*hotspot-manifest/);
  assert.doesNotMatch(previewFunctionArtifact, /acceptedAnswers|teacherSolutions|teacher-solutions\.json|revealText/);
  assert.match(previewFunctionArtifact, /native-teacher|Native Teacher/);
  assert.match(previewFunctionArtifact, /builder_preview_resource_not_found/);

  const virtualEntry = "virtual:builder-content-resource-test";
  const resourceArtifact = await commonJsArtifact(virtualEntry, [{
    name: "builder-content-resource-test-entry",
    resolveId(id) {
      if (id === virtualEntry) return `\0${virtualEntry}`;
      if (id === "builder-content-resource-registry") return registryPath;
      return null;
    },
    load(id) {
      if (id === `\0${virtualEntry}`) return 'export { resolveBuilderContentResource } from "builder-content-resource-registry";';
      return null;
    },
  }]);
  assert.ok(resourceArtifact, "The deployed-style resource artifact was not generated.");
  assert.doesNotMatch(resourceArtifact, /hotspot-manifest\.mjs|require\(["'][^"']*hotspot-manifest|import\(["'][^"']*hotspot-manifest/);
  assert.doesNotMatch(resourceArtifact, /acceptedAnswers|teacherSolutions|teacher-solutions\.json|revealText/);
  assert.match(resourceArtifact, /Students Book hotspot identity is invalid/);

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "hhplms-builder-content-"));
  try {
    const functionArtifactPath = path.join(temporaryDirectory, "builder-content.cjs");
    const previewFunctionArtifactPath = path.join(temporaryDirectory, "builder-preview.cjs");
    const resourceArtifactPath = path.join(temporaryDirectory, "builder-content-resource.cjs");
    await Promise.all([
      writeFile(functionArtifactPath, functionArtifact, "utf8"),
      writeFile(previewFunctionArtifactPath, previewFunctionArtifact, "utf8"),
      writeFile(resourceArtifactPath, resourceArtifact, "utf8"),
    ]);
    const require = createRequire(import.meta.url);
    assert.equal(typeof require(functionArtifactPath).handler, "function");
    assert.equal(typeof require(previewFunctionArtifactPath).handler, "function");

    const bundledResolver = require(resourceArtifactPath).resolveBuilderContentResource;
    assert.equal(typeof bundledResolver, "function");
    const resource = await bundledResolver("ultimate-b2", "ultimate-b2-students-book", "hotspots");
    assert.equal(resource.bookSlug, "ultimate-b2");
    assert.equal(resource.componentSlug, "ultimate-b2-students-book");
    assert.equal(resource.schemaVersion, "1.0");
    const baseline = resource.baseline();
    assert.equal(baseline.packageSlug, "ultimate-b2");
    assert.equal(baseline.componentSlug, "students-book");
    assert.deepEqual(baseline.pages, {});
    assert.throws(() => resource.validate({ ...baseline, pages: { unknown: [] } }), /Unknown Students Book page id/);
    assert.throws(() => resource.validate({ ...baseline, schemaVersion: "broken" }), /identity is invalid/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
