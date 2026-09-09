function normalizeBuilderPageRevision(value, { nullable }) {
  if (value === null && nullable) return null;
  const normalized = typeof value === "number"
    ? value
    : typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error("invalid_builder_page_revision");
  }
  return normalized;
}

function normalizeRevisionField(row, field, options = { nullable: true }) {
  return row ? { ...row, [field]: normalizeBuilderPageRevision(row[field], options) } : null;
}

export async function loadBuilderPages(sql, { bookSlug, componentSlug }) {
  const components = await sql`
    select component.id,coalesce(revision.revision,0) revision,
      coalesce((select document.revision from builder_component_documents document where document.book_component_id=component.id and document.document_type='hotspots' and document.document_key='default'),0) hotspot_revision
    from book_packages package join book_components component on component.book_package_id=package.id
    left join builder_component_page_revisions revision on revision.book_component_id=component.id
    where package.slug=${bookSlug} and component.slug=${componentSlug} limit 1
  `;
  if (!components[0]) return null;
  const units = await sql`
    select unit.id,unit.slug,unit.title,unit.unit_number,unit.sort_order
    from units unit
    where unit.book_component_id=${components[0].id}
      and unit.unit_number between 1 and 10
    order by unit.sort_order,unit.unit_number,unit.slug
  `;
  const rows = await sql`
    select page.id,page.stable_key,page.label,page.sort_order,page.source_metadata,page.unit_id,
      unit.slug unit_slug,unit.title unit_title,unit.unit_number,unit.sort_order unit_sort_order,
      asset.id asset_id,package.slug book_slug,component.slug component_slug,
      asset.book_package_id,asset.book_component_id,asset.object_key,asset.asset_role,asset.storage_profile,asset.storage_bucket,
      asset.publication_status,asset.access_level,asset.mime_type,asset.byte_size,asset.checksum_sha256,asset.width,asset.height
    from book_pages page
    join book_packages package on package.id=page.book_package_id
    join book_components component on component.id=page.book_component_id and component.book_package_id=package.id
    left join lateral (
      select candidate.* from book_assets candidate
      where candidate.page_id=page.id and candidate.asset_role='page_image' and candidate.publication_status='draft'
        and (package.slug='ultimate-b2' or candidate.book_package_id=package.id and candidate.book_component_id=component.id)
      order by candidate.updated_at desc,case when package.slug<>'ultimate-b2' then candidate.id end desc limit 1
    ) asset on true
    left join units unit on unit.id=page.unit_id and unit.book_component_id=page.book_component_id
    where package.slug=${bookSlug} and component.slug=${componentSlug}
      and page.stable_key like ${`${componentSlug}/pages/%`}
    order by unit.sort_order nulls last,page.sort_order,page.stable_key
  `;
  return { revision: normalizeBuilderPageRevision(components[0].revision, { nullable: false }), hotspotRevision: normalizeBuilderPageRevision(components[0].hotspot_revision ?? 0, { nullable: false }), units, rows };
}

export async function prepareBuilderPageUpload(sql, input) {
  const rows = await sql`select * from prepare_builder_component_page_upload(
    ${input.bookSlug},${input.componentSlug},${input.pageKey},${input.mode},${input.expectedRevision},
    ${input.clientMutationId}::uuid,${input.uploadId}::uuid,${input.requestSha256},${JSON.stringify(input.pageMetadata)}::jsonb,
    ${JSON.stringify(input.fileDescriptor)}::jsonb,${input.stagingObjectKey},${input.builderUserId}::uuid,${input.expiresAt}
  )`;
  return normalizeRevisionField(rows[0] || null, "current_revision");
}

export async function claimBuilderPageUpload(sql, input) {
  const rows = await sql`select * from claim_builder_component_page_upload(${input.uploadId}::uuid,${input.expectedRevision},${input.clientMutationId}::uuid,${input.builderUserId}::uuid)`;
  return normalizeRevisionField(rows[0] || null, "current_revision");
}

export async function loadBuilderPageUploadScope(sql, { uploadId, builderUserId }) {
  const rows = await sql`
    select package.slug book_slug,component.slug component_slug
    from builder_component_page_upload_sessions upload
    join book_packages package on package.id=upload.book_package_id
    join book_components component
      on component.id=upload.book_component_id
      and component.book_package_id=package.id
    where upload.id=${uploadId}::uuid
      and upload.created_by_builder_user_id=${builderUserId}::uuid
    limit 1
  `;
  const row = rows[0];
  return row ? { bookSlug: row.book_slug, componentSlug: row.component_slug } : null;
}

export async function completeBuilderPageUpload(sql, input) {
  const rows = await sql`select * from complete_builder_component_page_upload(
    ${input.uploadId}::uuid,${input.builderUserId}::uuid,${input.objectKey},${input.storageBucket},${input.mimeType},
    ${input.byteSize},${input.checksumSha256},${input.width},${input.height}
  )`;
  return normalizeRevisionField(rows[0] || null, "revision", { nullable: false });
}

