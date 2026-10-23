/**
 * EverOS 记忆 —— DSH 插件的 Host 半（记忆引擎 + 管理面板合一）。
 *
 * 一个 loader row 内同时完成两件事：
 *  1. 记忆（内置的 EverOS 官方引擎，含本地 DSH 0.2 兼容补丁）：
 *     自动回忆、自动记录、开机拉起服务；
 *  2. 管理面板：同源 JSON 路由 /api/everos-panel/*，供浏览器半渲染。
 *
 * 面板的服务参数（地址、启动命令、数据目录）全部从记忆配置派生，只保留一份真相。
 * @module @lorenzo__li/dsh-everos-memory
 */
import z from '@deepseek-ai/schemastery'
import { join } from 'node:path'
import { Config as MemoryConfig, resolveConfig } from './vendor/everos-memory/config.js'
import { apply as memoryApply, setServiceProbe } from './vendor/everos-memory/index.js'
import { createService } from './lib/everos.js'
import { createServiceManager } from './lib/service-manager.js'
import { describeConfig, saveConfig } from './lib/settings.js'

/** 记忆部分只硬依赖 agents；webServer 走可选注入，所以 headless profile 里记忆照常工作。 */
export const inject = ['agents']

/** 浏览器侧 API 前缀（client 用文档相对路径 api/everos-panel/... 访问）。 */
const API = '/api/everos-panel'

const IS_WINDOWS = process.platform === 'win32'

/** 日志时间显示格式（面板设置里可选）。 */
const TIME_FORMATS = new Set(['local', 'local-short', 'iso', 'utc'])

/**
 * 可移植默认值：不假设作者的安装路径。
 * - `EVEROS_DIR` 环境变量优先；
 * - Windows 上退回 `%ProgramData%\everos`；
 * - 都没有就留空，面板会显示"未配置"的引导，用户自己填。
 */
function defaultEverosDir() {
  const env = typeof process.env.EVEROS_DIR === 'string' ? process.env.EVEROS_DIR.trim() : ''
  if (env !== '') return env
  const programData = typeof process.env.ProgramData === 'string' ? process.env.ProgramData.trim() : ''
  if (IS_WINDOWS && programData !== '') return join(programData, 'everos')
  return ''
}

const DEFAULT_EVEROS_DIR = defaultEverosDir()
const DEFAULT_EVEROS_EXE = typeof process.env.EVEROS_EXE === 'string' ? process.env.EVEROS_EXE.trim() : ''
const DEFAULT_LOG_PATH = DEFAULT_EVEROS_DIR === '' ? '' : join(DEFAULT_EVEROS_DIR, 'logs', 'everos-server.log')
/** 诊断日志：默认放在服务目录旁边，可用 EVEROS_DEBUG_LOG 覆盖；为空则不写文件。 */
const DEBUG_LOG = (() => {
  const env = typeof process.env.EVEROS_DEBUG_LOG === 'string' ? process.env.EVEROS_DEBUG_LOG.trim() : ''
  if (env !== '') return env
  return DEFAULT_EVEROS_DIR === '' ? '' : join(DEFAULT_EVEROS_DIR, '..', 'everos-debug.log')
})()

/** 记忆引擎 24 项配置 + 面板 6 项，合成一份设置表单。 */
export const Config = z.object({
  ...MemoryConfig.dict,
  // 覆盖记忆引擎的 autoStart 默认值：默认不自动启动，避免没配置的机器每次开机都尝试失败。
  autoStart: z.boolean().default(false),
  panelLogPath: z.string().default(DEFAULT_LOG_PATH),
  panelEverosExe: z.string().default(''),
  panelTimeFormat: z.union(['local', 'local-short', 'iso', 'utc']).default('local'),
  panelRequestTimeoutMs: z.number().default(20000),
  panelStartTimeoutMs: z.number().default(180000),
  panelAutoRestart: z.boolean().default(true),
  panelRespectManualStop: z.boolean().default(true),
})

/**
 * 从合并配置派生出面板需要的服务参数（地址/命令/目录只写一次）。
 * @param {Record<string, unknown>} input 本 row 的 config
 */
