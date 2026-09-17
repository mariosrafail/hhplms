import assert from "node:assert/strict";

import { expect } from "@playwright/test";

export async function measureDragDrop(locator, { context, viewport }) {
  await locator.evaluate(async (surface) => {
    let previousSignature = "";
    let stableFrames = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const visualRect = surface.querySelector(".native-drag-drop-visual-region")?.getBoundingClientRect();
      const workspaceRect = surface.querySelector(".native-drag-drop-workspace")?.getBoundingClientRect();
      const stageRect = surface.querySelector(".native-drag-drop-stage")?.getBoundingClientRect();
      if (!visualRect || !workspaceRect || !stageRect) continue;
      const signature = [visualRect.width, visualRect.height, workspaceRect.height, stageRect.width, stageRect.height].map((value) => value.toFixed(2)).join(":");
      const stageInsideVisual = stageRect.left >= visualRect.left - 1 && stageRect.right <= visualRect.right + 1 && stageRect.top >= visualRect.top - 1 && stageRect.bottom <= visualRect.bottom + 1;
      stableFrames = stageInsideVisual && signature === previousSignature ? stableFrames + 1 : 0;
      previousSignature = signature;
      if (stableFrames >= 2) return;
    }
  });
  const measurement = await locator.evaluate((surface, measuredContext) => {
    const snapshot = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        element: element.tagName.toLowerCase(),
        className: typeof element.className === "string" ? element.className : "",
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        minWidth: style.minWidth,
        minHeight: style.minHeight,
        maxWidth: style.maxWidth,
        maxHeight: style.maxHeight,
        display: style.display,
        gridTemplateRows: style.gridTemplateRows,
        alignSelf: style.alignSelf,
        overflow: style.overflow,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
      };
    };
    const visualElement = surface.querySelector(".native-drag-drop-visual-region");
    const workspaceElement = surface.querySelector(".native-drag-drop-workspace");
    const stageSlotElement = surface.querySelector(".native-drag-drop-stage-slot");
    const stageElement = surface.querySelector(".native-drag-drop-stage");
    const bankElement = surface.querySelector(".native-drag-drop-bank");
    const bankItemsElement = surface.querySelector(".native-drag-drop-bank-items");
    const root = snapshot(surface);
    const visual = snapshot(visualElement);
    const workspace = snapshot(workspaceElement);
    const stageSlot = snapshot(stageSlotElement);
    const stage = snapshot(stageElement);
    const bank = snapshot(bankElement);
    const activityHost = snapshot(surface.closest(".native-readable-text-activity-view"));
    const ancestors = [];
    for (let current = surface.parentElement, depth = 0; current && depth < 9; current = current.parentElement, depth += 1) ancestors.push(snapshot(current));
    const stageRect = stageElement.getBoundingClientRect();
    const stageSlotRect = stageSlotElement.getBoundingClientRect();
    const workspaceRect = workspaceElement.getBoundingClientRect();
    const visualRect = visualElement.getBoundingClientRect();
    const bankRect = bankElement.getBoundingClientRect();
    return {
      context: measuredContext,
      viewport: { width: innerWidth, height: innerHeight },
      root,
      visual,
      workspace,
      stageSlot,
      stage,
      bank,
      activityHost,
      ancestors,
      activityHostFillRatio: activityHost ? root.height / activityHost.height : null,
      visualRootRatio: visual.height / root.height,
      bankRootRatio: bank.height / root.height,
      usableVisualRatio: stageSlot.height / workspace.height,
      usableBankRatio: bank.height / stage.height,
      bankTopRatio: (bankRect.top - stageRect.top) / stageRect.height,
      bankInsideStage: bankRect.left >= stageRect.left - 1 && bankRect.right <= stageRect.right + 1 && bankRect.top >= stageRect.top - 1 && bankRect.bottom <= stageRect.bottom + 1,
      bankOverlapsStage: bankRect.left < stageRect.right - 1 && bankRect.right > stageRect.left + 1 && bankRect.top < stageRect.bottom - 1 && bankRect.bottom > stageRect.top + 1,
      bankItemRows: new Set([...bankItemsElement.children].map((item) => Math.round(item.getBoundingClientRect().top))).size,
      bankItemsScrollable: bankItemsElement.scrollHeight > bankItemsElement.clientHeight + 1,
      stageAspectRatio: stage.width / stage.height,
      sourceAspectRatio: Number(stageElement.dataset.surfaceWidth) / Number(stageElement.dataset.surfaceHeight),
      stageInsideVisual: stageRect.left >= visualRect.left - 1 && stageRect.right <= visualRect.right + 1 && stageRect.top >= visualRect.top - 1 && stageRect.bottom <= visualRect.bottom + 1,
      stageInsideSlot: stageRect.left >= stageSlotRect.left - 1 && stageRect.right <= stageSlotRect.right + 1 && stageRect.top >= stageSlotRect.top - 1 && stageRect.bottom <= stageSlotRect.bottom + 1,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      activityScrollOverflow: { x: surface.scrollWidth - surface.clientWidth, y: surface.scrollHeight - surface.clientHeight },
    };
  }, context);
  process.stdout.write(`[drag-drop-geometry] ${JSON.stringify({ requestedViewport: viewport, ...measurement })}\n`);
  return measurement;
}

