# Offline Teacher edition exports

Source: local Tasks 1–3 and `lib/offline-editions`, `scripts/offline-editions`,
`src/apps/android-edition-offline`. Contract version: `offline-edition-pack.v1`;
runtime compatibility: `edition-classroom.v1`. This document describes code,
not permission to access shared services or a production acceptance receipt.

## Product and immutable selection

The new product is **Ultimate B2 Teacher classroom**, with independent Greek
and International editions. Audience and edition are separate dimensions.
Existing Student, canonical B2 Teacher and generic Teacher Project exports
retain their existing IDs, inputs and tasks. Companion is not an included
component. Required composition is SB, WB, Grammar and independently mapped
SB/WB Word Lists, with the exact frozen SB UI owner.

Only an explicitly selected **historically published edition-release.v2** can
be collected. There is no `latest`, current-head lookup, draft fallback or
candidate export. The source contract/compiler and all migrations remain
unchanged. Export does not call capture, import, associate, PREPARE or PUBLISH.

`select` performs a trusted authenticated read of the explicit release and
creates a portable handoff containing book, edition, Teacher audience, release
ID/contract, expected private release hash and composition hash. `collect`
checks that exact handoff again. No URL, cookie, token, timestamp or local
path belongs in the handoff or semantic pack identity.

The server replays existing private release verification before projecting.
The private release and component hashes are retained as **source identities**;
an allowlisted envelope cannot locally reconstruct omitted private snapshots.
The complete public composition and lexical projection hashes can be checked
locally. The derived pack identity independently binds all projected metadata,
source references, revisions, mappings, canonical UI bindings and inventory.

## Authentication and collection

Existing developer-authenticated Builder release GET accepts
`offline=1&audience=teacher`, with a published-only database read. Existing
entitled LMS edition-release GET supports the same projection only after book
access, explicit edition grant and Teacher/admin role checks. A client
`teacherMode` flag confers no authorization. Student/public projection tests
require empty Teacher documents and no Teacher answer/UI asset inventory.
The existing narrow public classroom-artwork route is unchanged.

The collector performs GETs against the selected origin and exact release,
using existing component/role-owned asset routes. Redirects fail. Each request
has a 60-second bound and cancellation, metadata is limited to 32 MiB, individual
files to 512 MiB, inventory to 30,000 logical entries and materialized bytes to
8 GiB. Exceeding a bound is an explicit failure. Credentials are supplied
through hidden stdin or the local launcher's password field, held in memory
and sent only as authentication headers. They are not command arguments,
saved browser-store reads, environment-profile reads or report fields.

Every logical SB/WB registration is authorized/read/verified before physical
deduplication. Equal hashes never confer ownership. Shared bytes retain separate
component/source/role registrations. Canonical UI fallbacks are collected from
the named bindings actually requested by the shared UI model, not a broad
publisher asset glob. The web build replaces authoring-page data with an
allowlisted shell-only UI projection.
The shared Unit Extras read helpers live in a pure runtime module so reading
frozen extras cannot initialize the canonical authoring-page/activity catalog.
The build also rejects canonical authoring/runtime/generated lesson modules in
its browser graph; native presentation capabilities come from frozen documents.

## Pack and runtime

`manifest.json` contains schema/runtime versions, selection, allowlisted source
snapshot, canonical UI binding map, complete logical asset inventory and
`packSha256`. Every asset has component, source hash, role, hash, size, media
type, extension and a local `assets/<sha256>.<extension>` path. Full source
references include source ID, scope, revision and hash. Teacher documents are
included only in this explicitly authorized Teacher artifact.

International Word Lists contain English fields, English audio and empty
translation objects. Greek contains English/Greek and English audio. Neither
contains raw bilingual imports, provenance, storage keys or database rows.
Occurrence IDs, duplicate occurrences, displayed numbers and booleans are
preserved. Required unresolved mappings are named in readiness failures.

Current v2 content wraps SB v3 and managed component contracts. Their included
hotspots target normalized native documents; SB v3 explicitly declares its
`native-only-after-publication` policy. Export supports all nine currently
declared kinds using existing renderers. An unknown required kind/action or
missing document is rejected with its ID, never silently removed or routed to
an unrelated legacy renderer. This does not claim support for an unrepresented
legacy activity contract.

`SharedEditionClassroom` is presentation extracted from the Task 3 hosted
adapter. Both adapters share `TeacherClassroomPages`, `EmbeddedActivityFrame`,
native renderers, Word List hook/overlay, UI model and layer/Back handling.
The offline adapter has stable publication/delivery/source objects and resolves
pages, fonts, media and words only from the verified local manifest. It imports
no hosted classroom/lexical loader. Verification hashes one bounded file at a
time before enabling content; it does not retain all media in memory or hash
the book on every interaction. Missing/corrupt content fails visibly closed.

## Local launcher and CLI

Prerequisites: a tracked reviewed checkout, Node 22 with `npm ci`, Python 3.12+
with `lzma`/`zlib`, Java 21, Android SDK platform 36/build-tools 36.0.0, and
`ANDROID_SDK_ROOT` (or `ANDROID_HOME`). Only debug signing is used. The launcher
does not install Java/Android toolchains, change signing secrets or install an APK.

Start the loopback-only interface:

```powershell
npm run offline:editions -- launcher --output C:/task-owned/edition-exports
```

