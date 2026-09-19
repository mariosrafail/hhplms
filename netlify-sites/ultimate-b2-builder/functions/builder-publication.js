import { createBuilderPublicationHandler } from "../server/_builder-publication.js";
import { createBuilderProductPublicationHandler, parseBuilderProductPublicationRoute } from "../server/_builder-product-publication.js";
import { createBuilderEditionHandler, parseBuilderEditionRoute } from "../server/_builder-editions.js";
import { createBuilderWordListHandler, parseWordListRoute } from "../server/_builder-wordlists.js";

export function createBuilderPublicationFunction({
  componentHandler = createBuilderPublicationHandler(),
  productHandler = createBuilderProductPublicationHandler(),
  editionHandler = createBuilderEditionHandler(),
  wordListHandler = createBuilderWordListHandler(),
} = {}) {
  return (event, context) => parseWordListRoute(event) ? wordListHandler(event, context) : parseBuilderEditionRoute(event) ? editionHandler(event, context) : parseBuilderProductPublicationRoute(event)
    ? productHandler(event, context)
    : componentHandler(event, context);
}

export const handler = createBuilderPublicationFunction();
