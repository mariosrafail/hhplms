import {
  badRequest, requestsHiddenPhaseOneComponent, withTeacherSolutionHeaders, teacherSolutionResponse,
  isValidUuid, invalidUuidResponse, studentSafeActivityPayload, studentSafePackageTree,
  verifyPackageAccess, resolveScopedUserId, verifyAssignmentAccess, verifyStudentAccess,
  verifyClassAccess, verifyContentEditorReferences, getSubmissionAccessRow,
  canAccessTeacherScopedRow, createTeacherClass, enforceInviteRateLimit, findClassByInviteCode,
  joinClass, listTeacherClasses, publicClassInviteRow, recordInviteAttempt, forbidden, requireAuth,
  safeServerError, isAdmin, isStudent, isTeacher, requireResourceRole, fetchActivity,
  fetchBookPackages, fetchPackageTree, databaseNotConfiguredResponse, getSql,
  isDatabaseNotConfiguredError, json, parseBody, readQuery, getBookAssetAccess, accessiblePackageIds,
  stripStudentAnswerKeys, validateSubmittedAnswers, isSubmittedAnswerCorrect,
  canAccessStudentScopedRow
} from "./_book-content/shared.js";
import {
  assignmentRowToUi, createAssignment, listTeacherAssignments, listAssignmentsForStudent,
  listUserBookAccess, deleteAssignment, closeAssignment, listAssignmentTargets, assignmentTargetsFailureResponse
} from "./_book-content/assignment-actions.js";
import {
  createHomework, getTeacherHomework, listStudentHomeworks, listTeacherHomeworks, updateHomework,
} from "./_book-content/homework-actions.js";
import {
  submitActivity, getStudentGrades, getAssignmentResults
} from "./_book-content/submission-actions.js";
import {
  listClassStudents, listTeacherStudents, reviewSubmission, getSchoolMetrics
} from "./_book-content/class-actions.js";
import { listPageHotspots, savePageHotspots } from "./_book-content/hotspot-actions.js";
import {
  getTeacherActivitySolutions, browserSafeBookActivityPayload, scoreBookActivityRecord,
  listBookActivities, getBookActivity, scoreBookActivity, createBookActivity,
  updateBookActivity, deleteBookActivity
} from "./_book-content/book-activity-actions.js";
import { listBookMediaAssets, createBookMediaAsset } from "./_book-content/media-asset-actions.js";
import {
  getDashboardMetrics, withDashboardMetricsHeaders
} from "./_book-content/dashboard-metrics.js";
import { getTeacherGradeAnalytics } from "./_book-content/teacher-grade-analytics.js";
import { routePublishedBookRead } from "./_book-content/publication-read-routes.js";

export {
  stripStudentAnswerKeys,
  studentSafeActivityPayload,
  validateSubmittedAnswers,
  isSubmittedAnswerCorrect,
  canAccessTeacherScopedRow,
  canAccessStudentScopedRow,
  getTeacherActivitySolutions,
  browserSafeBookActivityPayload,
  scoreBookActivityRecord,
};

