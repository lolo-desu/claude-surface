/** Native performance opt-in: full chat data, smaller render window and reversible
 * native preference ownership. Requires local ST + default Seraphina. All fixture
 * chat/card/settings writes are intercepted. CU_PERF_REPEAT repeats measurements;
 * CU_PERF_QUICK skips the full1000 off case for quick functional checks.
 * Explicit CU_EXPECTED_CAP/CU_EXPECTED_FPS permit testing an older50/30 source
 * without importing its implementation constants. CU_PERF_CASES filters IDs;
 * CU_PERF_TOTAL=10000 checks complete larger history with the same native path.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const engines = await import(process.env.CU_PLAYWRIGHT_MODULE || 'playwright');
const source = path.resolve(process.env.CU_SOURCE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const output = process.env.CU_TEST_OUTPUT || path.join(source, 'artifacts/native-performance');
await fs.mkdir(output, { recursive: true });
const engine = process.env.CU_ENGINE || 'chromium';
const expectedCap = Number(process.env.CU_EXPECTED_CAP || 25);
const expectedFPS = Number(process.env.CU_EXPECTED_FPS || 10);
const total = Number(process.env.CU_PERF_TOTAL || 1000);
assert(Number.isInteger(expectedCap) && expectedCap > 0, 'CU_EXPECTED_CAP must be a positive integer');
assert(Number.isFinite(expectedFPS) && expectedFPS > 0, 'CU_EXPECTED_FPS must be positive');
assert(Number.isInteger(total) && total >= 1000, 'CU_PERF_TOTAL must be an integer of at least1000');
const executable = process.env[engine === 'webkit' ? 'CU_WEBKIT_EXECUTABLE' : 'CU_CHROMIUM_EXECUTABLE'];
const browser = await engines[engine].launch({ headless: true, ...(executable ? { executablePath: executable } : {}) });
const report = { source, engine, expectedCap, expectedFPS, total, browser: browser.version(), startedAt: new Date().toISOString(), cpuProfiler: false, cases: [] };
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const selectedCases = process.env.CU_PERF_CASES?.split(',');
const scenarios = [
    { id: 'default-off', limit: 100 },
    ...process.env.CU_PERF_QUICK ? [] : [{ id: 'off-full1000', limit: 1000, mode: false }],
    { id: 'on-full1000', limit: 1000, mode: true },
    { id: 'on-default100', limit: 100, mode: true, functional: true },
    { id: 'on-user30', limit: 30, mode: true },
    { id: 'on-user20', limit: 20, mode: true },
    { id: 'on-unlimited', limit: 0, mode: true },
].filter(scenario => !selectedCases || selectedCases.includes(scenario.id));
const repeat = Number(process.env.CU_PERF_REPEAT || 1);
assert(scenarios.length > 0, 'CU_PERF_CASES matched no test scenarios');
assert(Number.isInteger(repeat) && repeat > 0, 'CU_PERF_REPEAT must be a positive integer');
const message = i => ({ name: i % 2 ? 'User' : 'Seraphina', is_user: !!(i % 2), is_system: false, send_date: '2026-11-11T12:00:00Z', mes: `Message ${i + 1}\n\n"Quoted text"\n\n${'长聊天性能测试，保留原生数据与编辑行为。'.repeat(6)}`, extra: {} });
const snapshot = page => page.evaluate(() => {
    const context = SillyTavern.getContext();
    return {
        total: context.chat.length, visible: document.querySelectorAll('#chat>.mes').length,
        native: context.powerUserSettings.chat_truncation,
        fps: context.powerUserSettings.streaming_fps,
        config: structuredClone(context.extensionSettings.claude_surface),
        ids: [...document.querySelectorAll('#chat>.mes')].map(element => Number(element.getAttribute('mesid'))),
        more: !!document.getElementById('show_more_messages'), elements: document.querySelectorAll('#chat *').length,
    };
});
const idle = page => page.waitForFunction(() => window.cuNativeReady && !window.cuNativeSelecting && !window.cuNativeSaveCalls);
const appearance = async page => {
    if (!await page.locator('#cu-native-performance').isVisible()) {
        await page.locator('.cu-header button[aria-label="更多"]').click();
        await page.locator('.cu-sheet').getByRole('button', { name: '主题设置', exact: true }).click();
    }
};
const mode = async (page, enabled) => {
    await appearance(page);
    await page.locator('#cu-native-performance').setChecked(enabled);
    await frames(page);
};
const dismiss = async page => {
    if (await page.locator('.cu-sheet-panel').count()) {
        await page.locator('.cu-sheet-panel').press('Escape');
        await page.locator('.cu-sheet').waitFor({ state: 'hidden' });
    }
};

try {
    for (let run = 1; run <= repeat; run++) for (const scenario of scenarios) {
        const context = await browser.newContext({ viewport: { width: 412, height: 950 }, isMobile: true, hasTouch: true, locale: 'zh-CN' });
        await context.addInitScript(() => {
            localStorage.setItem('language', 'zh-cn'); window.cuNativeTasks = [];
            if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => {
                for (const task of list.getEntries()) window.cuNativeTasks.push({ start: task.startTime, duration: task.duration });
            }).observe({ type: 'longtask', buffered: true });
        });
        const loads = [], groupLoads = [], settingsWrites = [], errors = [];
        const messages = Array.from({ length: total }, (_, i) => message(i));
        const group = { id: 'perf-group', name: 'Performance Group', members: ['default_Seraphina.png'], disabled_members: [], chat_id: 'Group Default', chats: ['Group Default', 'Group History'], chat_metadata: {}, past_metadata: {}, allow_self_responses: false, generation_mode: 0, activation_strategy: 0 };
        let pointer = 'Default Fixture', reloadSettings;
        await context.route('**/api/groups/all', route => route.fulfill({ json: [group] }));
        // Opening native settings/character definitions can schedule unrelated
        // token-counter XHRs. Keep those deterministic and local in this fixture.
        await context.route(/\/api\/tokenizers\/openai\/count(?:\?|$)/, route => route.fulfill({ json: { token_count: 42 } }));
        await context.route('**/api/groups/edit', route => { Object.assign(group, route.request().postDataJSON()); return route.fulfill({ json: { result: 'ok' } }); });
        await context.route('**/api/settings/get', async route => {
            const response = await route.fetch(), data = await response.json(), settings = reloadSettings || JSON.parse(data.settings);
            if (!reloadSettings) {
                settings.firstRun = false; settings.main_api = 'openai';
                settings.power_user.chat_truncation = scenario.limit;
                settings.power_user.streaming_fps = 30;
                settings.power_user.auto_scroll_chat_to_bottom = true;
                settings.extension_settings.claude_surface = { enabled: true, design: 'claude', mode: 'dark', ...(scenario.mode === undefined ? {} : { nativePerformance: scenario.mode }) };
                settings.extension_settings.disabledExtensions = ['third-party/ST-BaiBai-Book', 'third-party/ST-BaiBai-Tools'];
            }
            data.settings = JSON.stringify(settings); await route.fulfill({ response, json: data });
        });
        await context.route('**/api/settings/save', route => {
            let body = route.request().postDataBuffer();
            if (route.request().headers()['content-encoding'] === 'gzip') body = gunzipSync(body);
            settingsWrites.push(JSON.parse(body.toString()));
            return route.fulfill({ json: { result: 'ok' } });
        });
        for (const endpoint of ['themes/save', 'extensions/version']) await context.route('**/api/' + endpoint, route => route.fulfill({ json: { result: 'ok', isUpToDate: true } }));
        await context.route(/\/api\/(chats|groups|chat-completions)\/(save|edit|generate)(\?|$)/, route => route.fulfill({ json: { result: 'ok' } }));
        await context.route('**/api/characters/get', async route => { const response = await route.fetch(), data = await response.json(); data.chat = pointer; await route.fulfill({ response, json: data }); });
        await context.route('**/api/characters/merge-attributes', route => { pointer = route.request().postDataJSON().chat; return route.fulfill({ json: { result: 'ok' } }); });
        await context.route('**/api/characters/edit', route => route.fulfill({ json: { result: 'ok' } }));
        await context.route('**/api/chats/get', route => { loads.push(route.request().postDataJSON().file_name); return route.fulfill({ json: [{ user_name: 'User', character_name: 'Seraphina', chat_metadata: { tainted: true } }, ...messages] }); });
        await context.route('**/api/chats/group/get', route => { groupLoads.push(route.request().postDataJSON().id); return route.fulfill({ json: [{ chat_metadata: { tainted: true } }, ...messages] }); });
        await context.route('**/api/chats/recent', route => route.fulfill({ json: [
            { avatar: 'default_Seraphina.png', file_name: 'Performance History.jsonl', chat_items: total, last_mes: '2026-11-11', mes: 'fixture' },
            { group: 'perf-group', file_name: 'Group History.jsonl', chat_items: total, last_mes: '2026-11-11', mes: 'group fixture' },
        ] }));
        await context.route('**/script.js', async route => {
            const response = await route.fetch(); let body = await response.text();
            body = body.replace('export async function saveChatConditional() {', 'export async function saveChatConditional() { window.cuNativeSaveCalls=(window.cuNativeSaveCalls||0)+1;try {');
            const end = body.indexOf('\n}', body.indexOf('export async function saveChatConditional() {'));
            assert(end > 0, 'Native save fixture instrumentation target missing');
            body = body.slice(0, end) + '\n}finally{window.cuNativeSaveCalls--}' + body.slice(end);
            body += '\neventSource.on(event_types.APP_READY,()=>window.cuNativeReady=true);';
            await route.fulfill({ response, body, contentType: 'text/javascript' });
        });
        await context.route('**/scripts/extensions/third-party/claude-surface/**', async route => {
            const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/claude-surface/')[1]);
            const file = path.resolve(source, relative); if (!file.startsWith(source + path.sep)) return route.abort();
            try { let body = await fs.readFile(file); if (relative === 'index.js') body += '\nObject.defineProperty(window,"cuNativeSelecting",{get:()=>!!state.selecting});'; await route.fulfill({ body, contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/json' }); } catch { await route.abort(); }
        });
        const page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(String(error)));
        const result = { ...scenario, run }; report.cases.push(result);
        try {
            await page.goto(process.env.CU_TEST_URL || 'http://127.0.0.1:8010', { waitUntil: 'networkidle' });
            await idle(page); await page.waitForFunction(() => document.querySelector('.cu-home-history-toggle') && document.querySelector('.cu-recents .cu-character-row'));
            await page.locator('.cu-home-history-toggle').click();
            const start = await page.evaluate(() => performance.now()), startTime = Date.now();
            await page.locator('.cu-home-history').getByRole('button', { name: 'Seraphina', exact: true }).click();
            await idle(page); const expected = scenario.mode ? Math.min(scenario.limit || total, expectedCap) : (scenario.limit || total);
            await page.waitForFunction(n => document.querySelectorAll('#chat>.mes').length === n && !document.querySelector('#chat>.mes>.mesAvatarWrapper'), expected);
            await page.waitForFunction(() => { const chat = document.getElementById('chat'); return Math.abs(chat.scrollHeight - chat.clientHeight - chat.scrollTop) <= 2; });
            await frames(page);
            result.navigation = {
                ms: Date.now() - startTime, startedAt: new Date(startTime).toISOString(), endedAt: new Date().toISOString(),
                longTasksSupported: await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes('longtask')),
                tasks: await page.evaluate(t => window.cuNativeTasks.filter(task => task.start >= t), start), ...await snapshot(page),
            };
            assert.equal(result.navigation.total, total); assert.equal(result.navigation.visible, expected); assert.equal(result.navigation.native, expected);
            assert.equal(result.navigation.fps, scenario.mode ? expectedFPS : 30);
            assert.deepEqual(result.navigation.ids, Array.from({ length: expected }, (_, i) => total - expected + i)); assert.deepEqual(loads, ['Performance History']);
            if (scenario.mode && (scenario.limit === 0 || scenario.limit > expectedCap)) assert.deepEqual(result.navigation.config.nativePerformanceRestore, { original: scenario.limit, applied: expectedCap });
            else assert.equal(result.navigation.config.nativePerformanceRestore, undefined);
            if (scenario.mode && expectedFPS < 30) assert.deepEqual(result.navigation.config.nativeStreamingRestore, { original: 30, applied: expectedFPS });
            else assert.equal(result.navigation.config.nativeStreamingRestore, undefined);
            if (scenario.functional && run === 1) {
                const initialCount = result.navigation.visible;
                const first = await page.locator('#chat>.mes').first().elementHandle();
                await page.locator('#show_more_messages').scrollIntoViewIfNeeded();
                const top = await first.evaluate(element => element.getBoundingClientRect().top);
                await page.locator('#show_more_messages').click();
                await page.waitForFunction(n => document.querySelectorAll('#chat>.mes').length === n, initialCount + expectedCap); await frames(page);
                result.more = { anchorDelta: await first.evaluate(element => element.getBoundingClientRect().top) - top, ...await snapshot(page) };
                assert(Math.abs(result.more.anchorDelta) < 3, 'Native Show more moved the reading anchor'); assert.equal(result.more.total, total);
                await mode(page, false); assert.deepEqual([(await snapshot(page)).native, (await snapshot(page)).fps], [100, 30]); assert.equal(loads.length, 1, 'Changing mode reloaded the chat');
                await mode(page, true); assert.equal((await snapshot(page)).native, expectedCap);
                // Explicitly selecting the current cap relinquishes the older preference.
                await page.evaluate(cap => { const input = document.getElementById('chat_truncation'); input.value = String(cap); input.dispatchEvent(new Event('input', { bubbles: true })); }, expectedCap); await frames(page);
                await mode(page, false); assert.equal((await snapshot(page)).native, expectedCap);
                await page.evaluate(() => { const input = document.getElementById('chat_truncation'); input.value = '200'; input.dispatchEvent(new Event('input', { bubbles: true })); });
                await mode(page, true); assert.equal((await snapshot(page)).native, expectedCap);
                // Native numeric-counter commits use jQuery input rather than DOM dispatch.
                await page.evaluate(() => jQuery('#chat_truncation').val('300').trigger('input', { forced: true })); await frames(page);
                assert.equal((await snapshot(page)).native, expectedCap); assert.deepEqual((await snapshot(page)).config.nativePerformanceRestore, { original: 300, applied: expectedCap });
                if (expectedFPS === 10) {
                    await page.evaluate(() => jQuery('#streaming_fps').val('5').trigger('input', { forced: true }));
                    assert.equal((await snapshot(page)).fps, 5); assert.equal((await snapshot(page)).config.nativeStreamingRestore, undefined);
                    await mode(page, false); assert.equal((await snapshot(page)).fps, 5);
                    await page.evaluate(() => jQuery('#streaming_fps').val('30').trigger('input', { forced: true })); await mode(page, true);
                    assert.deepEqual((await snapshot(page)).config.nativeStreamingRestore, { original: 30, applied: 10 });
                    await page.evaluate(() => jQuery('#streaming_fps').val('10').trigger('input', { forced: true })); await mode(page, false);
                    assert.equal((await snapshot(page)).fps, 10);
                    await page.evaluate(() => jQuery('#streaming_fps').val('30').trigger('input', { forced: true })); await mode(page, true);
                }
                // Other extensions may change the plain native setting programmatically.
                await page.evaluate(() => { SillyTavern.getContext().powerUserSettings.chat_truncation = 75; });
                await mode(page, false); assert.equal((await snapshot(page)).native, 75, 'External native preference was overwritten');
                await mode(page, true); await dismiss(page);
                // New saved session retains ownership information and returns the original75 on off.
                await page.evaluate(() => SillyTavern.getContext().saveSettingsDebounced());
                const persisted = await page.evaluate(async () => { const host = await import('/script.js'); await host.saveSettings(); return true; }); assert(persisted);
                await page.waitForFunction(() => !window.cuNativeSaveCalls);
                assert(settingsWrites.length > 0); reloadSettings = settingsWrites.at(-1);
                assert.equal(reloadSettings.power_user.chat_truncation, expectedCap); assert.deepEqual(reloadSettings.extension_settings.claude_surface.nativePerformanceRestore, { original: 75, applied: expectedCap });
                assert.equal(reloadSettings.power_user.streaming_fps, expectedFPS);
                if (expectedFPS < 30) assert.deepEqual(reloadSettings.extension_settings.claude_surface.nativeStreamingRestore, { original: 30, applied: expectedFPS });
                await page.reload({ waitUntil: 'networkidle' }); await idle(page); await page.waitForFunction(() => !!document.querySelector('.cu-header'));
                assert.equal((await snapshot(page)).native, expectedCap); await mode(page, false); assert.deepEqual([(await snapshot(page)).native, (await snapshot(page)).fps], [75, 30]);
                await mode(page, true); await dismiss(page);
                await page.locator('.cu-header .cu-home-action').click(); await idle(page);
                await page.locator('.cu-home-history-toggle').click();
                await page.locator('.cu-home-history').getByRole('button', { name: 'Performance Group', exact: true }).click(); await idle(page);
                await page.waitForFunction(cap => SillyTavern.getContext().groupId === 'perf-group' && document.querySelectorAll('#chat>.mes').length === cap, expectedCap); await frames(page);
                result.group = await snapshot(page); assert.equal(result.group.total, total); assert.deepEqual(groupLoads, ['Group History']);
                await page.evaluate(() => { const input = document.getElementById('cu-extension-enabled'); input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); }); await frames(page);
                assert.deepEqual([(await snapshot(page)).native, (await snapshot(page)).fps], [75, 30], 'Disabling Surface did not restore both native preferences');
                await page.evaluate(() => { const input = document.getElementById('cu-extension-enabled'); input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); }); await frames(page);
                assert.deepEqual([(await snapshot(page)).native, (await snapshot(page)).fps], [expectedCap, expectedFPS]);
                // Run the real native disable API, whose manifest hook must restore before its save.
                await page.evaluate(async () => { const extensions = await import('/scripts/extensions.js'); await extensions.disableExtension('third-party/claude-surface', false); });
                assert.equal((await snapshot(page)).native, 75); assert.equal((await snapshot(page)).config.nativePerformance, false);
                assert.equal(settingsWrites.at(-1).power_user.chat_truncation, 75, 'Native disable saved the temporary cap');
                assert.equal(settingsWrites.at(-1).power_user.streaming_fps, 30, 'Native disable saved the temporary FPS');
                result.functional = 'PASS';
            }
            assert.deepEqual(errors, []); result.errors = errors; console.log('PASS', scenario.id, run, result.navigation.ms, 'ms');
            await page.screenshot({ path: path.join(output, `${scenario.id}-${run}.png`) });
        } catch (error) { result.error = String(error); result.errors = errors; await page.screenshot({ path: path.join(output, `${scenario.id}-${run}-failure.png`) }).catch(() => {}); throw error; }
        finally { await context.close(); await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2)); }
    }
} finally { await browser.close(); report.endedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2)); }
