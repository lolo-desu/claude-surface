/** Isolated custom-palette browser regression. Settings and theme writes stay in memory.
 * CU_TEST_URL, CU_SOURCE, CU_TEST_OUTPUT, CU_PLAYWRIGHT_MODULE, CU_WIDTH,
 * CU_ENGINE/CU_BROWSER, CU_CHROMIUM_EXECUTABLE and CU_WEBKIT_EXECUTABLE are supported.
 * Run once per engine; WebKit automation does not replace an iPhone Safari check.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const playwright = await import(process.env.CU_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.env.CU_SOURCE || await fs.access(path.join(repo, 'extension/style.css')).then(() => path.join(repo, 'extension')).catch(() => repo));
const origin = process.env.CU_TEST_URL || 'http://127.0.0.1:8010';
const out = path.resolve(process.env.CU_TEST_OUTPUT || path.join(repo, 'artifacts/custom-palettes'));
await fs.mkdir(out, { recursive: true });
const engine = process.env.CU_BROWSER || process.env.CU_ENGINE || 'chromium';
const executablePath = process.env[engine === 'webkit' ? 'CU_WEBKIT_EXECUTABLE' : 'CU_CHROMIUM_EXECUTABLE'];
const browser = await playwright[engine].launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
let initialData, initialSettings, lastSaved;
const width=Number(process.env.CU_WIDTH||393);let stage='startup';
try{
 const context=await browser.newContext({viewport:{width,height:width===844?390:852},hasTouch:width<900,isMobile:width<900,locale:'zh-CN'});await context.addInitScript(() => {
  localStorage.setItem('language', 'zh-cn'); window.__cuPaletteAppReady = false;
  const timer = setInterval(() => {
   try {
    const context = window.SillyTavern?.getContext?.();
    if (!context?.eventTypes?.APP_READY) return;
    context.eventSource.once(context.eventTypes.APP_READY, () => { window.__cuPaletteAppReady = true; });
    clearInterval(timer);
   } catch { /* Context exports may still be initializing. */ }
  }, 0);
 });
 await context.route('**/api/settings/get', async route => {
  if (!initialData) {
   initialData = await (await route.fetch()).json(); initialSettings = JSON.parse(initialData.settings);
   initialData.enable_extensions_auto_update = false;
   initialSettings.firstRun = false; initialSettings.main_api = 'openai'; initialSettings.extension_settings.notifyUpdates = false;
   initialSettings.extension_settings.claude_surface = { enabled: true, design: 'claude', mode: 'dark', compactComposer: true };
   initialSettings.extension_settings.disabledExtensions = ['third-party/ST-BaiBai-Book', 'third-party/ST-BaiBai-Tools'];
  }
  await route.fulfill({ json: { ...initialData, settings: JSON.stringify(lastSaved || initialSettings) } });
 });
 await context.route('**/api/settings/save', async route => { lastSaved = route.request().postDataJSON(); await route.fulfill({ json: { result: 'ok' } }); });
 await context.route(/\/api\/(themes|chats)\/save/,r=>r.fulfill({json:{result:'ok'}}));await context.route(/\/api\/.*generate/,r=>r.abort());await context.route(/\/api\/extensions\/(install|update|delete|switch|move)(\?|$)/,r=>r.abort());await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
 await context.route('**/scripts/extensions/third-party/claude-surface/**',async r=>{const rel=decodeURIComponent(new URL(r.request().url()).pathname.split('/claude-surface/')[1]),file=path.resolve(source,rel);if(!file.startsWith(source+path.sep))return r.abort();try{await r.fulfill({body:await fs.readFile(file),contentType:rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':'application/json'});}catch{await r.abort();}});
 const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&m.text().includes('[Claude Surface]'))errors.push(m.text());});await page.goto(origin,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__cuPaletteAppReady&&document.querySelector('.cu-header')&&!document.querySelector('.splash-screen'),null,{timeout:60000});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

try{
const appearance=async()=>{await page.locator('.cu-header button[aria-label="更多"]').click();await page.locator('.cu-sheet').getByRole('button',{name:'主题设置',exact:true}).click();};
const config=()=>page.evaluate(()=>SillyTavern.getContext().extensionSettings.claude_surface);
const globalColors=()=>page.evaluate(()=>['bg','quote','border'].map(key=>getComputedStyle(document.body).getPropertyValue('--cu-'+key).trim()));
const field=(key)=>page.locator('.cu-custom-color-row').filter({has:page.locator('label',{hasText:{bg:'主背景',quote:'引用文本',border:'边框颜色'}[key]})}).locator('.cu-custom-color-hex');
const byLabel=label=>page.getByRole('button',{name:label,exact:true});
await appearance();await page.locator('.cu-palette-add').click();await byLabel('新建配色').click();stage='editor';
await page.locator('.cu-custom-editor').waitFor();assert.equal(await page.locator('.cu-custom-color-hex').count(),24);const before=await globalColors();
await page.locator('.cu-custom-name input').fill('我的<配色>');await field('bg').fill('#112233');await field('quote').fill('#ff8800');await field('border').fill('#abcdef80');
await byLabel('浅色').click();await field('bg').fill('#fef1e2');await field('quote').fill('#551122');assert.deepEqual(await globalColors(),before,'draft must not mutate globals');
await field('quote').fill('#xyz');await byLabel('导出草稿').click();assert.equal(await page.locator('.cu-custom-editor').count(),1);assert(await page.locator('.cu-custom-error').isVisible());assert.equal(await field('quote').inputValue(),'#xyz');
await field('quote').fill('#551122');await page.screenshot({path:out+'/editor-light.png'});await byLabel('深色').click();assert.equal(await field('bg').inputValue(),'#112233');await byLabel('保存并应用').click();stage='saved';
await page.locator('.cu-appearance-settings').waitFor();const current=await config();assert.equal(current.customPalettes.length,1);const saved=current.customPalettes[0];assert.equal(saved.label,'我的<配色>');assert.equal(saved.light.bg,'#fef1e2');assert.equal(saved.dark.bg,'#112233');assert.equal(saved.dark.border,'#abcdef80');assert.equal(current.designPalettes.claude,saved.id);assert.equal(await page.locator('.cu-palette-chip').filter({hasText:'我的<配色>'}).getAttribute('aria-pressed'),'true');assert.equal((await globalColors())[0],'#112233');
// The save fixture is reused by settings/get, so this is a real app reload rather
// than reinjecting extension settings directly into the browser after navigation.
stage='reload';const deadline=Date.now()+20000;while(!lastSaved?.extension_settings?.claude_surface?.customPalettes?.some(item=>item.id===saved.id)){assert(Date.now()<deadline,'Custom palette did not reach the settings save fixture');await new Promise(resolve=>setTimeout(resolve,50));}
await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.__cuPaletteAppReady&&document.querySelector('.cu-header')&&!document.querySelector('.splash-screen'),null,{timeout:60000});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
assert.deepEqual((await config()).customPalettes[0],saved);assert.equal((await config()).designPalettes.claude,saved.id);assert.equal((await globalColors())[0],'#112233');await appearance();

await page.locator('.cu-palette-add').click();await byLabel('新建配色').click();stage='clone';assert.equal(await field('bg').inputValue(),'#112233');await byLabel('浅色').click();assert.equal(await field('bg').inputValue(),'#fef1e2');await byLabel('返回自定义颜色').click();assert.equal((await config()).customPalettes.length,1);
await byLabel('我的<配色>').click();await byLabel('导出草稿').click();stage='export';const json=await page.locator('.cu-custom-transfer').inputValue();assert.deepEqual(JSON.parse(json),saved);await page.locator('.cu-custom-toolbar select').selectOption('yaml');const yaml=await page.locator('.cu-custom-transfer').inputValue();assert(yaml.includes('schema: claude-surface-palette'));assert(yaml.includes('"#112233"')||yaml.includes("'#112233'"));
await byLabel('返回上一页').click();await byLabel('返回自定义颜色').click();await byLabel('导入配色').click();stage='import';await page.locator('.cu-custom-transfer').fill(yaml);await byLabel('导入并编辑').click();await page.locator('.cu-custom-editor').waitFor();assert.equal(await field('bg').inputValue(),'#112233');await page.locator('.cu-custom-name input').fill('Imported');await byLabel('保存并应用').click();const imported=await config();assert.equal(imported.customPalettes.length,2);assert.notEqual(imported.customPalettes[0].id,imported.customPalettes[1].id);
await page.locator('.cu-palette-add').click();await byLabel('导入配色').click();const malicious=JSON.stringify({...saved,dark:{...saved.dark,bg:'red; display:none'}});await page.locator('.cu-custom-transfer').fill(malicious);await byLabel('导入并编辑').click();assert(await page.locator('.cu-custom-error').isVisible());assert.equal(await page.locator('.cu-custom-transfer').inputValue(),malicious);assert.equal((await config()).customPalettes.length,2);
await page.locator('.cu-custom-transfer').fill('x'.repeat(131073));await byLabel('导入并编辑').click();assert((await page.locator('.cu-custom-error').textContent()).includes('128 KiB'));assert.equal((await config()).customPalettes.length,2);
await byLabel('返回自定义颜色').click();const row=page.locator('.cu-custom-saved-row').filter({hasText:'Imported'});await row.getByRole('button',{name:'删除',exact:true}).click();await row.getByRole('button',{name:'确认删除',exact:true}).click();assert.equal((await config()).customPalettes.length,1);
await byLabel('新建配色').click();stage='layout';const layout=await page.evaluate(()=>({scrollWidth:document.querySelector('.cu-sheet-body').scrollWidth,width:document.querySelector('.cu-sheet-body').clientWidth,preview:document.querySelector('.cu-custom-preview').getBoundingClientRect().toJSON()}));assert(layout.scrollWidth<=layout.width+1,JSON.stringify(layout));await page.screenshot({path:out+'/editor-final.png'});

// A draft opened before the collection becomes full must not create a silently
// unselectable sixty-fifth palette. Import and create enforce the same limit.
stage='limit';await page.evaluate(saved=>{SillyTavern.getContext().extensionSettings.claude_surface.customPalettes=Array.from({length:64},(_,i)=>({...saved,id:'custom-'+crypto.randomUUID(),label:'Limit '+i}));},saved);
await byLabel('保存并应用').click();assert(await page.locator('.cu-custom-error').isVisible());assert.equal((await config()).customPalettes.length,64);assert.equal(await page.locator('.cu-custom-editor').count(),1);
await byLabel('返回自定义颜色').click();await byLabel('新建配色').click();assert(await page.locator('.cu-custom-error').isVisible());assert.equal(await page.locator('.cu-custom-editor').count(),0);
await byLabel('导入配色').click();await page.locator('.cu-custom-transfer').fill(json);await byLabel('导入并编辑').click();assert(await page.locator('.cu-custom-error').isVisible());assert.equal((await config()).customPalettes.length,64);assert.equal(await page.locator('.cu-custom-transfer').inputValue(),json);
assert.deepEqual(errors,[]);await fs.writeFile(out+'/summary.json',JSON.stringify({passed:true,width,engine,layout,saved,json,yaml,errors},null,2));console.log(JSON.stringify({passed:true,width,engine,out}));
}catch(e){await page.screenshot({path:out+'/failure.png'});await fs.writeFile(out+'/failure.json',JSON.stringify({stage,error:String(e),errors},null,2));throw e;}
finally{await context.close();}
}finally{await browser.close();}
