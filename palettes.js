// Curated color systems. Every choice belongs to one design and includes both modes.
const colors = values => Object.fromEntries([
    'bg', 'sidebar', 'surface', 'input', 'text', 'muted', 'border', 'input-border',
    'hover', 'selected', 'user', 'code', 'accent', 'on-accent', 'link',
].map((key, index) => [key, values[index]]));
const choice = (id, label, swatch, light, dark) => ({ id, label, swatch, light, dark });
const accent = (color, foreground, selected, user, link = color) => ({
    accent: color, 'on-accent': foreground, selected, user, link,
});
const swissNight = (color, selected, link) => ({
    bg: '#171717', sidebar: '#202020', surface: '#232323', input: '#282828',
    text: '#f1eee8', muted: '#b5b2ac', border: '#ffffff22', 'input-border': '#ffffff38',
    hover: '#ffffff09', selected, user: '#303030', code: '#222222',
    accent: color, 'on-accent': '#171717', link,
});

export const palettesByDesign = {
    claude: [
        choice('clay', '陶土', '#d77757', {accent:'#a8472d','on-accent':'#ffffff'}, {accent:'#d77757','on-accent':'#191919'}),
        choice('olive', '橄榄', '#65764c', colors([
            '#fbfbf6', '#f1f2e8', '#ffffff', '#ffffff', '#30352b', '#62675c', '#30352b25', '#30352b36',
            '#30352b09', '#e4e9d7', '#edf0e6', '#f1f2e8', '#566d42', '#ffffff', '#4b6241',
        ]), colors([
            '#1c201a', '#22271f', '#292f25', '#30382c', '#e4e8dd', '#adb5a2', '#e4e8dd22', '#e4e8dd35',
            '#e4e8dd0c', '#3a4430', '#2c3526', '#252c20', '#bbcd9e', '#24301a', '#c4d6ad',
        ])),
        choice('slate', '石墨', '#627c8c', colors([
            '#f7f9fa', '#eef2f4', '#ffffff', '#ffffff', '#24333c', '#596b76', '#24333c24', '#24333c35',
            '#24333c08', '#dfe8ed', '#eaf0f3', '#edf1f4', '#486c82', '#ffffff', '#3b6580',
        ]), colors([
            '#192126', '#1f282e', '#263138', '#2d3a42', '#e0e8ed', '#a7b7c1', '#e0e8ed22', '#e0e8ed35',
            '#e0e8ed0b', '#354954', '#293b46', '#222d34', '#a2c5da', '#143143', '#afd0e2',
        ])),
    ],
    material: [
        choice('azure', '天蓝', '#0b57d0', colors([
            '#f8fafd', '#eff3fa', '#edf2fa', '#f0f4f9', '#1f1f1f', '#5f6368', '#d5dce7', '#b8c7e0',
            '#0b57d00a', '#d3e3fd', '#e8effa', '#eef2f6', '#0b57d0', '#ffffff', '#1558b5',
        ]), colors([
            '#131314', '#1e1f20', '#242629', '#1e1f20', '#e3e3e3', '#adb3bc', '#3c4046', '#4a5260',
            '#a8c7fa0d', '#34445b', '#2c3442', '#1b1d20', '#a8c7fa', '#062e6f', '#a8c7fa',
        ])),
        choice('lilac', '丁香', '#7962aa', colors([
            '#fffbfe', '#f3edf7', '#f7f2fa', '#eee8f4', '#1d1b20', '#5f5866', '#d9d0df', '#b9a7cb',
            '#6750a40b', '#eaddff', '#e8def8', '#f1eaf6', '#6750a4', '#ffffff', '#604292',
        ]), colors([
            '#141218', '#1d1a22', '#211d27', '#292430', '#e6e1e9', '#c5bfce', '#494250', '#605767',
            '#d0bcff14', '#4f378b', '#332b45', '#211d2b', '#d0bcff', '#381e72', '#d0bcff',
        ])),
        choice('mint', '薄荷', '#267058', colors([
            '#f5fbf7', '#e8f2ec', '#edf7f0', '#e5f0e9', '#172b22', '#4b6357', '#cadacf', '#a6c2b0',
            '#2670580b', '#cbe9d9', '#d9ecdf', '#eaf3ec', '#226b52', '#ffffff', '#1c654d',
        ]), colors([
            '#101b16', '#19261f', '#1e2e25', '#25392e', '#dce9df', '#b1c9b8', '#3c5445', '#52725e',
            '#99d5b414', '#315e49', '#294937', '#1b2b22', '#99d5b4', '#103c2a', '#a7dec0',
        ])),
        choice('peach', '杏桃', '#a85a35', colors([
            '#fff8f4', '#f9ece4', '#fff0e7', '#f5e5db', '#39271f', '#725a4e', '#e7cfc0', '#ccab96',
            '#a3542e0a', '#ffdbc8', '#f8e1d2', '#f7eae1', '#984b27', '#ffffff', '#8e4424',
        ]), colors([
            '#211712', '#2b201a', '#33261f', '#3b2c22', '#f3e2d6', '#cdb6a7', '#604b3d', '#80614d',
            '#f2b89c12', '#654330', '#4b3426', '#30221b', '#f2b89c', '#492914', '#f6c6aa',
        ])),
    ],
    adwaita: [
        choice('blue', '蓝色', '#3584e4', accent('#1c71d8', '#ffffff', '#d8e1eb', '#f2f2f3'),
            accent('#99c1f1', '#102b4b', '#3c4c61', '#303034')),
        choice('teal', '青绿', '#26a89a', accent('#007d70', '#ffffff', '#d7e9e5', '#eff4f3'),
            accent('#81d0c4', '#10362f', '#304e49', '#303735')),
        choice('violet', '紫罗兰', '#916cca', accent('#6749a2', '#ffffff', '#e5def0', '#f4f1f7'),
            accent('#c8adf0', '#32204d', '#4b405e', '#343039')),
        choice('orange', '橙色', '#d96e28', accent('#b34b00', '#ffffff', '#f2e0d2', '#f8f2ed'),
            accent('#ffb27b', '#42230e', '#5c4535', '#39332f')),
    ],
    swiss: [
        choice('vermilion', '朱红', '#c43e2b', {
            bg: '#f3f0e8', sidebar: '#e0e5d8', surface: '#f7f4ec', input: '#f7f4ec',
            text: '#193c35', muted: '#4e6054', border: '#193c3524', 'input-border': '#193c3540',
            hover: '#193c3508', selected: '#c9d5c2', user: '#d9e2d4', code: '#eeece2',
            accent: '#c43e2b', 'on-accent': '#ffffff', link: '#2d6553',
        }, swissNight('#ef795b', '#393939', '#f59b82')),
        choice('cobalt', '钴蓝', '#325f9c', {
            bg: '#f3f3ef', sidebar: '#e4e8ea', surface: '#fafaf6', input: '#fafaf6',
            text: '#213548', muted: '#53616d', border: '#21354824', 'input-border': '#21354840',
            hover: '#21354808', selected: '#cfdce5', user: '#dde5eb', code: '#e9edf0',
            accent: '#315f9b', 'on-accent': '#ffffff', link: '#315f9b',
        }, swissNight('#9cbbe8', '#333c48', '#b0c8ec')),
        choice('olive', '苔金', '#6c7043', {
            bg: '#f5f2e8', sidebar: '#e9e6d6', surface: '#fcf9ef', input: '#fcf9ef',
            text: '#373b26', muted: '#5b5f48', border: '#373b2624', 'input-border': '#373b2640',
            hover: '#373b2608', selected: '#dcdcc5', user: '#e7e7d5', code: '#eeecdf',
            accent: '#626438', 'on-accent': '#ffffff', link: '#5c6034',
        }, swissNight('#c7c58c', '#3d3d32', '#d2d0a3')),
    ],
};

