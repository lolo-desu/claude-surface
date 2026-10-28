/** Real local PromptManager regression. Playwright env matches controls.browser.mjs.
 * Server setting/preset writes and all generation requests are blocked. Prompt
 * save/cancel tests use only temporary in-memory edits, then restore originals. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium,webkit}=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=await fs.access(path.join(repo,'extension/style.css')).then(()=>path.join(repo,'extension')).catch(()=>repo);
const output=path.resolve(process.env.CU_TEST_OUTPUT||path.join(repo,'artifacts/prompt-editor-0103'));
await fs.mkdir(output,{recursive:true});
const origin=process.env.CU_TEST_URL||'http://127.0.0.1:8010';
const report={cases:[],browsers:{},writesIntercepted:true};
const popupId='#completion_prompt_manager_popup';
const fieldId='#completion_prompt_manager_popup_entry_form_prompt';
async function appearance(page){
 await page.locator('.cu-header button[aria-label="更多"]').click();
 await page.locator('.cu-sheet').getByRole('button',{name:'主题设置',exact:true}).click();
}
async function presets(page){
 if(await page.locator('#left-nav-panel').isVisible())return;
 await page.locator('.cu-header button[aria-label="更多"]').click();
 await page.locator('.cu-tool-grid').getByRole('button',{name:'预设',exact:true}).click();
}
async function edit(page,id='main'){
 await presets(page);
 await page.locator(`#completion_prompt_manager_list [data-pm-identifier="${id}"] .prompt-manager-edit-action`).click();
 await page.locator(popupId).waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelector('#completion_prompt_manager_popup').getBoundingClientRect().height>150);
}
async function close(page){
 await page.locator('#completion_prompt_manager_popup_entry_form_close').click();
 await page.locator(popupId).waitFor({state:'hidden'});
}
async function dimensions(page){
 return page.locator(popupId).evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height,width:r.width,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight,viewportWidth:innerWidth,viewportHeight:innerHeight,x:scrollX,y:scrollY};});
}
function fits(d,label,mobile){
 assert(d.height>150,`${label}: collapsed editor ${JSON.stringify(d)}`);
 assert(d.left>=-1 && d.right<=d.viewportWidth+1 && d.bottom<=d.viewportHeight+1,`${label}: outside viewport ${JSON.stringify(d)}`);
 assert(d.scrollWidth<=d.clientWidth+1,`${label}: horizontal overflow`);
 if(mobile){assert(Math.abs(d.width-d.viewportWidth)<1);assert(Math.abs(d.bottom-d.viewportHeight)<1);assert.equal(d.x,0);assert.equal(d.y,0);}
}
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 const executablePath=process.env[name==='chromium'?'CU_CHROMIUM_EXECUTABLE':'CU_WEBKIT_EXECUTABLE'];
 const browser=await engine.launch({headless:true,...(executablePath?{executablePath}:{})});report.browsers[name]=browser.version();
 const context=await browser.newContext({viewport:{width:412,height:915},locale:'zh-CN',hasTouch:true});
 try{
  await context.route(/\/api\/(settings|themes|presets)\/save/,r=>r.fulfill({json:{result:'ok'}}));
  await context.route(/\/api\/.*generate/,r=>r.abort('blockedbyclient'));
  await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
  if(!process.env.CU_SERVER_CSS)for(const file of ['style.css','index.js','native-ui.js','world-info-ui.js']){
   const body=await fs.readFile(path.join(source,file),'utf8');
   await context.route(`**/scripts/extensions/third-party/claude-surface/${file}*`,r=>r.fulfill({contentType:file.endsWith('.css')?'text/css':'text/javascript',body}));
  }
  await context.addInitScript(()=>{
   const native=visualViewport, adapter=new EventTarget();let mock=null;
   for(const key of ['width','height','offsetTop','offsetLeft','scale'])Object.defineProperty(adapter,key,{get:()=>mock?.[key]??native[key]});
   for(const type of ['resize','scroll'])native.addEventListener(type,()=>adapter.dispatchEvent(new Event(type)));
   Object.defineProperty(window,'visualViewport',{value:adapter});window.__cuTestViewport=value=>{mock=value;adapter.dispatchEvent(new Event('resize'));};
  });
  const page=await context.newPage();page.setDefaultTimeout(6000);page.setDefaultNavigationTimeout(30000);await page.goto(origin,{waitUntil:'networkidle'});
  for(const family of ['claude','material','adwaita','swiss'])for(const mode of ['dark','light']){
   await appearance(page);await page.locator(`[data-cu-design-choice="${family}"]`).click();await page.locator(`[data-cu-mode="${mode}"]`).click();
   await page.locator('.cu-sheet-panel').focus();await page.keyboard.press('Escape');await page.locator('.cu-sheet').waitFor({state:'hidden'});
   for(const viewport of [{width:320,height:740},{width:412,height:915},{width:844,height:390},{width:1440,height:1000}]){
    await page.setViewportSize(viewport);await edit(page);
    const label=`${name}-${family}-${mode}-${viewport.width}`, mobile=viewport.width<900;
    const before=await dimensions(page);fits(before,label,mobile);
    const field=page.locator(fieldId),original=await field.inputValue();
    await field.fill(original+'\n[Surface regression temporary edit]');
    assert(await field.evaluate(el=>document.activeElement===el));
    if(mobile)assert(parseFloat(await field.evaluate(el=>getComputedStyle(el).fontSize))>=16);
    await close(page);await edit(page);assert.equal(await field.inputValue(),original,'Cancel changed the prompt');
    const next=original+'\n[Surface regression saved only in browser memory]';
    await field.fill(next);await page.locator('#completion_prompt_manager_popup_entry_form_save').click();
    await page.locator(popupId).waitFor({state:'hidden'});await edit(page);assert.equal(await field.inputValue(),next,'Native save did not apply');
    await field.fill(original);await page.locator('#completion_prompt_manager_popup_entry_form_save').click();await page.locator(popupId).waitFor({state:'hidden'});
    await edit(page);
    if(viewport.width===412){
     await page.evaluate(()=>__cuTestViewport({width:412,height:440,offsetTop:0,offsetLeft:0,scale:1}));
     await page.waitForFunction(()=>Math.abs(document.querySelector('#completion_prompt_manager_popup').getBoundingClientRect().bottom-440)<1);
     await page.evaluate(()=>__cuTestViewport(null));
     await page.waitForFunction(()=>Math.abs(document.querySelector('#completion_prompt_manager_popup').getBoundingClientRect().bottom-innerHeight)<1);
    }
    await field.focus();await page.keyboard.press('Escape');await page.locator(popupId).waitFor({state:'hidden'});
    await edit(page);
    // Outside-press closing used to leave a stale closedDrawer class. Reopen
    // through the real pencil action and ensure it is usable again.
    await page.locator('.cu-header').click({position:{x:2,y:2}});await page.locator(popupId).waitFor({state:'hidden'});
    await edit(page);assert(!await page.locator(popupId).evaluate(el=>el.classList.contains('closedDrawer')));
    if(viewport.width===412 && mode==='dark')await page.screenshot({path:path.join(output,label+'.png')});
    await page.locator('.cu-header button[aria-label="关闭原生面板"]').click();await page.locator(popupId).waitFor({state:'hidden'});
    await page.waitForFunction(()=>!document.body.style.getPropertyValue('--cu-prompt-view-height'));
    report.cases.push({label,before,cancel:true,save:true,escape:true,reopen:true,headerClose:true});console.log('PASS '+label);
   }
  }
  await context.close();
 }catch(error){
  report.error=String(error);const page=context.pages().at(-1);if(page)await page.screenshot({path:path.join(output,`${name}-failure.png`)}).catch(()=>{});throw error;
 }finally{await browser.close();await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(report,null,2));}
}
console.log(JSON.stringify({passed:report.cases.length,browsers:report.browsers,output}));
