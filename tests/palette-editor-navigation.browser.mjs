/** Export/back retains the chosen light/dark editing mode and unsaved draft data.
 * Local ST, real UI navigation, and intercepted settings/theme/chat writes; standard CU_* controls. */
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import{fileURLToPath}from'node:url';
const playwright=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
const source=path.resolve(process.env.CU_SOURCE||path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));const out=process.env.CU_TEST_OUTPUT||path.join(source,'artifacts/palette-editor-navigation');await fs.mkdir(out,{recursive:true});
const engine=process.env.CU_ENGINE||'chromium';const executablePath=process.env[engine==='webkit'?'CU_WEBKIT_EXECUTABLE':'CU_CHROMIUM_EXECUTABLE'];const browser=await playwright[engine].launch({headless:true,...(executablePath?{executablePath}:{} )});
try{const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,locale:'zh-CN'});
await context.addInitScript(()=>{localStorage.setItem('language','zh-cn');window.__paletteNavReady=false;const timer=setInterval(()=>{try{const c=window.SillyTavern?.getContext?.();if(!c?.eventTypes?.APP_READY)return;c.eventSource.once(c.eventTypes.APP_READY,()=>window.__paletteNavReady=true);clearInterval(timer);}catch{}},0);});
await context.route('**/api/settings/get',async r=>{const response=await r.fetch(),data=await response.json(),s=JSON.parse(data.settings);s.firstRun=false;s.main_api='openai';s.extension_settings.claude_surface={enabled:true,design:'claude',mode:'dark'};s.extension_settings.disabledExtensions=['third-party/ST-BaiBai-Book','third-party/ST-BaiBai-Tools'];data.enable_extensions_auto_update=false;data.settings=JSON.stringify(s);await r.fulfill({response,json:data});});
await context.route(/\/api\/(settings|themes|chats)\/save/,r=>r.fulfill({json:{result:'ok'}}));await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));await context.route(/\/api\/.*generate/,r=>r.abort());
await context.route('**/scripts/extensions/third-party/claude-surface/**',async r=>{const rel=decodeURIComponent(new URL(r.request().url()).pathname.split('/claude-surface/')[1]);try{await r.fulfill({body:await fs.readFile(path.join(source,rel)),contentType:rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':'application/json'});}catch{await r.abort();}});
const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(String(e)));p.setDefaultTimeout(20000);await p.goto(process.env.CU_TEST_URL||'http://127.0.0.1:8010',{waitUntil:'networkidle'});await p.waitForFunction(()=>window.__paletteNavReady&&document.querySelector('.cu-header'));
await p.locator('.cu-header button[aria-label="更多"]').click();await p.locator('.cu-sheet').getByRole('button',{name:'主题设置',exact:true}).click();
await p.locator('.cu-palette-add').click();await p.getByRole('button',{name:'新建配色',exact:true}).click();await p.locator('.cu-custom-editor').waitFor();await p.locator('.cu-custom-name input').fill('Navigation draft');
const field=()=>p.locator('.cu-custom-color-row').filter({has:p.locator('label',{hasText:'主背景'})}).locator('.cu-custom-color-hex');
const stages=[];let exported;
for(const [mode,label,color]of [['light','浅色','#123456'],['dark','深色','#abcdef']]){
 await p.getByRole('button',{name:label,exact:true}).click();await field().fill(color);const beforeMode=await p.locator('.cu-custom-preview').getAttribute('data-mode');
 await p.getByRole('button',{name:'导出草稿',exact:true}).click();exported=JSON.parse(await p.locator('.cu-custom-transfer').inputValue());await p.getByRole('button',{name:'返回上一页',exact:true}).click();
 const afterMode=await p.locator('.cu-custom-preview').getAttribute('data-mode'),visibleBackground=await field().inputValue(),name=await p.locator('.cu-custom-name input').inputValue();stages.push({mode,beforeMode,afterMode,visibleBackground,name,exportedBackground:exported[mode].bg});
}
const config=await p.evaluate(()=>SillyTavern.getContext().extensionSettings.claude_surface);const result={source,engine,stages,exported,storedPalettes:config.customPalettes?.length||0,errors};console.log(JSON.stringify({source,engine,stages,storedPalettes:result.storedPalettes,errors},null,2));await fs.writeFile(out+'/summary.json',JSON.stringify(result,null,2));await p.screenshot({path:out+'/palette-editor-navigation.png'});
if(!process.env.CU_BASELINE){assert(stages.every(s=>s.beforeMode===s.mode&&s.afterMode===s.mode&&s.visibleBackground===s.exportedBackground),'Export/back reset the chosen editing mode or draft colors: '+JSON.stringify(stages));assert(stages.every(s=>s.name==='Navigation draft'));assert.equal(exported.light.bg,'#123456');assert.equal(exported.dark.bg,'#abcdef');assert.equal(result.storedPalettes,0,'Exporting a draft unexpectedly saved it');assert.deepEqual(errors,[]);}
await context.close();}
finally{await browser.close();}
