-- Additive B1/B1 Plus publication contracts. No content, heads or history are rewritten.
begin;

create or replace function builder_b1_publication_contract(requested_book_slug text)
returns jsonb language sql immutable as $$
  select case requested_book_slug
    when 'ultimate-b1' then '{"compilerId":"ultimate-b1-product-v1","components":["ultimate-b1-students-book","ultimate-b1-workbook"]}'::jsonb
    when 'ultimate-b1-plus' then '{"compilerId":"ultimate-b1-plus-product-v1","components":["ultimate-b1-plus-students-book","ultimate-b1-plus-workbook"]}'::jsonb
    else null end
$$;

-- Canonical JSON for the closed release contracts (schema/identity keys are ASCII).
-- Numbers use the shortest IEEE-754 representation, with JSON.stringify's decimal range.
create or replace function builder_publication_stable_json(value jsonb)
returns text language plpgsql immutable strict as $$
declare result text; number_value double precision;
begin
  case jsonb_typeof(value)
    when 'object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||builder_publication_stable_json(child),',' order by key collate "C"),'')||'}' into result from jsonb_each(value) entry(key,child);
    when 'array' then select '['||coalesce(string_agg(builder_publication_stable_json(child),',' order by position),'')||']' into result from jsonb_array_elements(value) with ordinality entry(child,position);
    when 'number' then
      number_value:=(value::text)::double precision;
      if number_value=0 then return '0'; end if;
      result:=number_value::text;
      if abs(number_value)>=0.000001 and abs(number_value)<1e21 then
        result:=(result::numeric)::text;
        if position('.' in result)>0 then result:=rtrim(rtrim(result,'0'),'.'); end if;
      else result:=regexp_replace(result,'e([+-])0+','e\1'); end if;
    else result:=value::text;
  end case;
  return result;
end $$;

create or replace function builder_publication_json_sha256(value jsonb)
returns text language sql immutable strict as $$
  select encode(digest(convert_to(builder_publication_stable_json(value),'UTF8'),'sha256'),'hex')
$$;

create or replace function builder_b1_managed_page_snapshot(requested_component_id uuid)
returns jsonb language sql volatile as $$
with scope as (
  select component.* from book_components component join book_packages package on package.id=component.book_package_id
  where component.id=requested_component_id and builder_b1_publication_contract(package.slug)->'components' ? component.slug
), current_units as (
  select unit.* from units unit join scope on scope.id=unit.book_component_id where unit.unit_number between 1 and 10
), current_pages as (
  select page.*,unit.slug unit_slug,unit.title unit_title,unit.unit_number,unit.sort_order unit_sort_order,
    asset.id asset_id,asset.checksum_sha256,asset.mime_type,asset.byte_size,asset.width,asset.height,
    asset.access_level,asset.storage_profile
  from book_pages page join scope on scope.id=page.book_component_id and scope.book_package_id=page.book_package_id
  left join current_units unit on unit.id=page.unit_id
  left join lateral (
    select candidate.* from book_assets candidate where candidate.page_id=page.id and candidate.book_component_id=scope.id
      and candidate.book_package_id=scope.book_package_id and candidate.asset_role='page_image' and candidate.publication_status='draft'
    order by candidate.updated_at desc,candidate.id desc limit 1
  ) asset on true
  where page.source_metadata->'is_active'='true'::jsonb and page.stable_key like scope.slug||'/pages/%'
), projected as (
  select jsonb_build_object('id',split_part(page.stable_key,'/pages/',2),'stableKey',page.stable_key,
    'unitId',page.unit_id,'unitSlug',page.unit_slug,'unitNumber',page.unit_number,'unitTitle',left(page.unit_title,200),
    'sectionTitle',left(coalesce(page.source_metadata->>'section_title',''),200),'printedLabel',left(coalesce(page.source_metadata->>'printed_label',''),80),
    'sortOrder',page.sort_order,'label',left(page.label,200),'image',jsonb_build_object(
      'sha256',page.checksum_sha256,'extension',case page.mime_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' end,
      'mediaType',page.mime_type,'role','managed_page_image','byteSize',page.byte_size,'width',page.width,'height',page.height)) value,
    page.unit_sort_order,page.unit_number,page.unit_slug,page.sort_order,page.stable_key
  from current_pages page where page.asset_id is not null and page.access_level='internal' and page.storage_profile='private'
)
select case when (select count(*) from projected)<>(select count(*) from current_pages) then null else jsonb_build_object(
  'units',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'title',left(title,200),'unitNumber',unit_number,'sortOrder',sort_order) order by sort_order,unit_number,slug),'[]'::jsonb) from current_units),
  'pages',(select coalesce(jsonb_agg(value order by unit_sort_order nulls last,unit_number,unit_slug,sort_order,stable_key),'[]'::jsonb) from projected)) end
