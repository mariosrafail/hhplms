import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { nativeMultiPartAssetRequirements } from "../../src/data/native-activities/nativeMultiPart.js";
import { nativeCompleteSentencesAssetRequirements } from "../../src/data/native-activities/nativeCompleteSentences.js";
import { nativeListeningAssetRequirements } from "../../src/data/native-activities/nativeListening.js";
import { nativeOldschoolListeningAssetRequirements } from "../../src/data/native-activities/nativeOldschoolListening.js";
import { studentsBookV3Sources } from "./students-book-publication-v3.js";
import { appendMultiPartPublicationFixture } from "./native-multi-part-publication.js";
import { appendMarkWordsPublicationFixture } from "./native-mark-words.js";
import { publishedManagedPageBytes } from "./published-managed-book.js";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { resolveNativeActivityKind } from "../../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { createNativeOpenResponseQuestion } from "../../src/data/native-activities/nativeOpenResponse.js";
import { createEmptyHostedTeacherUiDocument } from "../../src/data/ultimate-b2/hostedTeacherUiDocument.js";
import { buildNativeActivityAssetObjectKey } from "../../lib/book-assets/object-keys.js";
import { componentPublicationAssetStorageTarget } from "../../lib/book-assets/publication-asset-storage.js";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = (payload) => ({ payload, revision: 1, sha256: builderDocumentSha256(payload) });
const child = (kind, n) => `${kind}-${String(n).padStart(32, "0")}`;
function blankPng(width, height) {
  const crc = (bytes) => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let n = 0; n < 8; n++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1)); } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(body)); return Buffer.concat([size, body, checksum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height, 247); for (let row = 0; row < height; row++) pixels[row * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
export async function classroomSourceInputs() {
  const inputs = structuredClone(appendMarkWordsPublicationFixture(appendMultiPartPublicationFixture(studentsBookV3Sources())));
  delete inputs.unitExtras; const pageId = "ub2-sb-unit-1-part-1";
  const audio = await readFile(new URL("./wordlist-pronunciation.mp3", import.meta.url));
  const objects = new Map(); inputs.native.assetRows = [];
  for (const [index, kind] of ["complete-sentences", "listening", "oldschool-listening"].entries()) {
    const definition = resolveNativeActivityKind(kind), activityId = `ultimate-b2-sb-u1-p1-o${980 + index}`;
    const pub = definition.createBlankPublic({ activityId, title: `Classroom ${kind}`, placement: { pageId } }), teacher = definition.createBlankTeacher({ activityId });
    const interaction = pub.parts[0].interaction, solution = teacher.parts[0].solution;
    const reference = (slot) => ({ slot, assetId: randomUUID(), checksumSha256: hash(slot === "audio" ? audio : publishedManagedPageBytes), role: "activity_artwork" });
    pub.assets = [reference("background")];
    if (kind === "complete-sentences") {
      interaction.items = [{ id: child("item", 1), prompt: "We _____ today." }]; solution.answers = [{ itemId: child("item", 1), text: "study" }];
      Object.assign(interaction.presentation.panels[0], { backgroundAssetSlot: "background", hotspots: [{ id: child("hot", 1), itemId: child("item", 1), area: { x: 200, y: 160, width: 300, height: 55 } }] });
    } else {
      pub.assets.push(reference("audio")); interaction.audioAssetSlot = "audio"; interaction.audioDurationMs = 1200;
      interaction.questions = [{ ...createNativeOpenResponseQuestion(child("q", 1)), prompt: "Describe the sound." }]; solution.modelAnswers = [{ questionId: child("q", 1), text: "A synthetic tone." }];
      if (kind === "listening") interaction.panels[1].backgroundAssetSlot = "background";
      else { interaction.panels[1].pageAssetSlot = "background"; interaction.panels[1].altText = "Synthetic transcript page"; }
      interaction.cues = [{ id: child("cue", 1), startMs: 0, endMs: 1000, text: "Synthetic pronunciation", ...(kind === "oldschool-listening" ? { highlightRegions: [{ id: child("region", 1), x: 20, y: 40, width: 800, height: 50 }], scrollY: null } : {}) }];
    }
    const entry = { activityId, kind, placement: { pageId }, sortOrder: inputs.native.index.payload.activities.length + 1 };
    inputs.native.index.payload.activities.push(entry); inputs.native.activities[activityId] = { index: entry, public: source(pub), teacher: source(teacher) };
    inputs.documents.hotspots.payload.pages[pageId].push({ id: `classroom-hotspot-${index}`, pageId, pageNumber: 5, unitNumber: 1, left: 4 + index * 16, top: 35, width: 12, height: 12, label: `Classroom ${kind}`, actionType: "normalized_activity", activityKey: activityId });
  }
  // Materialize deterministic, synthetic media; every reference has its real byte hash.
  for (const entry of Object.values(inputs.native.activities)) {
    const pub = entry.public.payload;
    if (pub.kind === "open-response") {
      pub.assets.push({ slot: "readable-text", assetId: randomUUID(), checksumSha256: hash(publishedManagedPageBytes), role: "activity_artwork" });
      pub.readableText = { kind: "image", assetSlot: "readable-text", sourceWidth: 1024, sourceHeight: 582, altText: "Synthetic readable passage" };
    }
    const requirements = ({ "multi-part": nativeMultiPartAssetRequirements, "complete-sentences": nativeCompleteSentencesAssetRequirements, listening: nativeListeningAssetRequirements, "oldschool-listening": nativeOldschoolListeningAssetRequirements })[pub.kind]?.(pub) || [];
    for (const reference of pub.assets) {
      const required = requirements.find((item) => item.slot === reference.slot && item.width) || { width: 1024, height: 582 };
      const bytes = reference.slot === "audio" ? audio : blankPng(required.width, required.height);
      reference.assetId = randomUUID(); reference.checksumSha256 = hash(bytes);
      const extension = reference.slot === "audio" ? ".mp3" : ".png";
      const objectKey = buildNativeActivityAssetObjectKey({ bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", activityId: pub.activityId, assetSlot: reference.slot, checksum: reference.checksumSha256, extension });
      objects.set(objectKey, bytes);
      inputs.native.assetRows.push({ id: reference.assetId, checksum_sha256: reference.checksumSha256, asset_role: reference.role, object_key: objectKey,
        storage_profile: "private", storage_bucket: "isolated-editions-fixture", mime_type: extension === ".mp3" ? "audio/mpeg" : "image/png", byte_size: bytes.length,
        width: extension === ".png" ? required.width : null, height: extension === ".png" ? required.height : null, publication_status: "draft", access_level: "internal", source_metadata: { native_activity_id: pub.activityId, asset_slot: reference.slot } });
    }
    entry.public = source(pub); entry.teacher = source(entry.teacher.payload);
  }
  inputs.native.index = source(inputs.native.index.payload); inputs.documents.hotspots = source(inputs.documents.hotspots.payload);
  const ui = structuredClone(createEmptyHostedTeacherUiDocument());
  for (const [index, state] of ["active", "disabled", "pressed"].entries()) {
    // Deliberately rotate the art so fallback to the canonical state is observable.
    const artworkState = ["pressed", "active", "disabled"][index];
    const bytes = await readFile(`src/assets/books/ultimate-b2/legacy-classroom-ui/icons/navigation/publisher-navibar/navibar-vocabulary-${artworkState}.png`);
    const descriptor = { sha256: hash(bytes), extension: "png", mediaType: "image/png", sizeBytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), originalFilename: `custom-${state}.png` };
    ui.assets[`navibar.vocabulary.${state}`] = descriptor;
    objects.set(componentPublicationAssetStorageTarget({ bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", ...descriptor, role: "teacher_ui" }).objectKey, bytes);
  }
  inputs.documents.teacherUi = source(ui);
  return { inputs, objects };
}
