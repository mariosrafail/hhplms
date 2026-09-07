import repositoryHotspots from "../../../src/data/ultimate-b2/authoring/studentsBookHotspots.json" with { type: "json" };
import {
  ULTIMATE_B2_HOTSPOT_SCHEMA_VERSION,
  validateAndNormalizeUltimateB2HotspotManifest,
  validateUltimateB2HotspotManifestStructure,
  createEmptyManagedComponentHotspotManifest,
  validateAndNormalizeManagedComponentHotspotManifest,
  validateManagedComponentHotspotManifestStructure,
} from "../../../scripts/ultimate-b2/hotspot-manifest.js";
import { loadBuilderPages } from "./_builder-pages-store.js";
import { loadStudentsBookPageAuthority } from "./_students-book-page-authority.js";
import { normalizeStudentsBookCurrentHotspots, emptyStudentsBookCurrentHotspots } from "../../../src/data/ultimate-b2/studentsBookCurrentHotspots.js";
import { ultimateB2StudentsBookAuthoringActivities } from "../../../src/data/ultimate-b2/studentsBookAuthoringCatalog.js";
import {
  createUltimateB2HostedOpenResponseSeed,
  normalizeUltimateB2HostedOpenResponseDraft,
  ULTIMATE_B2_HOSTED_OPEN_RESPONSE_SCHEMA_VERSION,
} from "../../../src/data/ultimate-b2/hostedOpenResponseDraft.js";
import { isUltimateB2ConfigurableOpenResponse } from "../../../src/data/ultimate-b2/openResponseActivityRegistry.js";
import { findStudentsBookImplementation, isStudentsBookActivityEnabled } from "../../../src/data/ultimate-b2/studentsBookCatalog.js";
import { HOSTED_TEACHER_UI_SCHEMA_VERSION } from "../../../src/data/ultimate-b2/hostedTeacherUiBindingCatalog.js";
import { NATIVE_ACTIVITY_SCHEMA_VERSION, createEmptyNativeActivityIndex, normalizeNativeActivityIndex } from "../../../src/data/native-activities/nativeActivityPublic.js";
import { NATIVE_ACTIVITY_KINDS, normalizeNativeActivityPublicDocument, normalizeNativeActivityTeacherDocument } from "./_native-activity-registry.js";
import { resolveNativeActivityAdapter } from "./_native-activity-adapters.js";
import { applyUltimateB2ActivityLifecycle, createEmptyUltimateB2ActivityLifecycle, normalizeUltimateB2ActivityLifecycle, ULTIMATE_B2_ACTIVITY_LIFECYCLE_SCHEMA_VERSION } from "../../../src/data/ultimate-b2/activityLifecycle.js";
import { createEmptyUltimateB2UnitExtras, normalizeUltimateB2UnitExtrasDocument, projectUltimateB2UnitExtrasForPublication, ULTIMATE_B2_UNIT_EXTRAS_SCHEMA_VERSION } from "../../../src/data/ultimate-b2/unitExtras.js";
import { listBuilderServerComponents, resolveBuilderServerComponent } from "./_builder-component-registry.js";
import { createEmptyBuilderTeacherUiDocument, normalizeBuilderTeacherUiDocument, projectBuilderTeacherUiPreview } from "./_builder-teacher-ui-document.js";

