import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_SOURCE_SCHEMA, EDITION_COMPOSITION_SCHEMA, contentEdition,
  contentEditionBooks, normalizeContentEdition, normalizeContentSourceReference,
  normalizeEditionComposition, findContentEditionBook,
} from "../src/data/contentEditions.js";

const book = "ultimate-b2";
const shared = { kind: "shared", editionIds: ["international", "greek"] };
const scoped = (editionId) => ({ kind: "edition", editionIds: [editionId] });
const reference = (index, scope = shared) => ({
  schemaVersion: CONTENT_SOURCE_SCHEMA,
  sourceId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  bookSlug: book, componentSlug: contentEditionBooks[book].components[index],
  scope: structuredClone(scope), revision: 1, sha256: "a".repeat(64),
});
const composition = (editionId) => ({
  schemaVersion: EDITION_COMPOSITION_SCHEMA, edition: contentEdition(book, editionId),
  members: [reference(0), reference(1), reference(2, scoped(editionId))],
});
test("content editions are explicitly available only for the B2 pilot, independent of role and language", () => {
  assert.notDeepEqual(contentEdition(book, "international"), contentEdition(book, "greek"));
  for (const slug of ["ultimate-b1", "ultimate-b1-plus", "unknown", "toString", "__proto__"]) {
    assert.equal(findContentEditionBook(slug), null);
    assert.throws(() => contentEdition(slug, "greek"), { code: "content_edition_unavailable" });
  }
  for (const id of [undefined, null, "", "el", "teacher", "student", "Greek"]) assert.throws(() => contentEdition(book, id));
  for (const field of ["language", "role", "showTranslations"]) assert.throws(() => normalizeContentEdition({ ...contentEdition(book, "greek"), [field]: "el" }));
  assert.equal(contentEditionBooks[book].wordListOperational, false);
  assert.equal(contentEditionBooks[book].uiOwnerComponentSlug, "ultimate-b2-students-book");
});
test("both editions select explicit shared SB/WB revisions and their own whole Grammar source", () => {
  const international = normalizeEditionComposition(composition("international"));
  const greek = normalizeEditionComposition(composition("greek"));
  assert.deepEqual(international.members.slice(0, 2), greek.members.slice(0, 2));
  assert.notDeepEqual(international.members[2].scope, greek.members[2].scope);
  const input = composition("greek");
  const frozen = normalizeEditionComposition(input);
  input.members[0].scope.editionIds.push("unsupported");
  assert.deepEqual(frozen.members[0].scope.editionIds, ["international", "greek"]);
  assert.throws(() => { frozen.members[2].revision = 2; }, TypeError);
});
test("unknown, cross-book, cross-component and cross-edition source substitutions fail even with identical checksums", () => {
  const requested = { edition: contentEdition(book, "international"), componentSlug: reference(2).componentSlug };
  assert.throws(() => normalizeContentSourceReference(reference(2, scoped("greek")), requested), { code: "edition_source_owner_mismatch" });
  for (const patch of [
    { bookSlug: "ultimate-b1" }, { componentSlug: "ultimate-b1-students-book" },
    { sourceId: "invalid" }, { revision: 0 }, { sha256: "" },
    { scope: { kind: "shared", editionIds: ["greek"] } },
    { scope: { kind: "edition", editionIds: ["international", "greek"] } },
  ]) assert.throws(() => normalizeContentSourceReference({ ...reference(0), ...patch }));
  assert.throws(() => normalizeContentSourceReference(reference(1), { ...requested, componentSlug: reference(0).componentSlug }));
  assert.throws(() => normalizeContentSourceReference({ ...reference(0), translation: "Greek text" }));
});
test("readiness requires every component in canonical order without borrowing missing Grammar", () => {
  const value = composition("international");
  value.members.pop();
  assert.throws(() => normalizeEditionComposition(value), { code: "edition_required_sources_missing" });
  value.members.push(reference(2, scoped("greek")));
  assert.throws(() => normalizeEditionComposition(value), { code: "edition_source_owner_mismatch" });
  value.members = [reference(1), reference(0), reference(2)];
  assert.throws(() => normalizeEditionComposition(value));
});
