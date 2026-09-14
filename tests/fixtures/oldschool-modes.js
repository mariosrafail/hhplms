import { createOldschoolTypographyPair, typographyId as id, typographyFont } from "./oldschool-typography.js";
import { switchNativeOldschoolListeningQuestionMode } from "../../src/data/native-activities/nativeOldschoolListeningAuthoring.js";
import { createNativeSingleChoiceQuestion } from "../../src/data/native-activities/nativeSingleChoice.js";

export function createOldschoolModePair(mode = "open-response", supporting = 4, { visual = false, layoutMode = "standard" } = {}) {
  const pair = createOldschoolTypographyPair();
  const { publicDocument: document, teacherDocument } = pair;
  switchNativeOldschoolListeningQuestionMode(document, teacherDocument, mode);
  const interaction = document.parts[0].interaction;
  const artwork = { assetId: "10000000-0000-4000-8000-000000000074", checksumSha256: "c".repeat(64), role: "activity_artwork", slot: "question-image" };
  document.assets.push(artwork);
  const image = { id: id("img", 4), assetSlot: artwork.slot, area: { x: 0, y: 0, width: 1024, height: 582 }, order: 0, altText: "Question background", decorative: false, fit: "contain", locked: true };
  if (mode === "open-response") {
    interaction.artwork = [{ ...image, id: id("art", 4) }];
    interaction.questions[0].responseRegion.presentation.answerFontAssetSlot = typographyFont.slot;
    document.assets.push(typographyFont);
  } else if (mode === "single-choice") {
    const question = createNativeSingleChoiceQuestion(id("q", 1), [id("opt", 1), id("opt", 2)]);
    question.prompt = "Choose the train.";
    question.options[0].text = "Train"; question.options[1].text = "Bus";
    interaction.questions = [question];
    teacherDocument.parts[0].solution.correctAnswers = [{ questionId: question.id, correctOptionId: question.options[0].id }];
    // Nonvisual MC still has the fixed outer question canvas for readable hotspots.
    if (visual) interaction.presentation = { kind: "image-hotspot", panels: [{ id: id("panel", 5), backgroundAssetSlot: artwork.slot, sourceWidth: 1024, sourceHeight: 582, hotspots: question.options.map((option, index) => ({ id: id("hot", index + 1), questionId: question.id, optionId: option.id, area: { x: 100 + index * 300, y: 220, width: 200, height: 70 } })) }] };
    else document.assets = document.assets.filter((asset) => asset.slot !== artwork.slot);
  } else {
    const child = interaction.questionInteraction;
    child.randomize = false;
    child.layoutMode = layoutMode; child.answerBankHeightPx = 116; child.textPanelHeightPx = 360;
    child.words = [{ id: id("word", 1), text: "Train", reusable: false, shortLabel: "A" }, { id: id("word", 2), text: "Bus", reusable: false, shortLabel: "B", image: { assetSlot: artwork.slot, sourceWidth: 1024, sourceHeight: 582, displayWidth: 64, displayHeight: 40 } }];
    child.presentation.bankWordStyle.fontAssetSlot = typographyFont.slot;
    document.assets.push(typographyFont);
    child.panels[0].id = id("panel", 4);
    child.panels[0].images = [image];
    child.panels[0].dropTargets = [{ id: id("target", 1), area: { x: 100, y: 200, width: 220, height: 55 }, accessibleLabel: "First answer", capacity: 1 }];
    teacherDocument.parts[0].solution.mappings = [{ targetId: id("target", 1), wordIds: [id("word", 1)] }];
  }
  if (supporting > 0) {
    document.assets.push({ ...artwork, assetId: "10000000-0000-4000-8000-000000000075", slot: "readable-image", checksumSha256: "d".repeat(64) });
    document.readableText = { kind: "image", assetSlot: "readable-image", sourceWidth: 1024, sourceHeight: 1600, altText: "Independent readable text" };
  }
  if (supporting > 1) {
    if (supporting > 2) document.assets.push({ ...artwork, assetId: "10000000-0000-4000-8000-000000000076", slot: "readable-audio", checksumSha256: "e".repeat(64) });
    document.audioTextHotspots = { hotspots: [{ id: id("aud", 1), panelId: "panel-1", activityArea: { x: 400, y: 100, width: 40, height: 40 }, readableFocusArea: { x: 0, y: 0, width: 1024, height: 291 }, readableHighlightArea: null, focusLayout: "fixed-aspect", audioAssetSlot: supporting > 2 ? "readable-audio" : "", label: "Read the clue" }] };
  }
  if (supporting < 4) interaction.snippetHotspots = [];
  return pair;
}
