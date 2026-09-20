# Word Lists — portable import and edition publication

Context delta · `verifiedAt: 2026-09-19`. Task 2 extends local Task 1 commit
`223a3a153dcfa4958a7eac14342eeac8c0f0a162`; inspected origin/dev remained
`7bdc71e1158180da96dc5e854ce31e7eeb07014c`. This document describes repository
contracts, not a hosted migration/import/publication receipt.

## Local extraction

Prerequisites: Python **3.11+**, standard-library `lzma`/`zlib`; Node **22+**
for the canonical portable/MP3 validator. The graphical picker additionally
uses standard-library Tk (`tkinter`; install the OS Tk package on Linux).
CI installs Python 3.12 explicitly. `tests/wordlists-extractor.test.js` fails,
rather than skips, when Python/LZMA is absent. Windows development verification
used Python 3.14.6/Tk 8.6 and Node 22.23.2.

Double-click `scripts/wordlists/launch.cmd` on Windows, or run
`python scripts/wordlists/extract.py --gui`. Select SWF, audio root, export
parent directory and explicit book/edition provenance. The picker creates a
fresh uniquely named directory, shows progress and invokes the same core and
portable validator as the CLI. It never runs Flash or any publisher executable.

```text
python scripts/wordlists/extract.py --swf <file.swf> --audio-root <directory> --output <new-directory> --book ultimate-b2 --edition greek
node scripts/wordlists/validate.mjs <new-directory-or-wordlist.zip>
```

The CLI refuses an existing output directory. Sources are read-only. Failed
exports remain local for diagnosis; no previous export is overwritten. Outputs:
`wordlist.json`, `audio/<sha256>.mp3`, deterministic stored `wordlist.zip`,
separate `audit.json`, and local `raw-wordlist.json`. Raw JSON/audit do not enter
the portable ZIP or application bundles. Full datasets, MP3s and SWFs are never
tracked fixtures. The validator reopens the ZIP, verifies dataset identity,
every file hash/size and actual MP3 bytes using the existing MP3 inspector.

FWS, CWS and actual ZWS/LZMA are bounded at 128 MiB compressed/decompressed;
LZMA dictionary at 64 MiB; 100,000 tags; embedded JSON at 8 MiB. Both stream
length/termination and tag/SymbolClass/DefineBinaryData bounds are checked.
The selector matches validated `wordlist…json` symbols and the `wordlist.item`
shape; no character ID, offset or generated suffix is fixed. Multiple matches
are an error. Audio is resolved from `item.sound + '.mp3'` under the selected
root, never from `num` or `id`; traversal and root escape are rejected.

The real B2 acceptance found 1,928 occurrences, 1,645 original `unit` entries,
283 `work` entries, 1,851 referenced MP3 paths/distinct audio byte sequences,
36,113,340 audio bytes and repeated original ID 1094. GR/International raw
JSON is byte-identical, SHA-256
`732fd495023c38de8065673d2dd7e19569e5cad9e8c9b22845a23d3d72be5e42`.
Two source headwords are JSON booleans, `true` and `false`; extraction preserves
them exactly and lists their occurrences in the audit. Counts are observations,
not validation rules. No source spelling, translation or malformed lexical
value is guessed or corrected.

## Portable contract

`src/data/wordlists/portable.js` is the canonical schema/identity verifier;
`archive.js` validates complete packages in both browser and local Node.
`portable-wordlist.v1` has exactly:

| Field | Meaning |
| --- | --- |
| datasetKey | Stable import slot, currently `publisher-wordlist` |
| datasetSha256 | SHA-256 of canonical semantic JSON, excluding this field and provenance |
| bookSlug | Explicit source book; must match the target |
| languages | Explicit available languages, including `en` |
| provenance | `format`, explicit `edition`, SWF hash, raw JSON hash; no PC paths |
| entries | Ordered occurrence records; duplicated IDs/headwords remain separate |
| audio | Distinct byte-addressed MP3 descriptors: path/hash/size/media type |

`schemaVersion` is also mandatory. Canonical JSON sorts object keys, preserves
array order and Unicode, and has no volatile timestamp. Provenance differences
do not change the lexical dataset identity. Each occurrence has `id`, `order`,
`originalId`, `displayNumber`, allowlisted `english` fields, language-keyed
`translations`, preserved `source` unit/part/unitPrefix/belong/sound/image,
explicit `memberships`, and `audioPath`. `entry-000001` etc. identify ordered
occurrences, not numeric publisher IDs, spelling or shared audio. Reordering
is a visible content change, never a headword-based merge.

The B2 extractor classifies exact `unitN_P` groups as SB and `workN_P` as WB.
Companion/practice/progress/review and unknown groups remain `unsupported`.
All original memberships and source fields survive; audio folders confer no
component ownership. No source section is automatically treated as a Builder
page ID. Other books can implement their own explicit source adapter; this task
does not register B1/B1+ editions or seed B2 data into them.

