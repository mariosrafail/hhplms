import assert from "node:assert/strict";
import test from "node:test";

import studentsBookRuntime from "../src/data/ultimate-b2/generated/students-book.runtime.json" with { type: "json" };
import {
  buildStudentsBookOverviewEntries,
  buildTeacherUnitOverviewEntries,
  isUltimateB2StudentsBookIdentity,
} from "../src/apps/android-teacher-offline/studentsBookOverviewLayout.js";
import {
  allocateOverviewColumns,
  buildManagedOverviewEntries,
  buildGenericOverviewEntries,
  cleanOverviewSectionLabel,
  managedOverviewPageWeight,
  MAX_OVERVIEW_PAGE_WEIGHT,
  overviewEntryWeight,
  overviewPageWeight,
  printedPageNumbers,
  splitOverviewEntries,
} from "../src/apps/android-teacher-offline/unitOverviewLayout.js";

const pages = (...spreadNumbers) => spreadNumbers.map((spreadNumber, index) => ({
  id: `page-${index + 1}`,
  title: `Section ${index + 1}`,
  spreadNumber,
  pageNumbers: [],
  images: [`/${index + 1}.png`],
}));
const entries = (sourcePages) => sourcePages.map((page) => ({ id: page.id, pageIds: [page.id], pages: [page] }));
const managedPages = (...weights) => weights.map((weight, index) => ({
  id: `managed-page-${index + 1}`,
  title: `Managed page ${index + 1}`,
  spreadNumber: `Page ${index + 1}`,
  pageNumbers: [],
  imageWidth: weight === 2 ? 1180 : 581,
  imageHeight: 794,
  images: [`/managed-${index + 1}.png`],
}));
const rowLabels = (sourceEntries, row) => sourceEntries.filter((entry) => entry.row === row).map((entry) => entry.pageLabel);
const rowWeight = (sourceEntries, row) => sourceEntries.filter((entry) => entry.row === row).reduce((sum, entry) => sum + entry.physicalWeight, 0);
const managedStudentUnit = (bookSlug, number, count = 4) => ({
  number,
  pages: Array.from({ length: count }, (_, index) => ({
    id: `${bookSlug}-students-book-unit-${number}-managed-page-${index + 1}`,
    title: `Unit ${number} managed page ${index + 1}`,
    spreadNumber: `Page ${index + 1}`,
    pageNumbers: [],
    imageWidth: index % 2 ? 1180 : 581,
    imageHeight: 794,
    images: [`/${bookSlug}/unit-${number}/page-${index + 1}.png`],
  })),
});

const componentIdentity = (bookSlug, suffix = "students-book") => ({
  bookSlug,
  componentSlug: `${bookSlug}-${suffix}`,
});

test("generic and managed overviews group adjacent labelled singles before row allocation", () => {
  for (const build of [buildGenericOverviewEntries, buildManagedOverviewEntries]) {
    const source = [60, 61, 62, 63, 65, 66].map((number, index) => ({ id: `real-${index}`, overviewLabel: "Practice 5", printedLabel: `pg ${number}`, imageWidth: 581, imageHeight: 794 }));
    source[2].overviewLabel = "Reading";
    source[5].componentSlug = "another-component";
    const spread = { id: "real-spread", overviewLabel: "Practice 5", printedLabel: "pg 67-68", imageWidth: 1180, imageHeight: 794 };
    const unknown = { id: "unknown", overviewLabel: "Practice 5" };
    const unit = { number: 5, pages: [...source, spread, unknown] };
    const before = structuredClone(unit);
    const actual = build(unit);
    assert.deepEqual(actual[0].pageIds, ["real-0", "real-1"]);
    assert.equal(actual[0].label, "Practice 5");
    assert.equal(actual[0].pageLabel, "pg 60-61");
    assert.equal(actual[0].physicalWeight, 2);
    assert.ok(actual.slice(1).every((entry) => entry.pages.length === 1));
    assert.deepEqual(actual.flatMap((entry) => entry.pageIds), unit.pages.map((page) => page.id));
    assert.deepEqual(unit, before);
    for (const key of ["bookSlug", "componentSlug", "unitId", "unitNumber"]) {
      const separate = { number: 5, pages: [source[0], { ...source[1], [key]: "different" }] };
      assert.equal(build(separate).length, 2, key);
    }
    assert.equal(build({ number: 5, pages: [{ ...source[0], overviewLabel: "" }, { ...source[1], overviewLabel: "" }] }).length, 2);
  }
});

