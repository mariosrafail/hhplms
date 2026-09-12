const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const TOKEN = /^v[123]\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export const HOSTED_VIEWER_RUNTIME_MODES = Object.freeze({
  BARE: "bare",
  BUILDER_PREVIEW: "builder-preview",
  RELEASE_PREVIEW: "release-preview",
  INVALID: "invalid",
});

export function resolveHostedViewerRuntimeContext(search = globalThis.location?.search || "") {
  const parameters = new URLSearchParams(search);
  const builderPreview = parameters.getAll("builderPreview");
  const authorizations = parameters.getAll("previewAuthorization");
  const releaseIds = parameters.getAll("releaseId");
  const productReleaseIds = parameters.getAll("productReleaseId");
  const memberHashes = parameters.getAll("memberSha256");
  const hasPreviewState = builderPreview.length || authorizations.length || releaseIds.length || productReleaseIds.length || memberHashes.length;
  if (!hasPreviewState) return Object.freeze({ kind: HOSTED_VIEWER_RUNTIME_MODES.BARE, teacherPreview: false });
  if (builderPreview.length !== 1 || builderPreview[0] !== "1" || authorizations.length !== 1 || !TOKEN.test(authorizations[0]) || releaseIds.length > 1) {
    return Object.freeze({ kind: HOSTED_VIEWER_RUNTIME_MODES.INVALID, teacherPreview: false });
  }
  if (!releaseIds.length && !productReleaseIds.length && !memberHashes.length && !authorizations[0].startsWith("v3.")) {
    return Object.freeze({ kind: HOSTED_VIEWER_RUNTIME_MODES.BUILDER_PREVIEW, teacherPreview: true, authorization: authorizations[0] });
  }
  if (releaseIds.length !== 1 || productReleaseIds.length !== 1 || memberHashes.length !== 1 || !authorizations[0].startsWith("v3.")
    || !UUID.test(releaseIds[0]) || !UUID.test(productReleaseIds[0]) || !SHA256.test(memberHashes[0])) return Object.freeze({ kind: HOSTED_VIEWER_RUNTIME_MODES.INVALID, teacherPreview: false });
  return Object.freeze({
    kind: HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW,
    teacherPreview: true,
    authorization: authorizations[0],
    releaseId: releaseIds[0].toLowerCase(),
    productReleaseId: productReleaseIds[0].toLowerCase(),
    memberSha256: memberHashes[0],
  });
}

export function currentHostedReleaseId(search = globalThis.location?.search || "") {
  const context = resolveHostedViewerRuntimeContext(search);
  return context.kind === HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW ? context.releaseId : null;
}

export function currentHostedPreviewAuthorization(search = globalThis.location?.search || "") {
  const context = resolveHostedViewerRuntimeContext(search);
  return context.teacherPreview ? context.authorization : null;
}

export function authorizedHostedPreviewPath(path, authorization = currentHostedPreviewAuthorization()) {
  if (!path.startsWith("/preview/") || !TOKEN.test(String(authorization || ""))) throw new Error("Authorized Viewer preview context is required.");
  const url = new URL(path, "https://viewer.invalid");
  url.searchParams.set("previewAuthorization", authorization);
  return `${url.pathname}${url.search}`;
}

export function createHostedBuilderPreviewRuntimeContext(authorization) {
  if (!/^v[12]\./.test(String(authorization || "")) || !TOKEN.test(String(authorization || ""))) throw new Error("Authorized Builder Review is required.");
  return Object.freeze({
    kind: HOSTED_VIEWER_RUNTIME_MODES.BUILDER_PREVIEW,
    teacherPreview: true,
    authorization,
  });
}

export function createHostedReleasePreviewRuntimeContext({ authorization, productReleaseId, componentReleaseId, memberSha256 }) {
  if (!TOKEN.test(String(authorization || "")) || !String(authorization).startsWith("v3.") || !UUID.test(String(productReleaseId || ""))
    || !UUID.test(String(componentReleaseId || "")) || !SHA256.test(String(memberSha256 || ""))) throw new Error("Authorized release member Review is required.");
  return Object.freeze({ kind: HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW, teacherPreview: true, authorization, productReleaseId: productReleaseId.toLowerCase(), releaseId: componentReleaseId.toLowerCase(), memberSha256 });
}

