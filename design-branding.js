// Original geometry for design families; these are not AI vendor marks.
export const designMarks = {
    material: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="17" height="17" rx="6" fill="currentColor" opacity=".45"/><path d="M15 12h8a6 6 0 0 1 6 6v5a6 6 0 0 1-6 6h-5a6 6 0 0 1-6-6v-8a3 3 0 0 1 3-3Z" fill="currentColor"/></svg>',
    adwaita: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="24" height="24" rx="6"/><path d="M4 12h24M10 18h12M10 23h7"/><circle cx="9" cy="8" r=".7" fill="currentColor" stroke="none"/></svg>',
    swiss: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="4" fill="currentColor" opacity=".16"/><path d="M8 8h16v7H8zM18 18h6v6h-6z" fill="currentColor"/><path d="M8 18h7v6H8z" fill="currentColor" opacity=".6"/></svg>',
};

export function designBrand(config) {
    return Object.hasOwn(designMarks, config.design) ? { name: 'SillyTavern', key: 'design:' + config.design, mark: designMarks[config.design], fixed: true } : null;
}
