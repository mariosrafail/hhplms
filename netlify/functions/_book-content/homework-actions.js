import { createHash, randomUUID } from "node:crypto";
import { listTeacherAssignments, normalizeLinks } from "./assignment-actions.js";
import { assembleStudentHomeworks, assembleTeacherHomeworks } from "./homework-presentation.js";
import { classTargetPackageConflictResponse } from "./assignment-package-compatibility.js";
import { normalizePublishedBookLocator } from "./published-book-model.js";
import {
  NATIVE_ASSIGNMENT_TARGET_KIND,
  containsClientTeacherMaterial,
  resolveNativeAssignmentTarget,
} from "./native-assignment-runtime.js";
import {
  badRequest,
  forbidden,
  isAdmin,
  isTeacher,
  isValidUuid,
  json,
  parseOptionalDeadline,
  sameSchool,
  verifyClassAccess,
  verifyPackageAccess,
  withHomeworkMutationTransaction,
} from "./shared.js";

export { assembleStudentHomeworks, assembleTeacherHomeworks } from "./homework-presentation.js";

const LEGACY_TARGET_KIND = "legacy_activity";
const MAX_HOMEWORK_ITEMS = 50;
const idempotencyPattern = /^[A-Za-z0-9._:-]{8,128}$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalTarget(rawItem = {}) {
  if (rawItem.kind === LEGACY_TARGET_KIND) {
    if (Object.keys(rawItem).some((key) => !["kind", "activityId"].includes(key))) {
      return { error: "Legacy Homework items contain unsupported fields" };
    }
    if (!isValidUuid(rawItem.activityId)) return { error: "Homework item activityId must be a valid UUID" };
    return { kind: LEGACY_TARGET_KIND, activityId: String(rawItem.activityId).toLowerCase() };
  }
  if (rawItem.kind === NATIVE_ASSIGNMENT_TARGET_KIND) {
    if (Object.keys(rawItem).some((key) => !["kind", "releaseId", "nativeActivityId", "locator"].includes(key))) {
      return { error: "Published-native Homework items contain unsupported fields" };
    }
    if (!isValidUuid(rawItem.releaseId)) return { error: "Homework item releaseId must be a valid UUID" };
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(String(rawItem.nativeActivityId || ""))) {
      return { error: "Homework item nativeActivityId is invalid" };
    }
    let locator;
    try { locator = normalizePublishedBookLocator(rawItem.locator); }
    catch { return { error: "Homework item locator is invalid" }; }
    return {
      kind: NATIVE_ASSIGNMENT_TARGET_KIND,
      releaseId: String(rawItem.releaseId).toLowerCase(),
      nativeActivityId: String(rawItem.nativeActivityId),
      ...(locator ? { locator } : {}),
    };
  }
  return { error: "Homework item kind must be legacy_activity or published_native" };
}

function targetIdentity(target) {
  return target.kind === LEGACY_TARGET_KIND
    ? `${LEGACY_TARGET_KIND}:${target.activityId}`
    : `${NATIVE_ASSIGNMENT_TARGET_KIND}:${target.releaseId}:${target.nativeActivityId}`;
}

export function normalizeHomeworkCreateBody(body = {}, { teacherId, schoolId } = {}) {
  const title = String(body.title || "").trim();
  const teacherNotes = String(body.teacherNotes || "").trim();
  const worksheetLinks = normalizeLinks(body.worksheetLinks || body.worksheetLink || body.worksheetUrls);
  const due = parseOptionalDeadline(body.dueAt || body.dueDate || null);
  const idempotencyKey = String(body.idempotencyKey || body.requestId || "").trim();
  const classIds = Array.isArray(body.classIds) ? body.classIds.map((value) => String(value).toLowerCase()) : body.classId ? [String(body.classId).toLowerCase()] : [];
  const rawItems = Array.isArray(body.items) ? body.items : [];

  if (!title) return { error: "Homework title is required" };
  if (title.length > 240) return { error: "Homework title must be at most 240 characters" };
  if (teacherNotes.length > 4_000) return { error: "teacherNotes must be at most 4000 characters" };
  if (due.error) return { error: due.error };
  if (!idempotencyPattern.test(idempotencyKey)) return { error: "idempotencyKey must be 8-128 safe characters" };
  if (!classIds.length) return { error: "At least one classId is required" };
  if (new Set(classIds).size !== classIds.length) return { error: "Duplicate classId values are not allowed" };
  if (classIds.some((classId) => !isValidUuid(classId))) return { error: "classId must be a valid UUID" };
  if (rawItems.length < 2 || rawItems.length > MAX_HOMEWORK_ITEMS) {
    return { error: `Homework items must contain 2-${MAX_HOMEWORK_ITEMS} activities` };
  }

  const items = [];
  for (const rawItem of rawItems) {
    const target = canonicalTarget(rawItem);
    if (target.error) return target;
    items.push(target);
  }
  const identities = items.map(targetIdentity);
  if (new Set(identities).size !== identities.length) return { error: "Duplicate activities are not allowed in one Homework" };

  const canonicalRequest = {
    schoolId,
    teacherId,
    title,
    teacherNotes,
    worksheetLinks,
    dueAt: due.value,
    status: "assigned",
    classIds: [...classIds].sort(),
    items,
  };
  return {
    ...canonicalRequest,
    classIds,
    idempotencyKey,
    requestSha256: sha256(JSON.stringify(canonicalRequest)),
  };
}

