/**
 * EverOS 服务的「统一管家」—— 进程生命周期的唯一拥有者。
 *
 * 职责（Phase 2）：
 *  - 启动 / 停止 / 重启（写日志、等就绪、先确认端口上确实是 EverOS）；
 *  - 周期性健康检查，崩了就按策略自动拉起（`autoRestart`）；
 *  - 记住"这个实例是不是我拉起的"（owner: plugin / external），卸载时只关自己的；
 *  - 尊重手动停止：你在面板点了停止，就不再自作主张拉起（`respectManualStop`）；
 *  - 给记忆部分一个廉价探针：每轮开始前问一句"现在能用吗"，不能用就快速跳过。
 *
 * 所有会改变进程状态的操作都串行执行（同一时刻只有一个 start/stop/restart 在跑），
 * 避免"冷启动期间点停止"之类的竞态把状态搞乱。
 * @module @lorenzo__li/dsh-everos-memory/lib/service-manager
 */
import { execFile, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** 本地时间字符串，用于日志分隔行。 */
function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 默认健康检查：200 且 status=ok 才算可用。 */
async function defaultHealthCheck(baseUrl, timeoutMs) {
  try {
    const response = await fetch(baseUrl + '/health', { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return null
    const body = await response.json().catch(() => null)
    return body !== null && typeof body === 'object' && body.status === 'ok' ? body : null
  } catch {
    return null
  }
}

/** 默认端口扫描：netstat 找 LISTENING 的 PID，拿不到返回 null。 */
async function defaultListen(port) {
  let output = ''
  try {
    output = await new Promise((done) => {
      execFile('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true, timeout: 10000, encoding: 'utf8' },
        (error, stdout) => done(error ? '' : String(stdout ?? '')))
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

/** 默认杀进程：taskkill 连同子进程树。 */
function defaultKill(pid) {
  return new Promise((done, reject) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15000 },
      (error) => (error ? reject(error) : done(undefined)))
  })
}

/**
 * 创建管家。
 * @param {object} options 派生后的服务配置 + 策略开关 + 可注入的测试缝隙
 */
export function createServiceManager(options = {}) {
  const config = {
    baseUrl: String(options.baseUrl ?? 'http://127.0.0.1:8000').replace(/\/+$/, ''),
    memoryRoot: String(options.memoryRoot ?? 'D:\\ProgramData\\everos'),
    everosExe: String(options.everosExe ?? 'D:\\ProgramData\\everos-venv\\Scripts\\everos.exe'),
    startArgs: Array.isArray(options.startArgs) && options.startArgs.length > 0 ? options.startArgs.slice() : undefined,
    logPath: String(options.logPath ?? 'D:\\ProgramData\\everos\\logs\\everos-server.log'),
    startTimeoutMs: Math.max(1000, Number(options.startTimeoutMs) || 180000),
    autoRestart: options.autoRestart !== false,
    respectManualStop: options.respectManualStop !== false,
    /** 是否配置了启动命令；false 时管家只探测、不尝试拉起。 */
    configured: options.configured !== false,
    /** 服务启停依赖 netstat/taskkill，目前仅 Windows 支持。 */
    platformSupported: options.platformSupported !== false,
    monitorIntervalMs: Math.max(5000, Number(options.monitorIntervalMs) || 15000),
    pollIntervalMs: Math.max(10, Number(options.pollIntervalMs) || 1000),
    stopPollIntervalMs: Math.max(10, Number(options.stopPollIntervalMs) || 500),
  }
  const port = Number(new URL(config.baseUrl).port || 80)
  const healthCheck = typeof options.healthCheck === 'function' ? options.healthCheck : defaultHealthCheck
  const listen = typeof options.listen === 'function' ? options.listen : defaultListen
  const kill = typeof options.kill === 'function' ? options.kill : defaultKill
  const spawnProcess = typeof options.spawnProcess === 'function' ? options.spawnProcess : spawn

  /** 缓存的运行状态。 */
  let ready = false
  let health = null
  let childPid = null
  let owned = false
  let manuallyStopped = false
  let lastError = null
  let startedAt = null
  let timer = null
  let disposed = false
  /** 监控是否"armed"：只有开机允许自启（autoStart）或用户手动启动过之后，自愈才会拉起服务。 */
  let monitorArmed = false
  /** 串行队列：所有改变进程状态的操作排队执行。 */
  let queue = Promise.resolve()

  /** 排队执行，保证 start/stop/restart/ensure 互斥。 */
  function serialize(task) {
    const run = queue.then(task, task)
    queue = run.then(() => {}, () => {})
    return run
  }

  /** 同步快照（面板 / 日志说明用）。 */
  function snapshot() {
    return {
      running: ready,
      usable: ready,
      pid: ready ? childPid : null,
      startedAt,
      owner: owned ? 'plugin' : (ready ? 'external' : null),
      logPath: config.logPath,
      lastError,
      autoRestart: config.autoRestart,
      respectManualStop: config.respectManualStop,
      configured: config.configured,
      platformSupported: config.platformSupported,
      manuallyStopped,
      health,
    }
  }

  /** 探针：更新 ready/health 并返回是否可用（记忆部分每轮调用一次）。 */
  async function probe(timeoutMs = 2000) {
    if (disposed) {
      ready = false
      return false
    }
    let body = null
    try {
      body = await healthCheck(config.baseUrl, timeoutMs)
    } catch {
      body = null
    }
    ready = body !== null
    health = body
    if (!ready && childPid === null) owned = false
    return ready
  }

  /** 当前监听 PID：自己拉起的优先，否则扫端口；两者不一致时以端口为准（可能被外部重启了）。 */
  async function currentPid() {
    const listener = await listen(port)
    if (listener === null) return null
    if (owned && childPid !== null && childPid !== listener) {
      // 我们拉起的进程已不在监听：可能被外部杀掉并换了实例，改成外部实例，避免误杀。
      owned = false
      childPid = listener
    } else if (childPid === null) {
      childPid = listener
      owned = false
    }
    return listener
  }

  /** 启动服务（幂等）：已在跑直接返回；端口被占/找不到可执行文件/超时都给明确文案。 */
  async function doStart() {
    if (disposed) return { ok: false, message: '插件正在卸载，已取消启动' }
    if (!config.platformSupported) {
      return { ok: false, message: '服务启停目前仅支持 Windows（依赖 netstat / taskkill）；面板的浏览、搜索、日志在其它系统仍可用' }
    }
    if (!config.configured) {
      return { ok: false, message: '未配置 EverOS 启动命令：点面板「设置」填写 startCommand，或先运行仓库里的 scripts/setup-everos.ps1' }
    }
    if (await probe()) {
      manuallyStopped = false
      return { ok: true, message: '服务已经在运行' }
    }
    const occupied = await listen(port)
    if (occupied !== null) {
      return { ok: false, message: `端口 ${port} 已被其他程序占用，无法启动 EverOS` }
    }
    const argv = config.startArgs !== undefined ? config.startArgs : [config.everosExe, 'server', 'start', '--root', config.memoryRoot]
    const executable = String(argv[0])
    if (!existsSync(executable)) return { ok: false, message: '找不到可执行文件：' + executable }
    if (disposed) return { ok: false, message: '插件正在卸载，已取消启动' }

    let fd
    try {
      mkdirSync(dirname(config.logPath), { recursive: true })
      fd = openSync(config.logPath, 'a')
      writeSync(fd, `\n===== ${stamp()} DSH 插件（管家）启动 EverOS =====\n`)
      const child = spawnProcess(executable, argv.slice(1), {
        cwd: config.memoryRoot,
        detached: true,
        stdio: ['ignore', fd, fd],
        windowsHide: true,
        env: {
          ...process.env,
          EVEROS_MEMORIZE__MODE: process.env.EVEROS_MEMORIZE__MODE ?? 'agent',
          EVEROS_API__PORT: process.env.EVEROS_API__PORT ?? String(port),
        },
      })
      child.on('error', (error) => { lastError = error instanceof Error ? error.message : String(error) })
      child.unref()
      childPid = typeof child.pid === 'number' ? child.pid : null
      owned = true
      const spawnedPid = childPid
      // 子进程自己退出（崩溃/被杀）时立刻放弃所有权，避免拿着旧 PID 误杀别的进程。
      child.on('exit', () => {
        if (childPid === spawnedPid) {
          childPid = null
          owned = false
          ready = false
        }
      })
    } catch (error) {
      owned = false
      childPid = null
      lastError = error instanceof Error ? error.message : String(error)
      return { ok: false, message: '启动失败：' + lastError }
    } finally {
      if (fd !== undefined) {
        try { closeSync(fd) } catch { /* 已关闭 */ }
      }
    }

    const deadline = Date.now() + config.startTimeoutMs
    while (Date.now() < deadline) {
      if (disposed) return { ok: false, message: '插件正在卸载，已取消启动' }
      if (await probe()) {
        startedAt = Date.now() / 1000
        manuallyStopped = false
        lastError = null
        monitorArmed = true
        return { ok: true, message: '启动成功' }
      }
      await sleep(config.pollIntervalMs)
    }
    ready = false
    lastError = '启动后未通过健康检查（超时）'
    return { ok: false, message: `启动后 ${Math.round(config.startTimeoutMs / 1000)} 秒内未通过健康检查，请查看服务日志` }
  }

  /** 停止服务：先确认健康检查通过（端口上确实是 EverOS），再 taskkill。 */
  async function doStop() {
    const healthy = await probe()
    if (!healthy) {
      manuallyStopped = true
      // 健康检查失败时顺手清掉可能过期的自有 PID，防止卸载时误杀复用该 PID 的进程。
      owned = false
      childPid = null
      return { ok: true, message: '服务本来就没在运行' }
    }
    const pid = await currentPid()
    if (pid === null) return { ok: false, message: '没找到监听 EverOS 的进程，拒绝操作' }
    try {
      await kill(pid)
    } catch (error) {
      return { ok: false, message: '停止失败：' + (error instanceof Error ? error.message : String(error)) }
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!(await probe())) {
        ready = false
        owned = false
        childPid = null
        startedAt = null
        manuallyStopped = true
        lastError = null
        return { ok: true, message: `已停止（PID ${pid}）` }
      }
      await sleep(config.stopPollIntervalMs)
    }
    return { ok: false, message: '已发送停止指令，但服务仍有响应' }
  }

  /** 重启：停 → 1 秒 → 起（整体串行，不会和别的启停操作交错）。 */
  async function doRestart() {
    const stopped = await doStop()
    await sleep(1000)
    manuallyStopped = false
    const started = await doStart()
    return { ok: stopped.ok && started.ok, message: `${stopped.message}；${started.message}` }
  }

  /** 确保服务在跑（开机、自愈、面板"启动"共用）。manual=true 忽略"手动停止"策略。 */
  async function doEnsure(manual) {
    if (disposed) return { ok: false, message: '管家已停止' }
    if (await probe()) return { ok: true, message: '服务已经在运行' }
    if (!manual && manuallyStopped && config.respectManualStop) {
      return { ok: true, message: '服务已被手动停止，不自动拉起（面板里可手动启动）', skipped: true }
    }
    return doStart()
  }

  const start = () => serialize(doStart)
  const stop = () => serialize(doStop)
  const restart = () => serialize(doRestart)
  const ensure = (manual = false) => serialize(() => doEnsure(manual === true))

  /** 周期检查：挂了且允许自愈就拉起；失败写进 lastError。 */
  async function tick() {
    if (disposed) return
    if (!monitorArmed) return
    if (!config.configured || !config.platformSupported) return
    const healthy = await probe(1500)
    if (healthy) return
    if (!config.autoRestart) return
    if (manuallyStopped && config.respectManualStop) return
    const result = await ensure(false)
    if (result && result.ok === false) lastError = result.message
  }

  /**
   * 激活：可选开机确保一次 + 启动周期监控。
   * 监控始终开启（即使 autoStart=false），这样你手动启动之后崩了也能自愈。
   * @param {{ startNow?: boolean }} [options]
   */
  function activate(activation = {}) {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    disposed = false
    monitorArmed = activation.startNow !== false && config.configured && config.platformSupported
    if (monitorArmed) {
      void ensure(false).catch((error) => { lastError = error instanceof Error ? error.message : String(error) })
    }
    timer = setInterval(() => { void tick().catch(() => {}) }, config.monitorIntervalMs)
    return async function dispose() {
      disposed = true
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
      // 等排队的启停收尾，但最多等 5 秒，避免卸载卡住。
      await Promise.race([queue.catch(() => {}), sleep(5000)])
      if (owned && childPid !== null && config.platformSupported) {
        const pid = childPid
        try { await kill(pid) } catch { /* 关不掉就留给下次启动的健康检查 */ }
      }
      ready = false
      owned = false
      childPid = null
      monitorArmed = false
    }
  }

  return {
    config: { ...config, port },
    probe,
    start,
    stop,
    restart,
    ensure,
    tick,
    activate,
    snapshot,
    currentPid,
    isUsable: () => ready,
    isDisposed: () => disposed,
  }
}
