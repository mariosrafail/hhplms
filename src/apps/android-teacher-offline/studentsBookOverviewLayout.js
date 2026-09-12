import { buildGenericOverviewEntries, buildManagedOverviewEntries, overviewEntryWeight, overviewSectionLabel, overviewPrintedLabel, printedPageNumbers } from "./unitOverviewLayout.js";

const ULTIMATE_B2_STUDENTS_BOOK_IDENTITY = Object.freeze({
  bookSlug: "ultimate-b2",
  componentSlug: "ultimate-b2-students-book",
});

export function isUltimateB2StudentsBookIdentity(identity) {
  return identity?.bookSlug === ULTIMATE_B2_STUDENTS_BOOK_IDENTITY.bookSlug
    && identity?.componentSlug === ULTIMATE_B2_STUDENTS_BOOK_IDENTITY.componentSlug;
}

export const studentsBookOverviewLayout = Object.freeze({
  1: [
    { label: null, pageLabel: "pg 5", pageIds: ["ub2-sb-unit-1-part-1"], row: 1 },
    { label: "Reading", pageLabel: "pg 6-7", pageIds: ["ub2-sb-unit-1-part-2"], row: 1 },
    { label: "Vocabulary in Use", pageLabel: "pg 8-9", pageIds: ["ub2-sb-unit-1-part-3"], row: 1 },
    { label: "Grammar in Use", pageLabel: "pg 10-11", pageIds: ["ub2-sb-unit-1-part-4"], row: 1 },
    { label: "Listening", pageLabel: "pg 12", pageIds: ["ub2-sb-unit-1-part-5"], row: 2 },
    { label: "Speaking", pageLabel: "pg 13", pageIds: ["ub2-sb-unit-1-part-6"], row: 2 },
    { label: "Writing", pageLabel: "pg 14-15", pageIds: ["ub2-sb-unit-1-part-7"], row: 2 },
    { label: "Review 1", pageLabel: "pg 16", pageIds: ["ub2-sb-unit-1-part-8"], row: 2 },
    { label: "Practice 1", pageLabel: "pg 17-18", pageIds: ["ub2-sb-unit-1-part-9", "ub2-sb-unit-1-part-10"], row: 2 },
  ],
  2: [
    { label: null, pageLabel: "pg 19", pageIds: ["reading-19"], row: 1 },
    { label: "Reading", pageLabel: "pg 20-21", pageIds: ["reading-20-21"], row: 1 },
    { label: "Vocabulary in Use", pageLabel: "pg 22-23", pageIds: ["vocabulary-22-23"], row: 1 },
    { label: "Grammar in Use", pageLabel: "pg 24-25", pageIds: ["grammar-24-25"], row: 1 },
    { label: "Listening", pageLabel: "pg 26", pageIds: ["listening-26"], row: 1 },
    { label: "Speaking", pageLabel: "pg 27", pageIds: ["speaking-27"], row: 2 },
    { label: "Writing", pageLabel: "pg 28-29", pageIds: ["writing-28-29"], row: 2 },
    { label: "Review 2", pageLabel: "pg 30", pageIds: ["review-30"], row: 2 },
    { label: "Practice 2", pageLabel: "pg 31-32", pageIds: ["practice-31", "practice-32"], row: 2 },
    { label: "Progress check 1", pageLabel: "pg 33-34", pageIds: ["progress-check-33", "progress-check-34"], row: 2 },
  ],
});

export function buildStudentsBookOverviewEntries(unit) {
  const configuration = studentsBookOverviewLayout[Number(unit?.number)];
  const realPages = unit?.pages || [];
  if (!configuration) return buildGenericOverviewEntries(unit);

  const pagesById = new Map(realPages.map((page) => [page.id, page]));
  const configuredIds = configuration.flatMap((entry) => entry.pageIds);
  const duplicateIds = configuredIds.filter((id, index) => configuredIds.indexOf(id) !== index);
  const missingIds = configuredIds.filter((id) => !pagesById.has(id));
  const omittedIds = realPages.map((page) => page.id).filter((id) => !configuredIds.includes(id));

  if (duplicateIds.length || missingIds.length || omittedIds.length || configuredIds.length !== realPages.length) {
    throw new Error(`Invalid Unit ${unit.number} overview layout: ${JSON.stringify({ duplicateIds, missingIds, omittedIds })}`);
  }

  return configuration.map((entry, index) => {
    const result = {
      ...entry,
      id: `unit-${unit.number}-overview-${index + 1}`,
      pages: entry.pageIds.map((id) => pagesById.get(id)),
    };
    if (result.pages.some((page) => Object.hasOwn(page, "overviewLabel"))) {
      result.label = overviewSectionLabel(result.pages[0]);
      const numbers = result.pages.flatMap(printedPageNumbers);
      if (numbers.length) result.pageLabel = overviewPrintedLabel({ pageNumbers: numbers });
    }
    return { ...result, physicalWeight: overviewEntryWeight(result) };
  });
}

export function buildTeacherUnitOverviewEntries({ unit, selectedBookId, componentIdentity }) {
  if (selectedBookId !== "students-book") return buildManagedOverviewEntries(unit);
  return isUltimateB2StudentsBookIdentity(componentIdentity)
    ? buildStudentsBookOverviewEntries(unit)
    : buildGenericOverviewEntries(unit);
}