export async function handler(event, context) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { "Content-Type": "application/json" }, body: "" };
  const query = readQuery(event);

  try {
    const sql = getSql();

    if (event.httpMethod === "GET" && query.action === "class-by-slug") {
      return json(404, { error: "Class not found" });
    }

    if (event.httpMethod === "GET" && query.action === "class-by-invite") {
      const rateLimitError = await enforceInviteRateLimit(sql, event);
      if (rateLimitError) return rateLimitError;
      const classItem = await findClassByInviteCode(sql, query.inviteCode);
      await recordInviteAttempt(sql, event, Boolean(classItem));
      const publicClassItem = publicClassInviteRow(classItem);
      return publicClassItem ? json(200, { classItem: publicClassItem, class: publicClassItem }) : json(404, { error: "Class not found" });
    }

    const auth = await requireAuth(event, sql);
    if (auth.error) {
      return ["dashboard-metrics", "teacher-grade-analytics"].includes(query.action)
        ? withDashboardMetricsHeaders(auth.error)
        : query.action === "teacher-activity-solutions"
        ? withTeacherSolutionHeaders(auth.error)
        : auth.error;
    }
    const currentUser = auth.currentUser;

    const publicationRead = await routePublishedBookRead(sql, currentUser, event, query, context);
    if (publicationRead) return publicationRead;

    if (event.httpMethod === "GET") {
      if (query.action === "dashboard-metrics") {
        return await getDashboardMetrics(sql, currentUser, event.queryStringParameters || {});
      }
      if (query.action === "teacher-grade-analytics") {
        return await getTeacherGradeAnalytics(sql, currentUser, event.queryStringParameters || {});
      }
      if (requestsHiddenPhaseOneComponent(query)) {
        return json(404, { error: "Component not found" });
      }
      if (query.action === "teacher-activity-solutions") {
        return getTeacherActivitySolutions(sql, currentUser, query);
      }
      if (query.action === "asset-access") {
        return getBookAssetAccess(sql, currentUser, query, {
          localRequestHost: event.headers?.host || event.headers?.Host || "",
        });
      }
      if (query.action === "list") {
        const allowedIds = await accessiblePackageIds(sql, currentUser);
        const packages = await fetchBookPackages(sql);
        return json(200, { bookPackages: packages.filter((item) => allowedIds.includes(String(item.id))) });
      }
      if (query.action === "activity") {
        const accessError = await verifyPackageAccess(sql, currentUser, { activityId: query.activityId, activitySlug: query.activitySlug || query.slug });
        if (accessError) return accessError;
        const activity = await fetchActivity(sql, { ...query, currentDiscovery: true });
        return activity ? json(200, { activity: studentSafeActivityPayload(activity) }) : json(404, { error: "Activity not found" });
      }
      if (query.action === "component") {
        const accessError = await verifyPackageAccess(sql, currentUser, { packageId: query.packageId, packageSlug: query.packageSlug });
        if (accessError) return accessError;
        const tree = await fetchPackageTree(sql, query);
        const visibleTree = studentSafePackageTree(tree);
        const component = visibleTree?.components.find((item) => item.id === query.componentId || item.slug === query.slug);
        return component ? json(200, { component }) : json(404, { error: "Component not found" });
      }
      if (query.action === "access") {
        const userScope = await resolveScopedUserId(sql, currentUser, query.userId);
        return userScope.error || json(200, { bookAccess: await listUserBookAccess(sql, userScope.userId) });
      }
      if (query.action === "school-metrics") {
        const roleError = requireResourceRole(currentUser, ["admin"]);
        return roleError || getSchoolMetrics(sql, currentUser);
      }
      if (query.action === "teacher-assignments") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        if (roleError) return roleError;
        if (query.teacherId && !isValidUuid(query.teacherId)) return invalidUuidResponse("teacherId");
        if (isTeacher(currentUser) && query.teacherId && String(query.teacherId) !== String(currentUser.id)) return forbidden();
        const teacherId = isTeacher(currentUser) ? currentUser.id : query.teacherId || "";
        return json(200, { assignments: await listTeacherAssignments(sql, teacherId, currentUser) });
      }
      if (query.action === "teacher-homeworks") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        if (roleError) return roleError;
        if (query.teacherId && !isValidUuid(query.teacherId)) return invalidUuidResponse("teacherId");
        if (isTeacher(currentUser) && query.teacherId && String(query.teacherId) !== String(currentUser.id)) return forbidden();
        const teacherId = isTeacher(currentUser) ? currentUser.id : query.teacherId || "";
        return json(200, { homeworks: await listTeacherHomeworks(sql, teacherId, currentUser) });
      }
      if (query.action === "student-homeworks") {
        const roleError = requireResourceRole(currentUser, ["student", "admin"]);
        if (roleError) return roleError;
        const studentId = isStudent(currentUser) ? currentUser.id : query.studentId;
        const accessError = await verifyStudentAccess(sql, currentUser, studentId);
        return accessError || json(200, { homeworks: await listStudentHomeworks(sql, studentId, currentUser) });
      }
      if (query.action === "homework") {
        if (!query.homeworkId) return badRequest("homeworkId is required");
        if (!isValidUuid(query.homeworkId)) return invalidUuidResponse("homeworkId");
        if (query.teacherId && !isValidUuid(query.teacherId)) return invalidUuidResponse("teacherId");
        if (isStudent(currentUser)) {
          const homework = (await listStudentHomeworks(sql, currentUser.id, currentUser))
            .find((item) => String(item.id) === String(query.homeworkId));
          return homework ? json(200, { homework }) : json(404, { error: "Homework not found" });
        }
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        if (roleError) return roleError;
        const homework = await getTeacherHomework(
          sql,
          query.homeworkId,
          isTeacher(currentUser) ? currentUser.id : query.teacherId || "",
          currentUser,
        );
        return homework ? json(200, { homework }) : json(404, { error: "Homework not found" });
      }
      if (query.action === "assignment-targets") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        return roleError || json(200, { targets: await listAssignmentTargets(sql, currentUser) });
      }
      if (query.action === "assignments") {
        const roleError = requireResourceRole(currentUser, ["student", "admin"]);
        if (roleError) return roleError;
        const studentId = isStudent(currentUser) ? currentUser.id : query.studentId;
        const accessError = await verifyStudentAccess(sql, currentUser, studentId);
        return accessError || json(200, { assignments: await listAssignmentsForStudent(sql, studentId, currentUser) });
      }
      if (query.action === "grades") {
        const roleError = requireResourceRole(currentUser, ["student", "admin"]);
        if (roleError) return roleError;
        const studentId = isStudent(currentUser) ? currentUser.id : query.studentId;
        const accessError = await verifyStudentAccess(sql, currentUser, studentId);
        return accessError || json(200, { grades: await getStudentGrades(sql, studentId, currentUser) });
      }
      if (query.action === "assignment-results") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        if (roleError) return roleError;
        if (!query.assignmentId) return badRequest("assignmentId is required");
        if (!isValidUuid(query.assignmentId)) return invalidUuidResponse("assignmentId");
        const accessError = await verifyAssignmentAccess(sql, currentUser, query.assignmentId);
        return accessError || getAssignmentResults(sql, query.assignmentId);
      }
      if (query.action === "class-students") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        if (roleError) return roleError;
        const accessError = await verifyClassAccess(sql, currentUser, query.classId);
        return accessError || listClassStudents(sql, query.classId);
      }
      if (query.action === "teacher-students") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        if (roleError) return roleError;
        if (query.teacherId && !isValidUuid(query.teacherId)) return invalidUuidResponse("teacherId");
        if (isTeacher(currentUser) && query.teacherId && String(query.teacherId) !== String(currentUser.id)) return forbidden();
        const teacherId = isTeacher(currentUser) ? currentUser.id : query.teacherId || "";
        return listTeacherStudents(sql, teacherId, currentUser);
      }
      if (query.action === "page-hotspots") {
        const accessError = await verifyPackageAccess(sql, currentUser, { packageSlug: query.packageSlug });
        return accessError || listPageHotspots(sql, query, currentUser);
      }
      if (query.action === "book-activities") {
        const accessError = await verifyPackageAccess(sql, currentUser, { packageSlug: query.packageSlug });
        return accessError || listBookActivities(sql, query, currentUser);
      }
      if (query.action === "book-activity") return getBookActivity(sql, query, currentUser);
      if (query.action === "book-media-assets") {
        const accessError = await verifyPackageAccess(sql, currentUser, { packageSlug: query.packageSlug });
        return accessError || listBookMediaAssets(sql, query, currentUser);
      }
      if (query.action === "classes") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        if (roleError) return roleError;
        if (query.teacherId && !isValidUuid(query.teacherId)) return invalidUuidResponse("teacherId");
        if (isTeacher(currentUser) && query.teacherId && String(query.teacherId) !== String(currentUser.id)) return forbidden();
        return json(200, { classes: await listTeacherClasses(sql, isTeacher(currentUser) ? currentUser.id : query.teacherId, isAdmin(currentUser) ? currentUser.school_id : "") });
      }
      const accessError = await verifyPackageAccess(sql, currentUser, { packageId: query.packageId, packageSlug: query.slug || query.packageSlug || "ultimate-b2" });
      if (accessError) return accessError;
      const tree = await fetchPackageTree(sql, query);
      return tree ? json(200, { bookPackage: studentSafePackageTree(tree) }) : json(404, { error: "Book package not found. Run database/006_book_content_platform.sql." });
    }

    if (event.httpMethod === "POST") {
      if (query.action === "teacher-activity-solutions") {
        return teacherSolutionResponse(405, { error: "Method not allowed" });
      }
      const body = parseBody(event);
      if (query.action === "activate") return json(410, { error: "Use the signed-in book licensing redemption endpoint" });
      if (query.action === "assign") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        if (roleError) return roleError;
        return createAssignment(sql, body, currentUser);
      }
      if (query.action === "create-assignment") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        if (roleError) return roleError;
        return createAssignment(sql, body, currentUser);
      }
      if (query.action === "create-homework") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        if (roleError) return roleError;
        return createHomework(sql, body, currentUser);
      }
      if (query.action === "update-homework") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        if (roleError) return roleError;
        return updateHomework(sql, body, currentUser);
      }
      if (query.action === "delete-assignment") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        if (roleError) return roleError;
        return deleteAssignment(sql, body, currentUser);
      }
      if (query.action === "close-assignment") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        if (roleError) return roleError;
        return closeAssignment(sql, body, currentUser);
      }
      if (query.action === "submit") {
        const roleError = requireResourceRole(currentUser, ["student"]);
        if (roleError) return roleError;
        return submitActivity(sql, body, currentUser);
      }
      if (query.action === "score-book-activity") return scoreBookActivity(sql, body, currentUser);
      if (query.action === "review-submission") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        if (roleError) return roleError;
        if (!body.submissionId) return badRequest("submissionId is required");
        if (!isValidUuid(body.submissionId)) return invalidUuidResponse("submissionId");
        const submission = await getSubmissionAccessRow(sql, body.submissionId);
        if (!submission) return json(404, { error: "Submission not found" });
        if (!canAccessTeacherScopedRow(currentUser, submission)) return forbidden();
        return reviewSubmission(sql, body, currentUser);
      }
      if (query.action === "create-class") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        if (roleError) return roleError;
        if (isTeacher(currentUser) && body.teacherId && String(body.teacherId) !== String(currentUser.id)) return forbidden();
        return createTeacherClass(sql, {
          ...body,
          teacherId: isTeacher(currentUser) ? currentUser.id : body.teacherId,
          schoolId: currentUser.school_id || body.schoolId || null,
        });
      }
      if (query.action === "join-class") {
        const roleError = requireResourceRole(currentUser, ["student"]);
        if (roleError) return roleError;
        if (body.studentId && String(body.studentId) !== String(currentUser.id)) return forbidden("Students can only join classes for their own account");
        if (body.classId || body.slug) return badRequest("A valid class invite code is required");
        const rateLimitError = await enforceInviteRateLimit(sql, event);
        if (rateLimitError) return rateLimitError;
        const response = await joinClass(sql, { inviteCode: body.inviteCode, studentId: currentUser.id });
        await recordInviteAttempt(sql, event, response.statusCode === 200);
        return response;
      }
      if (query.action === "save-page-hotspots") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        const packageError = roleError || await verifyPackageAccess(sql, currentUser, { packageSlug: body.packageSlug || body.package_slug });
        const referenceError = packageError || await verifyContentEditorReferences(sql, currentUser, body);
        return referenceError || savePageHotspots(sql, { ...body, createdBy: currentUser.id, created_by: currentUser.id }, currentUser);
      }
      if (query.action === "create-book-activity") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        const packageError = roleError || await verifyPackageAccess(sql, currentUser, { packageSlug: body.packageSlug || body.package_slug });
        const referenceError = packageError || await verifyContentEditorReferences(sql, currentUser, body);
        return referenceError || createBookActivity(sql, { ...body, createdBy: currentUser.id, created_by: currentUser.id }, currentUser);
      }
      if (query.action === "update-book-activity") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        const referenceError = roleError || await verifyContentEditorReferences(sql, currentUser, body);
        return referenceError || updateBookActivity(sql, { ...body, createdBy: currentUser.id, created_by: currentUser.id }, currentUser);
      }
      if (query.action === "delete-book-activity") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        const referenceError = roleError || await verifyContentEditorReferences(sql, currentUser, body);
        return referenceError || deleteBookActivity(sql, body, currentUser);
      }
      if (query.action === "create-book-media-asset") {
        const roleError = requireResourceRole(currentUser, ["teacher", "admin"]);
        const packageError = roleError || await verifyPackageAccess(sql, currentUser, { packageSlug: body.packageSlug || body.package_slug });
        const referenceError = packageError || await verifyContentEditorReferences(sql, currentUser, body);
        return referenceError || createBookMediaAsset(sql, { ...body, createdBy: currentUser.id, created_by: currentUser.id }, currentUser);
      }
      return badRequest("Unsupported POST action");
    }

    return json(405, { error: "Method not allowed" });
  } catch (error) {
    if (error?.code === "PZ004") return json(409, { error: "Choose a published Students Book activity for a new assignment or Homework item.", code: "students_book_native_publication_required" });
    if (isDatabaseNotConfiguredError(error)) {
      const response = databaseNotConfiguredResponse();
      return ["dashboard-metrics", "teacher-grade-analytics"].includes(query.action)
        ? withDashboardMetricsHeaders(response)
        : query.action === "teacher-activity-solutions"
        ? withTeacherSolutionHeaders(response)
        : response;
    }
    if (error?.code === "42703") {
      const response = json(500, {
        error: "Assignment database migration is missing",
        migration: "database/010_assignment_live_flow.sql",
      });
      return ["dashboard-metrics", "teacher-grade-analytics"].includes(query.action)
        ? withDashboardMetricsHeaders(response)
        : query.action === "teacher-activity-solutions"
        ? withTeacherSolutionHeaders(response)
        : response;
    }
    if (query.action === "assignment-targets") {
      const integrityResponse = assignmentTargetsFailureResponse(error);
      if (integrityResponse) return integrityResponse;
    }
    const response = safeServerError(error, "Book content API failed");
    return ["dashboard-metrics", "teacher-grade-analytics"].includes(query.action)
      ? withDashboardMetricsHeaders(response)
      : query.action === "teacher-activity-solutions"
      ? withTeacherSolutionHeaders(response)
      : response;
  }
}
