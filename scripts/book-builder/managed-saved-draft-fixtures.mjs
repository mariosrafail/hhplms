import { createBuilderPagesHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-pages.js";
import { createBuilderPreviewAuthorizationHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-preview-authorization-handler.js";
import { classifyBuilderPreviewAuthorization, inspectBuilderPreviewAuthorizationScope, issueBuilderPreviewAuthorization } from "../../netlify-sites/ultimate-b2-builder/server/_builder-preview-authorization.js";
import { createBuilderWorker } from "../../cloudflare/builder/worker.js";
import { createBuilderNativePreviewHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-preview.js";

export const savedDraftIdentities = ["ultimate-b1", "ultimate-b1-plus"].flatMap((bookSlug) =>
  ["students-book", "workbook"].map((suffix) => ({ bookSlug, componentSlug: `${bookSlug}-${suffix}` })));
export const savedDraftImage = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=", "base64");

export function createManagedSavedDraftFixture() {
  const environment = { BUILDER_PREVIEW_AUTH_SECRET: "synthetic-managed-startup-test-secret-only-2026" };
  const now = Date.now();
  const requests = [];
  const issued = [];
  let nonce = 0;
  const issue = (identity, { view = "library", pageId = null, issuedAt = now } = {}) => {
    const intent = { ...identity, view, pageId, activityId: null, releaseId: null };
    const result = issueBuilderPreviewAuthorization(intent, { environment, now: issuedAt, nonce: `managed-startup-fixture-nonce-${++nonce}` });
    issued.push({ ...identity, ...result });
    return result;
  };
  const pageIds = (identity) => [1, 2].map((number) => `${identity.componentSlug}-page-${number}`);
  const assetId = "40000000-0000-4000-8000-000000000001";
  const pagePath = (identity, pageId = pageIds(identity)[0]) => `/preview/pages/books/${identity.bookSlug}/components/${identity.componentSlug}/pages/${pageId}/assets/${assetId}/preview`;
  const observe = (event, scope) => {
    const decision = classifyBuilderPreviewAuthorization(event, scope, { environment, now });
    requests.push({ ...scope, token: event.queryStringParameters?.previewAuthorization || "", cookie: event.headers?.cookie, decision });
    return decision;
  };
  const sql = () => { throw new Error("Synthetic startup fixtures must not execute SQL"); };
  const pages = createBuilderPagesHandler({
    getDatabase: () => sql,
    authorize: async () => ({ error: { statusCode: 401, body: "Unauthorized" } }),
    authorizePreview: (event, _sql, scope) => observe(event, scope),
    loadPages: async (_sql, identity) => {
      const units = Array.from({ length: 10 }, (_, index) => ({ id: `${identity.componentSlug}-unit-${index + 1}`, slug: `unit-${index + 1}`, title: `Unit ${index + 1}`, unit_number: index + 1, sort_order: index + 1 }));
      return { revision: 1, units, rows: identity.componentSlug.endsWith("grammar-book") ? [] : pageIds(identity).map((pageId, index) => ({
        stable_key: `${identity.componentSlug}/pages/${pageId}`, label: `Page ${index + 1}`, sort_order: index + 1,
        unit_id: units[0].id, unit_slug: "unit-1", unit_number: 1, unit_title: "Unit 1", unit_sort_order: 1,
        source_metadata: { is_active: true, printed_label: `${index + 1}` }, asset_id: assetId,
        mime_type: "image/png", byte_size: savedDraftImage.length, checksum_sha256: "a".repeat(64), width: 1, height: 1,
      })) };
    },
    loadAsset: async (_sql, identity) => pageIds(identity).includes(identity.pageId) && identity.assetId === assetId
      ? { object_key: `synthetic/${identity.componentSlug}/${identity.pageId}.png` } : null,
    storage: () => ({ signedGetUrl: async ({ objectKey }) => `https://synthetic-storage.invalid/${objectKey}` }),
    logger: { error() {} },
  });
  const previewAuthorization = createBuilderPreviewAuthorizationHandler({
    getDatabase: () => sql,
    authorize: async () => ({ error: { statusCode: 401, body: "Unauthorized" } }),
    inspect: (event, scope) => inspectBuilderPreviewAuthorizationScope(event, scope, { environment, now }),
    issue: (intent) => issue({ bookSlug: intent.bookSlug, componentSlug: intent.componentSlug }, intent),
    logger: { error() {} },
  });
  const preview = async (event) => {
    const match = event.path.match(/^\/builder\/preview\/content\/books\/([^/]+)\/components\/([^/]+)\/(hotspots|ui-controller)$/);
    if (!match) return { statusCode: 404, body: "Not found" };
    const [, bookSlug, componentSlug, resource] = match;
    const decision = observe(event, { bookSlug, componentSlug, action: resource === "hotspots" ? "managed-hotspots" : "teacher-ui-draft" });
    if (!decision.authorized) return { statusCode: 401, body: "Unauthorized" };
    const document = resource === "hotspots"
      ? { schemaVersion: "1.0", packageSlug: bookSlug, componentSlug, pages: {} }
      : { schemaVersion: "1.0", packageId: componentSlug, assets: { "background.main": { sha256: "b".repeat(64), extension: "png", mediaType: "image/png", sizeBytes: savedDraftImage.length, width: 1, height: 1 } } };
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookSlug, componentSlug, revision: 1, document }) };
  };
  const nativePreview = createBuilderNativePreviewHandler({
    getDatabase: () => sql,
    loadDocument: async () => null,
    inspectAuthorization: (event, scope) => inspectBuilderPreviewAuthorizationScope(event, scope, { environment, now }),
    logger: { error() {} },
  });
  const worker = createBuilderWorker({ handlers: { pages, previewAuthorization, preview, nativePreview } });
  const fetch = (url, options = {}) => worker.fetch(new Request(new URL(url, "https://saved-draft.invalid"), options), {});
  return { now, issue, requests, issued, pageIds, pagePath, fetch, worker };
}
