import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadProductionMigrationManifest } from "./_migration-readiness.mjs";
import { canonicalStudentsBookPages } from "../netlify-sites/ultimate-b2-builder/server/_builder-page-catalog.js";

const root = new URL("../", import.meta.url);
const target = new URL("database/060_students_book_page_expansion.sql", root);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const read = async (file) => (await readFile(new URL(file, root), "utf8")).replaceAll("\r\n", "\n");
const functionSql = (source, name) => {
  const start = source.indexOf(`create or replace function ${name}(`);
  if (start < 0) throw new Error(`Missing baseline function ${name}`);
  const end = source.indexOf("end $$;", start);
  if (end < 0) throw new Error(`Missing baseline function terminator ${name}`);
  return source.slice(start, end + "end $$;".length);
};
const replace = (source, before, after, expectedCount = 1) => {
  if (source.split(before).length - 1 !== expectedCount) throw new Error(`Released function replacement count changed: expected ${expectedCount} for ${before}`);
  return source.replaceAll(before, () => after);
};
const baseline56 = await read("database/056_ultimate_b1_managed_package_shells.sql");
const baseline53 = await read("database/053_builder_page_lifecycle_completion.sql");
const baseline58 = await read("database/058_native_teacher_answer_assets.sql");
const canonicalCondition = "(requested_component_slug='ultimate-b2-students-book' and exists(select 1 from builder_students_book_canonical_pages where page_key=requested_page_key))";
let prepare = functionSql(baseline56, "prepare_builder_component_page_upload");
prepare = replace(prepare, "  if requested_page_metadata ? 'unitId'", `  if requested_component_slug='ultimate-b2-students-book' and (
    requested_page_key is null or requested_mode is null or requested_mode not in ('create','replace')
    or requested_expected_revision is null or requested_expected_revision<0
    or not builder_students_book_page_metadata_valid(requested_page_metadata)
  ) then return query select 'invalid_page_metadata',null::uuid,null::bigint,null::text,null::text; return; end if;
  if requested_page_metadata ? 'unitId'`);
prepare = replace(prepare, "if requested_book_slug='ultimate-b2' and requested_component_slug='ultimate-b2-students-book' and requested_mode<>'replace' then\n    return query select 'operation_not_allowed',null::uuid,revision_row.revision,null::text,null::text; return;\n  end if;", `if requested_book_slug='ultimate-b2' and requested_component_slug='ultimate-b2-students-book' then
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
  end if;`);
let complete = functionSql(baseline53, "complete_builder_component_page_upload");
complete = replace(complete, "student_component:=component_slug='ultimate-b2-students-book';", "student_component:=component_slug='ultimate-b2-students-book' and exists(select 1 from builder_students_book_canonical_pages where page_key=session.page_key);\n  if student_component and exists(select 1 from builder_students_book_canonical_pages where page_key=session.page_key and (width<>requested_width or height<>requested_height)) then raise exception 'canonical page dimensions conflict'; end if;");
complete = replace(complete, "  page_slug:=substring", `  if component_slug='ultimate-b2-students-book' then
    if package_slug is distinct from 'ultimate-b2' or not exists(select 1 from book_components where id=session.book_component_id and book_package_id=session.book_package_id)
      or not builder_students_book_page_metadata_valid(session.page_metadata)
      or requested_mime_type is null or requested_byte_size is null or requested_checksum is null or requested_width is null or requested_height is null
      or (not student_component and session.page_key !~ '^ultimate-b2-students-book/pages/sb-page-[a-f0-9]{32}$') then raise exception 'page upload metadata is invalid'; end if;
  end if;
  page_slug:=substring`);
complete = replace(complete, "  select page_revision.* into revision_row", `  if component_slug='ultimate-b2-students-book' then
    if student_component and requested_unit is not null and not exists(select 1 from units unit join builder_students_book_canonical_pages canonical on canonical.unit_number=unit.unit_number where canonical.page_key=session.page_key and unit.id=requested_unit) then raise exception 'canonical page unit conflict'; end if;
    if not student_component and session.upload_mode='create' and requested_unit is null then raise exception 'page upload unit is invalid'; end if;
  end if;
  select page_revision.* into revision_row`);
