/** Zero-dependency HTTP client for EverOS memory routes. */
const PATH_SAFE = /^[a-zA-Z0-9_.@+-]+$/u;
export class EverosError extends Error {
    status;
    code;
    requestId;
    path;
    constructor(status, code, message, requestId, path, options) {
        super(message, options);
        this.status = status;
        this.code = code;
        this.requestId = requestId;
        this.path = path;
        this.name = 'EverosError';
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function assertScopeId(value, field) {
    if (value === undefined)
        return;
    if (value === '.' || value === '..' || value.length > 128 || !PATH_SAFE.test(value)) {
        throw new EverosError(0, 'INVALID_SCOPE_ID', `invalid ${field}: ${JSON.stringify(value)}`);
    }
}
function combinedSignal(configuredTimeout, options) {
    const timeoutMs = options?.timeoutMs ?? configuredTimeout;
    const timeout = timeoutMs !== undefined && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    if (timeout && options?.signal)
        return AbortSignal.any([timeout, options.signal]);
    return timeout ?? options?.signal;
}
export function createEverosClient(options) {
    const baseUrl = options.baseUrl.replace(/\/+$/u, '');
    const doFetch = options.fetch ?? fetch;
    const configuredVersion = options.apiVersion ?? 'auto';
    let negotiatedVersion = configuredVersion === 'auto' ? undefined : configuredVersion;
    async function call(method, path, body, callOptions) {
        let response;
        try {
            response = await doFetch(`${baseUrl}${path}`, {
                method,
                headers: body === undefined ? undefined : { 'content-type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: combinedSignal(options.timeoutMs, callOptions),
            });
        }
        catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            throw new EverosError(0, 'NETWORK_ERROR', `${method} ${path} failed: ${message}`, undefined, path, { cause });
        }
        const text = await response.text();
        let parsed;
        if (text) {
            try {
                parsed = JSON.parse(text);
            }
            catch {
                throw new EverosError(response.status, 'BAD_RESPONSE', `${method} ${path} returned non-JSON (HTTP ${response.status})`, undefined, path);
            }
        }
        return { status: response.status, ok: response.ok, parsed };
    }
    async function enveloped(path, body, callOptions) {
        const result = await call('POST', path, body, callOptions);
        if (result.ok && isRecord(result.parsed) && 'data' in result.parsed) {
            return result.parsed.data;
        }
        if (isRecord(result.parsed) && isRecord(result.parsed.error)) {
            const error = result.parsed.error;
            const requestId = typeof result.parsed.request_id === 'string' ? result.parsed.request_id : undefined;
            throw new EverosError(result.status, error.code, error.message ?? `${path} failed (HTTP ${result.status})`, requestId, error.path ?? path);
        }
        throw new EverosError(result.status, undefined, `${path} returned an unexpected response (HTTP ${result.status})`, undefined, path);
    }
    async function memoryCall(route, body, callOptions) {
        if (negotiatedVersion) {
            return enveloped(`/api/${negotiatedVersion}/memory/${route}`, body, callOptions);
        }
        try {
            const value = await enveloped(`/api/v2/memory/${route}`, body, callOptions);
            negotiatedVersion = 'v2';
            return value;
        }
        catch (error) {
            if (!(error instanceof EverosError) || error.status !== 404)
                throw error;
        }
        const value = await enveloped(`/api/v1/memory/${route}`, body, callOptions);
        negotiatedVersion = 'v1';
        return value;
    }
    return {
        async health(callOptions) {
            const result = await call('GET', '/health', undefined, callOptions);
            if (result.ok && isRecord(result.parsed) && result.parsed.status === 'ok') {
                return { status: 'ok' };
            }
            throw new EverosError(result.status, undefined, `/health returned an unexpected response (HTTP ${result.status})`, undefined, '/health');
        },
        async add(request, callOptions) {
            assertScopeId(request.app_id, 'app_id');
            assertScopeId(request.project_id, 'project_id');
            return memoryCall('add', request, callOptions);
        },
        async search(request, callOptions) {
            if ((request.user_id === undefined) === (request.agent_id === undefined)) {
                throw new EverosError(0, 'INVALID_OWNER', 'exactly one of user_id / agent_id must be provided');
            }
            assertScopeId(request.app_id, 'app_id');
            assertScopeId(request.project_id, 'project_id');
            return memoryCall('search', request, callOptions);
        },
        async flush(request, callOptions) {
            assertScopeId(request.app_id, 'app_id');
            assertScopeId(request.project_id, 'project_id');
            return memoryCall('flush', request, callOptions);
        },
        resolvedApiVersion() {
            return negotiatedVersion;
        },
    };
}
