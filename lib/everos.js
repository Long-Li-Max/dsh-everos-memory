/**
 * EverOS 面板插件的 Host 侧服务：所有逻辑都在本机 Node 进程里执行，
 * 不依赖原来的 Python 面板（D:\\ProgramData\\everos-ui/server.py）。
 *
 * 数据来源：
 *  - EverOS 服务自身：GET /health、GET /metrics、POST /api/v2/memory/search
 *  - 记忆文件：{memoryRoot}/{appId} 下的全部 .md（Markdown 即事实来源，只读）
 *  - 进程状态：netstat 找端口监听者 + /health 校验（防止误杀别的程序）
 * @module dsh-everos-panel/lib/everos
 */
import { execFile, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, statSync, writeSync } from 'node:fs'
import { open, readFile, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** 面板自身的兜底默认值（真正生效的路径由 index.js 的可移植默认值派生后传进来）。 */
export const DEFAULT_CONFIG = {
  baseUrl: 'http://127.0.0.1:8000',
  memoryRoot: '',
  appId: 'dsh',
  everosExe: '',
  logPath: '',
  requestTimeoutMs: 20000,
  startTimeoutMs: 180000,
  timeFormat: 'local',
}

/** posix 风格相对路径（Windows 上反斜杠换成正斜杠，前端统一用它）。 */
const posix = (value) => value.split(sep).join('/')

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** 本地时间字符串，用于日志分隔行。 */
function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 带超时的 JSON 请求；网络错误一律归一成 status 0，不抛。 */
async function fetchJson(url, options = {}) {
  const { method = 'GET', body, timeoutMs = 5000 } = options
  const init = { method, signal: AbortSignal.timeout(timeoutMs) }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  try {
    const response = await fetch(url, init)
    const text = await response.text()
    let json = null
    if (text !== '') {
      try { json = JSON.parse(text) } catch { json = null }
    }
    return { status: response.status, json, text }
  } catch {
    return { status: 0, json: null, text: '' }
  }
}

/** 带超时的纯文本请求。 */
async function fetchText(url, timeoutMs = 5000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return ''
    return await response.text()
  } catch {
    return ''
  }
}

/** /health 通过（200 且 status=ok）才认为服务可用。 */
async function readHealth(baseUrl) {
  const result = await fetchJson(baseUrl + '/health', { timeoutMs: 2000 })
  return result.status === 200 && result.json !== null && result.json.status === 'ok' ? result.json : null
}

/** 端口上处于 LISTENING 的进程 PID（netstat 解析；拿不到返回 null）。 */
async function listenPid(port) {
  let output = ''
  try {
    output = await new Promise((done) => {
      execFile('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true, timeout: 10000, encoding: 'utf8' },
        (error, stdout) => { done(error ? '' : String(stdout ?? '')) })
    })
  } catch {
    return null
  }
  const suffix = ':' + port
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5) continue
    if (parts[0].toUpperCase() !== 'TCP') continue
    if (!parts[1].endsWith(suffix)) continue
    if (parts[3].toUpperCase() !== 'LISTENING') continue
    const pid = Number.parseInt(parts[4], 10)
    if (Number.isInteger(pid) && pid > 0) return pid
  }
  return null
}

/** 只有确认端口上回答的是 EverOS，才认这个 PID —— 防止误杀别的程序。 */
async function everosPid(baseUrl, port) {
  const pid = await listenPid(port)
  if (pid === null) return null
  return (await readHealth(baseUrl)) === null ? null : pid
}

/** 解析 /metrics 里的请求计数行：'method="POST",path="...",status="200"} 18.0'。 */
function parseCounters(text) {
  const lines = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('everos_http_requests_total')) continue
    const brace = line.indexOf('{')
    if (brace < 0) continue
    lines.push(line.slice(brace + 1).trim())
  }
  return lines
}

/** 从计数器行里取数值（行尾的 Prometheus 采样值）。 */
function counterValue(line) {
  const match = line.match(/\}\s+([0-9eE+.-]+)\s*$/)
  return match ? Number(match[1]) : 0
}

/** 计数器行里的 path 标签。 */
function counterPath(line) {
  const match = line.match(/path="([^"]*)"/)
  return match ? match[1] : ''
}

/**
 * 服务启动时间：Prometheus 计数器系列的 _created 是进程内最早的创建时间，
 * 取全部 _created 的最小值就是本次进程的启动时刻（Unix 秒）。
 * 比派生子进程查进程创建时间更稳（不依赖 tasklist/Get-Process 权限）。
 */
