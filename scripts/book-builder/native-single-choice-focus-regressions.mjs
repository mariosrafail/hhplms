import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { expect } from "@playwright/test";

const cases = [
  { name: "desktop", viewport: { width: 1440, height: 900 }, size: { width: 1280, height: 728 }, scale: 1 },
  { name: "small", viewport: { width: 800, height: 600 }, size: { width: 740, height: 480 }, scale: 1 },
  { name: "scaled-viewer", viewport: { width: 800, height: 600 }, size: { width: 1024, height: 582 }, scale: .65 },
];

async function frames(page, count = 4) {
  return page.evaluate((count) => new Promise((resolve) => {
    const samples = [];
    const tick = () => { samples.push(globalThis.singleChoiceDiagnostics.resizeCallbacks); if (samples.length === count) resolve(samples); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), count);
}

async function stageGeometry(page, label, record) {
  const geometry = await page.locator(".native-single-choice-visual-panel").evaluateAll((panels) => panels.map((panel) => {
    const rect = (element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const index = Number((panel.querySelector("h3")?.textContent || panel.getAttribute("aria-label")).match(/\d+/)[0]) - 1;
    const document = globalThis.nativePresentationFixture.choice.publicDocument;
    const source = document.parts[0].interaction.presentation.panels[index];
    const slot = panel.querySelector(".native-single-choice-stage-slot");
    const stage = panel.querySelector(".native-single-choice-visual-stage");
    const image = stage.querySelector(":scope > img");
    const areas = [...source.hotspots.map((hotspot) => hotspot.area), ...document.audioTextHotspots.hotspots.filter((hotspot) => hotspot.panelId === source.id).map((hotspot) => hotspot.activityArea)];
    const hotspots = [...stage.querySelectorAll(".native-single-choice-hotspot, .native-audio-text-hotspot")].map(rect);
    const panelList = panel.parentElement;
    const visual = panelList.parentElement;
    const surface = visual.parentElement;
    const article = surface.closest("article");
    const activityView = article.parentElement;
    const computed = (element) => {
      const css = getComputedStyle(element);
      return Object.fromEntries(["display", "position", "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight", "gridTemplateRows", "gridTemplateColumns", "gap", "alignSelf", "alignItems", "justifyItems", "inset", "margin", "aspectRatio", "containerType", "overflow"].map((key) => [key, css[key]]));
    };
    const heightChain = Object.fromEntries(Object.entries({ activityView, article, surface, visual, panels: panelList, panel, slot }).map(([key, element]) => [key, { rect: rect(element), computed: computed(element) }]));
    return { anchored: stage.hasAttribute("data-hotspot-anchored"), active: stage.querySelector('.native-audio-text-hotspot[aria-pressed="true"]') ? rect(stage.querySelector('.native-audio-text-hotspot[aria-pressed="true"]')) : null, index, mode: panelList.classList.contains("is-show-all") ? "show-all" : "paged", runtimeArticle: article.className, heightChain, source: { width: source.sourceWidth, height: source.sourceHeight }, slot: rect(slot), stage: rect(stage), image: rect(image), imageSource: { width: image.naturalWidth, height: image.naturalHeight }, areas, hotspots, containerType: getComputedStyle(slot).containerType, position: getComputedStyle(stage).position, computed: { visual: computed(visual), panels: computed(panelList), panel: computed(panel), slot: computed(slot), stage: computed(stage) } };
  }));
  record({ label, panels: geometry });
  const near = (a, b, reason) => assert.ok(Math.abs(a - b) <= 1, `${label}: ${reason}: ${a} != ${b}`);
  for (const g of geometry) {
    if (g.mode === "paged") {
      const chain = Object.fromEntries(Object.entries(g.heightChain).map(([key, value]) => [key, value.rect]));
      for (const [key, bounds] of Object.entries(chain)) assert.ok(Number.isFinite(bounds.height) && bounds.height > 0, `${label}: ${key} needs finite usable height`);
      for (const [child, parent] of [["article", "activityView"], ["surface", "article"], ["visual", "surface"], ["panel", "panels"]]) near(chain[child].height, chain[parent].height, `${child} fills ${parent}`);
      for (const [child, parent] of [["panels", "visual"], ["slot", "panel"]]) near(chain[child].y + chain[child].height, chain[parent].y + chain[parent].height, `${child} consumes remaining ${parent} height`);
    }
    const aspect = g.source.width / g.source.height;
    const width = g.anchored ? g.slot.width : Math.min(g.slot.width, g.slot.height * aspect);
    assert.ok(width > 0 && g.stage.height > 0, `${label}: empty stage`);
    near(g.stage.width, width, "contain width"); near(g.stage.height, width / aspect, "contain height");
    near(g.stage.width, g.stage.height * aspect, "aspect");
    near(g.stage.x, g.slot.x + (g.slot.width - g.stage.width) / 2, "horizontal centering");
    if (g.anchored && g.stage.height > g.slot.height) {
      assert.ok(g.active && g.active.y >= g.slot.y - 1 && g.active.y + g.active.height <= g.slot.y + g.slot.height + 1, `${label}: active hotspot remains in locked crop`);
      assert.ok(g.stage.y <= g.slot.y + 1 && g.stage.y + g.stage.height >= g.slot.y + g.slot.height - 1, `${label}: crop remains inside artwork`);
    } else {
      near(g.stage.y, g.slot.y + (g.slot.height - g.stage.height) / 2, "vertical centering");
      assert.ok(g.stage.width <= g.slot.width + 1 && g.stage.height <= g.slot.height + 1, `${label}: stage overflow`);
    }
    for (const key of ["x", "y", "width", "height"]) near(g.image[key], g.stage[key], `artwork ${key}`);
    assert.deepEqual(g.imageSource, g.source);
    assert.equal(g.containerType, "normal", `${label}: stage must not query a size container`);
    assert.equal(g.hotspots.length, g.areas.length);
    g.areas.forEach((area, index) => {
      const hotspot = g.hotspots[index];
      near(hotspot.x, g.stage.x + area.x / g.source.width * g.stage.width, "hotspot x");
      near(hotspot.y, g.stage.y + area.y / g.source.height * g.stage.height, "hotspot y");
      near(hotspot.width, area.width / g.source.width * g.stage.width, "hotspot width");
      near(hotspot.height, area.height / g.source.height * g.stage.height, "hotspot height");
    });
  }
}

const responseState = (page, teacher) => page.evaluate((teacher) => ({
  choices: [...document.querySelectorAll(".native-single-choice-hotspot")].map((button) => ({ label: button.getAttribute("aria-label"), selected: button.getAttribute("aria-pressed"), answer: button.dataset.answerState || null, disabled: button.disabled })),
  reveal: teacher ? globalThis.nativePresentationFixture.states.at(-1)?.reveal : null,
}), teacher);

async function warmTransition(page, button) {
  const session = await page.context().newCDPSession(page);
  const trace = { layouts: [], invalidations: 0 };
  session.on("Tracing.dataCollected", ({ value }) => {
    for (const event of value) {
      if (event.name === "Layout" && event.ph === "X") trace.layouts.push(event.dur / 1000);
      if (event.name.includes("Invalidation")) trace.invalidations++;
    }
  });
  await session.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking", transferMode: "ReportEvents" });
  try {
    await button.click();
    await expect(page.locator('.native-audio-text-focus[data-focus-layout="fixed-aspect"]')).toBeVisible();
    const callbacks = await frames(page, 8);
    const metric = await page.evaluate(() => {
      const diagnostics = globalThis.singleChoiceDiagnostics;
      const click = diagnostics.click;
      return { clickToSplitMs: click.split - click.start, resizeCallbacks: diagnostics.resizeCallbacks - click.resizeStart, longTasks: diagnostics.longTasks.filter((task) => task.start + task.duration > click.start && task.start <= click.painted), focusPosition: getComputedStyle(document.querySelector(".native-single-choice-visual-stage")).position };
    });
    const complete = new Promise((resolve) => session.once("Tracing.tracingComplete", resolve));
    await session.send("Tracing.end"); await complete;
    const result = { ...metric, resizeFrameCounts: callbacks, largestLayoutMs: Math.max(0, ...trace.layouts), layoutCount: trace.layouts.length, invalidationCount: trace.invalidations };
    assert.ok(Number.isFinite(result.clickToSplitMs) && result.clickToSplitMs < 100, JSON.stringify(result));
    assert.equal(result.longTasks.length, 0, JSON.stringify(result));
    assert.ok(result.largestLayoutMs < 50, JSON.stringify(result));
    assert.ok(result.layoutCount <= 8 && result.resizeCallbacks <= 12, JSON.stringify(result));
    assert.equal(new Set(callbacks.slice(-4)).size, 1, `Resize feedback: ${JSON.stringify(result)}`);
    assert.equal(result.focusPosition, "absolute");
    return result;
  } finally { await session.detach(); }
}

export async function runSingleChoiceFocusRegressions(browser, baseUrl, output, { published = false } = {}) {
  const prefix = published ? "single-choice-published" : "single-choice";
  const css = await readFile("src/components/native-single-choice/nativeSingleChoice.css", "utf8");
  assert.doesNotMatch(css, /cq[wh]\b|container-type\s*:\s*size/);
  const assets = new Map();
  for (const [id, width, height] of [[11, 1024, 582], [12, 1000, 560], [13, 480, 960], [14, 1440, 360]]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#edf4fa"/><path d="M0 0L${width} ${height}M${width} 0L0 ${height}" stroke="#abc"/><rect x="21" y="25" width="698" height="198" fill="none" stroke="#267"/><text x="40" y="150" font-size="28">Synthetic panel ${id}: readable excerpt</text></svg>`;
    assets.set(String(id).padStart(12, "0"), await sharp(Buffer.from(svg)).png().toBuffer());
  }
  const measurements = []; const errors = [];
  const page = await browser.newPage();
  await page.route("**/native-fixture-assets/*", (route) => route.fulfill({ contentType: "image/png", body: assets.get(route.request().url().slice(-12)) }));
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(() => {
    const metrics = globalThis.singleChoiceDiagnostics = { resizeCallbacks: 0, longTasks: [], click: null };
    const Observer = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class extends Observer { constructor(callback) { super((...args) => { metrics.resizeCallbacks++; callback(...args); }); } };
    new PerformanceObserver((list) => metrics.longTasks.push(...list.getEntries().map((entry) => ({ start: entry.startTime, duration: entry.duration })))).observe({ type: "longtask" });
    new MutationObserver(() => {
      const focused = document.querySelector(".native-audio-text-focus");
      if (metrics.click && !metrics.click.split && focused) metrics.click.split = performance.now();
      if (metrics.escape && !metrics.escape.closed && !focused) metrics.escape.closed = performance.now();
    }).observe(document, { childList: true, subtree: true });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") metrics.escape = { start: performance.now() }; }, true);
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".native-audio-text-hotspot")) return;
      const click = metrics.click = { start: performance.now(), resizeStart: metrics.resizeCallbacks };
      requestAnimationFrame(() => requestAnimationFrame(() => { click.painted = performance.now(); }));
    }, true);
  });
  try {
    for (const scenario of published ? [cases[2]] : cases) for (const teacher of [true, false]) {
      await page.setViewportSize(scenario.viewport);
      await page.goto(`${baseUrl}tests/fixtures/native-runtime-regressions/presentation.html?fixed-focus`);
      await page.getByRole("button", { name: "Open readable excerpt 1", exact: true }).waitFor();
      await page.evaluate(({ scenario, teacher, published }) => { nativePresentationFixture.setSize(scenario.size); nativePresentationFixture.setScale(scenario.scale); nativePresentationFixture.setMode(published ? teacher ? "choice-published-teacher" : "choice-published-student" : teacher ? "choice" : "choice-student"); }, { scenario, teacher, published });
      const articleSelector = `.native-readable-text-activity-view > article.${published ? "published-native-activity" : "hosted-native-draft-activity"}`;
      await expect(page.locator(`${articleSelector} ${teacher ? ".native-single-choice-teacher" : ".native-single-choice-student"}`)).toBeVisible();
      await page.evaluate(async () => {
        await Promise.all([...nativePresentationFixture.choice.publicDocument.assets.map((asset) => nativePresentationFixture.assetUrl(asset.assetId)), "/src/assets/native-activities/readable-text-hotspot-active.svg", "/src/assets/native-activities/readable-text-hotspot-pressed.svg"].map(async (src) => { const image = new Image(); image.src = src; await image.decode(); }));
        await document.fonts.ready;
      });
      await frames(page);
      const entry = { scenario, mode: teacher ? "Teacher" : "Student", runtime: published ? "published" : "hosted-draft", geometry: [] };
      measurements.push(entry);
      const measure = async (label) => { await frames(page); await stageGeometry(page, `${entry.mode}/${scenario.name}/${label}`, (geometry) => entry.geometry.push(geometry)); };
      const hotspot = (number) => page.getByRole("button", { name: `Open readable excerpt ${number}`, exact: true });
      const focus = page.locator(".native-audio-text-focus");
      await measure("normal");
      await page.getByRole("button", { name: "Choose: Second", exact: true }).click();
      await frames(page);
      const before = await responseState(page, teacher);
      entry.performance = await warmTransition(page, hotspot(1));
      await measure("fixed-focus");
      await page.screenshot({ path: `${output}/${prefix}-${entry.mode}-${scenario.name}-focus.png` });
      assert.deepEqual(await responseState(page, teacher), before, "Focus must retain responses and reveal state");
      await expect(focus.locator("svg")).toHaveAttribute("viewBox", "21 25 698 198");
      await page.keyboard.press("Escape"); await expect(focus).toHaveCount(0); await measure("closed");
      entry.escapeCloseMs = await page.evaluate(() => singleChoiceDiagnostics.escape.closed - singleChoiceDiagnostics.escape.start);
      assert.ok(Number.isFinite(entry.escapeCloseMs) && entry.escapeCloseMs < 100, `Escape close: ${entry.escapeCloseMs} ms`);
      if (teacher) {
        await page.evaluate(() => nativePresentationFixture.command("show-next"));
        await expect(page.getByRole("button", { name: "Choose: First", exact: true })).toHaveAttribute("data-answer-state", "correct");
      }
      await frames(page);
      const revealed = await responseState(page, teacher);
      await page.evaluate(() => { const buttons = document.querySelectorAll(".native-audio-text-hotspot"); buttons[0].click(); buttons[1].click(); });
      await expect(focus).toHaveAttribute("aria-label", "Focused readable text: Open readable excerpt 2");
      await expect(focus.locator("svg")).toHaveAttribute("viewBox", "24 107 721 205");
      await measure("rapid-last-hotspot-wins");
      assert.deepEqual(await responseState(page, teacher), revealed);
      await hotspot(2).click(); await expect(focus).toHaveCount(0);
      for (const index of [2, 3]) {
        await hotspot(index === 2 ? 1 : 3).click();
        if (teacher) await page.evaluate(() => nativePresentationFixture.command("next-panel"));
        else await page.getByRole("button", { name: "Next", exact: true }).click();
        await expect(page.locator(".native-single-choice-visual-panel")).toHaveAccessibleName(`Panel ${index}`);
        await expect(focus).toHaveCount(0); await measure(`panel-${index}`);
        await hotspot(index + 1).click(); await expect(focus).toBeVisible(); await measure(`panel-${index}-focus`);
        await page.keyboard.press("Escape"); await expect(focus).toHaveCount(0);
      }
      if (teacher) {
        await page.evaluate(() => nativePresentationFixture.command("previous-panel")); await frames(page);
        await page.evaluate(() => nativePresentationFixture.command("previous-panel"));
        await expect(page.getByRole("button", { name: "Choose: First", exact: true })).toHaveAttribute("data-answer-state", "correct");
      } else {
        await page.getByRole("button", { name: "Show All", exact: true }).click();
        await expect(page.getByRole("button", { name: "Choose: Second", exact: true })).toHaveAttribute("aria-pressed", "true");
      }
      await measure("navigation-retains-response");
      await page.screenshot({ path: `${output}/${prefix}-${entry.mode}-${scenario.name}.png` });
    }
    assert.deepEqual(errors, []);
    console.log(`${published ? "Published " : ""}Single Choice fixed-aspect focus: ${measurements.length} Teacher/Student scenarios passed; geometry, warm transitions, rapid switch, Escape and navigation verified.`);
  } catch (error) {
    await page.screenshot({ path: `${output}/${prefix}-focus-failure.png` });
    throw error;
  } finally {
    await writeFile(`${output}/${prefix}-focus-measurements.json`, JSON.stringify({ browser: browser.version(), measurements, errors }, null, 2));
    await page.close();
  }
}
