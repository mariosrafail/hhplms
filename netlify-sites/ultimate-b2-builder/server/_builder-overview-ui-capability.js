// Migration 064 extends B1 UI SQL validation, not base publication readiness.
// Inspect the document/projection being written; never infer immutable semantics
// from the current draft or require the feature merely because a book is B1.
export function requiresOverviewUiSchema(ui) {
  return ["ultimate-b1-students-book", "ultimate-b1-plus-students-book"].includes(ui?.packageId)
    && (["overviewCaptionFontFamily", "independentPartsBackgrounds"].some((key) => Object.hasOwn(ui, key))
      || ["background.workbook-parts", "background.grammar-book-parts"].some((key) => Object.hasOwn(ui.assets || {}, key)));
}

export async function overviewUiDatabaseReady(sql) {
  const rows = await sql`select to_regprocedure('builder_b1_overview_ui_settings_integrity(jsonb)') is not null ready`;
  return rows[0]?.ready === true;
}
