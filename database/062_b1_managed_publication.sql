-- Additive B1/B1 Plus publication contracts. No content, heads or history are rewritten.

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


-- Canonical source operations lock before their first row or narrower advisory lock.
-- A read-only scope lookup cannot block a publisher. Locked lookups/authorization
-- in each operation still validate the request after serialization.
create or replace function lock_builder_b1_component_source(requested_component_id uuid)
returns void language plpgsql as $$
begin
  if exists(select 1 from book_components component join book_packages package on package.id=component.book_package_id
    where component.id=requested_component_id and builder_b1_publication_contract(package.slug)->'components' ? component.slug) then
    perform pg_advisory_xact_lock(hashtextextended('builder-publication-component:'||requested_component_id::text,0));
  end if;
end $$;


-- Effective 032_builder_component_authoring.sql definition; early B1 source serialization.
create or replace function save_builder_component_document(
  requested_book_slug text,
  requested_component_slug text,
  requested_document_type text,
  requested_document_key text,
  requested_schema_version text,
  expected_revision bigint,
  requested_payload jsonb,
  requested_payload_sha256 text,
  actor_builder_user_id uuid,
  requested_client_mutation_id uuid
)
returns table (
  outcome text,
  document_id uuid,
  saved_revision bigint,
  current_revision bigint,
  saved_payload jsonb,
  saved_payload_sha256 text
)
language plpgsql
as $$
declare
  resolved_package_id uuid;
  resolved_component_id uuid;
  current_document_id uuid;
  current_document_revision bigint;
  next_revision bigint;
  replay_revision bigint;
  replay_payload jsonb;
  replay_payload_sha256 text;
begin
  perform lock_builder_b1_component_source((select component.id from book_components component join book_packages package on package.id=component.book_package_id where package.slug=requested_book_slug and component.slug=requested_component_slug));
  if not exists (
    select 1 from builder_users
    where id = actor_builder_user_id and status = 'active' and role = 'developer'
  ) then
    return query select 'unauthorized_actor'::text, null::uuid, null::bigint, null::bigint, null::jsonb, null::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', 'builder-document', requested_book_slug, requested_component_slug,
      requested_document_type, requested_document_key),
    0
  ));

  select package.id, component.id
  into resolved_package_id, resolved_component_id
  from book_packages package
  join book_components component on component.book_package_id = package.id
  where package.slug = requested_book_slug
    and component.slug = requested_component_slug
  limit 1;

  if resolved_package_id is null or resolved_component_id is null then
    return query select 'resource_not_found'::text, null::uuid, null::bigint, null::bigint, null::jsonb, null::text;
    return;
  end if;

  select document.id, document.revision
  into current_document_id, current_document_revision
  from builder_component_documents document
  where document.book_component_id = resolved_component_id
    and document.document_type = requested_document_type
    and document.document_key = requested_document_key
  for update;

  if current_document_id is not null then
    select history.revision, history.payload, history.payload_sha256
    into replay_revision, replay_payload, replay_payload_sha256
    from builder_component_document_revisions history
    where history.document_id = current_document_id
      and history.client_mutation_id = requested_client_mutation_id;

    if replay_revision is not null then
      if replay_payload_sha256 <> requested_payload_sha256 then
        return query select 'mutation_id_conflict'::text, current_document_id, replay_revision,
          current_document_revision, null::jsonb, replay_payload_sha256;
      else
        return query select 'idempotent'::text, current_document_id, replay_revision,
          current_document_revision, replay_payload, replay_payload_sha256;
      end if;
      return;
    end if;

    if current_document_revision <> expected_revision then
      return query select 'revision_conflict'::text, current_document_id, null::bigint,
        current_document_revision, null::jsonb, null::text;
      return;
    end if;

    next_revision := current_document_revision + 1;
    update builder_component_documents
    set schema_version = requested_schema_version,
        revision = next_revision,
        payload = requested_payload,
        payload_sha256 = requested_payload_sha256,
        updated_by_builder_user_id = actor_builder_user_id,
        updated_at = now()
    where id = current_document_id;
  else
    if expected_revision <> 0 then
      return query select 'revision_conflict'::text, null::uuid, null::bigint,
        0::bigint, null::jsonb, null::text;
      return;
    end if;

    next_revision := 1;
    insert into builder_component_documents(
      book_package_id, book_component_id, document_type, document_key,
      schema_version, revision, payload, payload_sha256,
      created_by_builder_user_id, updated_by_builder_user_id
    ) values (
      resolved_package_id, resolved_component_id, requested_document_type, requested_document_key,
      requested_schema_version, next_revision, requested_payload, requested_payload_sha256,
      actor_builder_user_id, actor_builder_user_id
    ) returning id into current_document_id;
  end if;

  insert into builder_component_document_revisions(
    document_id, revision, payload, payload_sha256,
    changed_by_builder_user_id, client_mutation_id
  ) values (
    current_document_id, next_revision, requested_payload, requested_payload_sha256,
    actor_builder_user_id, requested_client_mutation_id
  );

  insert into builder_audit_log(builder_user_id, action, target_type, target_id, metadata)
  values (
    actor_builder_user_id,
    'builder_document_saved',
    'builder_component_document',
    current_document_id::text,
    jsonb_build_object(
      'book_slug', requested_book_slug,
      'component_slug', requested_component_slug,
      'document_type', requested_document_type,
      'revision', next_revision,
      'source', 'database'
    )
  );

  return query select 'saved'::text, current_document_id, next_revision,
    next_revision, requested_payload, requested_payload_sha256;
end;
$$;

-- Effective 036_builder_native_activity_foundation.sql definition; early B1 source serialization.
create or replace function create_builder_native_activity(
  requested_book_slug text,
  requested_component_slug text,
  requested_activity_id text,
  requested_kind text,
  expected_index_revision bigint,
  requested_index_payload jsonb,
  requested_index_sha256 text,
  requested_public_payload jsonb,
  requested_public_sha256 text,
  requested_teacher_payload jsonb,
  requested_teacher_sha256 text,
  requested_schema_version text,
  requested_request_sha256 text,
  actor_builder_user_id uuid,
  requested_client_mutation_id uuid
)
returns table (
  outcome text,
  activity_id text,
  index_revision bigint,
  public_revision bigint,
  teacher_revision bigint
)
language plpgsql
as $$
declare
  resolved_package_id uuid;
  resolved_component_id uuid;
  index_document_id uuid;
  public_document_id uuid;
  teacher_document_id uuid;
  current_index_revision bigint;
  next_index_revision bigint;
  replay builder_native_activity_creation_mutations%rowtype;
begin
  perform lock_builder_b1_component_source((select component.id from book_components component join book_packages package on package.id=component.book_package_id where package.slug=requested_book_slug and component.slug=requested_component_slug));
  if not exists (
    select 1 from builder_users
    where id = actor_builder_user_id and status = 'active' and role = 'developer'
  ) then
    return query select 'unauthorized_actor'::text, null::text, null::bigint, null::bigint, null::bigint;
    return;
  end if;

  select package.id, component.id
  into resolved_package_id, resolved_component_id
  from book_packages package
  join book_components component on component.book_package_id = package.id
  where package.slug = requested_book_slug and component.slug = requested_component_slug
  limit 1;

  if resolved_component_id is null then
    return query select 'resource_not_found'::text, null::text, null::bigint, null::bigint, null::bigint;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('builder-native-activity-component:' || resolved_component_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('builder-publication-component:' || resolved_component_id::text, 0));

  select * into replay
  from builder_native_activity_creation_mutations
  where book_component_id = resolved_component_id and client_mutation_id = requested_client_mutation_id;

  if replay.id is not null then
    if replay.request_sha256 <> requested_request_sha256 then
      return query select 'mutation_id_conflict'::text, replay.activity_id, replay.resulting_index_revision, 1::bigint, 1::bigint;
    else
      return query select 'idempotent'::text, replay.activity_id, replay.resulting_index_revision, 1::bigint, 1::bigint;
    end if;
    return;
  end if;

  select document.id, document.revision
  into index_document_id, current_index_revision
  from builder_component_documents document
  where document.book_component_id = resolved_component_id
    and document.document_type = 'native_activity_index'
    and document.document_key = 'default'
  for update;

  current_index_revision := coalesce(current_index_revision, 0);
  if current_index_revision <> expected_index_revision then
    return query select 'revision_conflict'::text, null::text, current_index_revision, null::bigint, null::bigint;
    return;
  end if;

  if exists (
    select 1 from builder_component_documents
    where book_component_id = resolved_component_id
      and document_key = requested_activity_id
      and document_type in ('native_activity_public', 'native_activity_teacher')
  ) then
    return query select 'identity_conflict'::text, requested_activity_id, current_index_revision, null::bigint, null::bigint;
    return;
  end if;

  next_index_revision := current_index_revision + 1;
  if index_document_id is null then
    insert into builder_component_documents(
      book_package_id, book_component_id, document_type, document_key, schema_version,
      revision, payload, payload_sha256, created_by_builder_user_id, updated_by_builder_user_id
    ) values (
      resolved_package_id, resolved_component_id, 'native_activity_index', 'default', requested_schema_version,
      next_index_revision, requested_index_payload, requested_index_sha256, actor_builder_user_id, actor_builder_user_id
    ) returning id into index_document_id;
  else
    update builder_component_documents
    set schema_version=requested_schema_version, revision=next_index_revision,
        payload=requested_index_payload, payload_sha256=requested_index_sha256,
        updated_by_builder_user_id=actor_builder_user_id, updated_at=now()
    where id=index_document_id;
  end if;

  insert into builder_component_documents(
    book_package_id, book_component_id, document_type, document_key, schema_version,
    revision, payload, payload_sha256, created_by_builder_user_id, updated_by_builder_user_id
  ) values (
    resolved_package_id, resolved_component_id, 'native_activity_public', requested_activity_id, requested_schema_version,
    1, requested_public_payload, requested_public_sha256, actor_builder_user_id, actor_builder_user_id
  ) returning id into public_document_id;

  insert into builder_component_documents(
    book_package_id, book_component_id, document_type, document_key, schema_version,
    revision, payload, payload_sha256, created_by_builder_user_id, updated_by_builder_user_id
  ) values (
    resolved_package_id, resolved_component_id, 'native_activity_teacher', requested_activity_id, requested_schema_version,
    1, requested_teacher_payload, requested_teacher_sha256, actor_builder_user_id, actor_builder_user_id
  ) returning id into teacher_document_id;

  insert into builder_component_document_revisions(document_id, revision, payload, payload_sha256, changed_by_builder_user_id, client_mutation_id)
  values
    (index_document_id, next_index_revision, requested_index_payload, requested_index_sha256, actor_builder_user_id, requested_client_mutation_id),
    (public_document_id, 1, requested_public_payload, requested_public_sha256, actor_builder_user_id, requested_client_mutation_id),
    (teacher_document_id, 1, requested_teacher_payload, requested_teacher_sha256, actor_builder_user_id, requested_client_mutation_id);

  insert into builder_native_activity_creation_mutations(
    book_component_id, client_mutation_id, request_sha256, activity_id,
    resulting_index_revision, created_by_builder_user_id
  ) values (
    resolved_component_id, requested_client_mutation_id, requested_request_sha256, requested_activity_id,
    next_index_revision, actor_builder_user_id
  );

  insert into builder_audit_log(builder_user_id, action, target_type, target_id, metadata)
  values (actor_builder_user_id, 'native_activity_created', 'builder_component_document', public_document_id::text,
    jsonb_build_object('book_slug', requested_book_slug, 'component_slug', requested_component_slug,
      'activity_id', requested_activity_id, 'kind', requested_kind, 'index_revision', next_index_revision));

  return query select 'created'::text, requested_activity_id, next_index_revision, 1::bigint, 1::bigint;
end;
$$;

-- Effective 037_builder_native_open_response_authoring.sql definition; early B1 source serialization.
create or replace function save_builder_native_activity_pair(
  requested_book_slug text,
  requested_component_slug text,
  requested_activity_id text,
  requested_schema_version text,
  expected_public_revision bigint,
  expected_teacher_revision bigint,
  requested_public_payload jsonb,
  requested_public_sha256 text,
  requested_teacher_payload jsonb,
  requested_teacher_sha256 text,
  requested_request_sha256 text,
  actor_builder_user_id uuid,
  requested_client_mutation_id uuid
)
returns table(outcome text, public_revision bigint, teacher_revision bigint, current_public_revision bigint, current_teacher_revision bigint)
language plpgsql as $$
declare
  resolved_component_id uuid;
  public_document builder_component_documents%rowtype;
  teacher_document builder_component_documents%rowtype;
  replay builder_native_activity_pair_mutations%rowtype;
  next_public_revision bigint;
  next_teacher_revision bigint;
