import test from 'node:test';
import assert from 'node:assert/strict';
import { setupReasoningScroll } from '../reasoning-scroll.js';

function harness({ thinking = true, expanded = true, active = true } = {}) {
    const previous = { MutationObserver: globalThis.MutationObserver, ResizeObserver: globalThis.ResizeObserver, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
    const frames = new Map(); let nextFrame = 0, notify, queries = 0;
    globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
    globalThis.cancelAnimationFrame = id => frames.delete(id);
    globalThis.MutationObserver = class { constructor(callback) { notify = callback; } observe() {} disconnect() {} };
    globalThis.ResizeObserver = undefined;
    const view = new EventTarget(), root = new EventTarget(), box = new EventTarget();
    const details = { nodeType: 1, open: expanded, dataset: { state: thinking ? 'thinking' : 'done' }, matches: selector => selector === '.mes_reasoning_details' };
    let top = 0, writes = 0, reads = 0;
    Object.assign(box, { nodeType: 1, isConnected: true, height: 300, viewport: 100, matches: selector => selector.split(',').includes('.mes_reasoning'), closest: selector => selector === '.mes_reasoning_details' ? details : selector === '.mes_reasoning' ? box : null, querySelectorAll: () => [] });
    Object.defineProperties(box, {
        scrollHeight: { get() { reads++; return box.height; } },
        clientHeight: { get() { reads++; return box.viewport; } },
        scrollTop: { get() { reads++; return top; }, set(value) { writes++; top = Math.max(0, Math.min(value, box.height - box.viewport)); } },
    });
    Object.assign(root, { nodeType: 1, scrollTop: 73, contains: element => element.isConnected, ownerDocument: { defaultView: view }, querySelectorAll: () => { queries++; return [box]; } });
    details.querySelector = () => box;
    const api = setupReasoningScroll({ root, enabled: () => active });
    const tick = () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(); };
    const stream = (height = box.height + 100) => { box.height = height; notify([{ type: 'childList', target: box, addedNodes: [], removedNodes: [] }]); };
    const attribute = name => notify([{ type: 'attributes', target: details, attributeName: name }]);
    const scroll = value => { top = value; box.dispatchEvent(new Event('scroll')); };
    return { api, root, box, details, frames, stream, tick, scroll, attribute, notify: records => notify(records), get top() { return top; }, get writes() { return writes; }, get reads() { return reads; }, get queries() { return queries; }, set active(value) { active = value; }, restore() { api.destroy(); Object.assign(globalThis, previous); } };
}

test('streaming follows only the inner bottom, pauses when reading above, and resumes at bottom', () => {
    const h = harness();
    try {
        assert.equal(h.reads, 0, 'Registering during message decoration must not force layout');
        h.tick(); assert.equal(h.top, 200);
        h.stream(); h.tick(); assert.equal(h.top, 300);
        h.scroll(80); h.stream(); h.tick(); assert.equal(h.top, 80);
        h.scroll(400); h.stream(); h.tick(); assert.equal(h.top, 500);
        assert.equal(h.root.scrollTop, 73, 'Reasoning following moved the outer chat');
    } finally { h.restore(); }
});

test('an asynchronous event from our own scroll does not cancel following after another chunk', () => {
    const h = harness();
    try {
        h.tick(); h.stream();
        h.box.dispatchEvent(new Event('scroll')); // Same lastTop, but the new bottom is now farther away.
        h.tick(); assert.equal(h.top, 300);
    } finally { h.restore(); }
});

test('collapsed and disabled content does not scroll, and expanding resumes a followed stream', () => {
    const h = harness({ expanded: false });
    try {
        h.tick(); h.stream(); h.tick(); assert.equal(h.writes, 0);
        h.details.open = true; h.attribute('open'); h.tick(); assert.equal(h.top, 300);
        h.active = false; h.api.refresh(); h.stream(); h.tick(); assert.equal(h.top, 300);
        h.active = true; h.api.refresh(); h.tick(); assert.equal(h.top, 400);
        h.scroll(60); h.details.open = false; h.attribute('open'); h.tick();
        h.scroll(0); // Browser reports zero while details is closed; ignore it.
        h.stream(); h.tick(); h.details.open = true; h.attribute('open'); h.tick(); assert.equal(h.top, 60);
    } finally { h.restore(); }
});

test('history stays at its reading position and the last streaming chunk follows once', () => {
    const history = harness({ thinking: false });
    try { history.tick(); assert.equal(history.writes, 0); history.stream(); history.tick(); assert.equal(history.writes, 0); } finally { history.restore(); }
    const h = harness();
    try {
        h.tick(); h.stream(); h.details.dataset.state = 'done'; h.attribute('data-state'); h.tick(); assert.equal(h.top, 300);
        h.stream(); h.tick(); assert.equal(h.top, 300, 'Finished reasoning kept following unrelated later updates');
    } finally { h.restore(); }
});

test('many chunks coalesce without searching streamed subtrees', () => {
    const h = harness();
    try {
        h.tick(); const queries = h.queries;
        const paragraph = { nodeType: 1, querySelectorAll() { assert.fail('Streamed paragraphs must not be searched'); } };
        for (let i = 0; i < 100; i++) h.notify([{ type: 'childList', target: h.box, addedNodes: [paragraph], removedNodes: [paragraph] }]);
        assert.equal(h.frames.size, 1); h.tick(); assert.equal(h.queries, queries);
    } finally { h.restore(); }
});

