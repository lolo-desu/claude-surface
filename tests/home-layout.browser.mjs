/** Stationary home acceptance, deliberately focused on mainstream phone and
 * desktop layouts. Recents open by button only and scroll inside their list.
 * Chromium uses real CDP touch drags; WebKit checks desktop wheel input and cancellation
 * of single-touch events (not a claim of real iOS hardware validation). */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const {chromium,webkit}=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
const {default:sharp}=await import(process.env.CU_SHARP_MODULE||'sharp');
const out=path.resolve(process.env.CU_TEST_OUTPUT||'artifacts/home-mainstream');await fs.mkdir(out,{recursive:true});
const report={cases:[],errors:[]};
const selectors=['html','body','#sheld','.cu-home-welcome','.cu-home-scroll','.cu-home-content'];
async function positions(page){return page.evaluate(selectors=>({
 elements:selectors.map(selector=>{const x=document.querySelector(selector);return{selector,left:x.scrollLeft,top:x.scrollTop,width:x.clientWidth,scrollWidth:x.scrollWidth,height:x.clientHeight,scrollHeight:x.scrollHeight};}),
 greeting:document.querySelector('.cu-home-greeting').getBoundingClientRect().toJSON(),
 input:document.querySelector('#form_sheld').getBoundingClientRect().toJSON(),
 expanded:document.querySelector('.cu-home-history-toggle').getAttribute('aria-expanded'),
 viewport:{x:visualViewport.offsetLeft,y:visualViewport.offsetTop},
}),selectors);}
function stationary(before,after,label){
 assert(after.elements.every(x=>x.left===0&&x.top===0&&x.scrollWidth<=x.width+1),JSON.stringify({label,after}));
 assert(after.elements.filter(x=>x.selector.startsWith('.cu-home')).every(x=>x.scrollHeight<=x.height+1),`home has a vertical scroll range: ${label}`);
 assert.equal(after.expanded,'false',`gesture opened recents: ${label}`);
 assert(Math.abs(before.greeting.y-after.greeting.y)<1&&Math.abs(before.greeting.x-after.greeting.x)<1,`greeting moved: ${label}`);
 assert(Math.abs(before.input.bottom-after.input.bottom)<1,`composer moved: ${label}`);
 assert.equal(after.viewport.x,0);assert.equal(after.viewport.y,0);
}
for(const [engineName,engine]of[['chromium',chromium],['webkit',webkit]]){
 if(process.env.CU_ENGINE&&process.env.CU_ENGINE!==engineName)continue;
 const executablePath=process.env[engineName==='chromium'?'CU_CHROMIUM_EXECUTABLE':'CU_WEBKIT_EXECUTABLE'];
 const browser=await engine.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{for(const [device,width,height,touch]of[['phone',390,844,true],['desktop',1440,900,false]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,deviceScaleFactor:touch?3:1,locale:'zh-CN'});
  await context.route(/\/api\/(settings|themes|presets|chats)\/save/,r=>r.fulfill({json:{result:'ok'}}));
  await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(String(e)));
  try{
   await page.goto(process.env.CU_TEST_URL||'http://127.0.0.1:8011/',{waitUntil:'networkidle'});
   for(const family of ['claude','material','adwaita','swiss'])for(const mode of ['dark','light']){
    const label=`${engineName}-${device}-${family}-${mode}`;
    await page.locator('.cu-header').getByRole('button',{name:'更多',exact:true}).click();await page.locator('.cu-sheet').getByRole('button',{name:'主题设置',exact:true}).click();
    await page.locator(`[data-cu-design-choice="${family}"]`).click();await page.locator(`[data-cu-mode="${mode}"]`).click();
    for(const name of ['显示 SillyTavern 背景图片','显示原生菜单栏','输入栏紧凑模式'])await page.getByRole('switch',{name,exact:true}).uncheck();
    await page.locator('.cu-sheet-heading').getByRole('button',{name:'关闭',exact:true}).click();await page.locator('.cu-sheet').waitFor({state:'hidden'});
    const before=await positions(page);stationary(before,before,label);
    await page.evaluate(selectors=>{for(const selector of selectors){const x=document.querySelector(selector);x.scrollLeft=80;x.scrollTop=80;}window.scrollTo(80,80);},selectors);
    stationary(before,await positions(page),label+' programmatic');
    const canvas=await page.locator('.cu-home-welcome').boundingBox(),x=canvas.x+canvas.width/2,y=canvas.y+canvas.height*.65;
    const mobileWebKit=touch&&engineName==='webkit';
    await page.mouse.move(x,y);for(const [dx,dy]of[[250,0],[-250,0],[0,250],[0,-250]]){
     if(mobileWebKit)await page.locator('.cu-home-welcome').dispatchEvent('wheel',{deltaX:dx,deltaY:dy,bubbles:true,cancelable:true});
     else await page.mouse.wheel(dx,dy);
    }
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));stationary(before,await positions(page),label+' wheel');
    let realTouch=false;
    if(touch&&engineName==='chromium'){
     const cdp=await context.newCDPSession(page);
     for(const [dx,dy]of[[90,0],[-90,0],[0,90],[0,-90]]){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      for(let step=1;step<=6;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*step/6,y:y+dy*step/6}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
     }
     await cdp.detach();realTouch=true;stationary(before,await positions(page),label+' native touch');
    }
    const cancellation=await page.locator('.cu-home-welcome').evaluate(x=>[1,2].map(count=>{const e=new Event('touchmove',{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:Array(count).fill({clientX:100,clientY:300})});x.dispatchEvent(e);return e.defaultPrevented;}));
    assert.deepEqual(cancellation,[true,false],`single-touch hold / pinch zoom: ${label}`);
    const image=await page.screenshot({path:path.join(out,label+'-home.png'),animations:'disabled',scale:'css'});
    let glow;
    if(family==='material'){
     glow=await page.locator('.cu-home-welcome').evaluate(x=>{const s=getComputedStyle(x,'::before');return{top:parseFloat(s.top),height:parseFloat(s.height),width:parseFloat(s.width),frameHeight:x.clientHeight,frameWidth:x.clientWidth};});
     assert(glow.top>=16&&glow.height===320&&glow.top+glow.height<=glow.frameHeight&&glow.width<=glow.frameWidth+1,JSON.stringify({label,glow}));
     const noLightStyle=await page.addStyleTag({content:'.cu-home-welcome::before,.cu-home-welcome::after{opacity:0!important}'});
     const noLight=await page.screenshot({animations:'disabled',scale:'css'});await noLightStyle.evaluate(x=>x.remove());
     const band={left:Math.round(canvas.x+canvas.width/2-50),top:Math.round(canvas.y+glow.top+glow.height/2-10),width:100,height:20};
     const a=await sharp(image).extract(band).removeAlpha().raw().toBuffer(),b=await sharp(noLight).extract(band).removeAlpha().raw().toBuffer();
     glow.centerDelta=a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length;assert(glow.centerDelta>.5,`light invisible: ${label}`);
    }
    await page.locator('.cu-home-history-toggle').click();await page.locator('.cu-home-history').waitFor({state:'visible'});
    const list=page.locator('.cu-home-history');const listRect=await list.boundingBox();assert(listRect.height>=80,`recent list collapsed: ${label}`);
    if(mobileWebKit)await list.evaluate(x=>x.scrollTop=400);
    else{await page.mouse.move(listRect.x+listRect.width/2,listRect.y+listRect.height/2);await page.mouse.wheel(0,400);}
    await page.waitForFunction(()=>{const x=document.querySelector('.cu-home-history');return x.scrollHeight<=x.clientHeight+1||x.scrollTop>0;});
    const listTop=await list.evaluate(x=>x.scrollTop);assert((await positions(page)).elements.every(x=>x.left===0&&x.top===0),`list scrolled an ancestor: ${label}`);
    await page.screenshot({path:path.join(out,label+'-recent.png'),animations:'disabled',scale:'css'});
    await page.locator('.cu-home-history-toggle').click();await list.waitFor({state:'hidden'});stationary(before,await positions(page),label+' collapsed again');
    report.cases.push({label,realTouch,cancellation,glow,listTop,listScrollMode:mobileWebKit?'programmatic':'wheel'});console.log('PASS',label);
   }
  }catch(error){await page.screenshot({path:path.join(out,`${engineName}-${device}-failure.png`),scale:'css'});throw error;}finally{await context.close();}
 }}finally{await browser.close();}
}
assert.equal(report.errors.length,0,report.errors.join('\n'));await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({cases:report.cases.length}));
