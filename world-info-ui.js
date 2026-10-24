/* Mobile-only grouping. Comment anchors restore the exact native desktop tree. */
export function setupMobileWorldInfo(settings) {
    const mobile = matchMedia('(max-width: 899px)');
    const adapted = new Map();
    function refresh() {
        const enabled = settings().enabled && mobile.matches;
        for (const [editor, record] of adapted) {
            if (!editor.isConnected) { adapted.delete(editor); continue; }
            if (enabled) continue;
            for (const { node, anchor } of record.nodes) anchor.replaceWith(node);
            record.details.remove();
            adapted.delete(editor);
        }
        if (!enabled) return;
        document.querySelectorAll('#world_popup_entries_list .world_entry_edit').forEach(editor => {
            if (adapted.has(editor)) return;
            const details = document.createElement('details'); details.className = 'cu-wi-advanced';
            const summary = document.createElement('summary'); summary.textContent = '更多条目设置';
            details.append(summary);
            const candidates = [...editor.children].slice(1);
            const overrides = editor.querySelector('[name="perEntryOverridesBlock"]');
            if (overrides) candidates.unshift(overrides);
            const nodes = candidates.map(node => {
                const anchor = document.createComment('Claude Surface: native field position');
                node.before(anchor); details.append(node);
                return { node, anchor };
            });
            editor.append(details);
            adapted.set(editor, { details, nodes });
        });
    }
    let frame;
    const observer = new MutationObserver(() => {
        cancelAnimationFrame(frame); frame = requestAnimationFrame(refresh);
    });
    observer.observe(document.getElementById('world_popup_entries_list'), { childList: true, subtree: true });
    mobile.addEventListener('change', refresh);
    refresh();
    return { refresh };
}
