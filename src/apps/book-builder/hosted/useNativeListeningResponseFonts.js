import { mergeNativeManagedAssetReference, removeNativeManagedAssetReferenceIfUnused } from "../../../data/native-activities/nativeActivityPublic.js";
import { useBuilderFontLibrary } from "./useBuilderFontLibrary.js";

export function useNativeListeningResponseFonts({ bookSlug, componentSlug, mutatePublic, selectedQuestionId, onMessage }) {
  const { fonts, recordUploadedFont } = useBuilderFontLibrary({ bookSlug, componentSlug, onMessage });
  const setAnswerFont = (font) => mutatePublic((next) => {
    const target = next.parts[0].interaction.questions.find((question) => question.id === selectedQuestionId);
    if (!target) return;
    const presentation = target.responseRegion.presentation;
    const previousSlot = presentation.answerFontAssetSlot;
    if (font) {
      next.assets = mergeNativeManagedAssetReference(next.assets, { assetId: font.assetId, checksumSha256: font.checksumSha256, role: font.role, slot: font.slot });
      presentation.answerFontAssetSlot = font.slot;
    } else delete presentation.answerFontAssetSlot;
    if (previousSlot && previousSlot !== font?.slot) removeNativeManagedAssetReferenceIfUnused(next, previousSlot);
  });

  return { fonts, recordUploadedFont, setAnswerFont };
}
