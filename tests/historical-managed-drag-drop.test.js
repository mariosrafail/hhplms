import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { builderDocumentSha256, stableBuilderJson, assertPublicBuilderDocument } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { compileUltimateB2ManagedComponentRelease, verifyUltimateB2ManagedComponentRelease, normalizeManagedPublicProjection, normalizeManagedTeacherProjection } from "../netlify-sites/ultimate-b2-builder/server/_builder-managed-publication-compiler.js";
import { verifyImmutableComponentRelease } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { managedDragDropSources, managedDragDropReleaseRow } from "./fixtures/managed-drag-drop.js";

const grammar = "ultimate-b2-grammar-book", workbook = "ultimate-b2-workbook";
const pins = {
  "historical-managed-drag-drop-original-grammar.json": "1fbb5a28c7c8218d4338d63f7872a4b521e6eeca9ca5618a5cf3005af969a0bd",
  "historical-managed-drag-drop-original-workbook.json": "c90e6e2770d161ef27b71cc459bc73b7248803c2b81bb7decef2ff64dad12e30",
  "historical-managed-drag-drop-presentation-grammar.json": "5e01d49aaf218e640bfff3da5c121c03875851876b964dc5f28246ae556d8ca2",
  "historical-managed-drag-drop-presentation-workbook.json": "ba05d19cc91c8c22e2fca89d1b6424a5790cb71b10bcb3a99f9907d1cd848a86",
  "historical-managed-drag-drop-multiline-grammar.json": "9493f38068b82b00faef453dcc2a74d1c7ac771106ea472893e85ed8ccae43c6",
  "historical-managed-drag-drop-multiline-workbook.json": "c48d6cc5c61908ed8b35d232fbf60c2088825ef9a022a00bad4dc7b5afefcc6a",
  "historical-managed-drag-drop-rich-grammar.json": "0668b3c71468b75969a049ee90ac48a8a02dceb679a17e83b0e395b95b49c3dc",
  "historical-managed-drag-drop-rich-workbook.json": "cf0bac0c995fdbc00246aaa4afb0e450c0f7b91fed1727a9c9beb3b3e1c96cf6"
};
function fixture(epoch = "original", component = grammar) {
  return JSON.parse(readFileSync(new URL(`./fixtures/historical-managed-drag-drop-${epoch}-${component === grammar ? "grammar" : "workbook"}.json`, import.meta.url), "utf8"));
}
const publicDocument = (row) => Object.values(row.public_projection.nativeActivities)[0].document;
const teacherDocument = (row) => Object.values(row.teacher_projection.nativeActivities)[0].document;
const interaction = (row) => publicDocument(row).parts[0].interaction;
const solution = (row) => teacherDocument(row).parts[0].solution;
function rehash(row) {
  for (const name of ["source_snapshot", "public_projection", "teacher_projection"]) row[`${name}_sha256`] = builderDocumentSha256(row[name]);
  row.release_sha256 = builderDocumentSha256({ compatibility: row.runtime_compatibility_sha256, sourceSnapshot: row.source_snapshot, publicProjection: row.public_projection, teacherProjection: row.teacher_projection });
  return row;
}
const reject = (row) => assert.throws(() => verifyUltimateB2ManagedComponentRelease(row, grammar), /release_integrity_failed|publication_compiler_mismatch/);

