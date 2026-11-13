import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const playwright = await import(process.env.CU_PLAYWRIGHT_MODULE || 'playwright');
export const baseSource = path.resolve(process.env.CU_SOURCE || path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'));
export const artifactRoot = process.env.CU_TEST_OUTPUT || path.join(baseSource, 'artifacts/message-edit-controls');
export const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
export async function fixture({ source = baseSource, total = 7, limit = total, chars = 30000, width = 412, height = 950, design = 'claude', traceOwnership = true, toolbarCpu = false } = {}) {
    const engine = process.env.CU_ENGINE || 'chromium';
    const executable = process.env[engine === 'webkit' ? 'CU_WEBKIT_EXECUTABLE' : 'CU_CHROMIUM_EXECUTABLE'];
    const browser = await playwright[engine].launch({ headless: true, executablePath: executable });
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 900, hasTouch: width < 900, locale: 'zh-CN' });
    await context.addInitScript(({ traceOwnership }) => {
        localStorage.setItem('language', 'zh-cn');
        const audit = window.cuEditAudit = { visits: 0, calls: 0, actions: {}, events: {}, selectors: [], ownedSelectors: [], listeners: [], observers: [], saves: 0, syncMs: [], refreshCalls: 0 };
        if (!traceOwnership) return;
        const owned = () => { const lines = new Error().stack.split('\n'); const caller = lines[0].startsWith('Error') ? lines[3] : lines[2]; return (caller || '').includes('message-edit-controls.js'); };
        const nativeAdd = EventTarget.prototype.addEventListener, nativeRemove = EventTarget.prototype.removeEventListener;
        const capture = options => typeof options === 'boolean' ? options : !!options?.capture;
        EventTarget.prototype.addEventListener = function(type, callback, options) {
            if (owned()) audit.listeners.push({ target: new WeakRef(this), type, callback: new WeakRef(callback), capture: capture(options) });
            return nativeAdd.call(this, type, callback, options);
        };
        EventTarget.prototype.removeEventListener = function(type, callback, options) {
            for (let i = audit.listeners.length - 1; i >= 0; i--) { const entry = audit.listeners[i]; if (entry.target.deref() === this && entry.type === type && entry.callback.deref() === callback && entry.capture === capture(options)) audit.listeners.splice(i, 1); }
            return nativeRemove.call(this, type, callback, options);
        };
        const NativeMO = MutationObserver;
        window.MutationObserver = class extends NativeMO {
            constructor(callback) {
                const tracked = owned() ? { active: false, callbacks: 0, records: 0 } : null;
                super((records, observer) => { if (tracked) { tracked.callbacks++; tracked.records += records.length; } return callback(records, observer); });
                this.tracked = tracked; if (tracked) audit.observers.push(tracked);
            }
            observe(...args) { if (this.tracked) this.tracked.active = true; return super.observe(...args); }
            disconnect() { if (this.tracked) this.tracked.active = false; return super.disconnect(); }
        };
        for (const proto of [Document.prototype, Element.prototype]) for (const name of ['querySelector', 'querySelectorAll']) {
            const original = proto[name];
            proto[name] = function(selector) {
                const item = { method: name, root: this === document ? 'document' : this.id || this.className?.toString()?.slice(0, 80), selector };
                if ((this === document && /#chat|\.mes\b|curEditTextarea/.test(selector)) || this.id === 'chat') audit.selectors.push(item);
                if (owned()) audit.ownedSelectors.push(item);
                return original.call(this, selector);
            };
        }
    }, { traceOwnership });
    let pointer = 'Audit Default'; const requests = { loads: [], saves: [], settings: [], pointer: [] };
    await context.route('**/api/settings/get', async route => { const response = await route.fetch(), data = await response.json(), settings = JSON.parse(data.settings); settings.firstRun = false; settings.main_api = 'openai'; settings.power_user.chat_truncation = limit; settings.power_user.auto_scroll_chat_to_bottom = true; settings.extension_settings.claude_surface = { enabled: true, design, mode: 'dark' }; settings.extension_settings.disabledExtensions = ['third-party/ST-BaiBai-Book', 'third-party/ST-BaiBai-Tools']; data.settings = JSON.stringify(settings); await route.fulfill({ response, json: data }); });
    await context.route('**/api/settings/save', route => { requests.settings.push(route.request().postData()); return route.fulfill({ json: { result: 'ok' } }); });
    await context.route('**/api/themes/save', route => route.fulfill({ json: { result: 'ok' } }));
    await context.route('**/api/extensions/version', route => route.fulfill({ json: { isUpToDate: true } }));
    await context.route('**/api/characters/get', async route => { const response = await route.fetch(), data = await response.json(); data.chat = pointer; await route.fulfill({ response, json: data }); });
    await context.route('**/api/characters/merge-attributes', route => { const body = route.request().postDataJSON(); pointer = body.chat; requests.pointer.push(body); return route.fulfill({ json: { result: 'ok' } }); });
    await context.route('**/api/characters/edit', route => route.fulfill({ json: { result: 'ok' } }));
    await context.route(/\/api\/(chats|groups|chat-completions)\/(save|edit|generate)(\?|$)/, route => { requests.saves.push({ url: route.request().url(), body: route.request().postDataJSON() }); return route.fulfill({ json: { result: 'ok' } }); });
    const targetId = total - 3;
    const longLine = '大文本编辑回归，保留原生字符和每一行。\n';
    const longText = longLine.repeat(Math.ceil(chars / longLine.length)).slice(0, chars);
    const messages = Array.from({ length: total }, (_, index) => ({ name: index % 2 ? 'User' : 'Seraphina', is_user: !!(index % 2), is_system: false, send_date: '2026-11-13T03:00:00Z', mes: index === targetId ? longText : `Audit message ${index}\n\n${'Native message '.repeat(8)}`, extra: {} }));
    await context.route('**/api/chats/get', route => { requests.loads.push(route.request().postDataJSON().file_name); return route.fulfill({ json: [{ user_name: 'User', character_name: 'Seraphina', chat_metadata: { tainted: true } }, ...messages] }); });
    await context.route('**/api/chats/recent', route => route.fulfill({ json: [{ avatar: 'default_Seraphina.png', file_name: 'Edit Audit History.jsonl', chat_items: total, last_mes: '2026-11-13', mes: 'fixture' }] }));
    await context.route('**/scripts/extensions/third-party/claude-surface/**', async route => {
        const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/claude-surface/')[1]), file = path.resolve(source, relative);
        if (!file.startsWith(path.resolve(source) + path.sep)) return route.abort();
        try { let body = await fs.readFile(file); if (relative === 'message-edit-controls.js' && toolbarCpu) { body = body.toString().replace('const rootObserver = new Observer(', 'const nativeSynchronize = synchronize; synchronize = (...args) => { const start = performance.now(); try { return nativeSynchronize(...args); } finally { window.cuEditAudit.syncMs.push(performance.now() - start); } }; const rootObserver = new Observer(').replace('function refresh(messages) {', 'function refresh(messages) { window.cuEditAudit.refreshCalls++;'); } if (relative === 'index.js') { let text = body.toString(); const start = text.indexOf('function decorateMessages('), end = text.indexOf('function captureEditorAnchor(', start); let part = text.slice(start, end); const brace = part.indexOf('{'); part = part.slice(0, brace + 1) + 'window.cuEditAudit.calls++;' + part.slice(brace + 1); part = part.replace('forEach(message => {', 'forEach(message => {window.cuEditAudit.visits++;'); text = text.slice(0, start) + part + text.slice(end); body = text + '\nwindow.cuAuditState=state;window.cuAuditSettings=settings;window.cuAuditAppearance=applyAppearance;'; } await route.fulfill({ body, contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/json' }); } catch { await route.abort(); }
    });
    const page = await context.newPage(); page.setDefaultTimeout(25000); const errors = []; page.on('pageerror', error => errors.push(String(error)));
    await page.goto(process.env.CU_TEST_URL || 'http://127.0.0.1:8010', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('.cu-recents .cu-character-row') && document.querySelector('#chat .welcomePanel'));
    await page.locator('.cu-home-history-toggle').click(); await page.locator('.cu-home-history .cu-character-row').first().click();
    await page.waitForFunction(n => !window.cuAuditState.selecting && document.querySelectorAll('#chat>.mes').length === n, limit); await frames(page);
    await page.evaluate(() => {
        for (const action of ['done', 'cancel', 'copy', 'up', 'down', 'delete', 'add_reasoning']) document.addEventListener('click', event => { if (event.target.closest?.('.mes_edit_' + action)) cuEditAudit.actions[action] = (cuEditAudit.actions[action] || 0) + 1; }, true);
        const context = SillyTavern.getContext(); for (const name of ['MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED']) if (context.eventTypes[name]) context.eventSource.on(context.eventTypes[name], () => cuEditAudit.events[name] = (cuEditAudit.events[name] || 0) + 1);
    });
    return { browser, context, page, requests, errors, targetId, longText, total, limit, source, async close() { await context.close(); await browser.close(); } };
}
export const stats = page => page.evaluate(() => ({ visits: cuEditAudit.visits, calls: cuEditAudit.calls, actions: { ...cuEditAudit.actions }, events: { ...cuEditAudit.events }, selectors: [...cuEditAudit.selectors], ownedSelectors: [...cuEditAudit.ownedSelectors], listeners: cuEditAudit.listeners.filter(entry => entry.target.deref() && entry.callback.deref()).map(entry => ({ type: entry.type, target: entry.target.deref().id || entry.target.deref().className || entry.target.deref().nodeName, connected: entry.target.deref().isConnected })), observers: cuEditAudit.observers.map(entry => ({ ...entry })), domNodes: document.querySelectorAll('#chat *').length, topBars: document.querySelectorAll('.cu-message-edit-controls').length, toolbarElements: [...document.querySelectorAll('.cu-message-edit-controls')].reduce((count, bar) => count + 1 + bar.querySelectorAll('*').length, 0) }));
export const reset = page => page.evaluate(() => { cuEditAudit.visits = 0; cuEditAudit.calls = 0; cuEditAudit.actions = {}; cuEditAudit.events = {}; cuEditAudit.selectors = []; cuEditAudit.ownedSelectors = []; });