async function dispatchPointer(source, type, init, { pointerId = 41, pointerType = "mouse" } = {}) {
  await source.evaluate((element, payload) => {
    const ownCapture = Object.getOwnPropertyDescriptor(element, "setPointerCapture");
    if (payload.type === "pointerdown") Object.defineProperty(element, "setPointerCapture", { configurable: true, value() {} });
    try {
      element.dispatchEvent(new PointerEvent(payload.type, { bubbles: true, cancelable: true, pointerId: payload.pointerId, pointerType: payload.pointerType, isPrimary: true, ...payload.init }));
    } finally {
      if (payload.type === "pointerdown") {
        if (ownCapture) Object.defineProperty(element, "setPointerCapture", ownCapture);
        else delete element.setPointerCapture;
      }
    }
  }, { type, init, pointerId, pointerType });
}

async function dragBetween(page, source, target) {
  await source.scrollIntoViewIfNeeded();
  const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  assert.ok(sourceBox && targetBox);
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
  await page.mouse.up();
}

const dragChipStyleProperties = [
  "boxSizing", "fontFamily", "fontSize", "fontStyle", "fontStretch", "fontVariant", "fontWeight", "lineHeight", "letterSpacing", "wordSpacing",
  "whiteSpace", "overflowWrap", "wordBreak", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderTopStyle", "borderTopColor", "borderRightWidth", "borderRightStyle", "borderRightColor",
  "borderBottomWidth", "borderBottomStyle", "borderBottomColor", "borderLeftWidth", "borderLeftStyle", "borderLeftColor",
  "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius",
  "backgroundColor", "color", "textAlign", "verticalAlign", "display", "alignItems", "justifyContent",
];

async function renderedChipSnapshot(locator) {
  return locator.evaluate((element, properties) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      rect: { width: rect.width, height: rect.height },
      style: Object.fromEntries(properties.map((property) => [property, style[property]])),
    };
  }, dragChipStyleProperties);
}

export async function assertPixelIdenticalDragPreview(page, source) {
  await source.scrollIntoViewIfNeeded();
  const sourceSnapshot = await renderedChipSnapshot(source);
  const sourceBox = await source.boundingBox();
  assert.ok(sourceBox);
  const start = { x: sourceBox.x + sourceBox.width * .37, y: sourceBox.y + sourceBox.height * .61 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 34, start.y - 24, { steps: 5 });
  const preview = page.locator("[data-drag-drop-drag-preview]");
  await preview.waitFor();
  const previewSnapshot = await renderedChipSnapshot(preview);
  assert.ok(Math.abs(sourceSnapshot.rect.width - previewSnapshot.rect.width) <= 1, JSON.stringify({ sourceSnapshot, previewSnapshot }));
  assert.ok(Math.abs(sourceSnapshot.rect.height - previewSnapshot.rect.height) <= 1, JSON.stringify({ sourceSnapshot, previewSnapshot }));
  assert.deepEqual(previewSnapshot.style, sourceSnapshot.style, "the portal preview preserves the source chip's rendered typography and box styling");
  await page.mouse.up();
  await preview.waitFor({ state: "detached" });
  await source.click();
  if (await source.getAttribute("aria-pressed") === "true") await source.click();
}

