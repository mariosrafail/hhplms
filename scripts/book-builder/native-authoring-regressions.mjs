import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function exerciseIntegerHotspotCoordinates(audioEditor, panelIndex) {
    const xInput = audioEditor.getByLabel("Activity hotspot X", { exact: true });
    const yInput = audioEditor.getByLabel("Activity hotspot Y", { exact: true });
    await expect.poll(() => audioEditor.evaluate((editor) => {
      const input = editor.querySelector('[aria-label="Activity hotspot X"]');
      const marker = editor.querySelector(".native-audio-hotspot-authoring-marker");
      const width = Number(input.max) / (1 - Number.parseFloat(marker.style.width) / 100);
      return Math.abs(Number(input.value) - width * Number.parseFloat(marker.style.left) / 100) < .01;
    })).toBe(true);
    const originalX = await xInput.inputValue(); const originalY = await yInput.inputValue();
    assert.ok(Number.isInteger(Number(originalX)) && Number.isInteger(Number(originalY)));
    await xInput.fill(""); await xInput.blur(); assert.equal(await xInput.inputValue(), originalX);
    await xInput.fill("99999"); await xInput.press("Enter"); assert.equal(await xInput.inputValue(), await xInput.getAttribute("max"));
    await xInput.fill(originalX); await xInput.press("Enter");
    await yInput.fill("-5"); await yInput.blur(); assert.equal(await yInput.inputValue(), "0");
    await yInput.fill("210.4"); await yInput.press("Enter"); assert.equal(await yInput.inputValue(), "210"); if (panelIndex) { await yInput.fill(originalY); await yInput.blur(); }
}

export async function openStudentsUnitOnePage(viewer, navigation = null) {
  const wait = (operation) => navigation ? navigation.wait(operation) : operation; const click = (locator, description) => navigation ? navigation.click(locator, description) : locator.click();
  await wait(viewer.locator(".teacher-offline-library").waitFor()); assert.equal(await wait(viewer.getByRole("button", { name: "Students Book", exact: true }).getAttribute("aria-pressed")), "true");
  await click(viewer.getByRole("button", { name: /^Open Unit 1:/ }), "Open Unit 1"); await wait(viewer.getByRole("heading", { name: "Unit 1", exact: true }).waitFor());
  await click(viewer.locator(".teacher-unit-page-open").first(), "Student Unit 1 page card"); await wait(viewer.locator(".teacher-offline-page-stage").waitFor());
}

export async function exerciseAuthoredSizeSaveReload(page, savedDocument, orderPages) {
  await Promise.all([page.waitForResponse((response) => response.url().endsWith("/save") && response.request().method() === "POST"), page.getByRole("button", { name: "Save Draft", exact: true }).click()]);
  await page.getByText("Draft saved.", { exact: true }).waitFor();
  const saved = savedDocument();
  const presentation = saved.parts[0].interaction.questions.find((question) => question.responseRegion.ariaLabel === "Response for question 1").responseRegion.presentation;
  assert.equal(presentation.answerSizeMode, "authored", JSON.stringify(saved.parts[0].interaction.questions.map((question) => ({ id: question.id, presentation: question.responseRegion.presentation }))));
  assert.equal(presentation.answerFontSizeMax, 100);
  await exercisePersistedActivityOrder(page, saved.activityId, orderPages);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: new RegExp(saved.activityId) }).click();
  await page.getByRole("tab", { name: "Layout", exact: true }).click();
  await page.getByRole("button", { name: "Response for question 1", exact: true }).click();
  const controls = page.getByRole("group", { name: "Response region quick controls" });
  assert.equal(await controls.getByLabel("Requested answer size").inputValue(), "100");
  assert.equal(await controls.getByLabel("Answer sizing", { exact: true }).inputValue(), "authored");
  // Continue the independent legacy geometry/fit scenarios at their authored size.
  await controls.getByLabel("Answer sizing", { exact: true }).selectOption("auto-fit");
  await controls.getByLabel("Requested answer size").fill("28");
  await controls.getByLabel("Requested answer size").press("Enter");
}

export async function exerciseExternalActivityNavigation(viewer) {
  const previous = viewer.getByRole("button", { name: "Previous activity", exact: true });
  const next = viewer.getByRole("button", { name: "Next activity", exact: true });
  assert.equal(await previous.isDisabled(), false);
  assert.equal(await next.isDisabled(), false);
  await next.click();
  await viewer.locator(".native-image-surface").waitFor();
  await previous.click();
  await viewer.getByText("First prompt", { exact: true }).waitFor();
  assert.equal(await viewer.getByText("First private model answer", { exact: true }).count(), 0);
}

export async function exercisePersistedActivityOrder(page, activityId, orderPages) {
  const pageId = "ub2-sb-unit-1-part-1";
  const before = [...orderPages()[pageId]];
  const position = before.indexOf(activityId);
  assert.ok(position > 0);
  await page.locator(".activity-builder-navigation-toggle").focus();
  await page.getByLabel("Search activities").fill(activityId);
  const row = page.locator(".activity-tree-item-row").filter({ has: page.locator(`button[title="${activityId}"]`) });
  await Promise.all([page.waitForResponse((response) => response.url().endsWith("/order") && response.request().method() === "GET"), row.getByRole("button", { name: /^Move Up:/ }).click()]);
  const expected = [...before]; [expected[position - 1], expected[position]] = [expected[position], expected[position - 1]];
  assert.deepEqual(orderPages()[pageId], expected, "filtered reorder swaps one authoritative neighbor and preserves every hidden record");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(`button[title="${activityId}"]`).waitFor();
  assert.deepEqual(await page.locator(".activity-tree-items").first().locator(".activity-tree-item-row > button").evaluateAll((buttons) => buttons.map((button) => button.title)), expected);
  const first = page.locator(".activity-tree-item-row").filter({ has: page.locator(`button[title="${expected[0]}"]`) });
  const last = page.locator(".activity-tree-item-row").filter({ has: page.locator(`button[title="${expected.at(-1)}"]`) });
  assert.equal(await first.getByRole("button", { name: /^Move Up:/ }).isDisabled(), true);
  assert.equal(await last.getByRole("button", { name: /^Move Down:/ }).isDisabled(), true);
  await page.locator(".activity-builder-navigation-toggle").focus();
  await Promise.all([page.waitForResponse((response) => response.url().endsWith("/order") && response.request().method() === "GET"), row.getByRole("button", { name: /^Move Down:/ }).click()]);
  assert.deepEqual(orderPages()[pageId], before);
}
