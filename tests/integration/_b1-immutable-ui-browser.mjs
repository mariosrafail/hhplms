import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { publishedManagedUiFixture } from "../fixtures/published-managed-ui.js";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";

export async function changeBrowserUiDraft(pool, actor, book, media, variant) {
  const slug = `${book}-students-book`, fixture = await publishedManagedUiFixture(slug, variant);
  for (const [key, bytes] of fixture.objects) media.set(key, bytes);
  const revision = (await pool.query("select revision from builder_component_documents where book_component_id=(select id from book_components where slug=$1) and document_type='teacher_ui' and document_key='default'", [slug])).rows[0].revision;
  const saved = (await pool.query("select outcome from save_builder_component_document($1,$2,'teacher_ui','default','1.0',$3,$4::jsonb,$5,$6,$7)", [book, slug, revision, JSON.stringify(fixture.payload), builderDocumentSha256(fixture.payload), actor, randomUUID()])).rows[0];
  assert.equal(saved.outcome, "saved");
}

export async function verifyFrozenBrowserUi(frame, frozen, book, media) {
  const ui = frozen.teacher_projection.ui, background = ui.assets["background.main"], sound = ui.assets["sound.correct"];
  await expect.poll(async () => frame.locator('.teacher-offline-book').evaluate((node) => node.style.getPropertyValue('--legacy-classroom-background')).then((value) => value.includes(background.sha256) && value.includes(frozen.id))).toBe(true);
  const audioUrls = await frame.locator('body').evaluate(() => window.__immutableUiAudioUrls || []);
  const matches = audioUrls.filter((value) => value.includes(`${sound.sha256}.${sound.extension}`));
  for (const id of ["button", "correct", "incorrect", "page-turn"]) {
    const asset = ui.assets[`sound.${id}`];
    assert.ok(audioUrls.some((value) => value.includes(`${asset.sha256}.${asset.extension}`) && value.includes(frozen.id)), "Each distinct classroom sound resolves from the frozen UI-owner member");
  }
  const soundUrl = new URL(matches[0], 'https://hhplms-viewer.netlify.app');
  assert.ok(soundUrl.pathname.includes(`${book}-students-book`) && soundUrl.pathname.includes(frozen.id));
  assert.ok(soundUrl.searchParams.get('previewAuthorization'), "Release audio has scoped transient authorization");
  const received = await frame.locator('body').evaluate(async (_node, url) => {
    const response = await fetch(url, { credentials: 'omit' });
    return { status: response.status, mime: response.headers.get('content-type'), bytes: [...new Uint8Array(await response.arrayBuffer())] };
  }, matches[0]);
  assert.equal(received.status, 200); assert.equal(received.mime, sound.mediaType);
  assert.equal(createHash('sha256').update(Buffer.from(received.bytes)).digest('hex'), sound.sha256);
  assert.ok([...media.values()].some((bytes) => Buffer.from(bytes).equals(Buffer.from(received.bytes))));
  const statuses = await frame.locator('body').evaluate(async (_node, value) => {
    const missing = new URL(value, location.href); missing.searchParams.delete('previewAuthorization');
    const wrong = new URL(value, location.href); wrong.searchParams.set('previewAuthorization', 'invalid-synthetic-grant');
    return Promise.all([missing, wrong].map(async (url) => (await fetch(url, { credentials: 'omit' })).status));
  }, matches[0]);
  assert.ok(statuses.every((status) => [401, 403].includes(status)), "Release UI assets reject absent or invalid scoped grants");
}
