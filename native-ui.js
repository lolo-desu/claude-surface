import { setupMobileWorldInfo } from './world-info-ui.js';
import { toggleDrawer } from '../../../utils.js';
/* Adapt native elements in place: their IDs, values and event handlers stay intact. */
export function setupNativeUI({ settings, save, button, svg, showCharacters, openCharacter, characterEntities }) {
    const mobileWorld = setupMobileWorldInfo(settings, { toggleDrawer });
    const compactViewport = matchMedia('(max-width: 899px)');
    const panel = document.getElementById('left-nav-panel');
    const presetIcon = document.getElementById('leftNavDrawerIcon');
    const originalPresetTitle = presetIcon?.title;
    const toolbar = document.createElement('div'); toolbar.className = 'cu-sampler-toolbar';
    const title = document.createElement('span'); title.textContent = '预设';
    const lock = button('解锁参数', 'lock', () => {
        settings().slidersLocked = !settings().slidersLocked;
        save(); refreshLock();
    }, 'cu-icon cu-sampler-lock');
    toolbar.append(title, lock); panel.prepend(toolbar);
    function refreshLock() {
        if (presetIcon) {
            presetIcon.title = settings().enabled ? '预设' : originalPresetTitle;
            presetIcon.setAttribute('aria-label', presetIcon.title);
        }
        const locked = settings().enabled && settings().slidersLocked;
        panel.classList.toggle('cu-sampler-locked', locked);
        lock.innerHTML = svg(locked ? 'lock' : 'unlock');
        lock.title = locked ? '解锁参数' : '锁定参数';
        lock.setAttribute('aria-label', lock.title);
        lock.setAttribute('aria-pressed', String(locked));
        panel.querySelectorAll('.cu-range-row input,.range-block-range-and-counter input').forEach(input => {
            if (input.type === 'range' || input.type === 'number') {
                if (locked) input.setAttribute('aria-disabled', 'true');
                else input.removeAttribute('aria-disabled');
            }
        });
    }
    // Block user gestures only. Native preset loading can still update these values.
    for (const type of ['pointerdown', 'click', 'wheel', 'keydown', 'beforeinput', 'paste', 'drop']) {
        panel.addEventListener(type, event => {
            if (!settings().enabled || !settings().slidersLocked || event.key === 'Tab') return;
            const input = event.target.closest('input');
            if (!input || !['range','number'].includes(input.type) || !input.closest('.cu-range-row,.range-block-range-and-counter')) return;
            event.preventDefault(); event.stopImmediatePropagation();
        }, { capture: true, passive: false });
    }
    const paintRange = input => {
        const minimum = Number(input.min) || 0, maximum = Number(input.max) || 100;
        input.style.setProperty('--cu-range-fill', `${Math.max(0, Math.min(100, 100 * (Number(input.value) - minimum) / (maximum - minimum || 1)))}%`);
    };
    function decorate(root = document) {
        root.querySelectorAll('input[type="range"]').forEach(input => {
            const parent = input.parentElement;
            if (input.closest('#WorldInfo') && !compactViewport.matches) {
                const row = parent.classList.contains('range-block-range') ? parent.parentElement : parent;
                row.classList.remove('cu-range-row', 'cu-range-legacy');
                row.querySelectorAll('.cu-range-label').forEach(label => label.classList.remove('cu-range-label'));
                paintRange(input);
                return;
            }
            // The legacy layout has separate range/counter wrappers; the newer one has direct children.
            if (parent.classList.contains('range-block-range')) parent.parentElement.classList.add('cu-range-row', 'cu-range-legacy');
            else {
                parent.classList.add('cu-range-row');
                [...parent.children].filter(child => child !== input && !child.matches('input,.range-block-counter')).forEach(child => child.classList.add('cu-range-label'));
            }
            paintRange(input);
        });
        refreshLock();
        const glyphs = ['sliders','plug','type','book','sliders','image','puzzle','user','people'];
        document.querySelectorAll('#top-settings-holder > .drawer > .drawer-toggle > .drawer-icon').forEach((icon, index) => {
            if (!icon.classList.contains('cu-native-icon')) { icon.classList.add('cu-native-icon'); icon.innerHTML = svg(glyphs[index]); }
        });
        for (const [id, glyph] of [['rm_button_create','plus'],['character_import_button','arrow'],['external_import_button','plug'],['rm_button_group_chats','people'],['rm_button_search','search'],['charListGridToggle','image'],['bulkEditButton','edit'],['rm_button_characters','people']]) {
            const control = document.getElementById(id);
            if (control && !control.classList.contains('cu-outline-control')) {
                control.classList.add('cu-outline-control'); control.insertAdjacentHTML('afterbegin', svg(glyph));
            }
        }
    }
    decorate();
    compactViewport.addEventListener('change', () => decorate());
    document.addEventListener('input', event => {
        if (event.target.matches('input[type="range"]')) paintRange(event.target);
        if (event.target.matches('input[type="number"]')) {
            const related = document.getElementById(event.target.dataset.for);
            if (related?.type === 'range') requestAnimationFrame(() => paintRange(related));
        }
    });
    let frame;
    const observer = new MutationObserver(records => {
        if (!records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches('input[type="range"]') || node.querySelector('input[type="range"]'))))) return;
        cancelAnimationFrame(frame); frame = requestAnimationFrame(() => decorate());
    });
    observer.observe(document.getElementById('top-settings-holder'), { childList: true, subtree: true });
    document.getElementById('top-settings-holder').addEventListener('change', () => {
        cancelAnimationFrame(frame); frame = requestAnimationFrame(() => decorate());
    });
    // Open chats directly from the native list; keep explicit editing as a separate action.
    document.addEventListener('click', event => {
        if (!settings().enabled) return;
        const icon = event.target.closest('#rightNavDrawerIcon');
        if (icon && event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); showCharacters(); return; }
        const card = event.target.closest('#right-nav-panel .character_select');
        if (!card || event.target.closest('input,button,a,select,textarea,label,.tag,.menu_button,.character_fav_button,.ch_fav_icon')) return;
        const characterId = card.dataset.chid || card.getAttribute('chid');
        const entity = characterEntities().find(entity => !entity.group && String(entity.id) === characterId);
        if (!entity) return;
        event.preventDefault(); event.stopImmediatePropagation();
        openCharacter(entity).catch(error => { console.error('[Claude Surface]', error); });
    }, true);
    const context = SillyTavern.getContext();
    for (const name of ['SETTINGS_UPDATED','MAIN_API_CHANGED']) if (context.eventTypes[name]) context.eventSource.on(context.eventTypes[name], () => { decorate(); });
    return { refresh: () => { refreshLock(); mobileWorld.refresh(); } };
}
