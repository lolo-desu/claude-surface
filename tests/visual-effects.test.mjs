import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const base = new URL('../', import.meta.url);
const root = fs.existsSync(new URL('extension/visual-effects.js', base)) ? new URL('extension/', base) : base;
const source = fs.readFileSync(new URL('visual-effects.js', root), 'utf8');
const { visualEffectsOf, applyVisualEffects } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

function body() {
    const classes = new Set(['foreign-class']);
    const properties = new Map([['--foreign-property', 'preserved']]);
    return {
        classes, properties,
        classList: { toggle: (name, active) => active ? classes.add(name) : classes.delete(name) },
        style: { setProperty: (name, value) => properties.set(name, value), removeProperty: name => properties.delete(name) },
    };
}

test('legacy installs get defaults while explicit zero values survive saving and reloading', () => {
    const fallback = visualEffectsOf();
    assert.equal(fallback.uiTransparency, 12);
    assert.equal(fallback.uiBlur, 8);
    assert.equal(fallback.backgroundDim, 30);
    assert.equal(fallback.backgroundBlur, 0);
    const config = JSON.parse(JSON.stringify({ uiTransparency: 0, uiBlur: 0, backgroundDim: 0, backgroundBlur: 0 }));
    assert.deepEqual(visualEffectsOf(config), config);
});

test('persisted values are clamped and CSS fragments or non-finite values cannot reach the styles', () => {
    assert.deepEqual(visualEffectsOf({ uiTransparency: 900, uiBlur: -9, backgroundDim: '46.6', backgroundBlur: 100 }),
        { uiTransparency: 100, uiBlur: 0, backgroundDim: 47, backgroundBlur: 24 });
    assert.deepEqual(visualEffectsOf({ uiTransparency: null, uiBlur: Infinity, backgroundDim: '0);opacity:0', backgroundBlur: '' }), visualEffectsOf());
});

test('interface and image blur stay independent and only paint parameters are assigned', () => {
    const host = body();
    applyVisualEffects(host, { enabled: true, background: true, uiTransparency: 40, uiBlur: 16, backgroundBlur: 0, backgroundDim: 25 });
    assert.equal(host.properties.get('--cu-ui-opacity'), '60%');
    assert.equal(host.properties.get('--cu-ui-backdrop'), 'blur(16px)');
    assert.equal(host.properties.get('--cu-background-filter'), 'blur(0px) brightness(0.75)');
    assert.equal(host.classes.has('cu-glass-enabled'), true);
    assert.equal(host.classes.has('cu-background-blurred'), false);
    assert.equal([...host.properties.keys()].every(key => key.startsWith('--')), true);
});

test('switching the background off preserves its preferences and removes only the overscan state', () => {
    const host = body();
    const original = { enabled: true, background: true, uiBlur: 0, uiTransparency: 0, backgroundBlur: 24, backgroundDim: 80 };
    applyVisualEffects(host, original);
    assert.equal(host.classes.has('cu-background-blurred'), true);
    assert.equal(host.properties.get('--cu-background-spread'), '72px');
    const off = Object.freeze({ ...original, background: false });
    applyVisualEffects(host, off);
    assert.equal(host.classes.has('cu-background-blurred'), false);
    assert.equal(host.classes.has('cu-glass-enabled'), false);
    assert.equal(off.backgroundBlur, 24);
    applyVisualEffects(host, original);
    assert.equal(host.classes.has('cu-background-blurred'), true);
});

test('disabling Surface removes its effects and preserves foreign styles and saved preferences', () => {
    const host = body();
    const original = { enabled: true, background: true, backgroundBlur: 12 };
    applyVisualEffects(host, original);
    applyVisualEffects(host, Object.freeze({ ...original, enabled: false }));
    assert.deepEqual([...host.classes], ['foreign-class']);
    assert.deepEqual([...host.properties], [['--foreign-property', 'preserved']]);
    assert.equal(original.backgroundBlur, 12);
});

test('switching design and day/night mode leaves all four saved effect choices intact', () => {
    const values = { uiTransparency: 24, uiBlur: 12, backgroundDim: 35, backgroundBlur: 7 };
    const host = body();
    const initial = { enabled: true, background: true, ...values };
    applyVisualEffects(host, initial);
    const previous = [...host.properties];
    for (const design of ['claude', 'material', 'adwaita', 'swiss']) {
        for (const mode of ['light', 'dark', 'system', 'companion']) {
            const config = Object.freeze({ ...initial, design, mode });
            assert.deepEqual(visualEffectsOf(config), values);
            applyVisualEffects(host, config);
            assert.deepEqual([...host.properties], previous);
        }
    }
});
