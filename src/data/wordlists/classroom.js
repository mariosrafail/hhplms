import { contentEdition, normalizeContentSourceReference } from "../contentEditions.js";
import { normalizeHostedTeacherUiPreview } from "../ultimate-b2/hostedTeacherUiDocument.js";
import { stableJson } from "./portable.js";
import { wordListUrl, validateWordListContext } from "./loader.js";

export async function classroomRead(context, parameters, signal) {
  const response = await fetch(wordListUrl(context, parameters), { credentials: "same-origin", cache: "no-store", signal });
  if (!response.ok) throw new Error([401, 403].includes(response.status) ? "Edition access is unavailable." : "Verified edition content could not load. Please retry.");
  const value = await response.json();
  if (value.edition?.bookSlug !== context.bookSlug || value.edition?.editionId !== context.editionId
    || context.kind !== "draft" && value.releaseId !== context.releaseId) throw new Error("Edition content identity mismatch.");
  return value;
}
export async function loadEditionClassroom(context, { signal } = {}) {
  validateWordListContext(context);
  const value = await classroomRead(context, { content: "1" }, signal);
  const targetSource = normalizeContentSourceReference(value.source, { edition: contentEdition(context.bookSlug, context.editionId), componentSlug: context.componentSlug });
  if (context.targetSource && stableJson(context.targetSource) !== stableJson(targetSource)) throw new Error("The associated source changed. Reopen its saved review.");
  const projection = value.projection;
  if (projection?.bookSlug !== context.bookSlug || projection?.componentSlug !== context.componentSlug || !Array.isArray(projection.pages)
    || !Array.isArray(projection.units) || !Array.isArray(projection.assets) || !projection.nativeActivities || !projection.hotspots?.pages) throw new Error("Edition projection is invalid.");
  const sourcePageIds = projection.pages.map((page) => page.id);
  if (new Set(sourcePageIds).size !== sourcePageIds.length || projection.pages.some((page) => typeof page.id !== "string" || !page.id
    || !projection.units.some((unit) => unit.id === page.unitId) || !projection.assets.some((asset) => asset.sha256 === page.image?.sha256 && asset.role === page.image.role))) throw new Error("Edition pages are invalid.");
  const verifiedContext = { ...context, targetSource, sourcePageIds };
  const uiValue = await classroomRead(verifiedContext, { ui: "1" }, signal);
  const ownerSource = normalizeContentSourceReference(uiValue.ownerSource, { edition: contentEdition(context.bookSlug, context.editionId), componentSlug: `${context.bookSlug}-students-book` });
  if (context.componentSlug === ownerSource.componentSlug && stableJson(ownerSource) !== stableJson(targetSource)) throw new Error("Edition UI owner mismatch.");
  const ui = normalizeHostedTeacherUiPreview(uiValue.ui, { packageId: ownerSource.componentSlug });
  const url = (parameters) => wordListUrl(verifiedContext, { content: "1", ...parameters });
  const assetUrl = (_publication, reference) => {
    const descriptor = projection.assets.find((asset) => asset.sha256 === reference?.checksumSha256 && asset.role === reference.role);
    return descriptor ? url({ assetSha256: descriptor.sha256, assetRole: descriptor.role, extension: descriptor.extension }) : "";
  };
  const delivery = Object.freeze({ assetUrl,
    async loadTeacher(_publication, activityId, { signal: requestSignal }) {
      const result = await classroomRead(verifiedContext, { content: "1", teacherActivityId: activityId }, requestSignal);
      if (result.document?.activityId !== activityId) throw new Error("Teacher activity identity mismatch.");
      return result.document;
    },
    teacherAssetUrl: (_publication, activityId, sectionId) => url({ teacherAssetActivityId: activityId, ...(sectionId ? { sectionId } : {}) }),
  });
  return { context: verifiedContext, projection, delivery, ui, ownerSource,
    uiAssetUrl: (_asset, bindingId) => wordListUrl(verifiedContext, { ui: "1", uiBindingId: bindingId, uiOwnerSha256: ownerSource.sha256 }),
    uiFontUrl: () => wordListUrl(verifiedContext, { ui: "1", uiFont: "1", uiOwnerSha256: ownerSource.sha256 }),
    pageAssetUrl: (page) => url({ assetSha256: page.image.sha256, assetRole: page.image.role, extension: page.image.extension }),
    publication: Object.freeze({ kind: "published", releaseId: context.releaseId || targetSource.sourceId, projection,
      bookSlug: context.bookSlug, componentSlug: context.componentSlug }),
  };
}
