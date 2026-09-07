import { badRequest, requestsHiddenPhaseOneComponent, teacherSolutionHeaders, withTeacherSolutionHeaders, teacherSolutionResponse, uuidPattern, isValidUuid, invalidUuidResponse, jsonArray, numericOrNull, studentHiddenAnswerFields, stripStudentAnswerKeys, studentSafeActivityPayload, parseOptionalDeadline, assignmentIdempotencyKey, validateSubmittedAnswers, studentSafePackageTree, normalizeSubmittedAnswer, isSubmittedAnswerCorrect, packageIdForQuery, verifyPackageAccess, supportedBookActivityTypes, supportedBookMediaKinds, supportedHotspotActionTypes, requireText, optionalJson, getUserSchoolId, getUserAccessRow, resolveScopedUserId, getClassAccessRow, getAssignmentAccessRow, getSubmissionAccessRow, canAccessTeacherScopedRow, canAccessStudentScopedRow, verifyClassAccess, verifyAssignmentAccess, verifyStudentAccess, verifyContentEditorReferences, createTeacherClass, enforceInviteRateLimit, findClassByInviteCode, joinClass, listTeacherClasses, publicClassInviteRow, recordInviteAttempt, forbidden, requireAuth, safeServerError, unauthorized, isAdmin, isStudent, isTeacher, requireResourceRole, sameSchool, fetchActivity, fetchBookPackages, fetchPackageTree, databaseNotConfiguredResponse, getSql, isDatabaseNotConfiguredError, json, parseBody, readQuery, getBookAssetAccess, accessiblePackageIds, withAssignmentLifecycleTransaction } from "./shared.js";
import {
  NATIVE_ASSIGNMENT_TARGET_KIND,
  containsClientTeacherMaterial,
  listPublishedNativeAssignmentTargets,
  nativeTargetToStudent,
  nativeAssignmentCapability,
  resolveNativeAssignmentTarget,
} from "./native-assignment-runtime.js";
import { publishedBookReadModel } from "./published-book-model.js";
import {
  classTargetPackageConflictResponse,
  verifyDirectStudentTargetEntitlements,
} from "./assignment-package-compatibility.js";

export async function listUserBookAccess(sql, userId) {
  if (!userId) return [];
  const rows = await sql`
    select ba.id, ba.role_scope, ba.granted_at, bp.id as book_package_id, bp.title, bp.slug, bp.level, p.name as publisher
    from book_access ba
    join book_packages bp on bp.id = ba.book_package_id
    join publishers p on p.id = bp.publisher_id
    where ba.user_id = ${userId} and bp.status = 'active'
    order by ba.granted_at desc
  `;
  return rows.map((row) => ({
    id: row.id,
    roleScope: row.role_scope,
    grantedAt: row.granted_at,
    bookPackage: {
      id: row.book_package_id,
      title: row.title,
      slug: row.slug,
      level: row.level,
      publisher: row.publisher,
    },
  }));
}

export function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return [value];
}

export function normalizeLinks(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "")
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function assignmentRowToUi(row = {}) {
  const total = Number(row.total_students || row.total || 0);
  const submitted = Number(row.submitted_count || row.submitted || 0);
  const averageScoreValue = numericOrNull(row.average_score);
  const averageScore = averageScoreValue === null ? null : Math.round(averageScoreValue);

  return {
    id: row.id,
    homeworkId: row.homework_id || null,
    homeworkItemId: row.homework_item_id || null,
    targetKind: row.target_kind || "legacy_activity",
    activityId: row.activity_id,
    nativeReleaseId: row.native_release_id || null,
    nativeActivityId: row.native_activity_id || null,
    teacherId: row.teacher_id,
    classId: row.class_id,
    studentId: row.student_id,
    title: row.assignment_title || row.title || row.activity_title || "Untitled assignment",
    activityTitle: row.activity_title,
    activitySlug: row.activity_slug,
    activityType: row.activity_type,
    assignedAt: row.assigned_at,
    dueAt: row.due_at,
    dueDate: row.due_at,
    status: row.status || "assigned",
    teacherNotes: row.teacher_notes || "",
    worksheetLinks: jsonArray(row.worksheet_links),
    attachedFiles: jsonArray(row.attached_files),
    className: row.class_name || (row.student_id ? "Individual" : "Class assignment"),
    teacherName: row.teacher_name || "",
    lessonTitle: row.lesson_title || "",
    unitTitle: row.unit_title || "",
    component: row.component_title || row.component || "",
    componentTitle: row.component_title || row.component || "",
    packageTitle: row.package_title || "",
    total,
    totalStudents: total,
    submitted,
    submittedCount: submitted,
    missing: Math.max(total - submitted, 0),
    missingCount: Math.max(total - submitted, 0),
    averageScore,
    latestSubmittedAt: row.latest_submitted_at || null,
    completionPercent: total ? Math.round((submitted / total) * 100) : 0,
    awaitingReviewCount: Number(row.awaiting_review_count || 0),
    reviewedCount: Number(row.reviewed_count || 0),
    autoScoredCount: Number(row.auto_scored_count || 0),
    completedCount: Number(row.completed_count || 0),
    implementationMode: row.implementation_mode || null,
  };
}