complete = replace(complete, "  if page_row.id is null then", `  if component_slug='ultimate-b2-students-book' and not student_component and (
    session.upload_mode='create' and page_row.id is not null
    or session.upload_mode='replace' and (page_row.id is null or coalesce(page_row.source_metadata->>'is_active','false')<>'true')
  ) then raise exception 'page upload identity conflict'; end if;
  if page_row.id is null then`);
complete = replace(complete, "set label=session.page_metadata->>'label',sort_order=(session.page_metadata->>'sortOrder')::int,", `set label=case when student_component and updated_page.source_metadata->>'has_metadata_override'='true' then updated_page.label else session.page_metadata->>'label' end,
      sort_order=case when student_component and updated_page.source_metadata->>'has_metadata_override'='true' then updated_page.sort_order else (session.page_metadata->>'sortOrder')::int end,`);
complete = replace(complete, "'printed_label',coalesce(session.page_metadata->>'printedLabel',''),'original_filename',session.file_descriptor->>'name'),updated_at=now()", "'printed_label',case when student_component and updated_page.source_metadata->>'has_metadata_override'='true' then coalesce(updated_page.source_metadata->>'printed_label','') else coalesce(session.page_metadata->>'printedLabel','') end,'original_filename',session.file_descriptor->>'name'),updated_at=now()");
let mutate = functionSql(baseline53, "mutate_builder_component_page");
mutate = replace(mutate, "requested_component_slug='ultimate-b2-students-book'", canonicalCondition, 4);
mutate = replace(mutate, "  if requested_page_metadata ? 'unitId'", `  if requested_component_slug='ultimate-b2-students-book' and requested_action in ('metadata','reorder') and not builder_students_book_page_metadata_valid(requested_page_metadata) then return query select 'invalid_page_metadata',null::bigint; return; end if;
  if requested_page_metadata ? 'unitId'`);
