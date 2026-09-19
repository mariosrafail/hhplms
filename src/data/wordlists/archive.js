import { WORDLIST_LIMITS as limits, reject, safeAudioPath, verifyPortable, wordListHash } from "./portable.js";
import { firstMpegFrameOffset } from "../../../lib/book-assets/mp3-frames.js";

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
async function inflateBounded(bytes, maximum) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > maximum) { await reader.cancel(); reject("wordlist_zip_inflate_limit"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
// Deliberately strict ZIP subset: no encryption, ZIP64, descriptors, comments,
// extra fields, directories or trailing data. Stored and bounded raw DEFLATE.
export async function readWordListZip(input) {
  const bytes = new Uint8Array(input);
  if (bytes.length < 22 || bytes.length > limits.total + limits.json + 1024 * 1024) reject("wordlist_zip_size");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset) => view.getUint16(offset, true); const u32 = (offset) => view.getUint32(offset, true);
  const end = bytes.length - 22;
  if (u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 20)
    || u16(end + 8) !== u16(end + 10)) reject("wordlist_zip_header");
  const count = u16(end + 10); const start = u32(end + 16);
  if (!count || count > limits.files + 1 || start + u32(end + 12) !== end) reject("wordlist_zip_directory");
  const decoder = new TextDecoder("utf-8", { fatal: true }); const entries = new Map();
  let cursor = start; let nextLocal = 0; let total = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50) reject("wordlist_zip_entry");
    const flags = u16(cursor + 8); const method = u16(cursor + 10); const crc = u32(cursor + 16);
    const packed = u32(cursor + 20); const size = u32(cursor + 24); const nameLength = u16(cursor + 28);
    const local = u32(cursor + 42); const mode = u32(cursor + 38) >>> 16;
    if (flags & ~0x800 || ![0, 8].includes(method) || u16(cursor + 30) || u16(cursor + 32) || u16(cursor + 34)
      || u32(cursor + 38) & 0x10 || (mode & 0xf000) && (mode & 0xf000) !== 0x8000 || cursor + 46 + nameLength > end) reject("wordlist_zip_unsupported_entry");
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength); const name = decoder.decode(nameBytes);
    if (name !== "wordlist.json") safeAudioPath(name);
    if (entries.has(name.toLowerCase())) reject("wordlist_zip_collision");
    const maximum = name === "wordlist.json" ? limits.json : limits.file;
    total += size;
    if (!size || size > maximum || total > limits.total + limits.json || packed > maximum || local !== nextLocal
      || local + 30 + nameLength > start || u32(local) !== 0x04034b50) reject("wordlist_zip_bounds");
    if (u16(local + 6) !== flags || u16(local + 8) !== method || u32(local + 14) !== crc
      || u32(local + 18) !== packed || u32(local + 22) !== size || u16(local + 26) !== nameLength || u16(local + 28)
      || decoder.decode(bytes.subarray(local + 30, local + 30 + nameLength)) !== name) reject("wordlist_zip_inconsistent_header");
    const dataStart = local + 30 + nameLength; nextLocal = dataStart + packed;
    if (nextLocal > start) reject("wordlist_zip_bounds");
    const compressed = bytes.subarray(dataStart, nextLocal);
    const data = method === 0 ? compressed : await inflateBounded(compressed, size);
    if (data.length !== size || crc32(data) !== crc) reject("wordlist_zip_integrity");
    entries.set(name, data); cursor += 46 + nameLength;
  }
  if (cursor !== end || nextLocal !== start || !entries.has("wordlist.json")) reject("wordlist_zip_directory");
  return entries;
}
export async function validateWordListFiles(entries, { allowMissing = false } = {}) {
  const raw = entries.get("wordlist.json");
  if (!raw || raw.length > limits.json) reject("wordlist_json_limit");
  const dataset = await verifyPortable(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
  const wanted = new Set(["wordlist.json", ...dataset.audio.map((audio) => audio.path)]);
  for (const path of entries.keys()) if (!wanted.has(path)) reject("wordlist_unrequested_file");
  const missing = [];
  for (const audio of dataset.audio) {
    const data = entries.get(audio.path);
    if (!data) { missing.push(audio.path); continue; }
    if (data.length !== audio.byteSize || await wordListHash(data) !== audio.sha256) reject("wordlist_audio_integrity");
    if (firstMpegFrameOffset(data) < 0) reject("wordlist_audio_invalid");
  }
  if (missing.length && !allowMissing) reject("wordlist_audio_missing");
  return { dataset, missing };
}