function assignmentLifecycleResponse(row, action) {
  if (!row?.assignment_exists) return json(404, { error: "Assignment not found" });
  if (!row.authorized) return forbidden();
  if (row.homework_id) {
    return json(409, {
      error: "Homework-managed assignments cannot be changed individually.",
      conflict: "homework-managed-assignment",
    });
  }
  if (action === "delete" && row.has_submissions) {
    return json(409, { error: "This assignment now has submissions and cannot be deleted. Close it instead.", conflict: "assignment-has-submissions" });
  }
  if (action === "close" && !row.has_submissions) {
    return json(409, { error: "This assignment has no submissions and can be deleted instead.", conflict: "assignment-has-no-submissions" });
  }
  if (action === "delete" && !row.mutated) return json(409, { error: "Assignment could not be deleted safely. Refresh and try again." });
  if (action === "close" && !row.mutated && row.assignment_status !== "closed") return json(409, { error: "Assignment could not be closed safely. Refresh and try again." });
  return null;
}

export async function deleteAssignment(sql, body, currentUser) {
  const assignmentId = body.assignmentId || body.id;
  if (!assignmentId) return badRequest("assignmentId is required");
  if (!isValidUuid(assignmentId)) return invalidUuidResponse("assignmentId");
  const rows = await withAssignmentLifecycleTransaction(sql, assignmentId, (transactionSql) => transactionSql`
    with target as materialized (
      select aa.id,
             aa.status,
             aa.homework_id,
             coalesce(aa.school_id, c.school_id, teacher.school_id, student.school_id) as effective_school_id,
             aa.teacher_id,
             exists (select 1 from activity_submissions s where s.activity_assignment_id = aa.id) as has_submissions
      from activity_assignments aa
      left join classes c on c.id = aa.class_id
      left join app_users teacher on teacher.id = aa.teacher_id
      left join app_users student on student.id = aa.student_id
      where aa.id = ${assignmentId}
    ), authorized_target as materialized (
      select *, (
        (${currentUser.role} = 'teacher' and teacher_id = ${currentUser.id} and effective_school_id = ${currentUser.school_id})
        or (${currentUser.role} = 'admin' and effective_school_id = ${currentUser.school_id})
      ) as authorized
      from target
    ), deleted as (
      delete from activity_assignments aa
      using authorized_target target
      where aa.id = target.id and target.authorized and target.homework_id is null and not target.has_submissions
      returning aa.id
    )
    select exists(select 1 from target) as assignment_exists,
           coalesce((select authorized from authorized_target), false) as authorized,
           coalesce((select has_submissions from target), false) as has_submissions,
           (select homework_id from target) as homework_id,
           (select status from target) as assignment_status,
           exists(select 1 from deleted) as mutated
  `);
  const conflict = assignmentLifecycleResponse(rows[0], "delete");
  return conflict || json(200, { deletedAssignmentId: assignmentId });
}

