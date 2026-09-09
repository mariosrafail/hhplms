# B1 and B1 Plus managed publication

## Initial design record

Baseline: freshly fetched `origin/dev` at `7e98db0f7587819a6332a76b6611ebe40309dfd7`, tree `0cb603695fa5f295fc023a5f28d279bfe8fe9525`. Implementation uses the isolated `feat/b1-managed-publication` worktree. The original authoring worktree is not an input to builds or tests.

The existing B1/B1 Plus adapters already own managed pages, hotspots, native activity documents and namespaced private assets. Missing publication registrations, B2-only source collection/product policies, a fixed Builder endpoint and B2-only LMS viewer/discovery gates prevent those drafts from reaching immutable Interactive. Empty authoring shells are not evidence of publication readiness.

### Contracts and reuse

- Register only B1 Students Book/Workbook and B1 Plus Students Book/Workbook, with component compiler IDs `<component-slug>-v1`, schema `1.0`.
- Register `ultimate-b1-product-v1` and `ultimate-b1-plus-product-v1`, schema `1.0`; each requires Students Book (order 1) and Workbook (order 2). Both must compile and freeze successfully.
- Keep B2's current three-member product and legacy product, component v1/v2/v3, managed historical representations, serialization and fingerprints unchanged. Dispatch by explicit book/component/compiler registration. B1 Students Book never enters the canonical B2 Students Book compiler.
- Keep the closed, browser-safe publication metadata separate from server compilers and Teacher normalization. Reuse managed compilation, role-scoped pinning, product transactions, signed immutable Review, PublishedBookInteractive and PublishedBookSurface.
- New managed releases reject empty active-page sets and incomplete linked activities. Compilation reports the component and actionable readiness errors without Teacher documents.
- One canonical Unit/page sequence drives the LMS selectors and navigation. Recognize only creation-contract page prefixes for the matching component; retain B2's current route and ordering semantics.

### Database and concurrency

Add migration `062_b1_managed_publication.sql`; do not alter historical migrations. Extend closed SQL product/member/compiler dispatch and retain exact B2 recipes. Reuse immutable release/member/event/pin tables and the existing runtime role boundaries.

For new managed products, compare the actual canonical Unit/page/image snapshot as well as document/index/lifecycle/native revisions and checksums. Serialize relevant source writes with component publication locks. Check source freshness inside PREPARE/PUBLISH transactions, not only in the frontend or a preceding server read. Validate exact required membership and complete role-scoped pins before activation; preserve expected-head and mutation replay behavior.

PREPARE creates a candidate and pins its sources, never an active head. PUBLISH is a separate explicit operation. No migration, save, preparation or deployment auto-publishes. Historical assignments continue resolving their original component release, activity and locator.

Expose schema capability/readiness explicitly for the new books before 062 is installed. Existing B2 must continue working against the prior schema. Rollout is additive schema first, then code; neither step creates content or publication heads.

### Builder and LMS boundaries

Parameterize the existing publication workspace with the selected book, required members and compiler identity. Reset/guard asynchronous state on book switches. Preserve readable history when current drafts are incomplete; provide truthful per-member blockers and separate Prepare/Publish controls. Immutable Review must use the chosen product/member and the immutable page set, even after draft pages change.

Discover all entitled registered packages independently. Missing B1/B1 Plus publication is ordinary absence and cannot suppress healthy B2. Corrupt releases remain distinguishable failures. New products resolve only exact family members; retain B2's historical component-only fallback explicitly. New managed paths never expose mutable drafts or legacy missing-target fallback.

Private asset delivery continues to prove release membership, namespace, role, owner, checksum and canonical object key. Student endpoints cannot return Teacher documents or Teacher-only assets, including equal-checksum cases. No storage resource or credential changes are planned.

### CI risk / derived-state check before implementation

- Migration manifest and generated runtime schema contract must advance through the canonical generator. Historical migration 061 and its canonical generator output remain unchanged.
- New product fingerprint domain prefixes must agree in JS and SQL; B2 prefix/serialization bytes remain identical. Synthetic expected IDs come from creation contracts and independent fixture expectations.
- No historical projection/hash/pin rewrite or manual hash substitution. Browser fixtures change intentionally; no generated real content is introduced.
- Browser capability metadata must not import server compilers or private Teacher material. Validate Builder, Viewer, web, Student offline and Teacher offline bundle boundaries.
- Shared server read/compile changes reach both Cloudflare Worker graphs. Run canonical Builder/LMS builds and local dry-run verification; do not run remote media sync, CORS or deployment commands.
- New top-level tests run through `npm test`; database regressions run through `test:integration`; the new browser flow must be wired into an existing CI browser entrypoint.

### Controlled implementation and regression matrix

