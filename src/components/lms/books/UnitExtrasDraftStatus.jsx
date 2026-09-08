import "./UnitExtrasDraftStatus.css";

export function UnitExtrasDraftStatus({ publication }) {
  if (publication?.kind !== "draft") return null;
  const missing = (publication.projection?.unitExtras?.units || []).flatMap(unit => [
    ...unit.categories.videos.filter(item => item.readiness === "missing-media").map(item => ({ ...item, unitNumber: unit.unitNumber, format: "MP4" })),
    ...(unit.categories.audios || []).filter(item => item.readiness === "missing-media").map(item => ({ ...item, unitNumber: unit.unitNumber, format: "MP3" })),
  ]);
  if (!missing.length) return null;
  return <aside className="unit-extras-draft-status" role="status" aria-label="Unfinished Unit Extras">
    <strong>Saved Draft: media not ready</strong>
    <ul>{missing.map(item => <li key={item.id}>Unit {item.unitNumber}: {item.title} - {item.format} required</li>)}</ul>
    <p>Upload the missing media in Unit Extras before publication.</p>
  </aside>;
}
