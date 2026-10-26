import { closeCurrentChat, setActiveCharacter, setActiveGroup } from '../../../../script.js';
import { openGroupById } from '../../../group-chats.js';
import { brandMarks } from './brand-marks.js';
import { setupNativeUI } from './native-ui.js';
import { setupManagedTheme } from './theme-manager.js';
import { designs, designOf, appearanceMode } from './designs.js';
import { designBrand } from './design-branding.js';
import { paletteOptions, selectedPalette } from './palettes.js';
import { setupExtensionCompatibility } from './extension-compat.js';
import { visualEffectControls, visualEffectsOf, applyVisualEffects } from './visual-effects.js';
import { openWorldInfoEditor } from '../../../world-info.js';

const KEY = 'claude_surface';
const ctx = () => SillyTavern.getContext();
const media = matchMedia('(prefers-color-scheme: dark)');
const desktop = matchMedia('(min-width: 900px)');
const mediaReduced = matchMedia('(prefers-reduced-motion: reduce)');
const defaults = { enabled: true, mode: 'dark', serif: true, background: false, nativeToolbar: false, quickRepliesCollapsed: false, compactComposer: false, headerMode: 'always', sidebarPinned: false, useNativeHome: false, messageStyle: 'minimal', brandName: 'Claude', brandIcon: 'claude', customBrandIcon: '', recentCharacters: [] };
const state = { initialized: false, recents: [], sheet: null, returnFocus: null, refreshing: false };
const icons = {
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M5.8 8v8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5"/>',
    book: '<path d="M4 4h14a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2V4Zm0 12h16M8 4v8"/>',
    puzzle: '<path d="M4 9V4h5a3 3 0 1 1 6 0h5v5a3 3 0 1 0 0 6v5h-5a3 3 0 1 0-6 0H4v-5a3 3 0 1 0 0-6Z"/>',
    sliders: '<path d="M4 6h4m4 0h8M4 12h10m4 0h2M4 18h2m4 0h10"/><circle cx="10" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    moon: '<path d="M20 14a8 8 0 0 1-10-10 8.5 8.5 0 1 0 10 10Z"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>',
    reset: '<path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/>',
    arrow: '<path d="m7 17 10-10M7 7h10v10"/>',
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1Z"/>',
    plug: '<path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4"/>',
    type: '<path d="M4 5h16M12 5v15M8 20h8"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
    user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-4L4 15Z"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    unlock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 7-2M12 14v3"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H5a2 2 0 0 0-2 2v10a1 1 0 0 0 1 1h4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    collapse: '<path d="m7 4 5 5 5-5M7 20l5-5 5 5M4 12h16"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.sliders}</svg>`;
const star = '<svg class="cu-star" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><path d="M16 2v28M2 16h28M6 6l20 20M6 26 26 6M10 3l12 26M3 10l26 12M3 22l26-12M10 29 22 3"/></svg>';

function brandElement() {
    const mark = document.createElement('span');
    mark.className = 'cu-brand-mark'; mark.setAttribute('aria-hidden', 'true');
    return mark;
}

function applyBranding() {
    const config = settings();
    const fixed = designBrand(config);
    const kind = ['claude','chatgpt','gemini','deepseek','custom'].includes(config.brandIcon) ? config.brandIcon : 'claude';
    const custom = /^data:image\/(?:png|jpeg|webp|gif);base64,/.test(config.customBrandIcon) ? config.customBrandIcon : '';
    document.querySelectorAll('.cu-brand-name').forEach(name => { name.textContent = fixed?.name || config.brandName.trim().slice(0,40) || 'Claude'; });
    document.querySelectorAll('.cu-home-action').forEach(control => {
        const label = (control.dataset.cuHomePrefix || '') + (fixed ? 'SillyTavern 首页' : 'Claude 首页');
        control.title = label; control.setAttribute('aria-label', label);
        const text = control.querySelector(':scope > span'); if (text) text.textContent = label;
    });
    document.querySelectorAll('[data-cu-brand-custom]').forEach(control => { control.hidden = !!fixed || (control.classList.contains('cu-brand-upload') && kind !== 'custom'); });
    document.querySelectorAll('[data-cu-brand-fixed]').forEach(control => { control.hidden = !fixed; });
    document.querySelectorAll('.cu-disable-action').forEach(control => { const label = fixed ? '停用界面' : '停用 Claude Surface'; control.title = label; control.setAttribute('aria-label',label); control.querySelector('span').textContent = label; });
    const clear = document.getElementById('cu-clear-brand-icon');
    if (clear) clear.disabled = !custom;
    document.querySelectorAll('.cu-brand-mark').forEach(mark => {
        if (fixed) {
            if (mark.dataset.brand !== fixed.key) { mark.dataset.brand = fixed.key; mark.innerHTML = fixed.mark; }
            return;
        }
        if (mark.dataset.brand === kind && (kind !== 'custom' || mark.querySelector('img')?.getAttribute('src') === custom)) return;
        mark.dataset.brand = kind;
        if (kind === 'custom' && custom) {
            const image = document.createElement('img'); image.src = custom; image.alt = ''; mark.replaceChildren(image);
        } else mark.innerHTML = brandMarks[kind] || star;
    });
}

async function storeBrandImage(file) {
    if (!file || !file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) throw new Error('请选择小于 20 MB 的图片。');
    const url = URL.createObjectURL(file);
    try {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
        const scale = Math.min(128 / image.naturalWidth, 128 / image.naturalHeight);
        const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
        canvas.getContext('2d').drawImage(image, (128-width)/2, (128-height)/2, width, height);
        settings().customBrandIcon = canvas.toDataURL('image/png'); save(); applyBranding();
    } finally { URL.revokeObjectURL(url); }
}

function settings() {
    const ext = ctx().extensionSettings;
    ext[KEY] ??= { ...defaults };
    ext[KEY].design ??= 'claude';
    if (!ext[KEY].designPalettes || typeof ext[KEY].designPalettes !== 'object' || Array.isArray(ext[KEY].designPalettes)) ext[KEY].designPalettes = {};
    ext[KEY].headerMode ??= ext[KEY].scrollHeader ? 'scroll' : 'always';
    for (const [key, value] of Object.entries(defaults)) ext[KEY][key] ??= value;
    return ext[KEY];
}

function save() { ctx().saveSettingsDebounced(); }

function refreshEffectControls(config = settings()) {
    const values = visualEffectsOf(config);
    for (const control of visualEffectControls) {
        const input = document.getElementById('cu-effect-' + control.key);
        if (!input) continue;
        input.value = values[control.key];
        input.disabled = !!control.backgroundOnly && !config.background;
        input.style.setProperty('--cu-range-fill', (values[control.key] - control.min) / (control.max - control.min) * 100 + '%');
        document.getElementById(input.id + '-value').value = values[control.key] + control.unit;
    }
}

function refreshPaletteControls(config = settings()) {
    const family = designOf(config.design).id;
    const selected = selectedPalette(config);
    for (const host of document.querySelectorAll('.cu-palette-options')) {
        if (host.dataset.design !== family) {
            host.dataset.design = family; host.replaceChildren();
            for (const option of paletteOptions(family)) {
                const control = document.createElement('button'); control.type = 'button'; control.className = 'cu-palette-chip'; control.dataset.palette = option.id;
                const swatch = document.createElement('i'); swatch.style.setProperty('--cu-swatch', option.swatch); swatch.setAttribute('aria-hidden','true');
                const label = document.createElement('span'); label.textContent = option.label; control.append(swatch,label);
                control.addEventListener('click', () => { settings().designPalettes[family] = option.id; save(); applyAppearance(); });
                host.append(control);
            }
        }
        host.querySelectorAll('button').forEach(control => control.setAttribute('aria-pressed',String(control.dataset.palette === selected.id)));
    }
}

function homeAction({ prefix = '', force = false, className = '' } = {}) {
    const label = prefix + (designBrand(settings()) ? 'SillyTavern 首页' : 'Claude 首页');
    const control = button(label, 'home', () => goHome(force), className + ' cu-home-action');
    control.dataset.cuHomePrefix = prefix; return control;
}

function button(label, icon, action, className = '') {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `cu-button ${className}`;
    el.title = label;
    el.setAttribute('aria-label', label);
    el.innerHTML = svg(icon);
    if (!className.includes('cu-icon')) {
        const text = document.createElement('span');
        text.textContent = label;
        el.append(text);
    }
    el.addEventListener('click', () => { state.invoker = el; Promise.resolve().then(action).catch(report); });
    return el;
}

function report(error) {
    console.error('[Claude Surface]', error);
    toastr.error('操作未完成，请通过原生工具栏重试。', designBrand(settings()) ? 'SillyTavern' : 'Claude Surface');
}

const editable = element => element?.matches('input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]),textarea,[contenteditable="true"],[role="textbox"]');
function quietNavigation() {
    revealHeader();
    state.navigationInputIntent = false;
    state.navigationFocusUntil = performance.now() + 900;
    if (editable(document.activeElement)) document.activeElement.blur();
}

function applyAppearance() {
    const config = settings();
    applyBranding();
    const mode = appearanceMode(config);
    if (config.enabled) document.body.dataset.cuDesign = designOf(config.design).id;
    else delete document.body.dataset.cuDesign;
    if (config.enabled) document.body.dataset.cuPalette = selectedPalette(config).id;
    else delete document.body.dataset.cuPalette;
    refreshPaletteControls(config);
    if (config.enabled) document.body.dataset.claudeUi = mode;
    else delete document.body.dataset.claudeUi;
    document.body.classList.toggle('cu-shell-ready', config.enabled);
    document.body.classList.toggle('cu-background-enabled', config.enabled && config.background);
    applyVisualEffects(document.body, config);
    refreshEffectControls(config);
    document.body.classList.toggle('cu-qr-collapsed', config.enabled && config.quickRepliesCollapsed);
    document.body.classList.toggle('cu-compact-composer', config.enabled && config.compactComposer);
    if (config.enabled) document.body.dataset.cuMessageStyle = ['minimal','avatar','banner'].includes(config.messageStyle) ? config.messageStyle : 'minimal';
    else delete document.body.dataset.cuMessageStyle;
    const appearance = getComputedStyle(document.body);
    const colors = Object.fromEntries(['bg','text','accent'].map(key => {
        let value = appearance.getPropertyValue('--cu-' + key).trim();
        if (/^#[a-f0-9]{3,4}$/i.test(value)) value = '#' + [...value.slice(1)].map(char => char + char).join('');
        return [key,value];
    }));
    try { localStorage.setItem('claude-surface-boot', JSON.stringify({ enabled: config.enabled, mode: config.mode, resolvedMode: mode, design: designOf(config.design).id, colors })); } catch { /* Storage can be unavailable in private contexts. */ }
    document.documentElement.toggleAttribute('data-cu-boot', config.enabled);
    document.documentElement.dataset.cuBootMode = mode;
    document.documentElement.dataset.cuBootDesign = designOf(config.design).id;
    document.documentElement.style.removeProperty('--cu-boot-mark'); // Family selectors own the mark after startup.
    for (const [key,value] of Object.entries(colors)) document.documentElement.style.setProperty('--cu-boot-' + key,value);
    document.querySelectorAll('.cu-header,.cu-sidebar,.cu-composer-meta').forEach(el => { el.hidden = !config.enabled; });
    document.querySelector('.cu-return-home').hidden = !config.enabled || !settings().useNativeHome || !state.isHome;
    document.querySelector('.cu-home-content').hidden = !config.enabled || !document.body.classList.contains('cu-home');
    if (!config.enabled) {
        closeSheet();
        setSidebar(false);
        document.body.classList.remove('cu-native-open', 'cu-home');
        document.querySelector('.cu-home-greeting').hidden = true;
        decorateMessages(false);
    }
    document.body.style.setProperty('--cu-serif', config.serif ? 'Georgia, "Times New Roman", var(--cu-sans)' : 'var(--cu-sans)');
    document.querySelectorAll('[data-cu-mode]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.cuMode === config.mode)));
    const enabledInput = document.querySelector('#cu-extension-enabled');
    if (enabledInput) enabledInput.checked = config.enabled;
    const modeInput = document.querySelector('#cu-extension-mode');
    if (modeInput) modeInput.value = config.mode;
    document.querySelectorAll('[data-cu-design-choice]').forEach(control => control.setAttribute('aria-pressed', String(control.dataset.cuDesignChoice === designOf(config.design).id)));
    const designInput = document.getElementById('cu-extension-design');
    if (designInput) designInput.value = designOf(config.design).id;
    document.querySelectorAll('[data-cu-serif],#cu-extension-serif').forEach(control => {
        control.disabled = designOf(config.design).id !== 'claude';
        control.title = control.disabled ? '此偏好用于 Claude 风格，切回后继续生效。' : '';
    });
    for (const [id, key] of [['cu-extension-serif','serif'],['cu-extension-toolbar','nativeToolbar'],['cu-extension-compact','compactComposer']]) {
        const control = document.getElementById(id);
        if (control) control.checked = config[key];
    }
    const headerModeInput = document.getElementById('cu-extension-header-mode');
    if (headerModeInput) headerModeInput.value = headerMode();
    syncHeaderVisibility();
    state.nativeUI?.refresh();
    state.compatUI?.refresh();
    void state.themeUI?.sync().catch(report);
    if (config.enabled) { decorateMessages(); updateContext(); }
    syncNativePanels();
    setSidebar(false);
}

function setNativeToolbar(visible) {
    settings().nativeToolbar = visible;
    save();
    applyAppearance();
}

function syncDesktopDocks() {
    state.dockPins ??= new Map();
    const docked = settings().enabled && desktop.matches;
    for (const id of ['left-nav-panel','right-nav-panel']) {
        const panel = document.getElementById(id);
        const icon = panel?.parentElement.querySelector('.drawer-icon');
        if (!panel || !icon) continue;
        if (docked && !state.dockPins.has(panel)) state.dockPins.set(panel, { pinned: panel.classList.contains('pinnedOpen'), iconPinned: icon.classList.contains('drawerPinnedOpen') });
        const original = state.dockPins.get(panel);
        if (docked) {
            if (!panel.classList.contains('pinnedOpen')) panel.classList.add('pinnedOpen');
            if (!icon.classList.contains('drawerPinnedOpen')) icon.classList.add('drawerPinnedOpen');
        }
        else if (original) {
            panel.classList.toggle('pinnedOpen', original.pinned);
            icon.classList.toggle('drawerPinnedOpen', original.iconPinned);
            state.dockPins.delete(panel);
        }
    }
}

function setHeaderHidden(hidden) {
    if (document.body.classList.contains('cu-header-hidden') === hidden) return;
    const chat = document.getElementById('chat');
    const before = chat?.getBoundingClientRect().top;
    const scroll = chat?.scrollTop;
    document.body.classList.toggle('cu-header-hidden', hidden);
    // Keep the current line still when the toolbar changes the scroll viewport.
    if (chat && before != null) chat.scrollTop = scroll + chat.getBoundingClientRect().top - before;
    state.lastHeaderScroll = chat?.scrollTop;
    state.headerTravel = 0;
}

const headerModes = [['always','完全显示'],['scroll','滑动隐藏'],['tap','点击显示'],['hidden','完全隐藏']];
function headerMode() { return headerModes.some(([mode]) => mode === settings().headerMode) ? settings().headerMode : 'always'; }
function nativePanelOpen() { return !!document.querySelector('#top-settings-holder > .drawer > .drawer-content.openDrawer'); }

function syncHeaderVisibility() {
    const config = settings(), mode = headerMode();
    const nativeOpen = nativePanelOpen();
    const sidebarOpen = !desktop.matches && document.body.classList.contains('cu-sidebar-open');
    const temporary = !!state.sheet || nativeOpen || sidebarOpen;
    const hidden = config.enabled && !temporary && (mode === 'hidden' || (mode === 'tap' && !state.headerTappedOpen) || (mode === 'scroll' && !!state.headerScrollHidden));
    // This is the only writer of visibility; opening a page never changes prefs.
    document.body.classList.toggle('cu-native-open', config.enabled && (config.nativeToolbar || (mode === 'hidden' && nativeOpen)));
    if (config.enabled) document.body.dataset.cuHeaderMode = mode;
    else delete document.body.dataset.cuHeaderMode;
    setHeaderHidden(hidden);
    const header = document.querySelector('.cu-header');
    const nativeBar = document.getElementById('top-settings-holder');
    if (header) header.inert = hidden || sidebarOpen;
    if (nativeBar) nativeBar.inert = (hidden && !nativeOpen) || sidebarOpen;
    const trigger = document.getElementById('cu-header-reveal');
    if (trigger) {
        trigger.hidden = !config.enabled || mode !== 'tap' || !hidden;
        trigger.setAttribute('aria-expanded', String(!hidden));
    }
}

function setHeaderMode(mode) {
    if (!headerModes.some(([value]) => mode === value)) return;
    settings().headerMode = mode;
    settings().scrollHeader = mode === 'scroll'; // Preserve downgrade compatibility.
    state.headerScrollHidden = false; state.headerTappedOpen = false;
    state.headerTravel = 0; state.headerScrollIntentUntil = 0;
    save(); applyAppearance();
}

function revealHeader() {
    if (headerMode() === 'scroll') state.headerScrollHidden = false;
    syncHeaderVisibility();
}

function setupHeaderScroll() {
    const chatRoot = document.getElementById('chat');
    state.lastHeaderScroll = chatRoot?.scrollTop || 0;
    for (const type of ['wheel','touchstart','touchmove','pointerdown']) chatRoot?.addEventListener(type, () => { state.headerScrollIntentUntil = performance.now() + 1500; }, { passive: true });
    chatRoot?.addEventListener('wheel', event => { if (headerMode() === 'scroll' && event.deltaY < 0) revealHeader(); }, { passive: true });
    let touchY;
    chatRoot?.addEventListener('touchstart', event => { touchY = event.touches[0]?.clientY; }, { passive: true });
    chatRoot?.addEventListener('touchmove', event => {
        const y = event.touches[0]?.clientY;
        if (headerMode() === 'scroll' && touchY != null && y - touchY > 10) revealHeader();
        touchY = y;
    }, { passive: true });
    document.addEventListener('keydown', event => {
        if (!editable(event.target) && ['PageDown','PageUp','ArrowDown','ArrowUp','Home','End',' '].includes(event.key)) state.headerScrollIntentUntil = performance.now() + 1500;
    });
    document.addEventListener('scroll', event => {
        if (event.target?.id !== 'chat') return;
        const chat = event.target;
        const previous = state.lastHeaderScroll ?? chat.scrollTop;
        state.lastHeaderScroll = chat.scrollTop;
        if (!settings().enabled || headerMode() !== 'scroll' || performance.now() > (state.headerScrollIntentUntil || 0) || state.sheet || state.dropdownOpen || (!desktop.matches && document.body.classList.contains('cu-sidebar-open')) || editable(document.activeElement)) return;
        const delta = chat.scrollTop - previous;
        if (!delta) return;
        state.headerTravel = Math.sign(delta) === Math.sign(state.headerTravel || delta) ? (state.headerTravel || 0) + delta : delta;
        if (chat.scrollTop <= 2 || state.headerTravel < -18) revealHeader();
        else if (state.headerTravel > 24 && chat.scrollTop > 48) { state.headerScrollHidden = true; syncHeaderVisibility(); }
    }, { capture: true, passive: true });
    document.addEventListener('focusin', event => { if (headerMode() === 'scroll' && event.target.closest?.('.cu-header,#send_textarea')) revealHeader(); });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Tab' || !settings().enabled) return;
        if (headerMode() === 'tap') state.headerTappedOpen = true;
        revealHeader();
    });
    document.addEventListener('pointerdown', event => {
        if (!settings().enabled || headerMode() !== 'tap' || !state.headerTappedOpen || state.sheet || nativePanelOpen()) return;
        if (event.target.closest('.cu-header,#cu-header-reveal,#top-settings-holder,.cu-sidebar')) return;
        state.headerTappedOpen = false; syncHeaderVisibility();
    }, { passive: true });
}

function syncNativePanels() {
    syncDesktopDocks();
    const panels = [...document.querySelectorAll('#top-settings-holder > .drawer > .drawer-content.openDrawer')];
    const opened = settings().enabled && panels.length > 0;
    const pages = desktop.matches ? panels.filter(panel => !['left-nav-panel','right-nav-panel'].includes(panel.id)) : panels;
    state.dropdownOpen = pages.length > 0;
    syncHeaderVisibility();
    document.body.classList.toggle('cu-left-dock-open', settings().enabled && desktop.matches && panels.some(panel => panel.id === 'left-nav-panel'));
    document.body.classList.toggle('cu-right-dock-open', settings().enabled && desktop.matches && panels.some(panel => panel.id === 'right-nav-panel'));
    document.body.classList.toggle('cu-panel-open', opened);
    const close = document.getElementById('cu-native-close');
    if (close) close.hidden = !opened;
    const title = document.querySelector('.cu-title');
    const headerAvatar = document.querySelector('.cu-header-avatar');
    if (headerAvatar) headerAvatar.hidden = !state.headerEntity || pages.length > 0;
    const panelTitles = { 'left-nav-panel': '预设', WorldInfo: '世界书', 'right-nav-panel': '角色卡' };
    if (title) title.textContent = pages.length
        ? (panelTitles[pages.at(-1).id] || pages.at(-1).parentElement.querySelector('.drawer-icon')?.title || '更多')
        : (state.chatTitle || '新建对话');
}

function closeNativePanels({ keepDocks = false } = {}) {
    const promptEditor = document.getElementById('completion_prompt_manager_popup');
    if (promptEditor?.classList.contains('openDrawer')) promptEditor.querySelector('#completion_prompt_manager_popup_entry_form_close')?.click();
    document.querySelectorAll('#top-settings-holder > .drawer > .drawer-toggle').forEach(toggle => {
        if (keepDocks && ['left-nav-panel','right-nav-panel'].includes(toggle.parentElement.querySelector('.drawer-content')?.id)) return;
        if (toggle.querySelector('.openIcon')) toggle.click();
    });
    syncNativePanels();
}

function openNative(toggle) {
    revealHeader();
    quietNavigation();
    closeSheet();
    setSidebar(false);
    if (!toggle.querySelector('.openIcon')) toggle.click();
    syncNativePanels();
}

function decorateMessages(enabled = settings().enabled) {
    document.querySelectorAll('#chat > .mes').forEach(message => {
        const avatar = message.querySelector('.mesAvatarWrapper');
        const block = message.querySelector('.mes_block');
        const footer = block?.querySelector(':scope > .ch_name');
        if (!avatar || !footer) return;
        const hero = enabled && settings().messageStyle !== 'minimal' && ['avatar','banner'].includes(settings().messageStyle)
            && message.getAttribute('is_user') !== 'true' && message.getAttribute('is_system') !== 'true';
        avatar.classList.toggle('cu-message-hero', hero);
        if (hero) {
            if (avatar.parentElement !== message || avatar.nextElementSibling !== block) message.insertBefore(avatar, block);
        } else if (enabled && message.getAttribute('is_user') === 'true') {
            const metadata = footer.querySelector(':scope > .flex-container.flex1') || footer;
            if (avatar.parentElement !== metadata) metadata.prepend(avatar);
        } else if (enabled && avatar.parentElement !== footer) footer.prepend(avatar);
        else if (!enabled) {
            const before = message.querySelector(':scope > .swipe_left') || block;
            if (avatar.parentElement !== message || avatar.nextElementSibling !== before) message.insertBefore(avatar, before);
        }
        // Use the character cover at full resolution for banners, keeping the
        // existing avatar element and its native click behavior. Restore on exit.
        const image = avatar.querySelector('.avatar img');
        if (image) {
            const current = image.getAttribute('src');
            if (image.dataset.cuCover && current !== image.dataset.cuCover) {
                delete image.dataset.cuOriginalAvatar; delete image.dataset.cuCover;
            }
            if (hero && settings().messageStyle === 'banner' && !image.dataset.cuCover) {
                try {
                    const url = new URL(current, location.href);
                    const file = url.searchParams.get('file');
                    if (url.origin === location.origin && url.pathname === '/thumbnail' && url.searchParams.get('type') === 'avatar' && file) {
                        const cover = `/characters/${encodeURIComponent(file)}`;
                        image.dataset.cuOriginalAvatar = current;
                        image.dataset.cuCover = cover;
                        image.setAttribute('src', cover);
                    }
                } catch { /* Custom avatars keep their original URL. */ }
            } else if ((!hero || settings().messageStyle !== 'banner') && image.dataset.cuCover) {
                image.setAttribute('src', image.dataset.cuOriginalAvatar);
                delete image.dataset.cuOriginalAvatar; delete image.dataset.cuCover;
            }
        }
        for (const [name, icon] of [['copy','copy'],['edit','edit'],['close_all','collapse'],['edit_done','check'],['edit_cancel','close'],['delete','trash']]) {
            const control = message.querySelector(`.mes_reasoning_${name}`);
            if (control && !control.classList.contains('cu-reasoning-icon')) {
                control.classList.add('cu-reasoning-icon'); control.innerHTML = svg(icon);
            }
        }
    });
    const anchor = state.editorAnchor;
    if (anchor?.text.isConnected) {
        const chat = document.getElementById('chat');
        chat.scrollTop += anchor.text.getBoundingClientRect().top - anchor.top;
        state.editorAnchor = null;
    }
}

function captureEditorAnchor(event) {
    if (!settings().enabled) return;
    const control = event.target.closest?.('.mes_edit,.mes_edit_done,.mes_edit_cancel');
    const text = control?.closest('.mes')?.querySelector('.mes_text');
    if (!text) return;
    state.editorAnchor = { text, top: text.getBoundingClientRect().top };
    if (control.classList.contains('mes_edit')) {
        const style = getComputedStyle(text);
        const height = text.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
        text.style.setProperty('--cu-edit-min-height', `${Math.max(height, parseFloat(style.lineHeight) || 22)}px`);
    }
}

function setSidebar(open) {
    if (desktop.matches) open = settings().enabled && settings().sidebarPinned;
    if (open) revealHeader();
    if (open) quietNavigation();
    document.body.classList.toggle('cu-sidebar-open', open);
    const nav = document.querySelector('.cu-sidebar');
    if (nav) { nav.inert = !open; nav.setAttribute('aria-hidden', String(!open)); }
    for (const region of document.querySelectorAll('#sheld,.cu-header,#top-settings-holder')) region.inert = open && !desktop.matches;
    const backdrop = document.querySelector('.cu-backdrop');
    if (backdrop) backdrop.hidden = true;
    const opener = document.querySelector('#cu-sidebar-toggle');
    opener?.setAttribute('aria-expanded', String(open));
    const label = desktop.matches ? (open ? '取消侧边栏常驻' : '固定侧边栏') : '打开侧边栏';
    opener?.setAttribute('aria-label', label);
    if (opener) opener.title = label;
    if (desktop.matches) opener?.setAttribute('aria-pressed', String(open));
    else opener?.removeAttribute('aria-pressed');
    syncHeaderVisibility();
    if (open) document.querySelector('.cu-sidebar-top button')?.focus({ preventScroll: true });
}

function closeSheet(immediate = false) {
    if (!state.sheet) return;
    const previous = state.sheet;
    previous.dispatchEvent(new Event('cu-sheet-remove'));
    if (immediate === true || mediaReduced.matches) previous.remove();
    else {
        previous.classList.add('cu-sheet-closing');
        previous.inert = true;
        previous.addEventListener('animationend', () => previous.remove(), { once: true });
        setTimeout(() => previous.remove(), 220);
    }
    state.sheet = null;
    syncHeaderVisibility();
    if (!editable(state.returnFocus)) state.returnFocus?.focus({ preventScroll: true });
}

function sheet(title, { anchor, closeButton = true } = {}) {
    revealHeader();
    quietNavigation();
    closeSheet(true);
    state.returnFocus = document.activeElement;
    const root = document.createElement('div');
    root.className = 'cu-sheet';
    root.setAttribute('role', 'presentation');
    const panel = document.createElement('section');
    panel.className = 'cu-sheet-panel';
    panel.tabIndex = -1;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', title);
    const handle = button('下拉关闭面板', 'chevron', closeSheet, 'cu-sheet-handle');
    let drag;
    handle.addEventListener('pointerdown', event => {
        drag = { y: event.clientY, distance: 0 };
        handle.setPointerCapture(event.pointerId);
        panel.classList.add('cu-dragging');
    });
    handle.addEventListener('pointermove', event => {
        if (!drag) return;
        drag.distance = Math.max(0, event.clientY - drag.y);
        panel.style.transform = `translateY(${drag.distance}px)`;
    });
    const finishDrag = () => {
        if (!drag) return;
        const dismiss = drag.distance > 70;
        drag = null;
        panel.classList.remove('cu-dragging');
        panel.style.transform = '';
        if (dismiss) closeSheet();
    };
    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', () => { drag = null; panel.style.transform = ''; panel.classList.remove('cu-dragging'); });
    const heading = document.createElement('div');
    heading.className = 'cu-sheet-heading';
    const label = document.createElement('span');
    label.textContent = title;
    heading.append(label);
    if (closeButton) heading.append(button('关闭', 'close', closeSheet, 'cu-icon'));
    const content = document.createElement('div');
    content.className = 'cu-sheet-body';
    panel.append(handle, heading, content);
    root.append(panel);
    if (anchor && desktop.matches) {
        root.classList.add('cu-sheet-anchored');
        const positionPanel = () => {
            if (!anchor.isConnected) return;
            const rect = anchor.getBoundingClientRect();
            const fromBottom = rect.top > window.innerHeight / 2;
            root.classList.toggle('cu-sheet-from-bottom', fromBottom);
            const preferredLeft = rect.left < window.innerWidth / 2 ? rect.left : rect.right - 420;
            panel.style.left = `${Math.max(16, Math.min(preferredLeft, window.innerWidth - 436))}px`;
            panel.style.top = fromBottom ? 'auto' : `${Math.min(rect.bottom + 10, window.innerHeight - 120)}px`;
            panel.style.bottom = fromBottom ? `${Math.max(16, window.innerHeight - rect.top + 10)}px` : 'auto';
            panel.style.maxHeight = `${Math.max(120, fromBottom ? rect.top - 26 : window.innerHeight - rect.bottom - 26)}px`;
        };
        positionPanel();
        window.addEventListener('resize', positionPanel);
        root.addEventListener('cu-sheet-remove', () => window.removeEventListener('resize', positionPanel), { once: true });
    }
    root.addEventListener('click', event => { if (event.target === root) closeSheet(); });
    root.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); closeSheet(); }
        if (event.key === 'Tab') {
            const focusable = [...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
            const first = focusable[0], last = focusable.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus({ preventScroll: true }); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus({ preventScroll: true }); }
        }
    });
    document.body.append(root);
    state.sheet = root;
    syncHeaderVisibility();
    (heading.querySelector('button') || panel).focus({ preventScroll: true });
    return content;
}

