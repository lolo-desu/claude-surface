import { setupMobileWorldInfo, setupMobilePanelViewport } from './world-info-ui.js';
import { toggleDrawer } from '../../../utils.js';
import { extensionNames } from '../../../extensions.js';
/* Adapt native elements in place: their IDs, values and event handlers stay intact. */
export function setupNativeUI({ settings, svg, ui = text => text, showCharacters, openCharacter, characterEntities }) {
    const hasBaiBaiTools = () => {
        const disabled = SillyTavern.getContext().extensionSettings.disabledExtensions || [];
        return extensionNames.some(name => /(?:^|\/)ST-BaiBai-Tools(?:$|[-_])/i.test(name) && !disabled.includes(name))
            || !!document.querySelector('style[id^="bai_bai_toolkit_"],[data-bai-bai-world-info-mobile-header-layout="true"]');
    };
    const hasBaiWorldLayout = () => hasBaiBaiTools() && SillyTavern.getContext().extensionSettings.baiBaiToolkit?.worldInfoListOptimizationEnabled !== false;
    const mobileWorld = setupMobileWorldInfo(settings, { toggleDrawer, externalLayout: hasBaiWorldLayout, ui });
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
    const compactViewport = matchMedia('(max-width: 899px), (max-width: 1100px) and (pointer: coarse)');
    const presetIcon = document.getElementById('leftNavDrawerIcon');
    const originalPresetTitle = presetIcon?.title;
    const toolbarAttributes = new Map();
    const toolbarNames = ['预设','API 连接','回复格式','世界书','用户设置','背景','扩展程序','用户设定','角色卡'];
    let statusId = 0;
    const worldAttributes = new Map();
    const actionNames = new Map();
    function refreshActions() {
        for (const [control,record] of actionNames) {
            if (!control.isConnected) { actionNames.delete(control); continue; }
            if (!settings().enabled) {
                if (control.getAttribute('aria-label') === record.applied) record.original == null ? control.removeAttribute('aria-label') : control.setAttribute('aria-label',record.original);
                actionNames.delete(control);
            }
        }
        if (!settings().enabled) return;
        document.querySelectorAll('#top-settings-holder :is(.menu_button,.right_menu_button),#chat .ch_name .mes_button,#chat .swipe_left,#chat .swipe_right').forEach(control=>{
            const caption = control.title?.trim().split('\n')[0];
            if (!caption || control.closest('.mes_text') || control.getAttribute('aria-labelledby')) return;
            if (control.getAttribute('aria-label') && !actionNames.has(control)) return;
            const text = control.textContent.trim();
            if (text.length > 2 && /[a-zA-Z0-9\u4e00-\u9fff]/.test(text)) return;
            if (!actionNames.has(control)) actionNames.set(control,{original:control.getAttribute('aria-label')});
            const value = caption.slice(0,160); control.setAttribute('aria-label',value); actionNames.get(control).applied=value;
        });
    }
    function decorateWorld() {
        for (const element of worldAttributes.keys()) if (!element.isConnected) worldAttributes.delete(element);
        if (!settings().enabled) {
            document.querySelectorAll('.cu-wi-state-label').forEach(x=>x.remove());
            for (const [element,attrs] of worldAttributes) for (const [name,value] of Object.entries(attrs)) value == null ? element.removeAttribute(name) : element.setAttribute(name,value);
            worldAttributes.clear(); return;
        }
        const attributes = (element,values) => {
            if (!worldAttributes.has(element)) worldAttributes.set(element,Object.fromEntries(Object.keys(values).map(key=>[key,element.getAttribute(key)])));
            for (const [name,value] of Object.entries(values)) element.setAttribute(name,value);
        };
        document.querySelectorAll('#WorldInfo .world_entry select[name="entryStateSelector"]').forEach(select=>{
            attributes(select,{'aria-label':ui('状态'),id:select.id || `cu-wi-state-${++statusId}`});
            if (!select.previousElementSibling?.classList.contains('cu-wi-state-label')) {
                const label = document.createElement('label'); label.className='cu-wi-state-label'; label.htmlFor=select.id; label.textContent=ui('状态'); label.addEventListener('click',event=>event.stopPropagation()); select.before(label);
            }
        });
        document.querySelectorAll('#WorldInfo .switch_input_type_icon').forEach(button=>attributes(button,{tabindex:'0'}));
        document.querySelectorAll('#WIMultiSelector .select2-selection__clear').forEach(button=>attributes(button,{'aria-label':ui('清空全部世界书'),title:ui('清空全部世界书')}));
        document.querySelectorAll('#WIMultiSelector .select2-selection__choice__remove').forEach(button=>attributes(button,{'aria-label':ui('移除此世界书'),title:ui('移除此世界书')}));
    }
    function refreshToolbar() {
        document.querySelectorAll('#top-settings-holder > .drawer > .drawer-toggle').forEach((toggle,index) => {
            const keys = ['role','tabindex','aria-label','aria-controls','aria-expanded'];
            const icon = toggle.querySelector('.drawer-icon');
            if (!toolbarAttributes.has(toggle)) toolbarAttributes.set(toggle,{attributes:Object.fromEntries(keys.map(key => [key,toggle.getAttribute(key)])),iconAttributes:icon && Object.fromEntries(['role','tabindex','aria-hidden'].map(key=>[key,icon.getAttribute(key)]))});
            if (!settings().enabled) {
                for (const [key,value] of Object.entries(toolbarAttributes.get(toggle).attributes)) value == null ? toggle.removeAttribute(key) : toggle.setAttribute(key,value);
                if (icon) for (const [key,value] of Object.entries(toolbarAttributes.get(toggle).iconAttributes || {})) value == null ? icon.removeAttribute(key) : icon.setAttribute(key,value);
                return;
            }
            if (icon) { icon.setAttribute('role','presentation'); icon.setAttribute('aria-hidden','true'); icon.tabIndex = -1; }
            toggle.setAttribute('role','button'); toggle.tabIndex = 0;
            toggle.setAttribute('aria-label',ui(toolbarNames[index]) || toggle.querySelector('.drawer-icon')?.title || '更多');
            const panel = toggle.parentElement.querySelector('.drawer-content');
            if (panel?.id) toggle.setAttribute('aria-controls',panel.id);
            toggle.setAttribute('aria-expanded',String(!!panel?.classList.contains('openDrawer')));
        });
    }
    document.getElementById('top-settings-holder')?.addEventListener('keydown', event => {
        if (!settings().enabled || !['Enter',' '].includes(event.key) || !event.target.matches('.drawer-toggle')) return;
        event.preventDefault(); event.target.click();
    });
    new MutationObserver(records => {
        if (records.some(record=>record.target.matches('.drawer-icon,.drawer-content'))) refreshToolbar();
    }).observe(document.getElementById('top-settings-holder'),{subtree:true,attributes:true,attributeFilter:['class']});
    function refreshTitle() {
        if (presetIcon) {
            presetIcon.title = settings().enabled ? ui('预设') : originalPresetTitle;
            presetIcon.setAttribute('aria-label', presetIcon.title);
        }
    }
    const paintRange = input => {
        const minimum = Number(input.min) || 0, maximum = Number(input.max) || 100;
        input.style.setProperty('--cu-range-fill', `${Math.max(0, Math.min(100, 100 * (Number(input.value) - minimum) / (maximum - minimum || 1)))}%`);
    };
    function decorate(root = document) {
        refreshToolbar();
        decorateWorld();
        refreshActions();
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
        if (!records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches('input[type="range"],.world_entry,.select2-selection__choice') || node.querySelector('input[type="range"],.world_entry'))))) return;
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
    return { refreshActions, refresh: () => { refreshTitle(); refreshToolbar(); decorateWorld(); refreshActions(); mobileWorld.refresh(); refreshPromptViewport(); } };
}
