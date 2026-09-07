import { canonicalStudentsBookPagesById } from "../../../netlify-sites/ultimate-b2-builder/server/_builder-page-catalog.js";
import { verifyImmutableComponentRelease } from "../../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { lmsCanonicalPageAssetPath } from "../../../shared/lmsCanonicalPages.js";
import { publishedReleaseRow } from "./publication-actions.js";
import { isValidUuid, json } from "./shared.js";

const unavailable = (status = 404) => json(status, { error: "Published page image is unavailable" }, { "Cache-Control": "private, no-store", Vary: "Cookie" });

// Authentication/package authorization precedes this function. A request always
// resolves its exact published release; it never consults a mutable/latest head.
export async function getPublishedPageImage(sql, query, { assets, origin, method = "GET" } = {}) {
  if (query.bookSlug !== "ultimate-b2" || query.componentSlug !== "ultimate-b2-students-book" || !isValidUuid(query.releaseId)) return unavailable();
  const page = canonicalStudentsBookPagesById.get(query.pageId);
  if (!page || query.sha256 !== page.image.checksumSha256) return unavailable();
  const row = await publishedReleaseRow(sql, query);
  if (!row) return unavailable();
  const { publicProjection } = verifyImmutableComponentRelease(row);
  if (row.compiler_id === "ultimate-b2-students-book-v3") return unavailable();
  if (publicProjection.bookSlug !== query.bookSlug || publicProjection.componentSlug !== query.componentSlug
    || (publicProjection.activePageIds && !publicProjection.activePageIds.includes(page.id))) return unavailable();
  if (!assets?.fetch || !origin) return unavailable(503);
  try {
    const response = await assets.fetch(new Request(new URL(lmsCanonicalPageAssetPath(page.image), origin), { method: "GET" }));
    if (response.status !== 200 || response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== page.image.mimeType) {
      await response.body?.cancel();
      return unavailable(503);
    }
    // Bound one page by its trusted manifest size before hashing. Never load a
    // book, accept redirects, or stream unverified/SPA bytes to the browser.
    const reader = response.body?.getReader();
    if (!reader) return unavailable(503);
    const bytes = new Uint8Array(page.image.byteSize);
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.length > bytes.length) { await reader.cancel(); return unavailable(503); }
        bytes.set(value, size); size += value.length;
      }
    } finally { reader.releaseLock(); }
    if (size !== bytes.length) return unavailable(503);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (digest !== page.image.checksumSha256) return unavailable(503);
    return new Response(method === "HEAD" ? null : bytes, { headers: {
      "Content-Type": page.image.mimeType, "Content-Length": String(size),
      "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff",
    } });
  } catch { return unavailable(503); }
}