function startedAtFromMetrics(text) {
  let earliest = null
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('everos_http_requests_created')) continue
    const value = counterValue(line.slice(line.indexOf('{') + 1))
    if (!Number.isFinite(value) || value <= 0) continue
    if (earliest === null || value < earliest) earliest = value
  }
  return earliest
}

/** 需要查询的 owner 轨道目录名（用户轨 / Agent 轨）。 */
async function subdirs(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  } catch {
    return []
  }
}

/**
 * 按配置构造面板服务。
 * @param {typeof DEFAULT_CONFIG} input 已在入口处合并过默认值的配置。
 */
export function createService(input = {}, manager = null) {
  const config = { ...DEFAULT_CONFIG, ...input }
  const startArgs = Array.isArray(input.startArgs) && input.startArgs.length > 0 ? input.startArgs.slice() : undefined
  const memoryRoot = resolve(String(config.memoryRoot))
  const appId = String(config.appId ?? 'dsh')
  const dataRoot = join(memoryRoot, appId)
  const baseUrl = String(config.baseUrl ?? DEFAULT_CONFIG.baseUrl).replace(/\/+$/, '')
  const logPath = String(config.logPath ?? DEFAULT_CONFIG.logPath)
  const everosExe = String(config.everosExe ?? DEFAULT_CONFIG.everosExe)
  const port = Number(new URL(baseUrl).port || 80)
  const requestTimeoutMs = Number(config.requestTimeoutMs) || DEFAULT_CONFIG.requestTimeoutMs
  const startTimeoutMs = Number(config.startTimeoutMs) || DEFAULT_CONFIG.startTimeoutMs
  const configured = input.configured !== undefined ? input.configured === true : startArgs !== undefined
  const platformSupported = input.platformSupported !== undefined ? input.platformSupported === true : process.platform === 'win32'
  const timeFormat = ['local', 'local-short', 'iso', 'utc'].includes(String(config.timeFormat)) ? String(config.timeFormat) : 'local'

  /** 递归收集记忆 Markdown 文件（按小写完整路径排序，和原面板一致）。 */
  async function listMemoryFiles() {
    if (memoryRoot === '') return []
    const collected = []
    const walk = async (dir) => {
      let entries
      try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) { await walk(full); continue }
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) collected.push(full)
      }
    }
    await walk(dataRoot)
    collected.sort((a, b) => {
      const left = a.toLowerCase()
      const right = b.toLowerCase()
      return left < right ? -1 : left > right ? 1 : 0
    })
    return collected
  }

  /** 记忆类型：episodes / .atomic_facts / .cases / user.md / 其他。 */
  function kindOf(relPath) {
    const parts = relPath.toLowerCase().split('/')
    if (parts.includes('episodes')) return 'episode'
    if (parts.includes('.atomic_facts')) return 'atomic_fact'
    if (parts.includes('.cases')) return 'agent_case'
    if (parts[parts.length - 1] === 'user.md') return 'profile'
    return 'other'
  }

  /** 文件里的条目数：优先数 <!-- entry:xxx --> 开标记，退化为 ## ep_/af_/ac_ 标题。 */
  function entryCount(text) {
    let count = 0
    let index = text.indexOf('<!-- entry:')
    while (index >= 0) { count += 1; index = text.indexOf('<!-- entry:', index + 1) }
    if (count > 0) return count
    const headings = text.match(/^##\s+(?:ep|af|ac)_/gm)
    return headings === null ? 0 : headings.length
  }

  /** 路径必须在 memoryRoot 内、.md、且是已存在文件。 */
  function resolveMemoryFile(raw) {
    if (memoryRoot === '') return null
    if (typeof raw !== 'string' || raw.trim() === '') return null
    const candidate = resolve(memoryRoot, raw)
    const relativePath = relative(memoryRoot, candidate)
    if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) return null
    if (!candidate.toLowerCase().endsWith('.md')) return null
    try { if (!statSync(candidate).isFile()) return null } catch { return null }
    return candidate
  }

  /** 服务状态 + 计数器 + 调用次数汇总。 */
  async function status() {
    let healthBody = null
    let pid = null
    let serviceState = null
    if (manager !== null) {
      const usable = await manager.probe()
      serviceState = manager.snapshot()
      healthBody = usable ? serviceState.health : null
      if (usable) pid = await manager.currentPid()
    } else {
      healthBody = await readHealth(baseUrl)
      if (healthBody !== null) pid = await everosPid(baseUrl, port)
    }
    const health = healthBody
    const running = health !== null
    let metricsText = ''
    if (running) metricsText = await fetchText(baseUrl + '/metrics', 3000)
    const counters = running ? parseCounters(metricsText) : []
    const calls = { search: 0, add: 0, flush: 0 }
    for (const line of counters) {
      const path = counterPath(line)
      const value = counterValue(line)
      if (path.includes('memory/search')) calls.search += value
      else if (path.includes('memory/add')) calls.add += value
      else if (path.includes('memory/flush')) calls.flush += value
    }
    if (!running) pid = null
    return {
      running,
      pid,
      startedAt: running ? startedAtFromMetrics(metricsText) : null,
      version: running ? (health.version ?? null) : null,
      capabilities: running ? (health.capabilities ?? null) : null,
      cascade: running ? (health.cascade ?? null) : null,
      counters,
      calls,
      logPath,
      baseUrl,
      owner: serviceState === null ? null : serviceState.owner,
      usable: serviceState === null ? running : serviceState.usable,
      manuallyStopped: serviceState === null ? false : serviceState.manuallyStopped,
      autoRestart: serviceState === null ? null : serviceState.autoRestart,
      lastError: serviceState === null ? null : serviceState.lastError,
      configured,
      platformSupported,
      memoryRoot,
      timeFormat,
      hint: !platformSupported
        ? '服务启停目前仅支持 Windows（依赖 netstat / taskkill）；浏览、搜索、日志在其它系统仍可用'
        : (configured
          ? null
          : (memoryRoot === ''
            ? '还没配置 EverOS：点面板「设置」填写服务目录与启动命令，或先运行仓库里的 scripts/setup-everos.ps1'
            : '还没配置 EverOS 启动命令：点面板「设置」填写 startCommand，或先运行仓库里的 scripts/setup-everos.ps1')),
    }
  }

  /** 记忆目录树：workspace → kind → 文件列表。 */
  async function tree() {
    const files = await listMemoryFiles()
    const workspaces = {}
    let fileCount = 0
    let bytes = 0
    let latestMtime = 0
    for (const file of files) {
      let stat
      try { stat = statSync(file) } catch { continue }
      const relPath = posix(relative(memoryRoot, file))
      const inner = relative(dataRoot, file)
      const workspace = inner.startsWith('..') ? '未知' : inner.split(sep)[0]
      const kind = kindOf(inner.startsWith('..') ? relPath : posix(inner))
      const bucket = workspaces[workspace] ?? (workspaces[workspace] = {})
      const list = bucket[kind] ?? (bucket[kind] = [])
      const mtime = stat.mtimeMs / 1000
      list.push({ path: relPath, name: file.split(sep).pop(), size: stat.size, mtime })
      fileCount += 1
      bytes += stat.size
      if (mtime > latestMtime) latestMtime = mtime
    }
    return { workspaces, fileCount, bytes, latestMtime }
  }

  /** 读一个记忆文件（只读，路径做包含性校验）。 */
  async function file(rawPath) {
    const target = resolveMemoryFile(rawPath)
    if (target === null) return { status: 404, body: { error: '文件不存在或路径非法' } }
    try {
      const content = await readFile(target, 'utf8')
      return { status: 200, body: { path: posix(relative(memoryRoot, target)), content, entries: entryCount(content) } }
    } catch {
      return { status: 404, body: { error: '文件不存在或路径非法' } }
    }
  }

  /** 读服务日志尾部（只读该文件，最多 256KB 尾巴）。 */
  async function log(rawLines) {
    const requested = Number.parseInt(String(rawLines ?? '120'), 10)
    const take = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 2000) : 120
    const owner = manager === null ? null : manager.snapshot().owner
    const note = owner === 'external'
      ? '当前服务实例不是本插件启动的，日志里可能没有新内容'
      : 'EverOS 服务日志（本插件启动的实例）'
    if (!existsSync(logPath)) return { body: { lines: [], note: '本插件还没启动过 EverOS，没有日志', path: logPath } }
    let text = ''
    try {
      const handle = await open(logPath, 'r')
      try {
        const stat = await handle.stat()
        const start = Math.max(0, stat.size - 256 * 1024)
        const buffer = Buffer.alloc(stat.size - start)
        await handle.read(buffer, 0, buffer.length, start)
        text = buffer.toString('utf8')
      } finally {
        await handle.close()
      }
    } catch {
      return { body: { lines: [], note: '读取日志失败', path: logPath } }
    }
    const lines = text.split(/\r?\n/)
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    return { body: { lines: lines.slice(-take), note, path: logPath } }
  }

  /**
   * 按条目 id 定位原文：EverOS 搜索结果里的 id（ep_/af_/ac_/sk_ + 日期 + 序号）
   * 在 Markdown 里就是条目标题 `## <id>`；Agent 轨的 id 可能带 agent 前缀，取其中最后一段。
   */
  async function locate(rawId) {
    const raw = typeof rawId === 'string' ? rawId.trim() : ''
    const matched = raw.match(/((?:ep|af|ac|sk)_\d{8}_\d+)/u)
    const entryId = matched === null ? '' : matched[1]
    if (entryId === '') return { status: 400, body: { error: '无效的条目 id' } }
    const pattern = new RegExp('^#{2}\\s+' + entryId + '(?:\\s|$)', 'u')
    for (const path of await listMemoryFiles()) {
      let text
      try { text = await readFile(path, 'utf8') } catch { continue }
      if (!text.includes(entryId)) continue
      const lines = text.split(/\r?\n/)
      for (let index = 0; index < lines.length; index += 1) {
        if (pattern.test(lines[index])) {
          return { status: 200, body: { id: entryId, path: posix(relative(memoryRoot, path)), line: index + 1 } }
        }
      }
    }
    return { status: 404, body: { error: '没有找到包含该条目的文件', id: entryId } }
  }

  /** 原文匹配：全盘 md 的小写子串扫描，最多 60 条（与原面板一致）。 */
  async function searchLocal(query) {
    const needle = query.toLowerCase()
    const hits = []
    for (const path of await listMemoryFiles()) {
      let text
      try { text = await readFile(path, 'utf8') } catch { continue }
      const lines = text.split(/\r?\n/)
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].toLowerCase().includes(needle)) continue
        hits.push({ path: posix(relative(memoryRoot, path)), line: index + 1, text: lines[index].trim().slice(0, 300) })
        if (hits.length >= 60) return hits
      }
    }
    return hits
  }

  /** EverOS 排序搜索：对每个 workspace 的用户轨与 Agent 轨各查一次。 */
  async function searchEveros(query) {
    const workspaces = await subdirs(dataRoot)
    const requests = []
    for (const workspace of workspaces) {
      const users = await subdirs(join(dataRoot, workspace, 'users'))
      const agents = await subdirs(join(dataRoot, workspace, 'agents'))
      for (const user of users) {
        requests.push({ workspace, body: { app_id: appId, project_id: workspace, user_id: user, query, method: 'keyword', top_k: 8 } })
      }
      for (const agent of agents) {
        requests.push({ workspace, body: { app_id: appId, project_id: workspace, agent_id: agent, query, method: 'keyword', top_k: 8 } })
      }
    }
    const responses = await Promise.all(requests.map(async (request) => ({
      workspace: request.workspace,
      result: await fetchJson(baseUrl + '/api/v2/memory/search', {
        method: 'POST', body: request.body, timeoutMs: requestTimeoutMs,
      }),
    })))
    const results = []
    for (const { workspace, result } of responses) {
      if (result.status !== 200 || result.json === null || typeof result.json !== 'object') continue
      const data = result.json.data ?? {}
      for (const episode of data.episodes ?? []) {
        results.push({
          kind: 'episode', workspace,
          score: typeof episode.score === 'number' ? episode.score : null,
          subject: episode.subject ?? null,
          summary: episode.summary ?? null,
          id: episode.id ?? null,
          session: episode.session_id ?? null,
        })
      }
      for (const profile of data.profiles ?? []) {
        results.push({
          kind: 'profile', workspace, score: null, subject: '用户画像',
          summary: JSON.stringify(profile.profile_data ?? {}).slice(0, 400),
          id: profile.id ?? null,
          session: null,
        })
      }
      for (const item of data.agent_cases ?? []) {
        results.push({
          kind: 'agent_case', workspace,
          score: typeof item.score === 'number' ? item.score : null,
          subject: item.task_intent ?? null,
          summary: item.key_insight ?? item.approach ?? null,
          id: item.id ?? null,
          session: null,
        })
      }
      for (const skill of data.agent_skills ?? []) {
        results.push({
          kind: 'agent_skill', workspace,
          score: typeof skill.score === 'number' ? skill.score : null,
          subject: skill.name ?? null,
          summary: skill.description ?? null,
          id: skill.id ?? null,
          session: null,
        })
      }
    }
    results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    return results.slice(0, 12)
  }

  /** 搜索入口：mode = everos | local。 */
  async function search(query, mode) {
    const trimmed = String(query ?? '').trim()
    const selected = mode === 'local' ? 'local' : 'everos'
    if (trimmed === '') return { mode: selected, results: [] }
    if (selected === 'local') return { mode: 'local', results: await searchLocal(trimmed) }
    const usable = manager !== null ? await manager.probe() : (await readHealth(baseUrl)) !== null
    if (!usable) {
      return { mode: 'everos', error: '服务未运行，EverOS 搜索不可用', results: [] }
    }
    return { mode: 'everos', results: await searchEveros(trimmed) }
  }

  /** 启动 EverOS： detached 子进程 + 健康轮询；日志追加到 logPath。 */
  async function start() {
    if (manager !== null) return manager.start()
    if ((await readHealth(baseUrl)) !== null) return { ok: true, message: '服务已经在运行' }
    if ((await listenPid(port)) !== null) return { ok: false, message: `端口 ${port} 已被其他程序占用，无法启动 EverOS` }
    const argv = startArgs !== undefined ? startArgs : [everosExe, 'server', 'start', '--root', memoryRoot]
    const executable = String(argv[0])
    if (!existsSync(executable)) return { ok: false, message: '找不到可执行文件：' + executable }

    let fd
    try {
      mkdirSync(dirname(logPath), { recursive: true })
      fd = openSync(logPath, 'a')
      writeSync(fd, `\n===== ${stamp()} DSH 插件启动 EverOS =====\n`)
      const child = spawn(executable, argv.slice(1), {
        cwd: memoryRoot,
        detached: true,
        stdio: ['ignore', fd, fd],
        windowsHide: true,
        env: {
          ...process.env,
          EVEROS_MEMORIZE__MODE: process.env.EVEROS_MEMORIZE__MODE ?? 'agent',
          EVEROS_API__PORT: process.env.EVEROS_API__PORT ?? String(port),
        },
      })
      child.on('error', () => {})
      child.unref()
    } catch (error) {
      return { ok: false, message: '启动失败：' + (error instanceof Error ? error.message : String(error)) }
    } finally {
      if (fd !== undefined) {
        try { closeSync(fd) } catch { /* 已关闭 */ }
      }
    }

    const deadline = Date.now() + startTimeoutMs
    while (Date.now() < deadline) {
      if ((await readHealth(baseUrl)) !== null) return { ok: true, message: '启动成功' }
      await sleep(1000)
    }
    return { ok: false, message: `启动后 ${Math.round(startTimeoutMs / 1000)} 秒内未通过健康检查，请查看服务日志` }
  }

  /** 停止 EverOS：只在健康检查通过时 taskkill，防止误杀。 */
  async function stop() {
    if (manager !== null) return manager.stop()
    const pid = await everosPid(baseUrl, port)
    if (pid === null) {
      if ((await listenPid(port)) !== null) return { ok: false, message: `端口 ${port} 上不是 EverOS（健康检查不通过），拒绝操作` }
      return { ok: true, message: '服务本来就没在运行' }
    }
    try {
      await new Promise((done, reject) => {
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15000 },
          (error) => (error ? reject(error) : done(undefined)))
      })
    } catch (error) {
      return { ok: false, message: '停止失败：' + (error instanceof Error ? error.message : String(error)) }
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if ((await readHealth(baseUrl)) === null) return { ok: true, message: `已停止（PID ${pid}）` }
      await sleep(500)
    }
    return { ok: false, message: '已发送停止指令，但服务仍有响应' }
  }

  /** 重启：stop → 1s → start。 */
  async function restart() {
    if (manager !== null) return manager.restart()
    const stopped = await stop()
    await sleep(1000)
    const started = await start()
    return { ok: stopped.ok && started.ok, message: `${stopped.message}；${started.message}` }
  }

  return { config: { ...config, memoryRoot, appId, dataRoot, baseUrl, logPath, everosExe, startArgs, port, requestTimeoutMs, startTimeoutMs },
    status, tree, file, log, search, locate, start, stop, restart, listMemoryFiles, manager }
}
