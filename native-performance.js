// Manage the host's supported rendering window and streaming refresh limit.
// Complete chat data, token reception, finalization and explicit /chat-render
// requests remain native. Persist original values so reloads retain ownership.
export const NATIVE_MESSAGE_LIMIT = 25;
export const NATIVE_STREAMING_FPS = 10;
const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const preferences = [
    { key: 'chat_truncation', backup: 'nativePerformanceRestore', limit: NATIVE_MESSAGE_LIMIT, applied: [NATIVE_MESSAGE_LIMIT, 50] },
    { key: 'streaming_fps', backup: 'nativeStreamingRestore', limit: NATIVE_STREAMING_FPS, applied: [NATIVE_STREAMING_FPS] },
];
const owned = (record, preference) => record && valid(record.original)
    && preference.applied.includes(record.applied)
    && (record.original === 0 || record.original > record.applied);

export function setupNativePerformance({ settings, powerUser, save, streamingSupported = () => false, document: root = globalThis.document }) {
    function refresh({ userEdit = null } = {}) {
        const config = settings(), native = powerUser();
        if (!native) return;
        const active = config.enabled && config.nativePerformance === true;
        let changed = false;
        for (const preference of preferences) {
            const { key, backup: backupKey, limit } = preference;
            const current = native[key], backup = config[backupKey];
            const stillOwned = owned(backup, preference) && current === backup.applied && userEdit !== key;
            let next = current, nextBackup;
            if (!active || (key === 'streaming_fps' && streamingSupported() !== true)) {
                if (stillOwned) next = backup.original;
            } else {
                // Upgrade a still-owned legacy 50-message cap directly to 25,
                // preserving its original value rather than adopting 50.
                const original = stillOwned ? backup.original : current;
                // Native FPS 0 creates an invalid infinite Stopwatch interval,
                // which the host normalizes to 1ms; it does not disable output.
                if (valid(original) && (original === 0 || original > limit)) {
                    next = limit; nextBackup = { original, applied: limit };
                }
            }
            if (nextBackup) {
                if (!backup || backup.original !== nextBackup.original || backup.applied !== nextBackup.applied) {
                    config[backupKey] = nextBackup; changed = true;
                }
            } else if (backup !== undefined) { delete config[backupKey]; changed = true; }
            if (!Object.is(next, current)) {
                native[key] = next;
                for (const id of [key, `${key}_counter`]) {
                    const input = root?.getElementById(id);
                    if (input) input.value = String(next);
                }
                changed = true;
            }
        }
        if (changed) save();
        return changed;
    }
    const onInput = event => {
        // Native direct input handlers run before this bubbling listener. An
        // explicit choice of the applied limit must replace an older backup,
        // but must not discard ownership of the other managed preference.
        const key = event.target?.id;
        if (preferences.some(preference => preference.key === key)) refresh({ userEdit: key });
    };
    // Native numeric counters commit with jQuery.trigger('input'), which does
    // not dispatch a DOM event. Delegation observes both that and real input,
    // after the host's direct range handler has updated power_user.
    const jquery = globalThis.jQuery;
    const inputSelector = '#chat_truncation,#streaming_fps';
    if (jquery) jquery(root).on('input.cuNativePerformance', inputSelector, onInput);
    else root?.addEventListener('input', onInput);
    return {
        refresh,
        restore() {
            const wasActive = settings().nativePerformance;
            settings().nativePerformance = false;
            if (!refresh() && wasActive) save();
        },
        destroy() {
            if (jquery) jquery(root).off('input.cuNativePerformance', inputSelector, onInput);
            else root?.removeEventListener('input', onInput);
        },
    };
}
