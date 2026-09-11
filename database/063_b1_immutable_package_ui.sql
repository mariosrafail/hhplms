-- B1/B1+ immutable package UI v2. Additive contracts only: no release/head/content writes.
-- Historical component-v1/product-v1 functions below retain their 062 bodies.
create or replace function builder_b1_ui_publication_contract(requested_book_slug text)
returns jsonb language sql immutable as $$
 select case requested_book_slug
 when 'ultimate-b1' then '{"compilerId":"ultimate-b1-product-v2","components":["ultimate-b1-students-book","ultimate-b1-workbook"]}'::jsonb
 when 'ultimate-b1-plus' then '{"compilerId":"ultimate-b1-plus-product-v2","components":["ultimate-b1-plus-students-book","ultimate-b1-plus-workbook"]}'::jsonb
 else null end
$$;

create or replace function builder_publication_exact_keys(value jsonb, keys text[])
returns boolean language sql immutable as $$
 select coalesce(jsonb_typeof(value)='object' and (select array_agg(key order by key) from jsonb_object_keys(value) key)=(select array_agg(key order by key) from unnest(keys) key),false)
$$;

create or replace function builder_b1_ui_projection_integrity(ui jsonb, component_slug text)
returns boolean language plpgsql immutable as $$
declare binding record; family text; asset jsonb; extension text; media_type text; title_count int;
 catalog constant jsonb := '{"background.main":"raster","background.students-book-parts":"raster","branding.publisher-logo":"raster","title.gaf":"gaf","title.sd.1":"png","title.sd.2":"png","title.hd.1":"png","title.hd.2":"png","navigation.back":"raster","navigation.check":"raster","navigation.home":"raster","navigation.next":"raster","navigation.previous":"raster","navigation.close":"raster","navigation.minimize":"raster","navigation.settings":"raster","navigation.video":"raster","navigation.videoWorksheet":"raster","navigation.showText":"raster","navigation.showTextPressed":"raster","navigation.previousInternal":"raster","navigation.previousInternalDisabled":"raster","navigation.nextInternal":"raster","navigation.nextInternalDisabled":"raster","navibar.sb.active":"raster","navibar.gb.active":"raster","navibar.workbook.active":"raster","navibar.reload.active":"raster","navibar.reload.pressed":"raster","navibar.reload.disabled":"raster","navibar.show.all.active":"raster","navibar.show.all.pressed":"raster","navibar.show.all.disabled":"raster","navibar.show.next.active":"raster","navibar.show.next.pressed":"raster","navibar.show.next.disabled":"raster","unit.1.normal":"raster","unit.1.active":"raster","unit.2.normal":"raster","unit.2.active":"raster","unit.3.normal":"raster","unit.3.active":"raster","unit.4.normal":"raster","unit.4.active":"raster","unit.5.normal":"raster","unit.5.active":"raster","unit.6.normal":"raster","unit.6.active":"raster","unit.7.normal":"raster","unit.7.active":"raster","unit.8.normal":"raster","unit.8.active":"raster","unit.9.normal":"raster","unit.9.active":"raster","unit.10.normal":"raster","unit.10.active":"raster","edition.students-book.normal":"raster","edition.students-book.active":"raster","edition.workbook.normal":"raster","edition.workbook.active":"raster","edition.grammar-book.normal":"raster","edition.grammar-book.active":"raster","edition.extras.normal":"raster","edition.extras.active":"raster","extras.progress-checks.normal":"raster","extras.progress-checks.active":"raster","extras.reviews.normal":"raster","extras.reviews.active":"raster","extras.practice.normal":"raster","extras.practice.active":"raster","extras.videos.normal":"raster","extras.videos.active":"raster","extras.extra-videos.normal":"raster","extras.extra-videos.active":"raster","extras.word-lists.normal":"raster","extras.word-lists.active":"raster","extras.tests.normal":"raster","extras.tests.active":"raster","extras.games.normal":"raster","extras.games.active":"raster","extras.grammar-reference.normal":"raster","extras.grammar-reference.active":"raster","extras.irregular-verbs.normal":"raster","extras.irregular-verbs.active":"raster","extras.writing-bank.normal":"raster","extras.writing-bank.active":"raster","extras.speaking-bank.normal":"raster","extras.speaking-bank.active":"raster","extras.extra-tasks-for-early-finishers.normal":"raster","extras.extra-tasks-for-early-finishers.active":"raster","extras.worksheets-for-videos.normal":"raster","extras.worksheets-for-videos.active":"raster","toolbar.mouse.normal":"raster","toolbar.mouse.active":"raster","toolbar.pencil.normal":"raster","toolbar.pencil.active":"raster","toolbar.marker.normal":"raster","toolbar.marker.active":"raster","toolbar.eraser.normal":"raster","toolbar.eraser.active":"raster","toolbar.clear.normal":"raster","toolbar.clear.active":"raster","toolbar.zoom.normal":"raster","toolbar.zoom.active":"raster","toolbar.hide.normal":"raster","toolbar.hide.active":"raster","toolbar.show.normal":"raster","toolbar.show.active":"raster","toolbar.undo.normal":"raster","toolbar.undo.active":"raster","toolbar.redo.normal":"raster","toolbar.redo.active":"raster","toolbar.text.normal":"raster","toolbar.text.active":"raster","toolbar.annotations.normal":"raster","toolbar.annotations.active":"raster","toolbar.url.normal":"raster","toolbar.url.active":"raster","toolbar.save.normal":"raster","toolbar.save.active":"raster","toolbar.load.normal":"raster","toolbar.load.active":"raster","toolbar.timer.normal":"raster","toolbar.timer.active":"raster","toolbar.score.normal":"raster","toolbar.score.active":"raster","toolbar.print.normal":"raster","toolbar.print.active":"raster","toolbar.keyboard.normal":"raster","toolbar.keyboard.active":"raster","control.activity-hotspot":"raster","media-player.background":"raster","media-player.playActive":"raster","media-player.playPressed":"raster","media-player.pauseActive":"raster","media-player.pausePressed":"raster","media-player.stopActive":"raster","media-player.stopPressed":"raster","sound.button":"audio","sound.correct":"audio","sound.incorrect":"audio","sound.page-turn":"audio"}'::jsonb;
