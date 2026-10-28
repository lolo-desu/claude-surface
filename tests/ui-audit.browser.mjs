/** Regression of the 0.10.8 UI audit. Run against an isolated SillyTavern
 * profile containing sample chats and Top Info Bar. All server writes and
 * generation calls are intercepted; navigation/keyboard tests use native UI. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const {chromium,webkit}=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.CU_TEST_URL||'http://127.0.0.1:8011';
const out=path.resolve(process.env.CU_TEST_OUTPUT||'artifacts/ui-audit-0109');
await fs.mkdir(out,{recursive:true});const report={cases:[],errors:[]};
async function appearance(page){
 await page.locator('.cu-header button[aria-label="更多"]').click();
 await page.locator('.cu-sheet').getByRole('button',{name:'主题设置',exact:true}).click();
}
async function closeSheet(page){await page.locator('.cu-sheet-heading').getByRole('button',{name:'关闭',exact:true}).click();await page.locator('.cu-sheet').waitFor({state:'hidden'});}
async function dimensions(page,selector){return page.locator(selector).evaluate(x=>{const r=x.getBoundingClientRect(),s=getComputedStyle(x);return{...r.toJSON(),scrollHeight:x.scrollHeight,clientHeight:x.clientHeight,overflow:s.overflowY};});}
for(const [engineName,engine]of[['chromium',chromium],['webkit',webkit]]){
 if(process.env.CU_ENGINE&&process.env.CU_ENGINE!==engineName)continue;
 const executablePath=process.env[engineName==='chromium'?'CU_CHROMIUM_EXECUTABLE':'CU_WEBKIT_EXECUTABLE'];
 const browser=await engine.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{for(const [width,height,touch,dpr] of [[320,700,true,1],[667,375,true,2],[844,390,true,3],[932,430,true,3],[1024,768,true,2],[1000,700,false,1],[1024,768,false,1],[1440,900,false,1]]){
  if(process.env.CU_WIDTH&&width!==Number(process.env.CU_WIDTH))continue;
  const context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,deviceScaleFactor:dpr,locale:'zh-CN'});
  await context.route(/\/api\/(settings\/save|themes\/save|presets\/save|chats\/save|worldinfo\/edit)/,r=>r.fulfill({json:{result:'ok'}}));
  await context.route(/\/api\/.*(?:generate|completion)/,r=>r.fulfill({status:503,body:'UI test: generation disabled'}));
  await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
  await context.addInitScript(()=>{
   window.__cuAuditEvents=[];
   for(const type of ['pointerdown','pointerup','mousedown','mouseup','focusin','click','wheel','touchend'])document.addEventListener(type,e=>{const b=document.querySelector('.cu-home-history-toggle');window.__cuAuditEvents.push({type,target:e.target.closest?.('button')?.className||String(e.target.className),x:e.clientX,y:e.clientY,button:b?.getBoundingClientRect().toJSON(),scroll:document.querySelector('.cu-home-welcome')?.scrollTop,time:performance.now()});if(window.__cuAuditEvents.length>60)window.__cuAuditEvents.shift();},true);
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  try{
   await page.goto(origin,{waitUntil:'networkidle'});await page.locator('.cu-header').waitFor();
   for(const family of ['claude','material','adwaita','swiss'])for(const mode of ['dark','light']){
    const label=`${engineName}-${width}x${height}-${touch?'touch':'mouse'}-${family}-${mode}`;
    await appearance(page);await page.locator(`[data-cu-design-choice="${family}"]`).click();await page.locator(`[data-cu-mode="${mode}"]`).click();
    // Shift+Tab from the initially focused dialog/close control must wrap.
    for(let i=0;i<4;i++)await page.keyboard.press('Shift+Tab');
    assert(await page.evaluate(()=>!!document.activeElement.closest('.cu-sheet-panel')),'sheet focus escaped');
    await page.keyboard.press('Escape');await page.locator('.cu-sheet').waitFor({state:'hidden'});
    const icons=await page.locator('#top-settings-holder > .drawer > .drawer-toggle').evaluateAll(xs=>xs.map(x=>({role:x.getAttribute('role'),tab:x.tabIndex,label:x.getAttribute('aria-label'),opacity:getComputedStyle(x.querySelector('.drawer-icon')).opacity})));
    assert(icons.length===9&&icons.every(x=>x.role==='button'&&x.tab===0&&x.label&&Number(x.opacity)>=.85),JSON.stringify({label,icons}));
    await page.evaluate(()=>window.scrollTo(42,42));
    const scroll=await page.evaluate(()=>({x:scrollX,y:scrollY,w:document.scrollingElement.scrollWidth,h:document.scrollingElement.scrollHeight,vw:innerWidth,vh:innerHeight}));
    assert(scroll.x===0&&scroll.y===0&&scroll.w<=scroll.vw&&scroll.h<=scroll.vh,JSON.stringify({label,scroll}));
    assert(await page.locator('#bg1').evaluate(x=>getComputedStyle(x).backgroundImage!=='none'&&getComputedStyle(x).opacity==='1'),'missing background image');
    assert.equal(await page.locator('body').evaluate(x=>getComputedStyle(x).isolation),'isolate');
    await page.screenshot({path:path.join(out,label+'-home.png')});
    // Entire recents area scrolls; opening it cannot hide the character action.
    await page.locator('.cu-home-history-toggle').click();
    await page.locator('.cu-home-history').waitFor({state:'visible'});
    assert(await page.locator('.cu-home-choose').isVisible());
    const recent=await dimensions(page,'.cu-home-history'),welcome=await dimensions(page,'.cu-home-welcome');
    assert(recent.height>=30&&welcome.clientHeight>=80,JSON.stringify({label,recent,welcome}));
    if(height<500){await page.locator('.cu-home-welcome').evaluate(x=>x.scrollTop=x.scrollHeight);assert(await page.locator('.cu-home-history > *').first().isVisible());}
    await page.screenshot({path:path.join(out,label+'-recent.png')});
    if(family==='claude'&&mode==='dark'){
     const row=await page.locator('.cu-home-history > *').first().elementHandle();
     const toggleText=await page.locator('.cu-home-history-toggle span').evaluateHandle(x=>x.firstChild);
     await appearance(page);await page.locator(`[data-cu-mode="${mode}"]`).click();await closeSheet(page);
     assert(await row.evaluate(x=>x.isConnected),'unchanged recent rows were replaced by appearance refresh');
     assert(await toggleText.evaluate(x=>x.isConnected),'unchanged toggle text was replaced by appearance refresh');
    }
    await page.locator('.cu-home-history-toggle').click();
    await page.locator('.cu-home-history').waitFor({state:'hidden'});
    if(touch&&width<=1100){
     await page.locator('#cu-sidebar-toggle').click();
     await page.locator('.cu-sidebar').evaluate(x=>x.scrollTop=x.scrollHeight);
     const footer=await dimensions(page,'.cu-sidebar-footer');assert(footer.bottom<=height+1&&footer.top>=0,JSON.stringify({label,footer}));
     await page.locator('.cu-sidebar-footer button[aria-label="主题设置"]').click();await closeSheet(page);
     if(await page.locator('body').evaluate(x=>x.classList.contains('cu-sidebar-open')))await page.locator('.cu-sidebar-top button').click();
    }
    // Native keyboard navigation must open and close the preset panel.
    const preset=page.locator('#top-settings-holder > .drawer > .drawer-toggle').first();
    await preset.focus();await preset.press('Enter');await page.locator('#left-nav-panel').waitFor({state:'visible'});assert.equal(await preset.getAttribute('aria-expanded'),'true');
    if(!touch&&width===1440){
     await page.locator('#completion_prompt_manager_list [data-pm-identifier="main"] .prompt-manager-edit-action').click();
     const editor=await dimensions(page,'#completion_prompt_manager_popup');
     const side=await dimensions(page,'.cu-sidebar');assert(editor.width<=761&&editor.left>=side.right,JSON.stringify({label,editor,side}));
     await page.locator('#completion_prompt_manager_popup_entry_form_close').click();
    }
    await preset.press('Space');await page.locator('#left-nav-panel').waitFor({state:'hidden'});
    // A real sample character and chat, including upstream Top Info Bar.
    await page.locator('.cu-header button[aria-label="更多"]').click();await page.locator('.cu-tool-grid').getByRole('button',{name:'角色卡',exact:true}).click();
    await page.locator('#right-nav-panel .character_select').first().click();
    await page.waitForFunction(()=>!document.body.classList.contains('cu-home'));
    const touchLayout=await page.evaluate(()=>matchMedia('(max-width: 899px), (max-width: 1100px) and (pointer: coarse)').matches);
    if(!touchLayout&&await page.locator('#right-nav-panel').evaluate(x=>x.classList.contains('openDrawer')))await page.locator('#top-settings-holder > .drawer > .drawer-toggle').last().click();
    await page.locator('#right-nav-panel').waitFor({state:'hidden'});await page.locator('#cu-native-close').waitFor({state:'hidden'});await page.locator('#chat > .mes').first().waitFor({state:'visible'});
    assert(await page.locator('#chat').evaluate(x=>{const r=x.getBoundingClientRect();return!!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#chat');}),'chat is obscured by another panel');
    const chat=await dimensions(page,'#chat');if(touch&&height<500)assert(chat.height>=140,JSON.stringify({label,chat}));
    assert((await page.locator('#send_textarea').getAttribute('placeholder')).includes('API'),'offline hint lost');
    await page.screenshot({path:path.join(out,label+'-chat.png')});
    await page.locator('.cu-header .cu-home-action').click();await page.waitForFunction(()=>document.body.classList.contains('cu-home'));
    assert.equal(errors.length,0,errors.join('\n'));report.cases.push({label,scroll,recentHeight:recent.height,chatHeight:chat.height});await fs.writeFile(path.join(out,'progress.json'),JSON.stringify(report,null,2));console.log('PASS',label);
   }
  }catch(error){await page.screenshot({path:path.join(out,`${engineName}-${width}-failure.png`)});await fs.writeFile(path.join(out,`${engineName}-${width}-failure.json`),JSON.stringify(await page.evaluate(()=>({events:window.__cuAuditEvents,expanded:document.querySelector('.cu-home-history-toggle')?.getAttribute('aria-expanded'),body:document.body.className})),null,2));throw error;}finally{await context.close();}
 }}finally{await browser.close();}
}
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({cases:report.cases.length}));
