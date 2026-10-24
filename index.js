import { closeCurrentChat, setActiveCharacter, setActiveGroup } from '../../../../script.js';
import { openGroupById } from '../../../group-chats.js';
import { setupNativeUI } from './native-ui.js';

const KEY = 'claude_surface';
const ctx = () => SillyTavern.getContext();
const media = matchMedia('(prefers-color-scheme: dark)');
const desktop = matchMedia('(min-width: 900px)');
const mediaReduced = matchMedia('(prefers-reduced-motion: reduce)');
const defaults = { enabled: true, mode: 'dark', serif: true, background: false, nativeToolbar: false, slidersLocked: true, recentCharacters: [] };
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
    arrow: '<path d="m7 17 10-10M7 7h10v10"/>',
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1Z"/>',
    plug: '<path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-6 6v4m-4-4h8"/>',
    type: '<path d="M4 5h16M12 5v15M8 20h8"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-4L4 15Z"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    unlock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 7-2M12 14v3"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.sliders}</svg>`;
const star = '<svg class="cu-star" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><path d="M16 2v28M2 16h28M6 6l20 20M6 26 26 6M10 3l12 26M3 10l26 12M3 22l26-12M10 29 22 3"/></svg>';

function settings() {
    const ext = ctx().extensionSettings;
    ext[KEY] ??= { ...defaults };
    for (const [key, value] of Object.entries(defaults)) ext[KEY][key] ??= value;
    return ext[KEY];
}

function save() { ctx().saveSettingsDebounced(); }

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
    toastr.error('操作未完成，请通过原生工具栏重试。', 'Claude Surface');
}

function applyAppearance() {
    const config = settings();
    const mode = config.mode === 'system' ? (media.matches ? 'dark' : 'light') : config.mode;
    if (config.enabled) document.body.dataset.claudeUi = mode;
    else delete document.body.dataset.claudeUi;
    document.body.classList.toggle('cu-shell-ready', config.enabled);
    document.body.classList.toggle('cu-background-enabled', config.enabled && config.background);
    document.body.classList.toggle('cu-native-open', config.enabled && config.nativeToolbar);
    try { localStorage.setItem('claude-surface-boot', JSON.stringify({ enabled: config.enabled, mode: config.mode })); } catch { /* Storage can be unavailable in private contexts. */ }
    document.documentElement.toggleAttribute('data-cu-boot', config.enabled);
    document.documentElement.dataset.cuBootMode = mode;
    document.querySelectorAll('.cu-header,.cu-sidebar,.cu-composer-meta').forEach(el => { el.hidden = !config.enabled; });
    document.querySelector('.cu-return-home').hidden = !config.enabled || !state.nativeHome;
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
    for (const [id, key] of [['cu-extension-serif','serif'],['cu-extension-toolbar','nativeToolbar']]) {
        const control = document.getElementById(id);
        if (control) control.checked = config[key];
    }
    state.nativeUI?.refresh();
    if (config.enabled) { decorateMessages(); updateContext(); }
    syncNativePanels();
}

function setNativeToolbar(visible) {
    settings().nativeToolbar = visible;
    save();
    applyAppearance();
}

function syncNativePanels() {
    const panels = [...document.querySelectorAll('#top-settings-holder > .drawer > .drawer-content.openDrawer')];
    const opened = settings().enabled && panels.length > 0;
    document.body.classList.toggle('cu-panel-open', opened);
    const close = document.getElementById('cu-native-close');
    if (close) close.hidden = !opened;
    const title = document.querySelector('.cu-title');
    if (title) title.textContent = opened
        ? (panels.at(-1).parentElement.querySelector('.drawer-icon')?.title || '工具与设置')
        : (state.chatTitle || '新建对话');
}

function closeNativePanels() {
    document.querySelectorAll('#top-settings-holder > .drawer > .drawer-toggle').forEach(toggle => {
        if (toggle.querySelector('.openIcon')) toggle.click();
    });
}

function openNative(toggle) {
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
        if (enabled && avatar.parentElement !== footer) footer.prepend(avatar);
        else if (!enabled && avatar.parentElement === footer) message.insertBefore(avatar, message.querySelector(':scope > .swipe_left') || block);
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
    document.body.classList.toggle('cu-sidebar-open', open);
    const nav = document.querySelector('.cu-sidebar');
    if (nav) { nav.inert = !open; nav.setAttribute('aria-hidden', String(!open)); }
    for (const region of document.querySelectorAll('#sheld,.cu-header')) region.inert = open && !desktop.matches;
    const backdrop = document.querySelector('.cu-backdrop');
    if (backdrop) backdrop.hidden = !open || desktop.matches;
    const opener = document.querySelector('#cu-sidebar-toggle');
    opener?.setAttribute('aria-expanded', String(open));
    if (open) document.querySelector('.cu-sidebar .cu-search')?.focus({ preventScroll: true });
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
    state.returnFocus?.focus({ preventScroll: true });
}