async function dispatchImmediatePointerSequence(source, target, { cancel = false } = {}) {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  assert.ok(sourceBox && targetBox);
  await source.evaluate((element, payload) => {
    const ownCapture = Object.getOwnPropertyDescriptor(element, "setPointerCapture");
    Object.defineProperty(element, "setPointerCapture", { configurable: true, value() {} });
    const event = (type, init) => element.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 42, pointerType: "mouse", isPrimary: true, ...init }));
    try {
      event("pointerdown", { button: 0, buttons: 1, clientX: payload.sourceX, clientY: payload.sourceY });
      event("pointermove", { button: 0, buttons: 1, clientX: payload.targetX, clientY: payload.targetY });
      if (payload.cancel) event("pointercancel", { button: 0, buttons: 0, clientX: payload.targetX, clientY: payload.targetY });
      event("pointerup", { button: 0, buttons: 0, clientX: payload.targetX, clientY: payload.targetY });
    } finally {
      if (ownCapture) Object.defineProperty(element, "setPointerCapture", ownCapture);
      else delete element.setPointerCapture;
    }
  }, { sourceX: sourceBox.x + sourceBox.width / 2, sourceY: sourceBox.y + sourceBox.height / 2, targetX: targetBox.x + targetBox.width / 2, targetY: targetBox.y + targetBox.height / 2, cancel });
}

export async function exerciseValidatedDragDrop(page, surface, pair) {
  const target = surface.locator("[data-drag-drop-target-id]").first();
  const targetId = await target.getAttribute("data-drag-drop-target-id");
  const mapping = pair.teacherDocument.parts[0].solution.mappings.find((entry) => entry.targetId === targetId);
  const correctWordId = mapping?.wordIds?.[0] || mapping?.wordId;
  const wrongWordId = pair.publicDocument.parts[0].interaction.words.find((word) => word.id !== correctWordId)?.id;
  assert.ok(correctWordId && wrongWordId);
  const wrongWord = surface.locator(`[data-drag-drop-word-id="${wrongWordId}"]`);
  const correctWord = surface.locator(`[data-drag-drop-word-id="${correctWordId}"]`);
  await dispatchImmediatePointerSequence(correctWord, target, { cancel: true });
  assert.equal(await target.getAttribute("data-occupied"), null);
  assert.equal(await target.getAttribute("data-incorrect"), null);
  assert.equal(await correctWord.count(), 1);
  await dispatchImmediatePointerSequence(wrongWord, target);
  assert.equal(await target.getAttribute("data-occupied"), null);
  assert.equal(await target.getAttribute("data-incorrect"), "true");
  assert.equal(await wrongWord.count(), 1);
  assert.match(await surface.getByRole("status").textContent(), /does not belong/);
  assert.doesNotMatch(await target.getAttribute("aria-label"), /incorrect|wrong/i);
  assert.equal(await target.evaluate((element) => getComputedStyle(element).borderColor), "rgb(185, 28, 28)");
  await dispatchImmediatePointerSequence(correctWord, target);
  assert.equal(await target.getAttribute("data-occupied"), "true");
  assert.equal(await target.getAttribute("data-incorrect"), null);
  assert.equal(await correctWord.count(), 0, "a correctly placed word leaves the bank");
  assert.match(await surface.getByRole("status").textContent(), /placed in/);
  return target;
}