async function loadUltimateB2HotspotActivityUniverse(loadRelated, { includeCanonical = true } = {}) {
  const lifecycle = includeCanonical
    ? (await loadRelated("activity-lifecycle", ""))?.document || createEmptyUltimateB2ActivityLifecycle()
    : null;
  const storedIndex = await loadRelated("native-activity-index", "");
  const index = storedIndex?.document || createEmptyNativeActivityIndex();
  const storedPublicDocuments = await loadRelated.batch("native-activity-public", index.activities.map((entry) => entry.activityId));
  const nativeActivities = [];
  for (const entry of index.activities) {
    const storedPublic = storedPublicDocuments.get(entry.activityId);
    const publicDocument = storedPublic?.document;
    if (!publicDocument || publicDocument.kind !== entry.kind || publicDocument.placement.pageId !== entry.placement.pageId) throw new Error(`Native activity ${entry.activityId} is incomplete.`);
    nativeActivities.push({ activityKey: entry.activityId, title: publicDocument.metadata.title, pageId: entry.placement.pageId, kind: entry.kind, native: true, hotspotPageInvariant: true });
  }
  const canonicalActivities = includeCanonical
    ? applyUltimateB2ActivityLifecycle(ultimateB2StudentsBookAuthoringActivities, lifecycle).map((activity) => ({
      ...activity,
      hotspotPageInvariant: lifecycle.activities[activity.activityKey]?.status === "active",
    }))
    : [];
  return [...canonicalActivities, ...nativeActivities];
}

const ultimateB2HotspotResource = Object.freeze({
  bookSlug: "ultimate-b2",
  componentSlug: "ultimate-b2-students-book",
  resource: "hotspots",
  documentType: "hotspots",
  documentKey: "default",
  schemaVersion: ULTIMATE_B2_HOTSPOT_SCHEMA_VERSION,
  readable: true,
  writeAllowed: true,
  previewReadable: true,
  baseline() {
    return emptyStudentsBookCurrentHotspots();
  },
  validate(document) {
    return normalizeStudentsBookCurrentHotspots(document);
  },
  async validateMutationContext({ document, loadRelated, sql }) {
    const [catalog, activities] = await Promise.all([loadStudentsBookPageAuthority(sql), loadUltimateB2HotspotActivityUniverse(loadRelated, { includeCanonical: false })]);
    normalizeStudentsBookCurrentHotspots(document, { pages: catalog.pages, activities, requireActivityPage: true });
  },
  requiredRelatedForPreview: Object.freeze(["native-activity-index", "native-activity-public"]),
  async projectPreview(document, { loadRelated, sql }) {
    const [catalog, activities] = await Promise.all([loadStudentsBookPageAuthority(sql), loadUltimateB2HotspotActivityUniverse(loadRelated, { includeCanonical: false })]);
    return normalizeStudentsBookCurrentHotspots(structuredClone(document), { pages: catalog.pages, activities });
  },
});

const serverComponents = Object.freeze(listBuilderServerComponents());
const managedComponents = Object.freeze(serverComponents.filter((component) => component.mode === "managed"));

function managedPages(stored, componentSlug) {
  const prefix = `${componentSlug}/pages/`;
  return (stored?.rows || []).filter((row) => row.source_metadata?.is_active === true && row.asset_id && row.unit_id).map((row) => ({
    id: String(row.stable_key).slice(prefix.length),
    unitNumber: Number(row.unit_number),
  }));
}

function managedHotspotResource(registration) {
  const { bookSlug, componentSlug } = registration;
  const identity = Object.freeze({ bookSlug, componentSlug });
  return Object.freeze({
    bookSlug, componentSlug, resource: "hotspots", documentType: "hotspots", documentKey: "default",
    schemaVersion: ULTIMATE_B2_HOTSPOT_SCHEMA_VERSION, readable: true, writeAllowed: true, previewReadable: true, previewAudience: "managed",
    baseline() { return createEmptyManagedComponentHotspotManifest(identity); },
    validate(document) { return validateManagedComponentHotspotManifestStructure(document, identity); },
    async validateMutationContext({ document, loadRelated, sql }) {
      const [storedPages, activities] = await Promise.all([
        loadBuilderPages(sql, identity),
        loadUltimateB2HotspotActivityUniverse(loadRelated, { includeCanonical: false }),
      ]);
      validateAndNormalizeManagedComponentHotspotManifest(document, { ...identity, pages: managedPages(storedPages, componentSlug), activities, requireActivityPage: true });
    },
    requiredRelatedForPreview: Object.freeze(["native-activity-index", "native-activity-public"]),
    async projectPreview(document, { loadRelated, sql }) {
      const [storedPages, activities] = await Promise.all([
        loadBuilderPages(sql, identity),
        loadUltimateB2HotspotActivityUniverse(loadRelated, { includeCanonical: false }),
      ]);
      return validateAndNormalizeManagedComponentHotspotManifest(structuredClone(document), { ...identity, pages: managedPages(storedPages, componentSlug), activities });
    },
  });
}

