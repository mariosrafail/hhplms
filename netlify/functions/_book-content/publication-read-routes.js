import { json, requestsHiddenPhaseOneComponent, requireResourceRole, verifyPackageAccess } from "./shared.js";
import { getActiveComponentRelease, getPublishedNativeTeacherAnswer, getPublishedNativeTeacherDocument, getPublishedReleaseAsset } from "./publication-actions.js";
import { listPublishedBooks, getPublishedBookActivity, getStudentAssignmentDetail } from "./published-book-actions.js";
import { getPublishedPageImage } from "./published-page-image.js";
import { readPublishedEdition } from "./edition-read.js";

// Called only after requireAuth. Historical assignment detail resolves its own
// identity and access; ordinary book discovery retains the LMS visibility gate.
async function readPublishedBookRoute(sql, currentUser, event, query, context) {
  if (!["GET", "HEAD"].includes(event.httpMethod)) return null;
  if (query.action === "edition-release" && event.httpMethod === "GET") return readPublishedEdition(sql, currentUser, query);
  if (query.action === "published-page-image") {
    if (query.bookSlug !== "ultimate-b2" || query.componentSlug !== "ultimate-b2-students-book") return json(404, { error: "Page not found" });
    const accessError = await verifyPackageAccess(sql, currentUser, { packageSlug: query.bookSlug });
    return accessError || getPublishedPageImage(sql, query, { assets: context?.lmsAssets, origin: context?.lmsOrigin, method: event.httpMethod });
  }
  if (event.httpMethod === "GET") {
    if (query.action === "published-books") return listPublishedBooks(sql, currentUser);
    if (query.action === "student-assignment") return getStudentAssignmentDetail(sql, currentUser, query);
    if (query.action === "published-book-activity") return getPublishedBookActivity(sql, currentUser, query);
  }
  if (query.action === "published-native-answer-asset") {
    if (requestsHiddenPhaseOneComponent(query)) return json(404, { error: "Component not found" });
    const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
    const accessError = roleError || await verifyPackageAccess(sql, currentUser, { packageSlug: query.bookSlug });
    return accessError || getPublishedNativeTeacherAnswer(sql, query, { method: event.httpMethod });
  }
  if (query.action === "published-release-asset") {
    if (requestsHiddenPhaseOneComponent(query)) return json(404, { error: "Component not found" });
    const accessError = await verifyPackageAccess(sql, currentUser, { packageSlug: query.bookSlug });
    return accessError || getPublishedReleaseAsset(sql, query, { method: event.httpMethod, range: event.headers?.range || event.headers?.Range });
  }
  if (event.httpMethod !== "GET") return null;
  if (query.action === "active-component-release") {
    if (requestsHiddenPhaseOneComponent(query)) return json(404, { error: "Component not found" });
    const accessError = await verifyPackageAccess(sql, currentUser, { packageSlug: query.bookSlug });
    return accessError || getActiveComponentRelease(sql, query);
  }
  if (query.action === "published-native-teacher") {
    if (requestsHiddenPhaseOneComponent(query)) return json(404, { error: "Component not found" });
    const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
    const accessError = roleError || await verifyPackageAccess(sql, currentUser, { packageSlug: query.bookSlug });
    return accessError || getPublishedNativeTeacherDocument(sql, query);
  }
  return null;
}

export async function routePublishedBookRead(sql, currentUser, event, query, context) {
  const result = await readPublishedBookRoute(sql, currentUser, event, query, context);
  if (!result) return null;
  if (result instanceof Response) {
    result.headers.set("Cache-Control", "private, no-store");
    result.headers.set("Vary", "Cookie");
    return result;
  }
  return { ...result, headers: { ...result.headers, "Cache-Control": "private, no-store", Vary: "Cookie" } };
}
