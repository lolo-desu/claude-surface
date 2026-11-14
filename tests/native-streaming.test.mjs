import test from 'node:test';
import assert from 'node:assert/strict';
import { setupNativeStreaming } from '../native-streaming.js';

function harness() {
    const listeners = new Map(), calls = [], errors = [], terminal = [];
    const events = {
        on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
        removeListener(name, fn) { listeners.get(name)?.delete(fn); },
        emit(name, ...args) { for (const fn of [...(listeners.get(name) || [])]) fn(...args); },
    };
    const message = { mes: 'OLD', extra: {}, swipes: ['OLD'], swipe_info: [{}], swipe_id: 0 };
    const chatRoot = {}, element = { isConnected: true, parentElement: chatRoot, getAttribute: () => '0' };
    const textarea = { value: '', isConnected: true, dispatchEvent(event) { calls.push(['input', event.type]); } };
    const document = { getElementById: id => ({ chat: chatRoot, send_textarea: textarea })[id] };
    let active = true, chatId = 'chat';
    const context = { characterId: 0, groupId: null, chat: [message], getCurrentChatId: () => chatId, eventSource: events,
        eventTypes: { STREAM_TOKEN_RECEIVED: 'token', GENERATION_ENDED: 'ended', CHAT_CHANGED: 'chatChanged' } };
    const prototype = { onErrorStreaming(...args) {
        this.isStopped = true; calls.push(['original', ...args]);
        terminal.push({ mes: context.chat[0]?.mes, reason: context.chat[0]?.extra.reasoning, swipe: context.chat[0]?.swipes?.[0], dom: element.text });
        events.emit('ended', context.chat.length);
        return 'native-result';
    } };
    const processor = Object.assign(Object.create(prototype), {
        type: 'normal', messageId: 0, messageDom: element, result: 'LATEST', continueMessage: '', stoppingStrings: [],
        timeStarted: new Date(0), timeToFirstToken: 12, sendTextarea: textarea,
        reasoningHandler: {
            process(id, changed) { calls.push(['reason', id, changed]); context.chat[id].extra.reasoning = 'latest reason'; return Promise.resolve(); },
            finish(id) { calls.push(['reason-finish', id]); context.chat[id].extra.reasoning_duration = 42; return Promise.resolve(); },
        },
    });
    const host = {
        streamingProcessor: processor,
        cleanUpMessage(options) { calls.push(['clean', options]); return options.getMessage; },
        updateMessageElement(value, options) { assert.equal(options.messageElement[0], element); element.text = value.mes; calls.push(['render', options.messageId]); },
        syncMesToSwipe(id) { const value = context.chat[id]; value.swipes[0] = value.mes; value.swipe_info[0] = { extra: structuredClone(value.extra) }; calls.push(['swipe', id]); },
    };
    const api = setupNativeStreaming({ context: () => context, host, enabled: () => active, document, jquery: value => [value], report: error => errors.push(String(error)) });
    return { api, listeners, events, context, host, processor, message, element, textarea, calls, terminal, errors, original: prototype.onErrorStreaming,
        set enabled(value) { active = value; }, set chatId(value) { chatId = value; } };
}

