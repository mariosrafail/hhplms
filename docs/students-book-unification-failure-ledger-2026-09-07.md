# Students Book reviewed failure ledger - development evidence

Baseline: `fff347cceb86f47489130cd6c2d49a7e64d2af55`. This ledger covers every failure in the two exported review logs: 33 unit and 5 integration. Original log locations below identify the exact failing assertions. Large bundled-source diffs are referenced rather than duplicated.

Evidence is local development evidence, not final candidate validation. `reviewed-unit-focused.log`: 83 pass / 0 fail / 0 skip. `reviewed-integration-focused.log`: 14 pass / 0 fail / 0 skip. `foundation-unit-development.log`: 1604 pass / 0 fail / 63 skips. `foundation-integration-development.log`: 75 pass / 0 fail / 0 skip. Later source changes require rerunning the appropriate gates. Logs are held in the external continuation evidence directory; no shared data was used.

## 01. Builder content requires only a live Builder session for GET and Save

- Suite/location: `unit`, `tests/builder-content-api.test.js:90:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **intentional current-product-policy change with stale fixture**.
- Root cause: Fixture indexed the old generated hotspot baseline; current authoring correctly starts empty.
- Remediation: Create explicit valid synthetic native targets and authored hotspots before saving.
- Retained/equivalent evidence: Current GET remains exactly empty; save/reload/revisions/idempotency/history/conflict assertions retained.

Original assertion/error excerpt:

```text
"Cannot read properties of undefined (reading '0')"
```

## 02. Builder content mutation enforces same origin and JSON before persistence

- Suite/location: `unit`, `tests/builder-content-api.test.js:99:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **intentional current-product-policy change with stale fixture**.
- Root cause: Fixture indexed the old generated hotspot baseline; current authoring correctly starts empty.
- Remediation: Create explicit valid synthetic native targets and authored hotspots before saving.
- Retained/equivalent evidence: Current GET remains exactly empty; save/reload/revisions/idempotency/history/conflict assertions retained.

Original assertion/error excerpt:

```text
"Cannot read properties of undefined (reading '0')"
```

## 03. first and second Saves persist revisions and reload returns the latest document

- Suite/location: `unit`, `tests/builder-content-api.test.js:139:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **intentional current-product-policy change with stale fixture**.
- Root cause: Fixture indexed the old generated hotspot baseline; current authoring correctly starts empty.
- Remediation: Create explicit valid synthetic native targets and authored hotspots before saving.
- Retained/equivalent evidence: Current GET remains exactly empty; save/reload/revisions/idempotency/history/conflict assertions retained.

Original assertion/error excerpt:

```text
"Cannot read properties of undefined (reading '0')"
```

## 04. stale revisions conflict without overwrite

- Suite/location: `unit`, `tests/builder-content-api.test.js:159:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **intentional current-product-policy change with stale fixture**.
- Root cause: Fixture indexed the old generated hotspot baseline; current authoring correctly starts empty.
- Remediation: Create explicit valid synthetic native targets and authored hotspots before saving.
- Retained/equivalent evidence: Current GET remains exactly empty; save/reload/revisions/idempotency/history/conflict assertions retained.

Original assertion/error excerpt:

```text
"Cannot read properties of undefined (reading '0')"
```

## 05. mutation retries are idempotent while changed payload reuse is rejected

- Suite/location: `unit`, `tests/builder-content-api.test.js:169:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **intentional current-product-policy change with stale fixture**.
- Root cause: Fixture indexed the old generated hotspot baseline; current authoring correctly starts empty.
- Remediation: Create explicit valid synthetic native targets and authored hotspots before saving.
- Retained/equivalent evidence: Current GET remains exactly empty; save/reload/revisions/idempotency/history/conflict assertions retained.

Original assertion/error excerpt:

```text
"Cannot read properties of undefined (reading '0')"
```

## 06. hotspot validation rejects unknown pages, geometry, IDs, activities, actions, malformed bodies, and private keys

- Suite/location: `unit`, `tests/builder-content-api.test.js:184:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **intentional current-product-policy change with stale fixture**.
- Root cause: Fixture indexed the old generated hotspot baseline; current authoring correctly starts empty.
- Remediation: Create explicit valid synthetic native targets and authored hotspots before saving.
- Retained/equivalent evidence: Current GET remains exactly empty; save/reload/revisions/idempotency/history/conflict assertions retained.

