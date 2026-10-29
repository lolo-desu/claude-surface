/** Home hotfix: keep Material light outside the scrolling viewport and reject
 * horizontal overflow inside the home itself, including long names/recents.
 * Run against an isolated profile with sample recent chats; writes are blocked. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const {chromium,webkit}=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
const {default:sharp}=await import(process.env.CU_SHARP_MODULE||'sharp');
const out=path.resolve(process.env.CU_TEST_OUTPUT||'artifacts/home-layout');
await fs.mkdir(out,{recursive:true});
const report={cases:[],errors:[]};
for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
 if(process.env.CU_ENGINE&&process.env.CU_ENGINE!==engineName)continue;
 const executablePath=process.env[engineName==='chromium'?'CU_CHROMIUM_EXECUTABLE':'CU_WEBKIT_EXECUTABLE'];
 const browser=await engine.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{for(const touch of [false,true]){
  const context=await browser.newContext({viewport:{width:750,height:415},hasTouch:touch,isMobile:touch,locale:'zh-CN'});
  await context.route(/\/api\/(settings|themes|presets|chats)\/save/,r=>r.fulfill({json:{result:'ok'}}));
  await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(String(e)));
  try{
   await page.goto(process.env.CU_TEST_URL||'http://127.0.0.1:8011/',{waitUntil:'networkidle'});
   for(const family of ['claude','material','adwaita','swiss'])for(const mode of ['dark','light']){
    await page.locator('.cu-header').getByRole('button',{name:'更多',exact:true}).click();
    await page.locator('.cu-sheet').getByRole('button',{name:'主题设置',exact:true}).click();
    await page.locator(`[data-cu-design-choice="${family}"]`).click();await page.locator(`[data-cu-mode="${mode}"]`).click();
    await page.getByRole('switch',{name:'显示 SillyTavern 背景图片',exact:true}).uncheck();
    await page.getByRole('switch',{name:'显示原生菜单栏',exact:true}).uncheck();
    await page.locator('.cu-sheet-heading').getByRole('button',{name:'关闭',exact:true}).click();await page.locator('.cu-sheet').waitFor({state:'hidden'});
    const sizes=touch?[[320,700],[412,915],[844,390]]:[[750,415],[1024,768],[1440,900]];
    for(const [width,height]of sizes){
     await page.setViewportSize({width,height});
     const label=`${engineName}-${width}x${height}-${touch?'touch':'mouse'}-${family}-${mode}`;
     const inspect=()=>page.evaluate(()=>{
      const selectors=['html','body','#sheld','.cu-home-welcome','.cu-home-scroll','.cu-home-content'];
      return selectors.map(selector=>{const x=document.querySelector(selector),r=x.getBoundingClientRect();return{selector,width:x.clientWidth,scrollWidth:x.scrollWidth,left:x.scrollLeft,x:r.x};});
     });
     const flat=await inspect();assert(flat.every(x=>x.scrollWidth<=x.width+1&&x.left===0),JSON.stringify({label,flat}));
     const original=await page.locator('.cu-greeting-text').textContent();
     await page.locator('.cu-greeting-text').evaluate(x=>x.textContent='LongUnbrokenCharacterName'.repeat(7));
     assert((await inspect()).every(x=>x.scrollWidth<=x.width+1),`long greeting overflows: ${label}`);
     await page.locator('.cu-greeting-text').evaluate((x,text)=>x.textContent=text,original);
     await page.evaluate(()=>{for(const selector of ['html','body','#sheld','.cu-home-welcome','.cu-home-scroll'])document.querySelector(selector).scrollLeft=80;window.scrollTo(80,0);});
     const dragged=await inspect();assert(dragged.every(x=>x.left===0),JSON.stringify({label,dragged}));
     const image=await page.screenshot({path:path.join(out,label+'-home.png')});
     let glowDelta;
     if(family==='material'){
      assert.equal(await page.locator('.cu-home-welcome').evaluate(x=>getComputedStyle(x).overflowY),'visible');
      const band=await page.evaluate(()=>{const r=document.querySelector('.cu-home-welcome').getBoundingClientRect(),s=document.querySelector('#sheld').getBoundingClientRect();const top=Math.ceil(Math.max(s.top+2,r.top-26));return{left:Math.round(r.x+r.width/2-50),top,width:100,height:Math.max(1,Math.floor(r.top-top-2))};});
      const clean=await page.addStyleTag({content:'.cu-home-welcome::before,.cu-home-welcome::after{opacity:0!important}'});
      const noGlow=await page.screenshot();await clean.evaluate(x=>x.remove());
      const a=await sharp(image).extract(band).removeAlpha().raw().toBuffer(),b=await sharp(noGlow).extract(band).removeAlpha().raw().toBuffer();
      glowDelta=a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length;
      assert(glowDelta>.1,JSON.stringify({label,band,glowDelta,error:'Material light was clipped above the welcome frame'}));
      const edge={...band,top:await page.locator('#sheld').evaluate(x=>Math.ceil(x.getBoundingClientRect().top)),height:2};
      const edgeA=await sharp(image).extract(edge).removeAlpha().raw().toBuffer(),edgeB=await sharp(noGlow).extract(edge).removeAlpha().raw().toBuffer();
      const edgeDelta=edgeA.reduce((sum,v,i)=>sum+Math.abs(v-edgeB[i]),0)/edgeA.length;
      assert(edgeDelta<=.1,JSON.stringify({label,edgeDelta,error:'Material light meets the header before fading to zero'}));
     }
     await page.locator('.cu-home-history-toggle').click();await page.locator('.cu-home-history').waitFor({state:'visible'});
     assert((await inspect()).every(x=>x.scrollWidth<=x.width+1),`recent chats overflow: ${label}`);
     const scrolled=await page.locator('.cu-home-scroll').evaluate(x=>{x.scrollTop=x.scrollHeight;return{top:x.scrollTop,height:x.clientHeight,total:x.scrollHeight};});
     if(scrolled.total>scrolled.height+1)assert(scrolled.top>0,`vertical scrolling lost: ${label}`);
     await page.screenshot({path:path.join(out,label+'-recent.png')});
     await page.locator('.cu-home-history-toggle').click();await page.locator('.cu-home-history').waitFor({state:'hidden'});
     await page.locator('.cu-home-scroll').evaluate(x=>x.scrollTop=0);
     report.cases.push({label,flat,dragged,scrolled,glowDelta});console.log('PASS',label);
    }
   }
  }catch(error){await page.screenshot({path:path.join(out,`${engineName}-${touch?'touch':'mouse'}-failure.png`)});throw error;}finally{await context.close();}
 }}finally{await browser.close();}
}
assert.equal(report.errors.length,0,report.errors.join('\n'));
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({cases:report.cases.length,errors:report.errors.length}));
