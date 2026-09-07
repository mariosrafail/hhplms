import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isAllowedTeacherOfflineUrl } from "../src/apps/android-teacher-offline/teacherOfflineNetworkGuard.js";
import {
  createHostedReviewHotspotRuntime,
  ultimateB2HotspotPreviewRoute,
  validateUltimateB2HotspotPreviewEnvelope,
} from "../src/data/ultimate-b2/hostedReviewHotspotRuntime.js";

const pageId = "students-book-unit-1-page-8";
const previewAuthorization = `v1.${Buffer.from("scope").toString("base64url")}.${"a".repeat(43)}`;
const builderPreviewSearch = `?builderPreview=1&bookSlug=ultimate-b2&componentSlug=ultimate-b2-students-book&previewAuthorization=${previewAuthorization}&view=library`;

async function withViewerSearch(search, operation) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { configurable: true, value: new URL(`https://hhplms-viewer.netlify.app/${search}`) });
  try { return await operation(); } finally {
    if (descriptor) Object.defineProperty(globalThis, "location", descriptor);
    else delete globalThis.location;
  }
}

function manifest(geometry = { left: 1, top: 2, width: 3, height: 4 }) {
  return {
    schemaVersion: "1.0",
    packageSlug: "ultimate-b2",
    componentSlug: "students-book",
    pages: {
      [pageId]: [{
        id: "preview-hotspot",
        unitNumber: 1,
        pageId,
        pageNumber: 8,
        ...geometry,
        label: "Preview activity",
        actionType: "normalized_activity",
        activityKey: "ultimate-b2:students-book:unit-1:reading",
      }],
    },
  };
}

function envelope({ revision = 3, source = "database", document = manifest() } = {}) {
  return {
    bookSlug: "ultimate-b2",
    componentSlug: "ultimate-b2-students-book",
    resource: "hotspots",
    schemaVersion: "1.0",
    revision,
    source,
    document,
  };
}

function successfulFetch(value, calls) {
  return async (...arguments_) => {
    calls.push(arguments_);
    return { ok: true, json: async () => structuredClone(value) };
  };
}

test("Viewer startup performs one relative no-store fetch and installs revision 3 geometry", async () => {
  const baseline = manifest({ left: 5, top: 6, width: 7, height: 8 });
  const moved = manifest({ left: 11.125, top: 22.25, width: 13.375, height: 14.5 });
  const runtime = createHostedReviewHotspotRuntime(baseline);
  const calls = [];

  assert.deepEqual(await withViewerSearch(builderPreviewSearch, () => runtime.prepare({ fetchImpl: successfulFetch(envelope({ document: moved }), calls) })), {
    revision: 3,
    source: "database",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], `${ultimateB2HotspotPreviewRoute}?previewAuthorization=${encodeURIComponent(previewAuthorization)}`);
  assert.deepEqual(calls[0][1], { cache: "no-store", credentials: "omit" });
  assert.deepEqual(runtime.getActions({ pageId, pageNumber: 8, unitNumber: 1 })[0], {
    id: "preview-hotspot",
    label: "Preview activity",
    ariaLabel: "Preview activity",
    target: "normalized-activity",
    classification: "activity",
    availability: "enabled",
    activityKey: "ultimate-b2:students-book:unit-1:reading",
    authoredHotspot: true,
    top: "22.25%",
    left: "11.125%",
    width: "13.375%",
    height: "14.5%",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1, "Viewer startup must not start polling.");
});

test("explicit repository revision zero is accepted as authoritative live preview", async () => {
  const runtime = createHostedReviewHotspotRuntime(manifest());
  const repositoryDocument = manifest({ left: 9, top: 8, width: 7, height: 6 });
  const result = await withViewerSearch(builderPreviewSearch, () => runtime.prepare({
    fetchImpl: successfulFetch(envelope({ revision: 0, source: "repository", document: repositoryDocument }), []),
  }));
  assert.deepEqual(result, { revision: 0, source: "repository" });
  assert.equal(runtime.getActions({ pageId })[0].left, "9%");
});

test("malformed envelopes fail startup and preserve the previous in-memory state", async () => {
  const baseline = manifest({ left: 1, top: 2, width: 3, height: 4 });
  const invalidEnvelopes = [
    { ...envelope(), extra: true },
    envelope({ revision: 0, source: "database" }),
    envelope({ revision: 3, source: "repository" }),
    { ...envelope(), bookSlug: "another-book" },
    { ...envelope(), componentSlug: "students-book" },
    { ...envelope(), resource: "activities" },
    { ...envelope(), schemaVersion: "2.0" },
    envelope({ document: { ...manifest(), pages: [] } }),
  ];
  for (const invalid of invalidEnvelopes) {
    assert.throws(() => validateUltimateB2HotspotPreviewEnvelope(invalid), /invalid/);
    const runtime = createHostedReviewHotspotRuntime(baseline);
    await assert.rejects(
      withViewerSearch(builderPreviewSearch, () => runtime.prepare({ fetchImpl: successfulFetch(invalid, []) })),
      (error) => error.code === "LIVE_PREVIEW_UNAVAILABLE"
        && error.message === "Live preview content could not be loaded. Refresh and try again.",
    );
    assert.strictEqual(runtime.currentManifest(), baseline);
  }
});

test("network and non-200 failures fail visibly without silently installing committed fallback", async () => {
  const baseline = manifest();
  for (const fetchImpl of [
    async () => { throw new Error("private transport detail"); },
    async () => ({ ok: false, status: 503, json: async () => ({ error: "private server detail" }) }),
  ]) {
    const runtime = createHostedReviewHotspotRuntime(baseline);
    await assert.rejects(withViewerSearch(builderPreviewSearch, () => runtime.prepare({ fetchImpl })), (error) => (
      error.code === "LIVE_PREVIEW_UNAVAILABLE"
      && error.message === "Live preview content could not be loaded. Refresh and try again."
      && !/private|503/.test(error.message)
    ));
    assert.strictEqual(runtime.currentManifest(), baseline);
  }
});

test("bare Viewer startup keeps committed hotspots and performs no preview request", async () => {
  const baseline = manifest();
  const runtime = createHostedReviewHotspotRuntime(baseline);
  const calls = [];
  const result = await withViewerSearch("", () => runtime.prepare({ fetchImpl: async (...arguments_) => { calls.push(arguments_); throw new Error("must not fetch"); } }));
  assert.deepEqual(result, { revision: 0, source: "repository" });
  assert.deepEqual(calls, []);
  assert.strictEqual(runtime.currentManifest(), baseline);
});

test("malformed Viewer preview context fails closed before any request", async () => {
  const runtime = createHostedReviewHotspotRuntime(manifest());
  const calls = [];
  await assert.rejects(
    withViewerSearch("?builderPreview=1&previewAuthorization=malformed", () => runtime.prepare({ fetchImpl: async (...arguments_) => { calls.push(arguments_); } })),
    (error) => error.code === "LIVE_PREVIEW_UNAVAILABLE",
  );
  assert.deepEqual(calls, []);
});

test("network guard naturally allows same-origin preview and static assets while keeping blocked surfaces closed", () => {
  const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: new URL("https://hhplms-viewer.netlify.app/"),
  });
  try {
    assert.equal(isAllowedTeacherOfflineUrl("/assets/app.js"), true);
    assert.equal(isAllowedTeacherOfflineUrl(ultimateB2HotspotPreviewRoute), true);
    assert.equal(isAllowedTeacherOfflineUrl("/api/anything"), false);
    assert.equal(isAllowedTeacherOfflineUrl("/.netlify/functions/anything"), false);
    assert.equal(isAllowedTeacherOfflineUrl("/auth/anything"), false);
    assert.equal(isAllowedTeacherOfflineUrl("https://unrelated-origin.example/anything"), false);
  } finally {
    if (locationDescriptor) Object.defineProperty(globalThis, "location", locationDescriptor);
    else delete globalThis.location;
  }
});

