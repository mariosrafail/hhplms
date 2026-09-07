import { loadProductionMigrationManifest } from "../../scripts/_migration-readiness.mjs";
import { applyProductionMigration } from "../../scripts/_migration-transaction.mjs";

export async function applyCanonicalProductionMigrations(pool, { through = null } = {}) {
  const manifest = await loadProductionMigrationManifest();
  if (through && !manifest.some((migration) => migration.filename === through)) throw new Error(`Unknown baseline migration: ${through}`);
  const migrations = through ? manifest.slice(0, manifest.findIndex((migration) => migration.filename === through) + 1) : manifest;
  const client = await pool.connect();
  try {
    await client.query(`
      create table if not exists eduforge_migration_history(
        filename text primary key,
        checksum_sha256 text not null,
        applied_at timestamptz not null default now()
      )
    `);
    for (const migration of migrations) {
      await applyProductionMigration(client, migration);
    }
  } finally { client.release(); }
  return migrations;
}
