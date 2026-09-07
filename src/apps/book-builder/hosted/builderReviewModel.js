const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeId(value, label) {
  const normalized = String(value || "");
  if (!SAFE_ID.test(normalized)) throw new TypeError(`${label} is invalid.`);
  return normalized;
}

export function pageReviewIntent(page, productReleaseId = null) {
  const unitNumber = Number(page?.unitNumber);
  if (!Number.isInteger(unitNumber) || unitNumber < 1 || unitNumber > 99) throw new TypeError("Review unit number is invalid.");
  const intent = { view: "page", unitNumber, pageId: safeId(page?.pageId, "Review page ID") };
  if (productReleaseId !== null) {
    if (!UUID.test(String(productReleaseId || ""))) throw new TypeError("Review product release ID is invalid.");
    intent.productReleaseId = String(productReleaseId).toLowerCase();
  }
  return intent;
}

export function activityReviewIntent(activityId, page = null) {
  const intent = { view: "activity", activityId: safeId(activityId, "Review activity ID") };
  if (page) {
    const unitNumber = Number(page.unitNumber);
    if (!Number.isInteger(unitNumber) || unitNumber < 1 || unitNumber > 99) throw new TypeError("Review unit number is invalid.");
    intent.unitNumber = unitNumber;
    intent.pageId = safeId(page.pageId, "Review page ID");
  }
  return intent;
}

export function productDraftReviewIntent() {
  return Object.freeze({ view: "library" });
}

export function resolveUnifiedReviewIntent({ sourceMode, page, release }) {
  if (sourceMode === "release") {
    if (!release) return null;
    return pageReviewIntent(page, release.productReleaseId || release.id);
  }
  return productDraftReviewIntent();
}

function safeIssues(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((issue) => String(issue || "").trim().slice(0, 200)).filter(Boolean))]
    : [];
}

export function publicationReadinessPresentation(error) {
  const code = String(error?.code || error?.payload?.error || "");
  if (!code.startsWith("native_activity_") && code !== "placement_unavailable") return null;
  const activityId = SAFE_ID.test(String(error?.payload?.activityId || "")) ? String(error.payload.activityId) : null;
  const issues = safeIssues(error?.payload?.issues);
  return {
    title: "Publication blocked",
    activityId,
    issues: issues.length ? issues : [code === "placement_unavailable" ? "A linked activity refers to an unavailable page." : "The referenced native activity is not ready to publish."],
  };
}
