export const BUILD_PROFILE_IDS = Object.freeze({
  WEB_LMS: "web-lms",
  BUILDER_LOCAL_AUTHORING: "ultimate-b2-builder-local-authoring",
  BUILDER_HOSTED_REVIEW: "book-builder-hosted-review",
  INTERACTIVE_HOSTED_REVIEW: "ultimate-b2-interactive-review",
  ANDROID_STUDENT_OFFLINE: "android-student-offline",
  ANDROID_TEACHER_OFFLINE: "android-teacher-offline",
  ANDROID_TEACHER_PROJECT: "android-teacher-project",
  ANDROID_TEACHER_EDITION: "android-teacher-edition",
});

const profile = (id, capabilities) => Object.freeze({ id, ...capabilities });

export const buildProfiles = Object.freeze({
  [BUILD_PROFILE_IDS.WEB_LMS]: profile(BUILD_PROFILE_IDS.WEB_LMS, {
    builderReadOnly: true, builderMutations: false, publicationRuntime: true, teacherSolutions: false, teacherPresentation: false, staticOnly: false,
  }),
  [BUILD_PROFILE_IDS.BUILDER_LOCAL_AUTHORING]: profile(BUILD_PROFILE_IDS.BUILDER_LOCAL_AUTHORING, {
    builderReadOnly: false, builderMutations: true, teacherSolutions: false, teacherPresentation: false, staticOnly: false,
  }),
  [BUILD_PROFILE_IDS.BUILDER_HOSTED_REVIEW]: profile(BUILD_PROFILE_IDS.BUILDER_HOSTED_REVIEW, {
    builderReadOnly: true, builderMutations: false, publicationAuthoring: true, hostedDocumentWrites: Object.freeze(["hotspots", "open-response", "ui-controller", "unit-extras", "native-activity-public", "native-activity-teacher"]), teacherSolutions: false, teacherPresentation: false, staticOnly: true,
  }),
  [BUILD_PROFILE_IDS.INTERACTIVE_HOSTED_REVIEW]: profile(BUILD_PROFILE_IDS.INTERACTIVE_HOSTED_REVIEW, {
    // Student Interactive mode is intentionally hidden; students complete activities through the LMS.
    builderReadOnly: true, builderMutations: false, publicationPreview: true, teacherSolutions: false, teacherPresentation: true, authorizedTeacherPreview: true, staticOnly: true,
  }),
  [BUILD_PROFILE_IDS.ANDROID_STUDENT_OFFLINE]: profile(BUILD_PROFILE_IDS.ANDROID_STUDENT_OFFLINE, {
    builderReadOnly: true, builderMutations: false, teacherSolutions: false, teacherPresentation: false, staticOnly: true,
  }),
  [BUILD_PROFILE_IDS.ANDROID_TEACHER_OFFLINE]: profile(BUILD_PROFILE_IDS.ANDROID_TEACHER_OFFLINE, {
    builderReadOnly: true, builderMutations: false, teacherSolutions: true, teacherPresentation: true, staticOnly: true,
  }),
  [BUILD_PROFILE_IDS.ANDROID_TEACHER_PROJECT]: profile(BUILD_PROFILE_IDS.ANDROID_TEACHER_PROJECT, {
    builderReadOnly: true, builderMutations: false, teacherSolutions: true, teacherPresentation: true, staticOnly: true,
  }),
  [BUILD_PROFILE_IDS.ANDROID_TEACHER_EDITION]: profile(BUILD_PROFILE_IDS.ANDROID_TEACHER_EDITION, {
    builderReadOnly: true, builderMutations: false, teacherSolutions: true, teacherPresentation: true, staticOnly: true,
  }),
});

export function resolveBuildProfile(id) {
  const value = buildProfiles[String(id || "")];
  if (!value) throw new Error(`Unknown explicit build profile: ${id}`);
  return value;
}

const compiledProfileId = typeof __HHPLMS_BUILD_PROFILE__ === "string"
  ? __HHPLMS_BUILD_PROFILE__
  : BUILD_PROFILE_IDS.WEB_LMS;

export const activeBuildProfile = resolveBuildProfile(compiledProfileId);