export async function failBuilderPageUpload(sql, input) {
  const rows = await sql`select fail_builder_component_page_upload(${input.uploadId}::uuid,${input.builderUserId}::uuid,${input.failureCode}) failed`;
  return rows[0]?.failed === true;
}

export async function mutateBuilderPage(sql, input) {
  const rows = await sql`select * from mutate_builder_component_page(
    ${input.bookSlug},${input.componentSlug},${input.pageKey},${input.action},${input.expectedRevision},
    ${input.clientMutationId}::uuid,${JSON.stringify(input.pageMetadata)}::jsonb,${input.builderUserId}::uuid
  )`;
  return normalizeRevisionField(rows[0] || null, "current_revision");
}

function canonicalPageDescriptor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_canonical_builder_page");
  const descriptor = {
    stableKey: String(value.stableKey || ""),
    unitNumber: Number(value.unitNumber),
    label: String(value.label || ""),
    printedLabel: String(value.printedLabel || ""),
    sortOrder: Number(value.sortOrder),
    checksumSha256: String(value.checksumSha256 || ""),
    mimeType: String(value.mimeType || ""),
    width: Number(value.width),
    height: Number(value.height),
  };
  if (!/^[a-z0-9][a-z0-9._/-]{0,255}$/.test(descriptor.stableKey)
    || !Number.isSafeInteger(descriptor.unitNumber) || descriptor.unitNumber < 1 || descriptor.unitNumber > 10
    || !descriptor.label || descriptor.label.length > 160 || descriptor.printedLabel.length > 40
    || !Number.isSafeInteger(descriptor.sortOrder) || descriptor.sortOrder < -100000 || descriptor.sortOrder > 100000
    || !/^[a-f0-9]{64}$/.test(descriptor.checksumSha256)
    || !["image/png", "image/jpeg", "image/webp"].includes(descriptor.mimeType)
    || !Number.isSafeInteger(descriptor.width) || descriptor.width < 1
    || !Number.isSafeInteger(descriptor.height) || descriptor.height < 1) {
    throw new Error("invalid_canonical_builder_page");
  }
  return descriptor;
}

export async function mutateCanonicalBuilderPage(sql, input) {
  if (typeof sql?.transaction !== "function") throw new Error("builder_page_transaction_unavailable");
  const canonical = canonicalPageDescriptor(input.canonicalPage);
  if (canonical.stableKey !== input.pageKey || input.componentSlug !== "ultimate-b2-students-book") {
    throw new Error("invalid_canonical_builder_page");
  }
  const sourceMetadata = {
    source: "builder-pages",
    canonical_page_id: canonical.stableKey.split("/").at(-1),
    canonical_unit_number: canonical.unitNumber,
    canonical_image_checksum_sha256: canonical.checksumSha256,
    canonical_image_mime_type: canonical.mimeType,
    canonical_image_width: canonical.width,
    canonical_image_height: canonical.height,
    is_override: false,
    has_image_override: false,
    has_metadata_override: false,
    is_active: true,
    is_deleted: false,
    is_permanently_deleted: false,
    printed_label: canonical.printedLabel,
  };
  const lockKey = `builder-pages:${input.bookSlug}:${input.componentSlug}`;
  const results = await sql.transaction((transaction) => [
    transaction`select pg_advisory_xact_lock(hashtextextended(${lockKey},0)) locked`,
    transaction`
      insert into builder_component_page_revisions(book_component_id)
      select component.id
      from book_packages package join book_components component on component.book_package_id=package.id
      where package.slug=${input.bookSlug} and component.slug=${input.componentSlug}
      on conflict(book_component_id) do nothing
    `,
    transaction`
      with scope as materialized (
        select package.id package_id,component.id component_id
        from book_packages package
        join book_components component on component.book_package_id=package.id
        where package.slug=${input.bookSlug} and component.slug=${input.componentSlug}
        limit 1
      ), canonical_unit as materialized (
        select unit.id
        from units unit join scope on scope.component_id=unit.book_component_id
        where unit.unit_number=${canonical.unitNumber} and unit.slug=${`unit-${canonical.unitNumber}`}
        limit 1
      ), revision_lock as materialized (
        select revision.revision
        from builder_component_page_revisions revision join scope on scope.component_id=revision.book_component_id
        for update
      ), inserted as (
        insert into book_pages(book_package_id,book_component_id,unit_id,stable_key,label,sort_order,source_metadata)
        select scope.package_id,scope.component_id,canonical_unit.id,${canonical.stableKey},${canonical.label},${canonical.sortOrder},${JSON.stringify(sourceMetadata)}::jsonb
        from scope cross join canonical_unit cross join revision_lock
        where revision_lock.revision=${input.expectedRevision}
          and ${input.action} in ('metadata','reorder')
          and exists(select 1 from builder_users where id=${input.builderUserId}::uuid and status='active' and role='developer')
          and not exists(
            select 1 from builder_component_page_mutations mutation
            where mutation.book_component_id=scope.component_id and mutation.client_mutation_id=${input.clientMutationId}::uuid
          )
        on conflict(book_package_id,stable_key) do nothing
        returning id
      ), barrier as materialized (
        select count(*) inserted_count from inserted
      ), mutation as materialized (
        select result.*
        from barrier
        cross join lateral mutate_builder_component_page(
          ${input.bookSlug},${input.componentSlug},${input.pageKey},${input.action},${input.expectedRevision},
          ${input.clientMutationId}::uuid,${JSON.stringify(input.pageMetadata)}::jsonb,${input.builderUserId}::uuid
        ) result
      )
      select mutation.outcome,mutation.current_revision
      from mutation
    `,
  ]);
  return normalizeRevisionField(results?.[2]?.[0] || null, "current_revision");
}

