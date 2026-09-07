import { loadBuilderPages } from "./_builder-pages-store.js";
import { resolveBuilderContentResource } from "./_builder-content-registry.js";
import { normalizeStoredBuilderDocument, loadNativePublicationAssets } from "./_builder-publication-store.js";
import { nativeTeacherAnswerImages } from "../../../src/data/native-activities/nativeImageSampleAnswer.js";
import { studentsBookPageScope } from "./_students-book-page-authority.js";

export async function collectStudentsBookPublicationV3Sources(sql) {
  const { bookSlug, componentSlug } = studentsBookPageScope;
  const [pages, rows] = await Promise.all([
    loadBuilderPages(sql, studentsBookPageScope),
    sql`
      select coalesce(jsonb_agg(jsonb_build_object(
        'document_type',document.document_type,'document_key',document.document_key,'schema_version',document.schema_version,
        'revision',document.revision,'payload',document.payload,'payload_sha256',document.payload_sha256
      ) order by document.document_type,document.document_key) filter(where document.id is not null), '[]'::jsonb) documents
      from book_packages package
      join book_components component on component.book_package_id=package.id
      left join builder_component_documents document on document.book_component_id=component.id and document.book_package_id=package.id
        and document.document_type in ('hotspots','native_activity_index','native_activity_public','native_activity_teacher','unit_extras','teacher_ui')
      where package.slug=${bookSlug} and component.slug=${componentSlug}
      group by component.id limit 1
    `,
  ]);
  if (!pages || !rows[0]) throw new Error("Publication component is unavailable");
  const documents = new Map((rows[0].documents || []).map((row) => [`${row.document_type}/${row.document_key}`, row]));
  async function read(type, resourceName, key = "default") {
    const row = documents.get(`${type}/${key}`);
    if (!row) return null;
    const resource = await resolveBuilderContentResource(bookSlug, componentSlug, resourceName, key === "default" ? undefined : key);
    const normalized = normalizeStoredBuilderDocument(row, resource);
    // Validation does not replace the original authored payload. The checksum
    // and revision continue to identify the raw persisted document.
    return { ...normalized, payload: structuredClone(row.payload) };
  }
  const [index, hotspots, unitExtras, teacherUi] = await Promise.all([
    read("native_activity_index", "native-activity-index"), read("hotspots", "hotspots"), read("unit_extras", "unit-extras"), read("teacher_ui", "ui-controller"),
  ]);
  const activities = {};
  for (const entry of index?.payload.activities || []) {
    const [publicSource, teacherSource] = await Promise.all([read("native_activity_public", "native-activity-public", entry.activityId), read("native_activity_teacher", "native-activity-teacher", entry.activityId)]);
    activities[entry.activityId] = { index: entry, public: publicSource, teacher: teacherSource };
  }
  const references = Object.values(activities).flatMap((entry) => [...(entry.public?.payload.assets || []), ...nativeTeacherAnswerImages(entry.teacher?.payload).map((image) => image.reference)]);
  const extraReferences = (unitExtras?.payload.units || []).flatMap((unit) => [...unit.categories.videos, ...(unit.categories.audios || [])].flatMap((entry) => entry.asset ? [entry.asset] : []));
  const [assetRows, extraRows] = await Promise.all([
    loadNativePublicationAssets(sql, { ...studentsBookPageScope, references }), loadNativePublicationAssets(sql, { ...studentsBookPageScope, references: extraReferences }),
  ]);
  return { pages, documents: { hotspots, teacherUi }, native: { index, activities, assetRows }, unitExtras: { document: unitExtras, assetRows: extraRows } };
}
