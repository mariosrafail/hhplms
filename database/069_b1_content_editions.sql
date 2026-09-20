-- Explicit B1 family editions; no existing content is classified or rewritten.
-- B2 keeps three members; B1/B1+ retain published SB/WB membership.
create function builder_content_edition_components_v1(book_slug text)
returns text[] language sql immutable as $$
 select case book_slug
 when 'ultimate-b2' then array['ultimate-b2-students-book','ultimate-b2-workbook','ultimate-b2-grammar-book']
 when 'ultimate-b1' then array['ultimate-b1-students-book','ultimate-b1-workbook']
 when 'ultimate-b1-plus' then array['ultimate-b1-plus-students-book','ultimate-b1-plus-workbook']
 else array[]::text[] end
$$;

create or replace function check_content_edition_source_owner() returns trigger language plpgsql as $$
begin
  if not exists(select 1 from book_packages package join book_components component on component.book_package_id=package.id
    where package.id=new.book_package_id and component.id=new.book_component_id and component.slug=any(builder_content_edition_components_v1(package.slug)))
    then raise exception 'edition_source_owner_mismatch'; end if;
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.book_package_id is distinct from old.book_package_id
    or new.book_component_id is distinct from old.book_component_id or new.scope is distinct from old.scope or new.revision is distinct from old.revision+1)
    then raise exception 'edition_source_owner_mismatch'; end if;
  return new;
end $$;

create or replace function mutate_builder_content_edition(actor uuid, mutation_id uuid, request jsonb)
returns jsonb language plpgsql as $$
#variable_conflict use_variable
declare
  package_id uuid; component_id uuid; source_id uuid; edition text; operation text;
  requested_hash text; replay book_content_edition_mutations%rowtype;
  stored_source book_content_sources%rowtype; stored_release book_content_edition_releases%rowtype;
  expected bigint; current_revision bigint; selection_revision bigint;
  source_record jsonb; reference jsonb; member jsonb; payload jsonb; result jsonb;
  asset_id uuid; next_number bigint; required_components text[]; book_slug text;