Original assertion/error excerpt:

```text
"Cannot read properties of undefined (reading '0')"
```

## 07. stored documents verify raw checksums before validation and fail corrupt state closed

- Suite/location: `unit`, `tests/builder-content-api.test.js:206:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **implementation defect**.
- Root cause: Structural validation accepted unknown canonical page keys and generic normalization erased empty entries.
- Remediation: Validate canonical identity/fields before contextual managed membership and return the original validated payload without normalization rewrites.
- Retained/equivalent evidence: Original missing-rejection assertion retained; PostgreSQL contract test also rejects unknown/foreign managed pages and proves exact read/modify/save.

Original assertion/error excerpt:

```text
'Missing expected rejection.'
```

## 08. native validation uses one public batch for zero, one, and many activities and stays below the save budget

- Suite/location: `unit`, `tests/builder-content-api.test.js:282:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Authority adds a fixed page revision, Unit and page-row load; the old query fixture/count assumed one overlay read.
- Remediation: Provide scoped SQL rows and assert one public batch plus exactly three fixed authority queries as activity count grows.
- Retained/equivalent evidence: 0/1/60 native save cases and 101-entry catalog prove bounded reads; no per-activity page query.

Original assertion/error excerpt:

```text
Expected values to be strictly equal:

400 !== 200
```

## 09. native hotspot targets save, reload, and fail closed when the saved native catalog cannot prove membership

- Suite/location: `unit`, `tests/builder-content-api.test.js:336:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Fixture supplied no scoped SQL page/Unit context to the new DB-backed placement authority.
- Remediation: Supply faithful scoped page/Unit rows through the production SQL boundary; retain real resolver and handler.
- Retained/equivalent evidence: Original success, authorization and negative assertions retained; 83 focused unit tests passed.

Original assertion/error excerpt:

```text
Expected values to be strictly equal:

400 !== 200
```

## 10. hotspot PUT rejects retired and moved canonical targets before save_document

- Suite/location: `unit`, `tests/builder-content-api.test.js:369:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **intentional current-product-policy change with stale fixture**.
- Root cause: Current native-only authoring no longer permits generated canonical activity targets.
- Remediation: Keep an explicit rejected canonical-target test without consulting mutable legacy lifecycle for current authoring.
- Retained/equivalent evidence: New canonical target remains rejected before persistence; separate historical tests continue to exercise frozen inputs and lifecycle history.

Original assertion/error excerpt:

```text
"Cannot read properties of undefined (reading '0')"
```

## 11. deployed-style CommonJS artifacts bundle and execute the canonical hotspot validator graph

- Suite/location: `unit`, `tests/builder-content-netlify-runtime.test.js:33:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **generated/inventory state**.
- Root cause: Exact module/UI inventory described the old canonical authoring graph.
- Remediation: Update exact expected new modules/current authority wiring and execute the CommonJS validator bundle.
- Retained/equivalent evidence: Exact inventory remains closed; runtime rejects unknown page/bad schema and preserves the empty baseline.

Original assertion/error excerpt:

```text
The input did not match the regular expression /Unsupported hotspot manifest schemaVersion/. Input: [bundled/source text; see original log]
```

## 12. Image paired save requires auth and origin and delegates semantic managed-asset validation

- Suite/location: `unit`, `tests/builder-native-activity-api.test.js:109:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Fixture supplied no scoped SQL page/Unit context to the new DB-backed placement authority.
- Remediation: Supply faithful scoped page/Unit rows through the production SQL boundary; retain real resolver and handler.
- Retained/equivalent evidence: Original success, authorization and negative assertions retained; 83 focused unit tests passed.

Original assertion/error excerpt:

```text
"Cannot read properties of undefined (reading 'document')"
```

## 13. one create mutation produces index, public, and Teacher documents and replays the stable ID

- Suite/location: `unit`, `tests/builder-native-activity-api.test.js:139:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Fixture supplied no scoped SQL page/Unit context to the new DB-backed placement authority.
- Remediation: Supply faithful scoped page/Unit rows through the production SQL boundary; retain real resolver and handler.
- Retained/equivalent evidence: Original success, authorization and negative assertions retained; 83 focused unit tests passed.

Original assertion/error excerpt:

```text
Expected values to be strictly equal:

