/** EverOS automatic long-term memory for DeepSeek Harness. */
import { appendFileSync, statSync, truncateSync } from 'node:fs';
import { Config, resolveConfig } from './config.js';
import { createEverosClient } from './everos-client.js';
import { resolveUserId } from './identity.js';
import { MemoryRuntime } from './memory-runtime.js';
import { provision } from './provision.js';
import { PLUGIN_NAME, recallMessage } from './recall.js';
export const name = PLUGIN_NAME;
export const inject = ['agents'];
export { Config };
/** Local patch: fail-open swallows every error, so mirror diagnostics to a file. */
const DEBUG_LOG_DEFAULT = 'D:\\ProgramData\\everos-debug.log';
const DEBUG_LOG_MAX_BYTES = 5 * 1024 * 1024;
/** 每次调用时读环境变量：插件可以在 apply() 里按可移植规则改路径，或置空关闭文件日志。 */
function debugLogPath() {
    const env = process.env.EVEROS_DEBUG_LOG;
    if (typeof env === 'string') return env.trim();
    return DEBUG_LOG_DEFAULT;
}
let debugWrites = 0;
function debug(line) {
    try {
        const file = debugLogPath();
        if (file === '') return;
        if (++debugWrites % 200 === 0) {
            const stats = statSync(file, { throwIfNoEntry: false });
            if (stats && stats.size > DEBUG_LOG_MAX_BYTES)
                truncateSync(file, 0);
        }
        appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
    }
    catch {
        /* diagnostics must never break the host */
    }
}
const describe = (error) => (error instanceof Error ? error.stack ?? error.message : String(error));
/** Local patch (Phase 2): the unified service manager installs a cheap usability probe. */
let serviceProbe = null;
export function setServiceProbe(probe) {
    serviceProbe = typeof probe === 'function' ? probe : null;
}
export function apply(ctx, input) {
    const config = resolveConfig(input);
    const logger = {
        info: (message) => {
            ctx.logger.info(message);
            debug(`[info] ${message}`);
        },
        warn: (message) => {
            ctx.logger.warn(message);
            debug(`[warn] ${message}`);
        },
        error: (message) => {
            ctx.logger.error(message);
            debug(`[error] ${message}`);
        },
    };
    const userId = resolveUserId(config.userId);
    const client = createEverosClient({
        baseUrl: config.baseUrl,
        apiVersion: config.apiVersion,
    });
    const runtime = new MemoryRuntime({ client, config, userId, logger });
    ctx.on('agent/pre-step', async ({ agent, signal, step }, next) => {
        const decision = await next();
        if (decision.kind === 'reject' || signal.aborted || step !== 1)
            return decision;
        if (serviceProbe !== null && !(await serviceProbe())) {
            debug('skip recall: service not usable');
            return decision;
        }
        debug(`hook pre-step turn-step=${step} session=${agent?.session?.id} events=${typeof agent?.session?.snapshotEvents === 'function' ? agent.session.snapshotEvents().length : (Array.isArray(agent?.session?.events) ? agent.session.events.length : 'none')}`);
        runtime.noteActivity(agent.session);
        try {
            await runtime.flushBeforeRecall(agent.session);
        }
        catch (error) {
            logger.warn(`everos-memory: session-switch flush failed open: ${String(error)}`);
        }
        try {
            const recalled = await recallMessage({
                client,
                config,
                userId,
                session: agent.session,
                messages: decision.messages,
                signal,
                logger,
            });
            debug(`recall result: ${recalled ? 'injected' : 'empty'}`);
            if (!recalled)
                return decision;
            return { kind: 'enter', messages: [...decision.messages, recalled] };
        }
        catch (error) {
            logger.warn(`everos-memory: recall failed open: ${String(error)}`);
            debug(`recall stack: ${describe(error)}`);
            return decision;
        }
    }, { prepend: true });
    ctx.on('agent/turn-stopping', async ({ agent }) => {
        debug(`hook turn-stopping session=${agent?.session?.id}`);
        if (serviceProbe !== null && !(await serviceProbe())) {
            debug('skip capture: service not usable');
            return;
        }
        try {
            await runtime.capture(agent.session);
            debug('capture ok');
        }
        catch (error) {
            logger.warn(`everos-memory: capture failed open: ${String(error)}`);
            debug(`capture stack: ${describe(error)}`);
        }
    });
    ctx.on('session/disposed', (session) => {
        runtime.track(runtime.seal(session), 'session seal');
    });
    let stopping = false;
    let inFlightStop;
    const provisioned = config.autoStart
        ? provision({
            baseUrl: config.baseUrl,
            apiVersion: config.apiVersion,
            startCommand: config.startCommand,
            cwd: config.everosDir,
            readinessTimeoutMs: config.readinessTimeoutMs,
            readinessIntervalMs: config.readinessIntervalMs,
            logger,
            client,
            onStop: (stop) => {
                inFlightStop = stop;
                if (stopping)
                    stop();
            },
        }).catch((error) => {
            logger.warn(`everos-memory: provisioning failed open: ${String(error)}`);
            return undefined;
        })
        : Promise.resolve(undefined);
    ctx.effect(() => async () => {
        await runtime.dispose();
        stopping = true;
        const result = await provisioned;
        const stop = result?.stop ?? inFlightStop;
        stop?.();
    }, 'everos-memory: drain capture and stop owned EverOS process');
    logger.info(`everos-memory: active at ${config.baseUrl}, api=${config.apiVersion}`);
}