$$;

-- Serialize source changes with publication, including writes that do not bump page revisions.
create or replace function lock_builder_b1_publication_source()
returns trigger language plpgsql as $$
declare component_id uuid;
begin
  for component_id in select component.id from book_components component join book_packages package on package.id=component.book_package_id
    where component.id in (case when tg_op<>'DELETE' then new.book_component_id end,case when tg_op<>'INSERT' then old.book_component_id end)
      and builder_b1_publication_contract(package.slug)->'components' ? component.slug order by component.id loop
    perform pg_advisory_xact_lock(hashtextextended('builder-publication-component:'||component_id::text,0));
  end loop;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger units_b1_publication_lock before insert or update or delete on units for each row execute function lock_builder_b1_publication_source();
create trigger pages_b1_publication_lock before insert or update or delete on book_pages for each row execute function lock_builder_b1_publication_source();
create trigger assets_b1_publication_lock before insert or update or delete on book_assets for each row execute function lock_builder_b1_publication_source();
create trigger documents_b1_publication_lock before insert or update or delete on builder_component_documents for each row execute function lock_builder_b1_publication_source();

create or replace function builder_b1_component_integrity(requested_release_id uuid)
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

create or replace function builder_b1_product_integrity(requested_product_release_id uuid)
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
      or not builder_b1_component_integrity(member.component_release_id)
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

-- Existing B2 recipes and transactional flows are retained; new identities dispatch explicitly.
create or replace function builder_product_member_sha256(
  requested_order int,requested_component_slug text,requested_status text,requested_component_release_id uuid,
  requested_compiler_id text,requested_release_schema_version text,requested_release_sha256 text,
  requested_compatibility text,requested_unavailable_reason text
)
returns text language sql immutable as $$
  select encode(digest(convert_to(array_to_string(array[
    case when requested_component_slug in ('ultimate-b1-students-book','ultimate-b1-workbook') then 'ultimate-b1-product-member-v1' when requested_component_slug in ('ultimate-b1-plus-students-book','ultimate-b1-plus-workbook') then 'ultimate-b1-plus-product-member-v1' else 'ultimate-b2-product-member-v1' end,requested_order::text,requested_component_slug,requested_status,
    coalesce(requested_component_release_id::text,'-'),coalesce(requested_compiler_id,'-'),
    coalesce(requested_release_schema_version,'-'),coalesce(requested_release_sha256,'-'),
    coalesce(requested_compatibility,'-'),coalesce(requested_unavailable_reason,'-')
  ],E'\n'),'UTF8'),'sha256'),'hex')
$$;

