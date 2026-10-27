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
        themeBackup: { version: 2, originalName: 'Original', snapshot: { name: 'Original', custom_css: '/* unsaved CSS */', font_scale: 1.17, main_text_color: '#abcdef', reduced_motion: true } }, ...patch };
    const names = ['Snapshot','Original','Foreign','Claude Surface Base Dark','Claude Surface Base Light','Claude Surface Material','Claude Surface Adwaita','Claude Surface Swiss','SillyTavern FlatDesign'];
    const selector = { options: names.map(value => ({ value })), value: 'Claude Surface Base Dark' };
    const style = { disabled: false };
    const rootClasses = new Set(); rootClasses.contains = rootClasses.has;
    const bodyClasses = new Set(); bodyClasses.contains = bodyClasses.has;
    const document = { head: {}, body: { classList: bodyClasses }, documentElement: { classList: rootClasses },
        getElementById: id => id === 'custom-style' ? style : !mounted ? null : id === 'themes' ? selector : id === 'ui_preset_import_file' ? {} : null };
    const events = new Map(), observers = [], selected = [], cssWrites = [], controlValues = new Map();
    let refreshes = 0;
    const context = { powerUserSettings: { theme: selector.value, custom_css: 'saved', font_scale: 1, main_text_color: '#ffffff', reduced_motion: false, unrelated: 'keep' }, getRequestHeaders: () => ({}),
        eventTypes: { SETTINGS_UPDATED: 'settings', CHAT_CHANGED: 'chat' }, eventSource: { on: (type, fn) => events.set(type, fn) } };
    let changes = 0;
    const sandbox = { document, URL, console, SillyTavern: { getContext: () => context },
        matchMedia: () => ({ matches: true }), powerUser: {
            getThemeObject: name => Object.fromEntries(['custom_css','font_scale','main_text_color','reduced_motion'].map(key => [key,context.powerUserSettings[key]]).concat([['name',name]])),
            applyPowerUserSettings: () => { refreshes++; },
        },
        MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} },
        jQuery: target => ({ val(value) { if (target === selector) selector.value = value; else { controlValues.set(target,value); if(target==='#customCSS')cssWrites.push(value); } return this; },
            prop(key,value) { controlValues.set(target+':'+key,value); return this; },
            attr(key,value) { controlValues.set(target+':'+key,value); return this; },
            trigger(type) { if (target === selector) { context.powerUserSettings.theme = selector.value; selected.push(selector.value); events.get('native')?.(); } return this; },
            on(type, query, fn) { events.set('native', fn); } }),
    };
    vm.createContext(sandbox);
    vm.runInContext(designSource.replaceAll("document.documentElement.classList.contains", "document.documentElement.classList.has") + '\n' + managerSource + '\nthis.setup = setupManagedTheme; this.resolveMode = appearanceMode;', sandbox);
    const manager = sandbox.setup({ settings: () => config, save() {}, report: e => { throw e; }, appearanceChanged: () => { changes++; } });
    return { config, manager, style, document, selected, cssWrites, events, observers, sandbox, selector, context, controlValues, refreshes: () => refreshes,
        changes: () => changes, choose(name) { selector.value = name; context.powerUserSettings.theme = name; events.get('native')(); } };
}

