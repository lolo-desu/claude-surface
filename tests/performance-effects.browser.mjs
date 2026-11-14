/** Opt-in lean paint effects against the real native host. Fixture requests
 * isolate chat/settings writes and tokenizer resources; no GPU timing claims. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const engines = await import(process.env.CU_PLAYWRIGHT_MODULE || 'playwright');
const source = path.resolve(process.env.CU_SOURCE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const output = process.env.CU_TEST_OUTPUT || path.join(source, 'artifacts/performance-effects');
await fs.mkdir(output, { recursive: true });
const engine = process.env.CU_ENGINE || 'chromium';
const executablePath = process.env[engine === 'webkit' ? 'CU_WEBKIT_EXECUTABLE' : 'CU_CHROMIUM_EXECUTABLE'];
const browser = await engines[engine].launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const report = { source, engine, browser: browser.version(), timingClaims: false, cases: [], uiCases: [], errors: [] };
const saved = { uiTransparency: 40, uiBlur: 20, backgroundBlur: 12, backgroundDim: 35 };
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const values = page => page.evaluate(() => {
    const config = SillyTavern.getContext().extensionSettings.claude_surface;
    return Object.fromEntries(['uiTransparency', 'uiBlur', 'backgroundBlur', 'backgroundDim'].map(key => [key, config[key]]));
});
const setMode = (page, checked) => page.evaluate(checked => {
    const control = document.getElementById('cu-extension-native-performance');
    control.checked = checked; control.dispatchEvent(new Event('change', { bubbles: true }));
}, checked);
const snapshot = page => page.evaluate(() => {
    const body = document.body, style = getComputedStyle(body);
    const background = document.getElementById('bg1');
    const header = document.querySelector('.cu-header');
    const chat = document.getElementById('chat');
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return {
        glass: body.classList.contains('cu-glass-enabled'), blurred: body.classList.contains('cu-background-blurred'),
        opacity: style.getPropertyValue('--cu-ui-opacity'), backdrop: style.getPropertyValue('--cu-ui-backdrop'),
        backgroundFilter: getComputedStyle(background).filter, spread: style.getPropertyValue('--cu-background-spread'),
        headerBackdrop: getComputedStyle(header).backdropFilter || getComputedStyle(header).webkitBackdropFilter,
        backgroundImage: background.style.backgroundImage, backgroundParent: background.parentElement.className,
        chat: rect(chat), composer: rect(document.getElementById('send_form')), header: rect(header),
        anchor: document.querySelector('#chat>.mes[mesid="74"]').getBoundingClientRect().top,
        count: SillyTavern.getContext().chat.length,
        foreign: getComputedStyle(document.getElementById('cu-foreign-effect')).filter,
    };
});
const stableLayout = (a, b) => {
    for (const selector of ['chat', 'composer', 'header']) for (const key of ['x', 'y', 'width', 'height']) assert(Math.abs(a[selector][key] - b[selector][key]) < 2, `${selector}.${key}: ${a[selector][key]}→${b[selector][key]}`);
    assert(Math.abs(a.anchor - b.anchor) < 2, `Reading anchor shifted ${a.anchor}→${b.anchor}`);
    assert.equal(a.backgroundImage, b.backgroundImage); assert.equal(a.backgroundParent, b.backgroundParent);
    assert.equal(a.count, b.count); assert.equal(b.foreign, a.foreign);
};

const motion = page => page.evaluate(() => {
    const targets = ['.cu-sheet', '.cu-sheet-panel', '.cu-header', '.cu-sidebar'].map(selector => [selector, document.querySelector(selector), null]);
    targets.push(['thinking', document.querySelector('#chat>.mes[mesid="74"] .mes_reasoning_header'), '::before']);
    return Object.fromEntries(targets.map(([name, element, pseudo]) => {
        const style = getComputedStyle(element, pseudo);
        return [name, { animation: style.animationName, duration: style.animationDuration, transition: style.transitionDuration }];
    }));
});
async function appearanceUI(page, width) {
    await page.setViewportSize({ width, height: 852 });
    await page.evaluate(() => {
        const control = document.getElementById('cu-extension-design');
        control.value = 'claude'; control.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await frames(page);
    await page.evaluate(() => {
        const details = document.querySelector('#chat>.mes[mesid="74"] .mes_reasoning_details');
        details.dataset.state = 'thinking'; details.dataset.hasContent = 'true';
        details.querySelector('.mes_reasoning').textContent = 'Native reasoning motion fixture';
    });
    await page.locator('.cu-header').getByRole('button', { name: 'More', exact: true }).click();
    await page.locator('.cu-sheet').getByRole('button', { name: 'Appearance', exact: true }).click();
    const checkbox = page.locator('#cu-native-performance');
    await checkbox.waitFor({ state: 'attached' });
    await page.locator('.cu-sheet-closing').waitFor({ state: 'detached' });
    const normalMotion = await motion(page);
    assert.equal(normalMotion.thinking.animation, 'cu-thinking-pulse', 'Normal thinking animation did not exist as a negative control');
    assert.notEqual(normalMotion['.cu-header'].transition, '0s', 'Normal header transition did not exist as a negative control');
    const reduced = ['uiTransparency', 'uiBlur', 'backgroundBlur'];
    for (const key of reduced) {
        assert.equal(await page.locator('#cu-effect-' + key).isDisabled(), false);
        assert.equal(await page.locator('#cu-effect-' + key).inputValue(), String(saved[key]));
    }
    await checkbox.setChecked(true); await frames(page);
    assert.equal(await page.locator('body[data-cu-performance]').count(), 1);
    for (const key of reduced) {
        const input = page.locator('#cu-effect-' + key);
        assert.equal(await input.isDisabled(), true, `${key} must explain its suspended effect`);
        assert.equal(await input.inputValue(), String(saved[key]), `${key} lost its saved value`);
        assert.match(await input.getAttribute('title'), /restore/i, `${key} has no restoration explanation`);
        assert.match(await page.locator('#cu-effect-' + key + '-value').textContent(), new RegExp(String(saved[key])));
    }
    const activeMotion = await motion(page);
    for (const [selector, state] of Object.entries(activeMotion)) {
        assert.equal(state.animation, 'none', selector + ' animation kept running');
        assert(state.transition.split(',').every(value => parseFloat(value) === 0), selector + ' kept its transition');
    }
    const dimmer = page.locator('#cu-effect-backgroundDim');
    assert.equal(await dimmer.isDisabled(), false, 'Background dimming should remain adjustable');
    await dimmer.scrollIntoViewIfNeeded(); await dimmer.focus(); await dimmer.press('ArrowRight'); await frames(page);
    assert.equal(await dimmer.inputValue(), String(saved.backgroundDim + 1));
    assert.deepEqual(await values(page), { ...saved, backgroundDim: saved.backgroundDim + 1 });
    assert.match(await page.locator('#bg1').evaluate(element => getComputedStyle(element).filter), /brightness\(0\.64\)/);
    await page.screenshot({ path: path.join(output, `${width}-appearance-disabled-effects.png`) });
    await checkbox.scrollIntoViewIfNeeded(); await frames(page);
    const bounds = await page.evaluate(() => {
        const body = document.querySelector('.cu-sheet-body'), panel = document.querySelector('.cu-sheet-panel');
        const hint = document.getElementById('cu-performance-hint'), row = hint.closest('label');
        const rectangle = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
        return { viewport: innerWidth, bodyWidth: body.clientWidth, bodyScroll: body.scrollWidth, hintWidth: hint.clientWidth, hintScroll: hint.scrollWidth, panel: rectangle(panel), row: rectangle(row), text: hint.textContent };
    });
    assert(bounds.bodyScroll <= bounds.bodyWidth + 1, 'Appearance page overflows horizontally');
    assert(bounds.hintScroll <= bounds.hintWidth + 1, 'The compatibility hint overflows its text column');
    assert(bounds.panel.left >= -1 && bounds.panel.right <= bounds.viewport + 1, 'Appearance panel exceeds viewport');
    assert(bounds.row.left >= bounds.panel.left - 1 && bounds.row.right <= bounds.panel.right + 1, 'Performance option exceeds the full-page panel');
    assert.match(bounds.text, /25/); assert.match(bounds.text, /10/); assert.match(bounds.text, /blur|glass/i); assert.match(bounds.text, /extension/i);
    await page.screenshot({ path: path.join(output, `${width}-appearance-performance-hint.png`) });
    await checkbox.setChecked(false); await frames(page);
    assert.equal(await page.locator('body[data-cu-performance]').count(), 0);
    for (const key of reduced) {
        const input = page.locator('#cu-effect-' + key);
        assert.equal(await input.isDisabled(), false); assert.equal(await input.inputValue(), String(saved[key]));
        assert.equal(await input.getAttribute('title'), '');
    }
    assert.deepEqual(await values(page), { ...saved, backgroundDim: saved.backgroundDim + 1 });
    const restoredMotion = await motion(page);
    assert.deepEqual(restoredMotion, normalMotion, 'Turning off performance mode failed to restore normal motion');
    await dimmer.scrollIntoViewIfNeeded(); await dimmer.focus(); await dimmer.press('ArrowLeft'); await frames(page);
    assert.deepEqual(await values(page), saved);
    await page.locator('.cu-sheet-panel').press('Escape'); await page.locator('.cu-sheet').waitFor({ state: 'hidden' });
    report.uiCases.push({ width, normalMotion, activeMotion, restoredMotion, bounds, savedValuesRetained: true, dimmingAdjusted: true });
    console.log('PASS Appearance performance controls', width);
}

try {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, locale: 'en-US', reducedMotion: 'no-preference' });
    await context.addInitScript(() => localStorage.setItem('language', 'en'));
    await context.route('**/api/settings/get', async route => {
        const response = await route.fetch(), data = await response.json(), settings = JSON.parse(data.settings);
        settings.firstRun = false; settings.main_api = 'openai'; settings.active_character = null; settings.active_group = null;
        settings.power_user.chat_truncation = 50; settings.power_user.auto_scroll_chat_to_bottom = false;
        settings.extension_settings.claude_surface = { enabled: true, design: 'claude', mode: 'dark', background: true, nativePerformance: false, ...saved };
        settings.extension_settings.disabledExtensions = ['third-party/ST-BaiBai-Book', 'third-party/ST-BaiBai-Tools'];
        data.settings = JSON.stringify(settings); await route.fulfill({ response, json: data });
    });
    await context.route(/\/api\/tokenizers\/openai\/count(?:\?|$)/, route => route.fulfill({ json: { token_count: 42 } }));
    await context.route(/\/api\/(settings|themes|chats|groups|characters)\/(save|edit|delete|merge-attributes)(\?|$)/, route => route.fulfill({ json: { result: 'ok' } }));
    await context.route(/\/api\/extensions\/(install|update|delete|switch|move)(\?|$)/, route => route.abort());
    await context.route(/\/api\/.*(?:generate|completion)/, route => route.fulfill({ status: 503, body: 'Effects fixture: generation disabled' }));
    await context.route('**/api/extensions/version', route => route.fulfill({ json: { isUpToDate: true } }));
    const messages = Array.from({ length: 100 }, (_, i) => ({ name: 'Seraphina', is_user: false, is_system: false, send_date: '2026-11-14', mes: `Effect fixture message ${i + 1}\n\n${'Stable native layout and complete history. '.repeat(8)}`, extra: {} }));
    await context.route('**/api/chats/get', route => route.fulfill({ json: [{ user_name: 'User', character_name: 'Seraphina', chat_metadata: { tainted: true } }, ...messages] }));
    await context.route('**/api/chats/recent', route => route.fulfill({ json: [] }));
    await context.route('**/script.js', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: await response.text() + '\neventSource.on(event_types.APP_READY,()=>window.cuEffectsReady=true);', contentType: 'text/javascript' });
    });
    await context.route('**/scripts/extensions/third-party/claude-surface/**', async route => {
        const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/claude-surface/')[1]), filename = path.resolve(source, relative);
        if (!filename.startsWith(source + path.sep)) return route.abort();
        try { await route.fulfill({ body: await fs.readFile(filename), contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/json' }); }
        catch { await route.abort(); }
    });
    const page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', error => report.errors.push(String(error)));
    try {
        await page.goto(process.env.CU_TEST_URL || 'http://127.0.0.1:8010', { waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.cuEffectsReady && document.getElementById('cu-extension-native-performance'));
        await page.evaluate(async () => { await SillyTavern.getContext().selectCharacterById(0); });
        await page.waitForFunction(() => document.querySelectorAll('#chat>.mes').length === 50 && !document.querySelector('#chat>.mes>.mesAvatarWrapper'));
        await page.evaluate(() => {
            const foreign = document.createElement('div'); foreign.id = 'cu-foreign-effect'; foreign.style.filter = 'sepia(0.8)'; document.body.append(foreign);
            // A deterministic painted background verifies the image layer is
            // retained, without depending on the host's installed resources.
            document.getElementById('bg1').style.backgroundImage = 'linear-gradient(135deg, rgb(58, 88, 94), rgb(84, 54, 99))';
        });
        for (const [width, height] of process.env.CU_EFFECTS_UI_ONLY ? [] : [[393, 852], [1440, 900]]) {
            await page.setViewportSize({ width, height }); await frames(page);
            for (const design of ['claude', 'material', 'adwaita', 'swiss']) {
                await page.evaluate(design => {
                    const control = document.getElementById('cu-extension-design');
                    control.value = design; control.dispatchEvent(new Event('change', { bubbles: true }));
                }, design);
                await frames(page);
                await page.locator('#chat>.mes[mesid="74"]').evaluate(element => element.scrollIntoView({ block: 'start' })); await frames(page);
                const before = await snapshot(page);
                assert.match(before.backgroundImage, /linear-gradient/);
                assert.equal(before.glass, true); assert.equal(before.blurred, true); assert.match(before.backgroundFilter, /blur\(12px\)/);
                await setMode(page, true); await frames(page);
                const active = await snapshot(page);
                assert.equal(active.glass, false); assert.equal(active.blurred, false); assert.equal(active.opacity.trim(), '100%'); assert.equal(active.backdrop.trim(), 'none');
                assert.match(active.backgroundFilter, /brightness\(0\.65\)/); assert.doesNotMatch(active.backgroundFilter, /blur\((?!0px)/); assert.equal(active.spread.trim(), '0px');
                assert.equal(active.headerBackdrop, 'none'); assert.deepEqual(await values(page), saved); stableLayout(before, active);
                await page.screenshot({ path: path.join(output, `${width}-${design}-active.png`) });
                await setMode(page, false); await frames(page);
                const restored = await snapshot(page);
                assert.equal(restored.glass, true); assert.equal(restored.blurred, true); assert.equal(restored.opacity, before.opacity); assert.equal(restored.backdrop, before.backdrop); assert.equal(restored.backgroundFilter, before.backgroundFilter); assert.equal(restored.spread, before.spread);
                assert.deepEqual(await values(page), saved); stableLayout(before, restored);
                report.cases.push({ width, height, design, before, active, restored });
                console.log('PASS', width, design);
            }
        }
        await appearanceUI(page, 393);
        await appearanceUI(page, 320);
        assert.deepEqual(report.errors, []);
    } catch (error) { report.error = String(error); await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error; }
    finally { await context.close(); }
} finally { await browser.close(); await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2)); }