begin
  perform lock_builder_b1_component_source((select component.id from book_components component join book_packages package on package.id=component.book_package_id where package.slug=requested_book_slug and component.slug=requested_component_slug));
  if not exists(select 1 from builder_users where id=actor_builder_user_id and status='active' and role='developer') then
    return query select 'unauthorized_actor'::text,null::bigint,null::bigint,null::bigint,null::bigint; return;
  end if;
  select component.id into resolved_component_id
  from book_packages package join book_components component on component.book_package_id=package.id
  where package.slug=requested_book_slug and component.slug=requested_component_slug limit 1;
  if resolved_component_id is null then
    return query select 'resource_not_found'::text,null::bigint,null::bigint,null::bigint,null::bigint; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('builder-native-activity:' || resolved_component_id::text || ':' || requested_activity_id,0));
  select * into replay from builder_native_activity_pair_mutations
  where book_component_id=resolved_component_id and activity_id=requested_activity_id and client_mutation_id=requested_client_mutation_id;
  if replay.id is not null then
    if replay.request_sha256<>requested_request_sha256 then
      return query select 'mutation_id_conflict'::text,replay.resulting_public_revision,replay.resulting_teacher_revision,replay.resulting_public_revision,replay.resulting_teacher_revision;
    else
      return query select 'idempotent'::text,replay.resulting_public_revision,replay.resulting_teacher_revision,replay.resulting_public_revision,replay.resulting_teacher_revision;
    end if;
    return;
  end if;

  select * into public_document from builder_component_documents
  where book_component_id=resolved_component_id and document_type='native_activity_public' and document_key=requested_activity_id for update;
  select * into teacher_document from builder_component_documents
  where book_component_id=resolved_component_id and document_type='native_activity_teacher' and document_key=requested_activity_id for update;
  if public_document.id is null or teacher_document.id is null then
    return query select 'resource_not_found'::text,null::bigint,null::bigint,null::bigint,null::bigint; return;
  end if;
  if public_document.revision<>expected_public_revision or teacher_document.revision<>expected_teacher_revision then
    return query select 'revision_conflict'::text,null::bigint,null::bigint,public_document.revision,teacher_document.revision; return;
  end if;

  next_public_revision := public_document.revision + 1;
  next_teacher_revision := teacher_document.revision + 1;
  update builder_component_documents set schema_version=requested_schema_version,revision=next_public_revision,payload=requested_public_payload,payload_sha256=requested_public_sha256,updated_by_builder_user_id=actor_builder_user_id,updated_at=now() where id=public_document.id;
  update builder_component_documents set schema_version=requested_schema_version,revision=next_teacher_revision,payload=requested_teacher_payload,payload_sha256=requested_teacher_sha256,updated_by_builder_user_id=actor_builder_user_id,updated_at=now() where id=teacher_document.id;
  insert into builder_component_document_revisions(document_id,revision,payload,payload_sha256,changed_by_builder_user_id,client_mutation_id)
  values
    (public_document.id,next_public_revision,requested_public_payload,requested_public_sha256,actor_builder_user_id,requested_client_mutation_id),
    (teacher_document.id,next_teacher_revision,requested_teacher_payload,requested_teacher_sha256,actor_builder_user_id,requested_client_mutation_id);
  insert into builder_native_activity_pair_mutations(book_component_id,activity_id,client_mutation_id,request_sha256,resulting_public_revision,resulting_teacher_revision,created_by_builder_user_id)
  values(resolved_component_id,requested_activity_id,requested_client_mutation_id,requested_request_sha256,next_public_revision,next_teacher_revision,actor_builder_user_id);
  insert into builder_audit_log(builder_user_id,action,target_type,target_id,metadata)
  values(actor_builder_user_id,'native_activity_pair_saved','builder_component_document',public_document.id::text,
    jsonb_build_object('book_slug',requested_book_slug,'component_slug',requested_component_slug,'activity_id',requested_activity_id,'public_revision',next_public_revision,'teacher_revision',next_teacher_revision));
  return query select 'saved'::text,next_public_revision,next_teacher_revision,next_public_revision,next_teacher_revision;
end;
$$;

-- Effective 042_builder_native_activity_retirement.sql definition; early B1 source serialization.
create or replace function delete_builder_native_activity(
  requested_book_slug text,
  requested_component_slug text,
  requested_activity_id text,
  expected_index_revision bigint,
  requested_index_payload jsonb,
  requested_index_sha256 text,
  requested_index_schema_version text,
  expected_hotspot_revision bigint,
  requested_hotspot_payload jsonb,
  requested_hotspot_sha256 text,
  requested_hotspot_schema_version text,
  requested_hotspot_changed boolean,
  requested_removed_hotspot_count int,
  requested_request_sha256 text,
  actor_builder_user_id uuid,
  requested_client_mutation_id uuid
)
returns table(
  outcome text,
  activity_id text,
  index_revision bigint,
  hotspot_revision bigint,
  removed_hotspot_count int
)
language plpgsql as $$
declare
  resolved_package_id uuid;
  resolved_component_id uuid;
  index_document builder_component_documents%rowtype;
  hotspot_document builder_component_documents%rowtype;
  replay builder_native_activity_deletion_mutations%rowtype;
  next_index_revision bigint;
  next_hotspot_revision bigint;
  derived_index_payload jsonb;
begin
  perform lock_builder_b1_component_source((select component.id from book_components component join book_packages package on package.id=component.book_package_id where package.slug=requested_book_slug and component.slug=requested_component_slug));
  if not exists(select 1 from builder_users where id=actor_builder_user_id and status='active' and role='developer') then
    return query select 'unauthorized_actor'::text,null::text,null::bigint,null::bigint,null::int;
    return;
  end if;

  select package.id,component.id into resolved_package_id,resolved_component_id
  from book_packages package
  join book_components component on component.book_package_id=package.id
  where package.slug=requested_book_slug and component.slug=requested_component_slug
  limit 1;
  if resolved_component_id is null then
    return query select 'resource_not_found'::text,null::text,null::bigint,null::bigint,null::int;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('builder-native-activity-component:' || resolved_component_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('builder-publication-component:' || resolved_component_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('builder-native-activity:' || resolved_component_id::text || ':' || requested_activity_id,0));
  perform pg_advisory_xact_lock(hashtextextended('builder-native-assets:' || resolved_component_id::text || ':' || requested_activity_id,0));
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':','builder-document',requested_book_slug,requested_component_slug,'hotspots','default'),0
  ));

  select * into replay from builder_native_activity_deletion_mutations
  where book_component_id=resolved_component_id and client_mutation_id=requested_client_mutation_id;
  if replay.id is not null then
    if replay.request_sha256<>requested_request_sha256 then
      return query select 'mutation_id_conflict'::text,replay.activity_id,replay.resulting_index_revision,replay.resulting_hotspot_revision,replay.removed_hotspot_count;
    else
      return query select 'idempotent'::text,replay.activity_id,replay.resulting_index_revision,replay.resulting_hotspot_revision,replay.removed_hotspot_count;
    end if;
    return;
  end if;

  select * into index_document from builder_component_documents
  where book_component_id=resolved_component_id and document_type='native_activity_index' and document_key='default'
  for update;
  if index_document.id is null or not builder_native_activity_is_active(resolved_component_id,requested_activity_id) then
    return query select 'activity_not_active'::text,requested_activity_id,coalesce(index_document.revision,0),null::bigint,0::int;
    return;
  end if;

  select * into hotspot_document from builder_component_documents
  where book_component_id=resolved_component_id and document_type='hotspots' and document_key='default'
  for update;
  if index_document.revision<>expected_index_revision
    or coalesce(hotspot_document.revision,0)<>expected_hotspot_revision
  then
    return query select 'revision_conflict'::text,requested_activity_id,index_document.revision,coalesce(hotspot_document.revision,0),0::int;
    return;
  end if;

  select jsonb_set(index_document.payload,'{activities}',coalesce(jsonb_agg(entry.value order by entry.ordinality),'[]'::jsonb))
  into derived_index_payload
  from jsonb_array_elements(coalesce(index_document.payload->'activities','[]'::jsonb)) with ordinality entry(value,ordinality)
  where entry.value->>'activityId'<>requested_activity_id;
  if derived_index_payload<>requested_index_payload then
    raise exception 'native activity deletion index candidate is invalid';
  end if;

  next_index_revision := index_document.revision + 1;
  update builder_component_documents
  set schema_version=requested_index_schema_version,revision=next_index_revision,payload=requested_index_payload,
      payload_sha256=requested_index_sha256,updated_by_builder_user_id=actor_builder_user_id,updated_at=now()
  where id=index_document.id;
  insert into builder_component_document_revisions(document_id,revision,payload,payload_sha256,changed_by_builder_user_id,client_mutation_id)
  values(index_document.id,next_index_revision,requested_index_payload,requested_index_sha256,actor_builder_user_id,requested_client_mutation_id);

  next_hotspot_revision := coalesce(hotspot_document.revision,0);
  if requested_hotspot_changed then
    next_hotspot_revision := next_hotspot_revision + 1;
    if hotspot_document.id is null then
      insert into builder_component_documents(
        book_package_id,book_component_id,document_type,document_key,schema_version,revision,payload,payload_sha256,
        created_by_builder_user_id,updated_by_builder_user_id
      ) values(
        resolved_package_id,resolved_component_id,'hotspots','default',requested_hotspot_schema_version,next_hotspot_revision,
        requested_hotspot_payload,requested_hotspot_sha256,actor_builder_user_id,actor_builder_user_id
      ) returning * into hotspot_document;
    else
      update builder_component_documents
      set schema_version=requested_hotspot_schema_version,revision=next_hotspot_revision,payload=requested_hotspot_payload,
          payload_sha256=requested_hotspot_sha256,updated_by_builder_user_id=actor_builder_user_id,updated_at=now()
      where id=hotspot_document.id;
    end if;
    insert into builder_component_document_revisions(document_id,revision,payload,payload_sha256,changed_by_builder_user_id,client_mutation_id)
    values(hotspot_document.id,next_hotspot_revision,requested_hotspot_payload,requested_hotspot_sha256,actor_builder_user_id,requested_client_mutation_id);
  end if;

  insert into builder_native_activity_deletion_mutations(
    book_component_id,client_mutation_id,request_sha256,activity_id,resulting_index_revision,
    resulting_hotspot_revision,removed_hotspot_count,created_by_builder_user_id
  ) values(
    resolved_component_id,requested_client_mutation_id,requested_request_sha256,requested_activity_id,next_index_revision,
    next_hotspot_revision,requested_removed_hotspot_count,actor_builder_user_id
  );
  insert into builder_audit_log(builder_user_id,action,target_type,target_id,metadata)
  values(actor_builder_user_id,'native_activity_deleted','builder_component_document',index_document.id::text,
    jsonb_build_object('book_slug',requested_book_slug,'component_slug',requested_component_slug,
      'activity_id',requested_activity_id,'index_revision',next_index_revision,
      'hotspot_revision',next_hotspot_revision,'removed_hotspot_count',requested_removed_hotspot_count));

  return query select 'deleted'::text,requested_activity_id,next_index_revision,next_hotspot_revision,requested_removed_hotspot_count;
end;
$$;

-- Effective 043_builder_activity_lifecycle.sql definition; early B1 source serialization.
create or replace function mutate_builder_activity_lifecycle(
  requested_book_slug text,
  requested_component_slug text,
  requested_activity_id text,
  requested_activity_family text,
  requested_operation text,
  expected_source_page_id text,
  authoritative_source_page_id text,
  requested_destination_page_id text,
  expected_lifecycle_revision bigint,
  requested_lifecycle_payload jsonb,
  requested_lifecycle_sha256 text,
  requested_lifecycle_schema_version text,
  expected_index_revision bigint,
  requested_index_payload jsonb,
  requested_index_sha256 text,
  requested_index_schema_version text,
  expected_public_revision bigint,
  requested_public_payload jsonb,
  requested_public_sha256 text,
  requested_public_schema_version text,
  expected_hotspot_revision bigint,
  requested_hotspot_payload jsonb,
  requested_hotspot_sha256 text,
  requested_hotspot_schema_version text,
  requested_hotspot_changed boolean,
  requested_removed_hotspot_count int,
  requested_request_sha256 text,
  actor_builder_user_id uuid,
  requested_client_mutation_id uuid
)
returns table(
  outcome text,
  activity_id text,
  lifecycle_revision bigint,
  index_revision bigint,
  public_revision bigint,
  hotspot_revision bigint,
  removed_hotspot_count int
)
language plpgsql as $$
declare
  resolved_package_id uuid;
  resolved_component_id uuid;
  lifecycle_document builder_component_documents%rowtype;
  index_document builder_component_documents%rowtype;
  public_document builder_component_documents%rowtype;
  hotspot_document builder_component_documents%rowtype;
  replay builder_activity_lifecycle_mutations%rowtype;
  lifecycle_base jsonb;
  current_entry jsonb;
  derived_lifecycle_payload jsonb;
  derived_index_payload jsonb;
  derived_public_payload jsonb;
  next_lifecycle_revision bigint;
  next_index_revision bigint;
  next_public_revision bigint;
  next_hotspot_revision bigint;