begin
  if not exists(select 1 from builder_users where id=actor and status='active' and role='developer') then
    return jsonb_build_object('outcome','unauthorized_actor');
  end if;
  if mutation_id is null or jsonb_typeof(request) is distinct from 'object' then
    return jsonb_build_object('outcome','edition_request_invalid'); end if;
  book_slug := request->>'bookSlug';
  required_components := builder_content_edition_components_v1(book_slug);
  if cardinality(required_components)=0 then return jsonb_build_object('outcome','edition_book_unavailable'); end if;
  operation := request->>'operation'; edition := request->>'editionId';
  if edition is null or edition not in ('international','greek') then return jsonb_build_object('outcome','content_edition_unavailable'); end if;
  select id into package_id from book_packages where slug=book_slug;
  if package_id is null then return jsonb_build_object('outcome','edition_book_unavailable'); end if;
  -- A package-wide lock serializes shared-source writes with both edition
  -- candidate captures; head revisions themselves remain edition-scoped.
  perform pg_advisory_xact_lock(hashtextextended('content-editions:'||package_id::text,0));
  requested_hash := builder_publication_json_sha256(request);
  select * into replay from book_content_edition_mutations where client_mutation_id=mutation_id;
  if found then
    if replay.actor_id is distinct from actor or replay.request_sha256 is distinct from requested_hash then return jsonb_build_object('outcome','mutation_id_conflict'); end if;
    return replay.result || '{"replayed":true}'::jsonb;
  end if;
  if jsonb_typeof(request->'expectedRevision') is distinct from 'number'
    or not coalesce(request->>'expectedRevision' ~ '^(0|[1-9][0-9]{0,15})$',false) then
    return jsonb_build_object('outcome','edition_revision_invalid'); end if;
  expected := (request->>'expectedRevision')::bigint;
  if expected>9007199254740991 then return jsonb_build_object('outcome','edition_revision_invalid'); end if;
  if expected is null or expected<0 then return jsonb_build_object('outcome','edition_revision_invalid'); end if;
  if operation in ('save-source','associate') then
    select id into component_id from book_components where book_package_id=package_id and slug=request->>'componentSlug' and slug=any(required_components);
    if component_id is null then return jsonb_build_object('outcome','edition_component_mismatch'); end if;
    source_id := (request->>'sourceId')::uuid;
    select * into stored_source from book_content_sources where id=source_id;
    if found and (stored_source.book_package_id is distinct from package_id or stored_source.book_component_id is distinct from component_id
      or not (stored_source.scope->'editionIds' ? edition)) then return jsonb_build_object('outcome','edition_source_owner_mismatch'); end if;
  end if;
  if operation='save-source' then
    source_record := request->'record'; reference := source_record->'reference';
    if reference->>'bookSlug' is distinct from book_slug or reference->>'componentSlug' is distinct from request->>'componentSlug'
      or reference->>'sourceId' is distinct from source_id::text or not coalesce(reference->'scope'->'editionIds' ? edition,false)
      or reference->>'schemaVersion' is distinct from 'content-source.v1'
      or reference->'scope' not in ('{"kind":"shared","editionIds":["international","greek"]}'::jsonb,
        '{"kind":"edition","editionIds":["international"]}'::jsonb,'{"kind":"edition","editionIds":["greek"]}'::jsonb)
      or (reference-'sha256') is distinct from ((source_record->'source')-'inputs')
      or reference->>'sha256' is distinct from builder_publication_json_sha256(jsonb_build_object('namespace','content-source.v1','value',source_record->'source'))
      then return jsonb_build_object('outcome','edition_source_invalid'); end if;
    current_revision:=coalesce(stored_source.revision,0);
    if expected is distinct from current_revision or (reference->>'revision')::bigint is distinct from current_revision+1 then return jsonb_build_object('outcome','revision_conflict','revision',current_revision); end if;
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
        or exists(select 1 from book_content_source_asset_owners owner where owner.book_asset_id=asset_id and owner.source_id is distinct from source_id)
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
    if expected is distinct from coalesce(selection_revision,0) then return jsonb_build_object('outcome','revision_conflict','revision',coalesce(selection_revision,0)); end if;
    insert into book_content_edition_selections values(package_id,edition,coalesce(selection_revision,0)+1)
      on conflict(book_package_id,edition_id) do update set revision=excluded.revision;
    insert into book_content_edition_sources values(package_id,edition,component_id,source_id)
      on conflict(book_package_id,edition_id,book_component_id) do update set source_id=excluded.source_id;
    result:=jsonb_build_object('outcome','associated','revision',coalesce(selection_revision,0)+1);
  elsif operation='prepare' then
    payload:=request->'release';
    if jsonb_typeof(payload) is distinct from 'object' or jsonb_typeof(payload->'members') is distinct from 'array'
      or jsonb_typeof(payload->'composition'->'members') is distinct from 'array'
      or not coalesce(payload->>'id' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',false) then
      return jsonb_build_object('outcome','edition_release_invalid'); end if;
    select coalesce(max(release_number),0)+1 into next_number from book_content_edition_releases where book_package_id=package_id and edition_id=edition;
    select revision into selection_revision from book_content_edition_selections where book_package_id=package_id and edition_id=edition;
    if expected is distinct from coalesce(selection_revision,0) or (payload->>'number')::bigint is distinct from next_number then return jsonb_build_object('outcome','revision_conflict'); end if;
    if payload->>'schemaVersion' is distinct from 'edition-release.v1' or payload->>'compilerId' is distinct from (book_slug||'-edition-composition-v1')
      or payload->'composition'->'edition' is distinct from jsonb_build_object('schemaVersion','content-edition.v1','bookSlug',book_slug,'editionId',edition)
      or jsonb_array_length(payload->'members') is distinct from cardinality(required_components) or jsonb_array_length(payload->'composition'->'members') is distinct from cardinality(required_components)
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
    if array(select value->>'componentSlug' from jsonb_array_elements(payload->'composition'->'members')) is distinct from required_components
      or payload->'composition'->'members' is distinct from (select jsonb_agg(value->'reference') from jsonb_array_elements(payload->'members'))
      then return jsonb_build_object('outcome','edition_required_sources_missing'); end if;
    insert into book_content_edition_releases values((payload->>'id')::uuid,package_id,edition,next_number,payload,payload->>'releaseSha256',actor,now());
    insert into book_content_edition_release_sources select (payload->>'id')::uuid,(value->'reference'->>'sourceId')::uuid,(value->'reference'->>'revision')::bigint from jsonb_array_elements(payload->'members');
    result:=jsonb_build_object('outcome','prepared','releaseId',payload->>'id','number',next_number);
  elsif operation='publish' then
    select * into stored_release from book_content_edition_releases where id=(request->>'releaseId')::uuid and book_package_id=package_id and edition_id=edition;
    if not found then return jsonb_build_object('outcome','edition_release_context_mismatch'); end if;
    select revision into current_revision from book_content_edition_heads where book_package_id=package_id and edition_id=edition;
    if expected is distinct from coalesce(current_revision,0) then return jsonb_build_object('outcome','revision_conflict','revision',coalesce(current_revision,0)); end if;
    insert into book_content_edition_heads values(package_id,edition,stored_release.id,coalesce(current_revision,0)+1)
      on conflict(book_package_id,edition_id) do update set release_id=excluded.release_id,revision=excluded.revision;
    insert into book_content_edition_publications(release_id) values(stored_release.id) on conflict do nothing;
    result:=jsonb_build_object('outcome','published','releaseId',stored_release.id,'revision',coalesce(current_revision,0)+1);
  else return jsonb_build_object('outcome','edition_operation_invalid');
  end if;
  insert into book_content_edition_mutations values(mutation_id,actor,requested_hash,result,now());
  return result;
end $$;

create or replace function mutate_builder_wordlist(actor uuid, mutation uuid, req jsonb) returns jsonb language plpgsql as $$
declare
  package_id uuid; component_id uuid; target book_content_sources; src book_wordlist_sources;
  session book_wordlist_sessions; prior book_wordlist_mutations; result jsonb; record jsonb; item jsonb;
  required_components text[]; target_record jsonb; expected bigint; current_head bigint; release_record book_wordlist_edition_releases;
begin
  if not exists(select 1 from builder_users where id=actor and status='active' and role='developer') then
    return jsonb_build_object('outcome','wordlist_actor_denied'); end if;
  if mutation is null or jsonb_typeof(req) is distinct from 'object' then
    return jsonb_build_object('outcome','wordlist_context_invalid'); end if;
  required_components := builder_content_edition_components_v1(req->>'bookSlug');
  select id into package_id from book_packages where slug=req->>'bookSlug';
  if package_id is null or cardinality(required_components)=0 or req->>'editionId' is null or req->>'editionId' not in ('international','greek') then
    return jsonb_build_object('outcome','wordlist_context_invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended('content-editions:'||package_id::text,0));
  select * into prior from book_wordlist_mutations where id=mutation;
  if found then
    if prior.actor_id is distinct from actor or prior.request is distinct from req then return jsonb_build_object('outcome','mutation_id_conflict'); end if;
    return prior.result||'{"replayed":true}'::jsonb;
  end if;
  if req->>'operation' in ('begin','prepare','publish') then
    if jsonb_typeof(req->'expectedRevision') is distinct from 'number'
      or not coalesce(req->>'expectedRevision' ~ '^(0|[1-9][0-9]{0,15})$',false) then
      return jsonb_build_object('outcome','wordlist_revision_invalid'); end if;
    if (req->>'expectedRevision')::bigint>9007199254740991 then
      return jsonb_build_object('outcome','wordlist_revision_invalid'); end if;
  end if;
  if req->>'operation' in ('begin','bind','finalize','cancel') then
    select id into component_id from book_components where book_package_id=package_id and slug=req->>'componentSlug'
      and slug in ((req->>'bookSlug')||'-students-book',(req->>'bookSlug')||'-workbook');
    select * into target from book_content_sources where id=(req->>'targetSourceId')::uuid
      and book_package_id=package_id and book_component_id=component_id and scope->'editionIds' ? (req->>'editionId');
    if target.id is null then return jsonb_build_object('outcome','wordlist_source_owner'); end if;
    select r.record into target_record from book_content_source_revisions r where r.source_id=target.id and r.revision=target.revision;
    select * into src from book_wordlist_sources where id=(req->>'sourceId')::uuid;
    if src.id is not null and src.target_source_id is distinct from target.id then return jsonb_build_object('outcome','wordlist_source_owner'); end if;
    if req->>'operation'='begin' then
      if jsonb_typeof(req->'dataset') is distinct from 'object'
        or jsonb_typeof(req->'mappings') is distinct from 'array'
        or jsonb_typeof(req->'requiredAudio') is distinct from 'array' then
        return jsonb_build_object('outcome','wordlist_dataset_context'); end if;
      expected=(req->>'expectedRevision')::bigint;
      if coalesce(src.revision,0) is distinct from expected then return jsonb_build_object('outcome','revision_conflict'); end if;
      if req->'targetSource' is distinct from target_record->'reference' then return jsonb_build_object('outcome','wordlist_target_source_changed'); end if;
      if req->'dataset'->>'bookSlug' is distinct from req->>'bookSlug' or (src.id is not null and src.dataset_key is distinct from req->'dataset'->>'datasetKey') then
        return jsonb_build_object('outcome','wordlist_dataset_context'); end if;
      if src.id is null then
        if exists(select 1 from book_wordlist_sources where target_source_id=target.id and dataset_key=req->'dataset'->>'datasetKey') then
          return jsonb_build_object('outcome','wordlist_source_exists'); end if;
        insert into book_wordlist_sources(id,target_source_id,dataset_key) values((req->>'sourceId')::uuid,target.id,req->'dataset'->>'datasetKey');
      end if;
      if (select count(*) from book_wordlist_sessions where actor_id=actor and state='staging' and expires_at>now())>=8 then
        return jsonb_build_object('outcome','wordlist_session_limit'); end if;
      insert into book_wordlist_sessions(id,actor_id,source_id,request) values(mutation,actor,(req->>'sourceId')::uuid,req);
      result=jsonb_build_object('outcome','staging','sessionId',mutation);
    else
      select * into session from book_wordlist_sessions where id=(req->>'sessionId')::uuid and actor_id=actor
        and source_id=src.id and request->>'editionId'=req->>'editionId' and request->>'componentSlug'=req->>'componentSlug';
      if session.id is null or session.state is distinct from 'staging' or session.expires_at<now() then return jsonb_build_object('outcome','wordlist_session_unavailable'); end if;
      if req->>'operation'='cancel' then
        update book_wordlist_sessions set state='cancelled' where id=session.id;
        result=jsonb_build_object('outcome','cancelled');
      elsif req->>'operation'='bind' then
        item=req->'binding';
        if item->>'sourceId' is distinct from src.id::text or item->>'componentSlug' is distinct from req->>'componentSlug' or item->>'bookSlug' is distinct from req->>'bookSlug'
          or item->>'role' is distinct from 'wordlist_audio' or item->>'mediaType' is distinct from 'audio/mpeg'
          or item->>'objectKey' is distinct from 'builder-wordlist-audio/'||(req->>'bookSlug')||'/'||(req->>'componentSlug')||'/'||src.id::text||'/'||(item->>'sha256')||'.mp3'
          or not exists(select 1 from jsonb_array_elements(session.request->'requiredAudio') a
            where a->>'sha256'=item->>'sha256' and a->>'path'=item->>'path' and a->'byteSize'=item->'byteSize') then
          return jsonb_build_object('outcome','wordlist_audio_owner'); end if;
        select binding into record from book_wordlist_audio where source_id=src.id and sha256=item->>'sha256';
        if record is not null and record is distinct from item then return jsonb_build_object('outcome','wordlist_binding_conflict'); end if;
        insert into book_wordlist_audio(id,source_id,sha256,binding) values((item->>'assetId')::uuid,src.id,item->>'sha256',item) on conflict(source_id,sha256) do nothing;
        result=jsonb_build_object('outcome','bound');
      else
        record=req->'record'; expected=(session.request->>'expectedRevision')::bigint;
        if record->>'schemaVersion' is distinct from 'wordlist-source.v1'
          or jsonb_typeof(record->'bindings') is distinct from 'array'
          or record->>'sha256' is distinct from builder_publication_json_sha256(record-'sha256') then
          return jsonb_build_object('outcome','wordlist_session_conflict'); end if;
        if src.revision is distinct from expected then return jsonb_build_object('outcome','revision_conflict'); end if;
        if record->'targetSource' is distinct from target_record->'reference' or record->'targetSource' is distinct from session.request->'targetSource' then
          return jsonb_build_object('outcome','wordlist_target_source_changed'); end if;
        if record->'dataset' is distinct from session.request->'dataset' or record->'mappings' is distinct from session.request->'mappings'
          or (record->>'revision')::bigint is distinct from expected+1 or record->>'sourceId' is distinct from src.id::text then
          return jsonb_build_object('outcome','wordlist_session_conflict'); end if;
        if jsonb_array_length(record->'bindings') is distinct from jsonb_array_length(session.request->'requiredAudio')
          or exists(select 1 from jsonb_array_elements(record->'bindings') b where not exists(
            select 1 from book_wordlist_audio a where a.source_id=src.id and a.binding=b)) then
          return jsonb_build_object('outcome','wordlist_audio_missing'); end if;
        if expected>0 then
          select r.record into item from book_wordlist_revisions r where r.source_id=src.id and r.revision=expected;
          if exists(select 1 from jsonb_array_elements(item->'dataset'->'entries') old_entry where not exists(
            select 1 from jsonb_array_elements(record->'dataset'->'entries') new_entry where new_entry->>'id'=old_entry->>'id')) then
            return jsonb_build_object('outcome','wordlist_omitted_entries_conflict'); end if;
          if (item-array['sha256','revision','mappingRevision'])=(record-array['sha256','revision','mappingRevision']) then
            update book_wordlist_sessions set state='complete' where id=session.id;
            result=jsonb_build_object('outcome','unchanged','revision',expected);
          end if;
        end if;
        if result is null then
          insert into book_wordlist_revisions(source_id,revision,record) values(src.id,expected+1,record);
          update book_wordlist_sources set revision=expected+1 where id=src.id;
          update book_wordlist_sessions set state='complete' where id=session.id;
          result=jsonb_build_object('outcome','saved','revision',expected+1);
        end if;
      end if;
    end if;
  elsif req->>'operation'='prepare' then
    record=req->'release';
    if jsonb_typeof(record) is distinct from 'object'
      or jsonb_typeof(record->'content'->'members') is distinct from 'array'
      or jsonb_typeof(record->'wordlists') is distinct from 'array'
      or jsonb_typeof(record->'composition'->'wordlists') is distinct from 'array'
      or not coalesce(record->>'id' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',false)
      or record->'content'->>'id' is distinct from record->>'id'
      or record->'content'->'number' is distinct from record->'number'
      or record->'composition'->>'schemaVersion' is distinct from 'edition-composition.v2'
      or record->'composition'->'edition' is distinct from jsonb_build_object('schemaVersion','content-edition.v1','bookSlug',req->>'bookSlug','editionId',req->>'editionId')
      or record->'content'->>'schemaVersion' is distinct from 'edition-release.v1'
      or record->'content'->>'compilerId' is distinct from ((req->>'bookSlug')||'-edition-composition-v1')
      or record->'content'->'composition'->>'schemaVersion' is distinct from 'edition-composition.v1'
      or record->'content'->'composition'->'edition' is distinct from record->'composition'->'edition'
      or record->'content'->'composition'->'members' is distinct from record->'composition'->'members'
      or record->>'compositionSha256' is distinct from builder_publication_json_sha256(record->'composition')
      or record->>'releaseSha256' is distinct from builder_publication_json_sha256(record-'releaseSha256')
      or record->'content'->>'compositionSha256' is distinct from builder_publication_json_sha256(jsonb_build_object('namespace','edition-composition.v1','value',record->'content'->'composition'))
      or record->'content'->>'releaseSha256' is distinct from builder_publication_json_sha256(jsonb_build_object('namespace','edition-release.v1','value',(record->'content')-'releaseSha256')) then
      return jsonb_build_object('outcome','wordlist_release_context'); end if;
    if record->'composition'->'members' is distinct from (select jsonb_agg(value->'reference') from jsonb_array_elements(record->'content'->'members'))
      or jsonb_array_length(record->'composition'->'wordlists') is distinct from 2 then
      return jsonb_build_object('outcome','wordlist_release_context'); end if;
    if record->>'schemaVersion' is distinct from 'edition-release.v2' or record->'composition'->'edition'->>'bookSlug' is distinct from req->>'bookSlug'
      or record->'composition'->'edition'->>'editionId' is distinct from req->>'editionId'
      or jsonb_array_length(record->'content'->'members') is distinct from cardinality(required_components) or jsonb_array_length(record->'wordlists') is distinct from 2 or record->>'compilerId' is distinct from ((req->>'bookSlug')||'-edition-composition-v2')
      or array(select value->'reference'->>'componentSlug' from jsonb_array_elements(record->'content'->'members')) is distinct from required_components
      or array(select value->'targetSource'->>'componentSlug' from jsonb_array_elements(record->'wordlists')) is distinct from required_components[1:2] then
      return jsonb_build_object('outcome','wordlist_release_context'); end if;
    if coalesce((select revision from book_content_edition_selections where book_package_id=package_id and edition_id=req->>'editionId'),0)
       is distinct from (req->>'expectedRevision')::bigint then return jsonb_build_object('outcome','revision_conflict'); end if;
    for item in select * from jsonb_array_elements(record->'content'->'members') loop
      if not exists(select 1 from book_content_edition_sources a join book_content_sources s on s.id=a.source_id
        join book_content_source_revisions r on r.source_id=s.id and r.revision=s.revision
        where a.book_package_id=package_id and a.edition_id=req->>'editionId' and r.record=item) then
        return jsonb_build_object('outcome','wordlist_target_source_changed'); end if;
    end loop;
    for item in select * from jsonb_array_elements(record->'wordlists') loop
      if not exists(select 1 from jsonb_array_elements(record->'content'->'members') m where m->'reference'=item->'targetSource')
        or not exists(select 1 from jsonb_array_elements(record->'composition'->'wordlists') w
          where w->>'sourceId'=item->>'sourceId' and w->'revision'=item->'revision' and w->'mappingRevision'=item->'mappingRevision' and w->'sha256'=item->'sha256') then
        return jsonb_build_object('outcome','wordlist_target_source_changed'); end if;
      if not exists(select 1 from book_wordlist_sources s join book_wordlist_revisions r on r.source_id=s.id and r.revision=s.revision
        where s.id=(item->>'sourceId')::uuid and r.record=item) then return jsonb_build_object('outcome','revision_conflict'); end if;
    end loop;
    select coalesce(max(release_number),0)+1 into expected from book_wordlist_edition_releases where book_package_id=package_id and edition_id=req->>'editionId';
    if expected is distinct from (record->>'number')::bigint then return jsonb_build_object('outcome','revision_conflict'); end if;
    insert into book_wordlist_edition_releases(id,book_package_id,edition_id,release_number,payload)
      values((record->>'id')::uuid,package_id,req->>'editionId',expected,record);
    result=jsonb_build_object('outcome','prepared','releaseId',record->>'id');
  elsif req->>'operation'='publish' then
    select * into release_record from book_wordlist_edition_releases where id=(req->>'releaseId')::uuid
      and book_package_id=package_id and edition_id=req->>'editionId';
    if release_record.id is null then return jsonb_build_object('outcome','wordlist_release_context'); end if;
    select revision into current_head from book_wordlist_edition_heads where book_package_id=package_id and edition_id=req->>'editionId';
    if coalesce(current_head,0) is distinct from (req->>'expectedRevision')::bigint then return jsonb_build_object('outcome','revision_conflict'); end if;
    insert into book_wordlist_edition_heads values(package_id,req->>'editionId',release_record.id,coalesce(current_head,0)+1)
      on conflict(book_package_id,edition_id) do update set release_id=excluded.release_id,revision=excluded.revision;
    insert into book_wordlist_edition_publications values(release_record.id) on conflict do nothing;
    result=jsonb_build_object('outcome','published','releaseId',release_record.id);
  else return jsonb_build_object('outcome','wordlist_operation_invalid'); end if;
  insert into book_wordlist_mutations values(mutation,actor,req,result);
  return result;
end $$;
