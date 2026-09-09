import { buildBuilderPageAssetObjectKey } from "../../lib/book-assets/object-keys.js";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { compileUltimateB2ManagedComponentRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-managed-publication-compiler.js";
import { resolveNativeActivityKind } from "../../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { createNativeOpenResponseQuestion } from "../../src/data/native-activities/nativeOpenResponse.js";
import { nativeChildIdFromUuid } from "../../src/data/native-activities/nativeChildIdentity.js";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createBuilderPagesHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-pages.js";

export const publishedManagedPageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZLsAAAAASUVORK5CYII=", "base64");
export const publishedManagedPageSha256 = createHash("sha256").update(publishedManagedPageBytes).digest("hex");

const source = (payload) => ({ payload, revision: 1, sha256: builderDocumentSha256(payload) });
export function publishedManagedBookFixture(componentSlug = "ultimate-b2-workbook", { pageIds = null, pageLayout = null, unitSortOrders = {}, checksum = publishedManagedPageSha256, byteSize = publishedManagedPageBytes.length, width = 1, height = 1, title = "Explain your answer", teacherAnswer = "PUBLISHED_BOOK_PRIVATE_TEACHER_SENTINEL" } = {}) {
  const prefix = componentSlug === "ultimate-b2-workbook" ? "wb" : "gb";
  const units = Array.from({ length: 10 }, (_, index) => ({ id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, slug: `unit-${index + 1}`, title: `Unit ${index + 1}`, unit_number: index + 1, sort_order: unitSortOrders[index + 1] ?? index + 1 }));
  const layout = pageLayout || [{ unitNumber: 1, sortOrder: 1 }, { unitNumber: 1, sortOrder: 2 }];
  const pages = layout.map(({ unitNumber, sortOrder }, pageIndex) => {
    const number = pageIndex + 1;
    const unit = units.find((entry) => entry.unit_number === unitNumber);
    const pageId = pageIds?.[number - 1] || `${prefix}-page-${number}`;
    return { id: `20000000-0000-4000-8000-${String(number).padStart(12, "0")}`, stable_key: `${componentSlug}/pages/${pageId}`,
      label: `Page ${number}`, sort_order: sortOrder, source_metadata: { is_active: true, section_title: "Vocabulary", printed_label: String(number + 3) },
      unit_id: unit.id, unit_slug: unit.slug, unit_title: unit.title, unit_number: unit.unit_number, unit_sort_order: unit.sort_order,
      asset_id: `30000000-0000-4000-8000-${String(number).padStart(12, "0")}`, asset_role: "page_image",
      object_key: buildBuilderPageAssetObjectKey({ bookSlug: "ultimate-b2", componentSlug, pageId, checksum, extension: ".png" }),
      storage_profile: "private", storage_bucket: "private-assets", publication_status: "draft", access_level: "internal", mime_type: "image/png", byte_size: byteSize, checksum_sha256: checksum, width, height };
  });
  const index = []; const activities = {}; const hotspots = {};
  const kind = resolveNativeActivityKind("open-response");
  for (let number = 1; number <= pages.length; number += 1) {
    const unitNumber = layout[number - 1].unitNumber;
    const pageId = pageIds?.[number - 1] || `${prefix}-page-${number}`;
    const activityId = `ultimate-b2-${prefix}-unit-${unitNumber}-page-${number}-o1`;
    const questionId = nativeChildIdFromUuid("q", `40000000-0000-4000-8000-${String(number).padStart(12, "0")}`);
    const publicDocument = kind.createBlankPublic({ activityId, title: `${title} ${number}`, placement: { pageId } });
    publicDocument.parts[0].interaction.questions = [{ ...createNativeOpenResponseQuestion(questionId), prompt: `Explain question ${number}.` }];
    const teacherDocument = kind.createBlankTeacher({ activityId });
    teacherDocument.parts[0].solution.modelAnswers = [{ questionId, text: teacherAnswer }];
    const entry = { activityId, kind: "open-response", placement: { pageId }, sortOrder: number };
    index.push(entry); activities[activityId] = { index: entry, public: source(publicDocument), teacher: source(teacherDocument) };
    hotspots[pageId] = [{ id: `${prefix}-hotspot-${number}`, pageId, unitNumber, left: 10, top: 20, width: 35, height: 15,
      label: title, actionType: "normalized_activity", activityKey: activityId }];
  }
  const compiled = compileUltimateB2ManagedComponentRelease({ pages: { revision: 1, units, rows: pages },
    documents: { hotspots: source({ schemaVersion: "1.0", packageSlug: "ultimate-b2", componentSlug, pages: hotspots }), activityLifecycle: null },
    native: { index: source({ schemaVersion: "1.0", activities: index }), activities, assetRows: [] } }, componentSlug);
  return compiled;
}

// Exercise the real creation contract with in-memory dependencies. No database,
// storage service, upload, or publication mutation is performed here.
export async function managedPageRouteIds(componentSlug, count = 2) {
  const handler = createBuilderPagesHandler({
    getDatabase: () => ({}),
    authorize: async () => ({ builderUser: { id: "10000000-0000-4000-8000-000000000001" } }),
    prepare: async (_sql, input) => ({ outcome: "prepared", upload_id: input.uploadId, session_state: "prepared", staging_object_key: input.stagingObjectKey }),
    storage: () => ({ signedPutUrl: async () => ({ url: "https://isolated.invalid/upload", headers: {} }) }),
  });
  const ids = [];
  const mutations = ["abcde123-4567-4abc-89ab-0123456789ab", "98765432-abcd-4321-abcd-0123456789ef"];
  for (let index = 0; index < count; index += 1) {
    const clientMutationId = mutations[index] || `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const response = await handler({
      httpMethod: "POST", path: `/builder/api/pages/books/ultimate-b2/components/${componentSlug}/assets/prepare`,
      headers: { host: "builder.example", origin: "https://builder.example", "content-type": "application/json" },
      body: JSON.stringify({ mode: "create", pageId: "", expectedRevision: 0, clientMutationId,
        metadata: { unitId: "10000000-0000-4000-8000-000000000001", label: "Route regression", printedLabel: "", sortOrder: ids.length + 1 },
        file: { name: "synthetic.png", type: "image/png", size: publishedManagedPageBytes.length } }),
    });
    assert.equal(response.statusCode, 200, response.body);
    ids.push(JSON.parse(response.body).pageId);
  }
  return ids;
}

export const workbookOrderingLayout = Object.freeze([
  { unitNumber: 1, sortOrder: 20 }, { unitNumber: 1, sortOrder: 40 },
  { unitNumber: 2, sortOrder: 10 }, { unitNumber: 2, sortOrder: 20 },
  { unitNumber: 3, sortOrder: 5 }, { unitNumber: 3, sortOrder: 5 },
]);
