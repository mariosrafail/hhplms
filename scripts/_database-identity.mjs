import { createHash } from "node:crypto";

const targetOptions = new Set([
  "host", "hostaddr", "port", "database", "dbname", "db", "connectionstring",
  "service", "servicefile", "replication",
]);

function invalidTarget(reason) {
  const error = new Error(`Database target ${reason}`);
  error.operatorSafe = true;
  return error;
}

// Operator scripts only. This deliberately supports the intersection of the
// historical production identity and pg's effective target, not every pg URL.
export function parseDatabaseTarget(value) {
  let url;
  try {
    if (typeof value !== "string" || !value || /[\s\u0000-\u001f\u007f]/u.test(value) || !value.isWellFormed()) {
      throw new Error();
    }
    // Validate escapes before URLSearchParams can replace invalid UTF-8. Do not
    // use this decoded string as the URL or decode the database a second time.
    if (decodeURIComponent(value).includes("\0")) throw new Error();
    url = new URL(value);
  } catch {
    throw invalidTarget("must be a valid URL with valid UTF-8 escapes and no whitespace or NUL");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw invalidTarget("uses an unsupported protocol; use postgres:// or postgresql://");
  }
  if (!url.hostname || !url.pathname || url.pathname === "/") {
    throw invalidTarget("must identify a host and database");
  }
  if (url.hash || value.includes("#") || url.pathname.startsWith("//")) {
    throw invalidTarget("contains an ambiguous fragment or leading database slash");
  }
  // pg decodes encoded hostnames; the historical helper did not. Socket paths
  // and host lists are outside this single-host identity contract as well.
  const host = url.hostname.toLowerCase();
  if (!/^(?:[a-z0-9_][a-z0-9_.-]*|\[[a-f0-9:.]+\])$/i.test(host)) {
    throw invalidTarget("must use a literal single hostname or IP address");
  }
  for (const key of url.searchParams.keys()) {
    if (targetOptions.has(key.toLowerCase())) {
      throw invalidTarget("must not contain database-target query overrides");
    }
  }
  const port = Number(url.port || "5432");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw invalidTarget("must identify a valid TCP port");
  }
  const pathname = url.pathname.slice(1);
  const database = decodeURI(pathname);
  if (database !== decodeURIComponent(pathname)) {
    throw invalidTarget("contains reserved database escapes with divergent driver semantics");
  }
  // PostgreSQL preserves database-name case. Reject collisions; never transform
  // the effective database name just to match the historical lowercase hash.
  if (database !== database.toLowerCase()) {
    throw invalidTarget("effective database name must not change under lowercase normalization");
  }
  const identity = `${host}:${port}/${database}`;
  // pg otherwise consults ambient PGPORT, including when a Pool opens a later
  // client. Pin the validated target in memory without changing operator env.
  url.hostname = host;
  url.port = String(port);
  return Object.freeze({ host, port, database, identity, connectionString: url.href });
}

export function databaseIdentity(value) {
  return parseDatabaseTarget(value).identity;
}

export function databaseFingerprint(value) {
  return createHash("sha256").update(databaseIdentity(value)).digest("hex");
}
