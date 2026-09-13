# Visual targets and five-kind shared canvas

## Versioned native documents

`mark-the-words.visual.v1` is an opt-in native interaction/solution version for image targets. Public `targets` carry stable IDs and accessible labels; each panel hotspot binds one target and owns separate `area` (interaction) and `markArea` (presentation) rectangles in source-image coordinates. There are no generated passages or word tokens. The private solution alone stores `correctTargetIds` per panel. Legacy text and image-hotspot normalization, identities, response groups and Teacher passage reveal retain their existing behavior.

`multi-part.v2` extends shared canvas sections to DD, MC, visual Mark the Words, Open Response and Complete the Sentences. Both parent interaction and private solution carry the same version. `multi-part.v1` retains its existing DD/MC canvas contract; both versions retain all six flow types and reject recursive composition. The editor promotes the parent version only when adding one of the new canvas kinds.

These native subdocuments remain within the existing immutable publication envelope. No compiler ID, compatibility descriptor/hash, migration, release payload or assignment pin is rewritten. Existing compilers already snapshot and checksum the complete native documents and asset graph; the explicit native schema identifies the new payload semantics. Historical native versions continue through their original branches. The publication regression compiles both historical and new sources, checks old output equality, verifies frozen releases after removal of drafts, and checks private keys and marker dependencies.

## Geometry, assets and assessment

Only authored click/response/drop regions participate in cross-section overlap checks. Mark graphics may extend beyond their click region but must remain inside the source canvas; they are passive and never intercept events. All child surfaces use the parent coordinate system and only the parent renders the common image. OR preserves response-region typography and fit; CTS preserves its standalone answerStyle source.

Graphics use managed `activity_artwork` references and PNG/JPEG/WebP MIME validation at preview, persistence and publication boundaries. A slot can be reused across targets. Explicit null (`No graphic`) creates no asset requirement; it never suppresses the selection or assessment. The existing exact-set grading policy applies to selected target IDs grouped by panel. No new penalty policy is introduced. Student output contains no private correctness fields.

Background replacement retains existing authored geometry and updates every child surface. New bounds are validated before save; smaller images do not silently move or discard authored regions. Failed uploads preserve the previous draft. Child editors remain mounted when switching section/panel/mode; a background revision updates their public projection without remounting or clearing temporary editing buffers. Reference cleanup removes only slots no longer used anywhere in the composed document, including shared media.

Teacher target clicks toggle only the selected target. Explicit Show next/Show all/Reset remain independent commands and aggregate across child sections. A wrong No graphic selection still makes Teacher state non-pristine.

## Sizing regression

The reproduced case uses the actual hosted/published Teacher wrapper with internal Multi Part controls. At the fetched origin/dev sizing modules, the internal toolbar adds 21px above a 560px activity in a 560px clipping wrapper: 581px of content. Even after scrolling the flow panel to its end, the final CTS field extends beyond the clipping boundary. With the new styled controls before the sizing fix, the excess grows to 52.19px and the field also fails `elementFromPoint`. The regression asserts both the complete field bounds and the hit target. Student flow alone did not reproduce that failure; this is evidence for the internal-controls path, not an assertion about every possible reported layout.

The Multi Part root now allocates toolbar space with flex layout and places panels in a `min-height:0` body. Flow panels scroll within that body. Shared canvases use that body's size container for uniform source-ratio scaling. No delayed measurement, padding workaround or response-clearing remount is used.

## Executable evidence

- `npm run test:lms-native-drag-drop-layout` runs the existing browser suites plus shared-five, parent authoring and DD/CTS sizing regressions.
- `npm run test:builder:hosted-native-activity` includes creating a complete visual Mark the Words exercise from managed image uploads, including reused graphics and No graphic.
- `tests/native-visual-targets.test.js` checks schema/readiness, response/grading/restore, invalid geometry/identity/assets, duplication/cleanup, background propagation and frozen publication.
- `tests/integration/native-composition-persistence.test.js` invokes the real native Save handler on disposable PostgreSQL for standalone visual targets and the five-kind composition, including stale revisions and asset validation.
- Browser screenshots and measurements are written under `test-results/native-runtime-regressions/`; baseline clipping evidence uses the `sizing-before` prefix and fixed evidence uses `sizing-after`.