test("Teacher overview page weighting prioritizes canonical numbers and strictly parses printed labels", () => {
  assert.deepEqual(printedPageNumbers({ pageNumbers: [6, 7, 7, Number.NaN, Infinity, -1], spreadNumber: "99" }), [6, 7]);
  assert.equal(overviewPageWeight({ pageNumbers: [5], spreadNumber: "50-51" }), 1);
  for (const spreadNumber of ["70-71", " 70 – 71 ", "70—71"]) {
    assert.deepEqual(printedPageNumbers({ pageNumbers: [], spreadNumber }), [70, 71]);
    assert.equal(overviewPageWeight({ pageNumbers: [], spreadNumber }), 2);
  }
  for (const spreadNumber of ["", "pages 70-71", "71-70", "70-72", "-1", "0", "1-999999999", "70-"]) {
    assert.deepEqual(printedPageNumbers({ pageNumbers: [], spreadNumber }), [], spreadNumber);
    assert.equal(overviewPageWeight({ pageNumbers: [], spreadNumber }), 1, spreadNumber);
  }
  assert.equal(MAX_OVERVIEW_PAGE_WEIGHT, 2);
});

test("managed page weighting prioritizes persisted intrinsic geometry over editorial labels", () => {
  assert.equal(managedOverviewPageWeight({ spreadNumber: "Page 1", imageWidth: 1180, imageHeight: 794 }), 2);
  assert.equal(managedOverviewPageWeight({ spreadNumber: "Page 2", imageWidth: 581, imageHeight: 794 }), 1);
  assert.equal(managedOverviewPageWeight({ spreadNumber: "70-71", imageWidth: 581, imageHeight: 794 }), 1);
  assert.equal(managedOverviewPageWeight({ spreadNumber: "70-71" }), 2, "legacy catalogs without dimensions retain the strict label fallback");
});

test("entry weighting unions canonical pages without double-counting grouped duplicates", () => {
  const first = { id: "first", pageNumbers: [17], spreadNumber: "17" };
  const duplicate = { id: "duplicate", pageNumbers: [17, 18], spreadNumber: "17-18" };
  assert.equal(overviewEntryWeight({ pages: [first, duplicate] }), 2);
  assert.equal(overviewEntryWeight({ pages: [{ id: "bad-a" }, { id: "bad-b" }] }), 2);
});

test("Student Units 1 and 2 retain their canonical grouping and physical 7/7 and 8/8 rows", () => {
  const unit1 = buildStudentsBookOverviewEntries(studentsBookRuntime.units.find((unit) => unit.number === 1));
  const unit2 = buildStudentsBookOverviewEntries(studentsBookRuntime.units.find((unit) => unit.number === 2));
  assert.deepEqual(rowLabels(unit1, 1), ["pg 5", "pg 6-7", "pg 8-9", "pg 10-11"]);
  assert.deepEqual(rowLabels(unit1, 2), ["pg 12", "pg 13", "pg 14-15", "pg 16", "pg 17-18"]);
  assert.deepEqual([rowWeight(unit1, 1), rowWeight(unit1, 2)], [7, 7]);
  assert.deepEqual(rowLabels(unit2, 1), ["pg 19", "pg 20-21", "pg 22-23", "pg 24-25", "pg 26"]);
  assert.deepEqual(rowLabels(unit2, 2), ["pg 27", "pg 28-29", "pg 30", "pg 31-32", "pg 33-34"]);
  assert.deepEqual([rowWeight(unit2, 1), rowWeight(unit2, 2)], [8, 8]);
  const practice = unit2.find((entry) => entry.pageIds[0] === "practice-31");
  const progress = unit2.find((entry) => entry.pageIds[0] === "progress-check-33");
  const grammarSpread = unit2.find((entry) => entry.pageIds[0] === "grammar-24-25");
  assert.deepEqual(practice.pageIds, ["practice-31", "practice-32"]);
  assert.deepEqual(progress.pageIds, ["progress-check-33", "progress-check-34"]);
  assert.deepEqual(grammarSpread.pageIds, ["grammar-24-25"]);
  assert.equal(Object.hasOwn(practice, "navigationTargets"), false);
  assert.equal(Object.hasOwn(progress, "navigationTargets"), false);
});

