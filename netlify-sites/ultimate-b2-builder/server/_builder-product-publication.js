import { createHash, randomUUID } from "node:crypto";

import { createCloudflareR2ReleaseStorage } from "../../../lib/book-assets/cloudflare-r2-release-storage.js";
import { materializeCanonicalReleaseAssets, canonicalPublicationAssetFetcher } from "./_builder-canonical-release-assets.js";
import { createBookAssetStorage } from "../../../lib/book-assets/storage.js";
import { findProductBook, findProductComponent } from "../../../src/data/bookProductCatalog.js";
import {
  ULTIMATE_B2_PRODUCT_RELEASE_COMPILER_ID,
  ULTIMATE_B2_PRODUCT_RELEASE_COMPONENTS,
  ULTIMATE_B2_PRODUCT_RELEASE_SCHEMA_VERSION,
} from "../../../src/data/ultimate-b2/productPublication.js";
import { builderClientMutationIdPattern, stableBuilderJson } from "./_builder-content-security.js";
import { getBuilderSql, json, requireBuilderOrigin, requireBuilderUser } from "./_builder-auth.js";
import { ComponentPublicationAssetError } from "./_builder-publication-assets.js";
import { freezeComponentPublicationAssetPins } from "./_builder-publication-pins.js";
import { resolvePublicationCompiler, verifyImmutableComponentRelease } from "./_builder-publication-compilers.js";
import { verifyProductReleaseEnvelope } from "./_builder-product-publication-domain.js";
import {
  createProductRelease,
  loadProductPublicationMutation,
  loadProductPublicationAssetModes,
  loadProductPublicationStatus,
  loadProductRelease,
  loadProductReleaseComponentRows,
  productPublicationDatabaseReady,
  productPublicationPinDatabaseReady,
  publishProductRelease,
} from "./_builder-product-publication-store.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");

export function parseBuilderProductPublicationRoute(event) {
  const pathname = String(event.path || "").split("?")[0];
  const match = pathname.match(/(?:\/builder\/api\/publication|\/\.netlify\/functions\/builder-publication(?:\/product)?)\/books\/([^/]+)(?:\/(prepare|publish))?\/?$/);
  return match ? { bookSlug: decodeURIComponent(match[1]), action: match[2] || "status" } : null;
}

function body(event, keys) {
  const contentType = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === "content-type")?.[1] || "";
  if (!String(contentType).toLowerCase().startsWith("application/json")) return { error: json(415, { error: "expected_application_json" }) };
  let value;
  try { value = JSON.parse(event.body || "{}"); } catch { return { error: json(400, { error: "invalid_json" }) }; }
  return exact(value, keys) ? { value } : { error: json(400, { error: "invalid_request" }) };
}

function productConfiguration(bookSlug) {
  const product = findProductBook(bookSlug);
  if (!product || bookSlug !== "ultimate-b2") return null;
  const components = ULTIMATE_B2_PRODUCT_RELEASE_COMPONENTS.map((identity) => {
    const component = findProductComponent(bookSlug, identity.componentSlug);
    const compiler = component?.publication?.readable ? resolvePublicationCompiler(component.publication.compilerId) : null;
    return component && compiler ? { ...identity, component, compiler } : null;
  });
  return components.every(Boolean) ? { product, components } : null;
}

async function compileProduct(sql, configuration, dependencies) {
  return Promise.all(configuration.components.map(async ({ component, compiler }) => {
    const collected = await compiler.collect(sql);
    const compiled = compiler.compile(collected);
    if (compiled.compilerId !== component.publication.compilerId || compiled.releaseSchemaVersion !== compiler.releaseSchemaVersion) throw new Error("publication_compiler_mismatch");
    return { componentSlug: component.slug, compiler, compiled };
  }));
}

function exactEnvelope(release) {
  return {
    id: release.id,
    number: release.number,
    bookSlug: release.bookSlug,
    compilerId: release.compilerId,
    releaseSchemaVersion: release.releaseSchemaVersion,
    sourceSnapshotSha256: release.sourceSnapshotSha256,
    releaseSha256: release.releaseSha256,
    releaseNote: release.releaseNote,
    createdAt: new Date(release.createdAt).toISOString(),
    members: release.members.map((member) => ({
      componentSlug: member.componentSlug,
      order: member.order,
      status: member.status,
      componentReleaseId: member.componentReleaseId,
      compilerId: member.compilerId,
      releaseSchemaVersion: member.releaseSchemaVersion,
      releaseSha256: member.releaseSha256,
      compatibility: member.compatibility,
      memberSha256: member.memberSha256,
      unavailableReason: member.unavailableReason,
    })),
  };
}

