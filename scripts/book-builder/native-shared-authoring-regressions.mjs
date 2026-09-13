import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import sharp from "sharp";
import { sharedFive, sharedFiveTeacher } from "../../tests/fixtures/native-runtime-regressions/shared-five-data.js";
import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from "../../src/data/native-activities/nativeActivityRuntimeValidation.js";

export async function runSharedAuthoringRegressions(browser, baseUrl, output) {
 const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }); page.setDefaultTimeout(15000);
 const errors = []; page.on("pageerror", (error) => errors.push(error.message));
 let pair = structuredClone({ publicDocument: sharedFive, teacherDocument: sharedFiveTeacher });
 for (const entry of pair.publicDocument.parts[0].interaction.sections) entry.title = entry.kind;
 const image = await sharp({ create: { width: 1100, height: 650, channels: 3, background: "#d9eaf1" } }).png().toBuffer();
 let uploadSlot; let saved = false;
 await page.route("**/builder/api/**", async (route) => {
   const url = new URL(route.request().url());
   if (url.pathname.endsWith("/fonts")) return route.fulfill({ json: { fonts: [] } });
   if (url.pathname.endsWith("/preview")) return route.fulfill({ contentType: "image/png", body: image });
   if (url.pathname.includes("/native-activity-public/")) return route.fulfill({ json: { document: pair.publicDocument, revision: 1 } });
   if (url.pathname.includes("/native-activity-teacher/")) return route.fulfill({ json: { document: pair.teacherDocument, revision: 1 } });
   if (url.pathname.endsWith("/prepare")) { uploadSlot = route.request().postDataJSON().assetSlot; return route.fulfill({ json: { uploadId: "test-upload", authorization: { url: `${baseUrl}fixture-upload`, headers: {} } } }); }
   if (url.pathname.endsWith("/finalize")) return route.fulfill({ json: { reference: { slot: uploadSlot, assetId: "10000000-0000-4000-8000-000000000003", checksumSha256: "c".repeat(64), role: "activity_artwork" }, metadata: { width: 1100, height: 650 } } });
   if (url.pathname.endsWith("/save")) {
     const input = route.request().postDataJSON(); const pub = normalizeNativeRuntimePublicDocument(input.publicDocument, { activityId: sharedFive.activityId, kind: "multi-part" });
     const teacher = normalizeNativeRuntimeTeacherDocument(input.teacherDocument, { publicDocument: pub, activityId: sharedFive.activityId, kind: "multi-part" });
     pair = { publicDocument: pub, teacherDocument: teacher }; saved = true;
     return route.fulfill({ json: { ...pair, publicRevision: 2, teacherRevision: 2 } });
   }
   return route.fulfill({ status: 404, json: {} });
 });
 await page.route("**/fixture-upload", (route) => route.fulfill({ status: 200 }));
 try {
   await page.goto(`${baseUrl}tests/fixtures/native-runtime-regressions/shared-five.html?parent-editor`);
   const editor = page.locator(".native-multi-part-editor");
   const select = (kind) => editor.getByRole("button", { name: kind, exact: true }).click();
   await select("drag-drop");
   const randomize = editor.locator(".native-drag-drop-editor:visible").getByRole("checkbox", { name: "Randomize", exact: true });
   await expect(randomize).toBeChecked();
   await randomize.uncheck();
   await select("single-choice");
   const choice = editor.locator(".native-single-choice-editor:visible");
   const bulk = choice.locator(".native-bulk-generator"); await bulk.locator("summary").click();
   const pending = bulk.locator("textarea");
   await pending.fill("1. Uncommitted text\n*Yes\nNo");
   await select("mark-the-words");
   await editor.getByRole("button", { name: "Word hotspot 1", exact: true }).click();
   await editor.getByLabel("Target label", { exact: true }).fill("Unsaved target label");
   await editor.getByRole("tab", { name: "Shared media", exact: true }).click();
   await editor.getByRole("tab", { name: "Compose", exact: true }).click();
   await select("single-choice");; await expect(pending).toHaveValue("1. Uncommitted text\n*Yes\nNo");
   await editor.getByLabel("Shared background", { exact: true }).setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: image });
   await expect(editor.getByText(/Shared background uploaded/)).toBeVisible();
   await expect(pending).toHaveValue("1. Uncommitted text\n*Yes\nNo");
   await select("open-response");
   await editor.locator(".native-or-editor:visible").locator(".native-or-question-editor > label > textarea").first().fill("Unsaved explanation");
   await select("complete-sentences");
   await expect(editor.locator(".native-single-choice-editor:visible")).toBeVisible();
   await select("mark-the-words");
   await expect(editor.getByLabel("Target label", { exact: true })).toHaveValue("Unsaved target label");
   await editor.getByRole("button", { name: "Save Draft", exact: true }).click();
   await expect.poll(() => saved).toBe(true);
   const sections = pair.publicDocument.parts[0].interaction.sections;
   assert.equal(sections.find((entry) => entry.kind === "drag-drop").interaction.randomize, false);
   assert.equal(sections.find((entry) => entry.kind === "open-response").interaction.questions[0].prompt, "Unsaved explanation");
   assert.equal(sections.find((entry) => entry.kind === "mark-the-words").interaction.targets[0].label, "Unsaved target label");
   assert.deepEqual(pair.publicDocument.parts[0].interaction.panels[0].surface, { width: 1100, height: 650 });
   // The original image also supplies the DD item, so it is still a live dependency.
   assert.equal(pair.publicDocument.assets.some((asset) => asset.slot === "shared"), true);
   assert.equal(pair.publicDocument.assets.some((asset) => asset.slot === uploadSlot), true);
   await page.screenshot({ path: `${output}/shared-five-authoring.png`, fullPage: true });
   await page.reload(); await select("mark-the-words"); await editor.getByRole("button", { name: "Word hotspot 1", exact: true }).click();
   await expect(editor.getByLabel("Target label", { exact: true })).toHaveValue("Unsaved target label");
   await select("drag-drop"); await expect(randomize).not.toBeChecked();
   assert.deepEqual(errors, []);
 } catch (error) { await writeFile(`${output}/shared-authoring-failure.txt`, JSON.stringify({ errors, text: await page.locator("body").innerText() }, null, 2)); throw error; } finally { await page.close(); }
}