export async function exerciseDragDropProxy(page, surface, pair) {
  const target = surface.locator("[data-drag-drop-target-id]").first();
  const targetId = await target.getAttribute("data-drag-drop-target-id");
  const mapping = pair.teacherDocument.parts[0].solution.mappings.find((entry) => entry.targetId === targetId);
  const correctWordId = mapping?.wordIds?.[0] || mapping?.wordId;
  const wrongWordId = pair.publicDocument.parts[0].interaction.words.find((word) => word.id !== correctWordId)?.id;
  assert.ok(correctWordId && wrongWordId);
  const wrongWord = surface.locator(`[data-drag-drop-word-id="${wrongWordId}"]`);
  const candidateWords = surface.locator("[data-drag-drop-word-id]");
  const candidateTexts = await candidateWords.evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  const orderedIndexes = candidateTexts.map((text, index) => ({ index, length: text.length })).sort((left, right) => left.length - right.length);
  const previewIndexes = [...new Set([orderedIndexes[0]?.index, orderedIndexes.at(-1)?.index].filter(Number.isInteger))];
  for (const index of previewIndexes) await assertPixelIdenticalDragPreview(page, candidateWords.nth(index));
  await wrongWord.scrollIntoViewIfNeeded();
  const [wrongBox, targetBox] = await Promise.all([wrongWord.boundingBox(), target.boundingBox()]);
  assert.ok(wrongBox && targetBox);
  const pointerOffset = { x: wrongBox.width * .23, y: wrongBox.height * .71 };
  const destination = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
  await page.mouse.move(wrongBox.x + pointerOffset.x, wrongBox.y + pointerOffset.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 6 });
  const proxy = page.locator("[data-drag-drop-drag-preview]");
  await proxy.waitFor();
  const proxyBox = await proxy.boundingBox();
  assert.ok(proxyBox && destination.x >= proxyBox.x && destination.x <= proxyBox.x + proxyBox.width && destination.y >= proxyBox.y && destination.y <= proxyBox.y + proxyBox.height, "the drag proxy follows mouse coordinates");
  assert.ok(Math.abs(proxyBox.width - wrongBox.width) <= 1 && Math.abs(proxyBox.height - wrongBox.height) <= 1, "the portal drag proxy preserves the source border-box dimensions");
  assert.ok(Math.abs(proxyBox.x + pointerOffset.x - destination.x) < 2 && Math.abs(proxyBox.y + pointerOffset.y - destination.y) < 2, "the drag proxy preserves the mouse pointer's source-relative offset");
  await page.mouse.up();
  await expect(target).toHaveAttribute("data-incorrect", "true");
  await expect(proxy).toHaveAttribute("data-returning", "true");
  await proxy.waitFor({ state: "detached" });
  assert.equal(await wrongWord.count(), 1, "a wrong drag returns the source word to the bank");

  const correctWord = surface.locator(`[data-drag-drop-word-id="${correctWordId}"]`);
  await correctWord.scrollIntoViewIfNeeded();
  const [correctBox, surfaceBox] = await Promise.all([correctWord.boundingBox(), surface.boundingBox()]);
  assert.ok(correctBox && surfaceBox);
  const outside = { x: surfaceBox.x + 4, y: surfaceBox.y + 4 };
  await page.mouse.move(correctBox.x + correctBox.width / 2, correctBox.y + correctBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(outside.x, outside.y, { steps: 6 });
  await proxy.waitFor();
  await page.mouse.up();
  await expect(proxy).toHaveAttribute("data-returning", "true");
  await proxy.waitFor({ state: "detached" });
  assert.equal(await target.getAttribute("data-occupied"), null, "dropping outside targets does not commit");
  assert.equal(await correctWord.count(), 1);

  const touchStart = { x: correctBox.x + correctBox.width / 2, y: correctBox.y + correctBox.height / 2 };
  const touchEnd = { x: touchStart.x + 36, y: touchStart.y - 28 };
  await dispatchPointer(correctWord, "pointerdown", { button: 0, buttons: 1, clientX: touchStart.x, clientY: touchStart.y }, { pointerId: 71, pointerType: "touch" });
  await dispatchPointer(correctWord, "pointermove", { button: 0, buttons: 1, clientX: touchEnd.x, clientY: touchEnd.y }, { pointerId: 71, pointerType: "touch" });
  await proxy.waitFor();
  const touchProxyBox = await proxy.boundingBox();
  assert.ok(touchProxyBox && touchEnd.x >= touchProxyBox.x && touchEnd.x <= touchProxyBox.x + touchProxyBox.width && touchEnd.y >= touchProxyBox.y && touchEnd.y <= touchProxyBox.y + touchProxyBox.height, "the drag proxy follows touch pointer coordinates");
  assert.ok(Math.abs(touchProxyBox.x + touchProxyBox.width / 2 - touchEnd.x) < 2 && Math.abs(touchProxyBox.y + touchProxyBox.height / 2 - touchEnd.y) < 2, "the drag proxy is centered on the touch pointer");
  await dispatchPointer(correctWord, "pointercancel", { button: 0, buttons: 0, clientX: touchEnd.x, clientY: touchEnd.y }, { pointerId: 71, pointerType: "touch" });
  await proxy.waitFor({ state: "detached" });
  assert.equal(await correctWord.count(), 1, "pointer cancellation preserves the source word");

  await correctWord.focus();
  await correctWord.press("Enter");
  await expect(correctWord).toHaveAttribute("aria-pressed", "true");
  await target.focus();
  await target.press("Enter");
  await expect(target).toHaveAttribute("data-occupied", "true");
  assert.match(await surface.getByRole("status").textContent(), /placed in/);
  await target.press("Delete");
  await expect(target).not.toHaveAttribute("data-occupied", "true");
  assert.equal(await surface.locator(`[data-drag-drop-word-id="${correctWordId}"]`).count(), 1, "keyboard removal restores a consumed word");
}

