import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { chromium, expect } from '@playwright/test';
import lmsWorker from '../../cloudflare/lms/worker.js';
import { createBuilderWorker } from '../../cloudflare/builder/worker.js';
import { createBuilderAuthHandler } from '../../netlify-sites/ultimate-b2-builder/functions/builder-auth.js';
import { createBuilderPublicationFunction } from '../../netlify-sites/ultimate-b2-builder/functions/builder-publication.js';
import { createBuilderPublicationHandler } from '../../netlify-sites/ultimate-b2-builder/server/_builder-publication.js';
import { createBuilderProductPublicationHandler } from '../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication.js';
import { createBuilderPreviewAuthorizationHandler } from '../../netlify-sites/ultimate-b2-builder/server/_builder-preview-authorization-handler.js';
import { createBuilderPagesHandler } from '../../netlify-sites/ultimate-b2-builder/server/_builder-pages.js';
import { createBuilderNativeActivitiesHandler } from '../../netlify-sites/ultimate-b2-builder/server/_builder-native-activities.js';
import { createBuilderNativePreviewHandler } from '../../netlify-sites/ultimate-b2-builder/server/_builder-native-preview.js';
import { createBuilderContentHandler } from '../../netlify-sites/ultimate-b2-builder/server/_builder-content.js';
import { createBuilderPreviewHandler } from '../../netlify-sites/ultimate-b2-builder/server/_builder-preview.js';
import { hashBuilderToken, builderCookieName } from '../../netlify-sites/ultimate-b2-builder/server/_builder-auth.js';
import { hashToken, sessionCookieName, setSqlForTests } from '../../netlify/functions/_auth-utils.js';
import { changeBrowserUiDraft, verifyFrozenBrowserUi } from './_b1-immutable-ui-browser.mjs';

