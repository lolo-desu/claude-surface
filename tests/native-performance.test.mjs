import test from 'node:test';
import assert from 'node:assert/strict';
import { setupNativePerformance } from '../native-performance.js';

function harness(value = 100, config = { enabled: true, nativePerformance: false }) {
    const native = { chat_truncation: value }, listeners = new Map();
    const controls = Object.fromEntries(['chat_truncation', 'chat_truncation_counter'].map(id => [id, { value: String(value) }]));
    let saves = 0;
    const document = { getElementById: id => controls[id], addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
    const manager = setupNativePerformance({ settings: () => config, powerUser: () => native, save: () => saves++, document });
    return { config, native, controls, manager, listeners, get saves() { return saves; } };
}

test('default off leaves native preference and saved settings untouched', () => {
    const h = harness(); h.manager.refresh(); h.manager.refresh();
    assert.equal(h.native.chat_truncation, 100); assert.equal(h.saves, 0);
});
test('cap preserves full/native preference across serialization, reload and off', () => {
    for (const original of [0, 100, 1000]) {
        const h = harness(original); h.config.nativePerformance = true; h.manager.refresh();
        assert.equal(h.native.chat_truncation, 50);
        assert.deepEqual(h.config.nativePerformanceRestore, { original, applied: 50 });
        assert.equal(h.controls.chat_truncation_counter.value, '50');
        h.manager.refresh(); assert.equal(h.saves, 1);
        const reloaded = harness(50, JSON.parse(JSON.stringify(h.config))); reloaded.manager.refresh();
        assert.equal(reloaded.saves, 0);
        reloaded.config.nativePerformance = false; reloaded.manager.refresh();
        assert.equal(reloaded.native.chat_truncation, original);
        assert.equal(reloaded.config.nativePerformanceRestore, undefined);
        assert.equal(reloaded.saves, 1);
    }
});
test('a smaller native window is respected and unsupported values are not guessed', () => {
    for (const value of [1, 20, 50, -1, null, '100', undefined, Infinity, NaN]) {
        const h = harness(value); h.native.chat_truncation = value; h.config.nativePerformance = true; h.manager.refresh();
        assert.ok(Object.is(h.native.chat_truncation, value)); assert.equal(h.saves, 0);
    }
});
test('external edits become the new preference; off never overwrites unowned changes', () => {
    const h = harness(); h.config.nativePerformance = true; h.manager.refresh();
    h.native.chat_truncation = 200; h.manager.refresh();
    assert.equal(h.config.nativePerformanceRestore.original, 200);
    h.native.chat_truncation = 20; h.manager.refresh();
    assert.equal(h.config.nativePerformanceRestore, undefined);
    h.config.nativePerformance = false; h.manager.refresh(); assert.equal(h.native.chat_truncation, 20);
    h.native.chat_truncation = 100; h.config.nativePerformance = true; h.manager.refresh();
    h.native.chat_truncation = 75; h.manager.restore(); assert.equal(h.native.chat_truncation, 75);
});
test('explicit native input at the cap replaces an older preference', () => {
    const h = harness(); h.config.nativePerformance = true; h.manager.refresh();
    h.listeners.get('input')({ target: { id: 'chat_truncation' } });
    assert.equal(h.config.nativePerformanceRestore, undefined);
    h.manager.restore(); assert.equal(h.native.chat_truncation, 50);
});
test('extension disable and lifecycle hooks restore without touching loaded messages', () => {
    const h = harness(); h.config.nativePerformance = true; h.manager.refresh();
    h.config.enabled = false; h.manager.refresh(); assert.equal(h.native.chat_truncation, 100);
    h.config.enabled = true; h.manager.refresh(); h.manager.restore();
    assert.equal(h.config.nativePerformance, false); assert.equal(h.native.chat_truncation, 100);
    h.manager.destroy(); assert.equal(h.listeners.size, 0);
});
test('malformed backup cannot restore an unsupported value', () => {
    const h = harness(50, { enabled: true, nativePerformance: false, nativePerformanceRestore: { original: 'bad', applied: 50 } });
    h.manager.refresh(); assert.equal(h.native.chat_truncation, 50);
    assert.equal(h.config.nativePerformanceRestore, undefined);
});
