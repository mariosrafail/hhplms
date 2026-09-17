import { runMultiPartReadableAuthoring } from "./multi-part-readable-authoring-regressions.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { createServer } from "../../tests/_vite-test-server.mjs";
import { dndId } from "../../tests/fixtures/native-runtime-regressions/drag-drop-improvements-data.js";

export async function runRuntimeCorrectionsRegressions(browser, output) {
  await mkdir(output, { recursive: true });
  const media = new Map();
  const provider = { configureServer(server) { server.middlewares.use((req,res,next) => { const item=media.get(req.url?.split("?")[0]); if (!item) return next(); res.setHeader("Content-Type",item.type); res.end(item.bytes); }); }, name: "corrections-provider", enforce: "pre", resolveId: (id) => ["virtual:component-publication", "virtual:hosted-native-drafts"].includes(id) ? `\0${id}` : null,
    load: (id) => id === "\0virtual:hosted-native-drafts" ? "export const hostedNativeDraftAssetUrl=(_,id)=>globalThis.corrections.assetUrl(id); export const hostedNativeDraftTeacherAssetUrl=()=>'/private-answer';" : id === "\0virtual:component-publication" ? "export const publishedNativeAssetUrl=(_,ref)=>globalThis.corrections.assetUrl(ref.assetId); export const publishedNativeTeacherAssetUrl=()=>'/private-answer'; export const loadPublishedNativeTeacherDocument=async()=>globalThis.corrections.pair.teacherDocument;" : null };
  const server = await createServer({ configFile: false, plugins: [provider, react()], optimizeDeps: { entries: ["tests/fixtures/native-runtime-regressions/runtime-corrections.html"] }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
  await server.listen();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", acceptDownloads: true });
  const page = await context.newPage(); const errors = []; const evidence = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const images = {};
  for (const [slot, width, height, color] of [["shared",1024,582,"#e2edf8"],["background",1024,1100,"#d6eafa"],["overlay",150,100,"#d6a75b"],["item",120,60,"#357453"],["readable",1000,1800,"#fcf2d8"],["custom-worksheet",60,60,"#ba3267"]]) images[slot] = await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
  const audio = await readFile("src/assets/books/ultimate-b2/teacher-offline-media/unit-1-television-dialogue.mp3");
  const pdf = await readFile("src/assets/books/ultimate-b2/legacy-pilot/unit-1/part-2/obj1/video-worksheet.pdf");
  for (const [slot,bytes] of Object.entries(images)) media.set(`/correction-assets/${slot}`,{type:"image/png",bytes});
  media.set("/correction-assets/worksheet",{type:"application/pdf",bytes:pdf}); media.set("/correction-assets/worksheet-replaced",{type:"application/pdf",bytes:pdf});
  await page.route("**/correction-assets/*", (route) => { const slot = new URL(route.request().url()).pathname.split("/").pop(); return route.fulfill({ contentType: slot === "audio" ? "audio/mpeg" : slot.startsWith("worksheet") ? "application/pdf" : "image/png", body: slot === "audio" ? audio : slot.startsWith("worksheet") ? pdf : images[slot] || images.background }); });
  const configure = (values) => page.evaluate((values) => corrections.configure(values), values);
  const send = (type) => page.evaluate((type) => corrections.send(type), type);
  const word = (n) => page.locator(`[data-drag-drop-word-id="${dndId("word", n)}"]`);
  const geometry = () => page.locator(".native-drag-drop").first().evaluate((root) => {
    const rect = (selector) => { const node = root.querySelector(selector); const r = node.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height }; };
    const bank = root.querySelector(".native-drag-drop-bank"); const pane = root.querySelector(".native-drag-drop-workspace");
    return { bank:rect(".native-drag-drop-bank"), viewport:rect(".native-drag-drop-workspace"), stage:rect(".native-drag-drop-stage"), image:rect(".native-drag-drop-artwork"), target:rect(".native-drag-drop-target"), items:bank.querySelectorAll("[data-drag-drop-word-id]").length, scrollTop:pane.scrollTop, bankHeight:bank.offsetHeight };
  });
  const drag = async (from, to, invalid = false) => {
    const source = await from.boundingBox(); const dest = invalid ? { x:3, y:5, width:1, height:1 } : await to.boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
    await page.mouse.move(dest.x + dest.width / 2, dest.y + dest.height / 2, { steps: 8 }); await page.mouse.up();
  };
  try {
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/native-runtime-regressions/runtime-corrections.html`);
    for (const width of [1440, 760]) for (const layout of ["standard", "text"]) for (const images of [false, true]) {
      await page.setViewportSize({ width, height:1000 }); await configure({ kind:"dnd", path:"student", layout, images, scale:1 });
      await expect(word(12)).toBeVisible(); await expect.poll(() => page.evaluate(()=>corrections.state?.readableTextAvailable)).toBe(false); await expect.poll(async () => (await geometry()).bankHeight).toBe(240);
      const records = [await geometry()]; await page.screenshot({path:`${output}/adaptive-full-${layout}-${images}-${width}.png`}); const target = page.locator("[data-drag-drop-target-id]").first(); const bank = page.locator(".native-drag-drop-bank");
      await drag(word(1), target); await expect(word(1)).toHaveCount(0);
      for (let n=2;n<=12;n++) { await word(n).click(); await target.focus(); await page.keyboard.press("Enter"); await expect(word(n)).toHaveCount(0); if ([4,10,12].includes(n)) { await expect.poll(async () => (await geometry()).items).toBe(12-n); records.push(await geometry()); } }
      await expect.poll(async () => (await geometry()).bankHeight).toBe(24); await expect(page.getByText("Drag an answer here to return it", { exact: true })).toHaveCount(0); records.push(await geometry()); await page.screenshot({path:`${output}/adaptive-empty-${layout}-${images}-${width}.png`});
      for (const record of records) for (const field of ["image","target","stage"]) for (const dimension of ["width","height","x","y"]) assert.ok(Math.abs(record[field][dimension]-records[0][field][dimension])<1, JSON.stringify({width,layout,images,field,dimension,records}));
      assert.ok(records.at(-1).bank.height < records[0].bank.height);
      if (layout === "text") for(const record of records) assert.ok(Math.abs(record.viewport.y+record.viewport.height-record.bank.y)<1,"no spacer between viewport and bank");
      if (layout === "text") assert.ok(Math.abs(records.at(-1).viewport.height-records[0].viewport.height-(records[0].bank.height-records.at(-1).bank.height))<1);
      const placed = () => target.getByRole("button", {name:/^Remove/});
      const beforeInvalid = await page.evaluate(() => corrections.responses); await drag(placed().first(), bank, true); assert.deepEqual(await page.evaluate(() => corrections.responses), beforeInvalid);
      const source = await placed().first().boundingBox(); await page.mouse.move(source.x+2,source.y+2); await page.mouse.down(); await page.mouse.move(source.x+30,source.y+30);
      await placed().first().evaluate((node) => node.dispatchEvent(new PointerEvent("pointercancel", {bubbles:true,pointerId:1}))); await page.mouse.up();
      assert.deepEqual(await page.evaluate(() => corrections.responses), beforeInvalid);
      await drag(placed().first(), bank); await expect(word(1)).toBeVisible(); await expect.poll(async()=>(await geometry()).bankHeight).toBeGreaterThan(24); records.push(await geometry()); await page.screenshot({path:`${output}/adaptive-returned-${layout}-${images}-${width}.png`});
      for (let n=2;n<=12;n++) await placed().first().click();
      await expect.poll(async () => (await geometry()).bankHeight).toBe(240); records.push(await geometry());
      assert.deepEqual(await page.locator("[data-drag-drop-word-id]").evaluateAll((nodes)=>nodes.map((node)=>node.dataset.dragDropWordId)),Array.from({length:12},(_,i)=>dndId("word",i+1)));
      await word(1).click(); await target.click({position:{x:3,y:3}}); await placed().first().focus(); await page.keyboard.press("Delete"); await expect(word(1)).toBeVisible();
      await page.evaluate(()=>corrections.setReadOnly(true)); await expect(word(1)).toBeDisabled(); await target.click({force:true}); assert.deepEqual(await page.evaluate(()=>corrections.responses),{});
      await page.evaluate(()=>corrections.setReadOnly(false)); await send("reset-activity"); await expect(word(12)).toBeVisible();
      await page.screenshot({path:`${output}/adaptive-bank-${layout}-${images}-${width}.png`}); evidence.push({kind:"adaptive-bank",width,layout,images,records});
    }
    // Width, loaded fonts, Teacher transforms and scroll position are independent of placement.
    await configure({kind:"dnd",path:"student",layout:"text",images:true,scale:.65});
    await expect(word(12)).toBeVisible(); const scaledFull=await geometry();
    await drag(word(1),page.locator("[data-drag-drop-target-id]").first());await expect(word(1)).toHaveCount(0);
    const scaledPlaced=await geometry();assert.equal(scaledPlaced.image.width,scaledFull.image.width);assert.equal(scaledPlaced.target.width,scaledFull.target.width);
    await page.locator(".native-drag-drop-workspace").evaluate((node)=>{node.scrollTop=50;});
    await page.evaluate(()=>corrections.setResponses({["target-"+"1".padStart(32,"0")]:corrections.pair.publicDocument.parts[0].interaction.words.map((word)=>word.id)}));
    await expect.poll(async()=>(await geometry()).bankHeight).toBe(24);assert.equal((await geometry()).scrollTop,50);
    await send("reset-activity");await expect(word(12)).toBeVisible();
    const font=Buffer.from((await readFile("tests/fixtures/fonts/Ahem.ttf.base64","utf8")).trim(),"base64");
    await page.route("**/late-bank-font",route=>route.fulfill({contentType:"font/ttf",body:font}));
    const beforeFont=await geometry();
    await page.evaluate(async()=>{const font=new FontFace("LateBank", "url(/late-bank-font)");await font.load();document.fonts.add(font);document.querySelectorAll(".native-drag-drop-word").forEach((node)=>node.style.fontFamily="LateBank");document.fonts.dispatchEvent(new Event("loadingdone"));});
    await expect.poll(async()=>(await geometry()).bankHeight).toBe(240);assert.equal((await geometry()).image.width,beforeFont.image.width);
    await configure({kind:"dnd",path:"teacher",layout:"text",images:false,scale:.65});
    await expect(word(12)).toBeVisible();await send("show-next");await expect.poll(async()=>(await geometry()).bankHeight).toBe(24);
    await send("reset-activity");await expect.poll(async()=>(await geometry()).bankHeight).toBe(240);
    await page.evaluate(()=>corrections.setPair((pair)=>{const next=structuredClone(pair);next.publicDocument.parts[0].interaction.panels[0].surface.height=350;next.publicDocument.parts[0].interaction.panels[0].images[0].area.height=350;return next;}));
    const shortCanvas=await geometry();assert.ok(Math.abs(shortCanvas.stage.height-shortCanvas.stage.width*350/1024)<1);
    await send("show-all");await expect.poll(async()=>(await geometry()).bankHeight).toBe(24);assert.deepEqual((await geometry()).stage,shortCanvas.stage);
    evidence.push({kind:"scaled-scroll-font-teacher",scaledFull,scaledPlaced,shortCanvas});
    for (const path of ["student","teacher","draft-student","draft-teacher","published-student","published-teacher"]) for (const audio of [false,true]) {
      await page.setViewportSize({width:1440,height:1000}); await configure({kind:"multi",path,audio,scale:1});
      await expect(page.getByRole("button",{name:"Excerpt 1",exact:true})).toBeVisible();
      assert.equal(await page.locator(".native-multi-part-panel--canvas .native-audio-text-hotspot").count(),1);
      await page.getByRole("button",{name:"Excerpt 1",exact:true}).click(); await expect(page.locator(".native-audio-text-focus")).toBeVisible();
      await expect(page.locator(".native-audio-text-focus audio")).toHaveCount(audio?1:0);
      assert.deepEqual(await page.evaluate(()=>corrections.responses),{});
      await page.keyboard.press("Escape"); await expect(page.locator(".native-audio-text-focus")).toHaveCount(0);
      await send("next-panel"); await expect(page.locator('[data-section-id="'+dndId("section",20)+'"]')).toBeVisible();
      for (const n of [20,21]) {
        const section = page.locator(`[data-section-id="${dndId("section",n)}"]`); const cue = section.locator(".native-audio-text-hotspot");
        await cue.scrollIntoViewIfNeeded(); await cue.click(); await expect(cue).toHaveAttribute("aria-pressed","true");
        await expect(page.locator(".native-audio-text-hotspot[aria-pressed=true]")).toHaveCount(1);
        await page.keyboard.press("Escape"); await expect(page.locator(".native-audio-text-focus")).toHaveCount(0);
      }
      await send("previous-panel"); await expect(page.getByRole("button",{name:"Excerpt 1",exact:true})).toBeVisible();
      if(path.includes("teacher")) { await send("show-all"); await expect.poll(()=>page.evaluate(()=>corrections.state?.reveal?.revealed || 0)).toBeGreaterThan(0); const before=await page.evaluate(()=>corrections.state?.reveal?.revealed); assert.ok(before>0); await page.getByRole("button",{name:"Excerpt 1",exact:true}).click(); await page.keyboard.press("Escape"); assert.equal(await page.evaluate(()=>corrections.state?.reveal?.revealed),before); }
      await page.screenshot({path:`${output}/multi-readable-${path}-${audio}.png`}); evidence.push({kind:"multi-readable",path,audio});
    }
    await configure({kind:"multi",path:"editor",audio:true});
    await expect(page.getByRole("button",{name:"Add readable-text hotspot",exact:true})).toBeVisible();
    const select=page.getByLabel("Activity panel",{exact:true}); await expect(select.locator("option")).toHaveCount(6);
    await select.selectOption({index:5}); const canvas=page.getByRole("button",{name:"Place readable-text hotspot on activity",exact:true});
    await canvas.click({position:{x:60,y:70}}); assert.equal(await page.evaluate(()=>corrections.incomplete),false);
    const doc=await page.evaluate(()=>corrections.pair.publicDocument); assert.ok(doc.audioTextHotspots.hotspots[0].panelId.includes(dndId("section",21)));
    await page.screenshot({path:`${output}/multi-readable-authoring.png`});
    await runMultiPartReadableAuthoring(page,server.resolvedUrls.local[0],output,images.shared);
    await configure({kind:"worksheet",path:"student",images:false,scale:1});
    await page.evaluate(()=>corrections.setPair((pair)=>{ const next=structuredClone(pair); next.publicDocument.assets.push(...["video","worksheet"].map((slot,i)=>({slot,assetId:`30000000-0000-4000-8000-00000000000${i+1}`,checksumSha256:"a".repeat(64),role:"activity_artwork"}))); next.publicDocument.video={kind:"managed-mp4",assetSlot:"video",fileName:"clip.mp4",byteSize:100,durationMs:1000,cues:[],worksheet:{assetSlot:"worksheet",fileName:"worksheet.pdf",byteSize:100}}; return next; }));
    const videoButton=page.getByRole("button",{name:"Open Video",exact:true}); const worksheetButton=page.getByRole("button",{name:"Open Video Worksheet",exact:true});
    await expect(worksheetButton).toBeVisible(); await expect(page.locator(".native-video-worksheet-action")).toHaveCount(0);
    const artwork=await Promise.all([videoButton.locator("img").getAttribute("src"),worksheetButton.locator("img").getAttribute("src")]); assert.notEqual(...artwork);
    await worksheetButton.focus(); const download=page.waitForEvent("download"); await page.keyboard.press("Enter"); const downloaded=await download; assert.equal(downloaded.suggestedFilename(),"worksheet.pdf"); assert.deepEqual(await readFile(await downloaded.path()),pdf); assert.equal(await page.evaluate(()=>corrections.state.view),"questions");
    await videoButton.click(); await expect.poll(()=>page.evaluate(()=>corrections.state.view)).toBe("video");
    await videoButton.click(); await expect.poll(()=>page.evaluate(()=>corrections.state.view)).toBe("questions");
    await page.screenshot({path:`${output}/video-worksheet-real-navigation.png`});
    await page.evaluate(()=>corrections.setCustom(true)); await expect(worksheetButton.locator("img")).toHaveAttribute("src","/correction-assets/custom-worksheet"); assert.equal(await videoButton.locator("img").getAttribute("src"),artwork[0]);
    await page.evaluate(()=>corrections.setPair((pair)=>{ const next=structuredClone(pair); next.publicDocument.assets.push({ ...next.publicDocument.assets.find((asset)=>asset.slot==="worksheet"), slot:"worksheet-replaced",assetId:"30000000-0000-4000-8000-000000000003" }); next.publicDocument.video.worksheet={assetSlot:"worksheet-replaced",fileName:"replaced.pdf",byteSize:100}; return next; }));
    const replacement=page.waitForEvent("download"); await worksheetButton.click(); assert.equal((await replacement).suggestedFilename(),"replaced.pdf");
    await page.evaluate(()=>corrections.setPair((pair)=>{ const next=structuredClone(pair); delete next.publicDocument.video.worksheet; return next; })); await expect(worksheetButton).toHaveCount(0);
    assert.deepEqual(errors,[]); await writeFile(`${output}/runtime-corrections-geometry.json`,JSON.stringify(evidence,null,2));
    console.log("Runtime corrections browser matrix passed.");
  } catch(error) { await page.screenshot({path:`${output}/runtime-corrections-failure.png`,fullPage:true}); await writeFile(`${output}/runtime-corrections-failure.txt`,await page.locator("body").innerText()); throw error; }
  finally { await context.close(); await server.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { const browser=await chromium.launch({headless:true}); try { await runRuntimeCorrectionsRegressions(browser,process.env.NATIVE_REGRESSION_OUTPUT || "test-results/native-runtime-regressions"); } finally { await browser.close(); } }
