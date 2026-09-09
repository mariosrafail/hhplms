import { loadPinnedNativeAssignmentTarget } from "../netlify/functions/_book-content/native-assignment-runtime.js";
import { postgresTemplate } from "./_staging-db.mjs";

async function activityAssignmentRelationshipIssues(queryable) {
  const { rows } = await queryable.query(`
    with relationships as (
      select a.target_kind, a.native_release_id, a.native_activity_id,
             (s.id is null
              or (a.teacher_id is not null and t.id is null)
              or (a.class_id is not null and c.id is null)
              or (a.student_id is not null and student.id is null)
              or case a.target_kind
                when 'legacy_activity' then
                  act.id is null or a.native_release_id is not null or a.native_activity_id is not null
                when 'published_native' then
                  a.activity_id is not null or a.native_release_id is null or a.native_activity_id is null
                  or a.native_activity_id !~ '^[a-z0-9][a-z0-9-]{0,127}$'
                else true
              end) as missing_relationship
      from activity_assignments a
      left join schools s on s.id = a.school_id
      left join activities act on act.id = a.activity_id
      left join app_users t on t.id = a.teacher_id
      left join classes c on c.id = a.class_id
      left join app_users student on student.id = a.student_id
    )
    select * from relationships where missing_relationship or target_kind = 'published_native'
  `);
  const sql = postgresTemplate(queryable);
  const targets = new Map();
  let count = 0;
  for (const row of rows) {
    if (row.missing_relationship) { count += 1; continue; }
    const key = JSON.stringify([row.native_release_id, row.native_activity_id]);
    // Historical assignments resolve their immutable published release, not the
    // current publication head or mutable authoring index. Integrity errors fail closed.
    if (!targets.has(key)) targets.set(key, Boolean(await loadPinnedNativeAssignmentTarget(sql, row)));
    if (!targets.get(key)) count += 1;
  }
  return count;
}

export async function countRelationshipIssues(queryable, check) {
  return typeof check === "function"
    ? check(queryable)
    : Number((await queryable.query(check)).rows[0].count);
}

