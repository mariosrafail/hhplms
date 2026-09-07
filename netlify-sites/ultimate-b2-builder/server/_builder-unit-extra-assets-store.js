export async function prepareBuilderUnitExtraAssetUpload(sql, input) {
  const rows = await sql`select * from prepare_builder_unit_extra_asset_upload(
    ${input.bookSlug},${input.componentSlug},${input.unitSlug},${input.itemId},${input.assetSlot},
    ${input.expectedRevision},${input.clientMutationId}::uuid,${input.uploadId}::uuid,${input.requestSha256},
    ${JSON.stringify(input.fileDescriptor)}::jsonb,${input.stagingObjectKey},${input.builderUserId}::uuid,${input.expiresAt}
  )`;
  const row = rows[0];
  if (!row) throw new Error("Unit Extra upload preparation returned no result");
  return { outcome: row.outcome, uploadId: row.upload_id, currentRevision: row.current_revision === null ? null : Number(row.current_revision), state: row.session_state, fileDescriptor: row.file_descriptor, stagingObjectKey: row.staging_object_key };
}

export async function claimBuilderUnitExtraAssetUpload(sql, input) {
  const rows = await sql`select * from claim_builder_unit_extra_asset_upload(${input.uploadId}::uuid,${input.expectedRevision},${input.clientMutationId}::uuid,${input.builderUserId}::uuid)`;
  const row = rows[0];
  if (!row) throw new Error("Unit Extra upload claim returned no result");
  return {
    outcome: row.outcome, bookPackageId: row.book_package_id, bookComponentId: row.book_component_id,
    unitId: row.unit_id, unitSlug: row.unit_slug, itemId: row.unit_extra_item_id, assetSlot: row.asset_slot,
    currentRevision: row.current_revision === null ? null : Number(row.current_revision), fileDescriptor: row.file_descriptor,
    stagingObjectKey: row.staging_object_key, resultingAssetId: row.resulting_asset_id,
  };
}

export async function loadBuilderUnitExtraAssetUploadScope(sql, { uploadId, builderUserId }) {
  const rows = await sql`
    select package.slug book_slug,component.slug component_slug,unit_record.slug unit_slug,
      upload.unit_extra_item_id,upload.asset_slot
    from builder_unit_extra_asset_upload_sessions upload
    join book_packages package on package.id=upload.book_package_id
    join book_components component
      on component.id=upload.book_component_id
      and component.book_package_id=package.id
    join units unit_record
      on unit_record.id=upload.unit_id
      and unit_record.book_component_id=component.id
    where upload.id=${uploadId}::uuid
      and upload.created_by_builder_user_id=${builderUserId}::uuid
    limit 1
  `;
  const row = rows[0];
  return row ? {
    bookSlug: row.book_slug,
    componentSlug: row.component_slug,
    unitSlug: row.unit_slug,
    itemId: row.unit_extra_item_id,
    assetSlot: row.asset_slot,
  } : null;
}

export async function completeBuilderUnitExtraAssetUpload(sql, input) {
  const rows = await sql`select complete_builder_unit_extra_asset_upload(
    ${input.uploadId}::uuid,${input.builderUserId}::uuid,${input.objectKey},${input.storageBucket},
    ${input.mimeType},${input.byteSize},${input.checksumSha256},${input.durationMs}
  ) as asset_id`;
  if (!rows[0]?.asset_id) throw new Error("Unit Extra upload could not be completed");
  return rows[0].asset_id;
}

export async function failBuilderUnitExtraAssetUpload(sql, input) {
  const rows = await sql`select fail_builder_unit_extra_asset_upload(${input.uploadId}::uuid,${input.builderUserId}::uuid,${input.failureCode}) as failed`;
  return rows[0]?.failed === true;
}

export async function loadBuilderUnitExtraAsset(sql, { bookSlug, componentSlug, unitSlug, mediaKind, itemId, assetId }) {
  const role = mediaKind === "audios" ? "unit_extra_audio" : "unit_extra_video";
  const rows = await sql`
    select asset.id,asset.checksum_sha256,asset.asset_role,asset.object_key,asset.storage_profile,asset.storage_bucket,
      asset.mime_type,asset.byte_size,asset.duration_seconds,asset.publication_status,asset.access_level,
      asset.activity_id,asset.page_id,asset.source_metadata
    from book_assets asset
    join book_packages package on package.id=asset.book_package_id
    join book_components component on component.id=asset.book_component_id and component.book_package_id=package.id
    join units unit_record on unit_record.id=asset.unit_id and unit_record.book_component_id=component.id
    where package.slug=${bookSlug} and component.slug=${componentSlug} and unit_record.slug=${unitSlug}
      and asset.id=${assetId}::uuid and asset.asset_role=${role}
      and asset.source_metadata->>'unit_extra_item_id'=${itemId}
    limit 1
  `;
  return rows[0] || null;
}

export async function validateBuilderUnitExtraAssetReferences(sql, { bookSlug, componentSlug, document }) {
  const references = document.units.flatMap((unit) => [
    ...unit.categories.videos.filter((item) => item.asset).map((item) => ({ unit, item, role: "unit_extra_video", mimeType: "video/mp4" })),
    ...(unit.categories.audios || []).filter((item) => item.asset).map((item) => ({ unit, item, role: "unit_extra_audio", mimeType: "audio/mpeg" })),
  ]);
  if (!references.length) return;
  const ids = references.map(({ item }) => item.asset.assetId);
  const rows = await sql`
    select asset.id,asset.checksum_sha256,asset.asset_role,asset.mime_type,asset.byte_size,asset.duration_seconds,
      asset.publication_status,asset.access_level,asset.storage_profile,asset.activity_id,asset.page_id,asset.source_metadata,unit_record.slug as unit_slug
    from book_assets asset
    join book_packages package on package.id=asset.book_package_id
    join book_components component on component.id=asset.book_component_id and component.book_package_id=package.id
    join units unit_record on unit_record.id=asset.unit_id and unit_record.book_component_id=component.id
    where package.slug=${bookSlug} and component.slug=${componentSlug} and asset.id=any(${ids}::uuid[])
  `;
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  for (const { unit, item, role, mimeType } of references) {
    const row = byId.get(item.asset.assetId);
    if (!row || row.unit_slug !== unit.unitId || row.checksum_sha256 !== item.asset.checksumSha256 || row.asset_role !== role
      || row.mime_type !== mimeType || Number(row.byte_size) !== item.byteSize || (role === "unit_extra_video" && Math.round(Number(row.duration_seconds) * 1_000) !== item.durationMs)
      || row.publication_status !== "draft" || row.access_level !== "internal" || row.storage_profile !== "private"
      || row.activity_id !== null || row.page_id !== null || row.source_metadata?.unit_extra_item_id !== item.id || row.source_metadata?.asset_slot !== item.assetSlot) {
      throw new Error("unit_extra_asset_invalid");
    }
  }
}

export async function archiveUnreferencedBuilderUnitExtraAssets(sql, input) {
  const rows = await sql`select * from archive_unreferenced_builder_unit_extra_assets(${input.bookSlug},${input.componentSlug},${input.builderUserId}::uuid)`;
  return rows.map((row) => ({ assetId: row.asset_id, objectKey: row.object_key }));
}
