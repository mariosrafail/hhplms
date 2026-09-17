import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { localPlaywrightLaunchOptions } from "../android-teacher/playwright-launch-options.mjs";
import completeSentencesRuntime from "../../src/data/ultimate-b2/runtime/unit-01-reading-exercise-4.complete-sentences.json" with { type: "json" };
import completeSentencesSolution from "../../netlify/functions/_ultimate-b2-reading-exercise-4-solution.json" with { type: "json" };

const baseURL = "http://127.0.0.1:4181";
const artifactRoot = "test-results/ultimate-b2-legacy-pilot/visual";
const targets = [
  { name: "compact-804x360", width: 804, height: 360 },
  { name: "desktop-1280x800", width: 1280, height: 800 },
  { name: "full-hd-1920x1080", width: 1920, height: 1080 },
  { name: "4k-3840x2160", width: 3840, height: 2160 },
];
const activities = [
  { id: "ultimate-b2-sb-u1-p2-o1", label: /Reading.*Exercise 1/ },
  { id: "ultimate-b2-sb-u1-p2-o2", label: /Reading.*Exercise 2/ },
  { id: "ultimate-b2-sb-u1-p2-o3", label: /Reading.*Exercise 3/ },
  { id: "ultimate-b2-sb-u1-p2-o4", label: /Reading.*Exercise 4/ },
  { id: "ultimate-b2-sb-u1-p2-o5", label: /Reading.*Debate club/i },
];

function legacyPilotActivityUnit(activityId) {
  const unitMatch = /-u([0-9]+)-/.exec(activityId);
  return unitMatch ? Number(unitMatch[1]) : Number.NaN;
}

function legacyPilotActivityUnitLabel(unitNumber) {
  return new RegExp(`^Open Unit ${unitNumber}:`);
}

function targetUnitsFromActivities() {
  const units = activities.map((activity) => legacyPilotActivityUnit(activity.id));
  assert.ok(units.every(Number.isInteger), `Legacy pilot activities must include numeric unit ids: ${JSON.stringify(units)}`);
  const uniqueUnits = [...new Set(units)];
  assert.ok(uniqueUnits.length >= 1, "Legacy pilot visual targets must include at least one unit.");
  return uniqueUnits.sort((left, right) => left - right);
}

async function openInternalContents(page, unitNumber) {
  await page.evaluate((selectedUnitNumber) => {
    const current = window.history.state || {};
    const next = {
      teacherOffline: true,
      view: "book",
      location: { ...(current.location || {}), unitNumber: selectedUnitNumber, tab: "exercises", pageId: "" },
    };
    window.history.replaceState(next, "", "#book");
    window.dispatchEvent(new PopStateEvent("popstate", { state: next }));
  }, unitNumber);
  await page.locator(".teacher-offline-lessons").waitFor();
}

async function openPilotBookFromLauncher(page, targetName) {
  const targetUnits = targetUnitsFromActivities();
  if (targetUnits.length !== 1) {
    throw new Error(`${targetName} cannot use single launcher path because target units are ${JSON.stringify(targetUnits)}.`);
  }
  const targetUnit = targetUnits[0];
  const unitButton = page.getByRole("button", { name: legacyPilotActivityUnitLabel(targetUnit) });
  assert.equal(await unitButton.isVisible(), true, `${targetName} expects unit ${targetUnit} launcher button to be visible`);
  assert.equal(await unitButton.isEnabled(), true, `${targetName} expects unit ${targetUnit} launcher button to be enabled`);
  await unitButton.click();
  await page.locator(".teacher-offline-book").waitFor();
  await openInternalContents(page, targetUnit);
}

async function openNormalPage(page, unitNumber) {
  await page.evaluate((selectedUnitNumber) => {
    const current = window.history.state || {};
    const next = {
      teacherOffline: true,
      view: "book",
      location: { ...(current.location || {}), unitNumber: selectedUnitNumber, tab: "pages", pageId: "" },
    };
    window.history.replaceState(next, "", "#book");
    window.dispatchEvent(new PopStateEvent("popstate", { state: next }));
  }, unitNumber);
  const pageCard = page.locator(".teacher-unit-page-card").first();
  await pageCard.waitFor();
  await pageCard.locator(".teacher-unit-page-open").first().click();
  await page.locator(".teacher-offline-page-image img").waitFor();
}

