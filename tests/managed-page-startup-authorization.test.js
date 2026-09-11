import test from "node:test";
import assert from "node:assert/strict";
import { createManagedSavedDraftFixture, savedDraftIdentities } from "../scripts/book-builder/managed-saved-draft-fixtures.mjs";
import { createManagedReviewDescriptor } from "../src/apps/android-teacher-offline/managedReviewRuntime.js";
import { runInteractiveViewerStartup } from "../src/apps/android-teacher-offline/interactiveStartupAssets.js";
import { createHostedPreviewComponentAuthorizationSession } from "../src/apps/android-teacher-offline/hostedPreviewComponentAuthorizationSession.js";
import { exchangeHostedPreviewComponentAuthorization } from "../src/apps/android-teacher-offline/hostedReleasePreview.js";

const context = (authorization) => ({ kind: "builder-preview", teacherPreview: true, authorization });

async function withImages(fixture, run) {
  const original = globalThis.Image;
  globalThis.Image = class {
    set src(url) {
      if (!url) return;
      void fixture.fetch(url).then((response) => {
        if (response.status === 302) this.onload?.(); else this.onerror?.();
      }).catch(() => this.onerror?.());
    }
    async decode() {}
  };
  try { return await run(); } finally { globalThis.Image = original; }
}

for (const identity of savedDraftIdentities) {
  test(`${identity.componentSlug}: first and all blocking page images use the content context`, async () => {
    const fixture = createManagedSavedDraftFixture();
    const descriptor = createManagedReviewDescriptor(identity);
    const catalogToken = fixture.issue(identity).token;
    const currentToken = fixture.issue(identity).token;
    const shellToken = fixture.issue(descriptor.uiOwnerIdentity).token;
    const pack = await descriptor.contentPackProvider.load({ runtimeContext: context(catalogToken), fetchImpl: fixture.fetch });
    const before = JSON.stringify(pack);
    const states = [];
    let failure;
    await withImages(fixture, () => runInteractiveViewerStartup({
      loadContentPack: async () => pack,
      prepareHotspots: async () => {},
      startupAssets: descriptor.startupAssets,
      assetRuntimeContext: context(shellToken),
      getContentRuntimeContext: () => context(currentToken),
      onState: (state) => states.push(state.status),
    })).catch((error) => { failure = error; });
    const requests = fixture.requests.filter((request) => request.action === "managed-page-asset");
    assert.ok(requests.length > 0, "the real blocking image loader must issue a managed-page request");
    assert.ok(requests[0].token === currentToken, "the first required managed-page image request must have current content authorization");
    assert.equal(failure, undefined);
    assert.deepEqual(requests.map((request) => request.pageId).sort(), fixture.pageIds(identity).sort());
    assert.ok(requests.every((request) => request.token === currentToken && request.decision.authorized));
    assert.equal(states.at(-1), "ready");
    assert.equal(JSON.stringify(pack), before);
    assert.equal(before.includes("previewAuthorization"), false);
  });
}

test("real Worker/page handler keeps missing, malformed, expired and cross-scope page tokens denied despite cookies", async () => {
  const fixture = createManagedSavedDraftFixture();
  for (const identity of savedDraftIdentities) {
    const path = fixture.pagePath(identity);
    const wrongBook = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-workbook" };
    const wrongComponent = { ...identity, componentSlug: `${identity.bookSlug}-grammar-book` };
    for (const token of ["", "malformed", fixture.issue(identity, { issuedAt: fixture.now - 600_000 }).token,
      fixture.issue(wrongBook).token, fixture.issue(wrongComponent).token,
      fixture.issue(identity, { view: "page", pageId: fixture.pageIds(identity)[1] }).token]) {
      const response = await fixture.fetch(`${path}?previewAuthorization=${encodeURIComponent(token)}`, { headers: { Cookie: "hh_builder_session=must-not-authorize" } });
      assert.equal(response.status, 401);
    }
    const token = fixture.issue(identity, { view: "page", pageId: fixture.pageIds(identity)[0] }).token;
    assert.equal((await fixture.fetch(`${path}?previewAuthorization=${encodeURIComponent(token)}`)).status, 302);
  }
  assert.ok(fixture.requests.every((request) => request.cookie === undefined));
});

