/** Native reasoning overflow/following across designs and mobile orientations.
 * Requires local SillyTavern with default Seraphina; every write is intercepted.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const engines = await import(process.env.CU_PLAYWRIGHT_MODULE || 'playwright');
const source = path.resolve(process.env.CU_SOURCE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const output = process.env.CU_TEST_OUTPUT || path.join(source, 'artifacts/reasoning-scroll');
await fs.mkdir(output, { recursive: true });
const engine = process.env.CU_ENGINE || 'chromium';
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
            await page.waitForFunction(() => document.getElementById('cu-extension-enabled') && document.body.classList.contains('cu-home') && document.querySelector('#chat .welcomePanel'));
            await frames(page);
            await page.evaluate(() => SillyTavern.getContext().selectCharacterById(0, { switchMenu: false }));
            await page.waitForFunction(() => document.querySelectorAll('#chat>.mes').length === 3 && document.querySelector('#chat>.mes:last-child .mes_reasoning'));
            for (const viewport of [{ width: 393, height: 852 }, { width: 844, height: 390 }]) {
                await page.setViewportSize(viewport);
                await page.locator('#chat>.mes:last-child .mes_reasoning_details').evaluate(element => { element.open = true; element.dataset.state = 'done'; });
                await frames(page);
                // A stored history box starts at its reading position. Following
                // begins only after this reader actually returns to the bottom.
                await page.locator('#chat>.mes:last-child .mes_reasoning').evaluate(element => { element.scrollTop = element.scrollHeight; }); await frames(page);
                await page.locator('#chat>.mes:last-child .mes_reasoning_details').evaluate(element => { element.dataset.state = 'thinking'; });
                await chunk(page, 100); await frames(page);
                await page.locator('#chat').evaluate(element => { element.scrollTop = element.scrollHeight; }); await frames(page);
                const initial = await metrics(page), stages = [{ stage: 'initial', ...initial }];
                assert.equal(initial.overflow, 'auto'); assert(initial.height <= initial.cap + initial.padding + 1, JSON.stringify(initial));
                assert(initial.height > initial.cap - 2, 'Reasoning cap was unexpectedly smaller than available space');
                assert(initial.max > initial.height * 3, 'Native reasoning did not overflow its bounded box');
                assert(Math.abs(initial.top - initial.max) < 3, JSON.stringify(initial));
                await chunk(page, 110); await frames(page); let current = await metrics(page); assert(Math.abs(current.top - current.max) < 3); stages.push({ stage: 'append-bottom', ...current });
                await page.locator('#chat>.mes:last-child .mes_reasoning').evaluate(element => { element.scrollTop = 80; }); await frames(page);
                await chunk(page, 120); await frames(page); current = await metrics(page); assert.equal(current.top, 80); stages.push({ stage: 'reading-above', ...current });
                await page.locator('#chat>.mes:last-child .mes_reasoning').evaluate(element => { element.scrollTop = element.scrollHeight; }); await frames(page);
                await chunk(page, 130); await frames(page); current = await metrics(page); assert(Math.abs(current.top - current.max) < 3); stages.push({ stage: 'back-bottom', ...current });
                await chunk(page, 140, 'done'); await frames(page); current = await metrics(page); assert(Math.abs(current.top - current.max) < 3); stages.push({ stage: 'final-chunk', ...current });
                await chunk(page, 150); await frames(page); current = await metrics(page); assert(current.top < current.max - 3); stages.push({ stage: 'finished-history', ...current });
                assert(stages.every(stage => Math.abs(stage.outer - initial.outer) < 2), 'Following moved the outer chat: ' + JSON.stringify(stages));
                const result = { design, ...viewport, stages }; report.cases.push(result);
                await page.screenshot({ path: path.join(output, `${design}-${viewport.width}.png`) });
                console.log('PASS', design, viewport.width);
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
