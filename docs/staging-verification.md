# Staging verification

This procedure is only for a manually provisioned, isolated PostgreSQL staging database. Never point these commands at production. In hosted staging, `DATABASE_URL` is the application runtime connection and `STAGING_DATABASE_URL` is the separately named operator target; canonical preflight requires them to identify the same host, port, and database. Take a provider snapshot or logical backup before the first migration. Restore that snapshot to roll back; the migration runner deliberately has no destructive rollback mode.

## Safe setup and automated verification

In a fresh operator environment, configure every hosted staging variable documented in `.env.example` without saving credentials in the repository. The essential identity contract includes:

```powershell
$env:STAGING_DATABASE_URL = "postgresql://USER:PASSWORD@STAGING_HOST/STAGING_DATABASE?sslmode=require"
$env:DATABASE_URL = $env:STAGING_DATABASE_URL
$env:STAGING_DATABASE_CONFIRMATION = "isolated-staging-database"
$env:STAGING_ENVIRONMENT_CONFIRMATION = "hosted-nonproduction-staging"
$env:STAGING_PRODUCTION_DATABASE_FINGERPRINTS = "SHA256_OF_PRIMARY_PRODUCTION_HOST_PORT_DATABASE,SHA256_OF_OTHER_PRODUCTION_HOST_PORT_DATABASE"
$env:STAGING_PRODUCTION_DATABASE_FINGERPRINTS_CONFIRMATION = "complete-production-database-identity-set"
$env:HHPLMS_STAGING_QA_PASSWORD = "password123"
$env:APP_PUBLIC_URL = "https://your-isolated-staging.example"
$env:STAGING_PRODUCTION_APP_URL = "https://production.example"
$env:ACCOUNT_EMAIL_MODE = "preview"
```

The runtime and staging URLs may use different credentials or query parameters, but their host, port, and database identity must match. `STAGING_PRODUCTION_DATABASE_FINGERPRINTS` is a comma-separated, provider-agnostic deny-set derived from current provider control-plane metadata: include the SHA-256 identity fingerprint for every plausible production connection identity, including direct, pooled, primary, replica, or legacy host/port/database variants. Refresh and re-confirm the complete set immediately before migration. The preflight rejects an absent, empty, malformed, duplicate, or unconfirmed set and rejects the staging identity if it matches any entry. Fingerprints are identity metadata rather than credentials, but the preflight reports only their count and never returns their values; connection strings remain secret. This staging-only deny-set does not replace production's singular `PRODUCTION_DATABASE_FINGERPRINT`, which must continue to exactly match the production runtime identity. The host or database name must visibly contain `staging`, `stage`, `qa`, `sandbox`, `preview`, or `test`; names containing `prod` or `production` are rejected. Connection strings and passwords are never printed.

The shared [operator database identity contract](database-identity-contract.md) defines decoding, lowercase-name rejection, unsupported target overrides, and explicit in-memory port pinning. Only non-target query differences are permitted.

Run the complete non-destructive sequence:

```powershell
npm ci
npm run staging:verify
```

This first runs canonical hosted staging preflight. It then runs `staging:migrate`, `staging:seed`, `staging:integrity`, and `staging:smoke` in order. Migration receives the complete hosted environment and re-runs preflight before opening its connection. Only after that succeeds does the wrapper omit `DATABASE_URL` from the lower-level maintenance subprocesses, preserving the generic collision guard without requiring an operator shell change. The canonical migration order comes only from `database/MIGRATIONS.md`; demo password migration `012` is excluded, `013` must be present, and later listed migrations are allowed. Filenames must be unique, every listed file must exist, and applied checksums are verified. The QA seed is idempotent and leaves its data available for UI checks.

The canonical migration pair is executable with the same unchanged hosted environment:

```powershell
npm run staging:preflight
npm run staging:migrate
```

Prefer `staging:verify` for the complete sequence. Direct seed, integrity, smoke, and cleanup commands remain lower-level target-only maintenance tools protected by `requireSafeDatabase`; they do not replace the hosted preflight or migration handoff.

