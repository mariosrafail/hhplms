import fs from "node:fs/promises";
import path from "node:path";
import { readWordListZip, validateWordListFiles } from "../../src/data/wordlists/archive.js";
import { inspectManagedMp3 } from "../../lib/book-assets/audio-inspection.js";
import { WORDLIST_LIMITS } from "../../src/data/wordlists/portable.js";
async function readBounded(file, maximum) {
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum) throw new Error("Word List file exceeds bounded size");
    const bytes = Buffer.alloc(stat.size + 1); let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null);
      if (!bytesRead) break; offset += bytesRead;
    }
    if (offset !== stat.size) throw new Error("Word List file changed while reading");
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}
const target = process.argv[2];
if (!target) throw new Error("Usage: node scripts/wordlists/validate.mjs <export-directory|wordlist.zip>");
let files;
if (target.endsWith(".zip")) files = await readWordListZip(await readBounded(target, WORDLIST_LIMITS.total + WORDLIST_LIMITS.json + 1024 * 1024));
else {
  const json = await readBounded(path.join(target, "wordlist.json"), WORDLIST_LIMITS.json);
  const data = JSON.parse(json);
  files = new Map([["wordlist.json", json]]);
  // Validate safe descriptors before using any imported paths.
  const { verifyPortable } = await import("../../src/data/wordlists/portable.js");
  await verifyPortable(data);
  for (const descriptor of data.audio) files.set(descriptor.path, await readBounded(path.join(target, descriptor.path), WORDLIST_LIMITS.file));
}
const { dataset } = await validateWordListFiles(files);
for (const audio of dataset.audio) inspectManagedMp3(files.get(audio.path));
console.log(JSON.stringify({ valid: true, datasetSha256: dataset.datasetSha256, entries: dataset.entries.length, audio: dataset.audio.length }));
