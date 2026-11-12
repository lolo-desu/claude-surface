/** Mobile overlay viewport lifecycle against an isolated local SillyTavern.
 * VisualViewport values, the iOS CSS branch, PWA mode, and 34px safe area are
 * deterministic simulations; these checks do not claim physical iOS coverage.
 * Uses CU_SOURCE, CU_TEST_URL, CU_TEST_OUTPUT, CU_PLAYWRIGHT_MODULE, CU_ENGINE,
 * CU_CHROMIUM_EXECUTABLE and CU_WEBKIT_EXECUTABLE. Writes/generation are blocked.
 */
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {chromium,webkit}=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
import fs from 'node:fs/promises';
import path from 'node:path';
const source=path.resolve(process.env.CU_SOURCE||path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
const output=process.env.CU_TEST_OUTPUT||path.join(source,'artifacts/viewport-lifecycle');
const engine=process.env.CU_ENGINE||'chromium';
await fs.mkdir(output,{recursive:true});
const executablePath=process.env[engine==='webkit'?'CU_WEBKIT_EXECUTABLE':'CU_CHROMIUM_EXECUTABLE'];
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(executablePath?{executablePath}:{})});
const results={engine,source,errors:[]};
async function create({mobile=true,pwa=true}={}) {
 const context=await browser.newContext({viewport:mobile?{width:393,height:852}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile,locale:'zh-CN'});
 await context.addInitScript(({pwa})=>{localStorage.setItem('language','zh-cn');if(pwa){const orig=window.matchMedia.bind(window);window.matchMedia=q=>{const m=orig(q);if(q==='(display-mode: standalone)')Object.defineProperty(m,'matches',{value:true});return m;};}},{pwa});
 const css=text=>pwa?text.replaceAll('@supports (-webkit-touch-callout: none)','@supports (display: flex)').replaceAll('env(safe-area-inset-left)','0px').replaceAll('env(safe-area-inset-right)','0px').replaceAll('env(safe-area-inset-bottom)','34px'):text;
 if(pwa)await context.route('**/css/mobile-styles.css*',async r=>{const res=await r.fetch();await r.fulfill({response:res,body:css(await res.text())});});
 await context.route('**/api/settings/get',async r=>{const res=await r.fetch(),d=await res.json(),s=JSON.parse(d.settings);s.firstRun=false;s.main_api='openai';s.extension_settings.claude_surface={enabled:true,mode:'dark',compactComposer:true};s.extension_settings.disabledExtensions=['third-party/ST-BaiBai-Book','third-party/ST-BaiBai-Tools'];d.settings=JSON.stringify(s);await r.fulfill({response:res,json:d});});
 await context.route(/\/api\/(settings|themes|chats|groups)\/(save|edit|delete)(\?|$)/,r=>r.fulfill({json:{result:'ok'}}));
 await context.route(/\/api\/extensions\/(install|update|delete|switch|move)(\?|$)/,r=>r.abort());
 await context.route(/\/api\/.*(?:generate|completion)/,r=>r.fulfill({status:503,body:'Viewport test: generation disabled'}));
 await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
 await context.route('**/scripts/extensions/third-party/claude-surface/**',async r=>{const rel=decodeURIComponent(new URL(r.request().url()).pathname.split('/claude-surface/')[1]);const file=path.resolve(source,rel);if(!file.startsWith(source+'/'))return r.abort();try{await r.fulfill({body:rel.endsWith('.css')?css(await fs.readFile(file,'utf8')):await fs.readFile(file),contentType:rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':'application/json'});}catch{await r.abort();}});
 const page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>results.errors.push(String(e)));await page.goto(process.env.CU_TEST_URL||'http://127.0.0.1:8010',{waitUntil:'networkidle'});await page.locator('body[data-claude-ui].cu-shell-ready').waitFor({state:'attached'});await page.locator('.splash-screen').waitFor({state:'hidden'});
 await page.evaluate(()=>{const c=SillyTavern.getContext(),seed=c.characters[0],rows=Array.from({length:60},(_,i)=>({...seed,name:'Dummy '+i,avatar:'dummy_'+i+'.png'}));c.characters.push(...rows);c.extensionSettings.claude_surface.recentCharacters=rows.map(x=>x.avatar);c.eventSource.emit(c.eventTypes.SETTINGS_UPDATED);});
 await page.waitForFunction(()=>document.querySelectorAll('.cu-recents .cu-character-row').length>=60);
 return {page,context};
}
async function settle(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function viewport(page,height,top=0,scale=1){await page.evaluate(({height,top,scale})=>{for(const[k,v]of Object.entries({height,offsetTop:top,scale}))Object.defineProperty(visualViewport,k,{configurable:true,get:()=>v});visualViewport.dispatchEvent(new Event('resize'));visualViewport.dispatchEvent(new Event('scroll'));},{height,top,scale});await settle(page);}
async function geometry(page){await page.locator('.cu-recents').evaluate(e=>{e.scrollTop=e.scrollHeight;e.closest('.cu-sidebar').scrollTop=1e9;});await settle(page);return page.evaluate(()=>{const s=document.querySelector('.cu-sidebar'),l=document.querySelector('.cu-recents');return{sidebar:s.getBoundingClientRect().toJSON(),last:l.lastElementChild.getBoundingClientRect().toJSON(),footer:document.querySelector('.cu-sidebar-footer').getBoundingClientRect().toJSON(),paddingBottom:getComputedStyle(s).paddingBottom,heightVar:document.body.style.getPropertyValue('--cu-sidebar-height'),topVar:document.body.style.getPropertyValue('--cu-sidebar-top'),classes:document.body.className,active:document.activeElement.className,inset:document.body.style.getPropertyValue('--cu-bottom-inset'),visibleBottom:visualViewport.height+visualViewport.offsetTop};});}

let mobile;
try {
 mobile=await create();const page=mobile.page;
 await page.locator('#cu-sidebar-toggle').click();await page.locator('.cu-search').click();await page.locator('.cu-search').fill('Dummy');
 results.safeArea=[];
 for(const design of ['claude','material','adwaita','swiss']){
  await page.evaluate(d=>document.body.dataset.cuDesign=d,design);const item=await geometry(page);results.safeArea.push({design,...item});
  assert(item.footer.bottom<=818,`${design}: sidebar footer overlaps simulated home indicator`);assert.equal(item.paddingBottom,'34px');
 }
 await page.evaluate(()=>document.body.dataset.cuDesign='claude');await viewport(page,552);results.keyboard=await geometry(page);
 assert.equal(results.keyboard.active,'cu-search');assert(results.keyboard.last.bottom<=552,'Search last row is obscured at maximum scroll');assert.equal(results.keyboard.paddingBottom,'8px');assert.equal(results.keyboard.inset,'0px','Sidebar keyboard unexpectedly moved composer');
 for(const design of ['material','adwaita','swiss']){
  await page.evaluate(d=>document.body.dataset.cuDesign=d,design);const item=await geometry(page);assert.equal(item.paddingBottom,'8px',`${design}: keyboard retains duplicate safe-area padding`);
 }
 await page.evaluate(()=>document.body.dataset.cuDesign='claude');await viewport(page,552,80);results.pan=await geometry(page);assert.equal(results.pan.sidebar.top,80);assert(results.pan.last.bottom<=632);
 await page.setViewportSize({width:844,height:390});await viewport(page,240,12);results.rotation=await geometry(page);
 assert.equal(results.rotation.active,'cu-search','Rotation lost search focus');assert(results.rotation.classes.includes('cu-sidebar-open'),'Rotation closed sidebar');assert(results.rotation.last.bottom<=252);assert.equal(results.rotation.sidebar.top,12);
 await page.locator('.cu-search').evaluate(e=>e.blur());await settle(page);results.afterBlur=await geometry(page);assert.equal(results.afterBlur.heightVar,'');assert.equal(results.afterBlur.topVar,'');assert.equal(results.afterBlur.paddingBottom,'34px');
 await page.setViewportSize({width:393,height:852});await viewport(page,552,0,2);await page.locator('.cu-search').click();await settle(page);results.zoom=await geometry(page);assert.equal(results.zoom.heightVar,'','Pinch zoom was treated as keyboard');
 await page.keyboard.press('Escape');await viewport(page,852);
 await page.locator('.cu-header button[aria-label="更多"]').click();await page.locator('.cu-sheet button[aria-label="主题设置"]').click();await page.locator('.cu-brand-name-input').click();
 const sheetGeometry=()=>page.evaluate(()=>({input:document.querySelector('.cu-brand-name-input')?.getBoundingClientRect().toJSON(),panel:document.querySelector('.cu-sheet-panel')?.getBoundingClientRect().toJSON(),body:document.querySelector('.cu-sheet-body')?.getBoundingClientRect().toJSON(),focused:document.activeElement.className,classes:document.body.className,height:document.body.style.getPropertyValue('--cu-sheet-height'),top:document.body.style.getPropertyValue('--cu-sheet-top'),vvBottom:visualViewport.height+visualViewport.offsetTop}));
 await viewport(page,552);await settle(page);results.sheetKeyboard=await sheetGeometry();assert(results.sheetKeyboard.input.bottom<=552);assert(results.sheetKeyboard.input.top>=results.sheetKeyboard.body.top);
 await page.setViewportSize({width:844,height:390});await viewport(page,240,12);await settle(page);results.sheetRotation=await sheetGeometry();assert(results.sheetRotation.input.bottom<=252);assert(results.sheetRotation.input.top>=results.sheetRotation.body.top);
 await page.locator('.cu-brand-name-input').evaluate(e=>e.blur());await settle(page);results.sheetBlur=await sheetGeometry();assert(!results.sheetBlur.classes.includes('cu-sheet-keyboard'));assert.equal(results.sheetBlur.height,'');assert.equal(results.sheetBlur.top,'');
 await page.setViewportSize({width:393,height:852});await viewport(page,552);await page.locator('.cu-brand-name-input').click();await settle(page);await page.keyboard.press('Escape');await page.locator('.cu-sheet').waitFor({state:'hidden'});await settle(page);results.sheetClosed=await sheetGeometry();assert(!results.sheetClosed.classes.includes('cu-sheet-keyboard'));assert.equal(results.sheetClosed.height,'');assert.equal(results.sheetClosed.top,'');
 await viewport(page,852);await page.locator('#cu-sidebar-toggle').click();await page.locator('.cu-search').click();await viewport(page,552);
 await page.evaluate(()=>{const input=document.getElementById('cu-extension-enabled');input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));});await settle(page);
 results.disabled=await page.evaluate(()=>({enabled:document.body.hasAttribute('data-claude-ui'),height:document.body.style.getPropertyValue('--cu-sidebar-height'),top:document.body.style.getPropertyValue('--cu-sidebar-top'),keyboard:document.body.classList.contains('cu-sidebar-keyboard')}));assert.equal(results.disabled.enabled,false);assert.equal(results.disabled.height,'');assert.equal(results.disabled.top,'');assert.equal(results.disabled.keyboard,false);
 await mobile.context.close();mobile=null;
 const desktop=await create({mobile:false,pwa:false});try{await desktop.page.locator('#cu-sidebar-toggle').click();await desktop.page.locator('.cu-search').click();await desktop.page.locator('.cu-search').fill('Dummy');await settle(desktop.page);results.desktop=await geometry(desktop.page);assert.equal(results.desktop.sidebar.height,900);assert.equal(results.desktop.heightVar,'');assert.equal(results.desktop.topVar,'');}finally{await desktop.context.close();}
 assert.deepEqual(results.errors,[]);
 console.log(JSON.stringify({engine,passed:true,output}));
} catch(error) {results.failure=String(error);if(mobile)await mobile.page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally {await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(results,null,2));await browser.close();}
