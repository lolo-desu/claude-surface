import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const base = new URL('../', import.meta.url);
const root = fs.existsSync(new URL('extension/palettes.js', base)) ? new URL('extension/', base) : base;
const source = fs.readFileSync(new URL('palettes.js', root), 'utf8');
const { palettesByDesign, paletteOptions, paletteOf, selectedPalette, paletteStyles } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

function rgb(hex, background = '#ffffff') {
    const channels = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16));
    const alpha = channels.length === 4 ? channels[3] / 255 : 1;
    const behind = alpha < 1 ? rgb(background) : [0, 0, 0];
    return channels.slice(0, 3).map((value, index) => value / 255 * alpha + behind[index] * (1 - alpha));
}
function contrast(a, b) {
    const luminance = color => rgb(color).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const first = luminance(a), second = luminance(b);
    return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

test('palette choices are scoped and remembered separately for each design', () => {
    const config = { design: 'material', designPalettes: { material: 'peach', adwaita: 'violet', swiss: 'cobalt', claude: 'olive' } };
    for (const [design, id] of Object.entries(config.designPalettes)) {
        config.design = design;
        assert.equal(selectedPalette(config).id, id);
    }
    assert.equal(paletteOf('material', 'vermilion').id, 'azure');
    assert.equal(paletteOf('swiss', 'lilac').id, 'vermilion');
    assert.equal(paletteOf('claude', 'blue').id, 'clay');
});

test('invalid or legacy settings resolve to a safe family default', () => {
    assert.equal(selectedPalette().id, 'clay');
    assert.equal(selectedPalette({ design: 'constructor', designPalettes: {} }).id, 'clay');
    assert.equal(selectedPalette({ design: 'adwaita', designPalettes: [] }).id, 'blue');
    assert.equal(selectedPalette({ design: 'swiss', designPalettes: { swiss: 'missing' } }).id, 'vermilion');
    assert.deepEqual(paletteOptions('missing'), paletteOptions('claude'));
    assert.deepEqual(palettesByDesign.claude[0].light, {});
    assert.deepEqual(palettesByDesign.claude[0].dark, {});
});

test('every curated palette has unique options, valid tokens and readable text/actions', () => {
    for (const [design, palettes] of Object.entries(palettesByDesign)) {
        assert.ok(palettes.length >= 3);
        assert.equal(new Set(palettes.map(item => item.id)).size, palettes.length);
        for (const palette of palettes) {
            assert.match(palette.swatch, /^#[a-f0-9]{6}$/i);
            for (const [mode, tokens] of [['light', palette.light], ['dark', palette.dark]]) {
                for (const [name, value] of Object.entries(tokens)) assert.match(value, /^#[a-f0-9]{6}([a-f0-9]{2})?$/i, name);
                if (tokens.bg) {
                    for (const background of ['bg', 'sidebar', 'surface', 'input', 'selected', 'user', 'code']) {
                        assert.ok(contrast(tokens.text, tokens[background]) >= 4.5, `${design}/${palette.id}/${mode} body on ${background}`);
                    }
                    assert.ok(contrast(tokens.muted, tokens.bg) >= 4.5, `${design}/${palette.id}/${mode} muted`);
                    assert.ok(contrast(tokens.link, tokens.bg) >= 4.5, `${design}/${palette.id}/${mode} link`);
                }
                if (tokens.accent) assert.ok(contrast(tokens.accent, tokens['on-accent']) >= 4.5, `${design}/${palette.id}/${mode} action`);
            }
        }
    }
});

test('Swiss night palettes keep neutral charcoal surfaces across accent choices', () => {
    for (const palette of palettesByDesign.swiss) {
        for (const key of ['bg', 'sidebar', 'surface', 'input', 'user', 'code']) {
            const c = rgb(palette.dark[key]);
            assert.ok(Math.max(...c) - Math.min(...c) < .005, key);
        }
    }
});

test('generated CSS cannot affect a different design and matches the saved stylesheet', () => {
    const css = paletteStyles();
    assert.equal(css, fs.readFileSync(new URL('palette-styles.css', root), 'utf8'));
    for (const [design, palettes] of Object.entries(palettesByDesign)) {
        for (const palette of palettes) {
            if (!Object.keys(palette.dark).length) continue;
            assert.ok(css.includes(`[data-cu-design="${design}"][data-cu-palette="${palette.id}"]`));
        }
    }
    assert.ok(!css.includes('!important'));
});
