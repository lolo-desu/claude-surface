/** Native/third-party navigation regression against a local SillyTavern with
 * ST-BaiBai-Book installed. Real Book entry and handlers; settings writes blocked.
 * CU_TEST_URL, CU_PLAYWRIGHT_MODULE, CU_CHROMIUM_EXECUTABLE, CU_TEST_OUTPUT supported.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.CU_PLAYWRIGHT_MODULE || 'playwright');
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.CU_TEST_OUTPUT || path.join(source, 'artifacts/toolbar');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.CU_CHROMIUM_EXECUTABLE } : {}) });
const report = { version: JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8')).version, cases: [] };
const nativeEntries = [
    ['persona-management-button', '用户设定'], ['rightNavHolder', '角色卡'],
    ['ai-config-button', '预设'], ['sys-settings-button', 'API 连接'],
    ['advanced-formatting-button', '回复格式'], ['WI-SP-button', '世界书'],
    ['user-settings-button', '用户设置'], ['backgrounds-button', '背景'],
    ['extensions-settings-button', '扩展程序'],
];
const menu = async page => {
    await page.waitForFunction(() => !document.querySelector('.cu-sheet'));
    await page.locator('.cu-header button[aria-label="更多"]').click();
};
const closeNative = async page => {
    await page.locator('#cu-native-close').click();
    await page.waitForFunction(() => !document.querySelector('#PersonaManagement.openDrawer,#WorldInfo.openDrawer,#user-settings-block.openDrawer'));
};
try {
    for (const width of [412, 1440]) for (const book of [false, true]) {
        const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'zh-CN', isMobile: width < 900, hasTouch: width < 900 });
        await context.addInitScript(() => localStorage.setItem('language', 'zh-cn'));
        await context.route('**/api/settings/get', async route => {
            const response = await route.fetch(), data = await response.json(), settings = JSON.parse(data.settings);
            settings.firstRun = false; settings.main_api = 'openai';
            settings.extension_settings.claude_surface = { enabled: true, mode: 'dark', nativeToolbar: true };
            settings.extension_settings.disabledExtensions = ['third-party/ST-BaiBai-Tools', ...(!book ? ['third-party/ST-BaiBai-Book'] : [])];
            settings.extension_settings.baibai_book = { ui: { showTopBar: true } };
            data.settings = JSON.stringify(settings); await route.fulfill({ response, json: data });
        });
        await context.route('**/api/settings/save', route => route.fulfill({ json: { result: 'ok' } }));
        await context.route('**/api/extensions/version', route => route.fulfill({ json: { isUpToDate: true } }));
        await context.route(/\/api\/extensions\/(install|update|delete|switch|move)(\?|$)/, route => route.abort());
        await context.route('**/scripts/extensions/third-party/claude-surface/**', async route => {
            const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/claude-surface/')[1]);
            const file = path.resolve(source, relative);
            if (!file.startsWith(source + path.sep)) return route.abort();
            try { await route.fulfill({ body: await fs.readFile(file), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/json' }); }
            catch { await route.abort(); }
        });
        const page = await context.newPage(); page.setDefaultTimeout(10000);
        const errors = []; page.on('pageerror', error => errors.push(String(error)));
        try {
            await page.goto(process.env.CU_TEST_URL || 'http://127.0.0.1:8010', { waitUntil: 'networkidle' });
            await page.locator('body[data-claude-ui]').waitFor();
            if (book) await page.locator('#bbs-topbar-button').waitFor({ state: 'attached' });
            else assert.equal(await page.locator('#bbs-topbar-button').count(), 0);
            // Insert a new third-party entry after initialization and reorder the
            // native persona drawer, covering more than one plugin's insertion slot.
            await page.evaluate(() => {
                const holder = document.getElementById('top-settings-holder');
                holder.prepend(document.getElementById('persona-management-button'));
                const extra = document.createElement('div'); extra.id = 'toolbar-test-extension'; extra.className = 'drawer';
                extra.innerHTML = '<div class="drawer-toggle"><div class="drawer-icon" title="第三方测试入口"><span data-sentinel>★</span></div></div>';
                extra.firstElementChild.addEventListener('click', () => { window.toolbarTestClicks = (window.toolbarTestClicks || 0) + 1; });
                holder.prepend(extra);
            });
            for (const design of ['claude', 'material', 'adwaita', 'swiss']) for (const mode of ['dark', 'light']) {
                await menu(page); await page.locator('.cu-sheet').getByRole('button', { name: '主题设置', exact: true }).click();
                await page.locator(`[data-cu-design-choice="${design}"]`).click(); await page.locator(`[data-cu-mode="${mode}"]`).click();
                await page.locator('.cu-sheet-panel').press('Escape'); await page.locator('.cu-sheet').waitFor({ state: 'hidden' });
                await menu(page);
                for (const [id, label] of nativeEntries) {
                    const item = page.locator('.cu-tool-grid').getByRole('button', { name: label, exact: true });
                    assert.equal(await item.count(), 1, `${id}: wrong/duplicate label`);
                    const nativeSvg = await page.locator(`#${id} .cu-native-icon svg`).evaluate(el => el.outerHTML);
                    assert.equal(await item.locator('svg').evaluate(el => el.outerHTML), nativeSvg, `${id}: icon identity drifted`);
                }
                assert.equal(await page.locator('.cu-tool-grid').getByRole('button', { name: '柏宝书', exact: true }).count(), Number(book));
                await page.locator('.cu-tool-grid').getByRole('button', { name: '用户设定', exact: true }).click();
                await page.locator('#PersonaManagement').waitFor({ state: 'visible' });
                assert.equal(await page.locator('#bbs-app-host').getByRole('dialog', { name: '柏宝书', exact: true }).isVisible(), false, 'Persona action opened Book');
                await closeNative(page);
                await menu(page); await page.locator('.cu-tool-grid').getByRole('button', { name: '角色卡', exact: true }).click();
                await page.locator('#rm_print_characters_block').waitFor({ state: 'visible' });
                await closeNative(page);
                await menu(page); await page.locator('.cu-tool-grid').getByRole('button', { name: '用户设置', exact: true }).click();
                await page.locator('#user-settings-block').waitFor({ state: 'visible' }); await closeNative(page);
                const before = await page.evaluate(() => window.toolbarTestClicks || 0);
                await menu(page); await page.locator('.cu-tool-grid').getByRole('button', { name: '第三方测试入口', exact: true }).click();
                await page.waitForFunction(n => window.toolbarTestClicks === n + 1, before);
                assert.equal(await page.locator('#toolbar-test-extension [data-sentinel]').count(), 1, 'Third-party icon was replaced');
                assert.equal(await page.locator('#toolbar-test-extension .cu-native-icon').count(), 0);
                if (book) assert.equal(await page.locator('#bbs-topbar-button .cu-native-icon').count(), 0);
                const label = `${width}-${book ? 'book' : 'native'}-${design}-${mode}`;
                report.cases.push(label); console.log('PASS ' + label);
            }
            // Direct native toolbar access must also stay correct after reordering.
            await page.locator('#persona-management-button .drawer-icon').click();
            await page.locator('#PersonaManagement').waitFor({ state: 'visible' }); await closeNative(page);
            if (book) {
                await menu(page); await page.locator('.cu-tool-grid').getByRole('button', { name: '柏宝书', exact: true }).click();
                await page.locator('#bbs-app-host').getByRole('dialog', { name: '柏宝书', exact: true }).waitFor({ state: 'visible' });
                assert.match(await page.locator('#bbs-app-host').evaluate(el => el.shadowRoot.textContent), /柏宝书/);
                assert.equal(await page.locator('#PersonaManagement').isVisible(), false);
                await page.screenshot({ path: path.join(output, `${width}-book.png`) });
            }
            assert.deepEqual(errors, [], 'Unexpected browser errors');
        } catch (error) {
            await page.screenshot({ path: path.join(output, `${width}-${book}-failure.png`) }).catch(() => {});
            throw error;
        } finally { await context.close(); }
    }
} finally {
    await browser.close(); await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ passed: report.cases.length, output }));
