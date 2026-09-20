import assert from 'node:assert/strict';
import sharp from 'sharp';
import {randomUUID,createHash} from 'node:crypto';
import {createBuilderPagesHandler} from '../../netlify-sites/ultimate-b2-builder/server/_builder-pages.js';
import {resolveBuilderContentResource} from '../../netlify-sites/ultimate-b2-builder/server/_builder-content-registry.js';
import {saveBuilderComponentDocument} from '../../netlify-sites/ultimate-b2-builder/server/_builder-content-store.js';
import {builderDocumentSha256} from '../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js';
import {publishedManagedBookSources} from '../fixtures/published-managed-book.js';
import {publishedManagedUiFixture} from '../fixtures/published-managed-ui.js';
import {buildBookAssetHostedTeacherUiPublicKey} from '../../lib/book-assets/object-keys.js';
export async function seedB1EditionAuthoring({pool,sql,actor,storage,media}){
 const publishedManagedPageBytes=await sharp({create:{width:64,height:64,channels:3,background:'#246789'}}).png().toBuffer();
 const authorize=async()=>({builderUser:{id:actor}});
 const pages=createBuilderPagesHandler({getDatabase:()=>sql,authorize,storage:()=>storage});
 const post=(path,body)=>({path,httpMethod:'POST',headers:{host:'builder.example',origin:'https://builder.example','content-type':'application/json'},body:JSON.stringify(body)});
 const check=r=>{assert.equal(r.statusCode,200,r.body);return JSON.parse(r.body);};
 const save=async(book,component,name,document,id=null)=>{
  const resource=await resolveBuilderContentResource(book,component,name,id);const value=resource.validate(document);
  const result=await saveBuilderComponentDocument(sql,{resource,expectedRevision:0,clientMutationId:randomUUID(),document:value,payloadSha256:builderDocumentSha256(value),builderUserId:actor});
  assert.equal(result.outcome,'saved');
 };
 const byComponent={};
 for(const book of ['ultimate-b1','ultimate-b1-plus']) for(const suffix of ['students-book','workbook']){
  const component=book+'-'+suffix;const mutation=randomUUID();
  const units=(await pool.query('select * from units where book_component_id=(select id from book_components where slug=$1) order by unit_number',[component])).rows;
  const base=`/builder/api/pages/books/${book}/components/${component}/assets`;
  const prepared=check(await pages(post(base+'/prepare',{mode:'create',pageId:'',expectedRevision:0,clientMutationId:mutation,metadata:{unitId:units[0].id,label:'Edition test page',printedLabel:'4',sortOrder:1},file:{name:'fixture.png',type:'image/png',size:publishedManagedPageBytes.length}})));
  const session=(await pool.query('select staging_object_key from builder_component_page_upload_sessions where id=$1',[prepared.uploadId])).rows[0];
  media.set(session.staging_object_key,publishedManagedPageBytes);
  check(await pages(post(base+'/finalize',{uploadId:prepared.uploadId,expectedRevision:0,clientMutationId:mutation})));
  const fixture=publishedManagedBookSources(component,{pageIds:[prepared.pageId],pageLayout:[{unitNumber:1,sortOrder:1}],title:'B1 edition activity'});
  await save(book,component,'native-activity-index',fixture.native.index.payload);
  for(const [id,entry] of Object.entries(fixture.native.activities)){
   await save(book,component,'native-activity-public',entry.public.payload,id);
   await save(book,component,'native-activity-teacher',entry.teacher.payload,id);
  }
  await save(book,component,'hotspots',fixture.documents.hotspots.payload);
  if(suffix==='students-book'){
   const ui=await publishedManagedUiFixture(component,0,{vocabulary:true});
   await save(book,component,'ui-controller',ui.payload);
   for(const [key,bytes] of ui.objects) media.set(key,bytes);
   for(const asset of Object.values(ui.payload.assets)){
    const bytes=[...ui.objects.values()].find(bytes=>createHash('sha256').update(bytes).digest('hex')===asset.sha256);
    media.set(buildBookAssetHostedTeacherUiPublicKey({bookSlug:book,componentSlug:component,checksum:asset.sha256,extension:asset.extension}),bytes);
   }
  }
  byComponent[component]={pageId:prepared.pageId,activityId:Object.keys(fixture.native.activities)[0]};
 }
 return byComponent;
}
