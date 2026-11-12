import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { colorFields } from '../custom-palettes.js';

// Exercise the real UI handlers without a browser or server writes. Native host
// imports are adapters here; file completion order and DOM attachment are real
// boundaries the UI must handle independently of the rendering engine.
class Element extends EventTarget {
    constructor(tag) {
        super(); this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {};
        this.value = ''; this.dataset = {}; this.classList = { add() {} };
        this.style = { setProperty() {} };
    }
    get isConnected() { return this.attached === true || this.parentElement?.isConnected === true; }
    append(...nodes) { for (const node of nodes) { this.children.push(node); if (node instanceof Element) node.parentElement = this; } }
    prepend(node) { this.children.unshift(node); node.parentElement = this; }
    replaceChildren(...nodes) { for (const node of this.children) if (node instanceof Element) node.parentElement = null; this.children = []; this.append(...nodes); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    setCustomValidity() {}
    reportValidity() { return true; }
    focus() {}
    querySelectorAll(selector) { return descendants(this).filter(node => node.tagName === selector.toUpperCase()); }
    click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}
const descendants = root => root.children.flatMap(node => node instanceof Element ? [node, ...descendants(node)] : []);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const id = 'custom-3fa85f64-5717-4562-b3fc-2c963f66afa6';
const valid = () => ({ schema: 'claude-surface-palette', version: 1, id, label: 'Existing', design: 'claude', swatch: '#fff', light: Object.fromEntries(colorFields.map(f => [f.key, '#ffffff'])), dark: Object.fromEntries(colorFields.map(f => [f.key, '#112233'])) });

async function harness(config = { enabled: true, design: 'claude', customPalettes: [] }) {
    const previous = { document: globalThis.document, crypto: Object.getOwnPropertyDescriptor(globalThis, 'crypto'), uuid: globalThis.__paletteUITestUUIDCalls };
    const body = new Element('body'); body.attached = true; body.dataset.claudeUi = 'dark';
    globalThis.document = { body, getElementById: () => ({}), createElement: tag => new Element(tag) };
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
    globalThis.__paletteUITestUUIDCalls = 0;
    let source = await fs.readFile(new URL('../custom-palette-ui.js', import.meta.url), 'utf8');
    source = source.replace("import { yaml } from '../../../../lib.js';", 'const yaml = {};')
        .replace("import { uuidv4 } from '../../../utils.js';", "const uuidv4 = () => { globalThis.__paletteUITestUUIDCalls++; return '4fa85f64-5717-4562-b3fc-2c963f66afa6'; };")
        .replace("import { designOf } from './designs.js';", 'const designOf = id => ({id});')
        .replace("'./custom-palettes.js'", JSON.stringify(new URL('../custom-palettes.js', import.meta.url).href));
    const { setupCustomPaletteUI } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    let current, saves = 0, applies = 0;
    const api = setupCustomPaletteUI({
        settings: () => config, save() { saves++; }, applyAppearance() { applies++; }, showAppearance() {},
        sheet(title) { current?.remove(); current = new Element('div'); current.title = title; body.append(current); return current; },
        button(label, icon, run) { const node = new Element('button'); node.label = label; node.run = run; node.addEventListener('click', run); return node; },
    });
    const find = predicate => descendants(current).find(predicate);
    const button = label => find(node => node.label === label);
    const openImport = () => { api.open(); button('导入配色').click(); return { file: find(node => node.type === 'file'), text: find(node => node.tagName === 'TEXTAREA'), load: button('导入并编辑'), error: find(node => node.attributes.role === 'alert'), content: current }; };
    const select = (file, read, size = 1) => { file.files = [{ size, text: () => read.promise }]; file.dispatchEvent(new Event('change')); };
    return { api, config, button, openImport, select, get current() { return current; }, get saves() { return saves; }, get applies() { return applies; },
        restore() { globalThis.document = previous.document; if (previous.crypto) Object.defineProperty(globalThis, 'crypto', previous.crypto); else delete globalThis.crypto; if (previous.uuid === undefined) delete globalThis.__paletteUITestUUIDCalls; else globalThis.__paletteUITestUUIDCalls = previous.uuid; } };
}

test('a late previous file cannot replace the last selected import', async () => {
    const h = await harness();
    try {
        const { file, text, load } = h.openImport(), first = deferred(), second = deferred();
        h.select(file, first); h.select(file, second); assert.equal(load.disabled, true);
        second.resolve('second file'); await settle(); assert.equal(text.value, 'second file'); assert.equal(load.disabled, false);
        first.resolve('first file'); await settle(); assert.equal(text.value, 'second file');
    } finally { h.restore(); }
});

test('pending, failed or oversized reads cannot import the previous textarea contents', async () => {
    const h = await harness();
    try {
        const { file, text, load, error, content } = h.openImport(), read = deferred();
        text.value = JSON.stringify(valid()); h.select(file, read);
        load.run(); assert.equal(h.current, content, 'Pending file imported the old text');
        read.reject(new Error('unreadable')); await settle();
        assert.equal(load.disabled, true); assert.equal(error.hidden, false);
        load.run(); assert.equal(h.current, content);
        h.select(file, deferred(), 128 * 1024 + 1); assert.equal(load.disabled, true); load.run(); assert.equal(h.current, content);
    } finally { h.restore(); }
});

test('manual paste takes ownership from a pending read and stale errors stay hidden', async () => {
    const h = await harness();
    try {
        const { file, text, load, error } = h.openImport(), first = deferred(), second = deferred();
        h.select(file, first); text.value = 'manually pasted'; text.dispatchEvent(new Event('input'));
        assert.equal(load.disabled, false); first.resolve('late file'); await settle(); assert.equal(text.value, 'manually pasted');
        h.select(file, first); h.select(file, second); second.resolve('new file'); await settle();
        // A previously settled read is stale too; its completion cannot win.
        assert.equal(text.value, 'new file'); assert.equal(error.hidden, true);
        const failed = deferred(); h.select(file, failed); text.value = 'another paste'; text.dispatchEvent(new Event('input'));
        failed.reject(new Error('stale failure')); await settle(); assert.equal(error.hidden, true); assert.equal(text.value, 'another paste');
    } finally { h.restore(); }
});

test('closing the import page prevents a completed read from updating detached controls', async () => {
    const h = await harness();
    try {
        const { file, text, content } = h.openImport(), read = deferred();
        h.select(file, read); h.button('返回自定义颜色').click(); assert.equal(content.isConnected, false);
        read.resolve('offscreen file'); await settle(); assert.equal(text.value, '');
    } finally { h.restore(); }
});

test('creation uses the host UUID helper without randomUUID and repairs malformed selection state on save', async () => {
    const config = { enabled: true, design: 'claude', customPalettes: [valid()], designPalettes: { claude: id } }, h = await harness(config);
    try {
        assert.equal(crypto.randomUUID, undefined);
        h.api.open(); h.button('新建配色').click(); assert.equal(h.current.title, '编辑配色');
        assert.equal(globalThis.__paletteUITestUUIDCalls, 1);
        config.designPalettes = []; h.button('保存并应用').click();
        assert.equal(h.saves, 1); assert.equal(h.applies, 1); assert.equal(Array.isArray(config.designPalettes), false);
        assert.equal(config.designPalettes.claude, 'custom-4fa85f64-5717-4562-b3fc-2c963f66afa6');
        assert.equal(config.customPalettes.length, 2);
    } finally { h.restore(); }
});

test('invalid full saved arrays remain repairable and import saves the first usable selected entry', async () => {
    const entries = Array(64).fill(null), config = { enabled: true, design: 'claude', customPalettes: entries }, h = await harness(config);
    try {
        const { text, load } = h.openImport();
        assert.equal(config.customPalettes, entries, 'Merely opening the UI rewrote preferences');
        text.value = JSON.stringify(valid()); load.click();
        assert.equal(h.current.title, '编辑配色', 'Invalid rows consumed the entire save limit');
        h.button('保存并应用').click();
        assert.equal(config.customPalettes.length, 1);
        assert.equal(config.customPalettes[0].id, config.designPalettes.claude);
        assert.equal(config.customPalettes[0].label, 'Existing');
        assert.equal(h.saves, 1);
    } finally { h.restore(); }
});

test('repair on an explicit save preserves valid palettes from other design families', async () => {
    const other = { ...valid(), design: 'material', id: id.replace('3fa85f64', '5fa85f64'), label: 'Other family' };
    const entries = [other, ...Array(63).fill(null)], config = { enabled: true, design: 'claude', customPalettes: entries, designPalettes: { material: other.id } }, h = await harness(config);
    try {
        const { text, load } = h.openImport();
        assert.equal(config.customPalettes, entries); assert.deepEqual(config.designPalettes, { material: other.id });
        text.value = JSON.stringify(valid()); load.click(); assert.equal(h.current.title, '编辑配色');
        h.button('保存并应用').click();
        assert.equal(config.customPalettes.length, 2);
        assert.equal(config.customPalettes[0].id, other.id);
        assert.equal(config.customPalettes[0].design, 'material');
        assert.equal(config.designPalettes.material, other.id);
        assert.equal(config.designPalettes.claude, config.customPalettes[1].id);
    } finally { h.restore(); }
});