// Real Workers, authentication, handlers and PostgreSQL. All storage and browser
// traffic are confined to these synthetic fixture servers and bundled assets.
export async function verifyB1PublicationBrowser({ pool, sql, actor, teacher, student, media }) {
  const roots = { lms: resolve('dist'), builder: resolve('dist-netlify/ultimate-b2-builder'), viewer: resolve('dist-netlify/ultimate-b2-interactive') };
  for (const root of Object.values(roots)) await readFile(resolve(root, 'index.html'));
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.json': 'application/json' };
  const staticFetch = (root) => async (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + sep)) return new Response('Not found', { status: 404 });
    try { return new Response(await readFile(file), { headers: { 'Content-Type': mime[extname(file)] || 'application/octet-stream' } }); }
    catch { return new Response('Not found', { status: 404 }); }
  };
  const r2 = {
    async head(key) { const bytes = media.get(key); return bytes ? { size: bytes.length, customMetadata: { sha256: createHash('sha256').update(bytes).digest('hex') }, httpMetadata: { contentType: key.endsWith('.wav') ? 'audio/wav' : 'image/png' } } : null; },
    async get(key) { const bytes = media.get(key); return bytes ? { ...await this.head(key), body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), arrayBuffer: async () => bytes } : null; },
  };
  const dependency = { getDatabase: () => sql };
  const publication = createBuilderPublicationFunction({ componentHandler: createBuilderPublicationHandler(dependency), productHandler: createBuilderProductPublicationHandler(dependency) });
  const builderWorker = createBuilderWorker({ handlers: {
    auth: createBuilderAuthHandler(dependency), content: createBuilderContentHandler(dependency), pages: createBuilderPagesHandler(dependency),
    nativeActivities: createBuilderNativeActivitiesHandler(dependency), nativePreview: createBuilderNativePreviewHandler(dependency),
    preview: createBuilderPreviewHandler(dependency), previewAuthorization: createBuilderPreviewAuthorizationHandler(dependency),
    publication: (event, context) => publication(event, { ...context, cloudflare: { ...context.cloudflare, releaseSourceAssetsBucket: 'private-assets' } }),
  } });
  const previous = {};
  const setEnv = (values) => { for (const [key, value] of Object.entries(values)) { if (!Object.hasOwn(previous, key)) previous[key] = process.env[key]; process.env[key] = value; } };
  setEnv({ BUILDER_PREVIEW_AUTH_SECRET: 'isolated-b1-preview-secret-at-least-thirty-two-bytes' });
  setSqlForTests(sql);
  const errors = [];
  const serve = (fetcher) => createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = new Request(`http://127.0.0.1:${req.socket.localPort}${req.url}`, { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
      const result = await fetcher(request);
      res.writeHead(result.status, Object.fromEntries(result.headers));
      if (result.body) Readable.fromWeb(result.body).pipe(res); else res.end();
    } catch (error) { errors.push(error.message); res.writeHead(500); res.end('Isolated fixture error'); }
  });
  const builderEnv = { ASSETS: { fetch: staticFetch(roots.builder) }, RELEASE_SOURCE_ASSETS: r2, PLAYER_MEDIA: r2 };
  const builder = serve((request) => builderWorker.fetch(request, builderEnv));
  const lms = serve((request) => lmsWorker.fetch(request, { ASSETS: { fetch: staticFetch(roots.lms) } }));
  const objects = serve(async (request) => {
    const key = decodeURIComponent(new URL(request.url).pathname).replace(/^\/private-assets\//, '');
    const bytes = media.get(key);
    return bytes ? new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length), 'x-amz-meta-sha256': createHash('sha256').update(bytes).digest('hex') } }) : new Response('Not found', { status: 404 });
  });
  for (const server of [builder, lms, objects]) await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = (server) => `http://127.0.0.1:${server.address().port}`;
  setEnv({ BOOK_ASSET_STORAGE_PROVIDER: 's3', BOOK_ASSET_S3_ENDPOINT: origin(objects), BOOK_ASSET_S3_REGION: 'auto', BOOK_ASSET_S3_ACCESS_KEY_ID: 'isolated-test', BOOK_ASSET_S3_SECRET_ACCESS_KEY: 'isolated-test', BOOK_ASSET_PUBLIC_BUCKET: 'public-assets', BOOK_ASSET_PRIVATE_BUCKET: 'private-assets', BOOK_ASSET_ARCHIVE_BUCKET: 'archive-assets', BOOK_ASSET_PUBLIC_BASE_URL: origin(objects) + '/public-assets' });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
      window.__immutableUiAudioUrls = [];
      window.Audio = new Proxy(window.Audio, { construct(target, args) { window.__immutableUiAudioUrls.push(String(args[0] || '')); return Reflect.construct(target, args); } });
    });
    await context.route('**/*', async (route) => {
      const host = new URL(route.request().url()).hostname;
      if (!['127.0.0.1', 'hhplms-viewer.netlify.app'].includes(host)) { errors.push(`Unexpected network host: ${host}`); await route.abort(); }
      else await route.fallback();
    });
    const builderToken = randomBytes(32).toString('hex');
    await pool.query("insert into builder_sessions(builder_user_id,token_hash,expires_at) values($1,$2,now()+interval '1 day')", [actor, hashBuilderToken(builderToken)]);
    await context.addCookies([{ name: builderCookieName, value: builderToken, url: origin(builder), httpOnly: true, sameSite: 'Strict' }]);
    await context.route('https://hhplms-viewer.netlify.app/**', async (route) => {
      const original = route.request();
      const request = new Request(original.url(), { method: original.method(), headers: original.headers(), ...(original.postData() ? { body: original.postData() } : {}) });
      const viewerEnv = { ...builderEnv, ASSETS: { fetch: staticFetch(roots.viewer) } };
      let result = await builderWorker.fetch(request, viewerEnv);
      // Playwright does not route each hop of a redirected request. Resolve the
      // public content-addressed redirect locally before fulfilling the request.
      if (result.status === 302 && result.headers.get('location')?.startsWith('/preview/ui-assets-v2/')) {
        result = await builderWorker.fetch(new Request(new URL(result.headers.get('location'), request.url), { method: request.method }), viewerEnv);
      }
      await route.fulfill({ status: result.status, headers: Object.fromEntries(result.headers), body: Buffer.from(await result.arrayBuffer()) });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (result) => { if (result.status() >= 400) console.log('B1_BROWSER_RESPONSE', result.status(), new URL(result.url()).host, new URL(result.url()).pathname); });
    for (const book of ['ultimate-b1', 'ultimate-b1-plus']) {
      await page.goto(`${origin(builder)}/#/books/${book}/components/${book}-students-book/publication`);
      await expect(page.getByRole('heading', { name: 'Publication', exact: true })).toBeVisible();
      await expect(page.getByText('2 required components', { exact: true })).toBeVisible();
      const before = (await pool.query('select head_revision from book_product_publication_heads where book_package_id=(select id from book_packages where slug=$1)', [book])).rows[0].head_revision;
      await page.getByRole('button', { name: 'Prepare Preview', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('prepared with 2 required components');
      const frozen = (await pool.query("select r.* from book_component_releases r join book_components c on c.id=r.book_component_id where c.slug=$1 order by r.release_number desc limit 1", [`${book}-students-book`])).rows[0];
      await changeBrowserUiDraft(pool, actor, book, media, 1);
      assert.equal((await pool.query('select head_revision from book_product_publication_heads where book_package_id=(select id from book_packages where slug=$1)', [book])).rows[0].head_revision, before);
      for (const suffix of ['students-book', 'workbook']) {
        const originalPages = (await pool.query('select id,source_metadata from book_pages where book_component_id=(select id from book_components where slug=$1)', [`${book}-${suffix}`])).rows;
        await pool.query("update book_pages set source_metadata=jsonb_set(source_metadata,'{is_active}','false') where book_component_id=(select id from book_components where slug=$1)", [`${book}-${suffix}`]);
        await page.goto(`${origin(builder)}/#/books/${book}/components/${book}-${suffix}/publication`);
        await expect(page.getByRole('heading', { name: 'Publication', exact: true })).toBeVisible();
        await expect(page.locator('.publication-workspace > header')).toContainText(book === 'ultimate-b1' ? 'Ultimate English B1 · Product' : 'Ultimate English B1+ · Product');
        await page.getByRole('button', { name: 'Review', exact: true }).click();
        const frame = page.frameLocator('.unified-builder-review-dialog iframe');
        try { await expect(frame.locator('.teacher-offline-pages-viewer')).toBeVisible({ timeout: 15000 }); }
        catch (error) { for (const child of page.frames()) console.log('B1_BROWSER_FRAME', await child.locator('body').innerText().catch(() => 'unavailable')); throw error; }
        const frameUrl = new URL(await page.locator('.unified-builder-review-dialog iframe').getAttribute('src'));
        assert.equal(frameUrl.searchParams.get('bookSlug'), book);
        assert.equal(frameUrl.searchParams.get('componentSlug'), `${book}-${suffix}`);
        await verifyFrozenBrowserUi(frame, frozen, book, media);
        await frame.locator('.teacher-offline-page-hotspot').first().click();
        await expect(frame.locator('.published-native-activity')).toBeVisible();
        await expect(frame.locator('.published-native-activity')).toHaveAttribute('data-release-id', frameUrl.searchParams.get('releaseId'));
        await page.getByRole('button', { name: 'Close Review', exact: true }).click();
        for (const original of originalPages) await pool.query('update book_pages set source_metadata=$2::jsonb where id=$1', [original.id, JSON.stringify(original.source_metadata)]);
      }
      await changeBrowserUiDraft(pool, actor, book, media, 0);
      await page.reload();
      await page.getByRole('button', { name: 'Prepare Preview', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('prepared with 2 required components');
      await expect(page.getByRole('button', { name: 'Publish Preview', exact: true })).toBeEnabled();
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Publish Preview', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('now published');
    }
    await context.close();
    for (const user of [student, teacher]) {
      const session = await browser.newContext({ viewport: { width: 1365, height: 900 } });
      const token = randomBytes(32).toString('hex');
      await pool.query("insert into auth_sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '1 day')", [user.id, hashToken(token)]);
      await session.addCookies([{ name: sessionCookieName, value: token, url: origin(lms), httpOnly: true, sameSite: 'Lax' }]);
      const catalog = await session.request.get(`${origin(lms)}/.netlify/functions/book-content?action=published-books`);
      assert.equal(catalog.status(), 200);
      const books = (await catalog.json()).books.filter((book) => book.bookSlug !== 'ultimate-b2');
      assert.equal(books.length, 4);
      for (const book of books) {
        const page = await session.newPage(); page.on('pageerror', (error) => errors.push(error.message));
        const requests = []; page.on('request', (request) => requests.push(new URL(request.url())));
        const prefix = user.role === 'student' ? '/courses' : '/teacher/books';
        const base = `${origin(lms)}/#${prefix}/${book.bookSlug}/components/${book.componentSlug}/pages/`;
        await page.goto(base + book.pages[0].id);
        const surface = page.locator('[data-book-mode="practice"]');
        const selector = surface.locator('.published-book-controls select').nth(1);
        const retained = async (selected) => {
          await expect(surface).toHaveAttribute('data-release-id', book.releaseId);
          await expect(selector).toHaveValue(selected.id);
          await expect.poll(() => surface.locator('.published-page > img').evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
        };
        await retained(book.pages[0]);
        assert.deepEqual(await selector.locator('option').evaluateAll((options) => options.map((option) => option.value)), book.pages.map((entry) => entry.id));
        for (const selected of book.pages.slice(1)) { await surface.getByRole('button', { name: 'Next page', exact: true }).click(); await retained(selected); }
        for (const selected of book.pages.slice(0, -1).reverse()) { await surface.getByRole('button', { name: 'Previous page', exact: true }).click(); await retained(selected); }
        await selector.selectOption(book.pages[1].id); await retained(book.pages[1]);
        await page.goBack(); await retained(book.pages[0]); await page.goForward(); await retained(book.pages[1]); await page.reload(); await retained(book.pages[1]);
        await surface.locator('.published-page-hotspots button').first().click();
        await expect(surface.locator('.published-native-activity')).toHaveAttribute('data-release-id', book.releaseId);
        if (user.role === 'teacher') await surface.getByRole('button', { name: /^Reveal model answer/ }).first().click();
        else { await expect(surface).not.toContainText('PUBLISHED_BOOK_PRIVATE_TEACHER_SENTINEL'); assert.equal(requests.some((url) => url.searchParams.get('action') === 'published-native-teacher'), false); }
        assert.equal(requests.some((url) => ['activity', 'teacher-activity-solutions'].includes(url.searchParams.get('action'))), false);
        const evidence = process.env.PUBLISHED_BOOK_EVIDENCE_DIR || '/tmp/b1-publication-evidence'; await mkdir(evidence, { recursive: true });
        await page.screenshot({ path: `${evidence}/${book.componentSlug}-${user.role}.png`, fullPage: true }); await page.close();
      }
      await session.close();
    }
    assert.deepEqual(errors, []);
    console.log('B1_PUBLICATION_BROWSER all four components: real Builder Prepare/Review/Publish, Student/Teacher routes, order, history/reload, assets and native launch passed.');
  } finally {
    await browser?.close();
    for (const server of [builder, lms, objects]) await new Promise((done) => server.close(done));
    setSqlForTests(null);
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
