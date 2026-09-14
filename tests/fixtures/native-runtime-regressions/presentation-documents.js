import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from "../../../src/data/native-activities/nativeActivityRuntimeValidation.js";

export const childId = (prefix, number) => `${prefix}-${String(number).padStart(32, "0")}`;
const asset = (slot, number, role = "activity_artwork") => ({ slot, assetId: `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`, checksumSha256: "a".repeat(64), role });
export function presentationPair(kind = "drag-drop", reusable = true) {
  const publicDocument = { schemaVersion: "1.0", activityId: `regression-${kind}`, kind, metadata: { title: "Presentation regression", visibleInstructionText: "" }, placement: { pageId: "page-1" }, assets: [asset("artwork", 1), asset("readable", 2), asset("audio", 3)], readableText: { kind: "image", assetSlot: "readable", sourceWidth: 4096, sourceHeight: 8192, altText: "Large local readable passage" }, supplementalAudio: { assetSlot: "audio", durationMs: 2000 }, parts: [] };
  const teacherDocument = { schemaVersion: "1.0", activityId: publicDocument.activityId, kind, parts: [] };
  let interaction; let solution;
  if (kind === "drag-drop") {
    interaction = { kind, layoutMode: "text", answerBankHeightPx: 180, textPanelHeightPx: 320,
      words: ["A. An authored answer", "I keep the authored initial", "A long multiline answer\nwith wrapping and several words to measure", "Distractor"].map((text, index) => ({ id: childId("word", index + 1), text, reusable: index === 0 && reusable, shortLabel: String.fromCharCode(65 + index) })),
      panels: [{ id: childId("panel", 1), surface: { width: 1024, height: 2400 }, images: [{ id: childId("img", 1), assetSlot: "artwork", area: { x: 0, y: 0, width: 1024, height: 2400 }, order: 0, altText: "Text passage", decorative: false, fit: "contain", locked: true }], dropTargets: [0, 1, 2].map((index) => ({ id: childId("target", index + 1), accessibleLabel: `Target ${index + 1}`, capacity: index === 0 && reusable ? 2 : 1, area: { x: 30 + index * 290, y: 90, width: 250, height: 80 } })) }],
    };
    solution = { kind, mappings: interaction.panels[0].dropTargets.map((target, index) => ({ targetId: target.id, wordIds: index === 0 && reusable ? [childId("word", 1), childId("word", 2)] : [childId("word", reusable && index === 1 ? 1 : index + 1)] })) };
  } else {
    publicDocument.assets[0] = asset("artwork", 11);
    interaction = { kind, questions: [{ id: childId("q", 1), prompt: "Choose", options: [{ id: childId("opt", 1), text: "First" }, { id: childId("opt", 2), text: "Second" }] }], presentation: { kind: "image-hotspot", panels: [{ id: childId("panel", 1), backgroundAssetSlot: "artwork", sourceWidth: 1024, sourceHeight: 582, hotspots: [1, 2].map((number) => ({ id: childId("hot", number), questionId: childId("q", 1), optionId: childId("opt", number), area: { x: number * 260, y: 320, width: 220, height: 80 } })) }] } };
    solution = { kind, correctAnswers: [{ questionId: childId("q", 1), correctOptionId: childId("opt", 1) }] };
    publicDocument.audioTextHotspots = { hotspots: [1, 2].map((number) => ({ id: childId("aud", number), panelId: childId("panel", 1), activityArea: { x: number * 160, y: 80, width: 64, height: 64 }, readableFocusArea: { x: 0, y: (number - 1) * 2048, width: 4096, height: 4096 }, readableHighlightArea: { x: 100, y: (number - 1) * 2048 + 100, width: 3800, height: 160 }, focusLayout: "natural-width", audioAssetSlot: number === 2 ? "audio" : "", label: `Focus ${number}` })) };
  }
  publicDocument.parts = [{ id: "part-1", interaction }]; teacherDocument.parts = [{ id: "part-1", solution }];
  const normalized = normalizeNativeRuntimePublicDocument(publicDocument, { activityId: publicDocument.activityId, kind });
  return { publicDocument: normalized, teacherDocument: normalizeNativeRuntimeTeacherDocument(teacherDocument, { activityId: publicDocument.activityId, kind, publicDocument: normalized }) };
}

export function fixedAspectSingleChoicePair() {
  const { publicDocument, teacherDocument } = presentationPair("single-choice");
  publicDocument.activityId = teacherDocument.activityId = "regression-single-choice-fixed-aspect";
  publicDocument.assets = [asset("artwork", 11), asset("readable", 12), asset("portrait", 13), asset("wide", 14)];
  delete publicDocument.supplementalAudio;
  publicDocument.readableText = { kind: "image", assetSlot: "readable", sourceWidth: 1000, sourceHeight: 560, altText: "Synthetic fixed-aspect passage" };
  const interaction = publicDocument.parts[0].interaction;
  for (const [index, width, height, slot] of [[2, 480, 960, "portrait"], [3, 1440, 360, "wide"]]) {
    const questionId = childId("q", index);
    const optionId = childId("opt", index + 1);
    interaction.questions.push({ id: questionId, prompt: `Panel ${index} choice`, options: [{ id: optionId, text: "First" }, { id: childId("opt", index + 3), text: "Second" }] });
    interaction.presentation.panels.push({ id: childId("panel", index), backgroundAssetSlot: slot, sourceWidth: width, sourceHeight: height, hotspots: [optionId, childId("opt", index + 3)].map((id, optionIndex) => ({ id: childId("hot", index * 2 - 1 + optionIndex), questionId, optionId: id, area: { x: 40 + optionIndex * 200, y: 180, width: 160, height: 80 } })) });
    teacherDocument.parts[0].solution.correctAnswers.push({ questionId, correctOptionId: optionId });
  }
  const crops = [{ x: 21, y: 25, width: 698, height: 198 }, { x: 24, y: 107, width: 721, height: 205 }];
  publicDocument.audioTextHotspots.hotspots = [1, 2, 3, 4].map((number) => ({
    id: childId("aud", number), panelId: childId("panel", Math.max(1, number - 1)),
    activityArea: { x: number === 2 ? 320 : 160, y: 80, width: 64, height: 64 },
    readableFocusArea: crops[(number - 1) % 2], focusLayout: "fixed-aspect", audioAssetSlot: "", label: `Open readable excerpt ${number}`,
  }));
  const normalized = normalizeNativeRuntimePublicDocument(publicDocument, { activityId: publicDocument.activityId, kind: "single-choice" });
  return { publicDocument: normalized, teacherDocument: normalizeNativeRuntimeTeacherDocument(teacherDocument, { activityId: normalized.activityId, kind: normalized.kind, publicDocument: normalized }) };
}
