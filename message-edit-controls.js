// A second view of the host's edit actions. Native controls remain the only
// owners of their handlers, message identity, confirmation dialogs and saves.
export function setupMessageEditControls({ root, enabled, ui = text => text }) {
    const doc = root.ownerDocument;
    const view = doc.defaultView || globalThis;
    const Observer = view.MutationObserver || globalThis.MutationObserver;
    const requestFrame = callback => (view.requestAnimationFrame || globalThis.requestAnimationFrame).call(view, callback);
    const cancelFrame = id => (view.cancelAnimationFrame || globalThis.cancelAnimationFrame).call(view, id);
    const records = new Map(), readingFocus = new Map();
    const pending = new Set();
    let frame = null, destroyed = false, watchingRoot = false;
    const controls = 'button,[role="button"],.menu_button,input[type="button"],input[type="submit"],a[href]';
    const actions = ['done', 'copy', 'add_reasoning', 'delete', 'up', 'down', 'cancel'];
    const inRoot = node => !!node?.isConnected && root.contains(node);
    const getStyle = element => view.getComputedStyle?.(element);
    const visible = element => {
        if (!element || element.hidden || element.closest('[hidden]')) return false;
        const style = getStyle(element);
        return style?.display !== 'none' && style?.visibility !== 'hidden' && style?.visibility !== 'collapse'
            && !!element.getClientRects().length;
    };
    const unavailable = element => !!element.disabled || element.matches(':disabled') || getStyle(element)?.pointerEvents === 'none'
        || !!element.closest('.disabled,[aria-disabled="true"],fieldset[disabled]');
    const labelReferences = element => (element.getAttribute('aria-labelledby') || '').trim().split(/\s+/).filter(Boolean).map(id => doc.getElementById(id)).filter(Boolean);
    const labelOf = element => labelReferences(element).map(label => label.getAttribute('aria-label') || label.textContent || '').join(' ').trim()
        || (element.getAttribute('aria-label') || element.title || element.textContent || element.value || '').trim();
    const actionOf = element => actions.find(action => element.classList.contains('mes_edit_' + action)) || 'extra';
    const sourceFor = message => message.querySelector('.ch_name .mes_edit_buttons');
    const eligible = message => inRoot(message) && message.closest('.mes') === message;
    function syncRootObserver() {
        if ((records.size || readingFocus.size) && !watchingRoot) { rootObserver.observe(root, { childList: true }); view.addEventListener?.('resize', queueActive, { passive: true }); watchingRoot = true; }
        else if (!records.size && !readingFocus.size && watchingRoot) { rootObserver.disconnect(); view.removeEventListener?.('resize', queueActive); watchingRoot = false; }
    }
    function queueActive() { for (const message of records.keys()) queue(message); }
    function focusMayReturn(record) {
        return (doc.activeElement === doc.body || doc.activeElement === record.focusIntent?.button)
            && !doc.querySelector('dialog[open]') && inRoot(record.text) && !record.text.closest('[hidden],[inert]');
    }
    function clearReadingFocus(text) {
        const record = readingFocus.get(text);
        if (!record) return;
        readingFocus.delete(text); text.removeEventListener('blur', record.onBlur);
        if (text.getAttribute('tabindex') === '-1') text.removeAttribute('tabindex');
        syncRootObserver();
    }
    function focusReading(text) {
        for (const previous of [...readingFocus.keys()]) clearReadingFocus(previous);
        if (text.getAttribute('tabindex') === null) {
            const record = { onBlur: () => clearReadingFocus(text) };
            readingFocus.set(text, record); text.setAttribute('tabindex', '-1');
            text.addEventListener('blur', record.onBlur, { once: true }); syncRootObserver();
        }
        text.focus({ preventScroll: true });
        if (doc.activeElement !== text) clearReadingFocus(text);
    }
    function release(record, restoreReading = false) {
        const restore = restoreReading && record.focusIntent?.close && enabled() && focusMayReturn(record);
        record.observer.disconnect();
        pending.delete(record.message);
        for (const item of record.items.values()) item.button.removeEventListener('click', item.onClick);
        record.bar.remove();
        record.items.clear();
        record.focusIntent = null;
        records.delete(record.message);
        if (restore) focusReading(record.text);
        syncRootObserver();
        if (!pending.size && frame !== null) { cancelFrame(frame); frame = null; }
    }
    function clear() {
        for (const record of [...records.values()]) release(record);
        for (const text of [...readingFocus.keys()]) clearReadingFocus(text);
        pending.clear();
        if (frame !== null) cancelFrame(frame);
        frame = null;
    }
    function queue(message) {
        if (destroyed || !enabled()) return;
        pending.add(message);
        if (frame === null) frame = requestFrame(() => {
            frame = null;
            const messages = [...pending]; pending.clear(); refresh(messages);
        });
    }
    function sourceControls(bar) {
        const result = [];
        for (const child of bar.children) {
            if (child.matches('button,input[type="button"],input[type="submit"],a[href]') && child.namespaceURI !== 'http://www.w3.org/2000/svg') { result.push(child); continue; }
            // A styled menu wrapper can contain the actual plugin button.
            // Clicking the leaf still bubbles through its wrapper; clicking a
            // wrapper never reaches a listener attached only to its child.
            const nested = [...child.querySelectorAll(controls)].filter(element => element.namespaceURI !== 'http://www.w3.org/2000/svg' && !element.querySelector(controls));
            if (nested.length) result.push(...nested);
            else if (child.matches(controls) || (labelOf(child) && !child.matches('input,select,textarea,hr'))) result.push(child);
        }
        return result;
    }
    function visualClone(node) {
        if (node.nodeType !== 1) return node.cloneNode(true);
        if (node.matches('script,style,iframe,object,embed')) return doc.createElement('span');
        const interactive = node.matches('button,input,select,textarea,a,[contenteditable]');
        const copy = interactive ? (node.namespaceURI === 'http://www.w3.org/2000/svg' ? doc.createElementNS('http://www.w3.org/2000/svg', 'g') : doc.createElement('span')) : node.cloneNode(false);
        for (const attribute of [...copy.attributes]) {
            const name = attribute.name.toLowerCase();
            let presentationReference = false;
            if (node.namespaceURI === 'http://www.w3.org/2000/svg') {
                const value = attribute.value.trim();
                presentationReference = value.startsWith('#');
                if (['use', 'image', 'feimage'].includes(node.tagName.toLowerCase())) {
                    try {
                        const protocol = new URL(value, doc.baseURI || 'http://localhost/').protocol;
                        presentationReference ||= ['http:', 'https:', 'blob:'].includes(protocol) || (protocol === 'data:' && /^data:image\//i.test(value));
                    } catch { /* Invalid resource references do not become links. */ }
                }
            }
            if (name === 'id' || name === 'name' || name === 'for' || ((name === 'href' || name === 'xlink:href') && !presentationReference) || name === 'tabindex' || name === 'role'
                || name === 'contenteditable' || name.startsWith('on') || name.startsWith('data-') || name.startsWith('aria-')) copy.removeAttribute(attribute.name);
        }
        const iconClasses = [...node.classList].filter(name => /^fa(?:[sbrldkt])?$/.test(name) || name.startsWith('fa-'));
        copy.removeAttribute('class');
        if (iconClasses.length) copy.classList.add(...iconClasses);
        for (const child of node.childNodes) copy.append(visualClone(child));
        return copy;
    }
    function updateVisual(item, label) {
        const { source, button } = item;
        const signature = (source.namespaceURI === 'http://www.w3.org/2000/svg' ? source.outerHTML : source.className + '\n' + source.innerHTML + '\n' + (source.value || '')) + '\n' + label;
        if (item.signature === signature) return;
        item.signature = signature;
        const icon = doc.createElement('span'); icon.className = 'cu-message-edit-icon'; icon.setAttribute('aria-hidden', 'true');
        const iconClasses = [...source.classList].filter(name => /^fa(?:[sbrldkt])?$/.test(name) || name.startsWith('fa-'));
        if (iconClasses.length) icon.classList.add(...iconClasses);
        if (source.namespaceURI === 'http://www.w3.org/2000/svg') icon.append(visualClone(source));
        else for (const child of source.childNodes) icon.append(visualClone(child));
        if (!iconClasses.length && !icon.childNodes.length) icon.textContent = label;
        button.replaceChildren(icon);
    }
    function makeItem(record, source) {
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'cu-message-edit-control';
        const item = { source, button, signature: null };
        item.onClick = event => {
            event.preventDefault(); event.stopPropagation();
            if (destroyed || !enabled() || !inRoot(record.message) || doc.getElementById('curEditTextarea') !== record.editor
                || !inRoot(source) || !record.source.contains(source) || source.closest('[inert]') || !visible(source) || unavailable(source)) return;
            // Do not copy native selector classes onto this button. Exactly one
            // real click reaches both direct and delegated host/plugin handlers.
            record.focusIntent = event.detail === 0 && doc.activeElement === button
                ? { source, button, close: ['done', 'cancel'].includes(actionOf(source)) } : null;
            if (typeof source.click === 'function') source.click();
            else source.dispatchEvent(new view.MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view }));
            if (record.focusIntent) queue(record.message);
        };
        button.addEventListener('click', item.onClick);
        return item;
    }
    function observe(record) {
        record.observer.disconnect();
        // Only the tiny native edit footer is watched deeply. Plugin icons may
        // update arbitrary SVG/image attributes (d, viewBox, src, …).
        record.observer.observe(record.source, { childList: true, subtree: true, characterData: true, attributes: true });
        for (const source of record.items.keys()) for (const label of labelReferences(source)) {
            if (!record.source.contains(label) && !label.contains(record.message)) record.observer.observe(label, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'aria-labelledby'] });
        }
        for (const target of new Set([record.message, record.block, record.text, record.source.parentElement])) {
            if (target) record.observer.observe(target, { childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert'] });
        }
    }
    function synchronize(message, editor) {
        const block = editor.closest('.mes_block'), text = editor.closest('.mes_text'), source = sourceFor(message);
        if (!block || !text || !source) { if (records.has(message)) release(records.get(message)); return; }
        let record = records.get(message);
        if (!record) {
            const bar = doc.createElement('div'); bar.className = 'cu-message-edit-controls'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', ui('消息编辑操作'));
            record = { message, editor, block, text, source, bar, items: new Map(), focusIntent: null, observer: new Observer(mutations => {
                if (mutations.some(mutation => mutation.target !== record.bar && !record.bar.contains(mutation.target))) queue(message);
            }) };
            records.set(message, record);
        }
        const focus = doc.activeElement;
        const focused = [...record.items.values()].find(item => item.button === focus);
        record.observer.disconnect();
        Object.assign(record, { editor, block, text, source });
        const next = sourceControls(source);
        for (const [original, item] of record.items) if (!next.includes(original)) { item.button.removeEventListener('click', item.onClick); item.button.remove(); record.items.delete(original); }
        let previous = null, hasVisible = false;
        for (const original of next) {
            let item = record.items.get(original);
            if (!item) { item = makeItem(record, original); record.items.set(original, item); }
            const button = item.button, shown = visible(original), disabled = unavailable(original);
            const label = labelOf(original) || ui('编辑操作');
            if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
            if (button.title !== (original.title || label)) button.title = original.title || label;
            const action = actionOf(original);
            if (button.getAttribute('data-cu-edit-action') !== action) button.setAttribute('data-cu-edit-action', action);
            if (button.hidden !== !shown) button.hidden = !shown;
            if (button.disabled !== disabled) button.disabled = disabled;
            if (button.getAttribute('aria-disabled') !== String(disabled)) button.setAttribute('aria-disabled', String(disabled));
            for (const name of ['aria-pressed', 'aria-expanded', 'aria-haspopup', 'aria-busy', 'aria-controls']) {
                const value = original.getAttribute(name);
                if (button.getAttribute(name) === value) continue;
                if (value === null) button.removeAttribute(name); else button.setAttribute(name, value);
            }
            updateVisual(item, label);
            const expected = previous ? previous.nextElementSibling : record.bar.firstElementChild;
            if (expected !== button) record.bar.insertBefore(button, expected);
            previous = button; hasVisible ||= shown;
        }
        record.bar.hidden = !hasVisible;
        if (record.bar.parentElement !== block || record.bar.nextElementSibling !== text) block.insertBefore(record.bar, text);
        observe(record); syncRootObserver();
        if (record.focusIntent && !record.focusIntent.close) {
            const intent = record.focusIntent;
            if (focusMayReturn(record)) {
                const preferred = record.items.get(intent.source);
                const available = item => item && !item.button.hidden && !item.button.disabled;
                const target = available(preferred) ? preferred : [...record.items.values()].find(available);
                target?.button.focus({ preventScroll: true });
            }
            record.focusIntent = null;
        } else if (focused && (doc.activeElement === doc.body || doc.activeElement === focus)
            && (doc.activeElement === doc.body || !record.bar.contains(focus) || focus.hidden || focus.disabled)) {
            const preferred = record.items.get(focused.source);
            const available = item => item && !item.button.hidden && !item.button.disabled;
            const target = available(preferred) ? preferred : [...record.items.values()].find(available);
            target?.button.focus({ preventScroll: true });
        }
    }
    function refresh(messages) {
        if (destroyed) return;
        if (!enabled()) { clear(); return; }
        for (const text of [...readingFocus.keys()]) if (!inRoot(text)) clearReadingFocus(text);
        const editor = doc.getElementById('curEditTextarea');
        const message = editor?.closest('.mes');
        for (const record of [...records.values()]) if (!eligible(record.message) || record.message !== message || record.editor !== editor) release(record, !editor);
        if (!editor || !eligible(message)) return;
        if (messages && records.has(message) && ![...messages].includes(message)) return;
        synchronize(message, editor);
        pending.delete(message);
        if (!pending.size && frame !== null) { cancelFrame(frame); frame = null; }
    }
    const rootObserver = new Observer(() => {
        for (const text of [...readingFocus.keys()]) if (!inRoot(text)) clearReadingFocus(text);
        for (const record of [...records.values()]) if (!inRoot(record.message)) release(record);
    });
    refresh();
    return {
        refresh,
        destroy() { if (destroyed) return; destroyed = true; clear(); rootObserver.disconnect(); view.removeEventListener?.('resize', queueActive); watchingRoot = false; },
    };
}
