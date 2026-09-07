import { createContext, useContext } from "react";
export { publishedUnitExtraVideoUrl, publishedUnitExtraAudioUrl } from "../../src/apps/android-teacher-offline/hostedComponentReleaseProvider.js";
export const ExtrasPreviewContext = createContext({ kind: "none" });
export function usePublishedComponentRelease() { return useContext(ExtrasPreviewContext); }
