/** Native toolbar accessibility ownership across enable/disable and third-party edits.
 * Run against an isolated SillyTavern profile; settings/theme/chat writes and
 * generation are intercepted. Supports CU_SOURCE, CU_TEST_URL, CU_TEST_OUTPUT,
 * CU_PLAYWRIGHT_MODULE, CU_ENGINE, CU_CHROMIUM_EXECUTABLE, CU_WEBKIT_EXECUTABLE.
 */
import {fileURLToPath} from 'node:url';
const {chromium,webkit}=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');import fs from 'node:fs/promises';import path from 'node:path';
const source=path.resolve(process.env.CU_SOURCE||path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));const out=process.env.CU_TEST_OUTPUT||path.join(source,'artifacts/native-ownership');await fs.mkdir(out,{recursive:true});
const engine=process.env.CU_ENGINE||'chromium';const executablePath=process.env[engine==='webkit'?'CU_WEBKIT_EXECUTABLE':'CU_CHROMIUM_EXECUTABLE'];const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(executablePath?{executablePath}:{})});const report={source,engine,cases:[],failures:[]};
const expectedNative={label:'Native Disabled Label',tabindex:'5',role:'link',iconHidden:'false',iconIndex:'3'};
const expectedThirdParty={...expectedNative,label:'Third party while enabled',tabindex:'9',iconHidden:'false'};
async function fixture(width){const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<900,isMobile:width<900,locale:'en-US'});await context.addInitScript(()=>localStorage.setItem('language','en'));
 await context.route('**/api/settings/get',async r=>{const res=await r.fetch(),d=await res.json(),s=JSON.parse(d.settings);s.firstRun=false;s.main_api='openai';s.extension_settings.claude_surface={enabled:true,mode:'dark'};s.extension_settings.disabledExtensions=['third-party/ST-BaiBai-Book','third-party/ST-BaiBai-Tools'];d.settings=JSON.stringify(s);await r.fulfill({response:res,json:d});});
 await context.route(/\/api\/(settings|themes|chats|groups)\/(save|edit|delete|generate)(\?|$)/,r=>r.fulfill({json:{result:'ok'}}));await context.route(/\/api\/extensions\/(install|update|delete|switch|move)(\?|$)/,r=>r.abort());await context.route(/\/api\/.*(?:generate|completion)/,r=>r.fulfill({status:503,body:'UI test: generation disabled'}));await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
 await context.route('**/scripts/extensions/third-party/claude-surface/**',async r=>{const rel=decodeURIComponent(new URL(r.request().url()).pathname.split('/claude-surface/')[1]),p=path.resolve(source,rel);if(!p.startsWith(source+path.sep))return r.abort();try{await r.fulfill({body:await fs.readFile(p),contentType:rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':'application/json'});}catch{await r.abort();}});
 const page=await context.newPage();await page.goto(process.env.CU_TEST_URL||'http://127.0.0.1:8010',{waitUntil:'networkidle'});await page.locator('#cu-extension-enabled').waitFor({state:'attached',timeout:60000});return{context,page};}
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const read=page=>page.locator('#persona-management-button .drawer-toggle').evaluate(el=>({label:el.getAttribute('aria-label'),tabindex:el.getAttribute('tabindex'),role:el.getAttribute('role'),iconHidden:el.querySelector('.drawer-icon').getAttribute('aria-hidden'),iconIndex:el.querySelector('.drawer-icon').getAttribute('tabindex')}));
const toggle=(page,enabled)=>page.evaluate(enabled=>{const el=document.getElementById('cu-extension-enabled');el.checked=enabled;el.dispatchEvent(new Event('change',{bubbles:true}));},enabled);
const emit=page=>page.evaluate(async()=>{const c=SillyTavern.getContext();await c.eventSource.emit(c.eventTypes.SETTINGS_UPDATED);});
const change=(page,value)=>page.locator('#persona-management-button .drawer-toggle').evaluate((el,v)=>{el.setAttribute('aria-label',v.label);el.setAttribute('tabindex',v.tabindex);el.setAttribute('role',v.role);el.querySelector('.drawer-icon').setAttribute('aria-hidden',v.iconHidden);el.querySelector('.drawer-icon').setAttribute('tabindex',v.iconIndex);},value);
function check(width,name,actual,expected){const row={width,name,actual,expected,pass:JSON.stringify(actual)===JSON.stringify(expected)};report.cases.push(row);if(!row.pass)report.failures.push(row);}
try{for(const width of [393,1440]){const{context,page}=await fixture(width);try{
 await toggle(page,false);await settle(page);await change(page,expectedNative);await emit(page);await settle(page);check(width,'disabled mutation survives SETTINGS_UPDATED',await read(page),expectedNative);
 await toggle(page,true);await settle(page);const owned=await read(page);if(owned.role!=='button'||owned.tabindex!=='0'||owned.iconHidden!=='true')report.failures.push({width,name:'enable missing native ownership',owned});
 await toggle(page,false);await settle(page);check(width,'next disable restores fresh native snapshot',await read(page),expectedNative);
 // Begin another active ownership cycle then let an external owner change a subset.
 await change(page,expectedNative);await toggle(page,true);await settle(page);await page.locator('#persona-management-button .drawer-toggle').evaluate(el=>{el.setAttribute('aria-label','Third party while enabled');el.setAttribute('tabindex','9');el.querySelector('.drawer-icon').setAttribute('aria-hidden','false');});
 await emit(page);await settle(page);await toggle(page,false);await settle(page);check(width,'external edits while enabled survive release',await read(page),expectedThirdParty);
 await emit(page);await settle(page);check(width,'disabled notifications do not recapture attributes',await read(page),expectedThirdParty);

 // The preset icon title and accessible name must use the same native lifetime.
 const preset=page.locator('#leftNavDrawerIcon');
 await preset.evaluate(el=>{el.title='Native localized preset';el.setAttribute('aria-label','Native localized preset label');});
 await emit(page);await settle(page);
 const readPreset=()=>preset.evaluate(el=>({title:el.title,label:el.getAttribute('aria-label')}));
 check(width,'preset native title survives disabled settings',await readPreset(),{title:'Native localized preset',label:'Native localized preset label'});
 await toggle(page,true);await settle(page);await toggle(page,false);await settle(page);
 check(width,'preset native title restores latest snapshot',await readPreset(),{title:'Native localized preset',label:'Native localized preset label'});
 await toggle(page,true);await settle(page);await preset.evaluate(el=>{el.title='Third party title';el.setAttribute('aria-label','Third party preset label');});
 await emit(page);await settle(page);await toggle(page,false);await settle(page);
 check(width,'preset edits while enabled restore after active refresh',await readPreset(),{title:'Third party title',label:'Third party preset label'});
 }finally{await context.close();}}}finally{await browser.close();await fs.writeFile(out+'/summary.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({engine,cases:report.cases.length,failures:report.failures?.length??report.cases.filter(c=>!c.pass).length,errors:report.errors?.length||0,out}));if(report.failures.length)process.exitCode=1;
