import { handler as builderAuth } from "../../netlify-sites/ultimate-b2-builder/functions/builder-auth.js";
import { handler as builderContent } from "../../netlify-sites/ultimate-b2-builder/functions/builder-content.js";
import { handler as builderNativeActivities } from "../../netlify-sites/ultimate-b2-builder/functions/builder-native-activities.js";
import { handler as builderNativePreview } from "../../netlify-sites/ultimate-b2-builder/functions/builder-native-preview.js";
import { handler as builderOpenResponseImport } from "../../netlify-sites/ultimate-b2-builder/functions/builder-open-response-import.js";
import { handler as builderPreview } from "../../netlify-sites/ultimate-b2-builder/functions/builder-preview.js";
import { handler as builderPreviewAuthorization } from "../../netlify-sites/ultimate-b2-builder/functions/builder-preview-authorization.js";
import { handler as builderPublication } from "../../netlify-sites/ultimate-b2-builder/functions/builder-publication.js";
import { handler as builderTeacherUiAssets } from "../../netlify-sites/ultimate-b2-builder/functions/builder-teacher-ui-assets.js";
import { handler as builderUnitExtraAssets } from "../../netlify-sites/ultimate-b2-builder/functions/builder-unit-extra-assets.js";
import { handler as builderPages } from "../../netlify-sites/ultimate-b2-builder/functions/builder-pages.js";
import { invokeNetlifyHandler } from "../shared/netlify-handler-adapter.js";
import { servePlayerMedia } from "./player-media.js";
import { BUILDER_RELEASE_SOURCE_ASSETS_BUCKET } from "./storage-bindings.js";
import { isBuilderPublicAssetNamespace, serveBuilderPublicAsset } from "./teacher-ui-assets.js";

const productionHandlers = Object.freeze({
  auth: builderAuth,
  content: builderContent,
  nativeActivities: builderNativeActivities,
  nativePreview: builderNativePreview,
  openResponseImport: builderOpenResponseImport,
  preview: builderPreview,
  previewAuthorization: builderPreviewAuthorization,
  publication: builderPublication,
  teacherUiAssets: builderTeacherUiAssets,
  unitExtraAssets: builderUnitExtraAssets,
  pages: builderPages,
});

const routeDefinitions = Object.freeze([
  { prefix: "/builder/api/auth", exact: true, handler: "auth" },
  { prefix: "/builder/api/content", handler: "content" },
  { prefix: "/builder/api/native-activities", handler: "nativeActivities" },
  { prefix: "/builder/api/open-response-import", handler: "openResponseImport" },
  { prefix: "/builder/api/preview-authorization", exact: true, handler: "previewAuthorization" },
  { prefix: "/builder/api/publication", handler: "publication" },
  { prefix: "/builder/api/ui-assets", handler: "teacherUiAssets" },
  { prefix: "/builder/api/unit-extras", handler: "unitExtraAssets" },
  { prefix: "/builder/api/pages", handler: "pages" },
  { prefix: "/builder/preview/pages", handler: "pages" },
  { prefix: "/builder/preview/authorization", handler: "previewAuthorization" },
  { prefix: "/builder/preview/native-activities", handler: "nativePreview" },
  { prefix: "/builder/preview/releases", handler: "publication" },
  { prefix: "/builder/preview/unit-extras", handler: "unitExtraAssets" },
  { prefix: "/builder/preview/content", handler: "preview" },
  { prefix: "/builder/preview/open-response-import", handler: "openResponseImport" },
  { prefix: "/builder/preview/open-response-teacher", handler: "openResponseImport" },
  { prefix: "/builder/preview/open-response-assets", handler: "openResponseImport" },
  { prefix: "/builder/preview/ui-assets", handler: "teacherUiAssets" },
]);

