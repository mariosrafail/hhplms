import { createBuilderPublicationHandler } from "../server/_builder-publication.js";
import { createBuilderProductPublicationHandler, parseBuilderProductPublicationRoute } from "../server/_builder-product-publication.js";
import { createBuilderEditionHandler, parseBuilderEditionRoute } from "../server/_builder-editions.js";

export function createBuilderPublicationFunction({
  componentHandler = createBuilderPublicationHandler(),
  productHandler = createBuilderProductPublicationHandler(),
  editionHandler = createBuilderEditionHandler(),
} = {}) {
  return (event, context) => parseBuilderEditionRoute(event) ? editionHandler(event, context) : parseBuilderProductPublicationRoute(event)
    ? productHandler(event, context)
    : componentHandler(event, context);
}

export const handler = createBuilderPublicationFunction();
