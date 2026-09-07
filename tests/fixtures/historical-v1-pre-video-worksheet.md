# Frozen historical v1 compatibility artifact

`historical-v1-pre-video-worksheet-release.json` was emitted and verified by
the tracked repository at `6a7e3e606227fdb4ee9738719e7dbe2d9bb30989`, the parent
of `673540a96eedd74fc6440373489317830f7ffa80`, before the `navigation.videoWorksheet`
binding was introduced. It is the repository-only canonical v1 baseline,
not a staging release or a copy of an operational database row. No database,
credentials, object keys, accounts or media files were used.

In an isolated checkout of that historical commit, generation called
`compileUltimateB2ComponentRelease()` without authored inputs, mapped its
compiler, compatibility, source/public/Teacher documents and their hashes,
asset manifest and aggregate hash to the SQL row-shaped artifact, and set
`release_schema_version` from `sourceSnapshot.schemaVersion`. That checkout's
`verifyImmutableComponentRelease()` verified the artifact before serialization.
The historical compiler itself produced the old compatibility in both the
release envelope and public projection; neither was rewritten by current code.

| Frozen identity | SHA-256 |
|---|---|
| Canonical artifact | `9bfa4fcae11cb38b7f9b0e7b7e49b58ec15a0e6df2cfe7cfa5ac55570bafee9e` |
| Compatibility | `0864cd57203cf9f9bb5a3faef64d767ac150f701290b1a1e82d9fc8b684d0ef2` |
| Source snapshot | `81450a57c10d9e2cb76a51a97d7fce3c1f19094ddbe9295ff398c35b9c82a163` |
| Public projection | `059757259a2e1fb7c72f64ea750084cc1e7f302a5d1debdbc8306af265de873d` |
| Teacher projection | `bd5dbfb122445df6a2bbb3f8863afd062807e858d50e3572ae26ca70c128dc4a` |
| Aggregate release | `7a024dd8d6be028bce8bbfb1345e4ad07da0258eaca307971d42dc06a8516c44` |

At candidate `b6e50f9b`, the positive historical verification test failed with
`ReleaseIntegrityError`: the source/public/Teacher hashes matched, but the
current-only compatibility selection rejected the compatibility and aggregate.
The regression also independently pins the canonical historical helper to the
frozen compatibility, and checks that unknown self-consistent compatibility
hashes and rehashed embedded compatibility mismatches fail closed.

Do not regenerate this artifact or refresh its identities with current code.
Tests import it directly and need no historical checkout, Git history,
operational evidence, generated files or external services.