export async function closeAssignment(sql, body, currentUser) {
  const assignmentId = body.assignmentId || body.id;
  if (!assignmentId) return badRequest("assignmentId is required");
  if (!isValidUuid(assignmentId)) return invalidUuidResponse("assignmentId");
  const rows = await withAssignmentLifecycleTransaction(sql, assignmentId, (transactionSql) => transactionSql`
    with target as materialized (
      select aa.id,
             aa.status,
             aa.homework_id,
             coalesce(aa.school_id, c.school_id, teacher.school_id, student.school_id) as effective_school_id,
             aa.teacher_id,
             exists (select 1 from activity_submissions s where s.activity_assignment_id = aa.id) as has_submissions
      from activity_assignments aa
      left join classes c on c.id = aa.class_id
      left join app_users teacher on teacher.id = aa.teacher_id
      left join app_users student on student.id = aa.student_id
      where aa.id = ${assignmentId}
    ), authorized_target as materialized (
      select *, (
        (${currentUser.role} = 'teacher' and teacher_id = ${currentUser.id} and effective_school_id = ${currentUser.school_id})
        or (${currentUser.role} = 'admin' and effective_school_id = ${currentUser.school_id})
      ) as authorized
      from target
    ), closed as (
      update activity_assignments aa
      set status = 'closed'
      from authorized_target target
      where aa.id = target.id and target.authorized and target.homework_id is null and target.has_submissions and aa.status <> 'closed'
      returning aa.id
    )
    select exists(select 1 from target) as assignment_exists,
           coalesce((select authorized from authorized_target), false) as authorized,
           coalesce((select has_submissions from target), false) as has_submissions,
           (select homework_id from target) as homework_id,
           (select status from target) as assignment_status,
           exists(select 1 from closed) as mutated
  `);
  const conflict = assignmentLifecycleResponse(rows[0], "close");
  return conflict || json(200, { assignment: { id: assignmentId, status: "closed" } });
}