test("Android runtime remains a bundled no-op with no preview route dependency", async () => {
  const [androidRuntime, vite, app, generatedProvider, registry] = await Promise.all([
    readFile("src/data/ultimate-b2/studentsBookHotspots.js", "utf8"),
    readFile("vite.config.js", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineApp.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/generatedPackProvider.js", "utf8"),
    readFile("src/apps/android-teacher-offline/reviewComponentRegistry.js", "utf8"),
  ]);
  assert.match(androidRuntime, /prepareUltimateB2StudentsBookHotspots/);
  assert.match(androidRuntime, /source: "bundled"/);
  assert.doesNotMatch(androidRuntime, /fetch\s*\(|\/preview\/content\//);
  assert.match(vite, /virtual:ultimate-b2-runtime-hotspots/);
  assert.match(vite, /hostedReviewHotspots/);
  assert.match(vite, /studentsBookHotspots/);
  assert.doesNotMatch(vite, /window\.location|hostname|netlify\.app/i);
  assert.match(app, /loadContentPack: \(\) => initialRuntime\.contentPackProvider\.load/);
  assert.match(app, /prepareHotspots: \(\) => initialRuntime\.hotspotProvider\?\.prepare/);
  assert.match(app, /startupAssets: initialRuntime\.startupAssets/);
  assert.match(app, /productState\.status === "loading"[\s\S]*TeacherViewerStartupStatus[\s\S]*teacher-offline-pack-wait/);
  assert.match(app, /start\(\)\.catch\(\(error\)[\s\S]*setProductState\(failed\)[\s\S]*updateComponentState\(initialRuntime, failed\)/);
  assert.doesNotMatch(app, /\[activeRuntime, startupAttempt\]/);
  assert.match(app, /initialRuntimeContext\.kind === HOSTED_VIEWER_RUNTIME_MODES\.BUILDER_PREVIEW/);
  assert.match(registry, /prepareUltimateB2StudentsBookHotspots/);
  assert.match(generatedProvider, /interactiveStartupAssets = createNoopStartupAssets\(\)/);
  assert.doesNotMatch(generatedProvider, /hostedReviewStartupAssets/);
});


test("Saved Draft hotspot lookup uses authoritative page identity without requiring a printed folio", async () => {
  const draft = manifest(); delete draft.pages[pageId][0].pageNumber;
  const runtime = createHostedReviewHotspotRuntime(manifest());
  await withViewerSearch(builderPreviewSearch, () => runtime.prepare({ fetchImpl: successfulFetch(envelope({ document: draft }), []) }));
  assert.equal(runtime.getActions({ pageId, pageNumber: 8, unitNumber: 1 }).length, 1);
  assert.equal(runtime.getActions({ pageId, pageNumber: null, unitNumber: 1 }).length, 1);
  assert.equal(runtime.getActions({ pageId: "foreign-page", unitNumber: 1 }).length, 0);
  assert.equal(runtime.getActions({ pageId, unitNumber: 2 }).length, 0);
  assert.deepEqual(runtime.currentManifest(), draft);
  await runtime.prepare({ runtimeContext: { kind: "bare" } });
  assert.equal(runtime.getActions({ pageId, pageNumber: 9, unitNumber: 1 }).length, 0, "bare historical folio matching remains unchanged");
});