test('removed boxes and destroyed modules cannot retain pending work or scroll listeners', () => {
    const h = harness();
    try {
        h.tick(); h.stream(); h.box.isConnected = false;
        h.notify([{ type: 'childList', target: h.root, addedNodes: [], removedNodes: [{ nodeType: 1, matches: () => true }] }]);
        h.tick(); const writes = h.writes; h.scroll(30); h.stream(); h.tick(); assert.equal(h.writes, writes);
        h.api.destroy(); h.api.refresh(); assert.equal(h.frames.size, 0);
    } finally { h.restore(); }
});

test('disabled Surface suspends observers, queues and box listeners until a fresh enabled scan', () => {
    const h = harness({ active: false });
    try {
        assert.equal(h.queries, 0); assert.equal(h.frames.size, 0);
        h.active = true; h.api.refresh(); h.tick(); assert.equal(h.top, 200);
        h.stream(); assert.equal(h.frames.size, 1);
        h.active = false; h.api.refresh(); assert.equal(h.frames.size, 0);
        const reads = h.reads, queries = h.queries;
        h.scroll(40); for (let i = 0; i < 30; i++) h.stream();
        assert.equal(h.frames.size, 0); assert.equal(h.reads, reads); assert.equal(h.queries, queries);
        h.active = true; h.api.refresh(); assert.equal(h.queries, queries + 1); h.tick(); assert.equal(h.top, h.box.height - h.box.viewport);
    } finally { h.restore(); }
});

test('new native messages register only their one reasoning box, and early user reading wins', () => {
    const h = harness();
    try {
        h.scroll(50); h.tick(); assert.equal(h.top, 50, 'Initial follow overrode user input before the frame');
        const details = { nodeType: 1, open: true, dataset: { state: 'thinking' } };
        const box = new EventTarget(); let top = 0;
        Object.assign(box, { nodeType: 1, isConnected: true, scrollHeight: 600, clientHeight: 100, closest: () => details });
        Object.defineProperty(box, 'scrollTop', { get: () => top, set: value => { top = Math.min(500, value); } });
        const message = { nodeType: 1, matches: selector => selector.split(',').includes('.mes'), querySelector: () => box, querySelectorAll() { assert.fail('Native single-box lookup must stop before rich message text'); } };
        h.notify([{ type: 'childList', target: h.root, addedNodes: [message], removedNodes: [] }]);
        h.tick(); assert.equal(top, 500); assert.equal(h.root.scrollTop, 73);
    } finally { h.restore(); }
});

test('one thousand closed native placeholders stay idle until one reasoning box opens', () => {
    const previous = { MutationObserver: globalThis.MutationObserver, ResizeObserver: globalThis.ResizeObserver, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
    const frames = new Map(), boxes = [], details = [];
    let notify, nextFrame = 0, observed = 0, listeners = 0, api;
    globalThis.MutationObserver = class { constructor(callback) { notify = callback; } observe() {} disconnect() {} };
    globalThis.ResizeObserver = class { observe() { observed++; } unobserve() { observed--; } disconnect() {} };
    globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
    globalThis.cancelAnimationFrame = id => frames.delete(id);
    const view = new EventTarget(), root = new EventTarget();
    try {
        for (let i = 0; i < 1000; i++) {
            const detail = { nodeType: 1, open: false, dataset: { state: 'none' }, matches: selector => selector === '.mes_reasoning_details' };
            const box = new EventTarget(), add = box.addEventListener.bind(box), remove = box.removeEventListener.bind(box);
            let top = 0;
            Object.assign(box, {
                nodeType: 1, isConnected: true, scrollHeight: 300, clientHeight: 100,
                matches: selector => selector.split(',').includes('.mes_reasoning'),
                closest: selector => selector === '.mes_reasoning_details' ? detail : selector === '.mes_reasoning' ? box : null,
                addEventListener(type, ...args) { if (type === 'scroll') listeners++; add(type, ...args); },
                removeEventListener(type, ...args) { if (type === 'scroll') listeners--; remove(type, ...args); },
            });
            Object.defineProperty(box, 'scrollTop', { get: () => top, set: value => { top = Math.max(0, Math.min(200, value)); } });
            detail.querySelector = () => box; boxes.push(box); details.push(detail);
        }
        Object.assign(root, { ownerDocument: { defaultView: view }, contains: box => box.isConnected, querySelectorAll: () => boxes });
        api = setupReasoningScroll({ root, enabled: () => true });
        assert.equal(listeners, 0, 'Ordinary empty messages installed scroll listeners');
        assert.equal(observed, 0, 'Ordinary empty messages installed resize observers');
        assert.equal(frames.size, 0, 'Ordinary empty messages queued layout work');
        const detail = details[731], box = boxes[731];
        detail.dataset.state = 'thinking';
        notify([{ type: 'attributes', target: detail, attributeName: 'data-state' }]);
        notify([{ type: 'childList', target: box, addedNodes: [], removedNodes: [] }]);
        assert.equal(listeners, 0); assert.equal(observed, 0); assert.equal(frames.size, 0);
        detail.open = true;
        notify([{ type: 'attributes', target: detail, attributeName: 'open' }]);
        assert.equal(listeners, 1); assert.equal(observed, 1); assert.equal(frames.size, 1);
        const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback());
        assert.equal(box.scrollTop, 200, 'First opening of an active stream did not follow its bottom');
        api.destroy(); assert.equal(listeners, 0); assert.equal(observed, 0); assert.equal(frames.size, 0);
    } finally { api?.destroy(); Object.assign(globalThis, previous); }
});
