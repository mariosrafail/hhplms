import { collectManagedPublicationSources, normalizeStoredBuilderDocument } from "./_builder-publication-store.js";
import { resolveBuilderContentResource } from "./_builder-content-registry.js";
import { managedUiV2Components } from "./_builder-managed-ui-publication-compiler.js";

export async function collectManagedUiPublicationSources(sql, bookSlug, componentSlug) {
  if (!managedUiV2Components.includes(componentSlug) || componentSlug !== `${bookSlug}-students-book`) throw new Error("publication_compiler_mismatch");
  const [sources, rows] = await Promise.all([
    collectManagedPublicationSources(sql, bookSlug, componentSlug),
    sql`select document.* from builder_component_documents document
      join book_packages package on package.id=document.book_package_id
      join book_components component on component.id=document.book_component_id and component.book_package_id=package.id
      where package.slug=${bookSlug} and component.slug=${componentSlug}
        and document.document_type='teacher_ui' and document.document_key='default'`,
  ]);
  if (rows.length > 1) throw new Error("release_integrity_failed");
  let teacherUi = null;
  if (rows[0]) {
    const resource = await resolveBuilderContentResource(bookSlug, componentSlug, "ui-controller");
    teacherUi = normalizeStoredBuilderDocument(rows[0], resource);
    if (resource.validateReadContext) await resource.validateReadContext({ document: rows[0].payload, sql });
    teacherUi = { ...teacherUi, payload: structuredClone(rows[0].payload) };
  }
  return { ...sources, documents: { ...sources.documents, teacherUi } };
}
