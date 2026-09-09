import { demoBookPackages, inferPackageSlugFromBookId } from "../data/bookPackages.js";
import { isPhaseOneComponentVisible } from "../config/bookCatalogVisibility.js";

export const bookIds = [
  "students-book",
  "workbook",
  "grammar-book",
  "test-book",
  "video-bank",
  "english-journey-6-students-book",
  "english-journey-6-workbook",
  "english-journey-6-grammar-book",
  "english-journey-6-test-book",
  "english-journey-6-video-bank",
];

export const activityKeys = [
  "video-intro",
  "reading-ex3",
  "reading-ex4",
  "listening-page-20",
  "grammar-opening",
  "grammar-ex4",
  "quiz-1",
  "quiz-2",
];

export const mainHashRoutes = {
  home: { view: "home" },
  "/home": { view: "home" },
  "/": { view: "courses", role: "student", section: "books", selectedPackageSlug: null },
  "/courses": { view: "courses", role: "student", section: "books", selectedPackageSlug: null },
  courses: { view: "courses", role: "student", section: "books", selectedPackageSlug: null },
  flow: { view: "flow" },
  "/flow": { view: "flow" },
  "auth-student": { view: "auth-student", role: "student" },
  "auth-teacher": { view: "auth-teacher", role: "teacher" },
  "auth-admin": { view: "auth-admin", role: "admin" },
  student: { view: "student", role: "student", section: "dashboard" },
  "/student": { view: "student", role: "student", section: "dashboard" },
  "student-dashboard": { view: "student", role: "student", section: "dashboard" },
  "/student/dashboard": { view: "student", role: "student", section: "dashboard" },
  "student-books": { view: "student-books", role: "student", section: "books" },
  "/student/books": { view: "student-books", role: "student", section: "books" },
  "student-assignments": { view: "student-assignments", role: "student", section: "assignments" },
  "/student/assignments": { view: "student-assignments", role: "student", section: "assignments" },
  "student-grades": { view: "student-grades", role: "student", section: "grades" },
  "/student/grades": { view: "student-grades", role: "student", section: "grades" },
  "student-activity": { view: "student-activity", role: "student", section: "activity", activityKey: "reading-ex3", mode: "student" },
  "student-course": { view: "student-course", role: "student", section: "course" },
  "student-preview": { view: "student-preview", role: "student", section: "preview" },
  teacher: { view: "teacher", role: "teacher", section: "dashboard" },
  "/teacher": { view: "teacher", role: "teacher", section: "dashboard" },
  "teacher-dashboard": { view: "teacher", role: "teacher", section: "dashboard" },
  "/teacher/dashboard": { view: "teacher", role: "teacher", section: "dashboard" },
  "teacher-books": { view: "teacher-books", role: "teacher", section: "books" },
  "/teacher/books": { view: "teacher-books", role: "teacher", section: "books" },
  "teacher-classes": { view: "teacher-classes", role: "teacher", section: "classes" },
  "teacher-students": { view: "teacher-students", role: "teacher", section: "students" },
  "/teacher/students": { view: "teacher-students", role: "teacher", section: "students" },
  "teacher-assignments": { view: "teacher-assignments", role: "teacher", section: "assignments" },
  "teacher-custom-assignment": { view: "teacher-custom-assignment", role: "teacher", section: "custom-assignment" },
  "/teacher/custom-assignment": { view: "teacher-custom-assignment", role: "teacher", section: "custom-assignment" },
  "teacher-course-editor": { view: "teacher-course-editor", role: "teacher", section: "custom-assignment" },
  admin: { view: "admin", role: "admin", section: "overview" },
  "/admin": { view: "admin", role: "admin", section: "overview" },
  "admin-overview": { view: "admin", role: "admin", section: "overview" },
  "admin-school-setup": { view: "admin-school-setup", role: "admin", section: "school-setup" },
  "admin-users": { view: "admin-users", role: "admin", section: "users" },
  "admin-books-classes": { view: "admin-books-classes", role: "admin", section: "books-classes" },
  "admin-publisher-intelligence": { view: "admin-publisher-intelligence", role: "admin", section: "publisher-intelligence" },
  "admin-integrations": { view: "admin-integrations", role: "admin", section: "integrations" },
};