begin
 if not builder_publication_exact_keys(ui,array['schemaVersion','packageId','assets']) or ui->>'schemaVersion'<>'1.0'
   or ui->>'packageId' is distinct from component_slug or jsonb_typeof(ui->'assets') is distinct from 'object' then return false; end if;
 for binding in select * from jsonb_each(ui->'assets') loop
   family:=catalog->>binding.key; asset:=binding.value; extension:=asset->>'extension'; media_type:=asset->>'mediaType';
   if family is null or not builder_publication_exact_keys(asset,array['sha256','extension','mediaType','sizeBytes','width','height'])
     or coalesce(asset->>'sha256','')!~'^[a-f0-9]{64}$'
     or jsonb_typeof(asset->'sizeBytes')<>'number' or (asset->>'sizeBytes')!~'^[1-9][0-9]*$'
     or (asset->>'sizeBytes')::bigint>(case family when 'audio' then 12582912 when 'gaf' then 8388608 else 16777216 end)
     or media_type is distinct from (case extension when 'png' then 'image/png' when 'jpg' then 'image/jpeg' when 'webp' then 'image/webp' when 'mp3' then 'audio/mpeg' when 'wav' then 'audio/wav' when 'gaf' then 'application/x-gaf' end)
     or not (case family when 'raster' then extension in ('png','jpg','webp') when 'png' then extension='png' when 'audio' then extension in ('mp3','wav') when 'gaf' then extension='gaf' else false end) then return false; end if;
   if family in ('raster','png') then
     if jsonb_typeof(asset->'width')<>'number' or jsonb_typeof(asset->'height')<>'number'
       or (asset->>'width')!~'^[1-9][0-9]*$' or (asset->>'height')!~'^[1-9][0-9]*$'
       or (asset->>'width')::bigint>32768 or (asset->>'height')::bigint>32768 then return false; end if;
   elsif asset->'width'<>'null'::jsonb or asset->'height'<>'null'::jsonb then return false; end if;
 end loop;
 select count(*) into title_count from jsonb_object_keys(ui->'assets') k where k in ('title.gaf','title.sd.1','title.sd.2','title.hd.1','title.hd.2');
 if title_count not in (0,5) then return false; end if;
 if exists(select 1 from jsonb_each(ui->'assets') a join jsonb_each(ui->'assets') b on a.value->>'sha256'=b.value->>'sha256' and a.value->>'extension'=b.value->>'extension' where a.value<>b.value) then return false; end if;
 return true;
exception when others then return false;
end $$;

