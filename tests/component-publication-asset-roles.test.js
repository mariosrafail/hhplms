import assert from "node:assert/strict";
import test from "node:test";

import { componentPublicationAssetStorageTarget } from "../lib/book-assets/publication-asset-storage.js";
import {
  COMPONENT_PUBLICATION_ASSET_ROLES,
  COMPONENT_PUBLICATION_ASSET_STORAGE,
  componentPublicationAssetRolePolicy,
  isPrivateMaterializedComponentReleaseAssetRole,
  isPrivatePinnableComponentReleaseAssetRole,
  isPublicComponentPublicationAssetRole,
  isPublicProjectionComponentPublicationAssetRole,
} from "../src/data/ultimate-b2/componentPublicationAssetRoles.js";

const sha256 = "a".repeat(64);
const identity = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", sha256 };

test("publication asset roles have one explicit private-materialized versus hosted-public classification", () => {
  assert.deepEqual(Object.keys(COMPONENT_PUBLICATION_ASSET_ROLES).sort(), ["ACTIVITY_ARTWORK", "ACTIVITY_FONT", "CANONICAL_PAGE_IMAGE", "MANAGED_PAGE_IMAGE", "NATIVE_TEACHER_ANSWER", "OPEN_RESPONSE_ARTWORK", "TEACHER_UI", "UNIT_EXTRA_AUDIO", "UNIT_EXTRA_VIDEO"]);
  assert.equal(isPrivateMaterializedComponentReleaseAssetRole(COMPONENT_PUBLICATION_ASSET_ROLES.CANONICAL_PAGE_IMAGE), true);
  assert.equal(isPrivatePinnableComponentReleaseAssetRole(COMPONENT_PUBLICATION_ASSET_ROLES.CANONICAL_PAGE_IMAGE), false);
  assert.equal(isPublicComponentPublicationAssetRole(COMPONENT_PUBLICATION_ASSET_ROLES.CANONICAL_PAGE_IMAGE), false);
  assert.equal(isPublicProjectionComponentPublicationAssetRole(COMPONENT_PUBLICATION_ASSET_ROLES.CANONICAL_PAGE_IMAGE), true);
  for (const role of [COMPONENT_PUBLICATION_ASSET_ROLES.ACTIVITY_ARTWORK, COMPONENT_PUBLICATION_ASSET_ROLES.ACTIVITY_FONT, COMPONENT_PUBLICATION_ASSET_ROLES.MANAGED_PAGE_IMAGE, COMPONENT_PUBLICATION_ASSET_ROLES.UNIT_EXTRA_AUDIO, COMPONENT_PUBLICATION_ASSET_ROLES.UNIT_EXTRA_VIDEO]) {
    assert.equal(componentPublicationAssetRolePolicy(role).storage, COMPONENT_PUBLICATION_ASSET_STORAGE.PRIVATE_IMMUTABLE_RELEASE);
    assert.equal(isPrivateMaterializedComponentReleaseAssetRole(role), true);
    assert.equal(isPrivatePinnableComponentReleaseAssetRole(role), true);
    assert.equal(isPublicComponentPublicationAssetRole(role), false);
    assert.equal(isPublicProjectionComponentPublicationAssetRole(role), true);
  }
  for (const role of [COMPONENT_PUBLICATION_ASSET_ROLES.OPEN_RESPONSE_ARTWORK, COMPONENT_PUBLICATION_ASSET_ROLES.TEACHER_UI]) {
    assert.equal(isPrivateMaterializedComponentReleaseAssetRole(role), false);
    assert.equal(isPrivatePinnableComponentReleaseAssetRole(role), false);
    assert.equal(isPublicComponentPublicationAssetRole(role), true);
  }
  assert.equal(isPublicProjectionComponentPublicationAssetRole(COMPONENT_PUBLICATION_ASSET_ROLES.TEACHER_UI), false);
  assert.equal(componentPublicationAssetRolePolicy("unsupported"), null);
});

test("canonical role storage resolution keeps private release assets private and preserves hosted public namespaces", () => {
  assert.deepEqual(componentPublicationAssetStorageTarget({ ...identity, extension: "png", role: COMPONENT_PUBLICATION_ASSET_ROLES.ACTIVITY_ARTWORK }), {
    profile: "private",
    objectKey: `builder-release-assets/ultimate-b2/ultimate-b2-students-book/${sha256}.png`,
    public: false,
  });
  assert.deepEqual(componentPublicationAssetStorageTarget({ ...identity, extension: "mp4", role: COMPONENT_PUBLICATION_ASSET_ROLES.UNIT_EXTRA_VIDEO }), {
    profile: "private",
    objectKey: `builder-release-assets/ultimate-b2/ultimate-b2-students-book/${sha256}.mp4`,
    public: false,
  });
  assert.deepEqual(componentPublicationAssetStorageTarget({ ...identity, extension: "mp3", role: COMPONENT_PUBLICATION_ASSET_ROLES.UNIT_EXTRA_AUDIO }), {
    profile: "private",
    objectKey: `builder-release-assets/ultimate-b2/ultimate-b2-students-book/${sha256}.mp3`,
    public: false,
  });
  assert.deepEqual(componentPublicationAssetStorageTarget({ ...identity, extension: "webp", role: COMPONENT_PUBLICATION_ASSET_ROLES.OPEN_RESPONSE_ARTWORK }), {
    profile: "public",
    objectKey: `publishers/hamilton-house/books/ultimate-b2/editions/students-book/versions/hosted-draft/components/ultimate-b2-students-book/open-response/assets/${sha256}.webp`,
    publicPath: `/preview/open-response-assets/${sha256}.webp`,
    public: true,
  });
  assert.deepEqual(componentPublicationAssetStorageTarget({ ...identity, extension: "wav", role: COMPONENT_PUBLICATION_ASSET_ROLES.TEACHER_UI }), {
    profile: "public",
    objectKey: `publishers/hamilton-house/books/ultimate-b2/editions/students-book/versions/hosted-draft/components/ultimate-b2-students-book/teacher-ui/assets/${sha256}.wav`,
    publicPath: `/preview/ui-assets-v2/${sha256}.wav`,
    public: true,
  });
  assert.equal(componentPublicationAssetStorageTarget({ ...identity, extension: "png", role: "unsupported" }), null);
});
