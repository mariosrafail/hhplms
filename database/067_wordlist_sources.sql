-- Dedicated lexical revisions and component-owned pronunciation bindings.
-- No legacy authoring tables, edition-v1 tables or assignments are rewritten.
create table book_wordlist_sources (
  id uuid primary key, target_source_id uuid not null references book_content_sources(id),
  dataset_key text not null, revision bigint not null default 0 check(revision>=0),
  unique(target_source_id,dataset_key)
);
create table book_wordlist_revisions (
  source_id uuid not null references book_wordlist_sources(id), revision bigint not null check(revision>0),
  record jsonb not null, primary key(source_id,revision)
);
create table book_wordlist_audio (
  id uuid primary key, source_id uuid not null references book_wordlist_sources(id),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), binding jsonb not null,
  unique(source_id,sha256)
);
create table book_wordlist_sessions (
  id uuid primary key, actor_id uuid not null references builder_users(id),
  source_id uuid not null references book_wordlist_sources(id), request jsonb not null,
  state text not null default 'staging' check(state in ('staging','cancelled','complete')),
  expires_at timestamptz not null default now()+interval '24 hours'
);
create table book_wordlist_mutations (
  id uuid primary key, actor_id uuid not null references builder_users(id), request jsonb not null, result jsonb not null
);
create table book_wordlist_edition_releases (
  id uuid primary key, book_package_id uuid not null references book_packages(id), edition_id text not null,
  release_number bigint not null, payload jsonb not null,
  unique(book_package_id,edition_id,release_number), unique(id,book_package_id,edition_id)
);
create table book_wordlist_edition_heads (
  book_package_id uuid not null, edition_id text not null, release_id uuid not null, revision bigint not null,
  primary key(book_package_id,edition_id),
  foreign key(release_id,book_package_id,edition_id) references book_wordlist_edition_releases(id,book_package_id,edition_id)
);
create table book_wordlist_edition_publications (release_id uuid primary key references book_wordlist_edition_releases(id));
create trigger wordlist_revision_immutable before update or delete on book_wordlist_revisions for each row execute function prevent_content_edition_immutable_change();
create trigger wordlist_audio_immutable before update or delete on book_wordlist_audio for each row execute function prevent_content_edition_immutable_change();
create trigger wordlist_release_immutable before update or delete on book_wordlist_edition_releases for each row execute function prevent_content_edition_immutable_change();
create trigger wordlist_publication_immutable before update or delete on book_wordlist_edition_publications for each row execute function prevent_content_edition_immutable_change();
create trigger wordlist_mutation_immutable before update or delete on book_wordlist_mutations for each row execute function prevent_content_edition_immutable_change();
create function protect_wordlist_identity() returns trigger language plpgsql as $$
begin
  if new.id<>old.id or new.target_source_id<>old.target_source_id or new.dataset_key<>old.dataset_key
    or new.revision<>old.revision+1 then raise exception 'wordlist_source_identity_immutable'; end if;
  return new;
end $$;
create trigger wordlist_source_identity before update on book_wordlist_sources for each row execute function protect_wordlist_identity();

create function mutate_builder_wordlist(actor uuid, mutation uuid, req jsonb) returns jsonb language plpgsql as $$
declare
  package_id uuid; component_id uuid; target book_content_sources; src book_wordlist_sources;
  session book_wordlist_sessions; prior book_wordlist_mutations; result jsonb; record jsonb; item jsonb;
  target_record jsonb; expected bigint; current_head bigint; release_record book_wordlist_edition_releases;
