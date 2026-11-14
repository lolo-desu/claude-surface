/** Scoped native settings decoration, against an isolated SillyTavern profile.
 * Writes/generation are intercepted. CU_SOURCE, CU_TEST_URL, CU_TEST_OUTPUT,
 * CU_PLAYWRIGHT_MODULE, CU_ENGINE and browser executable overrides are supported.
 * Counters measure visited controls, not hardware-dependent elapsed time.
 */
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium, webkit } = await import(process.env.CU_PLAYWRIGHT_MODULE || 'playwright');
const source = path.resolve(process.env.CU_SOURCE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const out = process.env.CU_TEST_OUTPUT || path.join(source, 'artifacts/native-ui-performance');
await fs.mkdir(out, { recursive: true });
const engine = process.env.CU_ENGINE || 'chromium';
const executablePath = process.env[engine === 'webkit' ? 'CU_WEBKIT_EXECUTABLE' : 'CU_CHROMIUM_EXECUTABLE'];
const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const report = { source, engine, cases: [], failures: [] };
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
async function fixture(width) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 900, isMobile: width < 900, locale: 'en-US' });
    await context.addInitScript(() => localStorage.setItem('language', 'en'));
    await context.route('**/api/settings/get', async route => {
        const response = await route.fetch(), data = await response.json(), settings = JSON.parse(data.settings);
        settings.firstRun = false; settings.main_api = 'openai';
        settings.extension_settings.claude_surface = { enabled: true, mode: 'dark' };
        settings.extension_settings.disabledExtensions = ['third-party/ST-BaiBai-Book', 'third-party/ST-BaiBai-Tools'];
        data.settings = JSON.stringify(settings); await route.fulfill({ response, json: data });
    });
    await context.route(/\/api\/(settings|themes|chats|groups)\/(save|edit|delete|generate)(\?|$)/, route => route.fulfill({ json: { result: 'ok' } }));
    await context.route(/\/api\/extensions\/(install|update|delete|switch|move)(\?|$)/, route => route.abort());
    await context.route(/\/api\/.*(?:generate|completion)/, route => route.fulfill({ status: 503, body: 'UI test: generation disabled' }));
    await context.route('**/api/extensions/version', route => route.fulfill({ json: { isUpToDate: true } }));
    await context.route('**/scripts/extensions/third-party/claude-surface/**', async route => {
        const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/claude-surface/')[1]);
        const filename = path.resolve(source, relative);
        if (!filename.startsWith(source + path.sep)) return route.abort();
        try {
            let body = await fs.readFile(filename);
            if (relative === 'native-ui.js') body = Buffer.from(body.toString()
                .replace('const paintRange = input => {', 'const paintRange = input => { if (globalThis.__cuNativeCounts) globalThis.__cuNativeCounts.rangeVisits++;')
                .replace('const attributes = (element,values) => {', 'const attributes = (element,values) => { if (globalThis.__cuNativeCounts) globalThis.__cuNativeCounts.worldVisits++;')
                .replaceAll('mobileWorld.refresh();', 'if (globalThis.__cuNativeCounts) globalThis.__cuNativeCounts.worldRefreshes++; mobileWorld.refresh();'));
            await route.fulfill({ body, contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/json' });
        } catch { await route.abort(); }
    });
    const page = await context.newPage();
    await page.goto(process.env.CU_TEST_URL || 'http://127.0.0.1:8010', { waitUntil: 'networkidle' });
    await page.locator('#cu-extension-enabled').waitFor({ state: 'attached', timeout: 60000 });
    await page.evaluate(async () => { const ctx = SillyTavern.getContext(); if (ctx.eventTypes.APP_READY) await ctx.eventSource.emit(ctx.eventTypes.SETTINGS_UPDATED); });
    await settle(page);
    await page.evaluate(() => {
        const root = document.createElement('div'); root.id = 'cu-native-perf-rows';
        root.innerHTML = Array.from({ length: 1000 }, (_, i) => `<div class="world_entry"><select name="entryStateSelector"><option>Normal</option></select><div><input type="range" min="0" max="100" value="${i % 100}"><input class="neo-range-input" type="number"></div></div>`).join('');
        document.getElementById('WorldInfo').append(root);
        const unrelated = document.createElement('input'); unrelated.id = 'cu-native-perf-unrelated';
        document.getElementById('top-settings-holder').append(unrelated);
    });
    await settle(page);
    return { context, page };
}
const reset = page => page.evaluate(() => { globalThis.__cuNativeCounts = { rangeVisits: 0, worldVisits: 0, worldRefreshes: 0 }; });
const counts = page => page.evaluate(() => globalThis.__cuNativeCounts);
async function check(page, width, name, action, verify) {
    if (process.env.CU_CASE_FILTER && !name.includes(process.env.CU_CASE_FILTER)) return;
    await reset(page); await action(); await settle(page);
    const counters = await counts(page), row = { width, name, counters };
    try { await verify(counters); row.pass = true; } catch (error) { row.pass = false; row.error = error.message; report.failures.push(row); }
    report.cases.push(row);
}
try {
    for (const width of [393, 1440]) {
        const { context, page } = await fixture(width);
        try {
            await check(page, width, 'unrelated setting visits no ranges or world controls', () => page.evaluate(() => document.getElementById('cu-native-perf-unrelated').dispatchEvent(new Event('change', { bubbles: true }))), value => assert.deepEqual(value, { rangeVisits: 0, worldVisits: 0, worldRefreshes: 0 }));
            await check(page, width, 'self range insertion visits only that range', () => page.evaluate(() => {
                const range = document.createElement('input'); range.type = 'range'; range.id = 'cu-native-perf-added'; range.min = '0'; range.max = '100'; range.value = '37';
                document.getElementById('cu-native-perf-rows').append(range);
            }), async value => { assert.equal(value.rangeVisits, 1); assert.equal(value.worldVisits, 0); assert.equal(value.worldRefreshes, 0); assert.equal(await page.locator('#cu-native-perf-added').evaluate(el => el.style.getPropertyValue('--cu-range-fill')), '37%'); });
            await check(page, width, 'self state select insertion gains its label', () => page.evaluate(() => {
                const select = document.createElement('select'); select.name = 'entryStateSelector'; select.dataset.cuPerfState = 'true';
                document.querySelector('#cu-native-perf-rows .world_entry').append(select);
            }), async value => { assert.equal(value.rangeVisits, 0); assert.equal(value.worldVisits, 1); assert.equal(value.worldRefreshes, 0); assert.equal(await page.locator('[data-cu-perf-state]').evaluate(el => el.getAttribute('aria-label') === 'Status' && el.previousElementSibling?.htmlFor === el.id), true); });
            await check(page, width, 'self Select2 clear and remove insertion gains names', () => page.evaluate(() => {
                for (const name of ['clear', 'choice__remove']) { const control = document.createElement('span'); control.className = `select2-selection__${name}`; control.dataset.cuPerfSelect2 = name; document.getElementById('WIMultiSelector').append(control); }
            }), async value => { assert.equal(value.rangeVisits, 0); assert.equal(value.worldVisits, 2); assert.equal(value.worldRefreshes, 0); assert.deepEqual(await page.locator('[data-cu-perf-select2]').evaluateAll(elements => elements.map(el => !!el.getAttribute('aria-label') && !!el.title)), [true, true]); });
            await check(page, width, 'number companion change paints only its linked range', () => page.evaluate(() => {
                const input = document.createElement('input'); input.type = 'number'; input.dataset.for = 'cu-native-perf-added';
                document.getElementById('top-settings-holder').append(input); document.getElementById('cu-native-perf-added').value = '73'; input.dispatchEvent(new Event('change', { bubbles: true }));
            }), async value => { assert.equal(value.rangeVisits, 1); assert.equal(value.worldVisits, 0); assert.equal(value.worldRefreshes, 0); assert.equal(await page.locator('#cu-native-perf-added').evaluate(el => el.style.getPropertyValue('--cu-range-fill')), '73%'); });
            await check(page, width, 'overlapping added subtree visits each range once', () => page.evaluate(() => {
                const wrapper = document.createElement('div'); const child = document.createElement('div'); wrapper.append(child); document.getElementById('cu-native-perf-rows').append(wrapper);
                for (let i = 0; i < 3; i++) { const input = document.createElement('input'); input.type = 'range'; child.append(input); }
            }), value => { assert.equal(value.rangeVisits, 3); assert.equal(value.worldVisits, 0); assert.equal(value.worldRefreshes, 0); });
            await check(page, width, 'removed pending root receives no detached work', () => page.evaluate(() => {
                const input = document.createElement('input'); input.type = 'range'; document.getElementById('cu-native-perf-rows').append(input); input.remove();
            }), value => assert.deepEqual(value, { rangeVisits: 0, worldVisits: 0, worldRefreshes: 0 }));
            await check(page, width, 'native settings notification retains full reconciliation', () => page.evaluate(async () => { const ctx = SillyTavern.getContext(); await ctx.eventSource.emit(ctx.eventTypes.SETTINGS_UPDATED); }), value => { assert.ok(value.rangeVisits >= 1004); assert.ok(value.worldVisits >= 1003); assert.ok(value.worldRefreshes >= 1); });
            await check(page, width, 'disable restores generated labels and names', () => page.evaluate(() => {
                const input = document.getElementById('cu-extension-enabled'); input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true }));
            }), async () => {
                assert.equal(await page.locator('[data-cu-perf-state]').evaluate(el => !el.hasAttribute('aria-label') && !el.id && !el.previousElementSibling?.classList.contains('cu-wi-state-label')), true);
                assert.deepEqual(await page.locator('[data-cu-perf-select2]').evaluateAll(elements => elements.map(el => !el.hasAttribute('aria-label') && !el.hasAttribute('title'))), [true, true]);
            });
            await check(page, width, 'enable reapplies all controls after ownership release', () => page.evaluate(() => {
                const input = document.getElementById('cu-extension-enabled'); input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true }));
            }), async value => { assert.ok(value.rangeVisits >= 1004); assert.equal(await page.locator('[data-cu-perf-state]').getAttribute('aria-label'), 'Status'); });
            await check(page, width, 'Bai layout toggle retains complete compatibility reconciliation', () => page.evaluate(() => {
                const input = document.createElement('input'); input.id = 'bai_bai_toolkit_world_info_list_optimization_enabled'; input.type = 'checkbox';
                document.getElementById('top-settings-holder').append(input); input.dispatchEvent(new Event('change', { bubbles: true }));
            }), value => { assert.ok(value.rangeVisits >= 1004); assert.ok(value.worldRefreshes >= 1); });
            await check(page, width, 'viewport transition retains full range layout reconciliation', () => page.setViewportSize({ width: width < 900 ? 1440 : 393, height: 900 }), async value => {
                assert.ok(value.rangeVisits >= 1004);
                assert.equal(await page.locator('#cu-native-perf-rows .world_entry input[type="range"]').first().evaluate(el => el.parentElement.classList.contains('cu-range-row')), width >= 900);
            });
            await check(page, width, 'last removed state select leaves no owned label after disable', async () => {
                const toggle = enabled => page.evaluate(enabled => {
                    const input = document.getElementById('cu-extension-enabled'); input.checked = enabled; input.dispatchEvent(new Event('change', { bubbles: true }));
                }, enabled);
                await toggle(false); await settle(page);
                await page.evaluate(() => {
                    document.getElementById('cu-native-perf-rows').remove();
                    document.querySelectorAll('[data-cu-perf-select2]').forEach(element => element.remove());
                });
                await settle(page); await reset(page); await toggle(true); await settle(page);
                assert.equal((await counts(page)).worldVisits, 0, 'isolate the last owned world field');
                await page.evaluate(() => {
                    const row = document.createElement('div'); row.className = 'world_entry'; row.id = 'cu-native-perf-orphan-row';
                    const select = document.createElement('select'); select.name = 'entryStateSelector'; row.append(select);
                    document.getElementById('WorldInfo').append(row);
                });
                await settle(page);
                await page.evaluate(() => {
                    const select = document.querySelector('#cu-native-perf-orphan-row select');
                    select.previousElementSibling.dataset.cuPerfOrphanLabel = 'true'; select.remove();
                });
                await settle(page); await toggle(false); await settle(page);
            }, async () => {
                assert.equal(await page.locator('[data-cu-perf-orphan-label]').count(), 0);
                assert.equal(await page.locator('#cu-native-perf-orphan-row').count(), 1, 'preserve the native row');
            });
            await check(page, width, 'remounted native field releases its retained Surface label', async () => {
                await page.evaluate(() => {
                    const input = document.getElementById('cu-extension-enabled'); input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true }));
                    const row = document.createElement('div'); row.className = 'world_entry'; row.id = 'cu-native-perf-remount-row';
                    row.innerHTML = '<select name="entryStateSelector"></select>'; document.getElementById('WorldInfo').append(row);
                });
                await settle(page);
                await page.evaluate(() => {
                    const row = document.getElementById('cu-native-perf-remount-row');
                    row.querySelector('label').dataset.cuPerfRemountLabel = 'true'; row.remove(); globalThis.__cuNativeRetainedRow = row;
                });
                await settle(page);
                await page.evaluate(() => { document.getElementById('WorldInfo').append(globalThis.__cuNativeRetainedRow); delete globalThis.__cuNativeRetainedRow; });
                await settle(page);
                await page.evaluate(() => {
                    const input = document.getElementById('cu-extension-enabled'); input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true }));
                });
            }, async () => {
                assert.equal(await page.locator('[data-cu-perf-remount-label]').count(), 0);
                assert.equal(await page.locator('#cu-native-perf-remount-row select').count(), 1);
            });
        } finally { await context.close(); }
    }
} finally { await browser.close(); await fs.writeFile(path.join(out, 'summary.json'), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ engine, cases: report.cases.length, failures: report.failures.length, out }));
if (report.failures.length) { console.error(JSON.stringify(report.failures)); process.exitCode = 1; }