For the optional production-oriented licensing and three-school isolation dataset, use the additional explicit guard and commands. This dataset is separate from the smaller canonical QA seed:

```powershell
$env:ALLOW_DEMO_SEED = "true"
$env:MULTI_SCHOOL_SEED_CONFIRMATION = "fictional-multi-school-development-data"
$env:MULTI_SCHOOL_DEMO_PASSWORD = "password123"
npm run staging:seed:multi-school
npm run staging:integrity
npm run staging:cleanup:multi-school
```

The generated account/class table and development codes are printed only during the seed run. Do not capture them in shared build logs, and never reuse them in production. See [`book-licensing.md`](book-licensing.md) for the lifecycle, visibility matrix, deterministic accounts, and hosted E2E variables.

The integrity command must report zero rows in `tenant_integrity_issues`, zero relationship inconsistencies, and all required constraints, foreign keys, and indexes present. It reports problems but never rewrites ambiguous ownership.

## Accounts and URLs

The seed creates School A and School B, each with one admin, two teachers, two students, one paused student, two classes, book access, official and custom content, assignments, submissions, and a hotspot. Emails are deterministic:

- `qa.a.admin@hhplms.invalid`, `qa.a.teacher1@hhplms.invalid`, `qa.a.teacher2@hhplms.invalid`, `qa.a.student1@hhplms.invalid`, `qa.a.student2@hhplms.invalid`
- the same pattern with `qa.b.*`
- paused accounts: `qa.a.paused@hhplms.invalid` and `qa.b.paused@hhplms.invalid`

All disposable fictional QA accounts use `password123`, supplied through `HHPLMS_STAGING_QA_PASSWORD`. The legacy environment-variable name remains a temporary compatibility alias, but conflicting values fail closed. Passwords are bcrypt-hashed before storage.

> **Disposable QA only:** never point this seed at production, never apply deterministic demo-password migrations to production, and never reuse `password123` for real users.

Start the UI and functions with the staging database supplied only to that process:

```powershell
$env:DATABASE_URL = $env:STAGING_DATABASE_URL
npm run dev:netlify
```

Open the URL printed by Netlify Dev (normally `http://localhost:8888`). Use the direct API base `http://localhost:8888/.netlify/functions`. Unset `DATABASE_URL` again after stopping the process.

## Manual UI and API checklist

Admin:

- Sign in as School A admin, confirm only School A users and metrics appear, create then pause/delete a temporary teacher and student.
- Try School B user UUIDs with direct `GET`, `PATCH`, and `DELETE /user?id=...`; expect non-disclosing `404` and unchanged rows.
- Try to pause or delete the final active admin; expect `409`.
- Inspect responses in DevTools and confirm there are no password hashes, session tokens, invite codes, or cross-school identifiers.
- Invite a disposable teacher and student, verify preview delivery, resend only while invited, and confirm admin invitation/session revocation is unavailable.

Account lifecycle:

- Accept one invitation and confirm the token is removed from the visible URL before interacting with the form.
- Request forgot-password for known, unknown, and paused QA addresses; public messages must be equivalent.
- Complete reset/change-password and verify old cookies fail while the fresh current session works.
- Force-revoke a same-school teacher/student, reject cross-school/admin targets, and inspect non-sensitive security events/outbox states.
- For SMTP verification, use only a dedicated non-production inbox and `ACCOUNT_EMAIL_MODE=smtp`; never use a real user address.

Teacher:

- Confirm teacher 1 sees only class 1 and cannot open teacher 2 or School B private class resources.
- Confirm official course/lesson editing is forbidden.
- Create/edit a custom activity or hotspot, then confirm teacher 2 and School B cannot modify it.
- Create an assignment for the owned class; confirm another class is rejected. Review an owned submission and confirm foreign assignment/submission IDs are rejected without state changes.

Student:

- Confirm the assigned QA book and assigned lesson appear; an unassigned same-school lesson and every School B lesson must remain unavailable.
- Submit assigned work and confirm it is stored under the signed-in student. Supplying another `student_id` must return `403` and create no row.
- Join with `QASCHA01` (or `QASCHB01` for School B). A slug or UUID must not work. Public invite lookup must not reveal UUID, slug, invite code, student count, or school ID.
- Confirm another student's submissions cannot be read or overwritten.

