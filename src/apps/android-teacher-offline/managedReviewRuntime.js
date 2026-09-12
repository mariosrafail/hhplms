import { authorizedHostedPreviewPath, hostedReleasePath, HOSTED_VIEWER_RUNTIME_MODES, resolveHostedViewerRuntimeContext } from "./hostedReleasePreview.js";
import { createHostedStartupAssets } from "./interactiveStartupAssets.js";
import { hostedTeacherUiAssetPath } from "../../data/ultimate-b2/hostedTeacherUiDocument.js";
import { findManagedHostedComponent } from "../../data/managedHostedComponentCatalog.js";
import { createHostedReviewUiManifestProvider } from "./hostedReviewUiManifestProvider.js";
import { newManagedPublicationComponents } from "../../data/publicationRegistry.js";

const emptyUnits = () => Array.from({ length: 10 }, (_, index) => Object.freeze({ id: `unit-${index + 1}`, number: index + 1, title: `Unit ${index + 1}`, pages: Object.freeze([]) }));

function componentConfig(identity) {
  const bookSlug = typeof identity === "string" ? "ultimate-b2" : identity?.bookSlug;
  const componentSlug = typeof identity === "string" ? identity : identity?.componentSlug;
  const config = findManagedHostedComponent(bookSlug, componentSlug);
  if (!config) throw new Error("Managed review component is unsupported.");
  return config;
}

