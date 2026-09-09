import { getDemoBookPackage, mergeBookPackageWithDemoFallback, normalizeBookPackageKey } from "../data/bookPackages.js";
import { applyStudentsBookCatalog } from "../data/ultimate-b2/studentsBookCatalog.js";
import { databaseActivityPresentation } from "./bookActivityPresentation.js";

const jsonHeaders = { "Content-Type": "application/json" };

const componentTypeLabels = {
  students_book: "Students Book",
  workbook: "Workbook",
  grammar_book: "Grammar Book",
  test_book: "Test Book",
  video_bank: "Video Bank",
};

const coverTones = {
  students_book: "orange",
  workbook: "blue",
  grammar_book: "green",
  test_book: "slate",
  video_bank: "purple",
};

const activityTypeLabels = {
  media_video: "Video",
  reading_multiple_choice: "Multiple choice",
  reading_evidence: "Evidence",
  listening_multiple_choice: "Listening",
  listening_gap_fill: "Typed gap-fill",
  typed_gap_fill: "Typed gap-fill",
  audio_gap_fill: "Typed gap-fill",
  grammar_gap_fill: "Gap fill",
  grammar_multiple_choice: "Grammar",
  sentence_transformation: "Sentence transformation",
  typed_sentence_joining: "Sentence joining",
  grammar_sentence_joining: "Sentence joining",
  timed_quiz: "Timed test",
  writing: "Writing",
  matching: "Matching",
  imported_air_resource: "Imported AIR resource",
};

