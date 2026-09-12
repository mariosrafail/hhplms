-- Optional managed overview typography. No historical data or compiler changes.
create or replace function builder_overview_font_reference_integrity(reference jsonb)
returns boolean language sql immutable as $$
 select coalesce(builder_publication_exact_keys(reference,array['assetId','checksumSha256','role','slot'])
   and jsonb_typeof(reference->'assetId')='string'
   and reference->>'assetId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   and jsonb_typeof(reference->'checksumSha256')='string' and reference->>'checksumSha256' ~ '^[a-f0-9]{64}$'
   and reference->>'role'='activity_font'
   and reference->>'slot'='font-'||replace(reference->>'assetId','-',''),false)
$$;

create or replace function builder_b1_overview_ui_settings_integrity(ui jsonb)
returns boolean language sql immutable as $$
 select coalesce(
   builder_publication_exact_keys(ui - 'overviewCaptionFontFamily' - 'overviewCaptionFontAsset' - 'independentPartsBackgrounds', array['schemaVersion','packageId','assets'])
   and (not ui ? 'overviewCaptionFontFamily' or (jsonb_typeof(ui->'overviewCaptionFontFamily')='string' and ui->>'overviewCaptionFontFamily' in ('Arial','Georgia','Verdana')))
   and (not ui ? 'overviewCaptionFontAsset' or (not ui ? 'overviewCaptionFontFamily' and builder_overview_font_reference_integrity(ui->'overviewCaptionFontAsset')))
   and (not ui ? 'independentPartsBackgrounds' or ui->'independentPartsBackgrounds'='true'::jsonb), false)
$$;

create or replace function validate_builder_overview_font_document()
returns trigger language plpgsql as $$
declare book_slug text; component_slug text; reference jsonb;
begin
 if new.document_type<>'teacher_ui' or not new.payload ? 'overviewCaptionFontAsset' then return new; end if;
 reference:=new.payload->'overviewCaptionFontAsset';
 select p.slug,c.slug into book_slug,component_slug from book_packages p join book_components c on c.book_package_id=p.id
   where p.id=new.book_package_id and c.id=new.book_component_id;
 if book_slug not in ('ultimate-b1','ultimate-b1-plus','ultimate-b2') or component_slug is distinct from book_slug||'-students-book'
   or new.payload->>'packageId' is distinct from component_slug or not builder_b1_overview_ui_settings_integrity(new.payload)
   or not exists(select 1 from book_assets a where a.id::text=reference->>'assetId' and a.book_package_id=new.book_package_id and a.book_component_id=new.book_component_id
     and a.checksum_sha256=reference->>'checksumSha256' and a.asset_role='activity_font' and a.mime_type='font/ttf'
     and a.publication_status='draft' and a.access_level='internal' and a.storage_profile='private'
     and a.byte_size between 1 and 12582912 and a.source_metadata->>'font_library_scope'='component'
     and a.object_key='builder-font-library/'||book_slug||'/'||component_slug||'/assets/'||(reference->>'checksumSha256')||'.ttf')
 then raise exception 'invalid_overview_font_reference'; end if;
 return new;
end $$;

create trigger builder_overview_font_document before insert or update on builder_component_documents
 for each row execute function validate_builder_overview_font_document();

-- Deferred until the existing atomic product writer has inserted the private pins.
-- The reference remains Teacher-only; a public descriptor is allowed only when
-- a native public activity independently references this same managed asset.
create or replace function validate_builder_overview_font_release()
returns trigger language plpgsql as $$
declare reference jsonb; ui jsonb; descriptor jsonb; book_slug text; component_slug text;
begin
 ui:=new.teacher_projection->'ui';
 if not coalesce(ui ? 'overviewCaptionFontAsset',false) then return new; end if;
 reference:=ui->'overviewCaptionFontAsset';
 select p.slug,c.slug into book_slug,component_slug from book_packages p join book_components c on c.book_package_id=p.id
   where p.id=new.book_package_id and c.id=new.book_component_id;
 descriptor:=jsonb_build_object('sha256',reference->>'checksumSha256','extension','ttf','mediaType','font/ttf','role','activity_font');
 if component_slug is distinct from book_slug||'-students-book' or not builder_b1_ui_projection_integrity(ui,component_slug)
   or (select count(*) from jsonb_array_elements(new.asset_manifest) a where a=descriptor)<>1
   or exists(select 1 from jsonb_array_elements(new.public_projection->'assets') a where a=descriptor
     and not exists(select 1 from jsonb_each(new.public_projection->'nativeActivities') activity,
       lateral jsonb_array_elements(activity.value#>'{document,assets}') ref where ref=reference))
   or not exists(select 1 from builder_component_documents d where d.book_component_id=new.book_component_id and d.book_package_id=new.book_package_id
     and d.document_type='teacher_ui' and d.document_key='default'
     and d.revision=(new.source_snapshot#>>'{teacherUi,revision}')::bigint
     and builder_publication_json_sha256(d.payload)=new.source_snapshot#>>'{teacherUi,sha256}'
     and (d.payload-'assets')||jsonb_build_object('assets',(select coalesce(jsonb_object_agg(key,value-'originalFilename'),'{}'::jsonb) from jsonb_each(d.payload->'assets')))=ui)
 then raise exception 'invalid_overview_font_release'; end if;
 if new.asset_storage_mode='pinned-source-v1' and not exists(select 1 from book_component_release_asset_pins pin
   where pin.component_release_id=new.id and pin.book_package_id=new.book_package_id and pin.book_component_id=new.book_component_id
     and pin.book_asset_id::text=reference->>'assetId' and pin.checksum_sha256=reference->>'checksumSha256'
     and pin.asset_role='activity_font' and pin.source_asset_role='activity_font' and pin.media_type='font/ttf' and pin.extension='ttf'
     and pin.storage_profile='private' and pin.source_owner_key='component' and pin.source_asset_slot='')
 then raise exception 'invalid_overview_font_release_pin'; end if;
 return new;
end $$;

create constraint trigger builder_overview_font_release after insert on book_component_releases
 deferrable initially deferred for each row execute function validate_builder_overview_font_release();
