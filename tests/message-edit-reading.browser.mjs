/** Real native long-message confirmation/cancel at the top of a 30k editor.
 * Keyboard focus returns to reading without a scroll jump; temporary tabindex
 * ownership is released on blur/removal/disable. Synthetic messages and all
 * server writes stay in an isolated context. Uses the standard CU_* options.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fixture, frames, reset, stats, artifactRoot } from './fixtures/message-edit-audit.browser.mjs';

const f = await fixture({ total: 7, chars: 30000, width: 393, height: 900, traceOwnership: false });
const { page, targetId, longText, errors } = f;
const report = { source: f.source, cases: [], errors };
await fs.mkdir(artifactRoot, { recursive: true });
const message = page.locator(`#chat > .mes[mesid="${targetId}"]`);
const snapshot = () => page.evaluate(id => {
    const current = document.querySelector(`#chat > .mes[mesid="${id}"]`), text = current.querySelector('.mes_text'), active = document.activeElement;
    return { scroll: document.getElementById('chat').scrollTop, textTop: text.getBoundingClientRect().top,
        reading: active === text, body: active === document.body, tabindex: text.getAttribute('tabindex'), active: active?.className,
        bars: current.querySelectorAll('.cu-message-edit-controls').length };
}, targetId);
async function enter() {
    await message.locator('.mes_edit').click();
    await page.locator('.cu-message-edit-controls').waitFor();
    await page.locator('#curEditTextarea').evaluate((editor, text) => {
        editor.value = text + '\nTOP DRAFT'; editor.dispatchEvent(new Event('input', { bubbles: true })); editor.setSelectionRange(0, 0); editor.scrollTop = 0;
    }, longText.trim());
    await page.evaluate(() => {
        const chat = document.getElementById('chat'), bar = document.querySelector('.cu-message-edit-controls');
        chat.scrollTop += bar.getBoundingClientRect().top - chat.getBoundingClientRect().top - 8;
    });
    await frames(page);
}
async function activate(action, keyboard = true) {
    const proxy = page.locator(`.cu-message-edit-controls [data-cu-edit-action="${action}"]`);
    if (keyboard) { await proxy.focus(); await page.keyboard.press('Enter'); }
    else await proxy.click();
    await page.waitForFunction(() => !document.getElementById('curEditTextarea'));
    await frames(page);
}
try {
    await page.evaluate(() => { SillyTavern.getContext().powerUserSettings.auto_save_msg_edits = false; });
    for (const action of ['done', 'cancel']) for (const activation of ['pointer', 'keyboard']) {
        await enter(); await reset(page);
        if (activation === 'keyboard') await page.locator(`.cu-message-edit-control[data-cu-edit-action="${action}"]`).focus();
        const before = await snapshot(); await activate(action, activation === 'keyboard'); const after = await snapshot();
        const native = await stats(page);
        const result = { action, activation, before, after, anchorDelta: after.textTop - before.textTop, nativeActions: native.actions };
        report.cases.push(result);
        assert.equal(native.actions[action], 1, 'A top proxy dispatched its native action more than once');
        assert.equal(after.bars, 0);
        assert(Math.abs(result.anchorDelta) <= (activation === 'keyboard' ? 3 : 12), JSON.stringify(result));
        if (activation === 'keyboard') {
            assert(after.reading && !after.body, 'Native confirmation/cancel lost keyboard focus into BODY');
            assert.equal(after.tabindex, '-1', 'Reading focus needs its temporary negative tabindex until blur');
            if (action === 'cancel') {
                await message.locator('.mes_text').evaluate(text => text.setAttribute('tabindex', '3'));
                await page.locator('#cu-sidebar-toggle').focus();
                assert.equal(await message.locator('.mes_text').getAttribute('tabindex'), '3', 'Release overwrote an external tabindex change');
                await message.locator('.mes_text').evaluate(text => text.removeAttribute('tabindex'));
            } else {
                await page.locator('#cu-sidebar-toggle').focus();
                assert.equal(await message.locator('.mes_text').getAttribute('tabindex'), null, 'Blur leaked the temporary tabindex');
            }
        }
    }
    // A detached reading region must be released even if WebKit sends no blur.
    await enter(); await activate('cancel');
    const detachedText = await message.locator('.mes_text').elementHandle();
    assert.equal(await detachedText.getAttribute('tabindex'), '-1');
    await message.evaluate(element => element.remove()); await frames(page);
    assert.equal(await detachedText.getAttribute('tabindex'), null, 'Removing the message leaked its reading tabindex');
    report.cases.push({ action: 'remove-reading-message', released: true });
    assert.deepEqual(errors, []);
    await page.screenshot({ path: artifactRoot + '/message-edit-reading.png' });
    console.log(JSON.stringify({ source: f.source, cases: report.cases.length, errors }));
} catch (error) {
    report.error = String(error);
    await fs.mkdir(artifactRoot, { recursive: true });
    await page.screenshot({ path: artifactRoot + '/message-edit-reading-failure.png' }).catch(() => {});
    throw error;
} finally {
    await fs.mkdir(artifactRoot, { recursive: true });
    await fs.writeFile(artifactRoot + '/reading-focus.json', JSON.stringify(report, null, 2));
    await f.close();
}
