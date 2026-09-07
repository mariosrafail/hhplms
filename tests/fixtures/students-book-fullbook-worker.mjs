// Test-only entry point. Never imported by either production Worker.
import { materializeCanonicalReleaseAssets, canonicalPublicationAssetFetcher } from "../../netlify-sites/ultimate-b2-builder/server/_builder-canonical-release-assets.js";
import { CloudflareR2ReleaseStorage } from "../../lib/book-assets/cloudflare-r2-release-storage.js";

export default {
  async fetch(request, env) {
    const { input, delayMs = 0, failAt = 0, namespace = "" } = await request.json();
    const counts = { assetsFetch: 0, put: 0, head: 0, get: 0, readbackBytes: 0, putBytes: 0, maxConcurrentAssets: 0 };
    const delay = async () => { if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs)); };
    let active = 0;
    if (!/^[a-z0-9-]*$/.test(namespace)) throw new Error("Invalid test namespace");
    const namespaced = (key) => namespace ? `${namespace}/${key}` : key;
    const binding = {
      async put(key, body, options) { counts.put++; counts.putBytes += body.byteLength; await delay(); return env.RELEASE_SOURCE_ASSETS.put(namespaced(key), body, options); },
      async head(key) { counts.head++; await delay(); return env.RELEASE_SOURCE_ASSETS.head(namespaced(key)); },
      async get(key) {
        counts.get++; await delay(); const object = await env.RELEASE_SOURCE_ASSETS.get(namespaced(key));
        if (!object) return null;
        return { size: object.size, body: object.body, async arrayBuffer() { const bytes = await object.arrayBuffer(); counts.readbackBytes += bytes.byteLength; active--; return bytes; } };
      },
    };
    const storage = new CloudflareR2ReleaseStorage({ binding, privateBucket: "isolated-fullbook" });
    const fetchCanonical = canonicalPublicationAssetFetcher({ cloudflare: { staticAssets: env.ASSETS } });
    const started = Date.now(); let error = null;
    try {
      await materializeCanonicalReleaseAssets(storage, { ...input, fetchAsset: async (path) => {
        counts.assetsFetch++; active++; counts.maxConcurrentAssets = Math.max(active, counts.maxConcurrentAssets);
        if (failAt && counts.assetsFetch === failAt) throw new Error("injected_local_failure");
        await delay(); return fetchCanonical(path);
      } });
    } catch (failure) { error = { stage: failure.assetStage, failureClass: failure.failureClass }; }
    return Response.json({ counts, wallMs: Date.now() - started, error, cpu: "not measured: local workerd has no per-request isolate CPU counter in this harness", peakIsolateMemory: "not measured: no reliable per-isolate peak exposed", workloadBound: "one canonical asset at a time per request; not a measured isolate memory value" });
  },
};
