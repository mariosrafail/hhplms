import { englishJourney6Package } from "./englishJourney6DemoData.js";
import { ultimateB2Package } from "./ultimateB2DemoData.js";
import { filterPhaseOneComponents, sortPhaseOnePackages } from "../config/bookCatalogVisibility.js";
import { findProductBook } from "./bookProductCatalog.js";

const emptyCatalogComponent = (packageSlug, packageTitle, suffix, title, componentType, sortOrder) => ({
  id: `${packageSlug}-${suffix}`,
  slug: `${packageSlug}-${suffix}`,
  title: `${packageTitle} ${title}`,
  type: title,
  componentType,
  component_type: componentType,
  sortOrder,
  coverAssetPath: null,
  units: [],
});

function emptyUltimatePackage(slug) {
  const product = findProductBook(slug);
  return {
    id: slug,
    slug,
    packageTitle: product.title,
    packageLabel: `${product.title} package`,
    level: product.level,
    publisher: product.publisher,
    demoSchool: "Hamilton House ELT Demo",
    description: "Content will be added when the publisher files are available.",
    coverAssetPath: null,
    status: "active",
    components: product.components.map((item, index) => emptyCatalogComponent(
      slug,
      product.title,
      item.slug.slice(slug.length + 1),
      item.title,
      item.type,
      index + 1,
    )),
  };
}

export const ultimateB1Package = filterPhaseOneComponents(emptyUltimatePackage("ultimate-b1"));
export const ultimateB1PlusPackage = filterPhaseOneComponents(emptyUltimatePackage("ultimate-b1-plus"));
export const demoBookPackages = sortPhaseOnePackages([
  ultimateB1Package,
  ultimateB1PlusPackage,
  filterPhaseOneComponents(ultimateB2Package),
]);
const internalFallbackPackages = [...demoBookPackages, englishJourney6Package];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeMatchKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\+/g, "-plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function canonicalPackageIdentity(value = "") {
  const normalized = normalizeMatchKey(value);
  if (normalized.includes("ultimate-b1-plus") || normalized.includes("ultimate-english-b1-plus") || normalized.includes("ultimateb1plus")) return "ultimate-b1-plus";
  if (normalized.includes("ultimate-b1") || normalized.includes("ultimate-english-b1") || normalized.includes("ultimateb1")) return "ultimate-b1";
  if (normalized.includes("ultimate-b2") || normalized.includes("ultimateb2")) return "ultimate-b2";
  if (normalized.includes("english-journey-6") || normalized.includes("englishjourney6") || normalized === "ej6") return "english-journey-6";
  return normalized;
}

export function normalizeBookPackageKey(bookPackage = {}) {
  const slugIdentity = canonicalPackageIdentity(bookPackage.slug);
  if (slugIdentity && !UUID_PATTERN.test(String(bookPackage.slug))) return slugIdentity;

  const titleIdentity = canonicalPackageIdentity(bookPackage.packageTitle || bookPackage.title);
  if (["ultimate-b1", "ultimate-b1-plus", "ultimate-b2", "english-journey-6"].includes(titleIdentity)) return titleIdentity;

  if (titleIdentity) return titleIdentity;

  const idIdentity = canonicalPackageIdentity(bookPackage.id);
  return idIdentity && !UUID_PATTERN.test(String(bookPackage.id)) ? idIdentity : "";
}

export const normalizePackageIdentity = normalizeBookPackageKey;

export function getDemoBookPackage(slugOrId = "ultimate-b2") {
  const requestedIdentity = canonicalPackageIdentity(slugOrId);
  return internalFallbackPackages.find((bookPackage) => (
    normalizeBookPackageKey(bookPackage) === requestedIdentity ||
    bookPackage.slug === slugOrId ||
    bookPackage.id === slugOrId ||
    bookPackage.packageTitle === slugOrId
  )) || null;
}

function componentMatchKeys(component = {}) {
  return [
    component.id,
    component.slug,
    component.routeSlug,
    component.title,
    component.type,
    component.componentType,
  ].map(normalizeMatchKey).filter(Boolean);
}

function findMatchingDemoComponent(demoPackage, replacementComponent) {
  const replacementKeys = new Set(componentMatchKeys(replacementComponent));
  return (demoPackage?.components || []).find((demoComponent) => (
    componentMatchKeys(demoComponent).some((key) => replacementKeys.has(key))
  ));
}

function mergeComponentWithDemoFallback(replacementComponent, demoComponent) {
  // Current publication policy also excludes recovered Teacher/page catalogs.
  if (replacementComponent.legacyDiscoveryAllowed === false) return {
    ...replacementComponent,
    units: [],
    teacherUnits: [],
    pageUnits: [],
  };
  if (!demoComponent) return replacementComponent;
  return {
    ...demoComponent,
    ...replacementComponent,
    pageUnits: replacementComponent.pageUnits?.length ? replacementComponent.pageUnits : demoComponent.pageUnits,
  };
}

