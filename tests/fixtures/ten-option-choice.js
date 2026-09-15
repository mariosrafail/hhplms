import { createOldschoolModePair } from "./oldschool-modes.js";

export const choiceId = (prefix, n) => `${prefix}-${n.toString(16).padStart(32, "0")}`;
export const choiceInteraction = (pair) => pair.publicDocument.kind === "multi-part" ? pair.publicDocument.parts[0].interaction.sections[0].interaction : pair.publicDocument.parts[0].interaction;
export const choiceSolution = (pair) => pair.teacherDocument.kind === "multi-part" ? pair.teacherDocument.parts[0].solution.sections[0].solution : pair.teacherDocument.parts[0].solution;

export function tenOptionChoicePair(kind = "single-choice", { count = 10, multiple = false, visual = false, questionCount = 1, sourceHeight = 1100, supporting = 0 } = {}) {
  const questions = Array.from({ length: questionCount }, (_, q) => ({ id: choiceId("q", q + 1), prompt: `Choose for question ${q + 1}`, ...(multiple ? { selectionMode: "multiple" } : {}),
    options: Array.from({ length: count }, (_, i) => ({ id: choiceId("opt", q * 100 + i + 1), text: `Option ${q + 1}.${i + 1}` })),
  }));
  const correctAnswers = questions.map((question) => ({ questionId: question.id, ...(multiple ? { correctOptionIds: question.options.slice(-4).map(option => option.id) } : { correctOptionId: question.options.at(-1).id }) }));
  const background = { slot: "choice-background", assetId: "10000000-0000-4000-8000-000000000091", checksumSha256: "b".repeat(64), role: "activity_artwork" };
  const panel = { id: choiceId("panel", 1), backgroundAssetSlot: background.slot, sourceWidth: 1024, sourceHeight,
    hotspots: questions.flatMap((question, q) => question.options.map((option, i) => ({ id: choiceId("hot", q * 100 + i + 1), questionId: question.id, optionId: option.id, area: { x: 40 + i * 90, y: 40 + q * 50, width: 75, height: 35 } }))),
  };
  const interaction = { kind: "single-choice", questions, ...(visual ? { presentation: { kind: "image-hotspot", panels: [panel] } } : {}) };
  const solution = { kind: "single-choice", correctAnswers };
  const activityId = "ultimate-b2-sb-u1-p1-o998";
  const pair = { publicDocument: { schemaVersion: "1.0", activityId, kind, metadata: { title: "Synthetic ten-option choice", visibleInstructionText: "" }, placement: { pageId: "ub2-sb-unit-1-part-1" }, assets: visual ? [background] : [], parts: [{ id: "part-1", interaction }] },
    teacherDocument: { schemaVersion: "1.0", activityId, kind, parts: [{ id: "part-1", solution }] } };
  if (kind === "multi-part") {
    const outerPanel = { id: choiceId("panel", 1), title: "Choice panel", layout: visual ? "canvas" : "flow", surface: { width: 1024, height: sourceHeight }, background: visual ? { assetSlot: background.slot, altText: "Synthetic choice artwork" } : null };
    pair.publicDocument.parts[0].interaction = { kind, schemaVersion: "multi-part.v1", panels: [outerPanel], sections: [{ id: choiceId("section", 1), kind: "single-choice", title: "Ten choices", panelId: outerPanel.id, bankRegion: null, interaction }] };
    pair.teacherDocument.parts[0].solution = { kind, schemaVersion: "multi-part.v1", sections: [{ id: choiceId("section", 1), kind: "single-choice", solution }] };
  } else if (kind === "oldschool-listening") {
    const oldschool = createOldschoolModePair("single-choice", supporting);
    Object.assign(oldschool.publicDocument.parts[0].interaction, { questions, ...(visual ? { presentation: interaction.presentation } : {}) });
    oldschool.teacherDocument.parts[0].solution.correctAnswers = correctAnswers;
    if (visual) oldschool.publicDocument.assets.push(background);
    return oldschool;
  }
  return pair;
}
