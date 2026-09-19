# Content editions foundation (milestone 1)

Verified source inspection: 2026-09-19, starting from origin/dev
`7bdc71e1158180da96dc5e854ce31e7eeb07014c`. This is a repository contract,
not a receipt for migration, publication or acceptance on a hosted service.

## Identity and compatibility

`src/data/contentEditions.js` is the validated registry. Only `ultimate-b2`
opts into `international` and `greek`. A `content-edition.v1` identity has
exactly `schemaVersion`, `bookSlug`, `editionId`. Role, interface language,
device language and translation visibility are independent dimensions.
B1/B1+ do not acquire editions. Existing book/component/activity/page slugs
and IDs keep their meanings. Existing content stays unclassified by default.

The new writer does not alter the strict historical product/component
envelopes, compiler dispatch, unique member constraints, release numbering,
publication heads, assignments or snapshots. It uses separate tables and
`edition-release.v1` / `ultimate-b2-edition-composition-v1`. The historical
B2 SB v3 and managed WB/Grammar compilers compile captured component inputs;
their identifiers and implementations are unchanged. Verification replays
those historical compilers against captured inputs, never current drafts.
Future semantic changes require a new edition writer/contract and historical
dispatch; do not repoint the v1 compiler mapping.

## Source and release contracts

A private `content-source.v1` source contains exactly:

```json
{
  "schemaVersion": "content-source.v1",
  "sourceId": "10000000-0000-4000-8000-000000000001",
  "bookSlug": "ultimate-b2",
  "componentSlug": "ultimate-b2-students-book",
  "scope": { "kind": "shared", "editionIds": ["international", "greek"] },
  "revision": 1,
  "inputs": {}
}
```

`inputs` above is a placeholder: actual inputs must pass the component's
existing collector/compiler contract with a nonempty effective page set.
The edition-only scope is `{kind:"edition",editionIds:["greek"]}` (or
International). Ownership/scope are immutable for a source UUID. A revision
contains the whole image, placement, hotspot/activity and document context;
there is no document deep merge or missing-edition fallback.

`freezeEditionSource` produces `{reference,source,content}`. The reference
has the source identity fields except `inputs`, plus the SHA-256 of
`{namespace:"content-source.v1",value:source}` using canonical Builder JSON.
`content` contains the verified historical compiler snapshot, projections,
asset manifest and their hashes. These are private records. Unknown identity
keys, cross-book/component ownership and transient credentials are rejected.

`edition-composition.v1` contains `schemaVersion`, `edition`, `members`.
Members are exact source references in SB, WB, Grammar order; all three are
required. Shared SB/WB and separate whole Grammar sources are explicit
fixture associations, not classifications inferred from matching files.
An image's hash does not grant cross-source or cross-component ownership.

An `edition-release.v1` contains `schemaVersion`, `compilerId`, `id`,
`number`, `composition`, `compositionSha256`, `members`, `releaseSha256`.
Here members contain the entire frozen private source records. Composition
and release hashes use their schema names as canonical hash namespaces.
The release hash excludes its own field. Public envelopes retain verified
references and public projections, omit private inputs and Teacher documents,
and expose the private release hash as an opaque server-verified identity.
They cannot independently reconstruct the private release hash.

## Persistence and authorization

Migration `066_content_editions.sql` is appended to the canonical manifest.
Its runtime-schema contract is generated, feature-optional for legacy routes.
Edition routes fail closed when its writer is unavailable. No content,
edition associations or grants are seeded by the migration.

- `book_content_sources` and append-only `book_content_source_revisions`
  hold authored whole-source revisions.
- `book_content_source_asset_owners` claims managed asset UUIDs within the
  book/component for one source. The API validates captured DB metadata;
  source assets cannot subsequently be repointed/deleted. Explicit shared
  content is reused through one source, not a second claim on its assets.
  Managed Page UI Controller fonts participate in these checks.
- `book_content_edition_selections` / `book_content_edition_sources` hold
  explicit source associations with compare-and-swap revisions.
