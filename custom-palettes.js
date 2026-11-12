// Custom files contain color data only. They never provide selectors or CSS text.
export const colorFields = Object.freeze([
    ['bg', '主背景', '界面背景'], ['sidebar', '侧栏背景', '界面背景'],
    ['surface', '面板背景', '界面背景'], ['input', '输入栏背景', '界面背景'],
    ['user', '用户消息背景', '界面背景'], ['code', '代码块背景', '界面背景'],
    ['overlay', '遮罩颜色', '界面背景'],
    ['text', '主要文本', '文字'], ['muted', '次要文本', '文字'], ['link', '链接文本', '文字'],
    ['quote', '引用文本', '文字'], ['italic', '斜体文本', '文字'], ['underline', '下划线文本', '文字'],
    ['border', '边框颜色', '交互'], ['input-border', '输入栏边框', '交互'],
    ['hover', '悬停背景', '交互'], ['selected', '选中背景', '交互'],
    ['accent', '主题强调色', '交互'], ['on-accent', '强调色文字', '交互'],
    ['syntax-keyword', '代码关键字', '代码语法'], ['syntax-string', '代码字符串', '代码语法'],
    ['syntax-title', '代码标题与函数', '代码语法'], ['syntax-number', '代码数字', '代码语法'],
    ['syntax-comment', '代码注释', '代码语法'],
].map(([key, label, group]) => Object.freeze({ key, label, group })));

export const customPaletteSchema = 'claude-surface-palette';
export const maxCustomPaletteBytes = 128 * 1024;
export const maxCustomPalettes = 64;
const designs = new Set(['claude', 'material', 'adwaita', 'swiss']);
const fields = new Set(colorFields.map(field => field.key));
const topFields = new Set(['schema', 'version', 'id', 'label', 'design', 'swatch', 'light', 'dark']);
const idPattern = /^custom-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message, code = 'invalid-palette') {
    const error = new Error(message);
    error.code = code;
    throw error;
}