test('repairs current data, reasoning, DOM and swipe synchronously before native error notification', () => {
    const h = harness(); assert.equal(h.api.supported, true); h.events.emit('token', 'LATEST');
    assert.notEqual(h.processor.onErrorStreaming, h.original);
    assert.equal(h.processor.onErrorStreaming('error-argument'), 'native-result');
    assert.deepEqual(h.terminal, [{ mes: 'LATEST', reason: 'latest reason', swipe: 'LATEST', dom: 'LATEST' }]);
    assert.equal(h.calls.filter(([name]) => name === 'original').length, 1);
    assert.equal(h.calls.at(-1)[0], 'original');
    assert.equal(Object.hasOwn(h.processor, 'onErrorStreaming'), false); assert.deepEqual(h.errors, []);
});
test('the error guard survives modeoff because an existing native stopwatch keeps its interval', () => {
    const h = harness(); h.events.emit('token'); h.enabled = false; h.processor.result = 'LAST AFTER MODE OFF'; h.events.emit('token');
    h.processor.onErrorStreaming(); assert.equal(h.message.mes, 'LAST AFTER MODE OFF');
    assert.equal(h.terminal.length, 1);
});
test('continue mode includes its preserved prefix and normal cleanup options', () => {
    const h = harness(); h.processor.type = 'continue'; h.processor.continueMessage = 'PREFIX '; h.events.emit('token'); h.processor.onErrorStreaming();
    assert.equal(h.message.mes, 'PREFIX LATEST');
    const options = h.calls.find(([name]) => name === 'clean')[1];
    assert.equal(options.isContinue, true); assert.equal(options.displayIncompleteSentences, false);
});
test('native reasoning parsing occurs before rendering and swipe persistence', () => {
    const h = harness(); h.processor.result = '<think>thought</think>BODY';
    h.processor.reasoningHandler.process = id => { h.context.chat[id].mes = 'BODY'; h.context.chat[id].extra.reasoning = 'thought'; return Promise.resolve(); };
    h.events.emit('token'); h.processor.onErrorStreaming();
    assert.deepEqual(h.terminal[0], { mes: 'BODY', reason: 'thought', swipe: 'BODY', dom: 'BODY' });
});
test('tool errors synchronize native placeholder visibility without changing unrelated hidden messages', () => {
    for (const [result, reasoning, hidden] of [['LATEST', '', false], ['...', 'LATEST REASONING', false], ['...', '', true]]) {
        const h = harness(); h.processor.result = result; h.processor.reasoningHandler.reasoning = reasoning;
        h.processor.toolCalls = [{ id: 'native-tool' }];
        h.element.classList = { toggle(name, value) { assert.equal(name, 'displayNone'); h.calls.push(['visibility', value]); } };
        h.events.emit('token'); h.processor.onErrorStreaming();
        assert.deepEqual(h.calls.find(([name]) => name === 'visibility'), ['visibility', hidden]);
        assert(h.calls.findIndex(([name]) => name === 'visibility') < h.calls.findIndex(([name]) => name === 'render'));
    }
    const h = harness(); h.processor.toolCalls = [];
    h.element.classList = { toggle() { assert.fail('A non-tool message may be hidden by another feature'); } };
    h.events.emit('token'); h.processor.onErrorStreaming(); assert.equal(h.errors.length, 0);
});
test('impersonation repairs its native text input without creating or mutating a chat message', () => {
    const h = harness(); h.processor.type = 'impersonate'; h.processor.messageId = -1;
    h.events.emit('token'); h.processor.onErrorStreaming();
    assert.equal(h.textarea.value, 'LATEST'); assert.equal(h.message.mes, 'OLD');
    assert.equal(h.calls.filter(([name]) => name === 'input').length, 1);
    assert.equal(h.calls.filter(([name]) => name === 'render').length, 0);
});
test('stale chat, message, processor or DOM identities never receive a repair', () => {
    for (const change of ['chat', 'message', 'processor', 'detached', 'moved', 'id']) {
        const h = harness(); h.events.emit('token'); const wrapper = h.processor.onErrorStreaming;
        if (change === 'chat') h.chatId = 'other';
        if (change === 'message') h.context.chat[0] = { mes: 'OTHER', extra: {} };
        if (change === 'processor') h.host.streamingProcessor = {};
        if (change === 'detached') h.element.isConnected = false;
        if (change === 'moved') h.element.parentElement = {};
        if (change === 'id') h.processor.messageId = 1;
        wrapper.call(h.processor); assert.equal(h.message.mes, 'OLD', change);
        assert.equal(h.calls.filter(([name]) => name === 'render').length, 0, change);
        assert.equal(h.calls.filter(([name]) => name === 'original').length, 1, change);
    }
});
test('a synchronous context change during reasoning cannot render or sync into the next chat', () => {
    const h = harness(); h.events.emit('token');
    h.processor.reasoningHandler.process = () => { h.context.chat[0] = { mes: 'NEW CHAT', extra: {} }; return Promise.resolve(); };
    h.processor.onErrorStreaming(); assert.equal(h.context.chat[0].mes, 'NEW CHAT');
    assert.equal(h.calls.filter(([name]) => ['render', 'swipe', 'reason-finish'].includes(name)).length, 0);
});
test('unrelated generation-ended events retain the active processor guard', () => {
    const h = harness(); h.events.emit('token'); const wrapper = h.processor.onErrorStreaming;
    h.events.emit('ended', 1); assert.equal(h.processor.onErrorStreaming, wrapper);
    h.processor.isFinished = true; h.events.emit('ended', 1); assert.equal(h.processor.onErrorStreaming, h.original);
});
test('terminal cleanup restores only its own method and preserves foreign replacements', () => {
    for (const event of ['ended', 'chatChanged']) {
        const h = harness(); h.events.emit('token'); const foreign = () => 'foreign'; h.processor.onErrorStreaming = foreign;
        h.processor.isFinished = true; h.events.emit(event, 1); h.api.destroy();
        assert.equal(h.processor.onErrorStreaming, foreign);
    }
});
test('destroy releases owned instance methods and all public event subscriptions', () => {
    const h = harness(); h.events.emit('token'); h.api.destroy();
    assert.equal(h.processor.onErrorStreaming, h.original);
    assert.equal([...h.listeners.values()].reduce((count, set) => count + set.size, 0), 0);
});
test('error repair exceptions still forward exactly once to native error behavior', () => {
    const h = harness(); h.events.emit('token'); h.host.updateMessageElement = () => { throw new Error('render failure'); };
    h.processor.onErrorStreaming(); assert.equal(h.message.mes, 'LATEST');
    assert.equal(h.calls.filter(([name]) => name === 'original').length, 1); assert.match(h.errors[0], /render failure/);
});
test('disabled mode does not install an instance wrapper', () => {
    const h = harness(); h.enabled = false; h.events.emit('token');
    assert.equal(h.processor.onErrorStreaming, h.original); assert.equal(Object.hasOwn(h.processor, 'onErrorStreaming'), false);
});
test('a host missing a required public renderer reports unsupported without subscribing', () => {
    const h = harness(); h.api.destroy(); delete h.host.updateMessageElement;
    const api = setupNativeStreaming({ context: () => h.context, host: h.host, enabled: () => true,
        document: { getElementById: () => null }, jquery: value => [value] });
    assert.equal(api.supported, false); h.events.emit('token');
    assert.equal(h.processor.onErrorStreaming, h.original);
    assert.equal([...h.listeners.values()].reduce((count, set) => count + set.size, 0), 0);
    api.destroy();
});
