# Unit Extras Saved Draft readiness

Authorized current Saved Draft review supports structurally valid MP4 and MP3
placeholders before upload. The server checks the persisted document checksum,
authoring structure and current page ownership before projecting it.

`projectCurrentUnitExtrasDraft` emits a missing item as
`{ id, title, readiness: "missing-media", video: null }` (or `audio: null`).
Ready entries retain their previous projection. Identity, order and page
visibility remain intact; the source is never rewritten by projection.

Only `normalizeCurrentDraftUnitExtras`, used by the authorized draft client,
accepts these entries. The Viewer lists unfinished items, including items on
pages whose Extras are hidden, in a Saved Draft status panel. Page video menus
show disabled missing-MP4 entries; missing-MP3 selections show a status instead
of an audio element. Ready items remain usable. Missing entries create no URLs.

Publication still uses `projectCurrentUnitExtras`, the published normalizer,
and the existing asset verification/compiler paths. Missing media still rejects
with `unit_extra_video_not_ready` or `unit_extra_audio_not_ready`. Draft-only
entries cannot pass published-document validation. No schema, migration,
immutable identity or release-pin changes are required.

Malformed metadata, cues, references, foreign ownership and dependency failures
are not treated as missing media. Existing authorization, public-data checks
and managed media delivery checks continue to apply.

Validation covers the actual registry, stored-document handler and draft client,
strict publication/immutable contracts, and the actual editor/media components
in `test:builder:extras`. Restored acceptance must first exercise unchanged
canonical revision 31 on a disposable clone, before attaching synthetic media.

The Viewer imports its status through `virtual:unit-extras-draft-status`.
Vite selects the hosted implementation only for the authorized hosted
Interactive profile; other profiles select a network-free inactive component.
This keeps the loader and its dependencies out of offline artifacts, including
Teacher Project, without adding draft exports to the shared publication
providers. A runtime visibility condition alone cannot enforce this boundary.
The presentation-only `UnitExtrasDraftStatus` remains independent of loading.

The boundary regression resolves the actual Vite aliases and builds the selected
modules in memory for hosted, web and offline profiles. It requires no existing
dist or generated pack; full canonical profile builds and their unchanged
bundle verifiers provide whole-artifact validation.