create or replace function builder_b1_ui_component_integrity(requested_release_id uuid)
returns boolean language plpgsql volatile as $$
declare r book_component_releases%rowtype; book_slug text; component_slug text; ui jsonb; expected_assets jsonb; actual_assets jsonb; base_compatibility jsonb; expected_compatibility text;
begin
 select * into r from book_component_releases where id=requested_release_id;
 select package.slug,component.slug into book_slug,component_slug from book_components component join book_packages package on package.id=component.book_package_id
   where component.id=r.book_component_id and package.id=r.book_package_id;
 if builder_b1_ui_publication_contract(book_slug) is null or component_slug is distinct from book_slug||'-students-book'
   or r.compiler_id is distinct from component_slug||'-v2' or r.release_schema_version is distinct from '2.0' then return false; end if;
 ui:=r.teacher_projection->'ui';
 if not builder_b1_ui_projection_integrity(ui,component_slug)
   or not builder_publication_exact_keys(r.teacher_projection,array['schemaVersion','bookSlug','componentSlug','nativeActivities','ui'])
   or not builder_publication_exact_keys(r.source_snapshot,array['schemaVersion','pages','hotspots','activityLifecycle','nativeIndex','nativeActivities','teacherUi'])
   or not builder_publication_exact_keys(r.source_snapshot->'teacherUi',array['revision','sha256'])
   or jsonb_typeof(r.source_snapshot->'teacherUi'->'revision') is distinct from 'number'
   or coalesce(r.source_snapshot->'teacherUi'->>'revision','')!~'^(0|[1-9][0-9]*)$'
   or coalesce(r.source_snapshot->'teacherUi'->>'sha256','')!~'^[a-f0-9]{64}$'
   or not builder_publication_exact_keys(r.public_projection,array['schemaVersion','bookSlug','componentSlug','compatibility','units','pages','hotspots','nativeActivities','activityOrder','assets'])
   or r.public_projection->>'schemaVersion' is distinct from '2.0' or r.teacher_projection->>'schemaVersion' is distinct from '2.0'
   or r.source_snapshot->>'schemaVersion' is distinct from '2.0' then return false; end if;
 if r.source_snapshot->'teacherUi'->>'revision'='0' and (ui->'assets'<>'{}'::jsonb or r.source_snapshot->'teacherUi'->>'sha256'<>builder_publication_json_sha256(jsonb_build_object('schemaVersion','1.0','packageId',component_slug,'assets','{}'::jsonb))) then return false; end if;
 select coalesce(jsonb_agg(asset order by asset->>'sha256',asset->>'extension'),'[]'::jsonb) into expected_assets from
   (select distinct jsonb_build_object('sha256',value->>'sha256','extension',value->>'extension','mediaType',value->>'mediaType','role','teacher_ui') asset from jsonb_each(ui->'assets')) items;
 select coalesce(jsonb_agg(value order by value->>'sha256',value->>'extension'),'[]'::jsonb) into actual_assets from jsonb_array_elements(r.asset_manifest) where value->>'role'='teacher_ui';
 if expected_assets<>actual_assets or exists(select 1 from jsonb_array_elements(r.public_projection->'assets') where value->>'role' in ('teacher_ui','native_teacher_answer'))
   or exists(select 1 from jsonb_array_elements(r.asset_manifest) where not builder_publication_exact_keys(value,array['sha256','extension','mediaType','role']) or coalesce(value->>'role','') not in ('teacher_ui','managed_page_image','activity_artwork','activity_font','native_teacher_answer')) then return false; end if;
 base_compatibility:=jsonb_build_object('compilerId',component_slug||'-v1','releaseSchemaVersion','1.0','hotspotSchemaVersion','1.0','nativeActivitySchemaVersion','1.0','nativeIndexSchemaVersion','1.0','releaseAssetDescriptorSchemaVersion','1.0',
   'nativeKinds',(select coalesce(jsonb_agg(kind order by kind),'[]'::jsonb) from (select distinct value->>'kind' kind from jsonb_each(r.public_projection->'nativeActivities')) kinds));
 if exists(select 1 from jsonb_each(r.public_projection->'nativeActivities') a where a.value->>'kind'='multi-part'
   or coalesce(a.value#>'{document,parts,0,interaction,questionSurface}','null'::jsonb)<>'null'::jsonb
   or exists(select 1 from jsonb_array_elements(coalesce(a.value#>'{document,parts,0,interaction,words}','[]'::jsonb)) w where coalesce(w->'image','null'::jsonb)<>'null'::jsonb)
   or coalesce(r.teacher_projection->'nativeActivities'->a.key#>'{document,parts,0,solution,sampleAnswer}','null'::jsonb)<>'null'::jsonb)
 then base_compatibility:=base_compatibility||'{"nativeComposition":"multi-part.v1"}'::jsonb; end if;
 expected_compatibility:=builder_publication_json_sha256(jsonb_build_object('compilerId',r.compiler_id,'releaseSchemaVersion','2.0','managedV1Compatibility',builder_publication_json_sha256(base_compatibility),'teacherUiSchemaVersion','1.0'));
 return coalesce(r.public_projection->>'bookSlug'=book_slug and r.public_projection->>'componentSlug'=component_slug
   and r.teacher_projection->>'bookSlug'=book_slug and r.teacher_projection->>'componentSlug'=component_slug
   and r.source_snapshot_sha256=builder_publication_json_sha256(r.source_snapshot)
   and r.public_projection_sha256=builder_publication_json_sha256(r.public_projection)
   and r.teacher_projection_sha256=builder_publication_json_sha256(r.teacher_projection)
   and r.release_sha256=builder_publication_json_sha256(jsonb_build_object('compatibility',r.runtime_compatibility_sha256,'sourceSnapshot',r.source_snapshot,'publicProjection',r.public_projection,'teacherProjection',r.teacher_projection))
   and r.public_projection->>'compatibility'=expected_compatibility and r.runtime_compatibility_sha256=expected_compatibility
   and r.source_snapshot->'pages'->>'sha256'=builder_publication_json_sha256(jsonb_build_object('units',r.public_projection->'units','pages',r.public_projection->'pages'))
   and jsonb_array_length(r.public_projection->'units')=10 and jsonb_array_length(r.public_projection->'pages')>0,false);
exception when others then return false;
end $$;

create or replace function builder_b1_component_v1_integrity(requested_release_id uuid)
returns boolean language plpgsql volatile as $$
declare r book_component_releases%rowtype; book_slug text; component_slug text; contract jsonb;
begin
  select * into r from book_component_releases where id=requested_release_id;
  select package.slug,component.slug into book_slug,component_slug from book_components component join book_packages package on package.id=component.book_package_id
    where component.id=r.book_component_id and package.id=r.book_package_id;
  contract:=builder_b1_publication_contract(book_slug);
  if contract is null then return false; end if;
  return coalesce(contract->'components' ? component_slug and r.compiler_id=component_slug||'-v1' and r.release_schema_version='1.0'
    and r.public_projection->>'bookSlug'=book_slug and r.public_projection->>'componentSlug'=component_slug
    and r.teacher_projection->>'bookSlug'=book_slug and r.teacher_projection->>'componentSlug'=component_slug
    and r.source_snapshot_sha256=builder_publication_json_sha256(r.source_snapshot)
    and r.public_projection_sha256=builder_publication_json_sha256(r.public_projection)
    and r.teacher_projection_sha256=builder_publication_json_sha256(r.teacher_projection)
    and r.release_sha256=builder_publication_json_sha256(jsonb_build_object('compatibility',r.runtime_compatibility_sha256,'sourceSnapshot',r.source_snapshot,'publicProjection',r.public_projection,'teacherProjection',r.teacher_projection))
    and r.public_projection->>'compatibility'=r.runtime_compatibility_sha256
    and r.source_snapshot->'pages'->>'sha256'=builder_publication_json_sha256(jsonb_build_object('units',r.public_projection->'units','pages',r.public_projection->'pages'))
    and jsonb_array_length(r.public_projection->'units')=10 and jsonb_array_length(r.public_projection->'pages')>0, false);
end $$;

create or replace function builder_b1_component_integrity(requested_release_id uuid)
returns boolean language sql volatile as $$
 select coalesce((select case when compiler_id in ('ultimate-b1-students-book-v2','ultimate-b1-plus-students-book-v2')
 then builder_b1_ui_component_integrity(requested_release_id) else builder_b1_component_v1_integrity(requested_release_id) end
 from book_component_releases where id=requested_release_id),false)
$$;

create or replace function builder_b1_product_v1_integrity(requested_product_release_id uuid)
returns boolean language plpgsql volatile as $$
declare r book_product_releases%rowtype; book_slug text; contract jsonb; member record; position int:=0;
  slugs text[]:='{}'; hashes text[]:='{}'; source_hash text;
begin
  select * into r from book_product_releases where id=requested_product_release_id;
  select slug into book_slug from book_packages where id=r.book_package_id;
  contract:=builder_b1_publication_contract(book_slug);
  if contract is null or r.compiler_id is distinct from contract->>'compilerId' or r.release_schema_version<>'1.0' then return false; end if;
  for member in select m.*,component.slug,release.asset_storage_mode from book_product_release_members m
    join book_components component on component.id=m.book_component_id and component.book_package_id=r.book_package_id
    join book_component_releases release on release.id=m.component_release_id and release.book_component_id=component.id and release.book_package_id=r.book_package_id
    where m.product_release_id=r.id order by m.member_order loop
    position:=position+1;
    if member.member_order<>position or member.slug is distinct from contract->'components'->>(position-1)
      or member.member_status<>'included' or member.component_compiler_id is distinct from member.slug||'-v1'
      or member.component_release_schema_version<>'1.0' or member.asset_storage_mode<>'pinned-source-v1'
      or not builder_b1_component_v1_integrity(member.component_release_id)
      or not exists(select 1 from book_component_releases c where c.id=member.component_release_id
        and c.release_sha256=member.component_release_sha256 and c.runtime_compatibility_sha256=member.runtime_compatibility_sha256)
      or member.member_sha256<>builder_product_member_sha256(position,member.slug,'included',member.component_release_id,member.component_compiler_id,
        member.component_release_schema_version,member.component_release_sha256,member.runtime_compatibility_sha256,null)
    then return false; end if;
    if exists(select 1 from book_component_releases c, lateral jsonb_array_elements(c.asset_manifest) asset where c.id=member.component_release_id
      and not exists(select 1 from book_component_release_asset_pins pin where pin.component_release_id=c.id and pin.book_component_id=c.book_component_id
        and pin.book_package_id=c.book_package_id and pin.asset_role=asset->>'role' and pin.checksum_sha256=asset->>'sha256'
        and pin.extension=asset->>'extension' and pin.media_type=asset->>'mediaType')) then return false; end if;
    slugs:=array_append(slugs,member.slug); hashes:=array_append(hashes,member.member_sha256);
  end loop;
  if position<>2 or (select count(*) from book_product_release_members where product_release_id=r.id)<>2 then return false; end if;
  source_hash:=builder_product_source_sha256(book_slug,r.release_number,slugs,hashes);
  return source_hash=r.source_snapshot_sha256 and r.release_sha256=builder_product_release_sha256(r.compiler_id,r.release_schema_version,book_slug,r.release_number,source_hash,r.release_note,slugs,hashes);
end $$;

create or replace function builder_b1_ui_product_integrity(requested_product_release_id uuid)
returns boolean language plpgsql volatile as $$
declare r book_product_releases%rowtype; book_slug text; contract jsonb; member record; position int:=0;
  slugs text[]:='{}'; hashes text[]:='{}'; source_hash text;
begin
  select * into r from book_product_releases where id=requested_product_release_id;
  select slug into book_slug from book_packages where id=r.book_package_id;
  contract:=builder_b1_ui_publication_contract(book_slug);
  if contract is null or r.compiler_id is distinct from contract->>'compilerId' or r.release_schema_version<>'1.0' then return false; end if;
  for member in select m.*,component.slug,release.asset_storage_mode from book_product_release_members m
    join book_components component on component.id=m.book_component_id and component.book_package_id=r.book_package_id
    join book_component_releases release on release.id=m.component_release_id and release.book_component_id=component.id and release.book_package_id=r.book_package_id
    where m.product_release_id=r.id order by m.member_order loop
    position:=position+1;
    if member.member_order<>position or member.slug is distinct from contract->'components'->>(position-1)
      or member.member_status<>'included' or member.component_compiler_id is distinct from member.slug||(case when position=1 then '-v2' else '-v1' end)
      or member.component_release_schema_version<>(case when position=1 then '2.0' else '1.0' end) or member.asset_storage_mode<>'pinned-source-v1'
      or not builder_b1_component_integrity(member.component_release_id)
      or not exists(select 1 from book_component_releases c where c.id=member.component_release_id
        and c.compiler_id=member.component_compiler_id and c.release_schema_version=member.component_release_schema_version
        and c.release_sha256=member.component_release_sha256 and c.runtime_compatibility_sha256=member.runtime_compatibility_sha256)
      or member.member_sha256<>builder_product_member_sha256(position,member.slug,'included',member.component_release_id,member.component_compiler_id,
        member.component_release_schema_version,member.component_release_sha256,member.runtime_compatibility_sha256,null)
    then return false; end if;
    if exists(select 1 from book_component_releases c, lateral jsonb_array_elements(c.asset_manifest) asset where c.id=member.component_release_id and asset->>'role'<>'teacher_ui'
      and not exists(select 1 from book_component_release_asset_pins pin where pin.component_release_id=c.id and pin.book_component_id=c.book_component_id
        and pin.book_package_id=c.book_package_id and pin.asset_role=asset->>'role' and pin.checksum_sha256=asset->>'sha256'
        and pin.extension=asset->>'extension' and pin.media_type=asset->>'mediaType')) then return false; end if;
    slugs:=array_append(slugs,member.slug); hashes:=array_append(hashes,member.member_sha256);
  end loop;
  if position<>2 or (select count(*) from book_product_release_members where product_release_id=r.id)<>2 then return false; end if;
  source_hash:=builder_product_source_sha256(book_slug,r.release_number,slugs,hashes);
  return source_hash=r.source_snapshot_sha256 and r.release_sha256=builder_product_release_sha256(r.compiler_id,r.release_schema_version,book_slug,r.release_number,source_hash,r.release_note,slugs,hashes);
end $$;

create or replace function builder_b1_product_integrity(requested_product_release_id uuid)
returns boolean language sql volatile as $$
 select coalesce((select case when compiler_id in ('ultimate-b1-product-v2','ultimate-b1-plus-product-v2')
 then builder_b1_ui_product_integrity(requested_product_release_id) else builder_b1_product_v1_integrity(requested_product_release_id) end
 from book_product_releases where id=requested_product_release_id),false)
$$;

create or replace function builder_managed_release_sources_are_current(requested_release_id uuid)
returns boolean language plpgsql volatile as $$
declare
  release_row book_component_releases%rowtype; expected jsonb; actual_revision bigint; actual_sha text; activity_id text;
begin
  select * into release_row from book_component_releases where id=requested_release_id;
  if release_row.id is null or not (
    (release_row.compiler_id='ultimate-b2-workbook-v1' and release_row.release_schema_version='1.0')
    or (release_row.compiler_id='ultimate-b2-grammar-book-v1' and release_row.release_schema_version='1.0')
    or builder_b1_component_integrity(requested_release_id)
  ) then return false; end if;
  if release_row.compiler_id in ('ultimate-b1-students-book-v1','ultimate-b1-workbook-v1','ultimate-b1-plus-students-book-v1','ultimate-b1-plus-workbook-v1','ultimate-b1-students-book-v2','ultimate-b1-plus-students-book-v2')
    and builder_b1_managed_page_snapshot(release_row.book_component_id) is distinct from jsonb_build_object('units',release_row.public_projection->'units','pages',release_row.public_projection->'pages') then return false; end if;
  if release_row.compiler_id in ('ultimate-b1-students-book-v1','ultimate-b1-workbook-v1','ultimate-b1-plus-students-book-v1','ultimate-b1-plus-workbook-v1','ultimate-b1-students-book-v2','ultimate-b1-plus-students-book-v2') and exists(
    select 1 from book_component_release_asset_pins pin join book_assets asset on asset.id=pin.book_asset_id
    where pin.component_release_id=release_row.id and (asset.publication_status<>'draft' or asset.access_level<>'internal' or asset.storage_profile<>'private')
  ) then return false; end if;
  expected:=release_row.source_snapshot->'pages';
  select revision into actual_revision from builder_component_page_revisions where book_component_id=release_row.book_component_id;
  if coalesce(actual_revision,0)<>(expected->>'revision')::bigint then return false; end if;
  for expected in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('documentType','hotspots','source',release_row.source_snapshot->'hotspots'),
    jsonb_build_object('documentType','activity_lifecycle','source',release_row.source_snapshot->'activityLifecycle'),
    jsonb_build_object('documentType','native_activity_index','source',release_row.source_snapshot->'nativeIndex')
  )) loop
    actual_revision:=null; actual_sha:=null;
    select revision,case when release_row.compiler_id like 'ultimate-b1%' then builder_publication_json_sha256(payload) else payload_sha256 end into actual_revision,actual_sha from builder_component_documents
    where book_component_id=release_row.book_component_id and document_type=expected->>'documentType' and document_key='default';
    if coalesce(actual_revision,0)<>(expected->'source'->>'revision')::bigint
      or coalesce(actual_sha,expected->'source'->>'sha256')<>expected->'source'->>'sha256' then return false; end if;
  end loop;
  for activity_id in select jsonb_object_keys(release_row.source_snapshot->'nativeActivities') loop
    expected:=release_row.source_snapshot->'nativeActivities'->activity_id->'public';
    actual_revision:=null; actual_sha:=null;
    select revision,case when release_row.compiler_id like 'ultimate-b1%' then builder_publication_json_sha256(payload) else payload_sha256 end into actual_revision,actual_sha from builder_component_documents
    where book_component_id=release_row.book_component_id and document_type='native_activity_public' and document_key=activity_id;
    if coalesce(actual_revision,0)<>(expected->>'revision')::bigint or coalesce(actual_sha,'')<>expected->>'sha256' then return false; end if;
    expected:=release_row.source_snapshot->'nativeActivities'->activity_id->'teacher';
    actual_revision:=null; actual_sha:=null;
    select revision,case when release_row.compiler_id like 'ultimate-b1%' then builder_publication_json_sha256(payload) else payload_sha256 end into actual_revision,actual_sha from builder_component_documents
    where book_component_id=release_row.book_component_id and document_type='native_activity_teacher' and document_key=activity_id;
    if coalesce(actual_revision,0)<>(expected->>'revision')::bigint or coalesce(actual_sha,'')<>expected->>'sha256' then return false; end if;
  end loop;
  if release_row.compiler_id in ('ultimate-b1-students-book-v2','ultimate-b1-plus-students-book-v2') then
    expected:=release_row.source_snapshot->'teacherUi';
    select revision,builder_publication_json_sha256(payload) into actual_revision,actual_sha from builder_component_documents
      where book_package_id=release_row.book_package_id and book_component_id=release_row.book_component_id and document_type='teacher_ui' and document_key='default';
    if coalesce(actual_revision,0)<>(expected->>'revision')::bigint or (actual_revision is not null and actual_sha<>expected->>'sha256') then return false; end if;
    if actual_revision is not null and not exists(select 1 from builder_component_documents d
      where d.book_package_id=release_row.book_package_id and d.book_component_id=release_row.book_component_id and d.document_type='teacher_ui' and d.document_key='default'
      and d.payload_sha256=actual_sha and d.schema_version='1.0'
      and jsonb_build_object('schemaVersion',d.payload->'schemaVersion','packageId',d.payload->'packageId','assets',
        (select coalesce(jsonb_object_agg(key,(value-'originalFilename')||jsonb_build_object('extension',lower(value->>'extension'),'mediaType',lower(value->>'mediaType'))),'{}'::jsonb) from jsonb_each(d.payload->'assets')))=release_row.teacher_projection->'ui') then return false; end if;
  end if;
  return true;
end;
$$;

create or replace function builder_product_release_sources_are_current(requested_product_release_id uuid)
returns boolean language plpgsql volatile as $$
declare member record;
begin
  if not exists(select 1 from book_product_releases where id=requested_product_release_id) then return false; end if;
  for member in select family_member.*,release.compiler_id from book_product_release_members family_member
    left join book_component_releases release on release.id=family_member.component_release_id
    where family_member.product_release_id=requested_product_release_id order by family_member.member_order loop
    if member.member_status='included' and not (
      case when member.compiler_id in ('ultimate-b2-workbook-v1','ultimate-b2-grammar-book-v1','ultimate-b1-students-book-v1','ultimate-b1-workbook-v1','ultimate-b1-plus-students-book-v1','ultimate-b1-plus-workbook-v1','ultimate-b1-students-book-v2','ultimate-b1-plus-students-book-v2')
        then builder_managed_release_sources_are_current(member.component_release_id)
        else builder_release_sources_are_current(member.component_release_id) end
    ) then return false; end if;
  end loop;
  return true;
end;
$$;

create or replace function create_builder_product_release(
  requested_product_release_id uuid,requested_book_slug text,requested_release_schema_version text,requested_compiler_id text,
  requested_members jsonb,requested_request_sha256 text,requested_release_note text,actor_builder_user_id uuid,requested_client_mutation_id uuid
)
returns table(outcome text,product_release_id uuid,product_release_number bigint,source_snapshot_sha256 text,release_sha256 text,members jsonb)
language plpgsql as $$
declare
  resolved_package_id uuid; replay book_product_releases%rowtype; inserted_product book_product_releases%rowtype;
  member jsonb; member_position int; component_id uuid; component_release book_component_releases%rowtype;
  next_product_number bigint; next_component_number bigint; member_hashes text[]:='{}'; component_slugs text[]:=array['ultimate-b2-students-book','ultimate-b2-workbook','ultimate-b2-grammar-book'];
  expected_compilers text[]:=array['ultimate-b2-students-book-v2','ultimate-b2-workbook-v1','ultimate-b2-grammar-book-v1'];
  expected_schemas text[]:=array['2.0','1.0','1.0']; product_source_hash text; product_hash text;
begin
  if builder_b1_publication_contract(requested_book_slug) is not null then
    if current_setting('hhplms.release_asset_storage_mode',true) is distinct from 'pinned-source-v1' then
      return query select 'invalid_request',null::uuid,null::bigint,null::text,null::text,null::jsonb; return;
    end if;
    select array_agg(value order by ordinal) into component_slugs from jsonb_array_elements_text(builder_b1_publication_contract(requested_book_slug)->'components') with ordinality entry(value,ordinal);
    expected_compilers:=array[component_slugs[1]||'-v2',component_slugs[2]||'-v1']; expected_schemas:=array['2.0','1.0'];
  end if;
  -- Expanded schema accepts old-code v2 prepares as well as explicit v3. This
  -- changes no existing family/member/head and activates no source policy.
  if requested_book_slug='ultimate-b2' and requested_members->0->>'compilerId'='ultimate-b2-students-book-v3' then
    expected_compilers[1]:='ultimate-b2-students-book-v3'; expected_schemas[1]:='3.0';
  end if;
  if (requested_book_slug is distinct from 'ultimate-b2' and builder_b1_publication_contract(requested_book_slug) is null) or requested_release_schema_version is distinct from '1.0' or requested_compiler_id is distinct from (case when requested_book_slug='ultimate-b2' then 'ultimate-b2-product-v1' else builder_b1_ui_publication_contract(requested_book_slug)->>'compilerId' end)
    or jsonb_typeof(requested_members) is distinct from 'array' or jsonb_array_length(requested_members)<>cardinality(component_slugs)
    or requested_request_sha256!~'^[a-f0-9]{64}$' or length(coalesce(requested_release_note,''))>240 then
    return query select 'invalid_request',null::uuid,null::bigint,null::text,null::text,null::jsonb; return;
  end if;
  if not exists(select 1 from builder_users where id=actor_builder_user_id and status='active' and role='developer') then
    return query select 'unauthorized_actor',null::uuid,null::bigint,null::text,null::text,null::jsonb; return;
  end if;
  select id into resolved_package_id from book_packages where slug=requested_book_slug;
  if resolved_package_id is null then return query select 'product_not_found',null::uuid,null::bigint,null::text,null::text,null::jsonb; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('builder-product-publication:'||resolved_package_id::text,0));
  select * into replay from book_product_releases where book_package_id=resolved_package_id and client_mutation_id=requested_client_mutation_id;
  if replay.id is not null then
    return query select case when replay.request_sha256=requested_request_sha256 then 'idempotent' else 'mutation_id_conflict' end,
      replay.id,replay.release_number,replay.source_snapshot_sha256,replay.release_sha256,
      (select jsonb_agg(jsonb_build_object('componentSlug',component.slug,'order',family_member.member_order,'status',family_member.member_status,
        'componentReleaseId',family_member.component_release_id,'compilerId',family_member.component_compiler_id,'releaseSchemaVersion',family_member.component_release_schema_version,
        'releaseSha256',family_member.component_release_sha256,'compatibility',family_member.runtime_compatibility_sha256,'memberSha256',family_member.member_sha256,
        'unavailableReason',family_member.unavailable_reason) order by family_member.member_order)
       from book_product_release_members family_member join book_components component on component.id=family_member.book_component_id where family_member.product_release_id=replay.id);
    return;
  end if;
  for member,member_position in select value,ordinality::int from jsonb_array_elements(requested_members) with ordinality loop
    if member->>'componentSlug' is distinct from component_slugs[member_position] or member->>'compilerId' is distinct from expected_compilers[member_position]
      or member->>'releaseSchemaVersion' is distinct from expected_schemas[member_position] then raise exception 'product member identity is invalid'; end if;
    select id into component_id from book_components where book_package_id=resolved_package_id and slug=component_slugs[member_position];
    if component_id is null then raise exception 'product member component is unavailable'; end if;
    perform pg_advisory_xact_lock(hashtextextended('builder-publication-component:'||component_id::text,0));
  end loop;
  select coalesce(max(release_number),0)+1 into next_product_number from book_product_releases where book_package_id=resolved_package_id;
  for member,member_position in select value,ordinality::int from jsonb_array_elements(requested_members) with ordinality loop
    select id into component_id from book_components where book_package_id=resolved_package_id and slug=component_slugs[member_position];
    select coalesce(max(release_number),0)+1 into next_component_number from book_component_releases where book_component_id=component_id;
    insert into book_component_releases(id,book_package_id,book_component_id,release_number,release_schema_version,compiler_id,runtime_compatibility_sha256,
      source_snapshot,source_snapshot_sha256,public_projection,public_projection_sha256,teacher_projection,teacher_projection_sha256,asset_manifest,
      release_sha256,request_sha256,client_mutation_id,release_note,created_by_builder_user_id)
    values((member->>'releaseId')::uuid,resolved_package_id,component_id,next_component_number,member->>'releaseSchemaVersion',member->>'compilerId',member->>'compatibility',
      member->'sourceSnapshot',member->>'sourceSnapshotSha256',member->'publicProjection',member->>'publicProjectionSha256',member->'teacherProjection',member->>'teacherProjectionSha256',member->'assetManifest',
      member->>'releaseSha256',member->>'requestSha256',requested_client_mutation_id,nullif(trim(requested_release_note),''),actor_builder_user_id)
    returning * into component_release;
    if requested_book_slug<>'ultimate-b2' and (not builder_b1_component_integrity(component_release.id) or not builder_managed_release_sources_are_current(component_release.id)) then
      raise exception using errcode='PZ005',message='stale_release_preview';
    end if;
    member_hashes:=array_append(member_hashes,builder_product_member_sha256(member_position,component_slugs[member_position],'included',component_release.id,
      component_release.compiler_id,component_release.release_schema_version,component_release.release_sha256,component_release.runtime_compatibility_sha256,null));
  end loop;
  product_source_hash:=builder_product_source_sha256(requested_book_slug,next_product_number,component_slugs,member_hashes);
  product_hash:=builder_product_release_sha256(requested_compiler_id,requested_release_schema_version,requested_book_slug,next_product_number,product_source_hash,requested_release_note,component_slugs,member_hashes);
  insert into book_product_releases(id,book_package_id,release_number,release_schema_version,compiler_id,source_snapshot_sha256,release_sha256,request_sha256,client_mutation_id,release_note,created_by_builder_user_id)
  values(requested_product_release_id,resolved_package_id,next_product_number,requested_release_schema_version,requested_compiler_id,product_source_hash,product_hash,requested_request_sha256,requested_client_mutation_id,nullif(trim(requested_release_note),''),actor_builder_user_id)
  returning * into inserted_product;
  for member,member_position in select value,ordinality::int from jsonb_array_elements(requested_members) with ordinality loop
    insert into book_product_release_members(product_release_id,book_package_id,book_component_id,member_order,member_status,component_release_id,component_compiler_id,
      component_release_schema_version,component_release_sha256,runtime_compatibility_sha256,member_sha256)
    select inserted_product.id,resolved_package_id,component.id,member_position,'included',release.id,release.compiler_id,release.release_schema_version,
      release.release_sha256,release.runtime_compatibility_sha256,member_hashes[member_position]
    from book_components component join book_component_releases release on release.book_component_id=component.id
    where component.book_package_id=resolved_package_id and component.slug=component_slugs[member_position] and release.id=(member->>'releaseId')::uuid;
  end loop;
  insert into builder_audit_log(builder_user_id,action,target_type,target_id,metadata) values(actor_builder_user_id,'product_preview_release_created','book_product_release',inserted_product.id::text,
    jsonb_build_object('book_slug',requested_book_slug,'release_number',inserted_product.release_number,'release_sha256',inserted_product.release_sha256,'components',component_slugs));
  return query select 'created',inserted_product.id,inserted_product.release_number,inserted_product.source_snapshot_sha256,inserted_product.release_sha256,
    (select jsonb_agg(jsonb_build_object('componentSlug',component.slug,'order',family_member.member_order,'status',family_member.member_status,
      'componentReleaseId',family_member.component_release_id,'compilerId',family_member.component_compiler_id,'releaseSchemaVersion',family_member.component_release_schema_version,
      'releaseSha256',family_member.component_release_sha256,'compatibility',family_member.runtime_compatibility_sha256,'memberSha256',family_member.member_sha256,
      'unavailableReason',family_member.unavailable_reason) order by family_member.member_order)
     from book_product_release_members family_member join book_components component on component.id=family_member.book_component_id where family_member.product_release_id=inserted_product.id);
end;
$$;