function nativeTarget(selector) {
    const target = document.querySelector(selector);
    if (!target) throw new Error(`Missing native control: ${selector}`);
    const toggle = target.closest('.drawer-toggle') || target;
    openNative(toggle);
}

function showTools() {
    const content = sheet('更多', { anchor: state.invoker });
    const grid = document.createElement('div');
    grid.className = 'cu-tool-grid';
    const names = ['预设', 'API 连接', '回复格式', '世界书', '用户设置', '背景', '扩展程序', '用户设定', '角色卡'];
    const glyphs = ['sliders','plug','type','book','sliders','image','puzzle','user','people'];
    document.querySelectorAll('#top-settings-holder > .drawer > .drawer-toggle').forEach((toggle, index) => {
        const original = toggle.querySelector('.drawer-icon');
        const title = names[index] || original?.title || `工具 ${index + 1}`;
        const item = button(title, glyphs[index], () => index === 8 ? showCharacters() : openNative(toggle));
        grid.append(item);
    });
    const footer = document.createElement('div'); footer.className = 'cu-tools-footer';
    footer.append(button('主题设置', 'sun', showAppearance));
    content.append(grid, footer);
}

function showAppearance() {
    const content = sheet('主题设置', { closeButton: false });
    content.classList.add('cu-appearance-settings');
    const row = document.createElement('div');
    row.className = 'cu-settings-row';
    const label = document.createElement('span');
    label.textContent = '主题';
    const segment = document.createElement('div');
    segment.className = 'cu-segment';
    for (const [value, title] of [['system','系统'],['light','浅色'],['dark','深色'],['companion','伴侣']]) {
        const item = button(title, value === 'dark' ? 'moon' : 'sun', () => { settings().mode = value; save(); applyAppearance(); });
        item.dataset.cuMode = value;
        item.setAttribute('aria-pressed', String(settings().mode === value));
        segment.append(item);
    }
    row.append(label, segment);
    const paletteRow = document.createElement('div'); paletteRow.className = 'cu-settings-row cu-palette-row';
    const paletteLabel = document.createElement('span'); paletteLabel.textContent = '主题色';
    const paletteChoices = document.createElement('div'); paletteChoices.className = 'cu-palette-options'; paletteChoices.setAttribute('role','group'); paletteChoices.setAttribute('aria-label','主题色');
    paletteRow.append(paletteLabel,paletteChoices);
    const designGrid = document.createElement('div'); designGrid.className = 'cu-design-grid';
    designGrid.setAttribute('role', 'group'); designGrid.setAttribute('aria-label', '设计风格');
    for (const design of designs) {
        const card = document.createElement('button'); card.type = 'button'; card.className = 'cu-design-card';
        card.dataset.cuDesignChoice = design.id;
        card.setAttribute('aria-pressed', String(designOf(settings().design).id === design.id));
        const preview = document.createElement('span'); preview.className = 'cu-design-preview'; preview.setAttribute('aria-hidden', 'true');
        preview.innerHTML = '<i></i><i></i><i></i>';
        const title = document.createElement('strong'); title.textContent = design.label;
        card.append(preview, title);
        card.addEventListener('click', () => { settings().design = design.id; save(); applyAppearance(); });
        designGrid.append(card);
    }
    const fontRow = document.createElement('label');
    fontRow.className = 'cu-settings-row';
    const fontLabel = document.createElement('span');
    fontLabel.textContent = '英文回复使用衬线字体';
    const check = document.createElement('input');
    check.type = 'checkbox'; check.setAttribute('role', 'switch');
    check.checked = settings().serif;
    check.dataset.cuSerif = '';
    check.disabled = designOf(settings().design).id !== 'claude';
    check.title = check.disabled ? '此偏好用于 Claude 风格，切回后继续生效。' : '';
    check.addEventListener('change', () => { settings().serif = check.checked; save(); applyAppearance(); });
    fontRow.append(fontLabel, check);
    const toolbarRow = document.createElement('label');
    toolbarRow.className = 'cu-settings-row';
    const toolbarLabel = document.createElement('span');
    toolbarLabel.textContent = '显示原生菜单栏';
    const toolbarCheck = document.createElement('input');
    toolbarCheck.type = 'checkbox'; toolbarCheck.setAttribute('role', 'switch');
    toolbarCheck.checked = settings().nativeToolbar;
    toolbarCheck.addEventListener('change', () => setNativeToolbar(toolbarCheck.checked));
    toolbarRow.append(toolbarLabel, toolbarCheck);
    const backgroundRow = document.createElement('label');
    backgroundRow.className = 'cu-settings-row';
    const backgroundLabel = document.createElement('span');
    backgroundLabel.textContent = '显示 SillyTavern 背景图片';
    const backgroundCheck = document.createElement('input');
    backgroundCheck.type = 'checkbox'; backgroundCheck.setAttribute('role', 'switch');
    backgroundCheck.checked = settings().background;
    backgroundCheck.addEventListener('change', () => { settings().background = backgroundCheck.checked; save(); applyAppearance(); });
    backgroundRow.append(backgroundLabel, backgroundCheck);
    const effectsRows = visualEffectControls.map(control => {
        const row = document.createElement('label'); row.className = 'cu-settings-row cu-effect-slider';
        const title = document.createElement('span'); title.textContent = control.label;
        const input = document.createElement('input'); input.type = 'range'; input.id = 'cu-effect-' + control.key;
        input.min = control.min; input.max = control.max; input.step = '1';
        input.setAttribute('aria-label', control.label);
        const output = document.createElement('output'); output.id = input.id + '-value'; output.setAttribute('for', input.id);
        input.setAttribute('aria-describedby', output.id);
        input.addEventListener('input', () => {
            const config = settings(); config[control.key] = Number(input.value);
            applyVisualEffects(document.body, config); refreshEffectControls(config); save();
        });
        row.append(title, output, input); return row;
    });
    const effectsReset = document.createElement('div'); effectsReset.className = 'cu-effects-reset';
    effectsReset.append(button('重置效果', 'reset', () => {
        const config = settings();
        for (const control of visualEffectControls) config[control.key] = control.initial;
        applyVisualEffects(document.body, config); refreshEffectControls(config); save();
    }));
    const qrRow = document.createElement('label');
    qrRow.className = 'cu-settings-row cu-mobile-setting';
    const qrLabel = document.createElement('span'); qrLabel.textContent = '快速回复收起';
    const qrCheck = document.createElement('input'); qrCheck.type = 'checkbox'; qrCheck.setAttribute('role', 'switch'); qrCheck.checked = settings().quickRepliesCollapsed;
    qrCheck.addEventListener('change', () => { settings().quickRepliesCollapsed = qrCheck.checked; save(); applyAppearance(); });
    qrRow.append(qrLabel, qrCheck);
    const layoutRows = [];
    for (const [key, title] of [['compactComposer','输入栏紧凑模式']]) {
        const option = document.createElement('label'); option.className = 'cu-settings-row';
        const text = document.createElement('span'); text.textContent = title;
        const input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('role', 'switch'); input.checked = settings()[key];
        input.addEventListener('change', () => { settings()[key] = input.checked; save(); applyAppearance(); });
        option.append(text, input); layoutRows.push(option);
    }
    const headerRow = document.createElement('label'); headerRow.className = 'cu-settings-row';
    const headerLabel = document.createElement('span'); headerLabel.textContent = '顶栏显示';
    const headerSelect = document.createElement('select'); headerSelect.className = 'cu-settings-select'; headerSelect.setAttribute('aria-label', '顶栏显示');
    for (const [value,title] of headerModes) { const option = document.createElement('option'); option.value = value; option.textContent = title; headerSelect.append(option); }
    headerSelect.value = headerMode(); headerSelect.addEventListener('change', () => setHeaderMode(headerSelect.value));
    headerRow.append(headerLabel, headerSelect);
    const homeRow = document.createElement('label'); homeRow.className = 'cu-settings-row';
    const homeLabel = document.createElement('span'); homeLabel.textContent = '原版首页与最近记录';
    const homeCheck = document.createElement('input'); homeCheck.type = 'checkbox'; homeCheck.setAttribute('role', 'switch'); homeCheck.checked = settings().useNativeHome;
    homeCheck.addEventListener('change', () => { settings().useNativeHome = homeCheck.checked; save(); applyAppearance(); });
    homeRow.append(homeLabel, homeCheck);
    const messageRow = document.createElement('label'); messageRow.className = 'cu-settings-row';
    const messageLabel = document.createElement('span'); messageLabel.textContent = '角色消息样式';
    const messageSelect = document.createElement('select'); messageSelect.className = 'cu-settings-select'; messageSelect.setAttribute('aria-label', '角色消息样式');
    for (const [value, title] of [['minimal','极简'],['avatar','头像'],['banner','横幅']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = title; messageSelect.append(option);
    }
    messageSelect.value = settings().messageStyle;
    messageSelect.addEventListener('change', () => { settings().messageStyle = messageSelect.value; save(); applyAppearance(); });
    messageRow.append(messageLabel, messageSelect);
    const nameRow = document.createElement('label'); nameRow.className = 'cu-settings-row';
    const nameLabel = document.createElement('span'); nameLabel.textContent = '侧栏名称';
    const nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.className = 'cu-brand-name-input';
    nameInput.setAttribute('aria-label', '侧栏名称'); nameInput.maxLength = 40; nameInput.value = settings().brandName; nameInput.placeholder = 'Claude';
    nameInput.addEventListener('input', () => { settings().brandName = nameInput.value; save(); applyBranding(); });
    nameRow.append(nameLabel, nameInput);
    nameRow.dataset.cuBrandCustom = '';
    const iconRow = document.createElement('label'); iconRow.className = 'cu-settings-row';
    const iconLabel = document.createElement('span'); iconLabel.textContent = '品牌图标';
    const iconSelect = document.createElement('select'); iconSelect.className = 'cu-settings-select'; iconSelect.setAttribute('aria-label', '品牌图标');
    for (const [value, title] of [['claude','Claude'],['chatgpt','ChatGPT'],['gemini','Gemini'],['deepseek','DeepSeek'],['custom','自定义']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = title; iconSelect.append(option);
    }
    iconSelect.value = settings().brandIcon; iconRow.append(iconLabel, iconSelect);
    iconRow.dataset.cuBrandCustom = '';
    const uploadRow = document.createElement('div'); uploadRow.className = 'cu-settings-row cu-brand-upload'; uploadRow.hidden = settings().brandIcon !== 'custom';
    uploadRow.dataset.cuBrandCustom = '';
    const uploadLabel = document.createElement('span'); uploadLabel.textContent = '自定义图标';
    const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml'; fileInput.hidden = true;
    const preview = brandElement();
    const uploadButton = button('上传图标', 'image', () => {});
    // Keep the picker inside the original user gesture in WKWebView.
    uploadButton.addEventListener('click', () => fileInput.click());
    const clearButton = button('移除自定义图标', 'trash', () => { settings().customBrandIcon = ''; save(); applyBranding(); }, 'cu-icon');
    clearButton.id = 'cu-clear-brand-icon';
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        uploadButton.disabled = true;
        try { await storeBrandImage(file); }
        catch (error) { toastr.error(error.message || '图片加载失败，请换一张图片。'); }
        finally { uploadButton.disabled = false; fileInput.value = ''; }
    });
    uploadRow.append(uploadLabel, preview, uploadButton, clearButton, fileInput);
    iconSelect.addEventListener('change', () => { settings().brandIcon = iconSelect.value; uploadRow.hidden = iconSelect.value !== 'custom'; save(); applyBranding(); });
    const footer = document.createElement('div'); footer.className = 'cu-settings-footer';
    footer.append(button('停用 Claude Surface', 'close', () => { settings().enabled = false; save(); applyAppearance(); }, 'cu-danger cu-disable-action'));
    const fixedBrandRow = document.createElement('div'); fixedBrandRow.className = 'cu-settings-row'; fixedBrandRow.dataset.cuBrandFixed = '';
    const fixedBrandLabel = document.createElement('span'); fixedBrandLabel.textContent = '应用名称';
    const fixedName = document.createElement('strong'); fixedName.textContent = 'SillyTavern'; fixedBrandRow.append(fixedBrandLabel,brandElement(),fixedName);
    const group = (title, rows) => {
        const section = document.createElement('section'); section.className = 'cu-settings-section';
        const heading = document.createElement('h3'); heading.className = 'cu-settings-section-title'; heading.textContent = title;
        const list = document.createElement('div'); list.className = 'cu-settings-group'; list.append(...rows);
        section.append(heading, list); return section;
    };
    const effectsSection = group('背景与毛玻璃', [backgroundRow, ...effectsRows, effectsReset]); effectsSection.classList.add('cu-effects-section');
    content.append(designGrid, group('外观', [row, paletteRow, fontRow]), effectsSection, group('聊天', [messageRow, qrRow, ...layoutRows]), group('布局', [toolbarRow, homeRow, headerRow]), group('品牌', [fixedBrandRow, nameRow, iconRow, uploadRow]), footer);
    refreshEffectControls();
    refreshPaletteControls();
    applyBranding();
    state.compatUI?.refresh();
}

