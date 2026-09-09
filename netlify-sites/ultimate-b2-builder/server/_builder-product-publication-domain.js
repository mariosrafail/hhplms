import { createHash } from "node:crypto";

import { normalizeProductReleaseEnvelope } from "../../../src/data/ultimate-b2/productPublication.js";
import { findPublicationProduct, findPublicationComponentBySlug } from "../../../src/data/publicationRegistry.js";

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const absent = (value) => value === null || value === undefined ? "-" : String(value);

export function productReleaseMemberFingerprintInput(member) {
  return [
    `${findPublicationComponentBySlug(member.componentSlug)?.bookSlug || (() => { throw new Error("Unsupported product member"); })()}-product-member-v1`,
    member.order,
    member.componentSlug,
    member.status,
    absent(member.componentReleaseId),
    absent(member.compilerId),
    absent(member.releaseSchemaVersion),
    absent(member.releaseSha256),
    absent(member.compatibility),
    absent(member.unavailableReason),
  ].join("\n");
}

export function productReleaseMemberSha256(member) {
  return sha256(productReleaseMemberFingerprintInput(member));
}

export function productReleaseSourceFingerprintInput({ bookSlug, releaseNumber, members }) {
  return [
    `${findPublicationProduct(bookSlug)?.bookSlug || (() => { throw new Error("Unsupported product"); })()}-product-source-v1`,
    bookSlug,
    releaseNumber,
    ...members.map((member) => `${member.componentSlug}\t${member.memberSha256}`),
  ].join("\n");
}

export function productReleaseSourceSha256(value) {
  return sha256(productReleaseSourceFingerprintInput(value));
}

export function productReleaseFingerprintInput({ compilerId, releaseSchemaVersion, bookSlug, releaseNumber, sourceSnapshotSha256, releaseNote, members }) {
  return [
    `${findPublicationProduct(bookSlug)?.bookSlug || (() => { throw new Error("Unsupported product"); })()}-product-release-v1`,
    compilerId,
    releaseSchemaVersion,
    bookSlug,
    releaseNumber,
    sourceSnapshotSha256,
    releaseNote || "",
    ...members.map((member) => `${member.componentSlug}\t${member.memberSha256}`),
  ].join("\n");
}

export function productReleaseSha256(value) {
  return sha256(productReleaseFingerprintInput(value));
}

export function verifyProductReleaseEnvelope(value) {
  const release = normalizeProductReleaseEnvelope(value);
  for (const member of release.members) {
    if (productReleaseMemberSha256(member) !== member.memberSha256) throw new Error("Product release member fingerprint is invalid.");
  }
  const sourceSnapshotSha256 = productReleaseSourceSha256({ bookSlug: release.bookSlug, releaseNumber: release.number, members: release.members });
  if (sourceSnapshotSha256 !== release.sourceSnapshotSha256 || productReleaseSha256({
    compilerId: release.compilerId,
    releaseSchemaVersion: release.releaseSchemaVersion,
    bookSlug: release.bookSlug,
    releaseNumber: release.number,
    sourceSnapshotSha256,
    releaseNote: release.releaseNote,
    members: release.members,
  }) !== release.releaseSha256) throw new Error("Product release fingerprint is invalid.");
  return release;
}