function packageCompletenessScore(bookPackage = {}) {
  const components = bookPackage.components || [];
  const units = components.flatMap((component) => component.units || []);
  const lessons = units.flatMap((unit) => unit.lessons || []);
  const exercises = lessons.flatMap((lesson) => lesson.exercises || []);
  const pageUnits = components.flatMap((component) => component.pageUnits || []);
  return (
    components.length * 10 +
    units.length * 8 +
    exercises.length * 4 +
    pageUnits.length * 3 +
    (bookPackage.source === "database" ? 1000 : 0)
  );
}

function canonicalPackageFields(identity, replacement = {}) {
  if (identity === "ultimate-b1" || identity === "ultimate-b1-plus") {
    const fallback = identity === "ultimate-b1" ? ultimateB1Package : ultimateB1PlusPackage;
    return {
      id: replacement.id,
      slug: identity,
      packageTitle: fallback.packageTitle,
      packageLabel: replacement.packageLabel || fallback.packageLabel,
    };
  }
  if (identity === "ultimate-b2") {
    return {
      id: replacement.id,
      slug: "ultimate-b2",
      packageTitle: "Ultimate B2",
      packageLabel: replacement.packageLabel || "Ultimate B2 package",
    };
  }
  if (identity === "english-journey-6") {
    return {
      id: replacement.id || "english-journey-6",
      slug: "english-journey-6",
      packageTitle: "English Journey 6",
      packageLabel: replacement.packageLabel || "English Journey 6 package",
    };
  }
  return {};
}

function mergeBookPackages(preferredPackage, fallbackPackage) {
  if (!fallbackPackage) return preferredPackage;
  const identity = normalizeBookPackageKey(preferredPackage) || normalizeBookPackageKey(fallbackPackage);
  const preferredComponents = preferredPackage.components?.length ? preferredPackage.components : fallbackPackage.components;
  return {
    ...fallbackPackage,
    ...preferredPackage,
    ...canonicalPackageFields(identity, preferredPackage),
    components: (preferredComponents || []).map((component) => (
      mergeComponentWithDemoFallback(component, findMatchingDemoComponent(fallbackPackage, component))
    )),
  };
}

export function mergeBookPackageWithDemoFallback(replacement) {
  const demoPackage = getDemoBookPackage(normalizeBookPackageKey(replacement) || replacement.slug || replacement.id || replacement.packageTitle);
  if (!demoPackage) return replacement;
  const replacementComponents = replacement.components?.length ? replacement.components : demoPackage.components;
  const identity = normalizeBookPackageKey(replacement) || normalizeBookPackageKey(demoPackage);
  return {
    ...demoPackage,
    ...replacement,
    ...canonicalPackageFields(identity, replacement),
    components: replacementComponents.map((component) => (
      mergeComponentWithDemoFallback(component, findMatchingDemoComponent(demoPackage, component))
    )),
  };
}

export function dedupeBookPackages(bookPackages = []) {
  const packagesByIdentity = new Map();
  const identityOrder = [];

  bookPackages.filter(Boolean).forEach((bookPackage) => {
    const identity = normalizeBookPackageKey(bookPackage);
    if (!identity) {
      identityOrder.push(Symbol("book-package"));
      packagesByIdentity.set(identityOrder[identityOrder.length - 1], bookPackage);
      return;
    }

    if (!packagesByIdentity.has(identity)) {
      identityOrder.push(identity);
      packagesByIdentity.set(identity, bookPackage);
      return;
    }

    const existing = packagesByIdentity.get(identity);
    const preferred = packageCompletenessScore(bookPackage) >= packageCompletenessScore(existing) ? bookPackage : existing;
    const fallback = preferred === bookPackage ? existing : bookPackage;
    packagesByIdentity.set(identity, mergeBookPackages(preferred, fallback));
  });

  return identityOrder.map((identity) => packagesByIdentity.get(identity));
}

export function replaceDemoBookPackage(bookPackages, replacement) {
  const replacementIdentity = normalizeBookPackageKey(replacement);
  if (!replacementIdentity) return bookPackages;
  const mergedReplacement = mergeBookPackageWithDemoFallback(replacement);
  let didReplace = false;
  const nextPackages = bookPackages.map((bookPackage) => {
    if (normalizeBookPackageKey(bookPackage) !== replacementIdentity) return bookPackage;
    didReplace = true;
    return mergeBookPackages(mergedReplacement, bookPackage);
  });
  return dedupeBookPackages(didReplace ? nextPackages : [...nextPackages, mergedReplacement]);
}

export function inferPackageSlugFromBookId(bookId = "") {
  const normalized = String(bookId || "").toLowerCase();
  if (normalized.startsWith("english-journey-6") || normalized.startsWith("ej6-")) return "english-journey-6";
  if (normalized.startsWith("ultimate-b1-plus")) return "ultimate-b1-plus";
  if (normalized.startsWith("ultimate-b1")) return "ultimate-b1";
  if (normalized.startsWith("ultimate-b2") || ["students-book", "workbook", "grammar-book", "test-book"].includes(normalized)) return "ultimate-b2";
  return "";
}