export function panelServiceConfig(input = {}) {
  const resolved = resolveConfig(input)
  let startArgs = Array.isArray(resolved.startCommand) && resolved.startCommand.length > 0
    ? resolved.startCommand.slice()
    : undefined
  const panelExe = typeof input.panelEverosExe === 'string' ? input.panelEverosExe.trim() : ''
  if (panelExe !== '' && startArgs !== undefined) startArgs = [panelExe, ...startArgs.slice(1)]
  const exeFromStart = startArgs !== undefined && startArgs.length > 0 ? String(startArgs[0]) : ''
  const everosExe = panelExe || exeFromStart || DEFAULT_EVEROS_EXE
  const logPath = String(input.panelLogPath || DEFAULT_LOG_PATH)
  const timeFormat = TIME_FORMATS.has(String(input.panelTimeFormat)) ? String(input.panelTimeFormat) : 'local'
  return {
    baseUrl: resolved.baseUrl,
    memoryRoot: resolved.everosDir || DEFAULT_EVEROS_DIR,
    appId: resolved.appId,
    everosExe,
    startArgs,
    logPath,
    timeFormat,
    configured: startArgs !== undefined || everosExe !== '',
    platformSupported: IS_WINDOWS,
    requestTimeoutMs: Math.max(1000, Number(input.panelRequestTimeoutMs) || 20000),
    startTimeoutMs: Math.max(1000, Number(input.panelStartTimeoutMs) || 180000),
    autoStart: resolved.autoStart === true,
  }
}

/** JSON 响应。 */
function writeJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/**
 * 只允许回环、同源的浏览器请求：
 * - socket 对端必须是回环地址
 * - Host 头必须是 localhost / 127.0.0.1 / [::1]（防 DNS rebinding）
 * - 浏览器标记的跨站请求直接拒绝；有 Origin 时必须与 Host 同源
 */
function isSameOriginLoopback(req) {
  const remote = String(req.socket?.remoteAddress ?? '')
  const loopback = remote === '::1' || remote === '::ffff:127.0.0.1' || remote.startsWith('127.')
  if (!loopback) return false

  const host = String(req.headers.host ?? '')
  const hostname = host.replace(/:\d+$/, '').toLowerCase()
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]') return false

  if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return false

  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '') {
    try {
      if (new URL(origin).host !== host) return false
    } catch {
      return false
    }
  }
  return true
}

/** 解析请求 URL（相对 base，只为拿 query 参数）。 */
function queryOf(req) {
  try {
    return new URL(String(req.url ?? '/'), 'http://127.0.0.1').searchParams
  } catch {
    return new URLSearchParams()
  }
}

/** 读取并解析 JSON 请求体（上限 64KB，空 body 返回 null）。 */
async function readJsonBody(req, maxBytes = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return null
  return JSON.parse(text)
}

/**
 * 包装一个 exact 路由：鉴权 fence + 方法校验 + JSON 回写 + 异常兜底。
 * 注意：DSH 的路由按 (kind, path) 去重，所以同一路径只能注册一次；
 * 需要多方法时传数组，由 run 的第二参数区分。
 * @param {string | string[]} methods 允许的 HTTP 方法
 * @param {string} path API 路径（不含前缀）
 * @param {(req: import('node:http').IncomingMessage, method: string) => Promise<{ status: number, body: unknown }>} run
 */
function route(methods, path, run) {
  const allowed = Array.isArray(methods) ? methods : [methods]
  return {
    kind: 'exact',
    path: API + path,
    handler(req, res) {
      if (!isSameOriginLoopback(req)) {
        writeJson(res, 403, { error: 'forbidden' })
        return
      }
      const method = String(req.method ?? '').toUpperCase()
      if (!allowed.includes(method)) {
        writeJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      run(req, method).then(
        ({ status, body }) => writeJson(res, status, body),
        (error) => writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) }),
      )
    },
  }
}

