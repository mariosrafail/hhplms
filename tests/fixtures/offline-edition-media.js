import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import synthetic from "./students-book-synthetic-media.json" with { type: "json" };
import { publishedManagedPageBytes } from "./published-managed-book.js";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { buildNativeActivityAssetObjectKey, buildBuilderFontLibraryObjectKey } from "../../lib/book-assets/object-keys.js";

function worksheetPdf() {
  const content = "BT /F1 18 Tf 72 720 Td (Offline worksheet fixture) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let text = "%PDF-1.4\n"; const offsets = [];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

export async function completeOfflineFixtureMedia({ inputs, objects }) {
  const scope = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" };
  const add = (activityId, slot, bytes, extension, mediaType, role = "activity_artwork") => {
    const sha256 = createHash("sha256").update(bytes).digest("hex"), assetId = randomUUID();
    const reference = { assetId, checksumSha256: sha256, role, slot: role === "activity_font" ? `font-${assetId.replaceAll("-", "")}` : slot };
    const key = role === "activity_font" ? buildBuilderFontLibraryObjectKey({ ...scope, checksum: sha256 })
      : buildNativeActivityAssetObjectKey({ ...scope, activityId, assetSlot: slot, checksum: sha256, extension: `.${extension}`, purpose: role === "native_teacher_answer" ? "teacher-answer" : "native-asset" });
    const row = { id: assetId, checksum_sha256: sha256, asset_role: role, object_key: key, storage_profile: "private", storage_bucket: "isolated-editions-fixture",
      mime_type: mediaType, byte_size: bytes.length, width: extension === "png" ? 1 : null, height: extension === "png" ? 1 : null, publication_status: "draft", access_level: "internal",
      source_metadata: role === "activity_font" ? { font_library_scope: "component", original_filename: "Ahem.ttf", family_name: "Ahem" } : { native_activity_id: activityId, asset_slot: slot } };
    inputs.native.assetRows.push(row); objects.set(key, bytes); return { reference, row };
  };
  const image = Object.values(inputs.native.activities).find((entry) => entry.public.payload.kind === "image");
  const pub = image.public.payload, teacher = image.teacher.payload;
  const answer = add(pub.activityId, "sample-answer", publishedManagedPageBytes, "png", "image/png", "native_teacher_answer");
  teacher.parts[0].solution.sampleAnswer = { enabled: true, image: { reference: answer.reference, mediaType: "image/png", sourceWidth: 1, sourceHeight: 1, altText: "OFFLINE_TEACHER_ANSWER_ONLY" } };
  for (const [name, slot, extension, mediaType] of [["tone.mp3", "offline-supplemental", "mp3", "audio/mpeg"], ["color.mp4", "offline-video", "mp4", "video/mp4"]]) {
    const bytes = Buffer.from(synthetic.files[name].base64, "base64"); const asset = add(pub.activityId, slot, bytes, extension, mediaType);
    pub.assets.push(asset.reference);
    if (extension === "mp3") pub.supplementalAudio = { assetSlot: slot, durationMs: 250 };
    else pub.video = { kind: "managed-mp4", assetSlot: slot, fileName: "synthetic-blue.mp4", byteSize: bytes.length, durationMs: 400,
      cues: [{ id: "cue-00000000000000000000000000000001", startMs: 0, endMs: 400, text: "Synthetic blue frame" }] };
  }
  const pdf = worksheetPdf(), worksheet = add(pub.activityId, "offline-video-worksheet", pdf, "pdf", "application/pdf");
  pub.assets.push(worksheet.reference);
  pub.video.worksheet = { assetSlot: worksheet.reference.slot, fileName: "offline-worksheet.pdf", byteSize: pdf.length };
  const open = Object.values(inputs.native.activities).find((entry) => entry.public.payload.kind === "open-response");
  const bytes = Buffer.from(await readFile(new URL("./fonts/Ahem.ttf.base64", import.meta.url), "utf8"), "base64");
  const font = add(open.public.payload.activityId, "font", bytes, "ttf", "font/ttf", "activity_font");
  open.public.payload.assets.push(font.reference);
  open.public.payload.parts[0].interaction.questions[0].responseRegion.presentation.answerFontAssetSlot = font.reference.slot;
  const ui = structuredClone(inputs.documents.teacherUi.payload); ui.overviewCaptionFontAsset = font.reference;
  inputs.documents.teacherUi = { payload: ui, revision: 1, sha256: builderDocumentSha256(ui) };
  inputs.overviewFontSources = [{ row: font.row }];
  for (const entry of [image, open]) for (const type of ["public", "teacher"]) entry[type].sha256 = builderDocumentSha256(entry[type].payload);
  return { inputs, objects };
}
