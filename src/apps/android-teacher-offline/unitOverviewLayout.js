export const OVERVIEW_GRID_COLUMNS = 24;
export const MAX_OVERVIEW_PAGE_WEIGHT = 2;

const PRINTED_LABEL_PATTERN = /^(\d+)(?:\s*[-–—]\s*(\d+))?$/u;
const INTERNAL_ASSET_LABEL_PATTERN = /(?:^|[\\/])(?:parts?_part_\d+|page_\d+)(?:\.[a-z0-9]+)?$|\.(?:jpe?g|png|webp)$/i;

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function printedPageNumbers(page) {
  if (Array.isArray(page?.pageNumbers)) {
    const unique = [...new Set(page.pageNumbers.filter(positiveSafeInteger))];
    if (unique.length > 0 && unique.length <= MAX_OVERVIEW_PAGE_WEIGHT) return unique;
  }

  const printed = page?.printedLabel ? String(page.printedLabel).trim().replace(/^(?:pg|pages?)\s+/i, "") : String(page?.spreadNumber ?? "").trim();
  const match = printed.match(PRINTED_LABEL_PATTERN);
  if (!match) return [];
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  if (!positiveSafeInteger(start) || !positiveSafeInteger(end) || end < start) return [];
  const weight = end - start + 1;
  return weight <= MAX_OVERVIEW_PAGE_WEIGHT
    ? Array.from({ length: weight }, (_, index) => start + index)
    : [];
}

export function overviewPageWeight(page) {
  return printedPageNumbers(page).length || 1;
}

export function managedOverviewPageWeight(page) {
  const width = Number(page?.imageWidth);
  const height = Number(page?.imageHeight);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return width > height ? 2 : 1;
  }
  return overviewPageWeight(page);
}

export function overviewEntryWeight(entry) {
  if (positiveSafeInteger(entry?.physicalWeight) && entry.physicalWeight <= MAX_OVERVIEW_PAGE_WEIGHT) {
    return entry.physicalWeight;
  }
  const physicalPages = new Set();
  let fallbackPages = 0;
  const pages = Array.isArray(entry?.pages) ? entry.pages : [];

  pages.forEach((page) => {
    const numbers = printedPageNumbers(page);
    if (numbers.length) numbers.forEach((number) => physicalPages.add(number));
    else fallbackPages += 1;
  });

  return Math.max(1, physicalPages.size + fallbackPages);
}

export function splitOverviewEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { top: [], bottom: [], topWeight: 0, bottomWeight: 0, totalWeight: 0 };
  }

  const weights = entries.map(overviewEntryWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const target = Math.ceil(totalWeight / 2);
  let splitIndex = 0;
  let topWeight = 0;

  while (splitIndex < entries.length && topWeight < target) {
    topWeight += weights[splitIndex];
    splitIndex += 1;
  }

  return {
    top: entries.slice(0, splitIndex),
    bottom: entries.slice(splitIndex),
    topWeight,
    bottomWeight: totalWeight - topWeight,
    totalWeight,
  };
}

function idealSparseColumns(weight) {
  return weight > 1 ? 8 : 4;
}

export function allocateOverviewColumns(entries, columnCount = OVERVIEW_GRID_COLUMNS) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const weights = entries.map(overviewEntryWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const usedColumns = Math.min(columnCount, weights.reduce((sum, weight) => sum + idealSparseColumns(weight), 0));
  const exact = weights.map((weight) => (weight / totalWeight) * usedColumns);
  const spans = exact.map((value) => Math.max(1, Math.floor(value)));
  let remaining = usedColumns - spans.reduce((sum, span) => sum + span, 0);
  const priority = exact.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);

  for (let index = 0; remaining > 0; index = (index + 1) % priority.length) {
    spans[priority[index].index] += 1;
    remaining -= 1;
  }

  let columnStart = Math.floor((columnCount - usedColumns) / 2) + 1;
  return spans.map((columnSpan) => {
    const allocation = { columnStart, columnSpan };
    columnStart += columnSpan;
    return allocation;
  });
}

