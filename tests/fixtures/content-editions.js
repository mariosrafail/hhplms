import { CONTENT_SOURCE_SCHEMA, contentEdition } from "../../src/data/contentEditions.js";
import { studentsBookV3Sources } from "./students-book-publication-v3.js";
import { studentsBookUnits } from "./students-book-current.js";
import { buildBuilderPageAssetObjectKey } from "../../lib/book-assets/object-keys.js";
import { freezeEditionSource, prepareEditionRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-edition-domain.js";
import { createHash } from "node:crypto";
import { publishedManagedPageBytes, publishedManagedBookSources } from "./published-managed-book.js";

export const editionPageBytes = (editionId) => editionId === "greek"
  ? Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGNgqPjAUPEBAAf/AtHvWLIKAAAAAElFTkSuQmCC", "base64")
  : publishedManagedPageBytes;

export function editionFixtureInput(component, scope = "shared", revision = 1) {
  const componentSlug = `ultimate-b2-${component}`;
  const ordinal = component === "students-book" ? 1 : component === "workbook" ? 2 : scope === "greek" ? 4 : 3;
  const pageId = component === "workbook" ? "wb-page-one" : "gb-page-one";
  const bytes = editionPageBytes(scope);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const inputs = component === "students-book" ? studentsBookV3Sources() : {
    pages: { revision, units: structuredClone(studentsBookUnits), rows: [{
      id: `20000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
      stable_key: `${componentSlug}/pages/${pageId}`, label: `${scope} ${component}`,
      sort_order: 1, source_metadata: { is_active: true, section_title: "Synthetic page", printed_label: "1" },
      unit_id: studentsBookUnits[0].id, unit_slug: "unit-1", unit_title: "Unit 1", unit_number: 1,
      asset_id: `30000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
      book_slug: "ultimate-b2", component_slug: componentSlug, asset_role: "page_image",
      object_key: buildBuilderPageAssetObjectKey({ bookSlug: "ultimate-b2", componentSlug, pageId, checksum, extension: ".png" }),
      storage_profile: "private", storage_bucket: "isolated-editions-fixture", publication_status: "draft", access_level: "internal",
      mime_type: "image/png", byte_size: bytes.length, checksum_sha256: checksum, width: scope === "greek" ? 2 : 1, height: 1,
    }] },
    documents: { hotspots: null, activityLifecycle: null }, native: { index: null, activities: {}, assetRows: [] },
  };
  if (component !== "students-book") {
    const native = publishedManagedBookSources(componentSlug, { pageIds: [pageId], pageLayout: [{ unitNumber: 1, sortOrder: 1 }], title: "Edition fixture activity" });
    inputs.native = native.native;
    inputs.documents = native.documents;
  }
  return {
    schemaVersion: CONTENT_SOURCE_SCHEMA,
    sourceId: `10000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    bookSlug: "ultimate-b2", componentSlug,
    scope: scope === "shared" ? { kind: "shared", editionIds: ["international", "greek"] } : { kind: "edition", editionIds: [scope] },
    revision, inputs,
  };
}
export function editionFixtureSources(editionId) {
  return [editionFixtureInput("students-book"), editionFixtureInput("workbook"), editionFixtureInput("grammar-book", editionId)].map(freezeEditionSource);
}
export function editionFixtureRelease(editionId, sources = editionFixtureSources(editionId)) {
  return prepareEditionRelease({
    id: `40000000-0000-4000-8000-${editionId === "greek" ? "000000000002" : "000000000001"}`,
    number: 1, edition: contentEdition("ultimate-b2", editionId), sources,
  });
}