test("Workbook startup keeps content requests separate from public UI graphics and exact UI-owner release requests", async () => {
  const fixture = createManagedSavedDraftFixture();
  const identity = savedDraftIdentities[1];
  const descriptor = createManagedReviewDescriptor(identity);
  const token = fixture.issue(identity).token;
  const pack = await descriptor.contentPackProvider.load({ runtimeContext: context(token), fetchImpl: fixture.fetch });
  const ui = { assets: { background: { sha256: "b".repeat(64), extension: "png" } } };
  const owner = context(fixture.issue(descriptor.uiOwnerIdentity).token);
  const plan = descriptor.startupAssets.createLoadPlan(pack, ui, owner, context(token));
  assert.equal(plan.blocking.length, 3);
  assert.equal(plan.background.length, 0);
  assert.equal(plan.blocking[0].url, `/preview/ui-assets-v2/books/${identity.bookSlug}/components/${descriptor.uiOwnerIdentity.componentSlug}/${"b".repeat(64)}.png`);
  assert.ok(plan.blocking.slice(1).every((asset) => new URL(asset.url, "https://viewer.invalid").searchParams.get("previewAuthorization") === token));

  const releaseContext = { kind: "release-preview", releaseId: "20000000-0000-4000-8000-000000000001", authorization: `v3.member.${"c".repeat(43)}` };
  const releasePack = { assetsManifest: { resolver: "authorized-release-assets", assets: [] }, pageUnits: [{ pages: [{ id: "immutable-page", images: [`/preview/releases/books/${identity.bookSlug}/components/${identity.componentSlug}/10000000-0000-4000-8000-000000000001/assets/${"a".repeat(64)}.png?previewAuthorization=v3.content.${"d".repeat(43)}`] }] }] };
  const releaseBefore = JSON.stringify(releasePack);
  const releasePlan = descriptor.startupAssets.createLoadPlan(releasePack, ui, releaseContext, context(token));
  assert.equal(releasePlan.blocking[1].url, releasePack.pageUnits[0].pages[0].images[0]);
  assert.ok(releasePlan.blocking[0].url.includes(`/${descriptor.uiOwnerIdentity.componentSlug}/${releaseContext.releaseId}/`));
  assert.equal(new URL(releasePlan.blocking[0].url, "https://viewer.invalid").searchParams.get("previewAuthorization"), releaseContext.authorization);
  assert.equal(JSON.stringify(releasePack), releaseBefore);
});

test("startup never attaches content authorization to foreign origins, book/component/page paths or write endpoints", async () => {
  const fixture = createManagedSavedDraftFixture();
  const identity = savedDraftIdentities[0];
  const descriptor = createManagedReviewDescriptor(identity);
  const runtimeContext = context(fixture.issue(identity).token);
  const pack = await descriptor.contentPackProvider.load({ runtimeContext, fetchImpl: fixture.fetch });
  const valid = pack.pageUnits[0].pages[0].images[0];
  for (const url of [
    `https://third-party.invalid${valid}`, `//third-party.invalid${valid}`, "/preview/authorization/exchange",
    valid.replace("/preview/pages/", "/builder/api/pages/"), valid.replace("/books/ultimate-b1/", "/books/ultimate-b1-plus/"),
    valid.replace(`/components/${identity.componentSlug}/`, "/components/ultimate-b1-workbook/"),
    valid.replace(fixture.pageIds(identity)[0], fixture.pageIds(identity)[1]),
  ]) {
    const invalidPack = structuredClone(pack);
    invalidPack.pageUnits[0].pages[0].images[0] = url;
    assert.throws(() => descriptor.startupAssets.createLoadPlan(invalidPack, null, runtimeContext, runtimeContext), /scoped content preview/);
  }
  assert.throws(() => descriptor.startupAssets.createLoadPlan(pack, null, runtimeContext), /scoped content preview/);
});

