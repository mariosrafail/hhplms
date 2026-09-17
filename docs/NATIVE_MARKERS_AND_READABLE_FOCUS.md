# Native markers and readable focus

Local candidate based on dev `febd2a1e046a59550aaf8bafd1af99823171aed5`.

## Readable hotspots

`readableHighlights?: Array<{id: highlight-<32 hex>, area: {x,y,width,height}}>`
is the explicit multi-region representation (0?64 regions per hotspot).
It cannot coexist with `readableHighlightArea`. All regions are strictly bounded
by the readable image and outer focus. Legacy absent/singular/null fields retain
their original normalized serialization; the runtime adapter supplies a stable
legacy identity. The first region edit materializes the array and removes the
singular field. Empty arrays stay empty. Outer resize clamps each region without
deleting or renumbering any region. Color remains hotspot-wide.

The diameter control uses the existing 16?192 source-pixel circular bounds,
preserves the center where possible and clamps at the activity edge. It never
modifies focus/highlight geometry.

`useNativeHotspotAnchor` runs at the actual hotspot owner stage. It measures the
available clipping ancestors and surface width, preserves the full-width source
coordinate system, and translates the entire stage to center the active hotspot
with image-edge clamps. Shared canvases have one owner; flow children use the
existing parent/section/child projection. ResizeObserver handles layout changes.
Cleanup restores overridden styles. Only the activity crop is locked; readable
natural-width scrolling remains independent. Hotspot and visual-target CSS explicitly
overrides generic published-book button padding, backgrounds and minimum sizes;
authored icons and markers therefore remain visible in the actual LMS. The answer-bank return hint is
removed; bank geometry, refs, drag/keyboard return and live status remain.

## Image-only Mark the Words

New standalone and composite factories create `mark-the-words.visual.v1` pairs.
Text segmentation, old text authoring/rendering and historical normalizers remain
available for existing documents. The regular new editor opens directly in Visual.

Visual presentation optionally has `markerPresets` (at most 32). Each preset has
stable `marker-<32 hex>` identity plus `kind`, `color`, `thickness`, `height`,
`alignment` and `graphicAssetSlot`. Kinds are graphic/outline/underline, colors are
six-digit hex, thickness/height are integer source pixels in 1?192, alignment is
bottom/manual. Graphic presets require an activity_artwork slot; style presets
require null. Only explicit presets and legacy target graphic slots feed the
palette, never the general activity artwork inventory. Palette-only managed
assets remain referenced through cleanup, composite projection and publication.

New targets snapshot the active marker in optional `hotspot.marker`. Its graphic
slot must exactly match the existing hotspot graphic binding. These redundant
legacy-compatible bindings are strictly checked, and authoring writes them in the
same mutation. The private Correct/Incorrect drawing choice only mutates Teacher
answers. Defaults are separate from target selection. New geometry defaults to a
3-pixel bottom strip; automatic geometry follows click-area edits. Editing the
marking rectangle explicitly switches to manual geometry. Outline uses the entire
click rectangle with its stroke inset to prevent clipping. One SVG/image renderer
is used by authoring, Teacher, Student and submitted review.

Teacher manual toggle is gated by the private correct-target map, as are reveal
commands and counters. Student can mark every authored target. Legacy no-graphic
targets use a visible underline fallback. Each new Student selection snapshots the
active approved preset ID; changing the palette never restyles previous marks.

## Response extension and scoring

The existing `native-response.v1` selected-ID arrays remain authoritative. Each
Mark the Words item may additionally carry `markers: { [selectedTargetId]: presetId }`.
The runtime state keeps these in `responses.markers[groupId]`. Canonical restoration,
final submission, strict server validation, persistence and review preserve this
optional metadata. The server rejects foreign/unknown/unselected marker bindings,
duplicate or foreign selected IDs and arbitrary extra fields. Old array-only
submissions remain valid and serialize unchanged.

Scoring is unchanged: exact selected set per panel, then the existing proportion
of correct panels. A wrong extra or missing correct target fails that panel;
marker choice has no effect. The LMS takes its existing final-submit snapshot,
retains marks on failure and locks the successfully submitted attempt. This LMS
currently has in-memory unsent responses; no new server draft-save lifecycle is
introduced. Submitted restoration preserves marker metadata.

## CI risk and derived state

No migration, compiler identity/fingerprint change, immutable payload rewrite,
registry content regeneration, or hosted mutation is required. Optional public
fields are validated by the same native readers used in publication. Untouched
legacy payloads retain their original shapes. Generated web/Builder/Player and
Cloudflare bundles must be rebuilt; checked-in schema contracts and recovered
book content do not change.

Coverage: `native-marker-candidate.test.js`, the existing readable/visual/text and
composite unit suites, `native-marker-candidate-regressions.mjs` through the normal
runtime gate, the updated hosted visual-authoring acceptance, and
`_native-marker-persistence.mjs` through the existing PostgreSQL assignment suite.
The latter uses real Builder save/reload, publication compiler, pinned assignment,
authenticated book-content Submit and persisted results. Under
`PUBLISHED_BOOK_BROWSER=1`, `_native-marker-browser.mjs` uses the actual built LMS
and Cloudflare Worker with a disposable database; only media bytes and the first
intentional retry failure are intercepted. Historical, variable-height, shared,
Oldschool and bundle checks remain required. Execution results belong in the local
candidate report, not in this contract document.
