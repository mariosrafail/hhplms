import { isPhaseOneComponentVisible } from "../config/bookCatalogVisibility.js";

export const BOOK_COMPONENT_TYPES = Object.freeze([
  "students_book",
  "workbook",
  "grammar_book",
  "test_book",
]);

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{1,79}$/;
const VALID_REVIEW_STATES = new Set(["installed", "pending"]);
const VALID_AUTHORING_STATES = new Set(["active", "pending"]);

function component(bookSlug, suffix, title, type, teacherEditionId, options = {}) {
  const slug = `${bookSlug}-${suffix}`;
  return {
    id: slug,
    slug,
    bookSlug,
    title,
    type,
    teacherEditionId,
    registered: true,
    lmsVisible: isPhaseOneComponentVisible(bookSlug, slug),
    reviewState: options.reviewState || "pending",
    authoringState: options.authoringState || "pending",
    authoringAdapterId: options.authoringAdapterId || null,
    publication: Object.freeze({
      readable: options.publication?.readable === true,
      writable: options.publication?.writable === true,
      compilerId: options.publication?.compilerId || null,
    }),
  };
}

const catalogInput = [
  {
    id: "ultimate-b1",
    slug: "ultimate-b1",
    title: "Ultimate English B1",
    level: "B1",
    publisher: "Hamilton House",
    components: [
      component("ultimate-b1", "students-book", "Students Book", "students_book", "students-book", {
        authoringState: "active",
        authoringAdapterId: "ultimate-b1-students-book",
      }),
      component("ultimate-b1", "workbook", "Workbook", "workbook", "workbook", {
        authoringState: "active",
        authoringAdapterId: "ultimate-b1-workbook",
      }),
      component("ultimate-b1", "grammar-book", "Grammar Book", "grammar_book", "grammar-book", {
        authoringState: "active",
        authoringAdapterId: "ultimate-b1-grammar-book",
      }),
      component("ultimate-b1", "test-book", "Test Book", "test_book", null),
    ],
  },
  {
    id: "ultimate-b1-plus",
    slug: "ultimate-b1-plus",
    title: "Ultimate English B1+",
    level: "B1+",
    publisher: "Hamilton House",
    components: [
      component("ultimate-b1-plus", "students-book", "Students Book", "students_book", "students-book", {
        authoringState: "active",
        authoringAdapterId: "ultimate-b1-plus-students-book",
      }),
      component("ultimate-b1-plus", "workbook", "Workbook", "workbook", "workbook", {
        authoringState: "active",
        authoringAdapterId: "ultimate-b1-plus-workbook",
      }),
      component("ultimate-b1-plus", "grammar-book", "Grammar Book", "grammar_book", "grammar-book", {
        authoringState: "active",
        authoringAdapterId: "ultimate-b1-plus-grammar-book",
      }),
      component("ultimate-b1-plus", "test-book", "Test Book", "test_book", null),
    ],
  },
  {
    id: "ultimate-b2",
    slug: "ultimate-b2",
    title: "Ultimate B2",
    level: "B2",
    publisher: "Hamilton House",
    components: [
      component("ultimate-b2", "students-book", "Students Book", "students_book", "students-book", {
        reviewState: "installed",
        authoringState: "active",
        authoringAdapterId: "ultimate-b2-students-book",
        publication: {
          readable: true,
          writable: true,
          compilerId: "ultimate-b2-students-book-v3",
        },
      }),
      component("ultimate-b2", "workbook", "Workbook", "workbook", "workbook", {
        reviewState: "installed",
        authoringState: "active",
        authoringAdapterId: "ultimate-b2-workbook",
        publication: {
          readable: true,
          writable: false,
          compilerId: "ultimate-b2-workbook-v1",
        },
      }),
      component("ultimate-b2", "grammar-book", "Grammar Book", "grammar_book", "grammar-book", {
        reviewState: "installed",
        authoringState: "active",
        authoringAdapterId: "ultimate-b2-grammar-book",
        publication: {
          readable: true,
          writable: false,
          compilerId: "ultimate-b2-grammar-book-v1",
        },
      }),
      component("ultimate-b2", "test-book", "Test Book", "test_book", null),
    ],
  },
];

function freezeCatalog(books) {
  return Object.freeze(books.map((book) => Object.freeze({
    ...book,
    components: Object.freeze(book.components.map((item) => Object.freeze({ ...item }))),
  })));
}

export function createBookProductCatalog(books) {
  const bookSlugs = new Set();
  const componentSlugs = new Set();
  for (const book of books || []) {
    if (!SAFE_SLUG.test(book?.slug || "") || book.id !== book.slug || bookSlugs.has(book.slug)) {
      throw new Error(`Invalid or duplicate product book: ${book?.slug || "unknown"}`);
    }
    bookSlugs.add(book.slug);
    for (const item of book.components || []) {
      if (!SAFE_SLUG.test(item?.slug || "") || item.id !== item.slug || componentSlugs.has(item.slug)) {
        throw new Error(`Invalid or duplicate product component: ${item?.slug || "unknown"}`);
      }
      if (item.bookSlug !== book.slug || !item.slug.startsWith(`${book.slug}-`)) {
        throw new Error(`Product component has the wrong parent book: ${item.slug}`);
      }
      if (!BOOK_COMPONENT_TYPES.includes(item.type)) throw new Error(`Unsupported product component type: ${item.type}`);
      if (!VALID_REVIEW_STATES.has(item.reviewState) || !VALID_AUTHORING_STATES.has(item.authoringState)) {
        throw new Error(`Invalid product component readiness: ${item.slug}`);
      }
      const expectsAuthoringAdapter = item.authoringState === "active";
      if (expectsAuthoringAdapter !== Boolean(item.authoringAdapterId)) {
        throw new Error(`Product component authoring adapter mismatch: ${item.slug}`);
      }
      const publication = item.publication || {};
      const publicationEnabled = publication.readable === true || publication.writable === true;
      if (publication.writable === true && publication.readable !== true) throw new Error(`Writable publication must also be readable: ${item.slug}`);
      if (publicationEnabled !== Boolean(publication.compilerId)) throw new Error(`Product component publication compiler mismatch: ${item.slug}`);
      if (publicationEnabled && (item.reviewState !== "installed" || item.authoringState !== "active")) throw new Error(`Product component publication readiness mismatch: ${item.slug}`);
      if (item.type === "test_book" ? item.teacherEditionId !== null : !SAFE_SLUG.test(item.teacherEditionId || "")) {
        throw new Error(`Invalid Teacher edition mapping: ${item.slug}`);
      }
      componentSlugs.add(item.slug);
    }
  }
  return freezeCatalog(books || []);
}

export const bookProductCatalog = createBookProductCatalog(catalogInput);

export function findProductBook(bookSlug) {
  return bookProductCatalog.find((book) => book.slug === bookSlug) || null;
}

export function findProductComponent(bookSlug, componentSlug) {
  return findProductBook(bookSlug)?.components.find((item) => item.slug === componentSlug) || null;
}

export function findProductComponentByTeacherEdition(bookSlug, teacherEditionId) {
  return findProductBook(bookSlug)?.components.find((item) => item.teacherEditionId === teacherEditionId) || null;
}