begin
  perform lock_builder_b1_component_source((select component.id from book_components component join book_packages package on package.id=component.book_package_id where package.slug=requested_book_slug and component.slug=requested_component_slug));
  if requested_activity_family not in ('canonical','native')
    or requested_operation not in ('retire','move')
    or (requested_activity_family='native' and requested_operation='retire')
    or expected_source_page_id is null
    or authoritative_source_page_id is null
    or (requested_operation='move' and (requested_destination_page_id is null or requested_destination_page_id=expected_source_page_id))
  then
    return query select 'invalid_request'::text,requested_activity_id,0::bigint,0::bigint,0::bigint,0::bigint,0::int;
    return;
  end if;
  if not exists(select 1 from builder_users where id=actor_builder_user_id and status='active' and role='developer') then
    return query select 'unauthorized_actor'::text,null::text,0::bigint,0::bigint,0::bigint,0::bigint,0::int;
    return;
  end if;

  select package.id,component.id into resolved_package_id,resolved_component_id
  from book_packages package join book_components component on component.book_package_id=package.id
  where package.slug=requested_book_slug and component.slug=requested_component_slug limit 1;
  if resolved_component_id is null then
    return query select 'resource_not_found'::text,null::text,0::bigint,0::bigint,0::bigint,0::bigint,0::int;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('builder-native-activity-component:' || resolved_component_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('builder-publication-component:' || resolved_component_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('builder-activity-lifecycle:' || resolved_component_id::text || ':' || requested_activity_id,0));
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','builder-document',requested_book_slug,requested_component_slug,'hotspots','default'),0));

  select * into replay from builder_activity_lifecycle_mutations
  where book_component_id=resolved_component_id and client_mutation_id=requested_client_mutation_id;
  if replay.id is not null then
    if replay.request_sha256<>requested_request_sha256 then
      return query select 'mutation_id_conflict'::text,replay.activity_id,replay.resulting_lifecycle_revision,
        replay.resulting_index_revision,replay.resulting_public_revision,replay.resulting_hotspot_revision,replay.removed_hotspot_count;
    else
      return query select 'idempotent'::text,replay.activity_id,replay.resulting_lifecycle_revision,
        replay.resulting_index_revision,replay.resulting_public_revision,replay.resulting_hotspot_revision,replay.removed_hotspot_count;
    end if;
    return;
  end if;

  select * into lifecycle_document from builder_component_documents
  where book_component_id=resolved_component_id and document_type='activity_lifecycle' and document_key='default' for update;
  select * into hotspot_document from builder_component_documents
  where book_component_id=resolved_component_id and document_type='hotspots' and document_key='default' for update;

  next_lifecycle_revision:=coalesce(lifecycle_document.revision,0);
  next_index_revision:=0;
  next_public_revision:=0;
  next_hotspot_revision:=coalesce(hotspot_document.revision,0);

  if coalesce(lifecycle_document.revision,0)<>expected_lifecycle_revision
    or coalesce(hotspot_document.revision,0)<>expected_hotspot_revision then
    return query select 'revision_conflict'::text,requested_activity_id,next_lifecycle_revision,0::bigint,0::bigint,next_hotspot_revision,0::int;
    return;
  end if;

  if requested_activity_family='canonical' then
    lifecycle_base:=coalesce(lifecycle_document.payload,'{"schemaVersion":"1.0","activities":{}}'::jsonb);
    current_entry:=lifecycle_base->'activities'->requested_activity_id;
    if current_entry->>'status'='retired' then
      return query select 'activity_not_active'::text,requested_activity_id,next_lifecycle_revision,0::bigint,0::bigint,next_hotspot_revision,0::int;
      return;
    end if;
    if (current_entry is null and authoritative_source_page_id<>expected_source_page_id)
      or (current_entry is not null and current_entry->>'pageId'<>expected_source_page_id) then
      return query select 'location_conflict'::text,requested_activity_id,next_lifecycle_revision,0::bigint,0::bigint,next_hotspot_revision,0::int;
      return;
    end if;
    derived_lifecycle_payload:=jsonb_set(
      lifecycle_base,
      array['activities',requested_activity_id],
      jsonb_build_object(
        'status',case when requested_operation='retire' then 'retired' else 'active' end,
        'pageId',case when requested_operation='retire' then expected_source_page_id else requested_destination_page_id end
      ),true
    );
    if derived_lifecycle_payload<>requested_lifecycle_payload then raise exception 'activity lifecycle candidate is invalid'; end if;
    next_lifecycle_revision:=next_lifecycle_revision+1;
    if lifecycle_document.id is null then
      insert into builder_component_documents(
        book_package_id,book_component_id,document_type,document_key,schema_version,revision,payload,payload_sha256,
        created_by_builder_user_id,updated_by_builder_user_id
      ) values(
        resolved_package_id,resolved_component_id,'activity_lifecycle','default',requested_lifecycle_schema_version,
        next_lifecycle_revision,requested_lifecycle_payload,requested_lifecycle_sha256,actor_builder_user_id,actor_builder_user_id
      ) returning * into lifecycle_document;
    else
      update builder_component_documents set schema_version=requested_lifecycle_schema_version,revision=next_lifecycle_revision,
        payload=requested_lifecycle_payload,payload_sha256=requested_lifecycle_sha256,
        updated_by_builder_user_id=actor_builder_user_id,updated_at=now() where id=lifecycle_document.id;
    end if;
    insert into builder_component_document_revisions(document_id,revision,payload,payload_sha256,changed_by_builder_user_id,client_mutation_id)
    values(lifecycle_document.id,next_lifecycle_revision,requested_lifecycle_payload,requested_lifecycle_sha256,actor_builder_user_id,requested_client_mutation_id);
  else
    select * into index_document from builder_component_documents
    where book_component_id=resolved_component_id and document_type='native_activity_index' and document_key='default' for update;
    select * into public_document from builder_component_documents
    where book_component_id=resolved_component_id and document_type='native_activity_public' and document_key=requested_activity_id for update;
    next_index_revision:=coalesce(index_document.revision,0);
    next_public_revision:=coalesce(public_document.revision,0);
    if index_document.id is null or public_document.id is null or not builder_native_activity_is_active(resolved_component_id,requested_activity_id) then
      return query select 'activity_not_active'::text,requested_activity_id,next_lifecycle_revision,next_index_revision,next_public_revision,next_hotspot_revision,0::int;
      return;
    end if;
    if index_document.revision<>expected_index_revision or public_document.revision<>expected_public_revision then
      return query select 'revision_conflict'::text,requested_activity_id,next_lifecycle_revision,next_index_revision,next_public_revision,next_hotspot_revision,0::int;
      return;
    end if;
    if public_document.payload->'placement'->>'pageId'<>expected_source_page_id or not exists(
      select 1 from jsonb_array_elements(index_document.payload->'activities') entry
      where entry->>'activityId'=requested_activity_id and entry->'placement'->>'pageId'=expected_source_page_id
    ) then
      return query select 'location_conflict'::text,requested_activity_id,next_lifecycle_revision,next_index_revision,next_public_revision,next_hotspot_revision,0::int;
      return;
    end if;
    select jsonb_set(index_document.payload,'{activities}',jsonb_agg(
      case when entry.value->>'activityId'=requested_activity_id
        then jsonb_set(entry.value,'{placement,pageId}',to_jsonb(requested_destination_page_id),true)
        else entry.value end order by entry.ordinality
    )) into derived_index_payload
    from jsonb_array_elements(index_document.payload->'activities') with ordinality entry(value,ordinality);
    derived_public_payload:=jsonb_set(public_document.payload,'{placement,pageId}',to_jsonb(requested_destination_page_id),true);
    if derived_index_payload<>requested_index_payload or derived_public_payload<>requested_public_payload then
      raise exception 'native activity relocation candidate is invalid';
    end if;
    next_index_revision:=index_document.revision+1;
    next_public_revision:=public_document.revision+1;
    update builder_component_documents set schema_version=requested_index_schema_version,revision=next_index_revision,
      payload=requested_index_payload,payload_sha256=requested_index_sha256,updated_by_builder_user_id=actor_builder_user_id,updated_at=now()
    where id=index_document.id;
    update builder_component_documents set schema_version=requested_public_schema_version,revision=next_public_revision,
      payload=requested_public_payload,payload_sha256=requested_public_sha256,updated_by_builder_user_id=actor_builder_user_id,updated_at=now()
    where id=public_document.id;
    insert into builder_component_document_revisions(document_id,revision,payload,payload_sha256,changed_by_builder_user_id,client_mutation_id)
    values(index_document.id,next_index_revision,requested_index_payload,requested_index_sha256,actor_builder_user_id,requested_client_mutation_id);
    insert into builder_component_document_revisions(document_id,revision,payload,payload_sha256,changed_by_builder_user_id,client_mutation_id)
    values(public_document.id,next_public_revision,requested_public_payload,requested_public_sha256,actor_builder_user_id,requested_client_mutation_id);
  end if;

  if requested_hotspot_changed then
    next_hotspot_revision:=next_hotspot_revision+1;
    if hotspot_document.id is null then
      insert into builder_component_documents(
        book_package_id,book_component_id,document_type,document_key,schema_version,revision,payload,payload_sha256,
        created_by_builder_user_id,updated_by_builder_user_id
      ) values(
        resolved_package_id,resolved_component_id,'hotspots','default',requested_hotspot_schema_version,next_hotspot_revision,
        requested_hotspot_payload,requested_hotspot_sha256,actor_builder_user_id,actor_builder_user_id
      ) returning * into hotspot_document;
    else
      update builder_component_documents set schema_version=requested_hotspot_schema_version,revision=next_hotspot_revision,
        payload=requested_hotspot_payload,payload_sha256=requested_hotspot_sha256,
        updated_by_builder_user_id=actor_builder_user_id,updated_at=now() where id=hotspot_document.id;
    end if;
    insert into builder_component_document_revisions(document_id,revision,payload,payload_sha256,changed_by_builder_user_id,client_mutation_id)
    values(hotspot_document.id,next_hotspot_revision,requested_hotspot_payload,requested_hotspot_sha256,actor_builder_user_id,requested_client_mutation_id);
  end if;

  insert into builder_activity_lifecycle_mutations(
    book_component_id,client_mutation_id,request_sha256,activity_id,activity_family,operation,source_page_id,destination_page_id,
    resulting_lifecycle_revision,resulting_index_revision,resulting_public_revision,resulting_hotspot_revision,removed_hotspot_count,
    created_by_builder_user_id
  ) values(
    resolved_component_id,requested_client_mutation_id,requested_request_sha256,requested_activity_id,requested_activity_family,
    requested_operation,expected_source_page_id,requested_destination_page_id,next_lifecycle_revision,next_index_revision,
    next_public_revision,next_hotspot_revision,requested_removed_hotspot_count,actor_builder_user_id
  );
  insert into builder_audit_log(builder_user_id,action,target_type,target_id,metadata)
  values(actor_builder_user_id,'activity_' || case when requested_operation='retire' then 'retired' else 'moved' end,
    'book_component',resolved_component_id::text,jsonb_build_object(
      'book_slug',requested_book_slug,'component_slug',requested_component_slug,'activity_id',requested_activity_id,
      'activity_family',requested_activity_family,'source_page_id',expected_source_page_id,
      'destination_page_id',requested_destination_page_id,'lifecycle_revision',next_lifecycle_revision,
      'index_revision',next_index_revision,'public_revision',next_public_revision,
      'hotspot_revision',next_hotspot_revision,'removed_hotspot_count',requested_removed_hotspot_count
    ));

  return query select case when requested_operation='retire' then 'retired' else 'moved' end,
    requested_activity_id,next_lifecycle_revision,next_index_revision,next_public_revision,next_hotspot_revision,requested_removed_hotspot_count;
end;
$$;

-- Effective 057_builder_activity_order.sql definition; early B1 source serialization.
create or replace function save_builder_activity_order(
  requested_book_slug text, requested_component_slug text,
  expected_index_revision bigint, expected_lifecycle_revision bigint,
  requested_index jsonb, requested_lifecycle jsonb,
  index_sha256 text, lifecycle_sha256 text,
  actor_builder_user_id uuid, requested_client_mutation_id uuid
) returns table(outcome text, index_revision bigint, lifecycle_revision bigint)
language plpgsql as $$
declare
  component_id uuid;
  saved_index record;
  saved_lifecycle record;
begin
  perform lock_builder_b1_component_source((select component.id from book_components component join book_packages package on package.id=component.book_package_id where package.slug=requested_book_slug and component.slug=requested_component_slug));
  if not exists(select 1 from builder_users where id=actor_builder_user_id and status='active' and role='developer') then
    return query select 'unauthorized_actor'::text,0::bigint,0::bigint; return;
  end if;
  select component.id into component_id from book_components component
    join book_packages package on package.id=component.book_package_id
    where package.slug=requested_book_slug and component.slug=requested_component_slug;
  if component_id is null then
    return query select 'resource_not_found'::text,0::bigint,0::bigint; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('builder-native-activity-component:' || component_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('builder-publication-component:' || component_id::text,0));
  -- Generic saves preserve the canonical immutable revision and mutation history.
  -- A failure of either save aborts the subtransaction, including the first save.
  begin
    select * into saved_index from save_builder_component_document(
      requested_book_slug,requested_component_slug,'native_activity_index','default','1.0',
      expected_index_revision,requested_index,index_sha256,actor_builder_user_id,requested_client_mutation_id);
    if saved_index.outcome not in ('saved','idempotent') then raise exception 'activity_order_conflict' using errcode='40001'; end if;
    select * into saved_lifecycle from save_builder_component_document(
      requested_book_slug,requested_component_slug,'activity_lifecycle','default','1.0',
      expected_lifecycle_revision,requested_lifecycle,lifecycle_sha256,actor_builder_user_id,requested_client_mutation_id);
    if saved_lifecycle.outcome not in ('saved','idempotent') then raise exception 'activity_order_conflict' using errcode='40001'; end if;
    return query select 'saved'::text,saved_index.saved_revision,saved_lifecycle.saved_revision;
  exception when serialization_failure then
    return query select 'revision_conflict'::text,expected_index_revision,expected_lifecycle_revision;
  end;
end;
$$;

-- Effective 037_builder_native_open_response_authoring.sql definition; early B1 source serialization.
create or replace function prepare_builder_native_asset_upload(
  requested_book_slug text, requested_component_slug text, requested_activity_id text, requested_asset_slot text,
  requested_client_mutation_id uuid, requested_upload_id uuid, requested_request_sha256 text,
  requested_file_descriptor jsonb, requested_staging_object_key text, actor_builder_user_id uuid, requested_expires_at timestamptz
)
returns table(outcome text, upload_id uuid, session_state text, file_descriptor jsonb, staging_object_key text)
language plpgsql as $$
declare resolved_package_id uuid; resolved_component_id uuid; existing builder_native_asset_upload_sessions%rowtype;
begin
  perform lock_builder_b1_component_source((select component.id from book_components component join book_packages package on package.id=component.book_package_id where package.slug=requested_book_slug and component.slug=requested_component_slug));
  if not exists(select 1 from builder_users where id=actor_builder_user_id and status='active' and role='developer') then return query select 'unauthorized_actor'::text,null::uuid,null::text,null::jsonb,null::text; return; end if;
  select package.id,component.id into resolved_package_id,resolved_component_id from book_packages package join book_components component on component.book_package_id=package.id where package.slug=requested_book_slug and component.slug=requested_component_slug limit 1;
  if resolved_component_id is null or not exists(select 1 from builder_component_documents where book_component_id=resolved_component_id and document_type='native_activity_public' and document_key=requested_activity_id) then return query select 'resource_not_found'::text,null::uuid,null::text,null::jsonb,null::text; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('builder-native-assets:' || resolved_component_id::text || ':' || requested_activity_id,0));
  select * into existing from builder_native_asset_upload_sessions where book_component_id=resolved_component_id and client_mutation_id=requested_client_mutation_id;
  if existing.id is not null then
    if existing.request_sha256<>requested_request_sha256 then return query select 'mutation_id_conflict'::text,existing.id,existing.state,null::jsonb,null::text;
    else return query select 'idempotent'::text,existing.id,existing.state,existing.file_descriptor,existing.staging_object_key; end if; return;
  end if;
  insert into builder_native_asset_upload_sessions(id,book_package_id,book_component_id,activity_id,asset_slot,client_mutation_id,request_sha256,file_descriptor,staging_object_key,created_by_builder_user_id,expires_at)
  values(requested_upload_id,resolved_package_id,resolved_component_id,requested_activity_id,requested_asset_slot,requested_client_mutation_id,requested_request_sha256,requested_file_descriptor,requested_staging_object_key,actor_builder_user_id,requested_expires_at);
  return query select 'prepared'::text,requested_upload_id,'prepared'::text,requested_file_descriptor,requested_staging_object_key;
