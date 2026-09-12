-- Additive overview UI settings; existing releases, documents and heads are untouched.
-- Retain the 063 asset checks verbatim, extending only the two raster bindings
-- and the optional, closed settings fields. Legacy documents keep their exact shape.
create or replace function builder_b1_overview_ui_settings_integrity(ui jsonb)
returns boolean language sql immutable as $$
 select coalesce(
   builder_publication_exact_keys(ui - 'overviewCaptionFontFamily' - 'independentPartsBackgrounds', array['schemaVersion','packageId','assets'])
   and (not ui ? 'overviewCaptionFontFamily' or (jsonb_typeof(ui->'overviewCaptionFontFamily')='string' and ui->>'overviewCaptionFontFamily' in ('Arial','Georgia','Verdana')))
   and (not ui ? 'independentPartsBackgrounds' or ui->'independentPartsBackgrounds'='true'::jsonb), false)
$$;

create or replace function builder_b1_ui_projection_integrity(ui jsonb, component_slug text)
returns boolean language plpgsql immutable as $$
declare binding record; family text; asset jsonb; extension text; media_type text; title_count int;
 catalog constant jsonb := '{"background.main":"raster","background.students-book-parts":"raster","background.workbook-parts":"raster","background.grammar-book-parts":"raster","branding.publisher-logo":"raster","title.gaf":"gaf","title.sd.1":"png","title.sd.2":"png","title.hd.1":"png","title.hd.2":"png","navigation.back":"raster","navigation.check":"raster","navigation.home":"raster","navigation.next":"raster","navigation.previous":"raster","navigation.close":"raster","navigation.minimize":"raster","navigation.settings":"raster","navigation.video":"raster","navigation.videoWorksheet":"raster","navigation.showText":"raster","navigation.showTextPressed":"raster","navigation.previousInternal":"raster","navigation.previousInternalDisabled":"raster","navigation.nextInternal":"raster","navigation.nextInternalDisabled":"raster","navibar.sb.active":"raster","navibar.gb.active":"raster","navibar.workbook.active":"raster","navibar.reload.active":"raster","navibar.reload.pressed":"raster","navibar.reload.disabled":"raster","navibar.show.all.active":"raster","navibar.show.all.pressed":"raster","navibar.show.all.disabled":"raster","navibar.show.next.active":"raster","navibar.show.next.pressed":"raster","navibar.show.next.disabled":"raster","unit.1.normal":"raster","unit.1.active":"raster","unit.2.normal":"raster","unit.2.active":"raster","unit.3.normal":"raster","unit.3.active":"raster","unit.4.normal":"raster","unit.4.active":"raster","unit.5.normal":"raster","unit.5.active":"raster","unit.6.normal":"raster","unit.6.active":"raster","unit.7.normal":"raster","unit.7.active":"raster","unit.8.normal":"raster","unit.8.active":"raster","unit.9.normal":"raster","unit.9.active":"raster","unit.10.normal":"raster","unit.10.active":"raster","edition.students-book.normal":"raster","edition.students-book.active":"raster","edition.workbook.normal":"raster","edition.workbook.active":"raster","edition.grammar-book.normal":"raster","edition.grammar-book.active":"raster","edition.extras.normal":"raster","edition.extras.active":"raster","extras.progress-checks.normal":"raster","extras.progress-checks.active":"raster","extras.reviews.normal":"raster","extras.reviews.active":"raster","extras.practice.normal":"raster","extras.practice.active":"raster","extras.videos.normal":"raster","extras.videos.active":"raster","extras.extra-videos.normal":"raster","extras.extra-videos.active":"raster","extras.word-lists.normal":"raster","extras.word-lists.active":"raster","extras.tests.normal":"raster","extras.tests.active":"raster","extras.games.normal":"raster","extras.games.active":"raster","extras.grammar-reference.normal":"raster","extras.grammar-reference.active":"raster","extras.irregular-verbs.normal":"raster","extras.irregular-verbs.active":"raster","extras.writing-bank.normal":"raster","extras.writing-bank.active":"raster","extras.speaking-bank.normal":"raster","extras.speaking-bank.active":"raster","extras.extra-tasks-for-early-finishers.normal":"raster","extras.extra-tasks-for-early-finishers.active":"raster","extras.worksheets-for-videos.normal":"raster","extras.worksheets-for-videos.active":"raster","toolbar.mouse.normal":"raster","toolbar.mouse.active":"raster","toolbar.pencil.normal":"raster","toolbar.pencil.active":"raster","toolbar.marker.normal":"raster","toolbar.marker.active":"raster","toolbar.eraser.normal":"raster","toolbar.eraser.active":"raster","toolbar.clear.normal":"raster","toolbar.clear.active":"raster","toolbar.zoom.normal":"raster","toolbar.zoom.active":"raster","toolbar.hide.normal":"raster","toolbar.hide.active":"raster","toolbar.show.normal":"raster","toolbar.show.active":"raster","toolbar.undo.normal":"raster","toolbar.undo.active":"raster","toolbar.redo.normal":"raster","toolbar.redo.active":"raster","toolbar.text.normal":"raster","toolbar.text.active":"raster","toolbar.annotations.normal":"raster","toolbar.annotations.active":"raster","toolbar.url.normal":"raster","toolbar.url.active":"raster","toolbar.save.normal":"raster","toolbar.save.active":"raster","toolbar.load.normal":"raster","toolbar.load.active":"raster","toolbar.timer.normal":"raster","toolbar.timer.active":"raster","toolbar.score.normal":"raster","toolbar.score.active":"raster","toolbar.print.normal":"raster","toolbar.print.active":"raster","toolbar.keyboard.normal":"raster","toolbar.keyboard.active":"raster","control.activity-hotspot":"raster","media-player.background":"raster","media-player.playActive":"raster","media-player.playPressed":"raster","media-player.pauseActive":"raster","media-player.pausePressed":"raster","media-player.stopActive":"raster","media-player.stopPressed":"raster","sound.button":"audio","sound.correct":"audio","sound.incorrect":"audio","sound.page-turn":"audio"}'::jsonb;
begin
 if not builder_b1_overview_ui_settings_integrity(ui) or ui->>'schemaVersion'<>'1.0'
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

-- Preserve optional settings in the source/projection equality check. All revision,
-- raw-source checksum, pin and metadata checks remain identical to migration 063.
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
      and ((d.payload - 'assets') || jsonb_build_object('assets',
        (select coalesce(jsonb_object_agg(key,(value-'originalFilename')||jsonb_build_object('extension',lower(value->>'extension'),'mediaType',lower(value->>'mediaType'))),'{}'::jsonb) from jsonb_each(d.payload->'assets'))))=release_row.teacher_projection->'ui') then return false; end if;
  end if;
  return true;
end;
$$;