begin
  if not exists(select 1 from builder_users where id=actor and status='active' and role='developer') then
    return jsonb_build_object('outcome','wordlist_actor_denied'); end if;
  select id into package_id from book_packages where slug=req->>'bookSlug';
  if package_id is null or req->>'editionId' not in ('international','greek') then
    return jsonb_build_object('outcome','wordlist_context_invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended('content-editions:'||package_id::text,0));
  select * into prior from book_wordlist_mutations where id=mutation;
  if found then
    if prior.actor_id<>actor or prior.request<>req then return jsonb_build_object('outcome','mutation_id_conflict'); end if;
    return prior.result||'{"replayed":true}'::jsonb;
  end if;
  if req->>'operation' in ('begin','bind','finalize','cancel') then
    select id into component_id from book_components where book_package_id=package_id and slug=req->>'componentSlug'
      and slug in ((req->>'bookSlug')||'-students-book',(req->>'bookSlug')||'-workbook');
    select * into target from book_content_sources where id=(req->>'targetSourceId')::uuid
      and book_package_id=package_id and book_component_id=component_id and scope->'editionIds' ? (req->>'editionId');
    if target.id is null then return jsonb_build_object('outcome','wordlist_source_owner'); end if;
    select r.record into target_record from book_content_source_revisions r where r.source_id=target.id and r.revision=target.revision;
    select * into src from book_wordlist_sources where id=(req->>'sourceId')::uuid;
    if src.id is not null and src.target_source_id<>target.id then return jsonb_build_object('outcome','wordlist_source_owner'); end if;
    if req->>'operation'='begin' then
      expected=(req->>'expectedRevision')::bigint;
      if coalesce(src.revision,0)<>expected then return jsonb_build_object('outcome','revision_conflict'); end if;
      if req->'targetSource'<>target_record->'reference' then return jsonb_build_object('outcome','wordlist_target_source_changed'); end if;
      if req->'dataset'->>'bookSlug'<>req->>'bookSlug' or (src.id is not null and src.dataset_key<>req->'dataset'->>'datasetKey') then
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
      if session.id is null or session.state<>'staging' or session.expires_at<now() then return jsonb_build_object('outcome','wordlist_session_unavailable'); end if;
      if req->>'operation'='cancel' then
        update book_wordlist_sessions set state='cancelled' where id=session.id;
        result=jsonb_build_object('outcome','cancelled');
      elsif req->>'operation'='bind' then
        item=req->'binding';
        if item->>'sourceId'<>src.id::text or item->>'componentSlug'<>req->>'componentSlug' or item->>'bookSlug'<>req->>'bookSlug'
          or item->>'role'<>'wordlist_audio' or item->>'mediaType'<>'audio/mpeg'
          or item->>'objectKey'<>'builder-wordlist-audio/'||(req->>'bookSlug')||'/'||(req->>'componentSlug')||'/'||src.id::text||'/'||(item->>'sha256')||'.mp3'
          or not exists(select 1 from jsonb_array_elements(session.request->'requiredAudio') a
            where a->>'sha256'=item->>'sha256' and a->>'path'=item->>'path' and a->'byteSize'=item->'byteSize') then
          return jsonb_build_object('outcome','wordlist_audio_owner'); end if;
        select binding into record from book_wordlist_audio where source_id=src.id and sha256=item->>'sha256';
        if record is not null and record<>item then return jsonb_build_object('outcome','wordlist_binding_conflict'); end if;
        insert into book_wordlist_audio(id,source_id,sha256,binding) values((item->>'assetId')::uuid,src.id,item->>'sha256',item) on conflict(source_id,sha256) do nothing;
        result=jsonb_build_object('outcome','bound');
      else
        record=req->'record'; expected=(session.request->>'expectedRevision')::bigint;
        if src.revision<>expected then return jsonb_build_object('outcome','revision_conflict'); end if;
        if record->'targetSource'<>target_record->'reference' or record->'targetSource'<>session.request->'targetSource' then
          return jsonb_build_object('outcome','wordlist_target_source_changed'); end if;
        if record->'dataset'<>session.request->'dataset' or record->'mappings'<>session.request->'mappings'
          or (record->>'revision')::bigint<>expected+1 or record->>'sourceId'<>src.id::text then
          return jsonb_build_object('outcome','wordlist_session_conflict'); end if;
        if jsonb_array_length(record->'bindings')<>jsonb_array_length(session.request->'requiredAudio')
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
    if record->>'schemaVersion'<>'edition-release.v2' or record->'composition'->'edition'->>'bookSlug'<>req->>'bookSlug'
      or record->'composition'->'edition'->>'editionId'<>req->>'editionId'
      or jsonb_array_length(record->'content'->'members')<>3 or jsonb_array_length(record->'wordlists')<>2 then
      return jsonb_build_object('outcome','wordlist_release_context'); end if;
    if coalesce((select revision from book_content_edition_selections where book_package_id=package_id and edition_id=req->>'editionId'),0)
      <>(req->>'expectedRevision')::bigint then return jsonb_build_object('outcome','revision_conflict'); end if;
    for item in select * from jsonb_array_elements(record->'content'->'members') loop
      if not exists(select 1 from book_content_edition_sources a join book_content_sources s on s.id=a.source_id
        join book_content_source_revisions r on r.source_id=s.id and r.revision=s.revision
        where a.book_package_id=package_id and a.edition_id=req->>'editionId' and r.record=item) then
        return jsonb_build_object('outcome','wordlist_target_source_changed'); end if;
    end loop;
    for item in select * from jsonb_array_elements(record->'wordlists') loop
      if not exists(select 1 from book_wordlist_sources s join book_wordlist_revisions r on r.source_id=s.id and r.revision=s.revision
        where s.id=(item->>'sourceId')::uuid and r.record=item) then return jsonb_build_object('outcome','revision_conflict'); end if;
    end loop;
    select coalesce(max(release_number),0)+1 into expected from book_wordlist_edition_releases where book_package_id=package_id and edition_id=req->>'editionId';
    if expected<>(record->>'number')::bigint then return jsonb_build_object('outcome','revision_conflict'); end if;
    insert into book_wordlist_edition_releases(id,book_package_id,edition_id,release_number,payload)
      values((record->>'id')::uuid,package_id,req->>'editionId',expected,record);
    result=jsonb_build_object('outcome','prepared','releaseId',record->>'id');
  elsif req->>'operation'='publish' then
    select * into release_record from book_wordlist_edition_releases where id=(req->>'releaseId')::uuid
      and book_package_id=package_id and edition_id=req->>'editionId';
    if release_record.id is null then return jsonb_build_object('outcome','wordlist_release_context'); end if;
    select revision into current_head from book_wordlist_edition_heads where book_package_id=package_id and edition_id=req->>'editionId';
    if coalesce(current_head,0)<>(req->>'expectedRevision')::bigint then return jsonb_build_object('outcome','revision_conflict'); end if;
    insert into book_wordlist_edition_heads values(package_id,req->>'editionId',release_record.id,coalesce(current_head,0)+1)
      on conflict(book_package_id,edition_id) do update set release_id=excluded.release_id,revision=excluded.revision;
    insert into book_wordlist_edition_publications values(release_record.id) on conflict do nothing;
    result=jsonb_build_object('outcome','published','releaseId',release_record.id);
  else return jsonb_build_object('outcome','wordlist_operation_invalid'); end if;
  insert into book_wordlist_mutations values(mutation,actor,req,result);
  return result;
end $$;