export async function exchangeHostedPreviewComponentAuthorization({
  sourceBookSlug,
  sourceComponentSlug,
  targetBookSlug,
  targetComponentSlug,
  sourceAuthorization,
  runtimeContext = resolveHostedViewerRuntimeContext(),
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const context = runtimeContext;
  if (![HOSTED_VIEWER_RUNTIME_MODES.BUILDER_PREVIEW, HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW].includes(context.kind) || typeof fetchImpl !== "function") throw new Error("Authorized Review is required for component switching.");
  const authorization = sourceAuthorization || context.authorization;
  const releaseMode = context.kind === HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW;
  const response = await fetchImpl(authorizedHostedPreviewPath(releaseMode ? "/preview/authorization/release-member-exchange" : "/preview/authorization/exchange", authorization), {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: releaseMode
        ? { bookSlug: sourceBookSlug, componentSlug: sourceComponentSlug, productReleaseId: context.productReleaseId, componentReleaseId: context.releaseId, memberSha256: context.memberSha256 }
        : { bookSlug: sourceBookSlug, componentSlug: sourceComponentSlug },
      intent: { bookSlug: targetBookSlug, componentSlug: targetComponentSlug, view: "library", pageId: null, activityId: null, releaseId: null, ...(releaseMode ? { productReleaseId: context.productReleaseId } : {}) },
    }),
  });
  if (!response?.ok) throw new Error("The selected component could not be authorized for Builder Review.");
  const payload = await response.json();
  if (!TOKEN.test(String(payload?.token || "")) || !Number.isFinite(Date.parse(payload?.expiresAt || ""))) throw new Error("Component switch authorization is invalid.");
  if (releaseMode && (payload.productReleaseId !== context.productReleaseId || !UUID.test(String(payload.componentReleaseId || "")) || !SHA256.test(String(payload.memberSha256 || "")))) throw new Error("Release member switch authorization is invalid.");
  return Object.freeze({ token: payload.token, expiresAt: payload.expiresAt, ...(releaseMode ? { productReleaseId: payload.productReleaseId, componentReleaseId: payload.componentReleaseId, memberSha256: payload.memberSha256 } : {}) });
}

export async function loadHostedReleaseFamily({ runtimeContext = resolveHostedViewerRuntimeContext(), identity, fetchImpl = globalThis.fetch, signal } = {}) {
  const context = runtimeContext;
  if (context.kind !== HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW || typeof fetchImpl !== "function" || !SAFE_ID.test(String(identity?.bookSlug || "")) || !SAFE_ID.test(String(identity?.componentSlug || ""))) throw new Error("Authorized release family Review is required.");
  const url = new URL("/preview/authorization/release-family", "https://viewer.invalid");
  url.searchParams.set("bookSlug", identity.bookSlug);
  url.searchParams.set("componentSlug", identity.componentSlug);
  url.searchParams.set("productReleaseId", context.productReleaseId);
  url.searchParams.set("componentReleaseId", context.releaseId);
  url.searchParams.set("memberSha256", context.memberSha256);
  const response = await fetchImpl(authorizedHostedPreviewPath(`${url.pathname}${url.search}`, context.authorization), { method: "GET", credentials: "omit", cache: "no-store", signal });
  if (!response?.ok) throw new Error("Release family capabilities are unavailable.");
  const payload = await response.json();
  if (payload?.productReleaseId !== context.productReleaseId || !Array.isArray(payload.members)) throw new Error("Release family capabilities are invalid.");
  return Object.freeze({ ...payload, members: Object.freeze(payload.members.map((member) => Object.freeze({ ...member }))) });
}

export function hostedReleasePath(runtimeContext, identity, suffix) {
  if (runtimeContext?.kind !== HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW || !SAFE_ID.test(String(identity?.bookSlug || "")) || !SAFE_ID.test(String(identity?.componentSlug || ""))
    || !UUID.test(String(runtimeContext.releaseId || "")) || !/^(?:public|teacher-ui|teacher-ui-font|teacher-solution\/[a-z0-9][a-z0-9-]{0,127}|(?:native-teacher|native-answer)\/[a-z0-9][a-z0-9-]{0,127}|assets\/[a-f0-9]{64}\.(?:png|jpg|webp|mp3|mp4|pdf|ttf|wav|gaf))$/.test(suffix)) throw new Error("Invalid hosted release preview path.");
  return authorizedHostedPreviewPath(`/preview/releases/books/${identity.bookSlug}/components/${identity.componentSlug}/${runtimeContext.releaseId}/${suffix}`, runtimeContext.authorization);
}
