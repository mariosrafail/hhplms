import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";

const expectedTabs = ["Content", "Visual", "Audio & Timeline", "Page Mapping", "Answer Key", "Readable Text", "Video", "Local Preview"];
const exactCueFragments = [
  ["...our lives.", "What", "Let's first take a look at TV series.", "Most series are"],
  ["The middle sentence follows its mapped highlight."],
  [undefined],
];

function closeEnough(left, right, tolerance = .01) { return Math.abs(left - right) <= tolerance; }

export async function importOldschoolExactTranscriptMapping(page) {
  await page.getByRole("tab", { name: "Audio & Timeline" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export mapping JSON" }).click();
  const download = await downloadPromise; const mappingPath = await download.path(); assert.ok(mappingPath);
  const mapping = JSON.parse(await readFile(mappingPath, "utf8"));
  assert.deepEqual(mapping.cues.map((cue) => cue.highlightRegions.length), [4, 1, 1]);
  assert.deepEqual(mapping.cues.map((cue) => cue.scrollY), [null, null, 1450]);
  mapping.cues.forEach((cue, cueIndex) => {
    if (cueIndex < 2) { cue.highlightRegions.forEach((region, regionIndex) => { region.text = exactCueFragments[cueIndex][regionIndex]; }); cue.text = exactCueFragments[cueIndex].join(" "); }
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('.native-oldschool-listening-editor input[type=file][accept*="application/json"]').setInputFiles({ name: "oldschool-exact-mapping.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(mapping)) });
  await page.getByText("3 canonical JSON cues imported.", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Page Mapping" }).click();
  assert.equal(await page.locator(".native-oldschool-mapping-region").count(), 6);
}

async function assertCompleteTranscript(surface, interaction) {
  const fragments = surface.locator(".native-oldschool-listening-transcript-fragment");
  const expectedCount = interaction.cues.reduce((count, cue) => count + cue.highlightRegions.length, 0);
  await fragments.nth(expectedCount - 1).waitFor();
  assert.equal(await fragments.count(), expectedCount);
  assert.equal(await fragments.evaluateAll((entries) => entries.every((entry) => entry.getClientRects().length > 0 && getComputedStyle(entry).visibility === "visible")), true);
  for (const cue of interaction.cues) {
    const text = await surface.locator(`.native-oldschool-listening-transcript-fragment[data-cue-id="${cue.id}"]`).allTextContents();
    assert.equal(text.map((value) => value.trim()).filter(Boolean).join(" "), cue.text);
  }
}

async function exactPresentationMetrics(surface) {
  return surface.evaluate((root) => {
    const canvas = root.querySelector(".native-oldschool-listening-page-canvas"); const canvasRect = canvas.getBoundingClientRect();
    const normalized = (rect) => ({ x: (rect.left - canvasRect.left) / canvasRect.width, y: (rect.top - canvasRect.top) / canvasRect.height, width: rect.width / canvasRect.width, height: rect.height / canvasRect.height, right: (rect.right - canvasRect.left) / canvasRect.width });
    const fragments = [...root.querySelectorAll('.native-oldschool-listening-transcript-fragment[data-exact="true"]')].map((fragment) => {
      const line = fragment.firstElementChild; const text = fragment.querySelector(".native-oldschool-listening-exact-text"); const style = getComputedStyle(line); const highlightStyle = getComputedStyle(text); const range = document.createRange(); range.selectNodeContents(text);
      const textRect = text.getBoundingClientRect(); const rangeRect = range.getBoundingClientRect();
      return { cueId: fragment.dataset.cueId, regionId: fragment.dataset.regionId, text: text.textContent, highlighted: fragment.dataset.highlighted === "true", fragment: normalized(fragment.getBoundingClientRect()), textBox: normalized(textRect), textWidthPx: textRect.width, rangeWidthPx: rangeRect.width, rangeLeftPx: rangeRect.left, textLeftPx: textRect.left, rectCount: text.getClientRects().length, fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight, whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap, wordBreak: style.wordBreak, backgroundColor: highlightStyle.backgroundColor, outlineWidth: highlightStyle.outlineWidth, borderWidth: highlightStyle.borderWidth, boxShadow: highlightStyle.boxShadow };
    });
    return { canvasWidth: canvasRect.width, canvasLayoutWidth: canvas.offsetWidth, fragments, fallbackHighlights: root.querySelectorAll(".native-oldschool-listening-highlight").length };
  });
}

async function assertExactPresentation(surface, interaction, expectedActiveCount) {
  await assertCompleteTranscript(surface, interaction);
  if (expectedActiveCount) await expect.poll(async () => surface.locator('.native-oldschool-listening-transcript-fragment[data-highlighted="true"] .native-oldschool-listening-exact-text').evaluateAll((entries, count) => entries.length === count && entries.every((entry) => {
    const style = getComputedStyle(entry); const range = document.createRange(); range.selectNodeContents(entry); const text = entry.getBoundingClientRect(); const content = range.getBoundingClientRect();
    return style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.outlineWidth === "0px" && style.borderWidth === "0px" && style.boxShadow === "none" && Math.abs(text.width - content.width) <= 3 && Math.abs(text.left - content.left) <= 3;
  }), expectedActiveCount)).toBe(true);
  const metrics = await exactPresentationMetrics(surface); const expectedCount = interaction.cues.reduce((count, cue) => count + cue.highlightRegions.filter((region) => typeof region.text === "string" && region.text.length > 0).length, 0);
  assert.equal(metrics.fragments.length, expectedCount); assert.equal(metrics.fallbackHighlights, 0);
  const panel = interaction.panels[1]; const responsiveScale = metrics.canvasLayoutWidth / panel.sourceWidth;
  assert.equal(metrics.fragments.every((fragment) => closeEnough(Number.parseFloat(fragment.fontSize), 21 * responsiveScale, .05)), true, JSON.stringify(metrics));
  assert.equal(metrics.fragments.every((fragment) => closeEnough(Number.parseFloat(fragment.lineHeight), 31 * responsiveScale, .05)), true, JSON.stringify(metrics));
  assert.equal(metrics.fragments.every((fragment) => fragment.fontWeight === "400" && fragment.whiteSpace === "nowrap" && fragment.overflowWrap === "normal" && fragment.wordBreak === "normal" && fragment.rectCount === 1), true, JSON.stringify(metrics));
  assert.equal(metrics.fragments.filter((fragment) => fragment.highlighted).length, expectedActiveCount);
  assert.equal(metrics.fragments.filter((fragment) => fragment.highlighted).every((fragment) => fragment.backgroundColor !== "rgba(0, 0, 0, 0)" && fragment.outlineWidth === "0px" && fragment.borderWidth === "0px" && fragment.boxShadow === "none" && Math.abs(fragment.textWidthPx - fragment.rangeWidthPx) <= 3 && Math.abs(fragment.textLeftPx - fragment.rangeLeftPx) <= 3), true, JSON.stringify(metrics));
  const regions = new Map(interaction.cues.flatMap((cue) => cue.highlightRegions.map((region) => [region.id, region])));
  for (const fragment of metrics.fragments) {
    const region = regions.get(fragment.regionId);
    for (const key of ["x", "y", "width", "height"]) assert.ok(closeEnough(fragment.fragment[key], region[key] / (key === "x" || key === "width" ? panel.sourceWidth : panel.sourceHeight), .003), JSON.stringify(fragment));
    assert.ok(closeEnough(fragment.textBox.x, fragment.fragment.x, .003), JSON.stringify(fragment)); assert.ok(closeEnough(fragment.textBox.y, fragment.fragment.y, .003), JSON.stringify(fragment));
  }
  const what = metrics.fragments.find((fragment) => fragment.text === "What"); assert.ok(what.textBox.width < what.fragment.width * .55, JSON.stringify(what));
  for (const [leftText, rightText] of [["...our lives.", "What"], ["Let's first take a look at TV series.", "Most series are"]]) {
    const left = metrics.fragments.find((fragment) => fragment.text === leftText); const right = metrics.fragments.find((fragment) => fragment.text === rightText);
    assert.ok(closeEnough(left.fragment.y, right.fragment.y, .003), JSON.stringify({ left, right })); assert.ok(left.textBox.right < right.textBox.x, JSON.stringify({ left, right }));
  }
  return metrics;
}

export async function exerciseOldschoolPersistentTranscript({ page, oldschoolId, nativeDocuments, publishViewerHotspot, screenshotRoot }) {
  const interaction = nativeDocuments.get(oldschoolId).publicDocument.parts[0].interaction;
  assert.deepEqual(interaction.cues.map((cue) => cue.highlightRegions.map((region) => region.text)), exactCueFragments);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByLabel("Access").selectOption("all"); await page.getByLabel("Type").selectOption("all"); await page.getByPlaceholder("Search title, type, or ID").fill(oldschoolId);
  for (let depth = 0; depth < 3; depth += 1) { await page.locator('.activity-tree-toggle[aria-expanded="false"]').evaluateAll((buttons) => buttons.forEach((button) => button.click())); await page.waitForTimeout(20); }
  await page.getByRole("button", { name: new RegExp(oldschoolId) }).click(); const editor = page.locator(".native-oldschool-listening-editor"); await editor.waitFor();
  assert.deepEqual(await editor.getByRole("tab").allTextContents(), expectedTabs);
  await page.getByRole("tab", { name: "Page Mapping" }).click(); assert.equal(await page.locator(".native-oldschool-mapping-region").count(), 6);
  await page.getByRole("tab", { name: "Local Preview" }).click(); await page.getByRole("button", { name: "Student Preview" }).click();
  const preview = page.locator(".native-or-preview .native-oldschool-listening"); await preview.waitFor();
  assert.equal(await preview.getAttribute("data-view"), "questions"); assert.equal(await preview.getByText("The speaker emphasizes the later printed detail.", { exact: true }).count(), 0);
  assert.equal(await preview.locator(".native-or-prompt").count(), 0);
  const studentResponse = preview.locator(".native-or-student-response").first(); await studentResponse.fill("Rendered in the managed font"); assert.match(await studentResponse.evaluate((element) => getComputedStyle(element).fontFamily), /hh-native-font-/);
  const playerIsolation = await preview.evaluate((root) => { const stage = root.querySelector(".native-oldschool-listening-activity-stage").getBoundingClientRect(); const player = root.querySelector(".native-oldschool-listening-player-anchor").getBoundingClientRect(); const point = { x: player.left + 8, y: player.top + 8 }; const outsidePoint = { x: player.left - 4, y: player.top + 8 }; const hit = document.elementFromPoint(point.x, point.y); const outsideHit = document.elementFromPoint(outsidePoint.x, outsidePoint.y); return { right: stage.right - player.right, bottom: stage.bottom - player.bottom, hitInside: root.querySelector(".native-oldschool-listening-player-anchor").contains(hit), outsideHitsResponse: Boolean(outsideHit?.closest(".native-or-student-response")), point, outsidePoint }; });
  assert.ok(Math.abs(playerIsolation.right - 24) < 2 && Math.abs(playerIsolation.bottom - 18) < 2, JSON.stringify(playerIsolation)); assert.equal(playerIsolation.hitInside, true);
  await page.mouse.click(playerIsolation.point.x, playerIsolation.point.y); assert.equal(await preview.locator("textarea:focus").count(), 0); assert.equal(playerIsolation.outsideHitsResponse, true); await page.mouse.click(playerIsolation.outsidePoint.x, playerIsolation.outsidePoint.y); assert.equal(await preview.locator("textarea:focus").count(), 1);
  await preview.getByLabel("Listening audio position").fill("1"); await preview.getByAltText("A full printed listening page with three highlighted passages").waitFor();
  const firstMetrics = await assertExactPresentation(preview, interaction, 4);
  await page.setViewportSize({ width: 1024, height: 768 }); await page.waitForTimeout(100); const resizedMetrics = await assertExactPresentation(preview, interaction, 4);
  assert.ok(resizedMetrics.canvasWidth < firstMetrics.canvasWidth);
  for (const first of firstMetrics.fragments) { const resized = resizedMetrics.fragments.find((fragment) => fragment.regionId === first.regionId); for (const key of ["x", "y"]) assert.ok(closeEnough(resized.fragment[key], first.fragment[key], .003) && closeEnough(resized.textBox[key], first.textBox[key], .003), JSON.stringify({ first, resized })); }
  await page.setViewportSize({ width: 1440, height: 900 });
  await preview.getByRole("button", { name: "Play Listening audio" }).click(); await preview.getByRole("button", { name: "Pause Listening audio" }).waitFor(); await assertExactPresentation(preview, interaction, 4);
  await preview.getByRole("button", { name: "Pause Listening audio" }).click(); await assertExactPresentation(preview, interaction, 4);
  await preview.locator("audio").evaluate((audio) => { Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 2.5 }); audio.dispatchEvent(new Event("timeupdate")); }); await page.waitForFunction((root) => root.querySelectorAll('.native-oldschool-listening-transcript-fragment[data-highlighted="true"]').length === 1, await preview.elementHandle()); await assertExactPresentation(preview, interaction, 1); await page.waitForTimeout(200); const laterScroll = await preview.locator(".native-oldschool-listening-page-viewport").evaluate((element) => element.scrollTop); assert.ok(laterScroll > 0); const scrollbar = page.locator(".native-or-preview .native-readable-text-presentation").getByRole("scrollbar", { name: "Synchronized listening page scroll position" }); await scrollbar.waitFor(); const scrollPlacement = await scrollbar.evaluate((element) => { const control = element.getBoundingClientRect(); const host = element.closest(".native-scroll-controls-host"); const stage = host.getBoundingClientRect(); return { right: stage.right - control.right, bottom: stage.bottom - control.bottom, scale: stage.width / host.offsetWidth }; }); assert.ok(Math.abs(scrollPlacement.right - 8 * scrollPlacement.scale) < 2 && Math.abs(scrollPlacement.bottom - 8 * scrollPlacement.scale) < 2, JSON.stringify(scrollPlacement)); assert.equal(await scrollbar.getAttribute("aria-controls"), await preview.locator(".native-oldschool-listening-page-viewport").getAttribute("id"));
  await page.emulateMedia({ reducedMotion: "reduce" }); const viewport = preview.locator(".native-oldschool-listening-page-viewport"); await viewport.evaluate((element) => { const original = element.scrollTo.bind(element); element.scrollTo = (options) => { element.dataset.acceptanceScrollBehavior = typeof options === "object" ? options.behavior : "legacy"; original(options); }; });
  await preview.locator("audio").evaluate((audio) => { audio.currentTime = 6; audio.dispatchEvent(new Event("timeupdate")); }); const fallback = preview.locator(".native-oldschool-listening-highlight"); await fallback.waitFor(); await page.waitForTimeout(100); const fallbackMetrics = await fallback.evaluate((element) => { const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); const viewportRect = element.closest(".native-oldschool-listening-page-viewport").getBoundingClientRect(); return { backgroundColor: style.backgroundColor, borderWidth: style.borderWidth, boxShadow: style.boxShadow, centerRatio: ((rect.top + rect.bottom) / 2 - viewportRect.top) / viewportRect.height }; }); assert.notEqual(fallbackMetrics.backgroundColor, "rgba(0, 0, 0, 0)"); assert.equal(fallbackMetrics.borderWidth, "0px"); assert.equal(fallbackMetrics.boxShadow, "none"); assert.ok(fallbackMetrics.centerRatio >= .2 && fallbackMetrics.centerRatio <= .7, JSON.stringify(fallbackMetrics)); assert.equal(await viewport.getAttribute("data-acceptance-scroll-behavior"), "auto"); const lateScroll = await viewport.evaluate((element) => element.scrollTop); assert.ok(lateScroll > laterScroll);
  if (screenshotRoot) await page.screenshot({ path: path.join(screenshotRoot, "native-oldschool-listening-show-text.png"), fullPage: true });
  await preview.locator("audio").evaluate((audio) => { audio.currentTime = 1; audio.dispatchEvent(new Event("timeupdate")); }); await page.waitForFunction((root) => root.querySelectorAll('.native-oldschool-listening-transcript-fragment[data-highlighted="true"]').length === 4, await preview.elementHandle()); await assertExactPresentation(preview, interaction, 4); await page.waitForTimeout(200); assert.ok(await preview.locator(".native-oldschool-listening-page-viewport").evaluate((element) => element.scrollTop) < laterScroll);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await preview.getByRole("button", { name: "Stop Listening audio" }).click(); await page.waitForFunction((root) => root.getAttribute("data-view") === "questions", await preview.elementHandle());
  await preview.getByLabel("Listening audio position").fill("1"); await assertExactPresentation(preview, interaction, 4);
  await preview.getByRole("button", { name: "Play Listening audio" }).click(); await preview.locator("audio").evaluate((audio) => audio.dispatchEvent(new Event("ended"))); await page.waitForFunction((root) => root.getAttribute("data-view") === "questions", await preview.elementHandle()); assert.match(await preview.getByLabel("Listening audio time").innerText(), /^00:00 \/ /);
  await page.locator(".native-or-preview").getByRole("button", { name: "Teacher Preview" }).click(); const teacher = page.locator(".native-or-preview .native-oldschool-listening"); await teacher.locator(".native-or-answer-layer").click({ force: true }); const answerLines = teacher.locator(".native-or-answer-line"); await answerLines.first().waitFor(); assert.equal((await answerLines.allTextContents()).join(" ").replace(/\s+/g, " ").trim(), "The speaker emphasizes the later printed detail."); assert.match(await answerLines.first().evaluate((element) => getComputedStyle(element).fontFamily), /hh-native-font-/);

  publishViewerHotspot();
  await page.locator('.hosted-builder-tool-tabs a[href$="/hotspots"]').click(); await page.reload({ waitUntil: "domcontentloaded" }); await page.getByRole("button", { name: "Review", exact: true }).click();
  const viewer = page.frameLocator(".unified-builder-review-dialog iframe"); await viewer.getByRole("button", { name: "Draft Oldschool Listening hotspot" }).click({ force: true }); const viewerSurface = viewer.locator(".native-oldschool-listening"); await viewerSurface.waitFor();
  assert.equal(await viewerSurface.getByText("The speaker emphasizes the later printed detail.", { exact: true }).count(), 0); await viewer.getByRole("button", { name: "Next activity part", exact: true }).click(); await assertExactPresentation(viewerSurface, interaction, 4);
  await page.getByRole("button", { name: "Close Review" }).click(); await page.locator('.hosted-builder-tool-tabs a[href$="/activities"]').click();
}

export async function exerciseOldschoolMultipleChoicePanel({ page, oldschoolId, nativeDocuments, screenshotRoot }) {
  const before = structuredClone(nativeDocuments.get(oldschoolId).publicDocument.parts[0].interaction);
  await page.getByRole("button", { name: new RegExp(oldschoolId) }).click(); await page.locator(".native-oldschool-listening-editor").waitFor();
  await page.getByRole("tab", { name: "Content" }).click();
  page.once("dialog", (dialog) => dialog.dismiss()); await page.getByLabel("Panel 1 activity type").selectOption("single-choice");
  assert.equal(await page.getByLabel("Panel 1 activity type").inputValue(), "open-response"); assert.equal(await page.getByRole("textbox", { name: "Prompt", exact: true }).inputValue(), "What detail does the speaker emphasize?");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Panel 1 activity type").selectOption("single-choice");
  await page.getByText(/Panel 1 changed to Multiple Choice/).waitFor();
  const fillQuestion = async (prompt, options) => {
    await page.getByRole("button", { name: "Add Question" }).click();
    const editor = page.locator(".native-or-question-editor");
    await editor.getByLabel("Prompt").fill(prompt);
    for (const [index, option] of options.entries()) await editor.getByLabel(`Option ${index + 1}`, { exact: true }).fill(option);
  };
  await fillQuestion("Which statement is correct?", ["The first statement", "The second statement"]);
  await page.getByRole("tab", { name: "Answer Key" }).click();
  await page.getByRole("checkbox", { name: "Option 2: The second statement" }).check();
  await page.getByRole("tab", { name: "Content" }).click();
  await fillQuestion("Which two details are mentioned?", ["Detail alpha", "Detail beta"]);
  await page.getByRole("button", { name: "Add Option" }).click(); await page.getByLabel("Option 3", { exact: true }).fill("Detail gamma");
  await page.getByRole("tab", { name: "Answer Key" }).click();
  await page.getByRole("checkbox", { name: "Option 1: Detail alpha" }).check(); await page.getByRole("checkbox", { name: "Option 3: Detail gamma" }).check();
  await page.getByRole("tab", { name: "Local Preview" }).click(); await page.getByRole("button", { name: "Student Preview" }).click();
  const student = page.locator(".native-oldschool-listening .native-single-choice-student"); await student.waitFor();
  await student.getByRole("radio", { name: "The second statement" }).check(); await student.getByRole("checkbox", { name: "Detail alpha" }).check(); await student.getByRole("checkbox", { name: "Detail gamma" }).check();
  assert.equal(await student.getByRole("radio", { name: "The second statement" }).isChecked(), true); assert.equal(await student.getByRole("checkbox", { name: "Detail gamma" }).isChecked(), true);
  if (screenshotRoot) await page.screenshot({ path: path.join(screenshotRoot, "native-oldschool-listening-multiple-choice.png"), fullPage: true });
  await page.getByRole("button", { name: "Teacher Preview" }).click(); const teacher = page.locator(".native-oldschool-listening .native-single-choice-teacher"); await teacher.waitFor();
  await teacher.getByRole("radio", { name: "The second statement" }).check(); await teacher.getByRole("checkbox", { name: "Detail alpha" }).check(); await teacher.getByRole("checkbox", { name: "Detail gamma" }).check();
  await page.getByRole("button", { name: "Save Draft" }).click(); await page.getByText("Draft saved.", { exact: true }).waitFor();
  const saved = nativeDocuments.get(oldschoolId); const interaction = saved.publicDocument.parts[0].interaction;
  assert.equal(interaction.questionMode, "single-choice"); assert.equal(interaction.questions.length, 2); assert.deepEqual(interaction.panels[1], before.panels[1]); assert.deepEqual(interaction.cues, before.cues); assert.deepEqual(interaction.snippetHotspots, before.snippetHotspots); assert.equal(interaction.audioAssetSlot, before.audioAssetSlot); assert.equal(interaction.audioDurationMs, before.audioDurationMs);
  assert.doesNotMatch(JSON.stringify(saved.publicDocument), /correctOptionId/); assert.match(JSON.stringify(saved.teacherDocument), /correctOptionId/);
}

export async function exerciseOldschoolQuestionVisibility(page) {
  await page.getByRole("button", { name: "Add Question" }).click(); await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("What detail does the speaker emphasize?"); await page.getByRole("tab", { name: "Answer Key" }).click(); await page.getByLabel(/Private model answer 1/).fill("The speaker emphasizes the later printed detail."); await page.getByRole("tab", { name: "Visual" }).click(); await page.locator(".native-or-editor button.native-or-response").click({ force: true }); const oldschoolResponseControls = page.getByRole("group", { name: "Response region quick controls" }); await oldschoolResponseControls.getByLabel("Answer font").selectOption({ label: "Ahem" }); await oldschoolResponseControls.getByLabel("Quick Y").fill("440");
  await oldschoolResponseControls.getByLabel("Answer sizing", { exact: true }).selectOption("authored"); await oldschoolResponseControls.getByLabel("Requested answer size", { exact: true }).fill("32"); await oldschoolResponseControls.getByLabel("Requested answer size", { exact: true }).press("Tab"); await oldschoolResponseControls.getByLabel("Answer text color", { exact: true }).fill("#224466");
  assert.equal(await page.getByRole("button", { name: "Add Show Text Hotspot", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Remove Question 1 from prompts", exact: true }).click(); assert.equal(await page.locator(".native-or-editor .native-or-prompt").count(), 0); assert.equal(await page.locator(".native-or-editor .native-or-response").count(), 1);
  await page.getByLabel("Add question prompt", { exact: true }).selectOption({ index: 1 }); assert.equal(await page.locator(".native-or-editor .native-or-prompt").count(), 1); await page.getByRole("button", { name: "Remove Question 1 from prompts", exact: true }).click();
}
