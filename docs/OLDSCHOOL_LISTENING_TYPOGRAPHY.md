# Oldschool Listening transcript typography

Verified source baseline: `origin/dev` `17ff2fb4033eedf7309e7034d39faaec18ace78a`,
2026-09-13. This is a local implementation contract, not hosted acceptance.

## Durable region contract

`interaction.cues[].highlightRegions[]` optionally carries `typography` and
`runs`. No defaults are serialized into existing documents. Synthetic example:

```json
{
  "id": "region-00000000000000000000000000000001",
  "x": 40, "y": 40, "width": 900, "height": 24,
  "text": "A film title.",
  "typography": {
    "fontFamily": "Arial", "fontSize": 18, "fontWeight": 400,
    "color": "#000000", "align": "left"
  },
  "runs": [
    { "text": "A " },
    { "text": "film title", "typography": { "italic": true } },
    { "text": "." }
  ]
}
```

| Field | Accepted values |
| --- | --- |
| `fontFamily` | Existing system list: Arial, Georgia, Verdana |
| `fontAssetSlot` | Existing `activity_font` reference in the public asset list |
| `fontSize` | Integer source pixels, 8–96 |
| `fontWeight` | 100–900 in steps of 100 |
| `italic`, `underline` | Booleans, including explicit false |
| `color` | Six-digit hex, normalized to lowercase |
| `align` | left, center, right; region only |
| `lineHeight` | Integer source pixels, 8–192; region only |

Runs contain only `text` and optional inline `typography`, inheriting the region
style. A run's system family clears an inherited managed font; a managed slot
uses the inherited system fallback. Weight/italic/underline can explicitly reset.
Underlines are applied to text leaves so false can override a region underline.
Single-face managed TTFs permit browser weight/style synthesis; separately
authored face files can also be referenced per run using managed slots.

Plain region text remains canonical. CRLF/CR normalize to LF; concatenated runs
must equal normalized region text exactly. Spaces between runs and all interior
breaks survive. HTML-looking plain text stays literal. Raw CSS, attributes and
URLs are not accepted; unknown fields are rejected. Limits: 128 runs/region,
8,000 runs/document, 262,144 aggregate cue/region/run characters, 1 MiB/interaction.
Existing cue/region and per-fragment limits still apply. Typography requires
exact text in every region of that cue. Partially enriched legacy cues retain
their existing complete-cue fallback; adding styles to that state is rejected.

## Rendering and compatibility

The shared Student/Teacher surface and Page Mapping preview use
`NativeOldschoolExactTranscript`. Source sizes become container-width units
once; outer stage transforms scale geometry and text together. Authored text
uses explicit breaks without automatic wrapping, ellipsis or shrinking. Exact
text can extend beyond its individual region bounds; the outer transcript
remains clipped to the source page bounds, including mixed styled/legacy pages.
Highlight changes only the background. Timing, seek and follow logic are intact.

Without explicit `lineHeight`, authored text uses **4/3 of the largest effective
font size in that fragment**. This is renderer policy, not a recovered XML field.
Arial 18 normally uses a 24px line box; XML `height="24"` is independent geometry.
Unstyled exact fragments retain the existing font stack and 21px/31px behavior;
non-exact mappings retain existing fitting. The uniform-21px regression, B2
Roboto Regular/21px fixture and legacy adapter output are unchanged. Repository
caller inspection found the legacy adapter referenced by the existing Oldschool
test, with no production/compiler caller; enrichment uses the explicit XML action.

## Builder use

1. Open the existing Oldschool activity and bind its MP3/page image. Import the
   mapped JSON in **Audio & Timeline**. Its slots/dimensions must match.
2. In **Page Mapping → Import transcript typography from XML**, select the
   corresponding original `karaokeScroll` XML. It is read locally.
3. Review the region summary/rendered preview, then **Apply typography to local
   draft** or cancel. A changed mapping invalidates the preview transaction.
4. Select a region to adjust font, size, line height, weight, italic, underline,
   color or alignment. Imported inline overrides remain attached to their text.
5. **Save Draft** persists the ordinary public/Teacher pair. JSON export includes
   styles/runs; reimport requires its referenced assets bound in the activity.

