import { newManagedPublicationComponents } from "../../../src/data/publicationRegistry.js";

const component = ({
  bookSlug,
  componentSlug,
  componentType,
  title,
  mode,
  pagePrefix = null,
  activityPrefix,
  hotspotMode,
  unitExtras = false,
  packageUiOwner = false,
  publication = false,
  legacyOpenResponseImport = false,
}) => Object.freeze({
  bookSlug,
  componentSlug,
  componentType,
  title,
  mode,
  pageCatalog: Object.freeze({
    mode,
    pagePrefix,
    unitNumbers: mode === "managed" ? Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) : null,
  }),
  content: Object.freeze({
    hotspots: hotspotMode,
    activityLifecycle: true,
    nativeActivities: true,
    unitExtras,
    legacyOpenResponseImport,
  }),
  nativeActivity: Object.freeze({
    mode,
    activityPrefix,
  }),
  packageUi: Object.freeze({
    owner: packageUiOwner,
    resource: "ui-controller",
    packageId: packageUiOwner ? componentSlug : null,
    storageNamespace: packageUiOwner ? `${bookSlug}/${componentSlug}` : null,
  }),
  storageNamespace: Object.freeze({
    pages: `${bookSlug}/${componentSlug}`,
    nativeActivities: `${bookSlug}/${componentSlug}`,
    fonts: `${bookSlug}/${componentSlug}`,
  }),
  publication: Object.freeze({ enabled: publication || newManagedPublicationComponents.some((entry) => entry.bookSlug === bookSlug && entry.componentSlug === componentSlug) }),
});

const registrations = [
  component({
    bookSlug: "ultimate-b2",
    componentSlug: "ultimate-b2-students-book",
    componentType: "students-book",
    title: "Students Book",
    mode: "canonical",
    activityPrefix: "ultimate-b2-sb",
    hotspotMode: "canonical",
    unitExtras: true,
    packageUiOwner: true,
    publication: true,
    legacyOpenResponseImport: true,
  }),
  component({
    bookSlug: "ultimate-b2",
    componentSlug: "ultimate-b2-workbook",
    componentType: "workbook",
    title: "Workbook",
    mode: "managed",
    pagePrefix: "wb",
    activityPrefix: "ultimate-b2-wb",
    hotspotMode: "managed",
    publication: true,
  }),
  component({
    bookSlug: "ultimate-b2",
    componentSlug: "ultimate-b2-grammar-book",
    componentType: "grammar-book",
    title: "Grammar Book",
    mode: "managed",
    pagePrefix: "gb",
    activityPrefix: "ultimate-b2-gb",
    hotspotMode: "managed",
    publication: true,
  }),
  component({
    bookSlug: "ultimate-b1",
    componentSlug: "ultimate-b1-students-book",
    componentType: "students-book",
    title: "Students Book",
    mode: "managed",
    pagePrefix: "b1-sb",
    activityPrefix: "ultimate-b1-sb",
    hotspotMode: "managed",
    packageUiOwner: true,
  }),
  component({
    bookSlug: "ultimate-b1",
    componentSlug: "ultimate-b1-workbook",
    componentType: "workbook",
    title: "Workbook",
    mode: "managed",
    pagePrefix: "b1-wb",
    activityPrefix: "ultimate-b1-wb",
    hotspotMode: "managed",
  }),
  component({
    bookSlug: "ultimate-b1",
    componentSlug: "ultimate-b1-grammar-book",
    componentType: "grammar-book",
    title: "Grammar Book",
    mode: "managed",
    pagePrefix: "b1-gb",
    activityPrefix: "ultimate-b1-gb",
    hotspotMode: "managed",
  }),
  component({
    bookSlug: "ultimate-b1-plus",
    componentSlug: "ultimate-b1-plus-students-book",
    componentType: "students-book",
    title: "Students Book",
    mode: "managed",
    pagePrefix: "b1-plus-sb",
    activityPrefix: "ultimate-b1-plus-sb",
    hotspotMode: "managed",
    packageUiOwner: true,
  }),
  component({
    bookSlug: "ultimate-b1-plus",
    componentSlug: "ultimate-b1-plus-workbook",
    componentType: "workbook",
    title: "Workbook",
    mode: "managed",
    pagePrefix: "b1-plus-wb",
    activityPrefix: "ultimate-b1-plus-wb",
    hotspotMode: "managed",
  }),
  component({
    bookSlug: "ultimate-b1-plus",
    componentSlug: "ultimate-b1-plus-grammar-book",
    componentType: "grammar-book",
    title: "Grammar Book",
    mode: "managed",
    pagePrefix: "b1-plus-gb",
    activityPrefix: "ultimate-b1-plus-gb",
    hotspotMode: "managed",
  }),
];

const keyFor = (bookSlug, componentSlug) => `${bookSlug}/${componentSlug}`;
const registry = Object.freeze(Object.fromEntries(registrations.map((entry) => [keyFor(entry.bookSlug, entry.componentSlug), entry])));

if (Object.keys(registry).length !== registrations.length) {
  throw new Error("Builder component registry contains a duplicate tuple.");
}

const packageUiRegistry = Object.freeze(Object.fromEntries(registrations
  .filter((entry) => entry.packageUi.owner)
  .map((entry) => [entry.bookSlug, Object.freeze({
    bookSlug: entry.bookSlug,
    componentSlug: entry.componentSlug,
    resource: entry.packageUi.resource,
    packageId: entry.packageUi.packageId,
    storageNamespace: entry.packageUi.storageNamespace,
  })])));

if (Object.keys(packageUiRegistry).length !== registrations.filter((entry) => entry.packageUi.owner).length) {
  throw new Error("Builder component registry contains multiple package UI owners.");
}

export function resolveBuilderServerComponent(bookSlug, componentSlug) {
  return registry[keyFor(bookSlug, componentSlug)] || null;
}

export function resolveBuilderPackageUi(bookSlug, componentSlug = "") {
  const identity = packageUiRegistry[bookSlug] || null;
  return identity && (!componentSlug || identity.componentSlug === componentSlug) ? identity : null;
}

export function listBuilderServerComponents() {
  return [...registrations];
}

export const builderServerComponentRegistry = registry;
export const builderPackageUiRegistry = packageUiRegistry;
