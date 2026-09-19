import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { verifyPortable, portableDiff, WORDLIST_LIMITS } from "../src/data/wordlists/portable.js";
import { readWordListZip, validateWordListFiles } from "../src/data/wordlists/archive.js";
import { lexicalFixture, rehashLexicon, wordListFiles, testZip } from "./fixtures/wordlists.js";
test("portable identities preserve duplicate occurrences, Unicode and audio paths independently of displayed numbers and provenance", async () => {
  const dataset = lexicalFixture(); await verifyPortable(dataset);
  assert.equal(dataset.entries[0].originalId, dataset.entries[1].originalId);
  assert.notEqual(dataset.entries[0].id, dataset.entries[1].id);
  assert.equal(dataset.entries[0].displayNumber, 91); assert.equal(dataset.entries[0].source.sound, "unit/1/word7");
  const other = structuredClone(dataset); other.provenance.edition = "international"; other.provenance.sourceSha256 = "f".repeat(64);
  await verifyPortable(other); assert.equal(other.datasetSha256, dataset.datasetSha256);
  assert.equal(portableDiff(dataset, other).unchanged, 2);
  other.entries.pop(); rehashLexicon(other); assert.equal(portableDiff(dataset, other).omitted, 1);
  other.entries[0].english.word = "<img src=x onerror=alert(1)>"; rehashLexicon(other); await assert.rejects(verifyPortable(other), /text_invalid/);
});
test("strict archives round-trip stored/deflated audio and reject traversal, case collisions, symlinks, malformed headers and bounded inflate overflow", async () => {
  for (const options of [{}, { method: 8, compress: deflateRawSync }]) {
    const entries = await readWordListZip(testZip(wordListFiles(), options));
    assert.equal((await validateWordListFiles(entries)).dataset.entries.length, 2);
  }
  for (const path of ["../wordlist.json", "C:/wordlist.json", "//host/file", "audio/X.mp3", "nested.zip", "run.exe"]) {
    await assert.rejects(readWordListZip(testZip(new Map([[path, Buffer.from("bad")]]))));
  }
  await assert.rejects(readWordListZip(testZip(wordListFiles(), { mode: 0o120777 })), /unsupported/);
  const collision = wordListFiles(); collision.set("WORDLIST.JSON", Buffer.from("bad")); await assert.rejects(readWordListZip(testZip(collision)));
  const malformed = testZip(wordListFiles()); malformed[14] ^= 1; await assert.rejects(readWordListZip(malformed), /inconsistent/);
  await assert.rejects(readWordListZip(testZip(new Map([["wordlist.json", Buffer.alloc(1024 * 1024)]]), { method: 8, compress: deflateRawSync, declaredSize: 8 })), /inflate_limit/);
  await assert.rejects(readWordListZip(testZip(wordListFiles(), { declaredSize: WORDLIST_LIMITS.json + 1 })), /bounds/);
});
test("missing and forged audio never become a valid complete package", async () => {
  const missing = wordListFiles(); missing.delete(lexicalFixture().audio[0].path);
  await assert.rejects(validateWordListFiles(missing), /audio_missing/);
  assert.equal((await validateWordListFiles(missing, { allowMissing: true })).missing.length, 1);
  const corrupt = wordListFiles(); corrupt.set(lexicalFixture().audio[0].path, Buffer.alloc(417));
  await assert.rejects(validateWordListFiles(corrupt), /audio_integrity/);
  const fake = Buffer.alloc(417); const sha256 = createHash("sha256").update(fake).digest("hex");
  const dataset = lexicalFixture(); dataset.audio[0] = { ...dataset.audio[0], sha256, path: `audio/${sha256}.mp3` };
  dataset.entries.forEach((entry) => { entry.audioPath = dataset.audio[0].path; }); rehashLexicon(dataset);
  await assert.rejects(validateWordListFiles(new Map([["wordlist.json", Buffer.from(JSON.stringify(dataset))], [dataset.audio[0].path, fake]])), /audio_invalid/);
});