function dataObject(value, allowed, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${name}必须是普通对象`);
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (typeof key !== 'string' || !allowed.has(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            fail(`${name}包含不支持的字段`);
        }
    }
    return value;
}

export function normalizeColor(value) {
    if (typeof value !== 'string' || !/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(value)) {
        fail('颜色必须是 #RGB、#RGBA、#RRGGBB 或 #RRGGBBAA', 'invalid-color');
    }
    const hex = value.slice(1).toLowerCase();
    return '#' + (hex.length < 5 ? [...hex].map(char => char + char).join('') : hex);
}

function normalizeTokens(raw, mode) {
    dataObject(raw, fields, `${mode}颜色`);
    const result = {};
    for (const { key } of colorFields) {
        if (!Object.hasOwn(raw, key)) fail(`${mode}缺少颜色：${key}`, 'missing-color');
        result[key] = normalizeColor(raw[key]);
    }
    return result;
}

export function normalizeCustomPalette(raw) {
    dataObject(raw, topFields, '配色');
    for (const key of topFields) if (!Object.hasOwn(raw, key)) fail(`配色缺少字段：${key}`, 'missing-field');
    if (raw.schema !== customPaletteSchema || raw.version !== 1) fail('配色文件格式或版本不受支持', 'unsupported-schema');
    if (typeof raw.id !== 'string' || !idPattern.test(raw.id)) fail('配色 ID 必须为 custom- 加 UUID', 'invalid-id');
    if (typeof raw.label !== 'string' || raw.label.length > 120 || !raw.label.trim() || [...raw.label.trim()].length > 60 || /[\x00-\x1f\x7f]/.test(raw.label)) {
        fail('配色名称须为 1 至 60 个字符', 'invalid-label');
    }
    if (!designs.has(raw.design)) fail('配色所属风格不受支持', 'invalid-design');
    return {
        schema: customPaletteSchema, version: 1, id: raw.id.toLowerCase(), label: raw.label.trim(),
        design: raw.design, swatch: normalizeColor(raw.swatch),
        light: normalizeTokens(raw.light, '浅色'), dark: normalizeTokens(raw.dark, '深色'),
    };
}

function checkedText(text) {
    if (typeof text !== 'string') fail('配色文件为空', 'empty-file');
    if (text.length > maxCustomPaletteBytes || new TextEncoder().encode(text).byteLength > maxCustomPaletteBytes) {
        fail('配色文件超过 128 KiB', 'file-too-large');
    }
    if (!text.trim()) fail('配色文件为空', 'empty-file');
    return text.replace(/^\uFEFF/, '');
}

export function parseCustomPalette(text, { parseYAML } = {}) {
    text = checkedText(text);
    let raw;
    try { raw = JSON.parse(text); }
    catch {
        if (typeof parseYAML !== 'function') fail('文件不是有效 JSON；导入 YAML 需要 YAML 解析器', 'invalid-file');
        try { raw = parseYAML(text, { maxAliasCount: 0, uniqueKeys: true, strict: true, schema: 'core' }); }
        catch { fail('文件不是有效 JSON 或安全 YAML', 'invalid-file'); }
    }
    return normalizeCustomPalette(raw);
}

export function serializeCustomPalette(palette, format = 'json', { stringifyYAML } = {}) {
    const normalized = normalizeCustomPalette(palette);
    if (format === 'json') return JSON.stringify(normalized, null, 2) + '\n';
    if (format !== 'yaml' && format !== 'yml') fail('仅支持 JSON 或 YAML 导出', 'invalid-format');
    if (typeof stringifyYAML !== 'function') fail('导出 YAML 需要 YAML 序列化器', 'missing-yaml');
    let text;
    try { text = stringifyYAML(normalized, { aliasDuplicateObjects: false, lineWidth: 0 }); }
    catch { fail('无法导出 YAML 配色', 'invalid-file'); }
    return checkedText(text);
}

export function customPaletteOptions(config = {}, design = config?.design) {
    if (!designs.has(design) || !Array.isArray(config?.customPalettes)) return [];
    const options = [], seen = new Set();
    for (const entry of config.customPalettes.slice(0, maxCustomPalettes)) {
        try {
            const palette = normalizeCustomPalette(entry);
            if (palette.design !== design || seen.has(palette.id)) continue;
            seen.add(palette.id); options.push(palette);
        } catch { /* Invalid saved entries cannot become CSS. */ }
    }
    return options;
}

const applied = new WeakMap();
function restore(body) {
    const records = applied.get(body);
    if (!records) return;
    for (const [property, record] of records) {
        if (body.style.getPropertyValue(property) !== record.applied || body.style.getPropertyPriority(property) !== '') continue;
        if (record.value) body.style.setProperty(property, record.value, record.priority);
        else body.style.removeProperty(property);
    }
    applied.delete(body);
}

export function applyCustomPalette(body, config = {}, mode) {
    if (!body?.style) return null;
    if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};
    const design = designs.has(config.design) ? config.design : 'claude';
    const selections = config.designPalettes;
    const id = selections && typeof selections === 'object' && !Array.isArray(selections) && Object.hasOwn(selections, design) ? selections[design] : null;
    const palette = config.enabled && ['light', 'dark'].includes(mode) ? customPaletteOptions(config, design).find(item => item.id === id) : null;
    if (!palette) { restore(body); return null; }
    const records = applied.get(body) || new Map();
    for (const { key } of colorFields) {
        const property = `--cu-${key}`, value = palette[mode][key];
        const current = body.style.getPropertyValue(property), priority = body.style.getPropertyPriority(property);
        let record = records.get(property);
        // A third party may have changed an inline token while the editor was open.
        // Preserve that latest value for restoration, rather than an old snapshot.
        if (!record || current !== record.applied || priority !== '') record = { value: current, priority };
        if (current !== value || priority !== '') body.style.setProperty(property, value);
        record.applied = value; records.set(property, record);
    }
    applied.set(body, records);
    return palette;
}
