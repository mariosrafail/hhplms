import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { compilePublicationV2Fixture } from "../fixtures/publication-v2.js";
import { hashBuilderToken, builderCookieName } from "../../netlify-sites/ultimate-b2-builder/server/_builder-auth.js";

export function taggedDatabase(executor) {
  const sql = async (strings, ...values) => (await executor.query(strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), values)).rows;
  const transaction = async (key, callback) => {
    const client = await executor.connect();
    try {
      await client.query("begin"); await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
      const result = await callback(taggedDatabase(client)); await client.query("commit"); return result;
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  };
  sql.assignmentLifecycleTransaction = (id, callback) => transaction(`activity-assignment:${id}`, callback);
  sql.homeworkMutationTransaction = (id, callback) => transaction(`homework:${id}`, callback);
  sql.transaction = async (build) => {
    const client = await executor.connect();
    try {
      await client.query("begin");
      const queries = build((strings, ...values) => ({ strings, values }));
      const results = [];
      for (const { strings, values } of queries) results.push(await taggedDatabase(client)(strings, ...values));
      await client.query("commit"); return results;
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  };
  return sql;
}

export async function seedUnificationActors(pool) {
  const teacher = { ...(await pool.query("select id,school_id from app_users where role='teacher' and school_id is not null limit 1")).rows[0], role: "teacher" };
  const student = { ...(await pool.query("select id,school_id from app_users where role='student' and school_id=$1 limit 1", [teacher.school_id])).rows[0], role: "student" };
  await pool.query("update app_users set status='active' where id=$1", [student.id]);
  const component = (await pool.query("select * from book_components where slug='ultimate-b2-students-book'")).rows[0];
  await pool.query("insert into book_access(user_id,book_package_id,role_scope) values($1,$2,'teacher'),($3,$2,'student') on conflict do nothing", [teacher.id, component.book_package_id, student.id]);
  const classId = (await pool.query("insert into classes(school_id,name,slug,teacher_id,book_package_id,status,invite_code) values($1,'Unified Students Book',$2,$3,$4,'active',$5) returning id", [teacher.school_id, `unified-${randomUUID()}`, teacher.id, component.book_package_id, randomBytes(5).toString("hex")])).rows[0].id;
  await pool.query("insert into class_students(class_id,student_id,status) values($1,$2,'active')", [classId, student.id]);
  const actor = randomUUID(); const token = randomBytes(32).toString("base64url");
  await pool.query("insert into builder_users(id,full_name,email,password_hash) values($1,'Disposable Unification Builder',$2,'synthetic-no-login')", [actor, `${actor}@example.test`]);
  await pool.query("insert into builder_sessions(builder_user_id,token_hash,expires_at) values($1,$2,now()+interval '1 hour')", [actor, hashBuilderToken(token)]);
  return { teacher, student, component, classId, actor, builderCookie: `${builderCookieName}=${token}` };
}

// An explicit frozen pre-transition fixture, never reconstructed from today's
// authoring baseline. New publications below use the actual Prepare handler.
export async function insertHistoricalStudentsRelease(pool, { component, actor }) {
  const compiled = compilePublicationV2Fixture({ prompt: "R1 original prompt", teacherAnswer: "R1 protected model answer" });
  const id = randomUUID();
  await pool.query(`insert into book_component_releases(id,book_package_id,book_component_id,release_number,release_schema_version,compiler_id,runtime_compatibility_sha256,source_snapshot,source_snapshot_sha256,public_projection,public_projection_sha256,teacher_projection,teacher_projection_sha256,asset_manifest,release_sha256,request_sha256,client_mutation_id,created_by_builder_user_id)
    values($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16)`, [id, component.book_package_id, component.id, compiled.releaseSchemaVersion, compiled.compilerId, compiled.compatibility, compiled.sourceSnapshot, compiled.sourceSnapshotSha256, compiled.publicProjection, compiled.publicProjectionSha256, compiled.teacherProjection, compiled.teacherProjectionSha256, JSON.stringify(compiled.assetManifest), compiled.releaseSha256, randomUUID(), actor]);
  await pool.query("insert into book_component_publication_events(book_package_id,book_component_id,release_id,expected_head_revision,resulting_head_revision,request_sha256,client_mutation_id,published_by_builder_user_id) values($1,$2,$3,0,1,$4,$5,$6)", [component.book_package_id, component.id, id, compiled.releaseSha256, randomUUID(), actor]);
  await pool.query("insert into book_component_publication_heads(book_package_id,book_component_id,release_id,head_revision,published_by_builder_user_id) values($1,$2,$3,1,$4)", [component.book_package_id, component.id, id, actor]);
  return { id, compiled };
}

export async function syntheticPageStorage(t) {
  const objects = new Map(); const authorizations = new Map();
  const checksum = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const server = createServer(async (request, response) => {
    if (["GET", "HEAD"].includes(request.method)) {
      const path = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const object = path.startsWith("/synthetic-private/") && objects.get(path.slice("/synthetic-private/".length));
      if (!object) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "Content-Type": object.contentType, "Content-Length": object.byteSize, "x-amz-meta-sha256": object.checksumSha256 });
      response.end(request.method === "HEAD" ? undefined : object.bytes); return;
    }
    const authorization = authorizations.get(request.url);
    if (!authorization || request.method !== "PUT") { response.writeHead(403); response.end(); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    objects.set(authorization.objectKey, { bytes, byteSize: bytes.length, contentType: authorization.contentType, checksumSha256: checksum(bytes) });
    authorizations.delete(request.url); response.writeHead(200); response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const storage = {
    bucket(profile) { assert.equal(profile, "private"); return "synthetic-private"; },
    async signedPutUrl({ objectKey, contentType }) {
      const path = `/synthetic-upload/${randomUUID()}`; authorizations.set(path, { objectKey, contentType });
      return { url: `http://127.0.0.1:${server.address().port}${path}`, headers: { "Content-Type": contentType } };
    },
    async upload({ objectKey, body, contentType, checksumSha256, byteSize }) {
      const bytes = Buffer.from(body); assert.equal(bytes.length, byteSize); assert.equal(checksum(bytes), checksumSha256);
      const previous = objects.get(objectKey);
      if (previous) { assert.deepEqual(previous.bytes, bytes); return; }
      objects.set(objectKey, { bytes, byteSize, contentType, checksumSha256 });
    },
    async head({ objectKey }) { const object = objects.get(objectKey); assert(object, "Synthetic object must exist"); return object; },
    async download(input) { return Buffer.from((await storage.head(input)).bytes); },
    async delete({ objectKey }) { assert(objectKey.includes("/staging/"), "Only disposable upload staging objects may be deleted"); objects.delete(objectKey); },
    async openReadStream(input) { const object = await storage.head(input); return { ...object, contentRange: null, body: new Response(object.bytes).body }; },
  };
  return { storage, objects, origin: `http://127.0.0.1:${server.address().port}` };
}