export const relationshipChecks = [
  ["users_without_school", "select count(*)::int as count from app_users where school_id is null"],
  ["classes_missing_school", `select count(*)::int as count from classes c left join schools s on s.id = c.school_id where s.id is null`],
  ["classes_missing_teacher", `select count(*)::int as count from classes c left join app_users t on t.id = c.teacher_id where c.teacher_id is not null and t.id is null`],
  ["classes_with_cross_school_teacher", `select count(*)::int as count from classes c join app_users t on t.id = c.teacher_id where c.school_id is distinct from t.school_id`],
  ["class_memberships_missing_relationship", `select count(*)::int as count from class_students cs left join classes c on c.id = cs.class_id left join app_users s on s.id = cs.student_id where c.id is null or s.id is null`],
  ["cross_school_class_memberships", `select count(*)::int as count from class_students cs join classes c on c.id = cs.class_id join app_users s on s.id = cs.student_id where c.school_id is distinct from s.school_id`],

  ["courses_missing_relationship", `select count(*)::int as count from courses c left join schools s on s.id = c.school_id left join book_packages p on p.id = c.book_package_id left join app_users u on u.id = c.created_by where s.id is null or (c.book_package_id is not null and p.id is null) or (c.created_by is not null and u.id is null)`],
  ["custom_courses_without_creator", `select count(*)::int as count from courses where ownership_type = 'custom' and created_by is null`],
  ["custom_courses_cross_school_creator", `select count(*)::int as count from courses c join app_users u on u.id = c.created_by where c.ownership_type = 'custom' and c.school_id is distinct from u.school_id`],
  ["lessons_missing_relationship", `select count(*)::int as count from lessons l left join courses c on c.id = l.course_id left join units u on u.id = l.unit_id left join app_users creator on creator.id = l.created_by where (l.course_id is null and l.unit_id is null) or (l.course_id is not null and c.id is null) or (l.unit_id is not null and u.id is null) or (l.created_by is not null and creator.id is null)`],
  ["lessons_cross_school_course", `select count(*)::int as count from lessons l join courses c on c.id = l.course_id where l.school_id is not null and c.school_id is not null and l.school_id is distinct from c.school_id`],
  ["custom_lessons_without_creator", `select count(*)::int as count from lessons where ownership_type = 'custom' and created_by is null`],
  ["custom_lessons_cross_school_creator", `select count(*)::int as count from lessons l join app_users u on u.id = l.created_by where l.ownership_type = 'custom' and l.school_id is distinct from u.school_id`],
  ["lesson_activities_missing_relationship", `select count(*)::int as count from lesson_activities a left join lessons l on l.id = a.lesson_id left join app_users u on u.id = a.created_by where l.id is null or (a.created_by is not null and u.id is null)`],
  ["lesson_activities_cross_school_lesson", `select count(*)::int as count from lesson_activities a join lessons l on l.id = a.lesson_id where a.school_id is not null and l.school_id is not null and a.school_id is distinct from l.school_id`],
  ["custom_lesson_activities_without_creator", `select count(*)::int as count from lesson_activities where ownership_type = 'custom' and created_by is null`],
  ["custom_lesson_activities_cross_school_creator", `select count(*)::int as count from lesson_activities a join app_users u on u.id = a.created_by where a.ownership_type = 'custom' and a.school_id is distinct from u.school_id`],

  ["activities_missing_relationship", `select count(*)::int as count from activities a left join schools s on s.id = a.school_id left join lessons l on l.id = a.lesson_id left join app_users u on u.id = a.created_by where (a.school_id is not null and s.id is null) or (a.lesson_id is not null and l.id is null) or (a.created_by is not null and u.id is null)`],
  ["activities_cross_school_lesson", `select count(*)::int as count from activities a join lessons l on l.id = a.lesson_id where a.school_id is not null and l.school_id is not null and a.school_id is distinct from l.school_id`],
  ["custom_activities_without_creator", `select count(*)::int as count from activities where ownership_type = 'custom' and created_by is null`],
  ["custom_activities_cross_school_creator", `select count(*)::int as count from activities a join app_users u on u.id = a.created_by where a.ownership_type = 'custom' and a.school_id is distinct from u.school_id`],

  ["legacy_assignments_missing_relationship", `select count(*)::int as count from assignments a left join schools s on s.id = a.school_id left join activities act on act.id = a.activity_id left join app_users owner on owner.id = a.assigned_by where s.id is null or (a.activity_id is not null and act.id is null) or (a.assigned_by is not null and owner.id is null)`],
  ["legacy_assignments_missing_target", `select count(*)::int as count from assignments a left join classes c on a.target_type = 'class' and c.id = a.target_id left join app_users u on a.target_type = 'student' and u.id = a.target_id where (a.target_type = 'class' and c.id is null) or (a.target_type = 'student' and u.id is null)`],
  ["legacy_assignments_cross_school_owner", `select count(*)::int as count from assignments a join app_users u on u.id = a.assigned_by where a.school_id is distinct from u.school_id`],
  ["legacy_assignments_cross_school_class", `select count(*)::int as count from assignments a join classes c on a.target_type = 'class' and c.id = a.target_id where a.school_id is distinct from c.school_id`],
  ["legacy_assignments_cross_school_student", `select count(*)::int as count from assignments a join app_users s on a.target_type = 'student' and s.id = a.target_id where a.school_id is distinct from s.school_id`],
  ["activity_assignments_missing_relationship", activityAssignmentRelationshipIssues],
  ["activity_assignments_invalid_target", `select count(*)::int as count from activity_assignments where (class_id is null and student_id is null) or (class_id is not null and student_id is not null)`],
  ["activity_assignments_cross_school_activity", `select count(*)::int as count from activity_assignments a join activities act on act.id = a.activity_id where act.school_id is not null and a.school_id is distinct from act.school_id`],
  ["activity_assignments_cross_school_class", `select count(*)::int as count from activity_assignments a join classes c on c.id = a.class_id where a.school_id is distinct from c.school_id`],
  ["activity_assignments_cross_school_teacher", `select count(*)::int as count from activity_assignments a join app_users t on t.id = a.teacher_id where a.school_id is distinct from t.school_id`],
  ["activity_assignments_cross_school_student", `select count(*)::int as count from activity_assignments a join app_users s on s.id = a.student_id where a.school_id is distinct from s.school_id`],
  ["lesson_assignments_missing_relationship", `select count(*)::int as count from lesson_assignments a left join schools s on s.id = a.school_id left join lessons l on l.id = a.lesson_id left join app_users owner on owner.id = a.assigned_by left join classes c on c.id = a.class_id left join app_users student on student.id = a.student_id where s.id is null or l.id is null or owner.id is null or (a.class_id is not null and c.id is null) or (a.student_id is not null and student.id is null)`],
  ["lesson_assignments_cross_school_owner", `select count(*)::int as count from lesson_assignments a join app_users u on u.id = a.assigned_by where a.school_id is distinct from u.school_id`],
  ["lesson_assignments_cross_school_class", `select count(*)::int as count from lesson_assignments a join classes c on c.id = a.class_id where a.school_id is distinct from c.school_id`],
  ["lesson_assignments_cross_school_student", `select count(*)::int as count from lesson_assignments a join app_users u on u.id = a.student_id where a.school_id is distinct from u.school_id`],

  ["activity_submissions_missing_relationship", `select count(*)::int as count from activity_submissions s left join schools school on school.id = s.school_id left join app_users student on student.id = s.student_id left join assignments legacy on legacy.id = s.assignment_id left join activities act on act.id = s.activity_id left join activity_assignments aa on aa.id = s.activity_assignment_id where school.id is null or student.id is null or (s.assignment_id is not null and legacy.id is null) or (s.activity_id is not null and act.id is null) or (s.activity_assignment_id is not null and aa.id is null)`],
  ["activity_submissions_cross_school_student", `select count(*)::int as count from activity_submissions s join app_users u on u.id = s.student_id where s.school_id is distinct from u.school_id`],
  ["activity_submissions_cross_school_assignment", `select count(*)::int as count from activity_submissions s join activity_assignments a on a.id = s.activity_assignment_id where s.school_id is distinct from a.school_id`],
  ["activity_submissions_cross_school_legacy_assignment", `select count(*)::int as count from activity_submissions s join assignments a on a.id = s.assignment_id where s.school_id is distinct from a.school_id`],
  ["lesson_submissions_missing_relationship", `select count(*)::int as count from lesson_submissions s left join schools school on school.id = s.school_id left join lessons l on l.id = s.lesson_id left join app_users student on student.id = s.student_id where school.id is null or l.id is null or student.id is null`],
  ["lesson_submissions_cross_school_student", `select count(*)::int as count from lesson_submissions s join app_users u on u.id = s.student_id where s.school_id is distinct from u.school_id`],

  ["hotspots_missing_content_context", `select count(*)::int as count from book_page_hotspots h left join book_packages p on p.slug = h.package_slug left join book_components c on c.book_package_id = p.id and c.slug = h.component_slug where p.id is null or c.id is null`],
  ["custom_hotspots_cross_school_creator", `select count(*)::int as count from book_page_hotspots h join app_users u on u.id = h.created_by where h.school_id is distinct from u.school_id`],
  ["media_missing_content_context", `select count(*)::int as count from book_media_assets m left join book_packages p on p.slug = m.package_slug left join book_components c on c.book_package_id = p.id and c.slug = m.component_slug where p.id is null or c.id is null`],
  ["custom_media_cross_school_creator", `select count(*)::int as count from book_media_assets m join app_users u on u.id = m.created_by where m.school_id is distinct from u.school_id`],
  ["book_activities_missing_relationship", `select count(*)::int as count from book_activities a left join book_packages p on p.slug = a.package_slug left join book_components c on c.book_package_id = p.id and c.slug = a.component_slug left join book_media_assets m on m.id = a.media_id where p.id is null or c.id is null or (a.media_id is not null and m.id is null)`],
  ["custom_book_activities_cross_school_creator", `select count(*)::int as count from book_activities a join app_users u on u.id = a.created_by where a.school_id is distinct from u.school_id`],
  ["book_access_missing_relationship", `select count(*)::int as count from book_access a left join app_users u on u.id = a.user_id left join book_packages p on p.id = a.book_package_id where u.id is null or p.id is null`],
  ["license_batches_missing_relationship", `select count(*)::int as count from activation_code_batches b left join schools s on s.id=b.school_id left join book_packages p on p.id=b.book_package_id left join app_users u on u.id=b.created_by where s.id is null or p.id is null or (b.created_by is not null and u.id is null)`],
  ["license_batches_cross_school_creator", `select count(*)::int as count from activation_code_batches b join app_users u on u.id=b.created_by where b.school_id is distinct from u.school_id or u.role <> 'admin'`],
  ["license_codes_missing_relationship", `select count(*)::int as count from activation_codes c left join book_packages p on p.id=c.book_package_id left join schools s on s.id=c.school_id left join activation_code_batches b on b.id=c.batch_id where p.id is null or (c.school_id is not null and s.id is null) or (c.batch_id is not null and b.id is null)`],
  ["license_codes_cross_batch_scope", `select count(*)::int as count from activation_codes c join activation_code_batches b on b.id=c.batch_id where c.school_id is distinct from b.school_id or c.book_package_id is distinct from b.book_package_id`],
  ["license_codes_cross_school_redeemer", `select count(*)::int as count from activation_codes c join app_users u on u.id=c.redeemed_by where c.school_id is not null and (c.school_id is distinct from u.school_id or u.role <> 'student')`],
  ["license_codes_cross_school_creator", `select count(*)::int as count from activation_codes c join app_users u on u.id=c.created_by where c.school_id is not null and (c.school_id is distinct from u.school_id or u.role <> 'admin')`],
  ["license_entitlement_redemption_mismatch", `select count(*)::int as count from book_access ba join activation_codes c on c.id=ba.activation_code_id where ba.user_id is distinct from c.redeemed_by or ba.book_package_id is distinct from c.book_package_id or ba.role_scope <> 'student'`],
  ["license_audit_actor_cross_school", `select count(*)::int as count from book_license_audit_events e join app_users u on u.id=e.actor_user_id where e.school_id is distinct from u.school_id`],
  ["license_attempt_user_cross_school", `select count(*)::int as count from book_code_redemption_attempts a join app_users u on u.id=a.user_id where a.school_id is not null and a.school_id is distinct from u.school_id`],
  ["account_tokens_missing_user", `select count(*)::int as count from account_tokens t left join app_users u on u.id = t.user_id where u.id is null`],
  ["invitation_creator_cross_school", `select count(*)::int as count from app_users u join app_users inviter on inviter.id = u.invited_by where u.school_id is distinct from inviter.school_id`],
  ["account_outbox_invalid_user_reference", `select count(*)::int as count from account_email_outbox o left join app_users u on u.id = o.user_id where o.user_id is not null and u.id is null`],
  ["active_account_tokens_expired_beyond_retention", `select count(*)::int as count from account_tokens where used_at is null and revoked_at is null and expires_at < now() - interval '30 days'`],
  ["security_events_actor_cross_school", `select count(*)::int as count from account_security_events e join app_users actor on actor.id=e.actor_user_id where e.school_id is not null and actor.school_id is distinct from e.school_id`],
  ["security_events_user_cross_school", `select count(*)::int as count from account_security_events e join app_users u on u.id=e.user_id where e.school_id is not null and u.school_id is distinct from e.school_id`],
  ["account_outbox_creator_cross_school", `select count(*)::int as count from account_email_outbox o join app_users u on u.id=o.user_id join app_users creator on creator.id=o.created_by where u.school_id is distinct from creator.school_id`],
  ["account_outbox_stale_claims", `select count(*)::int as count from account_email_outbox where delivery_state='sending' and claimed_at < now()-interval '30 minutes'`],
];
