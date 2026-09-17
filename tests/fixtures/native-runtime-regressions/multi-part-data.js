import { createLegacyNativeMarkWordsInteraction } from "../../../src/data/native-activities/nativeMarkWords.js";
import "../../../src/data/native-activities/nativeOpenResponse.js";
import { createMultiPartSection } from "../../../src/apps/book-builder/hosted/nativeMultiPartAuthoring.js";
import { normalizeNativeMultiPartInteraction, validateNativeMultiPartTopology } from "../../../src/data/native-activities/nativeMultiPart.js";
import { NATIVE_DRAG_DROP_DEFAULT_PRESENTATION } from "../../../src/data/native-activities/nativeDragDrop.js";
import { createNativeOpenResponseQuestion } from "../../../src/data/native-activities/nativeOpenResponse.js";
import { generateNativeMarkWordsBulkCandidate } from "../../../src/data/native-activities/nativeMarkWordsBulkAuthoring.js";
const id = (prefix, n) => `${prefix}-${String(n).padStart(32, "0")}`;
const artwork = { assetId: "10000000-0000-4000-8000-000000000001", checksumSha256: "a".repeat(64), role: "activity_artwork", slot: "shared" };
const canvas = { id: id("panel", 1), title: "Shared exercises", layout: "canvas", surface: { width: 1024, height: 582 }, background: { assetSlot: "shared", altText: "Synthetic worksheet" } };
const flow = { id: id("panel", 2), title: "Two text choices", layout: "flow", surface: { width: 1024, height: 582 }, background: null };
const publicDocument = { schemaVersion: "1.0", activityId: "ultimate-b2-sb-u1-p1-o999", kind: "multi-part", metadata: { title: "Synthetic Multi-Part", visibleInstructionText: "" }, placement: { pageId: "ub2-sb-unit-1-part-1" }, assets: [artwork], parts: [{ id: "part-1", interaction: { kind: "multi-part", schemaVersion: "multi-part.v1", panels: [canvas, flow], sections: [] } }] };
const teacherDocument = { schemaVersion: "1.0", activityId: publicDocument.activityId, kind: "multi-part", parts: [{ id: "part-1", solution: { kind: "multi-part", schemaVersion: "multi-part.v1", sections: [] } }] };
function add(kind, panel, n) {
  const added = createMultiPartSection(kind, panel); added.section.id = added.privateSection.id = id("section", n); added.section.title = `Section ${n}`;
  if (kind === "drag-drop") {
    added.section.interaction.presentation = NATIVE_DRAG_DROP_DEFAULT_PRESENTATION;
    added.section.interaction.words = [{ id: id("word", 1), text: "Tick", reusable: true, image: { assetSlot: "shared", sourceWidth: 1024, sourceHeight: 582, displayWidth: 48, displayHeight: 32 } }];
    added.section.interaction.panels[0].dropTargets = [{ id: id("target", 1), area: { x: 50 + (n - 1) * 300, y: 60, width: 120, height: 60 }, accessibleLabel: "Place tick" }];
    added.section.bankRegion = { x: (n - 1) * 512, y: 450, width: 500, height: 132 };
    added.privateSection.solution.mappings = [{ targetId: id("target", 1), wordId: id("word", 1) }];
  } else {
    added.section.interaction.questions = [{ id: id("q", 1), prompt: "Choose", options: [{ id: id("opt", 1), text: "Yes" }, { id: id("opt", 2), text: "No" }] }];
    added.privateSection.solution.correctAnswers = [{ questionId: id("q", 1), correctOptionId: id("opt", 1) }];
    if (panel.layout === "canvas") added.section.interaction.presentation.panels[0].hotspots = [1, 2].map((option) => ({ id: id("hot", option), questionId: id("q", 1), optionId: id("opt", option), area: { x: option === 1 ? 210 : 510, y: 60, width: 100, height: 60 } }));
  }
  publicDocument.parts[0].interaction.sections.push(added.section); teacherDocument.parts[0].solution.sections.push(added.privateSection);
}
add("drag-drop", canvas, 1); add("drag-drop", canvas, 2); add("single-choice", canvas, 3); add("single-choice", flow, 4); add("single-choice", flow, 5);
for (const [index, kind] of ["open-response", "complete-sentences", "mark-the-words", "image"].entries()) {
  const added = createMultiPartSection(kind, flow); added.section.id = added.privateSection.id = id("section", index + 6); added.section.title = kind;
  const value = added.section.interaction;
  if (kind === "open-response") { const question = createNativeOpenResponseQuestion(id("q", 1)); question.prompt = "Explain the scene"; value.questions = [question]; added.privateSection.solution.modelAnswers = [{ questionId: question.id, text: "Synthetic private explanation" }]; }
  if (kind === "complete-sentences") { value.items = [{ id: id("item", 1), prompt: "We _____ today." }]; Object.assign(value.presentation.panels[0], { backgroundAssetSlot: "shared", hotspots: [{ id: id("hot", 1), itemId: id("item", 1), area: { x: 100, y: 100, width: 180, height: 48 } }] }); added.privateSection.solution.answers = [{ itemId: id("item", 1), text: "study" }]; }
  if (kind === "image") value.images = [{ id: id("img", 1), assetSlot: "shared", area: { x: 0, y: 0, ...canvas.surface }, order: 0, decorative: true, altText: "", fit: "contain", locked: true }];
  if (kind === "mark-the-words") {
    let sequence = 100;
    const candidate = generateNativeMarkWordsBulkCandidate({ source: "1. We *study* together.", publicDocument: { ...publicDocument, kind, parts: [{ id: "part-1", interaction: createLegacyNativeMarkWordsInteraction() }], assets: [] }, teacherDocument: { ...teacherDocument, kind, parts: [{ id: "part-1", solution: { kind, answers: [] } }] }, createId: (prefix) => id(prefix, ++sequence) });
    added.section.interaction = candidate.publicDocument.parts[0].interaction; added.privateSection.solution = candidate.teacherDocument.parts[0].solution;
  }
  publicDocument.parts[0].interaction.sections.push(added.section); teacherDocument.parts[0].solution.sections.push(added.privateSection);
}
publicDocument.parts[0].interaction = normalizeNativeMultiPartInteraction(publicDocument.parts[0].interaction, { assets: publicDocument.assets }); validateNativeMultiPartTopology(publicDocument, teacherDocument);
const imageDocument = { ...publicDocument, kind: "image", parts: [{ id: "part-1", interaction: { kind: "image", surface: canvas.surface, images: [{ id: id("img", 1), assetSlot: "shared", area: { x: 0, y: 0, ...canvas.surface }, order: 0, decorative: true, altText: "", fit: "contain", locked: false }] } }] };
const imageTeacher = { ...teacherDocument, kind: "image", parts: [{ id: "part-1", solution: { kind: "image", sampleAnswer: { enabled: true, image: { reference: { ...artwork, role: "native_teacher_answer" }, mediaType: "image/png", sourceWidth: 600, sourceHeight: 2400, altText: "Protected tall answer" } } } }] };

export { publicDocument, teacherDocument, imageDocument, imageTeacher };
