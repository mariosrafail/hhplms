import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const endpoint = process.env.ANDROID_WEBVIEW_DEVTOOLS_URL || "http://127.0.0.1:9222/json";
const runFile = promisify(execFile);
const adbArguments = (...args) => process.env.ANDROID_ADB_SERIAL
  ? ["-s", process.env.ANDROID_ADB_SERIAL, ...args]
  : args;
const targets = await fetch(endpoint).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === "page" && candidate.url.startsWith("https://localhost"));
assert.ok(target?.webSocketDebuggerUrl, "No debuggable teacher Android WebView was found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const networkUrls = [];
const consoleErrors = [];
let nextId = 1;

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  if (message.method === "Network.requestWillBeSent") {
    networkUrls.push(message.params.request.url);
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    consoleErrors.push(message.params.args.map((argument) => argument.value || argument.description || "").join(" "));
  }
  if (message.method === "Runtime.exceptionThrown") {
    consoleErrors.push(message.params.exceptionDetails.text || "Uncaught WebView exception");
  }
});

function command(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const response = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result.value;
}

const scenario = String.raw`
(async () => {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const wakeLock = await navigator.wakeLock?.request("screen").catch(() => null);
  const waitFor = async (predicate, label, timeout = 15000) => {
    const started = performance.now();
    while (!predicate()) {
      if (performance.now() - started > timeout) throw new Error("Timed out waiting for " + label);
      await sleep(50);
    }
    return Math.round(performance.now() - started);
  };
  const button = (label) => [...document.querySelectorAll("button")]
    .find((candidate) => candidate.textContent.replace(/\s+/g, " ").trim().includes(label));
  const click = async (label) => {
    const target = button(label);
    if (!target) throw new Error("Button not found: " + label);
    target.click();
    await sleep(75);
  };
  const openArticle = async (index) => {
    if (!document.querySelector(".teacher-offline-lessons article")) {
      await click("Contents / Exercises");
      await waitFor(() => document.querySelector(".teacher-offline-lessons article"), "activity contents");
    }
    const articles = [...document.querySelectorAll(".teacher-offline-lessons article")];
    if (!articles[index]) throw new Error("Activity article not found: " + index);
    articles[index].querySelector("button").click();
    await waitFor(() => document.querySelector(".teacher-offline-embedded-activity"), "embedded activity");
    if (document.querySelectorAll(".unit2-normalized-activity, .ultimate-b2-legacy-pilot").length !== 1) {
      throw new Error("Expected exactly one active activity renderer");
    }
    if (document.querySelectorAll(".teacher-offline-pages-viewer .classroom-teaching-toolbar").length !== 1) {
      throw new Error("Expected exactly one activity toolbar");
    }
    await click("Back to page");
    await waitFor(() => document.querySelector(".teacher-offline-page-image"), "page after activity");
    if (!document.querySelector(".teacher-offline-lessons article")) {
      await click("Contents / Exercises");
      await waitFor(() => document.querySelector(".teacher-offline-lessons article"), "activity contents after return");
    }
  };
  const openMediaActivity = async (unit, title, type, selector = type, variant = "primary") => {
    await click("Unit " + unit);
    await click("Contents / Exercises");
    await waitFor(() => document.querySelectorAll(".teacher-offline-lessons article").length > 0, "activity contents");
    const article = [...document.querySelectorAll(".teacher-offline-lessons article")]
      .find((candidate) => candidate.querySelector("strong")?.textContent.trim() === title);
    if (!article) throw new Error("Media activity not found: " + unit + " " + title);
    article.querySelector("button").click();
    await waitFor(() => document.querySelector(selector), type + " element");
    const media = document.querySelector(selector);
    await waitFor(() => media.readyState >= 1, type + " metadata", 30000);
    const source = new URL(media.currentSrc || media.src);
    if (source.origin !== location.origin || !source.pathname.startsWith("/assets/")) {
      throw new Error("Media did not resolve to a packaged local asset");
    }
    const before = media.currentTime;
    await Promise.race([
      media.play(),
      sleep(15000).then(() => { throw new Error(type + " playback start timed out: " + variant); }),
    ]);
    await sleep(1200);
    const playedTo = media.currentTime;
    media.pause();
    if (!(playedTo > before)) throw new Error(type + " playback did not advance");
    const seekTarget = Math.min(2, Number.isFinite(media.duration) ? media.duration / 2 : 2);
    media.currentTime = seekTarget;
    await sleep(200);
    const seekedTo = media.currentTime;
    const backButton = button("Back to page");
    if (backButton) {
      backButton.click();
      await sleep(75);
    } else if (!document.querySelector(".teacher-offline-book")) {
      throw new Error("Could not return from " + type + " activity");
    }
    await waitFor(() => document.querySelector(".teacher-offline-book"), "book after media activity");
    return {
      unit,
      type,
      variant,
      durationSeconds: Number(media.duration.toFixed(2)),
      playedSeconds: Number((playedTo - before).toFixed(2)),
      seekedToSeconds: Number(seekedTo.toFixed(2)),
    };
  };

  const timings = {};
  await waitFor(
    () => document.querySelector(".teacher-offline-library, .teacher-offline-book"),
    "initial teacher view",
    30000,
  );
  for (let attempts = 0; !document.querySelector(".teacher-offline-library") && attempts < 3; attempts += 1) {
    if (button("Back to page")) await click("Back to page");
    else if (button("Library")) await click("Library");
    else throw new Error("Could not return to the classroom library");
    await sleep(150);
  }
  if (!document.querySelector(".teacher-offline-library")) throw new Error("Classroom library did not open");
  if (!document.querySelector(".teacher-offline-library .classroom-teaching-toolbar")) throw new Error("Launcher classroom toolbar is missing");
  if (!document.querySelector(".teacher-offline-library > .legacy-home-settings-button")) throw new Error("Launcher bottom-right settings control is missing");
  if (!document.querySelector(".legacy-home-topbar .legacy-home-close-button")) throw new Error("Launcher close control is missing");
  if (document.querySelector('[aria-label^="Minimize"]')) throw new Error("Launcher minimize control still exists");
  timings.bookOpenMs = await (async () => {
    const started = performance.now();
    await click("Lights, Camera, Action!");
    await waitFor(() => document.querySelector(".teacher-offline-book"), "book");
    return Math.round(performance.now() - started);
  })();

  let maximumMountedPages = 0;
  const pageSwitchTimes = [];
  for (let index = 0; index < 30; index += 1) {
    const unit = index % 2 + 1;
    await click("Unit " + unit);
    if (!document.querySelector(".teacher-offline-pages")) await click("Book pages");
    const pages = [...document.querySelectorAll(".teacher-unit-page-card")];
    const started = performance.now();
    pages[index % pages.length].querySelector(".teacher-unit-page-open").click();
    await waitFor(() => {
      const image = document.querySelector(".teacher-offline-page-image img");
      return image?.complete && image.naturalWidth > 0;
    }, "page image");
    pageSwitchTimes.push(Math.round(performance.now() - started));
    maximumMountedPages = Math.max(maximumMountedPages, document.querySelectorAll(".teacher-offline-page-image img").length);
  }

  await click("Unit 1");
  await click("Contents / Exercises");
  await waitFor(() => document.querySelectorAll(".teacher-offline-lessons article").length === 38, "Unit 1 contents");
  const unit1Count = document.querySelectorAll(".teacher-offline-lessons article").length;
  for (let index = 0; index < 10; index += 1) await openArticle(index);
  await click("Unit 2");
  await waitFor(() => document.querySelectorAll(".teacher-offline-lessons article").length === 40, "Unit 2 contents");
  const unit2Count = document.querySelectorAll(".teacher-offline-lessons article").length;
  for (let index = 0; index < 10; index += 1) await openArticle(index);

  const media = [];
  media.push(await openMediaActivity(1, "Reading · Exercise 1", "video"));
  media.push(await openMediaActivity(1, "Reading · Exercise 2", "audio", ".legacy-pilot-main-audio audio"));
  media.push(await openMediaActivity(1, "Reading · Exercise 2", "audio", ".legacy-pilot-highlight-player audio", "publisher-highlight"));
  media.push(await openMediaActivity(2, "Reading · Exercise 1", "video"));
  media.push(await openMediaActivity(2, "Reading · Exercise 2", "audio"));

  const visibleControls = [...document.querySelectorAll("button, input, select, textarea")]
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
    });
  const smallestTouchTarget = visibleControls.reduce((smallest, element) => {
    const rect = element.getBoundingClientRect();
    return Math.min(smallest, rect.width, rect.height);
  }, Infinity);

  return {
    unit1Count,
    unit2Count,
    enabled: unit1Count + unit2Count,
    pageSwitches: pageSwitchTimes.length,
    pageSwitchAverageMs: Math.round(pageSwitchTimes.reduce((sum, value) => sum + value, 0) / pageSwitchTimes.length),
    pageSwitchMaximumMs: Math.max(...pageSwitchTimes),
    maximumMountedPages,
    activityOpenCloseCycles: 20,
    media,
    smallestVisibleTouchTargetPx: Math.round(smallestTouchTarget),
    timings,
    location: location.hash,
  };
})()
`;