function sheet(title, { anchor } = {}) {
    closeSheet(true);
    state.returnFocus = document.activeElement;
    const root = document.createElement('div');
    root.className = 'cu-sheet';
    root.setAttribute('role', 'presentation');
    const panel = document.createElement('section');
    panel.className = 'cu-sheet-panel';
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
    heading.append(label, button('关闭', 'close', closeSheet, 'cu-icon'));
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
    heading.querySelector('button').focus({ preventScroll: true });
    return content;
}

function nativeTarget(selector) {
    const target = document.querySelector(selector);
    if (!target) throw new Error(`Missing native control: ${selector}`);
    const toggle = target.closest('.drawer-toggle') || target;
    openNative(toggle);
}

function showTools() {
    const content = sheet('工具与设置', { anchor: state.invoker });
    const grid = document.createElement('div');
    grid.className = 'cu-tool-grid';
    const names = ['AI 回复配置', 'API 连接', '回复格式', '世界书', '用户设置', '背景', '扩展程序', '用户设定', '角色'];
    const glyphs = ['sliders','plug','type','book','sliders','image','puzzle','user','people'];
    document.querySelectorAll('#top-settings-holder > .drawer > .drawer-toggle').forEach((toggle, index) => {
        const original = toggle.querySelector('.drawer-icon');
        const title = names[index] || original?.title || `工具 ${index + 1}`;
        const item = button(title, glyphs[index], () => index === 8 ? showCharacters() : openNative(toggle));
        grid.append(item);
    });
    const note = document.createElement('p');
    note.className = 'cu-sheet-note';
    note.textContent = '下拉把手或点击关闭即可收起。';
    content.append(grid, note,
        button('显示 / 收起原生工具栏', 'sliders', () => {
            closeSheet(); setSidebar(false); setNativeToolbar(!settings().nativeToolbar);
        }),
        button('主题外观', 'sun', showAppearance),
        button(state.nativeHome ? '返回 Claude 首页' : '原版首页与最近记录', 'home', async () => { if (state.nativeHome) await goHome(); else { await goHome(); state.nativeHome = true; updateContext(); } }));
}

function showAppearance() {
    const content = sheet('外观');
    const row = document.createElement('div');
    row.className = 'cu-settings-row';
    const label = document.createElement('span');
    label.textContent = '主题';
    const segment = document.createElement('div');
    segment.className = 'cu-segment';
    for (const [value, title] of [['system','系统'],['light','浅色'],['dark','深色']]) {
        const item = button(title, value === 'dark' ? 'moon' : 'sun', () => { settings().mode = value; save(); applyAppearance(); });
        item.dataset.cuMode = value;
        item.setAttribute('aria-pressed', String(settings().mode === value));
        segment.append(item);
    }
    row.append(label, segment);
    const fontRow = document.createElement('label');
    fontRow.className = 'cu-settings-row';
    const fontLabel = document.createElement('span');
    fontLabel.textContent = '英文回复使用衬线字体';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = settings().serif;
    check.addEventListener('change', () => { settings().serif = check.checked; save(); applyAppearance(); });
    fontRow.append(fontLabel, check);
    const toolbarRow = document.createElement('label');
    toolbarRow.className = 'cu-settings-row';
    const toolbarLabel = document.createElement('span');
    toolbarLabel.textContent = '原生顶栏常驻';
    const toolbarCheck = document.createElement('input');
    toolbarCheck.type = 'checkbox';
    toolbarCheck.checked = settings().nativeToolbar;
    toolbarCheck.addEventListener('change', () => setNativeToolbar(toolbarCheck.checked));
    toolbarRow.append(toolbarLabel, toolbarCheck);
    const backgroundRow = document.createElement('label');
    backgroundRow.className = 'cu-settings-row';
    const backgroundLabel = document.createElement('span');
    backgroundLabel.textContent = '显示 SillyTavern 背景图片';
    const backgroundCheck = document.createElement('input');
    backgroundCheck.type = 'checkbox';
    backgroundCheck.checked = settings().background;
    backgroundCheck.addEventListener('change', () => { settings().background = backgroundCheck.checked; save(); applyAppearance(); });
    backgroundRow.append(backgroundLabel, backgroundCheck);
    const note = document.createElement('p');
    note.className = 'cu-sheet-note';
    note.textContent = '中文始终使用系统无衬线字体；英文回复可单独切换衬线字体。界面控件保持统一的无衬线排版。';
    content.append(row, fontRow, toolbarRow, backgroundRow, note, button('SillyTavern 用户设置', 'sliders', () => nativeTarget('#user-settings-button .drawer-icon')),
        button('停用 Claude Surface', 'close', () => { settings().enabled = false; save(); applyAppearance(); }));
}

