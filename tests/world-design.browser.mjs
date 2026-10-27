/** Real native/BaiBai compatibility regression. Set CU_BAI_SOURCE to a checkout
 * of https://github.com/baibai-git/ST-BaiBai-Tools (tested with 1.1.5).
 * All settings/theme/world writes are intercepted; no personal world is saved. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installBaiFixture} from './fixtures/bai-browser.mjs';
const {chromium,webkit}=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=await fs.access(path.join(repo,'extension/style.css')).then(()=>path.join(repo,'extension')).catch(()=>repo);
const output=path.resolve(process.env.CU_TEST_OUTPUT||path.join(repo,'artifacts/world-design-0104'));
const origin=process.env.CU_TEST_URL||'http://127.0.0.1:8010';
assert(process.env.CU_BAI_SOURCE,'CU_BAI_SOURCE must point to the real plugin checkout.');
await fs.mkdir(output,{recursive:true});
const report={cases:[],browsers:{},baiVersion:null};
async function fits(page,label){
 await page.waitForFunction(()=>Math.abs(document.querySelector('#WorldInfo').getBoundingClientRect().width-innerWidth)<1);
 const result=await page.evaluate(()=>{
  const p=document.querySelector('#WorldInfo'),h=document.querySelector('#wi-holder');
  return {width:innerWidth,left:p.getBoundingClientRect().left,right:p.getBoundingClientRect().right,panel:p.scrollWidth-p.clientWidth,holder:h.scrollWidth-h.clientWidth,x:scrollX,y:scrollY,overflow:[...p.querySelectorAll('*')].filter(x=>x.getBoundingClientRect().right>innerWidth+1).slice(0,5).map(x=>({tag:x.tagName,id:x.id,class:x.className,right:x.getBoundingClientRect().right,width:x.getBoundingClientRect().width}))};
 });
 assert(Math.abs(result.left)<1&&Math.abs(result.right-result.width)<1&&result.panel<2&&result.holder<2&&result.x===0&&result.y===0,`${label}: ${JSON.stringify(result)}`);
}
for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
 const executablePath=process.env[engineName==='chromium'?'CU_CHROMIUM_EXECUTABLE':'CU_WEBKIT_EXECUTABLE'];
 const browser=await engine.launch({headless:true,...(executablePath?{executablePath}:{})});
 report.browsers[engineName]=browser.version();
 try {for(const plugin of ['absent','enabled','disabled']){
  const context=await browser.newContext({viewport:{width:412,height:915},hasTouch:true,isMobile:true,locale:'zh-CN'});
  try{
   await context.route(/\/api\/(settings|themes)\/save/,r=>r.fulfill({json:{result:'ok'}}));
   await context.route(/\/api\/worldinfo\/(edit|delete|import)/,r=>r.fulfill({json:{result:'ok'}}));
   await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
   if(plugin!=='absent')report.baiVersion=(await installBaiFixture(context,process.env.CU_BAI_SOURCE,{enabled:plugin==='enabled'})).version;
   for(const file of ['style.css','world-info-ui.js','native-ui.js','index.js']){
    const body=await fs.readFile(path.join(source,file),'utf8');
    await context.route(`**/scripts/extensions/third-party/claude-surface/${file}*`,r=>r.fulfill({body,contentType:file.endsWith('.css')?'text/css':'text/javascript'}));
   }
   const page=await context.newPage();page.setDefaultTimeout(8000);
   const errors=[];page.on('pageerror',e=>errors.push(String(e)));
   await page.goto(origin,{waitUntil:'networkidle'});
   for(const family of ['claude','material','adwaita','swiss'])for(const mode of ['dark','light']){
    await page.locator('.cu-header button[aria-label="更多"]').click();
    await page.locator('.cu-sheet').getByRole('button',{name:'主题设置',exact:true}).click();
    await page.locator(`[data-cu-design-choice="${family}"]`).click();
    await page.locator(`[data-cu-mode="${mode}"]`).click();
    await page.locator('.cu-sheet-panel').focus();await page.keyboard.press('Escape');
    await page.locator('.cu-sheet').waitFor({state:'hidden'});
    await page.locator('.cu-header button[aria-label="更多"]').click();
    await page.locator('.cu-tool-grid').getByRole('button',{name:'世界书',exact:true}).click();
    await page.locator('.cu-sheet').waitFor({state:'hidden'});
    const selector=page.locator('#world_editor_select');await selector.selectOption('');
    const prefix=`${engineName}-${plugin}-${family}-${mode}`;
    await fits(page,prefix+' empty');
    const more=page.getByRole('button',{name:'更多世界书操作',exact:true});
    await more.waitFor({state:'visible'});
    const primary=await page.locator('#world_create_button,#world_popup_new,.cu-wi-tools-toggle').evaluateAll(xs=>xs.map(x=>x.getBoundingClientRect().toJSON()));
    assert(primary.length===3&&primary.every(x=>x.height===40&&Math.abs(x.top-primary[0].top)<1&&Math.abs(x.width-primary[0].width)<1),JSON.stringify(primary));
    assert.equal(await page.locator('#world_popup [data-cu-wi-tool]:visible').count(),0,'Low-frequency tools should begin collapsed');
    await more.click();assert.equal(await more.getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('#world_popup [data-cu-wi-tool]:visible').count(),9);
    const toolBoxes=await page.locator('#world_popup [data-cu-wi-tool]').evaluateAll(xs=>xs.map(x=>({label:x.dataset.cuWiLabel,...x.getBoundingClientRect().toJSON()})));
    assert(toolBoxes.every(x=>x.label&&x.height===36&&x.width>60),JSON.stringify(toolBoxes));
    await more.click();assert.equal(await more.getAttribute('aria-expanded'),'false');
    assert(await page.locator('#world_popup_entries_list').evaluate(el=>el.getBoundingClientRect().height<150),'Empty list reserves a screen of blank space');
    const world=await selector.locator('option').evaluateAll(xs=>xs.find(x=>x.value)?.value);
    assert(world,'A local sample world is required.');await selector.selectOption(world);
    const entry=page.locator('#world_popup_entries_list .world_entry').first();await entry.waitFor({state:'visible'});
    if(plugin==='enabled')await entry.locator('.bai-bai-wi-mobile-header').waitFor({state:'visible'});
    else await entry.locator('.cu-wi-title-row').waitFor({state:'visible'});
    assert.equal(await page.locator('#world_popup_entries_list.cu-wi-layout').count(),plugin==='enabled'?0:1);
    const search=page.locator('#world_info_search');await search.scrollIntoViewIfNeeded();
    await search.click();await search.pressSequentially('surface-regression-no-matching-entry-0104');
    assert.equal(await search.inputValue(),'surface-regression-no-matching-entry-0104','Search typing did not apply');
    await page.waitForFunction(()=>[...document.querySelectorAll('#world_popup_entries_list .world_entry')].filter(x=>x.getBoundingClientRect().height>0).length===0);
    await search.click();await search.press('ControlOrMeta+A');await search.press('Backspace');
    assert.equal(await search.inputValue(),'','Search did not clear');
    await page.waitForFunction(()=>[...document.querySelectorAll('#world_popup_entries_list .world_entry')].filter(x=>x.getBoundingClientRect().height>0).length>1);
    const title=entry.locator('textarea[name="comment"]');
    const original=await title.inputValue();
    const originalHeight=(await title.boundingBox()).height;
    await title.fill('用于测试长标题自动换行与边界的世界书条目名称 '.repeat(5));
    const titleSize=await title.evaluate(el=>({height:el.clientHeight,scrollHeight:el.scrollHeight,font:parseFloat(getComputedStyle(el).fontSize)}));
    assert(titleSize.font>=16&&titleSize.height>=originalHeight-2&&titleSize.height<=120,JSON.stringify(titleSize));
    await title.fill(original);
    for(const width of [320,412,844]){
     console.log('CHECK',prefix,width);
     await page.setViewportSize({width,height:width===844?390:915});
     await fits(page,prefix+'/'+width);
     await more.waitFor({state:'visible'});
     await entry.scrollIntoViewIfNeeded();
     await page.waitForFunction(()=>document.querySelector('#world_popup_entries_list .world_entry [name="position"]')?.getBoundingClientRect().width>0);
     const metrics=await entry.evaluate(el=>['position','order','probability'].map(name=>{
      const x=el.querySelector(`[name="${name}"]`),s=getComputedStyle(x),r=x.getBoundingClientRect();return{name,font:parseFloat(s.fontSize),height:r.height,width:r.width};
     }));
     assert(metrics.every(x=>x.font>=16&&x.height>=34&&x.width>=40),JSON.stringify({prefix,width,metrics}));
     if(plugin!=='enabled'||width<=600){
      const aligned=await entry.evaluate(el=>{
       const order=el.querySelector('[name="order"]').getBoundingClientRect(),prob=el.querySelector('[name="probability"]').getBoundingClientRect();
       const controls=[...el.querySelectorAll('.cu-wi-buttons .menu_button,.cu-wi-buttons .inline-drawer-toggle,.bai-bai-wi-mobile-action-group .menu_button,.bai-bai-wi-mobile-expand-slot .inline-drawer-toggle')].map(x=>x.getBoundingClientRect().toJSON());
       return{order:order.toJSON(),prob:prob.toJSON(),controls};
      });
      assert(Math.abs(aligned.order.top-aligned.prob.top)<1&&Math.abs(aligned.order.width-aligned.prob.width)<1&&aligned.order.height===40,JSON.stringify(aligned));
      assert(aligned.controls.length===4&&aligned.controls.every(x=>x.width===36&&x.height===36&&Math.abs(x.top-aligned.controls[0].top)<1),JSON.stringify(aligned));
     }
     const content=entry.locator('textarea[name="content"]');
     if(!await content.isVisible())await entry.locator('.inline-drawer-toggle').first().click();
     await content.waitFor({state:'visible'});await content.scrollIntoViewIfNeeded();
     assert(await content.evaluate(el=>el.getBoundingClientRect().height>=216&&parseFloat(getComputedStyle(el).fontSize)>=16));
     await fits(page,prefix+'/'+width+' expanded');
     if(width===412){await page.screenshot({path:path.join(output,prefix+'-editor.png')});}
     await entry.locator('.inline-drawer-toggle').first().click();
     await content.waitFor({state:'hidden'});
    }
    for(const width of [1024,1440]){
     await page.setViewportSize({width,height:1000});
     await page.waitForFunction(()=>!document.querySelector('#WorldInfo').classList.contains('cu-world-surface'));
     await entry.scrollIntoViewIfNeeded();
     const desktop=await entry.evaluate(el=>{
      const panel=document.querySelector('#WorldInfo'),r=el.getBoundingClientRect();
      return{left:r.left,right:r.right,panelRight:panel.getBoundingClientRect().right,overflow:panel.scrollWidth-panel.clientWidth,outside:[...panel.querySelectorAll('*')].filter(x=>x.getBoundingClientRect().right>panel.getBoundingClientRect().right).slice(0,5).map(x=>({id:x.id,cl:x.className,right:x.getBoundingClientRect().right})),fields:['order','probability'].map(name=>{const x=el.querySelector(`[name="${name}"]`),s=getComputedStyle(x),r=x.getBoundingClientRect();return{width:r.width,height:r.height,available:x.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)};})};
     });
     assert(desktop.right<=desktop.panelRight+1&&desktop.outside.length===0&&desktop.fields.every(x=>x.width>=64&&x.height>=36&&x.available>=40),JSON.stringify({prefix,width,desktop}));
    }
    await page.setViewportSize({width:412,height:915});
    await page.locator('.cu-header button[aria-label="更多"]').click();
    await page.locator('.cu-tool-grid').getByRole('button',{name:'世界书',exact:true}).click();
    await page.locator('.cu-sheet').waitFor({state:'hidden'});
    await fits(page,prefix+' restored portrait');
    await more.waitFor({state:'visible'});
    await page.locator('#wi-holder').evaluate(el=>{el.scrollTop=0;});
    await page.screenshot({path:path.join(output,prefix+'-list.png')});
    await page.locator('.cu-header button[aria-label="关闭原生面板"]').click();
    assert(await page.locator('#sheld').evaluate(el=>getComputedStyle(el).visibility==='visible'));
    report.cases.push({engine:engineName,plugin,family,mode,widths:[320,412,844,1024,1440],longTitle:titleSize});
   }
   assert.equal(errors.length,0,errors.join('\n'));
  }catch(error){const p=context.pages()[0];await p?.screenshot({path:path.join(output,`${engineName}-${plugin}-failure.png`)});console.log('FAILURE DOM',await p?.evaluate(()=>({search:document.querySelector('#world_info_search')?.value,cards:[...document.querySelectorAll('#world_popup_entries_list .world_entry')].map(x=>({height:x.getBoundingClientRect().height,title:x.querySelector('[name="comment"]')?.value})),panel:document.querySelector('#WorldInfo')?.className})));throw error;}finally{await context.close();}
 }}finally{await browser.close();}
}
await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({cases:report.cases.length,browsers:report.browsers,baiVersion:report.baiVersion}));
