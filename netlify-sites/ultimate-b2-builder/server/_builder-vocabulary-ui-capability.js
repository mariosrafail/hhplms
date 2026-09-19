// Migration 068 extends only B1/B1+ optional artwork validation. Historical
// releases and documents without these slots do not require the new capability.
export function requiresVocabularyUiSchema(ui) {
  return ["ultimate-b1-students-book", "ultimate-b1-plus-students-book"].includes(ui?.packageId)
    && ["active", "disabled", "pressed"].some((state) => Object.hasOwn(ui.assets || {}, `navibar.vocabulary.${state}`));
}

export async function vocabularyUiDatabaseReady(sql) {
  const rows = await sql`select to_regprocedure('builder_b1_vocabulary_ui_bindings()') is not null ready`;
  return rows[0]?.ready === true;
}
