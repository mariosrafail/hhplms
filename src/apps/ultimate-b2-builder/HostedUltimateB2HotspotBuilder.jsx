import { HostedHotspotBuilder } from "../book-builder/hosted/HostedHotspotBuilder.jsx";

export function HostedUltimateB2HotspotBuilder({ bookSlug = "ultimate-b2", componentSlug = "ultimate-b2-students-book" }) {
  const managed = true;
  const componentTitle = componentSlug === "ultimate-b2-workbook" ? "Workbook" : componentSlug === "ultimate-b2-grammar-book" ? "Grammar Book" : "Students Book";
  return <HostedHotspotBuilder
    bookSlug={bookSlug}
    componentSlug={componentSlug}
    bookTitle="Ultimate B2"
    componentTitle={componentTitle}
    managed={managed}
  />;
}

export default HostedUltimateB2HotspotBuilder;
