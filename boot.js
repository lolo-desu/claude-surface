/* Optional early stylesheet: loaded from the document head, before SillyTavern starts. */
(() => {
    let config = { enabled: true, mode: 'dark' };
    try { config = { ...config, ...JSON.parse(localStorage.getItem('claude-surface-boot') || '{}') }; } catch { /* Use defaults. */ }
    if (!config.enabled) return;
    const root = document.documentElement;
    const design = ['material', 'adwaita', 'swiss'].includes(config.design) ? config.design : 'claude';
    const mode = ['light', 'dark'].includes(config.mode) ? config.mode : config.mode === 'companion' && ['light', 'dark'].includes(config.resolvedMode)
        ? config.resolvedMode : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.setAttribute('data-cu-boot', '');
    root.dataset.cuBootMode = mode;
    root.dataset.cuBootDesign = design;
    const palettes = {
        material: { light: ['#f8fafd', '#1f1f1f', '#0b57d0'], dark: ['#131314', '#e3e3e3', '#a8c7fa'] },
        adwaita: { light: ['#ffffff', '#303034', '#1c71d8'], dark: ['#222226', '#fafafa', '#99c1f1'] },
        swiss: { light: ['#f3f0e8', '#193c35', '#c43e2b'], dark: ['#171717', '#f1eee8', '#ef795b'] },
    };
    if (design !== 'claude') {
        ['bg', 'text', 'accent'].forEach((key, index) => {
            const saved = config.colors?.[key];
            root.style.setProperty('--cu-boot-' + key, /^#[a-f0-9]{6}([a-f0-9]{2})?$/i.test(saved || '') ? saved : palettes[design][mode][index]);
        });
    }
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('./boot.css', document.currentScript.src).href;
    document.head.append(style);
})();