1. Closed registrations, managed compiler/source collection, product contracts and red/green unit regressions.
2. Additive SQL policy/freshness/locking extension, JS/SQL parity, clean install and B2 upgrade preservation.
3. Selected-book Builder publication and immutable Review; multi-package LMS discovery, routes, ordering and strict access boundaries.
4. Real-handler isolated end-to-end tests for all four components/two products, including required membership, replay/conflicts, entitlement combinations, same-checksum role/component asset denial and historical assignments.
5. R1/R2 propagation: publish R1; pin an assignment; add/move/repoint/remove hotspots, edit activity/order; confirm R1 isolation; prepare and stale R2; reject it; prepare/publish current R2; verify exact new browsing and unchanged old assignment/other books.
6. Freeze candidate; validate in a separate fresh checkout. First commands are exactly `npm ci`, `npm run verify:migration-manifest`, `npm run audit:runtime-schema-boundary`, `npm test`. Then all relevant PostgreSQL, browser, Builder/Viewer, B2 full-book/Extras, bundle, Cloudflare and affected offline gates. Any tracked edit invalidates final validation.
7. Create focused local commits after development validation; freeze that exact candidate for fresh-checkout validation and record its chain/tree. No push or hosted mutation.

## Implementation and validation notes

`src/data/publicationRegistry.js` is the closed browser contract. Server registration and `resolvePublicationCompiler` dispatch the four new compiler identities to the existing managed compiler; B2 keeps its historical verifier paths. `collectManagedPublicationSources` scopes every source by both book and component. `publicationPageRoutes.js` isolates the creation-ID policy shared by Student and Teacher parsers.

Migration 062 adds canonical JS/SQL snapshot hashing, component source locks and new-product integrity checks. Existing publication functions explicitly dispatch new products while retaining B2 recipes. The canonical runtime-schema generator marks only 062 as feature-optional: existing auth/B2 remain usable without it, while new product publication returns a schema-readiness state. If installed, its checksum is still verified. No historical migration or content generator output is rewritten.

The shared Builder workspace uses the selected book throughout and resets requests/state on scope changes. Candidate history includes verified immutable page metadata, so Review does not depend on remaining draft pages. Managed Viewer startup translates immutable page URLs into its existing preload plan instead of treating release descriptors as an offline pack manifest.

`tests/integration/b1-managed-publication.test.js` exercises all four components with real page/activity creation, compiler collection, SQL PREPARE/PUBLISH and HTTP reads. It covers source mutation after asset freeze, stale Unit metadata at publish, exact member policy, replay, head conflict, unauthorized actors, inactive candidates, eight entitlement combinations, missing-family isolation and fail-closed corruption. Identical raster bytes occupy separate page/Public/Teacher roles and separate component namespaces. Recomputed forged pin fingerprints still fail role/owner validation.

The R1/R2 scenario pins a real assignment to R1, then adds, moves, repoints and removes hotspots, edits an activity and changes page order. Draft edits and PREPARE leave R1 active. A stale candidate is rejected by both direct SQL and HTTP; explicit current publication changes browsing while the assignment retains the original release/page/hotspot/activity and the other product remains unchanged.

The upgrade tests compare historical B2 rows, heads, hashes, assignments and submissions byte-for-byte. The prior mutable B1 Homework test now runs its historical phase through 061, then installs 062 and proves old Homework remains readable while new mutable catalog entries are unavailable. The existing 060/061 preservation test remains explicitly bounded to those migrations rather than mistaking a later migration-history row for data loss.

`npm run test:b1-publication` extends the existing Playwright infrastructure with real local Builder/LMS Workers, disposable PostgreSQL and synthetic private storage. CI runs it after building web, Builder and Viewer. It covers selected-book publication, separate Prepare/Publish, immutable Review with draft pages removed, all four Student/Teacher viewers, page images, selectors, cross-Unit navigation, history/reload and native activity launch. Database commands must run sequentially against their disposable instance because the historical migration chain installs schema-local extensions.

Final command logs and exact candidate evidence belong outside the tracked candidate; they must be reported with the validated commit/tree. Skipped integration tests in `npm test` are not substitutes for the dedicated database/browser commands. Cloudflare verification is local dry-run only. Android/offline bundle and browser gates remain required; no application credentials or authoring workspace caches are inputs.

## Proposed hosted rollout (not executed)

Review -> separately authorized additive schema/code rollout -> exact-SHA CI/deployment -> fresh B1/B1 Plus content preflight -> PREPARE ONLY -> immutable candidate review -> separately authorized PUBLISH -> entitled Student/Teacher acceptance.

Synthetic tests establish repository behavior, not real B1/B1 Plus content readiness. Hosted content readiness remains NOT VERIFIED; production operational readiness remains NOT ESTABLISHED.
