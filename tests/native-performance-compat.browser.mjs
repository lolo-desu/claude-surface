/** Native performance preference ownership against real SillyTavern handlers.
 * Native settings/chat/card/delete writes and generation are intercepted.
 * Supports CU_SOURCE, CU_TEST_URL, CU_TEST_OUTPUT and standard browser flags.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const { chromium, webkit } = await import(process.env.CU_PLAYWRIGHT_MODULE || 'playwright');
const source = path.resolve(process.env.CU_SOURCE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const output = process.env.CU_TEST_OUTPUT || path.join(source, 'artifacts/native-performance-compat');
await fs.mkdir(output, { recursive: true });
const engine = process.env.CU_ENGINE || 'chromium';
const coldOnly = !!process.env.CU_COMPAT_COLD_ONLY;
const executablePath = process.env[engine === 'webkit' ? 'CU_WEBKIT_EXECUTABLE' : 'CU_CHROMIUM_EXECUTABLE'];
const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const report = { source, engine, checks: [], errors: [], saved: [], deleteRequests: 0, routedIndexHashes: [] };
const recordIndex = body => { const hash = createHash('sha256').update(body).digest('hex'); if (!report.routedIndexHashes.includes(hash)) report.routedIndexHashes.push(hash); };
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, locale: 'en-US' });
const messages = Array.from({ length: 180 }, (_, i) => ({ name: i % 2 ? 'User' : 'Seraphina', is_user: !!(i % 2), is_system: false, send_date: '2026-11-14', mes: `Message ${i + 1}\n\n${'Native compatibility content. '.repeat(8)}`, extra: {} }));
const summary = payload => ({ native: payload.power_user.chat_truncation, fps: payload.power_user.streaming_fps, enabled: payload.extension_settings.claude_surface.nativePerformance, backup: payload.extension_settings.claude_surface.nativePerformanceRestore, streamingBackup: payload.extension_settings.claude_surface.nativeStreamingRestore, disabled: payload.extension_settings.disabledExtensions });
await context.addInitScript(() => localStorage.setItem('language', 'en'));
await context.route('**/api/settings/get', async route => {
    const response = await route.fetch(), data = await response.json(), settings = JSON.parse(data.settings);
    settings.firstRun = false; settings.main_api = 'openai'; settings.active_character = null; settings.active_group = null;
    settings.power_user.chat_truncation = 1000; settings.power_user.streaming_fps = 30;
    settings.extension_settings.claude_surface = { enabled: true, mode: 'dark' };
    settings.extension_settings.disabledExtensions = ['third-party/ST-BaiBai-Book', 'third-party/ST-BaiBai-Tools'];
    data.settings = JSON.stringify(settings); await route.fulfill({ response, json: data });
});
await context.route(/\/api\/tokenizers\/openai\/count(?:\?|$)/, route => route.fulfill({ json: { token_count: 42 } }));
await context.route(/\/api\/(settings|themes|chats|groups|characters)\/(save|edit|delete|merge-attributes)(\?|$)/, async route => {
    if (new URL(route.request().url()).pathname === '/api/settings/save') {
        let body = route.request().postDataBuffer();
        if (route.request().headers()['content-encoding'] === 'gzip') body = gunzipSync(body);
        report.saved.push(summary(JSON.parse(body.toString())));
    }
    await route.fulfill({ json: { result: 'ok' } });
});
await context.route('**/api/extensions/delete', route => { report.deleteRequests++; return route.fulfill({ json: { result: 'ok' } }); });
await context.route(/\/api\/extensions\/(install|update|switch|move)(\?|$)/, route => route.abort());
await context.route(/\/api\/.*(?:generate|completion)/, route => route.fulfill({ status: 503, body: 'Compatibility test: generation disabled' }));
await context.route('**/api/extensions/version', route => route.fulfill({ json: { isUpToDate: true } }));
await context.route('**/api/chats/get', route => route.fulfill({ json: [{ user_name: 'User', character_name: 'Seraphina', chat_metadata: { tainted: true } }, ...messages] }));
await context.route('**/api/chats/recent', route => route.fulfill({ json: [] }));
await context.route('**/scripts/extensions/third-party/claude-surface/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/claude-surface/')[1]), filename = path.resolve(source, relative);
    if (!filename.startsWith(source + path.sep)) return route.abort();
    try {
        let body = await fs.readFile(filename);
        if (relative === 'index.js') { recordIndex(body); body = body.toString() + '\nSillyTavern.getContext().eventSource.on(SillyTavern.getContext().eventTypes.APP_READY,()=>window.cuNativeCompatReady=true);'; }
        await route.fulfill({ body, contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/json' });
    } catch { await route.abort(); }
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', error => report.errors.push(String(error)));
const snapshot = () => page.evaluate(() => {
    const c = SillyTavern.getContext(), config = c.extensionSettings.claude_surface;
    return { native: c.powerUserSettings.chat_truncation, fps: c.powerUserSettings.streaming_fps, enabled: config.nativePerformance, backup: config.nativePerformanceRestore, streamingBackup: config.nativeStreamingRestore, displayed: document.querySelectorAll('#chat > .mes').length, total: c.chat.length, performanceClass: document.body.hasAttribute('data-cu-performance'), maskClass: document.body.hasAttribute('data-cu-reasoning-masks') };
});
const check = (name, value, expected) => { assert.deepEqual(value, expected, name); report.checks.push(name); };
const setMode = enabled => page.evaluate(enabled => { const input = document.getElementById('cu-extension-native-performance'); input.checked = enabled; input.dispatchEvent(new Event('change', { bubbles: true })); }, enabled);
const input = value => page.evaluate(value => window.jQuery('#chat_truncation').val(value).trigger('input', { forced: true }), value);
const fpsInput = value => page.evaluate(value => window.jQuery('#streaming_fps').val(value).trigger('input', { forced: true }), value);
const forceSave = () => page.evaluate(async () => { const host = await import('/script.js'); await host.saveSettings(); });
async function coldHookScenario() {
    const coldContext = await browser.newContext({ viewport: { width: 393, height: 852 }, locale: 'en-US' });
    await coldContext.addInitScript(() => localStorage.setItem('language', 'en'));
    await coldContext.route('**/api/settings/get', async route => {
        const response = await route.fetch(), data = await response.json(), config = JSON.parse(data.settings);
        config.firstRun = false; config.active_character = null; config.active_group = null;
        config.power_user.chat_truncation = 50; config.power_user.streaming_fps = 10;
        config.extension_settings.claude_surface = { enabled: true, nativePerformance: true, nativePerformanceRestore: { original: 1000, applied: 50 }, nativeStreamingRestore: { original: 30, applied: 10 } };
        config.extension_settings.disabledExtensions = ['third-party/claude-surface', 'third-party/ST-BaiBai-Book', 'third-party/ST-BaiBai-Tools'];
        data.settings = JSON.stringify(config); await route.fulfill({ response, json: data });
    });
    await coldContext.route(/\/api\/tokenizers\/openai\/count(?:\?|$)/, route => route.fulfill({ json: { token_count: 42 } }));
    await coldContext.route('**/script.js', async route => {
        const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\neventSource.on(event_types.APP_READY,()=>window.cuColdCompatReady=true);', contentType: 'text/javascript' });
    });
    await coldContext.route(/\/api\/(settings|themes|chats|groups|characters)\/(save|edit|delete|merge-attributes)(\?|$)/, route => route.fulfill({ json: { result: 'ok' } }));
    await coldContext.route(/\/api\/extensions\/(install|update|delete|switch|move)(\?|$)/, route => route.abort());
    await coldContext.route('**/api/extensions/version', route => route.fulfill({ json: { isUpToDate: true } }));
    await coldContext.route('**/scripts/extensions/third-party/claude-surface/**', async route => {
        const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/claude-surface/')[1]), filename = path.resolve(source, relative);
        if (!filename.startsWith(source + path.sep)) return route.abort();
        try {
            let body = await fs.readFile(filename);
            if (relative === 'index.js') { recordIndex(body); body = body.toString().replace('jQuery(initialize);', 'window.cuColdInitialize = initialize;'); }
            await route.fulfill({ body, contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/json' });
        } catch { await route.abort(); }
    });
    const coldPage = await coldContext.newPage();
    coldPage.on('pageerror', error => report.errors.push(String(error)));
    try {
        await coldPage.goto(process.env.CU_TEST_URL || 'http://127.0.0.1:8010', { waitUntil: 'networkidle' });
        await coldPage.waitForFunction(() => window.cuColdCompatReady);
        report.cold = await coldPage.evaluate(async () => {
            const context = SillyTavern.getContext(), config = context.extensionSettings.claude_surface;
            const ownListeners = () => Object.values(window.jQuery._data(document, 'events') || {}).flat().filter(listener => listener.namespace?.split('.').includes('cuNativePerformance')).length;
            const before = ownListeners();
            const module = await import('/scripts/extensions/third-party/claude-surface/index.js');
            module.restoreNativePerformance();
            const result = { native: context.powerUserSettings.chat_truncation, fps: context.powerUserSettings.streaming_fps, enabled: config.nativePerformance, backup: config.nativePerformanceRestore, streamingBackup: config.nativeStreamingRestore, before, after: ownListeners() };
            window.cuColdInitialize();
            result.initializedUI = !!document.getElementById('cu-header');
            return result;
        });
        check('cold lifecycle hook restores legacy window and FPS before initialization', [report.cold.native, report.cold.fps, report.cold.enabled, report.cold.backup, report.cold.streamingBackup], [1000, 30, false, undefined, undefined]);
        check('temporary cold manager releases its delegated listener', [report.cold.before, report.cold.after], [0, 0]);
        check('initialization after cold removal does not recreate Surface UI', report.cold.initializedUI, false);
    } catch (error) {
        await coldPage.screenshot({ path: path.join(output, 'cold-failure.png') }).catch(() => {}); throw error;
    } finally { await coldContext.close(); }
}
try {
    if (!coldOnly) {
    await page.goto(process.env.CU_TEST_URL || 'http://127.0.0.1:8010', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.cuNativeCompatReady && document.getElementById('cu-extension-native-performance'));
    check('default off preserves both native preferences', await snapshot().then(s => [s.native, s.fps, s.enabled, s.backup, s.streamingBackup]), [1000, 30, false, undefined, undefined]);
    await page.evaluate(() => {
        const c = SillyTavern.getContext(), config = c.extensionSettings.claude_surface;
        c.powerUserSettings.chat_truncation = 50;
        config.nativePerformanceRestore = { original: 1000, applied: 50 };
    });
    await setMode(true);
    check('legacy applied50 upgrade retains original1000 while applying25', await snapshot().then(s => [s.native, s.backup]), [25, { original: 1000, applied: 25 }]);
    await setMode(false); check('legacy upgrade restores original1000 on off', await snapshot().then(s => [s.native, s.fps]), [1000, 30]);
    await input(50); await setMode(true);
    check('manual native50 without backup is adopted as original50', await snapshot().then(s => [s.native, s.backup]), [25, { original: 50, applied: 25 }]);
    await setMode(false); check('manual50 survives aggressive mode release', await snapshot().then(s => [s.native, s.fps]), [50, 30]);
    await input(1000); await setMode(true);
    check('enabling records both originals alongside native limits', await snapshot().then(s => [s.native, s.fps, s.enabled, s.backup, s.streamingBackup]), [25, 10, true, { original: 1000, applied: 25 }, { original: 30, applied: 10 }]);
    await forceSave(); check('native save retains both restoration records', [report.saved.at(-1).backup, report.saved.at(-1).streamingBackup], [{ original: 1000, applied: 25 }, { original: 30, applied: 10 }]);
    await input(200);
    check('native jQuery slider input adopts newer window preference', await snapshot().then(s => [s.native, s.backup, s.streamingBackup]), [25, { original: 200, applied: 25 }, { original: 30, applied: 10 }]);
    await page.evaluate(() => window.jQuery('#chat_truncation_counter').val('350').trigger('keyup').trigger('blur'));
    check('native numeric commit is observed after jQuery master input', await snapshot().then(s => [s.native, s.backup]), [25, { original: 350, applied: 25 }]);
    await fpsInput(60);
    check('native FPS input adopts newer preference without losing window backup', await snapshot().then(s => [s.fps, s.streamingBackup, s.backup]), [10, { original: 60, applied: 10 }, { original: 350, applied: 25 }]);
    await page.evaluate(() => window.jQuery('#streaming_fps_counter').val('45').trigger('keyup').trigger('blur'));
    check('native FPS numeric counter commits through jQuery input', await snapshot().then(s => [s.fps, s.streamingBackup]), [10, { original: 45, applied: 10 }]);
    await fpsInput(5);
    check('lower native5FPS remains user-owned', await snapshot().then(s => [s.fps, s.streamingBackup, s.backup]), [5, undefined, { original: 350, applied: 25 }]);
    await setMode(false); check('mode off retains lower5FPS', await snapshot().then(s => [s.native, s.fps]), [350, 5]);
    await fpsInput(30); await setMode(true); await fpsInput(10); await setMode(false);
    check('explicit native10FPS relinquishes old30FPS restore preference', await snapshot().then(s => [s.fps, s.streamingBackup]), [10, undefined]);
    await fpsInput(30); await setMode(true); await input(25); await setMode(false);
    check('explicit choice of current cap survives release independently of FPS', await snapshot().then(s => [s.native, s.fps, s.backup, s.streamingBackup]), [25, 30, undefined, undefined]);
    await setMode(true); await input(20); await setMode(false);
    check('smaller native preference remains user-owned', await snapshot().then(s => [s.native, s.backup]), [20, undefined]);
    await input(0); await setMode(true); await setMode(false);
    check('show all preference zero restores exactly', await snapshot().then(s => [s.native, s.backup]), [0, undefined]);
    await input(1000); await setMode(true);
    await page.evaluate(async () => { await SillyTavern.getContext().selectCharacterById(0, { switchMenu: false }); });
    await page.waitForFunction(() => document.querySelectorAll('#chat > .mes').length === 25 && document.querySelector('#show_more_messages'));
    check('native full chat data remains available', await snapshot().then(s => [s.displayed, s.total]), [25, 180]);
    const message = page.locator('#chat > .mes').last();
    await message.locator('.mes_edit').click();
    await page.locator('#curEditTextarea').click();
    await page.locator('#curEditTextarea').fill('UNSAVED NATIVE PERFORMANCE DRAFT');
    const editor = await page.locator('#curEditTextarea').elementHandle();
    const editSnapshot = () => page.evaluate(() => ({ text: document.getElementById('curEditTextarea')?.value, count: document.querySelectorAll('#chat > .mes').length, scroll: document.getElementById('chat').scrollTop }));
    const beforeToggle = await editSnapshot();
    await setMode(false);
    check('mode off restores preference without rerendering active draft', [await editor.evaluate(e => e === document.getElementById('curEditTextarea')), await editSnapshot()], [true, beforeToggle]);
    await setMode(true);
    const surfaceDraft = await editSnapshot();
    await page.evaluate(() => { const input = document.getElementById('cu-extension-enabled'); input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
    check('Surface off restores both native preferences and releases visual mode', await snapshot().then(s => [s.native, s.fps, s.backup, s.streamingBackup, s.performanceClass, s.maskClass]), [1000, 30, undefined, undefined, false, false]);
    check('Surface off preserves editor identity and complete draft', [await editor.evaluate(e => e === document.getElementById('curEditTextarea')), (await editSnapshot()).text], [true, surfaceDraft.text]);
    await page.evaluate(() => { const input = document.getElementById('cu-extension-enabled'); input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); });
    check('Surface re-enable reapplies both managed native limits', await snapshot().then(s => [s.native, s.fps]), [25, 10]);
    const beforeDisable = await editSnapshot();
    await page.evaluate(async () => { const extensions = await import('/scripts/extensions.js'); await extensions.disableExtension('third-party/claude-surface', false); });
    check('native disable hook restores both preferences before native save', [report.saved.at(-1).native, report.saved.at(-1).fps, report.saved.at(-1).enabled, report.saved.at(-1).backup, report.saved.at(-1).streamingBackup, report.saved.at(-1).disabled.includes('third-party/claude-surface')], [1000, 30, false, undefined, undefined, true]);
    check('native disable hook releases performance-specific visual classes', await snapshot().then(s => [s.performanceClass, s.maskClass]), [false, false]);
    check('native disable without reload preserves draft and DOM', [await editor.evaluate(e => e === document.getElementById('curEditTextarea')), await editSnapshot()], [true, beforeDisable]);
    await page.evaluate(async () => { const extensions = await import('/scripts/extensions.js'); await extensions.enableExtension('third-party/claude-surface', false); });
    await setMode(true);
    await message.locator('.mes_edit_cancel').click();
    await page.waitForFunction(() => !document.getElementById('curEditTextarea'));
    await page.evaluate(async () => { await SillyTavern.getContext().executeSlashCommandsWithOptions('/chat-render 5'); });
    check('explicit native chat-render count bypasses default batch cap', await snapshot().then(s => [s.displayed, s.total, s.native]), [30, 180, 25]);
    await page.evaluate(async () => { await SillyTavern.getContext().executeSlashCommandsWithOptions('/chat-render'); });
    check('explicit render all preserves complete native history', await snapshot().then(s => [s.displayed, s.total, s.native]), [180, 180, 25]);
    await forceSave();
    await page.evaluate(async () => { const extensions = await import('/scripts/extensions.js'); await extensions.deleteExtension('third-party/claude-surface', false); });
    check('native delete hook restores both preferences before intercepted deletion save', [report.deleteRequests, report.saved.at(-1).native, report.saved.at(-1).fps, report.saved.at(-1).enabled, report.saved.at(-1).backup, report.saved.at(-1).streamingBackup], [1, 1000, 30, false, undefined, undefined]);
    check('native delete hook releases performance-specific visual classes', await snapshot().then(s => [s.performanceClass, s.maskClass]), [false, false]);
    }
    await context.close();
    await coldHookScenario();
    check('browser has no uncaught errors', report.errors, []);
} catch (error) {
    report.failure = String(error); await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error;
} finally {
    await context.close(); await browser.close(); await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ engine, checks: report.checks.length, errors: report.errors.length, output }));