Tenant tampering and throttling:

- Repeat key requests after replacing school, user, class, assignment, submission, activity, lesson, and package IDs with School B values. Expect `403` or non-disclosing `404`; compare the database row before and after every mutation.
- Send 20 invalid, valid-shaped invite codes from one client IP; the next request must return `429` with `Retry-After`. After the 15-minute window, expired attempts must no longer count.
- Confirm success and failure payloads do not reveal whether another school exists.

Direct API example:

```powershell
curl.exe -i "http://localhost:8888/.netlify/functions/book-content?action=class-by-invite&inviteCode=QASCHA01"
```

Use the browser's authenticated request copy feature for protected API checks so its session cookie is included. Preserve redacted screenshots, response status/body, and before/after SQL counts as evidence; never preserve cookies or connection strings.

## Cleanup and confirmation

After manual verification:

```powershell
npm run staging:cleanup
npm run staging:integrity
```

If the optional multi-school seed was also applied, run `npm run staging:cleanup:multi-school` before the final integrity check.

Cleanup requires the same explicit staging confirmation, validates the complete registry, and deletes only deterministic QA roots and known smoke-test fingerprints. It refuses an unknown, partial, or mismatched registry, is safe to run repeatedly after a successful cleanup, verifies QA sessions are gone, and confirms migration history is unchanged. Keep migration history; do not drop staging data manually.

## Sign-off

| Area | Test owner | Result | Blocker | Evidence | Date |
| --- | --- | --- | --- | --- | --- |
| Migrations and integrity |  |  |  |  |  |
| Authentication and admin |  |  |  |  |  |
| Teacher authorization |  |  |  |  |  |
| Student authorization |  |  |  |  |  |
| Cross-school tampering |  |  |  |  |  |
| Invites and throttling |  |  |  |  |  |
| Cleanup |  |  |  |  |  |

## Hosted staging operations sign-off

Run `npm run staging:preflight` before migrations. A hosted target must use HTTPS, a visibly non-production hostname, its own database/secrets, and either gated preview mode or a dedicated staging SMTP inbox. After deploy, verify `operational-health` publicly and with the private monitoring header, then use Netlify **Run now** once for both scheduled functions. Scheduled functions run only on published deploys and use UTC schedules.

Hosted browser QA uses `npm run test:e2e:staging` with runtime-only `E2E_*` values. Screenshots and traces are retained only on failure and must be reviewed for tokens before sharing. Invitation/reset journeys that require inbox access remain manual when no provider-neutral mailbox API is configured.

Leave every item unchecked until it is actually executed:

- [ ] Chrome desktop and mobile-width
- [ ] Edge desktop
- [ ] Firefox desktop
- [ ] Safari/WebKit where accessible
- [ ] Admin, teacher, and student sign-in
- [ ] Teacher/student invitation, resend, and delivery state
- [ ] Acceptance URL sanitization, weak/mismatch rejection, activation, and replay failure
- [ ] Known/unknown forgot-password equivalence and reset-email rendering
- [ ] Reset invalidates old session and creates a working new session
- [ ] Password change for all roles and explicit logout
- [ ] Self session rotation preserves the current session
- [ ] Paused user and expired/used tokens fail safely
- [ ] School A cannot read or mutate School B
- [ ] Dispatcher, cleanup, health, and operational history
- [ ] Final tenant integrity and QA cleanup

| Area | Environment | Tester | Result | Evidence | Blocker | Date |
|---|---|---|---|---|---|---|
| Hosted deployment | Pending | — | Not run | — | Netlify staging access required | — |
| Dedicated SMTP | Pending | — | Not run | — | SMTP inbox and sender DNS required | — |
| Browser matrix | Pending | — | Not run | — | Hosted URL and QA credentials required | — |
| Scheduler/health | Pending | — | Not run | — | Published Netlify deploy required | — |
| WAF rules | Pending | — | Not configured | — | Netlify security access required | — |
