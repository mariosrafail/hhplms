# Historical demo entitlement inventory

## Purpose and boundary

Migration `023_demo_teacher_ultimate_b2_access.sql` conditionally granted Ultimate B2 access to two exact historical demo identities. It is part of the immutable production migration history and must remain unchanged. Its canonical normalized SHA-256 checksum is:

`1937108fffcdd5d0ad4a74ff1c61350ce3ff92787275b001dec876fa49153b5c`

The repository migration tooling also accepts the historical CRLF byte representation checksum `dabfe197e9e7970f6882f5194992bc75e7fe3fef4655b4c2cf8491837b42a8be`. Compatibility is derived by `migrationChecksums` and `migrationChecksumMatches`; it is not permission to edit the migration or its recorded history.

PR-014 Phase 1 adds read-only evidence gathering only. It does not remove identities, revoke access, repair data, apply migrations, or complete PR-014 remediation.

## Required production environment

Run only from an approved operator environment containing:

- `DATABASE_URL`: hosted production PostgreSQL connection.
- `PRODUCTION_DATABASE_FINGERPRINT`: SHA-256 of the production database identity under the shared [operator database identity contract](database-identity-contract.md).
- `PRODUCTION_ENVIRONMENT_CONFIRMATION=hosted-production`.
- `PRODUCTION_DATABASE_CONFIRMATION=read-only-production-preflight`.
- `PRODUCTION_APP_URL`: HTTPS production application URL.
- `PRODUCTION_DEMO_ENTITLEMENT_INVENTORY_CONFIRMATION=read-only-demo-entitlement-inventory`.

Then run:

```text
npm run production:inventory:demo-entitlements
```

The command rejects missing, malformed, loopback, staging/test/preview/QA-looking, placeholder, or fingerprint-mismatched targets. It verifies the complete repository migration manifest and exact database history, including one compatible migration 023 row, before reading entitlement aggregates.

The database work occurs inside `BEGIN READ ONLY` with bounded statement, lock, and idle-in-transaction timeouts. It always attempts `ROLLBACK`, releases the client, and closes the pool. It performs no data or schema mutation.

## Aggregate output and retained evidence

Output contains only:

- `migration023Verified`.
- `historicalSchoolCount`.
- `historicalIdentityCount`.
- `matchingEntitlementCount`.
- `classification`.
- `databaseFingerprintPrefix`.
- `manifestFingerprint`.

Valid classifications are:

- `historical-identities-absent`.
- `historical-identities-present-without-matching-entitlements`.
- `matching-migration-023-entitlements-present`.
- `partial-or-internally-inconsistent`.

Retain only the candidate SHA, UTC timestamp, operator, database fingerprint prefix, manifest fingerprint, classification, and aggregate counts. Never paste database URLs, credentials, raw fingerprints, account emails, school names, internal IDs, query parameters, tokens, sessions, SQL rows, or full command environments into tickets, chat, screenshots, or commit messages.

## Decision boundary

- If no matching entitlement rows exist, retain the aggregate evidence and reassess whether a forward cleanup is necessary.
- If matching rows exist, review the evidence and create a separate, forward-only cleanup migration in a later atomic task.
- If the result is partial or inconsistent, stop and obtain reviewed database analysis; do not infer or repair state from this command.

Never edit migration 023, remove it from historical migration history, manually change its recorded checksum, run ad-hoc `DELETE` statements, or use `012_demo_login_passwords.sql` as a production cleanup mechanism.
