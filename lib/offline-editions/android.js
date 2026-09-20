import { fail } from "../../src/data/offline-editions/contract.js";
import { TEACHER_ANDROID_MAIN_ACTIVITY } from "../teacher-project-builder/android-contract.js";

export const EDITION_ANDROID = Object.freeze({
  greek: Object.freeze({ applicationId: "com.hhplms.ultimateb2.greek.teacher", label: "Ultimate B2 — Greek Edition" }),
  international: Object.freeze({ applicationId: "com.hhplms.ultimateb2.international.teacher", label: "Ultimate B2 — International Edition" }),
});
export const EDITION_MAIN_ACTIVITY = TEACHER_ANDROID_MAIN_ACTIVITY.replace("/.", ".");
export function androidIdentity(selection, versionCode = 1, versionName = "1.0") {
  const identity = EDITION_ANDROID[selection.editionId];
  if (!identity || selection.bookSlug !== "ultimate-b2" || selection.audience !== "teacher") fail("offline_android_identity");
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000 || !/^\d{1,5}\.\d{1,5}(?:\.\d{1,5})?(?:-[a-z0-9.-]{1,24})?$/.test(versionName)) fail("offline_android_version");
  return { ...identity, versionCode, versionName, mainActivity: EDITION_MAIN_ACTIVITY, providerAuthority: `${identity.applicationId}.fileprovider`, minSdk: 24, targetSdk: 36, signature: "debug" };
}
