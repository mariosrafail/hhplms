-- Explicit, opt-in B2 content sources and edition compositions. No legacy
-- documents, release heads, assignments, entitlements or source associations
-- are backfilled. Historical publication tables and writers are unchanged.

create table book_content_sources (
  id uuid primary key,
  book_package_id uuid not null references book_packages(id),
  book_component_id uuid not null,
  scope jsonb not null check (scope in ('{"kind":"shared","editionIds":["international","greek"]}'::jsonb,
    '{"kind":"edition","editionIds":["international"]}'::jsonb, '{"kind":"edition","editionIds":["greek"]}'::jsonb)),
  revision bigint not null check (revision > 0),
  foreign key (book_component_id,book_package_id) references book_components(id,book_package_id),
  unique(id,book_package_id,book_component_id)
);
create table book_content_source_revisions (
  source_id uuid not null references book_content_sources(id),
  revision bigint not null check (revision > 0),
  record jsonb not null check (jsonb_typeof(record)='object'),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_builder_user_id uuid not null references builder_users(id),
  created_at timestamptz not null default now(),
  primary key(source_id,revision)
);
create table book_content_source_asset_owners (
  book_asset_id uuid primary key references book_assets(id),
  source_id uuid not null references book_content_sources(id)
);
create table book_content_edition_selections (
  book_package_id uuid not null references book_packages(id),
  edition_id text not null check(edition_id in ('international','greek')),
  revision bigint not null default 0 check(revision>=0),
  primary key(book_package_id,edition_id)
);
create table book_content_edition_sources (
  book_package_id uuid not null,
  edition_id text not null,
  book_component_id uuid not null,
  source_id uuid not null,
  primary key(book_package_id,edition_id,book_component_id),
  foreign key(book_package_id,edition_id) references book_content_edition_selections(book_package_id,edition_id),
  foreign key(source_id,book_package_id,book_component_id) references book_content_sources(id,book_package_id,book_component_id)
);
create table book_content_edition_releases (
  id uuid primary key,
  book_package_id uuid not null references book_packages(id),
  edition_id text not null check(edition_id in ('international','greek')),
  release_number bigint not null check(release_number>0),
  payload jsonb not null,
  release_sha256 text not null check(release_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_builder_user_id uuid not null references builder_users(id),
  created_at timestamptz not null default now(),
  unique(book_package_id,edition_id,release_number),
  unique(id,book_package_id,edition_id)
);
create table book_content_edition_release_sources (
  release_id uuid not null references book_content_edition_releases(id),
  source_id uuid not null,
  source_revision bigint not null,
  primary key(release_id,source_id),
  foreign key(source_id,source_revision) references book_content_source_revisions(source_id,revision)
);
create table book_content_edition_heads (
  book_package_id uuid not null,
  edition_id text not null,
  release_id uuid not null,
  revision bigint not null check(revision>0),
  primary key(book_package_id,edition_id),
  foreign key(release_id,book_package_id,edition_id) references book_content_edition_releases(id,book_package_id,edition_id)
);
create table book_content_edition_publications (
  release_id uuid primary key references book_content_edition_releases(id),
  published_at timestamptz not null default now()
);
create table book_content_edition_mutations (
  client_mutation_id uuid primary key,
  actor_id uuid not null references builder_users(id),
  request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now()
);
-- Additional allow-list only: the normal book entitlement and tenant/role
-- checks must also pass. There is deliberately no default grant or seed.
create table book_content_edition_access (
  school_id uuid not null references schools(id),
  user_id uuid not null references app_users(id),
  book_package_id uuid not null references book_packages(id),
  edition_id text not null check(edition_id in ('international','greek')),
  primary key(school_id,user_id,book_package_id,edition_id)
);

create function check_content_edition_source_owner() returns trigger language plpgsql as $$
begin
  if not exists(select 1 from book_packages package join book_components component on component.book_package_id=package.id
    where package.id=new.book_package_id and component.id=new.book_component_id and package.slug='ultimate-b2'
      and component.slug in ('ultimate-b2-students-book','ultimate-b2-workbook','ultimate-b2-grammar-book'))
    then raise exception 'edition_source_owner_mismatch'; end if;
  if tg_op='UPDATE' and (new.id<>old.id or new.book_package_id<>old.book_package_id
    or new.book_component_id<>old.book_component_id or new.scope<>old.scope or new.revision<>old.revision+1)
    then raise exception 'edition_source_owner_mismatch'; end if;
  return new;
end $$;
create trigger content_source_owner before insert or update on book_content_sources
  for each row execute function check_content_edition_source_owner();
create function check_content_edition_association() returns trigger language plpgsql as $$
begin
  if not exists(select 1 from book_content_sources source where source.id=new.source_id
    and source.book_package_id=new.book_package_id and source.book_component_id=new.book_component_id
    and source.scope->'editionIds' ? new.edition_id) then raise exception 'edition_source_owner_mismatch'; end if;
  return new;
end $$;
create trigger content_edition_association before insert or update on book_content_edition_sources
  for each row execute function check_content_edition_association();

create function prevent_content_edition_immutable_change() returns trigger language plpgsql as $$
begin raise exception 'edition_immutable_record'; end $$;
create trigger content_source_revision_immutable before update or delete on book_content_source_revisions
  for each row execute function prevent_content_edition_immutable_change();
create trigger content_edition_release_immutable before update or delete on book_content_edition_releases
  for each row execute function prevent_content_edition_immutable_change();
create trigger content_edition_members_immutable before update or delete on book_content_edition_release_sources
  for each row execute function prevent_content_edition_immutable_change();
create trigger content_source_asset_owner_immutable before update or delete on book_content_source_asset_owners
  for each row execute function prevent_content_edition_immutable_change();
create trigger content_edition_publication_immutable before update or delete on book_content_edition_publications
  for each row execute function prevent_content_edition_immutable_change();
create trigger content_edition_mutation_immutable before update or delete on book_content_edition_mutations
  for each row execute function prevent_content_edition_immutable_change();
create function protect_content_source_asset() returns trigger language plpgsql as $$
begin
  if exists(select 1 from book_content_source_asset_owners where book_asset_id=old.id) then
    if tg_op='DELETE' then raise exception 'edition_source_asset_immutable'; end if;
    if (to_jsonb(new)-array['updated_at','publication_status']) is distinct from (to_jsonb(old)-array['updated_at','publication_status'])
      then raise exception 'edition_source_asset_immutable'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger content_source_asset_immutable before update or delete on book_assets
  for each row execute function protect_content_source_asset();

create function mutate_builder_content_edition(actor uuid, mutation_id uuid, request jsonb)
returns jsonb language plpgsql as $$
#variable_conflict use_variable
declare
  package_id uuid; component_id uuid; source_id uuid; edition text; operation text;
  requested_hash text; replay book_content_edition_mutations%rowtype;
  stored_source book_content_sources%rowtype; stored_release book_content_edition_releases%rowtype;
  expected bigint; current_revision bigint; selection_revision bigint;
  source_record jsonb; reference jsonb; member jsonb; payload jsonb; result jsonb;
  asset_id uuid; next_number bigint; required_components text[] := array['ultimate-b2-students-book','ultimate-b2-workbook','ultimate-b2-grammar-book'];
begin
  if not exists(select 1 from builder_users where id=actor and status='active' and role='developer') then
    return jsonb_build_object('outcome','unauthorized_actor');
  end if;
  if request->>'bookSlug' is distinct from 'ultimate-b2' then return jsonb_build_object('outcome','edition_book_unavailable'); end if;
  operation := request->>'operation'; edition := request->>'editionId';
  if edition is null or edition not in ('international','greek') then return jsonb_build_object('outcome','content_edition_unavailable'); end if;
  select id into package_id from book_packages where slug='ultimate-b2';
  if package_id is null then return jsonb_build_object('outcome','edition_book_unavailable'); end if;
  -- A package-wide lock serializes shared-source writes with both edition
  -- candidate captures; head revisions themselves remain edition-scoped.
  perform pg_advisory_xact_lock(hashtextextended('content-editions:'||package_id::text,0));
  requested_hash := builder_publication_json_sha256(request);
  select * into replay from book_content_edition_mutations where client_mutation_id=mutation_id;
  if found then
    if replay.actor_id<>actor or replay.request_sha256<>requested_hash then return jsonb_build_object('outcome','mutation_id_conflict'); end if;
    return replay.result || '{"replayed":true}'::jsonb;
  end if;
  expected := (request->>'expectedRevision')::bigint;
  if expected is null or expected<0 then return jsonb_build_object('outcome','edition_revision_invalid'); end if;
  if operation in ('save-source','associate') then
    select id into component_id from book_components where book_package_id=package_id and slug=request->>'componentSlug' and slug=any(required_components);
    if component_id is null then return jsonb_build_object('outcome','edition_component_mismatch'); end if;
    source_id := (request->>'sourceId')::uuid;
    select * into stored_source from book_content_sources where id=source_id;
    if found and (stored_source.book_package_id<>package_id or stored_source.book_component_id<>component_id
      or not (stored_source.scope->'editionIds' ? edition)) then return jsonb_build_object('outcome','edition_source_owner_mismatch'); end if;
  end if;
  if operation='save-source' then
    source_record := request->'record'; reference := source_record->'reference';
    if reference->>'bookSlug' is distinct from 'ultimate-b2' or reference->>'componentSlug' is distinct from request->>'componentSlug'
      or reference->>'sourceId' is distinct from source_id::text or not coalesce(reference->'scope'->'editionIds' ? edition,false)
      or reference->>'schemaVersion' is distinct from 'content-source.v1'
      or reference->'scope' not in ('{"kind":"shared","editionIds":["international","greek"]}'::jsonb,
        '{"kind":"edition","editionIds":["international"]}'::jsonb,'{"kind":"edition","editionIds":["greek"]}'::jsonb)
      or (reference-'sha256') is distinct from ((source_record->'source')-'inputs')
      or reference->>'sha256' is distinct from builder_publication_json_sha256(jsonb_build_object('namespace','content-source.v1','value',source_record->'source'))
      then return jsonb_build_object('outcome','edition_source_invalid'); end if;
    current_revision:=coalesce(stored_source.revision,0);
    if expected<>current_revision or (reference->>'revision')::bigint<>current_revision+1 then return jsonb_build_object('outcome','revision_conflict','revision',current_revision); end if;
    if stored_source.id is not null and stored_source.scope is distinct from reference->'scope' then return jsonb_build_object('outcome','edition_source_owner_mismatch'); end if;
    if jsonb_typeof(request->'assetIds') is distinct from 'array'
      or array(select distinct value from jsonb_array_elements_text(request->'assetIds') order by value)
      is distinct from array(select distinct asset from (
        select value->>'asset_id' asset from jsonb_array_elements(coalesce(source_record->'source'->'inputs'->'pages'->'rows','[]'::jsonb)) where value->>'asset_id' is not null
        union select value->>'id' from jsonb_array_elements(coalesce(source_record->'source'->'inputs'->'native'->'assetRows','[]'::jsonb))
        union select value->>'id' from jsonb_array_elements(coalesce(source_record->'source'->'inputs'->'unitExtras'->'assetRows','[]'::jsonb))
        union select value->'row'->>'id' from jsonb_array_elements(coalesce(source_record->'source'->'inputs'->'overviewFontSources','[]'::jsonb))
      ) assets where asset is not null order by asset)
      then return jsonb_build_object('outcome','edition_asset_owner_mismatch'); end if;
    -- Every asset is claimed explicitly by this source, within the existing
    -- book/component boundary. A hash match never claims a foreign asset.
    for asset_id in select value::text::uuid from jsonb_array_elements_text(request->'assetIds') loop
      if not exists(select 1 from book_assets where id=asset_id and book_package_id=package_id and book_component_id=component_id)
        or exists(select 1 from book_content_source_asset_owners owner where owner.book_asset_id=asset_id and owner.source_id<>source_id)
        then return jsonb_build_object('outcome','edition_asset_owner_mismatch'); end if;
    end loop;
    insert into book_content_sources(id,book_package_id,book_component_id,scope,revision)
      values(source_id,package_id,component_id,reference->'scope',current_revision+1)
      on conflict(id) do update set revision=excluded.revision;
    insert into book_content_source_revisions values(source_id,current_revision+1,source_record,reference->>'sha256',actor,now());
    insert into book_content_source_asset_owners(book_asset_id,source_id)
      select value::uuid,source_id from jsonb_array_elements_text(request->'assetIds') on conflict(book_asset_id) do nothing;
    result:=jsonb_build_object('outcome','saved','revision',current_revision+1,'sourceId',source_id);
  elsif operation='associate' then
    if stored_source.id is null then return jsonb_build_object('outcome','edition_source_missing'); end if;
    select revision into selection_revision from book_content_edition_selections where book_package_id=package_id and edition_id=edition;
    if expected<>coalesce(selection_revision,0) then return jsonb_build_object('outcome','revision_conflict','revision',coalesce(selection_revision,0)); end if;
    insert into book_content_edition_selections values(package_id,edition,coalesce(selection_revision,0)+1)
      on conflict(book_package_id,edition_id) do update set revision=excluded.revision;
    insert into book_content_edition_sources values(package_id,edition,component_id,source_id)
      on conflict(book_package_id,edition_id,book_component_id) do update set source_id=excluded.source_id;
    result:=jsonb_build_object('outcome','associated','revision',coalesce(selection_revision,0)+1);
  elsif operation='prepare' then
    payload:=request->'release';
    select coalesce(max(release_number),0)+1 into next_number from book_content_edition_releases where book_package_id=package_id and edition_id=edition;
    select revision into selection_revision from book_content_edition_selections where book_package_id=package_id and edition_id=edition;
    if expected<>coalesce(selection_revision,0) or (payload->>'number')::bigint<>next_number then return jsonb_build_object('outcome','revision_conflict'); end if;
    if payload->>'schemaVersion' is distinct from 'edition-release.v1' or payload->>'compilerId' is distinct from 'ultimate-b2-edition-composition-v1'
      or payload->'composition'->'edition' is distinct from jsonb_build_object('schemaVersion','content-edition.v1','bookSlug','ultimate-b2','editionId',edition)
      or jsonb_array_length(payload->'members')<>3 or jsonb_array_length(payload->'composition'->'members')<>3
      or payload->>'compositionSha256' is distinct from builder_publication_json_sha256(jsonb_build_object('namespace','edition-composition.v1','value',payload->'composition'))
      or payload->>'releaseSha256' is distinct from builder_publication_json_sha256(jsonb_build_object('namespace','edition-release.v1','value',payload-'releaseSha256'))
      then return jsonb_build_object('outcome','edition_release_invalid'); end if;
    for member in select value from jsonb_array_elements(payload->'members') loop
      reference:=member->'reference';
      if not exists(select 1 from book_content_edition_sources association
        join book_content_sources source on source.id=association.source_id
        join book_components component on component.id=source.book_component_id
        join book_content_source_revisions revision on revision.source_id=source.id and revision.revision=source.revision
        where association.book_package_id=package_id and association.edition_id=edition
          and component.slug=reference->>'componentSlug' and revision.record=member)
        then return jsonb_build_object('outcome','edition_source_revision_conflict'); end if;
    end loop;
    if array(select value->>'componentSlug' from jsonb_array_elements(payload->'composition'->'members'))<>required_components
      or payload->'composition'->'members' is distinct from (select jsonb_agg(value->'reference') from jsonb_array_elements(payload->'members'))
      then return jsonb_build_object('outcome','edition_required_sources_missing'); end if;
    insert into book_content_edition_releases values((payload->>'id')::uuid,package_id,edition,next_number,payload,payload->>'releaseSha256',actor,now());
    insert into book_content_edition_release_sources select (payload->>'id')::uuid,(value->'reference'->>'sourceId')::uuid,(value->'reference'->>'revision')::bigint from jsonb_array_elements(payload->'members');
    result:=jsonb_build_object('outcome','prepared','releaseId',payload->>'id','number',next_number);
  elsif operation='publish' then
    select * into stored_release from book_content_edition_releases where id=(request->>'releaseId')::uuid and book_package_id=package_id and edition_id=edition;
    if not found then return jsonb_build_object('outcome','edition_release_context_mismatch'); end if;
    select revision into current_revision from book_content_edition_heads where book_package_id=package_id and edition_id=edition;
    if expected<>coalesce(current_revision,0) then return jsonb_build_object('outcome','revision_conflict','revision',coalesce(current_revision,0)); end if;
    insert into book_content_edition_heads values(package_id,edition,stored_release.id,coalesce(current_revision,0)+1)
      on conflict(book_package_id,edition_id) do update set release_id=excluded.release_id,revision=excluded.revision;
    insert into book_content_edition_publications(release_id) values(stored_release.id) on conflict do nothing;
    result:=jsonb_build_object('outcome','published','releaseId',stored_release.id,'revision',coalesce(current_revision,0)+1);
  else return jsonb_build_object('outcome','edition_operation_invalid');
  end if;
  insert into book_content_edition_mutations values(mutation_id,actor,requested_hash,result,now());
  return result;
end $$;
