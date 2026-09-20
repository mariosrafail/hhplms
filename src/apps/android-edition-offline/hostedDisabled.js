export const HOSTED_VIEWER_RUNTIME_MODES = Object.freeze({ RELEASE_PREVIEW: "disabled-release", BUILDER_PREVIEW: "disabled-builder" });
export const resolveHostedViewerRuntimeContext = () => ({ kind: "offline-edition" });
export function authorizedHostedPreviewPath() { throw new Error("offline_hosted_access_disabled"); }
export const hostedReleasePath = authorizedHostedPreviewPath;
export const teacherUiAssetUrl = authorizedHostedPreviewPath;
export const teacherUiFontUrl = (_context, _identity, asset, resolve) => { if (!resolve) throw new Error("offline_font_provider_required"); return resolve(asset); };
