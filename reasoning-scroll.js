// Keep an expanded streaming reasoning box at its own bottom until the reader
// scrolls upward. The native message and outer chat keep their positions.
export function setupReasoningScroll({ root, enabled }) {
    const records = new Map(), byDetails = new WeakMap(), pending = new Set();
    let frame = null, pruneNeeded = false, destroyed = false, watching = false;
    const view = root.ownerDocument?.defaultView || globalThis;
    const isExpanded = record => record.details?.open === true;
    const isThinking = record => record.details?.dataset.state === 'thinking';
    const inRoot = element => element.isConnected && root.contains(element);
    const atBottom = element => element.scrollHeight - element.clientHeight - element.scrollTop <= 3;
    const schedule = () => { if (!destroyed && frame === null) frame = requestAnimationFrame(flush); };
    function queue(record) {
        if (!record || !watching || destroyed) return;
        // A final text chunk and native thinking→done transition can share a
        // mutation delivery. Preserve that last following scroll once.
        record.finalChunk ||= record.thinking;
        pending.add(record);
        schedule();
    }
    function remove(record) {
        record.element.removeEventListener('scroll', record.onScroll);
        resizeObserver?.unobserve(record.element);
        if (byDetails.get(record.details) === record) byDetails.delete(record.details);
        pending.delete(record);
        records.delete(record.element);
    }
    function register(element) {
        if (!element) return;
        let record = records.get(element);
        const details = element.closest('.mes_reasoning_details');
        if (!details) return;
        // Every native message includes a closed, often empty placeholder.
        // Attach inner listeners/size observers only when it is first opened.
        if (!record && !details.open) return;
        if (record) {
            if (record.details !== details) {
                if (byDetails.get(record.details) === record) byDetails.delete(record.details);
                record.details = details;
                byDetails.set(details, record);
            }
            return record;
        }
        const thinking = details.dataset.state === 'thinking';
        record = { element, details, following: thinking ? true : null, lastTop: null, thinking, finalChunk: false, expanded: details.open === true };
        record.onScroll = () => {
            if (!enabled() || !isExpanded(record)) return;
            const top = element.scrollTop;
            // Our write already updates lastTop. Its asynchronous scroll event
            // may arrive after another chunk increased the scroll height.
            if (record.lastTop !== null && Math.abs(top - record.lastTop) <= .5) return;
            record.lastTop = top;
            record.following = atBottom(element);
        };
        records.set(element, record);
        byDetails.set(details, record);
        element.addEventListener('scroll', record.onScroll, { passive: true });
        resizeObserver?.observe(element);
        return record;
    }
    function scan(scope) {
        if (scope.matches?.('.mes_reasoning')) { queue(register(scope)); return; }
        if (scope.matches?.('.mes,.mes_block,.mes_reasoning_details')) {
            // Native messages contain one reasoning box, before the message
            // text. Stop at it instead of traversing the remaining rich HTML.
            queue(register(scope.querySelector('.mes_reasoning')));
            return;
        }
        scope.querySelectorAll?.('.mes_reasoning').forEach(element => queue(register(element)));
    }
    function flush() {
        frame = null;
        if (pruneNeeded) {
            pruneNeeded = false;
            for (const record of records.values()) if (!inRoot(record.element)) remove(record);
        }
        const active = enabled();
        if (!active) { suspend(); return; }
        for (const record of pending) {
            if (!inRoot(record.element)) { remove(record); continue; }
            const expanded = isExpanded(record), thinking = isThinking(record);
            if (active && expanded) {
                if (record.lastTop === null) record.lastTop = record.element.scrollTop;
                if (record.following === null) record.following = atBottom(record.element);
                if (record.following && (thinking || record.finalChunk)) {
                    record.element.scrollTop = record.element.scrollHeight;
                    record.lastTop = record.element.scrollTop;
                } else if (!record.expanded && !record.following) {
                    // Closing details can temporarily report scrollTop=0.
                    // Restore only the inner reading position on reopening.
                    record.element.scrollTop = record.lastTop;
                    record.lastTop = record.element.scrollTop;
                }
            }
            record.expanded = expanded;
            record.thinking = thinking;
            record.finalChunk = false;
        }
        pending.clear();
    }
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
        for (const entry of entries) queue(records.get(entry.target));
    }) : null;
    const observer = new MutationObserver(mutations => {
        if (!watching) return;
        if (!enabled()) { suspend(); return; }
        for (const mutation of mutations) {
            if (mutation.type === 'attributes') {
                const details = mutation.target;
                if (!details.matches?.('.mes_reasoning_details')) continue;
                let record = byDetails.get(details);
                if (!record) record = register(details.querySelector('.mes_reasoning'));
                queue(record);
                continue;
            }
            const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
            const reasoning = target?.closest?.('.mes_reasoning');
            if (reasoning) { queue(register(reasoning)); continue; }
            // Native streaming replaces rich HTML. Never search its added or
            // detached paragraphs for reasoning boxes.
            if (target?.closest?.('.mes_text')) continue;
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.matches('.mes_reasoning,.mes_reasoning_details,.mes,.mes_block')) scan(node);
            }
            if ([...mutation.removedNodes].some(node => node.nodeType === 1 && node.matches('.mes_reasoning,.mes_reasoning_details,.mes,.mes_block'))) {
                pruneNeeded = true;
                schedule();
            }
        }
    });
    const onLoad = event => queue(register(event.target.closest?.('.mes_reasoning')));
    const onResize = () => { for (const record of records.values()) queue(record); };
    function resume() {
        if (watching || destroyed || !enabled()) return;
        watching = true;
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'data-state'] });
        root.addEventListener('load', onLoad, true);
        view.addEventListener?.('resize', onResize, { passive: true });
        scan(root);
    }
    function suspend() {
        watching = false;
        observer.disconnect(); resizeObserver?.disconnect();
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null; pruneNeeded = false;
        root.removeEventListener('load', onLoad, true);
        view.removeEventListener?.('resize', onResize);
        for (const record of records.values()) remove(record);
        pending.clear();
    }
    resume();
    return {
        refresh(messages) {
            if (destroyed) return;
            if (!enabled()) { suspend(); return; }
            if (!watching) { resume(); return; }
            if (messages) for (const message of messages) scan(message);
            else { pruneNeeded = true; for (const record of records.values()) queue(record); schedule(); }
        },
        destroy() { destroyed = true; suspend(); },
    };
}