function showChatActions() {
    const content = sheet('对话', { anchor: state.invoker });
    const list = document.createElement('div');
    list.className = 'cu-sheet-list';
    list.append(
        homeAction({ force: true }),
        button('聊天记录', 'history', () => { quietNavigation(); closeSheet(); document.querySelector('#option_select_chat')?.click(); }),
        button('新建聊天', 'plus', () => { quietNavigation(); closeSheet(); document.querySelector('#option_start_new_chat')?.click(); }),
        button('编辑角色世界书', 'book', showCharacterWorld),
        button('编辑角色详情', 'edit', showCharacterEditor));
    content.append(list);
}

async function goHome(forceClaude = false) {
    quietNavigation();
    if (forceClaude && settings().useNativeHome) { settings().useNativeHome = false; save(); }
    state.homeRecent = false;
    closeSheet();
    closeNativePanels();
    setSidebar(false);
    await closeCurrentChat();
    updateContext();
    void refreshRecents();
}

async function refreshRecents() {
    if (state.refreshing) return;
    state.refreshing = true;
    try {
        const response = await fetch('/api/chats/recent', {
            method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify({ max: 60 }), cache: 'no-cache',
        });
        if (!response.ok) throw new Error(`History HTTP ${response.status}`);
        state.recents = await response.json();
        renderRecents();
    } catch (error) {
        console.warn('[Claude Surface] History unavailable', error);
        const root = document.querySelector('.cu-recents');
        root.replaceChildren(button('打开原版聊天记录', 'history', () => { setSidebar(false); document.querySelector('#option_select_chat')?.click(); }));
    } finally { state.refreshing = false; }
}

