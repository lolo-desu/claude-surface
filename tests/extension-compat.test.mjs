import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const base = new URL('../', import.meta.url);
const root = fs.existsSync(new URL('extension/extension-compat.js', base)) ? new URL('extension/', base) : base;
const source = fs.readFileSync(new URL('extension-compat.js', root), 'utf8').replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '');
const designSource = fs.readFileSync(new URL('designs.js', root), 'utf8').replaceAll('export ', '');
function classList() {
    const values = new Set();
    return { contains: key => values.has(key), toggle(key, value) { value ? values.add(key) : values.delete(key); }, add: key => values.add(key), remove: key => values.delete(key) };
}
function harness({ names = ['third-party/theme-companion'], disabled = [], mode = 'dark', marker = true } = {}) {
    const config = { enabled: true, mode };
    const classes = classList(), bodyClasses = classList();
    const controls = [{}];
    const listeners = new Map(), observers = [], events = new Map();
    const document = { body: { classList: bodyClasses }, documentElement: { classList: classes },
        querySelector: () => marker ? {} : null, querySelectorAll: () => controls,
        addEventListener: (type, fn) => listeners.set(type, fn) };
    const context = { extensionSettings: { disabledExtensions: disabled }, eventTypes: { APP_READY: 'ready', SETTINGS_UPDATED: 'settings' },
        eventSource: { on: (event, fn) => events.set(event, fn) } };
    let renders = 0, saves = 0;
    const sandbox = { document, extensionNames: names, SillyTavern: { getContext: () => context }, queueMicrotask,
        matchMedia: () => ({ matches: true }), MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} } };
    vm.createContext(sandbox);
    vm.runInContext(source + '\n' + designSource + '\nthis.setup = setupExtensionCompatibility; this.resolve = appearanceMode; this.forTheme = designForTheme;', sandbox);
    const api = sandbox.setup({ settings: () => config, save: () => saves++, appearanceChanged: () => renders++ });
    api.refresh();
    return { api, config, controls, classes, bodyClasses, observers, listeners, context,
        renders: () => renders, saves: () => saves, resolve: () => sandbox.resolve(config), forTheme: sandbox.forTheme };
}

test('disabled Companion does not activate from a leftover settings DOM', () => {
    const h = harness({ disabled: ['third-party/theme-companion'], mode: 'companion' });
    assert.equal(h.api.companionAvailable, false);
    assert.equal(h.controls[0].disabled, true);
    h.classes.add('dn-day');
    assert.equal(h.resolve(), 'dark');
});

test('Companion controls adopt its state without changing its preferences', async () => {
    const h = harness();
    const original = JSON.stringify(h.context.extensionSettings);
    h.classes.add('dn-day');
    h.listeners.get('click')({ target: { closest: () => ({}) } });
    await Promise.resolve();
    assert.equal(h.config.mode, 'companion');
    assert.equal(h.resolve(), 'light');
    assert.equal(h.saves(), 1);
    assert.equal(JSON.stringify(h.context.extensionSettings), original);
});

test('day/night changes update only followed mode and coalesce duplicate mutations', async () => {
    const h = harness({ mode: 'companion' });
    await Promise.resolve();
    const initial = h.renders();
    h.classes.add('dn-night'); h.observers[0](); h.observers[0]();
    await Promise.resolve();
    assert.equal(h.renders(), initial + 1);
    assert.equal(h.resolve(), 'dark');
    h.classes.remove('dn-night'); h.classes.add('dn-day'); h.observers[0]();
    await Promise.resolve();
    assert.equal(h.resolve(), 'light');
    h.config.mode = 'dark';
    h.classes.remove('dn-day'); h.classes.add('dn-night'); h.observers[0]();
    await Promise.resolve();
    assert.equal(h.resolve(), 'dark');
    assert.equal(h.renders(), initial + 2);
});

test('unrelated streaming message mutations do not request appearance updates', async () => {
    const h = harness({ mode: 'companion' });
    await Promise.resolve();
    const initial = h.renders();
    const node = { nodeType: 1, matches: () => false, querySelector: () => null };
    for (let i = 0; i < 30; i++) h.observers[1]([{ addedNodes: [node], removedNodes: [] }]);
    await Promise.resolve();
    assert.equal(h.renders(), initial);
});

test('late Companion detection and disabling refresh only its availability', async () => {
    const names = [];
    const h = harness({ names, marker: false, mode: 'companion' });
    assert.equal(h.api.companionAvailable, false);
    names.push('third-party/SillyTavern-Theme-Companion');
    h.api.refresh();
    await Promise.resolve();
    assert.equal(h.api.companionAvailable, true);
    assert.equal(h.controls[0].hidden, false);
    h.context.extensionSettings.disabledExtensions.push(names[0]);
    h.api.refresh();
    await Promise.resolve();
    assert.equal(h.api.companionAvailable, false);
    assert.equal(h.config.mode, 'companion');
    assert.equal(h.controls[0].disabled, true);
});

test('both old Swiss preset and new FlatDesign preset resolve to the same saved family', () => {
    const h = harness();
    assert.equal(h.forTheme('Claude Surface Swiss').id, 'swiss');
    assert.equal(h.forTheme('SillyTavern FlatDesign').id, 'swiss');
    assert.equal(h.forTheme('SillyTavern FlatDesign').label, 'FlatDesign');
    assert.equal(h.forTheme('Foreign'), undefined);
});
