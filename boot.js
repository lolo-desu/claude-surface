/* Optional early stylesheet: loaded from the document head, before SillyTavern starts. */
(() => {
    let config = { enabled: true, mode: 'dark' };
    try { config = { ...config, ...JSON.parse(localStorage.getItem('claude-surface-boot') || '{}') }; } catch { /* Use defaults. */ }
    if (!config.enabled) return;
    document.documentElement.setAttribute('data-cu-boot', '');
    document.documentElement.dataset.cuBootMode = config.mode === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : config.mode;
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('./boot.css', document.currentScript.src).href;
    document.head.append(style);
})();
