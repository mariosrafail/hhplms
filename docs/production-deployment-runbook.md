# Production deployment and migration runbook

## 1. Purpose and safety boundary

This runbook governs a production release of Hamilton House LMS. The repository production preflight is read-only: it validates the ordered migration manifest, recorded checksums, critical schema objects, and tenant-integrity counts inside a `BEGIN READ ONLY` transaction that always ends with `ROLLBACK`.

The Netlify build does not apply migrations. Production credentials are not used by ordinary CI, deploy previews, branch deploys, or local `npm run build`. Migrations are the sole schema authority: normal authentication requests perform the read-only contract in `docs/runtime-database-role.md` and return `SCHEMA_NOT_READY` rather than repairing an incomplete schema.

The deployment preflight requires an exact repository/database history match. Runtime readiness permits additional forward-compatible migration rows while requiring every migration and authentication object expected by the running code. Production runtime credentials should be separate from migration-owner and optional read-only preflight credentials. The actual production runtime-role rollout remains **Needs verification**.

The gate proves repository behavior. It does not prove that external GitHub, Netlify, database, backup, or monitoring controls are configured.

## 2. Required external configuration

### GitHub

An authorized reviewer must verify:

- `main` is protected and direct pushes are blocked where policy requires.
- Required checks include `unit-and-build`, `integration-database`, and `android-debug-builds`.
- Force-push and protected-branch deletion are disabled.
- Required approving reviews and stale-review dismissal are configured.
- The `production` GitHub Environment protects the manual read-only preflight, if used.
- Access to production environment secrets and workflow approval is restricted.

### Netlify

An authorized reviewer must verify:

- The production branch is exactly `main`.
- The build command is obtained from `netlify.toml`.
- Production variables and secrets are scoped only to production.
- Deploy previews and branch deploys do not receive production database credentials.
- Deploy approvals or deploy locks are configured when the account plan provides them.
- Operators understand whether successful production builds publish automatically.
- Rollback/redeploy access is restricted and audited.

### External-control evidence checklist

Do not mark an item verified without retained evidence.

| Control | Date | Reviewer | Screenshot/export location | Observed setting | Result |
| --- | --- | --- | --- | --- | --- |
| GitHub `main` protection |  |  |  |  | Needs verification |
| GitHub required checks |  |  |  |  | Needs verification |
| GitHub review/force-push/deletion rules |  |  |  |  | Needs verification |
| GitHub production environment protection |  |  |  |  | Needs verification |
| Netlify production branch |  |  |  |  | Needs verification |
| Netlify production variable scoping |  |  |  |  | Needs verification |
| Netlify preview secret exclusion |  |  |  |  | Needs verification |
| Netlify approvals/locks/publishing policy |  |  |  |  | Needs verification |
| Netlify rollback access |  |  |  |  | Needs verification |

## 3. Required production variables

Record variable presence and scope, never values, in release evidence.

- `DATABASE_URL`: application/runtime production PostgreSQL connection.
- `PRODUCTION_DATABASE_FINGERPRINT`: SHA-256 of normalized database hostname, port, and database name; it excludes credentials and query parameters.
- `PRODUCTION_ENVIRONMENT_CONFIRMATION`: exact production-environment confirmation.
- `PRODUCTION_DATABASE_CONFIRMATION`: exact read-only-preflight confirmation.
- `PRODUCTION_APP_URL`: HTTPS public production application URL.
- Existing application runtime secrets, including ordinary, Platform Admin, account-lifecycle, invitation, email-dispatch, monitoring, storage, and mail credentials where enabled.

The production preflight fails on missing or incorrect confirmations, malformed/loopback/non-production database identities, fingerprint mismatch, non-HTTPS application URLs, and placeholder values. It never prints the database URL, username, password, or raw fingerprint. The shared [operator database identity contract](database-identity-contract.md) defines effective-name decoding, case-changing-name rejection, unsupported target overrides, and explicit in-memory port pinning.

## 4. Pre-deployment sequence

Perform these steps in order:

1. Record the exact candidate commit SHA.
2. Confirm all required CI jobs succeeded for that exact SHA.
3. Inspect the migration diff between the currently deployed SHA and candidate SHA.
4. Confirm every migration follows expand/contract compatibility with both old and candidate code.
5. Obtain and retain provider backup/snapshot evidence and identify the tested restore procedure.
6. Apply pending forward migrations through the separately approved operator/DBA process. The Netlify build must not perform this step.
7. Run `npm run production:preflight` from the approved production environment or dispatch the protected manual production-preflight workflow from `main`.
8. Confirm the preflight reports matching migration counts/checksums and clean tenant integrity.
9. Permit the production Netlify build; `npm run deploy:build` will repeat the read-only preflight before Vite.
10. Complete and record the post-deployment health verification below.

