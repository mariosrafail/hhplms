import { markWordsResponseGroups } from "../../../../data/native-activities/nativeMarkWordsVisualTargets.js";
export function buildLegacyFinalSubmission({ assignmentId, activityId, result } = {}) {
  return {
    assignmentId,
    activityId,
    answers: result?.answers || {},
  };
}

export function buildNativeFinalSubmission({ assignmentId, target, responses = {} } = {}) {
  const interaction = target?.entry?.document?.parts?.[0]?.interaction || {};
  if (target?.nativeKind === "multi-part") return {
    assignmentId,
    response: { schemaVersion: "native-multi-response.v1", sections: (interaction.sections || []).filter((section) => section.kind !== "image").map((section) => ({ id: section.id, kind: section.kind, response: buildNativeFinalSubmission({ target: { nativeKind: section.kind, capability: { responseSchemaVersion: "native-response.v1" }, entry: { document: { parts: [{ interaction: section.interaction }] } } }, responses: responses[section.id] || {} }).response })) },
  };
  const questions = target?.nativeKind === "mark-the-words" ? markWordsResponseGroups(interaction) : target?.nativeKind === "drag-drop"
    ? (interaction.panels || []).flatMap((panel) => panel.dropTargets || [])
    : interaction.questions || interaction.items || [];
  return {
    assignmentId,
    response: {
      schemaVersion: target?.capability?.responseSchemaVersion,
      items: questions
        .filter((question) => !["single-choice", "drag-drop"].includes(target?.nativeKind) || responses[question.id])
        .map((question) => ({ id: question.id, value: responses[question.id] || (target?.nativeKind === "mark-the-words" ? [] : "") })),
    },
  };
}

export function isDuplicateFinalSubmission(error) {
  return error?.status === 409 && /already been submitted/i.test(error?.message || error?.payload?.error || "");
}

export function restoreNativeSubmissionResponses(payload) {
  if (payload?.schemaVersion === "native-multi-response.v1") return Object.fromEntries((payload.sections || []).map((section) => [section.id, restoreNativeSubmissionResponses(section.response)]));
  return Object.fromEntries((payload?.items || []).map((item) => [item.id, item.value]));
}
