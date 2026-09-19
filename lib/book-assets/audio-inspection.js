import { createHash } from "node:crypto";
import { firstMpegFrameOffset } from "./mp3-frames.js";

export const MANAGED_MP3_MAXIMUM_BYTES = 50 * 1024 * 1024;

export function inspectManagedMp3(input) {
  const bytes = Buffer.from(input || []);
  if (!bytes.length) throw Object.assign(new Error("empty_audio"), { code: "empty_audio" });
  if (bytes.length > MANAGED_MP3_MAXIMUM_BYTES) throw Object.assign(new Error("audio_file_too_large"), { code: "audio_file_too_large" });
  if (firstMpegFrameOffset(bytes) < 0) throw Object.assign(new Error("invalid_audio"), { code: "invalid_audio" });
  return {
    bytes,
    mimeType: "audio/mpeg",
    extension: ".mp3",
    byteSize: bytes.length,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    width: null,
    height: null,
  };
}
