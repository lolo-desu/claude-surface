// Native messages include all six controls even for empty, closed reasoning.
// Performance mode draws their glyphs with CSS masks instead of six SVG trees.
const controls = [['copy','copy'], ['edit','edit'], ['close_all','collapse'], ['edit_done','check'], ['edit_cancel','close'], ['delete','trash']];

export function createReasoningIcons({ svg }) {
    const owned = new WeakMap();
    const svgControls = new WeakMap();
    let revision = 0;
    function decorate(message, { enabled, lightweight }) {
        const actions = message.querySelector('.mes_reasoning_actions');
        if (!actions) return;
        for (const [name, icon] of controls) {
            const control = actions.querySelector(`.mes_reasoning_${name}`);
            if (!control) continue;
            let record = owned.get(control);
            const removeSVG = () => {
                if (!record?.svg) return;
                if (record.svg.parentNode === control) record.svg.remove();
                control.classList.remove('cu-reasoning-icon'); record.svg = null;
            };
            const removeMask = () => {
                if (record?.mask && control.getAttribute('data-cu-reasoning-mask') === record.mask) control.removeAttribute('data-cu-reasoning-mask');
                if (record) record.mask = null;
            };
            // Respect third-party glyphs/labels instead of replacing children.
            const custom = [...control.childNodes].some(node => node !== record?.svg && (node.nodeType === 1 || node.textContent.trim()));
            if (!enabled || custom) {
                removeSVG(); removeMask(); owned.delete(control); continue;
            }
            if (!record) { record = {}; owned.set(control, record); }
            if (lightweight) {
                removeSVG();
                if (control.getAttribute('data-cu-reasoning-mask') !== icon) control.setAttribute('data-cu-reasoning-mask', icon);
                record.mask = icon;
            } else {
                removeMask();
                if (record.svg?.parentNode === control) continue;
                control.insertAdjacentHTML('beforeend', svg(icon));
                record.svg = control.lastElementChild;
                svgControls.set(record.svg, control);
                control.classList.add('cu-reasoning-icon');
            }
        }
    }
    function cancel() { revision++; }
    function isOwnMutation(mutation) {
        const control = mutation.target, current = owned.get(control)?.svg;
        const added = [...mutation.addedNodes], removed = [...mutation.removedNodes];
        if (!added.length && !removed.length) return false;
        // External removal of our CURRENT SVG still needs normal decoration
        // to repair the icon. Ignore removals only after we relinquished it.
        return added.every(node => svgControls.get(node) === control && node === current)
            && removed.every(node => svgControls.get(node) === control && node !== current);
    }
    async function refreshAll(root, { enabled, lightweight }) {
        const ticket = ++revision;
        const view = root.ownerDocument?.defaultView || globalThis;
        const now = () => view.performance?.now?.() ?? Date.now();
        const yieldToMain = () => typeof view.scheduler?.yield === 'function'
            ? view.scheduler.yield()
            : new Promise(resolve => {
                if (view.setTimeout) view.setTimeout(resolve, 0);
                else globalThis.setTimeout(resolve, 0);
            });
        const messages = root.querySelectorAll(':scope > .mes');
        let count = 0, deadline = now() + 8;
        for (let index = 0; index < messages.length; index++) {
            if (ticket !== revision) return false;
            const message = messages[index];
            if (message.parentElement === root && message.isConnected !== false) {
                const options = { enabled: enabled(), lightweight: lightweight() };
                if (ticket !== revision) return false;
                decorate(message, options);
            }
            if ((++count >= 40 || now() >= deadline) && index + 1 < messages.length) {
                await yieldToMain();
                if (ticket !== revision) return false;
                count = 0; deadline = now() + 8;
            }
        }
        return true;
    }
    // Retain the direct decorator API while callers adopt the controller.
    return Object.assign(decorate, { decorate, refreshAll, cancel, isOwnMutation });
}
