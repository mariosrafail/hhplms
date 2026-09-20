import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import {applyCanonicalProductionMigrations} from './_migration-test-helpers.mjs';
import {requireSafeDatabase,postgresTemplate} from '../../scripts/_staging-db.mjs';
import {createBuilderEditionHandler} from '../../netlify-sites/ultimate-b2-builder/server/_builder-editions.js';
import {createBuilderWordListHandler} from '../../netlify-sites/ultimate-b2-builder/server/_builder-wordlists.js';
import {editionDatabaseReady,loadEditionStatus,loadEditionRelease} from '../../netlify-sites/ultimate-b2-builder/server/_builder-edition-store.js';
import {loadWordListEdition} from '../../netlify-sites/ultimate-b2-builder/server/_builder-wordlist-store.js';
import {prepareWordListEdition} from '../../netlify-sites/ultimate-b2-builder/server/_builder-wordlist-domain.js';
import {createBuilderAuthHandler} from '../../netlify-sites/ultimate-b2-builder/functions/builder-auth.js';
import {createBuilderContentHandler} from '../../netlify-sites/ultimate-b2-builder/server/_builder-content.js';
import {checkRuntimeSchemaReadiness} from '../../netlify/functions/_runtime-schema-readiness.js';
import {hashBuilderToken} from '../../netlify-sites/ultimate-b2-builder/server/_builder-auth.js';
import {seedB1EditionAuthoring} from './_b1-editions-fixture.mjs';
import {lexicalFixture,rehashLexicon,wordListMp3,wordListSha,testZip,wordListFiles} from '../fixtures/wordlists.js';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {expect} from '@playwright/test';
const enabled=Boolean(process.env.TEST_DATABASE_URL)&&process.env.TEST_DATABASE_CONFIRMATION==='isolated-test-database';
const checked=(r,code=200)=>{assert.equal(r.statusCode,code,r.body);return JSON.parse(r.body);};
const hash=(bytes)=>createHash('sha256').update(bytes).digest('hex');
test('B1/B1+ schema upgrade, real capture/import, immutable editions and separate ownership', {skip:!enabled},async(t)=>{
 const target=requireSafeDatabase('test');const url=new URL(target.connectionString);
 assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
 const schema='b1_editions_'+randomBytes(8).toString('hex');
 const admin=new pg.Pool({connectionString:url.toString(),max:1});await admin.query(`create schema "${schema}"`);
 url.searchParams.set('options',`-c search_path=${schema}`);const pool=new pg.Pool({connectionString:url.toString(),max:4});
 t.after(async()=>{await pool.end();await admin.query(`drop schema "${schema}" cascade`);await admin.end();});
 const sql=postgresTemplate(pool);await applyCanonicalProductionMigrations(pool,{through:'068_vocabulary_ui_bindings.sql'});
 assert.equal(await editionDatabaseReady(sql,'ultimate-b2'),true);assert.equal(await editionDatabaseReady(sql,'ultimate-b1'),false);
 const actor=randomUUID(),token=randomBytes(32).toString('hex');
 await pool.query("insert into builder_users(id,full_name,email,password_hash) values($1,'B1 editions',$2,$3)",[actor,actor+'@example.test',await bcrypt.hash('isolated-b1-edition-password',4)]);
 await pool.query("insert into builder_sessions(builder_user_id,token_hash,expires_at) values($1,$2,now()+interval '1 hour')",[actor,hashBuilderToken(token)]);
 const compatEvent={httpMethod:'GET',headers:{cookie:'hh_builder_session='+token},queryStringParameters:{}};
 assert.equal((await checkRuntimeSchemaReadiness(sql)).ready,true,'through-068 remains runtime compatible');
 checked(await createBuilderAuthHandler({getDatabase:()=>sql})(compatEvent));
 const login=await createBuilderAuthHandler({getDatabase:()=>sql})({httpMethod:'POST',headers:{host:'builder.example',origin:'https://builder.example','content-type':'application/json'},queryStringParameters:{action:'login'},body:JSON.stringify({email:actor+'@example.test',password:'isolated-b1-edition-password'})});
 assert.equal(checked(login).authenticated,true,'real login remains available before 069');
 checked(await createBuilderContentHandler({getDatabase:()=>sql})({...compatEvent,path:'/builder/api/content/books/ultimate-b2/components/ultimate-b2-students-book/hotspots'}));
 for(const book of ['ultimate-b2','ultimate-b1','ultimate-b1-plus']){
  const response=await createBuilderEditionHandler({getDatabase:()=>sql})({...compatEvent,path:`/builder/api/publication/editions/books/${book}/editions/greek`});
  if(book==='ultimate-b2')checked(response);
  else assert.equal(checked(response,409).error,'edition_schema_unavailable');
 }
 await applyCanonicalProductionMigrations(pool);
 for(const book of ['ultimate-b1','ultimate-b1-plus']) assert.equal(await editionDatabaseReady(sql,book),true);
 const media=new Map();const storage={bucket:()=> 'private-assets',signedPutUrl:async()=>({url:'https://isolated.invalid/upload',headers:{}}),
  upload:async({objectKey,body})=>{media.set(objectKey,Buffer.from(body));},delete:async({objectKey})=>{media.delete(objectKey);},
  download:async({objectKey})=>{assert(media.has(objectKey),objectKey);return media.get(objectKey);},
  head:async({objectKey})=>{const b=media.get(objectKey);assert(b,objectKey);return {byteSize:b.length,checksumSha256:hash(b),contentType:objectKey.endsWith('.mp3')?'audio/mpeg':objectKey.endsWith('.wav')?'audio/wav':'image/png'};}};
 const components=await seedB1EditionAuthoring({pool,sql,actor,storage,media});
 const preserved=async()=>{
  const result={};for(const table of ['book_pages','book_assets','builder_component_documents','book_component_releases','book_product_releases','activity_assignments']){
   const exists=(await pool.query('select to_regclass($1) relation',[table])).rows[0].relation;
   if(exists) result[table]=(await pool.query(`select coalesce(jsonb_agg(v order by v::text),'[]') data from (select to_jsonb(t) v from ${table} t) snapshots`)).rows[0].data;
  }return result;
 };
 const before=await preserved();
 const editions=createBuilderEditionHandler({getDatabase:()=>sql,storage:()=>storage});
 const words=createBuilderWordListHandler({getDatabase:()=>sql,storage:()=>storage});
 const handlerContext={cloudflare:{staticAssets:{fetch:()=>{throw new Error('B1 must not fetch B2 canonical pages');}}}};
 const event=(path,body,query={})=>({path,httpMethod:body?'POST':'GET',headers:{host:'builder.example',origin:'https://builder.example',cookie:'hh_builder_session='+token,'content-type':'application/json'},queryStringParameters:query,body:body&&JSON.stringify(body)});
 const editionBase=(book,id)=>`/builder/api/publication/editions/books/${book}/editions/${id}`;
 const wordBase=(book,id)=>`/builder/api/publication/wordlists/books/${book}/editions/${id}`;
 const mutate=async(book,id,action,body)=>checked(await editions(event(editionBase(book,id)+'/'+action,{clientMutationId:randomUUID(),...body}),handlerContext));
 const snapshots={};
 for(const book of ['ultimate-b1','ultimate-b1-plus']){
  const dataset=rehashLexicon({...lexicalFixture(),bookSlug:book});const sourceIds={};
  for(const suffix of ['students-book','workbook']){
   const component=book+'-'+suffix,sourceId=randomUUID();sourceIds[suffix]=sourceId;
   await mutate(book,'greek','capture',{sourceId,componentSlug:component,expectedRevision:0,scope:{kind:'shared',editionIds:['international','greek']}});
  }
  for(const id of ['greek','international']) for(const [index,suffix] of ['students-book','workbook'].entries())
   await mutate(book,id,'associate',{componentSlug:book+'-'+suffix,sourceId:sourceIds[suffix],expectedRevision:index});
  for(const suffix of ['students-book','workbook']){
   const component=book+'-'+suffix,base=wordBase(book,'greek')+'/components/'+component;
   const status=checked(await words(event(base),handlerContext));const sourceId=randomUUID();
   const mappings=[{group:suffix==='students-book'?'unit1_1':'work1_1',pageIds:[components[component].pageId]}];
   const begun=checked(await words(event(base+'/begin',{clientMutationId:randomUUID(),sourceId,expectedRevision:0,targetSource:status.target.reference,dataset,mappings}),handlerContext));
   const upload=event(base+'/upload/'+begun.sessionId,{}, {clientMutationId:randomUUID(),sha256:wordListSha});
   upload.body=wordListMp3.toString('base64');upload.isBase64Encoded=true;upload.headers['content-type']='audio/mpeg';
   checked(await words(upload,handlerContext));checked(await words(event(base+'/finalize/'+begun.sessionId,{clientMutationId:randomUUID()}),handlerContext));
   for(const id of ['greek','international']){
    const draft=checked(await words(event(wordBase(book,id)+'/components/'+component+'/draft'),handlerContext));
    assert.equal(draft.wordlist.entries.length,2);assert.equal(JSON.stringify(draft).includes('ΕΛΛΗΝΙΚΟ_SENTINEL'),id==='greek');
   }
  }
  for(const id of ['greek','international']){
   await mutate(book,id,'prepare',{expectedRevision:2});
   const status=await loadEditionStatus(sql,book,id);assert.equal(status.releases[0].members.length,2);
   await mutate(book,id,'publish',{releaseId:status.releases[0].id,expectedRevision:0});
   const ready=checked(await words(event(wordBase(book,id)+'/prepare',{clientMutationId:randomUUID(),expectedRevision:2}),handlerContext));
   checked(await words(event(wordBase(book,id)+'/publish',{clientMutationId:randomUUID(),releaseId:ready.releaseId,expectedRevision:0}),handlerContext));
   snapshots[book+'/'+id]=await loadWordListEdition(sql,{bookSlug:book,editionId:id,releaseId:ready.releaseId,publishedOnly:true});
   assert.equal(snapshots[book+'/'+id].content.members.length,2);
  }
 }
 assert.deepEqual(await preserved(),before,'edition/lexical operations preserve authored and historical rows');
 const unknown=await editions(event(editionBase('unknown-book','greek')),handlerContext);assert.equal(unknown.statusCode,409);
 const cross=await words(event(wordBase('ultimate-b1','greek')+'/components/ultimate-b1-plus-workbook'),handlerContext);assert.equal(cross.statusCode,409);
 const anonymous=event(editionBase('ultimate-b1','greek'));delete anonymous.headers.cookie;assert.equal((await editions(anonymous,handlerContext)).statusCode,401);
 const foreign=snapshots['ultimate-b1/greek'].content.members[0].reference.sourceId;
 const rejected=(await sql`select mutate_builder_content_edition(${actor}::uuid,${randomUUID()}::uuid,${JSON.stringify({operation:'associate',bookSlug:'ultimate-b1-plus',editionId:'greek',componentSlug:'ultimate-b1-plus-students-book',sourceId:foreign,expectedRevision:2})}::jsonb) result`)[0].result;
 assert.equal(rejected.outcome,'edition_source_owner_mismatch');
 const {readPublishedEdition}=await import('../../netlify/functions/_book-content/edition-read.js');
 const student=(await pool.query("select * from app_users where role='student' and school_id is not null limit 1")).rows[0];
 await pool.query("update app_users set status='active' where id=$1",[student.id]);student.status='active';
 const book='ultimate-b1',release=snapshots[book+'/greek'];const pack=(await pool.query('select id from book_packages where slug=$1',[book])).rows[0].id;
 await pool.query("insert into book_access(user_id,book_package_id,role_scope) values($1,$2,'student') on conflict do nothing",[student.id,pack]);
 const query={bookSlug:book,editionId:'greek',contract:'edition-release.v2',releaseId:release.id,componentSlug:book+'-workbook'};
 assert.equal((await readPublishedEdition(sql,student,query)).statusCode,403);
 await pool.query('insert into book_content_edition_access(school_id,user_id,book_package_id,edition_id) values($1,$2,$3,$4)',[student.school_id,student.id,pack,'greek']);
 const publicRead=checked(await readPublishedEdition(sql,student,query));assert.equal(publicRead.wordlist.entries.length,2);
 assert(!JSON.stringify(publicRead).includes('PUBLISHED_BOOK_PRIVATE_TEACHER_SENTINEL'));
 assert.equal((await readPublishedEdition(sql,student,{...query,teacherActivityId:components[book+'-workbook'].activityId})).statusCode,403);
 assert.equal((await readPublishedEdition(sql,student,{...query,editionId:'international'})).statusCode,403);
 assert.deepEqual(await preserved(),before);
 // The SQL boundary must reject incomplete requests even when called directly.
 // Roll back each probe so a failing negative control preserves the fixture.
 for (const missing of [undefined, null, '1', -1, 1.5, 9007199254740992, {}]) await t.test(`Word List publish rejects ${JSON.stringify(missing)} expectedRevision`,async()=>{
  const client=await pool.connect();
  try {
   await client.query('begin');
   const request={operation:'publish',bookSlug:book,editionId:'greek',releaseId:release.id,expectedRevision:missing};
   const result=(await client.query('select mutate_builder_wordlist($1,$2,$3::jsonb) result',[actor,randomUUID(),JSON.stringify(request)])).rows[0].result;
   assert.equal(result.outcome,'wordlist_revision_invalid');
  } finally {await client.query('rollback');client.release();}
 });
 const negativeRequest=async(writer,request,expected,mutation=randomUUID())=>{
  const client=await pool.connect();
  try{
   await client.query('begin');
   const result=(await client.query(`select ${writer}($1,$2,$3::jsonb) result`,[actor,mutation,JSON.stringify(request)])).rows[0].result;
   assert.equal(result.outcome,expected);
  }finally{await client.query('rollback');client.release();}
 };
 for(const request of [null,[],{}, {operation:'prepare',bookSlug:book,editionId:'greek',expectedRevision:2}]){
  await negativeRequest('mutate_builder_wordlist',request,request?.operation?'wordlist_release_context':'wordlist_context_invalid');
 }
 for(const expectedRevision of [undefined,null,'2',-1,1.5,9007199254740992,{}]){
  await negativeRequest('mutate_builder_content_edition',{operation:'publish',bookSlug:book,editionId:'greek',releaseId:release.content.id,expectedRevision},'edition_revision_invalid');
 }
 for(const [label,change] of [
  ['missing content',(r)=>{delete r.content;}],
  ['mismatched release id',(r)=>{r.id=randomUUID();}],
  ['foreign edition',(r)=>{r.composition.edition.editionId='international';}],
  ['foreign book member',(r)=>{r.content.members[0]=snapshots['ultimate-b1-plus/greek'].content.members[0];}],
  ['missing hash',(r)=>{delete r.releaseSha256;}],
 ])await t.test(`SQL rejects ${label} in Word List candidate`,async()=>{
  const id=randomUUID();const candidate=structuredClone(prepareWordListEdition({id,number:2,edition:release.composition.edition,sources:release.content.members,wordlists:release.wordlists}));
  change(candidate);
  await negativeRequest('mutate_builder_wordlist',{operation:'prepare',bookSlug:book,editionId:'greek',expectedRevision:2,release:candidate},'wordlist_release_context',id);
 });
 // B2 exercises the real collector, not a handcrafted source wrapper.
 const b2Capture=await mutate('ultimate-b2','greek','capture',{sourceId:randomUUID(),componentSlug:'ultimate-b2-students-book',expectedRevision:0,scope:{kind:'shared',editionIds:['international','greek']}});
 assert.equal(b2Capture.outcome,'saved');
 const b2Status=await loadEditionStatus(sql,'ultimate-b2','greek');
 assert.equal(b2Status.sources[0].content.compilerId,'ultimate-b2-students-book-v3');
 assert.deepEqual(await preserved(),before);
 if(process.env.B1_EDITION_BROWSER==='1'){
  const {verifyB1PublicationBrowser}=await import('./_b1-publication-browser.mjs');
  const {changeBrowserUiDraft}=await import('./_b1-immutable-ui-browser.mjs');
  for(const book of ['ultimate-b1','ultimate-b1-plus'])await changeBrowserUiDraft(pool,actor,book,media,1);
  const beforeBrowser=await preserved();
  await verifyB1PublicationBrowser({pool,sql,actor,student,media,editionAcceptance:async(browser)=>{
   await exerciseEditionWorkflow({...browser,pool,sql,student,components,snapshots});
  }});
  for(const [key,original] of Object.entries(snapshots)){
   const [bookSlug,editionId]=key.split('/');
   assert.deepEqual(await loadWordListEdition(sql,{bookSlug,editionId,releaseId:original.id,publishedOnly:true}),original);
  }
  assert.deepEqual(await preserved(),beforeBrowser,'browser import/classroom preserves authored and historical rows after the intentional fixture UI edit');
 }
});

