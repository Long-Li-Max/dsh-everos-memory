/**
 * 面板「设置」页的读写层。
 *
 * 读：优先用 DSH 的 settings 服务描述；拿不到时回退到"插件启动时拿到的当前配置"。
 * 写：优先走 settings.update()（DSH 校验 + 持久化 + 热应用）；拿不到描述时，
 *     直接改写 profile 的 cordis.patch.yml 中本插件那一行（原子写入），
 *     DSH 的 Loader 会监听该文件并自动重载（不生效时重启 DSH 即可）。
 *
 * 所有写入都先经过白名单与类型校验，未知字段一律拒绝。
 * @module @lorenzo__li/dsh-everos-memory/lib/settings
 */
import { readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { FIELD_GROUPS, FIELD_INDEX } from './settings-fields.js'

/** 用我们独有的字段认领"自己的那一条配置"。 */
function findDescriptor(settings) {
  if (settings === null || settings === undefined || typeof settings.describe !== 'function') return null
  try {
    const list = settings.describe()
    if (!Array.isArray(list)) return null
    return list.find((item) => item && item.value && typeof item.value === 'object'
      && Object.prototype.hasOwnProperty.call(item.value, 'panelLogPath')) ?? null
  } catch {
    return null
  }
}

/** 只保留我们认识的字段。 */
export function pickKnownValues(value) {
  const picked = {}
  for (const name of FIELD_INDEX.keys()) {
    picked[name] = value !== null && value !== undefined && Object.prototype.hasOwnProperty.call(value, name)
      ? value[name]
      : null
  }
  return picked
}

/**
 * 读取当前配置。
 * @param {object|null} settings DSH settings 服务（可能不可用）
 * @param {Record<string, unknown>|null} currentValues 插件启动时的有效配置
 */
export function describeConfig(settings, currentValues = null) {
  const descriptor = findDescriptor(settings)
  if (descriptor !== null) {
    return {
      available: true,
      source: 'settings',
      groups: FIELD_GROUPS,
      ns: descriptor.ns,
      revision: descriptor.revision,
      value: pickKnownValues(descriptor.value),
    }
  }
  if (currentValues !== null && typeof currentValues === 'object') {
    return { available: true, source: 'config', groups: FIELD_GROUPS, value: pickKnownValues(currentValues) }
  }
  return { available: false, groups: FIELD_GROUPS, value: null, error: '读取不到当前配置' }
}

/** 校验并归一化一个补丁：只允许已知字段、只允许正确类型。 */
export function validatePatch(patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('配置必须是一个对象')
  }
  const clean = {}
  for (const [name, raw] of Object.entries(patch)) {
    const field = FIELD_INDEX.get(name)
    if (field === undefined) throw new Error('未知配置项：' + name)
    if (field.type === 'number') {
      const value = Number(raw)
      if (!Number.isFinite(value)) throw new Error(name + ' 必须是数字')
      if (field.min !== undefined && value < field.min) throw new Error(name + ' 不能小于 ' + field.min)
      clean[name] = value
    } else if (field.type === 'boolean') {
      clean[name] = raw === true || raw === 'true'
    } else if (field.type === 'enum') {
      const value = String(raw)
      if (!field.options.includes(value)) throw new Error(name + ' 只能是：' + field.options.join(' / '))
      clean[name] = value
    } else {
      clean[name] = raw === null || raw === undefined ? '' : String(raw)
    }
  }
  if (Object.keys(clean).length === 0) throw new Error('没有要保存的字段')
  return clean
}

/** 把值渲染成 YAML 标量（字符串一律单引号，内部单引号翻倍）。 */
function yamlScalar(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  const text = value === null || value === undefined ? '' : String(value)
  return "'" + text.replace(/'/g, "''") + "'"
}

/** 渲染本插件那一行配置（按字段表顺序，整份写出，避免 YAML 合并歧义）。 */
export function renderRowBlock(values) {
  const lines = ['- id: everos', '  name: "@lorenzo__li/dsh-everos-memory"', '  config:']
  for (const group of FIELD_GROUPS) {
    for (const field of group.fields) {
      const value = values[field.name]
      if (value === undefined) continue
      lines.push('    ' + field.name + ': ' + yamlScalar(value))
    }
  }
  return lines.join('\n')
}

/** 找到 profile 的 cordis.patch.yml：优先问 DSH，其次按 profile 目录推断。 */
export async function resolveProfilePatchPath(settings) {
  if (settings !== null && settings !== undefined && typeof settings.prepareDocument === 'function') {
    try {
      const file = await settings.prepareDocument()
      if (typeof file === 'string' && file !== '') return file
    } catch {
      /* 回退到推断路径 */
    }
  }
  const profile = process.env.DSH_PROFILE || 'desktop'
  return join(homedir(), '.dsh', 'profiles', profile, 'cordis.patch.yml')
}

/** 把整行配置写回 profile patch（原子写入：临时文件 + rename）。 */
export async function saveToProfile(settings, currentValues, patch) {
  const file = await resolveProfilePatchPath(settings)
  const value = Object.assign({}, currentValues, patch)
  const block = renderRowBlock(value)
  let text = ''
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => /^-\s+id:\s*['"]?everos['"]?\s*$/.test(line))
  let next
  if (start >= 0) {
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^-\s/.test(lines[index])) { end = index; break }
    }
    next = [...lines.slice(0, start), ...block.split('\n'), ...lines.slice(end)].join('\n')
  } else {
    const prefix = text === '' ? '' : (text.endsWith('\n') ? text : text + '\n') + '\n'
    next = prefix + block + '\n'
  }
  const temporary = file + '.tmp-everos'
  await writeFile(temporary, next.endsWith('\n') ? next : next + '\n', 'utf8')
  await rename(temporary, file)
  return {
    ok: true,
    via: 'profile',
    saved: Object.keys(patch),
    note: '已写入 profile 配置；DSH 通常会自动重载，若面板没变化请重启 DSH',
  }
}

/**
 * 保存配置：优先 DSH settings 服务；不可用则改写 profile patch。
 * @param {object|null} settings DSH settings 服务
 * @param {Record<string, unknown>|null} currentValues 当前有效配置
 * @param {Record<string, unknown>} patch 要修改的字段
 */
export async function saveConfig(settings, currentValues, patch) {
  const clean = validatePatch(patch)
  const descriptor = findDescriptor(settings)
  if (descriptor !== null) {
    await settings.update(descriptor.ns, clean, descriptor.revision)
    return { ok: true, via: 'settings', saved: Object.keys(clean) }
  }
  return saveToProfile(settings, currentValues === null || typeof currentValues !== 'object' ? {} : currentValues, clean)
}
