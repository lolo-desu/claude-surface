import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttributeOwner } from '../control-attributes.js';

function element(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        isConnected: true,
        getAttribute: name => values.get(name) ?? null,
        setAttribute: (name, value) => values.set(name, String(value)),
        removeAttribute: name => values.delete(name),
        attributes: () => Object.fromEntries(values),
    };
}

test('disable restores native attributes once and leaves subsequent native edits alone', () => {
    const owner = createAttributeOwner();
    const control = element({ role: 'link', 'aria-label': 'Native personas' });
    owner.apply(control, { role: 'button', tabindex: 0, 'aria-label': 'Surface personas' });
    owner.restore();
    assert.deepEqual(control.attributes(), { role: 'link', 'aria-label': 'Native personas' });
    control.setAttribute('aria-label', 'Native after disable');
    control.setAttribute('tabindex', '7');
    owner.restore();
    assert.deepEqual(control.attributes(), { role: 'link', 'aria-label': 'Native after disable', tabindex: '7' });
});

test('release preserves an external change while restoring attributes Surface still owns', () => {
    const owner = createAttributeOwner();
    const control = element({ role: 'link', 'aria-label': 'Native personas' });
    owner.apply(control, { role: 'button', tabindex: 0, 'aria-label': 'Surface personas' });
    control.setAttribute('aria-label', 'Third-party personas');
    owner.restore();
    assert.deepEqual(control.attributes(), { role: 'link', 'aria-label': 'Third-party personas' });
});

test('an external change followed by active refresh becomes the value restored on disable', () => {
    const owner = createAttributeOwner();
    const control = element({ 'aria-label': 'Native personas', tabindex: '3' });
    owner.apply(control, { 'aria-label': 'Surface personas', tabindex: 0 });
    control.setAttribute('aria-label', 'Localized native personas');
    control.removeAttribute('tabindex');
    owner.apply(control, { 'aria-label': 'Surface personas', tabindex: 0 });
    owner.restore();
    assert.deepEqual(control.attributes(), { 'aria-label': 'Localized native personas' });
});

test('reenabling takes a fresh snapshot of the disabled native controls', () => {
    const owner = createAttributeOwner();
    const control = element({ title: 'First native theme' });
    owner.apply(control, { title: 'Surface preset', 'aria-label': 'Surface preset' });
    owner.restore();
    control.setAttribute('title', 'Second native theme');
    control.setAttribute('aria-label', 'Second native accessible name');
    owner.apply(control, { title: 'Surface preset', 'aria-label': 'Surface preset' });
    owner.restore();
    assert.deepEqual(control.attributes(), { title: 'Second native theme', 'aria-label': 'Second native accessible name' });
});

test('pruning releases removed toolbar controls without releasing connected controls', () => {
    const owner = createAttributeOwner();
    const removed = element({ role: 'link', 'aria-label': 'Native removed' });
    const connected = element({ role: 'link' });
    owner.apply(removed, { role: 'button', 'aria-label': 'Surface removed' });
    owner.apply(connected, { role: 'button' });
    removed.setAttribute('aria-label', 'Third-party removed');
    removed.isConnected = false;
    owner.prune();
    assert.deepEqual(removed.attributes(), { role: 'link', 'aria-label': 'Third-party removed' });
    assert.deepEqual(connected.attributes(), { role: 'button' });
    removed.setAttribute('role', 'menuitem');
    owner.restore();
    assert.deepEqual(removed.attributes(), { role: 'menuitem', 'aria-label': 'Third-party removed' });
    assert.deepEqual(connected.attributes(), { role: 'link' });
});

test('a pruned control can be reinserted and owned again with a fresh native snapshot', () => {
    const owner = createAttributeOwner();
    const control = element({ tabindex: '5' });
    owner.apply(control, { tabindex: 0 });
    control.isConnected = false;
    owner.prune();
    control.setAttribute('tabindex', '9');
    control.isConnected = true;
    owner.apply(control, { tabindex: 0 });
    owner.restore();
    assert.equal(control.getAttribute('tabindex'), '9');
});