async function parseJsonResponse(response) {
  const responseText = await response.text();
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const serverMessage = payload.detail || payload.details || payload.error || responseText || "Book content API request failed";
    const error = new Error(`Book content API request failed (${response.status}): ${serverMessage}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: jsonHeaders,
    ...options,
  });
  return parseJsonResponse(response);
}

function normalizeDbActivity(activity, component, unit, lesson) {
  const contentJson = activity.contentJson || activity.content_json || {};
  const activityType = activity.activityType || activity.activity_type;
  const presentation = databaseActivityPresentation(activity);

  return {
    id: activity.id,
    slug: activity.slug,
    title: activity.title.replace(/^Unit 2 Reading /, "").replace(/^Workbook page 20 Listening Exercise$/, "Workbook page 20"),
    component: componentTypeLabels[component.componentType || component.component_type] || component.title,
    unit: unit.title,
    lesson: lesson.lessonType || lesson.lesson_type || lesson.title,
    skill: lesson.lessonType || lesson.lesson_type || activityTypeLabels[activityType] || "Activity",
    type: activityTypeLabels[activityType] || activityType,
    activityType,
    activity_type: activityType,
    estimatedTime: presentation.estimatedTime,
    timerSeconds: activity.timerSeconds || activity.timer_seconds || null,
    sortOrder: activity.sortOrder ?? activity.sort_order ?? activity.position,
    mediaAssetPath: activity.mediaAssetPath || activity.media_asset_path || null,
    contentJson,
    content_json: contentJson,
    settingsJson: activity.settingsJson || activity.settings_json || {},
    settings_json: activity.settingsJson || activity.settings_json || {},
    questions: activity.questions || [],
    assignable: activity.isAssignable ?? activity.is_assignable ?? true,
    isAssignable: activity.isAssignable ?? activity.is_assignable ?? true,
    availableToStudent: true,
    status: presentation.status,
    demoActivityKey: contentJson.demoActivityKey || activity.demoActivityKey || activity.slug,
    description: activity.instructions || "Structured digital book exercise from the database-backed content model.",
    dbActivity: activity,
  };
}

export function normalizeBookPackageTree(bookPackage) {
  const packageIdentity = normalizeBookPackageKey(bookPackage);
  const fallbackPackage = getDemoBookPackage(packageIdentity || bookPackage?.slug || bookPackage?.id);
  if (!bookPackage) return null;
  if (!bookPackage.components?.length) return fallbackPackage || bookPackage;

  const normalizedPackage = {
    ...(fallbackPackage || {}),
    id: bookPackage.id,
    slug: packageIdentity || bookPackage.slug,
    packageTitle: bookPackage.packageTitle || bookPackage.title,
    packageLabel: bookPackage.packageLabel || `${bookPackage.title} package`,
    level: bookPackage.level,
    publisher: bookPackage.publisher,
    description: bookPackage.description,
    source: "database",
    components: bookPackage.components.map((component) => {
      const normalizedComponent = {
        id: component.id,
        slug: component.slug,
        title: component.title,
        subtitle: `${componentTypeLabels[component.componentType || component.component_type] || "Book component"} / ${component.legacyDiscoveryAllowed === false ? "Published Interactive" : "structured activities"}`,
        type: componentTypeLabels[component.componentType || component.component_type] || component.componentType || component.component_type,
        componentType: component.componentType || component.component_type,
        sortOrder: component.sortOrder ?? component.sort_order,
        coverTone: coverTones[component.componentType || component.component_type] || "orange",
        coverAssetPath: component.coverAssetPath || component.cover_asset_path,
        legacyDiscoveryAllowed: component.legacyDiscoveryAllowed !== false,
        units: (component.legacyDiscoveryAllowed === false ? [] : component.units || []).map((unit) => ({
          id: unit.id,
          slug: unit.slug,
          title: unit.title === "Unit 2" && component.componentType === "students_book" ? "Unit 2 Reading" : unit.title,
          unit: unit.title,
          unitNumber: unit.unitNumber ?? unit.unit_number,
          sortOrder: unit.sortOrder ?? unit.sort_order,
          lessons: (unit.lessons || []).map((lesson) => ({
            id: lesson.id,
            slug: lesson.slug,
            title: lesson.title,
            lessonType: lesson.lessonType || lesson.lesson_type,
            sortOrder: lesson.sortOrder ?? lesson.sort_order ?? lesson.position,
            exercises: (lesson.exercises || []).map((activity) => normalizeDbActivity(activity, component, unit, lesson)),
          })),
        })),
      };
      return packageIdentity === "ultimate-b2"
        && (component.componentType || component.component_type) === "students_book"
        && component.slug === "ultimate-b2-students-book"
        ? applyStudentsBookCatalog(normalizedComponent, normalizedComponent.units)
        : normalizedComponent;
    }),
  };
  return mergeBookPackageWithDemoFallback(normalizedPackage);
}

export async function listBookPackages() {
  const payload = await request("/.netlify/functions/book-content?action=list");
  return payload.bookPackages || [];
}

export async function listAuthorizedBookPackageTrees() {
  const packages = await listBookPackages();
  return Promise.all(packages.map((bookPackage) => getBookPackageTree(bookPackage.id || bookPackage.slug)));
}

export async function getBookPackage(slugOrId = "ultimate-b2") {
  return getBookPackageTree(slugOrId);
}

export async function getBookComponent(componentIdOrSlug, packageSlug = "ultimate-b2") {
  const tree = await getBookPackageTree(packageSlug);
  return tree.components.find((component) => component.id === componentIdOrSlug || component.slug === componentIdOrSlug) || null;
}

export async function getBookPackageTree(slugOrId = "ultimate-b2") {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(slugOrId);
  const query = isUuid ? `packageId=${encodeURIComponent(slugOrId)}` : `slug=${encodeURIComponent(slugOrId)}`;
  const payload = await request(`/.netlify/functions/book-content?action=tree&${query}`);
  return normalizeBookPackageTree(payload.bookPackage);
}

export async function getBookPackageTreeWithFallback(slugOrId = "ultimate-b2") {
  return getBookPackageTree(slugOrId);
}

export async function getActivity(activityIdOrSlug) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(activityIdOrSlug);
  const query = isUuid ? `activityId=${encodeURIComponent(activityIdOrSlug)}` : `activitySlug=${encodeURIComponent(activityIdOrSlug)}`;
  const payload = await request(`/.netlify/functions/book-content?action=activity&${query}`);
  return payload.activity;
}

export async function getTeacherActivitySolutions(stableActivityId, { signal } = {}) {
  const payload = await request(
    `/.netlify/functions/book-content?action=teacher-activity-solutions&stableActivityId=${encodeURIComponent(stableActivityId)}`,
    {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    },
  );
  return payload.solution;
}

export async function listUserBookAccess(userId) {
  const payload = await request(`/.netlify/functions/book-content?action=access&userId=${encodeURIComponent(userId)}`);
  return payload.bookAccess || [];
}

export async function assignActivityToClass(activityId, classId, teacherId) {
  const payload = await request("/.netlify/functions/book-content?action=assign", {
    method: "POST",
    body: JSON.stringify({ activityId, classId, teacherId }),
  });
  return payload.assignment;
}

export async function listAssignmentsForStudent(studentId) {
  const payload = await request(`/.netlify/functions/book-content?action=assignments&studentId=${encodeURIComponent(studentId)}`);
  return payload.assignments || [];
}

export async function submitActivity(activityId, studentId, answers, assignmentId = null) {
  const payload = await request("/.netlify/functions/book-content?action=submit", {
    method: "POST",
    body: JSON.stringify({ activityId, studentId, answers, assignmentId }),
  });
  return payload.submission;
}

export async function getStudentGrades(studentId) {
  const payload = await request(`/.netlify/functions/book-content?action=grades&studentId=${encodeURIComponent(studentId)}`);
  return payload.grades || [];
}
