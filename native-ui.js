import { setupMobileWorldInfo, setupMobilePanelViewport } from './world-info-ui.js';
import { toggleDrawer } from '../../../utils.js';
import { extensionNames } from '../../../extensions.js';
import { nativeDrawerControl } from './native-controls.js';
import { createAttributeOwner } from './control-attributes.js';
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
    const nativeAttributes = createAttributeOwner();
    const stopControl = document.getElementById('mes_stop');
    stopControl?.addEventListener('keydown', event => {
        if (!settings().enabled || !['Enter',' '].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        if (event.key !== ' ' || !event.repeat) stopControl.click();
    });
    let statusId = 0;
    const worldAttributes = new Map();
    // Native updates can replace a field while leaving our sibling label.
    const worldLabels = new Map();
    const controlsIn = (root, selector) => root?.querySelectorAll
        ? [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)] : [];
    // Weak keys release removed chat controls without walking all old messages.
    const actionNames = new WeakMap();
    function refreshActions(root = document) {
        const enabled = settings().enabled;
        const selector = root === document
            ? '#top-settings-holder :is(.menu_button,.right_menu_button),#chat .ch_name .mes_button,#chat .swipe_left,#chat .swipe_right'
            : root?.id === 'top-settings-holder' || root?.closest?.('#top-settings-holder') ? '.menu_button,.right_menu_button' : '.ch_name .mes_button,.swipe_left,.swipe_right';
        controlsIn(root, selector).forEach(control => {
            const record = actionNames.get(control);
            if (!enabled) {
                if (record && control.getAttribute('aria-label') === record.applied) record.original == null ? control.removeAttribute('aria-label') : control.setAttribute('aria-label',record.original);
                actionNames.delete(control); return;
            }
            const caption = control.title?.trim().split('\n')[0];
            if (!caption || control.closest('.mes_text') || control.getAttribute('aria-labelledby')) return;
            if (control.getAttribute('aria-label') && !record) return;
            const text = control.textContent.trim();
            if (text.length > 2 && /[a-zA-Z0-9\u4e00-\u9fff]/.test(text)) return;
            if (!record) actionNames.set(control,{original:control.getAttribute('aria-label')});
            const value = caption.slice(0,160);
            if (control.getAttribute('aria-label') !== value) control.setAttribute('aria-label',value);
            actionNames.get(control).applied=value;
        });
    }
    function pruneWorldAttributes() {
        for (const element of worldAttributes.keys()) if (!element.isConnected) worldAttributes.delete(element);
        for (const [label, control] of worldLabels) {
            if (!label.isConnected) worldLabels.delete(label);
            else if (!control.isConnected) { label.remove(); worldLabels.delete(label); }
        }
    }
    function decorateWorld(root = document) {
        if (!settings().enabled) {
            if (!worldAttributes.size && !worldLabels.size) return;
            for (const label of worldLabels.keys()) label.remove();
            worldLabels.clear();
            for (const [element,attrs] of worldAttributes) for (const [name,value] of Object.entries(attrs)) value == null ? element.removeAttribute(name) : element.setAttribute(name,value);
            worldAttributes.clear(); return;
        }
        const attributes = (element,values) => {
            if (!worldAttributes.has(element)) worldAttributes.set(element,Object.fromEntries(Object.keys(values).map(key=>[key,element.getAttribute(key)])));
            for (const [name,value] of Object.entries(values)) if (element.getAttribute(name) !== String(value)) element.setAttribute(name,value);
        };
        controlsIn(root, '#WorldInfo .world_entry select[name="entryStateSelector"]').forEach(select=>{
            attributes(select,{'aria-label':ui('状态'),id:select.id || `cu-wi-state-${++statusId}`});
            let label = select.previousElementSibling;
            if (!label?.classList.contains('cu-wi-state-label')) {
                label = document.createElement('label'); label.className='cu-wi-state-label'; label.htmlFor=select.id; label.textContent=ui('状态'); label.addEventListener('click',event=>event.stopPropagation()); select.before(label);
            }
            // Re-adopt a retained Surface label when a native tree remounts.
            worldLabels.set(label, select);
        });
        controlsIn(root, '#WorldInfo .switch_input_type_icon').forEach(button=>attributes(button,{tabindex:'0'}));
        controlsIn(root, '#WIMultiSelector .select2-selection__clear').forEach(button=>attributes(button,{'aria-label':ui('清空全部世界书'),title:ui('清空全部世界书')}));
        controlsIn(root, '#WIMultiSelector .select2-selection__choice__remove').forEach(button=>attributes(button,{'aria-label':ui('移除此世界书'),title:ui('移除此世界书')}));
    }
    function refreshToolbar() {
        if (!settings().enabled) { nativeAttributes.restore(); return; }
        nativeAttributes.prune();
        document.querySelectorAll('#top-settings-holder > .drawer > .drawer-toggle').forEach(toggle => {
            const control = nativeDrawerControl(toggle);
            if (!control) return;
            const icon = toggle.querySelector('.drawer-icon');
            nativeAttributes.apply(icon, { role: 'presentation', 'aria-hidden': 'true', tabindex: -1 });
            const panel = toggle.parentElement.querySelector('.drawer-content');
            nativeAttributes.apply(toggle, { role: 'button', tabindex: 0, 'aria-label': ui(control.label),
                ...(panel?.id ? { 'aria-controls': panel.id } : {}), 'aria-expanded': String(!!panel?.classList.contains('openDrawer')) });
        });
        if (stopControl) nativeAttributes.apply(stopControl, { role: 'button', tabindex: 0, 'aria-label': stopControl.title || ui('停止生成') });
    }
    document.getElementById('top-settings-holder')?.addEventListener('keydown', event => {
        if (!settings().enabled || !['Enter',' '].includes(event.key) || !event.target.matches('.drawer-toggle') || !nativeDrawerControl(event.target)) return;
        event.preventDefault();
        if (event.key !== ' ' || !event.repeat) event.target.click();
    });
    new MutationObserver(records => {
        if (records.some(record=>record.target.matches('.drawer-icon,.drawer-content'))) refreshToolbar();
    }).observe(document.getElementById('top-settings-holder'),{subtree:true,attributes:true,attributeFilter:['class']});
    function refreshTitle() {
        if (settings().enabled) nativeAttributes.apply(presetIcon, { title: ui('预设'), 'aria-label': ui('预设') });
        else nativeAttributes.restore();
    }
    const paintRange = input => {
        const minimum = Number(input.min) || 0, maximum = Number(input.max) || 100;
        const value = `${Math.max(0, Math.min(100, 100 * (Number(input.value) - minimum) / (maximum - minimum || 1)))}%`;
        if (input.style.getPropertyValue('--cu-range-fill') !== value) input.style.setProperty('--cu-range-fill', value);
    };
    function decorateRanges(root) {
        controlsIn(root, 'input[type="range"]').forEach(input => {
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
    }
    function decorate() {
        refreshToolbar();
        pruneWorldAttributes(); decorateWorld();
        refreshActions(document.getElementById('top-settings-holder'));
        document.body.classList.toggle('cu-baibai-tools', settings().enabled && hasBaiBaiTools());
        mobileWorld.refresh();
        decorateRanges(document);
        refreshTitle();
        document.querySelectorAll('#top-settings-holder > .drawer > .drawer-toggle > .drawer-icon').forEach(icon => {
            const control = nativeDrawerControl(icon);
            if (control && !icon.classList.contains('cu-native-icon')) { icon.classList.add('cu-native-icon'); icon.innerHTML = svg(control.icon); }
        });
        for (const [id, glyph] of [['rm_button_create','plus'],['character_import_button','arrow'],['external_import_button','plug'],['rm_button_group_chats','people'],['rm_button_search','search'],['charListGridToggle','image'],['bulkEditButton','edit'],['rm_button_characters','people']]) {
            const control = document.getElementById(id);
            if (control && !control.classList.contains('cu-outline-control')) {
                control.classList.add('cu-outline-control'); control.insertAdjacentHTML('afterbegin', svg(glyph));
            }
        }
    }
    decorate();
    compactViewport.addEventListener('change', () => refresh());
    document.addEventListener('input', event => {
        if (event.target.matches('input[type="range"]')) paintRange(event.target);
        if (event.target.matches('input[type="number"]')) {
            const related = document.getElementById(event.target.dataset.for);
            if (related?.type === 'range') requestAnimationFrame(() => paintRange(related));
        }
    });
    let frame = null, prunePending = false, fullPending = false;
    const pendingRoots = new Set();
    function queueRoot(root) {
        if (root?.nodeType !== 1) return;
        // Ancestor lookups scale with DOM depth, including a large native
        // list mounted one sibling at a time in the same mutation delivery.
        for (let parent = root; parent; parent = parent.parentElement) if (pendingRoots.has(parent)) return;
        pendingRoots.add(root);
        if (frame === null) frame = requestAnimationFrame(flushRoots);
    }
    function flushRoots() {
        frame = null;
        if (fullPending) { refresh(); return; }
        if (prunePending) { prunePending = false; pruneWorldAttributes(); }
        const roots = [...pendingRoots].filter(root => {
            for (let parent = root.parentElement; parent; parent = parent.parentElement) if (pendingRoots.has(parent)) return false;
            return true;
        });
        pendingRoots.clear();
        for (const root of roots) {
            if (!root.isConnected) continue;
            decorateWorld(root); decorateRanges(root); refreshActions(root);
        }
    }
    const dynamicControls = 'input[type="range"],.world_entry,select[name="entryStateSelector"],.switch_input_type_icon,.select2-selection__choice,.select2-selection__choice__remove,.select2-selection__clear,.menu_button,.right_menu_button';
    const observer = new MutationObserver(records => {
        for (const record of records) {
            for (const node of record.addedNodes) if (node.nodeType === 1 && (node.matches(dynamicControls) || node.querySelector(dynamicControls))) queueRoot(node);
            if (!prunePending && [...record.removedNodes].some(node => node.nodeType === 1 && (node.matches(dynamicControls) || node.querySelector(dynamicControls)))) {
                prunePending = true;
                if (frame === null) frame = requestAnimationFrame(flushRoots);
            }
        }
    });
    observer.observe(document.getElementById('top-settings-holder'), { childList: true, subtree: true });
    document.getElementById('top-settings-holder').addEventListener('change', event => {
        if (event.target.id === 'bai_bai_toolkit_world_info_list_optimization_enabled') {
            fullPending = true;
            if (frame === null) frame = requestAnimationFrame(flushRoots);
            return;
        }
        queueRoot(event.target);
        const related = document.getElementById(event.target.dataset?.for);
        if (related?.type === 'range') queueRoot(related);
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
    for (const name of ['SETTINGS_UPDATED','MAIN_API_CHANGED']) if (context.eventTypes[name]) context.eventSource.on(context.eventTypes[name], refresh);
    function refresh() {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null; pendingRoots.clear(); prunePending = false; fullPending = false;
        decorate(); refreshPromptViewport();
    }
    return { refreshActions, refresh };
}