function renderRecents() {
    const root = document.querySelector('.cu-recents');
    if (!root) return;
    const query = document.querySelector('.cu-search').value.toLocaleLowerCase();
    root.replaceChildren();
    const entities = characterEntities();
    const keys = [...new Set([...settings().recentCharacters, ...state.recents.map(row => row.group ? `group:${row.group}` : row.avatar)])];
    const rows = keys.map(key => entities.find(entity => entity.key === key)).filter(Boolean).filter(entity => entity.name.toLocaleLowerCase().includes(query));
    for (const entity of rows) root.append(characterRow(entity));
    if (!rows.length) {
        const empty = document.createElement('p');
        empty.className = 'cu-empty';
        empty.textContent = query ? '没有匹配的角色' : '选择角色后会显示在这里';
        root.append(empty);
    }
    renderHome();
}

function characterEntities() {
    const context = ctx();
    return [
        ...context.characters.map((char, id) => ({ key: char.avatar, id, name: char.name || char.avatar, avatar: char.avatar, favorite: [true, 'true'].includes(char.fav ?? char.data?.extensions?.fav), detail: (char.data?.tags || char.tags || []).join(' · ') })),
        ...context.groups.map(group => ({ key: `group:${group.id}`, group: group.id, name: group.name, avatar: group.avatar_url, detail: `${group.members?.length || 0} 位成员 · 群聊` })),
    ];
}

