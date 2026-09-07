import assert from "node:assert/strict";
import { canonicalStudentsBookPages } from "../../netlify-sites/ultimate-b2-builder/server/_builder-page-catalog.js";
import { createPublicationV2FixtureSources } from "./publication-v2.js";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";

export { canonicalStudentsBookPages };
export const studentsBookUnits = Array.from({ length: 10 }, (_, index) => ({ id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, slug: `unit-${index + 1}`, unit_number: index + 1, title: `Unit ${index + 1}`, sort_order: index + 1 }));

// Explicit current authored data, independent of the mutable empty baseline.
// The historical fixture itself remains untouched.
export function currentStudentsBookSources() {
  const sources = createPublicationV2FixtureSources();
  const ids = new Set(Object.keys(sources.native.activities));
  const payload = { ...sources.documents.hotspots.payload, pages: Object.fromEntries(Object.entries(sources.documents.hotspots.payload.pages).map(([id, hotspots]) => [id, hotspots.filter((hotspot) => ids.has(hotspot.activityKey))]).filter(([, hotspots]) => hotspots.length)) };
  sources.documents.hotspots = { ...sources.documents.hotspots, payload, sha256: builderDocumentSha256(payload) };
  return sources;
}

// SQL boundary fixture, not a replacement resolver. It exercises the actual
// page store + authority, checks query ownership and counts fixed read costs.
export function studentsBookPageSql({ rows = [], units = studentsBookUnits, onQuery = () => {}, otherSql = null } = {}) {
  return async (strings, ...values) => {
    const query = strings.join("?");
    onQuery(query, values);
    if (/builder_component_page_revisions revision/.test(query)) {
      assert.deepEqual(values, ["ultimate-b2", "ultimate-b2-students-book"]);
      return [{ id: "30000000-0000-4000-8000-000000000000", revision: 0, hotspot_revision: 0 }];
    }
    if (/from units unit/.test(query)) {
      assert.deepEqual(values, ["30000000-0000-4000-8000-000000000000"]);
      return structuredClone(units);
    }
    if (/from book_pages page/.test(query)) {
      assert.deepEqual(values, ["ultimate-b2", "ultimate-b2-students-book", "ultimate-b2-students-book/pages/%"]);
      return structuredClone(rows);
    }
    if (otherSql) return otherSql(strings, ...values);
    throw new Error("Unexpected query in Students Book page fixture");
  };
}

export function studentsBookContentSql(sources = null, onQuery = () => {}) {
  return studentsBookPageSql({ onQuery, otherSql: async (strings, ...values) => {
    assert.match(strings.join("?"), /builder_component_documents/);
    assert.deepEqual(values.slice(0, 2), ["ultimate-b2", "ultimate-b2-students-book"]);
    const type = values[2];
    const keys = Array.isArray(values[3]) ? values[3] : [values[3]];
    return keys.flatMap((key) => {
      const source = type === "hotspots" ? sources?.documents.hotspots : type === "native_activity_index" ? sources?.native.index : sources?.native.activities[key]?.[type === "native_activity_public" ? "public" : "teacher"];
      return source ? [{ document_key: key, schema_version: "1.0", revision: source.revision, payload: source.payload, payload_sha256: source.sha256 }] : [];
    });
  } });
}