400 !== 200
```

## 14. activity relocation forwards the server-derived authoritative source page independently of the client expectation

- Suite/location: `unit`, `tests/builder-native-activity-api.test.js:157:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Fixture supplied no scoped SQL page/Unit context to the new DB-backed placement authority.
- Remediation: Supply faithful scoped page/Unit rows through the production SQL boundary; retain real resolver and handler.
- Retained/equivalent evidence: Original success, authorization and negative assertions retained; 83 focused unit tests passed.

Original assertion/error excerpt:

```text
Expected values to be strictly equal:

400 !== 409
```

## 15. native deletion prunes every page reference, preserves history, is idempotent, and never reuses the stable ID

- Suite/location: `unit`, `tests/builder-native-activity-api.test.js:180:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Fixture supplied no scoped SQL page/Unit context to the new DB-backed placement authority.
- Remediation: Supply faithful scoped page/Unit rows through the production SQL boundary; retain real resolver and handler.
- Retained/equivalent evidence: Original success, authorization and negative assertions retained; 83 focused unit tests passed.

Original assertion/error excerpt:

```text
'Hotspot delete-one references an unavailable activityKey.'
```

## 16. deleted native activities reject stale paired saves and asset preparation without invoking mutation stores

- Suite/location: `unit`, `tests/builder-native-activity-api.test.js:216:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Fixture supplied no scoped SQL page/Unit context to the new DB-backed placement authority.
- Remediation: Supply faithful scoped page/Unit rows through the production SQL boundary; retain real resolver and handler.
- Retained/equivalent evidence: Original success, authorization and negative assertions retained; 83 focused unit tests passed.

Original assertion/error excerpt:

```text
Expected values to be strictly equal:

404 !== 200
```

## 17. native documents are authenticated reads and paired writes are the only mutation boundary

- Suite/location: `unit`, `tests/builder-native-activity-api.test.js:247:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Fixture supplied no scoped SQL page/Unit context to the new DB-backed placement authority.
- Remediation: Supply faithful scoped page/Unit rows through the production SQL boundary; retain real resolver and handler.
- Retained/equivalent evidence: Original success, authorization and negative assertions retained; 83 focused unit tests passed.

Original assertion/error excerpt:

```text
"Cannot read properties of undefined (reading 'document')"
```

## 18. authenticated native catalog exposes page-aware readiness without Teacher answers

- Suite/location: `unit`, `tests/builder-native-activity-api.test.js:298:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Fixture supplied no scoped SQL page/Unit context to the new DB-backed placement authority.
- Remediation: Supply faithful scoped page/Unit rows through the production SQL boundary; retain real resolver and handler.
- Retained/equivalent evidence: Original success, authorization and negative assertions retained; 83 focused unit tests passed.

Original assertion/error excerpt:

```text
Expected values to be strictly equal:

500 !== 200
```

## 19. catalog quarantines a missing local pair while preserving valid activities and safe diagnostics

- Suite/location: `unit`, `tests/builder-native-activity-api.test.js:331:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Fixture supplied no scoped SQL page/Unit context to the new DB-backed placement authority.
- Remediation: Supply faithful scoped page/Unit rows through the production SQL boundary; retain real resolver and handler.
- Retained/equivalent evidence: Original success, authorization and negative assertions retained; 83 focused unit tests passed.

Original assertion/error excerpt:

```text
{"error":"native_activity_request_failed"}

500 !== 200
```

## 20. catalog keeps a structurally valid activity non-ready when its local managed asset is missing

- Suite/location: `unit`, `tests/builder-native-activity-api.test.js:354:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Fixture supplied no scoped SQL page/Unit context to the new DB-backed placement authority.
- Remediation: Supply faithful scoped page/Unit rows through the production SQL boundary; retain real resolver and handler.
- Retained/equivalent evidence: Original success, authorization and negative assertions retained; 83 focused unit tests passed.

Original assertion/error excerpt:

```text
{"error":"native_activity_request_failed"}

500 !== 200
```

## 21. catalog boundary failures retain one generic response and emit only their exact safe diagnostic stage

