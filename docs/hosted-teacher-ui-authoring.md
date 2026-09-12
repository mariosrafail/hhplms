# Hosted Teacher UI authoring

The Ultimate B2 hosted Builder edits a fixed semantic catalog of Teacher Review interface bindings. It does not author layout, controls, routes, CSS, HTML, scripts, page/spread content, or the unwired publisher Navibar library. The saved `teacher_ui/default` Builder document is a strict override manifest over tracked canonical assets; deleting an override restores the tracked asset.

Uploads use the existing book-asset storage profiles. The authenticated Builder prepares an exact binding-scoped upload, sends bytes directly to a server-selected private staging object, and finalizes it through authoritative raster/audio/GAF inspection. Finalize promotes an immutable content-addressed public object and records a validated candidate, but does not change the Viewer. A separate revisioned Save proves candidate ownership and binding identity before writing through `builder_component_documents`. Migration `034_builder_teacher_ui_asset_uploads.sql` stores only this temporary candidate trust boundary; Task 6 Open Response tables are not reused.

Bare public Viewer mode makes no `ui-controller` request and uses canonical tracked UI. UI Controller no longer owns a library-scoped external Viewer. Its component-wide **Review · Saved Draft** opens a selected real page with page-scoped authorization, so native activities on that page remain usable without granting native permissions to library scope. Unsaved UI candidates remain local and Review continues showing the saved revision until **Save UI draft** succeeds.

An explicit Builder preview reads the no-store Teacher `ui-controller` projection only with a valid short-lived `previewAuthorization`, then derives same-origin `/preview/ui-assets/<sha256>.<extension>` paths. The Builder renews that authorization once per server-provided lifetime, thirty seconds before `expiresAt`; closing shared Review unmounts the frame and cancels its lifecycle. Failed renewal removes the explicit preview instead of exposing Teacher UI or silently falling back to bare mode. An exact release preview similarly reads its protected immutable Teacher UI projection. The hosted runtime resolves one asset model before rendering and supplies it to the existing shell. Standard LMS, Android Student, and Android Teacher offline builds continue to use their established providers; Android Teacher remains fully packaged and offline.

## Operations boundary

Repository tests use isolated PostgreSQL and fake/local object storage. A real review environment still needs independently verified S3/R2 credentials, private signed-PUT CORS, and public CDN CORS that permits Viewer image/audio loads and `fetch()` of GAF files after redirects. The public and private buckets, lifecycle/expired-staging cleanup, concurrency/throughput, monitoring, backups, and disaster recovery remain operational responsibilities. Do not mutate production/shared bucket CORS or storage during repository validation.

This is draft/review authoring, not publication and not production Teacher authorization.


## Managed overview caption fonts (local candidate, 2026-09-12)

B1, B1+ and B2 now use the existing component TTF library from migration 054.
The package registry resolves one UI owner (currently its Students Book), and
both the Page UI Controller and native activity controls share
`useBuilderFontLibrary` and `NativeActivityFontControls`. Upload TTF uses the
existing prepare / private PUT / inspect / finalize flow. It adds and selects
the asset immediately; only Save UI draft persists the selection. Default
removes both font settings. Arial, Georgia and Verdana remain system options.

The optional `overviewCaptionFontAsset` is exactly
`{ assetId, checksumSha256, role: "activity_font", slot: "font-<UUID without hyphens>" }`.
It is mutually exclusive with `overviewCaptionFontFamily`. Save checks the
canonical owner, active private component-library row, checksum and object key.
PREPARE collects the same asset into the Teacher manifest: B1/B1+ use existing
private source pins, while B2 uses its existing immutable materialization.
Checksum/role deduplication permits independent native activity reuse. An
overview-only font never enters the public projection. Old documents and
compiler fingerprints are unchanged.

Saved Draft Review loads the authorized `/ui-controller/font` preview route.
Immutable Review uses the protected release `/teacher-ui-font` route and its
frozen manifest/pin or materialized bytes, without consulting the mutable font
library. The existing FontFace loader applies the stable family only after
loading; both caption lines fall back safely on failure. The current Android
Teacher pack is built from canonical Git assets and does not import hosted
releases. Its offline behavior remains unchanged; a future frozen-pack provider
can supply the model's `resolveFrozenFontUrl` without a Builder network request.

Migration `065_teacher_overview_managed_font.sql` extends strict SQL validation
and checks release source/projection equality and private pins. It is a
feature-optional schema requirement: only Save with a managed reference,
PREPARE whose compiled Teacher UI contains one, or PUBLISH of an immutable
candidate containing one requires 065 (`overview_font_schema_unavailable`).
GET/status, historical releases, system fonts and unrelated writes remain
compatible with 064. The migration was tested only in disposable local
PostgreSQL; it has not been applied to hosted staging by this task.
