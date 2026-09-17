import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";
import worker from "../../cloudflare/lms/worker.js";
import { sessionCookieName } from "../../netlify/functions/_auth-utils.js";
import { captureNativeMarkerResponses, createNativeMarkerServer, closeNativeMarkerBrowser } from "./_native-marker-browser-lifecycle.mjs";

export async function verifyNativeMarkerAssignmentBrowser({ pool, token, assignmentId, pair }) {
 const root = resolve("dist"); await readFile(resolve(root, "index.html"));
 const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png" };
 const failures = [];
 const bridge = createNativeMarkerServer(async (req, res) => {
   const chunks = []; for await (const chunk of req) chunks.push(chunk);
   const request = new Request(`http://127.0.0.1:${server.address().port}${req.url}`, { method: req.method, headers: req.headers, ...(!["GET", "HEAD"].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
   const response = await worker.fetch(request, { ASSETS: { fetch: async (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname); const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(`${root}${sep}`)) return new Response("Not found", { status: 404 });
    try { return new Response(await readFile(file), { headers: { "Content-Type": types[extname(file)] || "application/octet-stream" } }); } catch { return new Response("Not found", { status: 404 }); }
   } } });
   res.writeHead(response.status, Object.fromEntries(response.headers));
   if (response.body) await pipeline(Readable.fromWeb(response.body), res);
   else await new Promise((done) => res.end(done));
 });
 const { server } = bridge;
 await new Promise((done) => server.listen(0, "127.0.0.1", done)); const origin = `http://127.0.0.1:${server.address().port}`;
 let browser, capture, scenarioError;
 try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: sessionCookieName, value: token, url: origin, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage(); page.on("pageerror", (error) => failures.push(error.message));
  const markerBytes = await sharp({ create: { width: 120, height: 3, channels: 3, background: "#be2030" } }).png().toBuffer();
  const markerChecksum = pair.publicDocument.assets.find((asset) => asset.slot === "graphic").checksumSha256;
  const bytes = await sharp({ create: { width: 1024, height: 582, channels: 3, background: "#d5e5ed" } }).png().toBuffer();
  // Only media bytes are synthetic. All assignment/auth/submit/review requests
  // go through the real Cloudflare Worker and isolated PostgreSQL handlers.
  await page.route("**/*action=published-release-asset*", (route) => route.fulfill({ contentType: "image/png", body: new URL(route.request().url()).searchParams.get("sha256") === markerChecksum ? markerBytes : bytes }));
  capture = captureNativeMarkerResponses(page);
  await page.goto(`${origin}/#/student/assignments/${assignmentId}`);
  const first = page.getByRole("button", { name: "Correct target", exact: true }); const second = page.getByRole("button", { name: "Wrong graphic", exact: true });
  await expect(first).toBeVisible();
  const assertTransparentTargets = async () => {
   const targetStyle = await first.evaluate((node) => { const s = getComputedStyle(node); return { background: s.backgroundColor, padding: s.padding, border: s.borderWidth }; });
   assert.deepEqual(targetStyle, { background: "rgba(0, 0, 0, 0)", padding: "0px", border: "0px" });
   const circle = await page.getByRole("button", { name: "Excerpt 1", exact: true }).evaluate((node) => { const r = node.getBoundingClientRect(), stage = node.parentElement.getBoundingClientRect(), s = getComputedStyle(node); return { logicalWidth: r.width / stage.width * 1024, logicalHeight: r.height / stage.height * 582, padding: s.padding }; });
   assert.ok(Math.abs(circle.logicalWidth - 20) < .1 && Math.abs(circle.logicalHeight - 20) < .1, JSON.stringify(circle)); assert.equal(circle.padding, "0px");
  };
  await assertTransparentTargets();
  await page.getByRole("button", { name: "Marker 1: graphic" }).click(); await first.click();
  await page.getByRole("button", { name: "Marker 2: outline" }).click(); await second.click();
  let failedOnce = false;
  await page.route("**/*action=submit", async (route) => { if (!failedOnce) { failedOnce = true; return route.fulfill({ status: 503, json: { error: "Isolated retry fixture" } }); } return route.continue(); });
  const submit = async () => { await page.getByRole("button", { name: "Submit assignment", exact: true }).click(); await page.getByRole("button", { name: "Submit final answers", exact: true }).click(); };
  await submit(); await expect(page.getByText("Isolated retry fixture", { exact: true })).toBeVisible(); await expect(first).toHaveAttribute("aria-pressed", "true"); await expect(second).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Submit final answers", exact: true })).toBeEnabled(); await Promise.all([page.waitForResponse((response) => response.url().includes("action=submit") && response.status() === 200), page.getByRole("button", { name: "Submit final answers", exact: true }).click()]);
  await expect(page.getByRole("button", { name: "Submit assignment", exact: true })).toHaveCount(0);
  const stored = (await pool.query("select response_payload,score_percent,status from activity_submissions where activity_assignment_id=$1", [assignmentId])).rows;
  assert.equal(stored.length, 1); assert.equal(Number(stored[0].score_percent), 100); assert.equal(stored[0].status, "submitted");
  const panel = pair.publicDocument.parts[0].interaction.presentation.panels[0]; const marks = stored[0].response_payload.items[0].markers;
  assert.notEqual(marks[panel.hotspots[0].targetId], marks[panel.hotspots[1].targetId]);
  await capture.drain();
  await page.reload(); await expect(first).toBeDisabled(); await expect(first).toHaveAttribute("aria-pressed", "true"); await expect(second).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.native-mark-words-stage [data-marker-kind="outline"]')).toHaveCount(1);
  await expect(page.locator('.native-mark-words-stage .native-mark-words-graphic')).toHaveCount(1);
  await assertTransparentTargets();
  await expect(page.locator(".app-intro-overlay")).toHaveCount(0); await first.scrollIntoViewIfNeeded();
  await mkdir("test-results/native-runtime-regressions", { recursive: true }); await page.screenshot({ path: "test-results/native-runtime-regressions/student-marker-submitted-review.png", fullPage: true });
 } catch (error) { scenarioError = error; }
 finally {
  try { await closeNativeMarkerBrowser({ capture, bridge, browser }); }
  catch (error) { scenarioError = scenarioError ? new AggregateError([scenarioError, error], "Native marker scenario and teardown failed") : error; }
 }
 if (scenarioError) throw scenarioError;
 assert.ok(capture.payloads.length > 0, "Student JSON responses must actually be inspected");
 assert.doesNotMatch(capture.payloads.join("\n"), /correctTargetIds|correctWordIds/); assert.deepEqual(failures, []);
 console.log("Native markers actual LMS browser: final Submit failure/retry, persisted 100%, per-target styles and reloaded read-only review passed.");
}
