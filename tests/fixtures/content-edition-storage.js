import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { editionPageBytes } from "./content-editions.js";
import { resolvePublicationCompiler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { componentPublicationAssetStorageTarget } from "../../lib/book-assets/publication-asset-storage.js";

// In-memory, task-owned storage with real synthetic page bytes and only tracked
// canonical files. Neither production credentials nor external fetches exist.
export async function contentEditionStorage(records, staticRoot) {
  const objects = new Map(); let uploads = 0;
  for (const record of records) {
    for (const row of record.source.inputs.pages.rows) objects.set(row.object_key, editionPageBytes(record.reference.scope.editionIds.length === 1 ? record.reference.scope.editionIds[0] : "shared"));
    const compiled = resolvePublicationCompiler(record.content.compilerId).compile(structuredClone(record.source.inputs));
    for (const source of compiled.canonicalAssetSources || []) {
      const target = componentPublicationAssetStorageTarget({ ...record.reference, ...source.descriptor });
      objects.set(target.objectKey, await readFile(path.join(staticRoot, source.path)));
    }
  }
  return {
    bucket: (profile) => { if (profile !== "private") throw new Error("Fixture private storage only"); return "isolated-editions-fixture"; },
    async head({ objectKey }) {
      const bytes = objects.get(objectKey); if (!bytes) throw new Error("Fixture object missing");
      return { checksumSha256: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.length, contentType: "image/png" };
    },
    async download({ objectKey }) { const bytes = objects.get(objectKey); if (!bytes) throw new Error("Fixture object missing"); return bytes; },
    async upload({ objectKey, body }) {
      const previous = objects.get(objectKey);
      if (previous && !Buffer.from(previous).equals(Buffer.from(body))) throw new Error("Fixture immutable collision");
      objects.set(objectKey, Buffer.from(body)); uploads++;
    },
    get uploads() { return uploads; },
  };
}
