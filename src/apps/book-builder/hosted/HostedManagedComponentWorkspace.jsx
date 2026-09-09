import { ComponentPagesWorkspace } from "./ComponentPagesWorkspace.jsx";
import { HostedActivityWorkspace } from "./HostedActivityWorkspace.jsx";
import { HostedHotspotBuilder } from "./HostedHotspotBuilder.jsx";
import { HostedPublicationWorkspace } from "../../ultimate-b2-builder/HostedPublicationWorkspace.jsx";
import "../../ultimate-b2-builder/ultimateB2HotspotBuilder.css";

export function HostedManagedComponentWorkspace({
  tool = "pages",
  nativeActivities = null,
  bookSlug,
  componentSlug,
  bookTitle,
  componentTitle,
}) {
  return <div className="ultimate-b2-builder-app" data-build-profile="book-builder-hosted-review" data-component-adapter={componentSlug}>
    {tool === "publication" ? <HostedPublicationWorkspace bookSlug={bookSlug} componentSlug={componentSlug} /> : null}
    {tool === "pages" ? <ComponentPagesWorkspace bookSlug={bookSlug} componentSlug={componentSlug} managed title={componentTitle} /> : null}
    {tool === "hotspots" ? <HostedHotspotBuilder bookSlug={bookSlug} componentSlug={componentSlug} bookTitle={bookTitle} componentTitle={componentTitle} managed /> : null}
    {tool === "activities" ? <HostedActivityWorkspace nativeActivities={nativeActivities} bookSlug={bookSlug} componentSlug={componentSlug} bookTitle={bookTitle} componentTitle={componentTitle} /> : null}
  </div>;
}

export default HostedManagedComponentWorkspace;
