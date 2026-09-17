import assert from "node:assert/strict";
import { expect } from "@playwright/test";

import { assertPixelIdenticalDragPreview } from "./hosted-native-activity-drag-drop.mjs";

async function measureTextBank(textPreview) {
  return textPreview.evaluate((surface) => {
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const numeric = (value) => Number.parseFloat(value) || 0;
    const bank = surface.querySelector(".native-drag-drop-bank");
    const bankItems = surface.querySelector(".native-drag-drop-bank-items");
    const stage = surface.querySelector(".native-drag-drop-stage");
    const itemsRect = box(bankItems);
    const itemStyle = getComputedStyle(bankItems);
    const phrases = [...bankItems.children].map((phrase) => {
      const style = getComputedStyle(phrase);
      const label = phrase.querySelector(".native-drag-drop-short-label");
      const labelStyle = getComputedStyle(label);
      return {
        text: phrase.textContent.trim(), rect: box(phrase), fontFamily: style.fontFamily,
        fontSize: numeric(style.fontSize), lineHeight: style.lineHeight,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
        label: {
          rect: box(label), minWidth: labelStyle.minWidth, minHeight: labelStyle.minHeight,
          padding: [labelStyle.paddingTop, labelStyle.paddingRight, labelStyle.paddingBottom, labelStyle.paddingLeft],
          borders: [labelStyle.borderTopWidth, labelStyle.borderRightWidth, labelStyle.borderBottomWidth, labelStyle.borderLeftWidth],
        },
      };
    });
    const tolerance = 1;
    const scrollFits = bankItems.scrollWidth <= bankItems.clientWidth && bankItems.scrollHeight <= bankItems.clientHeight;
    const childrenContained = phrases.every(({ rect }) => rect.left >= itemsRect.left - tolerance && rect.right <= itemsRect.right + tolerance && rect.top >= itemsRect.top - tolerance && rect.bottom <= itemsRect.bottom + tolerance);
    const fitScale = numeric(bankItems.dataset.fitScale);
    const fitStatus = bankItems.dataset.fitStatus || null;
    const renderedFontSize = Math.min(...phrases.map(({ fontSize }) => fontSize));
    const baseFontSize = fitScale > 0 ? renderedFontSize / fitScale : renderedFontSize;
    return {
      fits: fitStatus === "fit" && scrollFits && childrenContained, scrollFits, childrenContained,
      bank: { clientWidth: bank.clientWidth, clientHeight: bank.clientHeight, scrollWidth: bank.scrollWidth, scrollHeight: bank.scrollHeight, rect: box(bank) },
      bankItems: {
        clientWidth: bankItems.clientWidth, clientHeight: bankItems.clientHeight,
        scrollWidth: bankItems.scrollWidth, scrollHeight: bankItems.scrollHeight,
        rect: itemsRect, overflowX: itemStyle.overflowX, overflowY: itemStyle.overflowY,
        gap: itemStyle.gap, fitScale: bankItems.dataset.fitScale || null,
        fitStatus, chromeScale: null,
      },
      phrases, rows: [...new Set(phrases.map(({ rect }) => Math.round(rect.top)))],
      fonts: { status: document.fonts.status, renderedFontSize, baseFontSize, minimumScale: baseFontSize > 8 ? 8 / baseFontSize : 1, family: phrases[0]?.fontFamily || null },
      container: { surface: box(surface), stage: box(stage), stageClientWidth: stage.clientWidth, stageClientHeight: stage.clientHeight, stageType: getComputedStyle(stage).containerType },
    };
  });
}

