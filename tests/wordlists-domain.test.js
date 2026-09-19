import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { contentEdition } from "../src/data/contentEditions.js";
import { editionFixtureSources, editionFixtureRelease } from "./fixtures/content-editions.js";
import { lexicalFixture, wordListSha } from "./fixtures/wordlists.js";
import { freezeWordList, projectWordList, prepareWordListEdition, verifyWordListEdition, wordListEditionPublic,
  wordListObjectKey } from "../netlify-sites/ultimate-b2-builder/server/_builder-wordlist-domain.js";
import { verifyEditionRelease } from "../netlify-sites/ultimate-b2-builder/server/_builder-edition-domain.js";
import { wordListForPages } from "../src/data/wordlists/loader.js";

export function wordListRecord(target, mappings) {
  const dataset = lexicalFixture(); const sourceId = randomUUID();
  const identity = { sourceId, bookSlug: target.reference.bookSlug, componentSlug: target.reference.componentSlug, sha256: wordListSha };
  const bindings = [{ ...dataset.audio[0], sourceId, bookSlug: identity.bookSlug, componentSlug: identity.componentSlug,
    assetId: randomUUID(), role: "wordlist_audio", storageBucket: "isolated-wordlists", objectKey: wordListObjectKey(identity) }];
  return freezeWordList({ sourceId, revision: 1, mappingRevision: 1, target, dataset, bindings,
    mappings: mappings || [{ group: target.reference.componentSlug.endsWith("workbook") ? "work1_1" : "unit1_1", pageIds: [target.content.publicProjection.pages[0].id] }] });
}
test("Word List v2 binds mapping, policy, owned audio and complete content while v1 remains verifiable", () => {
  const sources = editionFixtureSources("international"); const records = sources.slice(0, 2).map((source) => wordListRecord(source));
  assert.notEqual(records[0].bindings[0].objectKey, records[1].bindings[0].objectKey);
  const edition = contentEdition("ultimate-b2", "international");
  const release = prepareWordListEdition({ id: randomUUID(), number: 1, edition, sources, wordlists: records });
  assert.deepEqual(verifyWordListEdition(release, edition), release);
  const json = JSON.stringify(wordListEditionPublic(release, edition));
  assert(!json.includes("ΕΛΛΗΝΙΚΟ_SENTINEL")); assert(!json.includes('"provenance"')); assert(!json.includes('"sound"'));
  assert.equal(projectWordList(records[0], "greek").entries[0].translations.el, "ΕΛΛΗΝΙΚΟ_SENTINEL");
  assert.deepEqual(verifyEditionRelease(editionFixtureRelease("international")), editionFixtureRelease("international"));
  const projected = projectWordList(records[0], "international");
  assert.equal(wordListForPages(projected, records[0].mappings[0].pageIds).length, 2);
  assert.equal(wordListForPages(projected, ["missing-page"]).length, 0);
  const pair = wordListRecord(sources[0], [{ group: "unit1_1", pageIds: sources[0].content.publicProjection.pages.slice(0, 2).map((page) => page.id) }]);
  assert.equal(wordListForPages(projectWordList(pair, "international"), pair.mappings[0].pageIds).length, 2, "Page pairs never duplicate lexical occurrences");
  const changed = structuredClone(release); changed.wordlists[0].dataset.entries[0].english.word = "changed";
  assert.throws(() => verifyWordListEdition(changed, edition), /integrity/);
  assert.throws(() => prepareWordListEdition({ id: randomUUID(), number: 2, edition, sources: sources.slice(0, 2), wordlists: records }));
});
test("unresolved authoring stays draft; invalid pages and foreign component bindings fail closed", () => {
  const target = editionFixtureSources("greek")[1]; const record = wordListRecord(target, [{ group: "work1_1", pageIds: [] }]);
  const input = { ...record, target };
  assert.throws(() => freezeWordList(input, { ready: true }), /unresolved/);
  assert.throws(() => freezeWordList({ ...input, mappings: [{ group: "work1_1", pageIds: ["deleted-or-foreign-page"] }] }), /page_context/);
  const bindings = structuredClone(record.bindings); bindings[0].componentSlug = "ultimate-b2-students-book";
  assert.throws(() => freezeWordList({ ...input, bindings }), /audio_owner/);
});