function managedActivityLifecycleResource({ bookSlug, componentSlug }) {
  return Object.freeze({
    bookSlug, componentSlug, resource: "activity-lifecycle", documentType: "activity_lifecycle", documentKey: "default",
    schemaVersion: ULTIMATE_B2_ACTIVITY_LIFECYCLE_SCHEMA_VERSION, readable: true, writeAllowed: false, previewReadable: false,
    baseline: createEmptyUltimateB2ActivityLifecycle, validate: normalizeUltimateB2ActivityLifecycle,
  });
}

function packageUiResource(registration) {
  const packageId = registration.packageUi.packageId;
  return Object.freeze({
    bookSlug: registration.bookSlug,
    componentSlug: registration.componentSlug,
    resource: "ui-controller",
    documentType: "teacher_ui",
    documentKey: "default",
    schemaVersion: HOSTED_TEACHER_UI_SCHEMA_VERSION,
    readable: true,
    writeAllowed: false,
    previewReadable: true,
    previewAudience: "teacher",
    previewRequiresStored: true,
    baseline() { return createEmptyBuilderTeacherUiDocument(packageId); },
    validate(document) { return normalizeBuilderTeacherUiDocument(document, packageId); },
    projectPreview(document) { return projectBuilderTeacherUiPreview(document, packageId); },
  });
}

const registry = Object.freeze({
  "ultimate-b2/ultimate-b2-students-book/hotspots": ultimateB2HotspotResource,
  "ultimate-b2/ultimate-b2-students-book/activity-lifecycle": Object.freeze({
    bookSlug: "ultimate-b2",
    componentSlug: "ultimate-b2-students-book",
    resource: "activity-lifecycle",
    documentType: "activity_lifecycle",
    documentKey: "default",
    schemaVersion: ULTIMATE_B2_ACTIVITY_LIFECYCLE_SCHEMA_VERSION,
    readable: true,
    writeAllowed: false,
    previewReadable: false,
    baseline: createEmptyUltimateB2ActivityLifecycle,
    validate: normalizeUltimateB2ActivityLifecycle,
  }),
  "ultimate-b2/ultimate-b2-students-book/unit-extras": Object.freeze({
    bookSlug: "ultimate-b2",
    componentSlug: "ultimate-b2-students-book",
    resource: "unit-extras",
    documentType: "unit_extras",
    documentKey: "default",
    schemaVersion: ULTIMATE_B2_UNIT_EXTRAS_SCHEMA_VERSION,
    audience: "public",
    readable: true,
    writeAllowed: true,
    previewReadable: true,
    previewAudience: "unit-extras",
    previewRequiresStored: true,
    baseline: createEmptyUltimateB2UnitExtras,
    validate: normalizeUltimateB2UnitExtrasDocument,
    projectPreview: projectUltimateB2UnitExtrasForPublication,
  }),
  ...Object.fromEntries(managedComponents.flatMap((registration) => [
    [`${registration.bookSlug}/${registration.componentSlug}/hotspots`, managedHotspotResource(registration)],
    [`${registration.bookSlug}/${registration.componentSlug}/activity-lifecycle`, managedActivityLifecycleResource(registration)],
  ])),
  ...Object.fromEntries(serverComponents.filter((registration) => registration.packageUi.owner).map((registration) => [
    `${registration.bookSlug}/${registration.componentSlug}/ui-controller`, packageUiResource(registration),
  ])),
});

const nativeActivityIdPattern = /^[a-z0-9][a-z0-9-]{0,127}$/;
function nativeComponent(bookSlug, componentSlug) {
  const registration = resolveBuilderServerComponent(bookSlug, componentSlug);
  return registration?.content.nativeActivities === true
    ? Object.freeze({ bookSlug, componentSlug }) : null;
}

