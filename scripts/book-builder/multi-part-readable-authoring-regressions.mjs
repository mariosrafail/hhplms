import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { multiPartReadablePair } from "../../tests/fixtures/native-runtime-regressions/runtime-corrections-data.js";
import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from "../../src/data/native-activities/nativeActivityRuntimeValidation.js";
import { dndId } from "../../tests/fixtures/native-runtime-regressions/drag-drop-improvements-data.js";

export async function runMultiPartReadableAuthoring(page, baseUrl, output, image) {
  let stored=multiPartReadablePair(true); let revision=1; let saves=0; let uploadSlot; let size={width:1100,height:650};
  await page.route("**/builder/api/**", async (route)=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith("/fonts")) return route.fulfill({json:{fonts:[]}});
    if(url.pathname.endsWith("/preview")) return route.fulfill({contentType:"image/png",body:image});
    if(url.pathname.includes("/native-activity-public/")) return route.fulfill({json:{document:stored.publicDocument,revision}});
    if(url.pathname.includes("/native-activity-teacher/")) return route.fulfill({json:{document:stored.teacherDocument,revision}});
    if(url.pathname.endsWith("/prepare")){uploadSlot=route.request().postDataJSON().assetSlot;return route.fulfill({json:{uploadId:"isolated-upload",authorization:{url:`${baseUrl}correction-upload`,headers:{}}}});}
    if(url.pathname.endsWith("/finalize")) return route.fulfill({json:{reference:{slot:uploadSlot,assetId:"40000000-0000-4000-8000-000000000017",checksumSha256:"e".repeat(64),role:"activity_artwork"},metadata:size}});
    if(url.pathname.endsWith("/save")){
      const input=route.request().postDataJSON();assert.equal(input.expectedPublicRevision,revision);assert.equal(input.expectedTeacherRevision,revision);
      const options={activityId:stored.publicDocument.activityId,kind:"multi-part"};
      const publicDocument=normalizeNativeRuntimePublicDocument(input.publicDocument,options); const teacherDocument=normalizeNativeRuntimeTeacherDocument(input.teacherDocument,{...options,publicDocument});
      stored={publicDocument,teacherDocument};revision++;saves++;return route.fulfill({json:{...stored,publicRevision:revision,teacherRevision:revision}});
    }
    return route.fulfill({status:404,json:{}});
  });
  await page.route("**/correction-upload",route=>route.fulfill({status:200}));
  await page.evaluate(()=>corrections.configure({kind:"multi",path:"builder",audio:true}));
  const editor=page.locator(".native-multi-part-editor"); const save=editor.getByRole("button",{name:"Save Draft",exact:true});
  const saveNext=async()=>{const count=saves;await save.click();await expect.poll(()=>saves).toBe(count+1);};
  await expect(editor.getByRole("tab",{name:"Shared media",exact:true})).toBeVisible();
  await editor.getByRole("tab",{name:"Shared media",exact:true}).click();
  await expect(editor.getByRole("button",{name:"Add readable-text hotspot",exact:true})).toBeVisible();
  await editor.getByRole("tab",{name:"Hotspot 5",exact:true}).click();
  await editor.getByRole("button",{name:"Place readable-text hotspot on activity",exact:true}).click({position:{x:140,y:100}});
  await saveNext(); const hotspots=structuredClone(stored.publicDocument.audioTextHotspots);
  await editor.getByRole("tab",{name:"Compose",exact:true}).click();
  await editor.getByRole("button",{name:"Move panel 1 later",exact:true}).click(); await saveNext(); assert.deepEqual(stored.publicDocument.audioTextHotspots,hotspots);
  await editor.getByRole("button",{name:/Two text choices.*flow/}).click();
  const row=()=>editor.locator(".native-multi-part-authoring-row").filter({has:page.getByRole("button",{name:"Visual section 20",exact:true})});
  await row().getByRole("button",{name:"Move section earlier",exact:true}).click(); await saveNext(); assert.deepEqual(stored.publicDocument.audioTextHotspots,hotspots);
  await row().getByRole("button",{name:"Duplicate section",exact:true}).click(); await saveNext(); assert.equal(stored.publicDocument.parts[0].interaction.sections.length,12);assert.deepEqual(stored.publicDocument.audioTextHotspots,hotspots);
  page.once("dialog",dialog=>dialog.dismiss()); await row().getByRole("button",{name:"Delete section",exact:true}).click();assert.equal(stored.publicDocument.parts[0].interaction.sections.length,12);
  page.once("dialog",dialog=>{assert.match(dialog.message(),/readable-text hotspots/);return dialog.accept();}); await row().getByRole("button",{name:"Delete section",exact:true}).click(); await saveNext();
  assert.equal(stored.publicDocument.audioTextHotspots.hotspots.length,5);assert.ok(stored.publicDocument.audioTextHotspots.hotspots.some((hotspot)=>hotspot.panelId.includes(dndId("section",21))));
  await editor.getByRole("button",{name:/Shared exercises.*canvas/}).click(); const retained=structuredClone(stored.publicDocument.audioTextHotspots);
  await editor.getByLabel("Shared background",{exact:true}).setInputFiles({name:"replacement.png",mimeType:"image/png",buffer:image});
  await expect(editor.getByText(/Shared background uploaded/)).toBeVisible();await saveNext();assert.deepEqual(stored.publicDocument.audioTextHotspots,retained);
  const panel=stored.publicDocument.parts[0].interaction.panels.find((panel)=>panel.layout==="canvas");assert.deepEqual(panel.surface,size);
  await page.evaluate(()=>corrections.configure({kind:"multi",path:"builder",audio:true}));
  await editor.getByRole("tab",{name:"Shared media",exact:true}).click();await expect(editor.getByRole("tab",{name:/^Hotspot /})).toHaveCount(5);
  await editor.getByRole("tab",{name:"Preview whole activity",exact:true}).click();await expect(editor.locator(".native-audio-text-hotspot:visible")).toHaveCount(4);
  await page.screenshot({path:`${output}/multi-readable-builder-roundtrip.png`});
  await page.unroute("**/builder/api/**");await page.unroute("**/correction-upload");
}
