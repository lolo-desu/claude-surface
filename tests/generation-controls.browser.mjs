/** Native stop and script controls across four designs, modes and viewport sizes.
 * Uses synthetic rendering states; never executes scripts or generation. All saves
 * are intercepted. Supports the repository CU_* source/browser/output options.
 */
import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const {chromium,webkit}=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');import fs from'node:fs/promises';import path from'node:path';
const source=path.resolve(process.env.CU_SOURCE||path.join(path.dirname(fileURLToPath(import.meta.url)),'..')),out=process.env.CU_TEST_OUTPUT||path.join(source,'artifacts/generation-controls');await fs.mkdir(out,{recursive:true});
const engine=process.env.CU_ENGINE||'chromium';const browser=await(engine==='webkit'?webkit:chromium).launch({executablePath:process.env[engine==='webkit'?'CU_WEBKIT_EXECUTABLE':'CU_CHROMIUM_EXECUTABLE']||undefined,headless:true});const report={source,engine,cases:[],browser:browser.version()};
try{for(const width of(process.env.CU_QUICK?[393]:[320,393,844,1440])){
 const context=await browser.newContext({viewport:{width,height:width===844?390:852},hasTouch:width<900,isMobile:width<900,locale:'zh-CN'});await context.addInitScript(()=>localStorage.setItem('language','zh-cn'));
 await context.route('**/api/settings/get',async r=>{const res=await r.fetch(),d=await res.json(),s=JSON.parse(d.settings);s.firstRun=false;s.main_api='openai';s.extension_settings.claude_surface={enabled:true,mode:'dark',compactComposer:true};s.extension_settings.disabledExtensions=['third-party/ST-BaiBai-Book','third-party/ST-BaiBai-Tools'];d.settings=JSON.stringify(s);await r.fulfill({response:res,json:d});});
 await context.route(/\/api\/(settings|themes|chats)\/save/,r=>r.fulfill({json:{result:'ok'}}));await context.route(/\/api\/(chat-completions|backends|chats)\/.*generate/,r=>r.abort());await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
 await context.route('**/scripts/extensions/third-party/claude-surface/**',async r=>{const rel=decodeURIComponent(new URL(r.request().url()).pathname.split('/claude-surface/')[1]);try{await r.fulfill({body:await fs.readFile(path.join(source,rel)),contentType:rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':'application/json'});}catch{await r.abort();}});
 const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto(process.env.CU_TEST_URL||'http://127.0.0.1:8010',{waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('.cu-header')&&!document.querySelector('.splash-screen'),null,{timeout:60000});
 await page.evaluate(()=>{const c=SillyTavern.getContext();window.stopEvents=0;c.eventSource.on(c.eventTypes.GENERATION_STOPPED,()=>window.stopEvents++);});
 try{for(const design of['claude','material','adwaita','swiss'])for(const compact of[true,false])for(const mode of['dark','light']){
  await page.waitForFunction(()=>!document.querySelector('.cu-sheet'));await page.locator('.cu-header button[aria-label="更多"]').click();await page.locator('.cu-sheet').getByRole('button',{name:'主题设置',exact:true}).click();await page.locator(`[data-cu-design-choice="${design}"]`).click();await page.locator(`[data-cu-mode="${mode}"]`).click();await page.getByRole('switch',{name:'输入栏紧凑模式',exact:true}).setChecked(compact);await page.locator('.cu-sheet-panel').press('Escape');await page.locator('.cu-sheet').waitFor({state:'hidden'});
  await page.evaluate(()=>{const c=SillyTavern.getContext();document.querySelector('#form_sheld').classList.remove('isExecutingCommandsFromChatInput','script_paused');document.querySelector('#send_but').classList.remove('displayNone');c.activateSendButtons();});
  assert.equal(await page.locator('#mes_stop').isVisible(),false,'Idle stop must stay hidden');assert.equal(await page.locator('#send_but').isVisible(),true);
  await page.evaluate(()=>SillyTavern.getContext().deactivateSendButtons());
  const stop=page.locator('#mes_stop');await stop.waitFor({state:'visible'});assert.equal(await page.locator('#send_but').isVisible(),false);
  const m=await stop.evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect(),before=getComputedStyle(e,'::before'),after=getComputedStyle(e,'::after');const p=[before,after].find(p=>p.content!=='none'&&parseFloat(p.width)>0&&parseFloat(p.height)>0);return{width:r.width,height:r.height,align:s.alignItems,justify:s.justifyContent,background:s.backgroundColor,pseudo:p?{width:parseFloat(p.width),height:parseFloat(p.height),position:p.position,background:p.backgroundColor}:null,iconDisplay:getComputedStyle(e.querySelector('i')).display,role:e.getAttribute('role'),tabindex:e.getAttribute('tabindex')};});
  assert(m.width>=32&&m.height>=32,JSON.stringify(m));assert.equal(m.align,'center');assert.equal(m.justify,'center');assert(m.pseudo&&m.pseudo.width>=12&&m.pseudo.height>=12,JSON.stringify(m));assert(Math.abs(m.pseudo.width-m.pseudo.height)<1);assert.equal(m.iconDisplay,'none');assert.equal(m.role,'button');assert(Number(m.tabindex)>=0);
  const clicks=await page.evaluate(()=>window.stopEvents);for(const [index,action]of ['Enter','Space','pointer'].entries()){await page.evaluate(()=>SillyTavern.getContext().deactivateSendButtons());await stop.waitFor({state:'visible'});await stop.focus();if(action==='pointer')await stop.click();else await page.keyboard.press(action);assert.equal(await page.evaluate(()=>window.stopEvents),clicks+index+1,action+' must invoke native stop once');}
  await page.evaluate(()=>SillyTavern.getContext().activateSendButtons());assert.equal(await stop.isVisible(),false);assert.equal(await page.locator('#send_but').isVisible(),true);
  // Native script visibility is simulated; no commands or generations execute.
  for(const paused of[false,true]){
   await page.evaluate(paused=>{const f=document.querySelector('#form_sheld');f.classList.add('isExecutingCommandsFromChatInput');f.classList.toggle('script_paused',paused);},paused);
   const script=await page.evaluate(()=>['send_but','mes_continue','stscript_pause','stscript_continue','stscript_stop'].map(id=>{const e=document.getElementById(id),s=getComputedStyle(e),i=e.querySelector('i');return{id,display:s.display,visibility:s.visibility,width:e.getBoundingClientRect().width,font:i?parseFloat(getComputedStyle(i).fontSize):null};}));
   for(const id of['send_but','mes_continue'])assert(script.find(x=>x.id===id).width<=1,JSON.stringify(script));for(const id of[paused?'stscript_continue':'stscript_pause','stscript_stop']){const c=script.find(x=>x.id===id);assert(c.width>=32&&c.font>=12,JSON.stringify(script));}
  }
  await page.evaluate(()=>document.querySelector('#form_sheld').classList.remove('isExecutingCommandsFromChatInput','script_paused'));
  assert.equal(await page.locator('#send_but').isVisible(),true);
  const label=`${width}-${design}-${compact?'compact':'full'}-${mode}`;report.cases.push({label,stop:m});console.log('PASS '+label);
  if(width===393&&compact&&mode==='dark'){await page.evaluate(()=>SillyTavern.getContext().deactivateSendButtons());await page.screenshot({path:`${out}/${label}.png`});await page.evaluate(()=>SillyTavern.getContext().activateSendButtons());}
 }
 // Disable restores host attributes and original FontAwesome glyph, not a stranded custom square.
 await page.evaluate(()=>{const toggle=document.getElementById('cu-extension-enabled');toggle.checked=false;toggle.dispatchEvent(new Event('change',{bubbles:true}));SillyTavern.getContext().deactivateSendButtons();});
 const restored=await page.locator('#mes_stop').evaluate(e=>({role:e.getAttribute('role'),tabindex:e.getAttribute('tabindex'),iconDisplay:getComputedStyle(e.querySelector('i')).display,pseudo:getComputedStyle(e,'::before').content}));assert.equal(restored.role,null);assert.equal(restored.tabindex,null);assert.notEqual(restored.iconDisplay,'none');assert.equal(restored.pseudo,'none');assert.deepEqual(errors,[]);
 }catch(e){report.error=String(e);report.pageErrors=errors;await page.screenshot({path:`${out}/${width}-failure.png`});throw e;}finally{await context.close();await fs.writeFile(out+'/summary.json',JSON.stringify(report,null,2));}
}}
finally{await browser.close();}
console.log(JSON.stringify({passed:report.cases.length,out}));