- `book_content_edition_releases`, `book_content_edition_release_sources`,
  `book_content_edition_heads`, `book_content_edition_publications` separate
  immutable candidates, edition-specific heads and historical publications.
- `book_content_edition_mutations` binds idempotency to actor plus canonical
  request, including edition. A replay in another context fails.
- `book_content_edition_access` is an additional school/user/book/edition
  allow-list. Existing book entitlement is still required. No entry means
  no edition access; common sources confer no grants.

`mutate_builder_content_edition` requires an active developer, serializes
source mutations/candidate captures with a package advisory transaction lock,
and checks source, selection and head revisions. Candidate capture compares
every source record to the associated current revision under that lock.
Concurrent changes cause a conflict rather than a mixed candidate.
Publishing changes only the requested edition's head. Previously published
releases remain readable by ID after any later source edit or publication.

PREPARE verifies private source assets with the existing pin verifier and
materializes canonical SB pages through the existing create-only mechanism.
Frozen input rows retain source paths; reads verify the source bucket, requested component,
role/manifest membership and returned byte hashes. This does not authorize
an upload or PREPARE on an operational service during implementation.

## Builder and read API

The existing book screen includes Content edition with default
`Existing content · Unclassified`. Selecting B2 Greek/International loads a
separate validated effective source context in the same Builder. Unconfigured
sources are visibly missing and PREPARE is disabled. A shared-edit warning,
revision number and whole-source scope distinguish shared/edition-only work.
Unsaved edition changes require discard confirmation; writes disable edition
switching. Dirty source edits disable association/publication actions.

The bounded foundation editor edits captured managed-page labels and section
titles; it preserves the complete captured activities/geometry. It is not a
new publisher import or a duplicate of every existing component editor.
The complete source-save API below supports validated whole-input revisions.
Canonical SB rows are identified as captured canonical content.

Developer-authenticated same-origin API base:
`/builder/api/publication/editions/books/{book}/editions/{edition}`.
The Netlify function path remains a supported alias through the existing
publication entry point. Operations:

| Operation | Method and required JSON fields |
| --- | --- |
| Status | GET base; sources, associations, revisions, readiness, public releases |
| Capture | POST `capture`: clientMutationId, expectedRevision (0), sourceId, componentSlug, scope |
| Save source | POST `save-source`: capture fields plus inputs; expectedRevision is current source revision |
| Associate | POST `associate`: clientMutationId, expectedRevision (selection), componentSlug, sourceId |
| Candidate | POST `prepare`: clientMutationId, expectedRevision (selection); mutation UUID is release UUID |
| Publish | POST `publish`: clientMutationId, expectedRevision (head), releaseId |
| Immutable review | GET `releases/{releaseId}`; optional componentSlug and activity/asset query |

Capture is an explicit copy of the current unclassified component snapshot
to a newly identified source. It does not mutate that draft or associate it
automatically. The UI offers scope, capture, source selection and association;
no manual SQL association is required. Capturing real localized content still
requires separately authorized source inspection/import/association. An asset
already claimed by another source produces an ownership conflict.

Immutable review uses the common `PublishedNativeTeacherActivityRunner` via
an optional delivery adapter. Existing callers retain their default adapter.
State is keyed by edition/release/component/activity. Page image and hotspot
geometry come from one frozen projection. Page UI Controller ownership stays
with the existing per-book SB owner; there is no second UI override registry.

LMS GET `book-content?action=edition-release&bookSlug=...&editionId=...&releaseId=...`
requires normal authentication, book access and the additional edition grant.
The actual edition must match the verified published release. Optional
`componentSlug` returns a component projection. `teacherActivityId` and
`teacherAssetActivityId` require Teacher/admin role; public/Student asset
reads are restricted to the public manifest. Asset fields are `assetSha256`,
`assetRole`, `extension`. No current-head lookup or draft fallback occurs.
This opt-in read path does not change existing LMS discovery or assignment
creation: old assignments continue through their original pinned release path.

## Word List extension contract (Task 2 data and Task 3 shared UI)

