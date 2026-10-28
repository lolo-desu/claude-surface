/** UI audit follow-up: localization, contrast tokens, glass floors, native-home
 * return, Quick Persona, offline swipe and disabling/restoring DOM ownership. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const base=new URL('../',import.meta.url);
const localeModule=await fs.access(new URL('extension/localization.js',base)).then(()=>new URL('extension/localization.js',base)).catch(()=>new URL('localization.js',base));
const {createLocalizer}=await import(localeModule);
const {chromium,webkit}=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.CU_TEST_URL||'http://127.0.0.1:8011';
const out=path.resolve(process.env.CU_TEST_OUTPUT||'artifacts/ui-audit-0109-details');await fs.mkdir(out,{recursive:true});const results=[],tabletResults=[];
async function appearance(page,u){await page.locator('.cu-header').getByRole('button',{name:u('更多'),exact:true}).click();await page.locator('.cu-sheet').getByRole('button',{name:u('主题设置'),exact:true}).click();}
async function close(page,u){await page.locator('.cu-sheet-heading').getByRole('button',{name:u('关闭'),exact:true}).click();await page.locator('.cu-sheet').waitFor({state:'hidden'});}
for(const [name,engine]of[['chromium',chromium],['webkit',webkit]]){
 const executablePath=process.env[name==='chromium'?'CU_CHROMIUM_EXECUTABLE':'CU_WEBKIT_EXECUTABLE'];const browser=await engine.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{for(const locale of ['zh-CN','en-US']){
  const u=createLocalizer(locale),context=await browser.newContext({viewport:{width:1440,height:900},locale});
  await context.addInitScript(locale=>localStorage.setItem('language',locale.toLowerCase()),locale);
  await context.route(/\/api\/(settings|themes|presets|chats)\/save/,r=>r.fulfill({json:{result:'ok'}}));
  await context.route(/\/api\/.*(?:generate|completion)/,r=>r.fulfill({status:503,body:'Generation disabled by UI test'}));
  await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
  const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto(origin,{waitUntil:'networkidle'});
  for(const family of ['claude','material','adwaita','swiss'])for(const mode of ['dark','light']){
   await appearance(page,u);await page.locator(`[data-cu-design-choice="${family}"]`).click();await page.locator(`[data-cu-mode="${mode}"]`).click();
   assert(await page.evaluate(()=>!!document.activeElement.closest('.cu-sheet-panel')),'appearance refresh moved focus behind modal');
   if(locale==='en-US')assert(!/[\u4e00-\u9fff]/.test(await page.locator('.cu-sheet-panel').innerText()),'untranslated Surface settings');
   if(family!=='claude')assert.equal(await page.locator('[data-cu-brand-fixed] .cu-brand-mark').evaluate(x=>x.getBoundingClientRect().width),24);
   const colors=await page.evaluate(()=>{
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=canvas.height=1;const body=getComputedStyle(document.body);
    const rgba=token=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=body.getPropertyValue('--cu-'+token).trim();ctx.fillRect(0,0,1,1);return[...ctx.getImageData(0,0,1,1).data];};
    const contrast=(front,back)=>{const rgb=rgba(front),bg=rgba(back),alpha=rgb[3]/255;const lum=x=>x.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);const a=lum(rgb.map((v,i)=>v*alpha+bg[i]*(1-alpha))),b=lum(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
    const paintAlpha=selector=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=getComputedStyle(document.querySelector(selector)).backgroundColor;ctx.fillRect(0,0,1,1);return ctx.getImageData(0,0,1,1).data[3]/255;};
    return{muted:['bg','sidebar','surface','input'].map(back=>contrast('muted',back)),accent:contrast('on-accent','accent'),headerAlpha:paintAlpha('.cu-header'),menuAlpha:paintAlpha('.cu-sheet-panel')};
   });
   assert(colors.muted.every(x=>x>=4.5)&&colors.accent>=4.5&&colors.headerAlpha>=.89&&colors.menuAlpha>=.95,JSON.stringify({name,locale,family,mode,colors}));
   await page.screenshot({path:path.join(out,`${name}-${locale}-${family}-${mode}.png`)});await close(page,u);
   results.push({name,locale,family,mode,colors});
  }
  if(locale==='en-US'){
   await page.setViewportSize({width:412,height:915});await page.locator('.cu-header').getByRole('button',{name:u('更多'),exact:true}).click();await page.locator('.cu-tool-grid').getByRole('button',{name:u('世界书'),exact:true}).click();
   await page.locator('#world_editor_select').selectOption('0');await page.locator('.cu-wi-tools-toggle').waitFor({state:'visible'});
   const ownLabels=await page.locator('[data-cu-wi-label],.cu-wi-tools-toggle').evaluateAll(xs=>xs.map(x=>x.dataset.cuWiLabel||x.textContent));assert(ownLabels.length>=4&&ownLabels.every(x=>!/[\u4e00-\u9fff]/.test(x)),JSON.stringify(ownLabels));
   await page.screenshot({path:path.join(out,`${name}-english-world.png`)});await page.locator('#cu-native-close').click();await page.setViewportSize({width:1440,height:900});
  }
  await appearance(page,u);await page.getByRole('switch',{name:u('原版首页与最近记录'),exact:true}).check();await close(page,u);
  await page.waitForFunction(()=>!document.body.classList.contains('cu-home'));await page.locator('.cu-header .cu-home-action').click();await page.waitForFunction(()=>document.body.classList.contains('cu-home'));
  await page.locator('.cu-header').getByRole('button',{name:u('更多'),exact:true}).click();await page.locator('.cu-tool-grid').getByRole('button',{name:u('角色卡'),exact:true}).click();await page.locator('#right-nav-panel .character_select').first().click();await page.waitForFunction(()=>!document.body.classList.contains('cu-home'));
  if(await page.locator('#right-nav-panel').isVisible())await page.locator('#top-settings-holder > .drawer > .drawer-toggle').last().click();
  await page.locator('#quickPersona').click();await page.locator('#quickPersonaMenu').waitFor({state:'visible'});
  const persona=await page.locator('#quickPersonaMenu').boundingBox();assert(persona.x>=-1&&persona.y>=-1&&persona.x+persona.width<=1441&&persona.y+persona.height<=901,JSON.stringify(persona));
  await page.locator('#quickPersona').click();await page.locator('#quickPersonaMenu').waitFor({state:'hidden'});
  const last=page.locator('#chat .last_mes');await last.scrollIntoViewIfNeeded();
  const swipe=last.locator('.swipe_right');
  if(await swipe.isVisible()){
   for(let i=0;i<8;i++){const before=await last.locator('.swipes-counter').textContent();await swipe.click();await page.waitForTimeout(50);const after=await last.locator('.swipes-counter').textContent();if(before===after)break;}
   const text=await last.locator('.swipes-counter').textContent(),counts=text.match(/(\d+)\s*\/\s*(\d+)/);if(counts)assert(Number(counts[1])<=Number(counts[2]),text);
  }
  await page.locator('.cu-header .cu-home-action').click();await page.waitForFunction(()=>document.body.classList.contains('cu-home'));
  // Keep the native extension page open while disabling, to test re-enable via its actual control.
  await page.locator('.cu-header').getByRole('button',{name:u('更多'),exact:true}).click();await page.locator('.cu-tool-grid').getByRole('button',{name:u('扩展程序'),exact:true}).click();await appearance(page,u);
  await page.locator('.cu-disable-action').click();await page.waitForFunction(()=>!document.body.hasAttribute('data-claude-ui'));
  assert.equal(await page.locator('.cu-background-layer').count(),0);assert(await page.locator('#bg1').evaluate(x=>x.parentElement===document.body));
  assert.equal(await page.locator('#top-settings-holder > .drawer > .drawer-toggle').first().getAttribute('role'),null);
  if(!await page.locator('#rm_extensions_block').isVisible())await page.locator('#extensions-settings-button .drawer-toggle').click();
  if(!await page.locator('#cu-extension-enabled').isVisible())await page.locator('#cu-extension-settings > .inline-drawer-toggle').click();await page.locator('#cu-extension-enabled').check();await page.waitForFunction(()=>document.body.hasAttribute('data-claude-ui'));assert.equal(await page.locator('.cu-background-layer').count(),1);
  assert.equal(errors.length,0,errors.join('\n'));await context.close();console.log('PASS details',name,locale);
 }
 if(name==='chromium'){
  const context=await browser.newContext({viewport:{width:1024,height:768},isMobile:true,hasTouch:true,locale:'zh-CN'}),page=await context.newPage();page.setDefaultTimeout(15000);const u=createLocalizer('zh-CN');
  await context.route(/\/api\/(settings|themes|presets|chats)\/save/,r=>r.fulfill({json:{result:'ok'}}));await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
  await page.goto(origin,{waitUntil:'networkidle'});await appearance(page,u);await page.locator('select[aria-label="顶栏显示"]').selectOption('scroll');await close(page,u);
  await page.locator('.cu-header button[aria-label="更多"]').click();await page.locator('.cu-tool-grid').getByRole('button',{name:'角色卡',exact:true}).click();await page.locator('#right-nav-panel .character_select').first().click();await page.waitForFunction(()=>!document.body.classList.contains('cu-home'));
  const chat=page.locator('#chat');await chat.evaluate(x=>x.scrollTop=120);await page.waitForTimeout(80);assert(!await page.locator('body').evaluate(x=>x.classList.contains('cu-header-hidden')),'automatic scrolling must not hide header');
  await chat.evaluate(x=>x.scrollTop=0);const before=await page.locator('#form_sheld').boundingBox();const box=await chat.boundingBox();const cdp=await context.newCDPSession(page),x=box.x+box.width/2,y=box.y+box.height*.7;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let step=1;step<=8;step++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*22}]});await page.waitForTimeout(16);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  await page.waitForFunction(()=>document.body.classList.contains('cu-header-hidden'));const after=await page.locator('#form_sheld').boundingBox();assert(Math.abs(before.y+before.height-after.y-after.height)<1,'input footer moved with header');
  await page.locator('#send_textarea').focus();await page.waitForFunction(()=>!document.body.classList.contains('cu-header-hidden'));await page.locator('#send_textarea').blur();
  await page.locator('.cu-header button[aria-label="更多"]').click();await page.locator('.cu-tool-grid').getByRole('button',{name:'用户设置',exact:true}).click();
  const columns=await page.locator('#user-settings-block-content').evaluate(x=>getComputedStyle(x).gridTemplateColumns.split(' ').length);assert.equal(columns,2);
  await page.emulateMedia({reducedMotion:'reduce',forcedColors:'active'});assert(await page.evaluate(()=>matchMedia('(forced-colors: active)').matches));assert.equal(await page.locator('.cu-header').evaluate(x=>getComputedStyle(x).transitionDuration),'0s');
  await page.screenshot({path:path.join(out,'chromium-tablet-forced-colors.png')});tabletResults.push({width:1024,userColumns:columns,automaticScrollIgnored:true,realTouchHidesHeader:true,composerBottomStable:true,reducedMotion:true,forcedColors:true});await context.close();console.log('PASS tablet native touch, density and accessibility media');
 }
 }finally{await browser.close();}
}
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify({appearance:results,tablet:tabletResults},null,2));console.log(JSON.stringify({appearanceCases:results.length,interactionCases:4,tabletCases:tabletResults.length}));
