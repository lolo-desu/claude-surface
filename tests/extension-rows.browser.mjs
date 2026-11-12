/** Real native extension-management rows, isolated synthetic manifests, no writes.
 * CU_TEST_URL, CU_SOURCE, CU_TEST_OUTPUT, CU_PLAYWRIGHT_MODULE,
 * CU_CHROMIUM_EXECUTABLE, CU_BROWSER=webkit and CU_WEBKIT_EXECUTABLE are supported.
 * Measurements do not substitute for an iPhone Safari device check.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const playwright = await import(process.env.CU_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.env.CU_SOURCE || await fs.access(path.join(repo, 'extension/style.css')).then(() => path.join(repo, 'extension')).catch(() => repo));
const origin = process.env.CU_TEST_URL || 'http://127.0.0.1:8010';
const out = path.resolve(process.env.CU_TEST_OUTPUT || path.join(repo, 'artifacts/extension-rows-01017'));
await fs.mkdir(out, { recursive: true });
const cases = [
 ...[320,393,430,1440].flatMap(width=>['claude','material','adwaita','swiss'].map(design=>({width,design,locale:'en'}))),
 ...[320,393].flatMap(width=>['zh-cn','de-de'].map(locale=>({width,design:'claude',locale}))),
];
const defs=[
 {id:'normal',name:'Plain extension',disabled:true},
 {id:'update',name:'Update available extension',disabled:true,update:true},
 {id:'clean',name:'Cleanup enabled extension',disabled:true,clean:true},
 {id:'clean-update',name:'Cleanup and update extension',disabled:true,clean:true,update:true},
 {id:'missing',name:'Unavailable extension with required modules',requires:['missing_a','missing_b_with_a_very_long_identifier','missing_c'],update:true},
 {id:'optional',name:'Active extension with optional modules',optional:['missing_a','missing_b_with_a_very_long_identifier','missing_c']},
];
const fake=defs.map(d=>({type:'local',name:`third-party/edge-audit-${d.id}`}));
const engine = process.env.CU_BROWSER || 'chromium';
const executablePath = process.env[engine === 'webkit' ? 'CU_WEBKIT_EXECUTABLE' : 'CU_CHROMIUM_EXECUTABLE'];
const browser = await playwright[engine].launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
if(process.env.CU_CASES)cases.splice(0,cases.length,...JSON.parse(process.env.CU_CASES));
const report=[];
for(const {width,design,locale} of cases){
 const context=await browser.newContext({viewport:{width,height:852},hasTouch:width<900,isMobile:width<900,locale});
 await context.addInitScript(value=>localStorage.setItem('language',value),locale);
 await context.route('**/api/extensions/discover',async r=>{const res=await r.fetch();await r.fulfill({response:res,json:[...await res.json(),...fake]});});
 await context.route('**/third-party/edge-audit-*/manifest.json*',r=>{const id=new URL(r.request().url()).pathname.match(/edge-audit-([^/]+)/)[1],d=defs.find(x=>x.id===id);return r.fulfill({json:{display_name:d.name,version:'2026.11.12.123456789',author:'Long author name',requires:d.requires||[],optional:d.optional||[],loading_order:1000+defs.indexOf(d),...(d.clean?{hooks:{clean:'auditClean'}}:{})}});});
 await context.route('**/api/settings/get',async r=>{const res=await r.fetch(),d=await res.json(),s=JSON.parse(d.settings);d.enable_extensions_auto_update=false;s.firstRun=false;s.main_api='openai';s.extension_settings.notifyUpdates=false;s.extension_settings.claude_surface={enabled:true,mode:'dark',design};s.extension_settings.disabledExtensions=['third-party/ST-BaiBai-Book','third-party/ST-BaiBai-Tools',...defs.filter(x=>x.disabled).map(x=>`third-party/edge-audit-${x.id}`)];d.settings=JSON.stringify(s);await r.fulfill({response:res,json:d});});
 await context.route(/\/api\/(settings|themes)\/save/,r=>r.fulfill({json:{result:'ok'}}));
 await context.route(/\/api\/.*generate/, r=>r.abort());
 await context.route('**/api/extensions/version',r=>{const id=r.request().postDataJSON().extensionName.replace('/edge-audit-',''),d=defs.find(x=>x.id===id);return r.fulfill({json:{isUpToDate:!d?.update,currentBranchName:'main-with-a-very-long-branch-name',currentCommitHash:'abcdef0123456789',remoteUrl:'https://github.com/long-author-name/long-extension-name'}});});
 await context.route('**/api/extensions/branches',r=>r.fulfill({json:[{name:'main-with-a-very-long-branch-name-abcdefghijklmnopqrstuvwxyz',commit:'abcdef0123456789',label:'origin/main',current:true},{name:'development',commit:'1234567',label:'origin/development',current:false}]}));
 await context.route(/\/api\/extensions\/(install|update|delete|switch|move)(\?|$)/,r=>r.abort());
 await context.route('**/scripts/extensions/third-party/claude-surface/**',async r=>{const rel=decodeURIComponent(new URL(r.request().url()).pathname.split('/claude-surface/')[1]),file=path.resolve(source,rel);if(!file.startsWith(source+path.sep))return r.abort();try{await r.fulfill({body:await fs.readFile(file),contentType:rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':'application/json'});}catch{await r.abort();}});
 const page=await context.newPage();page.setDefaultTimeout(15000);
 try{
  await page.goto(origin,{waitUntil:'networkidle'});
  await page.locator('dialog.transparent_dialogue_popup[open]').waitFor({state:'hidden',timeout:30000});
  await page.locator('.cu-header button[aria-label="More"], .cu-header button[aria-label="更多"]').click();
  await page.locator('.cu-tool-grid').getByRole('button', {name:/^(Extensions|扩展程序|Erweiterungen)$/}).click();
  await page.locator('#extensions_details').click();await page.locator('.extensions_info').waitFor();
  const settled = () => page.waitForFunction(() => { const rows = [...document.querySelectorAll('.extension_block[data-name^="/edge-audit-"]')]; return rows.length === 6 && rows.every(row => row.querySelector('.extension_version').textContent.includes('abcdef0')); });
  await settled();
  const result=await page.locator('.extensions_info').evaluate(root=>{
   const rect=el=>el?.getBoundingClientRect().toJSON();
   return{toolbar:{rect:rect(root.querySelector('.extensions_toolbar')),client:root.querySelector('.extensions_toolbar').clientWidth,scroll:root.querySelector('.extensions_toolbar').scrollWidth},rootOverflow:document.documentElement.scrollWidth-innerWidth,rows:[...root.querySelectorAll('.extension_block')].filter(e=>e.dataset.name.includes('edge-audit')).map(row=>({name:row.dataset.name,rect:rect(row),text:rect(row.querySelector('.extension_text_block')),nameRect:rect(row.querySelector('.extension_name')),nameClient:row.querySelector('.extension_name').clientWidth,nameScroll:row.querySelector('.extension_name').scrollWidth,actions:rect(row.querySelector('.extension_actions')),modules:row.querySelector('.extension_modules')?{rect:rect(row.querySelector('.extension_modules')),client:row.querySelector('.extension_modules').clientWidth,scroll:row.querySelector('.extension_modules').scrollWidth}:null,buttons:[...row.querySelectorAll('.extension_actions > button')].filter(e=>getComputedStyle(e).display!=='none').map(e=>({class:e.className,rect:rect(e)}))}))};
  });
  Object.assign(result,{width,design,locale});report.push(result);
  {
   assert(result.rootOverflow<=1,'page overflow');
   for(const row of result.rows){
    assert(row.text.width>=50,`${row.name}: title area collapsed to ${row.nameClient}`);
    if(row.modules)assert(row.modules.scroll<=row.modules.client+1,`${row.name}: module notes overflow`);
    for(const btn of row.buttons){
     if(width<900)assert(btn.rect.width>=43.5&&btn.rect.height>=43.5,'touch target shrank');
     assert(btn.rect.left>=row.rect.left-1&&btn.rect.right<=row.rect.right+1,`${row.name}: action outside row`);
    }
   }
  }
  if(width>=393)for(const row of result.rows.filter(row => !row.modules && row.buttons.length < 5))assert(row.rect.height <= 57, 'Ordinary extension row is too tall');
  console.log(width,design,locale,result.rows.map(r=>`${r.name.split('edge-audit-')[1]}:${r.rect.height.toFixed(1)}h/${r.nameClient}w/${r.buttons.length}a`).join(' '));
  const target = page.locator('.extension_block[data-name="/edge-audit-clean"]');
  await target.scrollIntoViewIfNeeded();
  result.defaultScroll = await target.evaluate(row => ({ rowTop: row.getBoundingClientRect().top, toolbarBottom: row.closest('.extensions_info').querySelector('.extensions_toolbar').getBoundingClientRect().bottom }));
  // A partially visible preceding row in a screenshot does not mean its content
  // is unreachable. Center the actual target before recording the evidence.
  await target.evaluate(row => row.scrollIntoView({ block: 'center' }));
  result.centeredScroll = await target.evaluate(row => ({ rowTop: row.getBoundingClientRect().top, rowBottom: row.getBoundingClientRect().bottom, toolbarBottom: row.closest('.extensions_info').querySelector('.extensions_toolbar').getBoundingClientRect().bottom, contentBottom: row.closest('.popup-content').getBoundingClientRect().bottom }));
  assert(result.centeredScroll.rowTop >= result.centeredScroll.toolbarBottom - 1, 'Target row is hidden by the sticky toolbar');
  assert(result.centeredScroll.rowBottom <= result.centeredScroll.contentBottom + 1, 'Target row cannot be brought fully into view');
  if(width===320||width===393) await page.screenshot({path:`${out}/${engine}-${width}-${design}-${locale}.png`});
  // Sorting changes only disposable browser account storage. It must preserve
  // row controls and notes after the native dialog has rebuilt itself.
  const oldId = await page.locator('.extensions_info').evaluate(root => root.closest('dialog').dataset.id);
  await page.locator('.extensions_toolbar > button').last().click();
  await page.waitForFunction(id => document.querySelector('.extensions_info')?.closest('dialog').dataset.id !== id, oldId);
  await settled();
  assert.equal(await page.locator('.extension_block[data-name^="/edge-audit-"]').count(), 6);
  assert.equal(await page.locator('.extension_block[data-name="/edge-audit-clean-update"] .extension_actions > button:visible').count(), 5);
 }catch(e){report.push({width,design,locale,error:String(e)});console.log('FAIL',width,design,locale,String(e));}
 await context.close();await fs.writeFile(path.join(out, `${engine}-summary.json`), JSON.stringify({ origin, source, cases: report }, null, 2));
}
await browser.close();
assert.equal(report.filter(entry => entry.error).length, 0, 'Extension row browser cases failed; see summary.json');
