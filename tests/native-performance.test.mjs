import test from 'node:test';
import assert from 'node:assert/strict';
import { setupNativePerformance } from '../native-performance.js';

function harness(value = 100, config = { enabled: true, nativePerformance: false }, fps = 30, streamingSupported = true) {
    const native = { chat_truncation: value, streaming_fps: fps }, listeners = new Map();
    const controls = Object.fromEntries(Object.entries(native).flatMap(([key, value]) => [key, `${key}_counter`].map(id => [id, { value: String(value) }])));
    let saves = 0;
    const document = { getElementById: id => controls[id], addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
    const manager = setupNativePerformance({ settings: () => config, powerUser: () => native, save: () => saves++, streamingSupported: () => streamingSupported, document });
    const input = (key, value) => { native[key] = value; listeners.get('input')({ target: { id: key } }); };
    return { config, native, controls, manager, listeners, input, get saves() { return saves; } };
}

test('default off leaves both native preferences and saved settings untouched', () => {
    const h = harness(); h.manager.refresh(); h.manager.refresh();
    assert.deepEqual(h.native, { chat_truncation: 100, streaming_fps: 30 }); assert.equal(h.saves, 0);
    assert.equal(h.config.nativePerformanceRestore, undefined); assert.equal(h.config.nativeStreamingRestore, undefined);
});
test('both caps preserve native preferences across serialization, reload and off with one save', () => {
    for (const original of [0, 50, 100, 1000]) for (const fps of [0, 15, 30, 100]) {
        const h = harness(original, { enabled: true, nativePerformance: true }, fps); h.manager.refresh();
        assert.deepEqual(h.native, { chat_truncation: 25, streaming_fps: 10 });
        assert.deepEqual(h.config.nativePerformanceRestore, { original, applied: 25 });
        assert.deepEqual(h.config.nativeStreamingRestore, { original: fps, applied: 10 });
        assert.equal(h.controls.chat_truncation_counter.value, '25'); assert.equal(h.controls.streaming_fps_counter.value, '10');
        h.manager.refresh(); assert.equal(h.saves, 1);
        const reloaded = harness(25, JSON.parse(JSON.stringify(h.config)), 10); reloaded.manager.refresh();
        assert.equal(reloaded.saves, 0);
        reloaded.config.nativePerformance = false; reloaded.manager.refresh();
        assert.deepEqual(reloaded.native, { chat_truncation: original, streaming_fps: fps });
        assert.equal(reloaded.config.nativePerformanceRestore, undefined); assert.equal(reloaded.config.nativeStreamingRestore, undefined);
        assert.equal(reloaded.saves, 1);
    }
});
test('smaller windows and unsupported window values remain untouched', () => {
    for (const value of [1, 20, 25, -1, null, '100', undefined, Infinity, NaN]) {
        const h = harness(value, { enabled: true, nativePerformance: true }, 5); h.native.chat_truncation = value; h.manager.refresh();
        assert.ok(Object.is(h.native.chat_truncation, value)); assert.equal(h.saves, 0);
        assert.equal(h.config.nativePerformanceRestore, undefined);
    }
});
test('smaller streaming rates and unsupported rates remain untouched', () => {
    for (const value of [1, 5, 10, -1, null, '30', undefined, Infinity, NaN]) {
        const h = harness(20, { enabled: true, nativePerformance: true }, value); h.native.streaming_fps = value; h.manager.refresh();
        assert.ok(Object.is(h.native.streaming_fps, value)); assert.equal(h.saves, 0);
        assert.equal(h.config.nativeStreamingRestore, undefined);
    }
});
test('owned legacy 50-message settings upgrade directly while retaining the original preference', () => {
    for (const original of [0, 100, 1000]) {
        const h = harness(50, { enabled: true, nativePerformance: true, nativePerformanceRestore: { original, applied: 50 } });
        h.manager.refresh(); assert.equal(h.native.chat_truncation, 25);
        assert.deepEqual(h.config.nativePerformanceRestore, { original, applied: 25 });
        assert.deepEqual(h.config.nativeStreamingRestore, { original: 30, applied: 10 });
        assert.equal(h.saves, 1); h.manager.refresh(); assert.equal(h.saves, 1);
        h.manager.restore(); assert.equal(h.native.chat_truncation, original); assert.equal(h.native.streaming_fps, 30);
    }
});
test('an inactive legacy record restores immediately and an unowned native 50 remains the original', () => {
    const legacy = harness(50, { enabled: true, nativePerformance: false, nativePerformanceRestore: { original: 1000, applied: 50 } });
    legacy.manager.refresh(); assert.equal(legacy.native.chat_truncation, 1000); assert.equal(legacy.native.streaming_fps, 30);
    assert.equal(legacy.config.nativePerformanceRestore, undefined);
    const unowned = harness(50, { enabled: true, nativePerformance: true }); unowned.manager.refresh();
    assert.deepEqual(unowned.config.nativePerformanceRestore, { original: 50, applied: 25 });
    unowned.manager.restore(); assert.equal(unowned.native.chat_truncation, 50);
});
test('external edits adopt the latest preferences independently', () => {
    const h = harness(); h.config.nativePerformance = true; h.manager.refresh();
    h.native.chat_truncation = 200; h.manager.refresh();
    assert.deepEqual(h.config.nativePerformanceRestore, { original: 200, applied: 25 });
    assert.deepEqual(h.config.nativeStreamingRestore, { original: 30, applied: 10 });
    h.native.streaming_fps = 60; h.manager.refresh();
    assert.deepEqual(h.config.nativeStreamingRestore, { original: 60, applied: 10 });
    h.native.chat_truncation = 20; h.manager.refresh();
    assert.equal(h.config.nativePerformanceRestore, undefined);
    h.config.nativePerformance = false; h.manager.refresh();
    assert.deepEqual(h.native, { chat_truncation: 20, streaming_fps: 60 });
});
test('release never overwrites a newer unowned native value in either preference', () => {
    const h = harness(); h.config.nativePerformance = true; h.manager.refresh();
    h.native.chat_truncation = 75; h.native.streaming_fps = 20;
    h.manager.restore(); assert.deepEqual(h.native, { chat_truncation: 75, streaming_fps: 20 });
    assert.equal(h.config.nativePerformanceRestore, undefined); assert.equal(h.config.nativeStreamingRestore, undefined);
});
test('explicit native input at a cap replaces only that preferences older value', () => {
    const h = harness(); h.config.nativePerformance = true; h.manager.refresh();
    h.input('chat_truncation', 25);
    assert.equal(h.config.nativePerformanceRestore, undefined);
    assert.deepEqual(h.config.nativeStreamingRestore, { original: 30, applied: 10 });
    h.manager.restore(); assert.deepEqual(h.native, { chat_truncation: 25, streaming_fps: 30 });
    h.config.nativePerformance = true; h.manager.refresh(); h.input('streaming_fps', 10);
    assert.equal(h.config.nativeStreamingRestore, undefined);
    h.manager.restore(); assert.deepEqual(h.native, { chat_truncation: 25, streaming_fps: 10 });
});
test('committed native input reclamps high values and preserves lower values independently', () => {
    const h = harness(); h.config.nativePerformance = true; h.manager.refresh();
    h.input('streaming_fps', 100); h.input('chat_truncation', 500);
    assert.deepEqual(h.native, { chat_truncation: 25, streaming_fps: 10 });
    assert.deepEqual(h.config.nativePerformanceRestore, { original: 500, applied: 25 });
    assert.deepEqual(h.config.nativeStreamingRestore, { original: 100, applied: 10 });
    h.input('streaming_fps', 5);
    assert.equal(h.config.nativeStreamingRestore, undefined);
    assert.deepEqual(h.config.nativePerformanceRestore, { original: 500, applied: 25 });
    h.manager.restore(); assert.deepEqual(h.native, { chat_truncation: 500, streaming_fps: 5 });
});
test('extension disable and lifecycle restoration release both owned preferences', () => {
    const h = harness(); h.config.nativePerformance = true; h.manager.refresh();
    h.config.enabled = false; h.manager.refresh();
    assert.deepEqual(h.native, { chat_truncation: 100, streaming_fps: 30 });
    h.config.enabled = true; h.manager.refresh(); h.manager.restore();
    assert.equal(h.config.nativePerformance, false); assert.deepEqual(h.native, { chat_truncation: 100, streaming_fps: 30 });
    h.manager.destroy(); assert.equal(h.listeners.size, 0);
});
test('malformed records cannot restore unsupported values or values outside recognized ownership', () => {
    for (const record of [{ original: 'bad', applied: 25 }, { original: 10, applied: 25 }, { original: 1000, applied: 30 }, { original: Infinity, applied: 25 }]) {
        const h = harness(25, { enabled: true, nativePerformance: false, nativePerformanceRestore: record }, 10);
        h.config.nativeStreamingRestore = { original: 'bad', applied: 10 }; h.manager.refresh();
        assert.deepEqual(h.native, { chat_truncation: 25, streaming_fps: 10 });
        assert.equal(h.config.nativePerformanceRestore, undefined); assert.equal(h.config.nativeStreamingRestore, undefined);
    }
});
test('an absent native preference does not prevent managing the supported preference', () => {
    const h = harness(); delete h.native.streaming_fps; h.config.nativePerformance = true; h.manager.refresh();
    assert.equal(h.native.chat_truncation, 25); assert.equal(h.native.streaming_fps, undefined);
    assert.equal(h.config.nativeStreamingRestore, undefined); h.manager.restore(); assert.equal(h.native.chat_truncation, 100);
});
test('unsupported streaming guards leave FPS native or restore its owned value while retaining the chat cap', () => {
    const fresh = harness(100, { enabled: true, nativePerformance: true }, 30, false); fresh.manager.refresh();
    assert.deepEqual(fresh.native, { chat_truncation: 25, streaming_fps: 30 });
    assert.equal(fresh.config.nativeStreamingRestore, undefined);
    const persisted = harness(25, { enabled: true, nativePerformance: true, nativePerformanceRestore: { original: 100, applied: 25 }, nativeStreamingRestore: { original: 30, applied: 10 } }, 10, false);
    persisted.manager.refresh(); assert.deepEqual(persisted.native, { chat_truncation: 25, streaming_fps: 30 });
    assert.deepEqual(persisted.config.nativePerformanceRestore, { original: 100, applied: 25 });
    assert.equal(persisted.config.nativeStreamingRestore, undefined);
    persisted.manager.restore(); assert.equal(persisted.native.chat_truncation, 100);
});