// Extends the existing real-Worker B1 browser harness; no hosted authentication
// or shared database is used. The enclosing test enforces a loopback-only DB.
async function exerciseEditionWorkflow({page,context,browser,builderOrigin,lmsOrigin,pool,sql,student,components,snapshots,errors}){
 const output=path.resolve(process.env.B1_EDITION_EVIDENCE_DIR||'artifacts/b1-editions');await mkdir(output,{recursive:true});
 const writes=[];context.on('request',r=>{if(r.method()==='POST')writes.push(new URL(r.url()).pathname);});
 const audio=await readFile(new URL('../fixtures/wordlist-pronunciation.mp3',import.meta.url));const audioSha=hash(audio);
 const releases={};const receipts=[];
 const selectComponent=async(component)=>{
  if(await page.getByLabel('Component',{exact:true}).inputValue()!==component){
   page.once('dialog',d=>d.accept());await page.getByLabel('Component',{exact:true}).selectOption(component);
  }
 };
 const inspectClassroom=async({targetPage,requestContext,origin,book,id,suffix,kind,teacher=true})=>{
  const classroom=targetPage.getByRole('region',{name:'Edition classroom',exact:true});
  await expect(classroom.locator('.teacher-unit-page-open').first()).toBeVisible();
  await classroom.locator('.teacher-unit-page-open').first().click();
  const vocabulary=classroom.getByRole('button',{name:'Vocabulary',exact:true});await expect(vocabulary).toBeEnabled();
  const owner=snapshots[book+'/'+id].content.members[0];
  const ownerHash=owner.reference.sha256;
  for(const state of ['active','disabled','pressed']){
   const url=new URL(await vocabulary.locator(`[data-icon-state="${state}"]`).getAttribute('src'),origin);
   assert.equal(url.searchParams.get('uiOwnerSha256'),ownerHash);
   assert.equal(url.searchParams.get('uiBindingId'),`navibar.vocabulary.${state}`);
   const response=await requestContext.get(url.href);assert.equal(response.status(),200);
   assert.equal(hash(await response.body()),owner.content.teacherProjection.ui.assets[`navibar.vocabulary.${state}`].sha256);
  }
  const grammar=classroom.getByRole('button',{name:/Grammar/});
  await expect(grammar).toHaveCount(1);
  for(const button of await grammar.all())await expect(button).toBeDisabled();
  const overlay=classroom.getByRole('dialog',{name:'Word List',exact:true});
  const lexicalCount=writes.length;
  await vocabulary.click();await expect(overlay.locator('.word-list-row')).toHaveCount(2);
  await expect(overlay.getByRole('heading',{name:'Greek',exact:true})).toHaveCount(id==='greek'?1:0);
  if(id==='greek')await expect(overlay.getByText('ΕΛΛΗΝΙΚΟ_SENTINEL',{exact:true}).first()).toBeVisible();
  else await expect(overlay).not.toContainText('ΕΛΛΗΝΙΚΟ_SENTINEL');
  await overlay.getByRole('button',{name:'Play English pronunciation 91',exact:true}).click();
  const audioElement=classroom.locator('.word-list-overlay audio');
  await expect.poll(()=>audioElement.evaluate(a=>a.currentTime)).toBeGreaterThan(0);
  const audioUrl=new URL(await audioElement.getAttribute('src'),origin);
  assert.equal(audioUrl.searchParams.get('audioSha256'),audioSha);
  const result=await requestContext.get(audioUrl.href);assert.equal(result.status(),200);assert.equal(hash(await result.body()),audioSha);
  await targetPage.keyboard.press('Escape');await expect(overlay).toHaveCount(0);
  for(const word of await classroom.locator('.word-list-word').all())await expect(word).toBeHidden();
  assert.equal(await audioElement.evaluate(a=>a.paused&&!a.getAttribute('src')),true);
  await classroom.locator('.teacher-offline-page-hotspot').first().click();
  const activity=classroom.locator('.teacher-offline-embedded-activity');await expect(activity).toBeVisible();
  await expect(activity.getByText('Explain question 1.',{exact:true})).toBeVisible();
  const answer=activity.locator('.native-or-answer-layer').first();
  if(teacher){await answer.click();await expect(answer).toHaveAttribute('aria-pressed','true');}
  await activity.evaluate(e=>{e.dataset.editionTestMount='retained';});
  const before=await activity.evaluate(e=>({text:e.innerText,answers:[...e.querySelectorAll('input,textarea')].map(n=>n.value),pressed:[...e.querySelectorAll('[aria-pressed]')].map(n=>n.getAttribute('aria-pressed'))}));
  await vocabulary.click();await expect(overlay).toBeVisible();await targetPage.keyboard.press('Escape');await expect(overlay).toHaveCount(0);
  for(const word of await classroom.locator('.word-list-word').all())await expect(word).toBeHidden();
  await expect(activity).toHaveAttribute('data-edition-test-mount','retained');
  assert.deepEqual(await activity.evaluate(e=>({text:e.innerText,answers:[...e.querySelectorAll('input,textarea')].map(n=>n.value),pressed:[...e.querySelectorAll('[aria-pressed]')].map(n=>n.getAttribute('aria-pressed'))})),before);
  assert.equal(writes.length,lexicalCount,'classroom and Word List interaction must not save');
  await classroom.screenshot({path:path.join(output,`${book}-${id}-${suffix}-${kind}.png`)});
  receipts.push({book,edition:id,component:suffix,kind,ownerHash,audioSha,sessionPreserved:true});
 };
 try{
  for(const book of ['ultimate-b1','ultimate-b1-plus']){
   const dataset=lexicalFixture();dataset.bookSlug=book;dataset.audio=[{path:`audio/${audioSha}.mp3`,sha256:audioSha,byteSize:audio.length,mediaType:'audio/mpeg'}];
   for(const entry of dataset.entries){entry.audioPath=dataset.audio[0].path;entry.english.word=book+' sample';}rehashLexicon(dataset);
   const zip=testZip(new Map([['wordlist.json',Buffer.from(JSON.stringify(dataset))],[dataset.audio[0].path,audio]]));
   await page.goto(`${builderOrigin}/#/books/${book}`);
   await expect(page.getByLabel('Content edition',{exact:true})).toHaveValue('');
   for(const id of ['greek','international']){
    await page.getByLabel('Content edition',{exact:true}).selectOption(id);
    await expect(page.getByLabel('Component',{exact:true})).toBeVisible();
    assert.deepEqual(await page.getByLabel('Component',{exact:true}).locator('option').evaluateAll(nodes=>nodes.map(n=>n.value)),[book+'-students-book',book+'-workbook']);
    for(const suffix of ['students-book','workbook']){
     const component=book+'-'+suffix;await selectComponent(component);
     const associated=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/associate'));
     await page.getByRole('button',{name:'Associate selected source',exact:true}).click();assert.equal((await associated).status(),200);
     const area=page.getByRole('region',{name:'Word Lists',exact:true});await expect(area.getByLabel('Word List package',{exact:true})).toBeEnabled();
     if(id==='greek'){
      const count=writes.length;
      await area.getByLabel('Word List package',{exact:true}).setInputFiles({name:'foreign-b2.zip',mimeType:'application/zip',buffer:testZip(wordListFiles())});
      await expect(area.getByRole('alert')).toBeVisible();assert.equal(writes.length,count);
      await area.getByLabel('Word List package',{exact:true}).setInputFiles({name:book+'.zip',mimeType:'application/zip',buffer:zip});
      await expect(area.getByText(/New: 0 · Changed: 2/)).toBeVisible();assert.equal(writes.length,count,'ZIP preview is read-only');
      await area.getByLabel(`Pages for ${suffix==='students-book'?'unit1_1':'work1_1'}`,{exact:true}).selectOption(components[component].pageId);
      page.once('dialog',d=>d.accept());await area.getByRole('button',{name:'Confirm Word List import',exact:true}).click();
      await expect(area.getByText('Word List saved. Page readiness is evaluated separately.')).toBeVisible();
      assert(writes.slice(count).some(p=>p.includes('/upload/')));
     }
     await area.getByRole('button',{name:'Open saved draft classroom',exact:true}).click();
     await inspectClassroom({targetPage:page,requestContext:context.request,origin:builderOrigin,book,id,suffix,kind:'draft'});
     await page.getByRole('button',{name:'Close classroom',exact:true}).click();
    }
    const area=page.getByRole('region',{name:'Word Lists',exact:true});
    await area.getByRole('button',{name:'Prepare edition with Word Lists',exact:true}).click();
    await expect(area.getByRole('button',{name:'Open classroom candidate 2',exact:true})).toBeVisible();
    for(const suffix of ['students-book','workbook']){
     await selectComponent(book+'-'+suffix);
     await area.getByRole('button',{name:'Open classroom candidate 2',exact:true}).click();
     await inspectClassroom({targetPage:page,requestContext:context.request,origin:builderOrigin,book,id,suffix,kind:'candidate'});
     await page.getByRole('button',{name:'Close classroom',exact:true}).click();
    }
    await area.getByRole('button',{name:'Publish Word List edition 2',exact:true}).click();await expect(area.getByText('v2 release 2 · Published',{exact:true})).toBeVisible();
    releases[book+'/'+id]=(await pool.query('select r.id from book_wordlist_edition_releases r join book_packages p on p.id=r.book_package_id where p.slug=$1 and r.edition_id=$2 and r.release_number=2',[book,id])).rows[0].id;
   }
  }
  const {hashToken,sessionCookieName}=await import('../../netlify/functions/_auth-utils.js');
  const token=randomBytes(32).toString('hex');await pool.query("insert into auth_sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '1 hour')",[student.id,hashToken(token)]);
  const session=await browser.newContext();await session.addCookies([{name:sessionCookieName,value:token,url:lmsOrigin,httpOnly:true,sameSite:'Lax'}]);
  session.on('request',r=>{if(r.method()==='POST')writes.push(new URL(r.url()).pathname);});
  await session.route('**/*',async route=>{
   const host=new URL(route.request().url()).hostname;
   if(host!=='127.0.0.1'){errors.push(`Unexpected published network host: ${host}`);await route.abort();}
   else await route.fallback();
  });
  const published=await session.newPage();
  published.on('pageerror',error=>errors.push(error.message));
  published.on('response',async response=>{
   if(response.status()>=400)console.log('B1_EDITION_PUBLISHED_RESPONSE',response.status(),new URL(response.url()).pathname,new URL(response.url()).search,await response.text().catch(()=>''));
  });
  for(const book of ['ultimate-b1','ultimate-b1-plus'])for(const id of ['greek','international']){
   const packageId=(await pool.query('select id from book_packages where slug=$1',[book])).rows[0].id;
   await pool.query("insert into book_access(user_id,book_package_id,role_scope) values($1,$2,'student') on conflict do nothing",[student.id,packageId]);
   await pool.query('insert into book_content_edition_access(school_id,user_id,book_package_id,edition_id) values($1,$2,$3,$4) on conflict do nothing',[student.school_id,student.id,packageId,id]);
   for(const suffix of ['students-book','workbook']){
    const query={action:'edition-release',contract:'edition-release.v2',bookSlug:book,editionId:id,releaseId:releases[book+'/'+id],componentSlug:book+'-'+suffix,content:'1'};
    const url=(overrides={})=>`${lmsOrigin}/.netlify/functions/book-content?${new URLSearchParams({...query,...overrides})}`;
    assert.equal((await context.request.get(url())).status(),401,'Builder authentication is not an LMS session');
    assert.equal((await session.request.get(url({componentSlug:book==='ultimate-b1'?'ultimate-b1-plus-workbook':'ultimate-b1-workbook'}))).status(),404);
    assert.equal((await session.request.get(url({ui:'1',componentSlug:book==='ultimate-b1'?'ultimate-b1-plus-workbook':'ultimate-b1-workbook'}))).status(),404);
    assert.equal((await session.request.get(url({ui:'1',componentSlug:book+'-grammar-book'}))).status(),404);
    assert.equal((await session.request.get(url({releaseId:releases[book+'/'+(id==='greek'?'international':'greek')]}))).status(),404);
    assert.equal((await session.request.get(url({teacherActivityId:components[book+'-'+suffix].activityId}))).status(),403);
    const direct=await session.request.get(url());
    assert.equal(direct.status(),200,`Published content response: ${await direct.text()}`);
    await published.goto(`${lmsOrigin}/#/editions/${book}/${id}/releases/${releases[book+'/'+id]}/components/${book}-${suffix}`);
    await inspectClassroom({targetPage:published,requestContext:session.request,origin:lmsOrigin,book,id,suffix,kind:'published',teacher:false});
    await expect(published.locator('body')).not.toContainText('PUBLISHED_BOOK_PRIVATE_TEACHER_SENTINEL');
   }
  }
  await session.close();assert.equal(receipts.length,24);await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipts,null,2));
  console.log('B1_EDITION_BROWSER: 24 draft/candidate/published book-edition-component cases, confirmed imports, frozen UI/audio and retained activity state passed.');
 }catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
}
