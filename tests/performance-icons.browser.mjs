/** Performance reasoning icons retain native controls while avoiding per-message
 * SVG subtrees. All settings/chat/card writes and background tokenization are
 * deterministic fixture routes. No elapsed-time performance claims are made.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const engines = await import(process.env.CU_PLAYWRIGHT_MODULE || 'playwright');
const source = path.resolve(process.env.CU_SOURCE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const output = process.env.CU_TEST_OUTPUT || path.join(source, 'artifacts/performance-icons');
await fs.mkdir(output, { recursive: true });
const engine = process.env.CU_ENGINE || 'chromium';
const executablePath = process.env[engine === 'webkit' ? 'CU_WEBKIT_EXECUTABLE' : 'CU_CHROMIUM_EXECUTABLE'];
const browser = await engines[engine].launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const report = { source, engine, browser: browser.version(), timingClaims: false, scenarios: [] };
const names = ['copy', 'edit', 'close_all', 'edit_done', 'edit_cancel', 'delete'];
const reasoning = 'Populated closed native reasoning: preserve copy and edit actions.';
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function fixture({ noMasks = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, locale: 'en-US' });
    await context.addInitScript(({ noMasks }) => {
        localStorage.setItem('language', 'en');
        window.cuIconAudit = { clicks: {}, clipboard: [], edited: 0 };
        window.cuGlyphDecorationVisits = 0;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.cuIconAudit.clipboard.push(text); } } });
        if (noMasks) {
            const supports = CSS.supports.bind(CSS);
            CSS.supports = (...args) => /mask(?:-image)?\b/.test(String(args[0])) ? false : supports(...args);
        }
    }, { noMasks });
    await context.route('**/api/settings/get', async route => {
        const response = await route.fetch(), data = await response.json(), settings = JSON.parse(data.settings);
        settings.firstRun = false; settings.main_api = 'openai'; settings.active_character = null; settings.active_group = null;
        settings.power_user.chat_truncation = 50; settings.power_user.auto_scroll_chat_to_bottom = true; settings.power_user.auto_save_msg_edits = false;
        settings.power_user.reasoning ??= {}; settings.power_user.reasoning.auto_expand = false;
        settings.extension_settings.claude_surface = { enabled: true, design: 'claude', mode: 'dark', nativePerformance: false };
        settings.extension_settings.disabledExtensions = ['third-party/ST-BaiBai-Book', 'third-party/ST-BaiBai-Tools'];
        data.settings = JSON.stringify(settings); await route.fulfill({ response, json: data });
    });
    await context.route(/\/api\/tokenizers\/openai\/count(?:\?|$)/, route => route.fulfill({ json: { token_count: 42 } }));
    await context.route(/\/api\/(settings|themes|chats|groups|characters)\/(save|edit|delete|merge-attributes)(\?|$)/, route => route.fulfill({ json: { result: 'ok' } }));
    await context.route(/\/api\/extensions\/(install|update|delete|switch|move)(\?|$)/, route => route.abort());
    await context.route(/\/api\/.*(?:generate|completion)/, route => route.fulfill({ status: 503, body: 'Icon fixture: generation disabled' }));
    await context.route('**/api/extensions/version', route => route.fulfill({ json: { isUpToDate: true } }));
    const messages = Array.from({ length: 1000 }, (_, i) => ({ name: 'Seraphina', is_user: false, is_system: false, send_date: '2026-11-14', mes: `Icon fixture message ${i + 1}\n\nNative controls remain intact.`, extra: i === 997 ? { reasoning } : {} }));
    await context.route('**/api/chats/get', route => route.fulfill({ json: [{ user_name: 'User', character_name: 'Seraphina', chat_metadata: { tainted: true } }, ...messages] }));
    await context.route('**/api/chats/recent', route => route.fulfill({ json: [] }));
    await context.route('**/script.js', async route => {
        const response = await route.fetch(); let text = await response.text();
        text = text.replace('export async function saveChatConditional() {', 'export async function saveChatConditional() { window.cuIconSaveCalls=(window.cuIconSaveCalls||0)+1;try {');
        const end = text.indexOf('\n}', text.indexOf('export async function saveChatConditional() {'));
        assert(end > 0, 'Native pending-save instrumentation target missing');
        text = text.slice(0, end) + '\n}finally{window.cuIconSaveCalls--}' + text.slice(end);
        text += '\neventSource.on(event_types.APP_READY,()=>window.cuIconReady=true);';
        await route.fulfill({ response, body: text, contentType: 'text/javascript' });
    });
    await context.route('**/scripts/extensions/third-party/claude-surface/**', async route => {
        const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/claude-surface/')[1]), filename = path.resolve(source, relative);
        if (!filename.startsWith(source + path.sep)) return route.abort();
        try {
            let body = await fs.readFile(filename);
            if (relative === 'index.js') {
                let text = body.toString();
                const start = text.indexOf('function decorateMessages('), end = text.indexOf('function trackEditorWidth(', start);
                assert(start >= 0 && end > start, 'Full-message decorator counter target missing');
                let part = text.slice(start, end); assert(part.includes('forEach(message => {'));
                part = part.replace('forEach(message => {', 'forEach(message => { window.cuGlyphDecorationVisits++;');
                body = text.slice(0, start) + part + text.slice(end);
            }
            await route.fulfill({ body, contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/json' });
        }
        catch { await route.abort(); }
    });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    await page.goto(process.env.CU_TEST_URL || 'http://127.0.0.1:8010', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.cuIconReady && !window.cuIconSaveCalls && document.getElementById('cu-extension-native-performance'));
    await page.evaluate(() => SillyTavern.getContext().selectCharacterById(0, { switchMenu: false }));
    await page.waitForFunction(() => !window.cuIconSaveCalls && document.querySelectorAll('#chat > .mes').length === 50);
    await frames(page);
    await page.evaluate(() => {
        document.addEventListener('click', event => {
            const control = event.target.closest?.('[class*="mes_reasoning_"]');
            const name = ['copy', 'edit', 'close_all', 'edit_done', 'edit_cancel', 'delete'].find(name => control?.classList.contains('mes_reasoning_' + name));
            if (name) window.cuIconAudit.clicks[name] = (window.cuIconAudit.clicks[name] || 0) + 1;
        }, true);
        const c = SillyTavern.getContext(); c.eventSource.on(c.eventTypes.MESSAGE_REASONING_EDITED, () => window.cuIconAudit.edited++);
    });
    return { context, page, errors };
}

async function state(page) {
    return page.evaluate(({ names }) => {
        const c = SillyTavern.getContext(), all = [...document.querySelectorAll('#chat > .mes .mes_reasoning_actions')];
        const populated = document.querySelector('#chat > .mes[mesid="997"]');
        return {
            visible: document.querySelectorAll('#chat > .mes').length, data: c.chat.length,
            elements: document.querySelectorAll('#chat *').length,
            svgs: all.reduce((sum, actions) => sum + actions.querySelectorAll('svg:not(#cu-foreign-reasoning-icon)').length, 0),
            masks: document.body.hasAttribute('data-cu-reasoning-masks'),
            populatedOpen: populated.querySelector('details').open,
            masksByControl: names.map(name => {
                const control = populated.querySelector('.mes_reasoning_' + name), style = getComputedStyle(control, '::before');
                return { name, mask: style.maskImage || style.webkitMaskImage, width: style.width, height: style.height };
            }),
            foreignConnected: !!document.getElementById('cu-foreign-reasoning-icon'),
            sameCopyControl: window.cuOriginalIconCopy ? document.querySelector('#chat > .mes[mesid="996"] .mes_reasoning_copy') === window.cuOriginalIconCopy : null,
        };
    }, { names });
}
const mode = async (page, value) => {
    await page.evaluate(value => { const input = document.getElementById('cu-extension-native-performance'); input.checked = value; input.dispatchEvent(new Event('change', { bubbles: true })); }, value);
    await frames(page);
};
const settlePath = (page, { masks, svgs }) => page.waitForFunction(({ masks, svgs }) => document.body.hasAttribute('data-cu-reasoning-masks') === masks
    && document.querySelectorAll('#chat > .mes .mes_reasoning_actions svg:not(#cu-foreign-reasoning-icon)').length === svgs, { masks, svgs });

try {
    for (const noMasks of [false, true]) {
        const f = await fixture({ noMasks }); const { page, errors } = f;
        const scenario = { noMasks, checks: [], stages: [] }; report.scenarios.push(scenario);
        const check = (name, value, expected) => { assert.deepEqual(value, expected, name); scenario.checks.push(name); };
        const setMode = async value => { await mode(page, value); await settlePath(page, { masks: value && !noMasks, svgs: value && !noMasks ? 0 : 50 * 6 - 1 }); };
        try {
            const before = await state(page); scenario.stages.push({ name: 'before', ...before });
            check('fixture starts with complete data and 50 rendered messages', [before.data, before.visible], [1000, 50]);
            check('ordinary Surface reasoning icons retain one SVG per action', before.svgs, 50 * 6);
            check('populated reasoning starts closed', before.populatedOpen, false);
            await page.evaluate(() => {
                const control = document.querySelector('#chat > .mes[mesid="996"] .mes_reasoning_copy'); window.cuOriginalIconCopy = control;
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.id = 'cu-foreign-reasoning-icon'; svg.setAttribute('width', '8'); svg.setAttribute('height', '8'); control.append(svg);
            });
            await setMode(true); const active = await state(page); scenario.stages.push({ name: 'active', ...active });
            check('mode does not re-render or truncate already loaded messages', [active.data, active.visible], [1000, 50]);
            check('native controls retain identity and foreign SVG children', [active.sameCopyControl, active.foreignConnected], [true, true]);
            check('mask capability controls the optimized icon path', active.masks, !noMasks);
            check('empty and populated closed controls use the expected SVG path', active.svgs, noMasks ? 50 * 6 - 1 : 0);
            if (!noMasks) {
                assert(before.elements - active.elements >= 50 * 6, 'Mask path did not reduce the SVG DOM at a fixed message count');
                assert(active.masksByControl.every(control => control.mask !== 'none' && control.width === '14px' && control.height === '14px'), JSON.stringify(active.masksByControl));
                scenario.checks.push('all six actions have masks before populated details opens');
            } else {
                assert(active.masksByControl.every(control => control.mask === 'none'), JSON.stringify(active.masksByControl));
                check('unsupported-mask fallback SVG remains visible', await page.locator('#chat > .mes[mesid="997"] .mes_reasoning_copy svg:not(#cu-foreign-reasoning-icon)').evaluate(svg => getComputedStyle(svg).display), 'block');
            }
            const target = page.locator('#chat > .mes[mesid="997"]');
            // Native ST hides its action group while details is collapsed.
            // The six glyphs must already be prepared, then work when exposed.
            await target.locator('.mes_reasoning_header').click();
            await page.waitForFunction(() => document.querySelector('#chat > .mes[mesid="997"] details').open);
            await target.locator('.mes_reasoning_copy').click();
            await page.waitForFunction(() => window.cuIconAudit.clipboard.length === 1);
            check('opening prepared summary preserves native one-click clipboard content', await page.evaluate(() => window.cuIconAudit.clipboard), [reasoning]);
            await setMode(false); const released = await state(page); scenario.stages.push({ name: 'released', ...released });
            check('mode off restores ordinary SVGs and preserves third-party child', [released.svgs, released.foreignConnected, released.sameCopyControl, released.masks], [50 * 6 - 1, true, true, false]);
            await setMode(true);
            check('mode changes preserve expanded reasoning state', await target.locator('details').evaluate(details => details.open), true);
            await target.locator('.mes_reasoning_edit').click(); await target.locator('.reasoning_edit_textarea').fill('Cancelled reasoning draft');
            await target.locator('.mes_reasoning_edit_cancel').click();
            await page.waitForFunction(() => !document.querySelector('.reasoning_edit_textarea'));
            check('native reasoning cancel retains original content', await page.evaluate(() => SillyTavern.getContext().chat[997].extra.reasoning), reasoning);
            await target.locator('.mes_reasoning_edit').click(); await target.locator('.reasoning_edit_textarea').fill('Saved reasoning draft');
            await target.locator('.mes_reasoning_edit_done').click();
            await page.waitForFunction(() => !window.cuIconSaveCalls && !document.querySelector('.reasoning_edit_textarea') && window.cuIconAudit.edited === 1);
            check('native reasoning confirm saves once', await page.evaluate(() => [SillyTavern.getContext().chat[997].extra.reasoning, window.cuIconAudit.edited]), ['Saved reasoning draft', 1]);
            await target.locator('.mes_reasoning_edit').click();
            await target.locator('.mes_reasoning_delete').click();
            await page.locator('dialog[open] .popup-button-cancel').last().click();
            check('native delete confirmation can be cancelled without clearing reasoning', await page.evaluate(() => SillyTavern.getContext().chat[997].extra.reasoning), 'Saved reasoning draft');
            await target.locator('.mes_reasoning_edit_cancel').click();
            await target.locator('.mes_reasoning_close_all').click();
            await page.waitForFunction(() => !document.querySelector('#chat > .mes[mesid="997"] details').open);
            scenario.checks.push('native collapse action closes the expanded reasoning block');
            check('all six native controls do not acquire duplicate handlers', await page.evaluate(() => window.cuIconAudit.clicks), { copy: 1, edit: 3, edit_cancel: 2, edit_done: 1, delete: 1, close_all: 1 });
            await frames(page); await settlePath(page, { masks: !noMasks, svgs: noMasks ? 50 * 6 - 1 : 0 });
            const afterEdit = await state(page); scenario.stages.push({ name: 'after-edit', ...afterEdit });
            check('native update re-renders controls in the selected icon path', [afterEdit.masks, afterEdit.svgs, afterEdit.data], [!noMasks, noMasks ? 50 * 6 - 1 : 0, 1000]);
            await page.screenshot({ path: path.join(output, noMasks ? 'fallback.png' : 'masks.png') });
            await setMode(false);
            await target.locator('.mes_reasoning_copy').evaluate(control => { window.cuExternallyRemovedGlyph = control.querySelector('svg'); window.cuExternallyRemovedGlyph.remove(); });
            await page.waitForFunction(() => {
                const svg = document.querySelector('#chat > .mes[mesid="997"] .mes_reasoning_copy svg');
                return svg && svg !== window.cuExternallyRemovedGlyph;
            });
            scenario.checks.push('external removal of a current owned SVG triggers native icon repair');
            await page.evaluate(() => {
                const control = document.querySelector('#chat > .mes[mesid="995"] .mes_reasoning_copy');
                window.cuMixedOriginalGlyph = control.querySelector('svg');
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.id = 'cu-mixed-foreign-glyph'; svg.setAttribute('width', '8'); svg.setAttribute('height', '8');
                control.append(svg, document.createTextNode('Foreign reasoning action'));
            });
            await page.waitForFunction(() => !window.cuMixedOriginalGlyph.isConnected && document.getElementById('cu-mixed-foreign-glyph')?.isConnected);
            check('mixed foreign SVG and label mutations still release owned glyphs', await page.locator('#chat > .mes[mesid="995"] .mes_reasoning_copy').textContent(), 'Foreign reasoning action');
            await target.locator('.mes_reasoning_copy').evaluate(control => {
                const next = document.createElement('div'); next.className = control.className; next.title = control.title;
                window.cuReplacementReasoningControl = next; control.replaceWith(next);
            });
            await page.waitForFunction(() => window.cuReplacementReasoningControl?.querySelector('svg'));
            scenario.checks.push('a native action replacement is decorated instead of skipped as an own SVG change');
            await target.locator('.mes_reasoning_header').click();
            await target.locator('.mes_reasoning_copy').click(); await page.waitForFunction(() => window.cuIconAudit.clipboard.length === 2);
            check('replacement native control retains delegated copy behavior exactly once', await page.evaluate(() => window.cuIconAudit.clipboard.at(-1)), 'Saved reasoning draft');
            assert.deepEqual(errors, []); scenario.errors = errors;
            console.log('PASS', noMasks ? 'unsupported-mask fallback' : 'performance masks', scenario.checks.length);
        } catch (error) {
            scenario.error = String(error); scenario.errors = errors;
            await page.screenshot({ path: path.join(output, noMasks ? 'fallback-failure.png' : 'masks-failure.png') }).catch(() => {}); throw error;
        } finally { await f.context.close(); await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2)); }
    }
    if (!process.env.CU_ICON_SKIP_LARGE) {
        const f = await fixture(); const { page, errors } = f;
        const scenario = { type: '500-message activation', checks: [], timingClaims: false }; report.scenarios.push(scenario);
        const check = (name, value, expected) => { assert.deepEqual(value, expected, name); scenario.checks.push(name); };
        try {
            await page.evaluate(async () => { const host = await import('/script.js'); await host.showMoreMessages(450); });
            await page.waitForFunction(() => document.querySelectorAll('#chat > .mes').length === 500 && document.querySelectorAll('#chat > .mes .mes_reasoning_actions svg').length === 3000);
            const target = page.locator('#chat > .mes[mesid="997"]');
            await target.locator('.mes_edit').click(); await page.locator('#curEditTextarea').click();
            await page.locator('#curEditTextarea').fill('Long unsaved icon conversion draft.\n'.repeat(1000));
            await page.locator('#curEditTextarea').evaluate(editor => { window.cuLargeIconEditor = editor; editor.focus(); editor.setSelectionRange(41, 78); });
            await frames(page);
            const editorState = () => page.evaluate(() => ({ same: window.cuLargeIconEditor === document.getElementById('curEditTextarea'), value: document.getElementById('curEditTextarea')?.value,
                focused: document.activeElement === document.getElementById('curEditTextarea'), start: document.getElementById('curEditTextarea')?.selectionStart,
                end: document.getElementById('curEditTextarea')?.selectionEnd, scroll: document.getElementById('chat').scrollTop }));
            const before = await editorState();
            await page.evaluate(() => { window.cuGlyphDecorationVisits = 0; });
            const immediate = await page.evaluate(() => {
                window.cuIconHeartbeat = null;
                const heartbeat = () => { window.cuIconHeartbeat = { remaining: document.querySelectorAll('#chat > .mes .mes_reasoning_actions svg').length }; };
                // scheduler.yield continuations outrank ordinary timers. Use
                // actual user-blocking priority where supported, timer order
                // in the Safari fallback, to model pending input work.
                if (globalThis.scheduler?.postTask) scheduler.postTask(heartbeat, { priority: 'user-blocking' });
                else setTimeout(heartbeat, 0);
                const input = document.getElementById('cu-extension-native-performance'); input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true }));
                return document.querySelectorAll('#chat > .mes .mes_reasoning_actions svg').length;
            });
            assert(immediate > 0, 'Activating mode synchronously converted all500 SVG subtrees');
            scenario.checks.push('large activation yields before converting all500 messages'); scenario.remainingImmediately = immediate;
            await page.waitForFunction(() => window.cuIconHeartbeat);
            scenario.heartbeat = await page.evaluate(() => window.cuIconHeartbeat);
            assert(scenario.heartbeat.remaining > 0, 'A queued input/task could not run before all conversion completed');
            scenario.checks.push('another queued task runs before conversion completes');
            await settlePath(page, { masks: true, svgs: 0 });
            await frames(page); await frames(page);
            scenario.glyphOnlyDecorations = await page.evaluate(() => window.cuGlyphDecorationVisits);
            check('ordinary glyph-only activation does not revisit message avatars or controls', scenario.glyphOnlyDecorations, 0);
            const active = await editorState();
            check('large conversion retains editor identity, text, caret and focus', { ...active, scroll: undefined }, { ...before, scroll: undefined });
            assert(Math.abs(active.scroll - before.scroll) < 2, 'Large conversion changed the reading position'); scenario.checks.push('large conversion preserves reading position');
            await page.evaluate(() => { window.cuGlyphDecorationVisits = 0; });
            await mode(page, false); await settlePath(page, { masks: false, svgs: 3000 }); await frames(page); await frames(page);
            scenario.ordinaryOffDecorations = await page.evaluate(() => window.cuGlyphDecorationVisits);
            check('ordinary glyph-only release does not revisit message avatars or controls', scenario.ordinaryOffDecorations, 0);
            const rapid = await page.evaluate(() => {
                const input = document.getElementById('cu-extension-native-performance');
                for (const value of [true, false, true, false]) { input.checked = value; input.dispatchEvent(new Event('change', { bubbles: true })); }
                return document.querySelectorAll('#chat > .mes').length;
            });
            check('rapid toggles retain all native DOM messages', rapid, 500);
            await settlePath(page, { masks: false, svgs: 3000 }); await frames(page); await frames(page);
            check('cancelled conversion cannot reapply stale masks', await page.locator('#chat [data-cu-reasoning-mask]').count(), 0);
            const released = await editorState();
            check('rapid release retains complete active draft and selection', { ...released, scroll: undefined }, { ...before, scroll: undefined });
            assert(Math.abs(released.scroll - before.scroll) < 2); scenario.checks.push('rapid release preserves reading position');
            check('large history data and first/last rendered IDs remain intact', await page.evaluate(() => [SillyTavern.getContext().chat.length, document.querySelector('#chat > .mes').getAttribute('mesid'), [...document.querySelectorAll('#chat > .mes')].at(-1).getAttribute('mesid')]), [1000, '500', '999']);
            scenario.rapidToggleDecorations = await page.evaluate(() => window.cuGlyphDecorationVisits);
            assert.deepEqual(errors, []); scenario.errors = errors;
            await page.screenshot({ path: path.join(output, 'large-activation.png') });
            console.log('PASS large activation', scenario.checks.length);
        } catch (error) {
            scenario.error = String(error); scenario.errors = errors;
            await page.screenshot({ path: path.join(output, 'large-failure.png') }).catch(() => {}); throw error;
        } finally { await f.context.close(); await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2)); }
    }
} finally { await browser.close(); }