Task 2 implements the separate versioned data/import/publication extension in
[WORD_LIST_CONTRACT.md](WORD_LIST_CONTRACT.md). The following requirements remain
its compatibility foundation. `wordListOperational` denotes interactive
launcher readiness, not availability of the new data APIs.

`wordListOperational` is true for the shared interactive capability; real
mapping readiness remains independent. Keep one canonical imported Word List source
with explicit available languages (`en`, `el`), provenance, an import revision
and integrity hash. Greek text being present cannot identify its edition.
An English-only projection must remove Greek translation content from its
runtime/public payload; hiding a column does not provide content separation.
Greek's English+Greek projection and International's English-only projection
must declare the projection policy and bind it into the edition release hash.

SB and WB need independent component-owned membership/mapping records, even
when they reference the same canonical lexical entry. Grammar has no Word List
capability or Vocabulary launcher for this feature. Map to current stable page
IDs and explicit sections; do not use a displayed page/word number as identity.
Preserve source group and occurrence identity: original word IDs may repeat.
Audio association must be explicit and must not derive filenames from display
numbers. Store immutable English MP3 asset references with ownership, hash,
byte size and media type, not embedded base64. Cross-component reuse requires
an explicit validated sharing policy, never a checksum-only shortcut.

Extend the source/release contracts with a versioned Word List member or new
writer, keeping v1 readers and required SB/WB/Grammar completeness unchanged.
The importer should produce validated portable data plus separate audio, then
use the authorized source persistence/association boundary. No local SWF path,
preview token, signed URL or credentials belong in durable JSON or packs.

Milestone 3 shared classroom behavior:

- Artwork `navibar_vocabulary_active`, `navibar_vocabulary_disabled`,
  `navibar_vocabulary_pressed` maps to existing canonical IDs
  `navibar.vocabulary.active`, `navibar.vocabulary.disabled`,
  `navibar.vocabulary.pressed` under Page UI Controller → Navigation / Window Controls.
- Supported SB/WB pages and activities opened from them have the launcher;
  Unit overview and Grammar do not.
- Overlay stays within the page/activity frame and preserves underlying
  activity state. English audio stops overlapping playback. No Greek audio.
- Independent per-word and per-column show/hide is temporary presentation
  state, scoped to the current verified context; it never changes edition.

Milestone 4 must consume verified edition releases, materialize complete
edition content and verify two actual APK outputs. Legacy B2 bundled packs,
generic Teacher Project export and hosted publication are distinct sources.
Milestone 1 adds no dual APK exporter and changes no signing/distribution.

## Acceptance and handoff boundaries

Tests in `content-editions`, `content-edition-domain`, `content-edition-api`
and `content-edition-assets` cover identity, no fallback, immutable snapshots,
Teacher separation and negative asset context. The disposable PostgreSQL
test covers real CAS, replay, ownership, independent heads and tenant grants.
`npm run test:builder:content-editions`, after the Builder build with an
isolated test DB, exercises real authentication, source save, dirty navigation,
shared propagation, association, image/activity review, PREPARE and PUBLISH.
The browser gate fails if its test database is absent. Normal `npm test`
retains the repository's environment-gated integration behavior.

The importer must preserve these tests plus historical v1/v2/v3 publication,
B1/B1+ Page UI ownership, pinned assignments, bundle safety, Android and
local Cloudflare gates. Final command receipts belong to the task report;
this document does not certify a future modified tree.

No shared migration, content association/import, PREPARE/PUBLISH, grants,
R2 sync/CORS operation or deployment is implied. Production operational
readiness and the publisher's real Greek content are not established.
The Task 2 portable schema and conservative cross-component audio policy are
documented in WORD_LIST_CONTRACT.md. The importer and versioned data APIs are
present together with the shared in-frame Vocabulary UI and bounded saved-draft,
immutable candidate and entitled published adapters. Source: Task 3 on local
Task 2 parent `29372dc0893a55e4672ef9022bbc5716112555b2`; verifiedAt: 2026-09-19.
The 104 SB and 50 WB unresolved real groups remain unresolved.