export function normalizeHomeworkUpdateBody(body = {}) {
  const homeworkId = String(body.homeworkId || "").trim().toLowerCase();
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt.trim() : "";
  const title = String(body.title || "").trim();
  const teacherNotes = String(body.teacherNotes || "").trim();
  const worksheetLinks = normalizeLinks(body.worksheetLinks || body.worksheetLink || body.worksheetUrls);
  const due = parseOptionalDeadline(body.dueAt || body.dueDate || null);
  const classIds = Array.isArray(body.classIds) ? body.classIds.map((value) => String(value).toLowerCase()) : [];
  const rawItems = Array.isArray(body.items) ? body.items : [];

  if (!isValidUuid(homeworkId)) return { error: "homeworkId must be a valid UUID" };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(expectedUpdatedAt)
    || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
    return { error: "expectedUpdatedAt must be a valid ISO date-time" };
  }
  if (!title) return { error: "Homework title is required" };
  if (title.length > 240) return { error: "Homework title must be at most 240 characters" };
  if (teacherNotes.length > 4_000) return { error: "teacherNotes must be at most 4000 characters" };
  if (due.error) return { error: due.error };
  if (!classIds.length) return { error: "At least one classId is required" };
  if (new Set(classIds).size !== classIds.length) return { error: "Duplicate classId values are not allowed" };
  if (classIds.some((classId) => !isValidUuid(classId))) return { error: "classId must be a valid UUID" };
  if (rawItems.length < 2 || rawItems.length > MAX_HOMEWORK_ITEMS) {
    return { error: `Homework items must contain 2-${MAX_HOMEWORK_ITEMS} activities` };
  }

  const items = [];
  for (const rawItem of rawItems) {
    const target = canonicalTarget(rawItem);
    if (target.error) return target;
    items.push(target);
  }
  const identities = items.map(targetIdentity);
  if (new Set(identities).size !== identities.length) return { error: "Duplicate activities are not allowed in one Homework" };
  return {
    homeworkId,
    expectedUpdatedAt,
    title,
    teacherNotes,
    worksheetLinks,
    dueAt: due.value,
    classIds,
    items,
  };
}

async function resolveHomeworkTeacher(sql, body, currentUser) {
  if (isTeacher(currentUser)) {
    if (body.teacherId && String(body.teacherId) !== String(currentUser.id)) return { error: forbidden() };
    return { teacherId: currentUser.id };
  }
  if (!isAdmin(currentUser)) return { error: forbidden() };
  if (!isValidUuid(body.teacherId)) return { error: badRequest("teacherId must be a valid UUID") };
  const rows = await sql`
    select id, school_id, role
    from app_users
    where id = ${body.teacherId} and role = 'teacher'
    limit 1
  `;
  if (!rows[0]) return { error: json(404, { error: "Teacher not found" }) };
  if (!sameSchool(currentUser, rows[0].school_id)) return { error: forbidden() };
  return { teacherId: rows[0].id };
}

