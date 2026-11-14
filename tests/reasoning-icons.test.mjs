import test from 'node:test';
import assert from 'node:assert/strict';
import { createReasoningIcons } from '../reasoning-icons.js';

const names = ['copy', 'edit', 'close_all', 'edit_done', 'edit_cancel', 'delete'];
function harness({ total = 1, scheduler = true, cost = 0 } = {}) {
    const tasks = [], visits = [], messages = [];
    let clock = 0, yields = 0, timeouts = 0;
    const view = {
        performance: { now: () => clock },
        setTimeout(callback, delay) { assert.equal(delay, 0); timeouts++; tasks.push(callback); },
        ...(scheduler ? { scheduler: { yield() { yields++; return new Promise(resolve => tasks.push(resolve)); } } } : {}),
    };
    const root = { ownerDocument: { defaultView: view }, querySelectorAll(selector) { assert.equal(selector, ':scope > .mes'); return [...messages]; } };
    const createControl = () => {
        const attributes = new Map(), classes = new Set();
        return {
            childNodes: [],
            classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
            getAttribute: key => attributes.get(key) ?? null,
            setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key),
            insertAdjacentHTML(position, html) {
                assert.equal(position, 'beforeend'); assert.match(html, /^<svg/);
                const parent = this;
                const node = { nodeType: 1, textContent: '', parentNode: parent, remove() { parent.childNodes.splice(parent.childNodes.indexOf(node), 1); node.parentNode = null; } };
                this.childNodes.push(node);
            },
            get lastElementChild() { return this.childNodes.filter(node => node.nodeType === 1).at(-1); },
        };
    };
    for (let index = 0; index < total; index++) {
        const controls = Object.fromEntries(names.map(name => [name, createControl()]));
        messages.push({ parentElement: root, isConnected: true, controls,
            querySelector(selector) {
                assert.equal(selector, '.mes_reasoning_actions'); visits.push(index); clock += cost;
                return { querySelector: selector => controls[selector.replace('.mes_reasoning_', '')] };
            },
        });
    }
    const api = createReasoningIcons({ svg: icon => `<svg data-icon="${icon}"></svg>` });
    const advance = async () => { tasks.shift()?.(); await Promise.resolve(); };
    const drain = async promise => { while (tasks.length) await advance(); return await promise; };
    const masked = message => names.every(name => message.controls[name].getAttribute('data-cu-reasoning-mask'));
    const svgCount = message => names.reduce((count, name) => count + message.controls[name].childNodes.filter(node => node.nodeType === 1).length, 0);
    return { api, root, view, messages, visits, tasks, advance, drain, masked, svgCount, get yields() { return yields; }, get timeouts() { return timeouts; } };
}