Limits: 10,000 entries; 4,096 distinct audio files; 4 MiB per MP3; 128 MiB
aggregate audio; 8 MiB JSON. ZIP accepts stored/raw-DEFLATE regular files with
matching local/central headers, CRC, sizes and contiguous non-overlapping
entries. It rejects traversal, absolute/drive/UNC names, backslashes, case
collisions, symlinks, executables, nested archives, encryption, ZIP64, extra
fields, directory entries, comments and data descriptors. Decompression stops
at the declared bounded size; unsupported ZIP variants must be repackaged.
Preview text is rendered as React text, never HTML; executable markup and
transient/absolute-path fields are not part of the strict portable shape.

## Builder authoring and transactions

Select a B2 content edition and an **already associated** SB/WB component source,
then use **Word Lists**. It is a dedicated section outside the Page UI Controller.
This importer never captures/replaces a component, classifies unclassified
content, or changes a page/activity/Teacher document/hotspot/order.

File selection validates ZIP or portable JSON plus separately selected exported
MP3s locally. Existing immutable bindings may satisfy missing current-component
audio only within the authorized Word List source. The preview shows counts,
languages, SB/WB proposals, duplicates, unsupported groups, missing audio,
added/changed/unchanged/omitted occurrences and unresolved mappings. No upload
or mutation starts until **Confirm Word List import** and its confirmation.
Existing manual mappings are retained during preview. Omitted entries block
reimport; there is no implicit deletion or replacement operation.

Mappings are ordered `{group,pageIds}` rows for every supported component group.
Each group can serve zero, one or two stable page IDs from the exact captured
component source. Empty lists mean an incomplete authoring draft. The importer
does not create pages or infer mappings by title/number/position. Invalid,
foreign/deleted-from-the-selected-source pages fail validation. A later source
revision requires explicit revalidation; historical source pages remain valid
for their already frozen publication. SB/WB mappings and revisions are independent.

Migration **067**, appended to `database/MIGRATIONS.md`, adds dedicated
`book_wordlist_*` tables and `mutate_builder_wordlist`. It never modifies 066.
It is feature-optional for old runtime readiness; Word List routes require its
function. There are no associations, grants or dataset seeds. Canonical schema
generation updates the manifest fingerprint; both strict Builder module
allowlists and safe Worker/build graphs include the new modules.

Sessions reserve a Word List source ID/import slot but create no active revision.
Each session belongs to its actor, book, edition, component, target source,
expected revision, dataset and reviewed mappings. Maximum eight unexpired
staging sessions per actor; sessions expire after 24 hours. The client sends
one bounded MP3 request at a time, displays progress and can pause. Retry uses
the same IDs and queries session status, including an already-completed result.
Closing/changing context aborts subsequent client work. An in-flight confirmed
server transaction may finish; reload/session status is authoritative.

Actual MP3 bytes are inspected server-side, hashed and compared to the session
manifest. Upload is create-only, followed by byte readback verification. Bindings
use the dedicated `wordlist_audio` role and private namespace
`builder-wordlist-audio/{book}/{component}/{wordListSourceId}/{sha256}.mp3`.
They are separate from activity/UI/Unit Extra assets. SB/WB require independently
registered objects even for matching bytes. Two editions may share a binding
through the same explicitly shared component source. Historical ownership in
066 is not weakened.

Staging here means session-bound, private immutable objects; finalization only
activates their verified manifest atomically. There is no mutable overwrite or
promotion copy. Failed/cancelled/expired sessions cannot activate a half-list.
Unreferenced staged bindings/objects are retained and can only be reused by that
same component source; this milestone performs **no automatic object deletion**.
Future garbage collection must be a separately authorized reference-aware task,
including all historical publications. Cancellation never deletes existing media.

Finalization uses the same package advisory transaction lock as Task 1, validates
exact current target reference and expected Word List revision, and captures all
required owned bindings. CAS and actor/request/context idempotency reject stale
or substituted writes. Identical reimport has outcome `unchanged`. Mapping edits
have their own `mappingRevision`, while every changed snapshot gets a source
revision/hash. No writes target authored exercise tables.

## Immutable publication and routes

Private `wordlist-source.v1` fields: sourceId, revision, mappingRevision,
targetSource (`content-source.v1` reference), dataset, mappings, bindings, sha256
and schemaVersion. Hash binds all fields except itself.

