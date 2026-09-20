import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {contentEdition, contentEditionBooks, editionSourceCompilerContract} from '../src/data/contentEditions.js';
import {freezeEditionSource,prepareEditionRelease,verifyEditionRelease} from '../netlify-sites/ultimate-b2-builder/server/_builder-edition-domain.js';
import {publishedManagedBookSources,managedPageRouteIds} from './fixtures/published-managed-book.js';
import {lexicalFixture,rehashLexicon,wordListSha} from './fixtures/wordlists.js';
import {freezeWordList,prepareWordListEdition,verifyWordListEdition,projectWordList,wordListObjectKey} from '../netlify-sites/ultimate-b2-builder/server/_builder-wordlist-domain.js';

for(const bookSlug of ['ultimate-b1','ultimate-b1-plus']) test(`${bookSlug} has isolated SB/WB editions, frozen SB UI, lexical projections and immutable writers`,async()=>{
 const sources=[];
 for(const componentSlug of contentEditionBooks[bookSlug].components){
  const inputs=publishedManagedBookSources(componentSlug,{pageIds:await managedPageRouteIds(componentSlug,1),pageLayout:[{unitNumber:1,sortOrder:1}]});
  const record=freezeEditionSource({schemaVersion:'content-source.v1',sourceId:randomUUID(),bookSlug,componentSlug,scope:{kind:'shared',editionIds:['international','greek']},revision:1,inputs});
  sources.push(record);
  assert.equal(record.content.compilerId,editionSourceCompilerContract(bookSlug,componentSlug).compilerId);
 }
 assert.equal(sources[0].content.teacherProjection.ui.packageId,bookSlug+'-students-book');
 const dataset=rehashLexicon({...lexicalFixture(),bookSlug});
 const lists=sources.map(target=>{
  const sourceId=randomUUID(),componentSlug=target.reference.componentSlug;
  const binding={...dataset.audio[0],role:'wordlist_audio',sourceId,componentSlug,bookSlug,assetId:randomUUID(),storageBucket:'private-assets'};
  binding.objectKey=wordListObjectKey(binding);
  return freezeWordList({sourceId,revision:1,mappingRevision:1,dataset,target,bindings:[binding],mappings:[{group:componentSlug.endsWith('workbook')?'work1_1':'unit1_1',pageIds:[target.content.publicProjection.pages[0].id]}]});
 });
 for(const editionId of ['international','greek']){
  const edition=contentEdition(bookSlug,editionId);
  const v1=prepareEditionRelease({id:randomUUID(),number:1,edition,sources});
  const v2=prepareWordListEdition({id:randomUUID(),number:1,edition,sources,wordlists:lists});
  assert.equal(v1.compilerId,bookSlug+'-edition-composition-v1');
  assert.equal(v2.compilerId,bookSlug+'-edition-composition-v2');
  assert.equal(v1.members.length,2);assert.equal(v2.content.members.length,2);
  assert.deepEqual(verifyEditionRelease(v1,edition),v1);
  assert.deepEqual(verifyWordListEdition(v2,edition),v2);
  for(const record of lists){
   const projected=projectWordList(record,editionId);
   assert.equal(projected.entries[0].audioSha256,wordListSha);
   assert.equal(JSON.stringify(projected).includes('ΕΛΛΗΝΙΚΟ_SENTINEL'),editionId==='greek');
  }
  assert.throws(()=>prepareEditionRelease({id:randomUUID(),number:2,edition,sources:sources.slice(0,1)}));
  assert.throws(()=>verifyEditionRelease({...v1,compilerId:'ultimate-b2-edition-composition-v1'},edition));
  assert.throws(()=>verifyWordListEdition({...v2,compilerId:'ultimate-b2-edition-composition-v2'},edition));
  assert.throws(()=>prepareWordListEdition({id:randomUUID(),number:2,edition,sources,wordlists:[lists[0],lists[0]]}));
  const original=JSON.stringify(v2);const future=structuredClone(sources[0].source);future.inputs.pages.rows[0].label='future edit';
  assert.equal(JSON.stringify(v2),original);
  assert.throws(()=>{sources[0].source.inputs.pages.rows[0].label='forbidden mutation';},TypeError);
 }
 assert.throws(()=>editionSourceCompilerContract(bookSlug,bookSlug+'-grammar-book'));
 assert.throws(()=>freezeEditionSource({...sources[0].source,bookSlug:'ultimate-b2'}));
});

test('capture drops only collector registry helpers and never alters saved content',async()=>{
 const {persistableCollectedEditionInputs}=await import('../netlify-sites/ultimate-b2-builder/server/_builder-editions.js');
 const component='ultimate-b1-students-book';
 const input=publishedManagedBookSources(component,{pageIds:await managedPageRouteIds(component,1),pageLayout:[{unitNumber:1,sortOrder:1}]});
 const helpers={validate:()=>true,baseline:()=>({})};
 input.documents.hotspots.resource=helpers;input.native.index.resource=helpers;
 for(const entry of Object.values(input.native.activities)){entry.public.resource=helpers;entry.teacher.resource=helpers;}
 const projected=persistableCollectedEditionInputs(input);
 assert.equal(input.documents.hotspots.resource,helpers);assert(!('resource' in projected.documents.hotspots));
 assert.deepEqual(projected.documents.hotspots.payload,input.documents.hotspots.payload);
 const value={schemaVersion:'content-source.v1',sourceId:randomUUID(),bookSlug:'ultimate-b1',componentSlug:component,scope:{kind:'shared',editionIds:['international','greek']},revision:1,inputs:projected};
 assert.doesNotThrow(()=>freezeEditionSource(value));
 assert.throws(()=>freezeEditionSource({...value,inputs:input}),{code:'edition_source_invalid'});
 const malicious=structuredClone(projected);malicious.documents.hotspots.payload.credentials='not allowed';
 assert.throws(()=>freezeEditionSource({...value,inputs:malicious}),{code:'edition_source_transient_data'});
});

test('edition classroom routes accept only matching registered book/components',async()=>{
 const {createServer}=await import('./_vite-test-server.mjs');
 const server=await createServer({server:{middlewareMode:true,hmr:false},logLevel:"silent"});
 try {const {parseHashRoute}=await server.ssrLoadModule('/src/utils/hashRoutes.js');const id=randomUUID();
 for(const book of ['ultimate-b1','ultimate-b1-plus']){
  const route=`#/editions/${book}/greek/releases/${id}/components/${book}-workbook`;
  assert.equal(parseHashRoute(route).view,'edition-classroom');
  assert.notEqual(parseHashRoute(route.replace(`${book}-workbook`,'ultimate-b2-workbook')).view,'edition-classroom');
  assert.notEqual(parseHashRoute(route.replace('-workbook','-grammar-book')).view,'edition-classroom');
 } } finally {await server.close();}
});
