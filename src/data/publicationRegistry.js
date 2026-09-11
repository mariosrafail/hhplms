// Closed, browser-safe contracts. Historical B2 compiler dispatch lives on the server.
const member = (bookSlug, suffix, order, pagePrefix, managed = true, version = 1) => Object.freeze({
  bookSlug, componentSlug: `${bookSlug}-${suffix}`, order, pagePrefix, managed,
  compilerId: `${bookSlug}-${suffix}-v${version}`, releaseSchemaVersion: `${version}.0`,
});
const product = (bookSlug, members, version = 1) => Object.freeze({
  bookSlug, compilerId: `${bookSlug}-product-v${version}`, releaseSchemaVersion: '1.0',
  members: Object.freeze(members),
});
// Frozen historical contracts are independent of current writer selection.
export const publicationProductsV1 = Object.freeze([
  product('ultimate-b1', [member('ultimate-b1', 'students-book', 1, 'b1-sb'), member('ultimate-b1', 'workbook', 2, 'b1-wb')]),
  product('ultimate-b1-plus', [member('ultimate-b1-plus', 'students-book', 1, 'b1-plus-sb'), member('ultimate-b1-plus', 'workbook', 2, 'b1-plus-wb')]),
  product('ultimate-b2', [member('ultimate-b2', 'students-book', 1, 'sb', false, 3), member('ultimate-b2', 'workbook', 2, 'wb'), member('ultimate-b2', 'grammar-book', 3, 'gb')]),
]);
export const managedPublicationComponentsV1 = Object.freeze(publicationProductsV1.flatMap((entry) => entry.members).filter((entry) => entry.managed));
export const findManagedPublicationComponentV1 = (slug) => managedPublicationComponentsV1.find((entry) => entry.componentSlug === slug) || null;
export const publicationProductsV2 = Object.freeze([
  product('ultimate-b1', [member('ultimate-b1', 'students-book', 1, 'b1-sb', true, 2), member('ultimate-b1', 'workbook', 2, 'b1-wb')], 2),
  product('ultimate-b1-plus', [member('ultimate-b1-plus', 'students-book', 1, 'b1-plus-sb', true, 2), member('ultimate-b1-plus', 'workbook', 2, 'b1-plus-wb')], 2),
]);
export const publicationProducts = Object.freeze([...publicationProductsV2, publicationProductsV1[2]]);
const b1ManagedCompilerIds = Object.freeze([...publicationProductsV1, ...publicationProductsV2].filter((entry) => entry.bookSlug !== 'ultimate-b2').flatMap((entry) => entry.members.map((member) => member.compilerId)));
export const isB1ManagedPublicationCompiler = (compilerId) => b1ManagedCompilerIds.includes(compilerId);
export const resolvePublicationProductContract = (bookSlug, compilerId) => [...publicationProductsV1, ...publicationProductsV2].find((entry) => entry.bookSlug === bookSlug && entry.compilerId === compilerId)
  || (bookSlug === 'ultimate-b2' && compilerId === 'ultimate-b2-product-legacy-v1' ? publicationProductsV1[2] : null);
export const publicationComponents = Object.freeze(publicationProducts.flatMap((entry) => entry.members));
export const newManagedPublicationComponents = Object.freeze(publicationComponents.filter((entry) => entry.bookSlug !== 'ultimate-b2'));
export const findPublicationProduct = (bookSlug) => publicationProducts.find((entry) => entry.bookSlug === bookSlug) || null;
export const findPublicationComponent = (bookSlug, componentSlug) => publicationComponents.find((entry) => entry.bookSlug === bookSlug && entry.componentSlug === componentSlug) || null;
export const findPublicationComponentBySlug = (componentSlug) => publicationComponents.find((entry) => entry.componentSlug === componentSlug) || null;