New writer `ultimate-b2-edition-composition-v2`, `edition-composition.v2`,
`edition-release.v2` wrap a verified complete v1 content release plus exactly
SB/WB Word List snapshots. Grammar remains required content but has no lexicon.
Composition binds references, source/mapping revisions and runtime projection
hashes. Release hash binds the entire private candidate. All required mappings
must be resolved; publication cannot invent pages to make readiness pass.
The writer validates immutable audio receipts already inspected at import,
without thousands of new R2 operations per PREPARE or playback.

V2 releases/heads/publication history are separate from v1 and old editionless
heads/assignments. Existing compiler implementations and dispatch remain intact.
V2 public envelopes retain opaque integrity hashes and public content, omit
private imports, storage keys and Teacher answers. International projection is
an allowlist of English lexical fields with `{}` translations. Greek explicitly
includes `el`. Both use English audio. No Greek-character stripping is used.
Raw imports/provenance are never delivered by runtime projections.

Builder API base: `/builder/api/publication/wordlists/books/{book}/editions/{edition}`
(same Netlify function alias as publication). Developer session is required;
all POSTs require same origin. Component base appends `/components/{component}`.

| Route | Contract |
| --- | --- |
| GET component base | Target reference/pages, current private authoring record, CAS revisions and public v2 releases |
| POST component `/begin` | clientMutationId, sourceId, expectedRevision, targetSource, dataset, mappings |
| GET component `/session/{id}` | Actor/context-scoped state, expiry and verified uploaded hashes |
| POST component `/upload/{id}` | One binary MP3; query sha256/clientMutationId |
| POST component `/finalize/{id}` | clientMutationId; atomic captured manifest activation |
| POST component `/cancel/{id}` | clientMutationId; cancel staging without deleting objects |
| GET component `/draft` | Verified runtime projection; optional audioSha256 |
| POST base `/prepare` | clientMutationId (release ID), expectedRevision (Task 1 selection) |
| POST base `/publish` | clientMutationId, expectedRevision (v2 head), releaseId |
| GET base `/releases/{id}` | Immutable public v2 envelope or component Word List/audio |

Published LMS route:
`/.netlify/functions/book-content?action=edition-release&contract=edition-release.v2&bookSlug=...&editionId=...&releaseId=...&componentSlug=...`.
Requires existing LMS authentication, book entitlement **and** explicit
school/user/book/edition grant, plus a historically published matching release.
There is no draft/current-head fallback. `audioSha256` resolves only a member of
that exact component snapshot; reads verify private bucket, size and byte hash.
`content=1` delegates immutable component/Teacher delivery to the existing v1
reader; Teacher/admin checks still apply. Builder draft, candidate and entitled
published authorization remain distinct. No new assignment creation is enabled.

## Shared classroom runtime (Task 3)

Source: Task 3 implementation on local Task 2 parent
`29372dc0893a55e4672ef9022bbc5716112555b2`; `verifiedAt: 2026-09-19`.
`wordListOperational: true` describes the interactive capability only. It does
not certify the real publisher mappings: 104 SB and 50 WB groups remain
unresolved, and incomplete mappings still block PREPARE.

Reachable application entry points:

- Builder book workspace → Content edition → SB/WB → Word Lists →
  **Open saved draft classroom** uses the exact associated saved source.
- **Open classroom candidate N** reads the selected immutable v2 release.
- Authenticated LMS route
  `#/editions/ultimate-b2/{greek|international}/releases/{UUID}/components/{componentSlug}`
  reads only historically published, entitled, explicitly granted editions.
  Components are `ultimate-b2-students-book`, `ultimate-b2-workbook` or
  `ultimate-b2-grammar-book`. Grammar has content but no Vocabulary control.

`EditionClassroom` adapts verified `content=1` delivery to the existing shared
`TeacherClassroomPages` navigation/frame and native activity renderers. The
legacy `TeacherOfflinePages` wrapper retains its original publication provider
and renderer. No edition context means no fabricated lexical availability.
Builder cookies are never passed to Player/preview. Existing LMS discovery,
assignment creation and historical pinned releases are unchanged.

`loadEditionClassroom` returns stable publication/delivery objects, the exact
content source reference, its page IDs and the frozen SB UI owner. The optional
`ui=1` read supplies only normalized UI metadata; `uiBindingId`/`uiFont` with
`uiOwnerSha256` serves a declared, hash-verified owner asset. It exposes no
Teacher answer document. Failed authorization, missing bytes or corruption
fail visibly; they cannot silently select a current draft or canonical override.
Draft canonical pages use a bounded, read-only static-assets resolver.

`loadWordList(context,{signal})` and `wordListAudioUrl(context,sha256)` extend the
Task 2 loader. Context contains `kind` (draft/candidate/published), `bookSlug`,
`editionId`, `componentSlug`, immutable `releaseId` where required, exact
`targetSource` (including source ID, revision and hash), `sourcePageIds` and up
to two selected stable `pageIds`. Strict `runtime-wordlist.v1` validation binds
projection policy, source, mappings, occurrence IDs and owned audio manifest.
`wordListForPages` returns the ordered union of occurrences, preserving distinct
occurrences with duplicate words/numbers/audio. Foreign or stale responses are
aborted/ignored; no data flashes across contexts. Loading, empty, unavailable
and error/retry are separate states.