function cleanHash(hash = "") {
  return decodeURIComponent(String(hash || "").replace(/^#/, "").trim());
}

function withLeadingSlash(hash = "") {
  const cleaned = cleanHash(hash);
  if (!cleaned || cleaned === "/") return "/";
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

function matchBookPageRoute(hash = "") {
  const normalizedHash = withLeadingSlash(hash);
  const courseMatch = normalizedHash.match(/^\/courses\/([^/]+)\/components\/([^/]+)\/(pages|flipbook)\/([^/]+)$/);
  if (courseMatch) {
    return {
      role: "student",
      packageSlug: courseMatch[1],
      componentSlug: courseMatch[2],
      subview: courseMatch[3],
      pageToken: courseMatch[4],
    };
  }

  const teacherMatch = normalizedHash.match(/^\/teacher\/books\/([^/]+)\/components\/([^/]+)\/(pages|flipbook)\/([^/]+)$/);
  if (teacherMatch) {
    return {
      role: "teacher",
      packageSlug: teacherMatch[1],
      componentSlug: teacherMatch[2],
      subview: teacherMatch[3],
      pageToken: teacherMatch[4],
    };
  }

  const legacyBookMatch = normalizedHash.match(/^\/(student|teacher)-book-([^/]+)\/pages\/([^/]+)\/([^/]+)$/);
  if (legacyBookMatch) {
    return {
      role: legacyBookMatch[1],
      packageSlug: "",
      componentSlug: legacyBookMatch[2],
      subview: "pages",
      pageToken: `${legacyBookMatch[3]}/${legacyBookMatch[4]}`,
    };
  }

  return null;
}

export function isSameBookPageRoute(previousHash = "", nextHash = "") {
  const previousRoute = matchBookPageRoute(previousHash);
  const nextRoute = matchBookPageRoute(nextHash);
  if (!previousRoute || !nextRoute) return false;

  return (
    previousRoute.role === nextRoute.role &&
    previousRoute.packageSlug === nextRoute.packageSlug &&
    previousRoute.componentSlug === nextRoute.componentSlug &&
    previousRoute.subview === nextRoute.subview &&
    previousRoute.pageToken !== nextRoute.pageToken
  );
}

export function slugifyRoute(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function slugifyClassName(className = "") {
  return slugifyRoute(className);
}

export function getPackageRouteSlug(bookPackage = {}) {
  return bookPackage.slug || bookPackage.id || slugifyRoute(bookPackage.packageTitle);
}

export function getComponentRouteSlug(component = {}) {
  return component.routeSlug || component.slug || component.id || slugifyRoute(component.title || component.type);
}

export function getExerciseRouteSlug(exercise = {}) {
  return exercise.stableActivityId || exercise.activityKey || exercise.demoActivityKey || exercise.id || slugifyRoute(exercise.title);
}

export function findBookPackageBySlug(courseSlug = "") {
  const normalized = slugifyRoute(courseSlug);
  return demoBookPackages.find((bookPackage) => {
    const candidates = [
      bookPackage.slug,
      bookPackage.id,
      bookPackage.packageTitle,
      bookPackage.packageLabel,
    ].map(slugifyRoute);
    return candidates.includes(normalized);
  }) || null;
}

function componentAliases(component = {}, bookPackage = {}) {
  return [
    component.id,
    component.slug,
    component.routeSlug,
    component.componentType,
    component.component_type,
    component.type,
    component.title,
    `${getPackageRouteSlug(bookPackage)}-${component.id || ""}`,
    `${getPackageRouteSlug(bookPackage)}-${component.slug || ""}`,
  ].map(slugifyRoute).filter(Boolean);
}

export function findComponentByRouteSlug(bookPackage = {}, componentSlug = "") {
  const normalized = slugifyRoute(componentSlug);
  return bookPackage?.components?.find((component) => (
    isPhaseOneComponentVisible(bookPackage, component)
    && componentAliases(component, bookPackage).includes(normalized)
  )) || null;
}

function getComponentExercises(component = {}) {
  return (component.units || []).flatMap((unit) => (
    (unit.lessons || []).flatMap((lesson) => lesson.exercises || [])
  ));
}

export function findExerciseByRouteSlug(component = {}, exerciseSlug = "") {
  const normalized = slugifyRoute(exerciseSlug);
  return getComponentExercises(component).find((exercise) => {
    const candidates = [
      exercise.id,
      exercise.stableActivityId,
      exercise.activityKey,
      exercise.demoActivityKey,
      ...(exercise.aliases || []),
      exercise.title,
      `exercise-${exercise.id}`,
      `exercise-${exercise.stableActivityId}`,
      `exercise-${exercise.activityKey}`,
      `exercise-${exercise.demoActivityKey}`,
    ].map(slugifyRoute);
    return candidates.includes(normalized);
  }) || null;
}

export function findPageByRouteToken(component = {}, pageToken = "") {
  const normalized = slugifyRoute(pageToken);
  const pages = (component.pageUnits || []).flatMap((unit) => (
    (unit.pages || []).map((page, index) => ({
      unit,
      page,
      localNumber: index + 1,
    }))
  ));
  const numericPage = Number(pageToken);

  if (Number.isInteger(numericPage) && numericPage > 0) {
    return pages.find(({ page }) => Number(page.pageNumber || page.number) === numericPage) || pages[numericPage - 1] || null;
  }

  return pages.find(({ page, localNumber }) => {
    const candidates = [
      page.id,
      page.slug,
      page.title,
      page.label,
      String(page.pageNumber || ""),
      String(localNumber),
    ].map(slugifyRoute);
    return candidates.includes(normalized);
  }) || null;
}

export function buildCourseHash(courseSlug = "") {
  return courseSlug ? `/courses/${slugifyRoute(courseSlug)}` : "/courses";
}

export function buildCourseComponentsHash(courseSlug = "") {
  return `${buildCourseHash(courseSlug)}/components`;
}

export function buildCourseComponentHash(courseSlug = "", componentSlug = "") {
  return `${buildCourseComponentsHash(courseSlug)}/${slugifyRoute(componentSlug)}`;
}

export function buildCourseComponentSubviewHash(courseSlug = "", componentSlug = "", subview = "exercises") {
  return `${buildCourseComponentHash(courseSlug, componentSlug)}/${slugifyRoute(subview)}`;
}

export function buildCourseExerciseHash(courseSlug = "", componentSlug = "", exerciseSlug = "") {
  return `${buildCourseComponentSubviewHash(courseSlug, componentSlug, "exercises")}/${slugifyRoute(exerciseSlug)}`;
}

export function buildCoursePageHash(courseSlug = "", componentSlug = "", pageToken = "") {
  return `${buildCourseComponentSubviewHash(courseSlug, componentSlug, "pages")}/${slugifyRoute(pageToken)}`;
}

export function buildTeacherSectionHash(section = "dashboard", itemId = "") {
  const normalizedSection = slugifyRoute(section);
  if (!normalizedSection || normalizedSection === "dashboard") return "/teacher";
  return itemId ? `/teacher/${normalizedSection}/${slugifyRoute(itemId)}` : `/teacher/${normalizedSection}`;
}

export function buildStudentSectionHash(section = "dashboard") {
  const normalizedSection = slugifyRoute(section);
  if (!normalizedSection || normalizedSection === "dashboard") return "/student";
  if (normalizedSection === "books") return "/courses";
  return `/student/${normalizedSection}`;
}

export function buildBookHash(role, bookId) {
  const packageSlug = inferPackageSlugFromBookId(bookId);
  if (role === "teacher") return `/teacher/books/${slugifyRoute(packageSlug)}/components/${slugifyRoute(bookId)}`;
  return buildCourseComponentHash(packageSlug, bookId);
}

export function buildBookPageHash(role, bookId, pageUnitId, pageId) {
  const packageSlug = inferPackageSlugFromBookId(bookId);
  const pageToken = pageId || pageUnitId;
  if (role === "teacher") {
    return `/teacher/books/${slugifyRoute(packageSlug)}/components/${slugifyRoute(bookId)}/pages/${slugifyRoute(pageToken)}`;
  }
  return buildCoursePageHash(packageSlug, bookId, pageToken);
}

export function buildActivityHash(activityKey, mode = "student") {
  if (mode === "teacher-preview") return `teacher-preview-${activityKey}`;
  if (mode === "teacher-presentation") return buildTeacherPresentationHash(activityKey);
  return `activity-${activityKey}`;
}

export function buildStudentAssignmentHash(assignmentId = "") {
  return `/student/assignments/${encodeURIComponent(String(assignmentId || ""))}`;
}

export function buildTeacherAssignmentReviewHash(assignmentId = "") {
  return `/teacher/assignments/${encodeURIComponent(String(assignmentId || ""))}/review`;
}

export function buildTeacherPresentationHash(activityKey, packageSlug = "ultimate-b2", componentSlug = "students-book") {
  return `/teacher/books/${slugifyRoute(packageSlug)}/components/${slugifyRoute(componentSlug)}/activities/${slugifyRoute(activityKey)}/presentation`;
}

export function buildClassInviteHash(classItem = {}) {
  const slug = classItem.inviteCode || classItem.invite_code || classItem.slug || classItem.classSlug || slugifyClassName(classItem.name);
  return `join-class/${slug}`;
}

export function buildClassInviteUrl(classItem = {}) {
  const hash = buildClassInviteHash(classItem);
  if (typeof window === "undefined") return `/#${hash}`;
  return `${window.location.origin}${window.location.pathname}${window.location.search}#${hash}`;
}

function baseRoute(hashView, route) {
  return {
    hash: hashView,
    selectedBookId: null,
    selectedPackageSlug: null,
    selectedBookSubview: null,
    selectedPageUnitId: null,
    selectedPageId: null,
    selectedPageNumber: null,
    selectedAssignmentId: null,
    selectedClassSlug: null,
    activityKey: null,
    mode: route.role || "student",
    valid: true,
    ...route,
  };
}

function publishedManagedPageId(packageSlug, component, pageToken = "") {
  // Managed page IDs are URL state, not proof of publication or access. The
  // published Interactive validates them against the selected immutable release.
  if (packageSlug !== "ultimate-b2") return null;
  const componentSlug = getComponentRouteSlug(component || {});
  if (["students-book", "ultimate-b2-students-book"].includes(componentSlug)) {
    return /^sb-page-[a-f0-9]{32}$/.test(pageToken) ? pageToken : null;
  }
  if (["workbook", "ultimate-b2-workbook"].includes(componentSlug)) {
    return /^wb-page-[a-f0-9]{32}$/.test(pageToken) ? pageToken : null;
  }
  return null;
}

function parseCourseRoute(hashView) {
  const parts = hashView.split("/").filter(Boolean);
  if (parts[0] !== "courses") return null;

  if (parts.length === 1) {
    return baseRoute(hashView, { view: "courses", role: "student", section: "books" });
  }

  const bookPackage = findBookPackageBySlug(parts[1]);
  if (!bookPackage) return null;
  const packageSlug = getPackageRouteSlug(bookPackage);

  if (parts.length === 2) {
    return baseRoute(hashView, { view: "courses", role: "student", section: "books", selectedPackageSlug: packageSlug });
  }

  if (parts[2] !== "components") return null;
  if (parts.length === 3) {
    return baseRoute(hashView, { view: "courses", role: "student", section: "books", selectedPackageSlug: packageSlug });
  }

  const component = findComponentByRouteSlug(bookPackage, parts[3]);
  if (!component) return null;
  const componentSlug = getComponentRouteSlug(component);
  const selectedBookId = componentSlug;

  if (parts.length === 4) {
    return baseRoute(hashView, {
      view: "courses",
      role: "student",
      section: "books",
      selectedPackageSlug: packageSlug,
      selectedBookId,
      selectedBookSubview: "exercises",
    });
  }

  const subview = parts[4];
  if (!["exercises", "pages", "flipbook"].includes(subview)) return null;

  if (subview === "exercises" && parts[5]) {
    const exercise = findExerciseByRouteSlug(component, parts[5]);
    if (!exercise) return null;
    return baseRoute(hashView, {
      view: "student-activity",
      role: "student",
      section: "activity",
      selectedPackageSlug: packageSlug,
      selectedBookId,
      selectedBookSubview: "exercises",
      activityKey: exercise.stableActivityId || exercise.activityKey || exercise.demoActivityKey || exercise.id,
      mode: "student",
    });
  }

  if ((subview === "pages" || subview === "flipbook") && parts[5]) {
    const pageMatch = findPageByRouteToken(component, parts[5]);
    const publishedPageId = parts.length === 6 ? publishedManagedPageId(packageSlug, component, parts[5]) : null;
    if (component.pageUnits?.length && !pageMatch && !publishedPageId) return null;
    return baseRoute(hashView, {
      view: "courses",
      role: "student",
      section: "books",
      selectedPackageSlug: packageSlug,
      selectedBookId,
      selectedBookSubview: subview,
      selectedPageUnitId: pageMatch?.unit?.id || null,
      selectedPageId: publishedPageId || pageMatch?.page?.id || null,
      selectedPageNumber: Number.isInteger(Number(parts[5])) ? Number(parts[5]) : null,
    });
  }

  if (parts.length === 5) {
    return baseRoute(hashView, {
      view: "courses",
      role: "student",
      section: "books",
      selectedPackageSlug: packageSlug,
      selectedBookId,
      selectedBookSubview: subview,
    });
  }

  return null;
}

function parseStudentRoute(hashView) {
  const parts = hashView.split("/").filter(Boolean);
  if (parts[0] !== "student") return null;
  if (parts[1] !== "assignments" || parts.length < 3) return null;
  if (parts.length !== 3 || !parts[2]) return null;
  return baseRoute(hashView, {
    view: "student-assignment",
    role: "student",
    section: "assignment",
    selectedAssignmentId: parts[2],
  });
}

function parseTeacherRoute(hashView) {
  const parts = hashView.split("/").filter(Boolean);
  if (parts[0] !== "teacher") return null;
  if (parts.length === 1) return baseRoute(hashView, { view: "teacher", role: "teacher", section: "dashboard" });

  const section = parts[1];
  if (section === "assignments") {
    return baseRoute(hashView, {
      view: "teacher-assignments",
      role: "teacher",
      section: "assignments",
      selectedAssignmentId: parts[2] || null,
      routeAction: parts[2] === "new" ? "new" : parts[3] === "review" ? "review" : null,
    });
  }

  if (section === "classes") {
    return baseRoute(hashView, {
      view: "teacher-classes",
      role: "teacher",
      section: "classes",
      selectedClassSlug: parts[2] && parts[2] !== "new" ? parts[2] : null,
      routeAction: parts[2] === "new" ? "new" : null,
    });
  }

  if (section === "books") {
    const bookPackage = parts[2] ? findBookPackageBySlug(parts[2]) : null;
    const packageSlug = bookPackage ? getPackageRouteSlug(bookPackage) : null;
    const component = bookPackage && parts[4] ? findComponentByRouteSlug(bookPackage, parts[4]) : null;
    if (parts[2] && !bookPackage) return null;
    if (parts[3] && parts[3] !== "components") return null;
    if (parts[4] && !component) return null;

    if (component && parts[5] === "activities" && parts[6] && parts[7] === "presentation" && parts.length === 8) {
      const exercise = findExerciseByRouteSlug(component, parts[6]);
      const enabled = exercise
        && exercise.availability !== "disabled"
        && exercise.implementationMode !== "unsupported-disabled"
        && exercise.implementationStatus !== "disabled-editorial-only";
      if (!enabled) return null;
      return baseRoute(hashView, {
        view: "teacher-presentation",
        role: "teacher",
        section: "books",
        selectedPackageSlug: packageSlug,
        selectedBookId: getComponentRouteSlug(component),
        selectedBookSubview: "exercises",
        activityKey: exercise.stableActivityId || exercise.activityKey || exercise.demoActivityKey || exercise.id,
        mode: "teacher-presentation",
      });
    }

    const subview = parts[5] || (component ? "exercises" : null);
    if (subview && !["exercises", "pages", "flipbook"].includes(subview)) return null;
    const pageMatch = component && parts[6] ? findPageByRouteToken(component, parts[6]) : null;
    const publishedPageId = parts.length === 7 && (subview === "pages" || subview === "flipbook") ? publishedManagedPageId(packageSlug, component, parts[6]) : null;
    if (component?.pageUnits?.length && parts[6] && !pageMatch && !publishedPageId) return null;
    return baseRoute(hashView, {
      view: "teacher-books",
      role: "teacher",
      section: "books",
      selectedPackageSlug: packageSlug,
      selectedBookId: component ? getComponentRouteSlug(component) : null,
      selectedBookSubview: subview,
      selectedPageUnitId: pageMatch?.unit?.id || null,
      selectedPageId: publishedPageId || pageMatch?.page?.id || null,
    });
  }

  return mainHashRoutes[hashView] ? baseRoute(hashView, mainHashRoutes[hashView]) : null;
}

export function getBookFromHash(hash) {
  const hashView = cleanHash(hash);
  const bookMatch = hashView.match(/^(student|teacher)-book-([^/]+)(?:\/pages\/([^/]+)\/([^/]+))?$/);
  if (!bookMatch || !bookIds.includes(bookMatch[2])) return null;

  return {
    role: bookMatch[1],
    selectedBookId: bookMatch[2],
    selectedPageUnitId: bookMatch[3] || null,
    selectedPageId: bookMatch[4] || null,
  };
}

export function getActivityFromHash(hash) {
  const hashView = cleanHash(hash);
  const studentMatch = hashView.match(/^activity-(.+)$/);
  if (studentMatch && (activityKeys.includes(studentMatch[1]) || /^ultimate-b2-sb-u[12]-p\d+-o\d+$/.test(studentMatch[1]))) {
    return { activityKey: studentMatch[1], mode: "student", role: "student" };
  }

  const teacherMatch = hashView.match(/^teacher-preview-(.+)$/);
  if (teacherMatch && (activityKeys.includes(teacherMatch[1]) || /^ultimate-b2-sb-u[12]-p\d+-o\d+$/.test(teacherMatch[1]))) {
    return { activityKey: teacherMatch[1], mode: "teacher-preview", role: "teacher" };
  }

  return null;
}

export function parseHashRoute(hash = "") {
  const rawHashView = cleanHash(hash);
  const hashView = rawHashView ? withLeadingSlash(rawHashView) : "/";
  const legacyHashView = rawHashView || "home";

  const accountMatch = rawHashView.match(/^\/?(accept-invitation|reset-password|account-security)(?:\?(.*))?$/);
  if (accountMatch) {
    return baseRoute(rawHashView, {
      view: accountMatch[1],
      accountToken: new URLSearchParams(accountMatch[2] || "").get("token") || "",
      role: "account",
    });
  }

  const joinClassMatch = rawHashView.match(/^join-class\/([^/]+)$/) || hashView.match(/^\/join-class\/([^/]+)$/);
  if (joinClassMatch) {
    return baseRoute(rawHashView || hashView, {
      view: "join-class",
      classSlug: joinClassMatch[1],
      mode: "student",
      role: "student",
    });
  }

  const courseRoute = parseCourseRoute(hashView);
  if (courseRoute) return courseRoute;

  const studentRoute = parseStudentRoute(hashView);
  if (studentRoute) return studentRoute;

  const teacherRoute = parseTeacherRoute(hashView);
  if (teacherRoute) return teacherRoute;

  const bookRoute = getBookFromHash(rawHashView);
  if (bookRoute) {
    const packageSlug = inferPackageSlugFromBookId(bookRoute.selectedBookId);
    return baseRoute(rawHashView, {
      view: `${bookRoute.role}-books`,
      role: bookRoute.role,
      section: "books",
      selectedPackageSlug: packageSlug,
      selectedBookId: bookRoute.selectedBookId,
      selectedBookSubview: bookRoute.selectedPageId ? "pages" : "exercises",
      selectedPageUnitId: bookRoute.selectedPageUnitId,
      selectedPageId: bookRoute.selectedPageId,
      mode: bookRoute.role,
    });
  }

  const activityRoute = getActivityFromHash(rawHashView);
  if (activityRoute) {
    return baseRoute(rawHashView, {
      view: activityRoute.role === "teacher" ? "teacher-books" : "student-activity",
      role: activityRoute.role,
      section: activityRoute.role === "teacher" ? "books" : "activity",
      mode: activityRoute.mode,
      activityKey: activityRoute.activityKey,
    });
  }

  const mainRoute = mainHashRoutes[hashView] || mainHashRoutes[legacyHashView];
  if (mainRoute) return baseRoute(hashView === "/" ? "/" : (mainHashRoutes[hashView] ? hashView : legacyHashView), mainRoute);

  return {
    hash: rawHashView || hashView,
    attemptedHash: rawHashView || hashView,
    view: "invalid-route",
    selectedBookId: null,
    selectedPackageSlug: null,
    selectedBookSubview: null,
    selectedPageUnitId: null,
    selectedPageId: null,
    selectedPageNumber: null,
    activityKey: null,
    mode: "student",
    valid: false,
  };
}