export async function createAssignment(sql, body, currentUser = null) {
  const activityId = body.activityId || body.bookActivityId;
  const requestedNativeTarget = body.target?.kind === NATIVE_ASSIGNMENT_TARGET_KIND ? body.target : null;
  let teacherId = isTeacher(currentUser) ? currentUser.id : body.teacherId;
  const classIds = toArray(body.classIds || body.classId);
  const studentIds = toArray(body.studentIds || body.studentId);
  const deadline = parseOptionalDeadline(body.dueAt || body.dueDate || null);
  if (deadline.error) return badRequest(deadline.error);
  const dueAt = deadline.value;
  const status = body.status || "assigned";
  const teacherNotes = String(body.teacherNotes || "").trim();
  const worksheetLinks = normalizeLinks(body.worksheetLinks || body.worksheetLink || body.worksheetUrls);
  const attachedFiles = Array.isArray(body.attachedFiles) ? body.attachedFiles : [];
  const title = String(body.title || "").trim() || null;

  if (!activityId && !requestedNativeTarget) return badRequest("activityId or a published native target is required");
  if (activityId && requestedNativeTarget) return badRequest("Choose either a legacy activityId or a published native target");
  if (activityId && !isValidUuid(activityId)) return invalidUuidResponse("activityId");
  if (body.target && !requestedNativeTarget) return badRequest("target.kind must be published_native");
  if (body.locator !== undefined || body.native_book_locator !== undefined) return badRequest("A book locator must be supplied inside the published native target");
  if (requestedNativeTarget && containsClientTeacherMaterial(body)) return badRequest("Teacher/model-answer material is not accepted from clients");
  if (isTeacher(currentUser) && body.teacherId && String(body.teacherId) !== String(currentUser.id)) return forbidden();
  if (isAdmin(currentUser)) {
    if (!teacherId) return badRequest("teacherId is required for admin assignment creation");
    if (!isValidUuid(teacherId)) return invalidUuidResponse("teacherId");
    const teacherRows = await sql`
      select id, school_id, role
      from app_users
      where id = ${teacherId} and role = 'teacher'
      limit 1
    `;
    const teacher = teacherRows[0];
    if (!teacher) return json(404, { error: "Teacher not found" });
    if (!sameSchool(currentUser, teacher.school_id)) return forbidden();
  }
  if (!teacherId) return badRequest("teacherId is required");
  if (!isValidUuid(teacherId)) return invalidUuidResponse("teacherId");
  if (!classIds.length && !studentIds.length) return badRequest("classId or studentId is required");
  const invalidClassId = classIds.find((classId) => !isValidUuid(classId));
  if (invalidClassId) return invalidUuidResponse("classId");
  const invalidStudentId = studentIds.find((studentId) => !isValidUuid(studentId));
  if (invalidStudentId) return invalidUuidResponse("studentId");
  if (!["assigned", "closed"].includes(status)) return badRequest("status must be assigned or closed");
  if (title && title.length > 240) return badRequest("title must be at most 240 characters");
  if (teacherNotes.length > 4_000) return badRequest("teacherNotes must be at most 4000 characters");

  for (const classId of classIds) {
    const accessError = await verifyClassAccess(sql, currentUser, classId);
    if (accessError) return accessError;
  }
  if (studentIds.length && !isAdmin(currentUser)) return forbidden("Only admins can create direct student assignments in this MVP");
  for (const studentId of studentIds) {
    if (isAdmin(currentUser)) {
      const accessError = await verifyStudentAccess(sql, currentUser, studentId);
      if (accessError) return accessError;
    }
  }

  let activity = null;
  let nativeTarget = null;
  if (requestedNativeTarget) {
    nativeTarget = await resolveNativeAssignmentTarget(sql, currentUser, requestedNativeTarget, { requireActive: true });
    if (nativeTarget.error) return json(nativeTarget.statusCode || 400, { error: nativeTarget.error, code: nativeTarget.code || "published_target_unavailable" });
    if (!nativeTarget.capability?.assignable) return forbidden("This published native activity is not assignable");
  } else {
    const activityRows = await sql`
      select activity.id, activity.title, activity.is_assignable, activity.content_json,
             package.id as book_package_id, builder_current_legacy_activity_allowed(component.id) as legacy_assignment_allowed
      from activities activity
      join lessons lesson on lesson.id = activity.lesson_id
      join units unit_record on unit_record.id = lesson.unit_id
      join book_components component on component.id = unit_record.book_component_id
      join book_packages package on package.id = component.book_package_id and package.status = 'active'
      where activity.id = ${activityId}
      limit 1
    `;
    activity = activityRows[0];
    if (!activity) return json(404, { error: "Activity not found" });
    if (
      activity.is_assignable === false
      || activity.content_json?.implementationMode === "unsupported-disabled"
      || activity.content_json?.implementationStatus === "disabled-editorial-only"
    ) return forbidden("This activity is not assignable");
    const packageError = await verifyPackageAccess(sql, currentUser, { activityId });
    if (packageError) return packageError;
    if (activity.legacy_assignment_allowed === false) return json(409, { error: "Choose a published Students Book activity for a new assignment.", code: "students_book_native_publication_required" });
  }

  const targetPackageId = nativeTarget?.row.book_package_id || activity?.book_package_id || null;
  if (classIds.length) {
    const classRows = await sql`
      select id, teacher_id, school_id, status, book_package_id
      from classes
      where id = any(${classIds}::uuid[])
        and school_id = ${currentUser.school_id}
    `;
    if (classRows.length !== classIds.length || classRows.some((row) => row.status !== "active")) {
      return forbidden("Assignments can only target active permitted classes");
    }
    const packageConflict = classTargetPackageConflictResponse(classRows, [targetPackageId]);
    if (packageConflict) return packageConflict;
  }
  const entitlementError = await verifyDirectStudentTargetEntitlements(
    sql,
    studentIds,
    targetPackageId,
    currentUser.school_id,
  );
  if (entitlementError) return entitlementError;

  const targetKind = nativeTarget ? NATIVE_ASSIGNMENT_TARGET_KIND : "legacy_activity";
  const nativeReleaseId = nativeTarget?.row.id || null;
  const nativeActivityId = nativeTarget?.nativeActivityId || null;
  const nativeBookLocator = nativeTarget?.locator ? JSON.stringify(nativeTarget.locator) : null;
  const canonicalTitle = nativeTarget?.publicEntry.document?.metadata?.title || activity?.title;

  const inserted = [];
  for (const classId of classIds) {
    const idempotency = assignmentIdempotencyKey(body, teacherId, activityId, "class", classId, dueAt, title, teacherNotes);
    if (idempotency.error) return badRequest(idempotency.error);
    const rows = await sql`
      insert into activity_assignments (
        school_id,
        activity_id,
        target_kind,
        native_release_id,
        native_activity_id,
        native_book_locator,
        teacher_id,
        class_id,
        student_id,
        due_at,
        status,
        title,
        teacher_notes,
        worksheet_links,
        attached_files,
        idempotency_key
      )
      values (
        ${currentUser.school_id},
        ${activityId || null},
        ${targetKind},
        ${nativeReleaseId},
        ${nativeActivityId},
        ${nativeBookLocator}::jsonb,
        ${teacherId},
        ${classId},
        null,
        ${dueAt},
        ${status},
        ${title || canonicalTitle},
        ${teacherNotes},
        ${JSON.stringify(worksheetLinks)}::jsonb,
        ${JSON.stringify(attachedFiles)}::jsonb,
        ${idempotency.value}
      )
      on conflict (school_id, teacher_id, idempotency_key)
        where idempotency_key is not null
      do update set idempotency_key = excluded.idempotency_key
      returning *
    `;
    inserted.push(rows[0]);
  }

  for (const studentId of studentIds) {
    const idempotency = assignmentIdempotencyKey(body, teacherId, activityId, "student", studentId, dueAt, title, teacherNotes);
    if (idempotency.error) return badRequest(idempotency.error);
    const rows = await sql`
      insert into activity_assignments (
        school_id,
        activity_id,
        target_kind,
        native_release_id,
        native_activity_id,
        native_book_locator,
        teacher_id,
        class_id,
        student_id,
        due_at,
        status,
        title,
        teacher_notes,
        worksheet_links,
        attached_files,
        idempotency_key
      )
      values (
        ${currentUser.school_id},
        ${activityId || null},
        ${targetKind},
        ${nativeReleaseId},
        ${nativeActivityId},
        ${nativeBookLocator}::jsonb,
        ${teacherId},
        null,
        ${studentId},
        ${dueAt},
        ${status},
        ${title || canonicalTitle},
        ${teacherNotes},
        ${JSON.stringify(worksheetLinks)}::jsonb,
        ${JSON.stringify(attachedFiles)}::jsonb,
        ${idempotency.value}
      )
      on conflict (school_id, teacher_id, idempotency_key)
        where idempotency_key is not null
      do update set idempotency_key = excluded.idempotency_key
      returning *
    `;
    inserted.push(rows[0]);
  }

  return json(200, { assignments: inserted.map(assignmentRowToUi), assignment: assignmentRowToUi(inserted[0]) });
}