function showChatActions() {
    const content = sheet('对话');
    const list = document.createElement('div');
    list.className = 'cu-sheet-list';
    list.append(
        button('当前角色的聊天记录', 'history', () => { closeSheet(); document.querySelector('#option_select_chat')?.click(); }),
        button('当前角色新建聊天', 'plus', () => { closeSheet(); document.querySelector('#option_start_new_chat')?.click(); }),
        button('完整聊天菜单', 'more', () => { closeSheet(); document.querySelector('#options_button')?.click(); }),
        button('角色', 'people', showCharacters),
        button('编辑当前角色', 'edit', showCharacterEditor),
        button('Claude 首页', 'home', goHome),
        button('工具与设置', 'sliders', showTools));
    content.append(list);
}

async function goHome() {
    state.nativeHome = false;
    state.homeRecent = false;
    closeSheet();
    closeNativePanels();
    setSidebar(false);
    await closeCurrentChat();
    updateContext();
    void refreshRecents();
    if (desktop.matches) document.querySelector('#send_textarea')?.focus({ preventScroll: true });
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
        state.nativeHome = false;
        settings().recentCharacters = [entity.key, ...settings().recentCharacters.filter(key => key !== entity.key)].slice(0, 60);
        save();
        closeSheet();
        setSidebar(false);
        closeNativePanels();
        updateContext();
        void refreshRecents();
    } finally { state.selecting = false; }
}

async function showCharacterEditor() {
    const id = ctx().characterId;
    if (id != null) await ctx().selectCharacterById(id, { switchMenu: true });
    nativeTarget('#rightNavDrawerIcon');
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
    document.body.classList.toggle('cu-home', home && !state.nativeHome);
    const greeting = document.querySelector('.cu-home-greeting');
    greeting.hidden = !home || !!state.nativeHome;
    const day = new Date().getDay();
    greeting.querySelector('span').textContent = `${day === 0 || day === 6 ? '周末愉快' : '今天过得怎么样'}，${context.name1 || '朋友'}`;
    state.chatTitle = home ? '新建对话' : (context.groups.find(group => group.id === context.groupId)?.name || context.characters[context.characterId]?.name || context.name2 || '对话');
    document.querySelector('.cu-title').textContent = state.chatTitle;
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
    document.querySelector('.cu-return-home').hidden = !state.nativeHome;
    renderHome();
    syncNativePanels();
}

function registerExtensionSettings() {
    const host = document.querySelector('#extensions_settings');
    if (!host || document.querySelector('#cu-extension-settings')) return;
    const block = document.createElement('div');
    block.id = 'cu-extension-settings';
    block.className = 'inline-drawer';
    block.innerHTML = '<div class="inline-drawer-toggle inline-drawer-header"><b>Claude Surface</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><label class="checkbox_label"><input id="cu-extension-enabled" type="checkbox"><span>启用 Claude 界面</span></label><label>主题 <select id="cu-extension-mode"><option value="dark">深色</option><option value="light">浅色</option><option value="system">跟随系统</option></select></label><p>完整功能由原版 SillyTavern 提供。</p></div>';
    host.append(block);
    const options = block.querySelector('.inline-drawer-content');
    for (const [id,key,title] of [['cu-extension-serif','serif','英文回复使用衬线字体'],['cu-extension-toolbar','nativeToolbar','原生顶栏常驻']]) {
        const label = document.createElement('label');
        label.className = 'checkbox_label';
        const input = document.createElement('input');
        input.type = 'checkbox'; input.id = id;
        const text = document.createElement('span'); text.textContent = title;
        label.append(input,text); options.append(label);
        input.addEventListener('change', () => { settings()[key] = input.checked; save(); applyAppearance(); });
    }
    block.querySelector('#cu-extension-enabled').addEventListener('change', event => { settings().enabled = event.target.checked; save(); applyAppearance(); });
    block.querySelector('#cu-extension-mode').addEventListener('change', event => { settings().mode = event.target.value; save(); applyAppearance(); });
}