Open the printed `127.0.0.1` address. Supply the authorized origin/session,
edition and explicit published release UUID; inspect the frozen identity/counts,
then build. Version inputs are explicit. The launcher uses the same collection,
materialization and native build core as the CLI, rejects concurrent requests
in its session, and offers cancellation. Each export has an isolated UUID
directory. It exposes no arbitrary command or path execution endpoint.

Equivalent CLI workflow (replace the example values):

```powershell
npm run offline:editions -- select --origin https://authorized.example --edition greek --release RELEASE_UUID --output C:/task-owned/greek-selection.json
npm run offline:editions -- collect --origin https://authorized.example --selection C:/task-owned/greek-selection.json --output C:/task-owned/greek-pack
npm run offline:editions -- verify --pack C:/task-owned/greek-pack
npm run offline:editions -- build --pack C:/task-owned/greek-pack --output C:/task-owned/greek-debug --version-code 1 --version-name 1.0
```

Use `--access entitled` with `select`/`collect` for the LMS role-aware route.
The cookie is prompted invisibly; do not put it in the shell command.
International uses `--edition international` and separate output paths.
No hand-written runtime JSON or code edits are required for later real releases.

## Native identity, staging and verification

| Edition | Stable application ID | Label |
| --- | --- | --- |
| Greek Teacher | `com.hhplms.ultimateb2.greek.teacher` | Ultimate B2 — Greek Edition |
| International Teacher | `com.hhplms.ultimateb2.international.teacher` | Ultimate B2 — International Edition |

The Java namespace and MainActivity come from the existing canonical
[Android compatibility contract](../lib/teacher-project-builder/android-contract.js).
The new manifests use its fully qualified activity name. Each FileProvider uses its own
application ID plus `.fileprovider`. Versions require positive integer
versionCode ≤ 2,100,000,000 and a bounded numeric versionName. Increase versionCode
for updates to the same application ID; content UUIDs/hashes never determine it.
These are debug review outputs, even when their source content is published.

Build staging archives an immutable Git index tree, rejecting unstaged changes,
and extracts only safe regular tracked members into a new task-owned directory.
The source tree identity binds the build receipt; no warm dist, ignored pack,
untracked publisher file or shared Android output is an input. Staging installs
its own dependencies and confines Capacitor/Gradle configuration changes to its
copy. Separate processes cannot consume each other's outputs. Existing output
destinations are rejected. Failed `.partial-UUID` directories are retained for
diagnosis and never represented as completed artifacts. Cancellation cannot
archive an old successful build. No successful-build cache/reuse is implemented.

Before atomic publication of the artifact directory, the copied APK is checked
with Android SDK `aapt` and `apksigner`, then independently streamed/read back
with Python ZIP tooling. Checks include application/launcher/provider/versions,
SDK levels, debug signer, no Internet permission/live reload, every staged web
file's hash/size, exact pack identity and bytes, and unexpected/forbidden data.
Documented additional native assets are Capacitor config/plugin metadata and
`native-bridge.js`; web additions are `cordova.js` and `cordova_plugins.js`.
Source maps, credentials, private storage paths and hosted endpoints fail.

Volatile build time, tool details, source tree and diagnostic paths belong in
external `build-receipt.json`. Semantic pack reproducibility is checked
independently of APK byte hashes; byte-identical APK reproducibility is not
claimed. SHA-256 and APK packaging are integrity mechanisms, not encryption,
licensing enforcement or DRM.

The web/APK embedding root is `assets/edition-pack`, while portable pack paths
remain relative to their own root. This preserves the existing Android PdfSaver
`assets/` boundary for native video worksheets without changing its native code.
Acceptance downloads and hashes a synthetic worksheet through the classroom UI;
Android document-picker/device behavior remains a separate acceptance gate.

## Acceptance and readiness boundaries

`npm test` includes pack/auth/ownership/path/native-identity negative cases.
`npm run test:offline-editions` requires a safety-confirmed disposable PostgreSQL
database, Builder static build and Playwright Chromium. It creates complete
synthetic releases through existing publication machinery, collects through
real authenticated routes, exercises the local GUI selection, shuts down
collection, builds both real APKs plus a reverse-order Greek isolation build and
runs cold blocked-network browser acceptance from their extracted bytes.
CI retains the old Student, Teacher, generic export, Task 1/2/3, database and
Worker gates and adds a separate Linux real-APK job.

Local HTTP serving of extracted assets is not Android WebView/device acceptance.
No physical device installation or co-installation claim follows from manifest
inspection. Final exact-tree commands/results are recorded in the task report.
The untouched Task 3 tree passed the front-loaded local Ubuntu 24.04/Node
22.23.2/Python 3.12.3 native gate on 2026-09-19; this does not relabel the older
Debian diagnostic or claim remote CI ran.

The real publisher observations from Tasks 2/3 (1,928 occurrences, 1,851 MP3s,
104 unresolved SB and 50 unresolved WB groups) are not schema constants. They
remain separate reviewed mapping/content prerequisites. Later authorized work
must establish complete localized Grammar and reviewed SB/WB mappings, apply
any required hosted migrations separately, explicitly associate/PREPARE/PUBLISH,
then select that published release with this exporter. None of those shared
operations is performed by local fixture success. Production signing,
distribution, licensing policy, device acceptance and recovery remain separate.
