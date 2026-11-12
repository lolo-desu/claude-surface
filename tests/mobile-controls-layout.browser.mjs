/** Adwaita full composer with optional controls and landscape sheet close targets.
 * Uses an isolated local SillyTavern. PWA/iOS CSS and 44px side safe areas are
 * deterministic simulations, not physical iOS evidence. Standard CU_* browser,
 * source, URL and output controls apply; settings writes/generation are blocked.
 */
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {chromium,webkit}=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
import fs from 'node:fs/promises';
import path from 'node:path';
const source=path.resolve(process.env.CU_SOURCE||path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
const output=process.env.CU_TEST_OUTPUT||path.join(source,'artifacts/mobile-controls-layout');
const engine=process.env.CU_ENGINE||'chromium';
await fs.mkdir(output,{recursive:true});
const executablePath=process.env[engine==='webkit'?'CU_WEBKIT_EXECUTABLE':'CU_CHROMIUM_EXECUTABLE'];
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(executablePath?{executablePath}:{})});
const results={engine,source,errors:[]};
async function create({width=393,height=852,design='claude',compact=false,safe=0,pwa=false}={}) {
 const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,locale:'zh-CN'});
 await context.addInitScript(({pwa})=>{localStorage.setItem('language','zh-cn');if(pwa){const orig=window.matchMedia.bind(window);window.matchMedia=q=>{const m=orig(q);if(q==='(display-mode: standalone)')Object.defineProperty(m,'matches',{value:true});return m;};}},{pwa});
 const css=text=>pwa?text.replaceAll('@supports (-webkit-touch-callout: none)','@supports (display: flex)').replaceAll('env(safe-area-inset-left)',`${safe}px`).replaceAll('env(safe-area-inset-right)',`${safe}px`).replaceAll('env(safe-area-inset-bottom)','34px'):text;
 if(pwa)await context.route('**/css/mobile-styles.css*',async r=>{const res=await r.fetch();await r.fulfill({response:res,body:css(await res.text())});});
 await context.route('**/api/settings/get',async r=>{const res=await r.fetch(),d=await res.json(),s=JSON.parse(d.settings);s.firstRun=false;s.main_api='openai';s.extension_settings.claude_surface={enabled:true,mode:'dark',design,compactComposer:compact};s.extension_settings.disabledExtensions=['third-party/ST-BaiBai-Book','third-party/ST-BaiBai-Tools'];d.settings=JSON.stringify(s);await r.fulfill({response:res,json:d});});
 await context.route(/\/api\/(settings|themes|chats|groups)\/(save|edit|delete)(\?|$)/,r=>r.fulfill({json:{result:'ok'}}));
 await context.route(/\/api\/extensions\/(install|update|delete|switch|move)(\?|$)/,r=>r.abort());
 await context.route(/\/api\/.*(?:generate|completion)/,r=>r.fulfill({status:503,body:'Viewport test: generation disabled'}));
 await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
 await context.route('**/scripts/extensions/third-party/claude-surface/**',async r=>{const rel=decodeURIComponent(new URL(r.request().url()).pathname.split('/claude-surface/')[1]);const file=path.resolve(source,rel);if(!file.startsWith(source+'/'))return r.abort();try{await r.fulfill({body:rel.endsWith('.css')?css(await fs.readFile(file,'utf8')):await fs.readFile(file),contentType:rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':'application/json'});}catch{await r.abort();}});
 const page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>results.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&m.text().includes('ResizeObserver'))results.errors.push(m.text())});await page.goto(process.env.CU_TEST_URL||'http://127.0.0.1:8010',{waitUntil:'networkidle'});await page.locator('body[data-claude-ui].cu-shell-ready').waitFor({state:'attached'});await page.locator('.splash-screen').waitFor({state:'hidden'});
 return {page,context};
}

const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
let current;results.composer=[];results.notch=[];
try{
 for(const width of [320,393]){
  current=await create({width,design:'adwaita'});const {page,context}=current;
  // Quick Persona's public geometry contract; no extension code executes.
  await page.addStyleTag({content:'#quickPersona{position:relative;width:var(--bottomFormBlockSize);height:var(--bottomFormBlockSize);order:10}#quickPersonaImg{width:100%;height:100%;object-fit:cover;border-radius:50%}#quickPersonaCaret{position:absolute;top:0;right:0;width:calc(var(--bottomFormBlockSize)/3);height:calc(var(--bottomFormBlockSize)/3);font-size:calc(var(--bottomFormBlockSize)/3)}'});
  await page.evaluate(()=>{document.getElementById('leftSendForm').insertAdjacentHTML('beforeend','<div id="quickPersona" class="interactable" tabindex="0"><img id="quickPersonaImg" src="/img/ai4.png"><div id="quickPersonaCaret" class="fa-fw fa-solid fa-caret-up"></div></div>');SillyTavern.getContext().activateSendButtons();});
  for(const optional of [[],['mes_continue'],['mes_continue','mes_impersonate']]){
   await page.evaluate(optional=>{for(const id of ['send_but','mes_continue','mes_impersonate']){const e=document.getElementById(id);e.classList.remove('displayNone');e.style.setProperty('display',id==='send_but'||optional.includes(id)?'flex':'none','important');}},optional);await settle(page);
   const text='一二三四五六七八九十一二三四五六七八';assert.equal(text.length,18);await page.locator('#send_textarea').fill(text);await settle(page);
   const item=await page.evaluate(()=>({width:innerWidth,compact:document.body.classList.contains('cu-compact-composer'),textarea:document.getElementById('send_textarea').getBoundingClientRect().toJSON(),composer:document.getElementById('send_form').getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth}));results.composer.push({optional,...item});assert.equal(item.compact,false,'Adwaita full fixture accidentally enabled compact mode');assert(item.textarea.width>=120,'Optional controls leave unreadable Adwaita textarea');assert(item.composer.height<=150,'Adwaita composer became excessively tall');assert.equal(item.overflow,width);
  }
  await context.close();current=null;
 }
 current=await create({width:844,height:390,pwa:true,safe:44});const {page,context}=current;
 for(const design of ['claude','material','adwaita','swiss']){
  await page.locator('.cu-header button[aria-label="更多"]').click();await page.locator('.cu-sheet button[aria-label="主题设置"]').click();await page.locator(`[data-cu-design-choice="${design}"]`).click();await page.locator('.cu-palette-add').click();await page.locator('.cu-custom-toolbar button[aria-label="新建配色"]').click();await page.locator('.cu-custom-editor').waitFor();await page.locator('.cu-sheet-panel').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
  const item=await page.locator('.cu-sheet-heading button').evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{rect:r.toJSON(),hit:hit?.closest('button')===e,panel:e.closest('.cu-sheet-panel').getBoundingClientRect().toJSON()};});results.notch.push({design,...item});assert(item.rect.left>=44&&item.rect.right<=800,'Nested sheet close target is under a landscape cutout');assert(item.rect.width>=44&&item.hit,'Nested sheet close target is not fully reachable');assert(item.panel.left>=44&&item.panel.right<=800);await page.locator('.cu-sheet-heading button').click();await page.locator('.cu-sheet').waitFor({state:'hidden'});
 }
 await context.close();current=null;assert.deepEqual(results.errors,[]);console.log(JSON.stringify({engine,composer:results.composer.length,notch:results.notch.length,output}));
}catch(error){results.failure=String(error);if(current)await current.page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}finally{await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(results,null,2));await browser.close();}