export async function exerciseDragDropExtensions(page, { dragDropId, savedDragDrop }) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Search title, type, or ID").fill(dragDropId);
  for (let depth = 0; depth < 3; depth += 1) {
    await page.locator('.activity-tree-toggle[aria-expanded="false"]').evaluateAll((buttons) => buttons.forEach((button) => button.click()));
    await page.waitForTimeout(20);
  }
  await page.getByRole("button", { name: new RegExp(dragDropId) }).click();
  await page.getByRole("tab", { name: "Content" }).click();

  const reusableRow = page.locator(".native-drag-drop-word-row").nth(1);
  await reusableRow.getByRole("checkbox").check();
  await page.getByLabel("Answer bank height (px)").fill("132");
  await page.getByLabel("Bank words managed font").selectOption("");
  await page.getByRole("tab", { name: "Answer Key" }).click();
  const extendedMappings = page.locator(".native-drag-drop-mapping select");
  await extendedMappings.nth(0).selectOption([
    { label: "repeated · word 2 · reusable" },
    { label: "distractor · word 4" },
  ]);
  await extendedMappings.nth(1).selectOption({ label: "repeated · word 2 · reusable" });
  await page.getByRole("tab", { name: "Local Preview" }).click();
  await page.locator(".studio-preview-panel").getByRole("button", { name: "Student Preview", exact: true }).click();
  await page.locator(".b2-hosted-activity-preview").focus();
  await page.waitForFunction(() => document.querySelector(".b2-hosted-activity-layout")?.dataset.navigationExpanded === "false");
  await page.waitForTimeout(250);

  const extendedPreview = page.locator(".studio-preview-panel .native-drag-drop");
  const extendedInteraction = savedDragDrop.publicDocument.parts[0].interaction;
  const reusableWordId = extendedInteraction.words[1].id;
  const distractorWordId = extendedInteraction.words[3].id;
  const firstExtendedTarget = extendedPreview.locator(`[data-drag-drop-target-id="${extendedInteraction.panels[0].dropTargets[0].id}"]`);
  const secondExtendedTarget = extendedPreview.locator(`[data-drag-drop-target-id="${extendedInteraction.panels[0].dropTargets[1].id}"]`);
  const reusableBankWord = extendedPreview.locator(`[data-drag-drop-word-id="${reusableWordId}"]`);
  assert.equal(await extendedPreview.getAttribute("class"), "native-drag-drop native-drag-drop-student");
  assert.match(await firstExtendedTarget.getAttribute("aria-label"), /0 of 2 places used/, "multi-select answer mapping raises the public target capacity");
  const standardLayouts = [];
  for (const height of [120, 180, 220]) {
    await page.getByRole("tab", { name: "Content" }).click();
    await page.getByLabel("Answer bank height (px)").fill(String(height));
    await page.getByRole("tab", { name: "Local Preview" }).click();
    await page.locator(".studio-preview-panel").getByRole("button", { name: "Student Preview", exact: true }).click();
    await extendedPreview.waitFor();
    const layout = await extendedPreview.evaluate(async (surface) => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = (selector) => {
        const box = surface.querySelector(selector).getBoundingClientRect();
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
      };
      const box = surface.getBoundingClientRect();
      return {
        surface: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height },
        visual: rect(".native-drag-drop-visual-region"), workspace: rect(".native-drag-drop-workspace"), stage: rect(".native-drag-drop-stage"),
        artwork: rect(".native-drag-drop-artwork"), bank: rect(".native-drag-drop-bank"), target: rect("[data-drag-drop-target-id]"),
      };
    });
    assert.ok(Math.abs(layout.bank.height - height) <= 1 && Math.abs(layout.bank.bottom - layout.stage.bottom) <= 1, JSON.stringify({ height, layout }));
    standardLayouts.push(layout);
  }
  for (const layout of standardLayouts.slice(1)) for (const region of ["surface", "visual", "workspace", "stage", "artwork", "target"]) for (const property of ["left", "top", "width", "height"]) assert.ok(Math.abs(layout[region][property] - standardLayouts[0][region][property]) <= 1, JSON.stringify({ region, property, baseline: standardLayouts[0], layout }));
  const expectedAspectRatio = extendedInteraction.panels[0].surface.width / extendedInteraction.panels[0].surface.height;
  assert.ok(standardLayouts.every((layout) => Math.abs(layout.stage.width / layout.stage.height - expectedAspectRatio) < .02), JSON.stringify(standardLayouts));
  const standardWords = extendedPreview.locator("[data-drag-drop-word-id]");
  const standardWordTexts = await standardWords.evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  const longestStandardWordIndex = standardWordTexts.reduce((longest, text, index, texts) => text.length > texts[longest].length ? index : longest, 0);
  await assertPixelIdenticalDragPreview(page, standardWords.first());
  await assertPixelIdenticalDragPreview(page, standardWords.nth(longestStandardWordIndex));
  await page.getByRole("tab", { name: "Content" }).click();
  await page.getByLabel("Answer bank height (px)").fill("132");
  await page.getByLabel("Bank words managed font").selectOption({ label: "Ahem" });
  await page.getByRole("tab", { name: "Local Preview" }).click();
  await page.locator(".studio-preview-panel").getByRole("button", { name: "Student Preview", exact: true }).click();
  await extendedPreview.waitFor();
  await reusableBankWord.click();
  await firstExtendedTarget.click();
  assert.equal(await reusableBankWord.count(), 1, "a reusable item remains available after placement");
  await expect(firstExtendedTarget.locator("[data-drag-drop-target-text]")).toHaveCount(1);

  const distractorBankWord = extendedPreview.locator(`[data-drag-drop-word-id="${distractorWordId}"]`);
  await distractorBankWord.click();
  await expect(distractorBankWord).toHaveAttribute("aria-pressed", "true");
  await firstExtendedTarget.focus();
  await firstExtendedTarget.press("Enter");
  await expect(firstExtendedTarget.locator("[data-drag-drop-target-text]")).toHaveCount(2);
  assert.equal(await firstExtendedTarget.getAttribute("data-full"), "true");
  await reusableBankWord.click();
  await secondExtendedTarget.click();
  assert.equal(await secondExtendedTarget.locator("[data-drag-drop-target-text]").count(), 1, "a reusable item can be correct in a second target");
  assert.equal(await reusableBankWord.count(), 1);

  await page.getByRole("tab", { name: "Answer Key" }).click();
  await page.locator(".native-drag-drop-mapping select").nth(1).selectOption({ label: "First · word 1" });
  await page.getByRole("tab", { name: "Content" }).click();
  await reusableRow.getByRole("checkbox").uncheck();
  for (let wordCount = await page.locator(".native-drag-drop-word-row").count(); wordCount > 6; wordCount -= 1) await page.getByRole("button", { name: `Remove word ${wordCount}` }).click();
  await page.locator(".native-drag-drop-word-row").nth(4).getByRole("textbox").fill("A longer classroom phrase must wrap naturally in the bank.");
  await page.locator(".native-drag-drop-word-row").nth(5).getByRole("textbox").fill("Responsive fitting keeps this substantial phrase readable.");
  await page.getByRole("radio", { name: "Text drag-and-drop" }).check();
  await page.getByLabel("Answer bank height (px)").fill("128");
  await page.getByLabel("Upper text-image panel height (px)").fill("310");
  await page.getByRole("tab", { name: "Answer Key" }).click();
  await page.locator(".native-drag-drop-mapping select").nth(0).selectOption([
    { label: "repeated · word 2 · label B" },
    { label: "distractor · word 4 · label D" },
  ]);
  await page.getByRole("tab", { name: "Local Preview" }).click();
  await page.locator(".studio-preview-panel").getByRole("button", { name: "Student Preview", exact: true }).click();

  const textPreview = page.locator(".studio-preview-panel .native-drag-drop");
  const textBankWord = textPreview.locator(`[data-drag-drop-word-id="${reusableWordId}"]`);
  assert.equal(await textBankWord.locator(".native-drag-drop-short-label").textContent(), "B");
  assert.equal(await textBankWord.locator("span").last().textContent(), "repeated");
  await page.waitForFunction((surface) => surface.querySelector(".native-drag-drop-bank-items")?.dataset.fitStatus, await textPreview.elementHandle());
  let latestTextBankMeasurement = null;
  try {
    await expect.poll(async () => {
      latestTextBankMeasurement = await measureTextBank(textPreview);
      return latestTextBankMeasurement.fits;
    }, { timeout: 2_000, intervals: [50, 100, 250] }).toBe(true);
  } catch {
    assert.fail(`Text Drag & Drop bank did not fit: ${JSON.stringify(latestTextBankMeasurement)}`);
  }
  const textModeLayout = await textPreview.evaluate((surface) => {
    const bank = surface.querySelector(".native-drag-drop-bank");
    const bankItems = surface.querySelector(".native-drag-drop-bank-items");
    const workspace = surface.querySelector(".native-drag-drop-workspace");
    const phrases = [...bankItems.children].map((entry) => { const box = entry.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, fontSize: Number.parseFloat(getComputedStyle(entry).fontSize) }; });
    const surfaceRect = surface.getBoundingClientRect(); const bankRect = bank.getBoundingClientRect(); const itemsRect = bankItems.getBoundingClientRect();
    return {
      bank: bankRect.height, workspace: workspace.getBoundingClientRect().height,
      bankBottomAnchored: Math.abs(bankRect.bottom - surfaceRect.bottom) <= 1,
      bankOverflow: { x: bankItems.scrollWidth - bankItems.clientWidth, y: bankItems.scrollHeight - bankItems.clientHeight, overflowX: getComputedStyle(bankItems).overflowX, overflowY: getComputedStyle(bankItems).overflowY },
      phraseRows: new Set(phrases.map((phrase) => Math.round(phrase.top))).size,
      phrasesShareRows: phrases.some((phrase, index) => phrases.some((other, otherIndex) => otherIndex !== index && Math.abs(other.top - phrase.top) <= 1)),
      phrasesUseNaturalWidth: phrases.some((phrase) => phrase.width < itemsRect.width - 2),
      phrasesInside: phrases.every((phrase) => phrase.left >= itemsRect.left - 1 && phrase.right <= itemsRect.right + 1 && phrase.top >= itemsRect.top - 1 && phrase.bottom <= itemsRect.bottom + 1),
      minimumFontSize: Math.min(...phrases.map((phrase) => phrase.fontSize)),
      workspaceOverflowY: getComputedStyle(workspace).overflowY,
      workspaceNeedsScroll: workspace.scrollHeight > workspace.clientHeight + 1,
    };
  });
  assert.ok(Math.abs(textModeLayout.bank - 128) <= 1 && Math.abs(textModeLayout.workspace - 310) <= 1, JSON.stringify(textModeLayout));
  assert.ok(textModeLayout.bankBottomAnchored && textModeLayout.phraseRows > 1 && textModeLayout.phrasesShareRows && textModeLayout.phrasesUseNaturalWidth && textModeLayout.phrasesInside, JSON.stringify(textModeLayout));
  assert.deepEqual(textModeLayout.bankOverflow, { x: 0, y: 0, overflowX: "hidden", overflowY: "hidden" });
  assert.ok(textModeLayout.minimumFontSize >= 7.9, JSON.stringify(textModeLayout));
  assert.equal(textModeLayout.workspaceOverflowY, "auto");
  assert.equal(textModeLayout.workspaceNeedsScroll, true);
  await textBankWord.click();
  const firstTextTarget = textPreview.locator(`[data-drag-drop-target-id="${extendedInteraction.panels[0].dropTargets[0].id}"]`);
  assert.match(await firstTextTarget.getAttribute("aria-label"), /0 of 2 places used/);
  await firstTextTarget.click();
  assert.equal((await firstTextTarget.textContent()).trim(), "B", "text mode places only the stable short label");
  assert.equal(await textBankWord.count(), 0, "a non-reusable text phrase is consumed after placement");
  await textPreview.locator(`[data-drag-drop-word-id="${distractorWordId}"]`).click();
  await firstTextTarget.focus();
  await firstTextTarget.press("Enter");
  assert.equal((await firstTextTarget.textContent()).replaceAll(/\s+/g, ""), "BD", "multi-answer text targets keep compact stable labels");
  await page.waitForFunction((target) => {
    const items = target.querySelector(".native-drag-drop-target-items");
    return items && items.scrollWidth <= items.clientWidth + 1 && items.scrollHeight <= items.clientHeight + 1;
  }, await firstTextTarget.elementHandle());
  const targetFit = await firstTextTarget.evaluate((target) => {
    const targetRect = target.getBoundingClientRect(); const items = target.querySelector(".native-drag-drop-target-items"); const style = getComputedStyle(items);
    const labels = [...items.querySelectorAll("[data-drag-drop-target-text]")].map((label) => { const box = label.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }; });
    return { overflowX: style.overflowX, overflowY: style.overflowY, scrollX: items.scrollWidth - items.clientWidth, scrollY: items.scrollHeight - items.clientHeight, labelsInside: labels.every((box) => box.left >= targetRect.left - 1 && box.right <= targetRect.right + 1 && box.top >= targetRect.top - 1 && box.bottom <= targetRect.bottom + 1), labelsVisible: labels.every((box) => box.width > 0 && box.height > 0) };
  });
  assert.deepEqual(targetFit, { overflowX: "hidden", overflowY: "hidden", scrollX: 0, scrollY: 0, labelsInside: true, labelsVisible: true });

  await page.getByRole("tab", { name: "Layout" }).click();
  const targetCountBeforeImport = await page.locator(".native-drag-drop-authoring-target:not(.is-draft)").count();
  const bulkImporter = page.locator(".native-hotspot-bulk-importer");
  await bulkImporter.locator("summary").click();
  const importSurface = extendedInteraction.panels[0].surface;
  await bulkImporter.getByLabel("Paste target geometry").fill(
    `SOURCE ${importSurface.width}x${importSurface.height}\n\nPANEL 1\nTARGET 3 items=5 x=20 y=30 width=100 height=40`,
  );
  await bulkImporter.getByRole("button", { name: "Preview targets" }).click();
  await bulkImporter.getByRole("status").waitFor();
  assert.equal(await page.locator(".native-drag-drop-authoring-target:not(.is-draft)").count(), targetCountBeforeImport, "bulk preview is non-mutating");
  await bulkImporter.getByRole("button", { name: "Apply append" }).click();
  assert.equal(await page.locator(".native-drag-drop-authoring-target:not(.is-draft)").count(), targetCountBeforeImport + 1, "bulk apply updates public geometry and private mappings together");
}
