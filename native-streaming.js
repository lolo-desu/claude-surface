// The host throttles both painting and message persistence while streaming.
// Its error path skips the final progress update. Preserve the last received
// chunk synchronously before native error events can save or expose the chat.
export function setupNativeStreaming({ context, host, enabled, document: root = globalThis.document, jquery = globalThis.jQuery, report = error => console.error('[Claude Surface]', error) }) {
    const initial = context(), events = initial.eventSource, types = initial.eventTypes;
    const supported = !!(events?.on && events?.removeListener && types?.STREAM_TOKEN_RECEIVED && types?.GENERATION_ENDED && types?.CHAT_CHANGED
        && typeof jquery === 'function' && root?.getElementById && 'streamingProcessor' in host
        && ['cleanUpMessage', 'updateMessageElement', 'syncMesToSwipe'].every(key => typeof host[key] === 'function'));
    let current = null;
    const chatKey = value => [String(value.characterId ?? ''), String(value.groupId ?? ''), value.getCurrentChatId?.()];
    function release(record = current) {
        if (!record) return;
        if (record.processor.onErrorStreaming === record.wrapper) {
            if (record.descriptor) Object.defineProperty(record.processor, 'onErrorStreaming', record.descriptor);
            else delete record.processor.onErrorStreaming;
        }
        if (current === record) current = null;
    }
    function sameMessage(record) {
        const value = context(), processor = record.processor, key = chatKey(value);
        if (host.streamingProcessor !== processor || key.some((part, index) => part !== record.key[index])) return false;
        if (processor.type === 'impersonate') return processor.sendTextarea === root.getElementById('send_textarea') && processor.sendTextarea?.isConnected;
        return value.chat?.[record.id] === record.message && processor.messageId === record.id
            && processor.messageDom === record.element && record.element?.isConnected
            && record.element.parentElement === root.getElementById('chat')
            && record.element.getAttribute('mesid') === String(record.id);
    }
    const watch = promise => { if (promise?.catch) promise.catch(report); };
    const onEnded = () => {
        if (current && (host.streamingProcessor !== current.processor || current.processor.isStopped || current.processor.isFinished)) release();
    };
    const onChatChanged = () => release();
    function repair(record) {
        if (!sameMessage(record)) return;
        const processor = record.processor;
        if (typeof processor.result !== 'string') return;
        const text = host.cleanUpMessage({
            getMessage: (processor.continueMessage || '') + processor.result,
            isImpersonate: processor.type === 'impersonate', isContinue: processor.type === 'continue',
            displayIncompleteSentences: false, stoppingStrings: processor.stoppingStrings,
        });
        if (!sameMessage(record)) return;
        if (processor.type === 'impersonate') {
            processor.sendTextarea.value = text;
            const EventClass = root.defaultView?.Event || globalThis.Event;
            processor.sendTextarea.dispatchEvent(new EventClass('input', { bubbles: true }));
            return;
        }
        const message = record.message, changed = message.mes !== text;
        message.mes = text;
        message.gen_started = processor.timeStarted;
        message.gen_finished = new Date();
        message.extra ??= {};
        message.extra.time_to_first_token = processor.timeToFirstToken;
        // Native ReasoningHandler parses/persists its message data before the
        // first await. Its continuation only updates cached reasoning DOM.
        // Do not await: native generate() does not await onErrorStreaming().
        watch(processor.reasoningHandler.process(record.id, changed, processor.promptReasoning));
        if (!sameMessage(record)) return;
        watch(processor.reasoningHandler.finish(record.id));
        if (!sameMessage(record)) return;
        // Match native streaming's tool-placeholder visibility rule. The last
        // received text/reasoning may have arrived before its next paint tick.
        if (Array.isArray(processor.toolCalls) && processor.toolCalls.length > 0) {
            record.element.classList.toggle('displayNone', ['', '...'].includes(processor.result) && !processor.reasoningHandler.reasoning);
        }
        host.updateMessageElement(message, { messageId: record.id, messageElement: jquery(record.element) });
        if (sameMessage(record)) host.syncMesToSwipe(record.id);
    }
    function onToken() {
        const processor = host.streamingProcessor;
        if (current?.processor !== processor) release();
        if (!enabled() || !processor || current?.processor === processor) return;
        if (typeof processor.onErrorStreaming !== 'function' || !processor.reasoningHandler
            || !['process', 'finish'].every(key => typeof processor.reasoningHandler[key] === 'function')) return;
        const value = context(), id = processor.messageId;
        if (processor.type !== 'impersonate' && (!Number.isInteger(id) || id < 0 || !value.chat?.[id])) return;
        const record = { processor, id, key: chatKey(value), message: value.chat?.[id], element: processor.messageDom,
            original: processor.onErrorStreaming, descriptor: Object.getOwnPropertyDescriptor(processor, 'onErrorStreaming') };
        if (!sameMessage(record)) return;
        record.wrapper = function (...args) {
            if (this === processor) {
                try { repair(record); } catch (error) { report(error); }
                release(record);
            }
            return record.original.apply(this, args);
        };
        try { processor.onErrorStreaming = record.wrapper; }
        catch { return; }
        if (processor.onErrorStreaming !== record.wrapper) return;
        current = record;
    }
    if (supported) {
        events.on(types.STREAM_TOKEN_RECEIVED, onToken);
        events.on(types.GENERATION_ENDED, onEnded);
        events.on(types.CHAT_CHANGED, onChatChanged);
    }
    return {
        supported,
        destroy() {
            if (supported) {
                events.removeListener(types.STREAM_TOKEN_RECEIVED, onToken);
                events.removeListener(types.GENERATION_ENDED, onEnded);
                events.removeListener(types.CHAT_CHANGED, onChatChanged);
            }
            release();
        },
    };
}
