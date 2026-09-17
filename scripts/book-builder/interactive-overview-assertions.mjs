import assert from "node:assert/strict";
import path from "node:path";

export async function assertInteractiveOverview(frame, expected, label, screenshot = {}) {
  const cards = frame.locator("[data-overview-entry]");
  const images = frame.locator(".teacher-unit-page-thumb img");
  await cards.nth(expected.labels.length - 1).waitFor();
  const imageCount = expected.pageIds ? expected.pageIds.flat().length : expected.labels.length;
  await images.nth(imageCount - 1).waitFor();
  await frame.locator("html").evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await images.evaluateAll(async (nodes, expectedCount) => {
    if (nodes.length !== expectedCount) throw new Error(`Expected ${expectedCount} overview images, found ${nodes.length}`);
    await Promise.all(nodes.map((image) => image.decode()));
  }, imageCount);

  await cards.page().mouse.move(0, 0);
  const hoveredOverviewElements = await frame.locator("html").evaluate(() => [...document.querySelectorAll(
    "[data-overview-entry]:hover, .teacher-unit-page-open:hover, .teacher-unit-page-thumb:hover",
  )].map((element) => ({ className: element.className, pageId: element.dataset.pageId, entry: element.dataset.overviewEntry })));
  assert.deepEqual(hoveredOverviewElements, [], `${label} baseline requires no hovered overview cards, page buttons or thumbnails after neutral pointer move`);
  console.log(`${label}: neutral pointer baseline PASS; no hovered overview elements`);

  const metrics = await frame.locator(".teacher-offline-unit-overview").evaluate((panel) => {
    const entries = [...panel.querySelectorAll("[data-overview-entry]")];
    const rectangle = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const directionalOverflow = (child, container) => ({
      left: Math.max(0, container.left - child.left),
      right: Math.max(0, child.right - container.right),
      top: Math.max(0, container.top - child.top),
      bottom: Math.max(0, child.bottom - container.bottom),
    });
    const maximumOverflow = (overflow) => Math.max(...Object.values(overflow));
    const rectangles = entries.map((entry) => entry.getBoundingClientRect());
    const imageNodes = entries.flatMap((entry) => [...entry.querySelectorAll(".teacher-unit-page-thumb img")]);
    const pageImages = imageNodes.map((image) => {
      const button = image.closest(".teacher-unit-page-open");
      const thumbnail = image.closest(".teacher-unit-page-thumb");
      const imageRectangle = rectangle(image);
      const thumbnailRectangle = rectangle(thumbnail);
      const containerRectangle = rectangle(button || thumbnail);
      return {
        entryIndex: entries.indexOf(image.closest("[data-overview-entry]")),
        pageId: button?.dataset.pageId || null,
        rectangle: imageRectangle,
        containerRectangle,
        thumbnailRectangle,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        objectFit: getComputedStyle(image).objectFit,
        containerOverflow: directionalOverflow(imageRectangle, containerRectangle),
        thumbnailOverflow: directionalOverflow(imageRectangle, thumbnailRectangle),
      };
    });
    const imageEntryIndices = pageImages.map((image) => image.entryIndex);
    const imageRectangles = pageImages.map((image) => image.rectangle);
    const panelRect = panel.getBoundingClientRect();
    const geometry = entries.map((entry) => {
      const card = rectangle(entry);
      const children = [
        ["copy", entry.querySelector(".teacher-unit-page-copy")],
        ["title", entry.querySelector(".teacher-unit-page-copy strong")],
        ["pageLabel", entry.querySelector(".teacher-unit-page-copy b")],
        ...[...entry.querySelectorAll(".teacher-unit-page-thumb")].map((thumbnail) => ["thumbnail", thumbnail]),
        ...[...entry.querySelectorAll(".teacher-unit-page-open")].map((button) => ["pageButton", button]),
        ...[...entry.querySelectorAll(".teacher-unit-page-thumb img")].map((image) => ["image", image]),
      ].filter(([, node]) => node).map(([kind, node]) => {
        const child = rectangle(node);
        const cardOverflow = directionalOverflow(child, card);
        const panelOverflow = directionalOverflow(child, panelRect);
        const style = kind === "title" || kind === "pageLabel" ? getComputedStyle(node) : null;
        return {
          kind,
          text: node.textContent?.trim() || null,
          rectangle: child,
          cardOverflow,
          panelOverflow,
          maximumCardOverflow: maximumOverflow(cardOverflow),
          maximumPanelOverflow: maximumOverflow(panelOverflow),
          textStyle: style ? {
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontStretch: style.fontStretch,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            overflow: style.overflow,
            textOverflow: style.textOverflow,
            whiteSpace: style.whiteSpace,
          } : null,
        };
      });
      return {
        entry: entry.dataset.overviewEntry,
        card,
        cardPanelOverflow: directionalOverflow(card, panelRect),
        children,
      };
    });
    const offenders = geometry.flatMap(({ entry, children }) => children.map((child) => ({ entry, ...child })))
      .sort((left, right) => Math.max(right.maximumCardOverflow, right.maximumPanelOverflow) - Math.max(left.maximumCardOverflow, left.maximumPanelOverflow));
    const loadedFontFaces = document.fonts ? [...document.fonts].map((face) => ({ family: face.family, status: face.status, style: face.style, weight: face.weight })) : [];
    return {
      pageImages,
      imageEntryIndices,
      pageIds: entries.map((entry) => [...entry.querySelectorAll(".teacher-unit-page-open")].map((button) => button.dataset.pageId)),
      labels: entries.map((entry) => entry.querySelector(".teacher-unit-page-copy b")?.textContent?.trim()),
      rows: entries.map((entry) => Number(entry.dataset.overviewRow)),
      weights: entries.map((entry) => Number(entry.dataset.overviewWeight)),
      spans: entries.map((entry) => Number(entry.dataset.overviewColumnSpan)),
      cardWidths: rectangles.map((rectangle) => rectangle.width),
      imageWidths: imageRectangles.map((rectangle) => rectangle.width),
      imageHeights: imageRectangles.map((rectangle) => rectangle.height),
      naturalWidths: pageImages.map((image) => image.naturalWidth),
      naturalHeights: pageImages.map((image) => image.naturalHeight),
      rowTopSpreads: [1, 2].map((row) => {
        const tops = rectangles.filter((_, index) => Number(entries[index].dataset.overviewRow) === row).map((rectangle) => rectangle.top);
        return tops.length ? Math.max(...tops) - Math.min(...tops) : null;
      }),
      minimumWidth: Math.min(...rectangles.map((rectangle) => rectangle.width)),
      minimumWidthRatio: Math.min(...rectangles.map((rectangle) => rectangle.width)) / panelRect.width,
      contained: rectangles.every((rectangle) => rectangle.left >= panelRect.left - 2 && rectangle.right <= panelRect.right + 2 && rectangle.top >= panelRect.top - 2 && rectangle.bottom <= panelRect.bottom + 2),
      overlaps: rectangles.some((first, index) => rectangles.slice(index + 1).some((second) => (
        first.left < second.right - 1 && first.right > second.left + 1
        && first.top < second.bottom - 1 && first.bottom > second.top + 1
      ))),
      imagesContained: pageImages.every((image) => maximumOverflow(image.containerOverflow) <= 1 && maximumOverflow(image.thumbnailOverflow) <= 1),
      objectFits: pageImages.map((image) => image.objectFit),
      thumbnailHeights: [...panel.querySelectorAll(".teacher-unit-page-thumb")].map((thumbnail) => thumbnail.getBoundingClientRect().height),
      titleFontSizes: entries.map((entry) => Number.parseFloat(getComputedStyle(entry.querySelector(".teacher-unit-page-copy strong")).fontSize)),
      pageLabelFontSizes: entries.map((entry) => Number.parseFloat(getComputedStyle(entry.querySelector(".teacher-unit-page-copy b")).fontSize)),
      overviewBook: panel.dataset.overviewBook,
      thumbnailToken: getComputedStyle(panel).getPropertyValue("--teacher-unit-overview-thumbnail-height").trim(),
      panelOverflow: panel.scrollWidth - panel.clientWidth,
      panelVerticalOverflow: panel.scrollHeight - panel.clientHeight,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      documentVerticalOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      panelGeometry: {
        rectangle: rectangle(panel),
        clientWidth: panel.clientWidth,
        clientHeight: panel.clientHeight,
        scrollWidth: panel.scrollWidth,
        scrollHeight: panel.scrollHeight,
      },
      geometry,
      maximumOffender: offenders[0],
      fontState: {
        status: document.fonts?.status || "unsupported",
        pfStieleCheck: document.fonts?.check('30.4px "PF Stiele Futura Medium"') || false,
        arialNarrowCheck: document.fonts?.check('30.4px "Arial Narrow"') || false,
        arialCheck: document.fonts?.check("30.4px Arial") || false,
        loadedFontFaces,
      },
    };
  });

  const childContainmentFailures = metrics.geometry.flatMap(({ entry, children }) => children
    .filter((child) => child.maximumCardOverflow > 1 || child.maximumPanelOverflow > 1)
    .map((child) => ({ entry, ...child })));
  console.log(`${label} geometry: ${JSON.stringify({ panel: metrics.panelGeometry, fontState: metrics.fontState, maximumOffender: metrics.maximumOffender, childContainmentFailures, pageImages: metrics.pageImages })}`);

  assert.deepEqual(metrics.labels, expected.labels, `${label} labels`);
  if (expected.pageIds) assert.deepEqual(metrics.pageIds, expected.pageIds, `${label} real page identities and order`);
  assert.deepEqual(metrics.pageImages.map((image) => image.pageId), metrics.pageIds.flat(), `${label} images follow their independent page buttons`);
  assert.deepEqual(metrics.rows, expected.rows, `${label} rows`);
  assert.deepEqual(metrics.weights, expected.weights, `${label} weights`);
  if (expected.spans) assert.deepEqual(metrics.spans, expected.spans, `${label} column spans`);
  assert.equal(metrics.overviewBook, expected.overviewBook, `${label} component identity`);
  assert.deepEqual([1, 2].map((row) => metrics.spans
    .filter((_, index) => metrics.rows[index] === row)
    .reduce((sum, span) => sum + span, 0)), expected.columnTotals, `${label} proportional columns`);
  assert.ok(metrics.rowTopSpreads.every((spread) => spread !== null && spread <= 3), `${label} exactly two visual rows`);
  assert.ok(metrics.minimumWidth >= 80 && metrics.minimumWidthRatio >= 0.1, `${label} readable card width: ${metrics.minimumWidth} (${metrics.minimumWidthRatio})`);
  assert.equal(metrics.contained, true, `${label} entries contained`);
  assert.equal(metrics.overlaps, false, `${label} no overlap`);
  assert.equal(metrics.imagesContained, true, `${label} images are not clipped`);
  assert.ok(metrics.objectFits.every((value) => value === "contain"), `${label} object-fit contain`);
  assert.equal(metrics.objectFits.length, imageCount, `${label} all images rendered`);
  assert.equal(metrics.fontState.status, "loaded", `${label} deterministic font state`);
  if (expected.overviewBook === "workbook" || expected.overviewBook === "grammar-book") {
    assert.deepEqual(childContainmentFailures, [], `${label} managed card children fit their cards and panel`);
    assert.deepEqual(metrics.weights.map((_, entryIndex) => metrics.naturalWidths.reduce((sum, width, index) => sum + (metrics.imageEntryIndices[index] === entryIndex ? (width > metrics.naturalHeights[index] ? 2 : 1) : 0), 0)), metrics.weights, `${label} weights follow intrinsic managed page geometry`);
  }
  assert.ok(metrics.panelOverflow <= 1, `${label} panel overflow: ${metrics.panelOverflow}px`);
  assert.ok(metrics.panelVerticalOverflow <= 1, `${label} vertical panel overflow: ${metrics.panelVerticalOverflow}px`);
  assert.ok(metrics.documentOverflow <= 1, `${label} document overflow`);
  assert.ok(metrics.documentVerticalOverflow <= 1, `${label} vertical document overflow`);

  if (expected.imageHeightParityTolerance !== undefined) {
    const singleIndices = metrics.imageEntryIndices.map((entryIndex, index) => metrics.weights[entryIndex] === 1 ? index : -1).filter((index) => index >= 0);
    const wideIndices = metrics.imageEntryIndices.map((entryIndex, index) => metrics.weights[entryIndex] === 2 ? index : -1).filter((index) => index >= 0);
    const spreadIndices = wideIndices.filter((index) => metrics.imageEntryIndices.filter((entryIndex) => entryIndex === metrics.imageEntryIndices[index]).length === 1);
    assert.ok(singleIndices.length > 0 && wideIndices.length > 0, `${label} includes singles and spread/group cards`);
    const targetHeight = singleIndices.reduce((sum, index) => sum + metrics.imageHeights[index], 0) / singleIndices.length;
    const maximumHeightDelta = Math.max(...wideIndices.map((index) => Math.abs(metrics.imageHeights[index] - targetHeight)));
    assert.ok(maximumHeightDelta <= expected.imageHeightParityTolerance, `${label} actual image height parity: ${maximumHeightDelta}px`);
    assert.ok(Math.abs(targetHeight - expected.singleImageHeight) <= expected.imageHeightParityTolerance, `${label} single-page image height remains ${expected.singleImageHeight}px: ${targetHeight}px`);
    if (spreadIndices.length) assert.ok(Math.min(...spreadIndices.map((index) => metrics.imageWidths[index])) > Math.max(...singleIndices.map((index) => metrics.imageWidths[index])), `${label} spread images are wider than singles`);
    assert.ok(Math.min(...wideIndices.map((index) => metrics.cardWidths[metrics.imageEntryIndices[index]])) > Math.max(...singleIndices.map((index) => metrics.cardWidths[metrics.imageEntryIndices[index]])), `${label} spread/group cards are wider than singles`);
    metrics.singleImageHeight = targetHeight;
    metrics.maximumSpreadHeightDelta = maximumHeightDelta;
  }

  const ratioImages = metrics.pageImages.filter((image) => expected.verifyNaturalAspectRatio || metrics.pageImages.filter((candidate) => candidate.entryIndex === image.entryIndex).length > 1);
  if (ratioImages.length) {
    const maximumAspectRatioDelta = Math.max(...ratioImages.map((image) => Math.abs(
      (image.rectangle.width / image.rectangle.height) - (image.naturalWidth / image.naturalHeight),
    )));
    assert.ok(maximumAspectRatioDelta <= 0.01, `${label} preserves natural image aspect ratios: ${maximumAspectRatioDelta}`);
    metrics.maximumAspectRatioDelta = maximumAspectRatioDelta;
  }

  console.log(`${label}: ${JSON.stringify(metrics.labels.map((pageLabel, index) => ({ pageLabel, weight: metrics.weights[index], span: metrics.spans[index], cardWidth: metrics.cardWidths[index], images: metrics.pageImages.filter((image) => image.entryIndex === index).map((image) => ({ pageId: image.pageId, imageWidth: image.rectangle.width, imageHeight: image.rectangle.height })) })))}; token ${metrics.thumbnailToken}; title ${metrics.titleFontSizes[0]}px; page label ${metrics.pageLabelFontSizes[0]}px; maximum height delta ${metrics.maximumSpreadHeightDelta}; maximum natural ratio delta ${metrics.maximumAspectRatioDelta}`);

  if (screenshot.directory && screenshot.fileName) {
    await frame.locator(".teacher-offline-unit-overview-screen").screenshot({ path: path.join(screenshot.directory, screenshot.fileName) });
  }

  return metrics;
}