function avatarElement(entity) {
    const avatar = document.createElement('span');
    avatar.className = 'cu-card-avatar';
    if (entity.avatar && entity.avatar !== 'none') {
        const image = document.createElement('img');
        image.alt = '';
        image.loading = 'lazy';
        image.src = entity.group ? entity.avatar : ctx().getThumbnailUrl('avatar', entity.avatar);
        image.addEventListener('error', () => { avatar.textContent = entity.name.slice(0, 1); }, { once: true });
        avatar.append(image);
    } else avatar.textContent = entity.name.slice(0, 1);
    return avatar;
}

function characterRow(entity, subtitle, action = () => openCharacter(entity)) {
    const row = button(entity.name, 'people', action, 'cu-character-row');
    row.firstElementChild.replaceWith(avatarElement(entity));
    const text = row.querySelector('span:last-child');
    text.className = 'cu-card-copy';
    const name = document.createElement('span');
    name.className = 'cu-card-name'; name.textContent = entity.name;
    text.replaceChildren(name);
    if (subtitle || entity.detail) {
        const description = document.createElement('small');
        description.textContent = subtitle || entity.detail;
        text.append(description);
    }
    row.setAttribute('aria-current', String(entity.group ? entity.group === ctx().groupId : String(entity.id) === String(ctx().characterId)));
    return row;
}

