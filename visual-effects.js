export const visualEffectControls = [
    { key: 'uiTransparency', label: '界面透明度', min: 0, max: 100, initial: 12, unit: '%' },
    { key: 'uiBlur', label: '界面毛玻璃', min: 0, max: 32, initial: 8, unit: 'px' },
    { key: 'backgroundDim', label: '背景变暗', min: 0, max: 100, initial: 30, unit: '%', backgroundOnly: true },
    { key: 'backgroundBlur', label: '背景模糊', min: 0, max: 24, initial: 0, unit: 'px', backgroundOnly: true },
];

export function visualEffectsOf(config = {}) {
    return Object.fromEntries(visualEffectControls.map(control => {
        const raw = config[control.key];
        const number = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
        return [control.key, Number.isFinite(number) ? Math.round(Math.min(control.max, Math.max(control.min, number))) : control.initial];
    }));
}

const properties = ['--cu-ui-opacity', '--cu-ui-backdrop', '--cu-background-filter', '--cu-background-spread', '--cu-reading-opacity'];

// Change surface paint only; never set opacity/filter on messages or layout containers.
export function applyVisualEffects(body, config) {
    const values = visualEffectsOf(config);
    body.classList.toggle('cu-glass-enabled', !!config.enabled && (values.uiTransparency > 0 || values.uiBlur > 0));
    body.classList.toggle('cu-background-blurred', !!config.enabled && !!config.background && values.backgroundBlur > 0);
    if (!config.enabled) {
        for (const property of properties) body.style.removeProperty(property);
        return values;
    }
    const opacity = 100 - values.uiTransparency;
    const css = [
        opacity + '%',
        values.uiBlur ? `blur(${values.uiBlur}px)` : 'none',
        `blur(${values.backgroundBlur}px) brightness(${(100 - values.backgroundDim) / 100})`,
        values.backgroundBlur * 3 + 'px',
        Math.round(opacity * .6) + '%',
    ];
    properties.forEach((property, index) => body.style.setProperty(property, css[index]));
    return values;
}
