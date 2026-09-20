import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

// One browser snapshot includes both element boxes and every text-node offset.
// Keep the original 1px descendant/Range checks, including whitespace rectangles.
export function captureDragDropTarget(target) {
  const rect = (r) => ({ x: r.x, y: r.y, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
  const outer = rect(target.getBoundingClientRect());
  const overflow = (r) => ({ left: Math.max(0, outer.left - r.left), right: Math.max(0, r.right - outer.right), top: Math.max(0, outer.top - r.top), bottom: Math.max(0, r.bottom - outer.bottom) });
  const rangeRects = (range) => [...range.getClientRects()].map((r) => ({ rect: rect(r), overflow: overflow(r) }));
  const properties = [
    "display", "position", "boxSizing", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight",
    "whiteSpace", "overflowWrap", "wordBreak", "letterSpacing", "wordSpacing", "flex", "flexBasis", "flexGrow",
    "flexShrink", "flexWrap", "alignItems", "alignContent", "justifyContent", "gap", "padding", "margin", "borderWidth",
    "minWidth", "minHeight", "maxWidth", "maxHeight", "width", "height", "overflowX", "overflowY", "transform",
    "transformOrigin", "transitionProperty", "transitionDuration", "transitionDelay", "animationName", "animationDuration", "opacity", "visibility",
  ];
  const all = [target, ...target.querySelectorAll("*")];
  const nodes = all.map((el, index) => {
    const css = getComputedStyle(el), range = document.createRange();
    range.selectNodeContents(el);
    const texts = [];
    for (const [nodeIndex, node] of [...el.childNodes].entries()) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const pieces = [];
      for (let start = 0; start < node.length; start++) {
        const character = document.createRange();
        character.setStart(node, start); character.setEnd(node, start + 1);
        pieces.push({ start, end: start + 1, text: node.textContent.slice(start, start + 1), rects: rangeRects(character) });
      }
      texts.push({ nodeIndex, text: node.textContent, pieces });
    }
    return {
      index, parentIndex: all.indexOf(el.parentElement), tag: el.tagName, className: el.className, text: el.textContent,
      checked: el.matches(".native-drag-drop-target-items, [data-drag-drop-target-text], .native-drag-drop-image-content, img, .native-drag-drop-image-caption"),
      attributes: Object.fromEntries([...el.attributes].map((a) => [a.name, a.value])), rect: rect(el.getBoundingClientRect()),
      scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, clientHeight: el.clientHeight,
      offsetWidth: el.offsetWidth, offsetHeight: el.offsetHeight, css: Object.fromEntries(properties.map((key) => [key, css[key]])),
      ranges: rangeRects(range), texts,
      image: el instanceof HTMLImageElement ? { complete: el.complete, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, currentSrc: el.currentSrc } : null,
    };
  });
  const wrapper = target.querySelector(".native-drag-drop-target-items");
  return {
    timestamp: performance.now(), outer, nodes,
    fonts: { status: document.fonts.status, faces: [...document.fonts].map((font) => ({ family: font.family, status: font.status, weight: font.weight })) },
    layout: target.closest(".native-drag-drop").dataset.layoutMode,
    scale: getComputedStyle(document.querySelector("#root > div")).transform, responses: structuredClone(dnd.responses),
    // Old attributes can survive disabling the fitter; never use them as readiness for image targets.
    fit: { ...wrapper.dataset, enabledForCurrentContent: !wrapper.querySelector("[data-image-item]") },
    animations: target.getAnimations({ subtree: true }).map((animation) => ({ playState: animation.playState, currentTime: animation.currentTime, effect: animation.effect.getTiming() })),
    violations: nodes.flatMap((node) => node.ranges.filter((r) => Object.values(r.overflow).some((value) => value > 1)).map((r) => ({ index: node.index, tag: node.tag, className: node.className, ...r }))),
  };
}

export function assertDragDropContained(snapshot) {
  const outer = snapshot.outer;
  for (const node of snapshot.nodes.filter((entry) => entry.checked)) {
    const box = node.rect;
    const m = { tag: node.className || node.tag, overflowX: node.css.overflowX, overflowY: node.css.overflowY,
      visible: box.width > 0 && box.height > 0 && box.left >= outer.left - 1 && box.right <= outer.right + 1 && box.top >= outer.top - 1 && box.bottom <= outer.bottom + 1,
      scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
      textContained: node.ranges.every(({ rect: r }) => r.left >= outer.left - 1 && r.right <= outer.right + 1 && r.top >= outer.top - 1 && r.bottom <= outer.bottom + 1) };
    assert.ok(!["auto", "scroll"].includes(m.overflowX) && !["auto", "scroll"].includes(m.overflowY), JSON.stringify(m));
    assert.ok(m.visible && m.textContained, JSON.stringify(m));
    assert.ok(m.scrollWidth <= m.clientWidth + 1 && m.scrollHeight <= m.clientHeight + 1, JSON.stringify(m));
  }
}

export async function verifyDragDropContainment(locator, output, label) {
  const snapshot = await locator.evaluate(captureDragDropTarget);
  await writeFile(`${output}/${label}.json`, JSON.stringify(snapshot, null, 2));
  try { assertDragDropContained(snapshot); }
  catch (error) {
    await locator.page().screenshot({ path: `${output}/${label}-failure.png`, fullPage: true });
    throw error;
  }
  return snapshot;
}