function createManagedHostedStartupAssets(config) {
  const identity = { bookSlug: config.bookSlug, componentSlug: config.uiOwnerComponentSlug };
  const newPublication = newManagedPublicationComponents.some((entry) => entry.bookSlug === config.bookSlug && entry.componentSlug === config.componentSlug);
  return createHostedStartupAssets(Object.freeze({
    runtimeAssets(pack, _uiManifest, contentContext) {
      if (!newPublication) return [];
      return (pack?.pageUnits || []).flatMap((unit) => unit.pages.flatMap((page) => page.images.map((url) => {
        // Immutable member URLs are already authorized; never replace their pins/token.
        if (pack.assetsManifest?.resolver === "authorized-release-assets") return { url, kind: "image" };
        const route = /^\/preview\/pages\/books\/([a-z0-9-]+)\/components\/([a-z0-9-]+)\/pages\/([a-z0-9-]+)\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/preview(?:\?[^#]*)?$/.exec(url);
        if (!route || route[1] !== config.bookSlug || route[2] !== config.componentSlug || route[3] !== page.id
          || contentContext?.kind !== HOSTED_VIEWER_RUNTIME_MODES.BUILDER_PREVIEW || !contentContext.authorization) {
          throw new Error("Managed page startup requires its scoped content preview context and page path.");
        }
        return { url: authorizedHostedPreviewPath(url, contentContext.authorization), kind: "image" };
      })));
    },
    uiAssetUrls(uiManifest, _pack, runtimeContext) {
      return Object.values(uiManifest?.assets || {}).map((asset) => runtimeContext?.kind === HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW
        ? hostedReleasePath(runtimeContext, identity, `assets/${asset.sha256}.${asset.extension}`)
        : hostedTeacherUiAssetPath(asset, identity));
    },
  }));
}

export const managedHostedStartupAssets = createManagedHostedStartupAssets(componentConfig("ultimate-b2-workbook"));

function previewContext(runtimeContext = resolveHostedViewerRuntimeContext()) {
  const context = runtimeContext;
  if (![HOSTED_VIEWER_RUNTIME_MODES.BUILDER_PREVIEW, HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW].includes(context.kind)) {
    const error = new Error("Managed components require authorized Review.");
    error.code = "LIVE_PREVIEW_UNAVAILABLE";
    throw error;
  }
  return context;
}

function managedImageDimensions(image) {
  const width = Number(image?.width);
  const height = Number(image?.height);
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? { imageWidth: width, imageHeight: height }
    : {};
}

async function loadManagedReleaseProjection(context, identity, fetchImpl, signal) {
  const config = componentConfig(identity);
  const response = await fetchImpl(hostedReleasePath(context, config, "public"), { method: "GET", credentials: "omit", cache: "no-store", signal });
  if (!response?.ok) throw new Error("Managed release projection is unavailable.");
  const payload = await response.json();
  if (payload?.releaseId !== context.releaseId || payload?.projection?.bookSlug !== config.bookSlug || payload.projection.componentSlug !== config.componentSlug
    || !Array.isArray(payload.projection.units) || !Array.isArray(payload.projection.pages)) throw new Error("Managed release projection identity is invalid.");
  return payload.projection;
}

export function managedPageUnitsFromRelease(projection, identity, context) {
  const config = componentConfig(identity);
  const pagesByUnit = new Map(projection.units.map((unit) => [unit.id, []]));
  for (const page of projection.pages) {
    if (!pagesByUnit.has(page.unitId) || !page.image?.sha256 || !page.image?.extension) throw new Error("Managed release page topology is invalid.");
    const image = hostedReleasePath(context, config, `assets/${page.image.sha256}.${page.image.extension}`);
    pagesByUnit.get(page.unitId).push(Object.freeze({ id: page.id, title: page.label, overviewLabel: page.label, printedLabel: page.printedLabel, pageNumber: null, spreadNumber: page.printedLabel || page.label, pageNumbers: Object.freeze([]), ...managedImageDimensions(page.image), images: Object.freeze([image]), activities: Object.freeze([]), actions: Object.freeze([]), sortOrder: page.sortOrder }));
  }
  return Object.freeze(projection.units.map((unit) => Object.freeze({ id: unit.slug, number: unit.unitNumber, title: unit.title, pages: Object.freeze(pagesByUnit.get(unit.id).sort((left, right) => left.sortOrder - right.sortOrder)) })));
}

export function managedPageUnitsFromCatalog(payload, identity) {
  const config = componentConfig(identity);
  if (payload?.component?.bookSlug !== config.bookSlug || payload.component.componentSlug !== config.componentSlug || payload.component.kind !== "managed" || !Array.isArray(payload.units) || !Array.isArray(payload.pages)) throw new Error("Managed page catalog identity is invalid.");
  const pagesByUnit = new Map(payload.units.map((unit) => [unit.id, []]));
  for (const page of payload.pages) {
    if (!page?.id || !page.unitId || !pagesByUnit.has(page.unitId) || page.componentSlug !== config.componentSlug || page.image?.source !== "managed" || !page.image.url) throw new Error("Managed page catalog contains an invalid page.");
    const imageUrl = new URL(page.image.url, "https://viewer.invalid");
    imageUrl.searchParams.delete("previewAuthorization");
    const imagePath = `${imageUrl.pathname}${imageUrl.search}`;
    pagesByUnit.get(page.unitId).push(Object.freeze({ id: page.id, title: page.label, overviewLabel: page.label, printedLabel: page.printedLabel, pageNumber: null, spreadNumber: page.printedLabel || page.label, pageNumbers: Object.freeze([]), ...managedImageDimensions(page.image), images: Object.freeze([imagePath]), activities: Object.freeze([]), actions: Object.freeze([]), sortOrder: page.sortOrder }));
  }
  return Object.freeze(payload.units.map((unit) => Object.freeze({ id: unit.slug, number: unit.unitNumber, title: unit.title, pages: Object.freeze(pagesByUnit.get(unit.id).sort((left, right) => left.sortOrder - right.sortOrder)) })));
}

export function createManagedReviewContentPackProvider(identity) {
  const config = componentConfig(identity);
  const componentId = config.componentSlug.slice(config.bookSlug.length + 1);
  return Object.freeze({
    async load({ runtimeContext, fetchImpl = globalThis.fetch, signal } = {}) {
      const context = previewContext(runtimeContext);
      if (context.kind === HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW) {
        const projection = await loadManagedReleaseProjection(context, config, fetchImpl, signal);
        return Object.freeze({
          manifest: Object.freeze({ packageId: config.componentSlug, componentId, schemaVersion: 1 }),
          catalog: Object.freeze({ schemaVersion: 1, packageId: config.componentSlug, componentId, title: `${config.bookTitle} ${config.componentTitle}`, units: Object.freeze([]) }),
          activities: Object.freeze({ schemaVersion: 1, packageId: config.componentSlug, activities: Object.freeze(Object.values(projection.nativeActivities || {}).map((entry) => Object.freeze({ id: entry.document.activityId, stableActivityId: entry.document.activityId, title: entry.document.metadata.title, activityType: entry.kind, availability: "enabled" }))) }),
          assetsManifest: Object.freeze({ schemaVersion: 1, resolver: "authorized-release-assets", assets: Object.freeze(config.bookSlug === "ultimate-b2" ? projection.assets || [] : []) }),
          ...(config.bookSlug !== "ultimate-b2" ? { releaseAssets: Object.freeze(projection.assets || []) } : {}),
          pageUnits: managedPageUnitsFromRelease(projection, config, context),
        });
      }
      const path = authorizedHostedPreviewPath(`/preview/pages/books/${config.bookSlug}/components/${config.componentSlug}`, context.authorization);
      const response = await fetchImpl(path, { method: "GET", credentials: "omit", cache: "no-store", signal });
      if (!response?.ok) throw new Error("Managed page catalog is unavailable.");
      const pageUnits = managedPageUnitsFromCatalog(await response.json(), config);
      return Object.freeze({
        manifest: Object.freeze({ packageId: config.componentSlug, componentId, schemaVersion: 1 }),
        catalog: Object.freeze({ schemaVersion: 1, packageId: config.componentSlug, componentId, title: `${config.bookTitle} ${config.componentTitle}`, units: Object.freeze([]) }),
        activities: Object.freeze({ schemaVersion: 1, packageId: config.componentSlug, activities: Object.freeze([]) }),
        assetsManifest: Object.freeze({ schemaVersion: 1, resolver: "authorized-builder-pages", assets: Object.freeze([]) }),
        pageUnits,
      });
    },
  });
}

function hotspotToAction(hotspot) {
  return hotspot?.actionType === "normalized_activity" && hotspot.activityKey ? { id: hotspot.id, label: hotspot.label, ariaLabel: hotspot.label || "Open activity", target: "normalized-activity", classification: "activity", availability: "enabled", activityKey: hotspot.activityKey, authoredHotspot: true, top: `${hotspot.top}%`, left: `${hotspot.left}%`, width: `${hotspot.width}%`, height: `${hotspot.height}%` } : null;
}

export function createManagedReviewHotspotProvider(identity) {
  const config = componentConfig(identity);
  let document = { schemaVersion: "1.0", packageSlug: config.bookSlug, componentSlug: config.componentSlug, pages: {} };
  return Object.freeze({
    async prepare({ runtimeContext, fetchImpl = globalThis.fetch, signal } = {}) {
      const context = previewContext(runtimeContext);
      if (context.kind === HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW) {
        const projection = await loadManagedReleaseProjection(context, config, fetchImpl, signal);
        document = structuredClone(projection.hotspots);
        return;
      }
      const path = authorizedHostedPreviewPath(`/preview/content/books/${config.bookSlug}/components/${config.componentSlug}/hotspots`, context.authorization);
      const response = await fetchImpl(path, { method: "GET", credentials: "omit", cache: "no-store", signal });
      if (!response?.ok) throw new Error("Managed hotspot document is unavailable.");
      const payload = await response.json();
      if (payload?.bookSlug !== config.bookSlug || payload.componentSlug !== config.componentSlug || payload.document?.componentSlug !== config.componentSlug || typeof payload.document.pages !== "object") throw new Error("Managed hotspot preview identity is invalid.");
      document = structuredClone(payload.document);
    },
    getActions({ pageId } = {}) { return (document.pages?.[pageId] || []).map(hotspotToAction).filter(Boolean); },
    getActivityKey(action) { return action?.authoredHotspot && action.target === "normalized-activity" ? String(action.activityKey || "") : null; },
  });
}

export function authorizeManagedReviewPageUnits(pageUnits, authorization) {
  return Object.freeze((pageUnits || []).map((unit) => Object.freeze({
    ...unit,
    pages: Object.freeze((unit.pages || []).map((page) => Object.freeze({
      ...page,
      images: Object.freeze((page.images || []).map((path) => authorizedHostedPreviewPath(path, authorization))),
    }))),
  })));
}

export function createManagedReviewDescriptor(identity) {
  const config = componentConfig(identity);
  const uiOwnerIdentity = Object.freeze({ bookSlug: config.bookSlug, componentSlug: config.uiOwnerComponentSlug });
  return Object.freeze({
    bookSlug: config.bookSlug, componentSlug: config.componentSlug, installationScope: "hosted-builder-review",
    contentPackProvider: createManagedReviewContentPackProvider(config), pageUnits: Object.freeze(emptyUnits()),
    hotspotProvider: createManagedReviewHotspotProvider(config), solutionProvider: Object.freeze({ get: () => null }),
    startupAssets: createManagedHostedStartupAssets(config),
    uiOwnerIdentity,
    uiManifestProvider: createHostedReviewUiManifestProvider(uiOwnerIdentity),
    authorizePageUnits: authorizeManagedReviewPageUnits,
  });
}
