/**
 * 面板「设置」页的字段定义（30 项：记忆引擎 24 + 面板/管家 6）。
 *
 * 字段只描述"长什么样、中文叫什么"，真正的读写由 lib/settings.js 通过 DSH 的
 * settings 服务完成（读当前值 / 写回 profile 配置）。
 * @module @lorenzo__li/dsh-everos-memory/lib/settings-fields
 */

/** 一个字段的元信息。 */
const string = (name, labelZh, labelEn, hintZh, hintEn) => ({ name, type: 'string', label: { zh: labelZh, en: labelEn }, hint: { zh: hintZh, en: hintEn } })
const number = (name, labelZh, labelEn, hintZh, hintEn, min) => ({ name, type: 'number', min, label: { zh: labelZh, en: labelEn }, hint: { zh: hintZh, en: hintEn } })
const boolean = (name, labelZh, labelEn, hintZh, hintEn) => ({ name, type: 'boolean', label: { zh: labelZh, en: labelEn }, hint: { zh: hintZh, en: hintEn } })
const enums = (name, options, labelZh, labelEn, hintZh, hintEn) => ({ name, type: 'enum', options, label: { zh: labelZh, en: labelEn }, hint: { zh: hintZh, en: hintEn } })

/** 分组后的字段表（顺序即界面顺序）。 */
export const FIELD_GROUPS = [
  {
    id: 'connection',
    label: { zh: '连接与启动', en: 'Connection & startup' },
    fields: [
      string('baseUrl', 'EverOS 服务地址', 'Service URL', '默认 http://127.0.0.1:8000', 'Default http://127.0.0.1:8000'),
      enums('apiVersion', ['auto', 'v1', 'v2'], '接口版本', 'API version', '一般保持 auto', 'Keep auto unless you know better'),
      string('appId', '记忆分区（appId）', 'Memory partition (appId)', '默认 dsh', 'Default dsh'),
      string('projectId', '项目 ID（可选）', 'Project id (optional)', '留空则按工作目录自动算', 'Empty = derived from the working directory'),
      string('userId', '用户 ID（可选）', 'User id (optional)', '留空则用系统用户名', 'Empty = OS user name'),
      string('agentId', 'Agent ID（可选）', 'Agent id (optional)', '留空则用当前 Agent 名', 'Empty = current agent name'),
      boolean('autoStart', '开机自动启动服务', 'Start service at boot', '关闭后需手动在面板里启动', 'Off = start manually from the panel'),
      string('startCommand', '启动命令', 'Start command', '面板与管家都用它拉起服务', 'Used by the panel and the service manager'),
      string('everosDir', '服务根目录（--root）', 'Service root', '记忆数据所在目录', 'Directory that holds memory data'),
      number('readinessTimeoutMs', '等待就绪超时（毫秒）', 'Readiness timeout (ms)', '冷启动慢时可调大', 'Raise it for slow cold starts', 1000),
      number('readinessIntervalMs', '等待就绪间隔（毫秒）', 'Readiness interval (ms)', '默认 1000', 'Default 1000', 100),
    ],
  },
  {
    id: 'recall',
    label: { zh: '回忆（读记忆）', en: 'Recall' },
    fields: [
      enums('recallMethod', ['keyword', 'vector', 'hybrid', 'agentic'], '回忆方式', 'Recall method', '本机没有向量能力时选 keyword', 'Use keyword when embeddings are disabled'),
      number('queryN', '查询带入几条历史消息', 'History messages in query', '默认 3', 'Default 3', 1),
      number('queryMaxChars', '查询字符上限', 'Query max chars', '默认 2000', 'Default 2000', 100),
      number('recallTopK', '每条轨最多取几条记忆', 'Top K per track', '默认 5，调小更精简', 'Default 5; smaller = less noise', 1),
      number('recallMaxChars', '注入记忆的字符上限', 'Injected memory max chars', '默认 12000', 'Default 12000', 100),
      number('recallTimeoutMs', '单次回忆超时（毫秒）', 'Recall timeout (ms)', '冷启动时建议 ≥15000', 'Use ≥15000 for cold starts', 1000),
    ],
  },
  {
    id: 'capture',
    label: { zh: '记录（写记忆）', en: 'Capture' },
    fields: [
      number('captureTimeoutMs', '单次记录超时（毫秒）', 'Capture timeout (ms)', '默认 15000', 'Default 15000', 1000),
      number('captureMaxChars', '单轮最多提交多少字符', 'Capture max chars', '默认 50000', 'Default 50000', 1000),
      number('flushIdleMs', '空闲多久后提交（毫秒）', 'Flush after idle (ms)', '默认 30000', 'Default 30000', 1000),
      number('flushTokenThreshold', '攒够多少 token 就提交', 'Flush at token count', '默认 12000', 'Default 12000', 100),
      number('flushMessageThreshold', '攒够多少条消息就提交', 'Flush at message count', '默认 50，调小记忆更及时', 'Default 50; smaller = sooner', 1),
      number('flushMaxDelayMs', '最长多久必须提交（毫秒）', 'Max flush delay (ms)', '默认 300000', 'Default 300000', 1000),
      boolean('flushOnSessionSwitch', '切换会话时先提交', 'Flush on session switch', '默认开启', 'Default on'),
    ],
  },
  {
    id: 'panel',
    label: { zh: '面板与管家', en: 'Panel & service manager' },
    fields: [
      enums('panelTimeFormat', ['local', 'local-short', 'iso', 'utc'], '日志时间格式', 'Log time format',
        'local=本地日期时间（默认）；local-short=只显时分秒；iso=本地 ISO 带时区；utc=保留原始 UTC',
        'local=local date-time (default); local-short=time only; iso=local ISO with offset; utc=raw UTC'),
      string('panelLogPath', '服务日志文件', 'Service log file', '管家启动的实例写到这里', 'Where the manager writes the service log'),
      string('panelEverosExe', '覆盖可执行文件（可选）', 'Override executable (optional)', '留空则用启动命令的第一个参数', 'Empty = first arg of the start command'),
      number('panelRequestTimeoutMs', '面板请求超时（毫秒）', 'Panel request timeout (ms)', '默认 20000', 'Default 20000', 1000),
      number('panelStartTimeoutMs', '启动等待超时（毫秒）', 'Start timeout (ms)', '默认 180000', 'Default 180000', 1000),
      boolean('panelAutoRestart', '服务崩了自动恢复', 'Auto restart on crash', '默认开启', 'Default on'),
      boolean('panelRespectManualStop', '尊重手动停止', 'Respect manual stop', '你点了停止就不再自动拉起', 'Do not auto-start after a manual stop'),
    ],
  },
]

/** name → 字段定义。 */
export const FIELD_INDEX = new Map(
  FIELD_GROUPS.flatMap((group) => group.fields).map((field) => [field.name, field]),
)
