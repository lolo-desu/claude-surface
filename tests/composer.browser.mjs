/** Compact composer regression: empty, multiline and bounded long drafts; four styles, day/night, mobile/desktop, Chromium/WebKit. Settings/theme writes are intercepted. Install Quick Persona and set CU_PERSONA_REQUIRED=1 to require avatar coverage. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium,webkit}=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=await fs.access(path.join(repo,'extension/style.css')).then(()=>path.join(repo,'extension')).catch(()=>repo);
const output=process.env.CU_TEST_OUTPUT||path.join(repo,'artifacts/composer');await fs.mkdir(output,{recursive:true});const report={cases:[],browsers:{}};
for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
 const executablePath=process.env[engineName==='chromium'?'CU_CHROMIUM_EXECUTABLE':'CU_WEBKIT_EXECUTABLE'];
 const browser=await engine.launch({headless:true,...(executablePath?{executablePath}:{})});report.browsers[engineName]=browser.version();
 try{
 const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,locale:'zh-CN'});
 await context.route(/\/api\/(settings|themes)\/save/,r=>r.fulfill({json:{result:'ok'}}));
 await context.route(/\/api\/worldinfo\/edit/,r=>r.fulfill({json:{result:'ok'}}));
 await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
 if(!process.env.CU_SERVER_CSS){const body=await fs.readFile(path.join(source,'style.css'),'utf8');await context.route('**/scripts/extensions/third-party/claude-surface/style.css*',r=>r.fulfill({body,contentType:'text/css'}));}
 const page=await context.newPage();page.setDefaultTimeout(10000);await page.goto(process.env.CU_TEST_URL||'http://127.0.0.1:8010/',{waitUntil:'networkidle'});
 if(process.env.CU_PERSONA_REQUIRED)await page.locator('#quickPersona').waitFor({state:'visible'});
 report.quickPersona=await page.locator('#quickPersona').isVisible();
 for(const family of ['claude','material','adwaita','swiss'])for(const mode of ['light','dark']){
  await page.locator('.cu-header button[aria-label="更多"]').click();await page.locator('.cu-sheet').getByRole('button',{name:'主题设置',exact:true}).click();
  await page.locator(`[data-cu-design-choice="${family}"]`).click();await page.locator(`[data-cu-mode="${mode}"]`).click();
  await page.getByRole('switch',{name:'输入栏紧凑模式',exact:true}).check();
  await page.locator('.cu-sheet-panel').focus();await page.keyboard.press('Escape');await page.locator('.cu-sheet').waitFor({state:'hidden'});
  for(const width of [320,412,1440]){
   await page.setViewportSize({width,height:915});const input=page.locator('#send_textarea');
   await input.click();await input.press('ControlOrMeta+A');await input.press('Backspace');await page.waitForFunction(()=>document.querySelector('#send_textarea').value==='');await page.waitForFunction(()=>document.querySelector('#send_textarea').clientHeight===36);
   const inspect=()=>input.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {height:el.clientHeight,scroll:el.scrollHeight,overflowX:el.scrollWidth-el.clientWidth,scrollbar:s.scrollbarWidth,webkit:getComputedStyle(el,'::-webkit-scrollbar').display,bottom:r.bottom,root:document.documentElement.scrollWidth-innerWidth,controls:[...document.querySelectorAll('#options_button,#extensionsMenuButton,#quickPersona,#send_but')].filter(x=>x.getBoundingClientRect().height>0).map(x=>({id:x.id,...x.getBoundingClientRect().toJSON()}))};});
   const empty=await inspect();assert.equal(empty.height,36,JSON.stringify({family,mode,width,empty}));assert(empty.scroll<=empty.height+1);assert(empty.root<=1);
   for(const c of empty.controls){assert.equal(c.height,36);assert.equal(c.width,36);assert(Math.abs(c.bottom-empty.bottom)<1);}
   await input.fill('第一行内容\n第二行内容\n第三行内容');const multi=await inspect();assert(multi.height>=80&&multi.scroll<=multi.height+1,JSON.stringify(multi));
   await input.fill('较长的正文用于验证输入内容完整、自动增高且不出现可见滚动条。\n'.repeat(35));const long=await inspect();assert(long.height<=240&&long.scroll>long.height);assert(long.scrollbar==='none'||long.webkit==='none');assert(long.overflowX<=1);
   if(width===412)await page.screenshot({path:`${output}/${engineName}-${family}-${mode}-long.png`});
   await input.click();await input.press('ControlOrMeta+A');await input.press('Backspace');await page.waitForFunction(()=>document.querySelector('#send_textarea').value==='');await page.waitForFunction(()=>document.querySelector('#send_textarea').clientHeight===36);
   report.cases.push({engineName,family,mode,width,empty,multiHeight:multi.height,longHeight:long.height});console.log('PASS',engineName,family,mode,width);
  }
 }
 await fs.writeFile(`${output}/summary.json`,JSON.stringify(report,null,2));
 }catch(error){await browser.contexts()[0]?.pages()[0]?.screenshot({path:`${output}/${engineName}-failure.png`});throw error;}finally{await browser.close();}
}
console.log(JSON.stringify({passed:report.cases.length,browsers:report.browsers}));
