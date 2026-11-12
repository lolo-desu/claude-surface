/** Actual Chromium CDP touch: independent inner reasoning and outer chat scroll,
 * streaming while reading, and containment at the inner bottom. Requires an
 * isolated local SillyTavern profile with a character; writes/generation blocked.
 * Uses CU_SOURCE, CU_TEST_URL, CU_TEST_OUTPUT, CU_QUICK, CU_PLAYWRIGHT_MODULE and
 * CU_CHROMIUM_EXECUTABLE. CDP touch injection requires Chromium.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const engines = await import(process.env.CU_PLAYWRIGHT_MODULE || 'playwright');
const source=path.resolve(process.env.CU_SOURCE||path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
const output = process.env.CU_TEST_OUTPUT || path.join(source, 'artifacts/reasoning-touch');
await fs.mkdir(output, { recursive: true });
const engine='chromium';
const executable = process.env[engine === 'webkit' ? 'CU_WEBKIT_EXECUTABLE' : 'CU_CHROMIUM_EXECUTABLE'];
const browser = await engines[engine].launch({ headless: true, ...(executable ? { executablePath: executable } : {}) });
const report = { source, engine, cases: [] };
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const metrics = page => page.locator('#chat>.mes:last-child .mes_reasoning').evaluate(element => {
    const style = getComputedStyle(element);
    return { top: element.scrollTop, max: element.scrollHeight - element.clientHeight, height: element.clientHeight,
        cap: Math.min(360, innerHeight * .45), padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
        outer: document.getElementById('chat').scrollTop, overflow: style.overflowY };
});
const chunk = (page, count, state) => page.evaluate(({ count, state }) => {
    const element = document.querySelector('#chat>.mes:last-child .mes_reasoning');
    element.innerHTML = Array.from({ length: count }, (_, index) => `<p>Native reasoning paragraph ${index}: bounded scrolling preserves the reading position.</p>`).join('');
    if (state) element.closest('details').dataset.state = state;
}, { count, state });
try {
    for (const design of process.env.CU_QUICK ? ['claude'] : ['claude', 'material', 'adwaita', 'swiss']) {
        const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, locale: 'zh-CN' });
        await context.addInitScript(() => localStorage.setItem('language', 'zh-cn'));
        await context.route('**/api/settings/get', async route => {
            const response = await route.fetch(), data = await response.json(), settings = JSON.parse(data.settings);
            settings.firstRun = false; settings.main_api = 'openai'; settings.power_user.auto_scroll_chat_to_bottom = false;
            settings.extension_settings.claude_surface = { enabled: true, design, mode: 'dark' };
            settings.extension_settings.disabledExtensions = ['third-party/ST-BaiBai-Book', 'third-party/ST-BaiBai-Tools'];
            data.settings = JSON.stringify(settings); await route.fulfill({ response, json: data });
        });
        await context.route(/\/api\/(settings|themes|chats|groups)\/(save|edit)(\?|$)/, route => route.fulfill({ json: { result: 'ok' } }));
        for (const endpoint of ['characters/merge-attributes', 'characters/edit']) await context.route('**/api/' + endpoint, route => route.fulfill({ json: { result: 'ok' } }));
        await context.route('**/api/extensions/version', route => route.fulfill({ json: { isUpToDate: true } }));
        await context.route(/\/api\/extensions\/(install|update|delete|switch|move)(\?|$)/,route=>route.abort());
        await context.route(/\/api\/.*(?:generate|completion)/,route=>route.fulfill({status:503,body:'Reasoning touch test: generation disabled'}));
        await context.route('**/api/chats/recent', route => route.fulfill({ json: [] }));
        const messages = Array.from({ length: 3 }, (_, index) => ({ name: 'Seraphina', is_user: false, is_system: false, send_date: '2026-11-11',
            mes: index === 2 ? 'Native message below its reasoning box.' : 'Earlier message.\n\n'.repeat(30),
            extra: index === 2 ? { reasoning: 'Native stored reasoning.\n\n'.repeat(100) } : {} }));
        await context.route('**/api/chats/get', route => route.fulfill({ json: [{ user_name: 'User', character_name: 'Seraphina', chat_metadata: { tainted: true } }, ...messages] }));
        await context.route('**/scripts/extensions/third-party/claude-surface/**', async route => {
            const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/claude-surface/')[1]), file = path.resolve(source, relative);
            if (!file.startsWith(source + path.sep)) return route.abort();
            try { await route.fulfill({ body: await fs.readFile(file), contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/json' }); } catch { await route.abort(); }
        });
        const page = await context.newPage(); page.setDefaultTimeout(20000);
        const errors = []; page.on('pageerror', error => errors.push(String(error)));
        try {
            await page.goto(process.env.CU_TEST_URL || 'http://127.0.0.1:8010', { waitUntil: 'networkidle' });
            await page.waitForFunction(() => document.getElementById('cu-extension-enabled'),null,{timeout:60000});await page.locator('.splash-screen').waitFor({state:'hidden',timeout:60000});
            await page.evaluate(() => SillyTavern.getContext().selectCharacterById(0, { switchMenu: false }));
            await page.waitForFunction(() => document.querySelectorAll('#chat>.mes').length === 3 && document.querySelector('#chat>.mes:last-child .mes_reasoning'));
            const cdp=await context.newCDPSession(page);
            const swipe=async(x,y,dy)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+dy*i/8,id:1}]});await page.waitForTimeout(30);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.evaluate(()=>new Promise(resolve=>{let last='',stable=0,frames=0;function tick(){const e=document.querySelector('#chat>.mes:last-child .mes_reasoning'),now=e.scrollTop+','+document.getElementById('chat').scrollTop;stable=now===last?stable+1:0;last=now;if(stable>=5||++frames>=120)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);}));};
            for(const viewport of [{width:393,height:852},{width:844,height:390}]){
             await page.setViewportSize(viewport);const reasoning=page.locator('#chat>.mes:last-child .mes_reasoning');await reasoning.evaluate(e=>{e.closest('details').open=true;e.closest('details').dataset.state='thinking';});await chunk(page,100);await frames(page);await reasoning.scrollIntoViewIfNeeded();await frames(page);
             await reasoning.evaluate(e=>{e.scrollTop=(e.scrollHeight-e.clientHeight)/2;});await frames(page);let before=await metrics(page),box=await reasoning.boundingBox();const y=Math.max(70,Math.min(viewport.height-240,box.y+box.height/2));await swipe(box.x+box.width/2,y,70);let after=await metrics(page);const result={design,...viewport,inner:{before,after}};assert(after.top<before.top-10,'Touch did not scroll inner reasoning upward');assert(Math.abs(after.outer-before.outer)<2,'Inner reasoning touch moved outer chat');
             before=after;await chunk(page,110);await frames(page);after=await metrics(page);result.appendWhileReading={before,after};assert(Math.abs(after.top-before.top)<2,'New reasoning chunk displaced touch reading position');
             await reasoning.evaluate(e=>{e.scrollTop=e.scrollHeight;});await frames(page);before=await metrics(page);box=await reasoning.boundingBox();await swipe(box.x+box.width/2,y,-70);after=await metrics(page);result.innerBottom={before,after};assert(Math.abs(after.outer-before.outer)<2,'Inner bottom overscroll leaked to outer chat');
             const chat=await page.locator('#chat').boundingBox();before=await metrics(page);await swipe(chat.x+3,chat.y+Math.min(chat.height/2,150),70);after=await metrics(page);result.outer={before,after};assert(after.outer<before.outer-10,'Outside reasoning touch did not scroll chat');assert(Math.abs(after.top-before.top)<2,'Outer touch changed inner reasoning');
             report.cases.push(result);console.log(JSON.stringify({design,...viewport,innerDelta:result.inner.after.top-result.inner.before.top,outerDelta:result.outer.after.outer-result.outer.before.outer}));await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(report,null,2));
            }
            await page.evaluate(() => { const input = document.getElementById('cu-extension-enabled'); input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
            await page.waitForFunction(() => !document.body.hasAttribute('data-claude-ui'));
            await page.locator('#chat>.mes:last-child .mes_reasoning').evaluate(element => { element.closest('details').dataset.state = 'thinking'; element.scrollTop = 20; }); await frames(page);
            const disabled = await metrics(page); await chunk(page, 200); await frames(page); assert.equal((await metrics(page)).top, disabled.top, 'Disabled Surface still followed reasoning');
            assert.deepEqual(errors, []);
        } catch (error) { report.error = String(error); report.errors = errors; await page.screenshot({ path: path.join(output, design + '-failure.png') }).catch(() => {}); throw error; }
        finally { await context.close(); await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2)); }
    }
} finally { await browser.close(); }
