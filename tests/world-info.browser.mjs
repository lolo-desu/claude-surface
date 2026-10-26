/** Local-world-info viewport regression. Playwright dependency/env matches
 * controls.browser.mjs. Settings/theme/world writes are intercepted. Browser
 * contexts are independent of the user's desktop browser. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium,webkit}=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=await fs.access(path.join(repo,'extension/style.css')).then(()=>path.join(repo,'extension')).catch(()=>repo);
const output=path.resolve(process.env.CU_TEST_OUTPUT||path.join(repo,'artifacts/world-info-0102'));
const origin=process.env.CU_TEST_URL||'http://127.0.0.1:8010';
await fs.mkdir(output,{recursive:true});
const report={cases:[],browsers:{},simulatedVisualViewport:true};
async function appearance(page) {
 await page.locator('.cu-header button[aria-label="更多"]').click();
 await page.locator('.cu-sheet').getByRole('button',{name:'主题设置',exact:true}).click();
}
async function openWorld(page) {
 await page.locator('.cu-header button[aria-label="更多"]').click();
 await page.locator('.cu-tool-grid').getByRole('button',{name:'世界书',exact:true}).click();
 await page.locator('#WorldInfo').waitFor({state:'visible'});
}
async function geometry(page) {
 return page.evaluate(()=>{
  const box=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,scrollTop:el.scrollTop};};
  return {panel:box(document.querySelector('#WorldInfo')),holder:box(document.querySelector('#wi-holder')),root:box(document.documentElement),width:innerWidth,height:innerHeight,x:scrollX,y:scrollY};
 });
}
function fits(result,label) {
 assert(Math.abs(result.panel.left)<1 && Math.abs(result.panel.right-result.width)<1,`${label}: panel width ${JSON.stringify(result)}`);
 assert(Math.abs(result.panel.bottom-result.height)<1,`${label}: panel bottom ${JSON.stringify(result)}`);
 assert(result.panel.scrollWidth<=result.panel.clientWidth+1,`${label}: panel overflows horizontally`);
 assert(result.holder.scrollWidth<=result.holder.clientWidth+1,`${label}: holder overflows horizontally`);
 assert.equal(result.x,0,`${label}: document panned horizontally`); assert.equal(result.y,0,`${label}: document panned vertically`);
}
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
 const executablePath=process.env[name==='chromium'?'CU_CHROMIUM_EXECUTABLE':'CU_WEBKIT_EXECUTABLE'];
 const browser=await engine.launch({headless:true,...(executablePath?{executablePath}:{})});
 report.browsers[name]=browser.version();
 const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,deviceScaleFactor:2,locale:'zh-CN'});
 try {
  await context.route(/\/api\/(settings|themes)\/save/,r=>r.fulfill({json:{result:'ok'}}));
  await context.route(/\/api\/worldinfo\/(edit|delete|import)/,r=>r.fulfill({json:{result:'ok'}}));
  await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
  if(!process.env.CU_SERVER_CSS) for(const file of ['style.css','world-info-ui.js']) {
   const body=await fs.readFile(path.join(source,file),'utf8');
   await context.route(`**/scripts/extensions/third-party/claude-surface/${file}*`,r=>r.fulfill({contentType:file.endsWith('.css')?'text/css':'text/javascript',body}));
  }
  // Model keyboard/address-bar viewport changes separately from physical
  // browser resizing. This does not claim to open a real iOS keyboard.
  await context.addInitScript(()=>{
   const native=window.visualViewport;
   const viewport=new EventTarget(); let mock=null;
   for(const key of ['width','height','offsetTop','offsetLeft','scale']) Object.defineProperty(viewport,key,{get:()=>mock?.[key]??native?.[key]??({width:innerWidth,height:innerHeight,offsetTop:0,offsetLeft:0,scale:1}[key])});
   for(const type of ['resize','scroll']) native?.addEventListener(type,()=>viewport.dispatchEvent(new Event(type)));
   Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
   window.__cuTestViewport=value=>{mock=value;viewport.dispatchEvent(new Event('resize'));};
  });
  const page=await context.newPage(); page.setDefaultTimeout(6000);
  await page.goto(origin,{waitUntil:'networkidle'});
  for(const family of ['claude','material','adwaita','swiss']) {
   for(const mode of ['dark','light']) {
    await appearance(page);
    await page.locator(`[data-cu-design-choice="${family}"]`).click();
    await page.locator(`[data-cu-mode="${mode}"]`).click();
    await page.locator('.cu-sheet-panel').focus(); await page.keyboard.press('Escape');
    await page.locator('.cu-sheet').waitFor({state:'hidden'});
    await openWorld(page);
    const selector=page.locator('#world_editor_select');
    const selected=await selector.locator('option').evaluateAll(options=>{const option=options.find(o=>o.value);return option?{value:option.value,label:option.textContent}:null;});
    assert(selected,'Local regression fixture needs at least one worldbook.');
    // Exercise the actual mobile dropdown, including its search input which
    // Select2 appends outside the editor's DOM subtree.
    await page.locator('.select2-selection[aria-labelledby="select2-world_editor_select-container"]').tap();
    const dropdown=page.locator('.select2-dropdown'); await dropdown.waitFor({state:'visible'});
    const dropdownSearch=dropdown.locator('input.select2-search__field');
    await dropdownSearch.tap();
    const dropdownState=await dropdownSearch.evaluate(el=>({fontSize:getComputedStyle(el).fontSize,world:document.querySelector('#WorldInfo').className,body:document.body.className,parent:el.parentElement.parentElement.outerHTML.slice(0,450)}));
    assert(Number.parseFloat(dropdownState.fontSize)>=16,JSON.stringify(dropdownState));
    await dropdownSearch.fill(selected.label);
    await dropdown.locator('.select2-results__option').filter({hasText:selected.label}).first().tap();
    await page.locator('#world_popup_entries_list .world_entry').first().waitFor({state:'visible'});
    for(const viewport of [{width:320,height:740},{width:393,height:852},{width:430,height:932},{width:844,height:390}]) {
     await page.setViewportSize(viewport);
     await page.waitForFunction(()=>Math.abs(parseFloat(getComputedStyle(document.body).getPropertyValue('--cu-world-view-width'))-innerWidth)<1);
     // Browser scrolling must not move the app frame, including when a field
     // is focused or an old persisted drag/resize position is present.
     await page.locator('#WorldInfo').evaluate(el=>{el.style.left='120px';el.style.top='170px';el.style.width='1800px';el.style.height='1800px';el.style.transform='translate(20px,20px)';});
     await page.evaluate(()=>window.scrollTo(200,300));
     const initial=await geometry(page); fits(initial,`${name}/${family}/${mode}/${viewport.width}`);
     const search=page.locator('#world_info_search'); await search.scrollIntoViewIfNeeded();
     await search.tap();
     assert(Number.parseFloat(await search.evaluate(el=>getComputedStyle(el).fontSize))>=16,'Search field invites iOS focus zoom');
     await search.fill('');
     fits(await geometry(page),'Focused worldbook');
     // Open a real entry and verify its editor remains usable without a page pan.
     const entry=page.locator('#world_popup_entries_list .world_entry').first();
     const content=entry.locator('textarea[name="content"]');
     if(!await content.isVisible()) await entry.locator('.inline-drawer-toggle').first().click();
     await content.waitFor({state:'visible'}); await content.scrollIntoViewIfNeeded(); await content.tap();
     assert(Number.parseFloat(await content.evaluate(el=>getComputedStyle(el).fontSize))>=16);
     fits(await geometry(page),'Focused entry');
     await page.locator('#wi-holder').evaluate(el=>{el.scrollTop=0;el.scrollLeft=500;});
     const holder=await page.locator('#wi-holder').boundingBox();
     if(name==='webkit') {
      // Playwright mobile WebKit has no wheel injection API. Use a trusted
      // keyboard scroll on the actual scroll container; geometry/taps remain mobile.
      const tabIndex=await page.locator('#wi-holder').getAttribute('tabindex');
      await page.locator('#wi-holder').evaluate(el=>{el.tabIndex=-1;el.focus();});
      await page.keyboard.press('PageDown');
      await page.locator('#wi-holder').evaluate((el,value)=>value===null?el.removeAttribute('tabindex'):el.setAttribute('tabindex',value),tabIndex);
     } else {
      await page.mouse.move(holder.x+10,holder.y+Math.min(80,holder.height/2));
      await page.mouse.wheel(250,600);
     }
     await page.waitForFunction(()=>document.querySelector('#wi-holder').scrollTop>0);
     const scrolled=await geometry(page);fits(scrolled,'Scrolled inner holder');
     if(name==='chromium' && mode==='dark' && viewport.width===393) {
      await page.locator('#wi-holder').evaluate(el=>{el.scrollTop=0;});
      const session=await context.newCDPSession(page), x=holder.x+12, y=holder.y+Math.min(holder.height-20,220);
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      for(let step=1;step<=6;step++) {
       await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+step*3,y:y-step*24}]});
       await page.waitForTimeout(16);
      }
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await session.detach();
      await page.waitForFunction(()=>document.querySelector('#wi-holder').scrollTop>0);
      fits(await geometry(page),'Native Chromium touch swipe');
     }
     const label=`${name}-${family}-${mode}-${viewport.width}`;
     report.cases.push({label,geometry:scrolled,scrollInput:name==='webkit'?'keyboard':'wheel',touchSwipe:name==='chromium'&&mode==='dark'&&viewport.width===393});console.log('PASS '+label);
     if(mode==='dark' && viewport.width===393) await page.screenshot({path:path.join(output,label+'.png')});
    }
    // Viewport contracts while layout viewport stays fixed (software keyboard).
    await page.setViewportSize({width:393,height:852});
    await page.evaluate(()=>window.__cuTestViewport({width:393,height:420,offsetTop:0,offsetLeft:0,scale:1}));
    await page.waitForFunction(()=>Math.abs(document.querySelector('#WorldInfo').getBoundingClientRect().bottom-420)<1);
    await page.evaluate(()=>window.__cuTestViewport({width:393,height:360,offsetTop:120,offsetLeft:0,scale:1}));
    await page.waitForFunction(()=>{const r=document.querySelector('#WorldInfo').getBoundingClientRect();return Math.abs(r.top-120)<1 && Math.abs(r.bottom-480)<1;});
    await page.evaluate(()=>window.__cuTestViewport({width:196.5,height:426,offsetTop:0,offsetLeft:0,scale:2}));
    await page.waitForFunction(()=>!document.body.style.getPropertyValue('--cu-world-view-width'));
    assert((await geometry(page)).panel.width>390,'Pinch zoom incorrectly resizes the layout');
    await page.evaluate(()=>window.__cuTestViewport(null));
    await page.waitForFunction(()=>Math.abs(document.querySelector('#WorldInfo').getBoundingClientRect().bottom-innerHeight)<1);
    await page.locator('.cu-header button[aria-label="关闭原生面板"]').click();
    await page.waitForFunction(()=>!document.body.style.getPropertyValue('--cu-world-view-height'));
    assert.equal(await page.locator('html').evaluate(el=>getComputedStyle(el).overflowX),'visible','Root remains locked after closing');
   }
  }
  await openWorld(page);
  await page.setViewportSize({width:1280,height:900});
  await page.waitForFunction(()=>!document.body.style.getPropertyValue('--cu-world-view-height'));
  assert.equal(await page.locator('html').evaluate(el=>getComputedStyle(el).overflowX),'visible');
  assert((await geometry(page)).panel.width<1200,'Desktop still uses mobile panel width');
  await context.close();
 } catch(error) {
  report.error=String(error);
  const last=context.pages().at(-1);if(last) await last.screenshot({path:path.join(output,`${name}-failure.png`)}).catch(()=>{});
  throw error;
 } finally {
  await browser.close();await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(report,null,2));
 }
}
console.log(JSON.stringify({passed:report.cases.length,browsers:report.browsers,output}));
