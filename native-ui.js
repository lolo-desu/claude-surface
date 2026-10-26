import { setupMobileWorldInfo, setupMobilePanelViewport } from './world-info-ui.js';
import { toggleDrawer } from '../../../utils.js';
import { extensionNames } from '../../../extensions.js';
/* Adapt native elements in place: their IDs, values and event handlers stay intact. */
export function setupNativeUI({ settings, svg, showCharacters, openCharacter, characterEntities }) {
    const hasBaiBaiTools = () => {
        const disabled = SillyTavern.getContext().extensionSettings.disabledExtensions || [];
        return extensionNames.some(name => /(?:^|\/)ST-BaiBai-Tools(?:$|[-_])/i.test(name) && !disabled.includes(name))
            || !!document.querySelector('style[id^="bai_bai_toolkit_"],[data-bai-bai-world-info-mobile-header-layout="true"]');
    };
    const hasBaiWorldLayout = () => hasBaiBaiTools() && SillyTavern.getContext().extensionSettings.baiBaiToolkit?.worldInfoListOptimizationEnabled !== false;
    const mobileWorld = setupMobileWorldInfo(settings, { toggleDrawer, externalLayout: hasBaiWorldLayout });
    // Bai's input handler immediately reads/rebuilds the existing list. Restore
    // native field positions before it takes ownership on a live enable.
    document.addEventListener('input', event => {
        if (event.target.id === 'bai_bai_toolkit_world_info_list_optimization_enabled' && event.target.checked) mobileWorld.release?.();
    }, true);
    const promptEditor = document.getElementById('completion_prompt_manager_popup');
    if (promptEditor) new MutationObserver(() => {
        // The host outside closer adds closedDrawer, while PromptManager only
        // adds openDrawer on reopening. Do not leave both classes on the editor.
        if (settings().enabled && promptEditor.classList.contains('openDrawer') && promptEditor.classList.contains('closedDrawer')) promptEditor.classList.remove('closedDrawer');
    }).observe(promptEditor, { attributes: true, attributeFilter: ['class'] });
    const refreshPromptViewport = setupMobilePanelViewport(settings, promptEditor, 'prompt');
    promptEditor?.addEventListener('keydown', event => {
        if (settings().enabled && event.key === 'Escape' && !document.querySelector('.select2-container--open')) {
            event.preventDefault(); event.stopPropagation();
            promptEditor.querySelector('#completion_prompt_manager_popup_entry_form_close')?.click();
        }
    });
    const compactViewport = matchMedia('(max-width: 899px)');
    const presetIcon = document.getElementById('leftNavDrawerIcon');
    const originalPresetTitle = presetIcon?.title;
    function refreshTitle() {
        if (presetIcon) {
            presetIcon.title = settings().enabled ? '预设' : originalPresetTitle;
            presetIcon.setAttribute('aria-label', presetIcon.title);
        }
    }
    const paintRange = input => {
        const minimum = Number(input.min) || 0, maximum = Number(input.max) || 100;
        input.style.setProperty('--cu-range-fill', `${Math.max(0, Math.min(100, 100 * (Number(input.value) - minimum) / (maximum - minimum || 1)))}%`);
    };
    function decorate(root = document) {
        document.body.classList.toggle('cu-baibai-tools', settings().enabled && hasBaiBaiTools());
        mobileWorld.refresh();
        root.querySelectorAll('input[type="range"]').forEach(input => {
            const parent = input.parentElement;
            if (input.closest('#WorldInfo') && !compactViewport.matches) {
                const row = parent.classList.contains('range-block-range') ? parent.parentElement : parent;
                row.classList.remove('cu-range-row', 'cu-range-legacy');
                row.querySelectorAll('.cu-range-label').forEach(label => label.classList.remove('cu-range-label'));
                paintRange(input);
                return;
            }
            const row = input.closest('.range-block-range-and-counter');
            if (row) row.classList.add('cu-range-row', 'cu-range-legacy');
            else if (parent.querySelector(':scope > .neo-range-input')) {
                parent.classList.add('cu-range-row');
                [...parent.children].filter(child => child !== input && !child.matches('input,.range-block-counter')).forEach(child => child.classList.add('cu-range-label'));
            }
            paintRange(input);
        });
        refreshTitle();
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
    return { refresh: () => { refreshTitle(); mobileWorld.refresh(); refreshPromptViewport(); } };
}