end;
$$;

-- Effective 037_builder_native_open_response_authoring.sql definition; early B1 source serialization.
create or replace function claim_builder_native_asset_upload(requested_upload_id uuid, requested_client_mutation_id uuid, actor_builder_user_id uuid)
returns table(outcome text, book_package_id uuid, book_component_id uuid, activity_id text, asset_slot text, file_descriptor jsonb, staging_object_key text, resulting_asset_id uuid)
language plpgsql as $$
declare session builder_native_asset_upload_sessions%rowtype;
begin
  perform lock_builder_b1_component_source((select source_session.book_component_id from builder_native_asset_upload_sessions source_session where source_session.id=requested_upload_id));
  select * into session from builder_native_asset_upload_sessions where id=requested_upload_id for update;
  if session.id is null or session.created_by_builder_user_id<>actor_builder_user_id then return query select 'session_not_found'::text,null::uuid,null::uuid,null::text,null::text,null::jsonb,null::text,null::uuid; return; end if;
  if session.client_mutation_id<>requested_client_mutation_id then return query select 'session_identity_conflict'::text,null::uuid,null::uuid,null::text,null::text,null::jsonb,null::text,null::uuid; return; end if;
  if session.state='completed' then return query select 'idempotent'::text,session.book_package_id,session.book_component_id,session.activity_id,session.asset_slot,session.file_descriptor,session.staging_object_key,session.resulting_asset_id; return; end if;
  if session.state<>'prepared' then return query select 'invalid_session_state'::text,null::uuid,null::uuid,null::text,null::text,null::jsonb,null::text,null::uuid; return; end if;
  if session.expires_at<=now() then update builder_native_asset_upload_sessions set state='failed',failure_code='expired_session',updated_at=now() where id=session.id; return query select 'expired_session'::text,null::uuid,null::uuid,null::text,null::text,null::jsonb,null::text,null::uuid; return; end if;
  update builder_native_asset_upload_sessions set state='finalizing',updated_at=now() where id=session.id;
  return query select 'claimed'::text,session.book_package_id,session.book_component_id,session.activity_id,session.asset_slot,session.file_descriptor,session.staging_object_key,null::uuid;
end;
$$;

-- Effective 058_native_teacher_answer_assets.sql definition; early B1 source serialization.
create or replace function complete_builder_native_asset_upload(
  requested_upload_id uuid, actor_builder_user_id uuid, requested_object_key text, requested_storage_bucket text,
  requested_mime_type text, requested_byte_size bigint, requested_checksum text, requested_width int, requested_height int
)
returns uuid language plpgsql as $$
declare
  session builder_native_asset_upload_sessions%rowtype;
  edition book_editions%rowtype;
  resolved_asset_id uuid;
  resolved_asset_slot text;
  reused_existing_asset boolean := false;
  resolved_role text;
  expected_answer_key text;
begin
  perform lock_builder_b1_component_source((select source_session.book_component_id from builder_native_asset_upload_sessions source_session where source_session.id=requested_upload_id));
  select * into session
  from builder_native_asset_upload_sessions
  where id=requested_upload_id
  for update;

  if session.id is null
    or session.created_by_builder_user_id<>actor_builder_user_id
    or session.state<>'finalizing'
  then
    raise exception 'native upload session cannot be completed';
  end if;

  resolved_role := case when session.file_descriptor->>'purpose'='teacher-answer' then 'native_teacher_answer' else 'activity_artwork' end;
  if resolved_role='native_teacher_answer' then
    select 'builder-native-assets/'||package.slug||'/'||component.slug||'/'||session.activity_id||'/assets/teacher-answers/'||requested_checksum||
      case requested_mime_type when 'image/png' then '.png' when 'image/jpeg' then '.jpg' when 'image/webp' then '.webp' else '' end
      into expected_answer_key from book_packages package join book_components component on component.book_package_id=package.id
      where package.id=session.book_package_id and component.id=session.book_component_id;
    if requested_mime_type not in ('image/png','image/jpeg','image/webp') or requested_width is null or requested_height is null
      or requested_width not between 1 and 8192 or requested_height not between 1 and 8192
      or requested_object_key is distinct from expected_answer_key then raise exception 'invalid protected native answer asset'; end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('builder-native-assets:' || session.book_component_id::text || ':' || session.activity_id,0)
  );

  insert into book_editions(book_package_id,edition_identifier,title,status,source_metadata)
  values(session.book_package_id,'builder-draft','Builder native draft assets','draft','{"source":"native-activity-builder"}'::jsonb)
  on conflict(book_package_id,edition_identifier) do update set updated_at=now()
  returning * into edition;

  select asset.id, asset.source_metadata->>'asset_slot'
  into resolved_asset_id, resolved_asset_slot
  from book_assets asset
  where asset.book_package_id=session.book_package_id
    and asset.book_component_id=session.book_component_id
    and asset.storage_bucket=requested_storage_bucket
    and asset.object_key=requested_object_key
    and asset.checksum_sha256=requested_checksum
    and asset.mime_type=requested_mime_type
    and asset.byte_size=requested_byte_size
    and asset.width=requested_width
    and asset.height=requested_height
    and asset.asset_role=resolved_role
    and asset.publication_status='draft'
    and asset.storage_profile='private'
    and asset.access_level='internal'
    and asset.source_metadata->>'native_activity_id'=session.activity_id
    and asset.source_metadata->>'asset_slot' ~ '^[a-z0-9][a-z0-9-]{0,127}$'
  limit 1;

  if resolved_asset_id is not null then
    reused_existing_asset := true;
  else
    -- An occupied physical identity that is not an exact, in-scope reusable
    -- native asset is a security/integrity conflict, never an implicit reuse.
    if exists (
      select 1 from book_assets asset
      where asset.storage_bucket=requested_storage_bucket
        and asset.object_key=requested_object_key
    ) then
      raise exception 'native asset object identity conflicts with an existing managed asset';
    end if;

    insert into book_assets(
      book_package_id,edition_id,book_component_id,stable_logical_key,asset_role,object_key,
      storage_profile,storage_bucket,mime_type,byte_size,checksum_sha256,width,height,
      edition_identifier,version,publication_status,access_level,source_metadata
    )
    values(
      session.book_package_id,edition.id,session.book_component_id,
      (select slug from book_packages where id=session.book_package_id)||'.builder-native.'||session.activity_id||'.'||session.asset_slot||'.'||left(requested_checksum,12),
      resolved_role,requested_object_key,'private',requested_storage_bucket,requested_mime_type,
      requested_byte_size,requested_checksum,requested_width,requested_height,
      'builder-draft','native-draft','draft','internal',
      jsonb_build_object('native_activity_id',session.activity_id,'asset_slot',session.asset_slot,'upload_session_id',session.id)
    )
    returning id into resolved_asset_id;
    resolved_asset_slot := session.asset_slot;
  end if;

  update builder_native_asset_upload_sessions
  set state='completed',resulting_asset_id=resolved_asset_id,updated_at=now()
  where id=session.id;

  insert into builder_audit_log(builder_user_id,action,target_type,target_id,metadata)
  values(
    actor_builder_user_id,'native_activity_asset_finalized','book_asset',resolved_asset_id::text,
    jsonb_build_object(
      'native_activity_id',session.activity_id,
      'requested_asset_slot',session.asset_slot,
      'resolved_asset_slot',resolved_asset_slot,
      'asset_role',resolved_role,
      'reused_existing_asset',reused_existing_asset
    )
  );

  return resolved_asset_id;
end;
$$;

-- Effective 054_builder_component_font_library.sql definition; early B1 source serialization.
create or replace function prepare_builder_font_upload(
  requested_book_slug text,requested_component_slug text,requested_client_mutation_id uuid,requested_upload_id uuid,
  requested_request_sha256 text,requested_file_descriptor jsonb,requested_staging_object_key text,
  actor_builder_user_id uuid,requested_expires_at timestamptz
)
returns table(outcome text,upload_id uuid,session_state text,file_descriptor jsonb,staging_object_key text)
language plpgsql as $$
declare resolved_package_id uuid; resolved_component_id uuid; existing builder_font_upload_sessions%rowtype;
begin
  perform lock_builder_b1_component_source((select component.id from book_components component join book_packages package on package.id=component.book_package_id where package.slug=requested_book_slug and component.slug=requested_component_slug));
  if not exists(select 1 from builder_users where id=actor_builder_user_id and status='active' and role='developer') then return query select 'unauthorized_actor',null::uuid,null::text,null::jsonb,null::text; return; end if;
  select package.id,component.id into resolved_package_id,resolved_component_id
  from book_packages package join book_components component on component.book_package_id=package.id
  where package.slug=requested_book_slug and component.slug=requested_component_slug limit 1;
  if resolved_component_id is null then return query select 'resource_not_found',null::uuid,null::text,null::jsonb,null::text; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('builder-font-library:'||resolved_component_id::text,0));
  select * into existing from builder_font_upload_sessions where book_component_id=resolved_component_id and client_mutation_id=requested_client_mutation_id;
  if existing.id is not null then
    if existing.request_sha256<>requested_request_sha256 then return query select 'mutation_id_conflict',existing.id,existing.state,null::jsonb,null::text;
    else return query select 'idempotent',existing.id,existing.state,existing.file_descriptor,existing.staging_object_key; end if; return;
  end if;
  insert into builder_font_upload_sessions(id,book_package_id,book_component_id,client_mutation_id,request_sha256,file_descriptor,staging_object_key,created_by_builder_user_id,expires_at)
  values(requested_upload_id,resolved_package_id,resolved_component_id,requested_client_mutation_id,requested_request_sha256,requested_file_descriptor,requested_staging_object_key,actor_builder_user_id,requested_expires_at);
  return query select 'prepared',requested_upload_id,'prepared',requested_file_descriptor,requested_staging_object_key;
end $$;

-- Effective 054_builder_component_font_library.sql definition; early B1 source serialization.
create or replace function claim_builder_font_upload(requested_upload_id uuid,requested_client_mutation_id uuid,actor_builder_user_id uuid)
returns table(outcome text,book_package_id uuid,book_component_id uuid,file_descriptor jsonb,staging_object_key text,resulting_asset_id uuid)
language plpgsql as $$
declare session builder_font_upload_sessions%rowtype;
begin
  perform lock_builder_b1_component_source((select source_session.book_component_id from builder_font_upload_sessions source_session where source_session.id=requested_upload_id));
  select * into session from builder_font_upload_sessions where id=requested_upload_id for update;
  if session.id is null or session.created_by_builder_user_id<>actor_builder_user_id then return query select 'session_not_found',null::uuid,null::uuid,null::jsonb,null::text,null::uuid; return; end if;
  if session.client_mutation_id<>requested_client_mutation_id then return query select 'session_identity_conflict',null::uuid,null::uuid,null::jsonb,null::text,null::uuid; return; end if;
  if session.state='completed' then return query select 'idempotent',session.book_package_id,session.book_component_id,session.file_descriptor,session.staging_object_key,session.resulting_asset_id; return; end if;
  if session.state<>'prepared' then return query select 'invalid_session_state',null::uuid,null::uuid,null::jsonb,null::text,null::uuid; return; end if;
  if session.expires_at<=now() then update builder_font_upload_sessions set state='failed',failure_code='expired_session',updated_at=now() where id=session.id; return query select 'expired_session',null::uuid,null::uuid,null::jsonb,null::text,null::uuid; return; end if;
  update builder_font_upload_sessions set state='finalizing',updated_at=now() where id=session.id;
  return query select 'claimed',session.book_package_id,session.book_component_id,session.file_descriptor,session.staging_object_key,null::uuid;
