/** Real Chromium touch injection: More swipes, scroll-vs-dismiss, click safety,
 * cancelled/multi-touch gestures, reduced motion, desktop Escape/backdrop.
 * Uses a local ST and the same CU_* browser/source/output controls as other tests.
 */
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import{fileURLToPath}from'node:url';
const {chromium}=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=process.env.CU_TEST_OUTPUT||path.join(source,'artifacts/sheet-gesture');await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CU_CHROMIUM_EXECUTABLE||undefined});const report={cases:[]};
async function open(page){await page.waitForFunction(()=>!document.querySelector('.cu-sheet'));await page.locator('.cu-header button[aria-label="更多"]').click();await page.locator('.cu-sheet-panel').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));assert.equal(await page.locator('.cu-sheet-heading button').count(),0);}
async function swipe(page,cdp,x,y,dx,dy,{duration=240,cancel=false}={}){
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
 for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/8,y:y+dy*i/8,id:1}]});await page.waitForTimeout(duration/8);}
 const transform=await page.locator('.cu-sheet-panel').evaluate(el=>el.style.transform);
 await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});return transform;
}
async function settleScroll(body){
 await body.evaluate(el=>new Promise(resolve=>{let last=el.scrollTop,stable=0,frames=0;function tick(){const current=el.scrollTop;stable=Math.abs(current-last)<0.1?stable+1:0;last=current;if(stable>=5||++frames>=120)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);}));
}
async function fixture(width,height){
 const context=await browser.newContext({viewport:{width,height},locale:'zh-CN',isMobile:width<900,hasTouch:width<900});
 await context.addInitScript(()=>localStorage.setItem('language','zh-cn'));
 await context.route('**/api/settings/get',async r=>{const res=await r.fetch(),d=await res.json(),s=JSON.parse(d.settings);s.firstRun=false;s.main_api='openai';s.extension_settings.claude_surface={enabled:true,mode:'dark'};s.extension_settings.disabledExtensions=['third-party/ST-BaiBai-Book','third-party/ST-BaiBai-Tools'];d.settings=JSON.stringify(s);await r.fulfill({response:res,json:d});});
 await context.route(/\/api\/(settings|themes)\/save/,r=>r.fulfill({json:{result:'ok'}}));await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
 await context.route('**/scripts/extensions/third-party/claude-surface/**',async r=>{const rel=decodeURIComponent(new URL(r.request().url()).pathname.split('/claude-surface/')[1]),file=path.resolve(source,rel);if(!file.startsWith(source+path.sep))return r.abort();try{await r.fulfill({body:await fs.readFile(file),contentType:rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':'application/json'});}catch{await r.abort();}});
 const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto(process.env.CU_TEST_URL||'http://127.0.0.1:8010',{waitUntil:'networkidle'});return{context,page,errors};
}
try{
 for(const [width,height]of(process.env.CU_QUICK?[[393,852]]:[[393,852],[844,390]])){
  const{context,page,errors}=await fixture(width,height);const cdp=await context.newCDPSession(page);
  try{for(const design of (process.env.CU_QUICK?['claude']:['claude','material','adwaita','swiss'])){
   await open(page);await page.locator('.cu-sheet').getByRole('button',{name:'主题设置',exact:true}).click();assert.equal(await page.locator('.cu-sheet-heading button').count(),1);
   await page.locator(`[data-cu-design-choice="${design}"]`).click();await page.locator(`[data-cu-mode="${width===393?'dark':'light'}"]`).click();await page.locator('.cu-sheet-panel').press('Escape');await page.locator('.cu-sheet').waitFor({state:'hidden'});
   await open(page);await page.screenshot({path:path.join(output,`${width}-${design}-menu.png`)});
   let card=await page.locator('.cu-tool-grid button').first().boundingBox();const x=card.x+card.width/2,y=card.y+Math.min(24,card.height/2);
   const tracking=await swipe(page,cdp,x,y,0,65);assert.match(tracking,/translateY/);
   await page.locator('.cu-sheet').waitFor({state:'hidden'});assert.equal(await page.locator('#top-settings-holder .drawer-content.openDrawer').count(),0,'Swipe clicked a menu entry');
   // A small slow drag rebounds; an immediate new tap still reaches the native item.
   await open(page);card=await page.locator('.cu-tool-grid').getByRole('button',{name:'预设',exact:true}).boundingBox();
   await swipe(page,cdp,card.x+card.width/2,card.y+card.height/2,0,22,{duration:600});assert.equal(await page.locator('.cu-sheet:not(.cu-sheet-closing)').count(),1);assert.equal(await page.locator('#left-nav-panel').isVisible(),false);
   await page.touchscreen.tap(card.x+card.width/2,card.y+card.height/2);await page.locator('#left-nav-panel').waitFor({state:'visible'});await page.locator('#cu-native-close').click();
   // Scrolling a long body upward, or down while already scrolled, must not dismiss.
   await open(page);await page.locator('.cu-tool-grid').evaluate(el=>{for(let i=0;i<40;i++){const b=document.createElement('button');b.textContent='额外入口 '+i;el.append(b);}});
   const body=page.locator('.cu-sheet-body');await body.evaluate(el=>{el.scrollTop=150;});let box=await body.boundingBox();const sx=box.x+box.width/2,sy=Math.min(box.y+box.height/2,height-105);
   await swipe(page,cdp,sx,sy,0,70);assert.equal(await page.locator('.cu-sheet:not(.cu-sheet-closing)').count(),1);assert((await body.evaluate(el=>el.scrollTop))<150);
   await body.evaluate(el=>{el.scrollTop=0;});await swipe(page,cdp,sx,sy,0,-70);assert((await body.evaluate(el=>el.scrollTop))>0);assert.equal(await page.locator('.cu-sheet:not(.cu-sheet-closing)').count(),1);
   await settleScroll(body);
   await body.evaluate(el=>{el.scrollTop=0;window.swipeTrace=[];const panel=el.closest('.cu-sheet-panel');for(const type of ['touchstart','touchmove','touchend','touchcancel'])panel.addEventListener(type,e=>window.swipeTrace.push({type,cancelable:e.cancelable,prevented:e.defaultPrevented,scroll:el.scrollTop,panelScroll:panel.scrollTop,target:e.target.tagName,transform:panel.style.transform}),{passive:true});});
   const moved=await swipe(page,cdp,sx,sy,0,65);assert.match(moved,/translateY/,JSON.stringify(await page.evaluate(()=>window.swipeTrace)));await page.locator('.cu-sheet').waitFor({state:'hidden'});
   // A cancelled gesture and a horizontal movement leave the menu open.
   await open(page);box=await page.locator('.cu-sheet-heading').boundingBox();await swipe(page,cdp,box.x+box.width/2,box.y+10,0,30,{cancel:true});assert.equal(await page.locator('.cu-sheet:not(.cu-sheet-closing)').count(),1);
   await swipe(page,cdp,box.x+box.width/2,box.y+10,60,3);assert.equal(await page.locator('.cu-sheet:not(.cu-sheet-closing)').count(),1);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+50,y:box.y+10,id:1}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+50,y:box.y+10,id:1},{x:box.x+100,y:box.y+10,id:2}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});assert.equal(await page.locator('.cu-sheet:not(.cu-sheet-closing)').count(),1);
   await page.locator('.cu-sheet-panel').press('Escape');await page.locator('.cu-sheet').waitFor({state:'hidden'});
   await open(page);await page.locator('.cu-sheet-handle').tap();await page.locator('.cu-sheet').waitFor({state:'hidden'});
   report.cases.push({width,height,design});console.log('PASS',width,design);
  }
  // Reduced motion still permits dismissal without relying on animationend.
  await page.emulateMedia({reducedMotion:'reduce'});await open(page);const heading=await page.locator('.cu-sheet-heading').boundingBox();await swipe(page,cdp,heading.x+heading.width/2,heading.y+10,0,65);await page.locator('.cu-sheet').waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);
  }catch(e){await page.screenshot({path:path.join(output,`${width}-failure.png`)});throw e;}finally{await context.close();await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(report,null,2));}
 }
 const{context,page,errors}=await fixture(1440,950);
 try{await open(page);await page.locator('.cu-sheet-panel').press('Escape');await page.locator('.cu-sheet').waitFor({state:'hidden'});await open(page);await page.locator('.cu-sheet').click({position:{x:2,y:2}});await page.locator('.cu-sheet').waitFor({state:'hidden'});assert.deepEqual(errors,[]);report.desktop=true;}finally{await context.close();}
}finally{await browser.close();await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.cases.length,desktop:report.desktop,output}));
