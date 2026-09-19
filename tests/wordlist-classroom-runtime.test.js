import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { editionFixtureSources } from "./fixtures/content-editions.js";
import { lexicalFixture, wordListSha } from "./fixtures/wordlists.js";
import { freezeWordList, projectWordList, wordListObjectKey } from "../netlify-sites/ultimate-b2-builder/server/_builder-wordlist-domain.js";
import { loadWordList, wordListForPages, wordListPageCapability, wordListUrl } from "../src/data/wordlists/loader.js";
import { validateRuntimeWordList, validateWordListContext, wordListContextKey } from "../src/data/wordlists/runtime.js";
import { HOSTED_EDITABLE_UI_BINDINGS_BY_ID } from "../src/data/ultimate-b2/hostedTeacherUiBindingCatalog.js";
import { HISTORICAL_B2_UI_BINDING_IDS } from "../src/data/ultimate-b2/historicalTeacherUiBindings.js";
import { consumeClassroomBack, registerClassroomLayer } from "../src/components/wordlists/classroomLayers.js";

function fixture(editionId = "greek") {
  const target = editionFixtureSources(editionId)[0], sourceId = randomUUID(), dataset = lexicalFixture();
  const identity = { sourceId, bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", sha256: wordListSha };
  const record = freezeWordList({ sourceId, revision: 1, mappingRevision: 1, target, dataset,
    mappings: [{ group: "unit1_1", pageIds: target.content.publicProjection.pages.slice(0, 2).map((page) => page.id) }],
    bindings: [{ ...dataset.audio[0], ...identity, assetId: randomUUID(), role: "wordlist_audio", storageBucket: "isolated-wordlists", objectKey: wordListObjectKey(identity) }] });
  const context = { kind: "candidate", bookSlug: "ultimate-b2", componentSlug: identity.componentSlug, editionId, releaseId: randomUUID(), targetSource: target.reference,
    sourcePageIds: target.content.publicProjection.pages.map((page) => page.id), pageIds: record.mappings[0].pageIds };
  return { context, wordlist: projectWordList(record, editionId) };
}
test("runtime rejects mismatched source, language policy, page, audio and unrecognized fields", () => {
  const { context, wordlist } = fixture(); assert.equal(validateRuntimeWordList(wordlist, context), wordlist);
  for (const change of [
    (value) => { value.targetSource.revision++; }, (value) => { value.targetSource.sha256 = "f".repeat(64); },
    (value) => { value.policy.languages = ["en"]; }, (value) => { value.entries[0].audioSha256 = "f".repeat(64); },
    (value) => { value.entries[1].id = value.entries[0].id; }, (value) => { value.entries.reverse(); },
    (value) => { value.entries[0].answer = "private"; }, (value) => { value.audio[0].role = "native_teacher_answer"; },
    (value) => { value.audio[0].byteSize = -1; }, (value) => { value.mappings[0].pageIds = ["foreign-page"]; },
  ]) { const invalid = structuredClone(wordlist); change(invalid); assert.throws(() => validateRuntimeWordList(invalid, context)); }
  assert.throws(() => validateWordListContext({ ...context, pageIds: ["foreign"] }));
  assert.throws(() => validateWordListContext({ ...context, pageIds: [context.pageIds[0], context.pageIds[0]] }));
  assert.throws(() => validateWordListContext({ ...context, kind: "current-head" }));
  const international = fixture("international"); assert.equal(validateRuntimeWordList(international.wordlist, international.context), international.wordlist);
  international.wordlist.entries[0].translations.el = "leak";
  assert.throws(() => validateRuntimeWordList(international.wordlist, international.context));
});
test("page pairs retain lexical occurrence order and distinct duplicate headwords", () => {
  const { context, wordlist } = fixture();
  assert.deepEqual(wordListForPages(wordlist, context.pageIds).map((entry) => entry.id), ["entry-000001", "entry-000002"]);
  assert.deepEqual(wordListForPages(wordlist, [...context.pageIds].reverse()), wordlist.entries);
  assert.equal(wordListPageCapability({ context, wordlist, componentSlug: context.componentSlug, pageIds: context.pageIds, surface: "activity" }).state, "ready");
  assert.equal(wordListPageCapability({ wordlist, componentSlug: context.componentSlug, pageIds: [context.sourcePageIds[3]], surface: "page" }).state, "empty");
  for (const surface of ["overview", "library", "standalone"]) assert.equal(wordListPageCapability({ wordlist, componentSlug: context.componentSlug, pageIds: context.pageIds, surface }).state, "unavailable");
  wordlist.entries[0].english.word = false; validateRuntimeWordList(wordlist, context);
});
test("ephemeral identity changes for every source/release/mapping/page scope but not display surface", () => {
  const { context, wordlist } = fixture(), key = wordListContextKey(context, wordlist);
  assert.equal(key, wordListContextKey({ ...context, surface: "activity" }, wordlist));
  for (const changed of [{ ...context, kind: "published" }, { ...context, releaseId: randomUUID() }, { ...context, pageIds: context.pageIds.slice(0, 1) },
    { ...context, targetSource: { ...context.targetSource, revision: context.targetSource.revision + 1 } }]) assert.notEqual(key, wordListContextKey(changed, wordlist));
  for (const field of ["revision", "mappingRevision"]) assert.notEqual(key, wordListContextKey(context, { ...wordlist, [field]: wordlist[field] + 1 }));
  assert.notEqual(key, wordListContextKey(context, { ...wordlist, sourceSha256: "f".repeat(64) }));
  assert.match(wordListUrl({ ...context, kind: "draft" }), /sourceRevision=1/);
  assert.match(wordListUrl({ ...context, kind: "published" }), /contract=edition-release.v2/);
});
test("loader rejects mismatched response envelopes and propagates cancellation", async (t) => {
  const { context, wordlist } = fixture(); const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const payload = { edition: { bookSlug: context.bookSlug, editionId: context.editionId }, releaseId: context.releaseId, wordlist };
  globalThis.fetch = async () => new Response(JSON.stringify(payload)); assert.equal((await loadWordList(context)).state, "ready");
  payload.releaseId = randomUUID(); await assert.rejects(loadWordList(context), /context_mismatch/);
  globalThis.fetch = async () => new Response("{}", { status: 403 }); assert.equal((await loadWordList(context)).state, "unavailable");
  const signal = AbortSignal.abort(); globalThis.fetch = async (_url, options) => { assert.equal(options.signal, signal); signal.throwIfAborted(); };
  await assert.rejects(loadWordList(context, { signal }), { name: "AbortError" });
});
test("Vocabulary controls extend the current per-book catalog without changing historical binding descriptors", async () => {
  for (const state of ["active", "disabled", "pressed"]) {
    const id = `navibar.vocabulary.${state}`; assert(HOSTED_EDITABLE_UI_BINDINGS_BY_ID[id]); assert(!HISTORICAL_B2_UI_BINDING_IDS.includes(id));
  }
  assert.equal(new Set(HISTORICAL_B2_UI_BINDING_IDS).size, HISTORICAL_B2_UI_BINDING_IDS.length);
  const wrapper = await readFile("src/apps/android-teacher-offline/TeacherOfflinePages.jsx", "utf8");
  const shared = await readFile("src/apps/android-teacher-offline/TeacherClassroomPages.jsx", "utf8");
  assert.match(wrapper, /TeacherClassroomPages/); assert.match(wrapper, /ActivityRenderer=\{TeacherOfflineEmbeddedActivity\}/);
  assert.match(shared, /<ActivityRenderer/); assert.match(shared, /<WordListOverlay key=\{wordlist.key\}/);
});
test("Android Back consumes the last connected open classroom layer and unregisters on exit", () => {
  const first = { isConnected: true }, second = { isConnected: true }, closed = [];
  const one = registerClassroomLayer(first, () => closed.push("first")), two = registerClassroomLayer(second, () => closed.push("second"));
  try {
    assert.equal(consumeClassroomBack(), true); assert.deepEqual(closed, ["second"]);
    two(); assert.equal(consumeClassroomBack(), true); assert.deepEqual(closed, ["second", "first"]);
    first.isConnected = false; assert.equal(consumeClassroomBack(), false);
  } finally { one(); two(); }
  assert.equal(consumeClassroomBack(), false);
});