async function resolveHomeworkTargets(sql, currentUser, items) {
  const resolved = [];
  const requestCache = new Map();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind === LEGACY_TARGET_KIND) {
      const rows = await sql`
        select activity.id, activity.title, activity.is_assignable, activity.content_json,
               package.id as book_package_id, builder_current_legacy_activity_allowed(component.id) as legacy_assignment_allowed
        from activities activity
        join lessons lesson on lesson.id = activity.lesson_id
        join units unit_record on unit_record.id = lesson.unit_id
        join book_components component on component.id = unit_record.book_component_id
        join book_packages package on package.id = component.book_package_id and package.status = 'active'
        where activity.id = ${item.activityId}
        limit 1
      `;
      const activity = rows[0];
      if (!activity) return { error: json(404, { error: "Activity not found" }) };
      if (
        activity.is_assignable === false
        || activity.content_json?.implementationMode === "unsupported-disabled"
        || activity.content_json?.implementationStatus === "disabled-editorial-only"
      ) return { error: forbidden("This activity is not assignable") };
      const accessError = await verifyPackageAccess(sql, currentUser, { activityId: item.activityId });
      if (accessError) return { error: accessError };
      if (activity.legacy_assignment_allowed === false) return { error: json(409, { error: "Choose a published Students Book activity for a new Homework item.", code: "students_book_native_publication_required" }) };
      resolved.push({
        position: index + 1,
        target_kind: LEGACY_TARGET_KIND,
        activity_id: item.activityId,
        native_release_id: null,
        native_activity_id: null,
        book_package_id: activity.book_package_id,
        title: activity.title,
      });
      continue;
    }
    const target = await resolveNativeAssignmentTarget(sql, currentUser, {
      kind: NATIVE_ASSIGNMENT_TARGET_KIND,
      releaseId: item.releaseId,
      nativeActivityId: item.nativeActivityId,
      ...(item.locator ? { locator: item.locator } : {}),
    }, { requireActive: true, requestCache });
    if (target.error) return { error: json(target.statusCode || 400, { error: target.error }) };
    if (!target.capability?.assignable) return { error: forbidden("This published native activity is not assignable") };
    resolved.push({
      position: index + 1,
      target_kind: NATIVE_ASSIGNMENT_TARGET_KIND,
      activity_id: null,
      native_release_id: target.row.id,
      native_activity_id: target.nativeActivityId,
      native_book_locator: target.locator || null,
      book_package_id: target.row.book_package_id,
      title: target.publicEntry.document?.metadata?.title || target.nativeActivityId,
    });
  }
  return { items: resolved };
}

export async function createHomework(sql, body, currentUser) {
  if (containsClientTeacherMaterial(body)) return badRequest("Teacher/model-answer material is not accepted from clients");
  const teacherScope = await resolveHomeworkTeacher(sql, body, currentUser);
  if (teacherScope.error) return teacherScope.error;
  const input = normalizeHomeworkCreateBody(body, {
    teacherId: teacherScope.teacherId,
    schoolId: currentUser.school_id,
  });
  if (input.error) return badRequest(input.error);

  const existingRows = await sql`
    select id, request_sha256
    from homeworks
    where school_id = ${currentUser.school_id}
      and teacher_id = ${teacherScope.teacherId}
      and idempotency_key = ${input.idempotencyKey}
    limit 1
  `;
  if (existingRows[0]) {
    if (existingRows[0].request_sha256 !== input.requestSha256) {
      return json(409, { error: "idempotencyKey was already used for different Homework content", conflict: "idempotency-key-reuse" });
    }
    const homework = await getTeacherHomework(sql, existingRows[0].id, teacherScope.teacherId, currentUser);
    return json(200, { homework, idempotent: true });
  }

  for (const classId of input.classIds) {
    const accessError = await verifyClassAccess(sql, currentUser, classId);
    if (accessError) return accessError;
  }
  const classRows = await sql`
    select id, teacher_id, school_id, status, book_package_id
    from classes
    where id = any(${input.classIds}::uuid[])
      and school_id = ${currentUser.school_id}
  `;
  if (classRows.length !== input.classIds.length || classRows.some((row) => row.status !== "active")) {
    return forbidden("Homework can only target active permitted classes");
  }
  const targets = await resolveHomeworkTargets(sql, currentUser, input.items);
  if (targets.error) return targets.error;
  const packageConflict = classTargetPackageConflictResponse(
    classRows,
    targets.items.map((item) => item.book_package_id),
  );
  if (packageConflict) return packageConflict;

  const rows = await sql`
    with item_input as materialized (
      select *
      from jsonb_to_recordset(${JSON.stringify(targets.items)}::jsonb) as input(
        position integer,
        target_kind text,
        activity_id uuid,
        native_release_id uuid,
        native_activity_id text,
        native_book_locator jsonb,
        title text
      )
    ), upserted_homework as (
      insert into homeworks (
        school_id, teacher_id, title, teacher_notes, worksheet_links, due_at,
        status, idempotency_key, request_sha256
      ) values (
        ${currentUser.school_id}, ${teacherScope.teacherId}, ${input.title},
        ${input.teacherNotes}, ${JSON.stringify(input.worksheetLinks)}::jsonb,
        ${input.dueAt}, 'assigned', ${input.idempotencyKey}, ${input.requestSha256}
      )
      on conflict (school_id, teacher_id, idempotency_key)
      do update set idempotency_key = excluded.idempotency_key
      where homeworks.request_sha256 = excluded.request_sha256
      returning *
    ), upserted_items as (
      insert into homework_items (
        homework_id, position, target_kind, activity_id, native_release_id, native_activity_id, native_book_locator
      )
      select homework.id, input.position, input.target_kind, input.activity_id,
             input.native_release_id, input.native_activity_id, input.native_book_locator
      from upserted_homework homework
      cross join item_input input
      on conflict (homework_id, position)
      do update set position = excluded.position
      returning *
    ), upserted_assignments as (
      insert into activity_assignments (
        school_id, activity_id, target_kind, native_release_id, native_activity_id, native_book_locator,
        teacher_id, class_id, student_id, due_at, status, title, teacher_notes,
        worksheet_links, attached_files, idempotency_key, homework_id, homework_item_id
      )
      select homework.school_id, item.activity_id, item.target_kind,
             item.native_release_id, item.native_activity_id, item.native_book_locator, homework.teacher_id,
             class_id, null, homework.due_at, 'assigned', homework.title,
             homework.teacher_notes, homework.worksheet_links, '[]'::jsonb,
             'homework:' || homework.id || ':item:' || item.id || ':class:' || class_id,
             homework.id, item.id
      from upserted_homework homework
      join upserted_items item on item.homework_id = homework.id
      join item_input input on input.position = item.position
      cross join unnest(${input.classIds}::uuid[]) class_id
      on conflict (school_id, teacher_id, idempotency_key)
        where idempotency_key is not null
      do update set idempotency_key = excluded.idempotency_key
      returning id
    )
    select (select id from upserted_homework limit 1) as homework_id,
           (select count(*)::int from upserted_items) as item_count,
           (select count(*)::int from upserted_assignments) as assignment_count
  `;
  if (!rows[0]?.homework_id) {
    return json(409, { error: "idempotencyKey was already used for different Homework content", conflict: "idempotency-key-reuse" });
  }
  const homework = await getTeacherHomework(sql, rows[0].homework_id, teacherScope.teacherId, currentUser);
  return json(201, { homework, idempotent: false });
}

