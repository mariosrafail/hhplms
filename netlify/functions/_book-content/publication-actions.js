import { deliverNativeTeacherAnswer } from "../../../netlify-sites/ultimate-b2-builder/server/_builder-native-answer-delivery.js";
import { loadComponentReleaseAssetPin } from "../../../netlify-sites/ultimate-b2-builder/server/_builder-publication-store.js";
import { createBookAssetStorage } from "../../../lib/book-assets/storage.js";
import { componentPublicationAssetStorageTarget } from "../../../lib/book-assets/publication-asset-storage.js";
import { verifyImmutableComponentRelease } from "../../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { ultimateB2PublicationCanonicalSeeds } from "../../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler.js";
import { hostedTeacherImportAsSolution, normalizeUltimateB2HostedOpenResponseTeacherImport } from "../../../src/data/ultimate-b2/hostedOpenResponseImport.js";
import { json } from "./shared.js";
import { supportedPublishedBook } from "./published-book-model.js";
import { deliverPublishedPinnedAsset } from "./published-pinned-asset-delivery.js";
import { isPrivatePinnableComponentReleaseAssetRole } from "../../../src/data/ultimate-b2/componentPublicationAssetRoles.js";
import { deliverCanonicalReleasePageAsset } from "../../../netlify-sites/ultimate-b2-builder/server/_canonical-release-page-delivery.js";
import { loadVerifiedPublishedBookFamily } from "./published-book-releases.js";

const SHA256 = /^[a-f0-9]{64}$/;
const privateJson = (statusCode, body) => json(statusCode, body, { "Cache-Control": "private, no-store", Vary: "Cookie" });

async function activeReleaseRow(sql, { bookSlug, componentSlug }) {
  if (bookSlug !== "ultimate-b2") {
    const packages = await sql`select id from book_packages where slug=${bookSlug} limit 1`;
    if (!packages[0]) return null;
    // The HTTP caller has already proved entitlement. Verify the entire family
    // before returning its member, including when a head is corrupt/incomplete.
    const family = await loadVerifiedPublishedBookFamily(sql, null, { allowed: [packages[0].id] });
    return family.find((member) => member.row.component_slug === componentSlug)?.row || null;
  }
  const rows = await sql`
    select release.*
    from book_component_publication_heads head
    join book_component_releases release on release.id=head.release_id and release.book_component_id=head.book_component_id
    join book_packages package on package.id=release.book_package_id
    join book_components component on component.id=release.book_component_id and component.book_package_id=package.id
    where package.slug=${bookSlug} and component.slug=${componentSlug} limit 1
  `;
  return rows[0] || null;
}

export async function publishedReleaseRow(sql, { bookSlug, componentSlug, releaseId }) {
  const rows = await sql`
    select release.*
    from book_component_releases release
    join book_packages package on package.id=release.book_package_id
    join book_components component on component.id=release.book_component_id and component.book_package_id=package.id
    where package.slug=${bookSlug} and component.slug=${componentSlug} and release.id=${releaseId}
      and exists(select 1 from book_component_publication_events event where event.release_id=release.id and event.book_component_id=release.book_component_id)
    limit 1
  `;
  return rows[0] || null;
}

function verifiedPublicProjection(row) {
  return verifyImmutableComponentRelease(row);
}

export async function getActiveComponentRelease(sql, query) {
  if (!supportedPublishedBook(query.bookSlug, query.componentSlug)) return privateJson(404, { error: "Component not found" });
  const row = await activeReleaseRow(sql, query);
  if (!row) return privateJson(404, { error: "no_publication" });
  const verified = verifiedPublicProjection(row);
  if (verified.publicProjection.bookSlug !== query.bookSlug || verified.publicProjection.componentSlug !== query.componentSlug) return privateJson(404, { error: "Component not found" });
  return privateJson(200, { releaseId: row.id, releaseNumber: Number(row.release_number), releaseSha256: row.release_sha256, compatibility: row.runtime_compatibility_sha256, compilerId: row.compiler_id, releaseSchemaVersion: row.release_schema_version, projection: verified.publicProjection });
}