Stop before deployment if any evidence is absent, any required check is not successful for the exact SHA, migration compatibility is unclear, backup evidence is missing, or preflight is not successful.

## 5. Migration policy

- Production migrations are forward-only.
- Never edit a migration already applied to any shared environment.
- `database/MIGRATIONS.md` is the sole ordered production manifest.
- A checksum mismatch, unknown history row, missing history row, pending migration, missing critical schema object, or tenant-integrity issue blocks release.
- Code must remain compatible throughout an expand/contract rollout.
- Destructive contraction occurs only in a later release after old code is no longer running and retained data has an approved disposition.
- Do not use automatic down migrations as rollback.

### Schema predating `eduforge_migration_history`

The gate fails closed with `Production schema exists without verified migration history`. It never creates or automatically baselines the table.

An approved baseline requires a separate, reviewed DBA operation:

1. Take and retain a backup or provider snapshot.
2. Identify the exact deployed commit.
3. Inspect the live schema and every historical migration effect.
4. Calculate checksums from that exact repository manifest.
5. Verify each historical migration effect individually.
6. Create and populate migration history only through the approved DBA change.
7. Rerun the read-only production preflight.
8. Retain schema inspection, checksum, reviewer, and execution evidence.

Never mark all repository migrations as applied without verifying their effects.

## 6. Health verification

After deployment, an approved operator must verify:

- The public application shell loads.
- The Platform Admin shell loads without exposing privileged data.
- An unauthenticated protected endpoint returns its expected 401 or 403.
- Ordinary sign-in succeeds with a dedicated approved QA account.
- School Admin, Teacher, and Student shells each pass a role-appropriate smoke check.
- Database-backed dashboard values load and no demo fallback appears.
- A separate-school check confirms no cross-tenant access.
- Browser developer tools show no new console errors.
- Relevant Netlify function logs contain no new repeated failures.

Do not place production credentials, session cookies, personal data, tenant identifiers, or raw log payloads in the release record.

### PR-014 historical demo entitlement inventory

Repository tooling for the read-only Phase 1 inventory is documented in `docs/demo-entitlement-inventory.md`. Run `npm run production:inventory:demo-entitlements` only from an explicitly confirmed hosted production operator environment and retain aggregate evidence only.

The repository implementation does not prove the state of any target environment. Actual target-environment inventory remains **Needs verification**, PR-014 is not fully remediated, and any forward-only cleanup migration is deferred until the inventory evidence receives separate review.

## 7. Rollback decision

Stop before deployment when preflight or evidence fails; no rollback is then required.

A code-only rollback is safe only when the previous code remains compatible with every migration already applied. Identify the exact previous commit and immutable Netlify deploy before approval. If newly applied schema is incompatible with old code, keep data intact and prefer a reviewed roll-forward correction. Never automatically run down migrations.

The incident commander and designated application/database approvers decide rollback versus roll-forward. Preserve database data, current backups, logs, preflight output, deployment identifiers, and the compatibility analysis before action.

## 8. Incident and release evidence

Record:

- Candidate and previous commit SHA.
- Netlify deployment ID and immutable deploy reference.
- Migration manifest fingerprint.
- Expected and applied migration counts.
- Latest expected migration.
- Production-preflight result and timestamp.
- Backup/snapshot and restore-test references.
- Health-verification result.
- Rollback or roll-forward decision and rationale.
- Operator, application reviewer, database reviewer, and timestamps.

## 9. External evidence gaps

The following remain **Needs verification** until evidence is supplied:

- GitHub branch protection and required-check enforcement.
- Netlify production branch and build-source configuration.
- Netlify deploy approvals/locks and automatic publishing behavior.
- Production environment-variable and secret scoping.
- Backup availability and restore testing.
- Production monitoring destinations and alert ownership.

Repository-level PR-008 remediation does not close these external evidence gaps. PR-007 remains unresolved pending successful PR-008 gate adoption. PR-014 repository inventory tooling exists, but target-environment inventory remains **Needs verification** and PR-014 is not fully remediated.
