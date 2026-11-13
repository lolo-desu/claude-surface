/** Width autosize fallback must preserve a valid chat reading position and
 * naturally clamp an out-of-range position. Uses actual native 45k AI editing.
 * UA scroll anchoring is disabled in the fixture so browser-specific reflow
 * policy cannot mask or double-adjust the raw scroll restoration under test.
 * The legacy case simulates absent field-sizing with JS supports=false plus
 * CSS fixed sizing; this is feature fallback coverage, not an old iOS runtime.
 * Standard CU_SOURCE, CU_TEST_URL, CU_TEST_OUTPUT, CU_PLAYWRIGHT_MODULE, CU_ENGINE,
 * CU_CHROMIUM_EXECUTABLE and CU_WEBKIT_EXECUTABLE options apply. Writes mocked.
 */
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import{fileURLToPath}from'node:url';
const playwright=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),source=path.resolve(process.env.CU_SOURCE||repo),out=process.env.CU_TEST_OUTPUT||path.join(repo,'artifacts/editor-width-legacy');await fs.mkdir(out,{recursive:true});
const engine=process.env.CU_ENGINE||'chromium',executablePath=process.env[engine==='webkit'?'CU_WEBKIT_EXECUTABLE':'CU_CHROMIUM_EXECUTABLE'];const browser=await playwright[engine].launch({headless:true,...(executablePath?{executablePath}:{})});
const report={engine,source,scenarios:[],errors:[]};const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function fixture({width=960,height=900,legacySizing=false}){
 const total=3,design='claude';
 const safe=width>=900?{top:0,right:0,bottom:0,left:0}:width===844?{top:0,right:44,bottom:21,left:44}:{top:47,right:0,bottom:34,left:0};
 const context=await browser.newContext({viewport:{width,height},isMobile:width<900,hasTouch:width<900,locale:'zh-CN'});
 await context.addInitScript(({mobile})=>{localStorage.setItem('language','zh-cn');if(!mobile)return;const match=window.matchMedia.bind(window);window.matchMedia=query=>{const m=match(query);if(query==='(display-mode: standalone)')Object.defineProperty(m,'matches',{value:true});return m;};},{mobile:width<900});
 if(legacySizing)await context.addInitScript(()=>{const supports=CSS.supports.bind(CSS);CSS.supports=(feature,value)=>feature==='field-sizing'&&value==='content'?false:supports(feature,value);});
 const css=text=>{if(legacySizing)text=text.replaceAll('(field-sizing: content)','(cu-legacy-field-sizing: content)').replaceAll('field-sizing: content','field-sizing: fixed');if(width>=900)return text;text=text.replaceAll('@supports (-webkit-touch-callout: none)','@supports (display: flex)');for(const[side,value]of Object.entries(safe))text=text.replaceAll(`env(safe-area-inset-${side})`,`var(--cu-test-safe-${side},${value}px)`);return text;};
 await context.route('**/*.css*',async route=>{const response=await route.fetch();await route.fulfill({response,body:css(await response.text())});});
 await context.route('**/css/mobile-styles.css*',async route=>{const response=await route.fetch();await route.fulfill({response,body:css(await response.text())});});
 await context.route('**/api/settings/get',async route=>{const response=await route.fetch(),data=await response.json(),settings=JSON.parse(data.settings);data.enable_extensions_auto_update=false;settings.firstRun=false;settings.main_api='openai';settings.power_user.chat_truncation=total;settings.power_user.auto_scroll_chat_to_bottom=false;settings.power_user.auto_save_msg_edits=false;settings.extension_settings.notifyUpdates=false;settings.extension_settings.claude_surface={enabled:true,design,mode:'dark',sidebarPinned:true};settings.extension_settings.disabledExtensions=['third-party/ST-BaiBai-Book','third-party/ST-BaiBai-Tools'];data.settings=JSON.stringify(settings);await route.fulfill({response,json:data});});
 const writes=[];
 await context.route(/\/api\/(settings|themes|chats|groups)\/(save|edit|delete)(\?|$)/,route=>{writes.push(route.request().url());return route.fulfill({json:{result:'ok'}});});
 await context.route(/\/api\/(characters\/(edit|merge-attributes)|extensions\/(install|update|delete|switch|move))(\?|$)/,route=>route.fulfill({json:{result:'ok'}}));
 await context.route(/\/api\/.*(?:generate|completion)/,route=>route.fulfill({status:503,body:'Edit layout test: generation disabled'}));
 await context.route('**/api/extensions/version',route=>route.fulfill({json:{isUpToDate:true}}));
 const targetId=1,longText='旧版酒馆消息宽度变更和滚动保持回归。'.repeat(2500);
 const messages=Array.from({length:total},(_,index)=>({name:index===targetId?'Seraphina':index%2?'User':'Seraphina',is_user:index===targetId?false:!!(index%2),is_system:false,send_date:'2026-11-13T03:00:00Z',mes:index===targetId?longText:`Earlier message ${index}.\n\n${'Native content '.repeat(8)}`,extra:{}}));
 await context.route('**/api/chats/get',route=>route.fulfill({json:[{user_name:'User',character_name:'Seraphina',chat_metadata:{tainted:true}},...messages]}));
 await context.route('**/api/chats/recent',route=>route.fulfill({json:[{avatar:'default_Seraphina.png',file_name:'Edit Layout Audit.jsonl',chat_items:total,last_mes:'2026-11-13',mes:'fixture'}]}));
 await context.route('**/scripts/extensions/third-party/claude-surface/**',async route=>{const relative=decodeURIComponent(new URL(route.request().url()).pathname.split('/claude-surface/')[1]),file=path.resolve(source,relative);if(!file.startsWith(source+path.sep))return route.abort();try{await route.fulfill({body:relative.endsWith('.css')?css(await fs.readFile(file,'utf8')):await fs.readFile(file),contentType:relative.endsWith('.js')?'text/javascript':relative.endsWith('.css')?'text/css':'application/json'});}catch{await route.abort();}});
 const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',error=>{errors.push(String(error));report.errors.push(String(error));});page.on('console',message=>{if(message.type()==='error'&&/\[Claude Surface\]|ResizeObserver/.test(message.text()))report.errors.push(message.text());});
 await page.goto(process.env.CU_TEST_URL||'http://127.0.0.1:8010',{waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('.cu-recents .cu-character-row')&&!document.querySelector('.splash-screen'),null,{timeout:60000});
 await page.locator('.cu-home-history-toggle').click();await page.locator('.cu-home-history .cu-character-row').first().click();await page.waitForFunction(count=>document.querySelectorAll('#chat>.mes').length===count&&!document.body.classList.contains('cu-home'),total);await frames(page);
 await page.evaluate(()=>{window.cuLayoutClicks=[];document.addEventListener('click',event=>cuLayoutClicks.push({tag:event.target.tagName,classes:event.target.className,action:event.target.closest('[data-cu-edit-action]')?.dataset.cuEditAction,cancel:!!event.target.closest('.mes_edit_cancel')}),true);});return{page,context,width,height,design,safe,targetId,writes,errors};
}
try {
  for (const legacySizing of [true, false]) {
    const scenario = { legacySizing, simulation: legacySizing ? 'CSS.supports(field-sizing)=false and CSS field-sizing:fixed' : 'actual field-sizing support', states: [] };
    report.scenarios.push(scenario);
    const f = await fixture({ width: 960, height:900, legacySizing });
    try {
      const { page } = f;
      await page.addStyleTag({content:'#chat{overflow-anchor:none!important}'});
      if (legacySizing) await page.addStyleTag({ content: '#curEditTextarea{field-sizing:fixed!important}' });
      await page.locator('#chat>.mes').nth(1).locator('.mes_edit').click();
      await page.locator('#curEditTextarea').waitFor();
      await frames(page);
      await page.locator('#cu-sidebar-toggle').focus();
      await page.evaluate(() => {
        window.legacyInputs = 0;
        document.getElementById('curEditTextarea').addEventListener('input', () => legacyInputs++);
        document.getElementById('chat').scrollTop = 10000;
      });
      async function state(stage) {
        await frames(page);
        const value = await page.locator('#curEditTextarea').evaluate((editor, stage) => {
          const chat = document.getElementById('chat');
          return { stage, active: document.activeElement.id, viewportWidth: innerWidth, scroll: chat.scrollTop,
            chatMax: chat.scrollHeight - chat.clientHeight, width: editor.getBoundingClientRect().width,
            height: editor.getBoundingClientRect().height, scrollHeight: editor.scrollHeight,
            minVar: editor.closest('.mes_text').style.getPropertyValue('--cu-edit-min-height'),
            inlineHeight: editor.style.height, chars: editor.value.length, inputs: legacyInputs };
        }, stage);
        scenario.states.push(value);
        assert.equal(value.chars, 45000);
        assert.equal(value.inputs, 0, 'Resize synthesized an input event');
        return value;
      }
      async function toggle(open, stage) {
        await page.locator('#cu-sidebar-toggle').click();
        await page.waitForFunction(open => document.body.classList.contains('cu-sidebar-open') === open, open);
        await page.waitForTimeout(250);
        return state(stage);
      }
      const before = await state('pinned-position10000');
      const after = await toggle(false, 'unpinned-position10000');
      assert(after.width > before.width + 10, 'Actual editor width did not change');
      assert(after.chatMax > 10000);
      assert(Math.abs(after.scroll - before.scroll) < 2, 'Width change lost valid reading position');
      assert(Math.abs(after.height - after.scrollHeight) < 5, 'Autosized editor does not fit content');
      const repinned = await toggle(true, 'repinned-position10000');
      assert(Math.abs(repinned.scroll - 10000) < 2, 'Reverse width change lost reading position');
      await page.evaluate(() => { const chat = document.getElementById('chat'); chat.scrollTop = chat.scrollHeight - chat.clientHeight - 5; });
      const nearEnd = await state('pinned-near-end');
      const clamped = await toggle(false, 'unpinned-near-end');
      assert(clamped.chatMax < nearEnd.scroll, 'Clamp fixture must shrink max below old position');
      assert(Math.abs(clamped.scroll - clamped.chatMax) < 2, 'Out-of-range position did not naturally clamp to new max');
      assert.equal(clamped.active, 'cu-sidebar-toggle', 'Resize stole focus');
      assert.deepEqual(f.errors, []);
      scenario.errors = f.errors;
      scenario.passed = true;
      await page.screenshot({ path: out + `/sidebar-${legacySizing ? 'legacy' : 'modern'}.png` });
    } finally { await f.context.close(); }
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify({engine,scenarios:report.scenarios.length,passed:true,out}));
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  await browser.close();
  await fs.writeFile(out + '/summary.json', JSON.stringify(report, null, 2));
}
