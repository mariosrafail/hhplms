import assert from "node:assert/strict";
import { expect } from "@playwright/test";

import { waitForStableGeometry } from "./playwright-layout-stability.mjs";

const canvasSelector = ".native-single-choice-hotspot-canvas";
const hotspotSelector = ".native-single-choice-authoring-hotspot";
const selectedName = "Hotspot selected";

export async function assertSingleChoicePreviewNextActionable(preview) {
  await preview.getByRole("button", { name: "Next", exact: true }).scrollIntoViewIfNeeded();
  const geometry = await preview.evaluate((root) => {
    const rect = (element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const describe = (element) => element ? { tag: element.tagName, className: element.className, ariaLabel: element.getAttribute("aria-label") } : null;
    const inspect = (element) => {
      if (!element) return null;
      const css = getComputedStyle(element);
      return { ...describe(element), rect: rect(element), css: Object.fromEntries(["width", "height", "min-height", "max-height", "overflow", "position", "display", "grid-template-rows", "aspect-ratio"].map((key) => [key, css.getPropertyValue(key)])) };
    };
    const next = [...root.querySelectorAll(".native-single-choice-visual-navigation button")].find((button) => button.textContent.trim() === "Next");
    const supplementary = root.querySelector(".native-supplementary-navigation");
    const bounds = rect(next); const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const hit = document.elementFromPoint(center.x, center.y);
    const navigation = supplementary ? rect(supplementary) : null;
    const selectors = [".native-readable-text-presentation", ".native-readable-text-activity-view", ".native-single-choice-student", ".native-single-choice-visual", ".native-single-choice-visual-navigation", ".native-single-choice-visual-panels", ".native-single-choice-visual-panel", ".native-single-choice-stage-slot", ".native-single-choice-visual-stage", ".native-supplementary-navigation"];
    return {
      nodes: { ".native-or-preview": inspect(root), ...Object.fromEntries(selectors.map((selector) => [selector, inspect(root.querySelector(selector))])), Next: inspect(next) },
      center, elementFromPoint: describe(hit), nextOwnsCenter: hit === next || next.contains(hit),
      supplementaryOverlapsCenter: Boolean(navigation && center.x >= navigation.x && center.x <= navigation.x + navigation.width && center.y >= navigation.y && center.y <= navigation.y + navigation.height),
    };
  });
  console.log(`SINGLE_CHOICE_LOCAL_PREVIEW_ACTIONABILITY ${JSON.stringify(geometry)}`);
  assert.equal(geometry.nextOwnsCenter, true, "Local Preview Next must own its real pointer target");
  assert.equal(geometry.supplementaryOverlapsCenter, false, "Activity presentation must not cover the center of Next");
}

const sourceGeometry = async (page) => {
  const canvas = page.locator(canvasSelector);
  const values = await Promise.all([
    page.getByRole("spinbutton", { name: "X", exact: true }).inputValue(),
    page.getByRole("spinbutton", { name: "Y", exact: true }).inputValue(),
    page.getByRole("spinbutton", { name: "Width", exact: true }).inputValue(),
    page.getByRole("spinbutton", { name: "Height", exact: true }).inputValue(),
    canvas.getAttribute("data-surface-width"),
    canvas.getAttribute("data-surface-height"),
  ]);
  const [x, y, width, height, sourceWidth, sourceHeight] = values.map(Number);
  return { x, y, width, height, sourceWidth, sourceHeight };
};

export function sourceRectanglesOverlap(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}

export async function setVisualHotspotGeometry(page, area) {
  for (const [name, value] of [["X", 0], ["Y", 0], ["Width", area.width], ["Height", area.height], ["X", area.x], ["Y", area.y]]) {
    await page.getByRole("spinbutton", { name, exact: true }).fill(String(value));
  }
  const geometry = await sourceGeometry(page);
  assert.deepEqual(
    { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height },
    area,
    "The hosted fixture must persist its deterministic source geometry through Builder controls",
  );
  assert.ok(area.x >= 0 && area.y >= 0 && area.x + area.width <= geometry.sourceWidth && area.y + area.height <= geometry.sourceHeight, "Deterministic hotspot geometry must stay inside the source image");
  return geometry;
}

export const createVisualHotspotCreator = (page) => async (bindingIndex, deterministicArea = null) => {
  const canvas = page.locator(canvasSelector);
  const hotspots = page.locator(hotspotSelector);
  const selected = page.getByRole("group", { name: selectedName });
  const initialHotspotCount = await hotspots.count();
  if (bindingIndex !== null && bindingIndex !== undefined) await page.getByLabel("Option to map").selectOption({ index: bindingIndex });
  await page.getByRole("button", { name: "New hotspot" }).click();
  await selected.waitFor();
  assert.equal(await hotspots.count(), initialHotspotCount + 1, "New hotspot must immediately create exactly one hotspot");
  assert.equal(await selected.count(), 1, "The new hotspot must be selected immediately");
  assert.equal(await selected.getByRole("button", { name: /Resize Hotspot from/ }).count(), 4, "All four resize handles must be available immediately");
  assert.equal(await canvas.evaluate((element) => element.classList.contains("is-drawing")), false, "Immediate creation must not enter drawing mode");
  assert.equal(await page.getByRole("button", { name: "Click target", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Visual highlight", exact: true }).count(), 0);
  assert.equal(await page.getByRole("group", { name: "Selected hotspot rectangle workflow" }).count(), 0);
  const geometry = await sourceGeometry(page);
  assert.equal(geometry.width, Math.min(25, geometry.sourceWidth));
  assert.equal(geometry.height, Math.min(25, geometry.sourceHeight));
  assert.ok(Number.isInteger(geometry.x) && Number.isInteger(geometry.y));
  assert.ok(geometry.x >= 0 && geometry.y >= 0 && geometry.x + geometry.width <= geometry.sourceWidth && geometry.y + geometry.height <= geometry.sourceHeight, "The new hotspot must stay inside the source image");
  return deterministicArea ? setVisualHotspotGeometry(page, deterministicArea) : geometry;
};

export async function exerciseVisualHotspotPointerMove(page, initialGeometry) {
  await page.getByRole("spinbutton", { name: "X", exact: true }).fill("200");
  await page.getByRole("spinbutton", { name: "Y", exact: true }).fill("80");
  const controls = ["X", "Y", "Width", "Height"].map((name) => page.getByRole("spinbutton", { name, exact: true }));
  const readGeometry = () => Promise.all(controls.map((control) => control.inputValue())).then((values) => values.map(Number));
  const baseline = await readGeometry();
  const sourceDimensions = [initialGeometry.sourceWidth, initialGeometry.sourceHeight, initialGeometry.sourceWidth, initialGeometry.sourceHeight];
  const canvas = page.locator(canvasSelector);
  const frame = page.getByRole("group", { name: selectedName });
  const renderedSourceGeometry = () => frame.evaluate((element, source) => ["left", "top", "width", "height"].map((property, index) => Math.round(Number.parseFloat(element.style[property]) * source[index] / 100)), sourceDimensions);
  await expect.poll(renderedSourceGeometry).toEqual(baseline);
  const frameBefore = (await waitForStableGeometry(frame, { label: "Selected hotspot before pointer movement" })).boxes[0];
  const canvasBox = await canvas.boundingBox();
  const label = frame.locator(".studio-selection-label");
  await label.hover();
  const selectedBefore = page.locator(`${hotspotSelector}.is-selected`);
  assert.equal(await selectedBefore.count(), 1, "Exactly one hotspot must be selected before pointer movement");
  const selectedHotspotName = await selectedBefore.getAttribute("aria-label");
  assert.ok(canvasBox && frameBefore && selectedHotspotName);
  const pointerStart = await label.evaluate((element, localCanvasSelector) => { const selectedFrame = element.closest(".studio-selection-frame"); const rect = element.getBoundingClientRect(); const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2; const hit = document.elementsFromPoint(x, y)[0]; return { x, y, hitTag: hit?.tagName || null, hitClass: hit?.className || null, belongsToFrame: Boolean(selectedFrame && hit && selectedFrame.contains(hit)), belongsToLabel: Boolean(hit && element.contains(hit)), isResizeHandle: Boolean(hit?.closest(".studio-resize-handle")), isCanvasBackground: hit === element.closest(localCanvasSelector) }; }, canvasSelector);
  assert.equal(pointerStart.belongsToFrame, true, `Pointer start must hit the selected frame: ${JSON.stringify(pointerStart)}`);
  assert.equal(pointerStart.belongsToLabel, true, `Pointer start must hit the actionable move grip: ${JSON.stringify(pointerStart)}`);
  assert.equal(pointerStart.isResizeHandle, false, `Pointer start must not hit a resize handle: ${JSON.stringify(pointerStart)}`);
  assert.equal(pointerStart.isCanvasBackground, false, `Pointer start must not hit the canvas background: ${JSON.stringify(pointerStart)}`);
  await frame.evaluate((element) => { element.addEventListener("pointerdown", (event) => { element.dataset.acceptancePointerTarget = event.target?.className || event.target?.tagName || "unknown"; }, { once: true }); });
  await page.mouse.down();
  await page.mouse.move(pointerStart.x + 10, pointerStart.y + 8, { steps: 6 });
  await page.mouse.up();
  const receivedPointerTarget = await frame.evaluate((element) => { const target = element.dataset.acceptancePointerTarget; delete element.dataset.acceptancePointerTarget; return target; });
  assert.ok(receivedPointerTarget, "The selected frame must receive the pointer-down used for movement");
  assert.equal(await frame.count(), 1, "The selected StageSelectionFrame must remain after pointer movement");
  const selectedAfter = page.locator(`${hotspotSelector}.is-selected`);
  assert.equal(await selectedAfter.count(), 1, "Pointer movement must preserve hotspot selection");
  assert.equal(await selectedAfter.getAttribute("aria-label"), selectedHotspotName, "Pointer movement must preserve the selected hotspot identity");
  await expect.poll(async () => (await readGeometry()).slice(0, 2)).not.toEqual(baseline.slice(0, 2));
  const pointerGeometry = await readGeometry();
  await expect.poll(renderedSourceGeometry).toEqual(pointerGeometry);
  const frameAfter = (await waitForStableGeometry(frame, { label: "Selected hotspot after pointer movement" })).boxes[0];
  assert.notDeepEqual(pointerGeometry.slice(0, 2), baseline.slice(0, 2), "Dragging the selected hotspot must change its source position");
  const renderedDelta = [frameAfter.left - frameBefore.left, frameAfter.top - frameBefore.top];
  const expectedDelta = [(pointerGeometry[0] - baseline[0]) * frameBefore.width / baseline[2], (pointerGeometry[1] - baseline[1]) * frameBefore.height / baseline[3]];
  for (let axis = 0; axis < 2; axis += 1) assert.ok(Math.abs(renderedDelta[axis] - expectedDelta[axis]) < 1.5, `Rendered hotspot frame movement must match source geometry on axis ${axis}: ${renderedDelta[axis]} vs ${expectedDelta[axis]}`);
  return canvasBox;
}

export async function exerciseBulkHotspotImport({ page, nativeDocuments, firstPanelPng, secondPanelPng }) {
  await page.getByRole("button", { name: "Add Activity" }).click();
  await page.getByRole("radio", { name: /Multiple Choice/ }).check();
  await page.getByLabel(/Initial title/).fill("Bulk hotspot import choice");
  await page.getByRole("button", { name: "Create activity" }).click();
  await page.getByRole("heading", { name: "Bulk hotspot import choice" }).first().waitFor();
  const activityId = [...nativeDocuments].find(([, pair]) => pair.publicDocument.metadata.title === "Bulk hotspot import choice")?.[0];
  assert.ok(activityId, "Bulk hotspot acceptance activity must be created");

  await page.getByText("Bulk generate from text", { exact: true }).click();
  const semanticSource = "1. Which first option is correct?\n*Alpha\nBeta\n2. Which second option is correct?\nGamma\n*Delta";
  await page.getByLabel("Paste numbered Multiple Choice content").fill(semanticSource);
  await page.getByRole("button", { name: "Generate content" }).click();
  await page.getByText("2 questions generated", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Answer Key" }).click();
  await page.getByRole("checkbox", { name: "Option 1: Alpha" }).click();
  await page.getByRole("checkbox", { name: "Option 2: Beta" }).click();
  await page.locator(".native-or-question-workspace > aside button").filter({ hasText: "Question 2" }).click();
  await page.getByRole("checkbox", { name: "Option 2: Delta" }).click();
  await page.getByRole("checkbox", { name: "Option 1: Gamma" }).click();
  await page.getByRole("button", { name: "Save Draft" }).click();
  await page.getByText("Draft saved.", { exact: true }).waitFor();

  const savedSemanticPair = structuredClone(nativeDocuments.get(activityId));
  const teacherBeforeImport = structuredClone(savedSemanticPair.teacherDocument);
  await page.getByRole("tab", { name: "Visual" }).click();
  assert.equal(await page.getByText("Bulk import hotspots from text", { exact: true }).count(), 0, "Importer stays hidden until Visual mode exists");
  await page.getByRole("button", { name: "Enable visual mode" }).click();
  await page.getByText("Bulk import hotspots from text", { exact: true }).waitFor();
  await page.locator(".native-single-choice-visual-authoring .studio-upload-action input").setInputFiles({ name: "choice-bulk-panel-one.png", mimeType: "image/png", buffer: firstPanelPng });
  await page.locator(".native-single-choice-hotspot-canvas img").waitFor();
  await page.getByRole("button", { name: "Add Panel" }).click();
  await page.locator(".native-single-choice-visual-authoring .studio-upload-action input").setInputFiles({ name: "choice-bulk-panel-two.png", mimeType: "image/png", buffer: secondPanelPng });
  await page.locator(".native-single-choice-hotspot-canvas img").waitFor();

  await page.getByText("Bulk import hotspots from text", { exact: true }).click();
  const geometrySource = "SOURCE 1024x582\n\nPANEL 1\n1.1 x=100 y=100 width=200 height=50\n1.2 x=400 y=100 width=200 height=50\n\nPANEL 2\n2.1 x=100 y=200 width=200 height=80\n2.2 x=400 y=200 width=200 height=80";
  const sourceInput = page.getByLabel("Paste hotspot geometry");
  await sourceInput.fill(geometrySource);
  assert.equal(await page.getByRole("button", { name: "Import hotspots" }).isDisabled(), false);
  await page.getByRole("button", { name: "Import hotspots" }).click();
  await page.getByText("4 hotspots imported", { exact: true }).waitFor();
  assert.equal(await sourceInput.inputValue(), geometrySource, "Successful import keeps the source in local state");
  assert.equal(await page.locator(".native-hotspot-bulk-importer__warning").count(), 2);
  assert.equal(await page.getByRole("group", { name: "Hotspot selected" }).count(), 1);
  assert.deepEqual(nativeDocuments.get(activityId), savedSemanticPair, "Local import must not save public or Teacher documents");
  assert.deepEqual(nativeDocuments.get(activityId).teacherDocument, teacherBeforeImport, "Local import must leave Teacher data byte-equivalent");
  assert.equal(JSON.stringify(nativeDocuments.get(activityId)).includes(geometrySource), false, "Raw geometry source must not reach persistence");
  assert.equal(Number(await page.getByRole("spinbutton", { name: "X", exact: true }).inputValue()), 100);
  assert.equal(Number(await page.getByRole("spinbutton", { name: "Y", exact: true }).inputValue()), 50);
  await page.getByRole("spinbutton", { name: "X", exact: true }).fill("110");
  await page.getByRole("button", { name: "Save Draft" }).click();
  await page.getByText("Draft saved.", { exact: true }).waitFor();

  const firstSaved = nativeDocuments.get(activityId);
  const firstSavedTeacher = structuredClone(firstSaved.teacherDocument);
  const firstSavedPanels = firstSaved.publicDocument.parts[0].interaction.presentation.panels;
  assert.deepEqual(firstSavedPanels.map(({ sourceWidth, sourceHeight }) => [sourceWidth, sourceHeight]), [[1024, 291], [700, 1200]]);
  assert.deepEqual(firstSavedPanels[0].hotspots.map(({ area }) => area), [{ x: 110, y: 50, width: 200, height: 25 }, { x: 400, y: 50, width: 200, height: 25 }]);
  assert.deepEqual(firstSavedPanels[1].hotspots.map(({ area }) => area), [{ x: 68, y: 412, width: 138, height: 166 }, { x: 273, y: 412, width: 138, height: 166 }]);
  assert.doesNotMatch(JSON.stringify(firstSaved.publicDocument), /correctOption|correctAnswers|isCorrect|SOURCE 1024x582/);
  assert.deepEqual(firstSaved.teacherDocument, teacherBeforeImport);
  const firstSavedIds = firstSavedPanels.map((panel) => panel.hotspots.map((hotspot) => hotspot.id));
  const unlistedPanelBeforeReplacement = structuredClone(firstSavedPanels[1]);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: new RegExp(activityId) }).click();
  await page.getByRole("tab", { name: "Visual" }).click();
  assert.deepEqual(nativeDocuments.get(activityId).publicDocument.parts[0].interaction.presentation.panels.map((panel) => panel.hotspots.map((hotspot) => hotspot.id)), firstSavedIds);
  await page.getByRole("tab", { name: "Local Preview" }).click();
  await page.getByRole("button", { name: "Student Preview" }).click();
  const studentPreview = page.locator(".native-or-preview .native-single-choice-student");
  const beta = studentPreview.getByRole("button", { name: "Which first option is correct?: Beta" });
  await beta.waitFor();
  const importedStyle = await studentPreview.locator(".native-single-choice-hotspot").first().evaluate((element) => ({ left: Number.parseFloat(element.style.left), top: Number.parseFloat(element.style.top), width: Number.parseFloat(element.style.width), height: Number.parseFloat(element.style.height) }));
  assert.ok(Math.abs(importedStyle.left - 110 / 1024 * 100) < .002 && Math.abs(importedStyle.top - 50 / 291 * 100) < .002, JSON.stringify(importedStyle));
  await beta.click(); assert.equal(await beta.getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Teacher Preview" }).click();
  const teacherPreview = page.locator(".native-or-preview .native-single-choice-teacher");
  const teacherBeta = teacherPreview.getByRole("button", { name: "Which first option is correct?: Beta" });
  await teacherBeta.click();
  assert.equal(await teacherBeta.getAttribute("data-answer-state"), "correct");

  await page.getByRole("tab", { name: "Visual" }).click();
  await page.getByText("Bulk import hotspots from text", { exact: true }).click();
  const replacementSource = "SOURCE 1024x582\nPANEL 1\n1.2 x=420 y=120 width=180 height=40\n1.1 x=120 y=120 width=180 height=40";
  await page.getByLabel("Paste hotspot geometry").fill(replacementSource);
  assert.equal(await page.getByRole("checkbox", { name: /Replace existing hotspots on listed panels/ }).isChecked(), false);
  await page.getByRole("button", { name: "Import hotspots" }).click();
  await page.getByRole("alert").getByText("Panel 1 already contains hotspots. Confirm replacement before importing.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Save Draft" }).isDisabled(), true, "Failed import must not dirty a freshly loaded editor");
  await page.getByRole("checkbox", { name: /Replace existing hotspots on listed panels/ }).check();
  await page.getByRole("button", { name: "Import hotspots" }).click();
  await page.getByText("2 hotspots imported", { exact: true }).waitFor();
  await page.getByText("2 existing IDs preserved; 0 new IDs created", { exact: true }).waitFor();
  const replacementGeometry = await Promise.all(["X", "Y", "Width", "Height"].map((name) => page.getByRole("spinbutton", { name, exact: true }).inputValue()));
  assert.deepEqual(replacementGeometry.map(Number), [120, 60, 180, 20]);
  await page.getByLabel("Paste hotspot geometry").fill("SOURCE 1024x582\nPANEL 1\n1.1 x=1020 y=0 width=10 height=10");
  await page.getByRole("button", { name: "Import hotspots" }).click();
  await page.getByRole("alert").getByText("Line 3: rectangle exceeds SOURCE 1024x582.", { exact: true }).waitFor();
  assert.deepEqual((await Promise.all(["X", "Y", "Width", "Height"].map((name) => page.getByRole("spinbutton", { name, exact: true }).inputValue()))).map(Number), [120, 60, 180, 20], "Invalid import must leave the local draft unchanged");
  await page.getByRole("button", { name: "Clear source" }).click();
  assert.equal(await page.getByLabel("Paste hotspot geometry").inputValue(), "");
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.getByRole("button", { name: "Save Draft" }).click();
  await page.getByText("Draft saved.", { exact: true }).waitFor();
  const replacedPair = nativeDocuments.get(activityId);
  const replacedPanels = replacedPair.publicDocument.parts[0].interaction.presentation.panels;
  assert.deepEqual(replacedPanels[1], unlistedPanelBeforeReplacement, "Confirmed replacement must leave an unlisted panel byte-equivalent");
  assert.deepEqual(replacedPanels[0].hotspots.map((hotspot) => hotspot.id), firstSavedIds[0]);
  assert.deepEqual(replacedPanels[0].hotspots.map(({ area }) => area), [{ x: 120, y: 60, width: 180, height: 20 }, { x: 420, y: 60, width: 180, height: 20 }]);
  assert.deepEqual(replacedPair.teacherDocument, firstSavedTeacher);
  assert.doesNotMatch(JSON.stringify(replacedPair.publicDocument), /correctOption|correctAnswers|isCorrect|SOURCE 1024x582/);
  return activityId;
}