const viewportScenario = String.raw`
(async () => {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const waitFor = async (predicate, label, timeout = 15000) => {
    const started = performance.now();
    while (!predicate()) {
      if (performance.now() - started > timeout) throw new Error("Timed out waiting for " + label);
      await sleep(50);
    }
  };
  const button = (label) => [...document.querySelectorAll("button")]
    .find((candidate) => candidate.textContent.replace(/\s+/g, " ").trim().includes(label));
  await waitFor(() => innerWidth > innerHeight, "landscape viewport", 30000);
  while (!document.querySelector(".teacher-offline-library")) {
    const back = button("Back to page") || button("Library");
    if (!back) break;
    back.click();
    await sleep(100);
  }
  [...document.querySelectorAll("button")].find((candidate) => candidate.getAttribute("aria-label")?.startsWith("Open Unit 1:"))?.click();
  await waitFor(() => document.querySelector(".teacher-offline-book"), "book");
  if (!document.querySelector(".teacher-offline-pages")) {
    button("Book pages")?.click();
    await waitFor(() => document.querySelector(".teacher-offline-pages"), "book pages");
  }
  button("Unit 2")?.click();
  await waitFor(
    () => [...document.querySelectorAll(".teacher-unit-page-card")]
      .some((candidate) => candidate.textContent.includes("pg 20-21")),
    "Unit 2 pages",
  );
  const targetPage = [...document.querySelectorAll(".teacher-unit-page-card")]
    .find((candidate) => candidate.textContent.includes("pg 20-21"));
  targetPage?.querySelector(".teacher-unit-page-open").click();
  await waitFor(() => document.querySelector(".teacher-offline-page-image img")?.naturalWidth > 0, "hotspot page");

  const stage = document.querySelector(".teacher-offline-page-stage");
  const pageImage = document.querySelector(".teacher-offline-page-image");
  const zoomButton = document.querySelector('[aria-label="Zoom"]');
  const dimensions = () => {
    const stageRect = stage.getBoundingClientRect();
    const pageRect = pageImage.getBoundingClientRect();
    return {
      stageWidth: Math.round(stageRect.width),
      stageHeight: Math.round(stageRect.height),
      pageWidth: Math.round(pageRect.width),
      pageHeight: Math.round(pageRect.height),
    };
  };

  const defaultFit = pageImage.dataset.fitMode;
  const fitPage = { mode: pageImage.dataset.fitMode, ...dimensions() };
  zoomButton.click();
  await sleep(50);
  const overlay = document.querySelector(".classroom-tools-overlay");
  const stageRect = overlay.getBoundingClientRect();
  overlay.setPointerCapture = () => {};
  overlay.hasPointerCapture = () => true;
  overlay.releasePointerCapture = () => {};
  overlay.dispatchEvent(new PointerEvent("pointerdown", {
    bubbles: true, pointerId: 91, buttons: 1,
    pointerType: "touch", isPrimary: true,
    clientX: stageRect.left + stageRect.width * .2, clientY: stageRect.top + stageRect.height * .2,
  }));
  for (let step = 1; step <= 4; step += 1) {
    overlay.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, pointerId: 91, buttons: 1,
      pointerType: "touch", isPrimary: true,
      clientX: stageRect.left + stageRect.width * (.2 + step * .1),
      clientY: stageRect.top + stageRect.height * (.2 + step * .1),
    }));
    await sleep(20);
  }
  overlay.dispatchEvent(new PointerEvent("pointerup", {
    bubbles: true, pointerId: 91,
    pointerType: "touch", isPrimary: true,
    clientX: stageRect.left + stageRect.width * .6, clientY: stageRect.top + stageRect.height * .6,
  }));
  await sleep(50);
  const regionScale = document.querySelector(".classroom-stage-transform")?.dataset.regionZoomScale || null;
  if (!(Number(regionScale) > 1)) throw new Error("Touch region zoom did not activate: " + regionScale);
  zoomButton.click();
  await sleep(50);
  if (document.querySelector(".classroom-stage-transform.region-zoom-active")) throw new Error("Touch region zoom did not reset");
  const toolbarButtonCount = document.querySelectorAll(".classroom-teaching-toolbar .legacy-teacher-tool-button").length;
  const selectedToolbarButtonCount = document.querySelectorAll('.classroom-teaching-toolbar [aria-pressed="true"]').length;
  if (toolbarButtonCount !== 18 || selectedToolbarButtonCount !== 1) throw new Error("Invalid toolbar state: " + toolbarButtonCount + "/" + selectedToolbarButtonCount);
  return {
    innerWidth,
    innerHeight,
    visualWidth: Math.round(visualViewport?.width || 0),
    visualHeight: Math.round(visualViewport?.height || 0),
    devicePixelRatio,
    orientation: innerWidth >= innerHeight ? "landscape" : "portrait",
    profile: document.documentElement.dataset.teacherViewport,
    defaultFit,
    fitPage,
    regionScale,
    toolbarButtonCount,
    selectedToolbarButtonCount,
    hotspotCount: pageImage.querySelectorAll(".teacher-offline-page-hotspot").length,
    mountedPageImages: document.querySelectorAll(".teacher-offline-page-image img").length,
  };
})()
`;

