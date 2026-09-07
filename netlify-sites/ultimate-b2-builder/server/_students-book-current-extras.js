import { validateCurrentUnitExtrasStructure, projectCurrentUnitExtras } from "../../../src/data/ultimate-b2/unitExtras.js";
import { loadStudentsBookPageAuthority } from "./_students-book-page-authority.js";
import { validateBuilderUnitExtraAssetReferences } from "./_builder-unit-extra-assets-store.js";

export async function validateCurrentUnitExtrasContext({ document, sql }) {
  validateCurrentUnitExtrasStructure(document);
  const authority = await loadStudentsBookPageAuthority(sql);
  const known = new Map([...authority.pages, ...authority.retained].map((page) => [page.id, page]));
  for (const setting of document.pages) {
    const page = known.get(setting.pageId);
    if (!page || setting.unitId !== page.unitSlug) throw new Error("unit_extra_page_ownership_invalid");
  }
  return authority;
}

export async function validateCurrentUnitExtrasMutation(context) {
  await validateCurrentUnitExtrasContext(context);
  await validateBuilderUnitExtraAssetReferences(context.sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", document: context.document });
}

export async function projectCurrentUnitExtrasPreview(document, { sql }) {
  return projectCurrentUnitExtras(document, await validateCurrentUnitExtrasContext({ document, sql }));
}
