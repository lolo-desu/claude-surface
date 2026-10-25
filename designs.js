export const designs = [
    { id: 'claude', label: 'Claude', note: '安静留白 · 柔和输入栏' },
    { id: 'material', label: 'Material Design', note: '分层表面 · 胶囊输入与柔和动效', theme: 'Claude Surface Material' },
    { id: 'adwaita', label: 'Adwaita', note: '居中标题 · 分组偏好与紧凑输入条', theme: 'Claude Surface Adwaita' },
    { id: 'swiss', label: '瑞士风格', note: '克制配色 · 精确字阶与轻边界', theme: 'Claude Surface Swiss' },
];
export const designOf = id => designs.find(item => item.id === id) || designs[0];
export function appearanceMode(config) {
    return ['light', 'dark'].includes(config.mode) ? config.mode : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
