import { logicalAssetKey, verifyPack, PACK_LIMITS, PACK_WEB_ROOT, fail } from "../../data/offline-editions/contract.js";
import { stableJson } from "../../data/wordlists/portable.js";
import { nativeTeacherAnswerImages } from "../../data/native-activities/nativeImageSampleAnswer.js";

let installed = null;
const url = (relative) => new URL(`${PACK_WEB_ROOT}/${relative}`, document.baseURI).href;
async function localBytes(relative, maximum) {
  const response = await fetch(url(relative), { cache: "no-store", credentials: "omit", redirect: "error" });
  if (!response.ok) fail("offline_file_missing", relative);
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > maximum) { await reader.cancel(); fail("offline_file_limit", relative); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
export async function installPack(expectedPackHash, onProgress) {
  const manifest = JSON.parse(new TextDecoder().decode(await localBytes("manifest.json", PACK_LIMITS.metadata)));
  const verified = await verifyPack(manifest, { expectedPackHash, readBytes: localBytes, onProgress });
  installed = { manifest, verified }; return manifest;
}
function assetUrl(member, descriptor) {
  if (!installed) fail("offline_pack_not_verified");
  const reference = { componentSlug: member.reference.componentSlug, sourceSha256: member.reference.sha256,
    role: descriptor.role, sha256: descriptor.sha256 || descriptor.checksumSha256, extension: descriptor.extension };
  const asset = descriptor.extension ? installed.verified.logical.get(logicalAssetKey(reference))
    : [...installed.verified.logical.values()].find((asset) => asset.componentSlug === reference.componentSlug && asset.sourceSha256 === reference.sourceSha256 && asset.role === reference.role && asset.sha256 === reference.sha256);
  if (!asset) fail("offline_dependency_missing"); return url(asset.path);
}
export function resolveUltimateB2AuthoredAssetUrl(binding) {
  if (!installed) return null; // Module initialization occurs before verification; content is still disabled.
  const id = typeof binding === "string" ? binding : binding?.id;
  const asset = installed.verified.logical.get(installed.manifest.canonicalUi[id]);
  if (!asset) fail("offline_ui_dependency_missing", id); return url(asset.path);
}
export function offlineClassroom(componentSlug) {
  if (!installed) fail("offline_pack_not_verified");
  const { snapshot, selection } = installed.manifest;
  const member = snapshot.members.find((member) => member.reference.componentSlug === componentSlug);
  if (!member) fail("offline_component_missing");
  const context = Object.freeze({ kind: "published", bookSlug: selection.bookSlug, editionId: selection.editionId, releaseId: selection.releaseId,
    componentSlug, targetSource: member.reference, sourcePageIds: member.projection.pages.map((page) => page.id) });
  const publication = Object.freeze({ kind: "published", releaseId: selection.releaseId, bookSlug: selection.bookSlug, componentSlug, projection: member.projection, offlineMember: member });
  const delivery = Object.freeze({ assetUrl: (_publication, reference) => assetUrl(member, reference),
    async loadTeacher(_publication, activityId, { signal } = {}) { signal?.throwIfAborted(); const document = member.teacherDocuments[activityId]; if (!document) fail("offline_teacher_missing", activityId); return document; },
    teacherAssetUrl(_publication, activityId, sectionId) { const image = nativeTeacherAnswerImages(member.teacherDocuments[activityId]).find((image) => (image.sectionId || "") === (sectionId || "")); if (!image) fail("offline_teacher_asset_missing", activityId); return assetUrl(member, image.reference); },
  });
  const owner = snapshot.members[0];
  const check = (requested) => { for (const key of ["kind", "bookSlug", "editionId", "releaseId", "componentSlug", "targetSource", "sourcePageIds"]) if (stableJson(requested[key]) !== stableJson(context[key])) fail("offline_wordlist_context"); };
  const wordListProvider = Object.freeze({ context,
    async load(requested, { signal } = {}) { signal?.throwIfAborted(); check(requested); if (!member.wordlist) return { state: "unavailable", wordlist: null }; return { state: "ready", wordlist: member.wordlist }; },
    audioUrl(requested, sha256) { check(requested); if (!member.wordlist?.audio.some((asset) => asset.sha256 === sha256)) fail("offline_wordlist_audio_owner"); return assetUrl(member, { sha256, role: "wordlist_audio", extension: "mp3" }); },
  });
  return { context, projection: member.projection, publication, delivery, ui: snapshot.uiOwner.ui, ownerSource: owner.reference,
    uiAssetUrl: (asset) => assetUrl(owner, { ...asset, role: "teacher_ui" }), uiFontUrl: (asset) => assetUrl(owner, { ...asset, role: "activity_font", extension: "ttf" }),
    pageAssetUrl: (page) => assetUrl(member, page.image), wordListProvider };
}
export const publishedNativeAssetUrl = (publication, reference) => assetUrl(publication.offlineMember, reference);
export const publishedUnitExtraVideoUrl = publishedNativeAssetUrl;
export const publishedUnitExtraAudioUrl = publishedNativeAssetUrl;
export function usePublishedComponentRelease() { fail("offline_provider_required"); }
export function loadPublishedNativeTeacherDocument() { fail("offline_provider_required"); }
export function publishedNativeTeacherAssetUrl() { fail("offline_provider_required"); }
