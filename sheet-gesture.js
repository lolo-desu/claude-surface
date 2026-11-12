// Keep native upward/content scrolling. Claim only a downward, single-finger
// gesture that starts at the top of the touched scroll container.
export function setupSheetGesture({ panel, handle, enabled, dismiss }) {
    const doc = panel.ownerDocument;
    let gesture = null, dismissing = false;
    const clearDrag = () => {
        gesture = null;
        panel.classList.remove('cu-dragging');
        panel.style.removeProperty('transform');
    };
    function blockClick() {
        const stop = event => { event.preventDefault(); event.stopImmediatePropagation(); };
        const clear = () => {
            clearTimeout(timer);
            doc.removeEventListener('click', stop, true);
            doc.removeEventListener('pointerdown', clear, true);
            doc.removeEventListener('touchstart', clear, true);
        };
        const timer = setTimeout(clear, 400);
        doc.addEventListener('click', stop, true);
        doc.addEventListener('pointerdown', clear, { once: true, capture: true });
        doc.addEventListener('touchstart', clear, { once: true, capture: true, passive: true });
    }
    function begin(x, y, target, pointer) {
        if (!enabled() || target.closest('input,textarea,select,a,[contenteditable="true"],[role="slider"]')) return;
        for (let node = target; node && panel.contains(node); node = node.parentElement) {
            if (node.scrollTop > 1) return;
            if (node === panel) break;
        }
        gesture = { x, y, lastY: y, time: performance.now(), velocity: 0, distance: 0, active: false, pointer };
    }
    function move(x, y, event) {
        if (!gesture) return;
        const dx = x - gesture.x, dy = y - gesture.y;
        if (!gesture.active) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
            if (dy <= 0 || Math.abs(dx) >= dy || !event.cancelable) { gesture = null; return; }
            gesture.active = true;
            // Stop the entrance animation once, so a cancelled drag springs
            // back without replaying the entrance animation.
            panel.style.animation = 'none';
            panel.classList.add('cu-dragging');
        }
        event.preventDefault();
        const now = performance.now();
        gesture.velocity = (y - gesture.lastY) / Math.max(1, now - gesture.time);
        gesture.lastY = y; gesture.time = now;
        gesture.distance = Math.max(0, dy);
        panel.style.transform = `translateY(${gesture.distance}px)`;
    }
    function finish(event, cancelled = false) {
        if (!gesture) return;
        if (!gesture.active) { gesture = null; return; }
        if (event.cancelable) event.preventDefault();
        blockClick();
        const { distance, velocity, time } = gesture;
        const flick = distance >= 20 && velocity > 0.55 && performance.now() - time < 100;
        if (!cancelled && (distance >= 48 || flick)) {
            dismissing = true;
            panel.classList.remove('cu-dragging');
            panel.style.setProperty('--cu-sheet-release-y', `${distance}px`);
            panel.style.animation = 'cu-sheet-swipe-out 180ms ease both';
            gesture = null;
            dismiss();
        } else clearDrag();
    }
    const startTouch = event => {
        if (event.touches.length !== 1) { clearDrag(); return; }
        const touch = event.touches[0]; begin(touch.clientX, touch.clientY, event.target);
    };
    const moveTouch = event => {
        if (event.touches.length !== 1) { clearDrag(); return; }
        const touch = event.touches[0]; move(touch.clientX, touch.clientY, event);
    };
    const endTouch = event => finish(event);
    const cancelTouch = event => finish(event, true);
    const startPointer = event => {
        if (event.pointerType === 'touch' || event.button !== 0 || !handle.contains(event.target)) return;
        begin(event.clientX, event.clientY, event.target, event.pointerId);
        if (gesture) handle.setPointerCapture(event.pointerId);
    };
    const movePointer = event => { if (gesture?.pointer === event.pointerId) move(event.clientX, event.clientY, event); };
    const endPointer = event => { if (gesture?.pointer === event.pointerId) finish(event, event.type === 'pointercancel'); };
    const listeners = [
        ['touchstart', startTouch, { passive: true }], ['touchmove', moveTouch, { passive: false }],
        ['touchend', endTouch, { passive: false }], ['touchcancel', cancelTouch, { passive: false }],
        ['pointerdown', startPointer], ['pointermove', movePointer], ['pointerup', endPointer], ['pointercancel', endPointer],
    ];
    for (const [type, listener, options] of listeners) panel.addEventListener(type, listener, options);
    return () => {
        if (gesture?.active) blockClick();
        for (const [type, listener, options] of listeners) panel.removeEventListener(type, listener, options);
        if (!dismissing) { clearDrag(); panel.style.removeProperty('animation'); }
    };
}
