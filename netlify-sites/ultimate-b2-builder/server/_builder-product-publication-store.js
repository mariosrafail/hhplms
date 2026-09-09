function member(row) {
  return {
    componentSlug: row.component_slug,
    order: Number(row.member_order),
    status: row.member_status,
    componentReleaseId: row.component_release_id,
    compilerId: row.component_compiler_id,
    releaseSchemaVersion: row.component_release_schema_version,
    releaseSha256: row.component_release_sha256,
    compatibility: row.runtime_compatibility_sha256,
    memberSha256: row.member_sha256,
    unavailableReason: row.unavailable_reason,
    sourceSnapshotSha256: row.component_source_snapshot_sha256 || null,
  };
}

function release(rows) {
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    number: Number(row.release_number),
    bookSlug: row.book_slug,
    compilerId: row.compiler_id,
    releaseSchemaVersion: row.release_schema_version,
    sourceSnapshotSha256: row.source_snapshot_sha256,
    releaseSha256: row.release_sha256,
    releaseNote: row.release_note || "",
    createdAt: row.created_at,
    current: row.is_current === true,
    headRevision: row.head_revision === null ? null : Number(row.head_revision),
    publishedAt: row.published_at || null,
    members: rows.map(member),
  };
}

export async function productPublicationDatabaseReady(sql, bookSlug = "ultimate-b2") {
  const rows = await sql`
    select to_regclass('book_product_releases') is not null
      and to_regprocedure('create_builder_product_release(uuid,text,text,text,jsonb,text,text,uuid,uuid)') is not null
      and to_regprocedure('builder_students_book_v3_sources_are_current(uuid)') is not null
      and to_regprocedure('publish_builder_product_release(text,uuid,bigint,text,uuid,uuid)') is not null
      and (${bookSlug}='ultimate-b2' or to_regprocedure('builder_b1_publication_contract(text)') is not null) ready
  `;
  return rows[0]?.ready === true;
}

export async function productPublicationPinDatabaseReady(sql) {
  const rows = await sql`
    select to_regclass('book_component_release_asset_pins') is not null
      and exists(select 1 from information_schema.columns where table_schema=current_schema()
        and table_name='book_component_releases' and column_name='asset_storage_mode')
      and to_regprocedure('create_builder_pinned_product_release(uuid,text,text,text,jsonb,text,text,uuid,uuid)') is not null
      and exists(
        select 1 from pg_constraint constraint_record
        join pg_class relation on relation.oid=constraint_record.conrelid
        join pg_namespace namespace on namespace.oid=relation.relnamespace
        where namespace.nspname=current_schema() and relation.relname='book_component_release_asset_pins'
          and constraint_record.contype='p'
          and pg_get_constraintdef(constraint_record.oid)='PRIMARY KEY (component_release_id, checksum_sha256, extension, asset_role)'
      ) ready
  `;
  return rows[0]?.ready === true;
}

export async function createProductRelease(sql, input) {
  const rows = await sql`select * from create_builder_pinned_product_release(
    ${input.productReleaseId}::uuid,${input.bookSlug},${input.releaseSchemaVersion},${input.compilerId},
    ${JSON.stringify(input.members)}::jsonb,${input.requestSha256},${input.releaseNote},${input.builderUserId}::uuid,${input.clientMutationId}::uuid
  )`;
  const row = rows[0];
  if (!row) throw new Error("Product release creation returned no result");
  return {
    outcome: row.outcome,
    productReleaseId: row.product_release_id,
    releaseNumber: row.product_release_number === null ? null : Number(row.product_release_number),
    sourceSnapshotSha256: row.source_snapshot_sha256,
    releaseSha256: row.release_sha256,
    members: row.members || [],
  };
}

export async function loadProductPublicationAssetModes(sql, { bookSlug, productReleaseId = null }) {
  const rows = await sql`
    select product.id product_release_id,component.slug component_slug,release.asset_storage_mode
    from book_product_releases product
    join book_packages package on package.id=product.book_package_id
    join book_product_release_members member on member.product_release_id=product.id and member.member_status='included'
    join book_components component on component.id=member.book_component_id
    join book_component_releases release on release.id=member.component_release_id
    where package.slug=${bookSlug} and (${productReleaseId}::uuid is null or product.id=${productReleaseId}::uuid)
    order by product.release_number desc,member.member_order
  `;
  return rows;
}