function storedTargetIdentity(item) {
  return item.target_kind === LEGACY_TARGET_KIND
    ? `${LEGACY_TARGET_KIND}:${item.activity_id}`
    : `${NATIVE_ASSIGNMENT_TARGET_KIND}:${item.native_release_id}:${item.native_activity_id}`;
}

function sameOrderedValues(left, right) {
  return left.length === right.length && left.every((value, index) => String(value) === String(right[index]));
}

function conflictResponse(conflict, error) {
  return json(409, { error, conflict });
}

export async function updateHomework(sql, body, currentUser) {
  if (containsClientTeacherMaterial(body)) return badRequest("Teacher/model-answer material is not accepted from clients");
  const input = normalizeHomeworkUpdateBody(body);
  if (input.error) return badRequest(input.error);

  const mutation = await withHomeworkMutationTransaction(sql, input.homeworkId, async (transactionSql) => {
    const homeworkRows = await transactionSql`
      select *, updated_at = ${input.expectedUpdatedAt}::timestamptz as updated_at_matches
      from homeworks
      where id = ${input.homeworkId}
      for update
    `;
    const currentHomework = homeworkRows[0];
    if (!currentHomework) return json(404, { error: "Homework not found" });
    const authorized = sameSchool(currentUser, currentHomework.school_id)
      && (isAdmin(currentUser) || (isTeacher(currentUser) && String(currentHomework.teacher_id) === String(currentUser.id)));
    if (!authorized) return forbidden();
    if (currentHomework.status === "closed") {
      return conflictResponse("homework-closed", "Closed Homework is read-only.");
    }
    if (!currentHomework.updated_at_matches) {
      return conflictResponse("homework-stale-edit", "This Homework changed after you opened it. Reload and reopen it before saving.");
    }

    const currentItems = await transactionSql`
      select item.id, item.position, item.target_kind, item.activity_id,
             item.native_release_id, item.native_activity_id, item.native_book_locator,
             coalesce(component.book_package_id, release.book_package_id) as book_package_id
      from homework_items item
      left join activities activity on activity.id = item.activity_id
      left join lessons lesson on lesson.id = activity.lesson_id
      left join units unit_record on unit_record.id = lesson.unit_id
      left join book_components component on component.id = unit_record.book_component_id
      left join book_component_releases release on release.id = item.native_release_id
      where item.homework_id = ${input.homeworkId}
      order by item.position
    `;
    const currentAssignments = await transactionSql`
      select id, homework_item_id, class_id, idempotency_key
      from activity_assignments
      where homework_id = ${input.homeworkId}
      order by id
      for update
    `;
    const requestedIdentities = input.items.map(targetIdentity);
    const currentIdentities = currentItems.map(storedTargetIdentity);
    const currentClassIds = [...new Set(currentAssignments.map((assignment) => String(assignment.class_id)).filter(Boolean))].sort();
    const requestedClassIds = [...input.classIds].map(String).sort();
    const currentPairKeys = currentAssignments.map((assignment) => `${assignment.homework_item_id}:${assignment.class_id}`);
    const currentPairKeySet = new Set(currentPairKeys);
    const requestedPairKeys = currentItems.flatMap((item) => input.classIds.map((classId) => `${item.id}:${classId}`));
    const matrixChanged = currentPairKeySet.size !== currentPairKeys.length
      || currentPairKeySet.size !== requestedPairKeys.length
      || requestedPairKeys.some((pair) => !currentPairKeySet.has(pair));
    const structureChanged = !sameOrderedValues(currentIdentities, requestedIdentities)
      || !sameOrderedValues(currentClassIds, requestedClassIds)
      || matrixChanged;
    const submissionRows = await transactionSql`
      select exists (
        select 1
        from activity_submissions submission
        join activity_assignments assignment on assignment.id = submission.activity_assignment_id
        where assignment.homework_id = ${input.homeworkId}
      ) as has_submissions
    `;
    if (structureChanged && submissionRows[0]?.has_submissions) {
      return conflictResponse(
        "homework-structure-locked",
        "Exercises, order, and classes are locked because learner work already exists.",
      );
    }

    const existingByIdentity = new Map(currentItems.map((item) => [storedTargetIdentity(item), item]));
    const newRequestedItems = input.items.filter((item) => !existingByIdentity.has(targetIdentity(item)));
    const resolvedNewTargets = newRequestedItems.length
      ? await resolveHomeworkTargets(transactionSql, currentUser, newRequestedItems)
      : { items: [] };
    if (resolvedNewTargets.error) return resolvedNewTargets.error;
    const resolvedNewByIdentity = new Map(newRequestedItems.map((item, index) => [
      targetIdentity(item),
      resolvedNewTargets.items[index],
    ]));

    if (structureChanged) {
      for (const classId of input.classIds) {
        const accessError = await verifyClassAccess(transactionSql, currentUser, classId);
        if (accessError) return accessError;
      }
      const classRows = await transactionSql`
        select id, teacher_id, school_id, status, book_package_id
        from classes
        where id = any(${input.classIds}::uuid[])
          and school_id = ${currentHomework.school_id}
      `;
      if (classRows.length !== input.classIds.length || classRows.some((row) => row.status !== "active")) {
        return forbidden("Homework can only target active permitted classes");
      }
      const requestedTargetPackages = input.items.map((item) => (
        existingByIdentity.get(targetIdentity(item))?.book_package_id
        || resolvedNewByIdentity.get(targetIdentity(item))?.book_package_id
        || null
      ));
      const packageConflict = classTargetPackageConflictResponse(classRows, requestedTargetPackages);
      if (packageConflict) return packageConflict;
    }

    const finalItems = input.items.map((item, index) => {
      const identity = targetIdentity(item);
      const existing = existingByIdentity.get(identity);
      const resolved = resolvedNewByIdentity.get(identity);
      return existing
        ? { ...existing, position: index + 1, identity }
        : { id: randomUUID(), ...resolved, position: index + 1, identity };
    });

    const assignmentByPair = new Map();
    for (const assignment of currentAssignments) {
      const pair = `${assignment.homework_item_id}:${assignment.class_id}`;
      if (assignmentByPair.has(pair)) {
        return conflictResponse("homework-integrity-conflict", "Homework assignments are not in a safely editable state.");
      }
      assignmentByPair.set(pair, assignment);
    }

    if (structureChanged) {
      const currentItemIds = currentItems.map((item) => item.id);
      if (currentItemIds.length) {
        await transactionSql`
          update homework_items
          set position = position + 1000000
          where homework_id = ${input.homeworkId}
            and id = any(${currentItemIds}::uuid[])
        `;
      }

      const finalItemIds = new Set(finalItems.map((item) => String(item.id)));
      const finalClassIds = new Set(input.classIds.map(String));
      const removedAssignmentIds = currentAssignments
        .filter((assignment) => !finalItemIds.has(String(assignment.homework_item_id)) || !finalClassIds.has(String(assignment.class_id)))
        .map((assignment) => assignment.id);
      if (removedAssignmentIds.length) {
        await transactionSql`
          delete from activity_assignments
          where homework_id = ${input.homeworkId}
            and id = any(${removedAssignmentIds}::uuid[])
        `;
      }

      const removedItemIds = currentItems.filter((item) => !finalItemIds.has(String(item.id))).map((item) => item.id);
      if (removedItemIds.length) {
        await transactionSql`
          delete from homework_items
          where homework_id = ${input.homeworkId}
            and id = any(${removedItemIds}::uuid[])
        `;
      }

      for (const item of finalItems.filter((candidate) => existingByIdentity.has(candidate.identity))) {
        await transactionSql`
          update homework_items
          set position = ${item.position}
          where homework_id = ${input.homeworkId} and id = ${item.id}
        `;
      }
      for (const item of finalItems.filter((candidate) => !existingByIdentity.has(candidate.identity))) {
        await transactionSql`
          insert into homework_items (
            id, homework_id, position, target_kind, activity_id, native_release_id, native_activity_id, native_book_locator
          ) values (
            ${item.id}, ${input.homeworkId}, ${item.position}, ${item.target_kind}, ${item.activity_id},
            ${item.native_release_id}, ${item.native_activity_id}, ${item.native_book_locator ? JSON.stringify(item.native_book_locator) : null}::jsonb
          )
        `;
      }

      const missingAssignments = [];
      for (const item of finalItems) {
        for (const classId of input.classIds) {
          if (!assignmentByPair.has(`${item.id}:${classId}`)) missingAssignments.push({ item, classId });
        }
      }
      if (missingAssignments.length) {
        await transactionSql`
          insert into activity_assignments (
            school_id, activity_id, target_kind, native_release_id, native_activity_id, native_book_locator,
            teacher_id, class_id, student_id, due_at, status, title, teacher_notes,
            worksheet_links, attached_files, idempotency_key, homework_id, homework_item_id
          )
          select ${currentHomework.school_id}, input.activity_id, input.target_kind,
                 input.native_release_id, input.native_activity_id, input.native_book_locator, ${currentHomework.teacher_id},
                 input.class_id, null, ${input.dueAt}, 'assigned', ${input.title},
                 ${input.teacherNotes}, ${JSON.stringify(input.worksheetLinks)}::jsonb, '[]'::jsonb,
                 'homework:' || ${input.homeworkId} || ':item:' || input.item_id || ':class:' || input.class_id,
                 ${input.homeworkId}, input.item_id
          from jsonb_to_recordset(${JSON.stringify(missingAssignments.map(({ item, classId }) => ({
            item_id: item.id,
            class_id: classId,
            target_kind: item.target_kind,
            activity_id: item.activity_id,
            native_release_id: item.native_release_id,
            native_activity_id: item.native_activity_id,
            native_book_locator: item.native_book_locator || null,
          })))}::jsonb) as input(
            item_id uuid, class_id uuid, target_kind text, activity_id uuid,
            native_release_id uuid, native_activity_id text, native_book_locator jsonb
          )
        `;
      }
    }

    await transactionSql`
      update activity_assignments
      set title = ${input.title}, teacher_notes = ${input.teacherNotes},
          worksheet_links = ${JSON.stringify(input.worksheetLinks)}::jsonb, due_at = ${input.dueAt}
      where homework_id = ${input.homeworkId}
    `;
    await transactionSql`
      update homeworks
      set title = ${input.title}, teacher_notes = ${input.teacherNotes},
          worksheet_links = ${JSON.stringify(input.worksheetLinks)}::jsonb, due_at = ${input.dueAt},
          updated_at = clock_timestamp()
      where id = ${input.homeworkId}
    `;
    return { teacherId: currentHomework.teacher_id };
  });
  if (mutation?.statusCode) return mutation;
  const homework = await getTeacherHomework(sql, input.homeworkId, mutation.teacherId, currentUser);
  return json(200, { homework });
}