async function verifyCandidate(sql, candidate, dependencies) {
  const envelope = verifyProductReleaseEnvelope(exactEnvelope(candidate));
  const componentRows = await dependencies.loadComponentRows(sql, { bookSlug: candidate.bookSlug, productReleaseId: candidate.id });
  const rowsBySlug = new Map(componentRows.map((row) => [row.component_slug, row]));
  for (const member of envelope.members) {
    const row = rowsBySlug.get(member.componentSlug);
    if (member.status === "unavailable") {
      if (row) throw new Error("release_integrity_failed");
      continue;
    }
    if (!row || row.id !== member.componentReleaseId || row.compiler_id !== member.compilerId || row.release_schema_version !== member.releaseSchemaVersion
      || row.release_sha256 !== member.releaseSha256 || row.runtime_compatibility_sha256 !== member.compatibility) throw new Error("release_integrity_failed");
    verifyImmutableComponentRelease(row);
  }
  return envelope;
}

function releaseState(release, currentSources) {
  if (release.members.some((member) => member.status === "unavailable")) return "historical";
  return release.members.every((member) => currentSources.get(member.componentSlug) === member.sourceSnapshotSha256) ? "current" : "stale";
}

function withAssetModes(release, modeRows, { legacySchema = false } = {}) {
  if (!release) return null;
  const rows = modeRows.filter((row) => row.product_release_id === release.id);
  const byComponent = new Map(rows.map((row) => [row.component_slug, row.asset_storage_mode]));
  const members = release.members.map((member) => ({
    ...member,
    assetStorageMode: member.status === "included" ? (byComponent.get(member.componentSlug) || (legacySchema ? "materialized-v1" : "unknown")) : null,
  }));
  const modes = new Set(members.map((member) => member.assetStorageMode).filter(Boolean));
  return { ...release, assetStorageMode: modes.size === 1 ? [...modes][0] : "mixed", members };
}

function prepareStorage(context, dependencies) {
  if (!Object.hasOwn(context || {}, "cloudflare")) return dependencies.storage();
  try {
    return dependencies.cloudflareStorage({
      binding: context?.cloudflare?.releaseSourceAssets,
      privateBucket: context?.cloudflare?.releaseSourceAssetsBucket,
    });
  } catch {
    throw new ComponentPublicationAssetError({
      stage: "pin-storage",
      failureClass: "source_storage_identity_invalid",
    });
  }
}