export async function listTeacherAssignments(sql, teacherId = "", currentUser = null) {
  const rows = await sql`
    select aa.id, aa.homework_id, aa.homework_item_id, aa.native_book_locator,
           aa.target_kind, aa.activity_id, aa.native_release_id, aa.native_activity_id,
           aa.teacher_id, aa.class_id, aa.student_id, aa.assigned_at, aa.due_at, aa.status,
           aa.title as assignment_title, aa.teacher_notes, aa.worksheet_links, aa.attached_files,
           coalesce(a.title, aa.title) as activity_title, a.slug as activity_slug,
           coalesce(a.activity_type, native_public.value->>'kind') as activity_type,
           case when aa.target_kind = 'published_native' then 'teacher-reviewed' else a.content_json->>'implementationMode' end as implementation_mode,
           l.id as lesson_id, l.slug as lesson_slug, l.title as lesson_title,
           u.id as unit_id, u.slug as unit_slug, u.title as unit_title,
           coalesce(bc.id, native_component.id) as component_id,
           coalesce(bc.slug, native_component.slug) as component_slug,
           coalesce(bc.title, native_component.title) as component_title,
           coalesce(bp.id, native_package.id) as package_id,
           coalesce(bp.slug, native_package.slug) as package_slug,
           coalesce(bp.title, native_package.title) as package_title,
           c.name as class_name, teacher.full_name as teacher_name,
           case
             when aa.class_id is not null then (
               select count(*)::int
               from class_students cs
               where cs.class_id = aa.class_id and coalesce(cs.status, 'active') = 'active'
             )
             when aa.student_id is not null then 1
             else 0
           end as total_students,
           count(distinct s.student_id)::int as submitted_count,
           (count(distinct s.student_id) filter (where s.status = 'awaiting_review'))::int as awaiting_review_count,
           (count(distinct s.student_id) filter (where s.status = 'reviewed'))::int as reviewed_count,
           (count(distinct s.student_id) filter (where s.status = 'submitted'))::int as auto_scored_count,
           (count(distinct s.student_id) filter (where s.status = 'completed'))::int as completed_count,
           avg(s.score_percent) as average_score,
           max(s.submitted_at) as latest_submitted_at
    from activity_assignments aa
    left join activities a on a.id = aa.activity_id
    left join lessons l on l.id = a.lesson_id
    left join units u on u.id = l.unit_id
    left join book_components bc on bc.id = u.book_component_id
    left join book_packages bp on bp.id = bc.book_package_id
    left join book_component_releases native_release on native_release.id = aa.native_release_id
    left join book_components native_component on native_component.id = native_release.book_component_id
    left join book_packages native_package on native_package.id = native_release.book_package_id
    left join lateral jsonb_each(native_release.public_projection->'nativeActivities') native_public on native_public.key = aa.native_activity_id
    left join classes c on c.id = aa.class_id
    left join app_users teacher on teacher.id = aa.teacher_id
    left join activity_submissions s on s.activity_assignment_id = aa.id
    where (${teacherId || null}::uuid is null or aa.teacher_id = ${teacherId || null})
      and aa.school_id = ${currentUser.school_id}
    group by aa.id, a.id, native_public.value, l.id, l.slug, l.title, u.id, u.slug, u.title,
             bc.id, bc.slug, bc.title, bp.id, bp.slug, bp.title,
             native_component.id, native_package.id, c.name, teacher.full_name
    order by aa.assigned_at desc
  `;

  return rows.map(assignmentRowToUi);
}

