/** Real native StreamingProcessor with a paced, deterministic token source.
 * Only the test's routed script response exposes the private native class.
 * Native parsing, reasoning, DOM writes, stop handling and finalization remain
 * real; chat/settings writes, tokenization and network generation are mocked.
 * CU_STREAM_REPEAT repeats paced samples; CU_STREAM_FUNCTIONAL_ONLY omits the
 * timed normal case. All scenarios begin with the same 50 loaded messages.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const engines = await import(process.env.CU_PLAYWRIGHT_MODULE || 'playwright');
const source = path.resolve(process.env.CU_SOURCE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const output = process.env.CU_TEST_OUTPUT || path.join(source, 'artifacts/native-streaming-performance');
await fs.mkdir(output, { recursive: true });
const engine = process.env.CU_ENGINE || 'chromium';
const executable = process.env[engine === 'webkit' ? 'CU_WEBKIT_EXECUTABLE' : 'CU_CHROMIUM_EXECUTABLE'];
const browser = await engines[engine].launch({ headless: true, ...(executable ? { executablePath: executable } : {}) });
const report = { source, engine, browser: browser.version(), startedAt: new Date().toISOString(), cases: [], errors: [] };
const repeat = Number(process.env.CU_STREAM_REPEAT || 1);
const selectedCases = process.env.CU_STREAM_CASES?.split(',').filter(Boolean);
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

// Appended within the real native module's lexical scope. No host file changes.
const nativeFixture = String.raw`
eventSource.on(event_types.APP_READY,()=>window.cuStreamReady=true);
window.cuRunNativeStream=async function(options={}) {
    const { type='normal', chunks=90, pace=16, stopAt=0, errorAt=0, toggleAt=0, fade=false, reasoningOnly=false, toolVisibility=false, toolReasoning=false }=options;
    const prefix=type==='continue' ? chat.at(-1).mes : '';
    const before=chat.length;
    const originalChat=JSON.stringify(chat);
    let originalSwipes;
    if(type==='swipe'){
        ensureSwipes(chat.at(-1));syncMesToSwipe(chat.length-1);
        originalSwipes=chat.at(-1).swipes.slice();
        // Native overswiping selects the next not-yet-created slot before
        // Generate('swipe') constructs its StreamingProcessor.
        chat.at(-1).swipe_id=chat.at(-1).swipes.length;
    }
    await eventSource.emit(event_types.GENERATION_STARTED,type,{},false);
    const promptReasoning=new PromptReasoning();
    const processor=new StreamingProcessor(type,false,new Date(),prefix,promptReasoning);
    if(type==='continue')processor.firstMessageText='';
    generation_started=processor.timeStarted;
    streamingProcessor=processor;
    abortController=processor.abortController;
    is_send_press=true;
    if(type==='impersonate')processor.markUIGenStarted();
    power_user.stream_fade_in=fade;
    // Native theme application can restore token-display preferences after
    // settings loading. Establish this controlled finalization check here.
    power_user.message_token_count_enabled=true;
    power_user.token_padding=64;
    const stats={type,chunks,pace,stopAt,errorAt,toggleAt,fade,reasoningOnly,toolVisibility,toolReasoning,before, fps:power_user.streaming_fps,tokens:[],progress:[],events:[],mutationWrites:0};
    const progress=processor.onProgressStreaming;
    processor.onProgressStreaming=async function(...args) {
        const start=performance.now();
        try {return await progress.apply(this,args);}
        finally {stats.progress.push({final:!!args[2],ms:performance.now()-start,length:args[1].length});}
    };
    const nativeError=processor.onErrorStreaming;
    processor.onErrorStreaming=function(...args){
        const message=chat[this.messageId], element=document.querySelector('#chat>.mes[mesid="'+this.messageId+'"]');
        stats.errorCalls=(stats.errorCalls||0)+1;
        stats.errorEntry={actual:this.type==='impersonate'?this.sendTextarea.value:message?.mes,swipe:message?.swipes?.[message.swipe_id],dom:this.type==='impersonate'?this.sendTextarea.value:element?.querySelector('.mes_text')?.textContent,reasoning:message?.extra?.reasoning,reasoningState:element?.querySelector('details.mes_reasoning_details')?.dataset.state,chatUnchanged:originalChat===JSON.stringify(chat),hidden:element?getComputedStyle(element).display==='none':null,hiddenClass:element?.classList.contains('displayNone')};
        return nativeError.apply(this,args);
    };
    const onToken=text=>{stats.tokens.push(text.length);stats.lastToken=text;};
    const onReceived=(id,kind)=>stats.events.push({event:'MESSAGE_RECEIVED',id,kind});
    const onRendered=(id,kind)=>stats.events.push({event:'CHARACTER_MESSAGE_RENDERED',id,kind});
    const onReasoning=(text,duration,id)=>stats.events.push({event:'STREAM_REASONING_DONE',id,text,duration});
    const onImpersonate=text=>stats.events.push({event:'IMPERSONATE_READY',text});
    eventSource.on(event_types.STREAM_TOKEN_RECEIVED,onToken);
    eventSource.on(event_types.MESSAGE_RECEIVED,onReceived);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED,onRendered);
    eventSource.on(event_types.STREAM_REASONING_DONE,onReasoning);
    eventSource.on(event_types.IMPERSONATE_READY,onImpersonate);
    const observer=new MutationObserver(records=>{
        for(const record of records)if(record.target instanceof Element&&record.target.matches('.mes_text'))stats.mutationWrites++;
    });
    observer.observe(document.getElementById('chat'),{childList:true,subtree:true});
    let body='', reasoning='';
    const unit=i=>'\n\n### Chunk '+i+'\n\nA native **streaming** paragraph preserves every token '+i+'. '+ 'Long message rendering and reasoning fixture. '.repeat(8)+'\n\n- item '+i+'\n- second item\n';
    processor.generator=async function*() {
        if(toolVisibility){
            const toolCalls=[{id:'synthetic-tool',type:'function',function:{name:'fixture_never_execute',arguments:'{}'}}];
            await new Promise(resolve=>setTimeout(resolve,125));
            yield {text:'...',state:{reasoning:''},toolCalls};
            stats.wasToolHidden=processor.messageDom.classList.contains('displayNone')&&getComputedStyle(processor.messageDom).display==='none';
            body=toolReasoning?'...':unit(1);
            yield {text:body,state:{reasoning:toolReasoning?'Late tool reasoning is preserved.':''},toolCalls};
            const lateVisible=toolReasoning?processor.messageDom.querySelector('.mes_reasoning').textContent.includes('Late tool reasoning'):processor.messageTextDom.textContent.includes('Chunk 1');
            stats.lateBodyWasUnpainted=!lateVisible&&stats.progress.length===1;
            throw new Error('Synthetic tool stream failure after late body');
        }
        const start=performance.now();
        for(let i=1;i<=chunks;i++){
            await new Promise(resolve=>setTimeout(resolve,Math.max(0,start+i*pace-performance.now())));
            if(errorAt&&i>errorAt)throw new Error('Synthetic stream failure after '+errorAt+' chunks');
            if(!reasoningOnly)body+=unit(i);
            if(i<=Math.ceil(chunks/3))reasoning+='Reasoning segment '+i+'. ';
            yield {text:body,state:{reasoning},swipes:[],toolCalls:[]};
            if(toggleAt===i){
                const control=document.getElementById('cu-extension-native-performance');
                control.checked=!control.checked;control.dispatchEvent(new Event('change',{bubbles:true}));
                stats.fpsAfterToggle=power_user.streaming_fps;
            }
            if(stopAt===i){stats.stopClicked=true;document.getElementById('mes_stop').click();}
        }
    };
    const started=performance.now();
    try {
        const result=await processor.generate();
        stats.result=result;
        const clean=cleanUpMessage({getMessage:result,isImpersonate:type==='impersonate',isContinue:type==='continue',displayIncompleteSentences:false});
        // Successful Generate cleans the new continuation before joining it;
        // its progress path receives the combined prefix and current chunk.
        // A failed stream has only that latter path available for recovery.
        stats.expected=errorAt ? cleanUpMessage({getMessage:prefix+result,isImpersonate:type==='impersonate',isContinue:type==='continue',displayIncompleteSentences:false,stoppingStrings:processor.stoppingStrings}) : prefix+clean;
        if(processor.isFinished&&!processor.isStopped)await processor.onFinishStreaming(processor.messageId,stats.expected);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const message=chat[processor.messageId], element=document.querySelector('#chat>.mes[mesid="'+processor.messageId+'"]');
        stats.ms=performance.now()-started;
        stats.messageId=processor.messageId;
        stats.after=chat.length;
        stats.actual=type==='impersonate'?processor.sendTextarea.value:message.mes;
        stats.swipe=message?.swipes?.[message.swipe_id];
        stats.reasoning=message?.extra?.reasoning;
        stats.tokenCount=message?.extra?.token_count;
        stats.dom=type==='impersonate'?processor.sendTextarea.value:element.querySelector('.mes_text').textContent;
        stats.reasoningState=element?.querySelector('details.mes_reasoning_details')?.dataset.state;
        stats.chatUnchanged=originalChat===JSON.stringify(chat);
        if(originalSwipes){stats.originalSwipes=originalSwipes;stats.preservedSwipes=message.swipes.slice(0,originalSwipes.length);stats.swipeCount=message.swipes.length;stats.swipeId=message.swipe_id;}
        stats.fpsAtEnd=power_user.streaming_fps;
        stats.finished=processor.isFinished;
        stats.stopped=processor.isStopped;
        stats.aborted=processor.abortController.signal.aborted;
        stats.generating=document.body.dataset.generating;
        stats.sendBusy=is_send_press;
        stats.progressCalls=stats.progress.filter(x=>!x.final).length;
        stats.finalCalls=stats.progress.filter(x=>x.final).length;
        stats.progressMs=stats.progress.filter(x=>!x.final).reduce((sum,x)=>sum+x.ms,0);
        return stats;
    } finally {
        observer.disconnect();
        eventSource.removeListener(event_types.STREAM_TOKEN_RECEIVED,onToken);
        eventSource.removeListener(event_types.MESSAGE_RECEIVED,onReceived);
        eventSource.removeListener(event_types.CHARACTER_MESSAGE_RENDERED,onRendered);
        eventSource.removeListener(event_types.STREAM_REASONING_DONE,onReasoning);
        eventSource.removeListener(event_types.IMPERSONATE_READY,onImpersonate);
        streamingProcessor=null;abortController=null;
        PromptReasoning.clearLatest();
        activateSendButtons();
    }
};
`;

async function createPage(mode) {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, locale: 'en-US' });
    await context.addInitScript(() => localStorage.setItem('language', 'en'));
    await context.route('**/api/settings/get', async route => {
        const response = await route.fetch(), data = await response.json(), settings = JSON.parse(data.settings);
        settings.firstRun = false; settings.main_api = 'openai'; settings.active_character = null; settings.active_group = null;
        settings.power_user.chat_truncation = 50; settings.power_user.streaming_fps = 30;
        settings.power_user.auto_scroll_chat_to_bottom = false;
        settings.power_user.message_token_count_enabled = true;
        settings.power_user.auto_swipe = false;
        settings.power_user.stream_fade_in = false;
        settings.power_user.reasoning ??= {}; settings.power_user.reasoning.auto_expand = true; settings.power_user.reasoning.auto_parse = false;
        settings.extension_settings.claude_surface = { enabled: true, mode: 'dark', nativePerformance: false };
        settings.extension_settings.disabledExtensions = ['third-party/ST-BaiBai-Book', 'third-party/ST-BaiBai-Tools'];
        data.settings = JSON.stringify(settings); await route.fulfill({ response, json: data });
    });
    await context.route(/\/api\/(settings|themes|chats|groups|characters)\/(save|edit|delete|merge-attributes)(\?|$)/, route => route.fulfill({ json: { result: 'ok' } }));
    await context.route(/\/api\/tokenizers\/openai\/count(?:\?|$)/, route => route.fulfill({ json: { token_count: 42 } }));
    await context.route('**/api/extensions/version', route => route.fulfill({ json: { isUpToDate: true } }));
    await context.route(/\/api\/extensions\/(install|update|delete|switch|move)(\?|$)/, route => route.abort());
    await context.route(/\/api\/.*(?:generate|completion)/, route => route.fulfill({ status: 503, body: 'Streaming fixture uses an in-page synthetic token generator' }));
    const messages = Array.from({ length: 50 }, (_, i) => ({ name: i % 2 ? 'Seraphina' : 'User', is_user: !(i % 2), is_system: false, send_date: '2026-11-14', mes: `Earlier message ${i + 1}\n\n${'Native history keeps the comparison DOM identical. '.repeat(8)}`, extra: {} }));
    await context.route('**/api/chats/get', route => route.fulfill({ json: [{ user_name: 'User', character_name: 'Seraphina', chat_metadata: { tainted: true } }, ...messages] }));
    await context.route('**/api/chats/recent', route => route.fulfill({ json: [] }));
    await context.route('**/script.js', async route => {
        const response = await route.fetch(); let body = await response.text();
        assert(body.includes('class StreamingProcessor {') && body.includes('async onProgressStreaming(messageId, text, isFinal) {'));
        body += nativeFixture;
        await route.fulfill({ response, body, contentType: 'text/javascript' });
    });
    await context.route('**/scripts/extensions/third-party/claude-surface/**', async route => {
        const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/claude-surface/')[1]);
        const filename = path.resolve(source, relative); if (!filename.startsWith(source + path.sep)) return route.abort();
        try { await route.fulfill({ body: await fs.readFile(filename), contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/json' }); } catch { await route.abort(); }
    });
    const page = await context.newPage(); page.setDefaultTimeout(45000);
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    await page.goto(process.env.CU_TEST_URL || 'http://127.0.0.1:8010', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.cuStreamReady && document.getElementById('cu-extension-native-performance'));
    await page.evaluate(async () => { await SillyTavern.getContext().selectCharacterById(0, { switchMenu: false }); });
    await page.waitForFunction(() => document.querySelectorAll('#chat > .mes').length === 50);
    if (mode) await page.evaluate(() => { const input = document.getElementById('cu-extension-native-performance'); input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); });
    await frames(page);
    assert.equal(await page.locator('#chat > .mes').count(), 50, 'Toggling mode reloaded native history');
    const fps = await page.evaluate(() => SillyTavern.getContext().powerUserSettings.streaming_fps);
    assert.equal(fps, mode ? 10 : 30);
    return { context, page, errors };
}

function verify(result, { mode, type = 'normal', chunks, stopAt = 0, errorAt = 0, toggleAt = 0, reasoningOnly = false, toolVisibility = false, toolReasoning = false }) {
    assert.equal(result.fps, mode ? 10 : 30);
    if (toolVisibility) {
        assert.equal(result.tokens.length, 2);
        assert.equal(result.wasToolHidden, true, 'Native tool-only progress did not establish the hidden-placeholder precondition');
        if (mode) assert.equal(result.lateBodyWasUnpainted, true, 'Late body unexpectedly reached the next native progress frame');
        assert.equal(result.errorCalls, 1);
        if (mode) {
            assert.equal(result.actual, result.expected);
            assert.equal(result.swipe, result.expected);
            assert.equal(result.errorEntry.actual, result.expected);
            if (toolReasoning) {
                assert.equal(result.errorEntry.reasoning, 'Late tool reasoning is preserved.');
                assert.equal(result.errorEntry.reasoningState, 'done');
            } else assert(result.errorEntry.dom.includes('Chunk 1'));
            assert.equal(result.errorEntry.hidden, false, 'Recovered tool-stream body remained hidden before native error callbacks');
            assert.equal(result.errorEntry.hiddenClass, false);
        }
        assert.equal(result.events.filter(x => x.event === 'MESSAGE_RECEIVED').length, 1);
        assert.equal(result.events.filter(x => x.event === 'CHARACTER_MESSAGE_RENDERED').length, 1);
        assert.equal(result.generating, undefined); assert.equal(result.sendBusy, false);
        return;
    }
    assert.equal(result.tokens.length, stopAt || errorAt || chunks, 'Native token reception dropped data');
    assert.equal(result.after, result.before + (['continue', 'swipe', 'impersonate'].includes(type) ? 0 : 1));
    if (type === 'impersonate') assert.equal(result.chatUnchanged, true, 'Impersonation changed raw chat data');
    if (type === 'swipe') {
        assert.deepEqual(result.preservedSwipes, result.originalSwipes, 'New swipe overwrote earlier swipe text');
        assert.equal(result.swipeCount, result.originalSwipes.length + 1);
        assert.equal(result.swipeId, result.originalSwipes.length);
    }
    if (!errorAt || mode || toggleAt) assert.equal(result.actual, result.expected, 'Latest streamed text was not flushed');
    if (errorAt && (mode || toggleAt)) {
        if (type !== 'impersonate') assert.equal(result.swipe, result.expected, 'Failed stream lost the latest swipe tail');
        assert.equal(result.errorCalls, 1, 'Native error handler must execute exactly once');
        assert.equal(result.errorEntry.actual, result.expected, 'Latest data must be committed before native error callbacks');
        if (type !== 'impersonate') assert.equal(result.errorEntry.swipe, result.expected, 'Latest swipe must be committed before native error callbacks');
        else assert.equal(result.errorEntry.chatUnchanged, true, 'Impersonation error changed raw chat before callbacks');
        if (!reasoningOnly) assert(result.errorEntry.dom.includes(`Chunk ${errorAt}`), 'Latest DOM must be committed before native error callbacks');
        else {
            assert.equal(result.errorEntry.dom, '', 'Failed reasoning-only stream left a stale body placeholder');
            const expectedReasoning = Array.from({ length: Math.min(errorAt, Math.ceil(chunks / 3)) }, (_, i) => `Reasoning segment ${i + 1}. `).join('').trim();
            assert.equal(result.errorEntry.reasoning, expectedReasoning, 'Reasoning tail must be committed before native error callbacks');
        }
        if (type !== 'impersonate') assert.equal(result.reasoningState, 'done', 'Failed stream left reasoning active');
    }
    if (toggleAt) assert.equal(result.fpsAtEnd, mode ? 30 : 10, 'Live mode switch did not restore/apply the next-generation preference');
    if (!errorAt) {
        if (type !== 'impersonate') assert.equal(result.swipe, result.expected, 'Current swipe did not retain final output');
        assert.equal(result.finalCalls, 1, 'Native final flush must execute exactly once');
        if (type !== 'impersonate') {
            assert.equal(result.tokenCount, 42);
            assert.equal(result.reasoningState, 'done');
            assert.equal(result.reasoning, `Reasoning segment 1. ${Array.from({ length: Math.min(stopAt || chunks, Math.ceil(chunks / 3)) - 1 }, (_, i) => `Reasoning segment ${i + 2}. `).join('')}`.trim());
        }
        assert(result.dom.includes(`Chunk ${stopAt || chunks}`), 'Final DOM did not contain latest chunk');
    }
    const nativeEvents = type === 'impersonate' || (errorAt && ['swipe', 'continue'].includes(type)) ? 0 : 1;
    assert.equal(result.events.filter(x => x.event === 'MESSAGE_RECEIVED').length, nativeEvents, 'Native message event duplicated or missing');
    assert.equal(result.events.filter(x => x.event === 'CHARACTER_MESSAGE_RENDERED').length, nativeEvents, 'Native rendered event duplicated or missing');
    assert.equal(result.events.filter(x => x.event === 'IMPERSONATE_READY').length, type === 'impersonate' && !errorAt ? 1 : 0, 'Native impersonation event duplicated or missing');
    assert.equal(result.generating, undefined); assert.equal(result.sendBusy, false);
    assert.equal(result.aborted, !!(stopAt || errorAt));
}

try {
    for (let run = 1; run <= repeat; run++) for (const mode of [false, true]) {
        const test = await createPage(mode);
        try {
            const scenarios = [
                ...process.env.CU_STREAM_FUNCTIONAL_ONLY ? [] : [{ id: 'paced', chunks: 90, pace: 16 }],
                ...run > 1 ? [] : [
                    { id: 'continue', type: 'continue', chunks: 24, pace: 16 },
                    { id: 'continue-error', type: 'continue', chunks: 30, pace: 16, errorAt: 13 },
                    { id: 'stop', chunks: 90, pace: 16, stopAt: 25 },
                    { id: 'error', chunks: 30, pace: 16, errorAt: 13 },
                    { id: 'reasoning-error', chunks: 30, pace: 16, errorAt: 13, reasoningOnly: true },
                    { id: 'fade', chunks: 24, pace: 16, fade: true },
                    { id: 'toggle', chunks: 36, pace: 16, toggleAt: 12 },
                    { id: 'toggle-error', chunks: 30, pace: 16, toggleAt: 6, errorAt: 13 },
                    { id: 'impersonate', type: 'impersonate', chunks: 24, pace: 16 },
                    { id: 'impersonate-error', type: 'impersonate', chunks: 30, pace: 16, errorAt: 13 },
                    { id: 'swipe', type: 'swipe', chunks: 24, pace: 16 },
                    { id: 'swipe-error', type: 'swipe', chunks: 30, pace: 16, errorAt: 13 },
                    { id: 'tool-visibility-error', chunks: 2, errorAt: 1, toolVisibility: true },
                    { id: 'tool-reasoning-error', chunks: 2, errorAt: 1, toolVisibility: true, toolReasoning: true },
                ],
            ].filter(scenario => !selectedCases || selectedCases.includes(scenario.id));
            for (const scenario of scenarios) {
                await test.page.evaluate(mode => { const input = document.getElementById('cu-extension-native-performance'); if (input.checked !== mode) { input.checked = mode; input.dispatchEvent(new Event('change', { bubbles: true })); } }, mode);
                await frames(test.page);
                const result = await test.page.evaluate(options => window.cuRunNativeStream(options), scenario);
                result.mode = mode; result.run = run; result.id = scenario.id; report.cases.push(result);
                verify(result, { mode, ...scenario });
                console.log(JSON.stringify({ mode, run, id: scenario.id, tokens: result.tokens.length, updates: result.progressCalls, progressMs: result.progressMs, nativeFPS: result.fps, finalCalls: result.finalCalls, retained: result.actual === result.expected }));
            }
            assert.deepEqual(test.errors, []); report.errors.push(...test.errors);
        } catch (error) {
            report.error = String(error); report.errors.push(...test.errors);
            await test.page.screenshot({ path: path.join(output, `failure-${mode}-${run}.png`) }).catch(() => {}); throw error;
        } finally { await test.context.close(); await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2)); }
    }
    const paired = [];
    for (let run = 1; run <= repeat; run++) {
        const off = report.cases.find(c => c.run === run && c.id === 'paced' && !c.mode), on = report.cases.find(c => c.run === run && c.id === 'paced' && c.mode);
        if (off && on) {
            assert.equal(off.actual, on.actual, 'Mode changed the full final message');
            assert.deepEqual(off.tokens, on.tokens, 'Mode changed native token reception');
            assert.equal(off.lastToken, on.lastToken, 'Mode changed final native token data');
            assert(on.progressCalls < off.progressCalls, 'Lower native FPS did not reduce Markdown/DOM progress calls');
            paired.push({ run, offCalls: off.progressCalls, onCalls: on.progressCalls, offProgressMs: off.progressMs, onProgressMs: on.progressMs });
        }
    }
    report.pairs = paired; report.endedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2));
} finally { await browser.close(); }
