import { lazy, Suspense, useMemo } from "react";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { AdminView } from "./components/lms/AdminView.jsx";
import { AuthView } from "./components/lms/AuthView.jsx";
import { AccountLifecycleView } from "./components/lms/AccountLifecycleView.jsx";
import { FullDemoFlow } from "./components/lms/FullDemoFlow.jsx";
import { JoinClassView } from "./components/lms/JoinClassView.jsx";
import { RoleSelection } from "./components/lms/RoleSelection.jsx";
import { Card, Header, PageTransition } from "./components/lms/Shared.jsx";
import { AppIntro } from "./components/lms/shared/AppIntro.jsx";
import { StudentCourseView } from "./components/lms/student/StudentCourseView.jsx";
import { StudentPortal } from "./components/lms/student/StudentPortal.jsx";
import { TeacherPortal } from "./components/lms/teacher/TeacherPortal.jsx";
import { TeacherPresentationView } from "./components/lms/activities/ultimate-b2/TeacherPresentationView.jsx";
import houseLogoMark from "./assets/branding/hamilton-house-logo-houseonly.png";
import { dashboardForRole, useAuth } from "./hooks/useAuth.js";
import { useCourseData } from "./hooks/useCourseData.js";
import { useHashView } from "./hooks/useHashView.js";
import { useSchoolBrand } from "./hooks/useSchoolBrand.js";
import { clearPublishedComponentReleaseCache } from "virtual:component-publication";
const EditionClassroom = lazy(() => import("./components/wordlists/EditionClassroom.jsx").then((module) => ({ default: module.EditionClassroom })));

const teacherSectionByView = {
  teacher: "dashboard",
  "teacher-books": "books",
  "teacher-classes": "classes",
  "teacher-students": "students",
  "teacher-assignments": "assignments",
  "teacher-custom-assignment": "custom-assignment",
  "teacher-course-editor": "custom-assignment",
};

const studentSectionByView = {
  courses: "books",
  student: "dashboard",
  "student-books": "books",
  "student-assignments": "assignments",
  "student-assignment": "assignment",
  "student-grades": "grades",
  "student-activity": "activity",
};

const adminSectionByView = {
  admin: "overview",
  "admin-school-setup": "school-setup",
  "admin-users": "users",
  "admin-books-classes": "books-classes",
  "admin-publisher-intelligence": "publisher-intelligence",
  "admin-integrations": "integrations",
};

function transitionGroupForView(view, activityKey = null) {
  if (view === "teacher-presentation") return "teacher-presentation";
  if (activityKey) return "student";
  if (view === "courses") return "student";
  if (view === "invalid-route") return "invalid-route";
  if (adminSectionByView[view]) return "admin";
  if (teacherSectionByView[view]) return "teacher";
  if (studentSectionByView[view]) return "student";
  return view;
}

function InvalidRouteView({ attemptedHash, navigateTo }) {
  return (
    <main className="route-fallback-screen">
      <section className="route-fallback-card">
        <AlertTriangle size={30} />
        <span className="eyebrow">Invalid route</span>
        <h1>This page link is not available.</h1>
        <p>{attemptedHash ? `No screen matches #${attemptedHash}.` : "No screen matches this URL."}</p>
        <button className="primary-action" type="button" onClick={() => navigateTo("/courses")} data-sound-click="back">
          <ArrowLeft size={17} /> Back to course list
        </button>
      </section>
    </main>
  );
}

function AccessGate({ requiredRole, currentUser, authLoading, navigateTo }) {
  const roleLabel = requiredRole === "admin" ? "admin" : requiredRole === "teacher" ? "teacher" : "student";
  if (authLoading) {
    return (
      <main className="route-fallback-screen">
        <Card className="route-fallback-card"><p>Checking current session...</p></Card>
      </main>
    );
  }
  const signedIn = Boolean(currentUser);
  return (
    <main className="route-fallback-screen">
      <Card className="route-fallback-card">
        <AlertTriangle size={30} />
        <span className="eyebrow">{signedIn ? "Access restricted" : "Sign in required"}</span>
        <h1>{signedIn ? "This account does not have access to this area." : "Sign in to continue."}</h1>
        <p>{signedIn ? `You are signed in as ${currentUser.role}. This area requires ${roleLabel} access.` : `This area requires a ${roleLabel} account.`}</p>
        <button className="primary-action" type="button" onClick={() => navigateTo(signedIn ? dashboardForRole(currentUser.role) : `auth-${requiredRole}`)} data-sound-click="submit">
          {signedIn ? "Go to my dashboard" : `Sign in as ${roleLabel}`}
        </button>
      </Card>
    </main>
  );
}

