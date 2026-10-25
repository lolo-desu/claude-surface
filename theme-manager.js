import * as powerUser from '../../../power-user.js';
import { designForTheme, designOf, appearanceMode } from './designs.js';

const baseNames = ['Claude Surface Base Dark', 'Claude Surface Base Light'];
const ownTheme = name => baseNames.includes(name) || !!designForTheme(name);

// Surface owns its shell and leaves foreign native stylesheets in place.
// Selecting a foreign native preset hands ownership back to that preset.
export function setupManagedTheme({ settings, save, report, appearanceChanged }) {
    const context = SillyTavern.getContext();
    let themeSelect = document.getElementById('themes');
    let importInput = document.getElementById('ui_preset_import_file');
    let appliedName = null;
    let queue = Promise.resolve();
    const currentName = () => context.powerUserSettings.theme;
    let observedName = currentName();
    let internalTarget = null;
    let nativeRevision = 0;
    let nativeIntent = null;
    const controls = () => {
        themeSelect = document.getElementById('themes') || themeSelect;
        importInput = document.getElementById('ui_preset_import_file') || importInput;
    };
    const registered = name => { controls(); return [...(themeSelect?.options || [])].some(option => option.value === name); };

    function guardCustomCSS() {
        const style = document.getElementById('custom-style');
        // Only the empty legacy base sheet needs to be suppressed.
        if (style) style.disabled = settings().enabled && baseNames.includes(currentName());
    }

    async function register(theme) {
        if (registered(theme.name)) return true;
        controls();
        // Tauri can detach the settings tree. Retry when it mounts, keeping
        // any previously captured controls so detached native handlers work.
        if (!importInput || !themeSelect) return false;
        const files = new DataTransfer();
        files.items.add(new File([JSON.stringify(theme)], theme.name + '.json', { type: 'application/json' }));
        importInput.files = files.files;
        internalTarget = theme.name;
        try { await jQuery(importInput).triggerHandler('change'); }
        finally { internalTarget = null; }
        if (!registered(theme.name)) throw new Error('主题未能保存：' + theme.name);
        return true;
    }

    function select(name) {
        controls();
        internalTarget = name;
        try {
            if (registered(name)) jQuery(themeSelect).val(name).trigger('change');
            else if (typeof powerUser.applyGlobalTheme === 'function') powerUser.applyGlobalTheme(name);
            else throw new Error('主题不存在：' + name);
            observedName = currentName();
        } finally { internalTarget = null; }
    }

    async function reconcile() {
        const config = settings();
        const revision = nativeRevision;
        const interrupted = () => {
            if (revision === nativeRevision) return false;
            // Native import can finish after a user picked another preset.
            // Restore that most recent choice before leaving this operation.
            if (nativeIntent && currentName() !== nativeIntent) select(nativeIntent);
            return true;
        };
        try {
            if (!config.enabled) {
                if (config.themeManaged && config.themeBackup) {
                    const restoreName = registered(config.themeBackup.name) ? config.themeBackup.name : config.themeBackup.originalName;
                    if (registered(restoreName)) select(restoreName);
                    if (typeof config.themeBackup.customCSS === 'string') jQuery('#customCSS').val(config.themeBackup.customCSS).trigger('input');
                    config.themeManaged = false;
                    save();
                }
                appliedName = null;
                guardCustomCSS();
                return;
            }
            if (!config.themeManaged) {
                const originalName = currentName();
                const name = 'Claude Surface Backup ' + new Date().toISOString().replace(/[:.]/g, '-');
                const snapshot = powerUser.getThemeObject(name);
                try {
                    if (!await register({ ...snapshot, custom_css: '' }) || interrupted()) return;
                    const response = await fetch('/api/themes/save', {
                        method: 'POST', headers: context.getRequestHeaders(), body: JSON.stringify(snapshot),
                    });
                    if (!response.ok) throw new Error('无法保存原主题快照');
                    if (interrupted()) return;
                } catch (error) {
                    if (interrupted()) return;
                    if (registered(originalName)) select(originalName);
                    jQuery('#customCSS').val(snapshot.custom_css || '').trigger('input');
                    throw error;
                }
                config.themeBackup = { name, originalName, customCSS: snapshot.custom_css || '' };
                config.themeManaged = true;
                save();
            }
            const design = designOf(config.design);
            const name = design.theme || baseNames[appearanceMode(config) === 'light' ? 1 : 0];
            if (!registered(name)) {
                const response = await fetch(new URL('./themes/' + (design.file || name + '.json'), import.meta.url));
                if (interrupted()) return;
                if (!response.ok) throw new Error('无法读取扩展自带主题');
                const theme = await response.json();
                if (interrupted() || !await register(theme) || interrupted()) return;
            }
            if (!config.enabled || designOf(config.design) !== design) return;
            if (appliedName !== name || currentName() !== name) select(name);
            appliedName = name;
            guardCustomCSS();
        } finally { guardCustomCSS(); }
    }

    function sync() { queue = queue.catch(() => {}).then(reconcile); return queue; }

    function nativeChanged() {
        guardCustomCSS();
        const name = currentName();
        if (name === observedName) return;
        observedName = name;
        if (name === internalTarget || name === appliedName) return;
        const config = settings();
        const design = designForTheme(currentName());
        if (design) {
            config.design = design.id;
            config.enabled = true;
            appliedName = currentName();
        } else if (config.enabled && !ownTheme(currentName())) {
            // Re-enabling Surface takes a fresh snapshot of the chosen theme.
            config.themeManaged = false;
            config.enabled = false;
            appliedName = null;
        } else return;
        nativeRevision++;
        nativeIntent = name;
        save();
        appearanceChanged();
    }
    jQuery(document).on('change.claudeSurface', '#themes', nativeChanged);
    const { eventSource, eventTypes } = context;
    for (const type of [eventTypes.SETTINGS_UPDATED, eventTypes.CHAT_CHANGED].filter(Boolean)) eventSource.on(type, nativeChanged);
    new MutationObserver(nativeChanged).observe(document.head, { childList: true, subtree: true });
    new MutationObserver(() => {
        if ((!themeSelect || !importInput) && document.getElementById('themes') && document.getElementById('ui_preset_import_file')) {
            controls(); void sync().catch(report);
        }
    }).observe(document.body, { childList: true, subtree: true });
    return { sync };
}