async function openCharacter(entity, file) {
    quietNavigation();
    if (state.selecting) return;
    state.selecting = true;
    try {
        if (entity.group) {
            await openGroupById(entity.group);
            setActiveGroup(entity.group);
            if (file) await ctx().openGroupChat(entity.group, file);
        } else {
            await ctx().selectCharacterById(entity.id, { switchMenu: false });
            if (String(ctx().characterId) !== String(entity.id)) return;
            setActiveCharacter(entity.avatar);
            if (file && ctx().getCurrentChatId() !== file) await ctx().openCharacterChat(file);
        }
        settings().recentCharacters = [entity.key, ...settings().recentCharacters.filter(key => key !== entity.key)].slice(0, 60);
        save();
        closeSheet();
        setSidebar(false);
        closeNativePanels({ keepDocks: desktop.matches });
        if (desktop.matches && document.getElementById('right-nav-panel')?.classList.contains('openDrawer')) document.getElementById('rm_button_characters')?.click();
        updateContext();
        void refreshRecents();
    } finally { state.selecting = false; }
}

async function showCharacterEditor() {
    quietNavigation();
    const id = ctx().characterId;
    if (id != null) await ctx().selectCharacterById(id, { switchMenu: true });
    nativeTarget('#rightNavDrawerIcon');
}

async function showCharacterWorld() {
    quietNavigation();
    closeSheet(); setSidebar(false);
    const id = ctx().characterId;
    if (id == null) { toastr.info('请先选择角色卡。'); return; }
    const world = ctx().characters[id]?.data?.extensions?.world;
    if (world) { openWorldInfoEditor(world); return; }
    await showCharacterEditor();
    document.getElementById('world_button')?.click();
}

function showCharacters() {
    nativeTarget('#rightNavDrawerIcon');
    document.querySelector('#rm_button_characters')?.click();
}

function showHomeRecents(show = !state.homeRecent) {
    state.homeRecent = show;
    document.body.classList.toggle('cu-home-recents', show);
    renderHome();
}

function renderHome() {
    const root = document.querySelector('.cu-home-content');
    if (!root) return;
    root.hidden = !settings().enabled || !document.body.classList.contains('cu-home');
    document.body.classList.toggle('cu-home-recents', !!state.homeRecent);
    const toggle = root.querySelector('.cu-home-history-toggle');
    toggle.setAttribute('aria-expanded', String(!!state.homeRecent));
    toggle.setAttribute('aria-label', state.homeRecent ? '收起最近聊天' : '最近聊天');
    toggle.querySelector('span').textContent = state.homeRecent ? '收起最近聊天' : '最近聊天';
    const list = root.querySelector('.cu-home-history');
    list.hidden = !state.homeRecent;
    list.replaceChildren();
    if (!state.homeRecent) return;
    const entities = characterEntities();
    for (const row of state.recents.slice(0, 30)) {
        const entity = entities.find(entity => entity.key === (row.group ? `group:${row.group}` : row.avatar));
        if (!entity) continue;
        const file = row.file_name.replace(/\.jsonl$/, '');
        list.append(characterRow(entity, file, () => openCharacter(entity, file)));
    }
    if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'cu-empty'; empty.textContent = '还没有最近聊天'; list.append(empty); }
}