end $$;

-- Effective 054_builder_component_font_library.sql definition; early B1 source serialization.
create or replace function complete_builder_font_upload(
  requested_upload_id uuid,actor_builder_user_id uuid,requested_object_key text,requested_storage_bucket text,
  requested_mime_type text,requested_byte_size bigint,requested_checksum text,requested_display_label text,requested_original_filename text
)
returns uuid language plpgsql as $$
declare session builder_font_upload_sessions%rowtype; edition book_editions%rowtype; resolved_asset_id uuid; reused boolean:=false;
begin
  perform lock_builder_b1_component_source((select source_session.book_component_id from builder_font_upload_sessions source_session where source_session.id=requested_upload_id));
  select * into session from builder_font_upload_sessions where id=requested_upload_id for update;
  if session.id is null or session.created_by_builder_user_id<>actor_builder_user_id or session.state<>'finalizing' then raise exception 'font upload session cannot be completed'; end if;
  if requested_mime_type<>'font/ttf' or requested_byte_size<1 or requested_byte_size>12582912 or requested_checksum!~'^[a-f0-9]{64}$'
    or char_length(requested_display_label) not between 1 and 120 or requested_display_label~'[[:cntrl:]]'
    or requested_original_filename!~'^[A-Za-z0-9][A-Za-z0-9._() -]{0,179}\.ttf$' then raise exception 'font upload metadata is invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('builder-font-library:'||session.book_component_id::text,0));
  insert into book_editions(book_package_id,edition_identifier,title,status,source_metadata)
  values(session.book_package_id,'builder-draft','Builder native draft assets','draft','{"source":"native-activity-builder"}'::jsonb)
  on conflict(book_package_id,edition_identifier) do update set updated_at=now() returning * into edition;
  select asset.id into resolved_asset_id from book_assets asset
  where asset.book_package_id=session.book_package_id and asset.book_component_id=session.book_component_id
    and asset.asset_role='activity_font' and asset.mime_type='font/ttf' and asset.checksum_sha256=requested_checksum
    and asset.byte_size=requested_byte_size and asset.object_key=requested_object_key and asset.storage_bucket=requested_storage_bucket
    and asset.publication_status='draft' and asset.storage_profile='private' and asset.access_level='internal'
    and asset.source_metadata->>'font_library_scope'='component' limit 1;
  if resolved_asset_id is not null then reused:=true;
  else
    if exists(select 1 from book_assets where storage_bucket=requested_storage_bucket and object_key=requested_object_key) then raise exception 'font object identity conflicts with an existing managed asset'; end if;
    insert into book_assets(book_package_id,edition_id,book_component_id,stable_logical_key,asset_role,object_key,storage_profile,storage_bucket,mime_type,byte_size,checksum_sha256,width,height,edition_identifier,version,publication_status,access_level,source_metadata)
    values(session.book_package_id,edition.id,session.book_component_id,(select package.slug||'.builder-font.'||component.slug||'.'||left(requested_checksum,12) from book_packages package join book_components component on component.id=session.book_component_id where package.id=session.book_package_id),
      'activity_font',requested_object_key,'private',requested_storage_bucket,'font/ttf',requested_byte_size,requested_checksum,null,null,'builder-draft','font-library','draft','internal',
      jsonb_build_object('font_library_scope','component','display_label',requested_display_label,'original_filename',requested_original_filename,'upload_session_id',session.id))
    returning id into resolved_asset_id;
  end if;
  update builder_font_upload_sessions set state='completed',resulting_asset_id=resolved_asset_id,updated_at=now() where id=session.id;
  insert into builder_audit_log(builder_user_id,action,target_type,target_id,metadata) values(actor_builder_user_id,'builder_font_finalized','book_asset',resolved_asset_id::text,jsonb_build_object('scope','component','reused_existing_asset',reused));
  return resolved_asset_id;
end $$;

-- Effective 060_students_book_page_expansion.sql definition; early B1 source serialization.
create or replace function prepare_builder_component_page_upload(
  requested_book_slug text,requested_component_slug text,requested_page_key text,requested_mode text,
  requested_expected_revision bigint,requested_client_mutation_id uuid,requested_upload_id uuid,
  requested_request_sha256 text,requested_page_metadata jsonb,requested_file_descriptor jsonb,
  requested_staging_object_key text,actor_builder_user_id uuid,requested_expires_at timestamptz
)
returns table(outcome text,upload_id uuid,current_revision bigint,session_state text,staging_object_key text)
language plpgsql as $$
declare scope record; revision_row builder_component_page_revisions%rowtype; existing builder_component_page_upload_sessions%rowtype; page_row book_pages%rowtype; requested_unit uuid;
begin
  perform lock_builder_b1_component_source((select component.id from book_components component join book_packages package on package.id=component.book_package_id where package.slug=requested_book_slug and component.slug=requested_component_slug));
  if not exists(select 1 from builder_users where id=actor_builder_user_id and status='active' and role='developer') then
    return query select 'unauthorized_actor',null::uuid,null::bigint,null::text,null::text; return;
  end if;
  select * into scope from resolve_builder_page_component(requested_book_slug,requested_component_slug);
  if scope.book_component_id is null or requested_page_key not like requested_component_slug||'/pages/%' then
    return query select 'resource_not_found',null::uuid,null::bigint,null::text,null::text; return;
  end if;
  if requested_component_slug='ultimate-b2-students-book' and (
    requested_page_key is null or requested_mode is null or requested_mode not in ('create','replace')
    or requested_expected_revision is null or requested_expected_revision<0
    or not builder_students_book_page_metadata_valid(requested_page_metadata)
  ) then return query select 'invalid_page_metadata',null::uuid,null::bigint,null::text,null::text; return; end if;
  if requested_page_metadata ? 'unitId' and coalesce(requested_page_metadata->>'unitId','')<>'' then
    begin requested_unit:=(requested_page_metadata->>'unitId')::uuid; exception when invalid_text_representation then
      return query select 'invalid_unit',null::uuid,null::bigint,null::text,null::text; return;
    end;
    if not exists(select 1 from units where id=requested_unit and book_component_id=scope.book_component_id and unit_number between 1 and 10 and slug='unit-'||unit_number) then
      return query select 'invalid_unit',null::uuid,null::bigint,null::text,null::text; return;
    end if;
  end if;
  insert into builder_component_page_revisions(book_component_id) values(scope.book_component_id) on conflict do nothing;
  select * into revision_row from builder_component_page_revisions where book_component_id=scope.book_component_id for update;
  select * into existing from builder_component_page_upload_sessions where book_component_id=scope.book_component_id and client_mutation_id=requested_client_mutation_id;
  if existing.id is not null then
    if existing.request_sha256<>requested_request_sha256 then
      return query select 'mutation_id_conflict',existing.id,revision_row.revision,existing.state,null::text;
    else
      return query select 'idempotent',existing.id,revision_row.revision,existing.state,existing.staging_object_key;
    end if;
    return;
  end if;
  if revision_row.revision<>requested_expected_revision then
    return query select 'revision_conflict',null::uuid,revision_row.revision,null::text,null::text; return;
  end if;
  select * into page_row from book_pages where book_component_id=scope.book_component_id and stable_key=requested_page_key;
  if requested_book_slug='ultimate-b2' and requested_component_slug='ultimate-b2-students-book' then
    if exists(select 1 from builder_students_book_canonical_pages where page_key=requested_page_key) then
      if requested_mode<>'replace' then return query select 'operation_not_allowed',null::uuid,revision_row.revision,null::text,null::text; return; end if;
      if exists(select 1 from builder_students_book_canonical_pages where page_key=requested_page_key and (requested_page_metadata->>'baselineWidth' is distinct from width::text or requested_page_metadata->>'baselineHeight' is distinct from height::text)) then
        return query select 'canonical_dimensions_conflict',null::uuid,revision_row.revision,null::text,null::text; return;
      end if;
      if requested_unit is not null and not exists(select 1 from units unit join builder_students_book_canonical_pages canonical on canonical.unit_number=unit.unit_number where canonical.page_key=requested_page_key and unit.id=requested_unit) then
        return query select 'invalid_unit',null::uuid,revision_row.revision,null::text,null::text; return;
      end if;
    elsif requested_page_key ~ '^ultimate-b2-students-book/pages/sb-page-[a-f0-9]{32}$' then
      if requested_mode='create' then
        if page_row.id is not null then return query select 'page_state_conflict',null::uuid,revision_row.revision,null::text,null::text; return; end if;
        if requested_unit is null then return query select 'invalid_unit',null::uuid,revision_row.revision,null::text,null::text; return; end if;
      elsif requested_mode<>'replace' or page_row.id is null or coalesce(page_row.source_metadata->>'is_active','false')<>'true' then
        return query select 'page_state_conflict',null::uuid,revision_row.revision,null::text,null::text; return;
      end if;
    else return query select 'invalid_students_book_page_identity',null::uuid,revision_row.revision,null::text,null::text; return;
    end if;
    if coalesce(page_row.source_metadata->>'is_deleted','false')='true' or coalesce(page_row.source_metadata->>'is_permanently_deleted','false')='true' then
      return query select 'page_state_conflict',null::uuid,revision_row.revision,null::text,null::text; return;
    end if;
  end if;
  if (requested_book_slug,requested_component_slug) in (
    ('ultimate-b2','ultimate-b2-workbook'),
    ('ultimate-b2','ultimate-b2-grammar-book'),
    ('ultimate-b1','ultimate-b1-students-book'),
    ('ultimate-b1','ultimate-b1-workbook'),
    ('ultimate-b1','ultimate-b1-grammar-book'),
    ('ultimate-b1-plus','ultimate-b1-plus-students-book'),
    ('ultimate-b1-plus','ultimate-b1-plus-workbook'),
    ('ultimate-b1-plus','ultimate-b1-plus-grammar-book')
  ) and (
    (requested_mode='create' and page_row.id is not null and coalesce(page_row.source_metadata->>'is_active','false')='true')
    or (requested_mode='replace' and (page_row.id is null or coalesce(page_row.source_metadata->>'is_active','false')<>'true'))
  ) then return query select 'page_state_conflict',null::uuid,revision_row.revision,null::text,null::text; return; end if;
  insert into builder_component_page_upload_sessions(
    id,book_package_id,book_component_id,page_key,upload_mode,expected_revision,client_mutation_id,request_sha256,
    page_metadata,file_descriptor,staging_object_key,created_by_builder_user_id,expires_at
  ) values(requested_upload_id,scope.book_package_id,scope.book_component_id,requested_page_key,requested_mode,requested_expected_revision,
    requested_client_mutation_id,requested_request_sha256,requested_page_metadata,requested_file_descriptor,requested_staging_object_key,actor_builder_user_id,requested_expires_at);
  return query select 'prepared',requested_upload_id,revision_row.revision,'prepared',requested_staging_object_key;
end $$;

-- Effective 045_builder_component_pages.sql definition; early B1 source serialization.
create or replace function claim_builder_component_page_upload(requested_upload_id uuid,requested_expected_revision bigint,requested_client_mutation_id uuid,actor_builder_user_id uuid)
returns table(outcome text,book_slug text,component_slug text,page_key text,upload_mode text,current_revision bigint,page_metadata jsonb,file_descriptor jsonb,staging_object_key text)
language plpgsql as $$
declare session builder_component_page_upload_sessions%rowtype; revision_row builder_component_page_revisions%rowtype; resolved_book_slug text; resolved_component_slug text;
begin
  perform lock_builder_b1_component_source((select source_session.book_component_id from builder_component_page_upload_sessions source_session where source_session.id=requested_upload_id));
  select * into session from builder_component_page_upload_sessions where id=requested_upload_id for update;
  if session.id is null or session.created_by_builder_user_id<>actor_builder_user_id then
    return query select 'session_not_found',null::text,null::text,null::text,null::text,null::bigint,null::jsonb,null::jsonb,null::text; return;
  end if;
  select package.slug,component.slug into resolved_book_slug,resolved_component_slug from book_packages package join book_components component on component.book_package_id=package.id where component.id=session.book_component_id;
  select * into revision_row from builder_component_page_revisions where book_component_id=session.book_component_id for update;
  if session.client_mutation_id<>requested_client_mutation_id or session.expected_revision<>requested_expected_revision then
    return query select 'session_identity_conflict',null::text,null::text,null::text,null::text,revision_row.revision,null::jsonb,null::jsonb,null::text; return;
  end if;
  if session.state='completed' then
    return query select 'idempotent',resolved_book_slug,resolved_component_slug,session.page_key,session.upload_mode,session.resulting_revision,session.page_metadata,session.file_descriptor,session.staging_object_key; return;
  end if;
  if session.state='finalizing' then return query select 'finalize_in_progress',null::text,null::text,null::text,null::text,revision_row.revision,null::jsonb,null::jsonb,null::text; return; end if;
  if session.state<>'prepared' then return query select 'invalid_session_state',null::text,null::text,null::text,null::text,revision_row.revision,null::jsonb,null::jsonb,null::text; return; end if;
  if session.expires_at<=now() then
    update builder_component_page_upload_sessions set state='failed',failure_code='expired_session',updated_at=now() where id=session.id;
    return query select 'expired_session',null::text,null::text,null::text,null::text,revision_row.revision,null::jsonb,null::jsonb,null::text; return;
  end if;
  if revision_row.revision<>requested_expected_revision then return query select 'revision_conflict',null::text,null::text,null::text,null::text,revision_row.revision,null::jsonb,null::jsonb,null::text; return; end if;
  update builder_component_page_upload_sessions set state='finalizing',updated_at=now() where id=session.id;
  return query select 'claimed',resolved_book_slug,resolved_component_slug,session.page_key,session.upload_mode,revision_row.revision,session.page_metadata,session.file_descriptor,session.staging_object_key;