let remove = functionSql(baseline53, "delete_builder_component_page_lifecycle");
remove = replace(remove, "page_row.id is null and requested_component_slug='ultimate-b2-students-book'", `page_row.id is null and ${canonicalCondition}`);
remove = replace(remove, "requested_component_slug<>'ultimate-b2-students-book' and coalesce", `not ${canonicalCondition} and coalesce`);
remove = replace(remove, "unit_number=(requested_page_metadata->>'unitNumber')::int limit 1", "unit_number=(select canonical.unit_number from builder_students_book_canonical_pages canonical where canonical.page_key=requested_page_key) limit 1");
let restore = functionSql(baseline53, "restore_builder_component_page");
restore = replace(restore, "requested_component_slug<>'ultimate-b2-students-book'", `not ${canonicalCondition}`);
restore = replace(restore, "case when requested_component_slug='ultimate-b2-students-book' then", `case when ${canonicalCondition} then`, 2);
// 058's font pin guard omitted the canonical /assets/ segment. Keep already
// pinned historical paths readable while accepting the uploader's exact key.
let pinGuard = functionSql(baseline58, "validate_builder_release_asset_pin");
pinGuard = replace(pinGuard, "or asset_row.source_metadata->>'font_library_scope'<>'component' or new.object_key<>expected_key", "or asset_row.source_metadata->>'font_library_scope'<>'component' or (new.object_key<>expected_key and new.object_key<>'builder-font-library/'||package_slug||'/'||component_slug||'/assets/'||new.checksum_sha256||'.ttf')");
// Refuse to resurrect an older definition if a later released migration has
// changed one of these functions. Only the new, unreleased 060 is generated.
const baselineMigrations = (await loadProductionMigrationManifest()).filter((entry) => Number(entry.filename.slice(0, 3)) < 60);
for (const [name, expected] of Object.entries({ prepare_builder_component_page_upload: 56, complete_builder_component_page_upload: 53, mutate_builder_component_page: 53, delete_builder_component_page_lifecycle: 53, restore_builder_component_page: 53, validate_builder_release_asset_pin: 58 })) {
  const definitions = baselineMigrations.filter((entry) => new RegExp(`create\\s+or\\s+replace\\s+function\\s+${name}\\s*\\(`, "i").test(entry.sql));
  if (Number(definitions.at(-1)?.filename.slice(0, 3)) !== expected) throw new Error(`Effective baseline definition changed: ${name}`);
}
const unitTitles = new Map(canonicalStudentsBookPages.map((page) => [page.unitNumber, page.unitTitle]));
if (canonicalStudentsBookPages.length !== 110 || unitTitles.size !== 10) throw new Error("Unexpected canonical Students Book topology");
const generated = `-- Generated by scripts/generate-students-book-page-expansion.mjs.
-- Additive current-authoring expansion. No authored page/activity/history rows
-- are rewritten. Historical canonical sources and released migrations are frozen.
-- Transaction owner: canonical migration runner (SQL and history in one commit).
create table if not exists builder_students_book_canonical_pages (
  page_key text primary key,
  unit_number integer not null check(unit_number between 1 and 10),
  width integer not null check(width>0),
  height integer not null check(height>0)
);
do $expansion$
declare component_id uuid; seed record; existing units%rowtype;
begin
  select component.id into strict component_id from book_components component join book_packages package on package.id=component.book_package_id where package.slug='ultimate-b2' and component.slug='ultimate-b2-students-book';
  -- Table-wide lock: blocks Unit writes for ALL components until runner commit.
  lock table units in share row exclusive mode;
  for seed in select * from (values
${[...unitTitles].map(([number, title]) => `    (${number},${quote(title)})`).join(",\n")}
  ) as seeds(number,title) loop
    if (select count(*) from units where book_component_id=component_id and (unit_number=seed.number or slug='unit-'||seed.number))>1 then raise exception 'students_book_unit_identity_conflict: Unit %',seed.number; end if;
    select * into existing from units where book_component_id=component_id and (unit_number=seed.number or slug='unit-'||seed.number);
    if existing.id is not null then
      if existing.unit_number is distinct from seed.number or existing.slug is distinct from 'unit-'||seed.number then raise exception 'students_book_unit_mapping_conflict: Unit %',seed.number; end if;
    else
      insert into units(book_component_id,title,slug,unit_number,sort_order) values(component_id,seed.title,'unit-'||seed.number,seed.number,seed.number);
    end if;
  end loop;
  for seed in select * from (values
${canonicalStudentsBookPages.map((page) => `    (${quote(page.stableKey)},${page.unitNumber},${page.image.width},${page.image.height})`).join(",\n")}
  ) as seeds(page_key,unit_number,width,height) loop
    if exists(select 1 from builder_students_book_canonical_pages page where page.page_key=seed.page_key and (page.unit_number<>seed.unit_number or page.width<>seed.width or page.height<>seed.height)) then raise exception 'students_book_canonical_identity_conflict: %',seed.page_key; end if;
    if not exists(select 1 from builder_students_book_canonical_pages page where page.page_key=seed.page_key) then
      insert into builder_students_book_canonical_pages values(seed.page_key,seed.unit_number,seed.width,seed.height);
    end if;
    if exists(select 1 from book_pages page left join units unit on unit.id=page.unit_id where page.stable_key=seed.page_key and (page.book_component_id is distinct from component_id or page.book_package_id is distinct from (select book_package_id from book_components where id=component_id) or page.unit_id is not null and (unit.book_component_id is distinct from component_id or unit.unit_number is distinct from seed.unit_number))) then raise exception 'students_book_page_unit_conflict: %',seed.page_key; end if;
  end loop;
end $expansion$;

-- Validate before casts; SQL NULL must never bypass a Students Book guard.
create or replace function builder_students_book_page_metadata_valid(metadata jsonb)
returns boolean language sql immutable as $$
  select coalesce(jsonb_typeof(metadata)='object'
    and jsonb_typeof(metadata->'label')='string' and length(metadata->>'label') between 1 and 200
    and jsonb_typeof(metadata->'sortOrder')='number' and (metadata->>'sortOrder') ~ '^-?[0-9]{1,9}$'
    and (not metadata ? 'printedLabel' or jsonb_typeof(metadata->'printedLabel')='string')
    and (not metadata ? 'unitId' or jsonb_typeof(metadata->'unitId')='string'), false)
$$;

${[prepare, complete, mutate, remove, restore, pinGuard].join("\n\n")}
`;
export async function verifyStudentsBookPageExpansion() {
  if (await read("database/060_students_book_page_expansion.sql") !== generated) throw new Error("Students Book page expansion is stale");
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes("--check")) {
    await verifyStudentsBookPageExpansion();
    console.log("Students Book page expansion matches its canonical generator");
  } else await writeFile(target, generated);
}