Unknown source fonts require an explicit binding: select/upload the appropriate
TTF through the existing component font library, then use **Bind a source font**
with the exact XML family name. A deliberately selected system replacement is
also supported; it is not recovery of the custom font file. Preview uses the
authorized component font route even before a newly bound font is saved.
Loading/failure is explicit in preview and Player, never described as exact fidelity.
Without XML, old JSON cannot reconstruct missing typography; legacy appearance
continues until manual authoring or matching source import. Existing releases and
assignments remain unchanged. Later publication needs separately authorized code
rollout, activity Save, and the normal PREPARE/PUBLISH process.

## XML safety and matching

Exactly one `karaokeScroll`, at most 4,000 texts, 20,000 lexical nodes, depth 32,
and 1 MiB input. Relevant text attributes are strict. Recognized source fields:
fontName/fontSize/fontColor/fontBold/align, optional fontItalic/fontUnderline/
lineHeight, and isHTML. Color `0` is black; bold `false` is weight 400.
HTML-declared text accepts encoded markup or CDATA using only b/strong, i/em, u,
br, and font with face/size/color (absolute source pixels). Undeclared HTML stays
literal. Entity decoding is inert with allowlisted names and numeric codepoint
validation. DTD/entities, processing instructions other than XML declarations,
scripts, event handlers, external resources and unsupported markup are rejected.
No network fetching, browser HTML parser, innerHTML or XML persistence is used.

Source IDs/names must be unique. Each region matches exact start/end timing and
plain text; decimal source IDs encoded in existing region IDs are checked when
present. Other IDs require a unique timing/text match. All source texts must be
consumed once; array/DOM order is irrelevant. Legacy outer ASCII boundary spaces
are removed once across the entire source fragment, never per run. Line-break or
wording differences cause mismatch. Any ambiguity/unsupported input/missing text
fails atomically. IDs, geometry, timing, scroll, snippets, bindings and Panel 1/
Teacher data remain intact. No cues/hotspots are created.

## Persistence and verification entry points

`nativeOldschoolListeningTypography.js` validates the contract and collects font
slots. Parent normalization validates transcript fonts while projecting relevant
fonts to Panel 1. `nativeActivityUsesManagedAssetSlot` includes region/run fonts,
so question mode switching and answer-font cleanup retain transcript dependencies.
Existing Save, publication requirements, manifests/pins and supported offline
delivery consume these managed references. Owner/role/checksum/release checks
are unchanged. No migration, compiler fingerprint or generated-hash edit is needed.

- `tests/native-oldschool-typography.test.js`: matching/security, JSON/authoring
  round-trip, whitespace, styles and font retention.
- `tests/oldschool-typography-publication.test.js`: immutable compiler output,
  manifests/pins, invalid owner/role/MIME/checksum and private-answer separation.
- `tests/integration/_oldschool-typography-persistence.mjs`, called by the existing
  font-library and published-native-assignment suites: real pair Save/reload,
  saved-draft projection, compilation and assignment release pinning.
- `scripts/book-builder/oldschool-typography-regressions.mjs`, included in
  `test:lms-native-drag-drop-layout`: actual Builder/XML preview/Save/reload/JSON,
  Student/Teacher and published runners, 430/1440px viewports, 0.65/1 stage scales,
  computed styles/DOM ranges, highlight invariance and delayed/failed fonts.

Font regressions use tracked public-domain `tests/fixtures/fonts/Ahem.ttf.base64`;
page/audio bytes are synthetic. Attachments are scoped reproduction inputs, never
a CI dependency or added publisher content. The supplied B1+ pair has 33 cues/61
regions, all uniquely matched; source texts 51/52 require inline runs. The mapped
page is 1018×1509 and XML specifies Arial 18. Scoped browser reproduction measures
all 61 text ranges inside their existing regions, with two italic runs in source
51 and one in 52. No page raster was attached, so visual
reproduction covers the transcript overlay. Final exact-candidate receipts are
in the task's local evidence report. Hosted acceptance: **NOT RUN**; production
operational readiness is not established.