test('the callable decorator and its alias retain SVG ownership and lightweight transitions', () => {
    const h = harness(), message = h.messages[0]; assert.equal(h.api.decorate, h.api);
    h.api(message, { enabled: true, lightweight: false }); assert.equal(h.svgCount(message), 6);
    h.api.decorate(message, { enabled: true, lightweight: true }); assert.equal(h.svgCount(message), 0); assert(h.masked(message));
    h.api(message, { enabled: true, lightweight: false }); assert.equal(h.svgCount(message), 6); assert(!h.masked(message));
    h.api(message, { enabled: false, lightweight: false }); assert.equal(h.svgCount(message), 0); assert(!h.masked(message));
});
test('foreign glyphs, text labels and externally changed mask attributes survive cleanup', () => {
    const h = harness(), message = h.messages[0], control = message.controls.copy;
    h.api(message, { enabled: true, lightweight: false });
    const foreign = { nodeType: 1, textContent: 'Custom', parentNode: control }; control.childNodes.push(foreign);
    h.api(message, { enabled: true, lightweight: true });
    assert.deepEqual(control.childNodes, [foreign]); assert.equal(control.getAttribute('data-cu-reasoning-mask'), null);
    const edit = message.controls.edit; edit.setAttribute('data-cu-reasoning-mask', 'foreign-mask');
    h.api(message, { enabled: false, lightweight: false });
    assert.equal(edit.getAttribute('data-cu-reasoning-mask'), 'foreign-mask'); assert.deepEqual(control.childNodes, [foreign]);
});
test('mutation ownership distinguishes our additions/removals from external current SVG removal and mixed nodes', () => {
    const h = harness(), message = h.messages[0], control = message.controls.copy;
    h.api(message, { enabled: true, lightweight: false });
    const node = control.lastElementChild;
    const change = (addedNodes, removedNodes, target = control) => ({ target, addedNodes, removedNodes });
    assert.equal(h.api.isOwnMutation(change([node], [])), true);
    node.remove();
    assert.equal(h.api.isOwnMutation(change([], [node])), false, 'External removal must repair the current icon');
    h.api(message, { enabled: true, lightweight: false });
    const replacement = control.lastElementChild;
    assert.notEqual(replacement, node);
    h.api(message, { enabled: true, lightweight: true });
    assert.equal(h.api.isOwnMutation(change([], [replacement])), true);
    assert.equal(h.api.isOwnMutation(change([{ nodeType: 3, textContent: 'Custom label' }], [replacement])), false);
    assert.equal(h.api.isOwnMutation(change([], [replacement], message.controls.edit)), false);
    assert.equal(h.api.isOwnMutation(change([{ nodeType: 1 }], [])), false);
    assert.equal(h.api.isOwnMutation(change([], [])), false);
});
test('scheduler slicing decorates at most 40 messages before yielding and never traverses avatars', async () => {
    const h = harness({ total: 105 });
    const promise = h.api.refreshAll(h.root, { enabled: () => true, lightweight: () => true });
    assert.equal(h.visits.length, 40); assert.equal(h.yields, 1); assert.equal(h.timeouts, 0);
    await h.advance(); assert.equal(h.visits.length, 80); assert.equal(h.yields, 2);
    assert.equal(await h.drain(promise), true); assert.equal(h.visits.length, 105);
    assert(h.messages.every(h.masked)); assert.equal(new Set(h.visits).size, 105);
});
test('the time budget yields before the count ceiling when individual messages cost more', async () => {
    const h = harness({ total: 10, cost: 3 });
    const promise = h.api.refreshAll(h.root, { enabled: () => true, lightweight: () => true });
    assert.equal(h.visits.length, 3); assert.equal(h.yields, 1);
    await h.advance(); assert.equal(h.visits.length, 6);
    await h.drain(promise); assert.equal(h.visits.length, 10);
});
test('Safari fallback yields with zero-delay timers and completes the same bounded work', async () => {
    const h = harness({ total: 85, scheduler: false });
    const promise = h.api.refreshAll(h.root, { enabled: () => true, lightweight: () => true });
    assert.equal(h.visits.length, 40); assert.equal(h.timeouts, 1); assert.equal(h.yields, 0);
    assert.equal(await h.drain(promise), true); assert.equal(h.timeouts, 2); assert.equal(h.visits.length, 85);
});
test('a newer refresh cancels stale slices and leaves every message at the latest glyph state', async () => {
    const h = harness({ total: 100 });
    const old = h.api.refreshAll(h.root, { enabled: () => true, lightweight: () => true });
    assert.equal(h.visits.length, 40);
    const latest = h.api.refreshAll(h.root, { enabled: () => true, lightweight: () => false });
    await h.drain(latest); assert.equal(await old, false);
    assert(h.messages.every(message => h.svgCount(message) === 6 && !h.masked(message)));
});
test('cancel prevents any resumed stale decoration after a synchronous style refresh', async () => {
    const h = harness({ total: 100, scheduler: false });
    const old = h.api.refreshAll(h.root, { enabled: () => true, lightweight: () => true });
    h.api.cancel();
    for (const message of h.messages) h.api.decorate(message, { enabled: false, lightweight: false });
    const visits = h.visits.length; assert.equal(await h.drain(old), false); assert.equal(h.visits.length, visits);
    assert(h.messages.every(message => h.svgCount(message) === 0 && !h.masked(message)));
});
test('state callbacks remain current and detached or reparented messages are skipped', async () => {
    const h = harness({ total: 90 }); let lightweight = true;
    const promise = h.api.refreshAll(h.root, { enabled: () => true, lightweight: () => lightweight });
    lightweight = false; h.messages[50].isConnected = false; h.messages[51].parentElement = {};
    await h.drain(promise);
    assert(h.masked(h.messages[0])); assert.equal(h.svgCount(h.messages[40]), 6);
    assert(!h.visits.includes(50)); assert(!h.visits.includes(51));
});
test('an empty chat completes without scheduling a task', async () => {
    const h = harness({ total: 0 });
    assert.equal(await h.api.refreshAll(h.root, { enabled: () => true, lightweight: () => true }), true);
    assert.equal(h.yields + h.timeouts, 0);
});
