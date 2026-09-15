# Native Multiple Choice authoring

The hosted Builder keeps semantic Multiple Choice authoring and visual geometry authoring separate. Use **Bulk generate from text** on the Content tab to create prompts, options, selection modes, and private Teacher answers. The Visual tab's **Bulk import hotspots from text** convenience creates only public hotspot rectangles and bindings to the existing current questions and options.

## Bulk hotspot workflow

1. Create the semantic questions and options, and set their answers through the normal Content and Answer Key flows.
2. Enable Visual mode, add the required panels, and upload every referenced panel background. The upload establishes the panel's intrinsic source dimensions; the importer never uses the placeholder dimensions of a panel without a background.
3. Paste one plain-text geometry document and choose **Import hotspots**.
4. Review the generated selection with the existing drag, resize, keyboard, and numeric controls.
5. Resolve any remaining unmapped options and use the existing explicit **Save Draft** action. Importing does not save or make a network request.

The accepted grammar is fixed-order and case-sensitive:

```text
SOURCE <width>x<height>

PANEL <panelOrdinal>
<questionOrdinal>.<optionOrdinal> x=<x> y=<y> width=<width> height=<height>
```

For example:

```text
SOURCE 1024x582

PANEL 1
1.1 x=120 y=185 width=190 height=30
1.2 x=315 y=185 width=170 height=30
1.3 x=490 y=185 width=180 height=30

PANEL 2
2.1 x=140 y=240 width=160 height=30
2.2 x=305 y=240 width=190 height=30
2.3 x=500 y=240 width=150 height=30
```

`SOURCE` is the one global coordinate plane for every panel block. Panel, question, and option ordinals are 1-based and resolve against the current order only when the import is applied: `1.3` means current Question 1, Option 3. Stable question and option IDs, never ordinals, are stored in the generated hotspots.

Input is limited to 65,536 characters. That bound allows more than 300 characters for each of the maximum 200 current Multiple Choice option bindings (20 questions × 10 options), while preventing unbounded pasted input. Blank lines, CRLF/CR/LF line endings, and ordinary leading, trailing, or separating spaces and tabs are accepted. Comments, extra directives, reordered or extra geometry fields, fractions, exponent notation, non-safe integers, rectangles outside SOURCE, duplicate panels, duplicate bindings, and trailing tokens are rejected with a line-numbered error. A failure leaves the draft unchanged.

## Scaling and replacement

Geometry is scaled to each uploaded background's intrinsic `sourceWidth` and `sourceHeight` by mapping rectangle edges:

```text
left   = floor(x * targetWidth / sourceWidth)
top    = floor(y * targetHeight / sourceHeight)
right  = ceil((x + width) * targetWidth / sourceWidth)
bottom = ceil((y + height) * targetHeight / sourceHeight)
```

The stored target rectangle is `{ x: left, y: top, width: right - left, height: bottom - top }`. Equal dimensions preserve geometry exactly, and an uncropped image at a different resolution keeps proportional placement. X and Y are scaled independently when aspect ratios differ; the Builder warns that cropped, translated, or reflowed images require manual correction.

Listed panels that already contain answer hotspots require **Replace existing hotspots on listed panels**. Replacement never touches an unlisted panel. A matching question-and-option binding keeps its stable hotspot ID even if it moves between two listed panels; new bindings receive new `hot` IDs, and omitted bindings are removed only from listed panels. Bindings already present on an unlisted panel and question layouts that would span panels fail closed.

Partial geometry is allowed in local authoring, but it does not weaken readiness: every option still needs exactly one hotspot before Save Draft is available. The pasted source remains only in local component state and is not persisted, transmitted, or copied into either public or Teacher documents. The importer never reads or changes correctness data.

This convenience is available only for native Multiple Choice. It does not upload or parse XML, IWB, OCR, or images, and it does not change the generic decoded-IWB parser boundary documented in `book-builder/ultimate-activity-parsers.md`.
