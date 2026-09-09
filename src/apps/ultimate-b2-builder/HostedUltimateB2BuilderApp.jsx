import catalog from "../../../android-content-packs/ultimate-b2-students-book/catalog.json";

import { ComponentPagesWorkspace } from "../book-builder/hosted/ComponentPagesWorkspace.jsx";
import { HostedActivityWorkspace } from "../book-builder/hosted/HostedActivityWorkspace.jsx";
import { isUltimateB2ConfigurableOpenResponse } from "../../data/ultimate-b2/openResponseActivityRegistry.js";
import { HostedOpenResponseEditor } from "./HostedOpenResponseEditor.jsx";
import { HostedPublicationWorkspace } from "./HostedPublicationWorkspace.jsx";
import { HostedUltimateB2HotspotBuilder } from "./HostedUltimateB2HotspotBuilder.jsx";
import { UnitExtrasEditor } from "./UnitExtrasEditor.jsx";

const componentTitle = (componentSlug) => componentSlug === "ultimate-b2-workbook"
  ? "Workbook"
  : componentSlug === "ultimate-b2-grammar-book" ? "Grammar Book" : "Students Book";

function UltimateB2ActivityWorkspace({ nativeActivities, bookSlug, componentSlug }) {
  return <HostedActivityWorkspace
    nativeActivities={nativeActivities}
    bookSlug={bookSlug}
    componentSlug={componentSlug}
    bookTitle="Ultimate B2"
    componentTitle={componentTitle(componentSlug)}
    canonicalUnits={catalog.units || []}
    isCanonicalEditable={isUltimateB2ConfigurableOpenResponse}
    CanonicalEditor={HostedOpenResponseEditor}
    UnitExtras={UnitExtrasEditor}
  />;
}

export function UltimateB2StudentsBookHostedWorkspace({ tool = "hotspots", nativeActivities = null, bookSlug = "ultimate-b2", componentSlug = "ultimate-b2-students-book" }) {
  return <div className="ultimate-b2-builder-app" data-build-profile="book-builder-hosted-review" data-component-adapter={componentSlug}>{tool === "hotspots" ? <HostedUltimateB2HotspotBuilder bookSlug={bookSlug} componentSlug={componentSlug} /> : null}{tool === "activities" ? <UltimateB2ActivityWorkspace nativeActivities={nativeActivities} bookSlug={bookSlug} componentSlug={componentSlug} /> : null}{tool === "publication" ? <HostedPublicationWorkspace bookSlug={bookSlug} componentSlug={componentSlug} /> : null}</div>;
}

export function UltimateB2ManagedComponentHostedWorkspace({ tool = "hotspots", nativeActivities = null, bookSlug = "ultimate-b2", componentSlug }) {
  return <div className="ultimate-b2-builder-app" data-build-profile="book-builder-hosted-review" data-component-adapter={componentSlug}>{tool === "hotspots" ? <HostedUltimateB2HotspotBuilder bookSlug={bookSlug} componentSlug={componentSlug} /> : null}{tool === "activities" ? <UltimateB2ActivityWorkspace nativeActivities={nativeActivities} bookSlug={bookSlug} componentSlug={componentSlug} /> : null}{tool === "publication" ? <HostedPublicationWorkspace bookSlug={bookSlug} componentSlug={componentSlug} /> : null}</div>;
}

export function UltimateB2PagesHostedWorkspace({ bookSlug = "ultimate-b2", componentSlug }) {
  const managed = true;
  return <div className="ultimate-b2-builder-app" data-build-profile="book-builder-hosted-review" data-component-adapter={componentSlug}><ComponentPagesWorkspace bookSlug={bookSlug} componentSlug={componentSlug} managed={managed} title={componentTitle(componentSlug)} /></div>;
}

export default UltimateB2StudentsBookHostedWorkspace;
