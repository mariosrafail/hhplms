// Additional opt-in local publisher acceptance. Required CI uses only synthetic
// tracked inputs; this module never reads publisher installations or profiles.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { componentGroups, verifyPortable } from "../../src/data/wordlists/portable.js";
import { requiredWordListAudio, projectWordList } from "../../netlify-sites/ultimate-b2-builder/server/_builder-wordlist-domain.js";
import { loadWordList } from "../../netlify-sites/ultimate-b2-builder/server/_builder-wordlist-store.js";

export async function exerciseFullWordListSource({ directory, sql, call, sources, assertPreserved }) {
  const dataset = await verifyPortable(JSON.parse(await readFile(path.join(directory, "wordlist.json"), "utf8")));
  const results = [];
  for (const component of ["students-book", "workbook"]) {
    const componentSlug = `ultimate-b2-${component}`;
    const target = sources.find((source) => source.reference.componentSlug === componentSlug);
    const current = await loadWordList(sql, target.reference.sourceId);
    const base = `international/components/${componentSlug}`; const id = randomUUID();
    const body = { clientMutationId: id, sourceId: current.id, expectedRevision: Number(current.revision), targetSource: target.reference,
      dataset, mappings: componentGroups(dataset, componentSlug).map((group) => ({ group, pageIds: [] })) };
    const begin = await call(`${base}/begin`, body); assert.equal(begin.status, 200, JSON.stringify(begin));
    const required = requiredWordListAudio(dataset, componentSlug);
    for (const [index, descriptor] of required.entries()) {
      const bytes = await readFile(path.join(directory, descriptor.path));
      const uploaded = await call(`${base}/upload/${id}`, null, { bytes, query: { sha256: descriptor.sha256, clientMutationId: randomUUID() } });
      assert.equal(uploaded.status, 200, JSON.stringify(uploaded));
      if ((index + 1) % 250 === 0) console.log(`Full Word List ${component}: ${index + 1}/${required.length} audio verified.`);
    }
    const final = await call(`${base}/finalize/${id}`, { clientMutationId: randomUUID() }); assert.equal(final.status, 200, JSON.stringify(final));
    const record = (await loadWordList(sql, target.reference.sourceId)).record;
    assert.equal(record.dataset.datasetSha256, dataset.datasetSha256); assert.equal(record.dataset.entries.length, dataset.entries.length);
    assert.equal(record.bindings.length, required.length); assert(record.mappings.every((mapping) => mapping.pageIds.length === 0));
    assert(projectWordList(record, "international").entries.every((entry) => Object.keys(entry.translations).length === 0));
    assert(projectWordList(record, "greek").entries.every((entry) => Object.hasOwn(entry.translations, "el")));
    await assertPreserved(); results.push({ componentSlug, entries: projectWordList(record, "international").entries.length,
      bindings: record.bindings.length, unresolvedGroups: record.mappings.length });
    const reimport = { ...body, clientMutationId: randomUUID(), expectedRevision: record.revision };
    assert.equal((await call(`${base}/begin`, reimport)).status, 200);
    const repeat = await call(`${base}/finalize/${reimport.clientMutationId}`, { clientMutationId: randomUUID() }); assert.equal(repeat.value.outcome, "unchanged");
  }
  assert.equal((await call("international/prepare", { clientMutationId: randomUUID(), expectedRevision: 3 })).value.error, "wordlist_mapping_unresolved");
  console.log(JSON.stringify({ fullSourceAcceptance: true, datasetSha256: dataset.datasetSha256, datasetEntries: dataset.entries.length, distinctAudio: dataset.audio.length,
    components: results, realPageMappingsInvented: 0, hostedChanges: 0 }));
}
