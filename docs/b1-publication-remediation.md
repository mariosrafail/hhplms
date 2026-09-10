# B1 publication corrective design

Baseline: `7e98db0f`; reviewed feature: `06a55820`. Migration 062 is local and
unpublished. Corrections append commits and replace no applied migration.

## CI Risk / Derived-State Check (before implementation)

The production runner owns migration SQL and its history insert in one
transaction. 062 must contain no top-level transaction control. The canonical
manifest is read from MIGRATIONS.md and SQL; `generate:runtime-schema-contract`
regenerates the checked-in runtime contract. The superseded 062 checksum is not
a compatibility checksum. Historical SQL and B2 release fingerprint recipes
remain unchanged.

Permanent tests belong in `tests/integration/*.test.js`, discovered by the
existing sequential PostgreSQL CI gate. Real authoring/publication tests reuse
the B1 browser fixture, preserving its earlier propagation expectations.
Baseline and candidate CI were inspected: fresh validation starts with npm ci,
manifest verification, runtime boundary audit, then npm test. Full integration,
Builder/Viewer/browser, offline/APK and local Cloudflare build/dry-run gates
follow. No hosted migration is performed by CI. Worker configuration and object
key policies remain unchanged; no remote preflight/sync/deployment is local
validation.

The migration fault test uses the existing physical history table name. Its
path is registered for that exact token in the existing branding compatibility
exception; the audit pattern, other paths and visible-branding rules are unchanged.

## Draft placement and immutable image identity

`book_pages.unit_id` is the authoritative current placement. The page revision
and immutable release projection version that placement. A page image belongs
to its package/component/page and checksum-addressed physical object;
`book_assets.unit_id` freezes its association when first pinned and is not the
current page placement. Moving a page must not move that pinned physical asset
identity. Unpinned assets retain existing B2 placement synchronization. Reuse
and restore preserve a pinned Unit; a new image records its creation Unit. This reuses the
existing versioned release association without duplicate physical objects.

Builder page readers join Units through book_pages. Managed source collection
uses those readers; SQL snapshots also join page.unit_id. Page-image pins and
delivery validate package/component/page ownership, canonical object key and
bytes, not current Unit placement. Unit Extras continue to own their Unit
directly and are outside this page-image rule. Pin guards and historical pins
are unchanged. The relationship validator permits a frozen Unit only on an
existing pinned page-image row with unchanged package/component/page/Unit;
inserts, reassignment and foreign Units retain their original checks.
For the four new components, moving a page also updates redundant hotspot Unit
labels through the canonical document save, in the same transaction. Geometry,
page/native identities, immutable revisions, audit and mutation replay remain.
Tests must prove stale detection, image reuse, restore,
historical assignment placement and exact delivery after real page saves.

## Lock order

For the four new components, canonical SQL mutation entrypoints acquire the
existing publication-component advisory lock before any operation-specific
advisory or row lock. Read-only scope/session lookup precedes this lock; the
existing locked lookup and validation still follow it. This applies to generic
document saves, native creation/pair/retirement/lifecycle/order, native and font
uploads, and page prepare/claim/finalize/save/delete/restore/purge.

Product operations retain package-publication -> member publication locks ->
head rows. Source operations never acquire a product lock. After the early
component lock, existing native-component/activity/assets/document locks and
session/revision/page/edition/asset row locks retain their local ordering.
The four source triggers remain freshness backstops; canonical operations do
not first encounter their publication lock after locking a source row.
Unrelated components have distinct locks; existing edition uniqueness can
still briefly serialize asset insertion within one package. B2 lock behavior
is unchanged. Direct multi-component SQL transactions are not an authoring API.

Concurrent tests use actual operations, separate connections, observed lock
waits and bounded statement deadlines, with no automatic retry. Retirement
winning before completion must reject the inactive upload atomically.

The native upload test pauses the actual completion at an edition INSERT,
after its native-assets lock. The original schema then deadlocks with actual
retirement; the corrected early component lock prevents that inversion. The
reverse interleaving pauses retirement at native-assets and proves completion
rejects the retired activity with 23514, leaving no partial asset. Public and
Teacher-answer paths run for every new component. Real page metadata writes
also race both PREPARE and SQL PUBLISH in both orderings; a source-first write
rejects the stale candidate, while publication-first leaves the frozen release
intact and makes it stale only for subsequent publication. Other-book locks
remain available while these operations wait.

No historical SQL through 061, pin guard, fingerprint recipe, legacy activation
policy, Worker configuration or deployment command is edited. The old B2
unpinned asset-placement expectation remains passing without changing it;
additional B2 pinned Workbook saves preserve all stored release and pin bytes.

## Rollout gates

Installing 062 still immediately restricts current legacy discovery for the
four new components. This policy is unchanged and its user-visible schema-first
gap requires separate explicit acceptance. Historical assignment access stays
available. Local correctness qualifies only for another pre-rollout review;
hosted content and production operational readiness remain unverified.
