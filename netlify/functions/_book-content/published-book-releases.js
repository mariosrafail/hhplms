import { verifyImmutableComponentRelease } from "../../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { loadProductRelease, loadProductReleaseComponentRows } from "../../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication-store.js";
import { verifyProductReleaseEnvelope } from "../../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication-domain.js";
import { accessiblePackageIds } from "./shared.js";
import { LMS_PUBLISHED_COMPONENTS } from "./published-book-model.js";
import { publicationProducts } from "../../../src/data/publicationRegistry.js";
import { findProductComponent } from "../../../src/data/bookProductCatalog.js";

function exactProductEnvelope(product) {
  return {
    id: product.id, number: product.number, bookSlug: product.bookSlug,
    compilerId: product.compilerId, releaseSchemaVersion: product.releaseSchemaVersion,
    sourceSnapshotSha256: product.sourceSnapshotSha256, releaseSha256: product.releaseSha256,
    releaseNote: product.releaseNote, createdAt: new Date(product.createdAt).toISOString(),
    members: product.members.map(({ sourceSnapshotSha256: _source, ...member }) => member),
  };
}

export async function loadVerifiedPublishedBookFamily(sql, currentUser, { allowed: suppliedAllowed = null, componentRows = null } = {}) {
  const allowed = suppliedAllowed || await accessiblePackageIds(sql, currentUser);
  if (!allowed.length) return [];
  const heads = await sql`
    select package.id as package_id, package.slug as package_slug, package.title as package_title,
           head.product_release_id
    from book_packages package
    left join book_product_publication_heads head on head.book_package_id=package.id
    where package.slug=any(${publicationProducts.map((product) => product.bookSlug)}::text[]) and package.status='active' and package.id=any(${allowed}::uuid[])
  `;
  if (!heads.length) return [];
  const families = [];
  for (const head of heads) families.push(...await loadFamily(sql, head, componentRows));
  return families;
}

async function loadFamily(sql, head, componentRows) {
  if (head.product_release_id) {
    const product = await loadProductRelease(sql, { bookSlug: head.package_slug, productReleaseId: head.product_release_id });
    if (!product) throw new Error("publication_family_unavailable");
    const envelope = verifyProductReleaseEnvelope(exactProductEnvelope(product));
    const rows = await loadProductReleaseComponentRows(sql, { bookSlug: head.package_slug, productReleaseId: product.id });
    const byComponent = new Map(rows.map((row) => [row.component_slug, row]));
    const result = [];
    for (const member of envelope.members) {
      const row = byComponent.get(member.componentSlug);
      if (member.status === "unavailable") {
        if (row) throw new Error("publication_family_mismatch");
        continue;
      }
      if (!row || row.id !== member.componentReleaseId || row.compiler_id !== member.compilerId
        || row.release_schema_version !== member.releaseSchemaVersion || row.release_sha256 !== member.releaseSha256
        || row.runtime_compatibility_sha256 !== member.compatibility) throw new Error("publication_family_mismatch");
      result.push({ row: { ...row, package_slug: head.package_slug, package_title: head.package_title,
        component_title: findProductComponent(head.package_slug, row.component_slug)?.title }, verified: verifyImmutableComponentRelease(row), productReleaseId: product.id });
    }
    if (rows.length !== result.length) throw new Error("publication_family_mismatch");
    return result;
  }
  // Historical component-only publications retain their original access path.
  // A product family, once present, is never assembled from component latests.
  if (head.package_slug !== "ultimate-b2") return [];
  const rows = componentRows?.filter((row) => row.package_slug === "ultimate-b2") || await sql`
    select release.*, package.slug as package_slug, package.title as package_title,
           component.slug as component_slug, component.title as component_title
    from book_component_publication_heads head
    join book_component_releases release on release.id=head.release_id and release.book_component_id=head.book_component_id
    join book_packages package on package.id=release.book_package_id
    join book_components component on component.id=release.book_component_id and component.book_package_id=package.id
    where package.id=${head.package_id} and component.slug=any(${LMS_PUBLISHED_COMPONENTS}::text[])
      and exists(select 1 from book_component_publication_events event where event.release_id=release.id and event.book_component_id=component.id)
    order by component.sort_order, component.slug
  `;
  return rows.map((row) => ({ row, verified: verifyImmutableComponentRelease(row), productReleaseId: null }));
}
