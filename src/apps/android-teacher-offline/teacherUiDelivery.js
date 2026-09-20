import { hostedTeacherUiAssetPath } from "../../data/ultimate-b2/hostedTeacherUiDocument.js";
import { HOSTED_VIEWER_RUNTIME_MODES, authorizedHostedPreviewPath, hostedReleasePath } from "./hostedReleasePreview.js";

export function teacherUiAssetUrl(context, identity, asset) {
  return context.kind === HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW
    ? hostedReleasePath(context, identity, `assets/${asset.sha256}.${asset.extension}`)
    : hostedTeacherUiAssetPath(asset, identity);
}
export function teacherUiFontUrl(context, identity, asset, resolveFrozenFontUrl) {
  return import.meta.env?.VITE_APP_MODE === "android-teacher-offline" ? resolveFrozenFontUrl?.(asset) || null
    : context.kind === HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW ? hostedReleasePath(context, identity, "teacher-ui-font")
      : context.kind === HOSTED_VIEWER_RUNTIME_MODES.BUILDER_PREVIEW ? authorizedHostedPreviewPath(`/preview/content/books/${identity.bookSlug}/components/${identity.componentSlug}/ui-controller/font`, context.authorization)
        : resolveFrozenFontUrl?.(asset) || null;
}