async function readChromeGeometry(page, label) {
  const geometry = await page.evaluate(() => {
    const bounds = (selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect && rect.width && rect.height
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : null;
    };
    return {
      navigation: bounds("[data-teacher-book-navigation]"),
      toolbar: bounds(".classroom-teaching-toolbar"),
    };
  });
  assert.ok(geometry.navigation, `${label} navigation is visible`);
  assert.ok(geometry.toolbar, `${label} toolbar is visible`);
  return geometry;
}

async function assertStableChromeGeometry(page, expected, label) {
  const actual = await readChromeGeometry(page, label);
  for (const region of ["navigation", "toolbar"]) {
    for (const dimension of ["x", "y", "width", "height"]) {
      assert.ok(
        Math.abs(actual[region][dimension] - expected[region][dimension]) <= 1,
        `${label} ${region} ${dimension} moved by more than 1 physical px: ${JSON.stringify({ expected, actual })}`,
      );
    }
  }
}

const preview = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4181"],
  { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
);

async function waitForPreview() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(baseURL);
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Legacy pilot preview did not start.");
}

async function completeStartupIntro(page) {
  const intro = page.getByRole("dialog", { name: "Ultimate B2 opening" });
  if (await intro.count()) {
    assert.equal(await intro.getByRole("button", { name: "Skip intro" }).count(), 0);
    await intro.locator("video").evaluate((video) => video.dispatchEvent(new Event("ended")));
  }
  await page.locator(".legacy-home-launcher").waitFor();
}

async function screenshot(page, target, objectNumber, state) {
  await page.screenshot({
    path: `${artifactRoot}/${target.name}-obj${objectNumber}-${state}.png`,
    animations: "disabled",
  });
}

function activitySelector(id) {
  if (id.endsWith("-o4")) return `[data-complete-sentences-activity="${id}"]`;
  if (id.endsWith("-o5")) return `[data-debate-club-activity="${id}"]`;
  return `[data-legacy-pilot-activity="${id}"]`;
}

