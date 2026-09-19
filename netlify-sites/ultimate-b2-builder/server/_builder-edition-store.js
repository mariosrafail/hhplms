import { contentEdition, requireEditionUuid } from "../../../src/data/contentEditions.js";
import { verifyEditionRelease, verifyEditionSource } from "./_builder-edition-domain.js";

export async function editionDatabaseReady(sql) {
  const rows = await sql`select to_regprocedure('mutate_builder_content_edition(uuid,uuid,jsonb)') is not null ready`;
  return rows[0]?.ready === true;
}
export async function mutateEdition(sql, actor, clientMutationId, request) {
  requireEditionUuid(actor); requireEditionUuid(clientMutationId);
  const rows = await sql`select mutate_builder_content_edition(${actor}::uuid,${clientMutationId}::uuid,${JSON.stringify(request)}::jsonb) result`;
  if (!rows[0]?.result) throw new Error("edition_mutation_unavailable");
  return rows[0].result;
}
export async function loadEditionStatus(sql, bookSlug, editionId) {
  const edition = contentEdition(bookSlug, editionId);
  const [sources, selections, heads, releases] = await Promise.all([
    sql`select revision.record from book_content_sources source
      join book_content_source_revisions revision on revision.source_id=source.id and revision.revision=source.revision
      join book_packages package on package.id=source.book_package_id
      where package.slug=${bookSlug} and source.scope->'editionIds' ? ${editionId} order by source.id`,
    sql`select selection.revision,component.slug component_slug,association.source_id
      from book_content_edition_selections selection join book_packages package on package.id=selection.book_package_id
      left join book_content_edition_sources association on association.book_package_id=selection.book_package_id and association.edition_id=selection.edition_id
      left join book_components component on component.id=association.book_component_id
      where package.slug=${bookSlug} and selection.edition_id=${editionId}`,
    sql`select head.revision,head.release_id from book_content_edition_heads head
      join book_packages package on package.id=head.book_package_id where package.slug=${bookSlug} and head.edition_id=${editionId}`,
    sql`select release.payload from book_content_edition_releases release join book_packages package on package.id=release.book_package_id
      where package.slug=${bookSlug} and release.edition_id=${editionId} order by release.release_number desc`,
  ]);
  return {
    edition,
    sources: sources.map(({ record }) => verifyEditionSource(record)),
    associations: Object.fromEntries(selections.filter((entry) => entry.source_id).map((entry) => [entry.component_slug, entry.source_id])),
    selectionRevision: Number(selections[0]?.revision || 0), headRevision: Number(heads[0]?.revision || 0),
    publishedReleaseId: heads[0]?.release_id || null,
    releases: releases.map(({ payload }) => verifyEditionRelease(payload, edition)),
  };
}
export async function loadEditionRelease(sql, { bookSlug, editionId, releaseId, publishedOnly = false }) {
  const edition = contentEdition(bookSlug, editionId); requireEditionUuid(releaseId);
  const rows = await sql`select release.payload from book_content_edition_releases release
    join book_packages package on package.id=release.book_package_id
    where package.slug=${bookSlug} and release.edition_id=${editionId} and release.id=${releaseId}::uuid
      and (${publishedOnly}=false or exists(select 1 from book_content_edition_publications publication where publication.release_id=release.id))`;
  return rows[0] ? verifyEditionRelease(rows[0].payload, edition) : null;
}
export async function editionUserAllowed(sql, currentUser, { bookSlug, editionId }) {
  contentEdition(bookSlug, editionId);
  const rows = await sql`select 1 allowed from book_content_edition_access access
    join app_users app_user on app_user.id=access.user_id and app_user.school_id=access.school_id
    join book_packages package on package.id=access.book_package_id
    where package.slug=${bookSlug} and access.edition_id=${editionId}
      and access.user_id=${currentUser.id}::uuid and access.school_id=${currentUser.school_id}::uuid
      and app_user.status='active'`;
  return rows.length === 1;
}