export async function exerciseDragDropPanelTransitionGuard(surface) {
  const source = surface.locator("[data-drag-drop-word-id]").first();
  const target = surface.locator("[data-drag-drop-target-id]").first();
  const sourceBox = await source.boundingBox();
  assert.ok(sourceBox);
  await dispatchPointer(source, "pointerdown", { button: 0, buttons: 1, clientX: sourceBox.x + sourceBox.width / 2, clientY: sourceBox.y + sourceBox.height / 2 });
  await surface.getByRole("button", { name: "Next", exact: true }).click();
  const nextTarget = surface.locator("[data-drag-drop-target-id]").first();
  const nextTargetBox = await nextTarget.boundingBox();
  assert.ok(nextTargetBox);
  await dispatchPointer(source, "pointerup", { button: 0, buttons: 0, clientX: nextTargetBox.x + nextTargetBox.width / 2, clientY: nextTargetBox.y + nextTargetBox.height / 2 });
  assert.equal(await nextTarget.getAttribute("data-occupied"), null);
  assert.equal(await source.count(), 1);
  await surface.getByRole("button", { name: "Previous", exact: true }).click();
  assert.equal(await target.getAttribute("data-occupied"), null);
}

export async function exerciseDragDropResetGuard(page, surface, resetButton, pair) {
  const source = surface.locator("[data-drag-drop-word-id]").first();
  const target = surface.locator("[data-drag-drop-target-id]").first();
  const revealedTarget = surface.locator("[data-drag-drop-target-id][data-revealed]").first();
  assert.equal(await resetButton.isDisabled(), true);
  assert.equal(await revealedTarget.count(), 0);
  const sourceBox = await source.boundingBox();
  assert.ok(sourceBox);
  await dispatchPointer(source, "pointerdown", { button: 0, buttons: 1, clientX: sourceBox.x + sourceBox.width / 2, clientY: sourceBox.y + sourceBox.height / 2 });
  await target.click();
  await revealedTarget.waitFor();
  const revealedTargetHandle = await revealedTarget.elementHandle();
  assert.ok(revealedTargetHandle);
  await resetButton.click({ trial: true });
  assert.equal(await resetButton.isDisabled(), false);
  await resetButton.click();
  await revealedTargetHandle.waitForElementState("hidden");
  assert.equal(await revealedTargetHandle.evaluate((element) => element.isConnected), false);
  await revealedTarget.waitFor({ state: "detached" });
  await target.waitFor({ state: "attached" });
  assert.equal(await target.evaluate((element, previous) => element !== previous, revealedTargetHandle), true);
  await expect(resetButton).toBeDisabled();
  assert.equal(await resetButton.isDisabled(), true);
  const targetBox = await target.boundingBox();
  assert.ok(targetBox);
  await dispatchPointer(source, "pointerup", { button: 0, buttons: 0, clientX: targetBox.x + targetBox.width / 2, clientY: targetBox.y + targetBox.height / 2 });
  assert.equal(await target.getAttribute("data-occupied"), null);
  assert.equal(await target.getAttribute("data-incorrect"), null);
  assert.equal(await target.getAttribute("data-revealed"), null);
  assert.equal(await source.count(), 1);
  assert.equal(await source.getAttribute("aria-pressed"), "false");

  const targetId = await target.getAttribute("data-drag-drop-target-id");
  const mapping = pair.teacherDocument.parts[0].solution.mappings.find((entry) => entry.targetId === targetId);
  const correctWordId = mapping?.wordIds?.[0] || mapping?.wordId;
  const wrongWordId = pair.publicDocument.parts[0].interaction.words.find((word) => word.id !== correctWordId)?.id;
  assert.ok(correctWordId && wrongWordId);
  const wrongWord = surface.locator(`[data-drag-drop-word-id="${wrongWordId}"]`);
  const correctWord = surface.locator(`[data-drag-drop-word-id="${correctWordId}"]`);
  await dragBetween(page, wrongWord, target);
  assert.equal(await target.getAttribute("data-occupied"), null);
  assert.equal(await target.getAttribute("data-incorrect"), "true");
  assert.equal(await wrongWord.count(), 1);
  await dragBetween(page, correctWord, target);
  assert.equal(await target.getAttribute("data-occupied"), "true");
  assert.equal(await target.getAttribute("data-incorrect"), null);
  assert.equal(await correctWord.count(), 0);
  return target;
}
