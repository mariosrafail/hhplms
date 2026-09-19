import { WordListR2Storage, readWordListAudio } from "../../lib/book-assets/wordlist-storage.js";
import { inspectManagedMp3 } from "../../lib/book-assets/audio-inspection.js";
export default { async fetch(request, env) {
  const input = await request.json(); const storage = new WordListR2Storage({ binding: env.RELEASE_SOURCE_ASSETS, privateBucket: "isolated-wordlists" });
  try {
    if (input.bytes) {
      const inspected = inspectManagedMp3(Buffer.from(input.bytes, "base64"));
      if (inspected.checksumSha256 !== input.binding.sha256 || inspected.byteSize !== input.binding.byteSize) throw new Error("identity mismatch");
      await storage.upload({ profile: "private", objectKey: input.binding.objectKey, body: inspected.bytes, contentType: inspected.mimeType, checksumSha256: inspected.checksumSha256, byteSize: inspected.byteSize });
    }
    const bytes = await readWordListAudio(storage, { bindings: [input.binding] }, input.binding.sha256);
    return Response.json({ byteSize: bytes.length });
  } catch (error) { return Response.json({ error: error.message }, { status: 409 }); }
} };