function nativeIndexResource(bookSlug, componentSlug, resource, documentKey) {
  const component = nativeComponent(bookSlug, componentSlug);
  if (!component || resource !== "native-activity-index" || documentKey) return null;
  const adapter = resolveNativeActivityAdapter(bookSlug, componentSlug);
  return Object.freeze({ ...component, resource, documentType: "native_activity_index", documentKey: "default", schemaVersion: NATIVE_ACTIVITY_SCHEMA_VERSION, audience: "public", readable: true, writeAllowed: false, previewReadable: false, baseline: createEmptyNativeActivityIndex, validate(document) {
    const normalized = normalizeNativeActivityIndex(document, { allowedKinds: NATIVE_ACTIVITY_KINDS });
    if (!adapter || normalized.activities.some((entry) => !adapter.ownsActivityId?.(entry.activityId))) throw new Error("Native activity index contains a foreign component identity.");
    return normalized;
  } });
}

function nativeDocumentResource(bookSlug, componentSlug, resource, documentKey) {
  const component = nativeComponent(bookSlug, componentSlug);
  const adapter = resolveNativeActivityAdapter(bookSlug, componentSlug);
  if (!component || !adapter?.ownsActivityId?.(documentKey) || !nativeActivityIdPattern.test(documentKey)) return null;
  const teacher = resource === "native-activity-teacher";
  if (!teacher && resource !== "native-activity-public") return null;
  return Object.freeze({
    ...component,
    resource,
    documentType: teacher ? "native_activity_teacher" : "native_activity_public",
    documentKey,
    schemaVersion: NATIVE_ACTIVITY_SCHEMA_VERSION,
    audience: teacher ? "teacher" : "public",
    readable: true,
    writeAllowed: false,
    previewReadable: false,
    requiresStored: true,
    baseline() { throw new Error("Native activity documents have no repository baseline."); },
    validate(document) { return teacher ? normalizeNativeActivityTeacherDocument(document, documentKey) : normalizeNativeActivityPublicDocument(document, documentKey); },
  });
}

function resolveOpenResponseResource(bookSlug, componentSlug, resource, documentKey) {
  if (bookSlug !== "ultimate-b2" || componentSlug !== "ultimate-b2-students-book" || resource !== "open-response") return null;
  const activity = findStudentsBookImplementation(documentKey);
  if (!activity || !isStudentsBookActivityEnabled(activity) || !isUltimateB2ConfigurableOpenResponse(activity)) return null;
  const canonicalSeed = createUltimateB2HostedOpenResponseSeed(activity);
  return Object.freeze({
    bookSlug,
    componentSlug,
    resource,
    documentType: "open_response",
    documentKey: activity.stableNormalizedId,
    schemaVersion: ULTIMATE_B2_HOSTED_OPEN_RESPONSE_SCHEMA_VERSION,
    readable: true,
    writeAllowed: true,
    previewReadable: true,
    previewRequiresStored: true,
    baseline() {
      return structuredClone(canonicalSeed);
    },
    validate(document) {
      return normalizeUltimateB2HostedOpenResponseDraft(document, canonicalSeed);
    },
    projectPreview(document) {
      return normalizeUltimateB2HostedOpenResponseDraft(document, canonicalSeed);
    },
  });
}

export async function resolveBuilderContentResource(bookSlug, componentSlug, resource, documentKey = "") {
  const nativeResource = nativeIndexResource(bookSlug, componentSlug, resource, documentKey) || nativeDocumentResource(bookSlug, componentSlug, resource, documentKey);
  if (nativeResource) return nativeResource;
  const openResponse = resolveOpenResponseResource(bookSlug, componentSlug, resource, documentKey);
  if (openResponse) return openResponse;
  if (documentKey) return null;
  return registry[`${bookSlug}/${componentSlug}/${resource}`] || null;
}

export const builderContentResourceRegistry = registry;
