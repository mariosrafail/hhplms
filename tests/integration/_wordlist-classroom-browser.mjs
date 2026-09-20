import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { requireBuilderUser } from "../../netlify-sites/ultimate-b2-builder/server/_builder-auth.js";
import { createBuilderEditionHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-editions.js";
import { createBuilderWordListHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-wordlists.js";
import { loadEditionStatus, mutateEdition } from "../../netlify-sites/ultimate-b2-builder/server/_builder-edition-store.js";
import { freezeEditionSource } from "../../netlify-sites/ultimate-b2-builder/server/_builder-edition-domain.js";
import { loadWordList } from "../../netlify-sites/ultimate-b2-builder/server/_builder-wordlist-store.js";
import { requireAuth, createSession } from "../../netlify/functions/_auth-utils.js";
import { readPublishedEdition } from "../../netlify/functions/_book-content/edition-read.js";
import { localPlaywrightLaunchOptions } from "../../scripts/android-teacher/playwright-launch-options.mjs";
import { contentEditionStorage } from "../fixtures/content-edition-storage.js";
import { lexicalFixture, rehashLexicon } from "../fixtures/wordlists.js";
import { classroomSourceInputs } from "../fixtures/wordlist-classroom.js";

export async function exerciseWordListClassroomBrowser({ sql, pool, actor, token, storage: lexicalStorage }) {
  const builderRoot = path.resolve("dist-netlify/ultimate-b2-builder");
  const lmsRoot = path.resolve("dist");
  const output = path.resolve(process.env.WORDLIST_SCREENSHOTS || "artifacts/wordlist-classroom"); await mkdir(output, { recursive: true });
  const originalStatus = await loadEditionStatus(sql, "ultimate-b2", "greek");
  const originalSb = originalStatus.sources.find((entry) => entry.reference.componentSlug === "ultimate-b2-students-book");
  const synthetic = await classroomSourceInputs();
  if (process.env.OFFLINE_EDITION_ACCEPTANCE === "1") {
    const { completeOfflineFixtureMedia } = await import("../fixtures/offline-edition-media.js");
    await completeOfflineFixtureMedia(synthetic);
  }
  const sourceRecord = freezeEditionSource({ ...originalSb.source, revision: originalSb.reference.revision + 1, inputs: synthetic.inputs });
  const assetEdition = (await pool.query("select id,book_package_id from book_editions where edition_identifier='edition-fixture-assets'")).rows[0];
  await pool.query(`insert into builder_component_documents(book_package_id,book_component_id,document_type,document_key,schema_version,revision,payload,payload_sha256,created_by_builder_user_id,updated_by_builder_user_id)
    select $1,id,'native_activity_index','default','1.0',1,$2::jsonb,$3,$4,$4 from book_components where book_package_id=$1 and slug='ultimate-b2-students-book'`,
  [assetEdition.book_package_id, JSON.stringify(synthetic.inputs.native.index.payload), synthetic.inputs.native.index.sha256, actor]);
  for (const row of synthetic.inputs.native.assetRows) {
    await pool.query(`insert into book_assets(id,book_package_id,edition_id,book_component_id,stable_logical_key,asset_role,object_key,storage_profile,storage_bucket,mime_type,byte_size,checksum_sha256,width,height,edition_identifier,version,publication_status,access_level,source_metadata)
      select $1,$2,$3,id,$4,$5,$6,'private',$7,$8,$9,$10,$11,$12,'edition-fixture-assets','v1','draft','internal',$13::jsonb from book_components where book_package_id=$2 and slug='ultimate-b2-students-book'`,
    [row.id, assetEdition.book_package_id, assetEdition.id, `ultimate-b2.classroom-fixture.${row.id}`, row.asset_role, row.object_key, row.storage_bucket, row.mime_type, row.byte_size, row.checksum_sha256, row.width, row.height, JSON.stringify(row.source_metadata)]);
  }
  assert.equal((await mutateEdition(sql, actor, randomUUID(), { operation: "save-source", bookSlug: "ultimate-b2", editionId: "greek", sourceId: sourceRecord.reference.sourceId,
    componentSlug: sourceRecord.reference.componentSlug, expectedRevision: originalSb.reference.revision, record: sourceRecord, assetIds: synthetic.inputs.native.assetRows.map((row) => row.id) })).outcome, "saved");
  const records = (await pool.query("select record from book_content_source_revisions")).rows.map(({ record }) => record);
  const contentStorage = await contentEditionStorage(records, builderRoot);
  const storage = { ...lexicalStorage, bucket: () => "isolated-editions-fixture", async download(reference) { return synthetic.objects.get(reference.objectKey) || await lexicalStorage.download(reference) || contentStorage.download(reference); } };
  const handler = createBuilderWordListHandler({ getDatabase: () => sql, storage: () => storage, prepareAssets: async () => {} });
  const editions = createBuilderEditionHandler({ getDatabase: () => sql });
  const handlerContext = { cloudflare: { staticAssets: { async fetch(request) {
    const pathname = new URL(request.url).pathname; assert(pathname.startsWith("/page-library/ultimate-b2/"));
    return new Response(await readFile(path.join(builderRoot, pathname)), { headers: { "Content-Type": "image/png" } });
  } } } };
  const call = async (suffix, body, query = {}, bytes = null) => {
    const result = await handler({ path: `/builder/api/publication/wordlists/books/ultimate-b2/editions/${suffix}`, httpMethod: "POST",
      headers: { host: "localhost", origin: "http://localhost", cookie: `hh_builder_session=${token}`, "content-type": bytes ? "audio/mpeg" : "application/json" },
      queryStringParameters: query, body: bytes ? bytes.toString("base64") : JSON.stringify(body), isBase64Encoded: Boolean(bytes) }, handlerContext);
    assert.equal(result.statusCode, 200, result.body); return JSON.parse(result.body);
  };
  // Explicit synthetic lexical setup. No publisher groups or source pages are changed.
  const audio = await readFile(new URL("../fixtures/wordlist-pronunciation.mp3", import.meta.url));
  const sha = createHash("sha256").update(audio).digest("hex");
  const dataset = lexicalFixture(); dataset.audio = [{ path: `audio/${sha}.mp3`, sha256: sha, byteSize: audio.length, mediaType: "audio/mpeg" }];
  dataset.entries = Array.from({ length: 50 }, (_, index) => ({ ...structuredClone(dataset.entries[0]), id: `entry-${String(index + 1).padStart(6, "0")}`, order: index,
    displayNumber: index + 1, audioPath: dataset.audio[0].path, english: { ...dataset.entries[0].english, word: index === 0 ? false : index === 1 ? "a deliberately long English headword for aligned rows" : `sample ${index + 1}` }, translations: { el: index === 1 ? "μια μεγάλη ελληνική λέξη για έλεγχο της στοίχισης" : `λέξη ${index + 1}` } }));
  dataset.entries[2].english.word = true;
  dataset.entries[49].displayNumber = dataset.entries[48].displayNumber;
  dataset.entries[49].english.word = dataset.entries[48].english.word;
  rehashLexicon(dataset);
  const status = await loadEditionStatus(sql, "ultimate-b2", "greek");
  for (const component of ["students-book", "workbook"]) {
    const target = status.sources.find((source) => source.reference.sourceId === status.associations[`ultimate-b2-${component}`]);
    const current = await loadWordList(sql, target.reference.sourceId);
    const base = `greek/components/ultimate-b2-${component}`;
    const session = await call(`${base}/begin`, { clientMutationId: randomUUID(), sourceId: current.id, expectedRevision: Number(current.revision),
      targetSource: target.reference, dataset, mappings: [{ group: component === "workbook" ? "work1_1" : "unit1_1", pageIds: target.content.publicProjection.pages.slice(0, component === "workbook" ? 1 : 2).map((page) => page.id) }] });
    await call(`${base}/upload/${session.sessionId}`, null, { sha256: sha, clientMutationId: randomUUID() }, audio);
    await call(`${base}/finalize/${session.sessionId}`, { clientMutationId: randomUUID() });
  }
  const releases = {};
  for (const edition of ["greek", "international"]) {
    const id = randomUUID(); await call(`${edition}/prepare`, { clientMutationId: id, expectedRevision: status.selectionRevision });
    await call(`${edition}/publish`, { clientMutationId: randomUUID(), releaseId: id, expectedRevision: 1 }); releases[edition] = id;
  }
  const student = (await pool.query("select * from app_users where email='student@editions.example.test'")).rows[0];
  if (process.env.OFFLINE_EDITION_ACCEPTANCE === "1") {
    const { exerciseOfflineEditionExport } = await import("./_offline-edition-export.mjs");
    await exerciseOfflineEditionExport({ sql, pool, handler, storage, token, releases, student });
    return;
  }
  const session = await createSession(sql, student.id, { headers: { host: "localhost" } });
  const writes = [], errors = [], reads = []; const faults = { lexical: 0, audio: false }; let releaseRead = null, releaseAudio = null;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost"); const lms = request.headers.host.startsWith("localhost");
      if (url.pathname.startsWith("/builder/api/") || url.pathname.startsWith("/.netlify/functions/")) {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const event = { path: url.pathname, httpMethod: request.method, headers: request.headers, queryStringParameters: Object.fromEntries(url.searchParams), body: Buffer.concat(chunks).toString("utf8") };
        if (request.method !== "GET") writes.push(url.pathname); else reads.push(url.pathname + url.search);
        let result;
        const lexicalRead = url.pathname.includes("/wordlists/") && (url.pathname.endsWith("/draft") || /\/releases\/[^/]+$/.test(url.pathname)) && !["content", "ui", "audioSha256"].some((key) => url.searchParams.has(key));
        if (lexicalRead && faults.lexical === "hold") await new Promise((resolve) => { releaseRead = resolve; });
        if (url.searchParams.has("audioSha256") && faults.audio === "hold") await new Promise((resolve) => { releaseAudio = resolve; });
        if (lexicalRead && faults.lexical === 503 || url.searchParams.has("audioSha256") && faults.audio) {
          response.writeHead(503, { "Content-Type": "application/json" }); response.end('{}'); return;
        }
        if (url.pathname.startsWith("/builder/")) result = lms ? { statusCode: 404, body: "{}" } : url.pathname.endsWith("/auth")
          ? await requireBuilderUser(event, sql).then((auth) => auth.error || { statusCode: 200, body: JSON.stringify({ authenticated: true, builderUser: auth.builderUser }) })
          : url.pathname.includes("/wordlists/") ? await handler(event, handlerContext) : await editions(event);
        else {
          const auth = await requireAuth(event, sql);
          result = auth.error || (url.pathname.endsWith("/auth-me") ? { statusCode: 200, body: JSON.stringify({ user: auth.currentUser }) }
            : url.searchParams.get("action") === "edition-release" ? await readPublishedEdition(sql, auth.currentUser, event.queryStringParameters, { storage: () => storage }) : { statusCode: 200, body: "{}" });
        }
        response.writeHead(result.statusCode, result.headers || { "Content-Type": "application/json" }); response.end(result.isBase64Encoded ? Buffer.from(result.body, "base64") : result.body); return;
      }
      const root = lms ? lmsRoot : builderRoot;
      const file = path.resolve(root, `.${url.pathname === "/" ? "/index.html" : url.pathname}`); assert(file.startsWith(root + path.sep));
      const bytes = await readFile(file);
      response.writeHead(200, { "Content-Type": ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg" })[path.extname(file)] || "application/octet-stream" }); response.end(bytes);
    } catch (error) { errors.push(error.message); response.writeHead(500); response.end("{}"); }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port, origin = `http://127.0.0.1:${port}`, lmsOrigin = `http://localhost:${port}`;
  const browser = await chromium.launch(localPlaywrightLaunchOptions());
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await context.addCookies([{ name: "hh_builder_session", value: token, url: origin }]);
    const page = await context.newPage(); const pageErrors = []; page.on("pageerror", (error) => pageErrors.push(error.message));
    const classroom = page.getByRole("region", { name: "Edition classroom", exact: true });
    const vocabulary = () => classroom.getByRole("button", { name: "Vocabulary", exact: true });
    const overlay = () => classroom.getByRole("dialog", { name: "Word List", exact: true });
    const openPage = async () => { await expect(classroom.locator(".teacher-unit-page-open").first()).toBeVisible(); await expect(vocabulary()).toHaveCount(0); await classroom.locator(".teacher-unit-page-open").first().click(); await expect(vocabulary()).toBeEnabled(); };
    const inspect = async (name, greek) => {
      await vocabulary().click(); await expect(overlay()).toBeVisible();
      await expect(classroom.locator(".teacher-offline-page-stage")).toHaveAttribute("inert", "");
      await expect(classroom.getByRole("toolbar", { name: "Classroom teaching tools", includeHidden: true })).toHaveAttribute("inert", "");
      const bounds = await overlay().boundingBox(), frame = await classroom.locator(".teacher-offline-page-reader").boundingBox();
      assert(bounds.x >= frame.x && bounds.y >= frame.y && bounds.x + bounds.width <= frame.x + frame.width + 1 && bounds.y + bounds.height <= frame.y + frame.height + 1);
      assert.equal(await overlay().evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
      assert(await overlay().locator(".word-list-scroll").evaluate((element) => element.clientHeight >= 180), "Word List needs a usable shared scroll viewport");
      await expect(overlay().getByRole("heading", { name: "Greek", exact: true })).toHaveCount(greek ? 1 : 0);
      await expect(overlay().locator(".word-list-row")).toHaveCount(50);
      await expect(overlay().getByText("false", { exact: true })).toBeVisible();
      await expect(overlay().getByText("true", { exact: true })).toBeVisible();
      await expect(overlay().getByRole("button", { name: "Toggle English 49", exact: true })).toHaveCount(2);
      const firstRow = overlay().locator(".word-list-row").first(); const rowHeight = (await firstRow.boundingBox()).height;
      await overlay().getByRole("button", { name: "Toggle English 1", exact: true }).click();
      await expect(overlay().getByText("false", { exact: true })).toBeHidden();
      assert.equal((await firstRow.boundingBox()).height, rowHeight);
      if (greek) {
        await overlay().getByRole("button", { name: "Toggle Greek 2", exact: true }).click();
        await expect(overlay().getByRole("button", { name: "Toggle English 2", exact: true })).toHaveAttribute("aria-pressed", "true");
        await overlay().getByRole("button", { name: "Show all Greek words", exact: true }).click();
      }
      await expect(vocabulary().locator('[data-icon-state="pressed"]')).toBeVisible();
      if (greek) await expect(overlay().getByText("λέξη 1", { exact: true })).toBeVisible();
      await overlay().getByRole("button", { name: "Play English pronunciation 1", exact: true }).click();
      await expect(overlay().getByRole("button", { name: "Play English pronunciation 1", exact: true })).toHaveAttribute("data-playback", "playing");
      await classroom.screenshot({ path: path.join(output, `${name}.png`) });
      const scroller = overlay().locator(".word-list-scroll"); await scroller.evaluate((element) => { element.scrollTop = 300; });
      await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(300);
      await page.keyboard.press("Escape"); await expect(overlay()).toHaveCount(0); await expect(vocabulary()).toBeFocused();
      assert.equal(await classroom.locator(".word-list-overlay audio").evaluate((audio) => audio.paused && !audio.getAttribute("src")), true);
      await vocabulary().click(); await expect(overlay().getByText("false", { exact: true })).toBeHidden();
      await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(300);
      await overlay().getByRole("button", { name: "Show all English words", exact: true }).click();
      await scroller.evaluate((element) => { element.scrollTop = 0; });
      await overlay().getByRole("button", { name: "Close Word List", exact: true }).click();
    };
    await page.goto(`${origin}/#/books/ultimate-b2`); await page.getByLabel("Content edition", { exact: true }).selectOption("greek");
    page.once("dialog", (dialog) => dialog.accept()); await page.getByLabel("Component", { exact: true }).selectOption("ultimate-b2-workbook");
    const area = page.getByRole("region", { name: "Word Lists", exact: true });
    await area.getByRole("button", { name: "Open saved draft classroom", exact: true }).click(); await openPage(); await inspect("greek-workbook-draft", true);
    for (const state of ["active", "disabled", "pressed"]) {
      const assetUrl = await vocabulary().locator(`[data-icon-state=${state}]`).getAttribute("src");
      assert(assetUrl.includes(`uiBindingId=navibar.vocabulary.${state}`));
      const result = await context.request.get(origin + assetUrl); assert.equal(result.status(), 200);
      assert.equal(createHash("sha256").update(await result.body()).digest("hex"), sourceRecord.content.teacherProjection.ui.assets[`navibar.vocabulary.${state}`].sha256);
    }
    await classroom.screenshot({ path: path.join(output, "workbook-before-activity.png") });
    await expect(classroom.getByRole("alert")).toHaveCount(0);
    await expect(classroom.locator(".teacher-offline-page-hotspot")).toHaveCount(1);
    await classroom.getByRole("button", { name: "Edition fixture activity", exact: true }).click();
    await expect(classroom.getByText("Explain question 1.", { exact: true })).toBeVisible();
    const input = classroom.locator(".native-or-answer-layer").first(); await input.click(); await expect(input).toHaveAttribute("aria-pressed", "true");
    const identity = await input.evaluate((element) => { element.dataset.testMount = "preserved"; return element.dataset.testMount; });
    await inspect("greek-workbook-activity", true); await expect(input).toHaveAttribute("aria-pressed", "true"); await expect(input).toHaveAttribute("data-test-mount", identity);
    await classroom.getByRole("button", { name: "Close classroom", exact: true }).click();
    await area.getByRole("button", { name: "Open classroom candidate 2", exact: true }).click(); await openPage(); await inspect("greek-workbook-candidate", true);
    await classroom.getByRole("button", { name: "Close classroom", exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept()); await page.getByLabel("Component", { exact: true }).selectOption("ultimate-b2-students-book");
    await area.getByRole("button", { name: "Open classroom candidate 2", exact: true }).click(); await openPage();
    await classroom.getByLabel("Classroom second page", { exact: true }).selectOption({ index: 1 }); await expect(vocabulary()).toBeEnabled(); await inspect("greek-students-book-pair", true);
    await classroom.getByLabel("Classroom second page", { exact: true }).selectOption(""); await expect(vocabulary()).toBeEnabled();
    for (const [index, entry] of Object.values(sourceRecord.content.publicProjection.nativeActivities).entries()) {
      if (index === 0) {
        await vocabulary().click(); await overlay().getByRole("button", { name: "Toggle English 1", exact: true }).click();
        await overlay().getByRole("button", { name: "Close Word List", exact: true }).click();
      }
      const hotspot = sourceRecord.content.publicProjection.hotspots.pages["ub2-sb-unit-1-part-1"].find((item) => item.activityKey === entry.document.activityId);
      const teacherResponse = page.waitForResponse((response) => new URL(response.url()).searchParams.get("teacherActivityId") === entry.document.activityId);
      await classroom.getByRole("button", { name: hotspot.label, exact: true }).click();
      const teacherDocument = await teacherResponse; assert.equal(teacherDocument.status(), 200); await teacherDocument.finished();
      const activity = classroom.locator(".teacher-offline-embedded-activity"); await expect(activity).toHaveAttribute("data-embedded-activity-id", entry.document.activityId);
      await expect(activity.locator("[data-native-media-scope]").first()).toBeVisible();
      try { await expect(activity.getByText(/^Loading Teacher (?:model )?answers…$/)).toHaveCount(0); }
      catch (error) { throw new Error(`${entry.kind}: ${await activity.innerText()}\n${error.message}`); }
      await expect(activity.locator(".published-native-activity > :not(header):not([role])").first()).toBeVisible();
      await activity.evaluate((element, value) => { element.dataset.testMount = value; }, String(index));
      const reveal = classroom.getByRole("button", { name: "Show All", exact: true });
      if (await reveal.isEnabled()) { await reveal.click(); await expect(reveal).toBeDisabled(); }
      if (entry.kind === "multi-part") {
        await classroom.getByRole("button", { name: "Next activity part", exact: true }).click();
        await expect(activity.locator(".native-multi-part-panel").nth(1)).toBeVisible();
        await expect(activity.locator(".native-multi-part-panel").first()).toBeHidden();
      }
      if (entry.kind === "open-response") {
        await classroom.getByRole("button", { name: "Show Text", exact: true }).click();
        await expect(activity.getByAltText("Synthetic readable passage")).toBeVisible();
      }
      const activityAudio = activity.locator("audio").first(); let pausedMediaTime = null;
      if (entry.kind === "oldschool-listening") {
        // Keep the 1.2-second synthetic clip running through browser scrolling;
        // its ordinary ended handler intentionally resets the listening view.
        await activityAudio.evaluate(async (audio) => { audio.dataset.testAudioMount = "preserved"; audio.playbackRate = 0.1; await audio.play(); });
        await expect.poll(() => activityAudio.evaluate((audio) => audio.currentTime)).toBeGreaterThanOrEqual(0.2);
        assert.equal(await activityAudio.evaluate((audio) => audio.paused), false);
      }
      const before = await activity.evaluate((element) => ({ text: element.innerText, inputs: [...element.querySelectorAll('input:not(.legacy-listening-player-seek),textarea')].map((input) => input.value), pressed: [...element.querySelectorAll("[aria-pressed]")].map((item) => item.getAttribute("aria-pressed")) }));
      await vocabulary().click(); await expect(overlay()).toBeVisible();
      if (index === 0) await expect(overlay().getByText("false", { exact: true })).toBeHidden();
      if (entry.kind === "oldschool-listening") {
        const media = await activityAudio.evaluate((audio) => ({ paused: audio.paused, time: audio.currentTime, duration: audio.duration, mount: audio.dataset.testAudioMount, scope: audio.closest("[data-wordlist-frame]")?.tagName }));
        assert(media.paused && media.time >= 0.2 && media.mount === "preserved", JSON.stringify(media));
        pausedMediaTime = media.time;
      }
      await page.keyboard.press("Escape"); await expect(overlay()).toBeHidden();
      if (pausedMediaTime !== null) assert.deepEqual(await activityAudio.evaluate((audio) => ({ paused: audio.paused, time: audio.currentTime })), { paused: true, time: pausedMediaTime });
      if (entry.kind === "open-response") await expect(activity.getByAltText("Synthetic readable passage")).toBeVisible();
      await expect(activity).toHaveAttribute("data-test-mount", String(index));
      assert.deepEqual(await activity.evaluate((element) => ({ text: element.innerText, inputs: [...element.querySelectorAll('input:not(.legacy-listening-player-seek),textarea')].map((input) => input.value), pressed: [...element.querySelectorAll("[aria-pressed]")].map((item) => item.getAttribute("aria-pressed")) })), before, entry.kind);
      await classroom.getByRole("button", { name: "Back", exact: true }).click();
      if (index === 0) {
        await vocabulary().click(); await expect(overlay().getByText("false", { exact: true })).toBeHidden();
        await overlay().getByRole("button", { name: "Show all English words", exact: true }).click();
        await overlay().getByRole("button", { name: "Close Word List", exact: true }).click();
      }
    }
    for (const size of [{ width: 1920, height: 1080 }, { width: 1024, height: 582 }, { width: 768, height: 1024 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size); await inspect(`greek-sb-${size.width}x${size.height}`, true);
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    await classroom.getByRole("button", { name: "Close classroom", exact: true }).click();
    await page.getByLabel("Content edition", { exact: true }).selectOption("international");
    await area.getByRole("button", { name: "Open classroom candidate 2", exact: true }).click(); await openPage(); await inspect("international-students-book", false);
    await classroom.getByRole("button", { name: "Next page", exact: true }).click(); await expect(vocabulary()).toBeEnabled();
    await classroom.getByRole("button", { name: "Next page", exact: true }).click(); await expect(vocabulary()).toBeDisabled();
    await expect(classroom.getByText("No Word List entries are mapped to this page.", { exact: true })).toBeVisible();
    await expect(vocabulary().locator('[data-icon-state="disabled"]')).toBeVisible(); await classroom.screenshot({ path: path.join(output, "custom-disabled-artwork.png") });
    await classroom.getByRole("button", { name: "Grammar Book", exact: true }).click(); await expect(classroom.locator(".teacher-unit-page-open").first()).toBeVisible();
    await classroom.locator(".teacher-unit-page-open").first().click(); await expect(vocabulary()).toHaveCount(0);
    await classroom.getByRole("button", { name: "Workbook", exact: true }).click(); await expect(classroom.locator(".teacher-unit-page-open").first()).toBeVisible();
    faults.lexical = "hold"; await classroom.locator(".teacher-unit-page-open").first().click();
    await expect(vocabulary()).toBeDisabled(); await expect(classroom.getByText("Loading Word List…", { exact: true })).toBeVisible();
    await expect.poll(() => typeof releaseRead).toBe("function"); faults.lexical = 0; releaseRead(); releaseRead = null; await expect(vocabulary()).toBeEnabled();
    await classroom.getByRole("button", { name: "Back", exact: true }).click(); faults.lexical = 503;
    await classroom.locator(".teacher-unit-page-open").first().click(); await expect(classroom.getByRole("button", { name: "Retry Word List", exact: true })).toBeVisible();
    await expect(vocabulary()).toBeDisabled(); faults.lexical = 0; await classroom.getByRole("button", { name: "Retry Word List", exact: true }).click(); await expect(vocabulary()).toBeEnabled();
    await vocabulary().click(); faults.audio = true;
    await overlay().getByRole("button", { name: "Play English pronunciation 1", exact: true }).click();
    await expect(overlay().getByRole("button", { name: "Play English pronunciation 1", exact: true })).toHaveAttribute("data-playback", "error");
    faults.audio = false; await overlay().getByRole("button", { name: "Play English pronunciation 1", exact: true }).click();
    await overlay().getByRole("button", { name: "Play English pronunciation 2", exact: true }).click();
    await expect(overlay().getByRole("button", { name: "Play English pronunciation 2", exact: true })).toHaveAttribute("data-playback", "playing");
    assert.equal(await overlay().locator("audio").count(), 1); await vocabulary().click(); await expect(overlay()).toHaveCount(0);
    faults.audio = "hold"; await vocabulary().click();
    await overlay().getByRole("button", { name: "Play English pronunciation 1", exact: true }).click();
    await expect.poll(() => typeof releaseAudio).toBe("function");
    await expect(overlay().getByRole("button", { name: "Play English pronunciation 1", exact: true })).toHaveAttribute("data-playback", "loading");
    await overlay().getByRole("button", { name: "Close Word List", exact: true }).click();
    faults.audio = false; releaseAudio(); releaseAudio = null;
    assert.equal(await classroom.locator(".word-list-overlay audio").evaluate((audio) => audio.paused && !audio.getAttribute("src")), true);
    await classroom.getByRole("button", { name: "Back", exact: true }).click(); faults.lexical = "hold";
    await classroom.locator(".teacher-unit-page-open").first().click(); await expect.poll(() => typeof releaseRead).toBe("function");
    await classroom.getByRole("button", { name: "Students Book", exact: true }).click();
    await expect(classroom.locator(".teacher-unit-page-open").first()).toBeVisible(); faults.lexical = 0; releaseRead(); releaseRead = null;
    await expect(vocabulary()).toHaveCount(0);
    assert.equal(writes.length, 0, "Opening/reading/using a classroom must not save authoring content");
    const lms = await browser.newContext({ viewport: { width: 1100, height: 820 } });
    await lms.addCookies([{ name: session.cookie.split("=")[0], value: session.token, url: lmsOrigin }]);
    const studentPage = await lms.newPage(); studentPage.on("pageerror", (error) => pageErrors.push(error.message));
    await studentPage.goto(`${lmsOrigin}/#/editions/ultimate-b2/greek/releases/${releases.greek}/components/ultimate-b2-workbook`);
    try { await expect(studentPage.locator(".teacher-unit-page-open").first()).toBeVisible(); }
    catch (error) { await studentPage.screenshot({ path: path.join(output, "published-failure.png"), fullPage: true }); throw new Error(`${error.message}\n${await studentPage.locator("body").innerText()}\nPage errors: ${JSON.stringify(pageErrors)}\nReads: ${JSON.stringify(reads.slice(-10))}`); }
    await studentPage.locator(".teacher-unit-page-open").first().click();
    await studentPage.getByRole("button", { name: "Vocabulary", exact: true }).click();
    await expect(studentPage.getByRole("dialog", { name: "Word List", exact: true })).toBeVisible();
    await studentPage.screenshot({ path: path.join(output, "greek-workbook-published-student.png"), fullPage: true });
    await studentPage.getByRole("button", { name: "Close Word List", exact: true }).click();
    await studentPage.getByRole("button", { name: "Edition fixture activity", exact: true }).click();
    const response = studentPage.locator("textarea").first(); await response.fill("My preserved answer");
    await studentPage.getByRole("button", { name: "Vocabulary", exact: true }).click();
    await studentPage.getByRole("button", { name: "Close Word List", exact: true }).click();
    await expect(response).toHaveValue("My preserved answer");
    const request = `/.netlify/functions/book-content?action=edition-release&contract=edition-release.v2&bookSlug=ultimate-b2&editionId=greek&releaseId=${releases.greek}&componentSlug=ultimate-b2-workbook`;
    assert.equal((await lms.request.get(lmsOrigin + request + "&teacherActivityId=any")).status(), 403);
    assert.equal((await fetch(lmsOrigin + request)).status, 401);
    assert.equal((await lms.request.get(lmsOrigin + request.replace("editionId=greek", "editionId=international"))).status(), 403);
    assert(!reads.some((url) => url.startsWith("/preview/") || url.includes("/player/")));
    assert.deepEqual(pageErrors, []); assert.deepEqual(errors, []);
    await lms.close(); await context.close();
    console.log(`Word List classroom: authenticated saved draft, immutable candidate, entitled published Student, SB/WB, Greek/International, pair union, live MP3, Boolean words, visibility/focus and mounted activity state passed. Screenshots: ${output}`);
  } catch (error) { console.error("Classroom browser failure:", error); throw error; }
  finally { releaseRead?.(); releaseAudio?.(); server.closeAllConnections(); await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
