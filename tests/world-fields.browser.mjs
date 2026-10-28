/** Native/Bai layouts plus the actual upstream TauriTavern editor.
 * No application settings, worlds or presets are written to the server. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installBaiFixture} from './fixtures/bai-browser.mjs';
import {installTauriEditorFixture} from './fixtures/tauri-editor.browser.mjs';
const {chromium,webkit}=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=await fs.access(path.join(repo,'extension/style.css')).then(()=>path.join(repo,'extension')).catch(()=>repo);
const origin=process.env.CU_TEST_URL||'http://127.0.0.1:8010';
const output=path.resolve(process.env.CU_TEST_OUTPUT||path.join(repo,'artifacts/world-fields-0108'));
await fs.mkdir(output,{recursive:true});const report={cases:[],browsers:{}};
const fixture='/scripts/extensions/third-party/surface-editor-qa/bootstrap.js';
async function editor(page,value){await page.evaluate(async({url,value})=>(await import(url)).setEditorEnabled(value),{url:fixture,value});}
async function tools(page,name){await page.locator('.cu-header button[aria-label="更多"]').click();await page.locator('.cu-sheet').getByRole('button',{name,exact:true}).click();await page.locator('.cu-sheet').waitFor({state:'hidden'});}
async function fieldMetrics(entry){return entry.evaluate(el=>{
 const labels=['Primary Keywords','Logic','Optional Filter','Content','Order:','Trigger %:'].map(key=>{const x=el.querySelector(`[data-i18n="${key}"]`),s=getComputedStyle(x);return {key,font:s.fontSize,line:s.lineHeight,color:s.color,opacity:s.opacity};});
 const flags=['excludeRecursion','preventRecursion','delay_until_recursion','ignoreBudget'].map(name=>{const input=el.querySelector(`input[name="${name}"]`),label=input.closest('label'),span=label.querySelector('span'),r=input.getBoundingClientRect(),t=span.getBoundingClientRect(),s=getComputedStyle(span);return{name,top:label.getBoundingClientRect().top,center:r.top+r.height/2,lineCenter:t.top+parseFloat(s.lineHeight)/2,font:s.fontSize,color:s.color,display:getComputedStyle(label).display};});
 return{labels,flags};
});}
for(const [name,engine]of[['chromium',chromium],['webkit',webkit]]){
 const executablePath=process.env[name==='chromium'?'CU_CHROMIUM_EXECUTABLE':'CU_WEBKIT_EXECUTABLE'];const browser=await engine.launch({headless:true,...(executablePath?{executablePath}:{})});report.browsers[name]=browser.version();
 try{for(const bai of [false,true]){
  const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,locale:'zh-CN'});const errors=[];
  try{
   await context.route(/\/api\/(settings|themes)\/save/,r=>r.fulfill({json:{result:'ok'}}));
   await context.route(/\/api\/worldinfo\/(edit|delete|import)/,r=>r.fulfill({json:{result:'ok'}}));
   await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
   if(bai)await installBaiFixture(context,process.env.CU_BAI_SOURCE,{enabled:true});
   await installTauriEditorFixture(context,process.env.CU_TAURI_SOURCE,process.env.CU_EDITOR_BUNDLE);
   await context.route('**/scripts/extensions/third-party/claude-surface/style.css*',async r=>r.fulfill({body:await fs.readFile(path.join(source,'style.css'),'utf8'),contentType:'text/css'}));
   const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(String(e)));await page.goto(origin,{waitUntil:'networkidle'});await editor(page,false);
   for(const family of ['claude','material','adwaita','swiss'])for(const mode of ['dark','light']){
    const label=`${name}-${bai?'bai':'native'}-${family}-${mode}`;
    if(process.env.CU_CASE_FILTER&&!label.includes(process.env.CU_CASE_FILTER))continue;
    await page.locator('.cu-header button[aria-label="更多"]').click();await page.locator('.cu-sheet').getByRole('button',{name:'主题设置',exact:true}).click();
    await page.locator(`[data-cu-design-choice="${family}"]`).click();await page.locator(`[data-cu-mode="${mode}"]`).click();await page.locator('.cu-sheet-panel').press('Escape');await page.locator('.cu-sheet').waitFor({state:'hidden'});
    await tools(page,'世界书');const select=page.locator('#world_editor_select');await select.selectOption(await select.locator('option').evaluateAll(xs=>xs.find(x=>x.value)?.value));
    const entry=page.locator('#world_popup_entries_list .world_entry').first();await entry.waitFor({state:'visible'});await entry.scrollIntoViewIfNeeded();
    await entry.locator('.inline-drawer-toggle').first().click();await entry.locator('textarea[name="content"]').waitFor({state:'visible'});
    if(bai)await entry.locator('.bai-bai-wi-mobile-expanded-extra-toggle').click();
    await entry.locator('[data-i18n="Optional Filter"]').waitFor({state:'visible'});
    await entry.locator('input[name="excludeRecursion"]').evaluate(x=>{x.closest('label').querySelector('span').textContent='不可递归（不会被其他条目激活）';});
    const measured=await fieldMetrics(entry);assert(measured.labels.every(x=>x.font==='14px'&&x.line==='22px'&&x.color===measured.labels[0].color&&x.opacity==='1'),JSON.stringify({label,labels:measured.labels}));
    assert(measured.flags.every(x=>x.font==='14px'&&x.color===measured.labels[0].color&&x.display==='grid'&&Math.abs(x.center-x.lineCenter)<1),JSON.stringify({label,flags:measured.flags}));
    assert(Math.abs(measured.flags[0].top-measured.flags[1].top)<1&&Math.abs(measured.flags[2].top-measured.flags[3].top)<1,JSON.stringify(measured.flags));
    await entry.locator('.world_entry_edit').evaluate(x=>x.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(output,label+'-plain.png')});
    await editor(page,true);const wrapper=entry.locator('.tt-codemirror-editor');await wrapper.waitFor({state:'visible'});await wrapper.scrollIntoViewIfNeeded();
    const frame=await wrapper.evaluate(x=>{const s=getComputedStyle(x),p=x.querySelector('.cm-panels-top');return{width:x.getBoundingClientRect().width,height:x.getBoundingClientRect().height,border:s.borderTopWidth,style:s.borderTopStyle,color:s.borderTopColor,radius:s.borderRadius,bg:s.backgroundColor,toolbarBorder:getComputedStyle(p).borderBottomWidth,toolbarButtons:[...x.querySelectorAll('.cm-editor-tools button')].map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height}))};});
    assert(frame.border==='1px'&&frame.style==='solid'&&frame.toolbarBorder==='1px'&&frame.height>=216&&frame.toolbarButtons.every(x=>x.w===44&&x.h===44),JSON.stringify({label,frame}));
    assert.equal(frame.radius==='0px',family==='swiss','FlatDesign keeps square editor corners');
    const original=await entry.locator('textarea[name="content"]').inputValue();const editable=wrapper.locator('.cm-content');await editable.fill('世界书编辑测试 qa-0108');await page.waitForFunction(()=>document.querySelector('#world_popup_entries_list .world_entry textarea[name="content"]').value.includes('qa-0108'));
    await wrapper.getByRole('button',{name:/Undo|撤[销消]/}).click();await page.waitForFunction(text=>document.querySelector('#world_popup_entries_list .world_entry textarea[name="content"]').value===text,original);
    await wrapper.getByRole('button',{name:/Redo|重[做作]/}).click();await page.waitForFunction(()=>document.querySelector('#world_popup_entries_list .world_entry textarea[name="content"]').value.includes('qa-0108'));
    await editable.fill(original);await page.waitForFunction(text=>document.querySelector('#world_popup_entries_list .world_entry textarea[name="content"]').value===text,original);
    await entry.locator('.world_entry_edit').evaluate(x=>x.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(output,label+'-codemirror.png')});await editor(page,false);
    await page.locator('.cu-header button[aria-label="关闭原生面板"]').click();await tools(page,'预设');
    const link=page.locator('label[for="bind_preset_to_connection"]');await link.scrollIntoViewIfNeeded();
    const boxes=await page.locator('#openai_api-presets .title_restorable > .flex-container > .menu_button').evaluateAll(xs=>xs.map(x=>x.getBoundingClientRect().toJSON()));assert(boxes.length===4&&boxes.every(x=>x.width===44&&x.height===44),JSON.stringify({label,boxes}));
    const checkbox=page.locator('#bind_preset_to_connection'),checked=await checkbox.isChecked();await link.click();assert.equal(await checkbox.isChecked(),!checked);
    const icons=await link.locator('i:visible').count();assert.equal(icons,1);
    const centered=await link.evaluate(x=>{const r=x.getBoundingClientRect(),i=[...x.querySelectorAll('i')].find(n=>getComputedStyle(n).display!=='none').getBoundingClientRect();return[Math.abs((r.left+r.right-i.left-i.right)/2),Math.abs((r.top+r.bottom-i.top-i.bottom)/2)];});assert(centered.every(x=>x<1),JSON.stringify(centered));
    await link.click();assert.equal(await checkbox.isChecked(),checked);await page.screenshot({path:path.join(output,label+'-preset.png')});await page.locator('.cu-header button[aria-label="关闭原生面板"]').click();
    assert.equal(errors.length,0,errors.join('\n'));report.cases.push({label,measured,frame,presetButtons:boxes.length});console.log('PASS',label);
   }
  }catch(error){await context.pages()[0]?.screenshot({path:path.join(output,name+'-'+bai+'-failure.png')});throw error;}finally{await context.close();}
 }}finally{await browser.close();}
}
await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({cases:report.cases.length,browsers:report.browsers}));
