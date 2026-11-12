/* Fixed native editors share normal-scale visible-viewport bounds. */
export function setupMobilePanelViewport(settings, panel, prefix) {
    if (!panel) return () => {};
    const mobile = matchMedia('(max-width: 899px), (max-width: 1100px) and (pointer: coarse)');
    let viewportFrame, viewportActive = false;
    const viewportProperties = ['width','height','top','left'].map(name => `--cu-${prefix}-view-${name}`);
    function refreshViewport() {
        const active = settings().enabled && mobile.matches && panel?.classList.contains('openDrawer') && !panel.classList.contains('closedDrawer');
        const viewport = window.visualViewport;
        // Follow keyboard/address-bar changes at normal scale. Pinch zoom keeps
        // the layout viewport, rather than shrinking the editor under the user.
        if (!active || (viewport && Math.abs(viewport.scale - 1) > .02)) {
            for (const property of viewportProperties) document.body.style.removeProperty(property);
        } else {
            if (!viewportActive) window.scrollTo(0, 0);
            const values = [viewport?.width || window.innerWidth, viewport?.height || window.innerHeight, viewport?.offsetTop || 0, viewport?.offsetLeft || 0];
            viewportProperties.forEach((property,index) => document.body.style.setProperty(property, `${Math.round(values[index] * 100) / 100}px`));
        }
        viewportActive = !!active;
    }
    const queueViewport = () => { cancelAnimationFrame(viewportFrame); viewportFrame = requestAnimationFrame(refreshViewport); };
    const guardedPortals = new WeakSet();
    jQuery(document).on(`select2:open.claudeSurface${prefix}Viewport`, event => {
        if (!settings().enabled || !mobile.matches || !panel.contains(event.target)) return;
        const portal = document.querySelector('.select2-container--open .select2-dropdown');
        if (!portal || guardedPortals.has(portal)) return;
        guardedPortals.add(portal);
        for (const type of ['mousedown','touchstart']) portal.addEventListener(type, press => {
            if (settings().enabled && mobile.matches && panel.classList.contains('openDrawer')) press.stopPropagation();
        }, { passive: true });
    });
    new MutationObserver(queueViewport).observe(panel, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', queueViewport);
    window.visualViewport?.addEventListener('resize', queueViewport);
    window.visualViewport?.addEventListener('scroll', queueViewport);
    mobile.addEventListener('change', queueViewport);
    refreshViewport();
    return refreshViewport;
}

/* Adapt semantic fields once. Keep native nodes, editor instances and events. */
export function setupMobileWorldInfo(settings, { toggleDrawer, externalLayout = () => false, ui = text => text } = {}) {
    const mobile = matchMedia('(max-width: 899px), (max-width: 1100px) and (pointer: coarse)');
    const panel = document.getElementById('WorldInfo');
    const list = document.getElementById('world_popup_entries_list');
    const headers = new Map(), editors = new Map();
    const toolbarLabels = new Map();
    const managementLabels = {
        world_import_button: ui('导入'), world_popup_export: ui('导出'), world_popup_name_button: ui('重命名'),
        world_duplicate: ui('复制'), world_popup_delete: ui('删除'), OpenAllWIEntries: ui('展开全部'),
        CloseAllWIEntries: ui('收起全部'), world_backfill_memos: ui('填充标题'), world_apply_current_sorting: ui('应用排序'),
    };
    let toolsButton;
    const refreshViewport = setupMobilePanelViewport(settings, panel, 'world');
    let frame;
    const observe = () => observer.observe(list, { childList: true, subtree: true });
    function move(node, destination, record, className) {
        if (!node) return;
        const anchor = document.createComment('Claude Surface: native field position');
        node.before(anchor); destination.append(node);
        record.nodes.push({ node, anchor });
        if (className) { node.classList.add(className); record.classes.push({ node, className }); }
    }
    function restore(record) {
        for (const { node, anchor } of record.nodes) if (anchor.isConnected) anchor.replaceWith(node);
        for (const { node, className } of record.classes) node.classList.remove(className);
        for (const wrapper of record.wrappers) wrapper.remove();
    }
    function release() {
        list?.classList.remove('cu-wi-layout');
        observer.disconnect();
        try {
            for (const map of [headers, editors]) {
                for (const [element, record] of map) if (element.isConnected) restore(record);
                map.clear();
            }
        } finally { observe(); }
    }
    function refreshToolbar(active) {
        if (!active) {
            toolsButton?.remove(); toolsButton = null;
            panel?.classList.remove('cu-wi-tools-open');
            for (const [node, old] of toolbarLabels) {
                for (const [key, value] of Object.entries(old)) {
                    if (value === undefined) delete node.dataset[key]; else node.dataset[key] = value;
                }
            }
            toolbarLabels.clear();
            return;
        }
        const root = panel.querySelector('.bai-bai-wi-popup-header') || document.getElementById('world_popup');
        if (!root) return;
        for (const [node] of toolbarLabels) if (!node.isConnected) toolbarLabels.delete(node);
        for (const [id, label] of Object.entries({ ...managementLabels, world_popup_new: ui('新条目') })) {
            const node = document.getElementById(id);
            if (!node) continue;
            if (!toolbarLabels.has(node)) toolbarLabels.set(node, { cuWiLabel: node.dataset.cuWiLabel, cuWiTool: node.dataset.cuWiTool });
            node.dataset.cuWiLabel = label;
            if (id in managementLabels) node.dataset.cuWiTool = 'true';
        }
        if (!toolsButton) {
            toolsButton = document.createElement('button'); toolsButton.type = 'button';
            toolsButton.className = 'cu-wi-tools-toggle';
            toolsButton.setAttribute('aria-label', ui('更多世界书操作'));
            toolsButton.setAttribute('aria-controls', 'world_popup');
            const icon = document.createElement('i'); icon.className = 'fa-solid fa-ellipsis'; icon.setAttribute('aria-hidden', 'true');
            const text = document.createElement('span'); text.textContent = ui('更多'); toolsButton.append(icon, text);
            toolsButton.addEventListener('click', () => {
                const expanded = panel.classList.toggle('cu-wi-tools-open');
                toolsButton.setAttribute('aria-expanded', String(expanded));
            });
        }
        if (toolsButton.parentElement !== root) root.append(toolsButton);
        toolsButton.setAttribute('aria-expanded', String(panel.classList.contains('cu-wi-tools-open')));
    }
    function adaptHeader(header) {
        if (headers.has(header) || header.closest('[data-bai-bai-world-info-mobile-header-layout="true"]')) return;
        const title = header.querySelector('.WIEntryTitleAndStatus');
        if (!title) return;
        const record = { nodes: [], classes: [], wrappers: [] };
        header.classList.add('cu-wi-header'); record.classes.push({ node: header, className: 'cu-wi-header' });
        const rows = ['title','position','actions'].map(name => {
            const row = document.createElement('div'); row.className = `cu-wi-${name}-row`;
            record.wrappers.push(row); return row;
        });
        const numbers = document.createElement('div'); numbers.className = 'cu-wi-numbers';
        const actions = document.createElement('div'); actions.className = 'cu-wi-buttons';
        rows[2].append(numbers, actions); record.wrappers.push(numbers, actions);
        header.prepend(...rows);
        const field = name => header.querySelector(`[name="${name}"]`)?.closest('.world_entry_form_control');
        move(title, rows[0], record);
        move(header.querySelector('.drag-handle'), rows[0], record);
        move(field('position'), rows[1], record, 'cu-wi-position-field');
        move(field('depth'), rows[1], record, 'cu-wi-depth-field');
        move(header.querySelector('.killSwitch'), rows[1], record);
        move(field('order'), numbers, record, 'cu-wi-order-field');
        move(field('probability'), numbers, record, 'cu-wi-probability-field');
        for (const selector of ['.move_entry_button','.duplicate_entry_button','.delete_entry_button','.inline-drawer-toggle']) {
            move(header.querySelector(selector), actions, record);
        }
        for (const node of header.querySelectorAll('.world_entry_thin_controls')) {
            if (!node.textContent.trim() && !node.querySelector('input,textarea,select,button,.menu_button,[role="button"]')) {
                node.classList.add('cu-wi-vacant'); record.classes.push({ node, className: 'cu-wi-vacant' });
            }
        }
        headers.set(header, record);
    }
    function adaptEditor(editor) {
        if (editors.has(editor) || editor.matches('[data-bai-bai-world-info-mobile-expanded-layout="true"]')) return;
        const record = { nodes: [], classes: [], wrappers: [] };
        const details = document.createElement('details'); details.className = 'cu-wi-advanced';
        const summary = document.createElement('summary'); summary.textContent = ui('更多条目设置');
        details.append(summary); record.wrappers.push(details);
        const candidates = [...editor.children].slice(1);
        const overrides = editor.querySelector('[name="perEntryOverridesBlock"]');
        if (overrides) candidates.unshift(overrides);
        for (const node of candidates) move(node, details, record);
        editor.append(details); editors.set(editor, record);
        const content = editor.querySelector('textarea[name="content"]')?.closest('.world_entry_form_control');
        const heading = content?.querySelector(':scope > label');
        if (content && heading) {
            content.classList.add('cu-wi-content-field'); record.classes.push({ node: content, className: 'cu-wi-content-field' });
            heading.classList.add('cu-wi-content-heading'); record.classes.push({ node: heading, className: 'cu-wi-content-heading' });
            const labels = [...heading.querySelectorAll('label.checkbox')].filter(label => label.querySelector('input[name="excludeRecursion"],input[name="preventRecursion"],input[name="delay_until_recursion"],input[name="ignoreBudget"]'));
            if (labels.length) {
                const sourceGroup = labels[0].parentElement.parentElement;
                const flags = document.createElement('div'); flags.className = 'cu-wi-content-flags';
                const containsAll = labels.every(label => sourceGroup.contains(label));
                for (const label of labels) move(label, flags, record);
                content.append(flags); record.wrappers.push(flags);
                if (containsAll && !sourceGroup.querySelector('input,select,textarea,button')) {
                    sourceGroup.classList.add('cu-wi-flags-source'); record.classes.push({ node: sourceGroup, className: 'cu-wi-flags-source' });
                }
            }
        }
    }
    function refresh() {
        refreshViewport();
        panel?.classList.toggle('cu-world-surface', settings().enabled && mobile.matches);
        refreshToolbar(settings().enabled && mobile.matches);
        list.dataset.cuEmptyMessage = document.getElementById('world_editor_select')?.value ? ui('没有匹配的条目') : ui('选择世界书后，在这里查看和编辑条目');
        observer.disconnect();
        try {
            const enabled = settings().enabled && mobile.matches && !externalLayout();
            list.classList.toggle('cu-wi-layout', enabled);
            for (const map of [headers, editors]) for (const [element, record] of map) {
                if (!element.isConnected) { map.delete(element); continue; }
                if (!enabled) { restore(record); map.delete(element); }
            }
            if (!enabled) return;
            list.querySelectorAll('.world_entry > form > .inline-drawer > .inline-drawer-header').forEach(adaptHeader);
            list.querySelectorAll('.world_entry_edit').forEach(adaptEditor);
        } finally { observe(); }
    }
    const relevant = node => node.nodeType === 1 && (node.matches('.world_entry,.world_entry_edit') || node.querySelector('.world_entry,.world_entry_edit'));
    const observer = new MutationObserver(records => {
        // Ignore CodeMirror transactions and token counters: they add no fields.
        if (!records.some(record => [...record.addedNodes,...record.removedNodes].some(relevant))) return;
        cancelAnimationFrame(frame); frame = requestAnimationFrame(refresh);
    });
    if (!list) return { refresh() {} };
    if (panel) new MutationObserver(records => {
        if (!records.some(record => [...record.addedNodes,...record.removedNodes].some(node => node.nodeType === 1 && node.matches('.bai-bai-wi-popup-header')))) return;
        cancelAnimationFrame(frame); frame = requestAnimationFrame(refresh);
    }).observe(panel, { childList: true, subtree: true });
    observe();
    document.getElementById('world_editor_select')?.addEventListener('change', () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(refresh); });
    list.addEventListener('click', event => {
        if (!settings().enabled || !mobile.matches || externalLayout() || !toggleDrawer) return;
        const toggle = event.target.closest('.world_entry .inline-drawer-toggle');
        if (!toggle || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
        const drawer = toggle.closest('.inline-drawer');
        const open = !drawer.querySelector(':scope > .inline-drawer-header .inline-drawer-icon')?.classList.contains('up');
        event.preventDefault(); event.stopImmediatePropagation();
        toggleDrawer(drawer, open);
    }, true);
    list.addEventListener('inline-drawer-toggle', event => {
        if (!settings().enabled || !mobile.matches || externalLayout()) return;
        const drawer = event.target;
        queueMicrotask(() => {
            const content = drawer.querySelector(':scope > .inline-drawer-content');
            const icon = drawer.querySelector(':scope > .inline-drawer-header .inline-drawer-icon');
            if (!content || !icon) return;
            jQuery(content).stop(true, true);
            for (const animation of content.getAnimations?.() || []) animation.cancel();
            content.style.removeProperty('height'); content.style.removeProperty('overflow');
            content.style.display = icon.classList.contains('up') ? 'block' : 'none';
        });
    });
    mobile.addEventListener('change', refresh);
    refresh();
    return { refresh, release };
}
