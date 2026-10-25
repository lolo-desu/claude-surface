export const designs = [
    { id: 'claude', label: 'Claude' },
    { id: 'material', label: 'Material Design', theme: 'Claude Surface Material' },
    { id: 'adwaita', label: 'Adwaita', theme: 'Claude Surface Adwaita' },
    { id: 'swiss', label: 'FlatDesign', theme: 'SillyTavern FlatDesign', file: 'Claude Surface Swiss.json', aliases: ['Claude Surface Swiss'] },
];
export const designOf = id => designs.find(item => item.id === id) || designs[0];
export const designForTheme = name => designs.find(item => item.theme === name || item.aliases?.includes(name));
export function appearanceMode(config) {
    if (config.mode === 'companion' && globalThis.document?.body?.classList.contains('cu-theme-companion')) {
        const classes = document.documentElement.classList;
        if (classes.contains('dn-day')) return 'light';
        if (classes.contains('dn-night')) return 'dark';
    }
    return ['light', 'dark'].includes(config.mode) ? config.mode : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
