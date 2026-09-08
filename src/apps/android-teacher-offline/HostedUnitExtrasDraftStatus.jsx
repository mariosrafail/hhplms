import { useEffect, useState } from "react";
import { loadHostedDraftUnitExtras } from "./hostedComponentReleaseProvider.js";
import { UnitExtrasDraftStatus } from "../../components/lms/books/UnitExtrasDraftStatus.jsx";

export function HostedUnitExtrasDraftStatus({ runtimeContext, identity }) {
  const [publication, setPublication] = useState({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setPublication({ kind: "loading" });
    // The notice must not initialize/cache the page activity-order provider.
    // That provider belongs to the actual page review, after authoring saves.
    loadHostedDraftUnitExtras({ context: runtimeContext, identity, signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setPublication(value); })
      .catch(() => { if (!controller.signal.aborted) setPublication({ kind: "error" }); });
    return () => controller.abort();
  }, [runtimeContext.kind, runtimeContext.authorization, identity.bookSlug, identity.componentSlug]);
  if (publication.kind === "error") return <p className="unit-extras-draft-status" role="alert">Saved Draft Unit Extras are unavailable.</p>;
  return <UnitExtrasDraftStatus publication={publication} />;
}
