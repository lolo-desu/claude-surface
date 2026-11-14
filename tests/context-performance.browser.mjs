/** Count-based catalog regression on the real host. Uses only synthetic chats
 * and in-memory characters; all settings/chat/card writes are intercepted. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const engines = await import(process.env.CU_PLAYWRIGHT_MODULE || 'playwright');
const source = path.resolve(process.env.CU_SOURCE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const output = process.env.CU_TEST_OUTPUT || path.join(source, 'artifacts/context-performance');
await fs.mkdir(output, { recursive: true });
const engine = process.env.CU_ENGINE || 'chromium';
const executablePath = process.env[engine === 'webkit' ? 'CU_WEBKIT_EXECUTABLE' : 'CU_CHROMIUM_EXECUTABLE'];
const browser = await engines[engine].launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 412, height: 950 }, isMobile: true, hasTouch: true, locale: 'zh-CN' });
const report = { engine, browser: browser.version(), cases: [] }, errors = [];
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
const reset = page => page.evaluate(() => { window.cuContextAudit.catalog = 0; window.cuContextAudit.updates = []; });
const stats = page => page.evaluate(() => structuredClone(window.cuContextAudit));
await context.addInitScript(() => { localStorage.setItem('language', 'zh-cn'); window.cuContextAudit = { catalog: 0, updates: [] }; });
const messages = Array.from({ length: 400 }, (_, i) => ({ name: i % 2 ? 'User' : 'Seraphina', is_user: !!(i % 2), is_system: false, send_date: '2026-11-11', mes: `Message ${i}\n\nCatalog regression fixture`, extra: {} }));
await context.route('**/api/settings/get', async route => {
    const response = await route.fetch(), data = await response.json(), settings = JSON.parse(data.settings);
    settings.firstRun = false; settings.main_api = 'openai'; settings.power_user.chat_truncation = 50;
    settings.extension_settings.claude_surface = { enabled: true, design: 'claude', mode: 'dark' };
    settings.extension_settings.disabledExtensions = ['third-party/ST-BaiBai-Book', 'third-party/ST-BaiBai-Tools'];
    data.settings = JSON.stringify(settings); await route.fulfill({ response, json: data });
});
for (const endpoint of ['settings/save', 'themes/save', 'extensions/version', 'characters/merge-attributes', 'characters/edit']) {
    await context.route('**/api/' + endpoint, route => route.fulfill({ json: { result: 'ok', isUpToDate: true } }));
}
await context.route(/\/api\/(chats|groups|chat-completions)\/(save|edit|generate)(\?|$)/, route => route.fulfill({ json: { result: 'ok' } }));
await context.route('**/api/groups/all', route => route.fulfill({ json: [] }));
await context.route('**/api/characters/get', async route => { const response = await route.fetch(), data = await response.json(); data.chat = 'Context History'; await route.fulfill({ response, json: data }); });
await context.route('**/api/chats/get', route => route.fulfill({ json: [{ user_name: 'User', character_name: 'Seraphina', chat_metadata: { tainted: true } }, ...messages] }));
await context.route('**/api/chats/recent', route => route.fulfill({ json: [{ avatar: 'default_Seraphina.png', file_name: 'Context History.jsonl', chat_items: 400, last_mes: '2026-11-11', mes: 'fixture' }] }));
await context.route('**/script.js', async route => {
    const response = await route.fetch(); let body = await response.text();
    body = body.replace('export async function saveChatConditional() {', 'export async function saveChatConditional() { window.cuContextSaveCalls=(window.cuContextSaveCalls||0)+1;try {');
    const end = body.indexOf('\n}', body.indexOf('export async function saveChatConditional() {'));
    assert(end > 0); body = body.slice(0, end) + '\n}finally{window.cuContextSaveCalls--}' + body.slice(end);
    body += '\neventSource.on(event_types.APP_READY,()=>window.cuContextReady=true);';
    await route.fulfill({ response, body, contentType: 'text/javascript' });
});
await context.route('**/scripts/extensions/third-party/claude-surface/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/claude-surface/')[1]);
    const file = path.resolve(source, relative); if (!file.startsWith(source + path.sep)) return route.abort();
    try {
        let body = await fs.readFile(file);
        if (relative === 'index.js') {
            let text = body.toString();
            assert(text.includes('function characterEntities() {') && text.includes('function updateContext(refreshLists = true) {'));
            text = text.replace('function characterEntities() {', 'function characterEntities() { window.cuContextAudit.catalog++;');
            text = text.replace('function updateContext(refreshLists = true) {', 'function updateContext(refreshLists = true) { window.cuContextAudit.updates.push(refreshLists);');
            // Controlled persona/model values affect only the extension context;
            // the host still owns chat navigation, message rendering and events.
            text = text.replace('const ctx = () => SillyTavern.getContext();', 'const ctx = () => ({...SillyTavern.getContext(),...window.cuContextOverrides});');
            body = text + '\nwindow.cuContextQueue=queueContextUpdate;Object.defineProperty(window,"cuContextSelecting",{get:()=>!!state.selecting});';
        }
        await route.fulfill({ body, contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/json' });
    } catch (error) { console.error(error); await route.abort(); }
});
const page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(String(error)));
try {
    await page.goto(process.env.CU_TEST_URL || 'http://127.0.0.1:8010', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.cuContextReady && !window.cuContextSelecting && !window.cuContextSaveCalls && !!document.querySelector('.cu-recents .cu-character-row'));
    await page.locator('.cu-home-history-toggle').click();
    await page.locator('.cu-home-history').getByRole('button', { name: 'Seraphina', exact: true }).click();
    await page.waitForFunction(() => !window.cuContextSelecting && !window.cuContextSaveCalls && document.querySelectorAll('#chat>.mes').length === 50);
    await frames(page);
    // Drain the host's delayed navigation settings save before measuring local
    // message work; SETTINGS_UPDATED is a genuine catalog invalidation.
    await page.evaluate(async () => { const host = await import('/script.js'), { cancelDebounce } = await import('/scripts/utils.js'); cancelDebounce(host.saveSettingsDebounced); await host.saveSettings(); });
    await frames(page);
    await page.evaluate(() => {
        const c = SillyTavern.getContext();
        for (let i = 1; i <= 1200; i++) c.characters.push({ avatar: `catalog-${i}.png`, name: `Catalog ${i}`, data: { tags: ['large', 'fixture'] } });
    });
    await reset(page);
    await page.evaluate(() => { const c = SillyTavern.getContext(), message = { name: 'User', is_user: true, is_system: false, mes: 'Appended catalog fixture', extra: {} }; c.chat.push(message); c.addOneMessage(message); });
    await page.waitForFunction(() => document.querySelectorAll('#chat>.mes').length === 51); await frames(page);
    const append = await stats(page); assert.equal(append.catalog, 0); assert(append.updates.includes(false)); report.cases.push({ stage: 'append', ...append });
    await page.locator('#show_more_messages').scrollIntoViewIfNeeded(); await reset(page);
    await page.locator('#show_more_messages').click(); await page.waitForFunction(() => document.querySelectorAll('#chat>.mes').length === 101); await frames(page);
    const older = await stats(page); assert.equal(older.catalog, 0); assert(older.updates.includes(false)); report.cases.push({ stage: 'older', ...older });
    await reset(page);
    await page.evaluate(() => { document.querySelector('#chat>.mes:last-child .mes_text').innerHTML = '<p>Streaming catalog fixture</p>'; }); await frames(page);
    const stream = await stats(page); assert.equal(stream.catalog, 0); assert.equal(stream.updates.length, 0); report.cases.push({ stage: 'stream', ...stream });
    // Message-only work must not suppress a real catalog event in either order.
    for (const order of [[false, true], [true, false], [false, false]]) {
        await reset(page); await page.evaluate(order => { for (const flag of order) window.cuContextQueue(flag); }, order); await frames(page);
        const result = await stats(page); assert.deepEqual(result.updates, [order.includes(true)]);
        assert.equal(result.catalog, order.includes(true) ? 1 : 0); report.cases.push({ stage: 'coalesced', order, ...result });
    }
    for (const event of ['SETTINGS_UPDATED', 'PERSONA_CHANGED', 'CHATCOMPLETION_MODEL_CHANGED', 'ONLINE_STATUS_CHANGED']) {
        await reset(page);
        await page.evaluate(async event => {
            const c = SillyTavern.getContext(); c.characters[c.characterId].name = `Renamed ${event}`;
            window.cuContextOverrides = { name1: `Persona ${event}`, onlineStatus: 'connected', mainApi: 'openai', getChatCompletionModel: () => `Model ${event}` };
            await c.eventSource.emit(c.eventTypes[event]);
        }, event); await frames(page);
        const result = await stats(page); assert(result.catalog >= 1, event);
        assert.equal(await page.locator('.cu-title').innerText(), `Renamed ${event}`);
        assert.equal(await page.locator('.cu-account-name').innerText(), `Persona ${event}`);
        assert.equal(await page.locator('.cu-model-label').innerText(), `Model ${event}`);
        assert.match(await page.locator('.cu-recents').innerText(), new RegExp(`Renamed ${event}`));
        report.cases.push({ stage: event, ...result });
    }
    // A real native close emits context events and reconciles home visibility.
    await page.locator('.cu-header .cu-home-action').click();
    await page.waitForFunction(() => !window.cuContextSelecting && SillyTavern.getContext().characterId == null && document.body.classList.contains('cu-home'));
    await frames(page); assert.equal(await page.locator('.cu-home-content').isVisible(), true);
    assert.match(await page.locator('.cu-greeting-text').innerText(), /Persona ONLINE_STATUS_CHANGED/);
    report.cases.push({ stage: 'home', pass: true });
    assert.deepEqual(errors, []); report.result = 'PASS'; console.log(JSON.stringify(report));
} catch (error) { report.error = String(error); report.errors = errors; await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error; }
finally { await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2)); await context.close(); await browser.close(); }
