import { useEffect, useState } from "react";

import { normalizeComponentPublicationEnvelope } from "../../services/componentPublicationApi.js";
import { createUltimateB2HostedOpenResponseSeed } from "../../data/ultimate-b2/hostedOpenResponseDraft.js";
import { hydrateUltimateB2ReleaseImport } from "../../data/ultimate-b2/componentPublication.js";
import { findStudentsBookImplementation } from "../../data/ultimate-b2/studentsBookCatalog.js";
import { getUltimateB2StudentsBookHotspotActions, getUltimateB2StudentsBookHotspotActionsFromManifest } from "../../data/ultimate-b2/studentsBookHotspots.js";
import { normalizeCurrentDraftUnitExtras } from "../../data/ultimate-b2/unitExtras.js";
import { authorizedHostedPreviewPath, HOSTED_VIEWER_RUNTIME_MODES, hostedReleasePath, resolveHostedViewerRuntimeContext } from "./hostedReleasePreview.js";
import { normalizeComponentActivityOrder } from "../../data/native-activities/nativeActivityOrder.js";

const cached = new Map();
const pending = new Map();

export function clearPublishedComponentReleaseCache() { cached.clear(); pending.clear(); }

async function loadRelease(signal, runtimeContext, identity) {
  const context = runtimeContext || resolveHostedViewerRuntimeContext();
  if (context.kind === HOSTED_VIEWER_RUNTIME_MODES.BUILDER_PREVIEW) {
    const [extras, response] = await Promise.all([
      loadHostedDraftUnitExtras({ signal, context, identity }),
      fetch(authorizedHostedPreviewPath(`/preview/native-activities/books/${identity.bookSlug}/components/${identity.componentSlug}/order`, context.authorization), { credentials: "omit", cache: "no-store", signal }),
    ]);
    if (!response.ok) throw new Error("Saved activity order is unavailable.");
    const value = await response.json();
    if (value.bookSlug !== identity.bookSlug || value.componentSlug !== identity.componentSlug) throw new Error("Saved activity order identity is invalid.");
    return { ...extras, kind: "draft", projection: { ...extras.projection, activityOrder: normalizeComponentActivityOrder(value.pages) }, runtimeContext: context, identity };
  }
  if (context.kind !== HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW) return { kind: "none" };
  const response = await fetch(hostedReleasePath(context, identity, "public"), { method: "GET", credentials: "omit", cache: "no-store", signal });
  if (!response.ok) throw new Error("Prepared release is unavailable.");
  const payload = await response.json();
  const normalized = identity.componentSlug === "ultimate-b2-students-book" ? normalizeComponentPublicationEnvelope(payload) : {
    kind: "published", releaseId: payload.releaseId, releaseNumber: payload.releaseNumber, releaseSha256: payload.releaseSha256,
    compatibility: payload.compatibility, compilerId: payload.compilerId, releaseSchemaVersion: payload.releaseSchemaVersion, projection: payload.projection,
  };
  return Object.freeze({ ...normalized, runtimeContext: context, identity: Object.freeze({ ...identity }) });
}