Vocabulary uses the existing canonical active/disabled/pressed PNGs, under
Page UI Controller → Navigation / Window Controls, for B2/B1/B1+ using existing
per-book ownership. B1 artwork changes do not grant B2 lexical capability.
Historical compiler descriptors use the explicit frozen pre-Vocabulary binding
set; they do not derive historical fingerprints from today's expanded catalog.
The v3 verifier matches its existing writer's deduplicated asset manifest;
v1/v2 verification semantics remain unchanged.

Migration `068_vocabulary_ui_bindings.sql` is required for B1/B1+ documents or
immutable projections containing the new overrides. The existing SQL raster
validator otherwise rejects these IDs. It extends only the optional binding
catalog and retains every 064 validation check, including metadata consistency;
065 settings/font checks remain active. It changes no stored row or compiler
fingerprint and leaves 066/067 untouched. Save/PREPARE/PUBLISH check this
capability against the document/compiled/frozen UI respectively and return
`vocabulary_ui_schema_unavailable` before writes when absent. Historical UI
without these slots and general login do not require 068. The canonical runtime
schema generator marks it feature-optional. Shared application is not performed
or authorized by this task; B1/B1+ use requires separately authorized migration.

The overlay lives outside the measured/transformed activity canvas, inside the
page reader. Its shared scroll, independent language/occurrence visibility and
focus survive close/reopen and page → activity → page. Identity resets on any
book/edition/component/source/release/mapping/page change. Greek has paired
English/Greek rows; International receives an English-only projection. Boolean
headwords are rendered with `String`, preserving true/false. Activities remain
mounted; the stage and tools are inert while the overlay is open. Navigation
is disabled except Vocabulary. Escape and registered Android Back close the
top layer first. No lexical action saves content or assignment state.

One non-preloading English audio element belongs to each active frame. Its
owned-hash URL is resolved only on a speaker action. Playback epochs discard
late promises; close/context exit/background/unmount clear the source. Existing
native media in that frame pauses without seek/reset or automatic resume.
Errors are visible and the speaker retries. No Greek audio or TTS is added.

Acceptance entry: `npm run test:wordlists:classroom`, after LMS and Builder
builds, with a safety-confirmed isolated PostgreSQL database. CI runs it after
Task 1/2 browser gates. Synthetic source mappings/media are separate from real
publisher data. Unit coverage includes strict contexts, historical descriptors,
frozen UI delivery and Back-layer registration. Existing bundle, publication,
assignment, per-book controller and Android gates remain required.

## Task 4 offline handoff

Reuse `TeacherClassroomPages` with an injected `ActivityRenderer`, stable
`classroom.publication`/`classroom.delivery`, verified `selectedPageIds` and
`classroom.wordlist = {context, load, audioUrl}`. The shared hook has no hosted
network fallback: the hosted adapter explicitly injects the existing loader,
and offline builds include only pure page-scope/validation code. A missing
provider fails closed. `load(context,{signal})` returns
`{state,wordlist}` and is validated by `usePageWordList`; `audioUrl(context,sha)`
resolves a locally materialized owned manifest member. Preserve the real
published release ID and complete source reference. Do not invent a draft or
standalone-activity page context. The context key includes source/release,
lexical/mapping revisions and the selected pages.

Materialize the verified wrapped content member, exact lexical projection,
component-owned MP3 bytes, public/role-appropriate activity assets and frozen
book-level SB UI-owner snapshot plus declared artwork/fonts. Verify hashes and
sizes before enabling the pack. Retain language allowlisting and Teacher/public
separation. Packs must contain no raw import/provenance, private storage keys,
Builder cookies, signed preview URLs, live-draft dependency or ungranted edition.
Shared UI is ready for that adapter; the two new edition APK exporters are not
implemented here. Real group mapping review and complete edition readiness
remain prerequisites. Existing APK checks are regression checks, not proof that
new edition packs exist. Hosted acceptance/production readiness are not
established. The ChatGPT Project copy has not been synchronized.

Task 4 implements this handoff in `SharedEditionClassroom` and the explicit
offline provider. See [OFFLINE_EDITION_EXPORT_CONTRACT.md](OFFLINE_EDITION_EXPORT_CONTRACT.md)
for the local GUI/CLI, exact published selection, complete pack verification,
isolated native builds and final-archive acceptance. This supersedes the
exporter deferral above, while preserving the real publisher readiness gate.
