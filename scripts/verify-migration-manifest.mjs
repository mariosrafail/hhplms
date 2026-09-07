import {
  loadProductionMigrationManifest,
  migrationManifestSummary,
} from "./_migration-readiness.mjs";
import { readFile } from "node:fs/promises";
import { verifyStudentsBookPageExpansion } from "./generate-students-book-page-expansion.mjs";
import { verifyStudentsBookPublicationV3 } from "./generate-students-book-publication-v3.mjs";
import {
  expectedRuntimeSchemaContractSource,
  runtimeSchemaContractUrl,
} from "./generate-runtime-schema-contract.mjs";

try {
  await verifyStudentsBookPageExpansion();
  await verifyStudentsBookPublicationV3();
  const migrations = await loadProductionMigrationManifest();
  const result = migrationManifestSummary(migrations);
  const [committedContract, expectedContract] = await Promise.all([
    readFile(runtimeSchemaContractUrl, "utf8"),
    expectedRuntimeSchemaContractSource(),
  ]);
  if (committedContract.replace(/\r\n/g, "\n") !== expectedContract) {
    throw new Error(
      "Runtime schema contract is stale; run npm run generate:runtime-schema-contract and commit the result",
    );
  }
  console.log(
    `Migration manifest and runtime contract verified: ${result.migrationCount} migrations; latest ${result.latestMigration}; fingerprint ${result.manifestFingerprint}.`,
  );
} catch (error) {
  console.error(`Migration manifest verification failed: ${error.message}`);
  process.exitCode = 1;
}
