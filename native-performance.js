// Use the host's supported rendering window, leaving its chat data, renderer,
// events and explicit /chat-render requests intact. Keep the backup alongside
// the native preference so a reload cannot lose the user's original value.
export const NATIVE_MESSAGE_LIMIT = 50;
const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const owned = record => record && valid(record.original) && (record.original === 0 || record.original > NATIVE_MESSAGE_LIMIT) && record.applied === NATIVE_MESSAGE_LIMIT;

export function setupNativePerformance({ settings, powerUser, save, document: root = globalThis.document }) {
    function refresh({ userEdit = false } = {}) {
        const config = settings(), native = powerUser();
        if (!native) return;
        const current = native.chat_truncation;
        const backup = config.nativePerformanceRestore;
        const active = config.enabled && config.nativePerformance === true;
        let changed = false, next = current;
        if (!active) {
            if (owned(backup) && current === backup.applied && !userEdit) next = backup.original;
            if (backup !== undefined) { delete config.nativePerformanceRestore; changed = true; }
        } else if (owned(backup) && current === backup.applied && !userEdit) {
            // Already applied, including after loading persisted settings.
        } else {
            if (backup !== undefined) { delete config.nativePerformanceRestore; changed = true; }
            if (valid(current) && (current === 0 || current > NATIVE_MESSAGE_LIMIT)) {
                config.nativePerformanceRestore = { original: current, applied: NATIVE_MESSAGE_LIMIT };
                next = NATIVE_MESSAGE_LIMIT; changed = true;
            }
        }
        if (!Object.is(next, current)) {
            native.chat_truncation = next;
            for (const id of ['chat_truncation', 'chat_truncation_counter']) {
                const input = root?.getElementById(id);
                if (input) input.value = String(next);
            }
            changed = true;
        }
        if (changed) save();
        return changed;
    }
    const onInput = event => {
        // Native direct input handlers run before this bubbling listener. An
        // explicit choice of 50 must replace a previous backup of 100, too.
        if (event.target?.id === 'chat_truncation') refresh({ userEdit: true });
    };
    // Native numeric counters commit with jQuery.trigger('input'), which does
    // not dispatch a DOM event. Delegation observes both that and real input,
    // after the host's direct range handler has updated power_user.
    const jquery = globalThis.jQuery;
    if (jquery) jquery(root).on('input.cuNativePerformance', '#chat_truncation', onInput);
    else root?.addEventListener('input', onInput);
    return {
        refresh,
        restore() {
            const wasActive = settings().nativePerformance;
            settings().nativePerformance = false;
            if (!refresh() && wasActive) save();
        },
        destroy() {
            if (jquery) jquery(root).off('input.cuNativePerformance', '#chat_truncation', onInput);
            else root?.removeEventListener('input', onInput);
        },
    };
}