/** 面板的全部路由，绑定到一个服务实例上。 */
function panelRoutes(service, settingsRef, currentValuesRef) {
  return [
    route('GET', '/status', async () => ({ status: 200, body: await service.status() })),
    route('GET', '/tree', async () => ({ status: 200, body: await service.tree() })),
    route('GET', '/file', async (req) => {
      const result = await service.file(queryOf(req).get('path') ?? '')
      return { status: result.status, body: result.body }
    }),
    route('GET', '/locate', async (req) => {
      const result = await service.locate(queryOf(req).get('id') ?? '')
      return { status: result.status, body: result.body }
    }),
    route('GET', '/log', async (req) => {
      const result = await service.log(queryOf(req).get('lines') ?? undefined)
      return { status: 200, body: result.body }
    }),
    route('GET', '/search', async (req) => {
      const query = queryOf(req)
      const body = await service.search(query.get('q') ?? '', query.get('mode') ?? 'everos')
      return { status: 200, body }
    }),
    route(['GET', 'POST'], '/config', async (req, method) => {
      const settings = settingsRef()
      if (method === 'GET') {
        return { status: 200, body: describeConfig(settings, currentValuesRef()) }
      }
      let body
      try {
        body = await readJsonBody(req)
      } catch (error) {
        return { status: 400, body: { error: '请求体不是合法 JSON：' + (error instanceof Error ? error.message : String(error)) } }
      }
      const patch = body !== null && typeof body === 'object' && body.patch !== undefined ? body.patch : body
      try {
        const saved = await saveConfig(settings, currentValuesRef(), patch)
        return { status: 200, body: saved }
      } catch (error) {
        return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } }
      }
    }),
    route('POST', '/start', async () => ({ status: 200, body: await service.start() })),
    route('POST', '/stop', async () => ({ status: 200, body: await service.stop() })),
    route('POST', '/restart', async () => ({ status: 200, body: await service.restart() })),
  ]
}

/**
 * 挂载 Host 半：先启动记忆部分（hooks + 服务拉起），再挂面板路由。
 * @param {import('@deepseek-ai/cordis').Context} ctx 本 row 的上下文
 * @param {Record<string, unknown>} [input] cordis.patch.yml 里本行的 config
 */
export function apply(ctx, input = {}) {
  const config = input ?? {}
  // 当前生效配置（补齐 schema 默认值），设置页在拿不到 DSH 描述时用它兜底。
  let effectiveConfig = config
  try {
    effectiveConfig = Config(config)
  } catch {
    effectiveConfig = config
  }
  const derived = panelServiceConfig(config)

  // 诊断日志路径（引擎按每次调用读取该环境变量；为空表示不写文件）。
  if (!process.env.EVEROS_DEBUG_LOG && DEBUG_LOG !== '') process.env.EVEROS_DEBUG_LOG = DEBUG_LOG

  // 统一管家：服务的唯一拥有者（启动/停止/重启/自愈/记住手动停止）。
  const manager = createServiceManager({
    ...derived,
    autoRestart: config.panelAutoRestart !== false,
    respectManualStop: config.panelRespectManualStop !== false,
  })

  // 记忆部分的"能用吗"探针：不可用就快速跳过，不傻等超时。
  setServiceProbe(() => manager.probe(1500))

  // 记忆部分：不再自己启动服务（服务生命周期全部交给管家）。
  memoryApply(ctx, { ...config, autoStart: false })

  // 管家：autoStart 时开机确保服务在跑；周期自愈始终开启（手动启动后崩了也能救）；
  // 插件卸载时先清探针、再关掉自己拉起的实例。
  ctx.effect(() => {
    const dispose = manager.activate({ startNow: derived.autoStart })
    return async () => {
      await dispose()
      setServiceProbe(null)
    }
  }, 'everos: service manager')

  // 设置服务（可选依赖）：面板设置页用它读当前配置、写回 profile。
  let settingsService = null
  ctx.inject(['settings'], (scope) => {
    settingsService = scope.settings
    scope.effect(() => () => { settingsService = null }, 'everos: settings reference')
  })

  ctx.inject(['webServer'], (web) => {
    const service = createService(derived, manager)
    web.effect(() => {
      const disposers = panelRoutes(service, () => settingsService ?? null, () => effectiveConfig).map((entry) => web.webServer.register(entry))
      return () => { for (const dispose of disposers.splice(0)) dispose() }
    }, 'everos-panel: routes')
  })
}
