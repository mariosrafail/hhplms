import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createBuilderNativeActivitiesHandler } from '../../netlify-sites/ultimate-b2-builder/server/_builder-native-activities.js';
import { resolveNativeActivityKind } from '../../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js';
import { buildNativeActivityAssetObjectKey } from '../../lib/book-assets/object-keys.js';

// Real managed activity creation, canonical documents and synthetic private storage.
// Identical bytes deliberately occupy both Public and Teacher roles in every book.
export async function addManagedImageFixture({ pool, sql, actor, book, component, pageId, save, media, bytes }) {
  const create = createBuilderNativeActivitiesHandler({ getDatabase: () => sql, authorize: async () => ({ builderUser: { id: actor } }) });
  const result = await create({ httpMethod: 'POST', path: `/builder/api/native-activities/books/${book}/components/${component}/create`,
    headers: { host: 'builder.example', origin: 'https://builder.example', 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'image', pageId, title: 'Published image fixture', clientMutationId: randomUUID() }) });
  assert.equal(result.statusCode, 200, result.body);
  const activityId = JSON.parse(result.body).activityId;
  const suffix = component.endsWith('-workbook') ? 'wb' : 'sb';
  assert.equal(activityId, `${book}-${suffix}-00000000000040008000000000000003-o2`);
  const kind = resolveNativeActivityKind('image');
  const publicDocument = kind.createBlankPublic({ activityId, title: 'Published image fixture', placement: { pageId } });
  const teacherDocument = kind.createBlankTeacher({ activityId });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const references = [];
  for (const [role, slot, purpose] of [['activity_artwork', 'composition-artwork', 'native-asset'], ['native_teacher_answer', 'teacher-answer', 'teacher-answer']]) {
    const assetId = randomUUID();
    const objectKey = buildNativeActivityAssetObjectKey({ bookSlug: book, componentSlug: component, activityId, checksum: sha256, extension: '.png', purpose });
    media.set(objectKey, bytes);
    await pool.query(`insert into book_assets(id,book_package_id,edition_id,book_component_id,stable_logical_key,asset_role,object_key,storage_profile,storage_bucket,mime_type,byte_size,checksum_sha256,width,height,edition_identifier,version,publication_status,access_level,source_metadata)
      select $1,book_package_id,edition_id,book_component_id,$2,$3,$4,'private','private-assets','image/png',$5,$6,64,64,edition_identifier,version,'draft','internal',$7::jsonb
      from book_assets where book_component_id=(select id from book_components where slug=$8) and asset_role='page_image' limit 1`,
    [assetId, `${book}.${component}.${activityId}.${role}`, role, objectKey, bytes.length, sha256, JSON.stringify({ native_activity_id: activityId, asset_slot: slot }), component]);
    references.push({ assetId, checksumSha256: sha256, role, slot });
  }
  publicDocument.assets = [references[0]];
  publicDocument.parts[0].interaction.images = [{ id: 'img-10000000000040008000000000000001', assetSlot: references[0].slot,
    area: { x: 10, y: 20, width: 320, height: 220 }, order: 0, altText: 'Public diagram', decorative: false, fit: 'contain', locked: false }];
  teacherDocument.parts[0].solution.sampleAnswer = { enabled: true, image: { reference: references[1], mediaType: 'image/png', sourceWidth: 64, sourceHeight: 64, altText: 'PRIVATE_IMAGE_DESCRIPTION' } };
  await save(book, component, 'native-activity-public', publicDocument, activityId);
  await save(book, component, 'native-activity-teacher', teacherDocument, activityId);
  return { activityId, sha256, references };
}
