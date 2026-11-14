// Mutation work is proportional to changed messages, not the entire chat.
// Disconnect while decorating so moving avatars cannot schedule another pass.
export function observeMessageUpdates({ root, enabled, decorate, contextChanged, followLoad = () => false, canPinLoad = () => true, loadKey = () => undefined, isOwnReasoningIconChange = () => false, batchSize = 80 }) {
    const dirty = new Set();
    let frame = null, rootChanged = false, pinLoad = null;
    const releasePin = () => { pinLoad = null; };
    for (const type of ['wheel','touchstart','pointerdown','keydown']) root.addEventListener(type, releasePin, { passive: true });
    const observe = () => observer.observe(root, { childList: true, subtree: true });
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(flush); };
    function collect(records, queue = true) {
        if (!enabled()) return;
        for (const record of records) {
            if (record.target === root) {
                rootChanged = true;
                for (const node of record.removedNodes) dirty.delete(node);
                for (const node of record.addedNodes) if (node.nodeType === 1 && node.matches('.mes')) { dirty.add(node); if (followLoad()) pinLoad = { key: loadKey() }; }
            } else {
                const nodes = [...record.addedNodes, ...record.removedNodes].filter(node => node.nodeType === 1);
                if (!nodes.length) continue;
                // Streaming HTML and reasoning text need no avatar/control work.
                const text = record.target.closest?.('.mes_text,.mes_reasoning');
                // The native editor is a direct child of .mes_text. Do not
                // traverse every streamed paragraph (including removed HTML).
                if (text && !nodes.some(node => node.id === 'curEditTextarea')) continue;
                if (record.target.closest?.('.mes_reasoning_actions') && isOwnReasoningIconChange(record)) continue;
                const message = record.target.parentElement?.closest('.mes') || record.target.closest?.('.mes');
                if (message?.parentElement === root) dirty.add(message);
            }
        }
        if (queue && (dirty.size || rootChanged)) schedule();
    }
    function flush() {
        frame = null;
        collect(observer.takeRecords(), false);
        if (!enabled()) { dirty.clear(); rootChanged = false; pinLoad = null; return; }
        const batch = [];
        for (const message of dirty) {
            dirty.delete(message);
            if (message.parentElement === root) batch.push(message);
            if (batch.length >= batchSize) break;
        }
        observer.disconnect();
        try { if (batch.length) decorate(batch); }
        finally { observe(); }
        if (rootChanged) { rootChanged = false; contextChanged(); }
        if (dirty.size) schedule();
        else if (pinLoad) {
            const pin = pinLoad; pinLoad = null;
            if (canPinLoad() && Object.is(pin.key, loadKey())) root.scrollTop = root.scrollHeight;
        }
    }
    const observer = new MutationObserver(collect);
    observe();
    return {
        refreshAll(callback) {
            if (frame !== null) cancelAnimationFrame(frame);
            frame = null; dirty.clear(); rootChanged = false; pinLoad = null; observer.disconnect();
            try { callback(); } finally { observe(); }
        },
    };
}
