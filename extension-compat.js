import { extensionNames } from '../../../extensions.js';

const companionName = /(?:^|\/)(?:SillyTavern-)?Theme-Companion(?:$|[-_])/i;
const companionMarkers = '#daynight_settings,#dn_menu_toggle';
const companionControls = '.daynight-settings [data-dn],#dn_menu_toggle,#dn_mode,#dn_start,#dn_end';

// Read public DOM/state only. Upstream controls, handlers, CSS and preferences remain owned by their extensions.
export function setupExtensionCompatibility({ settings, save, appearanceChanged, ui = text => text }) {
    const context = SillyTavern.getContext();
    let available = false;
    let lastMode = '';
    let pending = false;
    const rootMode = () => document.documentElement.classList.contains('dn-day') ? 'light'
        : document.documentElement.classList.contains('dn-night') ? 'dark' : '';
    const repaint = () => {
        if (pending) return;
        pending = true;
        queueMicrotask(() => { pending = false; appearanceChanged(); });
    };

    function refresh() {
        const disabled = context.extensionSettings.disabledExtensions || [];
        const installed = extensionNames.filter(name => companionName.test(name));
        const next = installed.length ? installed.some(name => !disabled.includes(name)) : !!document.querySelector(companionMarkers);
        const changed = available !== next;
        available = next;
        document.body.classList.toggle('cu-theme-companion', next);
        for (const control of document.querySelectorAll('[data-cu-mode="companion"],#cu-extension-mode option[value="companion"]')) {
            control.disabled = !next;
            control.hidden = !next && settings().mode !== 'companion';
            control.title = ui(next ? '跟随主题伴侣的昼夜设置' : '启用主题伴侣后可使用');
        }
        const mode = rootMode();
        const modeChanged = lastMode !== mode;
        lastMode = mode;
        if (settings().enabled && settings().mode === 'companion' && (changed || modeChanged)) repaint();
    }

    const rootObserver = new MutationObserver(refresh);
    rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const markerObserver = new MutationObserver(records => {
        if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
            node.nodeType === 1 && (node.matches(companionMarkers) || node.querySelector(companionMarkers))))) refresh();
    });
    markerObserver.observe(document.body, { childList: true, subtree: true });
    const adoptCompanion = event => {
        if (!available || !settings().enabled || !event.target.closest?.(companionControls)) return;
        if (settings().mode !== 'companion') { settings().mode = 'companion'; save(); }
        repaint();
    };
    document.addEventListener('click', adoptCompanion, true);
    document.addEventListener('change', adoptCompanion, true);
    for (const event of [context.eventTypes.APP_READY, context.eventTypes.SETTINGS_UPDATED].filter(Boolean)) context.eventSource.on(event, refresh);
    return { refresh, get companionAvailable() { return available; } };
}
