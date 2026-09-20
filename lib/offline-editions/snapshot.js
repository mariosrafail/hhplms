import { contentEdition } from "../../src/data/contentEditions.js";
import { verifyWordListEdition, projectWordList } from "../../netlify-sites/ultimate-b2-builder/server/_builder-wordlist-domain.js";
import { normalizeHostedTeacherUiPreview } from "../../src/data/ultimate-b2/hostedTeacherUiDocument.js";

// Called only after route authentication and a published-only database read.
// Private source hashes remain opaque identities in this derived envelope.
export function projectOfflineEdition(release, { bookSlug, editionId, audience, teacherAuthorized }) {
  if (!["teacher", "student"].includes(audience)) throw new Error("offline_audience_invalid");
  if (audience === "teacher" && teacherAuthorized !== true) throw new Error("offline_teacher_required");
  verifyWordListEdition(release, contentEdition(bookSlug, editionId));
  const owner = release.content.members.find((member) => member.reference.componentSlug === `${bookSlug}-students-book`);
  return {
    schemaVersion: "offline-edition-snapshot.v1", bookSlug, editionId, audience,
    source: { contract: release.schemaVersion, id: release.id, state: "published", number: release.number,
      releaseSha256: release.releaseSha256, compositionSha256: release.compositionSha256,
      contentReleaseSha256: release.content.releaseSha256, composition: release.composition },
    uiOwner: { reference: owner.reference, ui: normalizeHostedTeacherUiPreview(owner.content.teacherProjection.ui, { packageId: owner.reference.componentSlug }) },
    members: release.content.members.map((member) => ({
      reference: member.reference, compilerId: member.content.compilerId, releaseSchemaVersion: member.content.releaseSchemaVersion,
      releaseSha256: member.content.releaseSha256, projection: member.content.publicProjection,
      teacherDocuments: audience === "teacher" ? Object.fromEntries(Object.entries(member.content.teacherProjection.nativeActivities).map(([id, entry]) => [id, entry.document])) : {},
      assets: (audience === "teacher" ? member.content.assetManifest : member.content.publicProjection.assets).map(({ sha256, extension, mediaType, role }) => ({ sha256, extension, mediaType, role })),
      wordlist: release.wordlists.some((record) => record.targetSource.componentSlug === member.reference.componentSlug)
        ? projectWordList(release.wordlists.find((record) => record.targetSource.componentSlug === member.reference.componentSlug), editionId) : null,
    })),
  };
}