function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    const header = document.createElement('header');
    header.className = 'cu-header';
    const sidebarToggle = button('打开侧边栏', 'sidebar', () => { setSidebar(true); void refreshRecents(); }, 'cu-icon');
    sidebarToggle.id = 'cu-sidebar-toggle';
    sidebarToggle.setAttribute('aria-controls', 'cu-sidebar');
    sidebarToggle.setAttribute('aria-expanded', 'false');
    const title = document.createElement('div');
    title.className = 'cu-title';
    const closeNative = button('关闭原生面板', 'close', closeNativePanels, 'cu-icon');
    closeNative.id = 'cu-native-close';
    closeNative.hidden = true;
    header.append(sidebarToggle, title, closeNative, button('对话操作', 'more', showChatActions, 'cu-icon'), button('Claude 首页', 'home', goHome, 'cu-icon'), button('工具与设置', 'sliders', showTools, 'cu-icon'));
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
    wordmark.textContent = 'Claude';
    top.append(button('关闭侧边栏', 'sidebar', () => { setSidebar(false); sidebarToggle.focus({ preventScroll: true }); }, 'cu-icon'), wordmark);
    const search = document.createElement('input');
    search.className = 'cu-search';
    search.type = 'search';
    search.placeholder = '搜索最近角色';
    search.setAttribute('aria-label', '搜索最近角色');
    search.addEventListener('input', renderRecents);
    const nav = document.createElement('div');
    nav.className = 'cu-nav';
    nav.append(button('Claude 首页', 'home', goHome, 'cu-new'), button('角色', 'people', showCharacters), button('世界书', 'book', () => nativeTarget('#WIDrawerIcon')), button('扩展程序', 'puzzle', () => nativeTarget('#extensions-settings-button .drawer-icon')), button('工具与设置', 'sliders', showTools));
    const recentHeading = document.createElement('div');
    recentHeading.className = 'cu-recent-heading';
    recentHeading.textContent = '最近使用的角色';
    const recents = document.createElement('div');
    recents.className = 'cu-recents';
    const footer = document.createElement('div');
    footer.className = 'cu-sidebar-footer';
    const account = button('用户设定', 'people', () => nativeTarget('#persona-management-button .drawer-icon'), 'cu-account');
    account.innerHTML = '<span class="cu-avatar"></span><span class="cu-account-name"></span>';
    footer.append(account, button('外观', 'sun', showAppearance, 'cu-icon'));
    sidebar.append(top, search, nav, recentHeading, recents, footer);
    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'cu-backdrop';
    backdrop.hidden = true;
    backdrop.setAttribute('aria-label', '关闭侧边栏');
    backdrop.addEventListener('click', () => setSidebar(false));
    document.body.append(header, backdrop, sidebar);
    const greeting = document.createElement('div');
    greeting.className = 'cu-home-greeting';
    greeting.innerHTML = `${star}<span></span>`;
    const homeContent = document.createElement('div'); homeContent.className = 'cu-home-content';
    const choose = button('选择角色，开始对话', 'people', showCharacters, 'cu-home-choose');
    const recentToggle = button('最近聊天', 'chevron', () => showHomeRecents(), 'cu-home-history-toggle');
    const homeHistory = document.createElement('div'); homeHistory.className = 'cu-home-history'; homeHistory.hidden = true;
    homeContent.append(choose, recentToggle, homeHistory);
    const welcome = document.createElement('section'); welcome.className = 'cu-home-welcome';
    welcome.append(greeting, homeContent);
    document.querySelector('#sheld').append(welcome);
    const returnHome = button('返回 Claude 首页', 'home', goHome, 'cu-return-home'); returnHome.hidden = true; document.body.append(returnHome);
    let homeTouch;
    const homeGestureTarget = event => document.body.classList.contains('cu-home') && !state.sheet && !event.target.closest('#form_sheld,.cu-home-history,input,textarea');
    document.querySelector('#sheld').addEventListener('wheel', event => { if (homeGestureTarget(event) && event.deltaY > 20) showHomeRecents(true); }, { passive: true });
    document.querySelector('#sheld').addEventListener('touchstart', event => { homeTouch = homeGestureTarget(event) ? event.touches[0].clientY : null; }, { passive: true });
    document.querySelector('#sheld').addEventListener('touchend', event => { if (homeTouch != null && homeTouch - event.changedTouches[0].clientY > 45) showHomeRecents(true); homeTouch = null; }, { passive: true });
    const meta = document.createElement('div');
    meta.className = 'cu-composer-meta';
    const modelButton = button('API 连接与模型选择', 'chevron', () => nativeTarget('#API-status-top'));
    modelButton.querySelector('span').className = 'cu-model-label';
    meta.append(button('工具与设置', 'sliders', showTools), modelButton);
    document.querySelector('#form_sheld').append(meta);
    document.querySelector('#options_button')?.setAttribute('aria-label', '完整聊天菜单');
    document.querySelector('#extensionsMenuButton')?.setAttribute('aria-label', '附件与扩展菜单');
    registerExtensionSettings();
    state.nativeUI = setupNativeUI({ settings, save, button, svg, showCharacters, openCharacter, characterEntities });
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
    nativeObserver.observe(document.querySelector('#top-settings-holder'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !state.sheet && document.body.classList.contains('cu-sidebar-open')) {
            setSidebar(false); sidebarToggle.focus({ preventScroll: true });
        }
    });
    media.addEventListener('change', () => { if (settings().mode === 'system') applyAppearance(); });
    desktop.addEventListener('change', () => setSidebar(false));
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