async function teacherHomeworkRows(sql, teacherId, currentUser) {
  const headers = await sql`
    select homework.*,
           to_char(homework.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
    from homeworks homework
    where homework.school_id = ${currentUser.school_id}
      and (${teacherId || null}::uuid is null or homework.teacher_id = ${teacherId || null})
    order by homework.created_at desc, homework.id
  `;
  if (!headers.length) return { headers, items: [], assignments: [], progress: [], structureLocks: [] };
  const homeworkIds = headers.map((row) => row.id);
  const [items, allAssignments, progress, structureLocks] = await Promise.all([
    sql`
      select item.*, coalesce(activity.title, native_public.value->'document'->'metadata'->>'title', item.native_activity_id) as title,
             activity.slug as activity_slug,
             coalesce(activity.activity_type, native_public.value->>'kind') as activity_type,
             coalesce(component.title, native_component.title) as component_title,
             coalesce(component.id, native_component.id) as component_id,
             coalesce(component.slug, native_component.slug) as component_slug,
             coalesce(package.id, native_package.id) as package_id,
             coalesce(package.slug, native_package.slug) as package_slug,
             coalesce(package.title, native_package.title) as package_title
      from homework_items item
      left join activities activity on activity.id = item.activity_id
      left join lessons lesson on lesson.id = activity.lesson_id
      left join units unit_record on unit_record.id = lesson.unit_id
      left join book_components component on component.id = unit_record.book_component_id
      left join book_packages package on package.id = component.book_package_id
      left join book_component_releases release on release.id = item.native_release_id
      left join book_components native_component on native_component.id = release.book_component_id
      left join book_packages native_package on native_package.id = release.book_package_id
      left join lateral jsonb_each(release.public_projection->'nativeActivities') native_public
        on native_public.key = item.native_activity_id
      where item.homework_id = any(${homeworkIds}::uuid[])
      order by item.homework_id, item.position
    `,
    listTeacherAssignments(sql, teacherId, currentUser),
    sql`
      with eligible_assignments as (
        select assignment.homework_id, assignment.homework_item_id, assignment.id as assignment_id, membership.student_id
        from activity_assignments assignment
        join homework_items item on item.id = assignment.homework_item_id and item.homework_id = assignment.homework_id
        left join activities activity on activity.id = item.activity_id
        left join lessons lesson on lesson.id = activity.lesson_id
        left join units unit_record on unit_record.id = lesson.unit_id
        left join book_components component on component.id = unit_record.book_component_id
        left join book_component_releases release on release.id = item.native_release_id
        join class_students membership on membership.class_id = assignment.class_id
          and coalesce(membership.status, 'active') = 'active'
        join book_access access on access.user_id = membership.student_id
          and access.book_package_id = coalesce(component.book_package_id, release.book_package_id)
          and access.role_scope = 'student'
        join book_packages entitled_package on entitled_package.id = access.book_package_id
          and entitled_package.status = 'active'
        where assignment.homework_id = any(${homeworkIds}::uuid[])
        union all
        select assignment.homework_id, assignment.homework_item_id, assignment.id, assignment.student_id
        from activity_assignments assignment
        join homework_items item on item.id = assignment.homework_item_id and item.homework_id = assignment.homework_id
        left join activities activity on activity.id = item.activity_id
        left join lessons lesson on lesson.id = activity.lesson_id
        left join units unit_record on unit_record.id = lesson.unit_id
        left join book_components component on component.id = unit_record.book_component_id
        left join book_component_releases release on release.id = item.native_release_id
        join book_access access on access.user_id = assignment.student_id
          and access.book_package_id = coalesce(component.book_package_id, release.book_package_id)
          and access.role_scope = 'student'
        join book_packages entitled_package on entitled_package.id = access.book_package_id
          and entitled_package.status = 'active'
        where assignment.homework_id = any(${homeworkIds}::uuid[])
          and assignment.student_id is not null
      ), eligible_pairs as (
        select distinct homework_id, homework_item_id, student_id
        from eligible_assignments
      ), latest_submissions as (
        select distinct on (eligible.homework_id, eligible.homework_item_id, eligible.student_id)
               eligible.homework_id, eligible.homework_item_id, eligible.student_id,
               submission.id, submission.status
        from eligible_assignments eligible
        join activity_submissions submission
          on submission.activity_assignment_id = eligible.assignment_id
         and submission.student_id = eligible.student_id
        order by eligible.homework_id, eligible.homework_item_id, eligible.student_id,
                 submission.submitted_at desc, submission.id desc
      )
      select eligible.homework_id,
             count(*)::int as expected_count,
             count(latest.id)::int as submitted_count,
             count(latest.id) filter (where latest.status = 'awaiting_review')::int as awaiting_review_count,
             count(latest.id) filter (where latest.status = 'reviewed')::int as reviewed_count,
             count(latest.id) filter (where latest.status in ('submitted', 'completed'))::int as auto_scored_count
      from eligible_pairs eligible
      left join latest_submissions latest
        on latest.homework_id = eligible.homework_id
       and latest.homework_item_id = eligible.homework_item_id
       and latest.student_id = eligible.student_id
      group by eligible.homework_id
    `,
    sql`
      select homework.id as homework_id,
             exists (
               select 1
               from activity_assignments assignment
               join activity_submissions submission on submission.activity_assignment_id = assignment.id
               where assignment.homework_id = homework.id
             ) as structure_locked
      from homeworks homework
      where homework.id = any(${homeworkIds}::uuid[])
    `,
  ]);
  return {
    headers,
    items,
    assignments: allAssignments.filter((assignment) => assignment.homeworkId && homeworkIds.includes(assignment.homeworkId)),
    progress,
    structureLocks,
  };
}

