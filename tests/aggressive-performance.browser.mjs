/** Compare 0.10.19 mode50 with the aggressive mode25, then compare both at25
 * to isolate changes beyond the window size. Use frozen CU_BASELINE/CU_SOURCE
 * snapshots. All fixture writes/tokenization/generation are intercepted.
 * CU_PERF_REPEAT=3, CU_LOADED_TARGET=500, CU_SCENARIO=baseline50 (optional).
 * CU_DIAGNOSTICS=1 adds a native keyboard-observer counter for diagnostic runs.
 * CU_NAV_ONLY=1 skips the older-history/append stages after navigation checks.
 * Timing claims require an exclusive browser window; smoke runs are functional.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const engines = await import(process.env.CU_PLAYWRIGHT_MODULE || 'playwright');
const candidate = path.resolve(process.env.CU_SOURCE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
assert(process.env.CU_BASELINE, 'Set CU_BASELINE to a frozen 0.10.19 source checkout');
const baseline = path.resolve(process.env.CU_BASELINE);
const output = process.env.CU_TEST_OUTPUT || path.join(candidate, 'artifacts/aggressive-performance');
await fs.mkdir(output, { recursive: true });
const engine = process.env.CU_ENGINE || 'chromium';
const diagnostics = process.env.CU_DIAGNOSTICS === '1';
const navigationOnly = process.env.CU_NAV_ONLY === '1';
const executablePath = process.env[engine === 'webkit' ? 'CU_WEBKIT_EXECUTABLE' : 'CU_CHROMIUM_EXECUTABLE'];
const browser = await engines[engine].launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const report = { engine, browser: browser.version(), baseline, candidate, startedAt: new Date().toISOString(), cpuProfiler: false, nativeObserverDiagnostics: diagnostics, navigationOnly, cases: [] };
const repeats = Number(process.env.CU_PERF_REPEAT || 3), loadedTarget = Number(process.env.CU_LOADED_TARGET || 500);
assert(Number.isInteger(repeats) && repeats > 0, 'CU_PERF_REPEAT must be a positive integer');
assert(Number.isInteger(loadedTarget) && loadedTarget >= 50 && loadedTarget <= 1000 && loadedTarget % 50 === 0, 'CU_LOADED_TARGET must be a multiple of 50 between 50 and 1000');
const scenarios = [
    { id: 'baseline50', source: baseline, native: 1000, visible: 50 },
    { id: 'candidate25', source: candidate, native: 1000, visible: 25 },
    { id: 'baseline25', source: baseline, native: 25, visible: 25 },
    { id: 'candidate25matched', source: candidate, native: 25, visible: 25 },
].filter(scenario => !process.env.CU_SCENARIO || scenario.id === process.env.CU_SCENARIO);
assert(scenarios.length > 0, 'Unknown CU_SCENARIO');
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const idle = page => page.waitForFunction(() => window.cuAggressiveReady && !window.cuAggressiveSelecting && !window.cuAggressiveSaveCalls);
const settled = async (page, count) => {
    await idle(page);
    await page.waitForFunction(count => document.querySelectorAll('#chat > .mes').length === count && !document.querySelector('#chat > .mes > .mesAvatarWrapper'), count);
    await frames(page);
};
const stats = page => page.evaluate(() => ({
    total: SillyTavern.getContext().chat.length,
    firstMessage: SillyTavern.getContext().chat[0]?.mes,
    lastMessage: SillyTavern.getContext().chat.at(-1)?.mes,
    displayed: document.querySelectorAll('#chat > .mes').length,
    ids: [...document.querySelectorAll('#chat > .mes')].map(element => Number(element.getAttribute('mesid'))),
    elements: document.querySelectorAll('#chat *').length,
    reasoningSvg: document.querySelectorAll('#chat .cu-reasoning-icon svg').length,
    nativeWindow: SillyTavern.getContext().powerUserSettings.chat_truncation,
    more: !!document.getElementById('show_more_messages'),
    keyboard: window.cuAggressiveDiagnostics ? { ...window.cuAggressiveKeyboard } : null,
    longTasksSupported: PerformanceObserver.supportedEntryTypes.includes('longtask'),
    tasks: window.cuAggressiveTasks.filter(task => task.start >= window.cuAggressiveStart),
}));
const reset = page => page.evaluate(() => {
    window.cuAggressiveKeyboard = { calls: 0, records: 0, ms: 0 };
    window.cuAggressiveStart = performance.now();
});
try {
    for (let run = 1; run <= repeats; run++) for (const scenario of scenarios) {
        const context = await browser.newContext({ viewport: { width: 412, height: 950 }, isMobile: true, hasTouch: true, locale: 'zh-CN' });
        await context.addInitScript(({ diagnostics }) => {
            localStorage.setItem('language', 'zh-cn');
            window.cuAggressiveDiagnostics = diagnostics;
            window.cuAggressiveTasks = []; window.cuAggressiveKeyboard = { calls: 0, records: 0, ms: 0 };
            if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => {
                for (const task of list.getEntries()) window.cuAggressiveTasks.push({ start: task.startTime, duration: task.duration });
            }).observe({ type: 'longtask', buffered: true });
        }, { diagnostics });
        const errors = [], loads = [];
        const messages = Array.from({ length: 1000 }, (_, index) => ({ name: index % 2 ? 'User' : 'Seraphina', is_user: !!(index % 2), is_system: false, send_date: '2026-11-14', mes: `Message ${index + 1}\n\n> Quoted text\n\n${'长聊天性能测试，保留原生数据与编辑行为。'.repeat(6)}`, extra: index % 4 === 0 ? { reasoning: `Reasoning ${index + 1}` } : {} }));
        await context.route('**/api/settings/get', async route => {
            const response = await route.fetch(), data = await response.json(), settings = JSON.parse(data.settings);
            settings.firstRun = false; settings.main_api = 'openai'; settings.active_character = null; settings.active_group = null;
            settings.power_user.chat_truncation = scenario.native; settings.power_user.auto_scroll_chat_to_bottom = true;
            if (settings.power_user.reasoning) settings.power_user.reasoning.auto_expand = false;
            settings.extension_settings.claude_surface = { enabled: true, design: 'claude', mode: 'dark', nativePerformance: true };
            settings.extension_settings.disabledExtensions = ['third-party/ST-BaiBai-Book', 'third-party/ST-BaiBai-Tools'];
            data.settings = JSON.stringify(settings); await route.fulfill({ response, json: data });
        });
        await context.route(/\/api\/(settings|themes|chats|groups|characters)\/(save|edit|delete|merge-attributes)(\?|$)/, route => route.fulfill({ json: { result: 'ok' } }));
        await context.route(/\/api\/extensions\/(install|update|delete|switch|move)(\?|$)/, route => route.abort());
        await context.route(/\/api\/tokenizers\/openai\/count(?:\?|$)/, route => route.fulfill({ json: { token_count: 42 } }));
        await context.route(/\/api\/.*(?:generate|completion)/, route => route.fulfill({ status: 503, body: 'Performance test: generation disabled' }));
        await context.route('**/api/extensions/version', route => route.fulfill({ json: { isUpToDate: true } }));
        await context.route('**/api/groups/all', route => route.fulfill({ json: [] }));
        await context.route('**/api/characters/get', async route => { const response = await route.fetch(), data = await response.json(); data.chat = 'Aggressive History'; await route.fulfill({ response, json: data }); });
        await context.route('**/api/chats/get', route => { loads.push(route.request().postDataJSON().file_name); return route.fulfill({ json: [{ user_name: 'User', character_name: 'Seraphina', chat_metadata: { tainted: true } }, ...messages] }); });
        await context.route('**/api/chats/recent', route => route.fulfill({ json: [{ avatar: 'default_Seraphina.png', file_name: 'Aggressive History.jsonl', chat_items: 1000, last_mes: '2026-11-14', mes: 'fixture' }] }));
        await context.route('**/script.js', async route => {
            const response = await route.fetch(); let body = await response.text();
            body = body.replace('export async function saveChatConditional() {', 'export async function saveChatConditional() { window.cuAggressiveSaveCalls=(window.cuAggressiveSaveCalls||0)+1;try {');
            const end = body.indexOf('\n}', body.indexOf('export async function saveChatConditional() {'));
            assert(end > 0, 'Native save instrumentation target missing');
            body = body.slice(0, end) + '\n}finally{window.cuAggressiveSaveCalls--}' + body.slice(end);
            body += '\neventSource.on(event_types.APP_READY,()=>window.cuAggressiveReady=true);';
            await route.fulfill({ response, body, contentType: 'text/javascript' });
        });
        if (diagnostics) await context.route('**/scripts/keyboard.js', async route => {
            const response = await route.fetch(); let body = await response.text();
            const start = 'const observer = new MutationObserver(mutations => {';
            assert(body.includes(start), 'Native keyboard instrumentation target missing');
            body = body.replace(start, start + ' const cuStart=performance.now();try {');
            const end = body.indexOf('\n});', body.indexOf(start)); assert(end > 0);
            body = body.slice(0, end) + '\n}finally{const item=window.cuAggressiveKeyboard;item.calls++;item.records+=mutations.length;item.ms+=performance.now()-cuStart;}' + body.slice(end);
            await route.fulfill({ response, body, contentType: 'text/javascript' });
        });
        await context.route('**/scripts/extensions/third-party/claude-surface/**', async route => {
            const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/claude-surface/')[1]), file = path.resolve(scenario.source, relative);
            if (!file.startsWith(path.resolve(scenario.source) + path.sep)) return route.abort();
            try {
                let body = await fs.readFile(file);
                if (relative === 'index.js') body += '\nObject.defineProperty(window,"cuAggressiveSelecting",{get:()=>!!state.selecting});';
                await route.fulfill({ body, contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/json' });
            } catch { await route.abort(); }
        });
        const page = await context.newPage(); page.setDefaultTimeout(60000); page.on('pageerror', error => errors.push(String(error)));
        const result = { id: scenario.id, source: scenario.source, originalWindow: scenario.native, expectedWindow: scenario.visible, run }; report.cases.push(result);
        try {
            await page.goto(process.env.CU_TEST_URL || 'http://127.0.0.1:8010', { waitUntil: 'networkidle' });
            await idle(page); await page.waitForFunction(() => document.querySelector('.cu-recents .cu-character-row'));
            await page.locator('.cu-home-history-toggle').click(); await reset(page);
            const start = Date.now();
            await page.locator('.cu-home-history').getByRole('button', { name: 'Seraphina', exact: true }).click();
            await settled(page, scenario.visible);
            await page.waitForFunction(() => { const element = document.getElementById('chat'); return Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 3; });
            result.navigation = { ms: Date.now() - start, ...await stats(page) };
            assert.equal(result.navigation.total, 1000); assert.equal(result.navigation.nativeWindow, scenario.visible);
            assert.deepEqual(result.navigation.ids, Array.from({ length: scenario.visible }, (_, index) => 1000 - scenario.visible + index));
            assert.deepEqual(loads, ['Aggressive History']); assert.equal(result.navigation.firstMessage, messages[0].mes); assert.equal(result.navigation.lastMessage, messages.at(-1).mes);
            if (navigationOnly) result.functionalStagesSkipped = ['older-history', 'append'];
            if (!navigationOnly && run === 1) {
                await reset(page); const startMore = Date.now(); const deltas = [];
                let displayed = scenario.visible;
                while (displayed < loadedTarget) {
                    const first = await page.locator('#chat > .mes').first().elementHandle();
                    await page.locator('#show_more_messages').scrollIntoViewIfNeeded();
                    const top = await first.evaluate(element => element.getBoundingClientRect().top);
                    await page.locator('#show_more_messages').click(); displayed += scenario.visible;
                    await settled(page, displayed);
                    const delta = await first.evaluate(element => element.getBoundingClientRect().top) - top;
                    assert(Math.abs(delta) < 3, `Loading older messages moved anchor by ${delta}`); deltas.push(delta);
                }
                result.older = { ms: Date.now() - startMore, target: loadedTarget, anchorDeltas: deltas, ...await stats(page) };
                assert.equal(result.older.total, 1000);
                await page.locator('#chat').evaluate(element => { element.scrollTop = element.scrollHeight; }); await frames(page); await reset(page);
                const startAppend = Date.now();
                await page.evaluate(() => { const context = SillyTavern.getContext(); const message = { name: 'User', is_user: true, is_system: false, send_date: '2026-11-14', mes: 'Appended fixture message', extra: {} }; context.chat.push(message); context.addOneMessage(message); });
                await settled(page, displayed + 1);
                result.append = { ms: Date.now() - startAppend, ...await stats(page) };
                assert.equal(result.append.total, 1001); assert.equal(result.append.lastMessage, 'Appended fixture message');
            }
            result.errors = errors; assert.deepEqual(errors, []);
            console.log(JSON.stringify({ id: result.id, run, navigationMs: result.navigation.ms, elements: result.navigation.elements, keyboardMs: result.navigation.keyboard?.ms, olderMs: result.older?.ms, errors }));
        } catch (error) {
            result.error = String(error); result.errors = errors;
            await page.screenshot({ path: path.join(output, `${scenario.id}-${run}-failure.png`) }).catch(() => {}); throw error;
        } finally {
            await context.close(); report.endedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2));
        }
    }
} finally { await browser.close(); }
