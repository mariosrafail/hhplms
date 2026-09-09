// Closed, browser-safe contracts. Historical B2 compiler dispatch lives on the server.
const member = (bookSlug, suffix, order, pagePrefix, managed = true, version = 1) => Object.freeze({
  bookSlug, componentSlug: `${bookSlug}-${suffix}`, order, pagePrefix, managed,
  compilerId: `${bookSlug}-${suffix}-v${version}`, releaseSchemaVersion: `${version}.0`,
});
const product = (bookSlug, members) => Object.freeze({
  bookSlug, compilerId: `${bookSlug}-product-v1`, releaseSchemaVersion: '1.0',
  members: Object.freeze(members),
});
export const publicationProducts = Object.freeze([
  product('ultimate-b1', [member('ultimate-b1', 'students-book', 1, 'b1-sb'), member('ultimate-b1', 'workbook', 2, 'b1-wb')]),
  product('ultimate-b1-plus', [member('ultimate-b1-plus', 'students-book', 1, 'b1-plus-sb'), member('ultimate-b1-plus', 'workbook', 2, 'b1-plus-wb')]),
  product('ultimate-b2', [member('ultimate-b2', 'students-book', 1, 'sb', false, 3), member('ultimate-b2', 'workbook', 2, 'wb'), member('ultimate-b2', 'grammar-book', 3, 'gb')]),
]);
export const publicationComponents = Object.freeze(publicationProducts.flatMap((entry) => entry.members));
export const newManagedPublicationComponents = Object.freeze(publicationComponents.filter((entry) => entry.bookSlug !== 'ultimate-b2'));
export const findPublicationProduct = (bookSlug) => publicationProducts.find((entry) => entry.bookSlug === bookSlug) || null;
export const findPublicationComponent = (bookSlug, componentSlug) => publicationComponents.find((entry) => entry.bookSlug === bookSlug && entry.componentSlug === componentSlug) || null;
export const findPublicationComponentBySlug = (componentSlug) => publicationComponents.find((entry) => entry.componentSlug === componentSlug) || null;
