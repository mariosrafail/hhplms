import { componentActivityOrderEntries, projectComponentActivityOrder, reorderComponentActivity } from "../../../src/data/native-activities/nativeActivityOrder.js";
import { builderDocumentSha256 } from "./_builder-content-security.js";

export async function loadBuilderActivityOrder(dependencies, sql, identity) {
  const resources = await Promise.all(["native-activity-index", "activity-lifecycle"].map((type) => dependencies.resolveResource(identity.bookSlug, identity.componentSlug, type, "")));
  if (resources.some((value) => !value)) return null;
  const stored = await Promise.all(resources.map((resource) => dependencies.loadDocument(sql, resource)));
  const [index, lifecycle] = resources.map((resource, i) => stored[i]?.document || resource.baseline());
  const canonical = [];
  return { index, lifecycle, canonical, indexRevision: stored[0]?.revision || 0, lifecycleRevision: stored[1]?.revision || 0, pages: projectComponentActivityOrder(componentActivityOrderEntries(canonical, index, lifecycle)) };
}

export async function saveBuilderActivityOrder(sql, identity, current, input, builderUserId) {
  const next = reorderComponentActivity({ ...current, ...input });
  const rows = await sql`select * from save_builder_activity_order(
    ${identity.bookSlug},${identity.componentSlug},${input.expectedIndexRevision},${input.expectedLifecycleRevision},
    ${JSON.stringify(next.index)}::jsonb,${JSON.stringify(next.lifecycle)}::jsonb,
    ${builderDocumentSha256(next.index)},${builderDocumentSha256(next.lifecycle)},${builderUserId}::uuid,${input.clientMutationId}::uuid
  )`;
  return rows[0];
}
