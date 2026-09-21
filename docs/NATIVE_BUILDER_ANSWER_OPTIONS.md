# Native Builder answer options

Local candidate on `fe98327c3c775cae64e472c52a9a35ec6e2aa53e`.

Drag & Drop targets accept optional `answerMode: "all" | "any"`. Absence
retains all-required grading. `any` requires capacity one and at least one
private mapped ID; all-required still requires exact capacity coverage.
Eligibility across targets does not imply reuse. A deterministic augmenting-path
matching checks feasibility and supplies Teacher reveal across the complete
activity. Submission retains strict capacity, identity and non-reuse checks.
Optional boolean `sentenceStart` changes only Teacher target display, through
the shared renderer. Bank text, stored words, image items and text-mode labels
are unchanged. The controls are in Layout, after selecting a target.

Visual Mark the Words opts into `answerMode: "outline-category"` explicitly
in the Visual editor. The public marker palette remains the existing palette.
Outline category identity is normalized hex color, independent of preset ID or
geometry. Graphic/underline presets remain distinct and legacy palettes and
grading are unchanged. In grouped mode each private panel answer has a
`categories` map from correct target ID to normalized color. Public hotspots
cannot contain markers or graphic bindings. Existing per-target styles are
removed on explicit opt-in; outline appearance comes from the selected palette
entry. Correctness requires both the exact target set and the private categories.
Responses keep the existing approved preset-ID metadata, with recoloring replacing
one target's selection metadata. Teacher reveal resolves the private category
through the public palette. Section duplication remaps private map keys too.

Shared-canvas Text Drag & Drop keeps `kind: "drag-drop", layoutMode: "text"`.
A section's optional `textRegion` owns a rectangular crop in parent source
coordinates. The existing `textPanelHeightPx` bounds its visible scroll viewport;
the existing `bankRegion` stays fixed. The parent background masks out the owned
crop; the child renders that crop once, with image and targets translated together.
Text regions, targets and banks retain cross-section overlap/bounds validation.
The parent editor exposes text-region geometry and preserves it across child
edits, duplication and save/reload. Flow sections retain their existing layout.

No migration, historical compiler identity, frozen release rewrite, generated
registry or runtime database contract change is required. Public/Teacher readers
and the authoritative assignment scorer consume these explicit optional fields.
Regression entry points: `tests/native-builder-options.test.js` and
`native-builder-options-regressions.mjs` through the existing native runtime gate.
Execution results and limitations are recorded separately; this contract is not
hosted acceptance evidence.


## Review corrections: occupied state and authoring conversion

Teacher placement uses the effective visible target contents, including reveal
slots, for capacity checks, occupied/full metadata and accessible counts. A full
revealed target rejects click, pointer and keyboard placement without committing
a hidden manual answer or announcing success. Revealed answers remain read-only;
reset clears reveal and manual state through the existing owner path.

Grouped Mark the Words drawing chooses an outline preset on initialization and
also substitutes a valid outline for incompatible inherited drawing defaults.
Trailing legacy graphic/underline presets stay in the palette. This authoring
fallback does not change any existing private target category assignment.

Disabling outline-category grading is an explicitly destructive conversion.
The Builder asks for confirmation before discarding private category assignments;
Cancel leaves the entire public/Teacher pair unchanged. The authoring helper
also requires `{ confirmed: true }` before disabling an enabled grouped activity.
Confirmed disable retains correct target IDs and the palette, removes the
explicit mode and private category map, and stores no hidden backup in public
fields. Save/reload then uses the unchanged strict legacy contract. Re-enabling
a converted activity assigns the first available outline category to correct
targets; previous colors are not recoverable and this is stated in the dialog.
Enabling an already grouped activity is idempotent and preserves its categories.

The review regressions exercise real pointer/keyboard/click handlers and the
existing parent Mark the Words editor with save/read request fixtures and strict
normalization. They run through the existing native runtime browser gate.