export async function publishProductRelease(sql, input) {
  const rows = await sql`select * from publish_builder_product_release(
    ${input.bookSlug},${input.productReleaseId}::uuid,${input.expectedHeadRevision},${input.requestSha256},${input.builderUserId}::uuid,${input.clientMutationId}::uuid
  )`;
  const row = rows[0];
  if (!row) throw new Error("Product publication returned no result");
  return {
    outcome: row.outcome,
    productReleaseId: row.product_release_id,
    releaseNumber: row.product_release_number === null ? null : Number(row.product_release_number),
    headRevision: row.head_revision === null ? null : Number(row.head_revision),
    previousProductReleaseId: row.previous_product_release_id,
    publishedAt: row.published_at,
  };
}

export async function loadProductRelease(sql, { bookSlug, productReleaseId, activeOnly = false }) {
  const rows = await sql`
    select product.*,package.slug book_slug,head.product_release_id=product.id is_current,head.head_revision,head.published_at,
      family_member.member_order,family_member.member_status,family_member.component_release_id,
      family_member.component_compiler_id,family_member.component_release_schema_version,family_member.component_release_sha256,
      family_member.runtime_compatibility_sha256,family_member.member_sha256,family_member.unavailable_reason,
      component.slug component_slug,component_release.source_snapshot_sha256 component_source_snapshot_sha256
    from book_product_releases product
    join book_packages package on package.id=product.book_package_id
    join book_product_release_members family_member on family_member.product_release_id=product.id
    join book_components component on component.id=family_member.book_component_id
    left join book_component_releases component_release on component_release.id=family_member.component_release_id
    left join book_product_publication_heads head on head.book_package_id=product.book_package_id
    where package.slug=${bookSlug} and product.id=${productReleaseId}::uuid
      and (${activeOnly}::boolean=false or head.product_release_id=product.id)
    order by family_member.member_order
  `;
  return release(rows);
}

export async function loadProductReleaseComponentRows(sql, { bookSlug, productReleaseId }) {
  return sql`
    select component.slug component_slug,component_release.*
    from book_product_release_members family_member
    join book_product_releases product on product.id=family_member.product_release_id
    join book_packages package on package.id=product.book_package_id
    join book_components component on component.id=family_member.book_component_id
    join book_component_releases component_release on component_release.id=family_member.component_release_id
    where package.slug=${bookSlug} and product.id=${productReleaseId}::uuid and family_member.member_status='included'
    order by family_member.member_order
  `;
}

export async function loadProductPublicationStatus(sql, bookSlug) {
  const rows = await sql`
    select product.*,package.slug book_slug,head.product_release_id=product.id is_current,head.head_revision,head.published_at,
      family_member.member_order,family_member.member_status,family_member.component_release_id,
      family_member.component_compiler_id,family_member.component_release_schema_version,family_member.component_release_sha256,
      family_member.runtime_compatibility_sha256,family_member.member_sha256,family_member.unavailable_reason,
      component.slug component_slug,component_release.source_snapshot_sha256 component_source_snapshot_sha256
    from book_product_releases product
    join book_packages package on package.id=product.book_package_id
    join book_product_release_members family_member on family_member.product_release_id=product.id
    join book_components component on component.id=family_member.book_component_id
    left join book_component_releases component_release on component_release.id=family_member.component_release_id
    left join book_product_publication_heads head on head.book_package_id=product.book_package_id
    where package.slug=${bookSlug}
    order by product.release_number desc,family_member.member_order
  `;
  const grouped = [];
  for (const row of rows) {
    let current = grouped.at(-1);
    if (!current || current[0].id !== row.id) { current = []; grouped.push(current); }
    current.push(row);
  }
  const releases = grouped.map(release);
  const published = releases.find((candidate) => candidate.current) || null;
  return { headRevision: published?.headRevision || 0, published, releases };
}

export async function loadProductPublicationMutation(sql, { bookSlug, clientMutationId }) {
  const rows = await sql`
    select mutation.product_release_id,mutation.request_sha256,mutation.outcome,mutation.resulting_head_revision
    from book_product_publication_mutations mutation
    join book_packages package on package.id=mutation.book_package_id
    where package.slug=${bookSlug} and mutation.client_mutation_id=${clientMutationId}::uuid limit 1
  `;
  return rows[0] || null;
}
