# Operator database identity contract

Staging preflight, production preflight (including the read-only entitlement inventory), and the lower-level staging/test collision guard use `scripts/_database-identity.mjs`. Their confirmations, production deny-set and singular production fingerprint policies remain separate.

The identity is `lowercase-host:port/effective-database`, hashed as UTF-8 with SHA-256. A PostgreSQL URL must specify one literal hostname/IP address and a nonempty database. The default port is 5432. Validated operator pool connections receive an explicit port in memory, including when the URL omits it; ambient `PGPORT` cannot redirect later pool clients. No environment variable is rewritten. Specify a nondefault port explicitly in the URL.

The effective database follows the installed `pg` driver's path decoding. `/course_data` and `/course%5Fdata` identify the same database. Unicode is preserved without Unicode normalization. Credentials and non-target query options, such as `sslmode`, `application_name` and `options`, do not enter the fingerprint.

An effective database name that changes under lowercase normalization is rejected **before hashing**: `Course_data` is not silently changed to `course_data`. This restriction applies after decoding, not to uppercase hexadecimal escape spelling. Conventional accepted targets retain their historical production fingerprints; there is no alternate algorithm or legacy hash allowlist.

Fail-closed forms include empty targets, malformed escapes, invalid UTF-8, NUL, raw whitespace/control characters, fragments, encoded hostnames, socket paths/host lists, multiple leading database slashes, and reserved database escapes such as `%2F` whose driver interpretation differs from the historical production recipe. Target query options (`host`, `hostaddr`, `port`, `database`, `dbname`, `db`, `connectionString`, `service`, `servicefile`, `replication`) are rejected, including encoded or differently cased keys. Constructor-dependent nested connection strings are unsupported. Errors never echo URL values or attach parser errors containing credentials.

The contract identifies the explicit host/port/database tuple, not DNS aliases or provider topology. Direct, pooled, replica and legacy host representations still require separate production inventory evidence and deny-set entries. An identity fingerprint does not establish that a database is production, staging, entitled or ready for migration. Empty-input hashing artifacts are invalid and receive no compatibility exception.

`tests/database-identity.test.js` uses independent expected tuples and the installed driver without opening sockets. It runs under ordinary `npm test`, including Node 22 CI. No schema, publication, migration or generated asset change is part of this contract.