- Suite/location: `unit`, `tests/builder-native-activity-api.test.js:383:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **implementation defect**.
- Root cause: Deduplicated placement resolution lost the failed input index; SQL-less fixtures also failed before the intended stage.
- Remediation: Carry placementIndex from both syntax validation and deduplicated resolution; preserve safe activity/kind attribution only.
- Retained/equivalent evidence: Exact safe diagnostic fields, boundary stage, omitted Teacher/document content and generic HTTP failure assertions retained.

Original assertion/error excerpt:

```text
known placement-domain rejection
+ actual - expected

[
{
fields: {
-       activityId: 'ultimate-b2-sb-u1-p1-o99',
bookSlug: 'ultimate-b2',
boundaryStage: 'placement_resolution_failed',
```

## 22. catalog processing failures retain safe phase and code diagnostics without leaking documents or internals

- Suite/location: `unit`, `tests/builder-native-activity-api.test.js:472:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Fixture supplied no scoped SQL page/Unit context to the new DB-backed placement authority.
- Remediation: Supply faithful scoped page/Unit rows through the production SQL boundary; retain real resolver and handler.
- Retained/equivalent evidence: Original success, authorization and negative assertions retained; 83 focused unit tests passed.

Original assertion/error excerpt:

```text
uncoded catalog asset load
+ actual - expected

[
{
fields: {
bookSlug: 'ultimate-b2',
+       boundaryStage: 'placement_resolution_failed',
+       code: 'native_catalog_boundary_invalid',
-       code: 'native_catalog_processing_failed',
componentSlug: 'ultimate-b2-students-book',
-       processingStage: 'catalog_asset_load'
},
message: 'Builder native activity request failed'
}
]
```

## 23. catalog normalizes supported pre-rich Teacher answer shapes instead of quarantining them

- Suite/location: `unit`, `tests/builder-native-activity-api.test.js:598:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Fixture supplied no scoped SQL page/Unit context to the new DB-backed placement authority.
- Remediation: Supply faithful scoped page/Unit rows through the production SQL boundary; retain real resolver and handler.
- Retained/equivalent evidence: Original success, authorization and negative assertions retained; 83 focused unit tests passed.

Original assertion/error excerpt:

```text
{"error":"native_activity_request_failed"}

500 !== 200
```

## 24. Students Book catalog keeps a native activity on a tombstoned canonical page as Unassigned

- Suite/location: `unit`, `tests/builder-native-activity-api.test.js:630:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Fixture supplied no scoped SQL page/Unit context to the new DB-backed placement authority.
- Remediation: Supply faithful scoped page/Unit rows through the production SQL boundary; retain real resolver and handler.
- Retained/equivalent evidence: Original success, authorization and negative assertions retained; 83 focused unit tests passed.

Original assertion/error excerpt:

```text
{"error":"native_activity_request_failed"}

500 !== 200
```

## 25. a 101-Activity Students Book catalog uses one deduplicated tombstone-overlay SQL query

- Suite/location: `unit`, `tests/builder-native-activity-api.test.js:763:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Authority adds a fixed page revision, Unit and page-row load; the old query fixture/count assumed one overlay read.
- Remediation: Provide scoped SQL rows and assert one public batch plus exactly three fixed authority queries as activity count grows.
- Retained/equivalent evidence: 0/1/60 native save cases and 101-entry catalog prove bounded reads; no per-activity page query.

Original assertion/error excerpt:

```text
"Cannot read properties of undefined (reading 'length')"
```

## 26. Mark the Words handler creates, saves, replays and rejects stale or leaking pairs

- Suite/location: `unit`, `tests/builder-native-activity-api.test.js:874:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Fixture supplied no scoped SQL page/Unit context to the new DB-backed placement authority.
- Remediation: Supply faithful scoped page/Unit rows through the production SQL boundary; retain real resolver and handler.
- Retained/equivalent evidence: Original success, authorization and negative assertions retained; 83 focused unit tests passed.

Original assertion/error excerpt:

```text
Expected values to be strictly equal:

400 !== 200
```

## 27. saved order respects library, page and single-activity authorization scopes

- Suite/location: `unit`, `tests/builder-native-preview-api.test.js:172:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **intentional current-product-policy change with stale fixture**.
- Root cause: Library scope fixture relied on canonical entries outside the current native index.
- Remediation: Use a second actual native index entry on another canonical page.
- Retained/equivalent evidence: Library has multiple pages; page and single-activity authorization remain restricted.

Original assertion/error excerpt:

```text
The expression evaluated to a falsy value:

assert.ok(Object.keys(JSON.parse(library.body).pages).length > 1)
```

## 28. public Builder preview returns the canonical repository revision without a session

- Suite/location: `unit`, `tests/builder-preview-api.test.js:103:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Fixture supplied no scoped SQL page/Unit context to the new DB-backed placement authority.
- Remediation: Supply faithful scoped page/Unit rows through the production SQL boundary; retain real resolver and handler.
- Retained/equivalent evidence: Original success, authorization and negative assertions retained; 83 focused unit tests passed.

Original assertion/error excerpt:

```text
Expected values to be strictly equal:

500 !== 200
```

## 29. public Builder preview returns the checksum-validated latest database revision

- Suite/location: `unit`, `tests/builder-preview-api.test.js:132:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **intentional current-product-policy change with stale fixture**.
- Root cause: Fixture indexed the old generated hotspot baseline; current authoring correctly starts empty.
- Remediation: Create explicit valid synthetic native targets and authored hotspots before saving.
- Retained/equivalent evidence: Current GET remains exactly empty; save/reload/revisions/idempotency/history/conflict assertions retained.

Original assertion/error excerpt:

```text
"Cannot read properties of undefined (reading '0')"
```

## 30. hotspot preview loads declared native context and preserves a valid persisted native target

- Suite/location: `unit`, `tests/builder-preview-api.test.js:153:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **missing test dependency/context**.
- Root cause: Fixture supplied no scoped SQL page/Unit context to the new DB-backed placement authority.
- Remediation: Supply faithful scoped page/Unit rows through the production SQL boundary; retain real resolver and handler.
- Retained/equivalent evidence: Original success, authorization and negative assertions retained; 83 focused unit tests passed.

Original assertion/error excerpt:

```text
Expected values to be strictly equal:

500 !== 200
```

## 31. Students hotspot preview still loads lifecycle and filters retired canonical activities

- Suite/location: `unit`, `tests/builder-preview-api.test.js:250:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **intentional current-product-policy change with stale fixture**.
- Root cause: Current native-only authoring no longer permits generated canonical activity targets.
- Remediation: Keep an explicit rejected canonical-target test without consulting mutable legacy lifecycle for current authoring.
- Retained/equivalent evidence: New canonical target remains rejected before persistence; separate historical tests continue to exercise frozen inputs and lifecycle history.

Original assertion/error excerpt:

```text
Expected values to be strictly equal:

false !== true
```

## 32. hosted Hotspot Builder reuses the proven editor and exposes explicit persistence state

- Suite/location: `unit`, `tests/hosted-builder-hotspot-authoring.test.js:11:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **generated/inventory state**.
- Root cause: Exact module/UI inventory described the old canonical authoring graph.
- Remediation: Update exact expected new modules/current authority wiring and execute the CommonJS validator bundle.
- Retained/equivalent evidence: Exact inventory remains closed; runtime rejects unknown page/bad schema and preserves the empty baseline.

Original assertion/error excerpt:

```text
The input did not match the regular expression /ultimateB2StudentsBookPageUnits/. Input: [bundled/source text; see original log]
```

## 33. dedicated Builder site package isolates build output and Netlify Functions

- Suite/location: `unit`, `tests/netlify-review-targets.test.js:31:1`.
- Original log: `hhplms-sb-development-unit-final-diagnostic.log`.
- Classification: **generated/inventory state**.
- Root cause: Exact module/UI inventory described the old canonical authoring graph.
- Remediation: Update exact expected new modules/current authority wiring and execute the CommonJS validator bundle.
- Retained/equivalent evidence: Exact inventory remains closed; runtime rejects unknown page/bad schema and preserves the empty baseline.

Original assertion/error excerpt:

```text
Expected values to be strictly deep-equal:
+ actual - expected
```

## 34. isolated PostgreSQL persists current state, strict history, idempotency, concurrency, and audit atomically

- Suite/location: `integration`, `tests/integration/builder-content-persistence.test.js:40:1`.
- Original log: `hhplms-sb-development-integration-fresh-db.log`.
- Classification: **intentional current-product-policy change with stale fixture**.
- Root cause: Fixture indexed the old generated hotspot baseline; current authoring correctly starts empty.
- Remediation: Create explicit valid synthetic native targets and authored hotspots before saving.
- Retained/equivalent evidence: Current GET remains exactly empty; save/reload/revisions/idempotency/history/conflict assertions retained. Reviewed integration group: 14 pass, 0 skips; full development integration: 75 pass, 0 skips.

Original assertion/error excerpt:

```text
"Cannot read properties of undefined (reading '0')"
```

## 35. isolated PostgreSQL reorders mixed activities atomically and rejects concurrent revisions

- Suite/location: `integration`, `tests/integration/builder-native-activity-persistence.test.js:23:1`.
- Original log: `hhplms-sb-development-integration-fresh-db.log`.
- Classification: **intentional current-product-policy change with stale fixture**.
- Root cause: One current native item cannot move among canonical items excluded by current policy.
- Remediation: Create two actual native records before reorder.
- Retained/equivalent evidence: Concurrent outcomes remain [200,409]; second-document conflict proves full rollback. Reviewed integration group: 14 pass, 0 skips; full development integration: 75 pass, 0 skips.

Original assertion/error excerpt:

```text
[{"statusCode":400,"headers":{"Content-Type":"application/json","Cache-Control":"no-store"},"body":"{\"error\":\"activity_order_boundary\"}"},{"statusCode":400,"headers":{"Content-Type":"application/json","Cache-Control":"no-store"},"body":"{\"error\":\"activity_order_boundary\"}"}]
+ actual - expected

[
+   400,
+   400
-   200,
-   409
]
```

## 36. isolated PostgreSQL atomically relocates native and canonical identities and logically retires canonical activity membership

- Suite/location: `integration`, `tests/integration/builder-native-activity-persistence.test.js:446:1`.
- Original log: `hhplms-sb-development-integration-fresh-db.log`.
- Classification: **historical/current contract coupling**.
- Root cause: Historical lifecycle/publication fixture was derived from mutable current authoring baseline.
- Remediation: Use explicit historical saved input/frozen v1 projection; new current save still rejects unavailable canonical targets.
- Retained/equivalent evidence: Historical operation succeeds; stable identity, history, immutable release hashes, stale heads and concurrent publication assertions retained. Reviewed integration group: 14 pass, 0 skips; full development integration: 75 pass, 0 skips.

Original assertion/error excerpt:

```text
Expected values to be strictly equal:

400 !== 200
```

## 37. isolated PostgreSQL hotspot trigger accepts same-page targets and rejects retired, moved, and inactive targets

- Suite/location: `integration`, `tests/integration/builder-native-activity-persistence.test.js:506:1`.
- Original log: `hhplms-sb-development-integration-fresh-db.log`.
- Classification: **intentional current-product-policy change with stale fixture**.
- Root cause: Fixture indexed the old generated hotspot baseline; current authoring correctly starts empty.
- Remediation: Create explicit valid synthetic native targets and authored hotspots before saving.
- Retained/equivalent evidence: Current GET remains exactly empty; save/reload/revisions/idempotency/history/conflict assertions retained. Reviewed integration group: 14 pass, 0 skips; full development integration: 75 pass, 0 skips.

Original assertion/error excerpt:

```text
"Cannot read properties of undefined (reading 'push')"
```

## 38. isolated PostgreSQL preserves immutable release history and stale-safe atomic heads

- Suite/location: `integration`, `tests/integration/builder-publication-persistence.test.js:25:1`.
- Original log: `hhplms-sb-development-integration-fresh-db.log`.
- Classification: **historical/current contract coupling**.
- Root cause: Historical lifecycle/publication fixture was derived from mutable current authoring baseline.
- Remediation: Use explicit historical saved input/frozen v1 projection; new current save still rejects unavailable canonical targets.
- Retained/equivalent evidence: Historical operation succeeds; stable identity, history, immutable release hashes, stale heads and concurrent publication assertions retained. Reviewed integration group: 14 pass, 0 skips; full development integration: 75 pass, 0 skips.

Original assertion/error excerpt:

```text
"Cannot read properties of undefined (reading '0')"
```

## Continuation acceptance

The Greek status report documents the completed implementation and additional browser findings. Exact final candidate SHA/tree and fresh-checkout results are recorded outside tracked Git state in FINAL-REPORT.md, validation-results.json and INVENTORY.txt. The original 38 failures above remain a point-in-time ledger; their original locations are not rewritten to newer line numbers.
