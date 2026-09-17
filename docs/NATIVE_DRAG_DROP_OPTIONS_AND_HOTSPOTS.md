# Native Drag & Drop options and readable hotspots

Local candidate, verified repository baseline `23fae367b29e9bd4ce0d6ee8f69928e97345385b`, 2026-09-13.

`interaction.randomize` is an optional strict boolean. New activities use `true`.
Missing fields retain the existing randomized runtime behavior and remain absent
from legacy normalized documents. Explicit `false` displays `interaction.words`
in authored order, without sorting labels or mutating the array. Randomized order
is retained across response changes, panels, reuse and reset. Returning consumed
items restores their relative position. Multipart sections preserve this field
through parent normalization, Save and child projection.

The existing all-required `wordIds`, derived target capacity and private Teacher
mappings are unchanged. Reusable IDs can appear in different targets, never twice
in the same target. Instance removal is local to that target. Duplicate visible
text remains legal. The editor continues to reject cross-target non-reusable
mapping conflicts and turning reuse off before resolving existing conflicts.

Target content uses available dimensions and wrapping instead of miniature scroll
containers. Text fitting is bounded by the existing minimum and only applies when
the content overflows; authored typography values and target geometry are retained.
Images use compact padding, contain sizing and authored display bounds, including
captions. Drag proxies copy source dimensions and styling before applying the
source's visual scale once. Answer bank, text image and Readable Text viewports
retain their scrolling behavior. Content cards keep controls keyed by stable ID;
pending uploads block Save and cannot attach to another reordered item.

Standalone Drag & Drop uses the common top-level `readableText` and
`audioTextHotspots` contracts. Each hotspot references a stable `interaction.panels`
ID and its `surface`; the authoring canvas renders that panel's image composition.
Activity marker coordinates are independent from readable source focus/highlight
coordinates. Background resizing scales and bounds the circular marker only.
Panel deletion removes its hotspots and releases audio references only when unused.
Removing Readable Text uses the existing shared cleanup. Optional MP3 assets keep
the common authorization, MIME and managed asset requirements.
Image layer/item requirements explicitly accept raster MIME types, so an audio
asset cannot also satisfy a Drag & Drop image slot at Save or publication.

Local preview, hosted draft and published Student/Teacher renderers use the same
`NativeAudioTextHotspotButtons` and `NativeReadableTextPresentation` callbacks;
panel changes close the active excerpt/audio. Read-only review can open excerpts
without modifying responses. Hotspots remain sibling controls above drop targets.

Multipart media remain parent-owned. Current child projections persist section
interactions/assets, not top-level child readable text or hotspots. Child media
tabs remain filtered and no child network save is introduced. Therefore the new
hotspot authoring/runtime scope is standalone; the ordering, item layout and
response behavior improvements also apply to embedded Drag & Drop.

No compiler identity, historical release bytes/hashes, assignment pins, schema,
dependency or migration changes are required. The historical fixture explicitly
reconstructs the pre-option source instead of inheriting a new-activity default;
all fixed historical hashes remain asserted.

Regression entry points: `tests/native-drag-drop-options-hotspots.test.js`,
`tests/native-drag-drop.test.js`, `tests/historical-managed-drag-drop.test.js`,
`test:lms-native-drag-drop-layout` (including
`native-drag-drop-improvement-regressions.mjs` and shared authoring), and
`test:integration` through `native-composition-persistence.test.js`.
Execution receipts and screenshots are task artifacts, not proof of hosted
publication/deployment or production readiness.

Standard and Text background uploads now use validated intrinsic dimensions in
the existing panel surface. Replacing the first locked background resizes artwork,
targets and activity-side markers together; decorative layer replacement retains
the canvas. Embedded fixed-panel/shared-canvas owners retain their surface.
Standard runtime uses the same bounded, centered aspect-ratio sizing as Multiple
Choice, with the bank overlaid on that stage. The root also supplies its panel
ratio to content-sized LMS hosts. Readable focus remains in the shared presenter;
opening/closing it does not remount the response or Teacher session. No geometry
is rewritten on load or derived from rendered pixels.

Variable-height browser regressions cover 1024x291, 1024x312 and 1024x582,
Student/Teacher, direct, hosted-draft and published runners, desktop/small/scaled
views, actual placements/removals, reveal retention, bounded rectangles and
settled ResizeObserver callbacks. The authoring fixture exercises background
upload/replacement, decoration replacement and normalized Save/reload locally.
