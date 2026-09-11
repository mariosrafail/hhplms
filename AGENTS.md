# HHPLMS Codex Instructions

This repository is Hamilton House LMS / hhplms.

## Start here

Before substantial engineering analysis, implementation recommendations or
code changes:

1. Read `docs/HHPLMS_OPERATING_CONTEXT.md`.
2. Fetch/verify the current `origin/dev`; never treat a SHA stored in docs as
   permanently current.
3. Read the task-relevant code, handlers, Workers, registries, migrations,
   tests, scripts and docs at the current target SHA.
4. Explain the proven current state, gap and smallest safe next step before
   broad changes.

## Infrastructure

- Hosted stack: Cloudflare Workers + Neon PostgreSQL + Cloudflare R2.
- `netlify/`, `netlify-sites/`, `/.netlify/functions/`,
  `build:netlify:*` and `verify:netlify:*` remain active
  compatibility/runtime/CI dependencies where referenced.
- Their names are NOT evidence of active Netlify hosting.
- Do not mass-rename/delete them or propose Netlify dashboard work without
  current evidence.
- Builder and LMS Cloudflare configuration must be read from current
  repository/CI/provider evidence.

## Database and operational safety

- `database/MIGRATIONS.md` is the canonical migration order.
- Use `scripts/_database-identity.mjs` and the canonical safety/preflight
  paths; never invent database fingerprints or bypass guards.
- Shared staging, protected historical Neon resources, Cloudflare/R2
  resources, migrations, PREPARE/PUBLISH and manual deployment require
  explicit task-specific authorization.
- Never expose passwords, full connection strings, tokens, cookies, signed
  URLs or env dumps.
- Local test databases must be genuinely disposable and isolated.

## Books / publication

- Git registries, Builder drafts, managed pages, hotspots, native
  public/Teacher documents, uploaded assets, UI drafts and immutable releases
  are distinct sources/states.
- Save != PREPARE != PUBLISH != Git push/deploy != DB migration.
- Preserve historical release/compiler/assignment semantics unless a task
  explicitly and safely versions them.
- Teacher answers/assets must remain separated from Student/public/static
  bundles.

## Worktree / Git

- Target `dev`.
- Preserve unrelated local work.
- No main changes, merge, PR, force-push or history rewrite unless explicitly
  requested.
- Before any commit/push task inspect current `.github/workflows/ci.yml`,
  `package.json` and relevant build/deploy gates.
- Perform the repository-required CI Risk / Derived-State Check.
- Final validated Git tree must equal the pushed tree byte-for-byte.
- After a push verify exact-SHA CI; a failure stops the task until separately
  authorized remediation.

## Context upkeep

When architecture, hosting, environment loading, migration policy,
registries/publication contracts or CI materially change, update
`docs/HHPLMS_OPERATING_CONTEXT.md` in the same candidate before final
validation.

Do not duplicate volatile operational facts in this AGENTS.md.
Keep those facts, their source and `verifiedAt` in the operating context.

For simple transcription, bulk authoring text, hotspot-coordinate or SRT work,
do not open unrelated infrastructure investigations.