test("bespoke Student overview routing is scoped to the exact Ultimate B2 component", () => {
  const b2Identity = componentIdentity("ultimate-b2");
  assert.equal(isUltimateB2StudentsBookIdentity(b2Identity), true);
  for (const identity of [
    componentIdentity("ultimate-b1"),
    componentIdentity("ultimate-b1-plus"),
    componentIdentity("ultimate-b2", "workbook"),
    { bookSlug: "ultimate-b1", componentSlug: "ultimate-b2-students-book" },
    { bookSlug: "ultimate-b2", componentSlug: "ultimate-b1-students-book" },
    null,
  ]) assert.equal(isUltimateB2StudentsBookIdentity(identity), false);

  for (const number of [1, 2]) {
    const unit = studentsBookRuntime.units.find((candidate) => candidate.number === number);
    assert.deepEqual(
      buildTeacherUnitOverviewEntries({ unit, selectedBookId: "students-book", componentIdentity: b2Identity }),
      buildStudentsBookOverviewEntries(unit),
    );
    assert.throws(
      () => buildTeacherUnitOverviewEntries({
        unit: { ...unit, pages: unit.pages.slice(1) },
        selectedBookId: "students-book",
        componentIdentity: b2Identity,
      }),
      new RegExp(`Invalid Unit ${number} overview layout`),
    );
  }
});

test("Ultimate B1 and B1+ managed Student Units 1 and 2 use the generic overview", () => {
  for (const bookSlug of ["ultimate-b1", "ultimate-b1-plus"]) {
    for (const number of [1, 2]) {
      const unit = managedStudentUnit(bookSlug, number);
      const result = buildTeacherUnitOverviewEntries({
        unit,
        selectedBookId: "students-book",
        componentIdentity: componentIdentity(bookSlug),
      });
      assert.deepEqual(result.flatMap((entry) => entry.pageIds), unit.pages.map((page) => page.id));
      assert.ok(result.every((entry) => entry.id.startsWith(`unit-${number}-overview-`)));
      assert.ok(result.every((entry) => entry.pages.length === 1));
    }
  }
});

test("managed Student Unit 3+ and non-Student overview routing remain unchanged", () => {
  for (const bookSlug of ["ultimate-b1", "ultimate-b1-plus"]) {
    const unit = managedStudentUnit(bookSlug, 3);
    assert.deepEqual(
      buildTeacherUnitOverviewEntries({ unit, selectedBookId: "students-book", componentIdentity: componentIdentity(bookSlug) }),
      buildStudentsBookOverviewEntries(unit),
    );
  }

  const managedUnit = { number: 2, pages: managedPages(1, 2, 1, 2) };
  for (const [selectedBookId, identity] of [
    ["workbook", componentIdentity("ultimate-b2", "workbook")],
    ["grammar-book", componentIdentity("ultimate-b1-plus", "grammar-book")],
  ]) {
    assert.deepEqual(
      buildTeacherUnitOverviewEntries({ unit: managedUnit, selectedBookId, componentIdentity: identity }),
      buildManagedOverviewEntries(managedUnit),
    );
  }
});

test("Student Units 3-10 keep every atomic page once and derive rows from physical pages", () => {
  for (const unit of studentsBookRuntime.units.filter((candidate) => candidate.number >= 3)) {
    const result = buildStudentsBookOverviewEntries(unit);
    const flattenedIds = result.flatMap((entry) => entry.pageIds);
    assert.deepEqual(flattenedIds, unit.pages.map((page) => page.id), `Unit ${unit.number} order`);
    assert.equal(new Set(flattenedIds).size, unit.pages.length, `Unit ${unit.number} uniqueness`);
    assert.ok(result.every((entry) => entry.pages.length === 1), `Unit ${unit.number} atomic assets`);
    assert.deepEqual(result.map((entry) => entry.row), buildStudentsBookOverviewEntries(unit).map((entry) => entry.row), `Unit ${unit.number} deterministic rows`);
    for (const row of [1, 2]) {
      const rowEntries = result.filter((entry) => entry.row === row);
      if (!rowEntries.length) continue;
      assert.equal(rowEntries.reduce((sum, entry) => sum + entry.columnSpan, 0), 24, `Unit ${unit.number} row ${row} columns`);
      assert.equal(rowEntries[0].columnStart, 1, `Unit ${unit.number} row ${row} starts at column 1`);
      assert.equal(rowEntries.at(-1).columnStart + rowEntries.at(-1).columnSpan, 25, `Unit ${unit.number} row ${row} fills the grid`);
    }
  }

  const unit5 = buildStudentsBookOverviewEntries(studentsBookRuntime.units.find((unit) => unit.number === 5));
  assert.deepEqual(unit5.map((entry) => entry.physicalWeight), [1, 2, 2, 2, 1, 1, 2, 1, 1, 1]);
  assert.deepEqual(rowLabels(unit5, 1), ["pg 65", "pg 66-67", "pg 68-69", "pg 70-71"]);
  assert.deepEqual(rowLabels(unit5, 2), ["pg 72", "pg 73", "pg 74-75", "pg 76", "pg 77", "pg 78"]);
  assert.deepEqual([rowWeight(unit5, 1), rowWeight(unit5, 2)], [7, 7]);
});