async function assertPilotLayout(page, target, id) {
  await page.waitForFunction((activityId) => {
    const root = document.querySelector(`[data-legacy-pilot-activity="${activityId}"], [data-complete-sentences-activity="${activityId}"], [data-debate-club-activity="${activityId}"]`);
    if (!root) return false;
    return [...root.querySelectorAll("img")]
      .filter((image) => {
        const imageRect = image.getBoundingClientRect();
        return imageRect.width > 0 && imageRect.height > 0;
      })
      .every((image) => image.complete);
  }, id);
  const metrics = await page.locator(activitySelector(id)).evaluate((root) => {
    const rect = root.getBoundingClientRect();
    const stageScale = Number(document.querySelector("[data-teacher-stage-scale]")?.dataset.teacherStageScale);
    const fitViewport = root.closest(".teacher-offline-embedded-activity");
    const fitScale = Number(fitViewport?.dataset.fitScale);
    const presentationScale = stageScale * fitScale;
    const images = [...root.querySelectorAll("img")].filter((image) => {
      const imageRect = image.getBoundingClientRect();
      return imageRect.width > 0 && imageRect.height > 0;
    });
    const controls = [...root.querySelectorAll("button, input, textarea, audio, video")]
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== "none"
          && style.visibility !== "hidden"
          && !element.matches('input[type="radio"], input[type="checkbox"]');
      })
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          selector: `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).trim().split(/\s+/).join(".")}` : ""}`,
          role: element.getAttribute("role") || element.tagName.toLowerCase(),
          name: element.getAttribute("aria-label") || element.textContent?.trim() || "",
          width: bounds.width / presentationScale,
          height: bounds.height / presentationScale,
          renderedWidth: bounds.width,
          renderedHeight: bounds.height,
        };
      })
      .filter((control) => control.width && control.height);
    const authoredBounds = (element) => {
      const bounds = element.getBoundingClientRect();
      return {
        left: (bounds.left - rect.left) / presentationScale,
        top: (bounds.top - rect.top) / presentationScale,
        right: (bounds.right - rect.left) / presentationScale,
        bottom: (bounds.bottom - rect.top) / presentationScale,
        width: bounds.width / presentationScale,
        height: bounds.height / presentationScale,
      };
    };
    const completeSentenceBlanks = [...root.querySelectorAll("button[data-blank-id]")].map((button) => {
      const blankId = button.dataset.blankId;
      const visual = root.querySelector(`[data-blank-visual-id="${blankId}"]`);
      const answer = button.querySelector(`[data-blank-answer-id="${blankId}"]`);
      return {
        blankId,
        label: button.getAttribute("aria-label"),
        pressed: button.getAttribute("aria-pressed"),
        text: button.textContent?.trim() || "",
        target: authoredBounds(button),
        visual: visual ? authoredBounds(visual) : null,
        answer: answer ? authoredBounds(answer) : null,
      };
    });
    const smallestControl = controls.reduce((smallest, control) => (
      Math.min(control.width, control.height) < Math.min(smallest.width, smallest.height) ? control : smallest
    ));
    const fitContent = root.closest(".teacher-offline-embedded-activity-content");
    const listeningPlayer = root.querySelector(".teacher-listening-question-player, .teacher-listening-karaoke-player");
    const listeningPlayerRect = listeningPlayer?.getBoundingClientRect();
    const listeningStageRect = listeningPlayer?.closest(".teacher-listening-stage")?.getBoundingClientRect();
    const fitStyle = fitContent ? getComputedStyle(fitContent) : null;
    const viewportStyle = fitViewport ? getComputedStyle(fitViewport) : null;
    const viewportRect = fitViewport?.getBoundingClientRect();
    return {
      activityId: root.dataset.legacyPilotActivity || root.dataset.completeSentencesActivity || root.dataset.debateClubActivity,
      stageScale,
      presentationScale,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rootOverflow: root.scrollWidth - root.clientWidth,
      overflowingElements: [...root.querySelectorAll("*")].filter((element) => element.getBoundingClientRect().right > rect.right + 1).map((element) => ({
        selector: `${element.tagName.toLowerCase()}.${String(element.className || "").trim().split(/\s+/).join(".")}`,
        right: element.getBoundingClientRect().right,
        rootRight: rect.right,
      })).slice(0, 10),
      rootWidth: rect.width,
      authoredRootWidth: rect.width / presentationScale,
      authoredRootHeight: rect.height / presentationScale,
      rootInViewport: rect.left >= -1 && rect.right <= innerWidth + 1,
      brokenImages: images.filter((image) => !image.complete || image.naturalWidth === 0).length,
      brokenImageSources: images
        .filter((image) => !image.complete || image.naturalWidth === 0)
        .map((image) => ({ source: image.currentSrc || image.src, complete: image.complete, naturalWidth: image.naturalWidth })),
      minimumTarget: Math.min(smallestControl.width, smallestControl.height),
      smallestControl,
      completeSentenceBlanks,
      fitScale,
      fitPolicy: fitViewport?.dataset.fitPolicy || null,
      fitTransform: fitStyle?.transform || null,
      fitContentSize: fitContent ? {
        clientWidth: fitContent.clientWidth,
        clientHeight: fitContent.clientHeight,
        scrollWidth: fitContent.scrollWidth,
        scrollHeight: fitContent.scrollHeight,
      } : null,
      fitViewportSize: fitViewport ? {
        clientWidth: fitViewport.clientWidth,
        clientHeight: fitViewport.clientHeight,
        renderedWidth: viewportRect.width,
        renderedHeight: viewportRect.height,
        padding: viewportStyle?.padding,
        overflow: viewportStyle?.overflow,
      } : null,
      rasterUpscale: images.map((image) => ({
        source: image.currentSrc.split("/").at(-1),
        scale: Number((image.getBoundingClientRect().width / presentationScale / image.naturalWidth).toFixed(3)),
      })),
      listeningPlayer: listeningPlayerRect ? {
        rightGap: (listeningStageRect.right - listeningPlayerRect.right) / presentationScale,
        bottomGap: (listeningStageRect.bottom - listeningPlayerRect.bottom) / presentationScale,
        inside: listeningPlayerRect.left >= listeningStageRect.left && listeningPlayerRect.top >= listeningStageRect.top && listeningPlayerRect.right <= listeningStageRect.right && listeningPlayerRect.bottom <= listeningStageRect.bottom,
      } : null,
    };
  });
  assert.equal(metrics.activityId, id, `${target.name} activity identity`);
  assert.ok(metrics.documentOverflow <= 1, `${target.name} document overflow ${metrics.documentOverflow}px`);
  assert.ok(metrics.rootOverflow <= 1, `${target.name} pilot overflow ${metrics.rootOverflow}px: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.rootInViewport, `${target.name} pilot root must remain in viewport`);
  assert.equal(metrics.brokenImages, 0, `${target.name} publisher images: ${JSON.stringify(metrics.brokenImageSources)}`);
  assert.ok(Number.isFinite(metrics.stageScale) && metrics.stageScale > 0, `${target.name} fixed-stage scale: ${metrics.stageScale}`);
  assert.ok(Number.isFinite(metrics.fitScale) && metrics.fitScale > 0, `${target.name} activity-fit scale: ${metrics.fitScale}`);
  assert.ok(metrics.minimumTarget >= 38, `${target.name} authored minimum target ${metrics.minimumTarget}px: ${JSON.stringify(metrics)}`);
  if (id.endsWith("-o4")) {
    assert.equal(metrics.completeSentenceBlanks.length, completeSentencesRuntime.blanks.length, `${target.name} Object 4 exact blank count`);
    const tolerance = 0.1;
    for (const expected of completeSentencesRuntime.blanks) {
      const actual = metrics.completeSentenceBlanks.find((blank) => blank.blankId === expected.id);
      assert.ok(actual, `${target.name} Object 4 ${expected.id} target exists`);
      assert.equal(actual.label, `Reveal ${expected.label.toLowerCase()}`, `${target.name} Object 4 ${expected.id} accessible mapping`);
      assert.equal(actual.pressed, "false", `${target.name} Object 4 ${expected.id} starts unrevealed`);
      assert.equal(actual.text, "", `${target.name} Object 4 ${expected.id} does not leak its answer`);
      assert.ok(actual.target.height >= 38, `${target.name} Object 4 ${expected.id} target is at least 38 authored px: ${JSON.stringify(actual)}`);
      assert.ok(actual.target.left >= -tolerance && actual.target.top >= -tolerance && actual.target.right <= metrics.authoredRootWidth + tolerance && actual.target.bottom <= metrics.authoredRootHeight + tolerance, `${target.name} Object 4 ${expected.id} target remains inside the activity surface: ${JSON.stringify(actual.target)}`);
      const expectedVisual = { left: expected.area.x, top: expected.area.y, width: expected.area.width, height: expected.area.height };
      for (const surface of [actual.visual, actual.answer]) {
        assert.ok(surface, `${target.name} Object 4 ${expected.id} publisher visual surface exists`);
        for (const dimension of ["left", "top", "width", "height"]) {
          assert.ok(Math.abs(surface[dimension] - expectedVisual[dimension]) <= tolerance, `${target.name} Object 4 ${expected.id} ${dimension} preserves publisher geometry: ${JSON.stringify({ expected: expectedVisual, actual: surface })}`);
        }
      }
    }
    for (const [index, left] of metrics.completeSentenceBlanks.entries()) {
      for (const right of metrics.completeSentenceBlanks.slice(index + 1)) {
        const overlapWidth = Math.min(left.target.right, right.target.right) - Math.max(left.target.left, right.target.left);
        const overlapHeight = Math.min(left.target.bottom, right.target.bottom) - Math.max(left.target.top, right.target.top);
        assert.ok(overlapWidth <= tolerance || overlapHeight <= tolerance, `${target.name} Object 4 targets ${left.blankId} and ${right.blankId} must not overlap: ${JSON.stringify({ left: left.target, right: right.target })}`);
      }
    }
  }
  const improvedSurfaceActivity = /-o[23]$/.test(id);
  assert.ok(
    metrics.rasterUpscale.every((image) => image.scale <= (improvedSurfaceActivity ? 1.3 : 1.05)),
    `${target.name} must not enlarge publisher rasters: ${JSON.stringify(metrics.rasterUpscale)}`,
  );
  if (improvedSurfaceActivity) {
    assert.ok(metrics.authoredRootWidth >= 1279 && metrics.authoredRootHeight >= 727, `${target.name} ${id} must use the enlarged authored surface: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.fitPolicy, "source-authored-canvas", `${target.name} ${id} source canvas fit policy`);
    const expectedFitScale = Math.min(metrics.fitViewportSize.clientWidth / 1280, metrics.fitViewportSize.clientHeight / 728);
    assert.ok(Math.abs(metrics.fitScale - expectedFitScale) <= 0.002, `${target.name} ${id} maximum-contain scale: ${JSON.stringify({ expectedFitScale, metrics })}`);
    const renderedRootHeight = metrics.authoredRootHeight * metrics.presentationScale;
    assert.ok(Math.min(Math.abs(metrics.rootWidth - metrics.fitViewportSize.renderedWidth), Math.abs(renderedRootHeight - metrics.fitViewportSize.renderedHeight)) <= 2, `${target.name} ${id} must fill one activity viewport dimension`);
  }
  if (id.endsWith("-o2")) {
    assert.equal(metrics.listeningPlayer?.inside, true, `${target.name} Listening player must remain inside the activity root`);
    assert.ok(metrics.listeningPlayer.rightGap >= 20 && metrics.listeningPlayer.rightGap <= 40, `${target.name} Listening player right anchor: ${JSON.stringify(metrics.listeningPlayer)}`);
    assert.ok(metrics.listeningPlayer.bottomGap >= 15 && metrics.listeningPlayer.bottomGap <= 40, `${target.name} Listening player bottom anchor: ${JSON.stringify(metrics.listeningPlayer)}`);
  }
  return metrics;
}

let browser;
try {
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });
  await waitForPreview();
  browser = await chromium.launch(localPlaywrightLaunchOptions());
  const results = [];

  for (const target of targets) {
    const context = await browser.newContext({ viewport: { width: target.width, height: target.height } });
    const page = await context.newPage();
    const consoleErrors = [];
    const externalRequests = [];
    const failedRequests = [];
    const requestCounts = new Map();
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon/i.test(message.text())) consoleErrors.push(message.text());
    });
    page.on("request", (request) => {
      if (!request.url().startsWith(baseURL)) externalRequests.push(request.url());
      else requestCounts.set(request.url(), (requestCounts.get(request.url()) || 0) + 1);
    });
    page.on("requestfailed", (request) => {
      if (request.failure()?.errorText !== "net::ERR_ABORTED") {
        failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`);
      }
    });

    await page.goto(baseURL, { waitUntil: "networkidle" });
    await completeStartupIntro(page);
    assert.equal(await page.locator(".teacher-offline-library").count(), 1, `${target.name} requires teacher offline build`);
    await openPilotBookFromLauncher(page, target.name);
    let stableChrome = null;
    await page.locator(".teacher-offline-lessons").waitFor();
    assert.equal(await page.locator(".teacher-offline-lessons article").count(), 38, `${target.name} Unit 1 count`);

    for (const [index, activity] of activities.entries()) {
      const objectNumber = index + 1;
      let videoGeometry = null;
      const row = page.locator(".teacher-offline-lessons article").filter({ hasText: activity.label }).first();
      await row.getByRole("button", { name: "Present" }).click();
      await page.locator(activitySelector(activity.id)).waitFor();
      const initial = await assertPilotLayout(page, target, activity.id);
      assert.equal(await page.getByRole("button", { name: /activity part/ }).count(), [3, 5].includes(objectNumber) ? 2 : 0, `${target.name} Object ${objectNumber} internal navigation visibility`);
      stableChrome ||= await readChromeGeometry(page, `${target.name} object ${objectNumber} initial`);
      await assertStableChromeGeometry(page, stableChrome, `${target.name} object ${objectNumber} initial`);
      await screenshot(page, target, objectNumber, "initial");

      if (objectNumber === 1) {
        await page.locator('[data-teacher-book-navigation] button[title="Video"]').click();
        const overlay = page.locator("[data-activity-video-overlay]");
        await overlay.waitFor();
        await assertStableChromeGeometry(page, stableChrome, `${target.name} object 1 video overlay`);
        const video = overlay.locator("video");
        await video.waitFor();
        videoGeometry = await overlay.evaluate((element) => {
          const host = element.closest(".teacher-offline-embedded-activity").getBoundingClientRect();
          const overlayRect = element.getBoundingClientRect();
          const panel = element.querySelector(".teacher-activity-video-panel").getBoundingClientRect();
          const videoElement = element.querySelector("video");
          return {
            host: { left: host.left, top: host.top, width: host.width, height: host.height },
            overlay: { left: overlayRect.left, top: overlayRect.top, width: overlayRect.width, height: overlayRect.height },
            panel: { left: panel.left, top: panel.top, width: panel.width, height: panel.height },
            objectFit: getComputedStyle(videoElement).objectFit,
            policy: element.dataset.videoFitPolicy,
          };
        });
        for (const surface of [videoGeometry.overlay, videoGeometry.panel]) {
          assert.ok(Math.abs(surface.left - videoGeometry.host.left) <= 1 && Math.abs(surface.top - videoGeometry.host.top) <= 1 && Math.abs(surface.width - videoGeometry.host.width) <= 1 && Math.abs(surface.height - videoGeometry.host.height) <= 1, `${target.name} video activity viewport fill: ${JSON.stringify(videoGeometry)}`);
        }
        assert.equal(videoGeometry.objectFit, "contain", `${target.name} video media aspect ratio policy`);
        assert.equal(videoGeometry.policy, "viewport-with-contained-media", `${target.name} video fit policy`);
        await video.evaluate(async (element) => {
          element.muted = true;
          await element.play();
          element.currentTime = Math.min(1, element.duration || 1);
        });
        await page.waitForTimeout(180);
        await screenshot(page, target, objectNumber, "media");
        await video.evaluate((element) => element.pause());
        await overlay.getByRole("button", { name: "Close video" }).click();
        await page.locator(activitySelector(activity.id)).waitFor();
      }

      if (objectNumber === 2) {
        for (const [questionIndex, expectedHighlights] of [3, 7, 2].entries()) {
          const questionNumber = questionIndex + 1;
          await page.getByRole("button", { name: `Play passage for question ${questionNumber}` }).click();
          await page.locator('[data-listening-view="static-text"]').waitFor();
          assert.equal(await page.locator(".teacher-listening-static-highlight").count(), expectedHighlights, `${target.name} question ${questionNumber} exact hotspot count`);
          await assertStableChromeGeometry(page, stableChrome, `${target.name} object 2 question ${questionNumber} static text`);
          await screenshot(page, target, objectNumber, `question-${questionNumber}-static-highlight`);
          await page.locator(".teacher-listening-hidden-audio").last().evaluate((audio) => audio.dispatchEvent(new Event("ended")));
          await page.locator('[data-listening-view="questions"]').waitFor();
        }

        await page.getByRole("button", { name: "Reveal model answer 1" }).click();
        await page.getByRole("button", { name: "Model answer 1" }).waitFor();
        await screenshot(page, target, objectNumber, "model-answer-1");

        const fullAudio = page.locator(".teacher-listening-hidden-audio").first();
        await fullAudio.evaluate((audio) => { audio.muted = true; });
        await page.getByRole("button", { name: "Play full reading" }).click();
        await page.locator('[data-listening-view="karaoke"]').waitFor();
        await assertStableChromeGeometry(page, stableChrome, `${target.name} object 2 karaoke`);
        for (const [state, seconds] of [["early", 27], ["middle", 149], ["late", 270]]) {
          await fullAudio.evaluate((audio, time) => {
            audio.currentTime = time;
            audio.dispatchEvent(new Event("timeupdate"));
          }, seconds);
          await page.locator(".teacher-listening-fragment.active").first().waitFor();
          await screenshot(page, target, objectNumber, `karaoke-${state}`);
        }
        await page.getByRole("button", { name: "Pause full reading" }).click();
        await screenshot(page, target, objectNumber, "karaoke-paused");
        await page.getByRole("button", { name: "Stop full reading" }).click();
        await page.locator('[data-listening-view="questions"]').waitFor();
      }

      if (objectNumber === 3) {
        assert.equal(await page.locator(".teacher-multiple-choice-part-indicator").count(), 0, `${target.name} has no visible Part X/Y indicator`);
        const previousPart = page.getByRole("button", { name: "Previous activity part" });
        const nextPart = page.getByRole("button", { name: "Next activity part" });
        await page.waitForFunction(() => !document.querySelector('button[aria-label="Next activity part"]')?.disabled);
        assert.equal(await previousPart.isDisabled(), true, `${target.name} first Object 3 part disables previous`);
        assert.equal(await nextPart.isDisabled(), false, `${target.name} first Object 3 part enables next`);
        await page.getByRole("button", { name: /Question 1 option A:/ }).click();
        assert.equal(await page.getByRole("button", { name: /Question 1 option A:/ }).getAttribute("data-answer-state"), "wrong");
        await screenshot(page, target, objectNumber, "wrong-feedback");
        await page.getByRole("button", { name: /Question 1 option B:/ }).click();
        assert.equal(await page.getByRole("button", { name: /Question 1 option B:/ }).getAttribute("data-answer-state"), "correct");
        assert.equal(await page.getByRole("button", { name: /Question 1 option A:/ }).isDisabled(), true, `${target.name} solved question locks its options`);
        await screenshot(page, target, objectNumber, "correct-feedback");
        await nextPart.click();
        await page.locator('[data-multiple-choice-panel="2"]').waitFor();
        assert.equal(await page.getByText(/Part\s+2\s*\/\s*2/i).count(), 0, `${target.name} panel 2 has no visible Part X/Y text`);
        assert.equal(await nextPart.isDisabled(), true, `${target.name} last Object 3 part disables next`);
        await screenshot(page, target, objectNumber, "panel-2");
        await previousPart.click();
        await page.locator('[data-multiple-choice-panel="1"]').waitFor();
        assert.equal(await page.getByRole("button", { name: /Question 1 option B:/ }).getAttribute("data-answer-state"), "correct", `${target.name} Object 3 answer persists across panels`);
        await page.getByRole("button", { name: "Show Text" }).click();
        await page.locator('[data-multiple-choice-view="text"]').waitFor();
        await assertStableChromeGeometry(page, stableChrome, `${target.name} object 3 manual Show Text`);
        await screenshot(page, target, objectNumber, "show-text");
        await page.getByRole("button", { name: "Return to questions" }).click();
        await nextPart.click();
        await page.getByRole("button", { name: "Open text reference for question 5" }).click();
        await page.locator('[data-multiple-choice-view="text"]').waitFor();
        assert.equal(await page.locator(".teacher-multiple-choice-highlight").count(), 8, `${target.name} question 5 highlight count`);
        await screenshot(page, target, objectNumber, "question-5-reference");
        await page.locator(".teacher-multiple-choice-hidden-audio").evaluate((audio) => audio.dispatchEvent(new Event("ended")));
        await page.locator('[data-multiple-choice-panel="2"][data-multiple-choice-view="questions"]').waitFor();
      }

      if (objectNumber === 4) {
        const blankButtons = page.locator(".ultimate-b2-complete-sentence button[data-blank-id]");
        assert.equal(await blankButtons.count(), completeSentencesRuntime.blanks.length, `${target.name} Object 4 exact reveal target count`);
        for (const [blankIndex, expected] of completeSentencesRuntime.blanks.entries()) {
          const blank = blankButtons.nth(blankIndex);
          assert.equal(await blank.getAttribute("data-blank-id"), expected.id, `${target.name} Object 4 reveal order`);
          assert.equal(await blank.getAttribute("aria-label"), `Reveal ${expected.label.toLowerCase()}`);
          assert.equal(await blank.textContent(), "", `${target.name} Object 4 ${expected.id} answer starts hidden`);
          await blank.click();
          assert.equal(await blank.getAttribute("aria-pressed"), "true", `${target.name} Object 4 ${expected.id} stays revealed`);
          assert.equal((await blank.textContent()).trim(), completeSentencesSolution.blanks[expected.id], `${target.name} Object 4 ${expected.id} reveals its intended answer`);
        }
        await screenshot(page, target, objectNumber, "click-reveal");
        await page.getByRole("button", { name: "Show Text" }).click();
        await page.locator('[data-show-text-view="open"]').waitFor();
        await screenshot(page, target, objectNumber, "show-text");
        await page.getByRole("button", { name: "Return to questions" }).click();
        await page.locator('[data-complete-sentences-view="questions"]').waitFor();
        assert.ok((await blankButtons.evaluateAll((buttons) => buttons.every((button) => button.getAttribute("aria-pressed") === "true"))), `${target.name} Object 4 reveals persist after Show Text`);
      }

      if (objectNumber === 5) {
        const previousPart = page.getByRole("button", { name: "Previous activity part" });
        const nextPart = page.getByRole("button", { name: "Next activity part" });
        const partOneReveal = page.getByRole("button", { name: "Show model response for part 1", exact: true });
        await partOneReveal.click();
        assert.equal(await partOneReveal.getAttribute("aria-pressed"), "true");
        await screenshot(page, target, objectNumber, "part-1-reveal");
        await nextPart.click();
        await page.locator('[data-debate-part="2"]').waitFor();
        await page.getByRole("button", { name: "Show model response for part 2", exact: true }).click();
        await screenshot(page, target, objectNumber, "part-2-reveal");
        await previousPart.click();
        await page.locator('[data-debate-part="1"]').waitFor();
        assert.equal(await partOneReveal.getAttribute("aria-pressed"), "true", `${target.name} Object 5 reveal persists across parts`);
      }

      results.push({
        target: target.name,
        activityId: activity.id,
        minimumTarget: initial.minimumTarget,
        maximumRasterScale: Math.max(...initial.rasterUpscale.map((image) => image.scale)),
        overflow: Math.max(initial.documentOverflow, initial.rootOverflow),
        fitScale: initial.fitScale,
        fitPolicy: initial.fitPolicy,
        viewport: initial.fitViewportSize,
        listeningPlayer: initial.listeningPlayer,
        videoGeometry,
      });
      await openInternalContents(page, legacyPilotActivityUnit(activity.id));
    }

    await openNormalPage(page, targetUnitsFromActivities()[0]);
    await assertStableChromeGeometry(page, stableChrome, `${target.name} normal page`);

    assert.deepEqual(consoleErrors, [], `${target.name} console errors`);
    assert.deepEqual(externalRequests, [], `${target.name} external requests`);
    assert.deepEqual(failedRequests, [], `${target.name} failed requests`);
    assert.deepEqual(
      [...requestCounts].filter(([url, count]) => (
        (/\/assets\/highlight_/.test(url) && count > 4)
        || (/\/assets\/unit-1-reading/.test(url) && count > 8)
      )),
      [],
      `${target.name} media retry loops`,
    );
    await context.close();
  }

  const report = {
    schemaVersion: "1.0",
    status: "passed",
    generatedAt: new Date().toISOString(),
    targets,
    activities: activities.map((activity) => activity.id),
    results,
    artifactRoot,
  };
  await writeFile(`${artifactRoot}/visual-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  preview.kill();
}
