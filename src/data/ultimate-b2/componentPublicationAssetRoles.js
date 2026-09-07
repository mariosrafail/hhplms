export const COMPONENT_PUBLICATION_ASSET_ROLES = Object.freeze({
  OPEN_RESPONSE_ARTWORK: "open_response_artwork",
  ACTIVITY_ARTWORK: "activity_artwork",
  ACTIVITY_FONT: "activity_font",
  NATIVE_TEACHER_ANSWER: "native_teacher_answer",
  MANAGED_PAGE_IMAGE: "managed_page_image",
  CANONICAL_PAGE_IMAGE: "canonical_page_image",
  UNIT_EXTRA_VIDEO: "unit_extra_video",
  UNIT_EXTRA_AUDIO: "unit_extra_audio",
  TEACHER_UI: "teacher_ui",
});

export const COMPONENT_PUBLICATION_ASSET_STORAGE = Object.freeze({
  PRIVATE_IMMUTABLE_RELEASE: "private_immutable_release",
  PUBLIC_HOSTED_OPEN_RESPONSE: "public_hosted_open_response",
  PUBLIC_HOSTED_TEACHER_UI: "public_hosted_teacher_ui",
});

const rolePolicies = Object.freeze({
  [COMPONENT_PUBLICATION_ASSET_ROLES.CANONICAL_PAGE_IMAGE]: Object.freeze({ storage: COMPONENT_PUBLICATION_ASSET_STORAGE.PRIVATE_IMMUTABLE_RELEASE, materialized: true, pinnable: false, publicProjection: true }),
  [COMPONENT_PUBLICATION_ASSET_ROLES.NATIVE_TEACHER_ANSWER]: Object.freeze({ storage: COMPONENT_PUBLICATION_ASSET_STORAGE.PRIVATE_IMMUTABLE_RELEASE, materialized: true, pinnable: true, publicProjection: false, teacherOnly: true }),
  [COMPONENT_PUBLICATION_ASSET_ROLES.ACTIVITY_ARTWORK]: Object.freeze({
    storage: COMPONENT_PUBLICATION_ASSET_STORAGE.PRIVATE_IMMUTABLE_RELEASE,
    materialized: true,
    pinnable: true,
    publicProjection: true,
  }),
  [COMPONENT_PUBLICATION_ASSET_ROLES.ACTIVITY_FONT]: Object.freeze({
    storage: COMPONENT_PUBLICATION_ASSET_STORAGE.PRIVATE_IMMUTABLE_RELEASE,
    materialized: true,
    pinnable: true,
    publicProjection: true,
  }),
  [COMPONENT_PUBLICATION_ASSET_ROLES.MANAGED_PAGE_IMAGE]: Object.freeze({
    storage: COMPONENT_PUBLICATION_ASSET_STORAGE.PRIVATE_IMMUTABLE_RELEASE,
    materialized: true,
    pinnable: true,
    publicProjection: true,
  }),
  [COMPONENT_PUBLICATION_ASSET_ROLES.UNIT_EXTRA_VIDEO]: Object.freeze({
    storage: COMPONENT_PUBLICATION_ASSET_STORAGE.PRIVATE_IMMUTABLE_RELEASE,
    materialized: true,
    pinnable: true,
    publicProjection: true,
  }),
  [COMPONENT_PUBLICATION_ASSET_ROLES.UNIT_EXTRA_AUDIO]: Object.freeze({
    storage: COMPONENT_PUBLICATION_ASSET_STORAGE.PRIVATE_IMMUTABLE_RELEASE,
    materialized: true,
    pinnable: true,
    publicProjection: true,
  }),
  [COMPONENT_PUBLICATION_ASSET_ROLES.OPEN_RESPONSE_ARTWORK]: Object.freeze({
    storage: COMPONENT_PUBLICATION_ASSET_STORAGE.PUBLIC_HOSTED_OPEN_RESPONSE,
    materialized: false,
    publicProjection: true,
  }),
  [COMPONENT_PUBLICATION_ASSET_ROLES.TEACHER_UI]: Object.freeze({
    storage: COMPONENT_PUBLICATION_ASSET_STORAGE.PUBLIC_HOSTED_TEACHER_UI,
    materialized: false,
    publicProjection: false,
  }),
});

export const COMPONENT_PUBLICATION_ASSET_ROLE_POLICIES = rolePolicies;

export function componentPublicationAssetRolePolicy(role) {
  return rolePolicies[String(role || "")] || null;
}

export function isPrivateMaterializedComponentReleaseAssetRole(role) {
  const policy = componentPublicationAssetRolePolicy(role);
  return policy?.storage === COMPONENT_PUBLICATION_ASSET_STORAGE.PRIVATE_IMMUTABLE_RELEASE && policy.materialized === true;
}

export function isPrivatePinnableComponentReleaseAssetRole(role) {
  const policy = componentPublicationAssetRolePolicy(role);
  return policy?.storage === COMPONENT_PUBLICATION_ASSET_STORAGE.PRIVATE_IMMUTABLE_RELEASE && policy.pinnable === true;
}

export function isPublicComponentPublicationAssetRole(role) {
  const policy = componentPublicationAssetRolePolicy(role);
  return policy?.storage === COMPONENT_PUBLICATION_ASSET_STORAGE.PUBLIC_HOSTED_OPEN_RESPONSE
    || policy?.storage === COMPONENT_PUBLICATION_ASSET_STORAGE.PUBLIC_HOSTED_TEACHER_UI;
}

export function isPublicProjectionComponentPublicationAssetRole(role) {
  return componentPublicationAssetRolePolicy(role)?.publicProjection === true;
}