function updateContext() {
    if (!settings().enabled) return;
    const context = ctx();
    const home = context.characterId == null && !context.groupId && (!!document.querySelector('#chat .welcomePanel') || context.chat.every(message => message.is_system));
    state.isHome = home;
    document.body.classList.toggle('cu-home', home && !settings().useNativeHome);
    const greeting = document.querySelector('.cu-home-greeting');
    greeting.hidden = !home || settings().useNativeHome;
    const day = new Date().getDay();
    greeting.querySelector('.cu-greeting-text').textContent = `${day === 0 || day === 6 ? '周末愉快' : '今天过得怎么样'}，${context.name1 || '朋友'}`;
    state.chatTitle = home ? '新建对话' : (context.groups.find(group => group.id === context.groupId)?.name || context.characters[context.characterId]?.name || context.name2 || '对话');
    document.querySelector('.cu-title').textContent = state.chatTitle;
    const headerAvatar = document.querySelector('.cu-header-avatar');
    const entity = characterEntities().find(entity => entity.group ? entity.group === context.groupId : !context.groupId && String(entity.id) === String(context.characterId));
    state.headerEntity = home ? null : entity;
    if (state.headerEntity && headerAvatar.dataset.character !== entity.key) {
        headerAvatar.dataset.character = entity.key; headerAvatar.replaceChildren(avatarElement(entity));
    }
    headerAvatar.hidden = !state.headerEntity;
    document.querySelector('.cu-account-name').textContent = context.name1 || '用户';
    document.querySelector('.cu-avatar').textContent = (context.name1 || 'U').slice(0,1).toUpperCase();
    let model = '';
    if (context.mainApi === 'openai') model = context.getChatCompletionModel?.() || '';
    const connected = context.onlineStatus && context.onlineStatus !== 'no_connection';
    document.querySelector('.cu-model-label').textContent = model || (connected ? '模型与连接' : '连接模型');
    const textarea = document.querySelector('#send_textarea');
    textarea.placeholder = home ? '今天我能为您做些什么？' : '回复';
    textarea.setAttribute('aria-label', '消息');
    if (document.querySelector('.cu-recents')) renderRecents();
    document.querySelector('.cu-return-home').hidden = !home || !settings().useNativeHome;
    renderHome();
    syncNativePanels();
}

function registerExtensionSettings() {
    const host = document.querySelector('#extensions_settings');
    if (!host || document.querySelector('#cu-extension-settings')) return;
    const block = document.createElement('div');
    block.id = 'cu-extension-settings';
    block.className = 'inline-drawer';
    block.innerHTML = '<div class="inline-drawer-toggle inline-drawer-header"><b>Claude Surface</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><label class="checkbox_label"><input id="cu-extension-enabled" type="checkbox" role="switch"><span>启用 Claude 界面</span></label><label>主题 <select id="cu-extension-mode"><option value="dark">深色</option><option value="light">浅色</option><option value="system">跟随系统</option></select></label></div>';
    host.append(block);
    const options = block.querySelector('.inline-drawer-content');
    const companionOption = document.createElement('option'); companionOption.value = 'companion'; companionOption.textContent = '跟随主题伴侣';
    block.querySelector('#cu-extension-mode').append(companionOption);
    const designLabel = document.createElement('label'); designLabel.textContent = '设计风格 ';
    const designSelect = document.createElement('select'); designSelect.id = 'cu-extension-design';
    for (const design of designs) { const option = document.createElement('option'); option.value = design.id; option.textContent = design.label; designSelect.append(option); }
    designSelect.addEventListener('change', () => { settings().design = designSelect.value; save(); applyAppearance(); });
    designLabel.append(designSelect); options.prepend(designLabel);
    for (const [id,key,title] of [['cu-extension-serif','serif','英文回复使用衬线字体'],['cu-extension-toolbar','nativeToolbar','显示原生菜单栏'],['cu-extension-compact','compactComposer','输入栏紧凑模式']]) {
        const label = document.createElement('label');
        label.className = 'checkbox_label';
        const input = document.createElement('input');
        input.type = 'checkbox'; input.setAttribute('role', 'switch'); input.id = id;
        const text = document.createElement('span'); text.textContent = title;
        label.append(input,text); options.append(label);
        input.addEventListener('change', () => { settings()[key] = input.checked; save(); applyAppearance(); });
    }
    const headerLabel = document.createElement('label'); headerLabel.textContent = '顶栏显示 ';
    const headerSelect = document.createElement('select'); headerSelect.id = 'cu-extension-header-mode';
    for (const [value,title] of headerModes) { const option = document.createElement('option'); option.value = value; option.textContent = title; headerSelect.append(option); }
    headerSelect.addEventListener('change', () => setHeaderMode(headerSelect.value));
    headerLabel.append(headerSelect); options.append(headerLabel);
    block.querySelector('#cu-extension-enabled').addEventListener('change', event => { settings().enabled = event.target.checked; save(); applyAppearance(); });
    block.querySelector('#cu-extension-mode').addEventListener('change', event => { settings().mode = event.target.value; save(); applyAppearance(); });
}

