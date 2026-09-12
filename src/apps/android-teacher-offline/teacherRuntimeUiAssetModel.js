import { hostedTeacherUiAssetPath, normalizeHostedTeacherUiPreview } from "../../data/ultimate-b2/hostedTeacherUiDocument.js";
import { HOSTED_VIEWER_RUNTIME_MODES, authorizedHostedPreviewPath, hostedReleasePath, resolveHostedViewerRuntimeContext } from "./hostedReleasePreview.js";

export function createTeacherRuntimeUiAssetModel({ authoring, resolveCanonicalAssetUrl, resolveFrozenFontUrl = null, hostedPreview = null, runtimeContext = resolveHostedViewerRuntimeContext(), identity = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" } }) {
  if (!authoring || typeof resolveCanonicalAssetUrl !== "function") throw new TypeError("Teacher runtime UI asset factory requires canonical authoring and a URL resolver.");
  const preview = hostedPreview ? normalizeHostedTeacherUiPreview(hostedPreview, { packageId: identity.componentSlug }) : null;
  const overrides = preview?.assets || {};
  const partsFallback = () => preview?.independentPartsBackgrounds ? resolveCanonicalAssetUrl(authoring.shell.studentsBookPartsBackground) : url(authoring.shell.studentsBookPartsBackground);
  const context = runtimeContext;
  const url = (binding) => {
    if (!overrides[binding.id]) return resolveCanonicalAssetUrl(binding);
    return context.kind === HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW
      ? hostedReleasePath(context, identity, `assets/${overrides[binding.id].sha256}.${overrides[binding.id].extension}`)
      : hostedTeacherUiAssetPath(overrides[binding.id], identity);
  };
  const artwork = (item) => Object.freeze({ id: item.id, label: item.label, controlId: item.controlId, destination: item.destination || null, normal: url(item.normal), hoverPressed: url(item.active) });
  const toolbarItems = Object.freeze(authoring.shell.toolbar.map((item) => Object.freeze({
    id: item.id, label: item.label, controlId: item.controlId, normal: url(item.normal), active: url(item.active), sound: url(item.sound),
  })));
  const classroom = Object.freeze({
    overviewCaptionFontFamily: preview?.overviewCaptionFontFamily || null,
    overviewCaptionFontAsset: preview?.overviewCaptionFontAsset || null,
    overviewCaptionFontUrl: !preview?.overviewCaptionFontAsset ? null
      : import.meta.env?.VITE_APP_MODE === "android-teacher-offline" ? resolveFrozenFontUrl?.(preview.overviewCaptionFontAsset) || null
        : context.kind === HOSTED_VIEWER_RUNTIME_MODES.RELEASE_PREVIEW ? hostedReleasePath(context, identity, "teacher-ui-font")
        : context.kind === HOSTED_VIEWER_RUNTIME_MODES.BUILDER_PREVIEW ? authorizedHostedPreviewPath(`/preview/content/books/${identity.bookSlug}/components/${identity.componentSlug}/ui-controller/font`, context.authorization)
          : resolveFrozenFontUrl?.(preview.overviewCaptionFontAsset) || null,
    backgrounds: Object.freeze({
      classroomGlacier: url(authoring.shell.background),
      studentsBookPartsBackground: url(authoring.shell.studentsBookPartsBackground),
      workbookPartsBackground: overrides["background.workbook-parts"] ? url({ id: "background.workbook-parts" }) : partsFallback(),
      grammarBookPartsBackground: overrides["background.grammar-book-parts"] ? url({ id: "background.grammar-book-parts" }) : partsFallback(),
    }),
    branding: Object.freeze({
      hamiltonHouseLogo: url(authoring.shell.publisherLogo),
      menuTitle: Object.freeze({ gaf: url(authoring.shell.titleAnimation.gaf), sd: Object.freeze(authoring.shell.titleAnimation.sd.map(url)), hd: Object.freeze(authoring.shell.titleAnimation.hd.map(url)) }),
      bookMenu: Object.freeze({
        units: Object.freeze(authoring.shell.units.map(artwork)),
        editions: Object.freeze(authoring.shell.editions.map(artwork)),
        extras: Object.freeze(authoring.shell.extras.map((item) => Object.freeze({ ...artwork(item), column: item.column, order: item.order }))),
      }),
    }),
    controls: Object.freeze({ activityHotspot: url(authoring.shell.activityHotspot) }),
    bookSwitches: Object.freeze(authoring.shell.bookSwitches.map((item) => Object.freeze({ id: item.id, controlId: item.controlId, label: item.label, source: url(item.asset) }))),
    revealControls: Object.freeze(Object.fromEntries(authoring.shell.revealControls.map((item) => [item.id, Object.freeze({ id: item.id, controlId: item.controlId, label: item.label, active: url(item.active), pressed: url(item.pressed), disabled: url(item.disabled) })]))),
    mediaPlayer: Object.freeze({
      background: url(authoring.shell.mediaPlayer.background),
      play: Object.freeze({ active: url(authoring.shell.mediaPlayer.playActive), pressed: url(authoring.shell.mediaPlayer.playPressed) }),
      pause: Object.freeze({ active: url(authoring.shell.mediaPlayer.pauseActive), pressed: url(authoring.shell.mediaPlayer.pausePressed) }),
      stop: Object.freeze({ active: url(authoring.shell.mediaPlayer.stopActive), pressed: url(authoring.shell.mediaPlayer.stopPressed) }),
    }),
    icons: Object.freeze({
      ...Object.fromEntries(Object.entries(authoring.shell.navigation).map(([id, binding]) => [id, url(binding)])),
      teacherTools: Object.freeze(Object.fromEntries([
        ...authoring.shell.toolbar.map((item) => [item.id, Object.freeze({ normal: url(item.normal), active: url(item.active) })]),
        ["keyboard", Object.freeze({ normal: url(authoring.assets["toolbar.keyboard.normal"]), active: url(authoring.assets["toolbar.keyboard.active"]) })],
      ])),
    }),
    sounds: Object.freeze(Object.fromEntries(Object.entries(authoring.shell.sounds).map(([id, binding]) => [id, url(binding)]))),
  });
  return Object.freeze({ classroom, toolbarItems });
}