export async function getPublishedReleaseAsset(sql, query, { storage = createBookAssetStorage(), method = "GET", range = null } = {}) {
  const extension = String(query.extension || "").toLowerCase();
  if (!supportedPublishedBook(query.bookSlug, query.componentSlug) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(query.releaseId || "")) || !SHA256.test(String(query.sha256 || "")) || !["png", "jpg", "webp", "mp3", "mp4", "pdf", "ttf"].includes(extension)) return json(404, { error: "Asset not found" });
  const row = await publishedReleaseRow(sql, query);
  if (!row) return json(404, { error: "Asset not found" });
  const verified = verifiedPublicProjection(row);
  const asset = verified.publicProjection.assets.find((candidate) => candidate.sha256 === query.sha256 && candidate.extension === extension);
  if (!asset) return json(404, { error: "Asset not found" });
  if (verified.publicProjection.bookSlug !== query.bookSlug || verified.publicProjection.componentSlug !== query.componentSlug) return privateJson(404, { error: "Asset not found" });
  if (asset.role === "canonical_page_image") return deliverCanonicalReleasePageAsset({ projection: verified.publicProjection, asset, storage, method });
  if (row.asset_storage_mode === "pinned-source-v1" && isPrivatePinnableComponentReleaseAssetRole(asset.role)) {
    return deliverPublishedPinnedAsset(sql, query, { row, projection: verified.publicProjection, asset, storage, method, rangeHeader: range });
  }
  if (!["materialized-v1", "pinned-source-v1", undefined, null].includes(row.asset_storage_mode)) return privateJson(409, { error: "release_pin_integrity_failed" });
  const target = componentPublicationAssetStorageTarget({ bookSlug: query.bookSlug, componentSlug: query.componentSlug, ...asset });
  if (!target) return json(404, { error: "Asset not found" });
  if (!target.public) {
    const location = await storage.signedGetUrl({ profile: target.profile, objectKey: target.objectKey });
    return { statusCode: 302, headers: { Location: location, "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" }, body: "" };
  }
  return { statusCode: 302, headers: { Location: storage.publicUrl(target.objectKey), "Cache-Control": "private, max-age=300", Vary: "Cookie", "X-Content-Type-Options": "nosniff" }, body: "" };
}

export async function getPublishedNativeTeacherDocument(sql, query) {
  if (!supportedPublishedBook(query.bookSlug, query.componentSlug) || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(String(query.activityId || ""))) return privateJson(404, { error: "Native Teacher activity not found" });
  const row = await publishedReleaseRow(sql, query);
  if (!row) return privateJson(404, { error: "Native Teacher activity not found" });
  const verified = verifiedPublicProjection(row);
  const publicEntry = verified.publicProjection.nativeActivities?.[query.activityId];
  const teacherEntry = verified.teacherProjection.nativeActivities?.[query.activityId];
  if (!publicEntry || !teacherEntry || publicEntry.kind !== teacherEntry.kind) return privateJson(404, { error: "Native Teacher activity not found" });
  return privateJson(200, { releaseId: row.id, releaseNumber: Number(row.release_number), activityId: query.activityId, kind: teacherEntry.kind, document: teacherEntry.document });
}

export async function getPublishedTeacherSolutionOverride(sql, stableActivityId) {
  const row = await activeReleaseRow(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" });
  if (!row) return null;
  const verified = verifiedPublicProjection(row);
  const raw = verified.teacherProjection?.solutions?.[stableActivityId];
  if (!raw) return null;
  const seed = ultimateB2PublicationCanonicalSeeds()[stableActivityId];
  if (!seed) return null;
  const teacher = normalizeUltimateB2HostedOpenResponseTeacherImport(raw, stableActivityId, seed.questions.map((question) => question.id));
  return hostedTeacherImportAsSolution(teacher, stableActivityId, seed.questions.map((question) => question.id));
}

export async function getPublishedNativeTeacherAnswer(sql, query, { method = "GET", storage = createBookAssetStorage() } = {}) {
  if (!supportedPublishedBook(query.bookSlug, query.componentSlug) || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(String(query.activityId || "")) || !/^[0-9a-f-]{36}$/.test(String(query.releaseId || ""))) return privateJson(404, { error: "Native Teacher answer not found" });
  const release = await publishedReleaseRow(sql, query);
  if (!release) return privateJson(404, { error: "Native Teacher answer not found" });
  try {
    return await deliverNativeTeacherAnswer({ release, verified: verifiedPublicProjection(release), activityId: query.activityId, sectionId: query.sectionId || null, method, storage,
      loadPin: (asset) => loadComponentReleaseAssetPin(sql, { ...query, ...asset }) });
  } catch { return privateJson(404, { error: "Native Teacher answer not found" }); }
}