export function cleanOverviewSectionLabel(label) {
  const value = String(label ?? "").trim();
  return value && !INTERNAL_ASSET_LABEL_PATTERN.test(value) ? value : null;
}

export function overviewSectionLabel(page) {
  // An explicit authored label wins; a legacy page-number caption is not a section title.
  const authored = page?.overviewLabel ?? page?.label;
  const label = cleanOverviewSectionLabel(authored);
  if (label && !/^(?:pg|pages?)\s+\d+(?:\s*[-\u2013\u2014]\s*\d+)?$/i.test(label) && label !== page?.id) return label;
  const title = cleanOverviewSectionLabel(page?.title);
  return title && title !== page?.id && !/^(?:pg|pages?)\s+\d/i.test(title) && !/^[a-z0-9]+(?:[-_][a-z0-9]+){2,}$/i.test(title) ? title : null;
}

export function overviewPrintedLabel(page, fallbackIndex = 0) {
  const numbers = printedPageNumbers(page);
  if (numbers.length === 1) return `pg ${numbers[0]}`;
  if (numbers.length === 2) return `pg ${numbers[0]}-${numbers[1]}`;
  const fallback = String(page?.printedLabel || page?.spreadNumber || "").trim();
  return /^page\s+\S+/i.test(fallback) ? fallback : `Page ${fallbackIndex + 1}`;
}

function decorateRow(entries, row) {
  const allocations = allocateOverviewColumns(entries);
  return entries.map((entry, index) => ({
    ...entry,
    row,
    physicalWeight: overviewEntryWeight(entry),
    ...allocations[index],
  }));
}

// Pair only adjacent, explicitly labelled single pages with consecutive printed
// numbers. A spread is already one navigation target; missing metadata is not
// evidence that two pages belong together.
function groupOverviewEntries(entries) {
  const groups = [];
  for (const entry of entries) {
    const previous = groups.at(-1);
    const left = previous?.pages[0];
    const right = entry.pages[0];
    const leftNumbers = printedPageNumbers(left);
    const rightNumbers = printedPageNumbers(right);
    const sameScope = ["bookSlug", "componentSlug", "unitId", "unitNumber"].every((key) => left?.[key] === right?.[key]);
    if (previous?.pages.length === 1 && previous.physicalWeight === 1 && entry.physicalWeight === 1
      && entry.label && entry.label === previous.label && sameScope
      && leftNumbers.length === 1 && rightNumbers.length === 1 && rightNumbers[0] === leftNumbers[0] + 1) {
      groups[groups.length - 1] = { ...previous, pageLabel: `pg ${leftNumbers[0]}-${rightNumbers[0]}`,
        pages: [left, right], pageIds: [left.id, right.id], physicalWeight: 2 };
    } else groups.push(entry);
  }
  return groups;
}

export function buildGenericOverviewEntries(unit) {
  const entries = (unit?.pages || []).map((page, index) => ({
    id: `unit-${unit.number}-overview-${page.id}`,
    label: overviewSectionLabel(page),
    pageLabel: overviewPrintedLabel(page, index),
    pageIds: [page.id],
    pages: [page],
    physicalWeight: managedOverviewPageWeight(page),
  }));
  const rows = splitOverviewEntries(groupOverviewEntries(entries));
  return [...decorateRow(rows.top, 1), ...decorateRow(rows.bottom, 2)];
}

export function buildManagedOverviewEntries(unit) {
  const entries = (unit?.pages || []).map((page, index) => ({
    id: `unit-${unit.number}-managed-overview-${page.id}`,
    label: overviewSectionLabel(page),
    pageLabel: overviewPrintedLabel(page, index),
    pageIds: [page.id],
    pages: [page],
    physicalWeight: managedOverviewPageWeight(page),
  }));
  const rows = splitOverviewEntries(groupOverviewEntries(entries));
  return [...decorateRow(rows.top, 1), ...decorateRow(rows.bottom, 2)];
}