export async function loadBuilderPageHotspots(sql, { bookSlug, componentSlug }) {
  const rows = await sql`
    select document.revision,document.schema_version,document.payload,document.payload_sha256
    from builder_component_documents document
    join book_components component on component.id=document.book_component_id
    join book_packages package on package.id=document.book_package_id and package.id=component.book_package_id
    where package.slug=${bookSlug} and component.slug=${componentSlug}
      and document.document_type='hotspots' and document.document_key='default' limit 1
  `;
  return rows[0] || null;
}

export async function deleteBuilderPageLifecycle(sql, input) {
  const rows = await sql`select * from delete_builder_component_page_lifecycle(
    ${input.bookSlug},${input.componentSlug},${input.pageKey},${input.expectedRevision},${input.expectedHotspotRevision},
    ${input.clientMutationId}::uuid,${JSON.stringify(input.pageMetadata)}::jsonb,${input.hotspotSchemaVersion},
    ${JSON.stringify(input.hotspotDocument)}::jsonb,${input.hotspotSha256},${input.removedHotspotCount},${input.preservedActivityCount},${input.builderUserId}::uuid
  )`;
  const row = rows[0] || null;
  return row ? { ...row, current_revision: normalizeBuilderPageRevision(row.current_revision, { nullable: true }), hotspot_revision: normalizeBuilderPageRevision(row.hotspot_revision, { nullable: true }) } : null;
}

export async function restoreBuilderPage(sql, input) {
  const rows = await sql`select * from restore_builder_component_page(
    ${input.bookSlug},${input.componentSlug},${input.pageKey},${input.expectedRevision},${input.clientMutationId}::uuid,${input.builderUserId}::uuid
  )`;
  return normalizeRevisionField(rows[0] || null, "current_revision", { nullable: true });
}

// Compatibility export for callers compiled before the lifecycle was
// generalized. It uses the new all-component stored procedure.
export const restoreBuilderStudentsPage = restoreBuilderPage;

export async function purgeBuilderPage(sql, input) {
  const rows = await sql`select * from purge_builder_component_page(
    ${input.bookSlug},${input.componentSlug},${input.pageKey},${input.expectedRevision},${input.clientMutationId}::uuid,${input.builderUserId}::uuid
  )`;
  return normalizeRevisionField(rows[0] || null, "current_revision", { nullable: true });
}

export async function loadBuilderPageActivityReferences(sql, { bookSlug, componentSlug, pageId }) {
  const documents = await sql`
    select document.document_type,document.payload
    from builder_component_documents document
    join book_components component on component.id=document.book_component_id
    join book_packages package on package.id=document.book_package_id and package.id=component.book_package_id
    where package.slug=${bookSlug} and component.slug=${componentSlug}
      and document.document_type in ('native_activity_index','activity_lifecycle') and document.document_key='default'
  `;
  const legacy = await sql`
    select activity.id from book_activities activity
    where activity.package_slug=${bookSlug} and activity.component_slug=${componentSlug} and activity.page_id=${pageId}
  `;
  return {
    nativeIndex: documents.find((row) => row.document_type === "native_activity_index")?.payload || null,
    lifecycle: documents.find((row) => row.document_type === "activity_lifecycle")?.payload || null,
    legacyActivityIds: legacy.map((row) => String(row.id)),
  };
}

export async function loadBuilderPageAsset(sql, { bookSlug, componentSlug, pageKey, assetId }) {
  const rows = await sql`
    select asset.* from book_assets asset
    join book_pages page on page.id=asset.page_id and page.book_package_id=asset.book_package_id
    join book_packages package on package.id=asset.book_package_id
    join book_components component on component.id=asset.book_component_id and component.book_package_id=package.id
    where package.slug=${bookSlug} and component.slug=${componentSlug} and page.stable_key=${pageKey}
      and asset.id=${assetId}::uuid and asset.asset_role='page_image' and asset.publication_status='draft'
      and asset.storage_profile='private' and asset.access_level='internal' limit 1
  `;
  return rows[0] || null;
}
