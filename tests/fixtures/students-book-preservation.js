// Synthetic data only. These historical IDs are a minimum preservation fixture,
// never an application allowlist or a reconstruction of hosted authored content.
import assert from "node:assert/strict";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { resolveNativeActivityKind } from "../../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { createNativeOpenResponseQuestion } from "../../src/data/native-activities/nativeOpenResponse.js";
import { nativeChildIdFromUuid } from "../../src/data/native-activities/nativeChildIdentity.js";

export const protectedStudentsBookIds = Object.freeze(`
ultimate-b2-sb-u1-p1-o10
ultimate-b2-sb-u1-p1-o12
ultimate-b2-sb-u1-p1-o17
ultimate-b2-sb-u1-p1-o19
ultimate-b2-sb-u1-p1-o4
ultimate-b2-sb-u1-p10-o2
ultimate-b2-sb-u1-p2-o11
ultimate-b2-sb-u1-p2-o6
ultimate-b2-sb-u1-p2-o7
ultimate-b2-sb-u1-p2-o9
ultimate-b2-sb-u1-p3-o10
ultimate-b2-sb-u1-p3-o11
ultimate-b2-sb-u1-p3-o12
ultimate-b2-sb-u1-p3-o13
ultimate-b2-sb-u1-p3-o14
ultimate-b2-sb-u1-p3-o15
ultimate-b2-sb-u1-p3-o8
ultimate-b2-sb-u1-p3-o9
ultimate-b2-sb-u1-p4-o10
ultimate-b2-sb-u1-p4-o11
ultimate-b2-sb-u1-p4-o9
ultimate-b2-sb-u1-p8-o3
ultimate-b2-sb-u2-p1-o2
ultimate-b2-sb-u2-p1-o3
ultimate-b2-sb-u2-p1-o4
ultimate-b2-sb-u2-p10-o4
ultimate-b2-sb-u2-p10-o5
ultimate-b2-sb-u2-p10-o6
ultimate-b2-sb-u2-p11-o5
ultimate-b2-sb-u2-p11-o6
ultimate-b2-sb-u2-p11-o7
ultimate-b2-sb-u2-p11-o8
ultimate-b2-sb-u2-p12-o5
ultimate-b2-sb-u2-p12-o6
ultimate-b2-sb-u2-p12-o7
ultimate-b2-sb-u2-p12-o8
ultimate-b2-sb-u2-p2-o10
ultimate-b2-sb-u2-p2-o11
ultimate-b2-sb-u2-p2-o6
ultimate-b2-sb-u2-p2-o8
ultimate-b2-sb-u2-p2-o9
ultimate-b2-sb-u2-p3-o10
ultimate-b2-sb-u2-p3-o11
ultimate-b2-sb-u2-p3-o8
ultimate-b2-sb-u2-p3-o9
ultimate-b2-sb-u2-p6-o6
ultimate-b2-sb-u2-p7-o11
ultimate-b2-sb-u2-p7-o12
ultimate-b2-sb-u2-p7-o13
ultimate-b2-sb-u2-p7-o15
ultimate-b2-sb-u2-p7-o16
ultimate-b2-sb-u2-p7-o17
ultimate-b2-sb-u2-p7-o18
ultimate-b2-sb-u2-p8-o1
ultimate-b2-sb-u2-p9-o2
ultimate-b2-sb-u2-p9-o3
`.trim().split("\n"));

export function syntheticStudentsBookActivities(extraCount = 0) {
  const kind = resolveNativeActivityKind("open-response");
  const ids = [...protectedStudentsBookIds, ...Array.from({ length: extraCount }, (_, i) => `ultimate-b2-sb-u1-p1-o${1000 + i}`)];
  return ids.map((activityId, index) => {
    // Deliberately independent of uN/pN in the stable ID: exercise moved placement.
    const pageId = index % 2 ? "reading-20-21" : "ub2-sb-unit-1-part-2";
    const questionId = nativeChildIdFromUuid("q", `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
    const publicDocument = kind.createBlankPublic({ activityId, title: `Synthetic preservation ${index + 1}`, placement: { pageId } });
    publicDocument.parts[0].interaction.questions = [{ ...createNativeOpenResponseQuestion(questionId), prompt: `Synthetic prompt ${index + 1}` }];
    const teacherDocument = kind.createBlankTeacher({ activityId });
    teacherDocument.parts[0].solution.modelAnswers = [{ questionId, text: `Synthetic private answer ${index + 1}` }];
    const publicPayload = kind.normalizePublic(publicDocument, activityId);
    const teacherPayload = kind.normalizeTeacher(teacherDocument, activityId);
    kind.validatePair(publicPayload, teacherPayload);
    assert.equal(kind.assessReadiness(publicPayload, teacherPayload).ready, true);
    return {
      index: { activityId, kind: "open-response", placement: { pageId }, sortOrder: 100 + index },
      public: { payload: publicPayload, revision: 3, sha256: builderDocumentSha256(publicPayload) },
      teacher: { payload: teacherPayload, revision: 4, sha256: builderDocumentSha256(teacherPayload) },
    };
  });
}

// Compare complete records. Counts alone cannot detect delete/reinsert or edits.
export function assertPreservedRecords(before, after) {
  assert.deepEqual(after, before, "Protected authored data, identity, history or references changed");
}
