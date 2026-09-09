import { findPublicationComponent } from "../data/publicationRegistry.js";

export function publishedManagedPageId(packageSlug, componentSlug, pageToken = "") {
  // Managed page IDs are URL state, not proof of publication or access. The
  // published Interactive validates them against the selected immutable release.
  if (packageSlug !== "ultimate-b2") {
    const contract = managedRouteContract(packageSlug, componentSlug);
    return contract && new RegExp(`^${contract.pagePrefix}-page-[a-f0-9]{32}$`).test(pageToken) ? pageToken : null;
  }
  if (["students-book", "ultimate-b2-students-book"].includes(componentSlug)) {
    return /^sb-page-[a-f0-9]{32}$/.test(pageToken) ? pageToken : null;
  }
  if (["workbook", "ultimate-b2-workbook"].includes(componentSlug)) {
    return /^wb-page-[a-f0-9]{32}$/.test(pageToken) ? pageToken : null;
  }
  return null;
}

export function managedRouteContract(packageSlug, slug) {
  return packageSlug !== "ultimate-b2" && (findPublicationComponent(packageSlug, slug) || findPublicationComponent(packageSlug, `${packageSlug}-${slug}`));
}
