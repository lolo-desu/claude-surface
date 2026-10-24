import { getThemeObject } from '../../../power-user.js';

const managedNames = ['Claude Surface Base Dark', 'Claude Surface Base Light'];

// Use SillyTavern's own importer and theme selector so its preset registry,
// form controls, CSS variables and saved settings remain in agreement.
export function setupManagedTheme({ settings, save, report }) {
    const context = SillyTavern.getContext();
    const themeSelect = document.getElementById('themes');
    const importInput = document.getElementById('ui_preset_import_file');
    let applying = false;
    let appliedName = null;
    let queue = Promise.resolve();
    const registered = name => [...themeSelect.options].some(option => option.value === name);
    const currentMode = () => settings().mode === 'system'
        ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : settings().mode;

    function guardCustomCSS() {
        const style = document.getElementById('custom-style');
        if (style) style.disabled = settings().enabled;
    }

    async function register(theme) {
        if (registered(theme.name)) return;
        const files = new DataTransfer();
        files.items.add(new File([JSON.stringify(theme)], `${theme.name}.json`, { type: 'application/json' }));
        importInput.files = files.files;
        // triggerHandler returns the native async import handler's promise.
        await jQuery(importInput).triggerHandler('change');
        if (!registered(theme.name)) throw new Error(`主题未能保存：${theme.name}`);
    }

    function select(name) {
        if (!registered(name)) throw new Error(`主题不存在：${name}`);
        jQuery(themeSelect).val(name).trigger('change');
    }

    async function reconcile() {
        const config = settings();
        applying = true;
        try {
            if (!config.enabled) {
                if (config.themeManaged && config.themeBackup) {
                    const restoreName = registered(config.themeBackup.name) ? config.themeBackup.name : config.themeBackup.originalName;
                    if (registered(restoreName)) select(restoreName);
                    if (typeof config.themeBackup.customCSS === 'string') {
                        jQuery('#customCSS').val(config.themeBackup.customCSS).trigger('input');
                    }
                    config.themeManaged = false;
                    save();
                }
                guardCustomCSS();
                appliedName = null;
                return;
            }
            guardCustomCSS();
            if (!config.themeManaged) {
                const originalName = context.powerUserSettings.theme;
                const name = `Claude Surface Backup ${new Date().toISOString().replace(/[:.]/g, '-')}`;
                const snapshot = getThemeObject(name);
                try {
                    // Register a clean preset, then save the existing CSS as data.
                    // A backup of already-active @import rules must not run through
                    // the native warning for importing new external theme code.
                    await register({ ...snapshot, custom_css: '' });
                    const response = await fetch('/api/themes/save', {
                        method: 'POST', headers: context.getRequestHeaders(), body: JSON.stringify(snapshot),
                    });
                    if (!response.ok) throw new Error('无法保存原主题快照');
                }
                catch (error) {
                    if (registered(originalName)) select(originalName);
                    jQuery('#customCSS').val(snapshot.custom_css || '').trigger('input');
                    throw error;
                }
                config.themeBackup = { name, originalName, customCSS: snapshot.custom_css || '' };
                config.themeManaged = true;
                save();
            }
            const mode = currentMode();
            const name = managedNames[mode === 'light' ? 1 : 0];
            if (!registered(name)) {
                const response = await fetch(new URL(`./themes/${name}.json`, import.meta.url));
                if (!response.ok) throw new Error('无法读取扩展自带主题');
                await register(await response.json());
            }
            // A toggle or system color change may happen while saving a theme.
            if (!config.enabled || currentMode() !== mode) return;
            if (appliedName !== name || themeSelect.value !== name || context.powerUserSettings.theme !== name || context.powerUserSettings.custom_css) {
                select(name);
                appliedName = name;
            }
            guardCustomCSS();
        } finally {
            applying = false;
        }
    }

    function sync() {
        queue = queue.catch(() => {}).then(reconcile);
        return queue;
    }
    themeSelect.addEventListener('change', () => {
        if (!applying && settings().enabled) void sync().catch(report);
    });
    // Native custom CSS may replace its text node or recreate the style element.
    new MutationObserver(guardCustomCSS).observe(document.head, { childList: true, subtree: true });
    return { sync };
}