export async function listAssignmentsForStudent(sql, studentId, currentUser, { assignmentId = null, includeBook = false } = {}) {
  if (!studentId) return [];
  const rows = await sql`
    select aa.id, aa.homework_id, aa.homework_item_id, aa.native_book_locator,
           aa.target_kind, aa.native_release_id, aa.native_activity_id, aa.assigned_at, aa.due_at, aa.status,
           aa.title as assignment_title, aa.teacher_notes, aa.worksheet_links, aa.attached_files,
           a.id as activity_id, a.title as activity_title, a.slug as activity_slug, a.activity_type,
           a.content_json, a.timer_seconds, a.estimated_minutes,
           l.id as lesson_id, l.slug as lesson_slug, l.title as lesson_title,
           u.id as unit_id, u.slug as unit_slug, u.title as unit_title,
           coalesce(bc.id, native_component.id) as component_id,
           coalesce(bc.slug, native_component.slug) as component_slug,
           coalesce(bc.title, native_component.title) as component_title,
           coalesce(bp.id, native_package.id) as package_id,
           coalesce(bp.slug, native_package.slug) as package_slug,
           coalesce(bp.title, native_package.title) as package_title,
           c.name as class_name, teacher.full_name as teacher_name,
           latest.id as submission_id, latest.score_percent, latest.correct_count, latest.total_count, latest.status as submission_status,
           latest.submitted_at, latest.teacher_feedback, latest.reviewed_at,
           latest.response_payload, latest.response_schema_version
    from activity_assignments aa
    left join activities a on a.id = aa.activity_id
    left join lessons l on l.id = a.lesson_id
    left join units u on u.id = l.unit_id
    left join book_components bc on bc.id = u.book_component_id
    left join book_packages bp on bp.id = bc.book_package_id
    left join book_component_releases native_release on native_release.id = aa.native_release_id
    left join book_components native_component on native_component.id = native_release.book_component_id
    left join book_packages native_package on native_package.id = native_release.book_package_id
    left join classes c on c.id = aa.class_id
    left join app_users teacher on teacher.id = aa.teacher_id
    left join lateral (
      select s.*
      from activity_submissions s
      where s.activity_assignment_id = aa.id and s.student_id = ${studentId}
      order by s.submitted_at desc
      limit 1
    ) latest on true
    where aa.school_id = ${currentUser.school_id}
      and (${assignmentId}::uuid is null or aa.id=${assignmentId}::uuid)
      and (aa.student_id = ${studentId}
       or aa.class_id in (select class_id from class_students where student_id = ${studentId} and coalesce(status, 'active') = 'active'))
    order by aa.assigned_at desc
  `;

  const activityIds = [...new Set(rows.filter((row) => row.activity_id).map((row) => String(row.activity_id)))];
  const hydratedActivities = new Map();
  for (const activityId of activityIds) {
    const activity = await fetchActivity(sql, { activityId });
    if (activity) hydratedActivities.set(activityId, isStudent(currentUser) ? studentSafeActivityPayload(activity) : activity);
  }

  const nativeTargets = new Map();
  const nativeBooks = new Map();
  const requestCache = new Map();
  for (const row of rows.filter((candidate) => candidate.target_kind === NATIVE_ASSIGNMENT_TARGET_KIND)) {
    const target = await resolveNativeAssignmentTarget(sql, currentUser, {
      kind: NATIVE_ASSIGNMENT_TARGET_KIND,
      releaseId: row.native_release_id,
      nativeActivityId: row.native_activity_id,
    }, { requireActive: false, requestCache });
    if (!target.error) {
      nativeTargets.set(String(row.id), nativeTargetToStudent(target, row.native_activity_id));
      if (includeBook) {
        const capabilities = Object.fromEntries(Object.entries(target.verified.publicProjection.nativeActivities || {}).map(([id, entry]) => [id, nativeAssignmentCapability(entry.kind, entry.document)]));
        nativeBooks.set(String(row.id), publishedBookReadModel(target.row, target.verified.publicProjection, capabilities, row.native_book_locator?.productReleaseId || null));
      }
    }
  }

  return rows.filter((row) => row.target_kind !== NATIVE_ASSIGNMENT_TARGET_KIND || nativeTargets.has(String(row.id))).map((row) => ({
    id: row.id,
    assignmentId: row.id,
    homeworkId: row.homework_id || null,
    homeworkItemId: row.homework_item_id || null,
    bookLocator: row.native_book_locator || null,
    ...(includeBook && nativeBooks.has(String(row.id)) ? { book: nativeBooks.get(String(row.id)) } : {}),
    assignedAt: row.assigned_at,
    dueAt: row.due_at,
    status: row.status,
    title: row.assignment_title || row.activity_title,
    teacherNotes: row.teacher_notes || "",
    worksheetLinks: jsonArray(row.worksheet_links),
    attachedFiles: jsonArray(row.attached_files),
    className: row.class_name || "Individual",
    teacherName: row.teacher_name || "",
    completionStatus: row.submission_id
      ? row.submission_status === "awaiting_review"
        ? "Pending teacher review"
        : row.submission_status === "reviewed"
          ? "Reviewed"
          : row.submission_status === "completed"
            ? "Completed"
            : "Automatically graded"
      : row.due_at && new Date(row.due_at).getTime() <= Date.now()
        ? "Late"
        : "Assigned",
    submittedAt: row.submitted_at || null,
    submissionId: row.submission_id || null,
    submissionStatus: row.submission_status || null,
    teacherFeedback: row.teacher_feedback || "",
    reviewedAt: row.reviewed_at || null,
    scorePercent: numericOrNull(row.score_percent),
    correctCount: row.correct_count,
    totalCount: row.total_count,
    targetKind: row.target_kind || "legacy_activity",
    target: nativeTargets.get(String(row.id)) || null,
    responsePayload: row.response_payload || null,
    activity: row.target_kind === NATIVE_ASSIGNMENT_TARGET_KIND ? null : hydratedActivities.get(String(row.activity_id)) || {
      id: row.activity_id,
      title: row.activity_title,
      slug: row.activity_slug,
      activityType: row.activity_type,
      timerSeconds: row.timer_seconds,
      estimatedMinutes: row.estimated_minutes,
      contentJson: row.content_json || {},
      content_json: row.content_json || {},
      demoActivityKey: row.content_json?.demoActivityKey || row.activity_slug,
      questions: [],
    },
    lessonTitle: row.lesson_title,
    lessonId: row.lesson_id,
    lessonSlug: row.lesson_slug,
    unitTitle: row.unit_title,
    unitId: row.unit_id,
    unitSlug: row.unit_slug,
    componentTitle: row.component_title,
    componentId: row.component_id,
    componentSlug: row.component_slug,
    packageTitle: row.package_title,
    packageId: row.package_id,
    packageSlug: row.package_slug,
  }));
}

export async function listAssignmentTargets(sql, currentUser) {
  return listPublishedNativeAssignmentTargets(sql, currentUser);
}

export function assignmentTargetsFailureResponse(error) {
  const verifierFailure = error?.code === "release_integrity_failed"
    || error?.message === "release_integrity_failed"
    || error?.message === "publication_compiler_mismatch";
  return verifierFailure
    ? json(503, {
        error: "Published assignment activities are temporarily unavailable",
        code: "published-assignment-integrity-unavailable",
      })
    : null;
}