export function canAccessRole(currentUser, requiredRole) {
  return Boolean(currentUser && currentUser.role === requiredRole);
}

export default function App() {
  const {
    view,
    navigateTo,
    activityKey,
    selectedBookId,
    selectedPackageSlug,
    selectedBookSubview,
    selectedPageUnitId,
    selectedPageId,
    selectedPageNumber,
    selectedAssignmentId,
    selectedClassSlug,
    classSlug,
    attemptedHash,
    routeAction,
    accountToken,
    editionContext,
    mode: routeMode,
  } = useHashView();
  const auth = useAuth();
  const {
    brand,
    brandLoading,
    brandError,
    acceptPersistedBrand,
  } = useSchoolBrand(auth.currentUser);
  const courseData = useCourseData();

  const cssVars = useMemo(
    () => ({
      "--brand-primary": brand.primary,
      "--brand-secondary": brand.secondary,
      "--app-watermark-logo": `url(${houseLogoMark})`,
    }),
    [brand],
  );
  const transitionKey = transitionGroupForView(view, activityKey);
  const isTeacherPresentation = view === "teacher-presentation";
  const studentSection = studentSectionByView[view] || (activityKey && routeMode === "student" ? "activity" : null);
  const teacherAccessAllowed = canAccessRole(auth.currentUser, "teacher");
  const adminAccessAllowed = canAccessRole(auth.currentUser, "admin");
  const studentAccessAllowed = canAccessRole(auth.currentUser, "student");
  const authenticatedPortalVisible = Boolean(
    (adminSectionByView[view] && adminAccessAllowed)
    || (teacherSectionByView[view] && teacherAccessAllowed)
    || (studentSection && studentAccessAllowed),
  );

  const signOut = async () => {
    await auth.signOut();
    clearPublishedComponentReleaseCache();
    if (typeof window !== "undefined") window.sessionStorage.removeItem("hhplmsDemoRole");
    courseData.resetCourse();
    navigateTo("home");
  };

  const isRoleView = view !== "home";
  const headerActiveRole = view.startsWith("auth-")
    ? view.replace("auth-", "")
    : view.startsWith("student") || routeMode === "student"
      ? "student"
      : view.startsWith("teacher") || routeMode === "teacher-preview"
        ? "teacher"
        : view.startsWith("admin")
          ? "admin"
          : view;

  const addCourseSubmission = (submission) => {
    courseData.setCourse((current) => ({
      ...current,
      submissions: [submission, ...current.submissions.filter((item) => item.student !== submission.student)],
    }));
  };

  return (
    <div className="hhplms-app" style={cssVars}>
      <AppIntro />
      {isRoleView && !isTeacherPresentation && !authenticatedPortalVisible && (
        <>
          <Header
            activeRole={headerActiveRole}
            brand={brand}
            currentUser={auth.currentUser}
            navigateTo={navigateTo}
            onSignOut={signOut}
            showSignOut={!view.startsWith("auth-")}
          />
        </>
      )}

      <PageTransition pageKey={transitionKey}>
        {view === "edition-classroom" && (auth.authLoading ? <p role="status">Checking account…</p> : !auth.currentUser ? <AccessGate requiredRole="student" currentUser={null} authLoading={false} navigateTo={navigateTo} />
          : <Suspense fallback={<p role="status">Loading classroom…</p>}><EditionClassroom context={editionContext} teacherMode={["teacher", "admin"].includes(auth.currentUser.role)} onClose={() => navigateTo(dashboardForRole(auth.currentUser.role))} /></Suspense>)}
        {view === "home" && <RoleSelection navigateTo={navigateTo} brand={brand} />}
        {view === "invalid-route" && <InvalidRouteView attemptedHash={attemptedHash} navigateTo={navigateTo} />}
        {["accept-invitation", "reset-password", "account-security"].includes(view) && <AccountLifecycleView key={view} mode={view} token={accountToken} currentUser={auth.currentUser} onAuthenticated={auth.adoptAuthenticatedUser} onSignOut={signOut} navigateTo={navigateTo} />}
        {view.startsWith("auth-") && (
          <AuthView
            role={view.replace("auth-", "")}
            navigateTo={navigateTo}
            currentUser={auth.currentUser}
            authLoading={auth.authLoading}
            authError={auth.authError}
            setAuthError={auth.setAuthError}
            signIn={auth.signIn}
            createStudentAccount={auth.createStudentAccount}
            signOut={async () => {
              await auth.signOut();
              clearPublishedComponentReleaseCache();
              if (typeof window !== "undefined") window.sessionStorage.removeItem("hhplmsDemoRole");
              courseData.resetCourse();
              navigateTo("home");
            }}
          />
        )}
        {adminSectionByView[view] && !adminAccessAllowed && (
          <AccessGate requiredRole="admin" currentUser={auth.currentUser} authLoading={auth.authLoading} navigateTo={navigateTo} />
        )}
        {adminSectionByView[view] && adminAccessAllowed && (
          <AdminView
              initialSection={adminSectionByView[view]}
              brand={brand}
              brandLoading={brandLoading}
              brandError={brandError}
              onBrandPersisted={acceptPersistedBrand}
              navigateTo={navigateTo}
              currentUser={auth.currentUser}
              onSignOut={signOut}
          />
        )}
        {teacherSectionByView[view] && !teacherAccessAllowed && (
          <AccessGate requiredRole="teacher" currentUser={auth.currentUser} authLoading={auth.authLoading} navigateTo={navigateTo} />
        )}
        {teacherSectionByView[view] && teacherAccessAllowed && (
          <TeacherPortal
              initialSection={teacherSectionByView[view]}
              initialSelectedPackageSlug={selectedPackageSlug}
              initialSelectedBookId={selectedBookId}
              initialSelectedBookSubview={selectedBookSubview}
              initialSelectedPageUnitId={selectedPageUnitId}
              initialSelectedPageId={selectedPageId}
              initialSelectedPageNumber={selectedPageNumber}
              initialSelectedAssignmentId={selectedAssignmentId}
              initialSelectedClassSlug={selectedClassSlug}
              routeAction={routeAction}
              initialPreviewActivityKey={routeMode === "teacher-preview" ? activityKey : null}
              currentUser={auth.currentUser}
              brand={brand}
              onSignOut={signOut}
              course={courseData.course}
              onCourseChange={courseData.setCourse}
              navigateTo={navigateTo}
              courseLoading={courseData.loading}
              courseError={courseData.error}
              saveCourse={courseData.saveCourse}
              saveLesson={courseData.saveLesson}
              saveActivity={courseData.saveActivity}
              reloadCourse={courseData.reloadCourse}
          />
        )}
        {view === "teacher-presentation" && !teacherAccessAllowed && (
          <AccessGate requiredRole="teacher" currentUser={auth.currentUser} authLoading={auth.authLoading} navigateTo={navigateTo} />
        )}
        {view === "teacher-presentation" && teacherAccessAllowed && (
          <TeacherPresentationView activityKey={activityKey} navigateTo={navigateTo} />
        )}
        {studentSection && !studentAccessAllowed && (
          <AccessGate requiredRole="student" currentUser={auth.currentUser} authLoading={auth.authLoading} navigateTo={navigateTo} />
        )}
        {studentSection && studentAccessAllowed && (
          <StudentPortal
              initialSection={studentSection}
              initialActivityKey={routeMode === "student" ? activityKey : null}
              initialSelectedPackageSlug={selectedPackageSlug}
              initialSelectedBookId={selectedBookId}
              initialSelectedBookSubview={selectedBookSubview}
              initialSelectedPageUnitId={selectedPageUnitId}
              initialSelectedPageId={selectedPageId}
              initialSelectedPageNumber={selectedPageNumber}
              initialSelectedAssignmentId={selectedAssignmentId}
              course={courseData.course}
              onSubmission={addCourseSubmission}
              navigateTo={navigateTo}
              currentUser={auth.currentUser}
              brand={brand}
              onSignOut={signOut}
              courseLoading={courseData.loading}
              courseError={courseData.error}
              submitLesson={courseData.submitCourseLesson}
          />
        )}
        {view === "student-course" && !studentAccessAllowed && (
          <AccessGate requiredRole="student" currentUser={auth.currentUser} authLoading={auth.authLoading} navigateTo={navigateTo} />
        )}
        {view === "student-course" && studentAccessAllowed && (
          <StudentCourseView
            course={courseData.course}
            onSubmission={addCourseSubmission}
            navigateTo={navigateTo}
            courseLoading={courseData.loading}
            courseError={courseData.error}
            submitLesson={courseData.submitCourseLesson}
          />
        )}
        {view === "student-preview" && !teacherAccessAllowed && (
          <AccessGate requiredRole="teacher" currentUser={auth.currentUser} authLoading={auth.authLoading} navigateTo={navigateTo} />
        )}
        {view === "student-preview" && teacherAccessAllowed && (
          <StudentCourseView course={courseData.course} navigateTo={navigateTo} courseError={courseData.error} previewMode />
        )}
        {view === "flow" && <FullDemoFlow navigateTo={navigateTo} />}
        {view === "join-class" && <JoinClassView classSlug={classSlug} currentUser={auth.currentUser} navigateTo={navigateTo} />}
      </PageTransition>
    </div>
  );
}
