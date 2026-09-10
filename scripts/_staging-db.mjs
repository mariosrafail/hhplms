import pg from "pg";
import { parseDatabaseTarget } from "./_database-identity.mjs";
export {
  loadProductionMigrationFiles,
  loadProductionMigrationManifest,
  migrationChecksumMatches,
  migrationChecksums,
  parseProductionMigrationManifest,
  sha256,
} from "./_migration-readiness.mjs";

const { Pool } = pg;

const confirmations = {
  staging: ["STAGING_DATABASE_URL", "STAGING_DATABASE_CONFIRMATION", "isolated-staging-database"],
  test: ["TEST_DATABASE_URL", "TEST_DATABASE_CONFIRMATION", "isolated-test-database"],
};

export function requireSafeDatabase(kind = "staging", environment = process.env) {
  const definition = confirmations[kind];
  if (!definition) throw new Error(`Unsupported database safety mode: ${kind}`);
  const [urlName, confirmationName, expectedConfirmation] = definition;
  const rawUrl = environment[urlName];
  if (!rawUrl) throw new Error(`${urlName} is required`);
  if (environment[confirmationName] !== expectedConfirmation) {
    throw new Error(`${confirmationName} must equal ${expectedConfirmation}`);
  }

  const target = parseDatabaseTarget(rawUrl);
  const runtimeRaw = environment.DATABASE_URL;
  if (runtimeRaw) {
    const runtimeTarget = parseDatabaseTarget(runtimeRaw);
    if (runtimeTarget.identity === target.identity) {
      throw new Error(`${urlName} identifies the same database as DATABASE_URL`);
    }
  }

  const productionSignal = `${target.host}/${target.database}`;
  if (/(^|[._/-])(prod|production)([._/-]|$)/.test(productionSignal)) {
    throw new Error(`${urlName} appears to identify a production database`);
  }
  const isolationMarkers = kind === "staging" ? /(staging|stage|qa|sandbox|preview|test)/ : /(test|testing|ci|sandbox)/;
  if (!isolationMarkers.test(productionSignal)) {
    throw new Error(`${urlName} host or database name must visibly identify an isolated ${kind} target`);
  }

  return {
    connectionString: target.connectionString,
    safeLabel: `${target.host}/${target.database}`,
    kind,
  };
}

export function createSafePool(kind = "staging", environment = process.env) {
  const target = requireSafeDatabase(kind, environment);
  return { ...target, pool: new Pool({ connectionString: target.connectionString }) };
}

export async function withAdvisoryLock(client, lockName, callback) {
  await client.query("select pg_advisory_lock(hashtext($1))", [lockName]);
  try {
    return await callback();
  } finally {
    await client.query("select pg_advisory_unlock(hashtext($1))", [lockName]);
  }
}

export function postgresTemplate(pool) {
  const queryTemplate = (queryable) => async (strings, ...values) => {
    let text = strings[0];
    for (let index = 0; index < values.length; index += 1) text += `$${index + 1}${strings[index + 1]}`;
    return (await queryable.query(text, values)).rows;
  };
  const template = queryTemplate(pool);
  template.authLoginTransaction = async (lockValues, callback) => {
    const client = await pool.connect();
    const transactionSql = queryTemplate(client);
    try {
      await client.query("begin");
      await transactionSql`
        select pg_advisory_xact_lock(lock_key)
        from (
          select distinct hashtextextended(value, 0) as lock_key
          from unnest(${lockValues}::text[]) value
        ) locks
        order by lock_key
      `;
      const result = await callback(transactionSql);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };
  template.assignmentLifecycleTransaction = async (assignmentId, callback) => {
    const client = await pool.connect();
    const transactionSql = queryTemplate(client);
    try {
      await client.query("begin");
      await transactionSql`select pg_advisory_xact_lock(hashtextextended(${"activity-assignment:" + assignmentId}, 0))`;
      const result = await callback(transactionSql);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };
  return template;
}

export function parseHandlerResponse(response) {
  return {
    status: response.statusCode,
    headers: response.headers || {},
    body: JSON.parse(response.body || "{}"),
  };
}

export async function callHandler(handler, { method = "GET", query = {}, body = {}, cookie = "", ip = "127.0.0.50" } = {}) {
  const rawQuery = new URLSearchParams(query).toString();
  return parseHandlerResponse(await handler({
    httpMethod: method,
    headers: { host: "staging.local", cookie, "x-nf-client-connection-ip": ip },
    queryStringParameters: query,
    rawQuery,
    body: method === "GET" ? "" : JSON.stringify(body),
  }));
}
