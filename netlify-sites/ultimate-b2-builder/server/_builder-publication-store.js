import { nativeTeacherAnswerImages, nativeTeacherAnswerAssetDescriptors } from "../../../src/data/native-activities/nativeImageSampleAnswer.js";
import { builderDocumentSha256 } from "./_builder-content-security.js";
import { resolveBuilderContentResource } from "./_builder-content-registry.js";
import { ULTIMATE_B2_OPEN_RESPONSE_ACTIVITY_IDS } from "../../../src/data/ultimate-b2/openResponseActivityRegistry.js";
import { loadBuilderPages } from "./_builder-pages-store.js";
import { resolveBuilderServerComponent } from "./_builder-component-registry.js";

export function normalizeStoredBuilderDocument(row, resource) {
  if (!row) return null;
  const sha256 = builderDocumentSha256(row.payload);
  if (sha256 !== row.payload_sha256) throw new Error("Stored Builder document checksum is invalid");
  if (row.schema_version !== resource.schemaVersion) throw new Error("Stored Builder document schema is unsupported");
  const payload = resource.validate(row.payload);
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Stored Builder document revision is invalid");
  return { revision, sha256, payload, resource };
}

const document = normalizeStoredBuilderDocument;

export async function collectUltimateB2PublicationV2Sources(sql) {
  const [legacy, pages] = await Promise.all([
    collectUltimateB2PublicationSources(sql),
    loadBuilderPages(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" }),
  ]);
  const rows = await sql`
    select coalesce(jsonb_agg(jsonb_build_object(
      'document_type',document.document_type,'document_key',document.document_key,'schema_version',document.schema_version,
      'revision',document.revision,'payload',document.payload,'payload_sha256',document.payload_sha256
    ) order by document.document_type,document.document_key), '[]'::jsonb) as documents
    from book_packages package
    join book_components component on component.book_package_id=package.id
    left join builder_component_documents document on document.book_component_id=component.id
      and document.document_type in ('native_activity_index','native_activity_public','native_activity_teacher','unit_extras')
    where package.slug='ultimate-b2' and component.slug='ultimate-b2-students-book'
    group by component.id
    limit 1
  `;
  if (!rows[0]) throw new Error("Publication component is unavailable");
  const documentRows = new Map((rows[0].documents || []).filter((row) => row.document_type).map((row) => [`${row.document_type}/${row.document_key}`, row]));
  const indexResource = await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "native-activity-index");
  const unitExtrasResource = await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "unit-extras");
  const index = document(documentRows.get("native_activity_index/default"), indexResource);
  const unitExtras = document(documentRows.get("unit_extras/default"), unitExtrasResource);
  const activities = {};
  for (const entry of index?.payload?.activities || []) {
    const [publicResource, teacherResource] = await Promise.all([
      resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "native-activity-public", entry.activityId),
      resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "native-activity-teacher", entry.activityId),
    ]);
    activities[entry.activityId] = {
      index: entry,
      public: document(documentRows.get(`native_activity_public/${entry.activityId}`), publicResource),
      teacher: document(documentRows.get(`native_activity_teacher/${entry.activityId}`), teacherResource),
    };
  }
  const references = Object.values(activities).flatMap((entry) => [...(entry.public?.payload?.assets || []), ...nativeTeacherAnswerImages(entry.teacher?.payload).map((image) => image.reference)]);
  const assetRows = await loadNativePublicationAssets(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", references });
  const unitExtraReferences = (unitExtras?.payload?.units || []).flatMap((unit) => [
    ...(unit.categories.videos || []).flatMap((video) => video.asset ? [video.asset] : []),
    ...(unit.categories.audios || []).flatMap((audio) => audio.asset ? [audio.asset] : []),
  ]);
  const unitExtraAssetRows = await loadNativePublicationAssets(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", references: unitExtraReferences });
  return { ...legacy, pages, native: { index, activities, assetRows }, unitExtras: { document: unitExtras, assetRows: unitExtraAssetRows } };
}

export async function collectUltimateB2ManagedPublicationSources(sql, componentSlug) {
  if (!["ultimate-b2-workbook", "ultimate-b2-grammar-book"].includes(componentSlug)) throw new Error("Publication component is unavailable");
  const [pages, rows] = await Promise.all([
    loadBuilderPages(sql, { bookSlug: "ultimate-b2", componentSlug }),
    sql`
      select coalesce(jsonb_agg(jsonb_build_object(
        'document_type',document.document_type,'document_key',document.document_key,'schema_version',document.schema_version,
        'revision',document.revision,'payload',document.payload,'payload_sha256',document.payload_sha256
      ) order by document.document_type,document.document_key) filter(where document.id is not null), '[]'::jsonb) documents
      from book_packages package
      join book_components component on component.book_package_id=package.id
      left join builder_component_documents document on document.book_component_id=component.id
        and document.document_type in ('hotspots','activity_lifecycle','native_activity_index','native_activity_public','native_activity_teacher')
      where package.slug='ultimate-b2' and component.slug=${componentSlug}
      group by component.id
      limit 1
    `,
  ]);
  if (!pages || !rows[0]) throw new Error("Publication component is unavailable");
  const documentRows = new Map((rows[0].documents || []).map((row) => [`${row.document_type}/${row.document_key}`, row]));
  const [hotspotsResource, lifecycleResource, indexResource] = await Promise.all([
    resolveBuilderContentResource("ultimate-b2", componentSlug, "hotspots"),
    resolveBuilderContentResource("ultimate-b2", componentSlug, "activity-lifecycle"),
    resolveBuilderContentResource("ultimate-b2", componentSlug, "native-activity-index"),
  ]);
  const hotspots = document(documentRows.get("hotspots/default"), hotspotsResource);
  const activityLifecycle = document(documentRows.get("activity_lifecycle/default"), lifecycleResource);
  const index = document(documentRows.get("native_activity_index/default"), indexResource);
  const activities = {};
  for (const entry of index?.payload?.activities || []) {
    const [publicResource, teacherResource] = await Promise.all([
      resolveBuilderContentResource("ultimate-b2", componentSlug, "native-activity-public", entry.activityId),
      resolveBuilderContentResource("ultimate-b2", componentSlug, "native-activity-teacher", entry.activityId),
    ]);
    activities[entry.activityId] = {
      index: entry,
      public: document(documentRows.get(`native_activity_public/${entry.activityId}`), publicResource),
      teacher: document(documentRows.get(`native_activity_teacher/${entry.activityId}`), teacherResource),
    };
  }
  const references = Object.values(activities).flatMap((entry) => [...(entry.public?.payload?.assets || []), ...nativeTeacherAnswerImages(entry.teacher?.payload).map((image) => image.reference)]);
  const assetRows = await loadNativePublicationAssets(sql, { bookSlug: "ultimate-b2", componentSlug, references });
  return { pages, documents: { hotspots, activityLifecycle }, native: { index, activities, assetRows } };
}

export async function collectBuilderNativeActivityCatalogSources(sql, { bookSlug, componentSlug }) {
  const registration = resolveBuilderServerComponent(bookSlug, componentSlug);
  if (!registration?.content.nativeActivities) throw new Error("Publication component is unavailable");
  const rows = await sql`
    select package.slug book_slug,component.slug component_slug,
      document.document_type,document.document_key,document.schema_version,document.revision,document.payload,document.payload_sha256
    from book_packages package
    join book_components component on component.book_package_id=package.id
    left join builder_component_documents document on document.book_component_id=component.id
      and document.document_type='native_activity_index' and document.document_key='default'
    where package.slug=${bookSlug} and component.slug=${componentSlug}
    limit 1
  `;
  if (!rows[0]) throw new Error("Publication component is unavailable");
  const indexResource = await resolveBuilderContentResource(bookSlug, componentSlug, "native-activity-index");
  if (!indexResource) throw new Error("Publication component is unavailable");
  let index = null;
  if (rows[0].document_type) {
    try { index = normalizeStoredBuilderDocument(rows[0], indexResource); }
    catch { throw Object.assign(new Error("Native activity index is invalid"), { code: "native_catalog_index_invalid" }); }
  }
  const activityIds = (index?.payload?.activities || []).map((entry) => entry.activityId);
  const pairRows = activityIds.length ? await sql`
    select document.document_type,document.document_key,document.schema_version,document.revision,document.payload,document.payload_sha256
    from builder_component_documents document
    join book_components component on component.id=document.book_component_id
    join book_packages package on package.id=document.book_package_id and package.id=component.book_package_id
    where package.slug=${bookSlug} and component.slug=${componentSlug}
      and document.document_type in ('native_activity_public','native_activity_teacher')
      and document.document_key=any(${activityIds}::text[])
    order by document.document_type,document.document_key
  ` : [];
  const documents = new Map(pairRows.map((row) => [`${row.document_type}/${row.document_key}`, row]));
  return {
    native: {
      index,
      activities: Object.fromEntries((index?.payload?.activities || []).map((entry) => [entry.activityId, {
        index: entry,
        public: documents.get(`native_activity_public/${entry.activityId}`) || null,
        teacher: documents.get(`native_activity_teacher/${entry.activityId}`) || null,
      }])),
    },
  };
}

export async function loadBuilderNativeActivityCatalogAssets(sql, { references }) {
  if (!references.length) return [];
  const ids = [...new Set(references.map((reference) => reference.assetId))];
  return sql`
    select asset.id,package.slug book_slug,component.slug component_slug,
      asset.book_package_id,asset.book_component_id,asset.checksum_sha256,asset.asset_role,asset.object_key,asset.storage_profile,
      asset.storage_bucket,asset.mime_type,asset.byte_size,asset.width,asset.height,asset.duration_seconds,
      asset.unit_id,asset.page_id,asset.activity_id,
      asset.publication_status,asset.access_level,asset.source_metadata
    from book_assets asset
    join book_packages package on package.id=asset.book_package_id
    join book_components component on component.id=asset.book_component_id and component.book_package_id=package.id
    where asset.id=any(${ids}::uuid[])
    order by asset.id
  `;
}

export async function loadNativePublicationAssets(sql, { bookSlug, componentSlug, references }) {
  if (!references.length) return [];
  const ids = [...new Set(references.map((reference) => reference.assetId))];
  return sql`
    select asset.id,package.slug book_slug,component.slug component_slug,
      asset.book_package_id,asset.book_component_id,asset.checksum_sha256,asset.asset_role,asset.object_key,asset.storage_profile,
      asset.storage_bucket,asset.mime_type,asset.byte_size,asset.width,asset.height,asset.duration_seconds,
      asset.unit_id,asset.page_id,asset.activity_id,
      asset.publication_status,asset.access_level,asset.source_metadata
    from book_assets asset
    join book_packages package on package.id=asset.book_package_id
    join book_components component on component.id=asset.book_component_id and component.book_package_id=package.id
    where package.slug=${bookSlug} and component.slug=${componentSlug} and asset.id=any(${ids}::uuid[])
    order by asset.id
  `;
}

export async function publicationV2DatabaseReady(sql) {
  const rows = await sql`
    select position('ultimate-b2-students-book-v2' in pg_get_functiondef('builder_release_sources_are_current(uuid)'::regprocedure)) > 0 as ready
  `;
  return rows[0]?.ready === true;
}

export async function publicationV3DatabaseReady(sql) {
  const rows = await sql`select to_regprocedure('builder_students_book_v3_sources_are_current(uuid)') is not null ready`;
  return rows[0]?.ready === true;
}

export async function publicationAssetPinDatabaseReady(sql) {
  const rows = await sql`
    select to_regclass('book_component_release_asset_pins') is not null
      and exists(select 1 from information_schema.columns where table_schema=current_schema()
        and table_name='book_component_releases' and column_name='asset_storage_mode')
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

export async function collectUltimateB2PublicationSources(sql) {
  const activityIds = [...ULTIMATE_B2_OPEN_RESPONSE_ACTIVITY_IDS].sort();
  const rows = await sql`
    select
      coalesce((select jsonb_agg(jsonb_build_object(
        'document_type',document.document_type,'document_key',document.document_key,'schema_version',document.schema_version,
        'revision',document.revision,'payload',document.payload,'payload_sha256',document.payload_sha256
      ) order by document.document_type,document.document_key)
      from builder_component_documents document
      where document.book_component_id=component.id and (
        (document.document_type='hotspots' and document.document_key='default')
        or (document.document_type='activity_lifecycle' and document.document_key='default')
        or (document.document_type='teacher_ui' and document.document_key='default')
        or (document.document_type='open_response' and document.document_key in (select jsonb_array_elements_text(${JSON.stringify(activityIds)}::jsonb)))
      )), '[]'::jsonb) as documents,
      coalesce((select jsonb_agg(jsonb_build_object(
        'activity_key',current.activity_key,'revision',current.revision,'fingerprint_sha256',current.fingerprint_sha256,
        'public_projection',current.public_projection,'teacher_projection',current.teacher_projection,'updated_at',current.updated_at
      ) order by current.activity_key)
      from builder_open_response_imports current
      where current.book_component_id=component.id and current.activity_key in (select jsonb_array_elements_text(${JSON.stringify(activityIds)}::jsonb))), '[]'::jsonb) as imports
    from book_packages package join book_components component on component.book_package_id=package.id
    where package.slug='ultimate-b2' and component.slug='ultimate-b2-students-book'
    limit 1
  `;
  if (!rows[0]) throw new Error("Publication component is unavailable");
  const documentRows = new Map(rows[0].documents.map((row) => [`${row.document_type}/${row.document_key}`, row]));
  const importRows = new Map(rows[0].imports.map((row) => [row.activity_key, row]));
  const hotspotsResource = await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "hotspots");
  const lifecycleResource = await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "activity-lifecycle");
  const teacherUiResource = await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "ui-controller");
  const openResponse = {};
  const imports = {};
  for (const activityId of activityIds) {
    const resource = await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "open-response", activityId);
    const stored = document(documentRows.get(`open_response/${activityId}`), resource);
    if (stored) openResponse[activityId] = stored;
    const imported = importRows.get(activityId);
    if (imported) imports[activityId] = { revision: Number(imported.revision), fingerprint: imported.fingerprint_sha256, publicProjection: imported.public_projection, teacherProjection: imported.teacher_projection, updatedAt: imported.updated_at };
  }
  return {
    documents: {
      hotspots: document(documentRows.get("hotspots/default"), hotspotsResource),
      activityLifecycle: document(documentRows.get("activity_lifecycle/default"), lifecycleResource),
      teacherUi: document(documentRows.get("teacher_ui/default"), teacherUiResource),
      openResponse,
    },
    imports,
  };
}

function releaseMetadata(row) {
  if (!row) return null;
  return {
    id: row.id,
    number: Number(row.release_number),
    compilerId: row.compiler_id,
    releaseSchemaVersion: row.release_schema_version,
    releaseSha256: row.release_sha256,
    sourceSnapshotSha256: row.source_snapshot_sha256,
    compatibility: row.runtime_compatibility_sha256,
    createdAt: row.created_at,
    releaseNote: row.release_note || "",
  };
}

export async function createComponentRelease(sql, input) {
  const rows = await sql`select * from create_builder_component_release(
    ${input.bookSlug},${input.componentSlug},${input.releaseSchemaVersion},${input.compilerId},${input.compatibility},
    ${JSON.stringify(input.sourceSnapshot)}::jsonb,${input.sourceSnapshotSha256},
    ${JSON.stringify(input.publicProjection)}::jsonb,${input.publicProjectionSha256},
    ${JSON.stringify(input.teacherProjection)}::jsonb,${input.teacherProjectionSha256},
    ${JSON.stringify(input.assetManifest)}::jsonb,${input.releaseSha256},${input.requestSha256},${input.releaseNote},
    ${input.builderUserId}::uuid,${input.clientMutationId}::uuid
  )`;
  const row = rows[0];
  if (!row) throw new Error("Release creation returned no result");
  return { outcome: row.outcome, releaseId: row.release_id, releaseNumber: row.release_number === null ? null : Number(row.release_number), releaseSha256: row.release_sha256 };
}

export async function publishComponentRelease(sql, input) {
  const rows = await sql`select * from publish_builder_component_release(
    ${input.bookSlug},${input.componentSlug},${input.releaseId}::uuid,${input.expectedHeadRevision},${input.requestSha256},${input.builderUserId}::uuid,${input.clientMutationId}::uuid
  )`;
  const row = rows[0];
  if (!row) throw new Error("Release publication returned no result");
  return { outcome: row.outcome, releaseId: row.release_id, releaseNumber: row.release_number === null ? null : Number(row.release_number), headRevision: row.head_revision === null ? null : Number(row.head_revision), previousReleaseId: row.previous_release_id, publishedAt: row.published_at };
}

export async function loadComponentPublicationStatus(sql, bookSlug, componentSlug) {
  const rows = await sql`
    select release.*, head.release_id=release.id as is_current, head.head_revision, head.published_at,
      event.published_at as last_published_at
    from book_packages package join book_components component on component.book_package_id=package.id
    left join book_component_releases release on release.book_component_id=component.id
    left join book_component_publication_heads head on head.book_component_id=component.id
    left join lateral (select published_at from book_component_publication_events e where e.release_id=release.id order by e.id desc limit 1) event on true
    where package.slug=${bookSlug} and component.slug=${componentSlug}
    order by release.release_number desc nulls last limit 20
  `;
  const releases = rows.filter((row) => row.id).map((row) => ({ ...releaseMetadata(row), current: row.is_current === true, publishedAt: row.last_published_at || null }));
  const headRow = rows.find((row) => row.is_current === true);
  return { headRevision: headRow ? Number(headRow.head_revision) : 0, published: headRow ? { ...releaseMetadata(headRow), publishedAt: headRow.published_at } : null, releases };
}

export async function loadComponentRelease(sql, { bookSlug, componentSlug, releaseId, activeOnly = false }) {
  const rows = await sql`
    select release.*, head.release_id=release.id as is_current, head.head_revision, head.published_at
    from book_component_releases release
    join book_packages package on package.id=release.book_package_id
    join book_components component on component.id=release.book_component_id and component.book_package_id=package.id
    left join book_component_publication_heads head on head.book_component_id=component.id
    where package.slug=${bookSlug} and component.slug=${componentSlug} and release.id=${releaseId}::uuid
      and (${activeOnly}::boolean=false or head.release_id=release.id)
    limit 1
  `;
  return rows[0] || null;
}

export async function loadComponentReleaseAssetPin(sql, { bookSlug, componentSlug, releaseId, sha256, extension, role }) {
  const rows = await sql`
    select pin.component_release_id,pin.book_asset_id,pin.asset_role,pin.source_asset_role,pin.checksum_sha256,
      pin.byte_size,pin.media_type,pin.extension,pin.storage_profile,pin.storage_bucket,pin.object_key,
      pin.source_owner_key,pin.source_asset_slot,pin.pin_sha256
    from book_component_release_asset_pins pin
    join book_component_releases release on release.id=pin.component_release_id
      and release.book_component_id=pin.book_component_id and release.book_package_id=pin.book_package_id
    join book_packages package on package.id=release.book_package_id
    join book_components component on component.id=release.book_component_id and component.book_package_id=package.id
    where package.slug=${bookSlug} and component.slug=${componentSlug} and release.id=${releaseId}::uuid
      and release.asset_storage_mode='pinned-source-v1' and pin.checksum_sha256=${sha256} and pin.extension=${extension}
      and pin.asset_role=${role}
    limit 1
  `;
  return rows[0] || null;
}

export async function loadComponentPublicationMutation(sql, { bookSlug, componentSlug, clientMutationId }) {
  const rows = await sql`
    select mutation.release_id,mutation.request_sha256,mutation.outcome,mutation.resulting_head_revision
    from book_component_publication_mutations mutation
    join book_components component on component.id=mutation.book_component_id
    join book_packages package on package.id=component.book_package_id
    where package.slug=${bookSlug} and component.slug=${componentSlug} and mutation.client_mutation_id=${clientMutationId}::uuid
    limit 1
  `;
  return rows[0] || null;
}

export async function loadActiveComponentRelease(sql, { bookSlug, componentSlug }) {
  const rows = await sql`
    select release.*,head.head_revision,head.published_at
    from book_component_publication_heads head
    join book_component_releases release on release.id=head.release_id and release.book_component_id=head.book_component_id
    join book_packages package on package.id=release.book_package_id
    join book_components component on component.id=release.book_component_id and component.book_package_id=package.id
    where package.slug=${bookSlug} and component.slug=${componentSlug} limit 1
  `;
  return rows[0] || null;
}
