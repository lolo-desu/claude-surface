/** Run against a local SillyTavern: CU_TEST_URL=http://127.0.0.1:8010 node tests/controls.browser.mjs
 * Requires Playwright plus Chromium and WebKit. This uses isolated headless
 * contexts, blocks settings writes and extension mutations, and never attaches
 * to the user's desktop browser. CU_SERVER_CSS=1 audits the installed version.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium, webkit } = await import(process.env.CU_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.access(path.join(repo,'extension/style.css')).then(()=>path.join(repo,'extension')).catch(()=>repo);
const origin = process.env.CU_TEST_URL || 'http://127.0.0.1:8010';
const output = path.resolve(process.env.CU_TEST_OUTPUT || path.join(repo,'artifacts/controls-0101'));
await fs.mkdir(output,{recursive:true});
const report = { app:origin, serverCss:!!process.env.CU_SERVER_CSS, cases:[], browsers:{} };
const styles = await fs.readFile(path.join(source,'style.css'),'utf8');
async function appearance(page) {
    if (await page.locator('.cu-appearance-settings').isVisible()) return;
    await page.locator('.cu-header button[aria-label="更多"]').click();
    await page.locator('.cu-sheet').getByRole('button',{name:'主题设置',exact:true}).click();
    await page.locator('.cu-appearance-settings').waitFor({state:'visible'});
}
async function closeSheet(page) {
    await page.locator('.cu-sheet-panel').focus();
    await page.keyboard.press('Escape');
    await page.locator('.cu-sheet').waitFor({state:'hidden'});
}
async function closePopup(page) {
    const popup = page.locator('dialog.popup[open]').last();
    await popup.waitFor({state:'visible'});
    await page.keyboard.press('Escape');
    await popup.waitFor({state:'hidden'});
}
async function measure(input) {
    return input.evaluate(el => {
        const box=el.getBoundingClientRect(), style=getComputedStyle(el), after=getComputedStyle(el,'::after');
        return {width:box.width,height:box.height,position:style.position,afterWidth:parseFloat(after.width),afterHeight:parseFloat(after.height),pointerEvents:after.pointerEvents};
    });
}
function bounded(value, label) {
    assert.notEqual(value.position,'static',`${label}: decoration has no local containing block`);
    assert(value.afterWidth<=value.width+1 && value.afterHeight<=value.height+1,`${label}: oversized decoration ${JSON.stringify(value)}`);
    assert.equal(value.pointerEvents,'none',`${label}: decorative layer intercepts clicks`);
}
for (const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
    const executablePath=process.env[name==='chromium'?'CU_CHROMIUM_EXECUTABLE':'CU_WEBKIT_EXECUTABLE'];
    const browser=await engine.launch({headless:true,...(executablePath?{executablePath}:{})});
    report.browsers[name]=browser.version();
    try {
        const context=await browser.newContext({viewport:{width:412,height:915},locale:'zh-CN'});
        // Preserve server preferences; exercising visual controls needs no writes.
        await context.route('**/api/settings/save',r=>r.fulfill({json:{result:'ok'}}));
        await context.route('**/api/themes/save',r=>r.fulfill({json:{result:'ok'}}));
        await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true,currentBranchName:'test',remoteUrl:''}}));
        await context.route(/\/api\/extensions\/(install|update|delete|move|switch)(\?|$)/,r=>r.abort('blockedbyclient'));
        if (!process.env.CU_SERVER_CSS) {
            await context.route('**/scripts/extensions/third-party/claude-surface/style.css*',r=>r.fulfill({contentType:'text/css',body:styles}));
        }
        const page=await context.newPage();
        page.setDefaultTimeout(5000);
        await page.goto(origin,{waitUntil:'networkidle'});
        await page.locator('body[data-claude-ui]').waitFor();
        const extensionMarkup=await page.locator('#rm_extensions_block').evaluate(el=>el.outerHTML);
        for (const viewport of [{width:412,height:915},{width:1100,height:900},{width:1440,height:1000}]) {
            await page.setViewportSize(viewport);
            for (const family of ['claude','material','adwaita','swiss']) {
                for (const mode of ['dark','light']) {
                    await appearance(page);
                    await page.locator(`[data-cu-design-choice="${family}"]`).click();
                    await page.locator(`[data-cu-mode="${mode}"]`).click();
                    await page.waitForFunction(({family,mode})=>document.body.dataset.cuDesign===family && document.body.dataset.claudeUi===mode,{family,mode});
                    const toggle=page.locator('.cu-appearance-settings input[role="switch"]:not(:disabled)').first();
                    await toggle.scrollIntoViewIfNeeded();
                    const initial=await toggle.isChecked();
                    await toggle.setChecked(!initial); await toggle.setChecked(initial);
                    bounded(await measure(toggle),`${name}/${family}/${mode}: switch`);
                    const select=page.locator('.cu-settings-select').first();
                    await select.selectOption('avatar'); await select.selectOption('minimal');
                    const range=page.locator('#cu-effect-uiTransparency');
                    await range.scrollIntoViewIfNeeded(); await range.focus();
                    const before=Number(await range.inputValue());
                    await page.keyboard.press(before===100?'ArrowLeft':'ArrowRight');
                    assert.notEqual(Number(await range.inputValue()),before,'Range keyboard input did not change value');
                    await page.keyboard.press(before===100?'ArrowRight':'ArrowLeft');
                    await closeSheet(page);
                    await page.locator('.cu-header button[aria-label="更多"]').click();
                    await page.locator('.cu-tool-grid').getByRole('button',{name:'扩展程序',exact:true}).click();
                    const notification=page.locator('#extensions_notify_updates');
                    await notification.uncheck(); await notification.check();
                    const measurement=await measure(notification);
                    bounded(measurement,`${name}/${family}/${mode}: update checkbox`);
                    if (viewport.width>=900) {
                        const layout=await page.evaluate(()=>{
                            const panel=document.querySelector('#rm_extensions_block').getBoundingClientRect();
                            const sidebar=document.querySelector('#cu-sidebar').getBoundingClientRect();
                            return {left:panel.left,right:panel.right,width:innerWidth,sidebar:document.body.classList.contains('cu-sidebar-open')?sidebar.right:0};
                        });
                        assert(layout.left>=layout.sidebar-1 && layout.right<=layout.width+1,`Panel obstructed: ${JSON.stringify(layout)}`);
                    }
                    // A real click must reach BOTH native buttons; no forced click.
                    await page.locator('#extensions_details').click();
                    await closePopup(page);
                    await page.locator('#third_party_extension_button').click();
                    await closePopup(page);
                    const accordion=page.locator('#cu-extension-settings > .inline-drawer-header');
                    await accordion.click();
                    const enabled=page.locator('#cu-extension-enabled');
                    await enabled.waitFor({state:'visible'});
                    bounded(await measure(enabled),`${name}/${family}/${mode}: extension settings switch`);
                    await accordion.click();
                    await enabled.waitFor({state:'hidden'});
                    // Also audit every currently visible native checkbox, including
                    // its checked state, without dispatching preference changes.
                    const invalid=await page.locator('input[type="checkbox"]:visible').evaluateAll(items=>items.flatMap(el=>{
                        const previous=el.checked; el.checked=true;
                        const rect=el.getBoundingClientRect(), s=getComputedStyle(el), a=getComputedStyle(el,'::after'); el.checked=previous;
                        return s.position==='static'||parseFloat(a.width)>rect.width+1||parseFloat(a.height)>rect.height+1||a.pointerEvents!=='none'?[{id:el.id,position:s.position,width:rect.width,height:rect.height,afterWidth:a.width,afterHeight:a.height}]:[];
                    }));
                    assert.deepEqual(invalid,[],`Other invalid checkboxes: ${JSON.stringify(invalid)}`);
                    const label=`${name}-${viewport.width}-${family}-${mode}`;
                    if (viewport.width===412 || family==='material') await page.screenshot({path:path.join(output,label+'.png')});
                    report.cases.push({label,measurement,manageClicked:true,installClicked:true,accordionClicked:true});
                    console.log('PASS '+label);
                    await page.locator('.cu-header button[aria-label="关闭原生面板"]').click();
                }
            }
        }
        // Standalone native presets must retain the same containing block.
        for (const title of ['Dark','Light','Material','Adwaita','Swiss']) {
            const folder=['Dark','Light'].includes(title)?repo:source;
            const preset=JSON.parse(await fs.readFile(path.join(folder,'themes',`Claude Surface ${title}.json`),'utf8'));
            const native=await context.newPage();
            await native.setContent(`<html><head><base href="${origin}"><link rel="stylesheet" href="/style.css"><style>${preset.custom_css}</style></head><body>${extensionMarkup}</body></html>`);
            await native.locator('#rm_extensions_block').evaluate(el=>{el.classList.remove('closedDrawer');el.style.display='block';});
            const input=native.locator('#extensions_notify_updates'); await input.check();
            bounded(await measure(input),`${name}/native/${title}`);
            const label=`${name}-native-${title}`; report.cases.push({label}); console.log('PASS '+label);
            await native.close();
        }
        await context.close();
    } catch (error) {
        report.error=String(error);
        const last=browser.contexts().flatMap(c=>c.pages()).at(-1);
        if(last) {
            await last.screenshot({path:path.join(output,`${name}-failure.png`)}).catch(()=>{});
            report.focus=await last.evaluate(()=>document.activeElement?.outerHTML).catch(()=>null);
        }
        throw error;
    } finally {
        await browser.close();
        await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(report,null,2));
    }
}
console.log(JSON.stringify({passed:report.cases.length,output,browsers:report.browsers}));
