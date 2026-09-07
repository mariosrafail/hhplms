import { loadProductionMigrationManifest, migrationChecksumMatches, withAdvisoryLock } from "./_staging-db.mjs";
import { openVerifiedStagingMigrationPool } from "./_staging-preflight.mjs";
import { applyProductionMigration } from "./_migration-transaction.mjs";

const { pool, safeLabel } = await openVerifiedStagingMigrationPool();
const client = await pool.connect();

try {
  console.log(`Verified isolated staging target: ${safeLabel}`);
  await withAdvisoryLock(client, "eduforge:staging:migrations", async () => {
    const schemaExists = (await client.query("select to_regclass('public.schools') is not null as exists")).rows[0].exists;
    const historyExists = (await client.query("select to_regclass('public.eduforge_migration_history') is not null as exists")).rows[0].exists;
    if (schemaExists && !historyExists) {
      throw new Error("Existing LMS schema has no migration history; refusing to reapply migrations blindly");
    }

    await client.query(`
      create table if not exists eduforge_migration_history (
        filename text primary key,
        checksum_sha256 text not null,
        applied_at timestamptz not null default now()
      )
    `);

    const migrations = await loadProductionMigrationManifest();
    const appliedRows = await client.query("select filename, checksum_sha256 from eduforge_migration_history");
    const applied = new Map(appliedRows.rows.map((row) => [row.filename, row.checksum_sha256]));

    for (const migration of migrations) {
      if (applied.has(migration.filename)) {
        if (!migrationChecksumMatches(migration, applied.get(migration.filename))) {
          throw new Error(`Checksum mismatch for previously applied migration ${migration.filename}`);
        }
        console.log(`Verified ${migration.filename}`);
        continue;
      }

      await applyProductionMigration(client, migration);
      console.log(`Applied ${migration.filename}`);
    }
  });
  console.log("Staging migrations verified successfully.");
} finally {
  client.release();
  await pool.end();
}