end $$;

-- Effective 060_students_book_page_expansion.sql definition; early B1 source serialization and immutable page-image placement.
create or replace function complete_builder_component_page_upload(
  requested_upload_id uuid,actor_builder_user_id uuid,requested_object_key text,requested_storage_bucket text,
  requested_mime_type text,requested_byte_size bigint,requested_checksum text,requested_width int,requested_height int
)
returns table(outcome text,page_id uuid,asset_id uuid,revision bigint) language plpgsql as $$
declare session builder_component_page_upload_sessions%rowtype; revision_row builder_component_page_revisions%rowtype; page_row book_pages%rowtype;
  edition book_editions%rowtype; created_asset_id uuid; package_slug text; component_slug text; page_slug text; student_component boolean; requested_unit uuid;
begin
  perform lock_builder_b1_component_source((select source_session.book_component_id from builder_component_page_upload_sessions source_session where source_session.id=requested_upload_id));
  select upload_session.* into session from builder_component_page_upload_sessions upload_session where upload_session.id=requested_upload_id for update;
  if session.id is null or session.created_by_builder_user_id<>actor_builder_user_id or session.state<>'finalizing' then raise exception 'page upload session cannot be completed'; end if;
  if requested_mime_type not in ('image/png','image/jpeg','image/webp') or requested_byte_size<1 or requested_checksum!~'^[a-f0-9]{64}$' or requested_width<1 or requested_height<1 then raise exception 'page upload metadata is invalid'; end if;
  select book_package.slug,component.slug into package_slug,component_slug from book_packages book_package join book_components component on component.book_package_id=book_package.id where component.id=session.book_component_id;
  student_component:=component_slug='ultimate-b2-students-book' and exists(select 1 from builder_students_book_canonical_pages where page_key=session.page_key);
  if student_component and exists(select 1 from builder_students_book_canonical_pages where page_key=session.page_key and (width<>requested_width or height<>requested_height)) then raise exception 'canonical page dimensions conflict'; end if;
  if component_slug='ultimate-b2-students-book' then
    if package_slug is distinct from 'ultimate-b2' or not exists(select 1 from book_components where id=session.book_component_id and book_package_id=session.book_package_id)
      or not builder_students_book_page_metadata_valid(session.page_metadata)
      or requested_mime_type is null or requested_byte_size is null or requested_checksum is null or requested_width is null or requested_height is null
      or (not student_component and session.page_key !~ '^ultimate-b2-students-book/pages/sb-page-[a-f0-9]{32}$') then raise exception 'page upload metadata is invalid'; end if;
  end if;
  page_slug:=substring(session.page_key from char_length(component_slug)+8);
  if session.page_metadata ? 'unitId' and coalesce(session.page_metadata->>'unitId','')<>'' then
    requested_unit:=(session.page_metadata->>'unitId')::uuid;
    if not exists(select 1 from units where id=requested_unit and book_component_id=session.book_component_id and unit_number between 1 and 10 and slug='unit-'||unit_number) then raise exception 'page upload unit is invalid'; end if;
  end if;
  if component_slug='ultimate-b2-students-book' then
    if student_component and requested_unit is not null and not exists(select 1 from units unit join builder_students_book_canonical_pages canonical on canonical.unit_number=unit.unit_number where canonical.page_key=session.page_key and unit.id=requested_unit) then raise exception 'canonical page unit conflict'; end if;
    if not student_component and session.upload_mode='create' and requested_unit is null then raise exception 'page upload unit is invalid'; end if;
  end if;
  select page_revision.* into revision_row from builder_component_page_revisions page_revision where page_revision.book_component_id=session.book_component_id for update;
  if revision_row.revision<>session.expected_revision then raise exception 'page revision changed during finalize'; end if;
  select component_page.* into page_row from book_pages component_page where component_page.book_component_id=session.book_component_id and component_page.stable_key=session.page_key for update;
  if component_slug='ultimate-b2-students-book' and not student_component and (
    session.upload_mode='create' and page_row.id is not null
    or session.upload_mode='replace' and (page_row.id is null or coalesce(page_row.source_metadata->>'is_active','false')<>'true')
  ) then raise exception 'page upload identity conflict'; end if;
  if page_row.id is null then
    insert into book_pages as created_page(book_package_id,book_component_id,unit_id,stable_key,label,sort_order,source_metadata)
    values(session.book_package_id,session.book_component_id,requested_unit,session.page_key,session.page_metadata->>'label',(session.page_metadata->>'sortOrder')::int,
      jsonb_build_object('source','builder-pages','is_override',student_component,'has_image_override',student_component,'has_metadata_override',false,'is_active',true,'is_deleted',false,'printed_label',coalesce(session.page_metadata->>'printedLabel',''),'original_filename',session.file_descriptor->>'name')) returning created_page.* into page_row;
  else
    if coalesce(page_row.source_metadata->>'is_deleted','false')='true' or coalesce(page_row.source_metadata->>'is_permanently_deleted','false')='true' then raise exception 'page upload target is inactive'; end if;
    update book_pages as updated_page set label=case when student_component and updated_page.source_metadata->>'has_metadata_override'='true' then updated_page.label else session.page_metadata->>'label' end,
      sort_order=case when student_component and updated_page.source_metadata->>'has_metadata_override'='true' then updated_page.sort_order else (session.page_metadata->>'sortOrder')::int end,
      unit_id=case when requested_unit is not null then requested_unit else updated_page.unit_id end,
      source_metadata=updated_page.source_metadata||jsonb_build_object('source','builder-pages','is_override',student_component or coalesce((updated_page.source_metadata->>'has_metadata_override')::boolean,false),'has_image_override',student_component,'is_active',true,'is_deleted',false,'printed_label',case when student_component and updated_page.source_metadata->>'has_metadata_override'='true' then coalesce(updated_page.source_metadata->>'printed_label','') else coalesce(session.page_metadata->>'printedLabel','') end,'original_filename',session.file_descriptor->>'name'),updated_at=now()
    where updated_page.id=page_row.id returning updated_page.* into page_row;
  end if;
  perform place_builder_b1_page_hotspots(session.book_component_id,page_row.id,actor_builder_user_id,session.client_mutation_id);
  insert into book_editions as page_edition(book_package_id,edition_identifier,title,status,source_metadata)
  values(session.book_package_id,'builder-pages','Builder page assets','draft','{"source":"builder-pages"}'::jsonb)
  on conflict(book_package_id,edition_identifier) do update set updated_at=now() returning page_edition.* into edition;
  update book_assets page_asset set publication_status='archived',updated_at=now() where page_asset.page_id=page_row.id and page_asset.asset_role='page_image' and page_asset.publication_status='draft';
  select existing_asset.id into created_asset_id from book_assets existing_asset where existing_asset.storage_bucket=requested_storage_bucket and existing_asset.object_key=requested_object_key;
  if created_asset_id is not null then
    update book_assets managed_asset set publication_status='draft',unit_id=case when exists(select 1 from book_component_release_asset_pins pin where pin.book_asset_id=managed_asset.id) then managed_asset.unit_id else page_row.unit_id end,updated_at=now()
    where managed_asset.id=created_asset_id and managed_asset.book_package_id=session.book_package_id and managed_asset.book_component_id=session.book_component_id and managed_asset.page_id=page_row.id
      and managed_asset.asset_role='page_image' and managed_asset.mime_type=requested_mime_type and managed_asset.byte_size=requested_byte_size and managed_asset.checksum_sha256=requested_checksum
      and managed_asset.width=requested_width and managed_asset.height=requested_height and managed_asset.storage_profile='private' and managed_asset.access_level='internal';
    if not found then raise exception 'page managed asset identity conflict'; end if;
  else
    insert into book_assets as created_asset(book_package_id,edition_id,book_component_id,unit_id,page_id,activity_id,stable_logical_key,asset_role,object_key,storage_profile,storage_bucket,mime_type,byte_size,checksum_sha256,width,height,edition_identifier,version,publication_status,access_level,source_metadata)
    values(session.book_package_id,edition.id,session.book_component_id,page_row.unit_id,page_row.id,null,package_slug||'.builder-pages.'||component_slug||'.'||page_slug,'page_image',requested_object_key,'private',requested_storage_bucket,requested_mime_type,requested_byte_size,requested_checksum,requested_width,requested_height,'builder-pages',page_slug,'draft','internal',jsonb_build_object('upload_session_id',session.id,'original_filename',session.file_descriptor->>'name')) returning created_asset.id into created_asset_id;
  end if;
  update builder_component_page_revisions page_revision set revision=page_revision.revision+1,updated_at=now() where page_revision.book_component_id=session.book_component_id returning page_revision.* into revision_row;
  update builder_component_page_upload_sessions upload_session set state='completed',resulting_page_id=page_row.id,resulting_asset_id=created_asset_id,resulting_revision=revision_row.revision,finalized_at=now(),updated_at=now() where upload_session.id=session.id;
  insert into builder_audit_log(builder_user_id,action,target_type,target_id,metadata) values(actor_builder_user_id,'component_page_asset_finalized','book_page',page_row.id::text,jsonb_build_object('component_slug',component_slug,'page_key',session.page_key,'revision',revision_row.revision));
  return query select 'saved',page_row.id,created_asset_id,revision_row.revision;
end $$;

-- Effective 060_students_book_page_expansion.sql definition; early B1 source serialization and immutable page-image placement.
create or replace function mutate_builder_component_page(
  requested_book_slug text,requested_component_slug text,requested_page_key text,requested_action text,requested_expected_revision bigint,
  requested_client_mutation_id uuid,requested_page_metadata jsonb,actor_builder_user_id uuid
)
returns table(outcome text,current_revision bigint) language plpgsql as $$
declare scope record; revision_row builder_component_page_revisions%rowtype; page_row book_pages%rowtype; existing builder_component_page_mutations%rowtype; request_value jsonb; requested_unit uuid;
begin
  perform lock_builder_b1_component_source((select component.id from book_components component join book_packages package on package.id=component.book_package_id where package.slug=requested_book_slug and component.slug=requested_component_slug));
  if not exists(select 1 from builder_users where id=actor_builder_user_id and status='active' and role='developer') then return query select 'unauthorized_actor',null::bigint; return; end if;
  select * into scope from resolve_builder_page_component(requested_book_slug,requested_component_slug);
  if scope.book_component_id is null or requested_page_key not like requested_component_slug||'/pages/%' then return query select 'resource_not_found',null::bigint; return; end if;
  if requested_component_slug='ultimate-b2-students-book' and requested_action in ('metadata','reorder') and not builder_students_book_page_metadata_valid(requested_page_metadata) then return query select 'invalid_page_metadata',null::bigint; return; end if;
  if requested_page_metadata ? 'unitId' and coalesce(requested_page_metadata->>'unitId','')<>'' then
    begin requested_unit:=(requested_page_metadata->>'unitId')::uuid; exception when invalid_text_representation then return query select 'invalid_unit',null::bigint; return; end;
    if (requested_component_slug='ultimate-b2-students-book' and exists(select 1 from builder_students_book_canonical_pages where page_key=requested_page_key)) or not exists(select 1 from units where id=requested_unit and book_component_id=scope.book_component_id and unit_number between 1 and 10 and slug='unit-'||unit_number) then return query select 'invalid_unit',null::bigint; return; end if;
  end if;
  insert into builder_component_page_revisions(book_component_id) values(scope.book_component_id) on conflict do nothing;
  select * into revision_row from builder_component_page_revisions where book_component_id=scope.book_component_id for update;
  request_value:=jsonb_build_object('pageKey',requested_page_key,'action',requested_action,'metadata',requested_page_metadata);
  select * into existing from builder_component_page_mutations where book_component_id=scope.book_component_id and client_mutation_id=requested_client_mutation_id;
  if existing.client_mutation_id is not null then return query select case when existing.request_payload=request_value then 'idempotent' else 'mutation_id_conflict' end,existing.resulting_revision; return; end if;
  if revision_row.revision<>requested_expected_revision then return query select 'revision_conflict',revision_row.revision; return; end if;
  select * into page_row from book_pages where book_component_id=scope.book_component_id and stable_key=requested_page_key for update;
  if page_row.id is null then return query select 'page_not_found',revision_row.revision; return; end if;
  if coalesce(page_row.source_metadata->>'is_deleted','false')='true' or coalesce(page_row.source_metadata->>'is_permanently_deleted','false')='true' then return query select 'page_state_conflict',revision_row.revision; return; end if;
  if requested_action in ('metadata','reorder') then
    update book_pages set label=requested_page_metadata->>'label',sort_order=(requested_page_metadata->>'sortOrder')::int,
      unit_id=case when requested_unit is not null then requested_unit else unit_id end,
      source_metadata=source_metadata||jsonb_build_object('printed_label',coalesce(requested_page_metadata->>'printedLabel',''),'has_metadata_override',(requested_component_slug='ultimate-b2-students-book' and exists(select 1 from builder_students_book_canonical_pages where page_key=requested_page_key)),'is_override',(requested_component_slug='ultimate-b2-students-book' and exists(select 1 from builder_students_book_canonical_pages where page_key=requested_page_key)) or coalesce((source_metadata->>'is_override')::boolean,false)),updated_at=now() where id=page_row.id;
    perform place_builder_b1_page_hotspots(scope.book_component_id,page_row.id,actor_builder_user_id,requested_client_mutation_id);
    -- Pinned page-image identity keeps its frozen Unit; current placement is book_pages.unit_id.
    update book_assets set unit_id=(select unit_id from book_pages where id=page_row.id),updated_at=now() where page_id=page_row.id and publication_status='draft' and (asset_role<>'page_image' or not exists(select 1 from book_component_release_asset_pins pin where pin.book_asset_id=book_assets.id));
  elsif requested_action='restore-image' and (requested_component_slug='ultimate-b2-students-book' and exists(select 1 from builder_students_book_canonical_pages where page_key=requested_page_key)) then
    update book_assets set publication_status='archived',updated_at=now() where page_id=page_row.id and asset_role='page_image' and publication_status='draft';
    update book_pages set source_metadata=source_metadata||jsonb_build_object('has_image_override',false,'is_override',coalesce((source_metadata->>'has_metadata_override')::boolean,false)),updated_at=now() where id=page_row.id;
  else return query select 'operation_not_allowed',revision_row.revision; return; end if;
  update builder_component_page_revisions set revision=revision+1,updated_at=now() where book_component_id=scope.book_component_id returning * into revision_row;
  insert into builder_component_page_mutations(book_component_id,client_mutation_id,request_payload,resulting_revision,created_by_builder_user_id) values(scope.book_component_id,requested_client_mutation_id,request_value,revision_row.revision,actor_builder_user_id);
  insert into builder_audit_log(builder_user_id,action,target_type,target_id,metadata) values(actor_builder_user_id,'component_page_'||replace(requested_action,'-','_'),'book_page',page_row.id::text,jsonb_build_object('component_slug',requested_component_slug,'revision',revision_row.revision));
  return query select 'saved',revision_row.revision;
