import { json, verifyPackageAccess, requireResourceRole } from "./shared.js";
import { contentEdition, ContentEditionError } from "../../../src/data/contentEditions.js";
import { editionDatabaseReady, editionUserAllowed, loadEditionRelease } from "../../../netlify-sites/ultimate-b2-builder/server/_builder-edition-store.js";
import { editionReleaseRead } from "../../../netlify-sites/ultimate-b2-builder/server/_builder-editions.js";
import { createBookAssetStorage } from "../../../lib/book-assets/storage.js";
import { wordListDatabaseReady, loadWordListEdition } from "../../../netlify-sites/ultimate-b2-builder/server/_builder-wordlist-store.js";
import { wordListReleaseRead } from "../../../netlify-sites/ultimate-b2-builder/server/_builder-wordlists.js";

export async function readPublishedEdition(sql, currentUser, query, overrides = {}) {
  const wordlists = query.contract === "edition-release.v2";
  const deps = { ready: wordlists ? wordListDatabaseReady : editionDatabaseReady, allowed: editionUserAllowed, load: wordlists ? loadWordListEdition : loadEditionRelease,
    bookAccess: verifyPackageAccess, storage: createBookAssetStorage, ...overrides };
  try {
    contentEdition(query.bookSlug, query.editionId);
    const bookError = await deps.bookAccess(sql, currentUser, { packageSlug: query.bookSlug });
    if (bookError) return bookError;
    if (!await deps.ready(sql) || !await deps.allowed(sql, currentUser, query)) return json(403, { error: "edition_access_denied" });
    const teacher = !requireResourceRole(currentUser, ["teacher", "admin"]);
    if ((query.teacherActivityId || query.teacherAssetActivityId) && !teacher) return json(403, { error: "edition_teacher_required" });
    const release = await deps.load(sql, { bookSlug: query.bookSlug, editionId: query.editionId, releaseId: query.releaseId, publishedOnly: true });
    if (!release) return json(404, { error: "edition_release_missing" });
    return await (wordlists ? wordListReleaseRead : editionReleaseRead)(release, query, query.audioSha256 || query.assetSha256 || query.teacherAssetActivityId ? deps.storage() : null, { teacher });
  } catch (error) {
    return json(error instanceof ContentEditionError ? 404 : 503, { error: "edition_content_unavailable" });
  }
}