for (const [file, hash] of Object.entries(pins)) {
  test(`frozen ${file}: exact immutable identity and common reader`, () => {
    const bytes = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8");
    const row = JSON.parse(bytes), before = structuredClone(row);
    assert.equal(builderDocumentSha256(row), hash);
    const result = verifyUltimateB2ManagedComponentRelease(row, row.public_projection.componentSlug);
    assert.deepEqual(result.publicProjection, row.public_projection);
    assert.deepEqual(result.teacherProjection, row.teacher_projection);
    assert.equal(builderDocumentSha256({ compatibility: result.compatibility, sourceSnapshot: result.sourceSnapshot, publicProjection: result.publicProjection, teacherProjection: result.teacherProjection }), row.release_sha256);
    assert.doesNotThrow(() => verifyImmutableComponentRelease(row));
    assert.deepEqual(row, before);
    assert.equal(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8"), bytes);
    assertPublicBuilderDocument(result.publicProjection);
    assert.equal(/"(?:wordId|wordIds|mappings|solution)"/.test(stableBuilderJson(result.publicProjection)), false);
  });
}

for (const component of [grammar, workbook]) {
  test(`current ${component}: rich compile identity remains unchanged`, () => {
    const source = managedDragDropSources(component, { font: true, multiline: true });
    const compiled = compileUltimateB2ManagedComponentRelease(source, component);
    const row = managedDragDropReleaseRow(compiled);
    const historicalRich = fixture("rich", component);
    // Frozen with the unchanged 85a99c5a compiler before this verifier change.
    const baselinePins = {"ultimate-b2-grammar-book": "773a95d559374bdaa01e737fd0ae6033be05202eaa4dd5f0660a812f57573207", "ultimate-b2-workbook": "d4e6165cf1adcd4b3eb2d6183fddbc1af33d3e1432ab4aeaa02a2b45bc2dd523"};
    assert.equal(builderDocumentSha256(row), baselinePins[component]);
    // activityOrder was added later, independently of Drag & Drop. The documents
    // still match the independently compiled rich-era canonical artifacts exactly.
    assert.deepEqual(row.public_projection.nativeActivities, historicalRich.public_projection.nativeActivities);
    assert.deepEqual(row.teacher_projection.nativeActivities, historicalRich.teacher_projection.nativeActivities);
    assert.equal(row.runtime_compatibility_sha256, historicalRich.runtime_compatibility_sha256);
    const rich = interaction(row);
    assert.deepEqual(Object.keys(rich).sort(), ["kind", "words", "presentation", "panels", "layoutMode", "answerBankHeightPx", "textPanelHeightPx"].sort());
    assert.equal(rich.words[0].reusable, false);
    assert.equal(rich.words[0].shortLabel, "A");
    assert.equal(rich.panels[0].dropTargets[0].capacity, 1);
    assert.ok(Array.isArray(solution(row).mappings[0].wordIds));
    assert.deepEqual(verifyUltimateB2ManagedComponentRelease(row, component).publicProjection, compiled.publicProjection);
  });
}

test("current authoring normalizers still insert current defaults for historical inputs", () => {
  const row = fixture();
  const pub = normalizeManagedPublicProjection(row.public_projection, grammar);
  const teacher = normalizeManagedTeacherProjection(row.teacher_projection, grammar, pub);
  assert.notEqual(builderDocumentSha256(pub), row.public_projection_sha256);
  assert.notEqual(builderDocumentSha256(teacher), row.teacher_projection_sha256);
  assert.equal(Object.values(pub.nativeActivities)[0].document.parts[0].interaction.words[0].shortLabel, "A");
});

for (const epoch of ["original", "presentation", "multiline"]) {
  for (const [name, mutate] of [
    ["unknown compatibility", (r) => { r.runtime_compatibility_sha256 = r.public_projection.compatibility = "f".repeat(64); }],
    ["source", (r) => { r.source_snapshot.pages.revision++; }],
    ["public", (r) => { interaction(r).words[0].text = "Changed"; }],
    ["Teacher", (r) => { solution(r).mappings[0].wordId = interaction(r).words[1].id; }],
    ["manifest", (r) => { r.asset_manifest[0].sha256 = "f".repeat(64); }],
    ["aggregate", (r) => { r.release_sha256 = "f".repeat(64); }],
    ["component", (r) => { r.public_projection.componentSlug = workbook; }],
    ["compiler", (r) => { r.compiler_id = "ultimate-b2-workbook-v1"; }],
  ]) test(`${epoch} rejects ${name} tampering`, () => { const row = fixture(epoch); mutate(row); reject(row); });
}

for (const [name, mutate] of [
  ["unknown compatibility even after rehash", (r) => { r.runtime_compatibility_sha256 = r.public_projection.compatibility = "f".repeat(64); }],
  ["partial current word", (r) => { interaction(r).words[0].reusable = false; }],
  ["partial current target", (r) => { interaction(r).panels[0].dropTargets[0].capacity = 1; }],
  ["partial layout", (r) => { interaction(r).layoutMode = "standard"; }],
  ["unknown word field", (r) => { interaction(r).words[0].futureFormat = true; }],
  ["unrecognized original multiline", (r) => { interaction(r).words[0].text = "one\ntwo"; }],
  ["unrecognized original multiline metadata", (r) => { publicDocument(r).metadata.visibleInstructionText = "one\ntwo"; }],
  ["historical public with rich Teacher", (r) => { const m = solution(r).mappings[0]; m.wordIds = [m.wordId]; delete m.wordId; }],
  ["rich public with historical Teacher", (r) => { r.public_projection = normalizeManagedPublicProjection(r.public_projection, grammar); }],
  ["unknown target mapping", (r) => { solution(r).mappings[0].targetId = "target-20000000000040008000000000009999"; }],
  ["missing target mapping", (r) => { solution(r).mappings = []; }],
  ["duplicate mapping", (r) => { solution(r).mappings.push(structuredClone(solution(r).mappings[0])); }],
  ["duplicate public word ID", (r) => { interaction(r).words[1].id = interaction(r).words[0].id; }],
  ["out of bounds target", (r) => { interaction(r).panels[0].dropTargets[0].area.x = 1000; }],
  ["Teacher leakage", (r) => { interaction(r).mappings = structuredClone(solution(r).mappings); }],
  ["missing asset", (r) => { r.public_projection.assets.pop(); }],
  ["unknown asset slot", (r) => { interaction(r).panels[0].images[0].assetSlot = "missing"; }],
  ["Teacher role in public asset", (r) => { publicDocument(r).assets[0].role = "native_teacher_answer"; }],
]) test(`rehashing cannot admit ${name}`, () => { const row = fixture(); mutate(row); reject(rehash(row)); });

test("all activities must use one recognized profile, even with self-consistent hashes", () => {
  const row = fixture(), other = fixture("presentation");
  const id = `${publicDocument(row).activityId.slice(0, -1)}2`;
  const pub = publicDocument(other), teacher = teacherDocument(other);
  pub.activityId = id; teacher.activityId = id;
  row.public_projection.nativeActivities[id] = { kind: "drag-drop", document: pub };
  row.teacher_projection.nativeActivities[id] = { kind: "drag-drop", document: teacher };
  row.public_projection.assets = other.public_projection.assets;
  row.asset_manifest = other.asset_manifest;
  reject(rehash(row));
});

test("canonical-hash substitution does not legitimize a partially normalized stored document", () => {
  const row = fixture(), canonical = structuredClone(row);
  canonical.public_projection = normalizeManagedPublicProjection(row.public_projection, grammar);
  canonical.teacher_projection = normalizeManagedTeacherProjection(row.teacher_projection, grammar, canonical.public_projection);
  rehash(canonical);
  row.public_projection_sha256 = canonical.public_projection_sha256;
  row.teacher_projection_sha256 = canonical.teacher_projection_sha256;
  row.release_sha256 = canonical.release_sha256;
  reject(row);
});

test("presentation style/font validation is preserved with recomputed hashes", () => {
  for (const mutate of [
    (r) => { delete interaction(r).presentation; },
    (r) => { interaction(r).presentation.bankWordStyle.fontAssetSlot = "unknown-font"; },
    (r) => { interaction(r).presentation.bankWordStyle.fontFamily = "Unapproved"; },
    (r) => { interaction(r).presentation.bankWordStyle.fontSize = 100; },
    (r) => { interaction(r).presentation.bankWordStyle.color = "url(secret)"; },
    (r) => { interaction(r).presentation.extra = true; },
  ]) { const row = fixture("presentation"); mutate(row); reject(rehash(row)); }
});

test("historical component ownership cannot be transplanted with recomputed hashes", () => {
  const row = fixture("original", workbook);
  row.compiler_id = "ultimate-b2-grammar-book-v1";
  row.runtime_compatibility_sha256 = row.public_projection.compatibility = fixture().runtime_compatibility_sha256;
  row.public_projection.componentSlug = row.teacher_projection.componentSlug = grammar;
  row.public_projection.hotspots.componentSlug = grammar;
  for (const page of row.public_projection.pages) page.stableKey = `${grammar}/pages/${page.id}`;
  reject(rehash(row));
});

test("historical mapping forbids reusing one word across distinct valid targets", () => {
  const row = fixture(), target = structuredClone(interaction(row).panels[0].dropTargets[0]);
  target.id = target.id.slice(0, -1) + "2";
  interaction(row).panels[0].dropTargets.push(target);
  solution(row).mappings.push({ targetId: target.id, wordId: solution(row).mappings[0].wordId });
  reject(rehash(row));
});

test("original supporting image descriptions cannot use later multiline rules", () => {
  for (const mutate of [
    (r) => { interaction(r).panels[0].images[0].altText = "one\ntwo"; },
    (r) => { publicDocument(r).readableText = { kind: "image", assetSlot: "synthetic-panel", sourceWidth: 1000, sourceHeight: 600, altText: "one\ntwo" }; },
  ]) { const row = fixture(); mutate(row); reject(rehash(row)); }
});

test("malformed declared native kinds fail closed before profile selection", () => {
  for (const value of [null, [], { invalid: null }, { invalid: { kind: "unknown", document: {} } }]) {
    const row = fixture(); row.public_projection.nativeActivities = value; reject(rehash(row));
  }
});
