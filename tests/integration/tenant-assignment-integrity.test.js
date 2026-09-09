import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { countRelationshipIssues, relationshipChecks } from "../../scripts/_tenant-integrity-checks.mjs";
import { loadPinnedNativeAssignmentTarget } from "../../netlify/functions/_book-content/native-assignment-runtime.js";
import { postgresTemplate, requireSafeDatabase } from "../../scripts/_staging-db.mjs";
import { compilePublicationV2Fixture, publicationV2Fixture } from "../fixtures/publication-v2.js";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";

const enabled = Boolean(process.env.TEST_DATABASE_URL)
  && process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";
const releaseId = "20000000-0000-4000-8000-000000000001";
const absentId = "20000000-0000-4000-8000-000000000099";

test("assignment integrity resolves legacy and immutable published-native relationships", { skip: !enabled }, async (t) => {
  const { connectionString } = requireSafeDatabase("test");
  const schema = `hhplms_test_integrity_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Pool({ connectionString, max: 1 });
  await admin.query(`create schema "${schema}"`);
  const scoped = new URL(connectionString);
  scoped.searchParams.set("options", `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: scoped.toString(), max: 1 });
  let client;
  t.after(async () => {
    client?.release();
    await pool.end();
    await admin.query(`drop schema "${schema}" cascade`);
    await admin.end();
  });
  await applyCanonicalProductionMigrations(pool);
  client = await pool.connect();

  const schoolA = (await client.query("insert into schools(name) values('Integrity A') returning id")).rows[0].id;
  const schoolB = (await client.query("insert into schools(name) values('Integrity B') returning id")).rows[0].id;
  const user = async (school, role, label) => (await client.query(`
    insert into app_users(school_id,full_name,email,password_hash,role,status)
    values($1,$2,$3,'not-a-login-hash',$4,'active') returning id
  `, [school, label, `${label}@integrity.test`, role])).rows[0].id;
  const teacherA = await user(schoolA, "teacher", "teacher-a");
  const teacherB = await user(schoolB, "teacher", "teacher-b");
  const studentA = await user(schoolA, "student", "student-a");
  const studentB = await user(schoolB, "student", "student-b");
  const classRow = async (school, teacher, label) => (await client.query(`
    insert into classes(school_id,teacher_id,name,slug,invite_code,status)
    values($1,$2,$3,$3,$3,'active') returning id
  `, [school, teacher, label])).rows[0].id;
  const classA = await classRow(schoolA, teacherA, "integrity-a");
  const classB = await classRow(schoolB, teacherB, "integrity-b");
  const activity = (await client.query("select id from activities order by id limit 1")).rows[0].id;
  const scope = (await client.query(`
    select p.id package_id,c.id component_id from book_packages p
    join book_components c on c.book_package_id=p.id
    where p.slug='ultimate-b2' and c.slug='ultimate-b2-students-book'
  `)).rows[0];

  // Derive table shapes from real migrations, but omit constraints in these
  // connection-local copies so broken references reach the verifier itself.
  for (const table of ["activity_assignments", "book_component_releases", "book_component_publication_events", "book_component_publication_heads"]) {
    await client.query(`create temp table ${table} as select * from "${schema}".${table} with no data`);
  }
  const compiled = compilePublicationV2Fixture();
  const release = {
    id: releaseId, book_package_id: scope.package_id, book_component_id: scope.component_id,
    release_number: 1, release_schema_version: compiled.releaseSchemaVersion, compiler_id: compiled.compilerId,
    runtime_compatibility_sha256: compiled.compatibility,
    source_snapshot: compiled.sourceSnapshot, source_snapshot_sha256: compiled.sourceSnapshotSha256,
    public_projection: compiled.publicProjection, public_projection_sha256: compiled.publicProjectionSha256,
    teacher_projection: compiled.teacherProjection, teacher_projection_sha256: compiled.teacherProjectionSha256,
    asset_manifest: compiled.assetManifest, release_sha256: compiled.releaseSha256,
  };
  await client.query("insert into book_component_releases select * from jsonb_populate_record(null::book_component_releases,$1::jsonb)", [JSON.stringify(release)]);
  await client.query("insert into book_component_publication_events(book_package_id,book_component_id,release_id) values($1,$2,$3)", [scope.package_id, scope.component_id, releaseId]);
  const legacy = { school_id: schoolA, teacher_id: teacherA, class_id: classA, student_id: null, target_kind: "legacy_activity", activity_id: activity, native_release_id: null, native_activity_id: null };
  const native = { ...legacy, target_kind: "published_native", activity_id: null, native_release_id: releaseId, native_activity_id: publicationV2Fixture.openResponseId };
  const checks = new Map(relationshipChecks);
  const count = (name = "activity_assignments_missing_relationship") => countRelationshipIssues(client, checks.get(name));
  const assign = async (row) => {
    await client.query("truncate pg_temp.activity_assignments");
    await client.query("insert into activity_assignments select * from jsonb_populate_record(null::activity_assignments,$1::jsonb)", [JSON.stringify(row)]);
  };
  const isolated = (name, callback) => t.test(name, async () => {
    await client.query("begin");
    try { await callback(); } finally { await client.query("rollback"); }
  });

  await isolated("valid legacy activity passes", async () => {
    await assign(legacy);
    assert.equal(await count(), 0);
  });
  await isolated("missing legacy activity is detected", async () => {
    for (const activity_id of [null, absentId]) {
      await assign({ ...legacy, activity_id });
      assert.equal(await count(), 1);
    }
  });
  await isolated("valid published-native target passes without a current head or draft", async () => {
    await assign(native);
    assert.ok(await loadPinnedNativeAssignmentTarget(postgresTemplate(client), native));
    assert.equal(await count(), 0);
    await assign({ ...native, class_id: null, student_id: studentA });
    assert.equal(await count(), 0);
  });
  await isolated("missing native release is detected", async () => {
    for (const native_release_id of [null, absentId]) {
      await assign({ ...native, native_release_id });
      assert.equal(await count(), 1);
    }
  });
  await isolated("native identity must exist inside the pinned release", async () => {
    for (const native_activity_id of [null, "missing-native-activity", "INVALID ID"]) {
      await assign({ ...native, native_activity_id });
      assert.equal(await count(), 1);
    }
  });
  await isolated("unpublished release does not resolve", async () => {
    await assign(native);
    await client.query("delete from book_component_publication_events");
    assert.equal(await count(), 1);
  });
  await isolated("release must belong to its package and component", async () => {
    await assign(native);
    await client.query("update book_component_releases set book_component_id=$1", [absentId]);
    assert.equal(await count(), 1);
  });
  await isolated("immutable release hash corruption fails closed", async () => {
    await assign(native);
    await client.query("update book_component_releases set public_projection_sha256=$1", ["0".repeat(64)]);
    await assert.rejects(count(), /release_integrity_failed/);
  });
  await isolated("missing teacher projection entry fails closed", async () => {
    await assign(native);
    await client.query("update book_component_releases set teacher_projection=jsonb_set(teacher_projection,'{nativeActivities}',(teacher_projection->'nativeActivities')-$1::text)", [native.native_activity_id]);
    await assert.rejects(count());
  });
  await isolated("mixed and unknown target kinds are detected", async () => {
    for (const row of [{ ...native, activity_id: activity }, { ...legacy, native_release_id: releaseId }, { ...legacy, target_kind: "unknown" }, { ...legacy, target_kind: null }]) {
      await assign(row);
      assert.equal(await count(), 1);
    }
  });
  for (const [kind, fixture] of [["legacy", legacy], ["published-native", native]]) {
    await isolated(`${kind} keeps missing school, teacher, class and student checks`, async () => {
      for (const field of ["school_id", "teacher_id", "class_id", "student_id"]) {
        await assign({ ...fixture, [field]: absentId });
        assert.equal(await count(), 1, field);
      }
    });
    await isolated(`${kind} keeps all cross-school checks`, async () => {
      for (const [field, value, check] of [
        ["teacher_id", teacherB, "activity_assignments_cross_school_teacher"],
        ["class_id", classB, "activity_assignments_cross_school_class"],
        ["student_id", studentB, "activity_assignments_cross_school_student"],
        ["school_id", schoolB, "activity_assignments_cross_school_teacher"],
      ]) {
        await assign({ ...fixture, ...(field === "student_id" ? { class_id: null } : {}), [field]: value });
        assert.equal(await count(check), 1, field);
      }
    });
    await isolated(`${kind} keeps exclusive class/student targets`, async () => {
      for (const row of [{ ...fixture, class_id: null, student_id: null }, { ...fixture, student_id: studentA }]) {
        await assign(row);
        assert.equal(await count("activity_assignments_invalid_target"), 1);
      }
    });
  }
  await isolated("legacy custom activity cross-school ownership is still detected", async () => {
    await assign(legacy);
    await client.query("update activities set school_id=$1 where id=$2", [schoolB, activity]);
    assert.equal(await count("activity_assignments_cross_school_activity"), 1);
  });
});
