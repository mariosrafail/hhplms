export function incompleteExtrasFixture() {
  const video = { id: `video-${"1".repeat(32)}`, title: "Unfinished video", assetSlot: `video-${"1".repeat(32)}`, asset: null, fileName: "", byteSize: null, durationMs: null, cues: [] };
  const audio = { id: `audio-${"2".repeat(32)}`, title: "Unfinished audio", assetSlot: `audio-${"2".repeat(32)}`, asset: null, fileName: "", byteSize: null };
  return { schemaVersion: "1.0", units: [{ unitId: "unit-1", unitNumber: 1, categories: { videos: [video], audios: [audio] } }], pages: [{ pageId: "ub2-sb-unit-1-part-1", unitId: "unit-1", extrasVisibility: { videos: true, audios: true } }] };
}
