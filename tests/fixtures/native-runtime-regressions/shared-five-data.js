import { publicDocument as original, teacherDocument as originalTeacher } from "./multi-part-data.js";
import { createMultiPartSection } from "../../../src/apps/book-builder/hosted/nativeMultiPartAuthoring.js";
import { createNativeOpenResponseQuestion } from "../../../src/data/native-activities/nativeOpenResponse.js";
import { addVisualTarget, setVisualTargetCorrect } from "../../../src/data/native-activities/nativeMarkWordsVisualAuthoring.js";
import { normalizeNativeMultiPartInteraction, projectNativeMultiPartChild, validateNativeMultiPartTopology } from "../../../src/data/native-activities/nativeMultiPart.js";

export const sharedFive = structuredClone(original);
export const sharedFiveTeacher = structuredClone(originalTeacher);
const interaction = sharedFive.parts[0].interaction;
const solution = sharedFiveTeacher.parts[0].solution;
interaction.schemaVersion = solution.schemaVersion = "multi-part.v2";
interaction.panels = [interaction.panels[0]];
interaction.sections = interaction.sections.filter((section) => ["section-00000000000000000000000000000001", "section-00000000000000000000000000000003"].includes(section.id));
solution.sections = solution.sections.filter((section) => interaction.sections.some((entry) => entry.id === section.id));
const panel = interaction.panels[0];
interaction.sections[0].bankRegion = { x: 0, y: 450, width: 1024, height: 132 };
sharedFive.assets.push({ assetId: "10000000-0000-4000-8000-000000000002", checksumSha256: "b".repeat(64), role: "activity_artwork", slot: "graphic" });
for (const kind of ["open-response", "complete-sentences", "mark-the-words"]) {
  const added = createMultiPartSection(kind, panel);
  const child = added.section.interaction;
  if (kind === "open-response") {
    const question = createNativeOpenResponseQuestion("q-00000000000000000000000000000001");
    question.prompt = "Explain";
    child.questions = [question];
    added.privateSection.solution.modelAnswers = [{ questionId: question.id, text: "A response" }];
  }
  if (kind === "complete-sentences") {
    const id = "item-00000000000000000000000000000001";
    child.items = [{ id, prompt: "We _____ today." }];
    child.presentation.panels[0].hotspots = [{ id: "hot-00000000000000000000000000000001", itemId: id, area: { x: 750, y: 380, width: 200, height: 55 } }];
    added.privateSection.solution.answers = [{ itemId: id, text: "study" }];
  }
  interaction.sections.push(added.section); solution.sections.push(added.privateSection);
  if (kind === "mark-the-words") {
    const pair = projectNativeMultiPartChild(sharedFive, added.section, sharedFiveTeacher);
    for (let index = 0; index < 3; index++) {
      addVisualTarget(pair.publicDocument, pair.teacherDocument, child.presentation.panels[0].id, { x: 40 + index * 210, y: 350, width: 150, height: 40 });
      const hotspot = child.presentation.panels[0].hotspots[index];
      child.targets[index].label = ["Correct target", "Wrong graphic", "Wrong no graphic"][index];
      delete hotspot.marker; // Historical manual graphic fixture.
      hotspot.graphicAssetSlot = index === 2 ? null : "graphic";
      hotspot.markArea = { x: hotspot.area.x, y: 397, width: 120, height: 3 };
      if (!index) setVisualTargetCorrect(pair.publicDocument, pair.teacherDocument, child.presentation.panels[0].id, hotspot.targetId, true);
    }
  }
}
// Freeze generated child identities so browser evidence is reproducible across runs.
const identities = new Map(); let identitySequence = 100;
const stable = (value) => {
  if (typeof value === "string") return value.replace(/(section|panel|q|item|opt|hot|target|art)-[a-f0-9]{32}/g, (id) => {
    if (id.split("-")[1].startsWith("000000000000000000000000")) return id;
    if (!identities.has(id)) identities.set(id, `${id.split("-")[0]}-${String(++identitySequence).padStart(32, "0")}`);
    return identities.get(id);
  });
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, stable(entry)]));
  return value;
};
Object.assign(sharedFive, stable(sharedFive)); Object.assign(sharedFiveTeacher, stable(sharedFiveTeacher));
const stableInteraction = sharedFive.parts[0].interaction;
stableInteraction.sections.sort((a, b) => ["drag-drop", "single-choice", "mark-the-words", "open-response", "complete-sentences"].indexOf(a.kind) - ["drag-drop", "single-choice", "mark-the-words", "open-response", "complete-sentences"].indexOf(b.kind));
sharedFive.parts[0].interaction = normalizeNativeMultiPartInteraction(stableInteraction, { assets: sharedFive.assets });
validateNativeMultiPartTopology(sharedFive, sharedFiveTeacher);