end $$;

-- Effective 060_students_book_page_expansion.sql definition; early B1 source serialization.
create or replace function delete_builder_component_page_lifecycle(
  requested_book_slug text,requested_component_slug text,requested_page_key text,
  requested_expected_revision bigint,requested_expected_hotspot_revision bigint,
  requested_client_mutation_id uuid,requested_page_metadata jsonb,
  requested_hotspot_schema_version text,requested_hotspot_payload jsonb,requested_hotspot_sha256 text,
  requested_removed_hotspot_count int,requested_preserved_activity_count int,actor_builder_user_id uuid
)
returns table(outcome text,current_revision bigint,hotspot_revision bigint,removed_hotspot_count int,preserved_activity_count int)
language plpgsql as $$
declare
  scope record; revision_row builder_component_page_revisions%rowtype; page_row book_pages%rowtype;
  hotspot_document builder_component_documents%rowtype; existing builder_component_page_mutations%rowtype;
  request_value jsonb; page_slug text; next_hotspot_revision bigint; resolved_unit_id uuid; restorable_asset_id uuid;
begin
  perform lock_builder_b1_component_source((select component.id from book_components component join book_packages package on package.id=component.book_package_id where package.slug=requested_book_slug and component.slug=requested_component_slug));
  if not exists(select 1 from builder_users where id=actor_builder_user_id and status='active' and role='developer') then return query select 'unauthorized_actor',null::bigint,null::bigint,0,0; return; end if;
  select * into scope from resolve_builder_page_component(requested_book_slug,requested_component_slug);
  if scope.book_component_id is null or requested_page_key not like requested_component_slug||'/pages/%' then return query select 'resource_not_found',null::bigint,null::bigint,0,0; return; end if;
  if requested_hotspot_schema_version!~'^[0-9]+\.[0-9]+$' or requested_hotspot_sha256!~'^[a-f0-9]{64}$'
    or jsonb_typeof(requested_hotspot_payload)<>'object' or jsonb_typeof(requested_hotspot_payload->'pages')<>'object'
    or requested_hotspot_payload->>'schemaVersion'<>requested_hotspot_schema_version or requested_hotspot_payload->>'packageSlug'<>requested_book_slug
    or requested_removed_hotspot_count<0 or requested_preserved_activity_count<0 then return query select 'invalid_hotspot_projection',null::bigint,null::bigint,0,0; return; end if;
  page_slug:=substring(requested_page_key from char_length(requested_component_slug)+8);
  if requested_hotspot_payload->'pages' ? page_slug then return query select 'invalid_hotspot_projection',null::bigint,null::bigint,0,0; return; end if;
  insert into builder_component_page_revisions(book_component_id) values(scope.book_component_id) on conflict do nothing;
  select * into revision_row from builder_component_page_revisions where book_component_id=scope.book_component_id for update;
  select * into hotspot_document from builder_component_documents where book_component_id=scope.book_component_id and document_type='hotspots' and document_key='default' for update;
  next_hotspot_revision:=coalesce(hotspot_document.revision,0);
  request_value:=jsonb_build_object('pageKey',requested_page_key,'action','delete','expectedRevision',requested_expected_revision,'expectedHotspotRevision',requested_expected_hotspot_revision,'pageMetadata',requested_page_metadata,'hotspotSha256',requested_hotspot_sha256,'removedHotspotCount',requested_removed_hotspot_count,'preservedActivityCount',requested_preserved_activity_count);
  select * into existing from builder_component_page_mutations where book_component_id=scope.book_component_id and client_mutation_id=requested_client_mutation_id;
  if existing.client_mutation_id is not null then return query select case when existing.request_payload=request_value then 'idempotent' else 'mutation_id_conflict' end,existing.resulting_revision,coalesce(existing.resulting_hotspot_revision,next_hotspot_revision),coalesce(existing.removed_hotspot_count,0),coalesce(existing.preserved_activity_count,0); return; end if;
  if revision_row.revision<>requested_expected_revision then return query select 'revision_conflict',revision_row.revision,next_hotspot_revision,0,0; return; end if;
  if next_hotspot_revision<>requested_expected_hotspot_revision then return query select 'hotspot_revision_conflict',revision_row.revision,next_hotspot_revision,0,0; return; end if;
  if exists(select 1 from book_media_assets where package_slug=requested_book_slug and component_slug=requested_component_slug and page_id=page_slug)
    or exists(select 1 from builder_component_documents where book_component_id=scope.book_component_id
      and document_type not in ('hotspots','native_activity_index','native_activity_public','native_activity_teacher','activity_lifecycle','open_response')
      and not (requested_book_slug='ultimate-b2' and requested_component_slug='ultimate-b2-students-book' and document_type='unit_extras' and document_key='default')
      and payload::text like '%'||page_slug||'%') then return query select 'unsupported_page_reference',revision_row.revision,next_hotspot_revision,0,0; return; end if;
  select * into page_row from book_pages where book_component_id=scope.book_component_id and stable_key=requested_page_key for update;
  if page_row.id is null and (requested_component_slug='ultimate-b2-students-book' and exists(select 1 from builder_students_book_canonical_pages where page_key=requested_page_key)) then
    select id into resolved_unit_id from units where book_component_id=scope.book_component_id and unit_number=(select canonical.unit_number from builder_students_book_canonical_pages canonical where canonical.page_key=requested_page_key) limit 1;
    insert into book_pages(book_package_id,book_component_id,unit_id,stable_key,label,sort_order,source_metadata)
    values(scope.book_package_id,scope.book_component_id,resolved_unit_id,requested_page_key,requested_page_metadata->>'label',(requested_page_metadata->>'sortOrder')::int,
      jsonb_build_object('source','builder-pages','is_override',false,'has_image_override',false,'has_metadata_override',false,'is_active',false,'is_deleted',true,'is_permanently_deleted',false,'printed_label',coalesce(requested_page_metadata->>'printedLabel',''),'removed_hotspot_count',requested_removed_hotspot_count,'preserved_activity_count',requested_preserved_activity_count,'deleted_at',now())) returning * into page_row;
  elsif page_row.id is null then return query select 'page_not_found',revision_row.revision,next_hotspot_revision,0,0; return;
  elsif coalesce(page_row.source_metadata->>'is_deleted','false')='true' or coalesce(page_row.source_metadata->>'is_permanently_deleted','false')='true' or (not (requested_component_slug='ultimate-b2-students-book' and exists(select 1 from builder_students_book_canonical_pages where page_key=requested_page_key)) and coalesce(page_row.source_metadata->>'is_active','false')<>'true') then return query select 'page_state_conflict',revision_row.revision,next_hotspot_revision,0,0; return; end if;
  if exists(select 1 from book_assets where page_id=page_row.id and asset_role<>'page_image' and publication_status<>'archived') then return query select 'unsupported_page_reference',revision_row.revision,next_hotspot_revision,0,0; return; end if;
  select id into restorable_asset_id from book_assets where page_id=page_row.id and book_component_id=scope.book_component_id and asset_role='page_image' and publication_status='draft' and storage_profile='private' and access_level='internal' order by updated_at desc,id limit 1;
  if requested_removed_hotspot_count>0 then
    next_hotspot_revision:=next_hotspot_revision+1;
    if hotspot_document.id is null then
      insert into builder_component_documents(book_package_id,book_component_id,document_type,document_key,schema_version,revision,payload,payload_sha256,created_by_builder_user_id,updated_by_builder_user_id)
      values(scope.book_package_id,scope.book_component_id,'hotspots','default',requested_hotspot_schema_version,next_hotspot_revision,requested_hotspot_payload,requested_hotspot_sha256,actor_builder_user_id,actor_builder_user_id) returning * into hotspot_document;
    else update builder_component_documents set schema_version=requested_hotspot_schema_version,revision=next_hotspot_revision,payload=requested_hotspot_payload,payload_sha256=requested_hotspot_sha256,updated_by_builder_user_id=actor_builder_user_id,updated_at=now() where id=hotspot_document.id returning * into hotspot_document; end if;
    insert into builder_component_document_revisions(document_id,revision,payload,payload_sha256,changed_by_builder_user_id,client_mutation_id) values(hotspot_document.id,next_hotspot_revision,requested_hotspot_payload,requested_hotspot_sha256,actor_builder_user_id,requested_client_mutation_id);
  end if;
  update book_assets set publication_status='archived',updated_at=now() where page_id=page_row.id and asset_role='page_image' and publication_status='draft';
  update book_pages set source_metadata=source_metadata||jsonb_strip_nulls(jsonb_build_object('is_active',false,'is_deleted',true,'is_permanently_deleted',false,'removed_hotspot_count',requested_removed_hotspot_count,'preserved_activity_count',requested_preserved_activity_count,'restorable_asset_id',restorable_asset_id::text,'deleted_at',now())),updated_at=now() where id=page_row.id;
  update builder_component_page_revisions set revision=revision+1,updated_at=now() where book_component_id=scope.book_component_id returning * into revision_row;
  insert into builder_component_page_mutations(book_component_id,client_mutation_id,request_payload,resulting_revision,resulting_hotspot_revision,removed_hotspot_count,preserved_activity_count,created_by_builder_user_id) values(scope.book_component_id,requested_client_mutation_id,request_value,revision_row.revision,next_hotspot_revision,requested_removed_hotspot_count,requested_preserved_activity_count,actor_builder_user_id);
  insert into builder_audit_log(builder_user_id,action,target_type,target_id,metadata) values(actor_builder_user_id,'component_page_deleted','book_page',page_row.id::text,jsonb_build_object('component_slug',requested_component_slug,'page_key',requested_page_key,'page_revision',revision_row.revision,'hotspot_revision',next_hotspot_revision,'removed_hotspot_count',requested_removed_hotspot_count,'preserved_activity_count',requested_preserved_activity_count));
  return query select 'saved',revision_row.revision,next_hotspot_revision,requested_removed_hotspot_count,requested_preserved_activity_count;
end $$;

