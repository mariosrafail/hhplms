import { createHash } from "node:crypto";
import { inspectRasterBytes } from "./raster-inspection.js";

export async function verifyImageBytes(bytes, { sha256, byteSize, mediaType, width, height }) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== byteSize || createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("image_content_identity_mismatch");
  const png = bytes.length >= 24 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP";
  if (!(mediaType === "image/png" && png || mediaType === "image/jpeg" && jpeg || mediaType === "image/webp" && webp)) throw new Error("image_media_identity_mismatch");
  const raster = await inspectRasterBytes(bytes, { allowedFormats: ["png", "jpeg", "webp"], maximumBytes: 40 * 1024 * 1024, maximumDimension: 8192, maximumPixels: 8192 ** 2 });
  if (raster.mimeType !== mediaType || raster.width !== width || raster.height !== height) throw new Error("image_dimensions_identity_mismatch");
  return bytes;
}

export async function readBoundedImageResponse(response, expected) {
  if (response?.status !== 200 || response.redirected || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== expected.mediaType
    || !Number.isSafeInteger(expected.byteSize) || expected.byteSize < 1 || expected.byteSize > 40 * 1024 * 1024) {
    await response?.body?.cancel(); throw new Error("image_response_invalid");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("image_response_invalid");
  const bytes = new Uint8Array(expected.byteSize); let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      if (size + value.length > bytes.length) { await reader.cancel(); throw new Error("image_size_invalid"); }
      bytes.set(value, size); size += value.length;
    }
  } finally { reader.releaseLock(); }
  if (size !== bytes.length) throw new Error("image_size_invalid");
  return verifyImageBytes(bytes, expected);
}