test("managed Workbook and Grammar rows follow intrinsic spread geometry despite simple Page labels", () => {
  const workbook = buildManagedOverviewEntries({ number: 7, pages: managedPages(2, 2, 2, 1, 1, 2, 2) });
  assert.deepEqual(rowLabels(workbook, 1), ["Page 1", "Page 2", "Page 3"]);
  assert.deepEqual(rowLabels(workbook, 2), ["Page 4", "Page 5", "Page 6", "Page 7"]);
  assert.deepEqual(workbook.map((entry) => entry.physicalWeight), [2, 2, 2, 1, 1, 2, 2]);
  assert.deepEqual([rowWeight(workbook, 1), rowWeight(workbook, 2)], [6, 6]);
  assert.deepEqual(workbook.filter((entry) => entry.row === 1).map((entry) => entry.columnSpan), [8, 8, 8]);
  assert.deepEqual(workbook.filter((entry) => entry.row === 2).map((entry) => entry.columnSpan), [4, 4, 8, 8]);
  assert.equal(workbook.filter((entry) => entry.row === 1).reduce((sum, entry) => sum + entry.columnSpan, 0), 24);
  assert.equal(workbook.filter((entry) => entry.row === 2).reduce((sum, entry) => sum + entry.columnSpan, 0), 24);

  const grammar = buildManagedOverviewEntries({ number: 3, pages: managedPages(1, 2, 2, 1, 2, 1, 2) });
  assert.deepEqual(rowLabels(grammar, 1), ["Page 1", "Page 2", "Page 3", "Page 4"]);
  assert.deepEqual(rowLabels(grammar, 2), ["Page 5", "Page 6", "Page 7"]);
  assert.deepEqual(grammar.map((entry) => entry.physicalWeight), [1, 2, 2, 1, 2, 1, 2]);
  assert.deepEqual([rowWeight(grammar, 1), rowWeight(grammar, 2)], [6, 5]);
  assert.deepEqual(grammar.filter((entry) => entry.row === 1).map((entry) => entry.columnSpan), [4, 8, 8, 4]);
  assert.deepEqual(grammar.filter((entry) => entry.row === 2).map((entry) => entry.columnSpan), [8, 4, 8]);
});

test("split handles empty and small inputs without mutation, reordering, or identity loss", () => {
  assert.deepEqual(splitOverviewEntries([]), { top: [], bottom: [], topWeight: 0, bottomWeight: 0, totalWeight: 0 });
  const sourcePages = pages("1", "2-3");
  const sourceEntries = entries(sourcePages);
  const snapshot = structuredClone(sourceEntries);
  const one = splitOverviewEntries(sourceEntries.slice(0, 1));
  const two = splitOverviewEntries(sourceEntries);
  assert.deepEqual(one.top, [sourceEntries[0]]);
  assert.deepEqual(one.bottom, []);
  assert.deepEqual([...two.top, ...two.bottom], sourceEntries);
  assert.equal([...two.top, ...two.bottom][0], sourceEntries[0]);
  assert.deepEqual(sourceEntries, snapshot);
  assert.deepEqual(allocateOverviewColumns(sourceEntries.slice(0, 1)), [{ columnStart: 11, columnSpan: 4 }]);
});

test("publisher labels suppress internal filenames without inventing section titles", () => {
  assert.equal(cleanOverviewSectionLabel("Reading"), "Reading");
  assert.equal(cleanOverviewSectionLabel("parts_part_2.png"), null);
  assert.equal(cleanOverviewSectionLabel("unit/5/parts_part_2.png"), null);
  assert.equal(cleanOverviewSectionLabel(""), null);
});
