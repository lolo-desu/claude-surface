import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const base = new URL('../', import.meta.url);
const root = fs.existsSync(new URL('extension/custom-palettes.js', base)) ? new URL('extension/', base) : base;
const {
    colorFields, customPaletteSchema, maxCustomPaletteBytes, maxCustomPalettes,
    normalizeColor, normalizeCustomPalette, parseCustomPalette, serializeCustomPalette,
    customPaletteOptions, applyCustomPalette,
} = await import(new URL('custom-palettes.js', root));
const { paletteOptions, selectedPalette } = await import(new URL('palettes.js', root));

const id = 'custom-3fa85f64-5717-4562-b3fc-2c963f66afa6';
const tokens = color => Object.fromEntries(colorFields.map(({ key }) => [key, color]));
const palette = (overrides = {}) => ({ schema: customPaletteSchema, version: 1, id,
    label: '自己的配色', design: 'claude', swatch: '#ABC', light: tokens('#FfeEdd'), dark: tokens('#1234'), ...overrides });
const error = code => value => value?.code === code;

test('the editable fields cover all color tokens and normalize every hex notation', () => {
    assert.equal(colorFields.length, 24);
    assert.equal(new Set(colorFields.map(field => field.key)).size, 24);
    for (const key of ['bg', 'input-border', 'overlay', 'quote', 'italic', 'underline', 'syntax-comment']) {
        assert.ok(colorFields.some(field => field.key === key));
    }
    for (const field of colorFields) assert.ok(field.label && field.group && Object.isFrozen(field));
    assert.ok(Object.isFrozen(colorFields));
    for (const [input, output] of [['#AbC', '#aabbcc'], ['#aBcD', '#aabbccdd'], ['#ABCDEF', '#abcdef'], ['#ABCDEF99', '#abcdef99']]) {
        assert.equal(normalizeColor(input), output);
    }
    for (const input of ['red', 'transparent', '#ab', '#abcde', '#123456789', ' #fff', '#fff ', 'rgb(1,2,3)', 'var(--color)', 'url(https://example.com)', '#fff; color:red', 123, null, {}]) {
        assert.throws(() => normalizeColor(input), error('invalid-color'));
    }
});

test('normalization returns complete independent light and dark data', () => {
    const input = palette({ id: id.toUpperCase(), label: '  配色 🎨  ' });
    const normalized = normalizeCustomPalette(input);
    assert.equal(normalized.id, id);
    assert.equal(normalized.label, '配色 🎨');
    assert.equal(normalized.swatch, '#aabbcc');
    assert.equal(normalized.light.bg, '#ffeedd');
    assert.equal(normalized.dark.bg, '#11223344');
    assert.notEqual(normalized.light, input.light);
    assert.notEqual(normalized.light, normalized.dark);
    normalized.light.bg = '#000000';
    assert.equal(input.light.bg, '#FfeEdd');
    assert.equal(normalizeCustomPalette(palette({ label: '🎨'.repeat(60) })).label.length, 120);
});

test('schema, identifiers, design, names and both complete color maps are required', () => {
    for (const input of [null, [], 'palette', new Date()]) assert.throws(() => normalizeCustomPalette(input));
    for (const changes of [
        { schema: 'other' }, { version: 2 }, { version: '1' }, { id: 'clay' },
        { id: 'custom-<style>' }, { design: 'constructor' }, { design: 'other' },
        { label: '' }, { label: ' ' }, { label: 'a'.repeat(61) }, { label: 'line\nbreak' },
        { swatch: 'expression(alert(1))' }, { light: [] }, { dark: null },
    ]) assert.throws(() => normalizeCustomPalette(palette(changes)));
    for (const key of Object.keys(palette())) {
        const input = palette(); delete input[key];
        assert.throws(() => normalizeCustomPalette(input), error('missing-field'));
    }
    const incomplete = palette(); delete incomplete.dark.quote;
    assert.throws(() => normalizeCustomPalette(incomplete), error('missing-color'));
    assert.throws(() => normalizeCustomPalette(palette({ light: { ...tokens('#fff'), selector: 'body' } })));
});

