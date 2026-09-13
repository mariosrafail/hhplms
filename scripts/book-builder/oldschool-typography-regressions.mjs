import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import react from "@vitejs/plugin-react";
import { expect } from "@playwright/test";
import { createServer } from "../../tests/_vite-test-server.mjs";
import { createOldschoolTypographyPair, typographyFont, typographyXml } from "../../tests/fixtures/oldschool-typography.js";
import { appendOldschoolTypographyPublication, enrichedOldschoolTypographyPair } from "../../tests/fixtures/oldschool-typography-publication.js";
import { createPublicationV2FixtureSources } from "../../tests/fixtures/publication-v2.js";
import { compileUltimateB2ComponentReleaseV2 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { resolveNativeActivityKind } from "../../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";

function providers() {
  return { name: "typography-local-publication-provider", enforce: "pre", resolveId: (id) => id === "virtual:component-publication" ? "\0typography-publication" : null,
    load: (id) => id === "\0typography-publication" ? "export const publishedNativeAssetUrl=(_,ref)=>globalThis.typographyFixture.assetUrl(ref.assetId); export const publishedNativeTeacherAssetUrl=()=>''; export const loadPublishedNativeTeacherDocument=async()=>globalThis.typographyFixture.pair.teacherDocument;" : null };
}

function wav() {
  const data = Buffer.alloc(44 + 8000 * 8 * 2); data.write("RIFF"); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write("data", 36); data.writeUInt32LE(data.length - 44, 40); return data;
}

export async function runOldschoolTypographyRegressions(browser, output, { reproducer = null } = {}) {
  const server = await createServer({ configFile: false, plugins: [providers(), react()], optimizeDeps: { entries: ["tests/fixtures/native-runtime-regressions/oldschool-typography.html"] }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
  await server.listen(); const url = `${server.resolvedUrls.local[0]}tests/fixtures/native-runtime-regressions/oldschool-typography.html`;
  const fontBytes = Buffer.from((await readFile("tests/fixtures/fonts/Ahem.ttf.base64", "utf8")).trim(), "base64");
  let saved = createOldschoolTypographyPair(); let revision = 1; const evidence = []; const errors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const assetResponse = async (route) => {
    const path = route.request().url();
    if (path.includes(typographyFont.assetId)) {
      if (path.includes("mode=failed")) return route.fulfill({ status: 404, body: "Font unavailable" });
      if (path.includes("mode=delayed")) await new Promise((resolve) => setTimeout(resolve, 700));
      return route.fulfill({ contentType: "font/ttf", body: fontBytes });
    }
    if (path.includes("000000000071")) {
      const bytes = wav(); const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || "");
      if (range) {
        const start = Number(range[1]); const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
        return route.fulfill({ status: 206, contentType: "audio/wav", headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${bytes.length}` }, body: bytes.subarray(start, end + 1) });
      }
      return route.fulfill({ contentType: "audio/wav", headers: { "Accept-Ranges": "bytes" }, body: bytes });
    }
    return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1018" height="1509"><rect width="100%" height="100%" fill="white"/></svg>' });
  };
  await context.route("**/typography-assets/**", assetResponse);
  await context.route("**/builder/api/**", async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.endsWith("/preview")) {
      if (path.includes(typographyFont.assetId)) assert.match(path, /\/fonts\//, "uncommitted XML font preview uses the existing component font route");
      return assetResponse(route);
    }
    if (path.endsWith("/fonts")) return route.fulfill({ json: { fonts: [{ ...typographyFont, displayLabel: "Ahem fixture", byteSize: fontBytes.length }] } });
    if (path.includes("/native-activity-public/")) return route.fulfill({ json: { document: saved.publicDocument, revision } });
    if (path.includes("/native-activity-teacher/")) return route.fulfill({ json: { document: saved.teacherDocument, revision } });
    if (path.endsWith("/save")) {
      const body = request.postDataJSON(); const kind = resolveNativeActivityKind("oldschool-listening");
      saved = { publicDocument: kind.normalizePublic(body.publicDocument), teacherDocument: kind.normalizeTeacher(body.teacherDocument) }; kind.validatePair(saved.publicDocument, saved.teacherDocument); revision++;
      return route.fulfill({ json: { ...saved, publicRevision: revision, teacherRevision: revision } });
    }
    throw new Error(`Unexpected local Builder request ${path}`);
  });
  const page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(url); await page.getByRole("tab", { name: "Page Mapping", exact: true }).click();
    assert.equal(await page.locator('.native-oldschool-listening-exact-transcript').evaluate((node) => getComputedStyle(node).overflow), 'hidden', 'unstyled legacy transcript retains its original page boundary');
    const upload = page.getByText("Import transcript typography from XML", { exact: true }).locator("xpath=ancestor::label").locator("input");
    await upload.setInputFiles({ name: "transcript.xml", mimeType: "text/xml", buffer: Buffer.from(typographyXml) });
    await expect(page.getByRole("button", { name: "Apply typography to local draft" })).toBeVisible();
    assert.equal(await page.locator('.native-oldschool-listening-exact-transcript').evaluate((node) => getComputedStyle(node).overflow), 'hidden', 'authored preview retains the source page clip boundary');
    assert.equal(saved.publicDocument.parts[0].interaction.cues[0].highlightRegions[0].typography, undefined);
    await page.getByRole("button", { name: "Apply typography to local draft" }).click();
    await page.locator(".native-oldschool-mapping-region").first().click();
    await page.getByLabel("Transcript font size (source px)", { exact: true }).fill("19");
    await page.getByRole("button", { name: "Save Draft", exact: true }).click(); await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
    assert.equal(saved.publicDocument.parts[0].interaction.cues[0].highlightRegions[0].typography.fontSize, 19);
    await page.reload(); await page.getByRole("tab", { name: "Page Mapping", exact: true }).click(); await page.locator(".native-oldschool-mapping-region").first().click();
    await expect(page.getByLabel("Transcript font size (source px)", { exact: true })).toHaveValue("19");
    await page.screenshot({ path: `${output}/oldschool-builder-typography.png`, fullPage: true });
    const beforeBad = structuredClone(saved);
    await upload.setInputFiles({ name: "mismatch.xml", mimeType: "text/xml", buffer: Buffer.from(typographyXml.replace("Normal ", "Changed ")) });
    await expect(page.getByText(/Typography mismatch or ambiguous match/)).toBeVisible(); assert.deepEqual(saved, beforeBad);
    await page.getByRole("tab", { name: "Audio & Timeline", exact: true }).click();
    const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "Export mapping JSON" }).click();
    const download = await downloadPromise; const mapping = JSON.parse(await readFile(await download.path(), "utf8"));
    assert.deepEqual(mapping.cues, saved.publicDocument.parts[0].interaction.cues);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByText("Import mapping JSON", { exact: true }).locator("xpath=ancestor::label").locator("input").setInputFiles({ name: "mapping.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(mapping)) });
    await page.getByRole("tab", { name: "Page Mapping", exact: true }).click();
    await upload.setInputFiles({ name: "transcript.xml", mimeType: "text/xml", buffer: Buffer.from(typographyXml) });
    await page.getByText("Bind a source font", { exact: true }).click();
    await page.getByLabel("XML source font name", { exact: true }).fill("Arial");
    await page.getByLabel("XML font binding", { exact: true }).selectOption(typographyFont.slot);
    await page.getByRole("button", { name: "Bind font and preview XML again" }).click();
    await expect(page.locator('.native-oldschool-typography-preview').getByText(/Loading transcript fonts/)).toHaveCount(0);
    await page.getByRole("button", { name: "Apply typography to local draft" }).click();
    await page.getByRole("button", { name: "Save Draft", exact: true }).click(); await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
    assert.ok(saved.publicDocument.assets.some((asset) => asset.assetId === typographyFont.assetId));
    await page.getByRole("tab", { name: "Local Preview", exact: true }).click(); await page.getByRole("button", { name: "Student Preview" }).click();
    await page.getByRole("button", { name: "Play Listening audio", exact: true }).click();
    await expect(page.locator('.native-oldschool-listening [data-authored="true"]')).toHaveCount(3);

    const enriched = enrichedOldschoolTypographyPair();
    const compiled = compileUltimateB2ComponentReleaseV2(appendOldschoolTypographyPublication(createPublicationV2FixtureSources(), enriched));
    const frozen = { publicDocument: compiled.publicProjection.nativeActivities[enriched.publicDocument.activityId].document, teacherDocument: compiled.teacherProjection.nativeActivities[enriched.publicDocument.activityId].document };
    for (const mode of ["student", "teacher", "published-student", "published-teacher"]) {
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 430, height: 820 }]) {
        await page.setViewportSize(viewport);
        for (const scale of [1, .65]) {
          await page.evaluate(({ pair, mode, scale }) => { typographyFixture.setPair(pair); typographyFixture.setMode(mode); typographyFixture.setScale(scale); }, { pair: frozen, mode, scale });
          await page.locator('#runtime-stage .native-oldschool-listening').waitFor(); await page.evaluate(() => typographyFixture.showPage());
          const surface = page.locator('#runtime-stage .native-oldschool-listening');
          await expect(surface.locator('[data-authored="true"]')).toHaveCount(3);
          await expect(surface.getByText(/Loading transcript fonts/)).toHaveCount(0);
          const measure = () => surface.locator('[data-authored="true"]').evaluateAll((nodes) => nodes.map((node) => {
            const style = getComputedStyle(node.firstElementChild); const canvas = node.closest('.native-oldschool-listening-page-canvas');
            const spans = [...node.querySelectorAll('[data-transcript-run]')]; const region = node.getBoundingClientRect();
            const range = document.createRange(); range.selectNodeContents(node.querySelector('.native-oldschool-listening-exact-text'));
            return { text: node.textContent, fontSize: parseFloat(style.fontSize), fontFamily: style.fontFamily, lineHeight: parseFloat(style.lineHeight), logicalWidth: canvas.clientWidth, rect: { width: region.width, height: region.height },
              runs: spans.map((span) => { const s = getComputedStyle(span); return { text: span.textContent, fontSize: s.fontSize, fontWeight: s.fontWeight, fontStyle: s.fontStyle, decoration: s.textDecorationLine, fontFamily: s.fontFamily }; }),
              textRects: [...range.getClientRects()].filter((r) => r.width > 0).map((r) => ({ x: r.x-region.x, y:r.y-region.y, width:r.width, height:r.height })),
            };
          }));
          const audio = surface.locator('audio');
          await expect.poll(() => audio.evaluate((node) => node.readyState)).toBeGreaterThan(0);
          await audio.evaluate((node) => { node.pause(); node.currentTime = .2; });
          await expect(surface.locator('[data-highlighted="true"]')).toHaveCount(0); const before = await measure();
          await audio.evaluate((node) => { node.currentTime = 1.2; });
          await expect(surface.locator('[data-highlighted="true"]'), JSON.stringify({mode,scale,viewport,audio:await audio.evaluate(node=>({time:node.currentTime,duration:node.duration,ready:node.readyState,error:node.error?.code,seekable:node.seekable.length}))})).toHaveCount(1); const during = await measure();
          await audio.evaluate((node) => { node.currentTime = .2; }); await expect(surface.locator('[data-highlighted="true"]')).toHaveCount(0); const after = await measure();
          assert.deepEqual(during, before); assert.deepEqual(after, before);
          assert.ok(Math.abs(before[0].fontSize - 18 * before[0].logicalWidth / 1018) < .05);
          assert.ok(Math.abs(before[1].fontSize - 24 * before[1].logicalWidth / 1018) < .05);
          assert.equal(before[0].runs[1].fontWeight, "700"); assert.match(before[0].runs[1].fontFamily, /hh-native-font-/);
          assert.equal(before[0].runs[3].fontStyle, "italic"); assert.equal(before[0].runs[5].decoration, "underline");
          assert.equal(before[2].text, "Literal <i>text</i>."); assert.equal(await surface.locator('[data-region-id$="03"] i').count(), 0);
          for (const region of before) for (const rect of region.textRects) assert.ok(rect.x >= -.5 && rect.y >= -.5 && rect.x + rect.width <= region.rect.width + .5 && rect.y + rect.height <= region.rect.height + .5, JSON.stringify({ mode, viewport, scale, region }));
          evidence.push({ mode, viewport, scale, measurements: before });
        }
      }
    }
    await verifyTranscriptPageBoundary(page, evidence);
    for (const fontMode of ["delayed", "failed"]) {
      const other = await context.newPage(); other.on("pageerror", (error) => errors.push(error.message)); await other.goto(url);
      await other.evaluate(({ pair, fontMode }) => { typographyFixture.setPair(pair); typographyFixture.setMode('student'); typographyFixture.setFontMode(fontMode); }, { pair: frozen, fontMode });
      await other.evaluate(() => typographyFixture.showPage());
      if (fontMode === "delayed") { await expect(other.getByText(/Loading transcript fonts/)).toBeVisible(); await expect(other.getByText(/Loading transcript fonts/)).toHaveCount(0); }
      else await expect(other.getByRole('alert').filter({ hasText: 'Transcript font unavailable' })).toBeVisible();
      assert.equal(await other.locator('[data-authored="true"]').count(), 3); await other.close();
    }
    if (reproducer) {
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.evaluate((pair) => { typographyFixture.setPair(pair); typographyFixture.setMode('teacher'); typographyFixture.setScale(1); }, reproducer);
      await page.evaluate(() => typographyFixture.showPage()); await expect(page.locator('[data-authored="true"]')).toHaveCount(61);
      await page.screenshot({ path: `${output}/oldschool-user-source-transcript.png`, fullPage: true });
      const sourceMeasurements = await page.locator('[data-authored="true"]').evaluateAll((nodes) => nodes.map((node) => {
        const region = node.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(node.querySelector('.native-oldschool-listening-exact-text'));
        const style = getComputedStyle(node.firstElementChild); const sourceScale = node.closest('.native-oldschool-listening-page-canvas').clientWidth / 1018;
        return { id: node.dataset.regionId, fontSize: parseFloat(style.fontSize) / sourceScale, fontFamily: style.fontFamily, lineHeight: parseFloat(style.lineHeight) / sourceScale,
          italicRuns: [...node.querySelectorAll('[data-transcript-run]')].filter((run) => getComputedStyle(run).fontStyle === 'italic').length,
          insideRegion: [...range.getClientRects()].filter((rect) => rect.width > 0).every((rect) => rect.x >= region.x - 1 && rect.y >= region.y - 1 && rect.right <= region.right + 1 && rect.bottom <= region.bottom + 1),
        };
      }));
      for (const row of sourceMeasurements) { assert.ok(Math.abs(row.fontSize - 18) < .05); assert.match(row.fontFamily, /Arial/); assert.equal(row.insideRegion, true, row.id); }
      assert.equal(sourceMeasurements.find((row) => row.id.endsWith('51')).italicRuns, 2);
      assert.equal(sourceMeasurements.find((row) => row.id.endsWith('52')).italicRuns, 1);
      await page.locator('[data-region-id$="51"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/oldschool-user-source-inline-titles.png`, fullPage: true });
      await writeFile(`${output}/oldschool-user-source-measurements.json`, JSON.stringify(sourceMeasurements, null, 2));
    }
    assert.deepEqual(errors, []); await writeFile(`${output}/oldschool-typography-measurements.json`, JSON.stringify(evidence, null, 2));
  } finally { await context.close(); await server.close(); }
}

async function verifyTranscriptPageBoundary(page, evidence) {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 430, height: 820 }]) {
    await page.setViewportSize(viewport);
    for (const scale of [1, .65]) {
      let legacy;
      for (const variant of ["legacy", "authored", "mixed"]) {
        const pair = createOldschoolTypographyPair();
        // Deliberately tiny synthetic boxes exercise both region overflow inside
        // the page and text crossing its right/bottom edges. No source mapping changes.
        pair.publicDocument.parts[0].interaction.cues.forEach((cue, index) => {
          const region = cue.highlightRegions[0];
          Object.assign(region, { x: index === 1 ? 1000 : 40, y: index === 2 ? 1498 : 40 + index * 40, width: 8, height: 8 });
          if (variant === "authored" || variant === "mixed" && index === 0) region.typography = { fontFamily: "Arial", fontSize: 18 };
        });
        await page.evaluate(({ pair, scale }) => { typographyFixture.setPair(pair); typographyFixture.setMode('student'); typographyFixture.setScale(scale); }, { pair, scale });
        await page.locator('#runtime-stage .native-oldschool-listening').waitFor(); await page.evaluate(() => typographyFixture.showPage());
        const surface = page.locator('#runtime-stage .native-oldschool-listening');
        await expect(surface.locator('[data-exact="true"]')).toHaveCount(3);
        await expect(surface.locator('[data-authored="true"]')).toHaveCount(variant === 'legacy' ? 0 : variant === 'authored' ? 3 : 1);
        const measure = () => surface.evaluate((root) => {
          const canvas = root.querySelector('.native-oldschool-listening-page-canvas');
          const transcript = root.querySelector('.native-oldschool-listening-exact-transcript');
          const pane = root.querySelector('.native-oldschool-listening-page-viewport');
          const origin = canvas.getBoundingClientRect();
          const rect = (r) => ({ x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height, right: r.right - origin.x, bottom: r.bottom - origin.y });
          const dimensions = (node) => ({ width: node.clientWidth, height: node.clientHeight, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight });
          return { outerOverflow: getComputedStyle(transcript).overflow, page: rect(origin), clip: rect(transcript.getBoundingClientRect()),
            canvas: dimensions(canvas), pane: { ...dimensions(pane), scrollLeft: pane.scrollLeft, scrollTop: pane.scrollTop },
            document: dimensions(document.documentElement), sourceScale: canvas.clientWidth / 1018,
            regions: [...transcript.children].map((node) => {
              const text = node.querySelector('.native-oldschool-listening-exact-text');
              const range = document.createRange(); range.selectNodeContents(text);
              const style = getComputedStyle(node.firstElementChild);
              return { authored: node.dataset.authored === 'true', box: rect(node.getBoundingClientRect()),
                overflow: getComputedStyle(node).overflow, innerOverflow: style.overflow,
                fontFamily: style.fontFamily, fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), whiteSpace: style.whiteSpace,
                textRects: [...range.getClientRects()].filter((r) => r.width > 0).map(rect) };
            }) };
        });
        const audio = surface.locator('audio');
        await expect.poll(() => audio.evaluate((node) => node.readyState)).toBeGreaterThan(0);
        await audio.evaluate((node) => { node.pause(); node.currentTime = .2; });
        await expect(surface.locator('[data-highlighted="true"]')).toHaveCount(0); const before = await measure();
        await audio.evaluate((node) => { node.currentTime = 1.2; });
        await expect(surface.locator('[data-highlighted="true"]')).toHaveCount(1); const during = await measure();
        await audio.evaluate((node) => { node.currentTime = .2; });
        await expect(surface.locator('[data-highlighted="true"]')).toHaveCount(0); const after = await measure();
        assert.deepEqual(during, before, 'highlight preserves typography, ranges and page scroll geometry');
        assert.deepEqual(after, before, 'deactivation preserves typography, ranges and page scroll geometry');
        assert.equal(before.outerOverflow, 'hidden', `${variant} retains the page clip boundary`);
        assert.deepEqual(before.clip, before.page, 'the clipping ancestor covers exactly the source canvas');
        assert.equal(before.canvas.scrollWidth, before.canvas.width);
        assert.equal(before.canvas.scrollHeight, before.canvas.height);
        assert.equal(before.pane.scrollWidth, before.canvas.width);
        assert.equal(before.pane.scrollHeight, before.canvas.height);
        assert.equal(before.document.scrollWidth, before.document.width, 'no document horizontal overflow');
        for (const region of before.regions) {
          assert.equal(region.overflow, 'visible'); assert.equal(region.innerOverflow, 'visible');
          assert.ok(Math.abs(region.fontSize / before.sourceScale - (region.authored ? 18 : 21)) < .05);
          assert.ok(Math.abs(region.lineHeight / before.sourceScale - (region.authored ? 24 : 31)) < .05);
        }
        const inside = before.regions[0];
        assert.ok(inside.textRects.some((r) => r.right > inside.box.right + 1), 'text extends past its own tiny rectangle');
        assert.ok(inside.textRects.every((r) => r.x >= 0 && r.y >= 0 && r.right < before.clip.right && r.bottom < before.clip.bottom), 'that region overflow remains inside the page and is not clipped');
        assert.ok(before.regions[1].textRects.some((r) => r.right > before.clip.right + 1), 'right-edge ranges really cross the page clip');
        assert.ok(before.regions[2].textRects.some((r) => r.bottom > before.clip.bottom + 1), 'bottom-edge ranges really cross the page clip');
        // The actual ancestor's hidden overflow clips these crossing ranges;
        // neither canvas nor viewport gains their scrollable overflow.
        if (variant === 'legacy') legacy = before;
        else {
          for (const key of ['canvas', 'pane', 'document']) assert.deepEqual(before[key], legacy[key], `${variant} preserves legacy ${key} geometry`);
          if (variant === 'mixed') assert.deepEqual(before.regions.slice(1), legacy.regions.slice(1), 'one authored region does not affect legacy exact regions');
        }
        evidence.push({ boundary: variant, viewport, scale, measurements: before });
      }
    }
  }
}