try {
  await command("Runtime.enable");
  await command("Network.enable");
  const viewportOnly = process.env.ANDROID_DEVICE_VIEWPORT_ONLY === "1";
  const result = await evaluate(viewportOnly ? viewportScenario : scenario);
  if (viewportOnly) {
    console.log(JSON.stringify({ status: "passed", viewport: result }, null, 2));
    socket.close();
    process.exit(0);
  }
  let lifecycle = { tested: false };
  if (process.env.ANDROID_ADB) {
    const mediaStarted = await evaluate(String.raw`
      (async () => {
        const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const click = (label) => [...document.querySelectorAll("button")]
          .find((candidate) => candidate.textContent.replace(/\s+/g, " ").trim().includes(label))?.click();
        click("Unit 2");
        click("Contents / Exercises");
        await sleep(100);
        const article = [...document.querySelectorAll(".teacher-offline-lessons article")]
          .find((candidate) => candidate.querySelector("strong")?.textContent.trim() === "Reading · Exercise 2");
        article.querySelector("button").click();
        for (let attempt = 0; attempt < 200 && !document.querySelector("audio"); attempt += 1) await sleep(50);
        const media = document.querySelector("audio");
        for (let attempt = 0; attempt < 600 && media.readyState < 1; attempt += 1) await sleep(50);
        await media.play();
        await sleep(500);
        return !media.paused;
      })()
    `);
    assert.equal(mediaStarted, true, "Lifecycle audio did not start");
    await runFile(process.env.ANDROID_ADB, adbArguments("shell", "input", "keyevent", "3"));
    await new Promise((resolve) => setTimeout(resolve, 750));
    await runFile(process.env.ANDROID_ADB, adbArguments(
      "shell", "am", "start", "-n", "com.eduforge.offlinebooks/.MainActivity",
    ));
    await new Promise((resolve) => setTimeout(resolve, 750));
    // Physical WebView debugging can suspend while the app is backgrounded.
    // Query after resume and verify that media stayed paused across the cycle.
    const pausedInBackground = await evaluate("document.querySelector('audio')?.paused === true");
    const pausedAfterResume = await evaluate("document.querySelector('audio')?.paused === true");
    assert.equal(pausedInBackground, true, "Audio continued while the app was backgrounded");
    assert.equal(pausedAfterResume, true, "Audio resumed without an explicit user action");
    const restartedForLock = await evaluate(String.raw`
      (async () => {
        const media = document.querySelector("audio");
        await media.play();
        await new Promise((resolve) => setTimeout(resolve, 400));
        return !media.paused;
      })()
    `);
    assert.equal(restartedForLock, true, "Lock-screen audio did not start");
    await runFile(process.env.ANDROID_ADB, adbArguments("shell", "input", "keyevent", "26"));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await runFile(process.env.ANDROID_ADB, adbArguments("shell", "input", "keyevent", "26"));
    await runFile(process.env.ANDROID_ADB, adbArguments("shell", "input", "keyevent", "82"));
    await runFile(process.env.ANDROID_ADB, adbArguments(
      "shell", "am", "start", "-n", "com.eduforge.offlinebooks/.MainActivity",
    ));
    await new Promise((resolve) => setTimeout(resolve, 750));
    // Some physical WebViews suspend the debugger while locked, so query only
    // after wake; a paused state here proves lock did not leave or resume media.
    const pausedWhileLocked = await evaluate("document.querySelector('audio')?.paused === true");
    const pausedAfterUnlock = await evaluate("document.querySelector('audio')?.paused === true");
    assert.equal(pausedWhileLocked, true, "Audio continued while the screen was locked");
    assert.equal(pausedAfterUnlock, true, "Audio resumed without an explicit action after unlock");
    lifecycle = {
      tested: true,
      pausedInBackground,
      pausedAfterResume,
      pausedWhileLocked,
      pausedAfterUnlock,
    };
  }
  assert.equal(result.unit1Count, 38);
  assert.equal(result.unit2Count, 40);
  assert.equal(result.enabled, 78);
  assert.equal(result.maximumMountedPages, 1);
  assert.ok(result.smallestVisibleTouchTargetPx >= 48, "A visible teacher control is smaller than 48px");
  const forbiddenRequests = networkUrls.filter((url) => (
    /^(?:https?|wss?):/i.test(url) && !url.startsWith("https://localhost")
  ));
  assert.deepEqual(forbiddenRequests, []);
  assert.deepEqual(consoleErrors, []);
  console.log(JSON.stringify({
    status: "passed",
    target: { title: target.title, url: target.url },
    ...result,
    observedRequests: networkUrls.length,
    externalRequests: forbiddenRequests.length,
    consoleErrors: consoleErrors.length,
    lifecycle,
  }, null, 2));
} finally {
  socket.close();
}
