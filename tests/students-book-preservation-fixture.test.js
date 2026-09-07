import assert from "node:assert/strict";
import test from "node:test";
import { protectedStudentsBookIds, syntheticStudentsBookActivities, assertPreservedRecords } from "./fixtures/students-book-preservation.js";

test("Students Book preservation fixture has exact historical identities and valid synthetic pairs beyond the minimum", () => {
  assert.equal(new Set(protectedStudentsBookIds).size, 56);
  assert.equal(protectedStudentsBookIds.filter((id) => id.startsWith("ultimate-b2-sb-u1-")).length, 22);
  assert.equal(protectedStudentsBookIds.filter((id) => id.startsWith("ultimate-b2-sb-u2-")).length, 34);
  const records = syntheticStudentsBookActivities(2);
  assert.equal(records.length, 58);
  assert.deepEqual(records.slice(0, 56).map((entry) => entry.index.activityId), protectedStudentsBookIds);
  assert.equal(records[1].index.placement.pageId, "reading-20-21");
  assert.equal(records[1].index.activityId, "ultimate-b2-sb-u1-p1-o12");
  assertPreservedRecords(records, structuredClone(records));
});

test("preservation rejects same-count identity replacement, payload edits, revisions and placement/order changes", () => {
  const before = syntheticStudentsBookActivities(1);
  for (const mutate of [
    (records) => { records[0].index.activityId = "ultimate-b2-sb-u1-p1-o9999"; },
    (records) => { records[0].public.payload.metadata.title = "Changed"; },
    (records) => { records[0].teacher.payload.parts[0].solution.modelAnswers[0].text = "Changed"; },
    (records) => { records[0].public.revision += 1; },
    (records) => { records[0].index.placement.pageId = "ub2-sb-unit-1-part-1"; },
    (records) => { records[0].index.sortOrder += 1; },
    (records) => { records.pop(); },
  ]) {
    const after = structuredClone(before);
    mutate(after);
    assert.throws(() => assertPreservedRecords(before, after), /Protected authored data/);
  }
});
