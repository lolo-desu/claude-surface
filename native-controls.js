// Native drawer identity is stable; toolbar position is not. Third-party
// extensions may insert or reorder drawers and retain their own controls.
const drawers = {
    'ai-config-button': { label: '预设', icon: 'sliders' },
    'sys-settings-button': { label: 'API 连接', icon: 'plug' },
    'advanced-formatting-button': { label: '回复格式', icon: 'type' },
    'WI-SP-button': { label: '世界书', icon: 'book' },
    'user-settings-button': { label: '用户设置', icon: 'sliders' },
    'backgrounds-button': { label: '背景', icon: 'image' },
    'extensions-settings-button': { label: '扩展程序', icon: 'puzzle' },
    'persona-management-button': { label: '用户设定', icon: 'user' },
    'rightNavHolder': { label: '角色卡', icon: 'people', characters: true },
};

export function nativeDrawerControl(element) {
    const id = element.closest('.drawer')?.id;
    return Object.hasOwn(drawers, id) ? drawers[id] : null;
}
