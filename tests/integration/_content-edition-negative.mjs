import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { freezeEditionSource } from "../../netlify-sites/ultimate-b2-builder/server/_builder-edition-domain.js";
import { mutateEdition, loadEditionStatus, editionUserAllowed } from "../../netlify-sites/ultimate-b2-builder/server/_builder-edition-store.js";
import { validateEditionSourceAssets } from "../../netlify-sites/ultimate-b2-builder/server/_builder-edition-assets.js";
import { readPublishedEdition } from "../../netlify/functions/_book-content/edition-read.js";

export async function editionNegativePersistence({ pool, sql, actor, packageId, sources, releases, saveRequest }) {
  const internationalBefore = (await loadEditionStatus(sql, "ultimate-b2", "international")).sources;
  const edits = ["Greek revision A", "Greek revision B"].map((label) => {
    const source = structuredClone(sources[3].source);
    source.revision++; source.inputs.pages.rows[0].label = label;
    return freezeEditionSource(source);
  });
  const outcomes = await Promise.all(edits.map((record) => mutateEdition(sql, actor, randomUUID(), saveRequest(record))));
  assert.deepEqual(outcomes.map(({ outcome }) => outcome).sort(), ["revision_conflict", "saved"]);
  assert.deepEqual((await loadEditionStatus(sql, "ultimate-b2", "international")).sources, internationalBefore);
  const duplicate = structuredClone(sources[1].source); duplicate.sourceId = randomUUID();
  assert.equal((await mutateEdition(sql, actor, randomUUID(), saveRequest(freezeEditionSource(duplicate)))).outcome, "edition_asset_owner_mismatch");
  const forged = structuredClone(sources[1]); forged.source.inputs.pages.rows[0].storage_bucket = "foreign-bucket";
  await assert.rejects(validateEditionSourceAssets(sql, forged), { code: "edition_asset_context_mismatch" });
  forged.source.inputs.pages.rows[0] = structuredClone(sources[3].source.inputs.pages.rows[0]);
  await assert.rejects(validateEditionSourceAssets(sql, forged), { code: "edition_asset_owner_mismatch" });
  await assert.rejects(pool.query("update book_assets set storage_bucket='foreign' where id=$1", [sources[1].source.inputs.pages.rows[0].asset_id]), /edition_source_asset_immutable/);
  const school = (await pool.query("insert into schools(name) values('Edition isolated school') returning id")).rows[0].id;
  const foreignSchool = (await pool.query("insert into schools(name) values('Other isolated school') returning id")).rows[0].id;
  const users = [];
  for (const role of ["teacher", "student"]) {
    const user = (await pool.query("insert into app_users(school_id,full_name,email,role,status,password_hash,auth_provider) values($1,$2,$3,$2,'active','unused','password') returning *", [school, role, `${role}@editions.example.test`])).rows[0];
    users.push(user);
    await pool.query("insert into book_access(user_id,book_package_id,role_scope) values($1,$2,$3)", [user.id, packageId, role]);
    const query = { bookSlug: "ultimate-b2", editionId: "greek", releaseId: releases.greek.id };
    assert.equal((await readPublishedEdition(sql, user, query)).statusCode, 403);
    await pool.query("insert into book_content_edition_access values($1,$2,$3,'greek')", [school, user.id, packageId]);
    assert.equal((await readPublishedEdition(sql, user, query)).statusCode, 200);
    assert.equal(await editionUserAllowed(sql, { ...user, school_id: foreignSchool }, query), false);
    assert.equal((await readPublishedEdition(sql, user, { ...query, editionId: "international", releaseId: releases.international.id })).statusCode, 403);
    assert.equal((await readPublishedEdition(sql, user, { ...query, releaseId: releases.international.id })).statusCode, 404);
    const activityId = Object.keys(releases.greek.members[1].content.teacherProjection.nativeActivities)[0];
    const answer = await readPublishedEdition(sql, user, { ...query, componentSlug: "ultimate-b2-workbook", teacherActivityId: activityId });
    assert.equal(answer.statusCode, role === "teacher" ? 200 : 403);
    if (role === "teacher") assert.match(answer.body, /PUBLISHED_BOOK_PRIVATE_TEACHER_SENTINEL/);
  }
  await pool.query("delete from book_access where user_id=$1", [users[0].id]);
  assert.equal((await readPublishedEdition(sql, users[0], { bookSlug: "ultimate-b2", editionId: "greek", releaseId: releases.greek.id })).statusCode, 403);
}
