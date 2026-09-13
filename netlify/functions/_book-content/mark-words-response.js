import { isMarkWordsVisual, markWordsResponseGroups, markWordsAnswerGroups } from "../../../src/data/native-activities/nativeMarkWordsVisualTargets.js";
export function normalizeMarkWordsResponse(publicDocument, envelope) {
  const version = "native-response.v1";
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || envelope.schemaVersion !== version || Object.keys(envelope).sort().join(",") !== "items,schemaVersion") return { error: "response must contain exactly schemaVersion and items" };
  if (!Array.isArray(envelope.items) || envelope.items.length > 50 || JSON.stringify(envelope).length > 100_000) return { error: "response exceeds native response limits" };
  const items = markWordsResponseGroups(publicDocument.parts[0].interaction);
  const values = new Map();
  for (const response of envelope.items) {
    if (!response || typeof response !== "object" || Array.isArray(response) || Object.keys(response).sort().join(",") !== "id,value" || typeof response.id !== "string") return { error: "Each response item must contain exactly a string id and value" };
    const item = items.find((entry) => entry.id === response.id);
    if (!item || values.has(response.id)) return { error: "Unknown or duplicate passage ID" };
    if (!Array.isArray(response.value) || response.value.length > item.options.length || response.value.some((id) => typeof id !== "string" || !item.options.includes(id)) || new Set(response.value).size !== response.value.length) return { error: "Select unique word occurrences belonging to this passage" };
    values.set(item.id, item.options.filter((id) => response.value.includes(id)));
  }
  return { schemaVersion: version, payload: { schemaVersion: version, kind: "mark-the-words", items: items.filter((item) => values.has(item.id)).map((item) => ({ id: item.id, value: values.get(item.id) })) } };
}

function exactSet(selected, expected) { return expected.length > 0 && selected.length === expected.length && selected.every((id) => expected.includes(id)); }

export function markWordsReview(publicDocument, teacherDocument, payload = {}) {
  const responses = new Map((payload.items || []).map((entry) => [entry.id, entry.value]));
  const answers = markWordsAnswerGroups(teacherDocument.parts[0].solution);
  if (isMarkWordsVisual(publicDocument.parts[0].interaction)) {
    const interaction = publicDocument.parts[0].interaction;
    const labels = (ids) => ids.map((id) => interaction.targets.find((target) => target.id === id)?.label || id);
    return markWordsResponseGroups(interaction).map((group, index) => {
      const selected = responses.get(group.id) || []; const expected = answers.get(group.id) || [];
      return { questionId: group.id, prompt: `Panel ${index + 1}`, answer: labels(selected).join("; "), modelAnswer: labels(expected).join("; "), answers: labels(selected), modelAnswers: labels(expected), isCorrect: exactSet(selected, expected), feedback: "" };
    });
  }
  return publicDocument.parts[0].interaction.items.map((item) => {
    const selected = responses.get(item.id) || []; const expected = answers.get(item.id) || [];
    const describe = (ids) => item.words.flatMap((word, index) => ids.includes(word.id) ? [`${item.text.slice(word.start, word.end)} (word ${index + 1})`] : []);
    const selectedTexts = describe(selected); const expectedTexts = describe(expected);
    return { questionId: item.id, prompt: item.text, answer: selectedTexts.join("; "), modelAnswer: expectedTexts.join("; "), answers: selectedTexts, modelAnswers: expectedTexts, isCorrect: exactSet(selected, expected), feedback: "" };
  });
}

export function scoreMarkWordsResponse(publicDocument, teacherDocument, payload) {
  const review = markWordsReview(publicDocument, teacherDocument, payload);
  const correctCount = review.filter((item) => item.isCorrect).length; const totalCount = review.length;
  return { status: "submitted", correctCount, totalCount, scorePercent: totalCount ? Math.round(correctCount / totalCount * 100) : 0 };
}
