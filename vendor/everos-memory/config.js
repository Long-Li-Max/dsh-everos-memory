/** Plugin configuration and validation. */
import z from '@deepseek-ai/schemastery';
export const DEFAULTS = {
    baseUrl: 'http://127.0.0.1:8000',
    apiVersion: 'auto',
    appId: 'dsh',
    recallMethod: 'keyword',
    queryN: 3,
    queryMaxChars: 2_000,
    recallTopK: 5,
    recallMaxChars: 12_000,
    recallTimeoutMs: 5_000,
    captureTimeoutMs: 15_000,
    captureMaxChars: 50_000,
    flushIdleMs: 30_000,
    flushTokenThreshold: 12_000,
    flushMessageThreshold: 50,
    flushMaxDelayMs: 300_000,
    flushOnSessionSwitch: true,
    autoStart: true,
    readinessTimeoutMs: 60_000,
    readinessIntervalMs: 1_000,
};
const SCOPE_ID = /^[a-zA-Z0-9_.@+-]+$/u;
export const Config = z.object({
    baseUrl: z.string().default(DEFAULTS.baseUrl),
    apiVersion: z.union(['auto', 'v1', 'v2']).default(DEFAULTS.apiVersion),
    appId: z.string().default(DEFAULTS.appId),
    projectId: z.string(),
    userId: z.string(),
    agentId: z.string(),
    recallMethod: z
        .union(['keyword', 'vector', 'hybrid', 'agentic'])
        .default(DEFAULTS.recallMethod),
    queryN: z.number().default(DEFAULTS.queryN),
    queryMaxChars: z.number().default(DEFAULTS.queryMaxChars),
    recallTopK: z.number().default(DEFAULTS.recallTopK),
    recallMaxChars: z.number().default(DEFAULTS.recallMaxChars),
    recallTimeoutMs: z.number().default(DEFAULTS.recallTimeoutMs),
    captureTimeoutMs: z.number().default(DEFAULTS.captureTimeoutMs),
    captureMaxChars: z.number().default(DEFAULTS.captureMaxChars),
    flushIdleMs: z.number().default(DEFAULTS.flushIdleMs),
    flushTokenThreshold: z.number().default(DEFAULTS.flushTokenThreshold),
    flushMessageThreshold: z.number().default(DEFAULTS.flushMessageThreshold),
    flushMaxDelayMs: z.number().default(DEFAULTS.flushMaxDelayMs),
    flushOnSessionSwitch: z.boolean().default(DEFAULTS.flushOnSessionSwitch),
    autoStart: z.boolean().default(DEFAULTS.autoStart),
    startCommand: z.string(),
    everosDir: z.string(),
    readinessTimeoutMs: z.number().default(DEFAULTS.readinessTimeoutMs),
    readinessIntervalMs: z.number().default(DEFAULTS.readinessIntervalMs),
});
/** Normalize a human-entered HTTP URL and remove trailing slashes. */
export function normalizeBaseUrl(raw) {
    let value = raw?.trim() || DEFAULTS.baseUrl;
    if (!/^https?:\/\//iu.test(value))
        value = `http://${value}`;
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:')
            return DEFAULTS.baseUrl;
        return url.toString().replace(/\/+$/u, '');
    }
    catch {
        return DEFAULTS.baseUrl;
    }
}
/** Split an argv string without invoking a shell or performing expansion. */
export function splitCommand(raw) {
    const output = [];
    let previousEnd = -1;
    for (const match of raw.matchAll(/"([^"]*)"|'([^']*)'|([^\s"']+)/gu)) {
        const piece = match[1] ?? match[2] ?? match[3] ?? '';
        const index = match.index ?? -1;
        if (index === previousEnd && output.length > 0)
            output[output.length - 1] += piece;
        else
            output.push(piece);
        previousEnd = index + match[0].length;
    }
    return output.filter(Boolean);
}
function positiveInteger(value, fallback, field) {
    const selected = value ?? fallback;
    if (!Number.isSafeInteger(selected) || selected <= 0) {
        throw new TypeError(`everos-memory: ${field} must be a positive safe integer`);
    }
    return selected;
}
function optionalString(value) {
    return value?.trim() || undefined;
}
function scopeId(value, fallback, field) {
    const selected = optionalString(value) ?? fallback;
    if (selected === undefined)
        return undefined;
    if (selected === '.' || selected === '..' || selected.length > 128 || !SCOPE_ID.test(selected)) {
        throw new TypeError(`everos-memory: ${field} must be a path-safe identifier of at most 128 characters`);
    }
    return selected;
}
export function resolveConfig(input = {}) {
    const startCommandText = optionalString(input.startCommand);
    const startCommand = startCommandText ? splitCommand(startCommandText) : undefined;
    if (startCommandText && startCommand?.length === 0) {
        throw new TypeError('everos-memory: startCommand must contain an executable');
    }
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const parsedBaseUrl = new URL(baseUrl);
    if (parsedBaseUrl.username ||
        parsedBaseUrl.password ||
        parsedBaseUrl.search ||
        parsedBaseUrl.hash) {
        throw new TypeError('everos-memory: baseUrl must not contain credentials, query parameters, or a fragment');
    }
    return {
        baseUrl,
        apiVersion: input.apiVersion ?? DEFAULTS.apiVersion,
        appId: scopeId(input.appId, DEFAULTS.appId, 'appId') ?? DEFAULTS.appId,
        projectId: scopeId(input.projectId, undefined, 'projectId'),
        userId: optionalString(input.userId),
        agentId: optionalString(input.agentId),
        recallMethod: input.recallMethod ?? DEFAULTS.recallMethod,
        queryN: positiveInteger(input.queryN, DEFAULTS.queryN, 'queryN'),
        queryMaxChars: positiveInteger(input.queryMaxChars, DEFAULTS.queryMaxChars, 'queryMaxChars'),
        recallTopK: positiveInteger(input.recallTopK, DEFAULTS.recallTopK, 'recallTopK'),
        recallMaxChars: positiveInteger(input.recallMaxChars, DEFAULTS.recallMaxChars, 'recallMaxChars'),
        recallTimeoutMs: positiveInteger(input.recallTimeoutMs, DEFAULTS.recallTimeoutMs, 'recallTimeoutMs'),
        captureTimeoutMs: positiveInteger(input.captureTimeoutMs, DEFAULTS.captureTimeoutMs, 'captureTimeoutMs'),
        captureMaxChars: positiveInteger(input.captureMaxChars, DEFAULTS.captureMaxChars, 'captureMaxChars'),
        flushIdleMs: positiveInteger(input.flushIdleMs, DEFAULTS.flushIdleMs, 'flushIdleMs'),
        flushTokenThreshold: positiveInteger(input.flushTokenThreshold, DEFAULTS.flushTokenThreshold, 'flushTokenThreshold'),
        flushMessageThreshold: positiveInteger(input.flushMessageThreshold, DEFAULTS.flushMessageThreshold, 'flushMessageThreshold'),
        flushMaxDelayMs: positiveInteger(input.flushMaxDelayMs, DEFAULTS.flushMaxDelayMs, 'flushMaxDelayMs'),
        flushOnSessionSwitch: input.flushOnSessionSwitch ?? DEFAULTS.flushOnSessionSwitch,
        autoStart: input.autoStart ?? DEFAULTS.autoStart,
        startCommand,
        everosDir: optionalString(input.everosDir),
        readinessTimeoutMs: positiveInteger(input.readinessTimeoutMs, DEFAULTS.readinessTimeoutMs, 'readinessTimeoutMs'),
        readinessIntervalMs: positiveInteger(input.readinessIntervalMs, DEFAULTS.readinessIntervalMs, 'readinessIntervalMs'),
    };
}
