/** Full-page Appearance and every custom-palette descendant against isolated ST.
 * CU_SOURCE, CU_TEST_URL, CU_TEST_OUTPUT, CU_PLAYWRIGHT_MODULE, CU_ENGINE,
 * CU_CHROMIUM_EXECUTABLE, CU_WEBKIT_EXECUTABLE, CU_WIDTH and CU_QUICK are supported.
 * PWA, safe areas and VisualViewport keyboards are explicit simulations, not
 * physical iOS evidence. Settings/theme/chat writes and generation are blocked.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const playwright = await import(process.env.CU_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.env.CU_SOURCE || repo);
const { colorFields } = await import(pathToFileURL(path.join(source, 'custom-palettes.js')).href);
const output = path.resolve(process.env.CU_TEST_OUTPUT || path.join(repo, 'artifacts/appearance-pages'));
await fs.mkdir(output, { recursive: true });
const engine = process.env.CU_ENGINE || 'chromium';
const executablePath = process.env[engine === 'webkit' ? 'CU_WEBKIT_EXECUTABLE' : 'CU_CHROMIUM_EXECUTABLE'];
const browser = await playwright[engine].launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const families = ['claude', 'material', 'adwaita', 'swiss'];
const seeds = families.map((design, index) => ({
    schema: 'claude-surface-palette', version: 1,
    id: `custom-${String(index + 1).repeat(8)}-1111-4111-8111-111111111111`,
    label: `Saved ${design}`, design, swatch: '#336699',
    light: Object.fromEntries(colorFields.map(({ key }) => [key, '#336699'])),
    dark: Object.fromEntries(colorFields.map(({ key }) => [key, '#336699'])),
}));
const report = { engine, source, cases: [], errors: [] };
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const byName = (page, name) => page.getByRole('button', { name, exact: true });
async function fixture(width, height) {
    const mobile = width < 900;
    const safe = mobile ? { top: width === 844 ? 0 : 47, bottom: width === 844 ? 21 : 34, left: width === 844 ? 44 : 0, right: width === 844 ? 44 : 0 } : { top: 0, bottom: 0, left: 0, right: 0 };
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, locale: 'zh-CN' });
    await context.addInitScript(({ mobile }) => {
        localStorage.setItem('language', 'zh-cn');
        if (mobile) {
            const match = window.matchMedia.bind(window);
            window.matchMedia = query => { const media = match(query); if (query === '(display-mode: standalone)') Object.defineProperty(media, 'matches', { value: true }); return media; };
        }
    }, { mobile });
    const css = text => {
        if (!mobile) return text;
        text = text.replaceAll('@supports (-webkit-touch-callout: none)', '@supports (display: flex)');
        for (const [side, value] of Object.entries(safe)) text = text.replaceAll(`env(safe-area-inset-${side})`, `${value}px`);
        return text;
    };
    if (mobile) await context.route('**/css/mobile-styles.css*', async route => { const response = await route.fetch(); await route.fulfill({ response, body: css(await response.text()) }); });
    await context.route('**/api/settings/get', async route => {
        const response = await route.fetch(), data = await response.json(), settings = JSON.parse(data.settings);
        data.enable_extensions_auto_update = false;
        settings.firstRun = false; settings.main_api = 'openai'; settings.extension_settings.notifyUpdates = false;
        settings.extension_settings.disabledExtensions = ['third-party/ST-BaiBai-Book', 'third-party/ST-BaiBai-Tools'];
        settings.extension_settings.claude_surface = { enabled: true, mode: 'dark', compactComposer: true, customPalettes: seeds };
        data.settings = JSON.stringify(settings); await route.fulfill({ response, json: data });
    });
    await context.route(/\/api\/(settings|themes|chats|groups)\/(save|edit|delete)(\?|$)/, route => route.fulfill({ json: { result: 'ok' } }));
    await context.route(/\/api\/(characters\/(edit|merge-attributes)|extensions\/(install|update|delete|switch|move))(\?|$)/, route => route.abort());
    await context.route(/\/api\/.*(?:generate|completion)/, route => route.fulfill({ status: 503, body: 'Appearance page test: generation disabled' }));
    await context.route('**/api/extensions/version', route => route.fulfill({ json: { isUpToDate: true } }));
    await context.route('**/scripts/extensions/third-party/claude-surface/**', async route => {
        const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/claude-surface/')[1]), file = path.resolve(source, relative);
        if (!file.startsWith(source + path.sep)) return route.abort();
        try { await route.fulfill({ body: relative.endsWith('.css') ? css(await fs.readFile(file, 'utf8')) : await fs.readFile(file), contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/json' }); }
        catch { await route.abort(); }
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error' && /\[Claude Surface\]|ResizeObserver/.test(message.text())) report.errors.push(message.text()); });
    await page.goto(process.env.CU_TEST_URL || 'http://127.0.0.1:8010', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('.cu-header') && !document.querySelector('.splash-screen'), null, { timeout: 60000 });
    await frames(page);
    return { context, page, mobile, safe, width, height };
}
async function pageGeometry(page) {
    return page.locator('.cu-sheet').evaluate(root => {
        const panel = root.querySelector('.cu-sheet-panel'), heading = root.querySelector('.cu-sheet-heading'), body = root.querySelector('.cu-sheet-body'), close = heading.querySelector('button[aria-label="关闭"]'), style = getComputedStyle(panel), rootStyle = getComputedStyle(root), rect = close.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const color = canvas.getContext('2d'); color.fillStyle = rootStyle.backgroundColor; color.fillRect(0, 0, 1, 1);
        return { classes: root.className, root: root.getBoundingClientRect().toJSON(), panel: panel.getBoundingClientRect().toJSON(), heading: heading.getBoundingClientRect().toJSON(), body: body.getBoundingClientRect().toJSON(), close: rect.toJSON(), closeHit: hit?.closest('button') === close, handleCount: root.querySelectorAll('.cu-sheet-handle').length, radius: style.borderRadius, backgroundAlpha: color.getImageData(0, 0, 1, 1).data[3], overflowY: getComputedStyle(body).overflowY, width: innerWidth, height: innerHeight, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, docTop: document.scrollingElement.scrollTop, viewport: { top: visualViewport.offsetTop, height: visualViewport.height } };
    });
}
async function assertPage(test, stage, { keyboard = false } = {}) {
    const { page, width, height, safe, mobile } = test;
    await page.locator('.cu-sheet').evaluate(root => Promise.all(root.getAnimations().map(animation => animation.finished.catch(() => {})))); await frames(page);
    const item = await pageGeometry(page); report.current = { width, height, design: test.design, stage, geometry: item }; const top = keyboard ? item.viewport.top : 0, visibleHeight = keyboard ? item.viewport.height : height, bottomSafe = keyboard ? 0 : safe.bottom;
    assert(item.classes.includes('cu-full-page'), `${stage}: page was created as a sheet`);
    assert(Math.abs(item.root.left) < 1 && Math.abs(item.root.width - width) < 1, `${stage}: page does not span window width`);
    assert(Math.abs(item.root.top - top) < 1 && Math.abs(item.root.height - visibleHeight) < 1, `${stage}: page does not span visible viewport`);
    assert(item.panel.left <= safe.left + 1 && item.panel.right >= width - safe.right - 1, `${stage}: centered dialog width remains`);
    assert(item.panel.top <= top + safe.top + 1 && item.panel.bottom >= top + visibleHeight - bottomSafe - 1, `${stage}: sheet height limit remains`);
    assert.equal(item.radius, '0px', `${stage}: rounded sheet corners remain`); assert.equal(item.handleCount, 0, `${stage}: drag handle remains`); assert.equal(item.backgroundAlpha, 255, `${stage}: page backdrop is translucent`);
    assert(item.body.height > 0 && ['auto', 'scroll'].includes(item.overflowY), `${stage}: content does not own vertical scrolling`);
    assert(item.close.left >= safe.left && item.close.right <= width - safe.right && item.close.top >= top + safe.top - 1 && item.close.bottom <= top + visibleHeight + 1, `${stage}: close target is outside safe viewport`);
    assert(item.close.width >= (mobile ? 44 : 32) && item.closeHit, `${stage}: close target is not reachable`);
    assert.equal(item.docTop, 0, `${stage}: background document scrolled`);
    test.stages.push({ stage, ...item }); return item;
}
async function scrollBody(test) {
    const headingBefore = await test.page.locator('.cu-sheet-heading').boundingBox();
    const scrolled = await test.page.locator('.cu-sheet-body').evaluate(body => { body.scrollTop = body.scrollHeight; return { top: body.scrollTop, max: body.scrollHeight - body.clientHeight }; });
    await frames(test.page); const headingAfter = await test.page.locator('.cu-sheet-heading').boundingBox();
    assert.equal(headingAfter.y, headingBefore.y, 'Content scrolling moved the page heading'); assert.equal(scrolled.top, scrolled.max); return scrolled;
}
async function mockKeyboard(test, locator) {
    await locator.click(); const visibleHeight = test.width === 844 ? 240 : 520;
    await test.page.evaluate(height => { for (const [key, value] of Object.entries({ height, offsetTop: 12, scale: 1 })) Object.defineProperty(visualViewport, key, { configurable: true, get: () => value }); visualViewport.dispatchEvent(new Event('resize')); visualViewport.dispatchEvent(new Event('scroll')); }, visibleHeight);
    await frames(test.page); await assertPage(test, 'keyboard', { keyboard: true });
    const hit = await locator.evaluate(input => { const rect = input.getBoundingClientRect(), body = input.closest('.cu-sheet-body').getBoundingClientRect(), point = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); return { rect: rect.toJSON(), body: body.toJSON(), hit: point === input }; });
    assert(hit.rect.top >= hit.body.top - 1 && hit.rect.bottom <= hit.body.bottom + 1 && hit.hit, 'Focused field is obscured in full-page keyboard layout');
    return hit;
}
async function clearKeyboard(page) {
    await page.evaluate(() => { document.activeElement?.blur(); for (const key of ['height', 'offsetTop', 'scale']) delete visualViewport[key]; visualViewport.dispatchEvent(new Event('resize')); }); await frames(page);
}
async function closePage(page, escape = false) {
    if (escape) await page.keyboard.press('Escape'); else await byName(page, '关闭').click();
    await page.locator('.cu-sheet').waitFor({ state: 'hidden' }); await frames(page);
    const focus = await page.evaluate(() => { const node = document.activeElement, style = node && getComputedStyle(node); return { body: node === document.body, editable: node?.matches('input,textarea,[contenteditable="true"]'), visible: !!node?.getClientRects().length && style.visibility !== 'hidden' && style.display !== 'none', inert: !!node?.closest('[inert]') }; });
    assert(!focus.body && !focus.editable && focus.visible && !focus.inert, 'Closing a page did not restore usable navigation focus'); return focus;
}
let active;
try {
    for (const [width, height] of process.env.CU_WIDTH ? [[Number(process.env.CU_WIDTH),Number(process.env.CU_WIDTH)===844?390:Number(process.env.CU_WIDTH)>=900?900:852]] : process.env.CU_QUICK ? [[393, 852]] : [[393, 852], [320, 852], [844, 390], [1440, 900]]) {
        active = await fixture(width, height); const { page, context, mobile } = active;
        for (const design of process.env.CU_QUICK ? ['claude'] : families) {
            const test = { ...active, design, stages: [] }; const name = `Draft layout ${design}`;
            await page.locator('.cu-header button[aria-label="更多"]').click();
            if(design==='claude'){const panel=await page.locator('.cu-sheet-panel').boundingBox(),point=test.safe.left?{x:test.safe.left/2,y:height/2}:mobile?{x:width/2,y:Math.max(test.safe.top+8,panel.y/2)}:{x:2,y:height/2};if(mobile)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);await page.locator('.cu-sheet').waitFor({state:'hidden'});await page.locator('.cu-header button[aria-label="更多"]').click();}
            await byName(page, '主题设置').click(); await page.locator(`[data-cu-design-choice="${design}"]`).click();
            await assertPage(test, 'appearance'); test.appearanceScroll = await scrollBody(test); assert(test.appearanceScroll.max > 0, 'Appearance fixture should exercise long content');
            await page.screenshot({ path: path.join(output, `${width}-${design}-appearance.png`) });
            await page.locator('.cu-palette-add').click(); await assertPage(test, 'management');
            await byName(page, '新建配色').click(); await assertPage(test, 'create-editor'); assert.equal(await page.locator('.cu-custom-color-hex').count(), 24);
            await page.locator('.cu-custom-name input').fill(name); await page.locator('.cu-custom-color-hex').last().fill('#11223380');
            if(width===844){await page.touchscreen.tap(test.safe.left/2,height/2);await frames(page);assert.equal(await page.locator('.cu-full-page:not(.cu-sheet-closing)').count(),1,'Tapping the full-page safe-area gutter dismissed an unsaved draft');assert.equal(await page.locator('.cu-custom-name input').inputValue(),name);}
            if (mobile) { test.nameKeyboard = await mockKeyboard(test, page.locator('.cu-custom-name input')); await clearKeyboard(page); test.hexKeyboard = await mockKeyboard(test, page.locator('.cu-custom-color-hex').last()); await clearKeyboard(page); }
            await scrollBody(test); await page.screenshot({ path: path.join(output, `${width}-${design}-editor.png`) });
            await byName(page, '导出草稿').click(); await assertPage(test, 'draft-export'); const json = await page.locator('.cu-custom-transfer').inputValue(); assert.equal(JSON.parse(json).label, name);
            await byName(page, '返回上一页').click(); await assertPage(test, 'export-return-editor'); assert.equal(await page.locator('.cu-custom-name input').inputValue(), name);
            await byName(page, '返回自定义颜色').click(); await assertPage(test, 'editor-return-management');
            await byName(page, `Saved ${design}`).click(); await assertPage(test, 'saved-editor'); assert.equal(await page.locator('.cu-custom-name input').inputValue(), `Saved ${design}`); await byName(page, '返回自定义颜色').click();
            const row = page.locator('.cu-custom-saved-row').filter({ hasText: `Saved ${design}` }); await row.getByRole('button', { name: '导出', exact: true }).click(); await assertPage(test, 'saved-export'); await byName(page, '返回上一页').click();
            await byName(page, '导入配色').click(); await assertPage(test, 'import'); await page.locator('.cu-custom-transfer').fill(json);
            if (mobile) { await page.locator('.cu-custom-transfer').click(); await page.evaluate(height => { for (const [key, value] of Object.entries({ height, offsetTop: 12, scale: 1 })) Object.defineProperty(visualViewport, key, { configurable: true, get: () => value }); visualViewport.dispatchEvent(new Event('resize')); }, width === 844 ? 240 : 520); await frames(page); await assertPage(test, 'import-keyboard', { keyboard: true }); const pulses=[];for(let pulse=0;pulse<4;pulse++){await page.evaluate(()=>visualViewport.dispatchEvent(new Event('scroll')));await frames(page);pulses.push(await page.locator('.cu-sheet-body').evaluate(body=>body.scrollTop));}assert(Math.max(...pulses)-Math.min(...pulses)<1,'Repeated viewport events made the import editor oscillate');test.importViewportPulses=pulses;await clearKeyboard(page);assert.equal(await page.evaluate(()=>document.body.style.getPropertyValue('--cu-sheet-field-height')),'','Keyboard field height leaked after blur'); }
            await page.screenshot({ path: path.join(output, `${width}-${design}-import.png`) });
            await byName(page, '导入并编辑').click(); await assertPage(test, 'import-editor'); assert.equal(await page.locator('.cu-custom-name input').inputValue(), name);
            await byName(page, '返回自定义颜色').click(); await byName(page, '返回主题设置').click(); await assertPage(test, 'return-appearance');
            assert.equal(await page.evaluate(() => SillyTavern.getContext().extensionSettings.claude_surface.customPalettes.length), 4, 'Subpage navigation persisted an unsaved draft');
            test.closeFocus = await closePage(page, design === 'material'); report.cases.push({ width, height, design, stages: test.stages, appearanceScroll: test.appearanceScroll, nameKeyboard: test.nameKeyboard, hexKeyboard: test.hexKeyboard, importViewportPulses: test.importViewportPulses, closeFocus: test.closeFocus });
            console.log('PASS', width, design); await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2));
        }
        await page.locator('.cu-header button[aria-label="更多"]').click(); await byName(page, '主题设置').click(); await page.locator('.cu-palette-add').click(); await byName(page, '新建配色').click();
        if (mobile) await mockKeyboard({ ...active, stages: [] }, page.locator('.cu-custom-name input'));
        await page.evaluate(() => { const input = document.getElementById('cu-extension-enabled'); input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); }); await page.locator('.cu-sheet').waitFor({ state: 'hidden' }); await frames(page);
        const restored = await page.evaluate(() => ({ enabled: document.body.hasAttribute('data-claude-ui'), pages: document.querySelectorAll('.cu-full-page').length, inert: [...document.querySelectorAll('#sheld,#top-settings-holder')].some(node => node.inert), height: document.body.style.getPropertyValue('--cu-sheet-height'), top: document.body.style.getPropertyValue('--cu-sheet-top'), keyboard: document.body.classList.contains('cu-sheet-keyboard') }));
        assert.equal(restored.enabled, false); assert.equal(restored.pages, 0); assert.equal(restored.inert, false); assert.equal(restored.height, ''); assert.equal(restored.top, ''); assert.equal(restored.keyboard, false);
        await context.close(); active = null;
    }
    assert.deepEqual(report.errors, []); console.log(JSON.stringify({ engine, cases: report.cases.length, output }));
} catch (error) { report.failure = String(error); if (active) await active.page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error; }
finally { await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2)); await browser.close(); }
