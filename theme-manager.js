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

    function restoreSnapshot(backup) {
        // Only restore native appearance keys. Never reload prompts, connection
        // settings, or register a temporary preset just to apply a snapshot.
        const snapshot = backup.snapshot;
        const allowed = Object.keys(powerUser.getThemeObject('')).filter(key => key !== 'name');
        const values = Object.fromEntries(allowed.filter(key => Object.hasOwn(snapshot, key)).map(key => [key, snapshot[key]]));
        const name = backup.originalName || snapshot.name || '';
        const aliases = { custom_css: 'customCSS', chat_width: 'chat_width_slider', noShadows: 'noShadowsmode',
            hotswap_enabled: 'hotswapEnabled', timer_enabled: 'messageTimerEnabled', timestamps_enabled: 'messageTimestampsEnabled',
            timestamp_model_icon: 'messageModelIconEnabled', mesIDDisplay_enabled: 'mesIDDisplayEnabled', hideChatAvatars_enabled: 'hideChatAvatarsEnabled' };
        const colors = { main_text_color: 'main-text', italics_text_color: 'italics', underline_text_color: 'underline', quote_text_color: 'quote',
            blur_tint_color: 'blur-tint', chat_tint_color: 'chat-tint', user_mes_blur_tint_color: 'user-mes-blur-tint', bot_mes_blur_tint_color: 'bot-mes-blur-tint', shadow_color: 'shadow', border_color: 'border' };
        internalTarget = name;
        observedName = name;
        try {
            Object.assign(context.powerUserSettings, values, { theme: name });
            controls();
            jQuery(themeSelect).val(registered(name) ? name : null);
            for (const [key, value] of Object.entries(values)) {
                const control = jQuery('#' + (aliases[key] || key));
                if (colors[key]) jQuery('#' + colors[key] + '-color-picker').attr('color', value);
                else if (typeof value === 'boolean') control.prop('checked', value);
                else control.val(value);
            }
            powerUser.applyPowerUserSettings();
            // These native handlers apply appearance options not covered by the
            // public appearance refresh, and keep their normal host behavior.
            const events = { waifuMode: 'change', chat_display: 'change', toastr_position: 'change',
                enableZenSliders: 'input', enableLabMode: 'input', reduced_motion: 'input', compact_input_area: 'input',
                bogus_folders: 'input', zoomed_avatar_magnification: 'input' };
            for (const [key, event] of Object.entries(events)) if (Object.hasOwn(values, key)) jQuery('#' + key).trigger(event, { fromInit: true });
            if (typeof values.custom_css === 'string') jQuery('#customCSS').trigger('input');
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
                    let backup = config.themeBackup;
                    if (!backup.snapshot && backup.name) {
                        // Read old saved snapshots without importing or creating
                        // another theme. Existing files remain user-owned.
                        const response = await fetch('/api/settings/get', { method: 'POST', headers: context.getRequestHeaders() });
                        if (!response.ok) throw new Error('无法读取旧版主题恢复数据，请重试停用界面');
                        const data = await response.json();
                        if (interrupted()) return;
                        const snapshot = data.themes?.find(theme => theme.name === backup.name);
                        if (snapshot) config.themeBackup = backup = { version: 2, originalName: backup.originalName, snapshot: { ...snapshot, custom_css: backup.customCSS ?? snapshot.custom_css } };
                    }
                    if (backup.snapshot) restoreSnapshot(backup);
                    else {
                        if (registered(backup.originalName)) select(backup.originalName);
                        if (typeof backup.customCSS === 'string') jQuery('#customCSS').val(backup.customCSS).trigger('input');
                    }
                    config.themeManaged = false;
                    save();
                }
                appliedName = null;
                guardCustomCSS();
                return;
            }
            if (!config.themeManaged) {
                controls();
                if (!themeSelect || !importInput) return;
                const originalName = currentName();
                const snapshot = powerUser.getThemeObject(originalName);
                config.themeBackup = { version: 2, originalName, snapshot: { ...snapshot } };
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
