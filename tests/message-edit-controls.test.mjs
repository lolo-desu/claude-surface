import test from 'node:test';
import assert from 'node:assert/strict';
import { setupMessageEditControls } from '../message-edit-controls.js';

// Small DOM boundary: events execute real proxy listeners, while mutations and
// frames are explicitly delivered so lifecycle/performance assertions are exact.
function harness({ active = true, editing = true } = {}) {
    const frames = new Map(), observers = [], elements = new Set();
    let sequence = 0, queries = 0, idReads = 0;
    const doc = { activeElement: null };
    class Element extends EventTarget {
        constructor(tag = 'div') { super(); this.tagName = tag.toUpperCase(); this.nodeType = 1; this.ownerDocument = doc; this.parentElement = null; this.childNodes = []; this.attrs = new Map(); this._text = ''; this.rendered = true; elements.add(this); }
        get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
        get className() { return this.attrs.get('class') || ''; }
        set className(value) { this.setAttribute('class', value); }
        get classList() { const node = this; return { contains: value => node.className.split(/\s+/).includes(value), add(...values) { node.className = [...new Set([...node.classList, ...values])].filter(Boolean).join(' '); }, remove(...values) { node.className = [...node.classList].filter(value => !values.includes(value)).join(' '); }, [Symbol.iterator]: function* () { yield* node.className.split(/\s+/).filter(Boolean); } }; }
        get id() { return this.getAttribute('id') || ''; } set id(value) { this.setAttribute('id', value); }
        get title() { return this.getAttribute('title') || ''; } set title(value) { this.setAttribute('title', value); }
        get hidden() { return this.attrs.has('hidden'); } set hidden(value) { value ? this.setAttribute('hidden', '') : this.removeAttribute('hidden'); }
        get disabled() { return this.attrs.has('disabled'); } set disabled(value) { value ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'); }
        get children() { return this.childNodes.filter(child => child.nodeType === 1); }
        get firstElementChild() { return this.children[0] || null; }
        get nextElementSibling() { if (!this.parentElement) return null; const siblings = this.parentElement.children; return siblings[siblings.indexOf(this) + 1] || null; }
        get textContent() { return this._text + this.childNodes.map(child => child.textContent).join(''); }
        set textContent(value) { this.replaceChildren(); this._text = String(value); }
        get outerHTML() { return '<' + this.tagName + JSON.stringify([...this.attrs]) + '>' + this.innerHTML + '</' + this.tagName + '>'; }
        get innerHTML() { return this._text + this.childNodes.map(child => child.nodeType === 1 ? '<' + child.tagName + JSON.stringify([...child.attrs]) + '>' + child.innerHTML : child.textContent).join(''); }
        get isConnected() { return this === doc.body || !!this.parentElement?.isConnected; }
        setAttribute(name, value) { this.attrs.set(name, String(value)); }
        getAttribute(name) { return this.attrs.get(name) ?? null; }
        removeAttribute(name) { this.attrs.delete(name); }
        append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
        insertBefore(node, before) { node.remove(); node.parentElement = this; this.childNodes.splice(before ? this.childNodes.indexOf(before) : this.childNodes.length, 0, node); return node; }
        replaceChildren(...nodes) { for (const child of this.childNodes) child.parentElement = null; this.childNodes = []; this._text = ''; this.append(...nodes); }
        remove() { if (this.parentElement) { const parent = this.parentElement; parent.childNodes.splice(parent.childNodes.indexOf(this), 1); this.parentElement = null; } }
        contains(node) { return node === this || this.childNodes.some(child => child.contains?.(node)); }
        matches(selector) {
            return selector.split(',').some(part => {
                part = part.trim();
                if (part.includes(' ')) { const sections = part.split(/\s+/); return this.matches(sections.at(-1)) && !!this.parentElement?.closest(sections.slice(0, -1).join(' ')); }
                const match = part.match(/^([\w-]+)?((?:[.#][\w-]+)*)(?:\[([\w-]+)(?:="([^"]*)")?\])?$/);
                if (!match || (match[1] && this.tagName.toLowerCase() !== match[1])) return false;
                for (const token of match[2].match(/[.#][\w-]+/g) || []) if (token[0] === '.' ? !this.classList.contains(token.slice(1)) : this.id !== token.slice(1)) return false;
                return !match[3] || (this.attrs.has(match[3]) && (match[4] === undefined || this.getAttribute(match[3]) === match[4]));
            });
        }
        closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
        querySelectorAll(selector) { queries++; const result = []; const visit = node => { for (const child of node.children) { if (child.matches(selector)) result.push(child); visit(child); } }; visit(this); return result; }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        getClientRects() { for (let node = this; node; node = node.parentElement) if (node.hidden || node.getAttribute('data-display') === 'none' || !node.rendered) return []; return this.isConnected ? [{}] : []; }
        cloneNode(deep = false) { const copy = new Element(this.tagName); for (const [name, value] of this.attrs) copy.setAttribute(name, value); copy._text = this._text; copy.namespaceURI = this.namespaceURI; if (deep) for (const child of this.childNodes) copy.append(child.cloneNode(true)); return copy; }
        click() { if (!this.disabled) { const event = new Event('click', { cancelable: true, bubbles: true }); Object.defineProperty(event, 'detail', { value: 0 }); this.dispatchEvent(event); } }
        focus() { if (!this.disabled && !this.hidden && doc.activeElement !== this) { const previous = doc.activeElement; doc.activeElement = this; previous?.dispatchEvent(new Event('blur')); } }
    }
    class Observer {
        constructor(callback) { this.callback = callback; this.targets = new Map(); observers.push(this); }
        observe(target, options) { this.targets.set(target, options); }
        disconnect() { this.targets.clear(); }
    }
    const view = new EventTarget();
    Object.assign(view, { MouseEvent: class extends Event { constructor(type, options) { super(type, options); this.detail = 0; } }, MutationObserver: Observer, requestAnimationFrame(callback) { frames.set(++sequence, callback); return sequence; }, cancelAnimationFrame(id) { frames.delete(id); }, getComputedStyle(node) { let pointerEvents = 'auto'; for (let parent = node; parent; parent = parent.parentElement) { if (parent.getAttribute('data-pointer-events')) { pointerEvents = parent.getAttribute('data-pointer-events'); break; } } return { display: node.getAttribute('data-display') || 'block', visibility: node.getAttribute('data-visibility') || 'visible', pointerEvents }; } });
    doc.querySelector = selector => doc.body.querySelector(selector); doc.defaultView = view; doc.createElement = tag => new Element(tag); doc.createElementNS = (namespace, tag) => { const node = new Element(tag); node.namespaceURI = namespace; return node; }; doc.body = new Element('body');
    doc.getElementById = id => { idReads++; return [...elements].find(element => element.id === id && element.isConnected) || null; };
    const root = new Element(); root.id = 'chat'; doc.body.append(root);
    const createMessage = () => {
        const message = new Element(); message.className = 'mes'; message.setAttribute('mesid', root.children.length);
        const block = new Element(); block.className = 'mes_block';
        const text = new Element(); text.className = 'mes_text';
        const footer = new Element(); footer.className = 'ch_name';
        const native = new Element(); native.className = 'mes_edit_buttons'; native.id = 'native-edit-actions-' + root.children.length;
        footer.append(native); block.append(text, footer); message.append(block); root.append(message);
        return { message, block, text, footer, native };
    };
    const current = createMessage(), calls = [];
    const addAction = (action, label = action, parent = current.native) => {
        const source = new Element(); source.className = 'menu_button mes_edit_' + action + ' fa-solid fa-check'; source.title = label; source.id = 'native-' + action;
        source.addEventListener('click', function () { calls.push({ action, source: this, mesid: this.closest('.mes')?.getAttribute('mesid') }); }); parent.append(source); return source;
    };
    const sources = Object.fromEntries(['done', 'copy', 'add_reasoning', 'delete', 'up', 'down', 'cancel'].map(action => [action, addAction(action)]));
    const editor = new Element('textarea'); editor.id = 'curEditTextarea'; editor.className = 'edit_textarea'; if (editing) current.text.append(editor);
    const api = setupMessageEditControls({ root, enabled: () => active, ui: value => 'Localized ' + value });
    const mutate = (target, type = 'attributes', attributeName = 'class') => {
        for (const observer of observers) {
            const relevant = [...observer.targets].some(([watched, options]) => (watched === target || (options.subtree && watched.contains(target)))
                && (type === 'attributes' ? options.attributes && (!options.attributeFilter || options.attributeFilter.includes(attributeName)) : type === 'childList' ? options.childList : options.characterData));
            if (relevant) observer.callback([{ target, type, attributeName }]);
        }
    };
    const tick = () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(); };
    const bar = () => current.block.children.find(node => node.classList.contains('cu-message-edit-controls'));
    const proxy = action => bar()?.children.find(node => node.getAttribute('data-cu-edit-action') === action);
    return { ...current, doc, view, root, editor, sources, calls, api, frames, observers, Element, createMessage, addAction, mutate, tick, bar, proxy, get queries() { return queries; }, get idReads() { return idReads; }, set active(value) { active = value; } };
}

test('only a live main editor receives a top action group; footer and editor identity remain native', () => {
    const h = harness({ editing: false });
    assert.equal(h.bar(), undefined); assert(h.observers.every(observer => !observer.targets.size));
    h.text.append(h.editor); h.api.refresh([h.message]);
    assert.equal(h.bar().nextElementSibling, h.text);
    assert.equal(h.bar().getAttribute('role'), 'group'); assert.equal(h.bar().getAttribute('aria-label'), 'Localized 消息编辑操作');
    assert.equal(h.bar().children.length, 7); assert.equal(h.native.children.length, 7);
    assert.equal(h.doc.getElementById('curEditTextarea'), h.editor);
    for (const button of h.bar().children) { assert.equal(button.id, ''); assert(!button.className.includes('mes_edit_')); assert.equal(button.type, 'button'); }
    h.api.destroy();
});

test('each proxy invokes exactly its original native handler with the original message binding', () => {
    const h = harness();
    for (const action of ['done', 'copy', 'delete', 'up', 'down', 'cancel']) h.proxy(action).click();
    assert.deepEqual(h.calls.map(call => call.action), ['done', 'copy', 'delete', 'up', 'down', 'cancel']);
    assert(h.calls.every(call => call.source === h.sources[call.action] && call.mesid === '0'));
    h.message.setAttribute('mesid', '41'); h.proxy('up').click(); assert.equal(h.calls.at(-1).mesid, '41', 'Native identity must not be cached numerically');
    h.api.destroy();
});

test('native class disabled, aria-disabled, hidden and CSS visibility are mirrored and block activation', () => {
    const h = harness();
    h.sources.up.classList.add('disabled'); h.sources.down.setAttribute('aria-disabled', 'true'); h.sources.copy.hidden = true; h.sources.add_reasoning.setAttribute('data-display', 'none');
    h.api.refresh([h.message]);
    assert(h.proxy('up').disabled); assert.equal(h.proxy('up').getAttribute('aria-disabled'), 'true'); assert(h.proxy('down').disabled);
    assert(h.proxy('copy').hidden); assert(h.proxy('add_reasoning').hidden);
    h.proxy('up').click(); h.proxy('down').click(); h.proxy('copy').click(); assert.equal(h.calls.length, 0);
    h.sources.up.classList.remove('disabled'); h.mutate(h.sources.up); h.tick(); h.proxy('up').click(); assert.equal(h.calls.length, 1);
    h.api.destroy();
});

test('ancestor/footer visibility can hide and re-show actions without losing their observer', () => {
    const h = harness();
    h.footer.hidden = true; h.mutate(h.footer, 'attributes', 'hidden'); h.tick(); assert(h.bar().hidden); assert(h.proxy('done').hidden);
    h.footer.hidden = false; h.mutate(h.footer, 'attributes', 'hidden'); h.tick(); assert(!h.bar().hidden); assert(!h.proxy('done').hidden);
    h.native.setAttribute('data-display', 'none'); h.mutate(h.native, 'attributes', 'style'); h.tick(); assert(h.bar().hidden);
    h.native.removeAttribute('data-display'); h.mutate(h.native, 'attributes', 'style'); h.tick(); assert(!h.bar().hidden);
    h.api.destroy();
});

test('new/replaced plugin actions preserve source listeners and cannot duplicate IDs or native selectors', () => {
    const h = harness();
    const plugin = h.addAction('plugin', 'Extension action'); plugin.id = 'plugin-source';
    const icon = new h.Element('span'); icon.id = 'plugin-icon'; icon.className = 'mes_edit_done fa-solid fa-star'; icon.setAttribute('onclick', 'danger()'); plugin.append(icon);
    h.mutate(h.native, 'childList'); h.tick(); const button = h.bar().children.at(-1); assert.equal(button.getAttribute('aria-label'), 'Extension action');
    assert.equal(button.querySelectorAll('[id]').length, 0); assert.equal(button.querySelectorAll('.mes_edit_done').length, 0); assert.equal(button.children[0].children[0].getAttribute('onclick'), null);
    button.click(); assert.equal(h.calls.at(-1).source, plugin);
    const old = h.proxy('done'); h.sources.done.remove(); const replacement = h.addAction('done', 'Replacement confirm'); h.mutate(h.native, 'childList'); h.tick();
    old.click(); assert.equal(h.calls.length, 1, 'Detached proxies must not retain their action listener'); h.proxy('done').click(); assert.equal(h.calls.at(-1).source, replacement);
    h.api.destroy();
});

test('edit completion, message removal, disable/reenable and destroy release bars, observers and old proxies', () => {
    const h = harness(); const old = h.proxy('done');
    h.active = false; h.api.refresh(); assert.equal(h.bar(), undefined); assert(h.observers.every(observer => !observer.targets.size)); old.click(); assert.equal(h.calls.length, 0);
    h.active = true; h.api.refresh(); assert(h.bar());
    h.editor.remove(); h.mutate(h.text, 'childList'); h.tick(); assert.equal(h.bar(), undefined);
    h.text.append(h.editor); h.api.refresh(); h.message.remove(); h.mutate(h.root, 'childList'); assert.equal(h.bar(), undefined); assert.equal(h.frames.size, 0);
    h.root.append(h.message); h.api.refresh(); assert(h.bar()); const last = h.proxy('cancel'); h.api.destroy(); h.api.refresh(); last.click(); assert.equal(h.calls.length, 0); assert.equal(h.bar(), undefined);
    assert(h.observers.every(observer => !observer.targets.size));
});

test('unrelated incremental batches and editor typing never scan or rebuild the active message', () => {
    const h = harness(); const originalBar = h.bar(), originalDone = h.proxy('done');
    const other = h.createMessage().message; const queries = h.queries, reads = h.idReads;
    for (let index = 0; index < 1000; index++) h.api.refresh([other]);
    assert.equal(h.queries, queries, 'An unrelated message caused native/body subtree queries'); assert.equal(h.idReads - reads, 1000, 'Editor lookup must use one document ID index per batch');
    for (let index = 0; index < 1000; index++) h.mutate(h.editor, 'attributes', 'style');
    assert.equal(h.frames.size, 0, 'Typing/autosizing is outside the watched native footer');
    h.api.refresh([h.message]); assert.equal(h.bar(), originalBar); assert.equal(h.proxy('done'), originalDone);
    h.api.destroy();
});

test('an independently edited reasoning textarea never creates main-message controls', () => {
    const h = harness({ editing: false }); const reasoning = new h.Element('textarea'); reasoning.className = 'reasoning_edit_textarea'; h.text.append(reasoning); h.api.refresh([h.message]);
    assert.equal(h.bar(), undefined); assert(h.observers.every(observer => !observer.targets.size)); h.api.destroy();
});


test('SVG fragment references stay native, HTML links and duplicate IDs do not, and icon attributes refresh', () => {
    const h = harness(); const source = new h.Element('button'); source.className = 'menu_button'; source.title = 'SVG action'; h.native.append(source);
    const svg = new h.Element('svg'); svg.namespaceURI = 'http://www.w3.org/2000/svg';
    const symbol = new h.Element('symbol'); symbol.namespaceURI = svg.namespaceURI; symbol.id = 'native-icon-symbol';
    const path = new h.Element('path'); path.namespaceURI = svg.namespaceURI; path.setAttribute('d', 'M0 0h18v18z'); symbol.append(path);
    const use = new h.Element('use'); use.namespaceURI = svg.namespaceURI; use.setAttribute('href', '#native-icon-symbol');
    const anchor = new h.Element('a'); anchor.setAttribute('href', '#must-not-navigate'); anchor.textContent = 'Details';
    svg.append(symbol, use); source.append(svg, anchor); h.mutate(h.native, 'childList'); h.tick();
    const proxy = h.bar().children.at(-1);
    assert.equal(proxy.querySelector('use').getAttribute('href'), '#native-icon-symbol');
    assert.equal(proxy.querySelectorAll('[id]').length, 0); assert.equal(h.doc.getElementById('native-icon-symbol'), symbol);
    assert.equal(proxy.querySelectorAll('a[href]').length, 0);
    path.setAttribute('d', 'M10 10h4v4z'); h.mutate(path, 'attributes', 'd'); assert.equal(h.frames.size, 1); h.tick();
    assert.equal(proxy.querySelector('path').getAttribute('d'), 'M10 10h4v4z');
    svg.setAttribute('viewBox', '0 0 24 24'); h.mutate(svg, 'attributes', 'viewBox'); h.tick();
    assert.equal(proxy.querySelector('svg').getAttribute('viewBox'), '0 0 24 24');
    h.api.destroy();
});


test('a styled plugin wrapper targets its real nested button and inherits disabled state', () => {
    const h = harness(); const wrapper = new h.Element(); wrapper.className = 'menu_button'; wrapper.title = 'Wrapper';
    const button = new h.Element('button'); button.title = 'Nested plugin action'; button.textContent = 'Run'; let clicks = 0;
    button.addEventListener('click', () => clicks++); wrapper.append(button); h.native.append(wrapper); h.mutate(h.native, 'childList'); h.tick();
    const proxy = h.bar().children.at(-1); assert.equal(proxy.getAttribute('aria-label'), 'Nested plugin action'); proxy.click(); assert.equal(clicks, 1);
    wrapper.classList.add('disabled'); h.mutate(wrapper); h.tick(); assert(proxy.disabled); proxy.click(); assert.equal(clicks, 1);
    wrapper.classList.remove('disabled'); h.mutate(wrapper); h.tick(); proxy.click(); assert.equal(clicks, 2);
    h.api.destroy();
});


test('an inert chat ancestor does not permanently hide proxies and still blocks programmatic activation', () => {
    const h = harness(); const original = h.proxy('done');
    h.root.setAttribute('inert', ''); h.api.refresh(); assert(!h.bar().hidden); assert(!original.hidden); original.click(); assert.equal(h.calls.length, 0);
    h.root.removeAttribute('inert'); original.click(); assert.equal(h.calls.length, 1);
    h.api.destroy();
});

test('SVG image resources survive while script/navigation references never become proxy content', () => {
    const h = harness(); const source = new h.Element('button'); source.title = 'Resource icon';
    const svg = h.doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const image = h.doc.createElementNS(svg.namespaceURI, 'image'); image.setAttribute('href', 'data:image/svg+xml,<svg/>');
    const script = h.doc.createElementNS(svg.namespaceURI, 'script'); script.setAttribute('href', 'https://example.test/script.js'); script.textContent = 'sideEffect()';
    svg.append(image, script); source.append(svg); h.native.append(source); h.mutate(h.native, 'childList'); h.tick();
    const proxy = h.bar().children.at(-1); assert.equal(proxy.querySelector('image').getAttribute('href'), 'data:image/svg+xml,<svg/>'); assert.equal(proxy.querySelector('script'), null);
    image.setAttribute('href', 'javascript:sideEffect()'); h.mutate(image, 'attributes', 'href'); h.tick(); assert.equal(proxy.querySelector('image').getAttribute('href'), null);
    h.api.destroy();
});


test('CSS pointer-events blocking mirrors loading state instead of bypassing the native action', () => {
    const h = harness(); h.native.setAttribute('data-pointer-events', 'none'); h.mutate(h.native, 'attributes', 'style'); h.tick();
    assert(h.proxy('done').disabled); h.proxy('done').click(); assert.equal(h.calls.length, 0);
    h.native.removeAttribute('data-pointer-events'); h.mutate(h.native, 'attributes', 'style'); h.tick(); h.proxy('done').click(); assert.equal(h.calls.length, 1); h.api.destroy();
});

test('keyboard movement restores a usable top control after native reparenting loses focus', () => {
    const h = harness(); h.sources.up.addEventListener('click', () => { h.message.remove(); h.root.append(h.message); h.sources.up.classList.add('disabled'); h.doc.activeElement = h.doc.body; });
    h.proxy('up').focus(); h.proxy('up').click(); h.tick();
    assert.equal(h.doc.activeElement, h.proxy('done')); assert(h.proxy('up').disabled); h.api.destroy();
});

test('keyboard confirmation/cancel returns focus to reading without leaving tabindex changes', () => {
    for (const action of ['done', 'cancel']) {
        const h = harness(); h.sources[action].addEventListener('click', () => h.editor.remove());
        h.proxy(action).focus(); h.proxy(action).click(); h.tick();
        assert.equal(h.doc.activeElement, h.text); assert.equal(h.text.getAttribute('tabindex'), '-1'); assert.equal(h.bar(), undefined); h.doc.body.focus(); assert.equal(h.text.getAttribute('tabindex'), null); h.api.destroy();
    }
});

test('focus restoration never takes focus from a native popup or a newer user focus target', () => {
    const h = harness(); const popup = new h.Element('dialog'); popup.setAttribute('open', '');
    h.sources.copy.addEventListener('click', () => { h.doc.body.append(popup); popup.focus(); });
    h.proxy('copy').focus(); h.proxy('copy').click(); h.tick(); assert.equal(h.doc.activeElement, popup); popup.remove();
    const input = new h.Element('input'); h.doc.body.append(input); h.proxy('done').focus(); h.proxy('done').click(); h.tick(); input.focus(); h.editor.remove(); h.mutate(h.text, 'childList'); h.tick(); assert.equal(h.doc.activeElement, input); h.api.destroy();
});


test('referenced accessible names outrank aria-label and follow outside-label text changes', () => {
    const h = harness(); const label = new h.Element('span'); label.id = 'native-edit-label'; label.hidden = true; label.textContent = 'Accessible extension action'; h.doc.body.append(label);
    h.sources.done.setAttribute('aria-label', 'Fallback label'); h.sources.done.setAttribute('aria-labelledby', label.id); h.api.refresh([h.message]);
    assert.equal(h.proxy('done').getAttribute('aria-label'), 'Accessible extension action');
    label.textContent = 'Renamed action'; h.mutate(label, 'childList'); h.tick(); assert.equal(h.proxy('done').getAttribute('aria-label'), 'Renamed action'); h.api.destroy();
});

test('reading-focus ownership restores on blur/removal/disable and preserves third-party tabindex changes', () => {
    for (const release of ['blur', 'remove', 'disable', 'external']) {
        const h = harness(); h.sources.done.addEventListener('click', () => h.editor.remove()); h.proxy('done').focus(); h.proxy('done').click(); h.tick(); assert.equal(h.text.getAttribute('tabindex'), '-1');
        if (release === 'external') { h.text.setAttribute('tabindex', '3'); h.doc.body.focus(); assert.equal(h.text.getAttribute('tabindex'), '3'); }
        else { if (release === 'blur') h.doc.body.focus(); if (release === 'remove') { h.message.remove(); h.mutate(h.root, 'childList'); } if (release === 'disable') { h.active = false; h.api.refresh(); } assert.equal(h.text.getAttribute('tabindex'), null); }
        h.api.destroy(); assert(h.observers.every(observer => !observer.targets.size));
    }
});


test('direct SVG role controls keep a visual SVG shell and dispatch one original click without HTMLElement.click', () => {
    const h = harness(); const source = h.doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); source.click = undefined; source.setAttribute('role', 'button'); source.setAttribute('viewBox', '0 0 18 18'); source.title = 'SVG control'; source.id = 'native-svg-control';
    const path = h.doc.createElementNS(source.namespaceURI, 'path'); path.setAttribute('d', 'M0 0h18v18z'); source.append(path); let clicks = 0; source.addEventListener('click', () => clicks++); h.native.append(source); h.mutate(h.native, 'childList'); h.tick();
    const proxy = h.bar().children.at(-1); assert(proxy.querySelector('svg')); assert.equal(proxy.querySelector('svg').getAttribute('role'), null); assert.equal(proxy.querySelectorAll('[id]').length, 0); proxy.click(); assert.equal(clicks, 1);
    source.setAttribute('viewBox', '0 0 36 36'); h.mutate(source, 'attributes', 'viewBox'); h.tick(); assert.equal(proxy.querySelector('svg').getAttribute('viewBox'), '0 0 36 36'); h.api.destroy();
});

test('an explicit active-message refresh consumes pending work, but an unrelated batch preserves it', () => {
    const h = harness(); h.sources.up.classList.add('disabled'); h.mutate(h.sources.up); assert.equal(h.frames.size, 1);
    h.api.refresh([h.message]); assert(h.proxy('up').disabled); assert.equal(h.frames.size, 0); const queries = h.queries; h.tick(); assert.equal(h.queries, queries, 'An already synchronized footer ran twice');
    h.sources.up.classList.remove('disabled'); h.mutate(h.sources.up); const other = h.createMessage().message; h.api.refresh([other]); assert.equal(h.frames.size, 1); h.tick(); assert(!h.proxy('up').disabled, 'An unrelated batch lost pending source changes'); h.api.destroy();
});


test('button state ARIA follows the original control and is removed when native state is removed', () => {
    const h = harness(); const values = { 'aria-pressed': 'false', 'aria-expanded': 'false', 'aria-haspopup': 'menu', 'aria-busy': 'false', 'aria-controls': 'native-editor-popup' };
    for (const [name, value] of Object.entries(values)) h.sources.done.setAttribute(name, value); h.api.refresh([h.message]);
    for (const [name, value] of Object.entries(values)) assert.equal(h.proxy('done').getAttribute(name), value);
    h.sources.done.setAttribute('aria-pressed', 'true'); h.sources.done.setAttribute('aria-expanded', 'true'); h.mutate(h.sources.done, 'attributes', 'aria-pressed'); h.tick();
    assert.equal(h.proxy('done').getAttribute('aria-pressed'), 'true'); assert.equal(h.proxy('done').getAttribute('aria-expanded'), 'true');
    for (const name of Object.keys(values)) h.sources.done.removeAttribute(name); h.mutate(h.sources.done, 'attributes', 'aria-pressed'); h.tick();
    for (const name of Object.keys(values)) assert.equal(h.proxy('done').getAttribute(name), null); h.api.destroy();
});

test('an accessible-name-only plugin keeps its visible fallback caption in sync with the name', () => {
    const h = harness(); const source = new h.Element('button'); source.setAttribute('aria-label', 'Start extension'); h.native.append(source); h.mutate(h.native, 'childList'); h.tick();
    const proxy = h.bar().children.at(-1); assert.equal(proxy.textContent, 'Start extension'); source.setAttribute('aria-label', 'Stop extension'); h.mutate(source, 'attributes', 'aria-label'); h.tick();
    assert.equal(proxy.getAttribute('aria-label'), 'Stop extension'); assert.equal(proxy.textContent, 'Stop extension'); h.api.destroy();
});


test('mirroring a reordered footer keeps its focused proxy, without stealing a newer focus target', () => {
    for (const focusTarget of ['body', 'other']) {
        const h = harness(); const proxy = h.proxy('cancel'); proxy.focus(); const other = new h.Element('input'); h.doc.body.append(other);
        const bar = h.bar(), insertBefore = bar.insertBefore.bind(bar);
        bar.insertBefore = (node, before) => { const ownedFocus = node === h.doc.activeElement; const result = insertBefore(node, before); if (ownedFocus) h.doc.activeElement = focusTarget === 'body' ? h.doc.body : other; return result; };
        h.native.insertBefore(h.sources.cancel, h.sources.done); h.mutate(h.native, 'childList'); h.tick();
        assert.equal(h.bar().firstElementChild, proxy); assert.equal(h.doc.activeElement, focusTarget === 'body' ? proxy : other); h.api.destroy();
    }
});
