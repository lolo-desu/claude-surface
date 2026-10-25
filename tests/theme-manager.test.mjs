import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const base = new URL('../', import.meta.url);
const root = fs.existsSync(new URL('extension/designs.js', base)) ? new URL('extension/', base) : base;
const designSource = fs.readFileSync(new URL('designs.js', root), 'utf8').replaceAll('export ', '');
const managerSource = fs.readFileSync(new URL('theme-manager.js', root), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '').replaceAll('import.meta.url', '"http://localhost/ext/theme-manager.js"');

function harness(patch = {}, mounted = true) {
    const config = { enabled: true, mode: 'dark', design: 'claude', themeManaged: true,
        themeBackup: { name: 'Snapshot', originalName: 'Original', customCSS: '/* unsaved CSS */' }, ...patch };
    const names = ['Snapshot','Original','Foreign','Claude Surface Base Dark','Claude Surface Base Light','Claude Surface Material','Claude Surface Adwaita','Claude Surface Swiss'];
    const selector = { options: names.map(value => ({ value })), value: 'Claude Surface Base Dark' };
    const style = { disabled: false };
    const document = { head: {}, body: {}, documentElement: { classList: new Set() },
        getElementById: id => id === 'custom-style' ? style : !mounted ? null : id === 'themes' ? selector : id === 'ui_preset_import_file' ? {} : null };
    const events = new Map(), observers = [], selected = [], cssWrites = [];
    const context = { powerUserSettings: { theme: selector.value }, getRequestHeaders: () => ({}),
        eventTypes: { SETTINGS_UPDATED: 'settings', CHAT_CHANGED: 'chat' }, eventSource: { on: (type, fn) => events.set(type, fn) } };
    let changes = 0;
    const sandbox = { document, URL, console, SillyTavern: { getContext: () => context },
        matchMedia: () => ({ matches: true }), powerUser: { getThemeObject: name => ({ name, custom_css: 'saved' }) },
        MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} },
        jQuery: target => ({ val(value) { if (target === selector) selector.value = value; else cssWrites.push(value); return this; },
            trigger(type) { if (target === selector) { context.powerUserSettings.theme = selector.value; selected.push(selector.value); events.get('native')?.(); } return this; },
            on(type, query, fn) { events.set('native', fn); } }),
    };
    vm.createContext(sandbox);
    vm.runInContext(designSource.replaceAll("document.documentElement.classList.contains", "document.documentElement.classList.has") + '\n' + managerSource + '\nthis.setup = setupManagedTheme; this.resolveMode = appearanceMode;', sandbox);
    const manager = sandbox.setup({ settings: () => config, save() {}, report: e => { throw e; }, appearanceChanged: () => { changes++; } });
    return { config, manager, style, document, selected, cssWrites, events, observers, sandbox, selector,
        changes: () => changes, choose(name) { selector.value = name; context.powerUserSettings.theme = name; events.get('native')(); } };
}

test('three design presets retain their native CSS stylesheet ownership', async () => {
    for (const design of ['material','adwaita','swiss']) {
        const h = harness({ design });
        await h.manager.sync();
        assert.equal(h.style.disabled, false);
        assert.match(h.selected.at(-1), /Material|Adwaita|Swiss/);
        assert.equal(h.config.mode, 'dark');
    }
});
test('foreign native theme wins and later disable never restores a stale snapshot', async () => {
    const h = harness();
    await h.manager.sync();
    assert.equal(h.style.disabled, true);
    h.choose('Foreign');
    assert.equal(h.config.enabled, false);
    assert.equal(h.config.themeManaged, false);
    assert.equal(h.style.disabled, false);
    await h.manager.sync();
    assert.equal(h.selected.at(-1), 'Claude Surface Base Dark');
    assert.equal(h.changes(), 1);
});
test('native selection of a Surface design preserves the selected color mode', async () => {
    const h = harness();
    await h.manager.sync();
    h.choose('Claude Surface Adwaita');
    assert.equal(h.config.design, 'adwaita');
    assert.equal(h.config.mode, 'dark');
    await h.manager.sync();
    assert.equal(h.style.disabled, false);
});
test('explicit disable restores the original snapshot and unsaved CSS exactly once', async () => {
    const h = harness({ enabled: false });
    await h.manager.sync();
    await h.manager.sync();
    assert.deepEqual(h.selected, ['Snapshot']);
    assert.deepEqual(h.cssWrites, ['/* unsaved CSS */']);
    assert.equal(h.style.disabled, false);
});
test('no settings DOM at startup defers cleanly', async () => {
    const h = harness({ themeManaged: false }, false);
    await h.manager.sync();
    assert.equal(h.config.themeManaged, false);
    assert.equal(h.selected.length, 0);
});
test('light, dark and system modes resolve independently of external root classes', () => {
    const h = harness();
    h.document.documentElement.classList.add('dn-day');
    assert.equal(h.sandbox.resolveMode({ mode: 'system' }), 'dark');
    assert.equal(h.sandbox.resolveMode({ mode: 'dark' }), 'dark');
    h.document.documentElement.classList.delete('dn-day');
    h.document.documentElement.classList.add('dn-night');
    assert.equal(h.sandbox.resolveMode({ mode: 'system' }), 'dark');
    assert.equal(h.sandbox.resolveMode({ mode: 'light' }), 'light');
    h.document.documentElement.classList.clear();
    assert.equal(h.sandbox.resolveMode({ mode: 'system' }), 'dark');
});
test('a native choice made during a pending theme fetch is never overwritten', async () => {
    const h = harness({ design: 'material' });
    h.selector.options = h.selector.options.filter(option => option.value !== 'Claude Surface Material');
    let resolveFetch;
    h.sandbox.fetch = () => new Promise(resolve => { resolveFetch = resolve; });
    const pending = h.manager.sync();
    await new Promise(resolve => setImmediate(resolve));
    h.choose('Foreign');
    resolveFetch({ ok: true, json: async () => ({ name: 'Claude Surface Material' }) });
    await pending;
    assert.equal(h.config.enabled, false);
    assert.equal(h.selector.value, 'Foreign');
    assert.equal(h.selected.length, 0);
});
test('generated native designs preserve day/night palettes and exclude active shell', () => {
    for (const title of ['Material','Adwaita','Swiss']) {
        const preset = JSON.parse(fs.readFileSync(new URL('themes/Claude Surface ' + title + '.json', root)));
        assert.match(preset.custom_css, /--dn-support: 1/);
        assert.match(preset.custom_css, /:root\.dn-day/);
        assert.match(preset.custom_css, /:root\.dn-night/);
        assert.match(preset.custom_css, /body:not\(\[data-claude-ui\]\)/);
        assert.equal(preset.reduced_motion, undefined);
        assert.equal(/@import|url\(["']?https?:/i.test(preset.custom_css), false, 'No remote stylesheet or media');
    }
});
