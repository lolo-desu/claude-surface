import { yaml } from '../../../../lib.js';
import { uuidv4 } from '../../../utils.js';
import { designOf } from './designs.js';
import { colorFields, normalizeColor, normalizeCustomPalette, parseCustomPalette, serializeCustomPalette, customPaletteOptions, maxCustomPalettes } from './custom-palettes.js';

const MAX_FILE_SIZE = 128 * 1024;
const clone = value => JSON.parse(JSON.stringify(value));
const customId = () => `custom-${uuidv4()}`;
const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
};

// Resolve the current theme twice in an isolated document. The live body,
// selected palette and theme mode never change while a draft is being made.
function captureCurrentColors(design) {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
    frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${innerWidth}px;height:${innerHeight}px;visibility:hidden;pointer-events:none;border:0`;
    document.body.append(frame);
    try {
        const doc = frame.contentDocument;
        const styles = [];
        const readRules = sheet => {
            try {
                for (const rule of sheet.cssRules) {
                    if (rule.styleSheet) readRules(rule.styleSheet);
                    else styles.push(rule.cssText);
                }
            } catch { /* Cross-origin sheets cannot define extension colors. */ }
        };
        for (const sheet of document.styleSheets) if (!sheet.disabled) readRules(sheet);
        const style = doc.createElement('style'); style.textContent = styles.join('\n'); doc.head.append(style);
        for (const attr of document.body.attributes) if (!['id', 'style'].includes(attr.name)) doc.body.setAttribute(attr.name, attr.value);
        doc.body.dataset.cuDesign = design;
        // Preserve only color overrides belonging to the current theme.
        for (const { key } of colorFields) {
            const value = document.body.style.getPropertyValue(`--cu-${key}`);
            if (value) doc.body.style.setProperty(`--cu-${key}`, value);
        }
        const probe = doc.createElement('span'); doc.body.append(probe);
        const canvas = doc.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const colors = {};
        for (const mode of ['light', 'dark']) {
            doc.body.dataset.claudeUi = mode;
            const tokens = {};
            for (const { key } of colorFields) {
                probe.style.color = '';
                probe.style.color = `var(--cu-${key})`;
                const resolved = frame.contentWindow.getComputedStyle(probe).color;
                const rgb = resolved.match(/^rgba?\(([^)]+)\)$/);
                if (rgb) {
                    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
                    if (parts.length >= 3 && parts.every(Number.isFinite)) {
                        const bytes = [...parts.slice(0, 3), Math.round((parts[3] ?? 1) * 255)];
                        tokens[key] = normalizeColor('#' + bytes.slice(0, bytes[3] === 255 ? 3 : 4).map(n => Math.round(n).toString(16).padStart(2, '0')).join(''));
                        continue;
                    }
                }
                context.clearRect(0, 0, 1, 1); context.fillStyle = resolved; context.fillRect(0, 0, 1, 1);
                const bytes = context.getImageData(0, 0, 1, 1).data;
                const hex = [...bytes].map(n => n.toString(16).padStart(2, '0'));
                tokens[key] = normalizeColor('#' + hex.slice(0, bytes[3] === 255 ? 3 : 4).join(''));
            }
            colors[mode] = tokens;
        }
        return colors;
    } finally { frame.remove(); }
}

export function setupCustomPaletteUI({ settings, save, sheet, button, ui = text => text, applyAppearance, showAppearance }) {
    if (!document.getElementById('cu-custom-palettes-style')) {
        const stylesheet = document.createElement('link'); stylesheet.id = 'cu-custom-palettes-style'; stylesheet.rel = 'stylesheet';
        stylesheet.href = new URL('./custom-palettes.css', import.meta.url).href; document.head.append(stylesheet);
    }
    let sequence = 0;
    const action = (label, icon, run, className = '') => button(ui(label), icon, run, className);
    const describe = (parent, text) => parent.append(element('p', 'cu-custom-description', ui(text)));
    const errorBox = () => {
        const box = element('p', 'cu-custom-error'); box.hidden = true; box.setAttribute('role', 'alert'); return box;
    };
    const fail = (box, message, error) => {
        box.hidden = false;
        const details = {
            'invalid-color': '颜色必须是十六进制颜色，可包含透明度。',
            'missing-color': '配色缺少必要的颜色字段。',
            'invalid-label': '配色名称须为 1 至 60 个字符。',
            'unsupported-schema': '配色文件格式或版本不受支持。',
            'invalid-id': '配色文件的标识无效。',
            'invalid-design': '配色所属设计不受支持。',
            'file-too-large': '配色文件超过大小限制。',
            'invalid-file': '文件不是有效 JSON 或 YAML。',
            'invalid-palette': '配色数据包含不支持的字段。',
        };
        const detail = error?.code ? ui(details[error.code] || '请检查配色数据是否完整。') : error?.message;
        box.textContent = ui(message) + (detail ? ` ${detail}` : '');
    };
    const savedPalettes = () => {
        const raw = settings().customPalettes, result = [], seen = new Set();
        for (const entry of Array.isArray(raw) ? raw.slice(0, maxCustomPalettes) : []) {
            try {
                const palette = normalizeCustomPalette(entry), key = `${palette.design}:${palette.id}`;
                if (seen.has(key)) continue;
                seen.add(key); result.push(palette);
            } catch { /* Invalid stored rows do not consume an invisible slot. */ }
        }
        return result;
    };
    const hasRoom = () => savedPalettes().length < maxCustomPalettes;
    const page = title => {
        const content = sheet(ui(title)); content.classList.add('cu-custom-palettes'); return content;
    };
    const back = (content, label, run) => {
        const heading = content.closest?.('.cu-full-page')?.querySelector('.cu-sheet-heading');
        const control = action(label, 'chevron', run, 'cu-custom-back' + (heading ? ' cu-icon' : ''));
        if (heading) heading.prepend(control); else content.append(control);
    };
    const formats = (value, change) => {
        const select = element('select', 'cu-settings-select'); select.setAttribute('aria-label', ui('导出格式'));
        for (const format of ['json', 'yaml']) { const option = element('option', '', format.toUpperCase()); option.value = format; select.append(option); }
        select.value = value; select.addEventListener('change', () => change(select.value)); return select;
    };

    function openExport(palette, returnTo = open) {
        const content = page('导出配色'); back(content, '返回上一页', returnTo);
        describe(content, '可下载配色文件，或复制文本后在另一台设备导入。');
        let format = 'json';
        const text = element('textarea', 'cu-custom-transfer'); text.readOnly = true; text.spellcheck = false;
        text.setAttribute('aria-label', ui('配色内容'));
        const status = element('p', 'cu-custom-status'); status.setAttribute('role', 'status');
        const error = errorBox();
        const update = () => {
            try { text.value = serializeCustomPalette(palette, format, { stringifyYAML: yaml.stringify }); error.hidden = true; }
            catch (cause) { fail(error, '无法导出配色，请检查颜色和名称。', cause); }
        };
        const tools = element('div', 'cu-custom-toolbar');
        tools.append(formats(format, value => { format = value; update(); }), action('下载文件', 'arrow', () => {
            update(); if (!error.hidden) return;
            const blob = new Blob([text.value], { type: format === 'json' ? 'application/json' : 'application/yaml' });
            const url = URL.createObjectURL(blob), link = document.createElement('a');
            link.href = url; link.download = (palette.label.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_') || 'palette') + '.' + format;
            document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            status.textContent = ui('已准备下载。');
        }), action('复制文本', 'copy', async () => {
            try {
                if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text.value);
                else { text.focus(); text.select(); if (!document.execCommand('copy')) throw new Error(); }
                status.textContent = ui('已复制配色。');
            } catch { status.textContent = ui('请长按或选中文本，手动复制。'); text.focus(); text.select(); }
        }));
        content.append(tools, text, status, error); update();
    }

    function openImport() {
        const content = page('导入配色'); back(content, '返回自定义颜色', open);
        describe(content, '选择 JSON / YAML 文件，或粘贴配色文本。导入后可以先编辑，保存后才会应用。');
        const error = errorBox();
        const fileLabel = element('label', 'cu-custom-file'); fileLabel.append(element('span', '', ui('选择配色文件')));
        const file = element('input'); file.type = 'file'; file.accept = '.json,.yaml,.yml,application/json,application/yaml,text/yaml'; file.setAttribute('aria-label', ui('选择配色文件'));
        fileLabel.append(file);
        const textLabel = element('label', 'cu-custom-transfer-label'); textLabel.append(element('span', '', ui('配色文本')));
        const text = element('textarea', 'cu-custom-transfer'); text.spellcheck = false; text.placeholder = ui('在此粘贴 JSON 或 YAML'); textLabel.append(text);
        let readSequence = 0;
        text.addEventListener('input', () => {
            // Typing or pasting explicitly takes ownership from a pending file.
            ++readSequence; load.disabled = false; error.hidden = true;
        });
        file.addEventListener('change', async () => {
            const ticket = ++readSequence, selected = file.files?.[0];
            if (!selected) return;
            load.disabled = true;
            if (selected.size > MAX_FILE_SIZE) { fail(error, '文件过大，请选择不超过 128 KiB 的配色文件。'); return; }
            try {
                const value = await selected.text();
                if (ticket !== readSequence || !content.isConnected) return;
                text.value = value; load.disabled = false; error.hidden = true;
            } catch (cause) {
                if (ticket === readSequence && content.isConnected) fail(error, '无法读取文件，请重新选择。', cause);
            }
        });
        const load = action('导入并编辑', 'arrow', () => {
            if (load.disabled) return;
            if (!hasRoom()) { fail(error, '最多保存 64 套自定义配色，请先删除一套再导入。'); return; }
            if (!text.value.trim()) { fail(error, '请先选择文件或粘贴配色文本。'); text.focus(); return; }
            if (new Blob([text.value]).size > MAX_FILE_SIZE) { fail(error, '内容过大，请使用不超过 128 KiB 的配色。'); return; }
            try {
                const palette = parseCustomPalette(text.value, { parseYAML: yaml.parse });
                // Imports become a new choice in the current design. Existing
                // saved palettes are never replaced merely by importing a file.
                palette.id = customId(); palette.design = designOf(settings().design).id;
                openEditor(palette);
            } catch (cause) { fail(error, '无法导入：请检查配色文件的版本、颜色字段和十六进制颜色。', cause); }
        });
        content.append(fileLabel, textLabel, error, load);
    }

    function makePreview() {
        const preview = element('div', 'cu-custom-preview'); preview.setAttribute('aria-label', ui('配色预览'));
        const side = element('div', 'cu-custom-preview-sidebar'); side.setAttribute('aria-hidden', 'true');
        const body = element('div', 'cu-custom-preview-body');
        body.append(element('strong', 'cu-custom-preview-title', ui('主要文本')), element('span', 'cu-custom-preview-muted', ui('辅助文字')));
        const prose = element('div', 'cu-custom-preview-prose');
        for (const [tag, className, label] of [['em', 'cu-custom-preview-italic', '斜体'], ['u', 'cu-custom-preview-underline', '下划线'], ['q', 'cu-custom-preview-quote', '引用文字'], ['span', 'cu-custom-preview-link', '链接']]) prose.append(element(tag, className, ui(label)));
        const code = element('code', 'cu-custom-preview-code');
        for (const [className, label] of [['keyword', 'const '], ['title', 'reply'], ['', ' = '], ['string', '"Hello"'], ['', ' + '], ['number', '1'], ['comment', ' // …']]) code.append(element('span', className ? `cu-custom-preview-${className}` : '', label));
        const states = element('div', 'cu-custom-preview-states');
        states.append(element('span', 'cu-custom-preview-user', ui('用户背景')));
        for (const [state, label] of [['hover', '悬停'], ['selected', '选中'], ['overlay', '遮罩']]) states.append(element('span', `cu-custom-preview-state cu-custom-preview-state-${state}`, ui(label)));
        const input = element('div', 'cu-custom-preview-input'); input.append(element('span', '', ui('输入框')), element('span', 'cu-custom-preview-send', ui('发送')));
        body.append(prose, code, states, input); preview.append(side, body); return preview;
    }

    function openEditor(initial, initialMode) {
        const draft = clone(initial), raw = { light: {}, dark: {} };
        let mode = ['light','dark'].includes(initialMode) ? initialMode : document.body.dataset.claudeUi === 'light' ? 'light' : 'dark';
        const content = page('编辑配色'); content.classList.add('cu-custom-editor');
        back(content, '返回自定义颜色', open);
        const error = errorBox();
        const nameLabel = element('label', 'cu-custom-name'); nameLabel.append(element('span', '', ui('配色名称')));
        const name = element('input', 'cu-brand-name-input'); name.type = 'text'; name.maxLength = 60; name.value = draft.label; name.required = true; nameLabel.append(name);
        name.addEventListener('input', () => { draft.label = name.value; });
        const modeRow = element('div', 'cu-custom-mode-row'); modeRow.append(element('span', '', ui('编辑颜色')));
        const segment = element('div', 'cu-segment'); segment.setAttribute('role', 'group'); segment.setAttribute('aria-label', ui('编辑颜色'));
        for (const [value, label] of [['light', '浅色'], ['dark', '深色']]) {
            const control = action(label, value === 'dark' ? 'moon' : 'sun', () => { mode = value; renderFields(); }); control.dataset.customMode = value; segment.append(control);
        }
        modeRow.append(segment);
        const preview = makePreview(), fields = element('div', 'cu-custom-fields');
        const previewColors = () => { for (const { key } of colorFields) preview.style.setProperty(`--cu-preview-${key}`, draft[mode][key]); };
        const fieldInputs = new Map();
        function renderFields() {
            segment.querySelectorAll('button').forEach(control => control.setAttribute('aria-pressed', String(control.dataset.customMode === mode)));
            preview.dataset.mode = mode; previewColors(); fields.replaceChildren(); fieldInputs.clear();
            const groups = new Map();
            for (const field of colorFields) {
                if (!groups.has(field.group)) {
                    const group = element('details', 'cu-custom-color-group'); group.open = true;
                    group.append(element('summary', '', ui(field.group))); const list = element('div', 'cu-custom-color-list'); group.append(list); groups.set(field.group, list); fields.append(group);
                }
                const row = element('div', 'cu-custom-color-row'), id = `cu-custom-color-${++sequence}`;
                const label = element('label', '', ui(field.label)); label.htmlFor = id;
                const picker = element('input', 'cu-custom-color-picker'); picker.type = 'color'; picker.value = draft[mode][field.key].slice(0, 7); picker.setAttribute('aria-label', ui(field.label) + ' · ' + ui('选择颜色'));
                const hex = element('input', 'cu-custom-color-hex'); hex.type = 'text'; hex.id = id; hex.maxLength = 9; hex.spellcheck = false; hex.autocapitalize = 'off'; hex.autocomplete = 'off'; hex.value = raw[mode][field.key] ?? draft[mode][field.key]; hex.setAttribute('aria-label', ui(field.label) + ' · HEX'); hex.placeholder = '#RRGGBBAA';
                const validate = () => {
                    raw[mode][field.key] = hex.value;
                    try { const normalized = normalizeColor(hex.value); draft[mode][field.key] = normalized; picker.value = normalized.slice(0, 7); hex.removeAttribute('aria-invalid'); hex.setCustomValidity(''); previewColors(); return true; }
                    catch { hex.setAttribute('aria-invalid', 'true'); hex.setCustomValidity(ui('请输入十六进制颜色，例如 #336699 或 #33669980。')); return false; }
                };
                hex.addEventListener('input', validate); if (Object.hasOwn(raw[mode], field.key)) validate();
                picker.addEventListener('input', () => { const alpha = draft[mode][field.key].slice(7); hex.value = picker.value + alpha; validate(); });
                row.append(label, picker, hex); groups.get(field.group).append(row); fieldInputs.set(field.key, hex);
            }
        }
        const validatedDraft = () => {
            for (const candidateMode of ['light', 'dark']) for (const [key, value] of Object.entries(raw[candidateMode])) {
                try { draft[candidateMode][key] = normalizeColor(value); }
                catch { mode = candidateMode; renderFields(); const input = fieldInputs.get(key); input.focus(); input.reportValidity(); throw new Error(ui('请修正标出的颜色后再保存。')); }
            }
            return normalizeCustomPalette({ ...draft, label: name.value, swatch: draft.dark.accent });
        };
        const footer = element('div', 'cu-custom-editor-footer');
        const saveDraft = action('保存并应用', 'check', () => {
            try {
                const palette = validatedDraft(), config = settings(), stored = savedPalettes();
                const replacing = stored.some(item => item.id === palette.id && item.design === palette.design);
                if (!replacing && stored.length >= maxCustomPalettes) throw new Error(ui('最多保存 64 套自定义配色，请先删除一套。'));
                config.customPalettes = [...stored.filter(item => item.id !== palette.id || item.design !== palette.design), palette];
                if (!config.designPalettes || typeof config.designPalettes !== 'object' || Array.isArray(config.designPalettes)) config.designPalettes = {};
                config.designPalettes[palette.design] = palette.id;
                save(); applyAppearance(); showAppearance();
            } catch (cause) { fail(error, '无法保存配色。', cause); }
        });
        footer.append(saveDraft, action('导出草稿', 'copy', () => {
            try {
                const palette = validatedDraft();
                openExport(palette, () => openEditor(draft, mode));
            } catch (cause) { fail(error, '请填写名称并修正颜色后再导出。', cause); }
        }));
        content.append(nameLabel, modeRow, preview); describe(content, '颜色只在上方预览中变化。可输入 6 位颜色，或用 8 位颜色设置透明度；浅色和深色会随主题自动切换。');
        content.append(fields, error, footer); renderFields();
    }

    function open() {
        const content = page('自定义颜色'); back(content, '返回主题设置', showAppearance);
        describe(content, '为当前设计创建自己的配色。每套配色同时保存浅色和深色，也可以通过文件导入或导出。');
        const error = errorBox(), toolbar = element('div', 'cu-custom-toolbar');
        toolbar.append(action('新建配色', 'plus', () => {
            try {
                if (!hasRoom()) { fail(error, '最多保存 64 套自定义配色，请先删除一套。'); return; }
                const design = designOf(settings().design).id;
                const selected = customPaletteOptions(settings(), design).find(item => item.id === settings().designPalettes?.[design]);
                const colors = selected ? clone({ light: selected.light, dark: selected.dark }) : captureCurrentColors(design);
                openEditor({ schema: 'claude-surface-palette', version: 1, id: customId(), label: ui('我的配色'), design, swatch: colors.dark.accent, ...colors });
            } catch (cause) { fail(error, '无法读取当前配色，请重新打开后重试。', cause); }
        }), action('导入配色', 'arrow', openImport));
        content.append(toolbar, error);
        const choices = customPaletteOptions(settings(), designOf(settings().design).id);
        if (!choices.length) { describe(content, '还没有自定义配色。新建时会以当前颜色为起点。'); return; }
        const list = element('div', 'cu-custom-list');
        for (const palette of choices) {
            const row = element('div', 'cu-custom-saved-row');
            const edit = button(palette.label, 'edit', () => openEditor(palette), 'cu-custom-saved-edit');
            const swatch = element('i', 'cu-custom-saved-swatch'); swatch.style.backgroundColor = palette.swatch; swatch.setAttribute('aria-hidden', 'true'); edit.prepend(swatch);
            const exportButton = action('导出', 'copy', () => openExport(palette));
            const remove = action('删除', 'trash', () => {
                const confirm = action('确认删除', 'trash', () => {
                    const config = settings(); config.customPalettes = savedPalettes().filter(item => item.id !== palette.id || item.design !== palette.design);
                    if (config.designPalettes?.[palette.design] === palette.id) delete config.designPalettes[palette.design];
                    save(); applyAppearance(); open();
                }, 'cu-danger');
                row.replaceChildren(element('span', 'cu-custom-delete-name', palette.label), confirm, action('取消', 'close', open));
                confirm.focus({ preventScroll: true });
            }, 'cu-icon');
            row.append(edit, exportButton, remove); list.append(row);
        }
        content.append(list);
    }
    return { open };
}