test('CSS payloads, prototype keys, accessors and non-data objects cannot enter saved colors', () => {
    assert.throws(() => normalizeCustomPalette({ ...palette(), css: 'body {display:none}' }));
    const pollution = JSON.parse(JSON.stringify(palette()).replace('"version":1', '"version":1,"__proto__":{"polluted":true}'));
    assert.throws(() => normalizeCustomPalette(pollution));
    assert.equal({}.polluted, undefined);
    const inherited = Object.create(palette());
    assert.throws(() => normalizeCustomPalette(inherited));
    let invoked = false;
    const accessor = palette(); Object.defineProperty(accessor, 'label', { enumerable: true, get() { invoked = true; return 'getter'; } });
    assert.throws(() => normalizeCustomPalette(accessor));
    assert.equal(invoked, false);
    const symbol = palette(); symbol[Symbol('hidden')] = 'value';
    assert.throws(() => normalizeCustomPalette(symbol));
    const hidden = palette(); Object.defineProperty(hidden, 'hidden', { value: 'value' });
    assert.throws(() => normalizeCustomPalette(hidden));
    const nullPrototype = Object.assign(Object.create(null), palette());
    assert.equal(normalizeCustomPalette(nullPrototype).id, id);
});

test('JSON takes precedence and YAML is injected with strict alias limits', () => {
    let calls = 0;
    const validJSON = JSON.stringify(palette());
    assert.equal(parseCustomPalette('\uFEFF' + validJSON, { parseYAML() { calls++; throw Error('must not be called'); } }).id, id);
    assert.equal(calls, 0);
    assert.throws(() => parseCustomPalette('{broken'), error('invalid-file'));
    assert.throws(() => parseCustomPalette(JSON.stringify({ version: 99 }), { parseYAML() { calls++; return palette(); } }));
    assert.equal(calls, 0, 'semantically invalid JSON cannot fall back to YAML');
    const parsed = parseCustomPalette('schema: claude-surface-palette', { parseYAML(text, options) {
        calls++; assert.match(text, /^schema:/);
        assert.deepEqual(options, { maxAliasCount: 0, uniqueKeys: true, strict: true, schema: 'core' });
        return palette();
    } });
    assert.equal(parsed.id, id); assert.equal(calls, 1);
    assert.throws(() => parseCustomPalette('a: *alias', { parseYAML() { throw Error('alias expansion'); } }), error('invalid-file'));
    assert.throws(() => parseCustomPalette('a: b', { parseYAML() { return []; } }));
});

test('imports reject empty, oversized and non-string input before calling a parser', () => {
    for (const input of ['', '  ', null, 12]) assert.throws(() => parseCustomPalette(input), error('empty-file'));
    for (const input of ['a'.repeat(maxCustomPaletteBytes + 1), '界'.repeat(Math.ceil(maxCustomPaletteBytes / 3))]) {
        assert.throws(() => parseCustomPalette(input, { parseYAML() { assert.fail('parser must not run'); } }), error('file-too-large'));
    }
});

test('JSON and YAML exports serialize normalized data and handle formatter errors', () => {
    const text = serializeCustomPalette(palette());
    assert.equal(text.endsWith('\n'), true);
    assert.deepEqual(parseCustomPalette(text), normalizeCustomPalette(palette()));
    const yaml = serializeCustomPalette(palette(), 'yaml', { stringifyYAML(value, options) {
        assert.equal(value.light.bg, '#ffeedd');
        assert.deepEqual(options, { aliasDuplicateObjects: false, lineWidth: 0 });
        return 'schema: claude-surface-palette\n';
    } });
    assert.match(yaml, /^schema:/);
    assert.equal(serializeCustomPalette(palette(), 'yml', { stringifyYAML: () => 'value' }), 'value');
    assert.throws(() => serializeCustomPalette(palette(), 'css'), error('invalid-format'));
    assert.throws(() => serializeCustomPalette(palette(), 'yaml'), error('missing-yaml'));
    assert.throws(() => serializeCustomPalette(palette(), 'yaml', { stringifyYAML() { throw Error(); } }), error('invalid-file'));
    assert.throws(() => serializeCustomPalette(palette(), 'yaml', { stringifyYAML: () => '' }), error('empty-file'));
    assert.throws(() => serializeCustomPalette(palette(), 'yaml', { stringifyYAML: () => 'a'.repeat(maxCustomPaletteBytes + 1) }), error('file-too-large'));
    assert.throws(() => serializeCustomPalette({ ...palette(), css: 'injected' }));
});