export function paletteOptions(design) {
    return palettesByDesign[Object.hasOwn(palettesByDesign, design) ? design : 'claude'];
}

export function paletteOf(design, id) {
    const options = paletteOptions(design);
    return options.find(item => item.id === id) || options[0];
}

export function selectedPalette(config = {}) {
    const design = Object.hasOwn(palettesByDesign, config.design) ? config.design : 'claude';
    const saved = config.designPalettes;
    const id = saved && typeof saved === 'object' && !Array.isArray(saved) && Object.hasOwn(saved, design) ? saved[design] : null;
    return paletteOf(design, id);
}

export function paletteStyles() {
    const declarations = tokens => Object.entries(tokens).map(([name, value]) => `    --cu-${name}: ${value};`).join('\n');
    const rules = ['/* Generated from palettes.js. Choices are scoped to their design and mode. */'];
    for (const [design, choices] of Object.entries(palettesByDesign)) {
        for (const palette of choices) {
            const scope = `[data-cu-design="${design}"][data-cu-palette="${palette.id}"]`;
            if (Object.keys(palette.dark).length) rules.push(`body[data-claude-ui]${scope} {\n${declarations(palette.dark)}\n}`);
            if (Object.keys(palette.light).length) rules.push(`body[data-claude-ui="light"]${scope} {\n${declarations(palette.light)}\n}`);
        }
    }
    return rules.join('\n') + '\n';
}
