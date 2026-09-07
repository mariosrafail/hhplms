import { migrationChecksumMatches } from "./_migration-readiness.mjs";

// Call with a checked-out client, never a Pool: every statement must use the
// same PostgreSQL transaction. New migrations must not commit this transaction.
export async function applyProductionMigration(client, migration) {
  await client.query("begin");
  try {
    const existing = await client.query("select checksum_sha256 from eduforge_migration_history where filename=$1", [migration.filename]);
    if (existing.rows[0]) {
      if (!migrationChecksumMatches(migration, existing.rows[0].checksum_sha256)) throw new Error(`Checksum mismatch for previously applied migration ${migration.filename}`);
      await client.query("commit");
      return "verified";
    }
    await client.query(migration.sql);
    await client.query("insert into eduforge_migration_history(filename,checksum_sha256) values($1,$2)", [migration.filename, migration.checksum]);
    await client.query("commit");
    return "applied";
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}
