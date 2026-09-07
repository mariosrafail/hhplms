import { normalizeComponentPublicationEnvelope } from "../../services/componentPublicationApi.js";
export const ultimateB2HotspotPreviewRoute = "/preview/content/books/ultimate-b2/components/ultimate-b2-students-book/hotspots";
import { authorizedHostedPreviewPath, HOSTED_VIEWER_RUNTIME_MODES, hostedReleasePath, resolveHostedViewerRuntimeContext } from "../../apps/android-teacher-offline/hostedReleasePreview.js";

const envelopeKeys = Object.freeze([
  "bookSlug",
  "componentSlug",
  "resource",
  "schemaVersion",
  "revision",
  "source",
  "document",
]);
const documentKeys = Object.freeze(["schemaVersion", "packageSlug", "componentSlug", "pages"]);

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function validPages(pages) {
  return pages && typeof pages === "object" && !Array.isArray(pages)
    && Object.values(pages).every((hotspots) => (
      Array.isArray(hotspots)
      && hotspots.every((hotspot) => hotspot && typeof hotspot === "object" && !Array.isArray(hotspot))
    ));
}

export function validateUltimateB2HotspotPreviewEnvelope(value) {
  if (!exactKeys(value, envelopeKeys)) throw new Error("Live preview response is invalid.");
  if (
    value.bookSlug !== "ultimate-b2"
    || value.componentSlug !== "ultimate-b2-students-book"
    || value.resource !== "hotspots"
    || value.schemaVersion !== "1.0"
    || !Number.isSafeInteger(value.revision)
    || value.revision < 0
    || !["repository", "database"].includes(value.source)
    || (value.source === "repository" && value.revision !== 0)
    || (value.source === "database" && value.revision < 1)
    || !exactKeys(value.document, documentKeys)
    || value.document.schemaVersion !== "1.0"
    || value.document.packageSlug !== "ultimate-b2"
    || value.document.componentSlug !== "students-book"
    || !validPages(value.document.pages)
  ) throw new Error("Live preview response is invalid.");
  return value;
}

function unavailable() {
  const error = new Error("Live preview content could not be loaded. Refresh and try again.");
  error.code = "LIVE_PREVIEW_UNAVAILABLE";
  return error;
}

export function ultimateB2StudentsBookHotspotToAction(hotspot) {
  if (!hotspot || hotspot.actionType !== "normalized_activity" || !hotspot.activityKey) return null;
  return {
    id: hotspot.id,
    label: hotspot.label,
    ariaLabel: hotspot.label || "Open Students Book activity",
    target: "normalized-activity",
    classification: "activity",
    availability: "enabled",
    activityKey: hotspot.activityKey,
    authoredHotspot: true,
    top: `${hotspot.top}%`,
    left: `${hotspot.left}%`,
    width: `${hotspot.width}%`,
    height: `${hotspot.height}%`,
  };
}

export function getUltimateB2AuthoredHotspotActivityKey(action) {
  if (!action?.authoredHotspot || action.target !== "normalized-activity" || !action.activityKey) return null;
  return String(action.activityKey);
}

export function createHostedReviewHotspotRuntime(initialManifest) {
  let currentManifest = initialManifest;
  let pageIdentityOnly = false;

  function getHotspots({ pageId, pageNumber, unitNumber } = {}) {
    const hotspots = currentManifest.pages?.[String(pageId || "")] || [];
    return hotspots.filter((hotspot) => (
      (pageIdentityOnly || !Number.isFinite(Number(pageNumber)) || Number(hotspot.pageNumber) === Number(pageNumber))
      && (!Number.isFinite(Number(unitNumber)) || Number(hotspot.unitNumber) === Number(unitNumber))
    ));
  }

  return Object.freeze({
    currentManifest: () => currentManifest,
    getHotspots,
    getActions(identity = {}) {
      return getHotspots(identity).map(ultimateB2StudentsBookHotspotToAction).filter(Boolean);
    },
    async prepare({ runtimeContext = resolveHostedViewerRuntimeContext(), fetchImpl = globalThis.fetch, signal } = {}) {
      try {
        const context = runtimeContext;
        if (context.kind === HOSTED_VIEWER_RUNTIME_MODES.BARE) { currentManifest = initialManifest; pageIdentityOnly = false; return { revision: 0, source: "repository" }; }
        if (!context.teacherPreview || typeof fetchImpl !== "function") throw unavailable();
        const response = await fetchImpl(context.kind === HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW ? hostedReleasePath(context, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" }, "public") : authorizedHostedPreviewPath(ultimateB2HotspotPreviewRoute, context.authorization), {
          cache: "no-store",
          credentials: "omit",
          ...(signal ? { signal } : {}),
        });
        if (!response?.ok) throw unavailable();
        const payload = await response.json();
        if (context.kind === HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW) {
          const release = normalizeComponentPublicationEnvelope(payload);
          if (release.releaseId !== context.releaseId) throw unavailable();
          currentManifest = structuredClone(release.projection.hotspots);
          pageIdentityOnly = release.compilerId === "ultimate-b2-students-book-v3";
          return { revision: 0, source: "release", releaseId: context.releaseId };
        }
        const envelope = validateUltimateB2HotspotPreviewEnvelope(payload);
        currentManifest = structuredClone(envelope.document);
        pageIdentityOnly = true;
        return { revision: envelope.revision, source: envelope.source };
      } catch {
        throw unavailable();
      }
    },
  });
}
