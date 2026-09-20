import { contentEdition, normalizeContentSourceReference, requireEditionUuid } from "../contentEditions.js";
import { stableJson, exact, shaPattern } from "../wordlists/portable.js";
import { validateRuntimeWordList } from "../wordlists/runtime.js";

export const PACK_SCHEMA = "offline-edition-pack.v1";
export const PACK_RUNTIME = "edition-classroom.v1";
export const PACK_WEB_ROOT = "assets/edition-pack";
export const PACK_LIMITS = Object.freeze({ metadata: 32 * 1024 * 1024, file: 512 * 1024 * 1024, total: 8 * 1024 ** 3, files: 30000 });
export const nativeKinds = new Set(["multi-part", "image", "open-response", "single-choice", "complete-sentences", "listening", "oldschool-listening", "drag-drop", "mark-the-words"]);
const roles = new Set(["open_response_artwork", "activity_artwork", "activity_font", "native_teacher_answer", "managed_page_image", "canonical_page_image", "unit_extra_video", "unit_extra_audio", "teacher_ui", "wordlist_audio", "canonical_ui"]);
export function fail(code, context = "") { throw new Error(`${code}${context ? `: ${context}` : ""}`); }
export function safePackPath(value) {
  if (typeof value !== "string" || value.length > 240 || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value)
    || value.split("/").some((part) => !part || part === "." || part === ".." || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) fail("offline_path_unsafe");
  return value;
}
export async function digest(bytes) {
  const result = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), (n) => n.toString(16).padStart(2, "0")).join("");
}
export const semanticHash = (value) => digest(new TextEncoder().encode(stableJson(value)));
const equal = (a, b, code) => { if (stableJson(a) !== stableJson(b)) fail(code); };
export function validateSelection(selection) {
  exact(selection, ["bookSlug", "editionId", "audience", "releaseId", "contract", "releaseSha256", "compositionSha256"]);
  contentEdition(selection.bookSlug, selection.editionId); requireEditionUuid(selection.releaseId);
  if (selection.audience !== "teacher" || selection.contract !== "edition-release.v2" || !shaPattern.test(selection.releaseSha256) || !shaPattern.test(selection.compositionSha256)) fail("offline_selection_invalid");
  return selection;
}
export function assertSnapshot(snapshot, selection) {
  validateSelection(selection);
  exact(snapshot, ["schemaVersion", "bookSlug", "editionId", "audience", "source", "uiOwner", "members"]);
  if (snapshot.schemaVersion !== "offline-edition-snapshot.v1") fail("offline_snapshot_version");
  for (const key of ["bookSlug", "editionId", "audience"]) equal(snapshot[key], selection[key], "offline_selection_mismatch");
  exact(snapshot.source, ["contract", "id", "state", "number", "releaseSha256", "compositionSha256", "contentReleaseSha256", "composition"]);
  for (const [field, expected] of Object.entries({ contract: selection.contract, id: selection.releaseId, state: "published", releaseSha256: selection.releaseSha256, compositionSha256: selection.compositionSha256 })) equal(snapshot.source[field], expected, "offline_release_mismatch");
  const edition = contentEdition(selection.bookSlug, selection.editionId);
  const expectedComponents = ["students-book", "workbook", "grammar-book"].map((name) => `${selection.bookSlug}-${name}`);
  if (!Array.isArray(snapshot.members) || snapshot.members.length !== 3) fail("offline_composition_incomplete");
  snapshot.members.forEach((member, index) => {
    exact(member, ["reference", "compilerId", "releaseSchemaVersion", "releaseSha256", "projection", "teacherDocuments", "assets", "wordlist"]);
    normalizeContentSourceReference(member.reference, { edition, componentSlug: expectedComponents[index] });
    equal(member.reference, snapshot.source.composition.members[index], "offline_source_mismatch");
    const p = member.projection;
    if (p.bookSlug !== selection.bookSlug || p.componentSlug !== expectedComponents[index] || !p.pages?.length || !p.units?.length) fail("offline_component_incomplete", expectedComponents[index]);
    const pageIds = p.pages.map((page) => page.id);
    const descriptorFor = (reference) => member.assets.find((asset) => asset.sha256 === (reference.sha256 || reference.checksumSha256) && asset.role === reference.role);
    const assertReferences = (value) => {
      if (!value || typeof value !== "object") return;
      if (value.role && (value.checksumSha256 || value.sha256) && !descriptorFor(value)) fail("offline_dependency_missing", `${expectedComponents[index]}/${value.role}/${value.checksumSha256 || value.sha256}`);
      for (const child of Object.values(value)) assertReferences(child);
    };
    assertReferences(p); assertReferences(member.teacherDocuments);
    if (new Set(pageIds).size !== pageIds.length) fail("offline_pages_invalid");
    for (const [id, entry] of Object.entries(p.nativeActivities || {})) {
      if (!nativeKinds.has(entry.kind)) fail("offline_activity_unsupported", id);
      if (entry.document?.activityId !== id || !pageIds.includes(entry.document.placement?.pageId) || member.teacherDocuments[id]?.activityId !== id) fail("offline_activity_incomplete", id);
    }
    for (const [pageId, actions] of Object.entries(p.hotspots?.pages || {})) {
      if (!pageIds.includes(pageId)) fail("offline_page_unknown", pageId);
      for (const action of actions) if (action.actionType !== "normalized_activity" || !p.nativeActivities[action.activityKey]) fail("offline_action_unsupported", action.id);
    }
    if (Object.keys(member.teacherDocuments).some((id) => !p.nativeActivities[id])) fail("offline_teacher_document_foreign");
    for (const ids of Object.values(p.activityOrder || {})) for (const id of ids) if (!p.nativeActivities[id]) fail("offline_activity_unsupported", id);
    if (index < 2) {
      const context = { kind: "published", ...selection, componentSlug: expectedComponents[index], targetSource: member.reference, sourcePageIds: pageIds };
      validateRuntimeWordList(member.wordlist, context);
      const unresolved = member.wordlist.mappings.filter((mapping) => !mapping.pageIds.length);
      if (unresolved.length) fail("offline_mappings_unresolved", `${expectedComponents[index]} (${unresolved.map((m) => m.group).join(", ")})`);
      if (!member.wordlist.entries.length) fail("offline_wordlist_incomplete", expectedComponents[index]);
    } else if (member.wordlist !== null) fail("offline_grammar_wordlist_invalid");
  });
  exact(snapshot.uiOwner, ["reference", "ui"]);
  equal(snapshot.uiOwner.reference, snapshot.members[0].reference, "offline_ui_owner_mismatch");
  for (const asset of Object.values(snapshot.uiOwner.ui.assets)) if (!snapshot.members[0].assets.some((entry) => entry.role === "teacher_ui" && entry.sha256 === asset.sha256 && entry.extension === asset.extension)) fail("offline_ui_dependency_missing");
  const font = snapshot.uiOwner.ui.overviewCaptionFontAsset;
  if (font && !snapshot.members[0].assets.some((asset) => asset.role === "activity_font" && asset.sha256 === font.checksumSha256)) fail("offline_ui_font_missing");
  return snapshot;
}
export function logicalAssetKey(asset) { return `${asset.componentSlug}/${asset.sourceSha256}/${asset.role}/${asset.sha256}.${asset.extension}`; }
export function requiredAssets(snapshot) {
  const result = [];
  for (const member of snapshot.members) {
    const context = { componentSlug: member.reference.componentSlug, sourceSha256: member.reference.sha256 };
    for (const asset of member.assets) result.push({ ...asset, ...context });
    for (const asset of member.wordlist?.audio || []) result.push({ sha256: asset.sha256, mediaType: asset.mediaType, extension: "mp3", role: asset.role, ...context });
  }
  return result;
}
export async function verifyPack(manifest, { expectedPackHash, readBytes, onProgress = () => {} } = {}) {
  exact(manifest, ["schemaVersion", "runtime", "selection", "snapshot", "canonicalUi", "assets", "packSha256"]);
  if (manifest.schemaVersion !== PACK_SCHEMA || manifest.runtime !== PACK_RUNTIME) fail("offline_pack_version");
  const { packSha256, ...identity } = manifest;
  if (!shaPattern.test(packSha256) || expectedPackHash && packSha256 !== expectedPackHash || await semanticHash(identity) !== packSha256) fail("offline_pack_integrity");
  assertSnapshot(manifest.snapshot, manifest.selection);
  const composition = manifest.snapshot.source.composition;
  if (await semanticHash(composition) !== manifest.selection.compositionSha256) fail("offline_composition_integrity");
  for (let index = 0; index < 2; index++) {
    const wordlist = manifest.snapshot.members[index].wordlist;
    equal(composition.wordlists[index], { sourceId: wordlist.sourceId, revision: wordlist.revision, sha256: wordlist.sourceSha256,
      mappingRevision: wordlist.mappingRevision, projectionSha256: await semanticHash(wordlist) }, "offline_lexical_identity");
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length > PACK_LIMITS.files) fail("offline_inventory_limit");
  const logical = new Map(), files = new Map(); let total = 0;
  for (const asset of manifest.assets) {
    exact(asset, ["componentSlug", "sourceSha256", "role", "sha256", "extension", "mediaType", "byteSize", "path"]);
    if (!roles.has(asset.role) || !shaPattern.test(asset.sha256) || !Number.isSafeInteger(asset.byteSize) || asset.byteSize < 1 || asset.byteSize > PACK_LIMITS.file) fail("offline_asset_invalid");
    safePackPath(asset.path);
    const owner = manifest.snapshot.members.find((member) => member.reference.componentSlug === asset.componentSlug && member.reference.sha256 === asset.sourceSha256);
    if (!owner) fail("offline_asset_owner");
    if (asset.path !== `assets/${asset.sha256}.${asset.extension}`) fail("offline_asset_path");
    const key = logicalAssetKey(asset); if (logical.has(key)) fail("offline_asset_duplicate"); logical.set(key, asset);
    if (files.has(asset.path)) equal([asset.sha256, asset.byteSize, asset.mediaType], [files.get(asset.path).sha256, files.get(asset.path).byteSize, files.get(asset.path).mediaType], "offline_asset_collision");
    else { files.set(asset.path, asset); total += asset.byteSize; }
  }
  if (total > PACK_LIMITS.total) fail("offline_inventory_limit");
  const expected = new Set();
  for (const descriptor of requiredAssets(manifest.snapshot)) {
    const key = logicalAssetKey(descriptor); const owned = logical.get(key);
    if (!owned || owned.mediaType !== descriptor.mediaType) fail("offline_dependency_missing", key);
    expected.add(key);
  }
  for (const [id, key] of Object.entries(manifest.canonicalUi)) {
    if (!/^[a-zA-Z0-9._-]+$/.test(id) || !logical.has(key) || logical.get(key).role !== "canonical_ui" || logical.get(key).componentSlug !== manifest.snapshot.uiOwner.reference.componentSlug) fail("offline_ui_dependency_missing", id);
    expected.add(key);
  }
  for (const state of ["active", "disabled", "pressed"]) if (!manifest.canonicalUi[`navibar.vocabulary.${state}`]) fail("offline_vocabulary_artwork_missing");
  if (expected.size !== logical.size) fail("offline_inventory_unexpected");
  let count = 0;
  if (readBytes) for (const [file, asset] of files) {
    const bytes = await readBytes(file, asset.byteSize);
    if (bytes.byteLength !== asset.byteSize || await digest(bytes) !== asset.sha256) fail("offline_asset_integrity", file);
    onProgress(++count, files.size);
  }
  return { files, logical, totalBytes: total, packSha256 };
}