create or replace function builder_product_source_sha256(
  requested_book_slug text,requested_release_number bigint,requested_component_slugs text[],requested_member_hashes text[]
)
returns text language plpgsql immutable as $$
declare fingerprint text;
begin
  if cardinality(requested_component_slugs)<>cardinality(requested_member_hashes) then raise exception 'product member hash topology is invalid'; end if;
  fingerprint:=array_to_string(array[case when builder_b1_publication_contract(requested_book_slug) is not null then requested_book_slug||'-product-source-v1' else 'ultimate-b2-product-source-v1' end,requested_book_slug,requested_release_number::text],E'\n');
  for position in 1..cardinality(requested_component_slugs) loop
    fingerprint:=fingerprint||E'\n'||requested_component_slugs[position]||E'\t'||requested_member_hashes[position];
  end loop;
  return encode(digest(convert_to(fingerprint,'UTF8'),'sha256'),'hex');
end;
$$;

create or replace function builder_product_release_sha256(
  requested_compiler_id text,requested_release_schema_version text,requested_book_slug text,requested_release_number bigint,
  requested_source_sha256 text,requested_release_note text,requested_component_slugs text[],requested_member_hashes text[]
)
returns text language plpgsql immutable as $$
declare fingerprint text;
begin
  if cardinality(requested_component_slugs)<>cardinality(requested_member_hashes) then raise exception 'product member hash topology is invalid'; end if;
  fingerprint:=array_to_string(array[case when builder_b1_publication_contract(requested_book_slug) is not null then requested_book_slug||'-product-release-v1' else 'ultimate-b2-product-release-v1' end,requested_compiler_id,requested_release_schema_version,
    requested_book_slug,requested_release_number::text,requested_source_sha256,coalesce(requested_release_note,'')],E'\n');
  for position in 1..cardinality(requested_component_slugs) loop
    fingerprint:=fingerprint||E'\n'||requested_component_slugs[position]||E'\t'||requested_member_hashes[position];
  end loop;
  return encode(digest(convert_to(fingerprint,'UTF8'),'sha256'),'hex');
