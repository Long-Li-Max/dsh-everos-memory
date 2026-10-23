/** Lossless-enough DSH event mapping for EverOS user and agent extraction. */
import { agentIdOf } from './identity.js';
import { blocksToText, eventsOf, isDirectUserMessage } from './recall.js';
function clipText(text, maxChars) {
    if (text.length <= maxChars)
        return text;
    const marker = '\n[truncated by everos-memory]';
    return `${text.slice(0, Math.max(0, maxChars - marker.length))}${marker}`;
}
function boundedArguments(argumentsText, maxChars) {
    if (argumentsText.length <= maxChars)
        return argumentsText;
    return JSON.stringify({
        everos_truncated: true,
        preview: argumentsText.slice(0, Math.max(0, maxChars - 100)),
    });
}
function toolCalls(blocks, maxChars) {
    const calls = blocks.flatMap((block) => {
        if (block.type !== 'tool-call')
            return [];
        return [
            {
                id: String(block.id),
                type: 'function',
                function: {
                    name: block.name,
                    arguments: boundedArguments(block.arguments, maxChars),
                },
            },
        ];
    });
    return calls.length === 0 ? undefined : calls;
}
function toolNameIndex(session) {
    const names = new Map();
    for (const event of eventsOf(session)) {
        if (event.type === 'tool/call')
            names.set(String(event.data.callId), event.data.name);
    }
    return names;
}
/**
 * Convert new model-visible events after `afterSeq`.
 *
 * Raw reasoning chunks and plugin-injected context are intentionally excluded.
 * Assistant tool calls and tool results are retained because EverOS uses them to
 * extract reusable agent cases and skills.
 */
export function captureMessagesSince(session, afterSeq, userId, configuredAgentId, maxChars) {
    const agentId = agentIdOf(session, configuredAgentId);
    const names = toolNameIndex(session);
    const output = [];
    let scannedThroughSeq = afterSeq;
    for (const event of eventsOf(session)) {
        if (event.seq <= afterSeq)
            continue;
        scannedThroughSeq = Math.max(scannedThroughSeq, event.seq);
        const timestamp = Number.isSafeInteger(event.time) && event.time > 0 ? event.time : Date.now();
        switch (event.type) {
            case 'user/message': {
                if (!isDirectUserMessage(event.data))
                    break;
                const content = clipText(blocksToText(event.data.content), maxChars);
                if (!content)
                    break;
                output.push({
                    seq: event.seq,
                    item: {
                        sender_id: userId,
                        role: 'user',
                        timestamp,
                        content,
                    },
                });
                break;
            }
            case 'assistant/message': {
                const message = event.data.message;
                const calls = toolCalls(message.content, maxChars);
                const content = clipText(blocksToText(message.content), maxChars);
                if (!content && !calls)
                    break;
                output.push({
                    seq: event.seq,
                    item: {
                        sender_id: agentId,
                        sender_name: `${message.source.provider}/${message.source.model}`,
                        role: 'assistant',
                        timestamp,
                        content,
                        ...(calls ? { tool_calls: calls } : {}),
                    },
                });
                break;
            }
            case 'tool/result': {
                const message = event.data.message;
                const block = message.content[0];
                // DSH 0.2 moved toolCallId/isError onto the message and keeps
                // plain content blocks; 0.1 nested them inside a tool-result block.
                const callId = String(message.toolCallId ?? block?.toolCallId ?? message.source?.callId ?? 'unknown');
                const resultText = blocksToText(block?.type === 'tool-result' ? block.content : message.content);
                const status = message.isError || block?.isError || event.data.error ? '[tool error]\n' : '';
                const content = clipText(`${status}${resultText}`, maxChars).trim() || '[empty tool result]';
                output.push({
                    seq: event.seq,
                    item: {
                        sender_id: agentId,
                        sender_name: names.get(callId) ?? 'tool',
                        role: 'tool',
                        timestamp,
                        content,
                        tool_call_id: callId,
                    },
                });
                break;
            }
            default:
                break;
        }
    }
    return { messages: output, scannedThroughSeq };
}