function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    const header = document.createElement('header');
    header.className = 'cu-header'; header.id = 'cu-header';
    const sidebarToggle = button('打开侧边栏', 'sidebar', () => {
        if (desktop.matches) { settings().sidebarPinned = !settings().sidebarPinned; save(); }
        setSidebar(!document.body.classList.contains('cu-sidebar-open')); void refreshRecents();
    }, 'cu-icon');
    sidebarToggle.id = 'cu-sidebar-toggle';
    sidebarToggle.setAttribute('aria-controls', 'cu-sidebar');
    sidebarToggle.setAttribute('aria-expanded', 'false');
    const title = document.createElement('div');
    title.className = 'cu-title';
    const titleWrap = document.createElement('div'); titleWrap.className = 'cu-title-wrap';
    const subtitle = document.createElement('span'); subtitle.className = 'cu-header-subtitle'; subtitle.textContent = 'SillyTavern';
    const headerAvatar = document.createElement('span'); headerAvatar.className = 'cu-header-avatar'; headerAvatar.hidden = true; headerAvatar.setAttribute('aria-hidden', 'true');
    titleWrap.append(headerAvatar, title, subtitle);
    const closeNative = button('关闭原生面板', 'close', closeNativePanels, 'cu-icon');
    closeNative.id = 'cu-native-close';
    closeNative.hidden = true;
    header.append(sidebarToggle, titleWrap, closeNative, button('对话操作', 'more', showChatActions, 'cu-icon'), homeAction({className:'cu-icon'}), button('更多', 'sliders', showTools, 'cu-icon'));
    const sidebar = document.createElement('nav');
    sidebar.id = 'cu-sidebar';
    sidebar.className = 'cu-sidebar';
    sidebar.setAttribute('aria-label', '侧边栏');
    sidebar.inert = true;
    sidebar.setAttribute('aria-hidden', 'true');
    sidebar.addEventListener('keydown', event => {
        if (event.key !== 'Tab' || desktop.matches || state.sheet) return;
        const focusable = [...sidebar.querySelectorAll('button,input')].filter(el => !el.disabled && el.getClientRects().length);
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus({ preventScroll: true }); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus({ preventScroll: true }); }
    });
    const top = document.createElement('div');
    top.className = 'cu-sidebar-top';
    const wordmark = document.createElement('span');
    wordmark.className = 'cu-wordmark';
    const brandName = document.createElement('span'); brandName.className = 'cu-brand-name';
    wordmark.append(brandElement(), brandName);
    top.append(button('关闭侧边栏', 'sidebar', () => {
        if (desktop.matches) { settings().sidebarPinned = false; save(); }
        setSidebar(false); sidebarToggle.focus({ preventScroll: true });
    }, 'cu-icon'), wordmark);
    const search = document.createElement('input');
    search.className = 'cu-search';
    search.type = 'search';
    search.placeholder = '搜索最近角色';
    search.setAttribute('aria-label', '搜索最近角色');
    search.addEventListener('input', renderRecents);
    const nav = document.createElement('div');
    nav.className = 'cu-nav';
    nav.append(button('首页', 'home', goHome), button('预设', 'sliders', () => nativeTarget('#leftNavDrawerIcon')), button('扩展程序', 'puzzle', () => nativeTarget('#extensions-settings-button .drawer-icon')), button('世界书', 'book', () => nativeTarget('#WIDrawerIcon')), button('角色卡', 'people', showCharacters), button('更多', 'more', showTools));
    const recentHeading = document.createElement('div');
    recentHeading.className = 'cu-recent-heading';
    recentHeading.textContent = '最近使用的角色';
    const recents = document.createElement('div');
    recents.className = 'cu-recents';
    const footer = document.createElement('div');
    footer.className = 'cu-sidebar-footer';
    const account = button('用户设定', 'people', () => nativeTarget('#persona-management-button .drawer-icon'), 'cu-account');
    account.innerHTML = '<span class="cu-avatar"></span><span class="cu-account-name"></span>';
    footer.append(account, button('主题设置', 'sun', showAppearance, 'cu-icon'));
    sidebar.append(top, search, nav, recentHeading, recents, footer);
    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'cu-backdrop';
    backdrop.hidden = true;
    backdrop.setAttribute('aria-label', '关闭侧边栏');
    backdrop.addEventListener('click', () => setSidebar(false));
    const reveal = button('显示顶栏', 'chevron', () => { state.headerTappedOpen = true; syncHeaderVisibility(); }, 'cu-header-reveal cu-icon');
    reveal.id = 'cu-header-reveal'; reveal.hidden = true; reveal.setAttribute('aria-controls', 'cu-header');
    document.body.append(header, reveal, backdrop, sidebar);
    const greeting = document.createElement('div');
    greeting.className = 'cu-home-greeting';
    const greetingText = document.createElement('span'); greetingText.className = 'cu-greeting-text';
    greeting.append(brandElement(), greetingText);
    const homeContent = document.createElement('div'); homeContent.className = 'cu-home-content';
    const choose = button('选择角色，开始对话', 'people', showCharacters, 'cu-home-choose');
    const recentToggle = button('最近聊天', 'chevron', () => showHomeRecents(), 'cu-home-history-toggle');
    const homeHistory = document.createElement('div'); homeHistory.className = 'cu-home-history'; homeHistory.hidden = true;
    homeContent.append(choose, recentToggle, homeHistory);
    const welcome = document.createElement('section'); welcome.className = 'cu-home-welcome';
    welcome.append(greeting, homeContent);
    document.querySelector('#sheld').append(welcome);
    const returnHome = homeAction({ prefix:'返回 ', force:true, className:'cu-return-home' }); returnHome.hidden = true; document.body.append(returnHome);
    let homeTouch;
    const homeGestureTarget = event => document.body.classList.contains('cu-home') && !state.sheet && !event.target.closest('#form_sheld,.cu-home-history,input,textarea');
    document.querySelector('#sheld').addEventListener('wheel', event => { if (homeGestureTarget(event) && event.deltaY > 20) showHomeRecents(true); }, { passive: true });
    document.querySelector('#sheld').addEventListener('touchstart', event => { homeTouch = homeGestureTarget(event) ? event.touches[0].clientY : null; }, { passive: true });
    document.querySelector('#sheld').addEventListener('touchend', event => { if (homeTouch != null && homeTouch - event.changedTouches[0].clientY > 45) showHomeRecents(true); homeTouch = null; }, { passive: true });
    const meta = document.createElement('div');
    meta.className = 'cu-composer-meta';
    const modelButton = button('API 连接与模型选择', 'chevron', () => nativeTarget('#API-status-top'));
    modelButton.querySelector('span').className = 'cu-model-label';
    meta.append(button('更多', 'sliders', showTools), modelButton);
    document.querySelector('#form_sheld').append(meta);
    document.querySelector('#options_button')?.setAttribute('aria-label', '完整聊天菜单');
    document.querySelector('#extensionsMenuButton')?.setAttribute('aria-label', '附件与扩展菜单');
    registerExtensionSettings();
    state.nativeUI = setupNativeUI({ settings, save, button, svg, showCharacters, openCharacter, characterEntities });
    for (const [id, name] of [['left-nav-panel','预设'],['right-nav-panel','角色卡']]) {
        const panel = document.getElementById(id);
        if (!panel) continue;
        const heading = document.createElement('div'); heading.className = 'cu-dock-heading';
        const label = document.createElement('span'); label.textContent = name;
        heading.append(label, button(`关闭${name}`, 'close', () => {
            if (panel.classList.contains('openDrawer')) panel.parentElement.querySelector('.drawer-toggle')?.click();
        }, 'cu-icon'));
        panel.prepend(heading);
    }
    state.compatUI = setupExtensionCompatibility({ settings, save, appearanceChanged: applyAppearance });
    state.themeUI = setupManagedTheme({ settings, save, report, appearanceChanged: applyAppearance });
    setupHeaderScroll();
    // SVG paths and button padding are not .drawer-icon targets. Do not let
    // the native outside-press closer close a drawer before its toggle click.
    const nativeBar = document.getElementById('top-settings-holder');
    for (const type of ['mousedown','touchstart']) nativeBar.addEventListener(type, event => {
        if (settings().enabled && event.target.closest('.drawer-toggle')) event.stopPropagation();
    }, { passive: true });
    document.addEventListener('pointerdown', event => {
        if (editable(event.target) || editable(event.target.closest('label')?.control) || event.target.closest('#rm_button_search')) { state.navigationFocusUntil = 0; state.navigationInputIntent = true; }
    }, true);
    document.addEventListener('keydown', event => { if (event.key === 'Tab') { state.navigationFocusUntil = 0; state.navigationInputIntent = true; } }, true);
    document.addEventListener('focusin', event => {
        if (!settings().enabled || state.navigationInputIntent || (!state.selecting && performance.now() > (state.navigationFocusUntil || 0)) || !editable(event.target)) return;
        if (event.target.closest('#top-settings-holder,#select_chat_popup,#sheld,.cu-sidebar,.select2-dropdown')) event.target.blur();
    }, true);
    jQuery(document).on('select2:opening.claudeSurface', event => {
        if (settings().enabled && !desktop.matches && event.target instanceof HTMLSelectElement && !event.target.multiple) quietNavigation();
    });
    applyAppearance();
    void refreshRecents();
    const context = ctx();
    for (const name of ['APP_READY','CHAT_CHANGED','CHAT_LOADED','SETTINGS_UPDATED','MAIN_API_CHANGED','CHATCOMPLETION_MODEL_CHANGED','ONLINE_STATUS_CHANGED','PERSONA_CHANGED']) {
        if (context.eventTypes[name]) context.eventSource.on(context.eventTypes[name], () => { updateContext(); if (name.includes('CHAT') || name === 'APP_READY') void refreshRecents(); });
    }
    for (const name of ['CHAT_DELETED','CHAT_CREATED','CHAT_RENAMED','GROUP_CHAT_CREATED','GROUP_CHAT_DELETED']) {
        if (context.eventTypes[name]) context.eventSource.on(context.eventTypes[name], refreshRecents);
    }
    const chatElement = document.querySelector('#chat');
    const chatObserver = new MutationObserver(records => {
        const rootChange = records.some(record => record.target === chatElement);
        const editorChange = records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && (node.matches('.mes,#curEditTextarea') || node.querySelector('#curEditTextarea'))));
        if (rootChange || editorChange) {
            cancelAnimationFrame(state.messageFrame);
            state.messageFrame = requestAnimationFrame(() => { decorateMessages(); if (rootChange) updateContext(); });
        }
    });
    chatObserver.observe(chatElement, { childList: true, subtree: true });
    document.addEventListener('click', captureEditorAnchor, true);
    const nativeObserver = new MutationObserver(() => {
        cancelAnimationFrame(state.nativeFrame);
        state.nativeFrame = requestAnimationFrame(syncNativePanels);
    });
    document.querySelectorAll('#top-settings-holder > .drawer > .drawer-content').forEach(panel => {
        nativeObserver.observe(panel, { attributes: true, attributeFilter: ['class'] });
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !state.sheet && document.body.classList.contains('cu-sidebar-open')) {
            setSidebar(false); sidebarToggle.focus({ preventScroll: true });
        }
    });
    media.addEventListener('change', () => { if (['system','companion'].includes(settings().mode)) applyAppearance(); });
    desktop.addEventListener('change', () => {
        revealHeader(); setSidebar(false); syncNativePanels();
        if (!desktop.matches) closeNativePanels();
    });
    // Keep the real composer above mobile keyboards without replacing its input handlers.
    const adjustViewport = () => {
        const viewport = window.visualViewport;
        const keyboardInset = viewport && document.activeElement?.id === 'send_textarea'
            ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
        document.body.style.setProperty('--cu-bottom-inset', `${keyboardInset}px`);
    };
    window.visualViewport?.addEventListener('resize', adjustViewport);
    document.querySelector('#send_textarea').addEventListener('blur', () => document.body.style.setProperty('--cu-bottom-inset', '0px'));
}

jQuery(initialize);
