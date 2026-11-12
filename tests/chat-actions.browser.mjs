/** Native chat actions must wait for a pending Surface selection.
 * Requires a local SillyTavern with the default Seraphina character.
 * Synthetic chats and intercepted writes leave server data unchanged.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const engines = await import(process.env.CU_PLAYWRIGHT_MODULE || 'playwright');
const source = path.resolve(process.env.CU_SOURCE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const output = process.env.CU_TEST_OUTPUT || path.join(source, 'artifacts/chat-actions');
await fs.mkdir(output, { recursive: true });
const engine = process.env.CU_ENGINE || 'chromium';
const executable = process.env[engine === 'webkit' ? 'CU_WEBKIT_EXECUTABLE' : 'CU_CHROMIUM_EXECUTABLE'];
const browser = await engines[engine].launch({ headless: true, ...(executable ? { executablePath: executable } : {}) });
const baseline = !!process.env.CU_BASELINE;
const report = { source, engine, baseline, cases: [] };
const header = { user_name: 'User', character_name: 'Seraphina', chat_metadata: { tainted: true } };
const departedText = 'Delayed response from departed chat';
const message = text => ({ name: 'Seraphina', is_user: false, is_system: false, send_date: '2026-11-11', mes: text, extra: {} });
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

try {
    for (const action of ['home', 'new-chat', 'history', 'home-then-character', 'home-then-character-then-home']) {
        const context = await browser.newContext({ viewport: { width: 412, height: 950 }, isMobile: true, hasTouch: true, locale: 'zh-CN' });
        await context.addInitScript(() => localStorage.setItem('language', 'zh-cn'));
        const loads = [], writes = [], errors = [], consoleErrors = [];
        let pointer = 'Current', pendingRoute, searchRequests = 0;
        let resolveRequested;
        const requested = new Promise(resolve => { resolveRequested = resolve; });
        await context.route('**/api/settings/get', async route => {
            const response = await route.fetch(), data = await response.json(), settings = JSON.parse(data.settings);
            settings.firstRun = false;
            settings.main_api = 'openai';
            settings.extension_settings.claude_surface = { enabled: true, design: 'claude', mode: 'dark' };
            settings.extension_settings.disabledExtensions = ['third-party/ST-BaiBai-Book', 'third-party/ST-BaiBai-Tools'];
            data.settings = JSON.stringify(settings);
            await route.fulfill({ response, json: data });
        });
        for (const endpoint of ['settings/save', 'themes/save', 'extensions/version']) {
            await context.route('**/api/' + endpoint, route => route.fulfill({ json: { result: 'ok', isUpToDate: true } }));
        }
        await context.route(/\/api\/(chats|groups)\/(save|edit)(\?|$)/, route => route.fulfill({ json: { result: 'ok' } }));
        await context.route('**/api/characters/merge-attributes', route => {
            const body = route.request().postDataJSON();
            pointer = body.chat || pointer;
            writes.push({ type: 'pointer', chat: pointer });
            return route.fulfill({ json: { result: 'ok' } });
        });
        await context.route('**/api/characters/edit', route => {
            const match = route.request().postData()?.match(/name="chat"\r\n\r\n([^\r\n]*)/);
            if (match) pointer = match[1];
            writes.push({ type: 'card', chat: pointer });
            return route.fulfill({ json: { result: 'ok' } });
        });
        await context.route('**/api/characters/get', async route => {
            const response = await route.fetch(), data = await response.json();
            data.chat = pointer;
            await route.fulfill({ response, json: data });
        });
        await context.route('**/api/chats/recent', route => route.fulfill({ json: [{
            avatar: 'default_Seraphina.png', file_name: 'Delayed History.jsonl', chat_items: 1, last_mes: '2026-11-11', mes: 'fixture',
        }] }));
        await context.route('**/api/chats/search', route => {
            searchRequests++;
            return route.fulfill({ json: [{ file_name: 'Other History', file_size: '1KB', message_count: 1, preview_message: 'Other chat fixture', last_mes: '2026-11-11' }] });
        });
        await context.route('**/api/chats/get', route => {
            const file = route.request().postDataJSON().file_name;
            loads.push(file);
            if (loads.length === 1 && !action.startsWith('home-then-character')) { pendingRoute = route; resolveRequested(); return; }
            return route.fulfill({ json: action === 'new-chat' ? [header] : [header, message('History response: ' + file)] });
        });
        await context.route('**/scripts/extensions/third-party/claude-surface/**', async route => {
            const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/claude-surface/')[1]);
            const file = path.resolve(source, relative);
            if (!file.startsWith(source + path.sep)) return route.abort();
            try {
                let body = await fs.readFile(file);
                if (relative === 'index.js') body = body + '\nObject.defineProperty(window,"cuChatActionsSelecting",{get:()=>!!state.selecting});';
                await route.fulfill({ body, contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/json' });
            } catch { await route.abort(); }
        });
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        page.on('pageerror', error => errors.push(String(error)));
        page.on('console', event => { if (event.type() === 'error') consoleErrors.push(event.text()); });
        const result = { action };
        report.cases.push(result);
        try {
            await page.goto(process.env.CU_TEST_URL || 'http://127.0.0.1:8010', { waitUntil: 'networkidle' });
            await page.waitForFunction(() => document.querySelector('.cu-home-history-toggle') && document.querySelector('.cu-recents .cu-character-row'));
            const initialWelcome = await page.evaluate(() => SillyTavern.getContext().chat.map(item => item.mes));
            await page.locator('.cu-home-history-toggle').click();
            await page.locator('.cu-home-history .cu-character-row').first().click();
            if (action.startsWith('home-then-character')) {
                const latestHome = action.endsWith('then-home');
                await page.waitForFunction(() => !window.cuChatActionsSelecting && SillyTavern.getContext().characterId != null);
                await page.evaluate(() => {
                    const current = SillyTavern.getContext();
                    let blockNextSave = true;
                    current.eventSource.on(current.eventTypes.ITEMIZED_PROMPTS_SAVED, async () => {
                        if (!blockNextSave) return;
                        blockNextSave = false;
                        window.cuHomeSaveBlocked = true;
                        await new Promise(resolve => { window.cuReleaseHomeSave = resolve; });
                    });
                });
                await page.locator('.cu-header .cu-home-action').click();
                await page.waitForFunction(() => window.cuHomeSaveBlocked);
                await page.locator('#cu-sidebar-toggle').click();
                await page.locator('.cu-recents .cu-character-row').first().click();
                if (latestHome) await page.locator('.cu-header .cu-home-action').click();
                await frames(page);
                result.pending = { loads: [...loads], selecting: await page.evaluate(() => window.cuChatActionsSelecting) };
                if (!baseline) {
                    assert.equal(result.pending.selecting, true, 'Home must hold the navigation lock while native storage/events settle');
                    assert.equal(loads.length, 1, 'A new selection ran before Home finished clearing the previous chat');
                }
                await page.evaluate(() => window.cuReleaseHomeSave());
                if (!baseline) await page.waitForFunction(home => !window.cuChatActionsSelecting && (home ? SillyTavern.getContext().characterId == null : SillyTavern.getContext().characterId != null), latestHome);
                await frames(page);
                result.final = await page.evaluate(() => {
                    const current = SillyTavern.getContext();
                    return { characterId: current.characterId ?? null, selecting: window.cuChatActionsSelecting, chat: current.chat.map(item => item.mes), home: document.body.classList.contains('cu-home'), rendered: document.querySelectorAll('#chat>.mes').length };
                });
                Object.assign(result, { loads, writes, errors, consoleErrors });
                if (!baseline) {
                    assert.deepEqual(errors, []);
                    assert(!consoleErrors.some(error => error.includes('[Claude Surface]')), JSON.stringify(consoleErrors));
                    if (latestHome) {
                        assert.equal(result.final.characterId, null);
                        assert.equal(result.final.home, true, 'The latest Home intent was replaced by an earlier queued character');
                        assert.deepEqual(result.final.chat, initialWelcome);
                        assert.deepEqual(loads, ['Delayed History'], 'A superseded queued character was needlessly loaded');
                    } else {
                        assert.notEqual(result.final.characterId, null, 'The older Home completion discarded the newer character selection');
                        assert.equal(result.final.home, false);
                        assert.deepEqual(result.final.chat, ['History response: Delayed History']);
                        assert.equal(result.final.rendered, 1);
                        assert.deepEqual(loads, ['Delayed History', 'Delayed History']);
                    }
                }
                await page.screenshot({ path: path.join(output, action + '.png') });
                console.log('PASS', action, JSON.stringify({ loads, errors }));
                continue;
            }
            await requested;
            assert.equal(await page.evaluate(() => window.cuChatActionsSelecting), true);
            if (action === 'home') await page.locator('.cu-header .cu-home-action').click();
            else {
                await page.locator('.cu-header button[aria-label="聊天操作"]').click();
                await page.locator('.cu-sheet').getByRole('button', { name: action === 'new-chat' ? '新建聊天' : '聊天记录', exact: true }).click();
            }
            await frames(page);
            result.pending = { loads: [...loads], searchRequests, popupVisible: await page.locator(action === 'history' ? '#select_chat_popup:visible' : '.popup-button-ok:visible').count() };
            if (!baseline) {
                assert.deepEqual(loads, ['Delayed History'], 'Another native chat loaded before the original selection settled');
                assert.equal(searchRequests, 0, 'Native history searched before its selected character settled');
                assert.equal(result.pending.popupVisible, 0, 'Native action opened during the original selection');
                assert.equal(await page.evaluate(() => window.cuChatActionsSelecting && SillyTavern.getContext().characterId != null), true);
            } else if (action === 'home') await page.waitForFunction(() => SillyTavern.getContext().characterId == null);
            else {
                await page.locator(action === 'new-chat' ? '.popup-button-ok:visible' : '#select_chat_div .select_chat_block').first().click();
                await page.waitForFunction(() => document.querySelectorAll('#chat>.mes').length === 1 && SillyTavern.getContext().chat.length === 1);
            }
            await pendingRoute.fulfill({ json: [header, message(departedText)] });
            await page.waitForFunction(() => !window.cuChatActionsSelecting);
            if (action === 'home') {
                await page.waitForFunction(() => SillyTavern.getContext().characterId == null);
                if (!baseline) await page.waitForFunction(initial => JSON.stringify(SillyTavern.getContext().chat.map(item => item.mes)) === JSON.stringify(initial), initialWelcome);
            } else {
                if (!baseline) await page.locator(action === 'new-chat' ? '.popup-button-ok:visible' : '#select_chat_div .select_chat_block').first().click();
                await page.waitForFunction(kind => {
                    const current = SillyTavern.getContext();
                    const selected = kind === 'history' ? current.getCurrentChatId() === 'Other History' : current.getCurrentChatId()?.startsWith('Seraphina - ');
                    return selected && current.chat.length === 1 && document.querySelectorAll('#chat>.mes').length === 1;
                }, action);
            }
            await frames(page);
            result.final = await page.evaluate(() => {
                const current = SillyTavern.getContext();
                return { characterId: current.characterId ?? null, selecting: window.cuChatActionsSelecting, chat: current.chat.map(item => item.mes), file: current.getCurrentChatId(), home: document.body.classList.contains('cu-home'), rendered: document.querySelectorAll('#chat>.mes').length };
            });
            Object.assign(result, { loads, writes, errors, consoleErrors });
            if (!baseline) {
                assert.deepEqual(errors, []);
                assert(!consoleErrors.some(error => error.includes('[Claude Surface]')), JSON.stringify(consoleErrors));
                assert(!result.final.chat.includes(departedText), 'Departed chat response survived the latest navigation intent');
                if (action === 'home') {
                    assert.equal(result.final.characterId, null);
                    assert.equal(result.final.home, true);
                    assert.deepEqual(result.final.chat, initialWelcome, 'Home did not restore the native welcome messages');
                    assert.deepEqual(loads, ['Delayed History']);
                } else {
                    assert.equal(result.final.rendered, 1);
                    assert.equal(loads.length, 2, 'Earlier history was loaded again after the newer native action');
                    assert.equal(loads[0], 'Delayed History');
                    if (action === 'history') { assert.equal(result.final.file, 'Other History'); assert.deepEqual(result.final.chat, ['History response: Other History']); }
                    else assert(result.final.file.startsWith('Seraphina - '), 'New chat used an unhydrated character name');
                }
            }
            await page.screenshot({ path: path.join(output, action + '.png') });
            console.log('PASS', action, JSON.stringify({ loads, searchRequests, errors }));
        } catch (error) {
            result.error = String(error); result.errors = errors; result.consoleErrors = consoleErrors;
            await page.screenshot({ path: path.join(output, action + '-failure.png') }).catch(() => {});
            throw error;
        } finally {
            await context.close();
            await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2));
        }
    }
} finally { await browser.close(); }
