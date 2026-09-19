import { createHash } from "node:crypto";
import { datasetIdentity, stableJson } from "../../src/data/wordlists/portable.js";
export const wordListMp3 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0]), Buffer.alloc(413)]);
export const wordListSha = createHash("sha256").update(wordListMp3).digest("hex");
export function lexicalFixture() {
  const audioPath = `audio/${wordListSha}.mp3`;
  const entry = { id: "entry-000001", order: 0, originalId: 1094, displayNumber: 91,
    english: { word: "sample", partOfSpeech: "n", pronunciation: "ˈsɑːmpəl", definition: "English-only definition", example: "An English example." },
    translations: { el: "ΕΛΛΗΝΙΚΟ_SENTINEL" },
    source: { unit: "unit1", part: 1, unitPrefix: 1, belong: "unit1_1,work1_1,companion1_1", sound: "unit/1/word7", image: "" },
    memberships: [{ group: "unit1_1", component: "students-book" }, { group: "work1_1", component: "workbook" }, { group: "companion1_1", component: "unsupported" }], audioPath };
  const dataset = { schemaVersion: "portable-wordlist.v1", datasetKey: "publisher-wordlist", bookSlug: "ultimate-b2", languages: ["en", "el"],
    entries: [entry, { ...structuredClone(entry), id: "entry-000002", order: 1, displayNumber: 92 }],
    audio: [{ path: audioPath, sha256: wordListSha, byteSize: wordListMp3.length, mediaType: "audio/mpeg" }],
    provenance: { format: "swf-wordlist-json", edition: "greek", sourceSha256: "a".repeat(64), rawJsonSha256: "b".repeat(64) } };
  return rehashLexicon(dataset);
}
export function rehashLexicon(dataset) {
  dataset.datasetSha256 = createHash("sha256").update(stableJson(datasetIdentity(dataset))).digest("hex"); return dataset;
}
export function wordListFiles(dataset = lexicalFixture()) { return new Map([["wordlist.json", Buffer.from(JSON.stringify(dataset))], [dataset.audio[0].path, wordListMp3]]); }
export function testZip(entries, { mode = 0o100644, method = 0, compress = (bytes) => bytes, declaredSize } = {}) {
  const locals = []; const central = []; let offset = 0;
  const crc = (bytes) => { let c = 0xffffffff; for (const byte of bytes) { c ^= byte; for (let n = 0; n < 8; n++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; };
  for (const [name, bytes] of entries) {
    const n = Buffer.from(name); const compressed = compress(bytes); const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(method, 8); local.writeUInt32LE(crc(bytes), 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(declaredSize ?? bytes.length, 22); local.writeUInt16LE(n.length, 26);
    locals.push(local, n, compressed);
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(method, 10); dir.writeUInt32LE(crc(bytes), 16);
    dir.writeUInt32LE(compressed.length, 20); dir.writeUInt32LE(declaredSize ?? bytes.length, 24); dir.writeUInt16LE(n.length, 28);
    dir.writeUInt32LE((mode << 16) >>> 0, 38); dir.writeUInt32LE(offset, 42); central.push(dir, n); offset += local.length + n.length + compressed.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
