import { requireEditionUuid, contentEdition } from "../../../src/data/contentEditions.js";
import { verifyWordListEdition } from "./_builder-wordlist-domain.js";

export async function wordListDatabaseReady(sql) {
  return (await sql`select to_regprocedure('mutate_builder_wordlist(uuid,uuid,jsonb)') is not null ready`)[0]?.ready === true;
}
export async function mutateWordList(sql, actor, id, request) {
  requireEditionUuid(actor); requireEditionUuid(id);
  return (await sql`select mutate_builder_wordlist(${actor}::uuid,${id}::uuid,${JSON.stringify(request)}::jsonb) result`)[0].result;
}
export async function loadWordList(sql, targetSourceId, datasetKey = "publisher-wordlist") {
  requireEditionUuid(targetSourceId);
  const rows = await sql`select source.id, source.revision, revision.record from book_wordlist_sources source
    left join book_wordlist_revisions revision on revision.source_id=source.id and revision.revision=source.revision
    where source.target_source_id=${targetSourceId}::uuid and source.dataset_key=${datasetKey}`;
  return rows[0] || null;
}
export async function loadWordListBindings(sql, sourceId, sha256 = null) {
  requireEditionUuid(sourceId);
  return (await sql`select binding from book_wordlist_audio where source_id=${sourceId}::uuid and (${sha256}::text is null or sha256=${sha256}) order by sha256`).map((row) => row.binding);
}
export async function loadWordListSession(sql, actor, sessionId, audioSha256 = null) {
  requireEditionUuid(sessionId);
  return (await sql`select id,case when ${audioSha256}::text is null then request else
    (request-array['dataset','mappings','requiredAudio'])||jsonb_build_object('requiredAudio',
      (select coalesce(jsonb_agg(a),'[]') from jsonb_array_elements(request->'requiredAudio') a where a->>'sha256'=${audioSha256})) end request,
    state,expires_at from book_wordlist_sessions where id=${sessionId}::uuid and actor_id=${actor}::uuid`)[0] || null;
}
export async function wordListReleaseStatus(sql, { bookSlug, editionId }) {
  const [rows, heads] = await Promise.all([
    sql`select release.payload from book_wordlist_edition_releases release join book_packages package on package.id=release.book_package_id
      where package.slug=${bookSlug} and release.edition_id=${editionId} order by release.release_number desc`,
    sql`select head.revision,head.release_id from book_wordlist_edition_heads head join book_packages package on package.id=head.book_package_id
      where package.slug=${bookSlug} and head.edition_id=${editionId}`,
  ]);
  const edition = contentEdition(bookSlug, editionId);
  return { releases: rows.map((row) => verifyWordListEdition(row.payload, edition)), headRevision: Number(heads[0]?.revision || 0), publishedReleaseId: heads[0]?.release_id || null };
}
export async function loadWordListEdition(sql, { bookSlug, editionId, releaseId, publishedOnly = false }) {
  requireEditionUuid(releaseId); const edition = contentEdition(bookSlug, editionId);
  const rows = await sql`select release.payload from book_wordlist_edition_releases release join book_packages package on package.id=release.book_package_id
    where package.slug=${bookSlug} and release.edition_id=${editionId} and release.id=${releaseId}::uuid
    and (${publishedOnly}=false or exists(select 1 from book_wordlist_edition_publications publication where publication.release_id=release.id))`;
  return rows[0] ? verifyWordListEdition(rows[0].payload, edition) : null;
}