-- Effective 060_students_book_page_expansion.sql definition; early B1 source serialization and immutable page-image placement.
create or replace function restore_builder_component_page(
  requested_book_slug text,requested_component_slug text,requested_page_key text,requested_expected_revision bigint,
  requested_client_mutation_id uuid,actor_builder_user_id uuid
)
returns table(outcome text,current_revision bigint) language plpgsql as $$
declare scope record; revision_row builder_component_page_revisions%rowtype; page_row book_pages%rowtype; existing builder_component_page_mutations%rowtype; request_value jsonb; restore_asset uuid; candidate_count int;
begin
  perform lock_builder_b1_component_source((select component.id from book_components component join book_packages package on package.id=component.book_package_id where package.slug=requested_book_slug and component.slug=requested_component_slug));
  if not exists(select 1 from builder_users where id=actor_builder_user_id and status='active' and role='developer') then return query select 'unauthorized_actor',null::bigint; return; end if;
  select * into scope from resolve_builder_page_component(requested_book_slug,requested_component_slug);
  if scope.book_component_id is null or requested_page_key not like requested_component_slug||'/pages/%' then return query select 'resource_not_found',null::bigint; return; end if;
  insert into builder_component_page_revisions(book_component_id) values(scope.book_component_id) on conflict do nothing;
  select * into revision_row from builder_component_page_revisions where book_component_id=scope.book_component_id for update;
  request_value:=jsonb_build_object('pageKey',requested_page_key,'action','restore-page','expectedRevision',requested_expected_revision);
  select * into existing from builder_component_page_mutations where book_component_id=scope.book_component_id and client_mutation_id=requested_client_mutation_id;
  if existing.client_mutation_id is not null then return query select case when existing.request_payload=request_value then 'idempotent' else 'mutation_id_conflict' end,existing.resulting_revision; return; end if;
  if revision_row.revision<>requested_expected_revision then return query select 'revision_conflict',revision_row.revision; return; end if;
  select * into page_row from book_pages where book_component_id=scope.book_component_id and stable_key=requested_page_key for update;
  if page_row.id is null then return query select 'page_not_found',revision_row.revision; return; end if;
  if coalesce(page_row.source_metadata->>'is_permanently_deleted','false')='true' then return query select 'page_permanently_deleted',revision_row.revision; return; end if;
  if coalesce(page_row.source_metadata->>'is_deleted','false')<>'true' then return query select 'page_state_conflict',revision_row.revision; return; end if;
  if coalesce(page_row.source_metadata->>'restorable_asset_id','')<>'' then
    begin restore_asset:=(page_row.source_metadata->>'restorable_asset_id')::uuid; exception when invalid_text_representation then return query select 'restorable_asset_unavailable',revision_row.revision; return; end;
  elsif not (requested_component_slug='ultimate-b2-students-book' and exists(select 1 from builder_students_book_canonical_pages where page_key=requested_page_key)) then
    select count(*)::int,(array_agg(id order by id))[1] into candidate_count,restore_asset from book_assets where page_id=page_row.id and book_component_id=scope.book_component_id and book_package_id=scope.book_package_id and asset_role='page_image' and publication_status='archived' and storage_profile='private' and access_level='internal' and updated_at=page_row.updated_at;
    if candidate_count<>1 then select count(*)::int,(array_agg(id order by id))[1] into candidate_count,restore_asset from book_assets where page_id=page_row.id and book_component_id=scope.book_component_id and book_package_id=scope.book_package_id and asset_role='page_image' and publication_status='archived' and storage_profile='private' and access_level='internal'; end if;
    if candidate_count<>1 then return query select 'restorable_asset_unavailable',revision_row.revision; return; end if;
  end if;
  if restore_asset is not null then
    update book_assets set publication_status='archived',updated_at=now() where page_id=page_row.id and asset_role='page_image' and publication_status='draft';
    update book_assets set publication_status='draft',unit_id=case when exists(select 1 from book_component_release_asset_pins pin where pin.book_asset_id=book_assets.id) then book_assets.unit_id else page_row.unit_id end,updated_at=now() where id=restore_asset and page_id=page_row.id and book_component_id=scope.book_component_id and book_package_id=scope.book_package_id and asset_role='page_image' and publication_status='archived' and storage_profile='private' and access_level='internal';
    if not found then return query select 'restorable_asset_unavailable',revision_row.revision; return; end if;
  end if;
  update book_pages set source_metadata=(source_metadata-'deleted_at')||jsonb_build_object('is_active',true,'is_deleted',false,'is_permanently_deleted',false,'has_image_override',case when (requested_component_slug='ultimate-b2-students-book' and exists(select 1 from builder_students_book_canonical_pages where page_key=requested_page_key)) then restore_asset is not null else coalesce((source_metadata->>'has_image_override')::boolean,false) end,'is_override',case when (requested_component_slug='ultimate-b2-students-book' and exists(select 1 from builder_students_book_canonical_pages where page_key=requested_page_key)) then restore_asset is not null or coalesce((source_metadata->>'has_metadata_override')::boolean,false) else coalesce((source_metadata->>'is_override')::boolean,false) end),updated_at=now() where id=page_row.id;
  update builder_component_page_revisions set revision=revision+1,updated_at=now() where book_component_id=scope.book_component_id returning * into revision_row;
  insert into builder_component_page_mutations(book_component_id,client_mutation_id,request_payload,resulting_revision,created_by_builder_user_id) values(scope.book_component_id,requested_client_mutation_id,request_value,revision_row.revision,actor_builder_user_id);
  insert into builder_audit_log(builder_user_id,action,target_type,target_id,metadata) values(actor_builder_user_id,'component_page_restored','book_page',page_row.id::text,jsonb_build_object('component_slug',requested_component_slug,'revision',revision_row.revision,'hotspots_restored',false,'asset_id',restore_asset));
  return query select 'saved',revision_row.revision;
end $$;

-- Effective 053_builder_page_lifecycle_completion.sql definition; early B1 source serialization.
create or replace function purge_builder_component_page(
  requested_book_slug text,requested_component_slug text,requested_page_key text,requested_expected_revision bigint,
  requested_client_mutation_id uuid,actor_builder_user_id uuid
)
returns table(outcome text,current_revision bigint) language plpgsql as $$
declare scope record; revision_row builder_component_page_revisions%rowtype; page_row book_pages%rowtype; existing builder_component_page_mutations%rowtype; request_value jsonb;
begin
  perform lock_builder_b1_component_source((select component.id from book_components component join book_packages package on package.id=component.book_package_id where package.slug=requested_book_slug and component.slug=requested_component_slug));
  if not exists(select 1 from builder_users where id=actor_builder_user_id and status='active' and role='developer') then return query select 'unauthorized_actor',null::bigint; return; end if;
  select * into scope from resolve_builder_page_component(requested_book_slug,requested_component_slug);
  if scope.book_component_id is null or requested_page_key not like requested_component_slug||'/pages/%' then return query select 'resource_not_found',null::bigint; return; end if;
  insert into builder_component_page_revisions(book_component_id) values(scope.book_component_id) on conflict do nothing;
  select * into revision_row from builder_component_page_revisions where book_component_id=scope.book_component_id for update;
  request_value:=jsonb_build_object('pageKey',requested_page_key,'action','purge','expectedRevision',requested_expected_revision);
  select * into existing from builder_component_page_mutations where book_component_id=scope.book_component_id and client_mutation_id=requested_client_mutation_id;
  if existing.client_mutation_id is not null then return query select case when existing.request_payload=request_value then 'idempotent' else 'mutation_id_conflict' end,existing.resulting_revision; return; end if;
  if revision_row.revision<>requested_expected_revision then return query select 'revision_conflict',revision_row.revision; return; end if;
  select * into page_row from book_pages where book_component_id=scope.book_component_id and stable_key=requested_page_key for update;
  if page_row.id is null then return query select 'page_not_found',revision_row.revision; return; end if;
  if coalesce(page_row.source_metadata->>'is_permanently_deleted','false')='true' then return query select 'page_permanently_deleted',revision_row.revision; return; end if;
  if coalesce(page_row.source_metadata->>'is_deleted','false')<>'true' then return query select 'page_state_conflict',revision_row.revision; return; end if;
  update book_assets set publication_status='archived',updated_at=now() where page_id=page_row.id and publication_status='draft';
  update book_pages set source_metadata=source_metadata||jsonb_build_object('is_active',false,'is_deleted',true,'is_permanently_deleted',true,'permanently_deleted_at',now()),updated_at=now() where id=page_row.id;
  update builder_component_page_revisions set revision=revision+1,updated_at=now() where book_component_id=scope.book_component_id returning * into revision_row;
  insert into builder_component_page_mutations(book_component_id,client_mutation_id,request_payload,resulting_revision,created_by_builder_user_id) values(scope.book_component_id,requested_client_mutation_id,request_value,revision_row.revision,actor_builder_user_id);
  insert into builder_audit_log(builder_user_id,action,target_type,target_id,metadata) values(actor_builder_user_id,'component_page_permanently_deleted','book_page',page_row.id::text,jsonb_build_object('component_slug',requested_component_slug,'revision',revision_row.revision,'activities_preserved',true,'immutable_releases_affected',false));
  return query select 'saved',revision_row.revision;
end $$;

-- Unit is a page placement property, including the redundant authored hotspot
-- Unit labels. Change only those labels through the canonical document save;
-- preserve geometry, page/activity identities, revisions, replay and audit.
create or replace function place_builder_b1_page_hotspots(
  requested_component_id uuid,requested_page_id uuid,actor_builder_user_id uuid,requested_client_mutation_id uuid
)
returns void language plpgsql as $$
declare scope record; document builder_component_documents%rowtype; page_key text; unit_number int; next_payload jsonb; saved record;
begin
  select package.slug book_slug,component.slug component_slug into scope from book_components component
    join book_packages package on package.id=component.book_package_id where component.id=requested_component_id
    and builder_b1_publication_contract(package.slug)->'components' ? component.slug;
  if scope.component_slug is null then return; end if;
  perform lock_builder_b1_component_source(requested_component_id);
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','builder-document',scope.book_slug,scope.component_slug,'hotspots','default'),0));
  select split_part(page.stable_key,'/pages/',2),unit.unit_number into page_key,unit_number
    from book_pages page join units unit on unit.id=page.unit_id and unit.book_component_id=page.book_component_id
    where page.id=requested_page_id and page.book_component_id=requested_component_id;
  select * into document from builder_component_documents where book_component_id=requested_component_id and document_type='hotspots' and document_key='default' for update;
  if document.id is null or page_key is null or jsonb_typeof(document.payload->'pages'->page_key) is distinct from 'array' then return; end if;
  select jsonb_set(document.payload,array['pages',page_key],coalesce(jsonb_agg(jsonb_set(entry.value,'{unitNumber}',to_jsonb(unit_number)) order by entry.ordinality),'[]'::jsonb))
    into next_payload from jsonb_array_elements(document.payload->'pages'->page_key) with ordinality entry(value,ordinality);
  if next_payload=document.payload then return; end if;
  select * into saved from save_builder_component_document(scope.book_slug,scope.component_slug,'hotspots','default',document.schema_version,document.revision,
    next_payload,builder_publication_json_sha256(next_payload),actor_builder_user_id,requested_client_mutation_id);
  if saved.outcome<>'saved' then raise exception 'page hotspot placement conflict'; end if;
end $$;

-- Effective 018 ownership checks with explicit immutable page-image association.
create or replace function validate_book_asset_relationships()
returns trigger as $$
declare
  component_package uuid;
  unit_component uuid;
  activity_package uuid;
  asset_page_component uuid;
  asset_page_unit uuid;
  stored_edition_identifier text;
  stored_package_slug text;
begin
  select edition_identifier into stored_edition_identifier from book_editions where id = new.edition_id;
  if stored_edition_identifier is distinct from new.edition_identifier then
    raise exception 'book asset edition identifier does not match edition';
  end if;
  select slug into stored_package_slug from book_packages where id = new.book_package_id;
  if new.stable_logical_key <> stored_package_slug
     and new.stable_logical_key not like stored_package_slug || '.%' then
    raise exception 'book asset logical key is not namespaced to its package';
  end if;
  if new.book_component_id is not null then
    select book_package_id into component_package from book_components where id = new.book_component_id;
    if component_package is distinct from new.book_package_id then
      raise exception 'book asset component does not belong to package';
    end if;
  end if;
  if new.unit_id is not null then
    select book_component_id into unit_component from units where id = new.unit_id;
    if new.book_component_id is null or unit_component is distinct from new.book_component_id then
      raise exception 'book asset unit does not belong to component';
    end if;
  end if;
  if new.activity_id is not null then
    select bp.id into activity_package
    from activities a
    join lessons l on l.id = a.lesson_id
    join units u on u.id = l.unit_id
    join book_components bc on bc.id = u.book_component_id
    join book_packages bp on bp.id = bc.book_package_id
    where a.id = new.activity_id;
    if activity_package is distinct from new.book_package_id then
      raise exception 'book asset activity does not belong to package';
    end if;
  end if;
  if new.page_id is not null then
    select book_component_id, unit_id into asset_page_component, asset_page_unit from book_pages where id = new.page_id;
    if new.book_component_id is null or asset_page_component is distinct from new.book_component_id then
      raise exception 'book asset page does not belong to component';
    end if;
    -- Pinned page-image physical identity retains its frozen Unit when the
    -- page moves. INSERT and reassignment still require the current page Unit;
    -- package/component/Unit/page checks above remain mandatory on every write.
    if asset_page_unit is distinct from new.unit_id and not (
      tg_op='UPDATE' and old.asset_role='page_image' and new.asset_role='page_image'
      and old.book_package_id is not distinct from new.book_package_id
      and old.book_component_id is not distinct from new.book_component_id
      and old.page_id is not distinct from new.page_id
      and old.unit_id is not distinct from new.unit_id
      and exists(select 1 from book_component_release_asset_pins pin where pin.book_asset_id=old.id)
    ) then
      raise exception 'book asset page does not belong to unit';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;