export async function listTeacherHomeworks(sql, teacherId, currentUser) {
  return assembleTeacherHomeworks(await teacherHomeworkRows(sql, teacherId, currentUser));
}

export async function getTeacherHomework(sql, homeworkId, teacherId, currentUser) {
  if (!isValidUuid(homeworkId)) return null;
  return (await listTeacherHomeworks(sql, teacherId, currentUser))
    .find((homework) => String(homework.id) === String(homeworkId)) || null;
}

export async function listStudentHomeworks(sql, studentId, currentUser) {
  if (!studentId) return [];
  const rows = await sql`
    select homework.id as homework_id, homework.title as homework_title,
           homework.teacher_notes, homework.worksheet_links, homework.due_at,
           homework.status as homework_status, teacher.full_name as teacher_name,
           item.id as homework_item_id, item.position, item.target_kind,
           item.activity_id, item.native_release_id, item.native_activity_id,
           assignment.id as assignment_id, assignment.status,
           class_record.name as class_name,
           coalesce(activity.title, native_public.value->'document'->'metadata'->>'title', item.native_activity_id) as activity_title,
           coalesce(component.title, native_component.title) as component_title,
           coalesce(component.id, native_component.id) as component_id,
           coalesce(component.slug, native_component.slug) as component_slug,
           coalesce(package.id, native_package.id) as package_id,
           coalesce(package.slug, native_package.slug) as package_slug,
           coalesce(package.title, native_package.title) as package_title,
           latest.id as submission_id, latest.status as submission_status,
           latest.submitted_at, latest.score_percent
    from homeworks homework
    join homework_items item on item.homework_id = homework.id
    join activity_assignments assignment
      on assignment.homework_id = homework.id and assignment.homework_item_id = item.id
    left join classes class_record on class_record.id = assignment.class_id
    left join app_users teacher on teacher.id = homework.teacher_id
    left join activities activity on activity.id = item.activity_id
    left join lessons lesson on lesson.id = activity.lesson_id
    left join units unit_record on unit_record.id = lesson.unit_id
    left join book_components component on component.id = unit_record.book_component_id
    left join book_packages package on package.id = component.book_package_id
    left join book_component_releases release on release.id = item.native_release_id
    left join book_components native_component on native_component.id = release.book_component_id
    left join book_packages native_package on native_package.id = release.book_package_id
    left join lateral jsonb_each(release.public_projection->'nativeActivities') native_public
      on native_public.key = item.native_activity_id
    left join lateral (
      select submission.id, submission.status, submission.submitted_at, submission.score_percent
      from activity_submissions submission
      where submission.activity_assignment_id = assignment.id
        and submission.student_id = ${studentId}
      order by submission.submitted_at desc, submission.id desc
      limit 1
    ) latest on true
    where homework.school_id = ${currentUser.school_id}
      and assignment.school_id = ${currentUser.school_id}
      and coalesce(package.status, native_package.status) = 'active'
      and exists (
        select 1
        from book_access access
        where access.user_id = ${studentId}
          and access.book_package_id = coalesce(package.id, native_package.id)
          and access.role_scope = 'student'
      )
      and (
        assignment.student_id = ${studentId}
        or exists (
          select 1 from class_students membership
          where membership.class_id = assignment.class_id
            and membership.student_id = ${studentId}
            and coalesce(membership.status, 'active') = 'active'
        )
      )
    order by homework.created_at desc, homework.id, item.position, assignment.id
  `;
  return assembleStudentHomeworks(rows);
}
