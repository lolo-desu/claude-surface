/** Composer safe-area geometry. Chromium deterministically activates the host's
 * existing iOS CSS branch and substitutes safe-area values; this is a simulation,
 * not an iPhone/PWA runtime. CU_ENGINE=webkit can use a provisioned WebKit engine.
 * CU_BASELINE_CSS optionally compares an older Surface stylesheet.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium,webkit}=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const engineName=process.env.CU_ENGINE||'chromium';
const output=process.env.CU_TEST_OUTPUT||path.join(source,'artifacts/ios-composer');await fs.mkdir(output,{recursive:true});
const candidate=await fs.readFile(path.join(source,'style.css'),'utf8');
const baseline=process.env.CU_BASELINE_CSS?await fs.readFile(process.env.CU_BASELINE_CSS,'utf8'):candidate;
const scenarios=[
 {name:'ios-home-portrait',width:393,height:852,ios:true,pwa:true,safe:34,gain:34},
 {name:'ios-browser-portrait',width:393,height:852,ios:true,pwa:false,safe:34,gain:0},
 {name:'ios-home-landscape',width:844,height:390,ios:true,pwa:true,safe:21,gain:0},
 {name:'ios-home-no-inset',width:375,height:667,ios:true,pwa:true,safe:0,gain:15},
 {name:'android-home',width:393,height:852,ios:false,pwa:true,safe:0,gain:0},
 {name:'desktop',width:1440,height:950,ios:false,pwa:false,safe:0,gain:0},
];
const browser=await (engineName==='webkit'?webkit:chromium).launch({headless:true,executablePath:process.env[engineName==='webkit'?'CU_WEBKIT_EXECUTABLE':'CU_CHROMIUM_EXECUTABLE']||undefined});
const report={engine:engineName,simulation:engineName==='chromium',cases:[]};
function cssFor(text,sc){return text.replaceAll('@supports (-webkit-touch-callout: none)',sc.ios?'@supports (display: flex)':'@supports (display: non-existent-layout)')
 .replaceAll('env(safe-area-inset-bottom)',`${sc.safe}px`)
 .replaceAll('env(safe-area-inset-left)',sc.ios&&sc.width>sc.height?'44px':'0px')
 .replaceAll('env(safe-area-inset-right)',sc.ios&&sc.width>sc.height?'44px':'0px');}
const measure=page=>page.evaluate(()=>{
 const rect=id=>document.getElementById(id).getBoundingClientRect().toJSON();
 const parent=document.getElementById('sheld'),form=document.getElementById('form_sheld');
 return{parent:rect('sheld'),form:rect('form_sheld'),input:rect('send_form'),chat:rect('chat'),parentPadding:parseFloat(getComputedStyle(parent).paddingBottom),composerPadding:parseFloat(getComputedStyle(form).paddingBottom),leftPadding:parseFloat(getComputedStyle(parent).paddingLeft),viewport:innerHeight};
});
try{for(const sc of scenarios){
 const context=await browser.newContext({viewport:{width:sc.width,height:sc.height},isMobile:sc.width<900,hasTouch:sc.width<900,locale:'zh-CN'});
 await context.addInitScript(pwa=>{localStorage.setItem('language','zh-cn');const original=window.matchMedia.bind(window);window.matchMedia=query=>{const result=original(query);if(query==='(display-mode: standalone)')Object.defineProperty(result,'matches',{value:pwa});return result;};},sc.pwa);
 await context.route('**/css/mobile-styles.css*',async r=>{const res=await r.fetch();await r.fulfill({response:res,body:cssFor(await res.text(),sc)});});
 await context.route('**/scripts/extensions/third-party/claude-surface/style.css*',r=>r.fulfill({body:cssFor(baseline,sc),contentType:'text/css'}));
 await context.route('**/api/settings/get',async r=>{const res=await r.fetch(),d=await res.json(),s=JSON.parse(d.settings);s.firstRun=false;s.main_api='openai';s.extension_settings.claude_surface={enabled:true,mode:'dark',design:'claude',compactComposer:true};s.extension_settings.disabledExtensions=['third-party/ST-BaiBai-Book','third-party/ST-BaiBai-Tools'];d.settings=JSON.stringify(s);await r.fulfill({response:res,json:d});});
 await context.route(/\/api\/(settings|themes|chats)\/save/,r=>r.fulfill({json:{result:'ok'}}));
 await context.route('**/api/chats/get',r=>r.fulfill({json:[{chat_metadata:{tainted:true}},...Array.from({length:12},(_,i)=>({name:'Seraphina',is_user:false,is_system:false,mes:`布局检查 ${i+1}。\n\n用于确认输入栏下移后的聊天可用高度。`,extra:{},send_date:'2026-11-12'}))]}));
 await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
 const page=await context.newPage();page.setDefaultTimeout(15000);let candidateStyle;
 try{
 await page.goto(process.env.CU_TEST_URL||'http://127.0.0.1:8010',{waitUntil:'networkidle'});
 await page.evaluate(()=>SillyTavern.getContext().selectCharacterById(0,{switchMenu:false}));
 await page.waitForFunction(()=>!document.body.classList.contains('cu-home'));
 assert.equal(await page.locator('body.PWA').count(),Number(sc.pwa));
 for(const design of ['claude','material','adwaita','swiss'])for(const compact of [true,false]){
  await page.locator('.cu-header button[aria-label="更多"]').click();await page.locator('.cu-sheet').getByRole('button',{name:'主题设置',exact:true}).click();
  await page.locator(`[data-cu-design-choice="${design}"]`).click();await page.getByRole('switch',{name:'输入栏紧凑模式',exact:true}).setChecked(compact);
  await page.locator('.cu-sheet-panel').press('Escape');await page.locator('.cu-sheet').waitFor({state:'hidden'});
  candidateStyle=await page.addStyleTag({content:cssFor(candidate,sc)});
  const after=await measure(page);
  await candidateStyle.evaluate(el=>{el.disabled=true;});const before=await measure(page);await candidateStyle.evaluate(el=>{el.disabled=false;});
  if(process.env.CU_BASELINE_CSS){assert(Math.abs(after.input.bottom-before.input.bottom-sc.gain)<1,JSON.stringify({sc,before,after}));assert(Math.abs(after.chat.height-before.chat.height-sc.gain)<1,`Chat height changed unexpectedly: ${sc.name}`);}
  if(sc.ios&&sc.pwa){assert.equal(after.parentPadding,0);assert.equal(after.composerPadding,Math.max(12,sc.safe));assert(after.form.bottom<=sc.height+1);assert.equal(after.leftPadding,sc.width>sc.height?44:2);}
  // VisualViewport keyboard simulation exercises the real inset handler.
  const input=page.locator('#send_textarea');await input.click();await input.fill('输入内容保留');
  const visibleHeight=sc.height-Math.min(300,sc.height/2);
  await page.evaluate(height=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>height});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,get:()=>0});visualViewport.dispatchEvent(new Event('resize'));},visibleHeight);
  await page.waitForFunction(h=>document.getElementById('sheld').getBoundingClientRect().bottom<=h+1,visibleHeight);
  const keyboard=await measure(page);assert(keyboard.input.bottom<=visibleHeight+1);assert.equal(await input.inputValue(),'输入内容保留');
  await input.evaluate(el=>el.blur());await page.evaluate(()=>{delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'));});
  await page.waitForFunction(h=>Math.abs(document.getElementById('sheld').getBoundingClientRect().bottom-h)<1,sc.height);
  const restored=await measure(page);assert(Math.abs(restored.input.bottom-after.input.bottom)<1);
  const label=`${sc.name}-${design}-${compact?'compact':'regular'}`;report.cases.push({label,before,after,keyboard});console.log('PASS '+label);
  if(design==='claude'&&compact&&sc.pwa&&sc.ios){await page.screenshot({path:path.join(output,label+'-after.png')});await candidateStyle.evaluate(el=>{el.disabled=true;});await page.screenshot({path:path.join(output,label+'-before.png')});}
  await candidateStyle.evaluate(el=>el.remove());candidateStyle=null;
 }
 // With Surface disabled the host must regain its own original safe-area rule.
 if(sc.ios&&sc.pwa){
  candidateStyle=await page.addStyleTag({content:cssFor(candidate,sc)});
  await page.evaluate(()=>{const toggle=document.getElementById('cu-extension-enabled');toggle.checked=false;toggle.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal((await measure(page)).parentPadding,Math.max(15,sc.safe));
 }
 }catch(error){await page.screenshot({path:path.join(output,sc.name+'-failure.png')}).catch(()=>{});throw error;}
 finally{await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(report,null,2));await context.close();}
}}
finally{await browser.close();}
console.log(JSON.stringify({passed:report.cases.length,output}));