test('three design presets retain their native CSS stylesheet ownership', async () => {
    for (const design of ['material','adwaita','swiss']) {
        const h = harness({ design });
        await h.manager.sync();
        assert.equal(h.style.disabled, false);
        assert.match(h.selected.at(-1), /Material|Adwaita|FlatDesign/);
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

test('legacy Swiss native selections migrate to FlatDesign without losing appearance preferences', async () => {
    const h = harness({ design: 'swiss', mode: 'light', designPalettes: { swiss: 'cobalt' } });
    await h.manager.sync();
    h.choose('Claude Surface Swiss');
    assert.equal(h.config.enabled, true);
    assert.equal(h.config.design, 'swiss');
    assert.equal(h.config.mode, 'light');
    assert.equal(h.config.designPalettes.swiss, 'cobalt');
    await h.manager.sync();
    assert.equal(h.selector.value, 'SillyTavern FlatDesign');
});
test('explicit disable restores the original snapshot and unsaved CSS exactly once', async () => {
    const h = harness({ enabled: false });
    await h.manager.sync();
    await h.manager.sync();
    assert.deepEqual(h.selected, []);
    assert.equal(h.selector.value, 'Original');
    assert.equal(h.context.powerUserSettings.font_scale, 1.17);
    assert.equal(h.context.powerUserSettings.main_text_color, '#abcdef');
    assert.equal(h.context.powerUserSettings.reduced_motion, true);
    assert.equal(h.refreshes(), 1);
    assert.deepEqual(h.cssWrites, ['/* unsaved CSS */']);
    assert.equal(h.style.disabled, false);
});

test('capture, repeated sync, design switches and re-enable never register backup presets', async () => {
    const h = harness({ themeManaged: false });
    h.context.powerUserSettings.theme = h.selector.value = 'Foreign';
    h.context.powerUserSettings.custom_css = '/* live, unsaved */';
    h.context.powerUserSettings.font_scale = 1.28;
    h.sandbox.fetch = () => { throw new Error('Unexpected theme or settings write'); };
    const originalOptions = JSON.stringify(h.selector.options);
    for(let cycle=0;cycle<3;cycle++) {
        h.config.enabled = true;
        await h.manager.sync();await h.manager.sync();
        h.config.design = 'adwaita';await h.manager.sync();
        assert.equal(h.config.themeBackup.originalName, 'Foreign');
        assert.equal(h.config.themeBackup.snapshot.custom_css, '/* live, unsaved */');
        h.config.enabled = false;await h.manager.sync();
        assert.equal(h.selector.value, 'Foreign');
        assert.equal(h.context.powerUserSettings.font_scale, 1.28);
        assert.equal(h.context.powerUserSettings.custom_css, '/* live, unsaved */');
    }
    assert.equal(JSON.stringify(h.selector.options), originalOptions);
    assert.equal(h.config.themeBackup.name, undefined);
});

test('persisted internal snapshots survive restart and only restore appearance keys', async () => {
    const h = harness({ enabled: false });
    h.config.themeBackup = JSON.parse(JSON.stringify(h.config.themeBackup));
    h.config.themeBackup.snapshot.unrelated = 'overwrite';
    h.selector.options = h.selector.options.filter(x=>x.value!=='Original');
    await h.manager.sync();
    assert.equal(h.context.powerUserSettings.theme, 'Original');
    assert.equal(h.context.powerUserSettings.unrelated, 'keep');
    assert.equal(h.context.powerUserSettings.custom_css, '/* unsaved CSS */');
    assert.equal(h.selector.value, null, 'A deleted preset must not be recreated');
});

test('old file snapshots migrate through a read without selecting or writing backup themes', async () => {
    const h = harness({ enabled: false, themeBackup: {name:'Snapshot',originalName:'Original',customCSS:'/* unsaved CSS */'} });
    const requests=[];
    h.sandbox.fetch=async (url,options)=>{requests.push([url,options.method]);return{ok:true,json:async()=>({themes:[{name:'Snapshot',font_scale:1.4,custom_css:'stored'}]})};};
    await h.manager.sync();await h.manager.sync();
    assert.deepEqual(requests,[['/api/settings/get','POST']]);
    assert.equal(h.config.themeBackup.version,2);
    assert.equal(h.config.themeBackup.name,undefined);
    assert.equal(h.context.powerUserSettings.font_scale,1.4);
    assert.equal(h.context.powerUserSettings.custom_css,'/* unsaved CSS */');
    assert.deepEqual(h.selected,[]);
});

test('failed legacy reads keep recovery data and can be retried', async () => {
    const h = harness({ enabled:false,themeBackup:{name:'Snapshot',originalName:'Original',customCSS:'unsaved'} });
    h.sandbox.fetch=async()=>({ok:false});
    await assert.rejects(h.manager.sync(),/无法读取旧版/);
    assert.equal(h.config.themeManaged,true);
    assert.equal(h.config.themeBackup.name,'Snapshot');
    assert.equal(h.cssWrites.length,0);
});

test('native selection during a legacy snapshot read wins over restoration', async () => {
    const h = harness({enabled:false,themeBackup:{name:'Snapshot',originalName:'Original'}});
    let resolveRead;h.sandbox.fetch=()=>new Promise(resolve=>{resolveRead=resolve;});
    const pending=h.manager.sync();await new Promise(resolve=>setImmediate(resolve));
    // The user first re-enables the shell, then chooses a foreign preset.
    h.config.enabled=true;h.choose('Foreign');
    resolveRead({ok:true,json:async()=>({themes:[{name:'Snapshot',font_scale:1.9}]})});
    await pending;
    assert.equal(h.selector.value,'Foreign');assert.equal(h.refreshes(),0);
    assert.equal(h.config.themeManaged,false);
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
