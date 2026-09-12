import { Suspense, useEffect, useMemo, useState } from "react";
import { Boxes, FileImage, MapPinned, PanelsTopLeft, Rocket, Volume2 } from "lucide-react";

import {
  findHostedBuilderBook,
  findHostedBuilderComponent,
  hostedBuilderCatalog,
} from "./hostedBuilderCatalog.js";
import { resolveHostedBuilderAdapter, resolveHostedBuilderPackageTool } from "./hostedBuilderAdapters.jsx";
import { resolveHostedBuilderTool } from "./hostedBuilderCapabilities.js";
import { getBuilderPages } from "./builderPagesApi.js";
import { pageLibraryReviewNavigation } from "./pageLibraryReviewModel.js";
import { HostedPackageReview } from "./HostedPackageReview.jsx";
import { HostedBuilderReviewPage } from "./HostedBuilderReviewPage.jsx";
import { hostedBuilderHash, parseHostedBuilderHash } from "./hostedBuilderRouter.js";
import { HostedBuilderRouteTransition } from "./HostedBuilderRouteTransition.jsx";
import "./hostedBuilder.css";
import "./hostedBuilderModern.css";

function useHostedBuilderRoute() {
  const [route, setRoute] = useState(() => parseHostedBuilderHash(window.location.hash));
  useEffect(() => {
    const update = () => setRoute(parseHostedBuilderHash(window.location.hash));
    window.addEventListener("hashchange", update);
    if (!window.location.hash) window.history.replaceState(null, "", hostedBuilderHash());
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}

function Breadcrumbs({ book, component, tool, packageTool }) {
  const toolLabels = { pages: "Pages", hotspots: "Hotspot Builder", activities: "Activity Builder", ui: "Page UI Controller", sounds: "Sound Controller", publication: "Publication" };
  return <nav className="hosted-builder-breadcrumbs" aria-label="Breadcrumb">
    <a href={hostedBuilderHash()}>Books</a>
    {book ? <><span aria-hidden="true">/</span><a href={hostedBuilderHash({ bookSlug: book.slug })}>{book.title}</a></> : null}
    {component ? <><span aria-hidden="true">/</span><a href={hostedBuilderHash({ bookSlug: book.slug, componentSlug: component.slug })}>{component.title}</a></> : null}
    {tool || packageTool ? <><span aria-hidden="true">/</span><span aria-current="page">{toolLabels[tool || packageTool]}</span></> : null}
  </nav>;
}

function BookLibrary() {
  return <main className="hosted-builder-page" id="main-content">
    <header className="hosted-builder-title"><div><span>Hamilton House</span><h1>Book Builder</h1><p>Choose a publisher title to inspect its authoring components.</p></div><strong>Book Library</strong></header>
    <section className="hosted-builder-book-grid" aria-label="Available books">
      {hostedBuilderCatalog.map((book) => <article className="hosted-builder-book-card" key={book.slug}>
        {book.cover ? <img src={book.cover} alt={`${book.title} cover`} /> : <div className="hosted-builder-cover-placeholder" role="img" aria-label={`${book.title} cover not supplied`}><span>{book.level}</span></div>}
        <div><span className="hosted-builder-status">{book.status}</span><h2>{book.title}</h2><p>Level {book.level}</p><a className="hosted-builder-action" href={hostedBuilderHash({ bookSlug: book.slug })}>Open book</a></div>
      </article>)}
    </section>
  </main>;
}

function ComponentSelection({ book }) {
  return <main className="hosted-builder-page" id="main-content">
    <Breadcrumbs book={book} />
    <header className="hosted-builder-book-heading">{book.cover ? <img src={book.cover} alt="" /> : <div className="hosted-builder-cover-placeholder" aria-hidden="true"><span>{book.level}</span></div>}<div><span>Level {book.level}</span><h1>{book.title}</h1><p>Select a component. Components without a registered adapter remain visible for future authoring setup.</p></div></header>
    {book.packageTools?.length ? <section className="hosted-builder-package-tools" aria-labelledby="package-tools-title"><h2 id="package-tools-title">Package tools</h2><div>{book.packageTools.map((tool) => {
      const Icon = tool.id === "sounds" ? Volume2 : PanelsTopLeft;
      return <article key={tool.id}><Icon aria-hidden="true" /><div><span>{tool.status}</span><h3>{tool.title}</h3><p>{tool.description}</p><a className="hosted-builder-action" href={hostedBuilderHash({ bookSlug: book.slug, packageTool: tool.id })}>Open tool</a></div></article>;
    })}</div></section> : null}
    <section className="hosted-builder-component-grid" aria-label={`${book.title} components`}>
      {book.components.map((component) => {
        const available = Boolean(resolveHostedBuilderAdapter(book, component));
        return <article className="hosted-builder-component-card" data-available={available || undefined} key={component.slug}>
          {component.cover ? <img src={component.cover} alt="" /> : <div className="hosted-builder-cover-placeholder" aria-hidden="true"><span>{book.level}</span></div>}
          <div><span>{component.type.replaceAll("_", " ")}</span><h2>{component.title}</h2><p>{component.status}</p>{available
            // Temporarily hide only the Grammar Book workspace CTA; its adapter remains available.
            ? component.type !== "grammar_book" && <a className="hosted-builder-action" href={hostedBuilderHash({ bookSlug: book.slug, componentSlug: component.slug })}>Open workspace</a>
            : <span className="hosted-builder-unavailable">Authoring adapter pending</span>}</div>
        </article>;
      })}
    </section>
  </main>;
}

function PackageToolWorkspace({ book, tool }) {
  const resolved = resolveHostedBuilderPackageTool(book, tool);
  if (!resolved) return <NotFound />;
  const Tool = resolved.adapter.Tool;
  return <main className="hosted-builder-workspace" id="main-content"><div className="hosted-builder-workspace-chrome"><Breadcrumbs book={book} packageTool={tool} /></div><Suspense fallback={<p className="hosted-builder-loading" role="status">Loading package tool…</p>}><HostedBuilderRouteTransition routeKey={`${book.slug}/package/${tool}`}><Tool bookSlug={resolved.adapter.bookSlug} componentSlug={resolved.adapter.componentSlug} bookTitle={book.title} /></HostedBuilderRouteTransition></Suspense></main>;
}

function UnavailableComponent({ book, component }) {
  return <main className="hosted-builder-page" id="main-content">
    <Breadcrumbs book={book} component={component} />
    <section className="hosted-builder-notice"><span>Component registered</span><h1>{component.title}</h1><p>{component.status}. No hosted authoring adapter is connected in this read-only milestone.</p><a className="hosted-builder-action" href={hostedBuilderHash({ bookSlug: book.slug })}>Back to {book.title} components</a></section>
  </main>;
}

function Workspace({ book, component, tool }) {
  const adapter = resolveHostedBuilderAdapter(book, component);
  if (!adapter) return <UnavailableComponent book={book} component={component} />;
  if (!resolveHostedBuilderTool(adapter, tool)) return <NotFound />;
  const WorkspaceComponent = adapter.Workspace;
  const tools = [
    { id: "pages", label: "Pages", description: "Manage component pages", capability: "pages", Icon: FileImage },
    { id: "hotspots", label: "Hotspot Builder", description: "Place interactive targets", capability: "hotspots", Icon: MapPinned },
    { id: "activities", label: "Activity Builder", description: "Author learning activities", capability: "activities", Icon: Boxes },
    { id: "ui", label: "UI Controller", description: "Tune teacher controls", capability: "uiController", Icon: PanelsTopLeft },
    { id: "publication", label: "Publication", description: "Review release readiness", capability: "publication", Icon: Rocket },
  ];
  return <main className="hosted-builder-workspace" id="main-content">
    <div className="hosted-builder-workspace-chrome">
      <Breadcrumbs book={book} component={component} tool={tool} />
      <nav className="hosted-builder-tool-tabs" aria-label={`${component.title} tools`}>
        {tools.filter(({ capability }) => adapter.capabilities[capability]?.readable).map(({ id, label, description, capability, Icon }) => <a key={id} aria-current={tool === id ? "page" : undefined} href={hostedBuilderHash({ bookSlug: book.slug, componentSlug: component.slug, tool: id })}><Icon aria-hidden="true" /><span><strong>{label}</strong><small>{description} · {adapter.capabilities[capability].writable ? "Editable" : "Read-only"}</small></span></a>)}
      </nav>
    </div>
    <Suspense fallback={<p className="hosted-builder-loading" role="status">Loading component workspace…</p>}>
      <HostedBuilderRouteTransition routeKey={`${book.slug}/${component.slug}/${tool}`}><WorkspaceComponent tool={tool} capabilities={adapter.capabilities} nativeActivities={adapter.nativeActivities || null} bookSlug={book.slug} componentSlug={component.slug} bookTitle={book.title} componentTitle={component.title} /></HostedBuilderRouteTransition>
    </Suspense>
  </main>;
}

function NotFound() {
  return <main className="hosted-builder-page" id="main-content"><section className="hosted-builder-notice"><span>Route unavailable</span><h1>Builder location not found</h1><p>The requested book, component, or tool is not registered.</p><a className="hosted-builder-action" href={hostedBuilderHash()}>Return to Book Library</a></section></main>;
}

function PackageExperience({ book, route }) {
  const defaultComponentSlug = book.review?.defaultComponentSlug || book.components.find((component) => resolveHostedBuilderAdapter(book, component))?.slug;
  const routedComponent = route.componentSlug ? findHostedBuilderComponent(book, route.componentSlug) : null;
  const componentScopedRoute = ["workspace", "review", "legacy-package-tool"].includes(route.kind);
  const reviewComponent = componentScopedRoute
    ? routedComponent && resolveHostedBuilderAdapter(book, routedComponent) ? routedComponent : null
    : findHostedBuilderComponent(book, defaultComponentSlug);
  const reviewScope = reviewComponent ? `${book.slug}/${reviewComponent.slug}` : "";
  const [reviewPageState, setReviewPageState] = useState({ scope: "", pages: [] });
  const reviewPages = reviewPageState.scope === reviewScope ? reviewPageState.pages : [];
  const tool = route.kind === "package-tool" || route.kind === "legacy-package-tool" ? route.tool : route.kind === "workspace" ? route.tool : "pages";
  useEffect(() => {
    if (route.kind !== "legacy-package-tool" || !reviewComponent) return;
    window.history.replaceState(null, "", hostedBuilderHash({ bookSlug: book.slug, packageTool: route.tool }));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, [book.slug, reviewComponent, route.kind, route.tool]);
  useEffect(() => {
    if (!reviewComponent) return undefined;
    const controller = new AbortController();
    const load = () => getBuilderPages({ bookSlug: book.slug, componentSlug: reviewComponent.slug }, { signal: controller.signal })
      .then((library) => setReviewPageState({ scope: reviewScope, pages: pageLibraryReviewNavigation(library, { bookSlug: book.slug, componentSlug: reviewComponent.slug }).placements }))
      .catch((error) => { if (error.name !== "AbortError") setReviewPageState({ scope: reviewScope, pages: [] }); });
    load();
    const changed = (event) => { if (event.detail?.bookSlug === book.slug && event.detail?.componentSlug === reviewComponent.slug) load(); };
    window.addEventListener("builder:pages-changed", changed);
    return () => { controller.abort(); window.removeEventListener("builder:pages-changed", changed); };
  }, [book.slug, reviewComponent, reviewScope]);
  const content = useMemo(() => {
    if (route.kind === "book") return <HostedBuilderRouteTransition routeKey={`book/${book.slug}`}><ComponentSelection book={book} /></HostedBuilderRouteTransition>;
    if (route.kind === "package-tool") return <PackageToolWorkspace book={book} tool={route.tool} />;
    if (route.kind === "legacy-package-tool") return reviewComponent ? <PackageToolWorkspace book={book} tool={route.tool} /> : <NotFound />;
    const component = findHostedBuilderComponent(book, route.componentSlug);
    if (!component) return <NotFound />;
    if (route.kind === "review") return resolveHostedBuilderAdapter(book, component) ? <HostedBuilderReviewPage book={book} component={component} intent={route.intent} /> : <UnavailableComponent book={book} component={component} />;
    return <Workspace book={book} component={component} tool={route.tool} />;
  }, [book, route]);
  if (route.kind === "review") return content;
  if (componentScopedRoute && !reviewComponent) return content;
  return <HostedPackageReview key={reviewScope} tool={tool} pages={reviewPages} bookSlug={book.slug} componentSlug={reviewComponent?.slug || defaultComponentSlug}>{content}</HostedPackageReview>;
}

export function HostedBookBuilderApp() {
  const route = useHostedBuilderRoute();
  if (route.kind === "library") return <HostedBuilderRouteTransition routeKey="library"><BookLibrary /></HostedBuilderRouteTransition>;
  if (route.kind === "not-found") return <HostedBuilderRouteTransition routeKey="not-found"><NotFound /></HostedBuilderRouteTransition>;
  const book = findHostedBuilderBook(route.bookSlug);
  if (!book) return <NotFound />;
  return <PackageExperience book={book} route={route} />;
}

export default HostedBookBuilderApp;
