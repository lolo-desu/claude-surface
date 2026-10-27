/** Isolated recovery regression: all settings/theme writes are intercepted. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium,webkit}=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=await fs.access(path.join(repo,'extension/theme-manager.js')).then(()=>path.join(repo,'extension')).catch(()=>repo);
const output=path.resolve(process.env.CU_TEST_OUTPUT||path.join(repo,'artifacts/theme-recovery-0107'));
const origin=process.env.CU_TEST_URL||'http://127.0.0.1:8010';
await fs.mkdir(output,{recursive:true});
const report={cases:[],browsers:{}};
async function enabledControl(page){
 const panel=page.locator('#rm_extensions_block');
 if(!await panel.isVisible())await page.locator('#extensions-settings-button > .drawer-toggle').click();
 const control=page.locator('#cu-extension-enabled');
 if(!await control.isVisible())await page.locator('#cu-extension-settings > .inline-drawer-header').click();
 await control.waitFor({state:'visible'});return control;
}
async function snapshot(page){return page.evaluate(async()=>{const p=await import('/scripts/power-user.js');return p.getThemeObject('Surface Recovery Fixture');});}
for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
 const executablePath=process.env[engineName==='chromium'?'CU_CHROMIUM_EXECUTABLE':'CU_WEBKIT_EXECUTABLE'];
 const browser=await engine.launch({headless:true,...(executablePath?{executablePath}:{})});report.browsers[engineName]=browser.version();
 try{for(const scenario of [{width:412,legacy:false},{width:1440,legacy:false},{width:412,legacy:true}]){
  const label=engineName+'-'+scenario.width+'-'+(scenario.legacy?'legacy':'internal');
  const context=await browser.newContext({viewport:{width:scenario.width,height:1000},locale:'zh-CN'});
  let saved,initialSettings,initialData;const writes=[],errors=[];
  try{
   await context.route('**/api/settings/get',async route=>{
    if(!initialData){initialData=await (await route.fetch()).json();initialSettings=JSON.parse(initialData.settings);
     const live={...initialSettings.power_user,name:'Surface Recovery Fixture',custom_css:'.surface-recovery-fixture { color: rgb(12, 34, 56); }',font_scale:1.13,main_text_color:'rgba(210, 220, 230, 1)',reduced_motion:true};
     initialSettings.power_user={...live,theme:scenario.legacy?'Claude Surface Material':live.name};delete initialSettings.power_user.name;
     initialSettings.extension_settings.claude_surface={...initialSettings.extension_settings.claude_surface,enabled:scenario.legacy,design:'material',nativeToolbar:true,themeManaged:scenario.legacy};
     delete initialSettings.extension_settings.claude_surface.themeBackup;
     initialData.themes.push({...live,font_scale:1,custom_css:''});
     if(scenario.legacy){initialData.themes.push({...live,name:'Claude Surface Backup recovery regression'});initialSettings.extension_settings.claude_surface.themeBackup={name:'Claude Surface Backup recovery regression',originalName:live.name,customCSS:live.custom_css};}
    }
    await route.fulfill({json:{...initialData,settings:JSON.stringify(saved||initialSettings)}});
   });
   await context.route('**/api/settings/save',async route=>{saved=route.request().postDataJSON();await route.fulfill({json:{result:'ok'}});});
   await context.route('**/api/themes/save',async route=>{writes.push(route.request().postDataJSON());await route.fulfill({json:{result:'ok'}});});
   await context.route('**/api/themes/delete',route=>route.fulfill({status:500,json:{error:'Deletion forbidden in recovery regression'}}));
   await context.route('**/api/extensions/version',route=>route.fulfill({json:{isUpToDate:true}}));
   for(const file of ['theme-manager.js'])await context.route(`**/scripts/extensions/third-party/claude-surface/${file}*`,async route=>route.fulfill({body:await fs.readFile(path.join(source,file),'utf8'),contentType:'text/javascript'}));
   const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(String(e)));
   await page.goto(origin,{waitUntil:'networkidle'});await page.locator('#cu-extension-enabled').waitFor({state:'attached'});
   const expected=scenario.legacy?Object.fromEntries(Object.entries(initialData.themes.at(-1)).map(([key,value])=>[key,key==='name'?'Surface Recovery Fixture':value])):await snapshot(page);
   // Native getThemeObject contains only appearance keys, unlike a whole power_user record.
   const keys=Object.keys(await snapshot(page));for(const key of Object.keys(expected))if(!keys.includes(key))delete expected[key];
   const names=await page.locator('#themes option').evaluateAll(xs=>xs.map(x=>x.value));
   if(scenario.legacy){
    await (await enabledControl(page)).uncheck();
    await page.waitForFunction(()=>!SillyTavern.getContext().extensionSettings.claude_surface.themeManaged);
    assert.deepEqual(await snapshot(page),expected);
   }else{
    for(const family of ['claude','material','adwaita','swiss']){
     await (await enabledControl(page)).check();
     await page.waitForFunction(()=>SillyTavern.getContext().extensionSettings.claude_surface.themeBackup?.snapshot);
     await page.locator('.cu-header button[aria-label="更多"]').click();
     await page.locator('.cu-sheet').getByRole('button',{name:'主题设置',exact:true}).click();
     await page.locator(`[data-cu-design-choice="${family}"]`).click();
     await page.locator('.cu-sheet-panel').press('Escape');await page.locator('.cu-sheet').waitFor({state:'hidden'});
     await (await enabledControl(page)).uncheck();
     await page.waitForFunction(()=>!SillyTavern.getContext().extensionSettings.claude_surface.themeManaged);
     assert.deepEqual(await snapshot(page),expected,label+'/'+family);
    }
    await (await enabledControl(page)).check();
    await page.waitForFunction(()=>SillyTavern.getContext().extensionSettings.claude_surface.themeManaged);
    for(let attempt=0;attempt<400&&!saved?.extension_settings?.claude_surface?.themeManaged;attempt++)await new Promise(resolve=>setTimeout(resolve,50));
    assert(saved?.extension_settings?.claude_surface?.themeManaged,'Internal snapshot was not persisted before restart');
    await page.reload({waitUntil:'networkidle'});
    await (await enabledControl(page)).uncheck();await page.waitForFunction(()=>!SillyTavern.getContext().extensionSettings.claude_surface.themeManaged);
    assert.deepEqual(await snapshot(page),expected,label+'/restart');
   }
   assert.equal(writes.length,0,JSON.stringify(writes.map(x=>x.name)));
   assert.deepEqual(await page.locator('#themes option').evaluateAll(xs=>xs.map(x=>x.value)),names);
   assert.equal(await page.locator('#themes').inputValue(),'Surface Recovery Fixture');
   assert.equal(await page.locator('#customCSS').inputValue(),expected.custom_css);
   const rendered=await page.evaluate(()=>({font:document.documentElement.style.getPropertyValue('--fontScale'),color:document.documentElement.style.getPropertyValue('--SmartThemeBodyColor'),picker:document.querySelector('#main-text-color-picker').getAttribute('color')}));
   assert.equal(Number(rendered.font),expected.font_scale,'Rendered font size was not restored');
   assert.equal(rendered.color,expected.main_text_color,'Rendered text color was not restored');
   assert.equal(rendered.picker,expected.main_text_color,'Native color control was not restored');
   assert.equal(errors.length,0,errors.join('\n'));
   await page.screenshot({path:path.join(output,label+'.png')});
   report.cases.push({label,themeWrites:writes.length,themeCount:names.length,restart:!scenario.legacy,styles:scenario.legacy?[]:['claude','material','adwaita','swiss']});
   console.log('PASS',label);
  }catch(error){await context.pages()[0]?.screenshot({path:path.join(output,label+'-failure.png')});throw error;}finally{await context.close();}
 }}finally{await browser.close();}
}
await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
