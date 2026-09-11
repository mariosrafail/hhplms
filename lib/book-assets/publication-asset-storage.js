import {
  COMPONENT_PUBLICATION_ASSET_ROLES,
  COMPONENT_PUBLICATION_ASSET_STORAGE,
  componentPublicationAssetRolePolicy,
} from "../../src/data/ultimate-b2/componentPublicationAssetRoles.js";
import {
  buildBookAssetHostedOpenResponsePublicKey,
  buildBookAssetHostedTeacherUiPublicKey,
  buildComponentReleaseAssetObjectKey,
  buildBuilderPageAssetObjectKey,
  buildNativeActivityAssetObjectKey,
  buildBuilderFontLibraryObjectKey,
  buildUnitExtraAssetObjectKey,
} from "./object-keys.js";

export function componentPublicationAssetStorageTarget({ bookSlug, componentSlug, sha256, extension, role }) {
  const policy = componentPublicationAssetRolePolicy(role);
  if (!policy) return null;
  if (policy.storage === COMPONENT_PUBLICATION_ASSET_STORAGE.PRIVATE_IMMUTABLE_RELEASE) {
    return {
      profile: "private",
      objectKey: buildComponentReleaseAssetObjectKey({ bookSlug, componentSlug, checksum: sha256, extension }).replace("builder-release-assets/", policy.teacherOnly ? "builder-release-assets/teacher-answers/" : "builder-release-assets/"),
      public: false,
    };
  }
  if (policy.storage === COMPONENT_PUBLICATION_ASSET_STORAGE.PUBLIC_HOSTED_OPEN_RESPONSE) {
    return {
      profile: "public",
      objectKey: buildBookAssetHostedOpenResponsePublicKey({ checksum: sha256, extension: `.${String(extension || "").replace(/^\./, "")}` }),
      publicPath: `/preview/open-response-assets/${sha256}.${String(extension || "").replace(/^\./, "")}`,
      public: true,
    };
  }
  if (policy.storage === COMPONENT_PUBLICATION_ASSET_STORAGE.PUBLIC_HOSTED_TEACHER_UI) {
    return {
      profile: "public",
      objectKey: buildBookAssetHostedTeacherUiPublicKey({ bookSlug, componentSlug, checksum: sha256, extension }),
      publicPath: `/preview/ui-assets-v2/${bookSlug && bookSlug !== "ultimate-b2" ? `books/${bookSlug}/components/${componentSlug}/` : ""}${sha256}.${String(extension || "").replace(/^\./, "")}`,
      public: true,
    };
  }
  return null;
}

export function componentPublicationCanonicalPrivateSourceObjectKey({ bookSlug, componentSlug, descriptor, row }) {
  const extension = `.${String(descriptor?.extension || "").toLowerCase().replace(/^\./, "")}`;
  if (descriptor?.role === COMPONENT_PUBLICATION_ASSET_ROLES.MANAGED_PAGE_IMAGE) {
    return buildBuilderPageAssetObjectKey({
      bookSlug,
      componentSlug,
      pageId: row?.source_metadata?.publication_page_id,
      checksum: descriptor.sha256,
      extension,
    });
  }
  if ([COMPONENT_PUBLICATION_ASSET_ROLES.UNIT_EXTRA_VIDEO, COMPONENT_PUBLICATION_ASSET_ROLES.UNIT_EXTRA_AUDIO].includes(descriptor?.role)) {
    return buildUnitExtraAssetObjectKey({
      bookSlug,
      componentSlug,
      unitSlug: row?.source_metadata?.unit_slug,
      itemId: row?.source_metadata?.unit_extra_item_id,
      checksum: descriptor.sha256,
      extension,
    });
  }
  if ([COMPONENT_PUBLICATION_ASSET_ROLES.ACTIVITY_ARTWORK, COMPONENT_PUBLICATION_ASSET_ROLES.NATIVE_TEACHER_ANSWER].includes(descriptor?.role)) {
    return buildNativeActivityAssetObjectKey({
      bookSlug,
      componentSlug,
      activityId: row?.source_metadata?.native_activity_id,
      purpose: descriptor.role === "native_teacher_answer" ? "teacher-answer" : "native-asset",
      assetSlot: row?.source_metadata?.asset_slot,
      checksum: descriptor.sha256,
      extension,
    });
  }
  if (descriptor?.role === COMPONENT_PUBLICATION_ASSET_ROLES.ACTIVITY_FONT) {
    return buildBuilderFontLibraryObjectKey({ bookSlug, componentSlug, checksum: descriptor.sha256 });
  }
  return null;
}