test('only valid unique custom choices for the current design appear and remain selected', () => {
    const material = palette({ id: id.replace('3fa85f64', '4fa85f64'), design: 'material' });
    const config = { enabled: true, design: 'claude', customPalettes: [null, { ...palette(), css: 'bad' }, palette(), palette(), material], designPalettes: { claude: id, material: material.id } };
    assert.equal(customPaletteOptions(config).length, 1);
    assert.equal(customPaletteOptions(config, 'material').length, 1);
    assert.deepEqual(customPaletteOptions(null, 'claude'), []);
    assert.deepEqual(customPaletteOptions({ customPalettes: {} }, 'claude'), []);
    assert.deepEqual(customPaletteOptions(config, 'constructor'), []);
    assert.equal(paletteOptions('claude', config).length, paletteOptions('claude').length + 1);
    assert.equal(selectedPalette(config).id, id);
    config.design = 'material'; assert.equal(selectedPalette(config).id, material.id);
    config.customPalettes = []; assert.equal(selectedPalette(config).id, 'azure');
    const many = Array.from({ length: maxCustomPalettes + 5 }, (_, i) => palette({ id: `custom-${i.toString(16).padStart(8, '0')}-5717-4562-b3fc-2c963f66afa6` }));
    assert.equal(customPaletteOptions({ customPalettes: many }, 'claude').length, maxCustomPalettes);
});

class Style {
    values = new Map(); writes = 0;
    setProperty(key, value, priority = '') { this.values.set(key, { value, priority }); this.writes++; }
    getPropertyValue(key) { return this.values.get(key)?.value || ''; }
    getPropertyPriority(key) { return this.values.get(key)?.priority || ''; }
    removeProperty(key) { this.values.delete(key); this.writes++; }
}
const selectedConfig = () => ({ enabled: true, design: 'claude', customPalettes: [palette()], designPalettes: { claude: id } });

test('application writes only owned color tokens, avoids redundant writes and restores previous inline values', () => {
    const body = { style: new Style() }, config = selectedConfig();
    body.style.setProperty('--cu-bg', '#old', 'important');
    body.style.setProperty('--third-party', 'untouched');
    body.style.setProperty('--SmartThemeBodyColor', 'native');
    const before = body.style.writes;
    assert.equal(applyCustomPalette(body, config, 'dark').id, id);
    assert.equal(body.style.writes - before, colorFields.length);
    assert.equal(body.style.getPropertyValue('--cu-bg'), '#11223344');
    assert.equal(body.style.getPropertyPriority('--cu-bg'), '');
    applyCustomPalette(body, config, 'dark'); assert.equal(body.style.writes - before, colorFields.length);
    applyCustomPalette(body, config, 'light'); assert.equal(body.style.getPropertyValue('--cu-bg'), '#ffeedd');
    config.enabled = false;
    assert.equal(applyCustomPalette(body, config, 'light'), null);
    assert.equal(body.style.getPropertyValue('--cu-bg'), '#old');
    assert.equal(body.style.getPropertyPriority('--cu-bg'), 'important');
    assert.equal(body.style.getPropertyValue('--cu-text'), '');
    assert.equal(body.style.getPropertyValue('--third-party'), 'untouched');
    assert.equal(body.style.getPropertyValue('--SmartThemeBodyColor'), 'native');
    const restored = body.style.writes; applyCustomPalette(body, config, 'dark'); assert.equal(body.style.writes, restored);
});

test('external changes during custom mode survive deselection and repeated application', () => {
    const body = { style: new Style() }, config = selectedConfig();
    applyCustomPalette(body, config, 'dark');
    body.style.setProperty('--cu-text', '#external', 'important');
    config.designPalettes.claude = 'clay'; applyCustomPalette(body, config, 'dark');
    assert.equal(body.style.getPropertyValue('--cu-text'), '#external');
    assert.equal(body.style.getPropertyPriority('--cu-text'), 'important');
    config.designPalettes.claude = id; applyCustomPalette(body, config, 'dark');
    body.style.setProperty('--cu-bg', '#new-external');
    applyCustomPalette(body, config, 'light');
    config.customPalettes = []; applyCustomPalette(body, config, 'light');
    assert.equal(body.style.getPropertyValue('--cu-bg'), '#new-external');
    assert.equal(body.style.getPropertyValue('--cu-text'), '#external');
});

test('invalid modes, deleted selections and malformed settings release owned inline colors', () => {
    for (const changes of [{ design: 'material' }, { customPalettes: [] }, { designPalettes: [] }, { enabled: false }]) {
        const body = { style: new Style() }, config = selectedConfig();
        applyCustomPalette(body, config, 'dark');
        applyCustomPalette(body, { ...config, ...changes }, 'dark');
        assert.equal(body.style.getPropertyValue('--cu-bg'), '');
    }
    const body = { style: new Style() }, config = selectedConfig();
    applyCustomPalette(body, config, 'dark'); applyCustomPalette(body, config, 'system');
    assert.equal(body.style.getPropertyValue('--cu-bg'), '');
    assert.equal(applyCustomPalette(null, config, 'dark'), null);
    assert.equal(applyCustomPalette(body, null, 'dark'), null);
});
