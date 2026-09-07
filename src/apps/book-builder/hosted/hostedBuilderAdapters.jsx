import { lazy } from "react";

import { NATIVE_ACTIVITY_KINDS } from "../../../data/native-activities/nativeActivityKinds.js";

const UltimateB2StudentsBookHostedWorkspace = lazy(() => import(
  "../../ultimate-b2-builder/HostedUltimateB2BuilderApp.jsx"
).then((module) => ({ default: module.UltimateB2StudentsBookHostedWorkspace })));
const UltimateB2ManagedComponentHostedWorkspace = lazy(() => import(
  "../../ultimate-b2-builder/HostedUltimateB2BuilderApp.jsx"
).then((module) => ({ default: module.UltimateB2ManagedComponentHostedWorkspace })));
const UltimateB2PagesHostedWorkspace = lazy(() => import(
  "../../ultimate-b2-builder/HostedUltimateB2BuilderApp.jsx"
).then((module) => ({ default: module.UltimateB2PagesHostedWorkspace })));
const HostedManagedComponentWorkspace = lazy(() => import(
  "./HostedManagedComponentWorkspace.jsx"
).then((module) => ({ default: module.HostedManagedComponentWorkspace })));
const HostedTeacherUiController = lazy(() => import(
  "../../ultimate-b2-builder/HostedTeacherUiController.jsx"
).then((module) => ({ default: module.HostedTeacherUiController })));
const HostedSoundController = lazy(() => import(
  "../../ultimate-b2-builder/HostedSoundController.jsx"
).then((module) => ({ default: module.HostedSoundController })));

function UltimateB2StudentsBookWorkspace(props) {
  return props.tool === "pages" ? <UltimateB2PagesHostedWorkspace {...props} /> : <UltimateB2StudentsBookHostedWorkspace {...props} />;
}

const managedCapabilities = Object.freeze({
  pages: Object.freeze({ readable: true, writable: true }),
  hotspots: Object.freeze({ readable: true, writable: true }),
  activities: Object.freeze({ readable: true, writable: true }),
});

function managedAdapter({ id, bookSlug, bookTitle, componentSlug, componentTitle }) {
  return Object.freeze({
    id,
    bookSlug,
    componentSlug,
    nativeActivities: Object.freeze({ enabled: true, kinds: NATIVE_ACTIVITY_KINDS, placements: Object.freeze([]), managed: true }),
    capabilities: managedCapabilities,
    Workspace(props) { return <HostedManagedComponentWorkspace {...props} bookTitle={bookTitle} componentTitle={componentTitle} />; },
  });
}