export function createBuilderProductPublicationHandler(overrides = {}) {
  const dependencies = {
    getDatabase: overrides.getDatabase || getBuilderSql,
    authorize: overrides.authorize || requireBuilderUser,
    ready: overrides.ready || productPublicationDatabaseReady,
    pinReady: overrides.pinReady || productPublicationPinDatabaseReady,
    compileProduct: overrides.compileProduct || compileProduct,
    create: overrides.create || createProductRelease,
    publish: overrides.publish || publishProductRelease,
    status: overrides.status || loadProductPublicationStatus,
    loadRelease: overrides.loadRelease || loadProductRelease,
    loadComponentRows: overrides.loadComponentRows || loadProductReleaseComponentRows,
    verifyCandidate: overrides.verifyCandidate || verifyCandidate,
    loadMutation: overrides.loadMutation || loadProductPublicationMutation,
    loadAssetModes: overrides.loadAssetModes || loadProductPublicationAssetModes,
    freezePins: overrides.freezePins || freezeComponentPublicationAssetPins,
    materializeCanonical: overrides.materializeCanonical || materializeCanonicalReleaseAssets,
    canonicalFetch: overrides.canonicalFetch || canonicalPublicationAssetFetcher,
    storage: overrides.storage || (() => createBookAssetStorage()),
    cloudflareStorage: overrides.cloudflareStorage || createCloudflareR2ReleaseStorage,
    randomUuid: overrides.randomUuid || randomUUID,
    logger: overrides.logger || console,
  };

  return async function handler(event, context = {}) {
    const parsedRoute = parseBuilderProductPublicationRoute(event);
    const configuration = parsedRoute && productConfiguration(parsedRoute.bookSlug);
    if (!configuration) return json(404, { error: "publication_product_not_found" });
    try {
      const sql = dependencies.getDatabase();
      const auth = await dependencies.authorize(event, sql);
      if (auth.error) return auth.error;
      if (!await dependencies.ready(sql)) return json(409, { error: "publication_schema_unavailable" });
      const pinSchemaReady = await dependencies.pinReady(sql);
      if (event.httpMethod === "GET" && parsedRoute.action === "status") {
        const [status, compiledMembers, modeRows] = await Promise.all([
          dependencies.status(sql, parsedRoute.bookSlug),
          dependencies.compileProduct(sql, configuration, dependencies),
          pinSchemaReady ? dependencies.loadAssetModes(sql, { bookSlug: parsedRoute.bookSlug }) : Promise.resolve([]),
        ]);
        const currentSources = new Map(compiledMembers.map((entry) => [entry.componentSlug, entry.compiled.sourceSnapshotSha256]));
        const decorate = (release) => release ? { ...withAssetModes(release, modeRows, { legacySchema: !pinSchemaReady }), state: releaseState(release, currentSources) } : null;
        return json(200, {
          bookSlug: parsedRoute.bookSlug,
          compilerId: ULTIMATE_B2_PRODUCT_RELEASE_COMPILER_ID,
          releaseSchemaVersion: ULTIMATE_B2_PRODUCT_RELEASE_SCHEMA_VERSION,
          components: compiledMembers.map((entry) => ({ componentSlug: entry.componentSlug, compilerId: entry.compiled.compilerId, releaseSchemaVersion: entry.compiled.releaseSchemaVersion, currentSourceSha256: entry.compiled.sourceSnapshotSha256, ...(entry.compiled.reconciliation ? { reconciliation: entry.compiled.reconciliation } : {}) })),
          headRevision: status.headRevision,
          published: decorate(status.published),
          releases: status.releases.map(decorate),
        });
      }
      if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
      const originError = requireBuilderOrigin(event);
      if (originError) return originError;
      if (parsedRoute.action === "prepare") {
        const parsed = body(event, ["clientMutationId", "releaseNote"]);
        if (parsed.error) return parsed.error;
        if (!builderClientMutationIdPattern.test(parsed.value.clientMutationId) || typeof parsed.value.releaseNote !== "string" || parsed.value.releaseNote.length > 240) return json(400, { error: "invalid_request" });
        if (!pinSchemaReady) return json(409, { error: "release_pin_schema_unavailable" });
        const compiledMembers = await dependencies.compileProduct(sql, configuration, dependencies);
        const storage = prepareStorage(context, dependencies);
        for (const entry of compiledMembers) if (entry.compiled.canonicalAssetSources?.length) {
          await dependencies.materializeCanonical(storage, { bookSlug: parsedRoute.bookSlug, componentSlug: entry.componentSlug, ...entry.compiled, fetchAsset: dependencies.canonicalFetch(context) });
        }
        const pinnedMembers = await Promise.all(compiledMembers.map(async (entry) => ({
          entry,
          pins: await dependencies.freezePins(storage, { bookSlug: parsedRoute.bookSlug, componentSlug: entry.componentSlug, assetManifest: entry.compiled.assetManifest, nativeAssetSources: entry.compiled.nativeAssetSources || [] }),
        })));
        const members = pinnedMembers.map(({ entry, pins }) => ({ ...entry.compiled, componentSlug: entry.componentSlug, releaseId: dependencies.randomUuid(), requestSha256: entry.compiled.releaseSha256, assetStorageMode: "pinned-source-v1", assetPins: pins }));
        const requestSha256 = sha256(stableBuilderJson({ releaseNote: parsed.value.releaseNote, members: members.map((member) => ({ componentSlug: member.componentSlug, sourceSnapshotSha256: member.sourceSnapshotSha256, releaseSha256: member.releaseSha256, pinSha256: member.assetPins.map((pin) => pin.pinSha256) })) }));
        const result = await dependencies.create(sql, {
          productReleaseId: dependencies.randomUuid(),
          bookSlug: parsedRoute.bookSlug,
          compilerId: ULTIMATE_B2_PRODUCT_RELEASE_COMPILER_ID,
          releaseSchemaVersion: ULTIMATE_B2_PRODUCT_RELEASE_SCHEMA_VERSION,
          members,
          requestSha256,
          releaseNote: parsed.value.releaseNote,
          builderUserId: auth.builderUser.id,
          clientMutationId: parsed.value.clientMutationId,
        });
        if (["mutation_id_conflict"].includes(result.outcome)) return json(409, { error: result.outcome });
        if (!['created', 'idempotent'].includes(result.outcome)) return json(result.outcome === "product_not_found" ? 404 : 400, { error: result.outcome });
        const candidateRaw = await dependencies.loadRelease(sql, { bookSlug: parsedRoute.bookSlug, productReleaseId: result.productReleaseId });
        const candidate = withAssetModes(candidateRaw, await dependencies.loadAssetModes(sql, { bookSlug: parsedRoute.bookSlug, productReleaseId: result.productReleaseId }));
        await dependencies.verifyCandidate(sql, candidate, dependencies);
        return json(200, { ...result, idempotent: result.outcome === "idempotent", release: candidate });
      }
      if (parsedRoute.action === "publish") {
        const parsed = body(event, ["productReleaseId", "expectedHeadRevision", "clientMutationId"]);
        if (parsed.error) return parsed.error;
        if (!UUID.test(parsed.value.productReleaseId) || !Number.isSafeInteger(parsed.value.expectedHeadRevision) || parsed.value.expectedHeadRevision < 0 || !builderClientMutationIdPattern.test(parsed.value.clientMutationId)) return json(400, { error: "invalid_request" });
        const candidate = await dependencies.loadRelease(sql, { bookSlug: parsedRoute.bookSlug, productReleaseId: parsed.value.productReleaseId });
        if (!candidate) return json(404, { error: "release_not_found" });
        try { await dependencies.verifyCandidate(sql, candidate, dependencies); } catch { return json(409, { error: "release_integrity_failed" }); }
        if (candidate.compilerId !== ULTIMATE_B2_PRODUCT_RELEASE_COMPILER_ID) return json(409, { error: "legacy_release_read_only" });
        const requestSha256 = sha256(stableBuilderJson({ productReleaseId: parsed.value.productReleaseId, expectedHeadRevision: parsed.value.expectedHeadRevision }));
        const replay = await dependencies.loadMutation(sql, { bookSlug: parsedRoute.bookSlug, clientMutationId: parsed.value.clientMutationId });
        if (!replay && !candidate.current) {
          const compiledMembers = await dependencies.compileProduct(sql, configuration, dependencies);
          const currentSources = new Map(compiledMembers.map((entry) => [entry.componentSlug, entry.compiled.sourceSnapshotSha256]));
          if (candidate.members.some((member) => member.status !== "included" || currentSources.get(member.componentSlug) !== member.sourceSnapshotSha256)) return json(409, { error: "stale_release_preview" });
        }
        const result = await dependencies.publish(sql, { bookSlug: parsedRoute.bookSlug, ...parsed.value, requestSha256, builderUserId: auth.builderUser.id });
        if (["stale_release_preview", "head_conflict", "mutation_id_conflict", "incomplete_product_release"].includes(result.outcome)) return json(409, { error: result.outcome, ...result });
        if (result.outcome === "release_not_found") return json(404, { error: result.outcome });
        if (!["published", "idempotent", "already_active"].includes(result.outcome)) return json(400, { error: result.outcome });
        return json(200, { ...result, idempotent: ["idempotent", "already_active"].includes(result.outcome) });
      }
      return json(404, { error: "publication_route_not_found" });
    } catch (error) {
      dependencies.logger.error("Builder product publication request failed", {
        code: /^[A-Za-z0-9_.-]+$/.test(String(error?.code || error?.message || "")) ? (error.code || error.message) : "unknown",
        ...(error instanceof ComponentPublicationAssetError ? {
          assetId: error.assetId,
          assetRole: error.assetRole,
          assetStage: error.assetStage,
          failureClass: error.failureClass,
          ...(error.providerStatus ? { providerStatus: error.providerStatus } : {}),
          ...(error.providerCode ? { providerCode: error.providerCode } : {}),
        } : {}),
      });
      const safeCode = ["students_book_page_expansion_required", "students_book_page_asset_invalid", "placement_unavailable", "native_activity_not_found", "native_activity_pair_invalid", "native_activity_not_ready", "native_activity_asset_invalid", "managed_page_not_ready", "release_asset_unavailable", "publication_compiler_mismatch", "release_pin_conflict", "release_pin_integrity_failed"].includes(error?.code || error?.message) ? (error.code || error.message) : null;
      return safeCode ? json(409, { error: safeCode, ...(error.activityId ? { activityId: error.activityId } : {}), ...(error.issues?.length ? { issues: error.issues } : {}), ...(error.reconciliation ? { reconciliation: error.reconciliation } : {}) }) : json(500, { error: "builder_product_publication_failed" });
    }
  };
}
