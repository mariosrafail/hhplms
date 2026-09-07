import { getBuilderSql, json } from "./_builder-auth.js";
import { authorizeBuilderPreviewRequestWithDiagnostic, builderPreviewAuthorizationDiagnosticCodes } from "./_builder-preview-authorization.js";
import { resolveBuilderContentResource } from "./_builder-content-registry.js";
import { assertPublicBuilderDocument } from "./_builder-content-security.js";
import { loadBuilderComponentDocument, loadBuilderComponentDocuments } from "./_builder-content-store.js";
import { createBuilderRelatedDocumentLoader } from "./_builder-related-context.js";

const previewDiagnosticStages = new Set([
  "route",
  "resolve_resource",
  "database",
  "load_document",
  "repository_baseline",
  "validate_public_document",
  "project_preview",
  "validate_projection",
  "response",
]);
const safeDiagnosticToken = /^[A-Za-z0-9_.-]{1,64}$/;
const previewAuthorizationDiagnosticCodes = new Set(builderPreviewAuthorizationDiagnosticCodes);

function safeToken(value, fallback) {
  return typeof value === "string" && safeDiagnosticToken.test(value) ? value : fallback;
}

export function safeBuilderPreviewDiagnostic(stage, error) {
  let errorName;
  let errorCode;
  try { errorName = error?.name; } catch { errorName = undefined; }
  try { errorCode = error?.code; } catch { errorCode = undefined; }
  return {
    stage: previewDiagnosticStages.has(stage) ? stage : "database",
    errorName: safeToken(errorName, "UnknownError"),
    errorCode: safeToken(errorCode, "unknown"),
  };
}

function decodeSegment(segment) {
  try { return decodeURIComponent(segment); } catch { return ""; }
}

export function parseBuilderPreviewRoute(event) {
  const pathname = String(event?.path || "").split("?")[0];
  const match = pathname.match(/(?:\/builder\/preview\/content|\/\.netlify\/functions\/builder-preview)\/books\/([^/]+)\/components\/([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!match) return null;
  return {
    bookSlug: decodeSegment(match[1]),
    componentSlug: decodeSegment(match[2]),
    resource: decodeSegment(match[3]),
    documentKey: decodeSegment(match[4] || ""),
  };
}

function previewJson(statusCode, body) {
  return json(statusCode, body, { "X-Content-Type-Options": "nosniff" });
}

function previewResponse(resource, state, document) {
  return {
    bookSlug: resource.bookSlug,
    componentSlug: resource.componentSlug,
    resource: resource.resource,
    ...(resource.documentKey !== "default" ? { documentKey: resource.documentKey } : {}),
    schemaVersion: resource.schemaVersion,
    revision: state.revision,
    source: state.source,
    document,
  };
}

export function createBuilderPreviewHandler(overrides = {}) {
  const dependencies = {
    getDatabase: overrides.getDatabase || getBuilderSql,
    resolveResource: overrides.resolveResource || resolveBuilderContentResource,
    loadDocument: overrides.loadDocument || loadBuilderComponentDocument,
    loadDocuments: overrides.loadDocuments || loadBuilderComponentDocuments,
    authorizePreview: overrides.authorizePreview || authorizeBuilderPreviewRequestWithDiagnostic,
    logger: overrides.logger || console,
  };

  return async function builderPreviewHandler(event) {
    if (event.httpMethod !== "GET") return previewJson(405, { error: "method_not_allowed" });
    let stage = "route";
    try {
      const route = parseBuilderPreviewRoute(event);
      stage = "resolve_resource";
      const resource = route && await dependencies.resolveResource(route.bookSlug, route.componentSlug, route.resource, route.documentKey);
      if (!resource?.previewReadable || typeof resource.projectPreview !== "function") {
        return previewJson(404, { error: "builder_preview_resource_not_found" });
      }

      stage = "database";
      const sql = dependencies.getDatabase();
      if (["teacher", "managed", "unit-extras"].includes(resource.previewAudience)) {
        const action = resource.previewAudience === "managed" ? "managed-hotspots" : resource.previewAudience === "unit-extras" ? "unit-extras-draft" : "teacher-ui-draft";
        const decision = await dependencies.authorizePreview(event, sql, { action, bookSlug: resource.bookSlug, componentSlug: resource.componentSlug });
        const authorized = typeof decision === "boolean" ? decision : decision?.authorized === true;
        if (!authorized) {
          const code = previewAuthorizationDiagnosticCodes.has(decision?.code) ? decision.code : "authorization_denied";
          dependencies.logger.warn?.("Builder preview authorization denied", { code });
          return previewJson(401, { error: "Unauthorized" });
        }
      }
      stage = "load_document";
      let state = await dependencies.loadDocument(sql, resource);
      if (!state) {
        if (resource.previewRequiresStored) return previewJson(404, { error: "builder_preview_document_not_found" });
        stage = "repository_baseline";
        state = { revision: 0, source: "repository", document: resource.baseline() };
      }

      stage = "validate_public_document";
      assertPublicBuilderDocument(state.document);
      stage = "project_preview";
      const requiredRelated = resource.requiredRelatedForPreview || [];
      const projectionContext = requiredRelated.length ? {
        sql,
        loadRelated: createBuilderRelatedDocumentLoader({
          sql,
          resource,
          resolveResource: dependencies.resolveResource,
          loadDocument: dependencies.loadDocument,
          loadDocuments: dependencies.loadDocuments,
          allowedResources: requiredRelated,
        }),
      } : { sql };
      const document = await resource.projectPreview(state.document, projectionContext);
      stage = "validate_projection";
      assertPublicBuilderDocument(document);
      stage = "response";
      return previewJson(200, previewResponse(resource, state, document));
    } catch (error) {
      dependencies.logger.error("Builder preview request failed", safeBuilderPreviewDiagnostic(stage, error));
      return previewJson(500, { error: "builder_preview_failed" });
    }
  };
}