export async function loadHostedDraftUnitExtras({ signal, context = resolveHostedViewerRuntimeContext(), identity = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" }, fetchImpl = globalThis.fetch } = {}) {
  if (context.kind !== HOSTED_VIEWER_RUNTIME_MODES.BUILDER_PREVIEW || identity.bookSlug !== "ultimate-b2" || identity.componentSlug !== "ultimate-b2-students-book") return { kind: "none" };
  const path = authorizedHostedPreviewPath(`/preview/content/books/${identity.bookSlug}/components/${identity.componentSlug}/unit-extras`, context.authorization);
  const response = await fetchImpl(path, { method: "GET", credentials: "omit", cache: "no-store", signal });
  if (response.status === 404) return { kind: "none" };
  if (!response.ok) throw new Error("Saved Draft Unit Extras are unavailable.");
  const payload = await response.json();
  const keys = Object.keys(payload || {}).sort().join("\0");
  if (keys !== ["bookSlug", "componentSlug", "document", "resource", "revision", "schemaVersion", "source"].sort().join("\0")
    || payload.bookSlug !== identity.bookSlug || payload.componentSlug !== identity.componentSlug || payload.resource !== "unit-extras"
    || payload.schemaVersion !== "1.0" || !Number.isSafeInteger(payload.revision) || payload.revision < 1 || payload.source !== "database") throw new Error("Saved Draft Unit Extras identity is invalid.");
  return Object.freeze({ kind: "draft", revision: payload.revision, projection: Object.freeze({ unitExtras: normalizeCurrentDraftUnitExtras(payload.document) }), runtimeContext: context, identity: Object.freeze({ ...identity }) });
}

export function usePublishedComponentRelease({ runtimeContext = resolveHostedViewerRuntimeContext(), identity = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" } } = {}) {
  const key = `${runtimeContext.kind}:${runtimeContext.productReleaseId || "draft"}:${runtimeContext.releaseId || "draft"}:${runtimeContext.memberSha256 || "none"}:${runtimeContext.authorization || "anonymous"}:${identity.bookSlug}:${identity.componentSlug}`;
  const [state, setState] = useState(cached.get(key) || { kind: "loading" });
  useEffect(() => {
    if (cached.has(key)) { setState(cached.get(key)); return undefined; }
    const controller = new AbortController();
    if (!pending.has(key)) pending.set(key, loadRelease(controller.signal, runtimeContext, identity).then((value) => { cached.set(key, value); return value; }).finally(() => { pending.delete(key); }));
    pending.get(key).then(setState).catch((error) => setState({ kind: "error", message: error.message }));
    return () => controller.abort();
  }, [identity.bookSlug, identity.componentSlug, key, runtimeContext]);
  return state;
}

export function hydratePublishedActivityImport(activityId, input, publication) {
  if (!input) return null;
  const seed = createUltimateB2HostedOpenResponseSeed(findStudentsBookImplementation(activityId));
  return hydrateUltimateB2ReleaseImport(input, activityId, seed.questions.map((question) => question.id), (asset) => hostedReleasePath(publication.runtimeContext, publication.identity, `assets/${asset.sha256}.${asset.extension}`));
}

export function publishedHotspotActions(publication, identity) {
  if (publication.kind === "published" && publication.compilerId === "ultimate-b2-students-book-v3") return getUltimateB2StudentsBookHotspotActionsFromManifest(publication.projection.hotspots, { pageId: identity.pageId, unitNumber: identity.unitNumber });
  if (publication.kind === "published") return getUltimateB2StudentsBookHotspotActionsFromManifest(publication.projection.hotspots, identity);
  if (publication.kind === "none") return getUltimateB2StudentsBookHotspotActions(identity);
  return [];
}

export function publishedNativeAssetUrl(publication, reference) {
  if (publication.kind !== "published" || !reference) return "";
  const asset = publication.projection.assets.find((candidate) => candidate.sha256 === reference.checksumSha256 && candidate.role === reference.role);
  return asset ? hostedReleasePath(publication.runtimeContext, publication.identity, `assets/${asset.sha256}.${asset.extension}`) : "";
}

export function publishedUnitExtraVideoUrl(publication, reference) {
  if (publication.kind === "draft" && reference) {
    for (const unit of (publication.projection.unitExtras?.units || [])) {
      const video = unit.categories.videos.find((entry) => entry.video?.asset?.assetId === reference.assetId && entry.video.asset.checksumSha256 === reference.checksumSha256);
      if (video) return authorizedHostedPreviewPath(`/preview/unit-extras/books/${publication.identity.bookSlug}/components/${publication.identity.componentSlug}/units/${unit.unitId}/videos/${video.id}/assets/${reference.assetId}/preview`, publication.runtimeContext.authorization);
    }
    return "";
  }
  return publishedNativeAssetUrl(publication, reference);
}

export function publishedUnitExtraAudioUrl(publication, reference) {
  if (publication.kind === "draft" && reference) {
    for (const unit of (publication.projection.unitExtras?.units || [])) {
      const audio = (unit.categories.audios ?? []).find((entry) => entry.audio?.asset?.assetId === reference.assetId && entry.audio.asset.checksumSha256 === reference.checksumSha256);
      if (audio) return authorizedHostedPreviewPath(`/preview/unit-extras/books/${publication.identity.bookSlug}/components/${publication.identity.componentSlug}/units/${unit.unitId}/audios/${audio.id}/assets/${reference.assetId}/preview`, publication.runtimeContext.authorization);
    }
    return "";
  }
  return publishedNativeAssetUrl(publication, reference);
}

export async function loadPublishedNativeTeacherDocument(publication, activityId, { signal } = {}) {
  const response = await fetch(hostedReleasePath(publication.runtimeContext, publication.identity, `native-teacher/${activityId}`), { method: "GET", credentials: "omit", cache: "no-store", signal });
  if (!response.ok) throw new Error("Prepared Teacher activity is unavailable.");
  const payload = await response.json();
  if (payload.releaseId !== publication.releaseId || payload.activityId !== activityId) throw new Error("Prepared Teacher release identity mismatch.");
  return payload.document;
}

export function publishedNativeTeacherAssetUrl(publication, activityId, sectionId = null) {
  const path = hostedReleasePath(publication.runtimeContext, publication.identity, `native-answer/${activityId}`);
  return sectionId ? `${path}${path.includes("?") ? "&" : "?"}sectionId=${encodeURIComponent(sectionId)}` : path;
}