const adapters = Object.freeze({
  "ultimate-b1-students-book": managedAdapter({ id: "ultimate-b1-students-book", bookSlug: "ultimate-b1", bookTitle: "Ultimate English B1", componentSlug: "ultimate-b1-students-book", componentTitle: "Students Book" }),
  "ultimate-b1-workbook": managedAdapter({ id: "ultimate-b1-workbook", bookSlug: "ultimate-b1", bookTitle: "Ultimate English B1", componentSlug: "ultimate-b1-workbook", componentTitle: "Workbook" }),
  "ultimate-b1-grammar-book": managedAdapter({ id: "ultimate-b1-grammar-book", bookSlug: "ultimate-b1", bookTitle: "Ultimate English B1", componentSlug: "ultimate-b1-grammar-book", componentTitle: "Grammar Book" }),
  "ultimate-b1-plus-students-book": managedAdapter({ id: "ultimate-b1-plus-students-book", bookSlug: "ultimate-b1-plus", bookTitle: "Ultimate English B1+", componentSlug: "ultimate-b1-plus-students-book", componentTitle: "Students Book" }),
  "ultimate-b1-plus-workbook": managedAdapter({ id: "ultimate-b1-plus-workbook", bookSlug: "ultimate-b1-plus", bookTitle: "Ultimate English B1+", componentSlug: "ultimate-b1-plus-workbook", componentTitle: "Workbook" }),
  "ultimate-b1-plus-grammar-book": managedAdapter({ id: "ultimate-b1-plus-grammar-book", bookSlug: "ultimate-b1-plus", bookTitle: "Ultimate English B1+", componentSlug: "ultimate-b1-plus-grammar-book", componentTitle: "Grammar Book" }),
  "ultimate-b2-students-book": Object.freeze({
    id: "ultimate-b2-students-book",
    bookSlug: "ultimate-b2",
    componentSlug: "ultimate-b2-students-book",
    nativeActivities: Object.freeze({ enabled: true, kinds: NATIVE_ACTIVITY_KINDS, placements: Object.freeze([]), managed: true }),
    capabilities: Object.freeze({
      pages: Object.freeze({ readable: true, writable: true }),
      hotspots: Object.freeze({ readable: true, writable: true }),
      activities: Object.freeze({ readable: true, writable: true }),
      publication: Object.freeze({ readable: true, writable: true }),
    }),
    Workspace: UltimateB2StudentsBookWorkspace,
  }),
  "ultimate-b2-workbook": Object.freeze({
    id: "ultimate-b2-workbook",
    bookSlug: "ultimate-b2",
    componentSlug: "ultimate-b2-workbook",
    nativeActivities: Object.freeze({ enabled: true, kinds: NATIVE_ACTIVITY_KINDS, placements: Object.freeze([]), managed: true }),
    capabilities: Object.freeze({ pages: Object.freeze({ readable: true, writable: true }), hotspots: Object.freeze({ readable: true, writable: true }), activities: Object.freeze({ readable: true, writable: true }), publication: Object.freeze({ readable: true, writable: true }) }),
    Workspace(props) { return props.tool === "pages" ? <UltimateB2PagesHostedWorkspace {...props} /> : <UltimateB2ManagedComponentHostedWorkspace {...props} />; },
  }),
  "ultimate-b2-grammar-book": Object.freeze({
    id: "ultimate-b2-grammar-book", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-grammar-book",
    nativeActivities: Object.freeze({ enabled: true, kinds: NATIVE_ACTIVITY_KINDS, placements: Object.freeze([]), managed: true }),
    capabilities: Object.freeze({ pages: Object.freeze({ readable: true, writable: true }), hotspots: Object.freeze({ readable: true, writable: true }), activities: Object.freeze({ readable: true, writable: true }), publication: Object.freeze({ readable: true, writable: true }) }),
    Workspace(props) { return props.tool === "pages" ? <UltimateB2PagesHostedWorkspace {...props} /> : <UltimateB2ManagedComponentHostedWorkspace {...props} />; },
  }),
});

export function resolveHostedBuilderAdapter(book, component) {
  if (!component?.adapterId) return null;
  const adapter = adapters[component.adapterId];
  if (!adapter || adapter.bookSlug !== book?.slug || adapter.componentSlug !== component.slug) return null;
  return adapter;
}

export const hostedBuilderAdapters = adapters;

const packageToolAdapters = Object.freeze({
  "ultimate-b1-page-ui": Object.freeze({ bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-students-book", Tool: HostedTeacherUiController }),
  "ultimate-b1-sounds": Object.freeze({ bookSlug: "ultimate-b1", componentSlug: "ultimate-b1-students-book", Tool: HostedSoundController }),
  "ultimate-b1-plus-page-ui": Object.freeze({ bookSlug: "ultimate-b1-plus", componentSlug: "ultimate-b1-plus-students-book", Tool: HostedTeacherUiController }),
  "ultimate-b1-plus-sounds": Object.freeze({ bookSlug: "ultimate-b1-plus", componentSlug: "ultimate-b1-plus-students-book", Tool: HostedSoundController }),
  "ultimate-b2-page-ui": Object.freeze({ bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", Tool: HostedTeacherUiController }),
  "ultimate-b2-sounds": Object.freeze({ bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", Tool: HostedSoundController }),
});

export function resolveHostedBuilderPackageTool(book, toolId) {
  const declaration = book?.packageTools?.find((tool) => tool.id === toolId);
  const adapter = declaration ? packageToolAdapters[declaration.adapterId] : null;
  const ownsUiComponent = book?.components?.some((component) => component.slug === adapter?.componentSlug);
  return adapter?.bookSlug === book?.slug && ownsUiComponent ? Object.freeze({ declaration, adapter }) : null;
}