test("a required page outside a page token remains fatal; retry with a fresh existing library grant can become ready", async () => {
  const fixture = createManagedSavedDraftFixture();
  const identity = savedDraftIdentities[1];
  const descriptor = createManagedReviewDescriptor(identity);
  const catalogToken = fixture.issue(identity).token;
  const pack = await descriptor.contentPackProvider.load({ runtimeContext: context(catalogToken), fetchImpl: fixture.fetch });
  let current = context(fixture.issue(identity, { view: "page", pageId: fixture.pageIds(identity)[0] }).token);
  const states = [];
  const start = () => runInteractiveViewerStartup({ loadContentPack: async () => pack, prepareHotspots: async () => {}, startupAssets: descriptor.startupAssets, getContentRuntimeContext: () => current, onState: (state) => states.push(state.status) });
  await withImages(fixture, async () => {
    await assert.rejects(start(), (error) => error.code === "VIEWER_ASSET_LOAD_FAILED");
    assert.equal(states.includes("ready"), false);
    current = context(fixture.issue(identity).token);
    await start();
  });
  assert.equal(states.at(-1), "ready");
  assert.equal(JSON.stringify(pack).includes("previewAuthorization"), false);
});

test("planning reads the current renewed session after metadata loading; aborted old startup cannot report ready", async () => {
  const fixture = createManagedSavedDraftFixture();
  const identity = savedDraftIdentities[1];
  const descriptor = createManagedReviewDescriptor(identity);
  const initialContext = context(fixture.issue(identity).token);
  const pack = await descriptor.contentPackProvider.load({ runtimeContext: initialContext, fetchImpl: fixture.fetch });
  const session = createHostedPreviewComponentAuthorizationSession({ initialContext, initialIdentity: identity,
    exchange: (input) => exchangeHostedPreviewComponentAuthorization({ ...input, fetchImpl: fixture.fetch }),
    setTimer: () => 1, clearTimer() {},
  });
  try {
    const controller = new AbortController();
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    const oldStates = [];
    const old = runInteractiveViewerStartup({ loadContentPack: () => waiting, prepareHotspots: async () => {}, startupAssets: descriptor.startupAssets,
      signal: controller.signal, getContentRuntimeContext: () => session.contextFor(identity), onState: (state) => oldStates.push(state.status) });
    controller.abort(new Error("Review closed"));
    release(pack);
    await assert.rejects(old, /Review closed/);
    assert.equal(oldStates.includes("ready"), false);
    await withImages(fixture, () => runInteractiveViewerStartup({
      loadContentPack: async () => { await session.ensure(identity); return pack; },
      prepareHotspots: async () => {}, startupAssets: descriptor.startupAssets,
      getContentRuntimeContext: () => session.contextFor(identity),
    }));
    const requests = fixture.requests.filter((request) => request.action === "managed-page-asset");
    assert.ok(requests.every((request) => request.token === session.contextFor(identity).authorization && request.token !== initialContext.authorization));
  } finally { session.dispose(); }
});

test("empty managed components and B2 on-demand page policy need no new hosted blocking work", () => {
  for (const identity of [...savedDraftIdentities, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-workbook" }, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-grammar-book" }]) {
    const descriptor = createManagedReviewDescriptor(identity);
    const empty = descriptor.startupAssets.createLoadPlan({ assetsManifest: { assets: [] }, pageUnits: [] });
    assert.deepEqual(empty, { blocking: [], background: [] });
    if (identity.bookSlug === "ultimate-b2") assert.deepEqual(descriptor.startupAssets.createLoadPlan({ assetsManifest: { assets: [] }, pageUnits: [{ pages: [{ images: ["/on-demand-only.png"] }] }] }), empty);
  }
});