end;
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
  if release_row.compiler_id in ('ultimate-b1-students-book-v1','ultimate-b1-workbook-v1','ultimate-b1-plus-students-book-v1','ultimate-b1-plus-workbook-v1')
    and builder_b1_managed_page_snapshot(release_row.book_component_id) is distinct from jsonb_build_object('units',release_row.public_projection->'units','pages',release_row.public_projection->'pages') then return false; end if;
  if release_row.compiler_id in ('ultimate-b1-students-book-v1','ultimate-b1-workbook-v1','ultimate-b1-plus-students-book-v1','ultimate-b1-plus-workbook-v1') and exists(
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
      case when member.compiler_id in ('ultimate-b2-workbook-v1','ultimate-b2-grammar-book-v1','ultimate-b1-students-book-v1','ultimate-b1-workbook-v1','ultimate-b1-plus-students-book-v1','ultimate-b1-plus-workbook-v1')
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
    expected_compilers:=array[component_slugs[1]||'-v1',component_slugs[2]||'-v1']; expected_schemas:=array['1.0','1.0'];
  end if;
  -- Expanded schema accepts old-code v2 prepares as well as explicit v3. This
  -- changes no existing family/member/head and activates no source policy.
  if requested_book_slug='ultimate-b2' and requested_members->0->>'compilerId'='ultimate-b2-students-book-v3' then
    expected_compilers[1]:='ultimate-b2-students-book-v3'; expected_schemas[1]:='3.0';
  end if;
  if (requested_book_slug is distinct from 'ultimate-b2' and builder_b1_publication_contract(requested_book_slug) is null) or requested_release_schema_version is distinct from '1.0' or requested_compiler_id is distinct from requested_book_slug||'-product-v1'
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

create or replace function publish_builder_product_release(
  requested_book_slug text,requested_product_release_id uuid,expected_head_revision bigint,requested_request_sha256 text,
  actor_builder_user_id uuid,requested_client_mutation_id uuid
)
returns table(outcome text,product_release_id uuid,product_release_number bigint,head_revision bigint,previous_product_release_id uuid,published_at timestamptz)
language plpgsql as $$
declare
  resolved_package_id uuid; candidate book_product_releases%rowtype; replay book_product_publication_mutations%rowtype;
  current_head book_product_publication_heads%rowtype; component_head book_component_publication_heads%rowtype; member record;
  next_head_revision bigint; next_component_revision bigint; publication_time timestamptz:=now(); included_count int;
begin
  if not exists(select 1 from builder_users where id=actor_builder_user_id and status='active' and role='developer') then
    return query select 'unauthorized_actor',null::uuid,null::bigint,null::bigint,null::uuid,null::timestamptz; return; end if;
  select id into resolved_package_id from book_packages where slug=requested_book_slug;
  if resolved_package_id is null then return query select 'product_not_found',null::uuid,null::bigint,null::bigint,null::uuid,null::timestamptz; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('builder-product-publication:'||resolved_package_id::text,0));
  select * into replay from book_product_publication_mutations where book_package_id=resolved_package_id and client_mutation_id=requested_client_mutation_id;
  if replay.id is not null then
    select * into candidate from book_product_releases where id=replay.product_release_id;
    return query select case when replay.product_release_id=requested_product_release_id and replay.request_sha256=requested_request_sha256 then 'idempotent' else 'mutation_id_conflict' end,
      replay.product_release_id,candidate.release_number,replay.resulting_head_revision,replay.previous_product_release_id,replay.published_at; return;
  end if;
  select * into candidate from book_product_releases where id=requested_product_release_id and book_package_id=resolved_package_id;
  if candidate.id is null then return query select 'release_not_found',null::uuid,null::bigint,null::bigint,null::uuid,null::timestamptz; return; end if;
  select count(*) into included_count from book_product_release_members family_member
  where family_member.product_release_id=candidate.id and family_member.member_status='included';
  if (requested_book_slug='ultimate-b2' and (candidate.compiler_id<>'ultimate-b2-product-v1' or included_count<>3))
    or (requested_book_slug<>'ultimate-b2' and not builder_b1_product_integrity(candidate.id)) then return query select 'incomplete_product_release',candidate.id,candidate.release_number,null::bigint,null::uuid,null::timestamptz; return; end if;
  for member in select family_member.*,component.slug from book_product_release_members family_member join book_components component on component.id=family_member.book_component_id
    where family_member.product_release_id=candidate.id and family_member.member_status='included' order by component.slug loop
    perform pg_advisory_xact_lock(hashtextextended('builder-publication-component:'||member.book_component_id::text,0));
  end loop;
  select * into current_head from book_product_publication_heads where book_package_id=resolved_package_id for update;
  if coalesce(current_head.head_revision,0)<>expected_head_revision then return query select 'head_conflict',candidate.id,candidate.release_number,coalesce(current_head.head_revision,0),current_head.product_release_id,current_head.published_at; return; end if;
  if current_head.product_release_id=candidate.id then
    insert into book_product_publication_mutations(book_package_id,product_release_id,request_sha256,client_mutation_id,outcome,resulting_head_revision,previous_product_release_id,published_at)
    values(resolved_package_id,candidate.id,requested_request_sha256,requested_client_mutation_id,'already_active',current_head.head_revision,current_head.product_release_id,current_head.published_at);
    return query select 'already_active',candidate.id,candidate.release_number,current_head.head_revision,current_head.product_release_id,current_head.published_at; return;
  end if;
  if not builder_product_release_sources_are_current(candidate.id) then return query select 'stale_release_preview',candidate.id,candidate.release_number,coalesce(current_head.head_revision,0),current_head.product_release_id,current_head.published_at; return; end if;
  for member in select family_member.*,component.slug from book_product_release_members family_member join book_components component on component.id=family_member.book_component_id
    where family_member.product_release_id=candidate.id and family_member.member_status='included' order by component.slug loop
    select * into component_head from book_component_publication_heads where book_component_id=member.book_component_id for update;
    next_component_revision:=coalesce(component_head.head_revision,0)+1;
    insert into book_component_publication_heads(book_component_id,book_package_id,release_id,head_revision,published_by_builder_user_id,published_at)
    values(member.book_component_id,resolved_package_id,member.component_release_id,next_component_revision,actor_builder_user_id,publication_time)
    on conflict(book_component_id) do update set release_id=excluded.release_id,head_revision=excluded.head_revision,published_by_builder_user_id=excluded.published_by_builder_user_id,published_at=excluded.published_at;
    insert into book_component_publication_events(book_package_id,book_component_id,previous_release_id,release_id,expected_head_revision,resulting_head_revision,request_sha256,client_mutation_id,published_by_builder_user_id,published_at)
    values(resolved_package_id,member.book_component_id,component_head.release_id,member.component_release_id,coalesce(component_head.head_revision,0),next_component_revision,requested_request_sha256,requested_client_mutation_id,actor_builder_user_id,publication_time);
    insert into book_component_publication_mutations(book_component_id,release_id,request_sha256,client_mutation_id,outcome,resulting_head_revision,previous_release_id,published_at)
    values(member.book_component_id,member.component_release_id,requested_request_sha256,requested_client_mutation_id,'published',next_component_revision,component_head.release_id,publication_time);
  end loop;
  next_head_revision:=coalesce(current_head.head_revision,0)+1;
  insert into book_product_publication_heads(book_package_id,product_release_id,head_revision,published_by_builder_user_id,published_at)
  values(resolved_package_id,candidate.id,next_head_revision,actor_builder_user_id,publication_time)
  on conflict(book_package_id) do update set product_release_id=excluded.product_release_id,head_revision=excluded.head_revision,published_by_builder_user_id=excluded.published_by_builder_user_id,published_at=excluded.published_at;
  insert into book_product_publication_events(book_package_id,previous_product_release_id,product_release_id,expected_head_revision,resulting_head_revision,request_sha256,client_mutation_id,published_by_builder_user_id,published_at)
  values(resolved_package_id,current_head.product_release_id,candidate.id,expected_head_revision,next_head_revision,requested_request_sha256,requested_client_mutation_id,actor_builder_user_id,publication_time);
  insert into book_product_publication_mutations(book_package_id,product_release_id,request_sha256,client_mutation_id,outcome,resulting_head_revision,previous_product_release_id,published_at)
  values(resolved_package_id,candidate.id,requested_request_sha256,requested_client_mutation_id,'published',next_head_revision,current_head.product_release_id,publication_time);
  insert into builder_audit_log(builder_user_id,action,target_type,target_id,metadata) values(actor_builder_user_id,'product_release_published','book_product_release',candidate.id::text,
    jsonb_build_object('book_slug',requested_book_slug,'release_number',candidate.release_number,'previous_release_id',current_head.product_release_id,'head_revision',next_head_revision));
  return query select 'published',candidate.id,candidate.release_number,next_head_revision,current_head.product_release_id,publication_time;
end;
$$;

create or replace function builder_current_legacy_activity_allowed(requested_component_id uuid)
returns boolean language sql stable as $policy$
  select not exists(select 1 from book_components component join book_packages package on package.id=component.book_package_id
    where component.id=requested_component_id and builder_b1_publication_contract(package.slug)->'components' ? component.slug)
  and not exists(
    select 1 from book_components component join book_packages package on package.id=component.book_package_id
    join book_component_releases release on release.book_component_id=component.id and release.book_package_id=package.id
    join book_component_publication_events event on event.release_id=release.id and event.book_component_id=component.id
    where component.id=requested_component_id and package.slug='ultimate-b2' and component.slug='ultimate-b2-students-book'
      and release.compiler_id='ultimate-b2-students-book-v3' and release.release_schema_version='3.0'
      and release.runtime_compatibility_sha256='e7b80ea67f4d36cd2055a99cb1dd390c871658fd29c513b6552ef8a4bdb214e2'
  )
$policy$;

commit;