const playerRouteDefinitions = Object.freeze([
  { prefix: "/preview/pages", handler: "pages" },
  { prefix: "/preview/authorization", handler: "previewAuthorization" },
  { prefix: "/preview/native-activities", handler: "nativePreview" },
  { prefix: "/preview/releases", handler: "publication" },
  { prefix: "/preview/unit-extras", handler: "unitExtraAssets" },
  { prefix: "/preview/content", handler: "preview" },
  { prefix: "/preview/open-response-import", handler: "openResponseImport" },
  { prefix: "/preview/open-response-teacher", handler: "openResponseImport" },
]);

export const BUILDER_DYNAMIC_ROUTE_PREFIXES = Object.freeze(routeDefinitions.map(({ prefix }) => prefix));
export const BUILDER_PLAYER_ROUTE_PREFIXES = Object.freeze(playerRouteDefinitions.map(({ prefix }) => prefix));

function matches(pathname, route) {
  return pathname === route.prefix || (!route.exact && pathname.startsWith(`${route.prefix}/`));
}

export function resolveBuilderWorkerRoute(pathname) {
  const playerRoute = playerRouteDefinitions.find((route) => matches(pathname, route));
  if (playerRoute) return { ...playerRoute, playerFacing: true, compatibilityPath: `/builder${pathname}` };
  const builderRoute = routeDefinitions.find((route) => matches(pathname, route));
  return builderRoute ? { ...builderRoute, playerFacing: false, compatibilityPath: pathname } : null;
}

function compatibilityRequest(request, route) {
  if (!route.playerFacing) return request;
  const url = new URL(request.url);
  url.pathname = route.compatibilityPath;
  const rewritten = new Request(url, request);
  rewritten.headers.delete("cookie");
  return rewritten;
}

function dynamicNotFound() {
  return new Response(JSON.stringify({ error: "Builder route not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function isDynamicNamespace(pathname) {
  return pathname === "/builder/api" || pathname.startsWith("/builder/api/")
    || pathname === "/builder/preview" || pathname.startsWith("/builder/preview/")
    || pathname === "/preview" || pathname.startsWith("/preview/");
}

function isPlayerMediaNamespace(pathname) {
  return pathname === "/player-media" || pathname.startsWith("/player-media/");
}

function shouldUsePlayerFallback(pathname) {
  if (pathname === "/player/") return true;
  if (!pathname.startsWith("/player/") || pathname.startsWith("/player/assets/")) return false;
  const finalSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return !finalSegment.includes(".");
}

async function serveStaticAsset(request, env) {
  const requestUrl = new URL(request.url);
  const { pathname } = requestUrl;
  if (pathname === "/player") {
    requestUrl.pathname = "/player/";
    return Response.redirect(requestUrl.toString(), 307);
  }
  if (shouldUsePlayerFallback(pathname)) {
    requestUrl.pathname = "/player/";
    return env.ASSETS.fetch(new Request(requestUrl, request));
  }
  return env.ASSETS.fetch(request);
}

export function createBuilderWorker({ handlers: handlerOverrides = {}, playerMediaHandler = servePlayerMedia, publicAssetHandler = serveBuilderPublicAsset } = {}) {
  const handlers = Object.freeze({ ...productionHandlers, ...handlerOverrides });
  return {
    async fetch(request, env) {
      const pathname = new URL(request.url).pathname;
      if (isPlayerMediaNamespace(pathname)) return playerMediaHandler(request, env.PLAYER_MEDIA);
      if (isBuilderPublicAssetNamespace(pathname)) return publicAssetHandler(request, env.PLAYER_MEDIA);
      const route = resolveBuilderWorkerRoute(pathname);
      if (route) {
        const compatible = compatibilityRequest(request, route);
        return invokeNetlifyHandler(handlers[route.handler], compatible, {
          context: { cloudflare: {
            request: compatible,
            releaseSourceAssets: env.RELEASE_SOURCE_ASSETS,
            releaseSourceAssetsBucket: BUILDER_RELEASE_SOURCE_ASSETS_BUCKET,
            staticAssets: env.ASSETS,
          } },
        });
      }
      if (isDynamicNamespace(pathname)) return dynamicNotFound();
      return serveStaticAsset(request, env);
    },
  };
}

export default createBuilderWorker();
