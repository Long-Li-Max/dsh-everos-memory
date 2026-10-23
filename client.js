/**
 * EverOS memory panel - browser half (@lorenzo__li/dsh-everos-memory).
 *
 * Loaded through the dynamic client module loader: the factory receives only
 * the baseline `react` module (no JSX, no imports, no third-party code). It
 * registers two seats through `ctx.slots.inject`:
 *
 *  - `sidebar.panellist` - the shell-owned sidebar row; this module draws only
 *    the glyph (`PanelIcon`) with the shared panel id as `data-dsh-panel-entry`.
 *  - `main` (keyed by the same id) - the center-column page, mounted by the
 *    layout only while this panel is selected.
 *
 * All data comes from the host half over document-relative URLs
 * (`api/everos-panel/...`), never a leading-slash absolute path: the page has
 * to keep working under whatever prefix the desktop shell serves it from.
 *
 * Copy is registered with `ctx.locale.register` (zh is the key source, en is
 * aligned key for key) and read through `ctx.locale.bind`; a locale change
 * subscription re-renders the page. Styles are one CSS string injected
 * idempotently into a single `<style data-plugin data-plugin-css>` tag held by
 * `ctx.effect`, and only theme tokens are used so both color schemes keep
 * working.
 *
 * @module @lorenzo__li/dsh-everos-memory/client
 */
window.__ModuleLoader__.load({
  id: '@lorenzo__li/dsh-everos-memory',
  factory(require) {
    'use strict';

    const React = require('react');
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useMemo = React.useMemo;
    const useRef = React.useRef;
    const useCallback = React.useCallback;

    /** Package identity: also the id both slot registrations share. */
    const PLUGIN_ID = '@lorenzo__li/dsh-everos-memory';
    /** Panel id shared by the sidebar row and the main-slot occupant. */
    const PANEL_ID = 'everos-panel';
    /** Locale namespace of this plugin. */
    const NS = 'everos-panel';
    /** Row order among the shell's global panel rows (Plugins 0, Schedule 10, ...). */
    const PANEL_ORDER = 50;
    /** Document-relative API prefix (never starts with a slash). */
    const API_BASE = 'api/everos-panel';
    /** Stable style-tag key for idempotent CSS injection. */
    const STYLE_CSS_ID = '@lorenzo__li/dsh-everos-memory/panel.css';
    /** Language-neutral placeholder for an absent value. */
    const PLACEHOLDER = '\u2014';
    /** Display order of the memory kinds inside one workspace. */
    const KIND_ORDER = ['episode', 'atomic_fact', 'agent_case', 'profile', 'agent_skill', 'other'];

    /* ------------------------------------------------------------------ *
     * Dictionaries (zh is the key source; en must stay aligned key by key)
     * ------------------------------------------------------------------ */
    const zh = {
      'entry.label': 'EverOS 记忆',
      'status.title': '服务状态',
      'status.running': '运行中',
      'status.stopped': '未运行',
      'status.busy': '操作中',
      'status.loading': '正在读取状态…',
      'status.version': '版本',
      'status.pid': 'PID',
      'status.uptime': '已运行',
      'status.capabilities': '能力',
      'status.capability.llm': 'LLM',
      'status.capability.embed': '向量',
      'status.on': '开',
      'status.off': '关',
      'status.unknown': '未知',
      'status.address': '地址',
      'action.start': '启动',
      'action.stop': '停止',
      'action.restart': '重启',
      'action.starting': '启动中…',
      'action.stopping': '停止中…',
      'action.restarting': '重启中…',
      'action.refresh': '刷新',
      'action.close': '关闭',
      'action.retry': '重试',
      'stats.title': '记忆统计',
      'stats.log': '服务日志',
      'config.open': '设置',
      'config.title': '设置',
      'config.loading': '正在读取配置…',
      'config.save': '保存',
      'config.saving': '保存中…',
      'config.saved': '已保存',
      'config.unavailable': '读取不到插件配置（DSH 的 settings 服务不可用）',
      'config.hint': '保存后会写入你的 DSH profile 配置，并尽量立即生效；个别字段（如启动命令、服务目录）需要重启 DSH 才完全生效。第一次使用请先运行仓库里的 scripts/setup-everos.ps1（Windows），按提示把服务目录与启动命令填到下面对应字段。',
      'config.noChange': '没有修改项',
      'config.pendingReload': '配置已写入，但 DSH 还没重载插件；重启 DSH 后生效',
      'config.dirty': '有未保存的修改',
      'stats.searchCalls': '搜索调用',
      'stats.addCalls': '写入调用',
      'stats.fileCount': '记忆文件',
      'stats.bytes': '总量',
      'stats.latest': '最后写入',
      'tree.title': '记忆文件',
      'tree.loading': '正在加载记忆树…',
      'tree.empty': '还没有记忆文件',
      'tree.noFiles': '无文件',
      'kind.episode': '对话纪要',
      'kind.atomic_fact': '原子事实',
      'kind.agent_case': 'Agent 案例',
      'kind.agent_skill': 'Agent 技能',
      'kind.profile': '用户画像',
      'kind.other': '其他',
      'search.placeholder': '搜索记忆内容…',
      'search.mode.label': '搜索方式',
      'search.mode.everos': 'EverOS 排序',
      'search.mode.local': '原文匹配',
      'search.button': '搜索',
      'search.searching': '搜索中…',
      'search.emptyQuery': '请输入搜索关键词',
      'search.hint': '输入关键词后按回车或点击搜索',
      'search.resultsTitle': '搜索结果',
      'search.results': '共 {n} 条',
      'search.noResults': '没有找到匹配内容',
      'search.resultLine': '第 {line} 行',
      'search.score': '分数 {score}',
      'search.untitled': '无标题',
      'search.errorWithMessage': '搜索失败：{message}',
      'search.locateFailed': '没有找到对应的记忆文件',
      'search.locating': '正在定位…',
      'file.loading': '正在读取文件…',
      'file.entries': '{n} 个条目',
      'content.placeholder': '从左侧选择记忆文件，或在上方搜索。',
      'log.title': '服务日志',
      'log.loading': '正在读取日志…',
      'log.empty': '日志为空',
      'log.notePath': '日志文件：{path}',
      'error.network': '无法连接 DSH 面板服务，请确认页面已连接',
      'error.http': '请求失败（HTTP {status}）',
      'error.parse': '服务返回了无法解析的数据',
      'error.generic': '请求失败',
      'error.crash': '面板渲染出错，请重试',
      'notify.done': '操作已完成',
      'notify.failed': '操作未成功，请查看服务日志',
      'confirm.cancel': '取消',
      'confirm.stop.title': '停止 EverOS 服务？',
      'confirm.stop.body': '停止后 DSH 侧记忆会暂停，插件不会自动重启，需在本面板启动或重启 DSH。',
      'confirm.stop.confirm': '停止服务',
      'confirm.restart.title': '重启 EverOS 服务？',
      'confirm.restart.body': '重启会先停止再启动 EverOS；期间 DSH 侧记忆会暂停，启动可能需要数分钟。',
      'confirm.restart.confirm': '重启服务',
      'duration.seconds': '{n} 秒',
      'duration.minutes': '{n} 分钟',
      'duration.hours': '{h} 小时 {m} 分',
      'duration.days': '{d} 天 {h} 小时'
    };

    const en = {
      'entry.label': 'EverOS Memory',
      'status.title': 'Service status',
      'status.running': 'Running',
      'status.stopped': 'Stopped',
      'status.busy': 'Working',
      'status.loading': 'Reading status…',
      'status.version': 'Version',
      'status.pid': 'PID',
      'status.uptime': 'Uptime',
      'status.capabilities': 'Capabilities',
      'status.capability.llm': 'LLM',
      'status.capability.embed': 'Embedding',
      'status.on': 'on',
      'status.off': 'off',
      'status.unknown': 'unknown',
      'status.address': 'Address',
      'action.start': 'Start',
      'action.stop': 'Stop',
      'action.restart': 'Restart',
      'action.starting': 'Starting…',
      'action.stopping': 'Stopping…',
      'action.restarting': 'Restarting…',
      'action.refresh': 'Refresh',
      'action.close': 'Close',
      'action.retry': 'Retry',
      'stats.title': 'Memory stats',
      'stats.log': 'Service log',
      'config.open': 'Settings',
      'config.title': 'Settings',
      'config.loading': 'Loading configuration…',
      'config.save': 'Save',
      'config.saving': 'Saving…',
      'config.saved': 'Saved',
      'config.unavailable': 'Plugin configuration is unavailable (the DSH settings service is missing)',
      'config.hint': 'Saving writes to your DSH profile and applies live where possible; a few fields (start command, service directory) need a DSH restart. First run scripts/setup-everos.ps1 (Windows) and fill the service directory and start command below.',
      'config.noChange': 'Nothing changed',
      'config.pendingReload': 'Configuration written, but DSH has not reloaded the plugin yet; restart DSH to apply it',
      'config.dirty': 'Unsaved changes',
      'stats.searchCalls': 'Search calls',
      'stats.addCalls': 'Write calls',
      'stats.fileCount': 'Memory files',
      'stats.bytes': 'Total size',
      'stats.latest': 'Last write',
      'tree.title': 'Memory files',
      'tree.loading': 'Loading memory tree…',
      'tree.empty': 'No memory files yet',
      'tree.noFiles': 'None',
      'kind.episode': 'Episodes',
      'kind.atomic_fact': 'Atomic facts',
      'kind.agent_case': 'Agent cases',
      'kind.agent_skill': 'Agent skills',
      'kind.profile': 'Profile',
      'kind.other': 'Other',
      'search.placeholder': 'Search memories…',
      'search.mode.label': 'Search mode',
      'search.mode.everos': 'EverOS ranking',
      'search.mode.local': 'Exact text',
      'search.button': 'Search',
      'search.searching': 'Searching…',
      'search.emptyQuery': 'Enter a search term',
      'search.hint': 'Type a keyword, then press Enter or click Search',
      'search.resultsTitle': 'Search results',
      'search.results': '{n} results',
      'search.noResults': 'No matches',
      'search.resultLine': 'Line {line}',
      'search.score': 'Score {score}',
      'search.untitled': 'Untitled',
      'search.errorWithMessage': 'Search failed: {message}',
      'search.locateFailed': 'No matching memory file found',
      'search.locating': 'Locating…',
      'file.loading': 'Loading file…',
      'file.entries': '{n} entries',
      'content.placeholder': 'Pick a memory file on the left, or search above.',
      'log.title': 'Service log',
      'log.loading': 'Loading log…',
      'log.empty': 'The log is empty',
      'log.notePath': 'Log file: {path}',
      'error.network': 'Cannot reach the DSH panel service. Make sure the page is connected.',
      'error.http': 'Request failed (HTTP {status})',
      'error.parse': 'The service returned unreadable data.',
      'error.generic': 'Request failed',
      'error.crash': 'The panel failed to render. Please retry.',
      'notify.done': 'Done',
      'notify.failed': 'The action did not succeed. Check the service log.',
      'confirm.cancel': 'Cancel',
      'confirm.stop.title': 'Stop the EverOS service?',
      'confirm.stop.body': 'After stopping, memory on the DSH side pauses. The plugin will not restart it automatically; start it from this panel, or restart DSH.',
      'confirm.stop.confirm': 'Stop service',
      'confirm.restart.title': 'Restart the EverOS service?',
      'confirm.restart.body': 'A restart stops EverOS and then starts it again. Memory on the DSH side pauses meanwhile, and starting can take a few minutes.',
      'confirm.restart.confirm': 'Restart service',
      'duration.seconds': '{n}s',
      'duration.minutes': '{n}m',
      'duration.hours': '{h}h {m}m',
      'duration.days': '{d}d {h}h'
    };

    /* ------------------------------------------------------------------ *
     * Styles: one string, one idempotent <style> tag, theme tokens only.
     * ------------------------------------------------------------------ */
    const CSS = [
      '.evo-root{box-sizing:border-box;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);font-size:13px;line-height:1.55;overflow:hidden;background:var(--dsw-alias-bg-base)}',
      '.evo-fallback{align-items:center;justify-content:center}',
      '.evo-fallback-box{display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px}',
      '.evo-layout{display:flex;flex:1 1 auto;min-height:0;min-width:0}',
      '.evo-side{box-sizing:border-box;width:320px;flex:0 0 320px;min-height:0;display:flex;flex-direction:column;gap:12px;padding:16px;overflow:hidden;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}',
      '.evo-main{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column}',
      '.evo-toolbar{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l2);flex-wrap:wrap;flex:none}',
      '.evo-card{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l2));background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-2));border-radius:var(--dsw-radius-lg,10px);flex:none}',
      '.evo-card-tree{flex:1 1 auto;min-height:0;overflow:hidden}',
      '.evo-card-title{margin:0;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-caption)}',
      '.evo-status-head{display:flex;align-items:center;gap:8px}',
      '.evo-status-text{font-weight:600;font-size:13px}',
      '.evo-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-label-dimmed)}',
      '.evo-dot.is-running{background:var(--dsw-alias-state-success-primary)}',
      '.evo-dot.is-stopped{background:var(--dsw-alias-state-error-primary)}',
      '.evo-dot.is-busy{background:var(--dsw-alias-state-warn-label);animation:evo-pulse 1s ease-in-out infinite}',
      '@keyframes evo-pulse{0%,100%{opacity:1}50%{opacity:.3}}',
      '.evo-rows{display:flex;flex-direction:column;gap:4px}',
      '.evo-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:12px}',
      '.evo-row-label{color:var(--dsw-alias-label-tertiary);flex:none}',
      '.evo-row-value{color:var(--dsw-alias-label-primary);text-align:right;word-break:break-word;font-variant-numeric:tabular-nums;min-width:0}',
      '.evo-mono{font-family:var(--dsw-font-family-code,var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace));font-size:11px}',
      '.evo-cap{display:inline-flex;flex-wrap:wrap;gap:4px;justify-content:flex-end}',
      '.evo-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 6px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs,4px);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}',
      '.evo-chip-on{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.evo-chip-off{color:var(--dsw-alias-label-dimmed)}',
      '.evo-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px}',
      '.evo-btn{box-sizing:border-box;appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:28px;padding:0 10px;border-radius:var(--dsw-radius-md,6px);border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1;cursor:pointer;transition:background-color .12s,border-color .12s,opacity .12s}',
      '.evo-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.evo-btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
      '.evo-btn:disabled{cursor:default;opacity:.45}',
      '.evo-btn-primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}',
      '.evo-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
      '.evo-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.evo-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}',
      '.evo-stats-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.evo-stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}',
      '.evo-stat{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);min-width:0}',
      '.evo-stat-label{font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.evo-stat-value{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums;word-break:break-all}',
      '.evo-muted{color:var(--dsw-alias-label-tertiary);font-size:12px}',
      '.evo-tree{flex:1 1 auto;display:flex;flex-direction:column;gap:10px;min-height:0;overflow-y:auto;padding-right:2px}',
      '.evo-tree-ws{display:flex;flex-direction:column;gap:2px}',
      '.evo-tree-ws-head{margin:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);word-break:break-word}',
      '.evo-tree-kind{display:flex;flex-direction:column;gap:2px;padding-left:12px}',
      '.evo-tree-kind-head{font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-caption);padding:2px 0}',
      '.evo-tree-files{list-style:none;margin:0;padding:0 0 0 12px;display:flex;flex-direction:column;gap:1px}',
      '.evo-file{box-sizing:border-box;appearance:none;display:flex;align-items:baseline;gap:6px;width:100%;padding:3px 6px 3px 8px;border-radius:var(--dsw-radius-xs,4px);border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;text-align:left;cursor:pointer;min-width:0}',
      '.evo-file:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.evo-file:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
      '.evo-file.is-active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.evo-file-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.evo-file-size{flex:none;font-size:10px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}',
      '.evo-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,6px);overflow:hidden;flex:none}',
      '.evo-seg-btn{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;padding:0 10px;min-height:28px;cursor:pointer;line-height:1;white-space:nowrap}',
      '.evo-seg-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.evo-seg-btn.is-active{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary);font-weight:600}',
      '.evo-seg-btn:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
      '.evo-input{box-sizing:border-box;flex:1 1 200px;min-width:140px;height:28px;padding:0 10px;border-radius:var(--dsw-radius-md,6px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}',
      '.evo-input::placeholder{color:var(--dsw-alias-label-dimmed)}',
      '.evo-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
      '.evo-view{box-sizing:border-box;flex:1 1 auto;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}',
      '.evo-view-log{overflow:hidden}',
      '.evo-content-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:none}',
      '.evo-head-title{margin:0;font-size:14px;font-weight:600;word-break:break-word;flex:1 1 auto;min-width:0}',
      '.evo-error{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:var(--dsw-radius-md,6px);background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);font-size:12px;word-break:break-word;flex:none}',
      '.evo-error-text{flex:1 1 auto;min-width:0}',
      '.evo-results{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.evo-result{box-sizing:border-box;appearance:none;display:flex;flex-direction:column;gap:4px;width:100%;text-align:left;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,6px);background:transparent;color:inherit;font:inherit;cursor:pointer}',
      '.evo-result:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.evo-result:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
      '.evo-result-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.evo-badge{display:inline-flex;align-items:center;padding:0 6px;height:18px;border-radius:var(--dsw-radius-xs,4px);border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);font-size:10px;letter-spacing:.03em;flex:none}',
      '.evo-result-title{font-size:13px;font-weight:600;word-break:break-word}',
      '.evo-result-meta{font-size:11px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}',
      '.evo-result-text{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}',
      '.evo-md{position:relative;display:flex;flex-direction:column;gap:8px;font-size:13px;line-height:1.65;word-break:break-word;min-height:0}',
      '.evo-md h1,.evo-md h2,.evo-md h3,.evo-md h4{margin:8px 0 0;line-height:1.35;color:var(--dsw-alias-label-primary)}',
      '.evo-md h1{font-size:18px}',
      '.evo-md h2{font-size:16px}',
      '.evo-md h3{font-size:14px}',
      '.evo-md h4{font-size:13px}',
      '.evo-md p{margin:0}',
      '.evo-md ul,.evo-md ol{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:2px}',
      '.evo-md code{font-family:var(--dsw-font-family-code,var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace));font-size:11.5px;padding:1px 4px;border-radius:var(--dsw-radius-xs,4px);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2)}',
      '.evo-md pre{margin:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,6px);background:var(--dsw-alias-bg-layer-1);overflow-x:auto}',
      '.evo-md pre code{padding:0;border:none;background:transparent;font-size:11.5px;line-height:1.5;white-space:pre}',
      '.evo-md blockquote{margin:0;padding:2px 0 2px 10px;border-left:2px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;gap:4px}',
      '.evo-md hr{border:none;border-top:1px solid var(--dsw-alias-border-l2);margin:4px 0;width:100%}',
      '.evo-md strong{font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.evo-md [data-hit="1"]{background:var(--dsw-alias-interactive-bg-hover);border-radius:var(--dsw-radius-xs,4px);box-shadow:0 0 0 2px var(--dsw-alias-interactive-bg-hover)}',
      '.evo-notice{box-sizing:border-box;margin:0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,6px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.55}',
      '.evo-config{display:flex;flex-direction:column;gap:12px;min-height:0}',
      '.evo-config-group{margin:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.evo-config-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,240px);gap:2px 12px;align-items:center;padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.evo-config-meta{display:flex;flex-direction:column;gap:1px;min-width:0}',
      '.evo-config-label{font-size:12.5px;color:var(--dsw-alias-label-primary)}',
      '.evo-config-name{font-size:10.5px;color:var(--dsw-alias-label-tertiary);word-break:break-all}',
      '.evo-config-control{display:flex;justify-content:flex-end;min-width:0}',
      '.evo-config-control .evo-input{width:100%;min-width:0}',
      '.evo-config-control input[type="checkbox"]{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary)}',
      '.evo-config-hint{grid-column:1 / -1;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.evo-log{box-sizing:border-box;margin:0;flex:1 1 auto;min-height:0;overflow:auto;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,6px);background:var(--dsw-alias-bg-layer-1);font-family:var(--dsw-font-family-code,var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace));font-size:11.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary)}',
      '.evo-modal-backdrop{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.38)}',
      '.evo-modal{box-sizing:border-box;width:min(420px,100%);max-height:calc(100vh - 64px);display:flex;flex-direction:column;gap:12px;padding:20px;border-radius:var(--dsw-radius-xl,14px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent,0 12px 32px rgba(0,0,0,.28));color:var(--dsw-alias-label-primary)}',
      '.evo-modal-title{margin:0;font-size:15px;font-weight:600}',
      '.evo-modal-body{margin:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.evo-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}',
      '.evo-toast{position:fixed;right:20px;bottom:20px;z-index:1300;display:flex;align-items:flex-start;gap:8px;max-width:min(420px,calc(100vw - 40px));padding:10px 14px;border-radius:var(--dsw-radius-md,6px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.24));font-size:12px;color:var(--dsw-alias-label-primary);word-break:break-word}',
      '.evo-toast.is-error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.evo-toast.is-success{border-color:var(--dsw-alias-state-success-primary)}',
      '.evo-empty{margin:auto;display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary);text-align:center;padding:32px 16px}',
      '.evo-tree-toggle{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:100%;min-width:0;margin:0;padding:4px 6px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;text-align:left;cursor:pointer;font:inherit}',
      '.evo-tree-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.evo-tree-toggle:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
      '.evo-tree-toggle.evo-tree-ws-head{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);word-break:break-word}',
      '.evo-tree-toggle.evo-tree-kind-head{font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-caption);font-weight:400;padding:2px 6px}',
      '.evo-tree-caret{flex:none;width:10px;height:10px;opacity:.7;transition:transform .12s ease;transform:rotate(90deg)}',
      '.evo-tree-toggle[aria-expanded="false"] .evo-tree-caret{transform:rotate(0deg)}',
      '.evo-tree-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.evo-tree-count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:400}',
      '@media (max-width:760px){.evo-layout{flex-direction:column}.evo-side{width:100%;flex:0 0 auto;max-height:46%;border-right:none;border-bottom:1px solid var(--dsw-alias-border-l2)}}'
    ].join('\n');

    /* ------------------------------------------------------------------ *
     * Small helpers: errors, HTTP, formatting
     * ------------------------------------------------------------------ */
    function noop() {}

    function makeError(code) {
      const error = new Error(code);
      error.code = code;
      return error;
    }

    function toPanelError(error) {
      if (error && typeof error === 'object') {
        return {
          code: typeof error.code === 'string' ? error.code : 'unknown',
          status: typeof error.status === 'number' ? error.status : null,
          message: typeof error.message === 'string' ? error.message : ''
        };
      }
      return { code: 'unknown', status: null, message: error === undefined || error === null ? '' : String(error) };
    }

    /**
     * Localized error copy. Host replies carry their own Chinese message, which
     * is shown verbatim; only transport-level failures are translated here.
     */
    function describeError(error, t) {
      if (!error) return '';
      if (error.code === 'network') return t('error.network');
      if (error.code === 'parse') return t('error.parse');
      if (error.code === 'http') {
        if (error.message) return error.message;
        return t('error.http', { status: error.status === null ? '?' : error.status });
      }
      if (error.message) return error.message;
      return t('error.generic');
    }

    /**
     * One JSON request against the host half. The URL is document-relative on
     * purpose; no leading slash, no absolute origin, no abort timeout (start and
     * restart are allowed to block for minutes).
     */
    function request(path, init) {
      let response;
      try {
        response = fetch(API_BASE + path, init);
      } catch (error) {
        return Promise.reject(makeError('network'));
      }
      return response.then(function (res) {
        return res.text().then(function (body) {
          let data = null;
          if (body) {
            try {
              data = JSON.parse(body);
            } catch (parseError) {
              data = null;
            }
          }
          if (!res.ok) {
            const failure = makeError('http');
            failure.status = res.status;
            if (data && typeof data.error === 'string' && data.error) failure.message = data.error;
            throw failure;
          }
          if (data === null) throw makeError('parse');
          return data;
        }, function () {
          throw makeError('parse');
        });
      }, function () {
        throw makeError('network');
      });
    }

    function apiGet(path) {
      return request(path, { method: 'GET', headers: { accept: 'application/json' } });
    }

    function apiPost(path, payload) {
      const init = { method: 'POST', headers: { accept: 'application/json' } };
      if (payload !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(payload);
      }
      return request(path, init);
    }

    function formatCount(value) {
      const numeric = Number(value);
      if (!isFinite(numeric)) return PLACEHOLDER;
      return String(Math.round(numeric)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function formatBytes(value) {
      const numeric = Number(value);
      if (!isFinite(numeric) || numeric <= 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let unit = 0;
      let size = numeric;
      while (size >= 1024 && unit < units.length - 1) {
        size = size / 1024;
        unit += 1;
      }
      const digits = unit === 0 ? 0 : size >= 100 ? 0 : 1;
      return size.toFixed(digits) + ' ' + units[unit];
    }

    /** 允许的时间格式；status 里没有就按默认 local。 */
    function readTimeFormat(status) {
      const value = status && typeof status.timeFormat === 'string' ? status.timeFormat : 'local';
      return ['local', 'local-short', 'iso', 'utc'].indexOf(value) >= 0 ? value : 'local';
    }

    /** 本地 ISO 带时区偏移，例如 2026-10-23T16:15:18+08:00。 */
    function localIso(date) {
      const pad = function (value) { return String(value).padStart(2, '0'); };
      const offset = -date.getTimezoneOffset();
      const sign = offset >= 0 ? '+' : '-';
      const abs = Math.abs(offset);
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
        + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
        + sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
    }

    /** Unix seconds -> 按配置格式显示；无效时间返回 null。 */
    function formatClock(seconds, format) {
      const numeric = Number(seconds);
      if (!isFinite(numeric) || numeric <= 0) return null;
      const date = new Date(numeric * 1000);
      const mode = format || 'local';
      const pad = function (part) {
        return part < 10 ? '0' + part : String(part);
      };
      if (mode === 'local-short') return pad(date.getHours()) + ':' + pad(date.getMinutes());
      if (mode === 'iso') return localIso(date);
      if (mode === 'utc') return date.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
        ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    /** Unix seconds (host sends seconds as a float) -> localized duration. */
    function formatUptime(startedAt, t) {
      const numeric = Number(startedAt);
      if (!isFinite(numeric) || numeric <= 0) return null;
      let elapsed = Math.floor(Date.now() / 1000 - numeric);
      if (!isFinite(elapsed) || elapsed < 0) elapsed = 0;
      if (elapsed < 60) return t('duration.seconds', { n: elapsed });
      if (elapsed < 3600) return t('duration.minutes', { n: Math.floor(elapsed / 60) });
      if (elapsed < 86400) {
        return t('duration.hours', { h: Math.floor(elapsed / 3600), m: Math.floor((elapsed % 3600) / 60) });
      }
      return t('duration.days', { d: Math.floor(elapsed / 86400), h: Math.floor((elapsed % 86400) / 3600) });
    }

    /** Prefer the host's pre-aggregated `calls`, fall back to raw counters. */
    function readCounts(status) {
      if (!status || typeof status !== 'object') return { search: 0, add: 0 };
      const calls = status.calls;
      if (calls && typeof calls === 'object') {
        return {
          search: isFinite(Number(calls.search)) ? Number(calls.search) : 0,
          add: isFinite(Number(calls.add)) ? Number(calls.add) : 0
        };
      }
      return parseCounters(status.counters);
    }

    /** Raw `everos_http_requests_total` lines: `{...} 12`, keyed by route. */
    function parseCounters(counters) {
      const totals = { search: 0, add: 0 };
      if (!Array.isArray(counters)) return totals;
      for (let index = 0; index < counters.length; index += 1) {
        const line = counters[index];
        if (typeof line !== 'string') continue;
        const match = /\}\s+(\d+)\s*$/.exec(line);
        if (!match) continue;
        const count = Number(match[1]);
        if (!isFinite(count)) continue;
        if (line.indexOf('memory/search') !== -1) totals.search += count;
        else if (line.indexOf('memory/add') !== -1) totals.add += count;
      }
      return totals;
    }

    function kindLabel(kind, t) {
      if (KIND_ORDER.indexOf(kind) !== -1) return t('kind.' + kind);
      return t('kind.other');
    }

    /* ------------------------------------------------------------------ *
     * Lightweight Markdown: escape first, then render a tiny block/inline set
     * (headings, lists, fenced code, bold, inline code, blockquotes, rules).
     * No third-party renderer, no raw HTML from memory files ever reaches the
     * page: every text run is escaped before any tag of ours is inserted.
     * ------------------------------------------------------------------ */
    function escapeHtml(text) {
      return String(text === null || text === undefined ? '' : text).replace(/[&<>"']/g, function (character) {
        if (character === '&') return '&amp;';
        if (character === '<') return '&lt;';
        if (character === '>') return '&gt;';
        if (character === '"') return '&quot;';
        return '&#39;';
      });
    }

    function inlineHtml(text) {
      try {
        const escaped = escapeHtml(text);
        const pattern = /`([^`\n]+)`|\*\*([\s\S]+?)\*\*/g;
        let output = '';
        let last = 0;
        let match = pattern.exec(escaped);
        while (match !== null) {
          output += escaped.slice(last, match.index);
          if (match[1] !== undefined) output += '<code>' + match[1] + '</code>';
          else output += '<strong>' + match[2] + '</strong>';
          last = pattern.lastIndex;
          match = pattern.exec(escaped);
        }
        output += escaped.slice(last);
        return output;
      } catch (error) {
        return escapeHtml(text);
      }
    }

    function readList(lines, startIndex, kind) {
      const items = [];
      const itemPattern = kind === 'ol' ? /^\d+[.)]\s+(.*)$/ : /^[-*+]\s+(.*)$/;
      let index = startIndex;
      while (index < lines.length) {
        const trimmed = lines[index].trim();
        const itemMatch = itemPattern.exec(trimmed);
        if (itemMatch) {
          items.push(itemMatch[1]);
          index += 1;
          continue;
        }
        if (trimmed === '') break;
        if (/^(#{1,6}\s|```|~~~|>)/.test(trimmed)) break;
        if (kind === 'ul' && /^\d+[.)]\s+/.test(trimmed)) break;
        if (kind === 'ol' && /^[-*+]\s+/.test(trimmed)) break;
        if (items.length > 0) items[items.length - 1] = items[items.length - 1] + ' ' + trimmed;
        index += 1;
      }
      return { items: items, next: index };
    }

    function parseMarkdown(source) {
      const text = String(source === null || source === undefined ? '' : source).replace(/\r\n?/g, '\n');
      const lines = text.split('\n');
      const nodes = [];
      let index = 0;
      while (index < lines.length) {
        const rawLine = lines[index];
        const trimmed = rawLine.trim();
        if (trimmed === '') {
          index += 1;
          continue;
        }
        const fenceMatch = /^(```+|~~~+)\s*([A-Za-z0-9_+#.-]*)\s*$/.exec(trimmed);
        if (fenceMatch) {
          const marker = fenceMatch[1].charAt(0);
          const fenceLength = fenceMatch[1].length;
          const startLine = index;
          const buffer = [];
          index += 1;
          while (index < lines.length) {
            const currentTrimmed = lines[index].trim();
            let onlyMarker = currentTrimmed.length >= fenceLength;
            if (onlyMarker) {
              for (let position = 0; position < currentTrimmed.length; position += 1) {
                if (currentTrimmed.charAt(position) !== marker) {
                  onlyMarker = false;
                  break;
                }
              }
            }
            if (onlyMarker) {
              index += 1;
              break;
            }
            buffer.push(lines[index]);
            index += 1;
          }
          nodes.push({ type: 'code', line: startLine + 1, lang: fenceMatch[2] || '', text: buffer.join('\n') });
          continue;
        }
        const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
        if (headingMatch) {
          nodes.push({ type: 'heading', line: index + 1, level: headingMatch[1].length, text: headingMatch[2].trim() });
          index += 1;
          continue;
        }
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
          nodes.push({ type: 'hr', line: index + 1 });
          index += 1;
          continue;
        }
        if (/^>\s?/.test(trimmed)) {
          const startLine = index;
          const quoteLines = [];
          while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
            quoteLines.push(lines[index].trim().replace(/^>\s?/, ''));
            index += 1;
          }
          nodes.push({ type: 'quote', line: startLine + 1, text: quoteLines.join('\n') });
          continue;
        }
        if (/^[-*+]\s+/.test(trimmed)) {
          const list = readList(lines, index, 'ul');
          nodes.push({ type: 'ul', line: index + 1, items: list.items });
          index = list.next;
          continue;
        }
        if (/^\d+[.)]\s+/.test(trimmed)) {
          const list = readList(lines, index, 'ol');
          nodes.push({ type: 'ol', line: index + 1, items: list.items });
          index = list.next;
          continue;
        }
        const startLine = index;
        const paragraph = [];
        while (index < lines.length) {
          const current = lines[index];
          const currentTrimmed = current.trim();
          if (currentTrimmed === '') break;
          if (index > startLine) {
            if (/^(#{1,6}\s|>\s?|```|~~~|[-*+]\s|\d+[.)]\s)/.test(currentTrimmed)) break;
            if (/^(-{3,}|\*{3,}|_{3,})$/.test(currentTrimmed)) break;
          }
          paragraph.push(currentTrimmed);
          index += 1;
        }
        nodes.push({ type: 'p', line: startLine + 1, text: paragraph.join(' ') });
      }
      return nodes;
    }

    function parseMarkdownSafe(source) {
      try {
        return parseMarkdown(source);
      } catch (error) {
        return [{ type: 'p', line: 1, text: String(source === null || source === undefined ? '' : source) }];
      }
    }

    function renderMarkdownNodes(nodes, hitIndex) {
      const output = [];
      for (let index = 0; index < nodes.length; index += 1) {
        try {
          const node = nodes[index];
          const hit = index === hitIndex ? { 'data-hit': '1' } : null;
          const key = 'md-' + index;
          if (node.type === 'heading') {
            const level = node.level >= 1 && node.level <= 4 ? node.level : 4;
            output.push(h('h' + level, Object.assign({
              key: key,
              dangerouslySetInnerHTML: { __html: inlineHtml(node.text) }
            }, hit)));
          } else if (node.type === 'code') {
            output.push(h('pre', Object.assign({ key: key }, hit), h('code', null, node.text)));
          } else if (node.type === 'hr') {
            output.push(h('hr', Object.assign({ key: key }, hit)));
          } else if (node.type === 'quote') {
            output.push(h('blockquote', Object.assign({ key: key }, hit), String(node.text || '').split('\n').map(function (lineText, lineIndex) {
              return h('p', { key: 'q-' + lineIndex, dangerouslySetInnerHTML: { __html: inlineHtml(lineText) } });
            })));
          } else if (node.type === 'ul' || node.type === 'ol') {
            output.push(h(node.type, Object.assign({ key: key }, hit), (node.items || []).map(function (itemText, itemIndex) {
              return h('li', { key: 'li-' + itemIndex, dangerouslySetInnerHTML: { __html: inlineHtml(itemText) } });
            })));
          } else {
            output.push(h('p', Object.assign({
              key: key,
              dangerouslySetInnerHTML: { __html: inlineHtml(node.text) }
            }, hit)));
          }
        } catch (error) {
          /* Skip one broken block instead of taking the whole panel down. */
        }
      }
      return output;
    }

    /* ------------------------------------------------------------------ *
     * Presentational components
     * ------------------------------------------------------------------ */
    function ErrorBar(props) {
      if (!props.text) return null;
      return h('div', { className: 'evo-error', role: 'alert' },
        h('span', { className: 'evo-error-text' }, props.text));
    }

    function rowElement(label, value, mono, key) {
      return h('div', { className: 'evo-row', key: key },
        h('span', { className: 'evo-row-label' }, label),
        h('span', { className: 'evo-row-value' + (mono ? ' evo-mono' : '') }, value));
    }

    function capChip(label, value, t) {
      const known = typeof value === 'boolean';
      const on = value === true;
      const suffix = known ? (on ? t('status.on') : t('status.off')) : t('status.unknown');
      return h('span', { className: 'evo-chip ' + (on ? 'evo-chip-on' : 'evo-chip-off') }, label + ' ' + suffix);
    }

    function StatusCard(props) {
      const t = props.t;
      const status = props.status;
      const busy = props.busy;
      const error = props.error;

      let dotClass = 'evo-dot';
      let stateText = t('status.loading');
      if (busy) {
        dotClass += ' is-busy';
        stateText = t('status.busy');
      } else if (status && status.running === true) {
        dotClass += ' is-running';
        stateText = t('status.running');
      } else if (status) {
        dotClass += ' is-stopped';
        stateText = t('status.stopped');
      } else if (error) {
        stateText = t('status.unknown');
      }

      const version = status && typeof status.version === 'string' && status.version ? status.version : PLACEHOLDER;
      const pid = status && status.pid !== null && status.pid !== undefined && status.pid !== '' ? String(status.pid) : PLACEHOLDER;
      const uptime = status && status.running === true && status.startedAt ? formatUptime(status.startedAt, t) : null;
      const baseUrl = status && typeof status.baseUrl === 'string' ? status.baseUrl : '';
      const capabilities = status && status.capabilities && typeof status.capabilities === 'object' ? status.capabilities : null;

      const rows = [
        rowElement(t('status.version'), version, false, 'version'),
        rowElement(t('status.pid'), pid, true, 'pid'),
        rowElement(t('status.uptime'), uptime || PLACEHOLDER, false, 'uptime'),
        rowElement(t('status.capabilities'), capabilities
          ? h('span', { className: 'evo-cap' },
            capChip(t('status.capability.llm'), capabilities.llm, t),
            capChip(t('status.capability.embed'), capabilities.embed, t))
          : PLACEHOLDER, false, 'caps')
      ];
      if (baseUrl) rows.push(rowElement(t('status.address'), h('span', { className: 'evo-mono' }, baseUrl), false, 'address'));

      const disabled = Boolean(busy);
      const configured = !status || status.configured !== false;
      const platformSupported = !status || status.platformSupported !== false;
      const startDisabled = disabled || Boolean(status && status.running === true) || !configured || !platformSupported;
      const stopDisabled = disabled || Boolean(status && status.running !== true);
      const restartDisabled = disabled || !configured || !platformSupported;
      const hint = status && typeof status.hint === 'string' && status.hint ? status.hint : '';

      return h('section', { className: 'evo-card', 'aria-label': t('status.title') },
        h('h2', { className: 'evo-card-title' }, t('status.title')),
        h('div', { className: 'evo-status-head' },
          h('span', { className: dotClass, 'aria-hidden': 'true' }),
          h('span', { className: 'evo-status-text' }, stateText)),
        h('div', { className: 'evo-rows' }, rows),
        hint ? h('div', { className: 'evo-notice', key: 'hint' }, hint) : null,
        h('div', { className: 'evo-actions' },
          h('button', {
            type: 'button', className: 'evo-btn evo-btn-primary', key: 'start',
            disabled: startDisabled, onClick: props.onStart
          }, busy === 'start' ? t('action.starting') : t('action.start')),
          h('button', {
            type: 'button', className: 'evo-btn evo-btn-danger', key: 'stop',
            disabled: stopDisabled, onClick: props.onStop
          }, busy === 'stop' ? t('action.stopping') : t('action.stop')),
          h('button', {
            type: 'button', className: 'evo-btn', key: 'restart',
            disabled: restartDisabled, onClick: props.onRestart
          }, busy === 'restart' ? t('action.restarting') : t('action.restart'))),
        error ? h(ErrorBar, { text: describeError(error, t), key: 'error' }) : null);
    }

    function statTile(label, value, key) {
      return h('div', { className: 'evo-stat', key: key },
        h('span', { className: 'evo-stat-label' }, label),
        h('span', { className: 'evo-stat-value' }, value));
    }

    function StatsCard(props) {
      const t = props.t;
      const status = props.status;
      const tree = props.tree;
      const counts = useMemo(function () {
        return readCounts(status);
      }, [status]);
      const fileCount = tree && typeof tree.fileCount === 'number' ? tree.fileCount : null;
      const bytes = tree && typeof tree.bytes === 'number' ? tree.bytes : null;
      const latest = tree && typeof tree.latestMtime === 'number' ? formatClock(tree.latestMtime, readTimeFormat(status)) : null;

      return h('section', { className: 'evo-card', 'aria-label': t('stats.title') },
        h('div', { className: 'evo-stats-head' },
          h('h2', { className: 'evo-card-title' }, t('stats.title')),
          h('div', { className: 'evo-actions' },
            h('button', { type: 'button', className: 'evo-btn', key: 'config', onClick: props.onOpenConfig }, t('config.open')),
            h('button', { type: 'button', className: 'evo-btn', key: 'log', onClick: props.onOpenLog }, t('stats.log')))),
        h('div', { className: 'evo-stats-grid' },
          statTile(t('stats.searchCalls'), formatCount(counts.search), 'search'),
          statTile(t('stats.addCalls'), formatCount(counts.add), 'add'),
          statTile(t('stats.fileCount'), fileCount === null ? PLACEHOLDER : formatCount(fileCount), 'files'),
          statTile(t('stats.bytes'), bytes === null ? PLACEHOLDER : formatBytes(bytes), 'bytes')),
        h('div', { className: 'evo-row' },
          h('span', { className: 'evo-row-label' }, t('stats.latest')),
          h('span', { className: 'evo-row-value' }, latest || PLACEHOLDER)),
        props.error ? h(ErrorBar, { text: describeError(props.error, t), key: 'error' }) : null);
    }

    function TreeCaret() {
      return h('svg', { className: 'evo-tree-caret', viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('path', {
          d: 'M6 3.5 10.5 8 6 12.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round'
        }));
    }

    function MemoryTree(props) {
      const t = props.t;
      const tree = props.tree;
      const collapsedState = useState({});
      const collapsedMap = collapsedState[0];
      const setCollapsed = collapsedState[1];
      const toggle = useCallback(function (key) {
        setCollapsed(function (previous) {
          const next = Object.assign({}, previous);
          next[key] = !previous[key];
          return next;
        });
      }, [setCollapsed]);
      if (!tree) return h('div', { className: 'evo-muted' }, t('tree.loading'));
      const workspaces = tree.workspaces && typeof tree.workspaces === 'object' ? tree.workspaces : null;
      const names = workspaces ? Object.keys(workspaces).sort() : [];
      if (!names.length) return h('div', { className: 'evo-muted' }, t('tree.empty'));
      return h('div', { className: 'evo-tree' }, names.map(function (workspaceName) {
        const groups = workspaces[workspaceName] && typeof workspaces[workspaceName] === 'object' ? workspaces[workspaceName] : {};
        const kindSections = [];
        for (let kindIndex = 0; kindIndex < KIND_ORDER.length; kindIndex += 1) {
          const kind = KIND_ORDER[kindIndex];
          const files = Array.isArray(groups[kind]) ? groups[kind] : [];
          if (!files.length) continue;
          const kindKey = 'kind:' + workspaceName + ':' + kind;
          const kindExpanded = collapsedMap[kindKey] !== true;
          kindSections.push(h('div', { className: 'evo-tree-kind', key: 'kind-' + kind },
            h('button', {
              type: 'button',
              className: 'evo-tree-toggle evo-tree-kind-head',
              'aria-expanded': kindExpanded,
              onClick: function () { toggle(kindKey); }
            },
              h(TreeCaret, { key: 'caret' }),
              h('span', { key: 'label' }, kindLabel(kind, t) + ' \u00b7 ' + files.length)),
            kindExpanded ? h('ul', { className: 'evo-tree-files' }, files.map(function (file, fileIndex) {
              const path = file && typeof file.path === 'string' ? file.path : '';
              const label = file && typeof file.name === 'string' && file.name
                ? file.name
                : (path ? path.split('/').pop() : PLACEHOLDER);
              const active = path !== '' && props.selectedPath === path;
              return h('li', { key: path || 'file-' + fileIndex },
                h('button', {
                  type: 'button',
                  className: 'evo-file' + (active ? ' is-active' : ''),
                  title: path,
                  onClick: function () {
                    props.onOpen(path, null);
                  }
                },
                  h('span', { className: 'evo-file-name' }, label),
                  file && typeof file.size === 'number'
                    ? h('span', { className: 'evo-file-size' }, formatBytes(file.size))
                    : null));
            })) : null));
        }
        if (!kindSections.length) kindSections.push(h('div', { className: 'evo-muted', key: 'none' }, t('tree.noFiles')));
        const workspaceKey = 'ws:' + workspaceName;
        const workspaceExpanded = collapsedMap[workspaceKey] !== true;
        let workspaceTotal = 0;
        for (let totalIndex = 0; totalIndex < KIND_ORDER.length; totalIndex += 1) {
          const totalFiles = groups[KIND_ORDER[totalIndex]];
          if (Array.isArray(totalFiles)) workspaceTotal += totalFiles.length;
        }
        return h('section', { className: 'evo-tree-ws', key: 'ws-' + workspaceName },
          h('button', {
            type: 'button',
            className: 'evo-tree-toggle evo-tree-ws-head',
            title: workspaceName,
            'aria-expanded': workspaceExpanded,
            onClick: function () { toggle(workspaceKey); }
          },
            h(TreeCaret, { key: 'caret' }),
            h('span', { className: 'evo-tree-name', key: 'name' }, workspaceName),
            h('span', { className: 'evo-tree-count', key: 'count' }, ' \u00b7 ' + workspaceTotal)),
          workspaceExpanded ? kindSections : null);
      }));
    }

    function FileView(props) {
      const t = props.t;
      const file = props.file;
      const path = typeof props.path === 'string' ? props.path : '';
      const entries = file && typeof file.entries === 'number' ? file.entries : null;
      const content = file && typeof file.content === 'string' ? file.content : '';
      const nodes = useMemo(function () {
        return parseMarkdownSafe(content);
      }, [content]);
      const hitIndex = useMemo(function () {
        const targetLine = props.targetLine;
        if (typeof targetLine !== 'number') return -1;
        let index = -1;
        for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
          if (typeof nodes[nodeIndex].line === 'number' && nodes[nodeIndex].line <= targetLine) index = nodeIndex;
        }
        return index;
      }, [nodes, props.targetLine]);
      const scrollRef = useRef(null);

      useEffect(function () {
        const box = scrollRef.current;
        if (!box || hitIndex < 0) return;
        const target = box.querySelector('[data-hit="1"]');
        if (!target) return;
        const boxRect = box.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const next = box.scrollTop + (targetRect.top - boxRect.top) - 16;
        box.scrollTop = next < 0 ? 0 : next;
      }, [hitIndex, nodes]);

      const children = [];
      children.push(h('div', { className: 'evo-content-head', key: 'head' },
        h('h2', { className: 'evo-head-title evo-mono' }, path || PLACEHOLDER),
        entries !== null ? h('span', { className: 'evo-muted' }, t('file.entries', { n: formatCount(entries) })) : null,
        typeof props.targetLine === 'number'
          ? h('span', { className: 'evo-result-meta' }, t('search.resultLine', { line: props.targetLine }))
          : null,
        h('button', { type: 'button', className: 'evo-btn', key: 'close', onClick: props.onClose }, t('action.close'))));
      if (props.error) children.push(h(ErrorBar, { text: describeError(props.error, t), key: 'error' }));
      if (props.loading) {
        children.push(h('div', { className: 'evo-muted', key: 'loading' }, t('file.loading')));
      } else if (file) {
        children.push(h('div', { className: 'evo-md', key: 'md' }, renderMarkdownNodes(nodes, hitIndex)));
      }
      return h('div', { className: 'evo-view', ref: scrollRef }, children);
    }

    function renderLocalResult(item, index, props, t) {
      const path = item && typeof item.path === 'string' ? item.path : '';
      const name = path ? path.split('/').pop() : '';
      const line = item && typeof item.line === 'number' ? item.line : null;
      return h('li', { key: 'result-' + index },
        h('button', {
          type: 'button', className: 'evo-result', title: path,
          onClick: function () {
            props.onOpenLocal(path, line);
          }
        },
          h('div', { className: 'evo-result-head' },
            h('span', { className: 'evo-result-title' }, name || path),
            line !== null ? h('span', { className: 'evo-result-meta' }, t('search.resultLine', { line: line })) : null),
          item && typeof item.text === 'string' ? h('div', { className: 'evo-result-text' }, item.text) : null));
    }

    function renderEverosResult(item, index, props, t) {
      const kind = item && typeof item.kind === 'string' ? item.kind : 'other';
      const subject = item && typeof item.subject === 'string' ? item.subject : '';
      const summary = item && typeof item.summary === 'string' ? item.summary : '';
      const workspace = item && typeof item.workspace === 'string' ? item.workspace : '';
      const score = item && typeof item.score === 'number' && isFinite(item.score) ? item.score.toFixed(3) : null;
      return h('li', { key: 'result-' + index },
        h('button', {
          type: 'button', className: 'evo-result', title: subject || summary,
          onClick: function () {
            props.onOpenEveros(item);
          }
        },
          h('div', { className: 'evo-result-head' },
            h('span', { className: 'evo-badge' }, kindLabel(kind, t)),
            h('span', { className: 'evo-result-title' }, subject || t('search.untitled')),
            score !== null ? h('span', { className: 'evo-result-meta' }, t('search.score', { score: score })) : null,
            workspace ? h('span', { className: 'evo-result-meta' }, workspace) : null),
          summary ? h('div', { className: 'evo-result-text' }, summary) : null));
    }

    function SearchResults(props) {
      const t = props.t;
      const results = props.results;
      const searched = results !== null;
      const list = Array.isArray(results) ? results : [];
      const error = props.error;
      let errorText = '';
      if (error) {
        errorText = typeof error.server === 'string' && error.server
          ? t('search.errorWithMessage', { message: error.server })
          : describeError(error, t);
      }

      const children = [];
      children.push(h('div', { className: 'evo-content-head', key: 'head' },
        h('h2', { className: 'evo-head-title' }, t('search.resultsTitle')),
        searched ? h('span', { className: 'evo-muted' }, t('search.results', { n: list.length })) : null));
      if (props.searching) children.push(h('div', { className: 'evo-muted', key: 'searching' }, t('search.searching')));
      if (errorText) children.push(h(ErrorBar, { text: errorText, key: 'error' }));
      if (props.note) children.push(h('div', { className: 'evo-muted', key: 'note' }, props.note));

      if (list.length > 0) {
        children.push(h('ul', { className: 'evo-results', key: 'list' }, list.map(function (item, index) {
          const isLocal = item && typeof item.path === 'string' && typeof item.line === 'number';
          return isLocal ? renderLocalResult(item, index, props, t) : renderEverosResult(item, index, props, t);
        })));
      } else if (searched && !props.searching && !errorText) {
        children.push(h('div', { className: 'evo-empty', key: 'noresults' },
          h('div', { className: 'evo-muted' }, t('search.noResults'))));
      } else if (!searched && !props.searching) {
        children.push(h('div', { className: 'evo-empty', key: 'empty' },
          h('div', null, t('content.placeholder')),
          h('div', { className: 'evo-muted' }, t('search.hint'))));
      }
      return h('div', { className: 'evo-view' }, children);
    }

    /**
     * 日志时间按配置显示（默认本地）：
     * - EverOS 自己写的行是 UTC（结尾带 Z），按格式换算；
     * - 管家写的分隔行本来就是本地时间，原样保留。
     */
    function formatLogLine(line, format) {
      const text = typeof line === 'string' ? line : String(line === undefined || line === null ? '' : line);
      const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z(\s[\s\S]*)$/);
      if (!match) return text;
      const date = new Date(text.slice(0, text.indexOf('Z') + 1));
      if (isNaN(date.getTime())) return text;
      const mode = format || 'local';
      if (mode === 'utc') return text;
      const pad = function (value) { return String(value).padStart(2, '0'); };
      if (mode === 'local-short') {
        return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
          + match[7] + match[8];
      }
      if (mode === 'iso') return localIso(date) + match[7] + match[8];
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
        + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
        + match[7] + match[8];
    }

    function LogView(props) {
      const t = props.t;
      const log = props.log;
      const lines = log && Array.isArray(log.lines) ? log.lines : [];
      const note = log && typeof log.note === 'string' ? log.note : '';
      const path = log && typeof log.path === 'string' ? log.path : '';
      const children = [];
      children.push(h('div', { className: 'evo-content-head', key: 'head' },
        h('h2', { className: 'evo-head-title' }, t('log.title')),
        h('button', {
          type: 'button', className: 'evo-btn', key: 'refresh',
          disabled: props.loading, onClick: props.onRefresh
        }, props.loading ? t('log.loading') : t('action.refresh')),
        h('button', { type: 'button', className: 'evo-btn', key: 'close', onClick: props.onClose }, t('action.close'))));
      if (note) children.push(h('div', { className: 'evo-muted', key: 'note' }, note));
      if (path) children.push(h('div', { className: 'evo-muted evo-mono', key: 'path' }, t('log.notePath', { path: path })));
      if (props.error) children.push(h(ErrorBar, { text: describeError(props.error, t), key: 'error' }));
      if (lines.length > 0) children.push(h('pre', { className: 'evo-log', key: 'log' }, lines.map(function (line) {
        return formatLogLine(line, props.timeFormat);
      }).join('\n')));
      else if (!props.loading) children.push(h('div', { className: 'evo-muted', key: 'empty' }, t('log.empty')));
      return h('div', { className: 'evo-view evo-view-log' }, children);
    }

    function ConfirmDialog(props) {
      const open = typeof props.kind === 'string' && props.kind !== '';
      const cancelRef = useRef(null);
      const cancelActionRef = useRef(props.onCancel);

      useEffect(function () {
        cancelActionRef.current = props.onCancel;
      }, [props.onCancel]);

      useEffect(function () {
        if (!open) return undefined;
        const onKeyDown = function (event) {
          if (event.key === 'Escape' || event.key === 'Esc') {
            event.preventDefault();
            event.stopPropagation();
            cancelActionRef.current();
          }
        };
        document.addEventListener('keydown', onKeyDown, true);
        const timer = window.setTimeout(function () {
          const node = cancelRef.current;
          if (node && typeof node.focus === 'function') node.focus();
        }, 0);
        return function () {
          document.removeEventListener('keydown', onKeyDown, true);
          window.clearTimeout(timer);
        };
      }, [open]);

      if (!open) return null;
      const kind = props.kind;
      const t = props.t;
      return h('div', {
        className: 'evo-modal-backdrop', role: 'presentation',
        onClick: props.onCancel
      },
        h('div', {
          className: 'evo-modal', role: 'dialog', 'aria-modal': 'true',
          'aria-labelledby': 'everos-confirm-title',
          'aria-describedby': 'everos-confirm-body',
          onClick: function (event) {
            event.stopPropagation();
          }
        },
          h('h2', { className: 'evo-modal-title', id: 'everos-confirm-title' }, t('confirm.' + kind + '.title')),
          h('p', { className: 'evo-modal-body', id: 'everos-confirm-body' }, t('confirm.' + kind + '.body')),
          h('div', { className: 'evo-modal-actions' },
            h('button', {
              type: 'button', className: 'evo-btn', key: 'cancel',
              ref: cancelRef, onClick: props.onCancel
            }, t('confirm.cancel')),
            h('button', {
              type: 'button', className: 'evo-btn evo-btn-danger', key: 'confirm',
              onClick: props.onConfirm
            }, t('confirm.' + kind + '.confirm')))));
    }

    function Toast(props) {
      if (!props.toast) return null;
      const kind = props.toast.kind;
      return h('div', {
        className: 'evo-toast' + (kind === 'error' ? ' is-error' : kind === 'success' ? ' is-success' : ''),
        role: 'status'
      },
        h('span', { className: 'evo-toast-text' }, props.toast.text));
    }

    /**
     * Render boundary so a defect inside the page can never take the whole
     * `main` slot down; the fallback only offers a retry.
     */
    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
        this.handleRetry = this.handleRetry.bind(this);
      }

      static getDerivedStateFromError() {
        return { failed: true };
      }

      componentDidCatch(error) {
        try {
          console.error('[everos-panel] render failed', error);
        } catch (ignore) {
          /* console may be unavailable */
        }
      }

      handleRetry() {
        this.setState({ failed: false });
      }

      render() {
        if (this.state.failed) {
          return h('div', { className: 'evo-root evo-fallback', 'data-dsh-everos-panel-view': '' },
            h('div', { className: 'evo-fallback-box' },
              h('p', { className: 'evo-muted' }, this.props.t('error.crash')),
              h('button', { type: 'button', className: 'evo-btn', onClick: this.handleRetry }, this.props.t('action.retry'))));
        }
        return this.props.children;
      }
    }

    /* ------------------------------------------------------------------ *
     * The page
     * ------------------------------------------------------------------ */
    /** 设置页：按分组渲染 30 项配置（标签/说明由 Host 提供中英文）。 */
    function ConfigView(props) {
      const t = props.t;
      const data = props.data;
      const draft = props.draft;
      const loading = props.loading;
      const saving = props.saving;
      const error = props.error;
      const isZh = t('config.save') === '保存';
      const labelOf = function (pair) {
        if (pair === null || typeof pair !== 'object') return '';
        return isZh ? (pair.zh || pair.en || '') : (pair.en || pair.zh || '');
      };
      const children = [];
      children.push(h('div', { className: 'evo-content-head', key: 'head' },
        h('h2', { className: 'evo-head-title' }, t('config.title')),
        h('button', {
          type: 'button', className: 'evo-btn evo-btn-primary', key: 'save',
          disabled: saving || loading, onClick: props.onSave
        }, saving ? t('config.saving') : t('config.save')),
        h('button', { type: 'button', className: 'evo-btn', key: 'close', onClick: props.onClose }, t('action.close'))));
      children.push(h('div', { className: 'evo-muted', key: 'hint' }, t('config.hint')));
      if (error) children.push(h(ErrorBar, { text: describeError(error, t), key: 'error' }));
      if (loading) {
        children.push(h('div', { className: 'evo-muted', key: 'loading' }, t('config.loading')));
      } else if (!data || data.available !== true) {
        children.push(h('div', { className: 'evo-muted', key: 'unavailable' }, t('config.unavailable')));
      } else {
        const groups = Array.isArray(data.groups) ? data.groups : [];
        const sections = [];
        for (const group of groups) {
          const rows = [];
          const fields = Array.isArray(group.fields) ? group.fields : [];
          for (const field of fields) {
            const name = field.name;
            const value = draft ? draft[name] : null;
            let control;
            if (field.type === 'boolean') {
              control = h('input', {
                type: 'checkbox', checked: value === true,
                onChange: function (event) { props.onChange(name, event.target.checked); }
              });
            } else if (field.type === 'enum' && Array.isArray(field.options)) {
              control = h('select', {
                className: 'evo-input',
                value: value === null || value === undefined ? '' : String(value),
                onChange: function (event) { props.onChange(name, event.target.value); }
              }, field.options.map(function (option) { return h('option', { key: option, value: option }, option); }));
            } else if (field.type === 'number') {
              control = h('input', {
                className: 'evo-input', type: 'number',
                value: value === null || value === undefined ? '' : String(value),
                onChange: function (event) {
                  props.onChange(name, event.target.value === '' ? '' : Number(event.target.value));
                }
              });
            } else {
              control = h('input', {
                className: 'evo-input', type: 'text',
                value: value === null || value === undefined ? '' : String(value),
                onChange: function (event) { props.onChange(name, event.target.value); }
              });
            }
            rows.push(h('div', { className: 'evo-config-row', key: name },
              h('div', { className: 'evo-config-meta' },
                h('span', { className: 'evo-config-label' }, labelOf(field.label)),
                h('span', { className: 'evo-config-name evo-mono' }, name)),
              h('div', { className: 'evo-config-control' }, control),
              field.hint ? h('div', { className: 'evo-config-hint' }, labelOf(field.hint)) : null));
          }
          sections.push(h('section', { className: 'evo-card', key: group.id },
            h('h3', { className: 'evo-config-group' }, labelOf(group.label)),
            h('div', { className: 'evo-config' }, rows)));
        }
        children.push(h('div', { className: 'evo-config', key: 'groups' }, sections));
      }
      return h('div', { className: 'evo-view', key: 'config-view' }, children);
    }

    function EverosPanelInner(props) {
      const t = props.t;
      const subscribeLocale = props.subscribeLocale;

      const [status, setStatus] = useState(null);
      const [statusError, setStatusError] = useState(null);
      const [tree, setTree] = useState(null);
      const [treeError, setTreeError] = useState(null);
      const [treeLoading, setTreeLoading] = useState(true);
      const [busy, setBusy] = useState(null);
      const [query, setQuery] = useState('');
      const [mode, setMode] = useState('everos');
      const [searching, setSearching] = useState(false);
      const [searchResults, setSearchResults] = useState(null);
      const [searchError, setSearchError] = useState(null);
      const [searchNote, setSearchNote] = useState(null);
      const [selectedPath, setSelectedPath] = useState(null);
      const [file, setFile] = useState(null);
      const [fileError, setFileError] = useState(null);
      const [fileLoading, setFileLoading] = useState(false);
      const [targetLine, setTargetLine] = useState(null);
      const [logOpen, setLogOpen] = useState(false);
      const [log, setLog] = useState(null);
      const [logLoading, setLogLoading] = useState(false);
      const [logError, setLogError] = useState(null);
      const [toast, setToast] = useState(null);
      const [confirmKind, setConfirmKind] = useState(null);
      const [configOpen, setConfigOpen] = useState(false);
      const [configData, setConfigData] = useState(null);
      const [configDraft, setConfigDraft] = useState(null);
      const [configLoading, setConfigLoading] = useState(false);
      const [configSaving, setConfigSaving] = useState(false);
      const [configError, setConfigError] = useState(null);
      const [, setLocaleVersion] = useState(0);

      const statusSeq = useRef(0);
      const treeSeq = useRef(0);
      const fileSeq = useRef(0);
      const searchSeq = useRef(0);
      const locateSeq = useRef(0);
      const configPollRef = useRef(0);
      const logSeq = useRef(0);

      /* Re-render copy when the shell language changes. */
      useEffect(function () {
        if (typeof subscribeLocale !== 'function') return undefined;
        const dispose = subscribeLocale(function () {
          setLocaleVersion(function (version) {
            return version + 1;
          });
        });
        return typeof dispose === 'function' ? dispose : undefined;
      }, [subscribeLocale]);

      const requestStatus = useCallback(function () {
        const seq = statusSeq.current + 1;
        statusSeq.current = seq;
        return apiGet('/status').then(function (data) {
          if (statusSeq.current !== seq) return;
          setStatus(data && typeof data === 'object' ? data : null);
          setStatusError(null);
        }, function (error) {
          if (statusSeq.current !== seq) return;
          setStatusError(toPanelError(error));
        });
      }, []);

      const requestTree = useCallback(function () {
        const seq = treeSeq.current + 1;
        treeSeq.current = seq;
        setTreeLoading(true);
        return apiGet('/tree').then(function (data) {
          if (treeSeq.current !== seq) return;
          setTree(data && typeof data === 'object' ? data : null);
          setTreeError(null);
          setTreeLoading(false);
        }, function (error) {
          if (treeSeq.current !== seq) return;
          setTreeError(toPanelError(error));
          setTreeLoading(false);
        });
      }, []);

      /* Status poll: created on mount, cleared on unmount (panel switch). */
      useEffect(function () {
        requestStatus();
        const timer = window.setInterval(requestStatus, 5000);
        return function () {
          window.clearInterval(timer);
        };
      }, [requestStatus]);

      useEffect(function () {
        requestTree();
      }, [requestTree]);

      useEffect(function () {
        if (!toast) return undefined;
        const timer = window.setTimeout(function () {
          setToast(null);
        }, 6000);
        return function () {
          window.clearTimeout(timer);
        };
      }, [toast]);

      const showToast = useCallback(function (kind, text) {
        setToast({ kind: kind, text: text, at: Date.now() });
      }, []);

      const runOperation = useCallback(function (kind) {
        setBusy(kind);
        setToast(null);
        apiPost('/' + kind).then(function (data) {
          const ok = !(data && data.ok === false);
          const message = data && typeof data.message === 'string' && data.message
            ? data.message
            : t(ok ? 'notify.done' : 'notify.failed');
          showToast(ok ? 'success' : 'error', message);
          setBusy(null);
          requestStatus();
        }, function (error) {
          showToast('error', describeError(toPanelError(error), t));
          setBusy(null);
          requestStatus();
        });
      }, [requestStatus, showToast, t]);

      const askStart = useCallback(function () {
        runOperation('start');
      }, [runOperation]);
      const askStop = useCallback(function () {
        setConfirmKind('stop');
      }, []);
      const askRestart = useCallback(function () {
        setConfirmKind('restart');
      }, []);
      const closeConfirm = useCallback(function () {
        setConfirmKind(null);
      }, []);
      const confirmAction = useCallback(function () {
        const kind = confirmKind;
        setConfirmKind(null);
        if (kind) runOperation(kind);
      }, [confirmKind, runOperation]);

      const openFile = useCallback(function (path, line) {
        if (!path) return;
        const seq = fileSeq.current + 1;
        fileSeq.current = seq;
        setLogOpen(false);
        setConfigOpen(false);
        setSelectedPath(path);
        setFile(null);
        setFileError(null);
        setFileLoading(true);
        setTargetLine(typeof line === 'number' ? line : null);
        apiGet('/file?path=' + encodeURIComponent(path)).then(function (data) {
          if (fileSeq.current !== seq) return;
          setFile(data && typeof data === 'object' ? data : null);
          setFileError(null);
          setFileLoading(false);
        }, function (error) {
          if (fileSeq.current !== seq) return;
          setFileError(toPanelError(error));
          setFileLoading(false);
        });
      }, []);

      const closeFile = useCallback(function () {
        fileSeq.current += 1;
        setSelectedPath(null);
        setFile(null);
        setFileError(null);
        setFileLoading(false);
        setTargetLine(null);
      }, []);

      const runSearch = useCallback(function () {
        const keyword = query.trim();
        /* A search always leaves the log/file/config views and shows its results. */
        setLogOpen(false);
        setConfigOpen(false);
        closeFile();
        if (!keyword) {
          searchSeq.current += 1;
          setSearchResults([]);
          setSearchError(null);
          setSearchNote(t('search.emptyQuery'));
          return;
        }
        const seq = searchSeq.current + 1;
        searchSeq.current = seq;
        setSearching(true);
        setSearchError(null);
        setSearchNote(null);
        apiGet('/search?q=' + encodeURIComponent(keyword) + '&mode=' + encodeURIComponent(mode)).then(function (data) {
          if (searchSeq.current !== seq) return;
          const results = data && Array.isArray(data.results) ? data.results : [];
          setSearchResults(results);
          setSearching(false);
          if (data && typeof data.error === 'string' && data.error) setSearchError({ server: data.error });
          else setSearchError(null);
        }, function (error) {
          if (searchSeq.current !== seq) return;
          setSearchResults([]);
          setSearchError(toPanelError(error));
          setSearching(false);
        });
      }, [query, mode, t, closeFile]);

      const openEverosResult = useCallback(function (item) {
        const entryId = item && typeof item.id === 'string' ? item.id.trim() : '';
        const subject = item && typeof item.subject === 'string' ? item.subject.trim() : '';
        const summary = item && typeof item.summary === 'string' ? item.summary.trim() : '';
        const probe = (subject || summary).slice(0, 24);
        const seq = locateSeq.current + 1;
        locateSeq.current = seq;
        setSearchNote(t('search.locating'));

        // 兜底：老办法——拿标题前 24 字回本地做一次子串搜索。
        const locateBySubject = function () {
          if (!probe) {
            setSearchNote(null);
            showToast('error', t('search.locateFailed'));
            return;
          }
          apiGet('/search?q=' + encodeURIComponent(probe) + '&mode=local').then(function (data) {
            if (locateSeq.current !== seq) return;
            const results = data && Array.isArray(data.results) ? data.results : [];
            let hit = null;
            for (let index = 0; index < results.length; index += 1) {
              if (results[index] && typeof results[index].path === 'string') {
                hit = results[index];
                break;
              }
            }
            if (!hit) {
              setSearchNote(null);
              showToast('error', t('search.locateFailed'));
              return;
            }
            setSearchNote(null);
            openFile(hit.path, typeof hit.line === 'number' ? hit.line : null);
          }, function (error) {
            if (locateSeq.current !== seq) return;
            setSearchNote(null);
            showToast('error', describeError(toPanelError(error), t));
          });
        };

        // 首选：用条目 id 精确定位 Markdown 里的 `## <id>`。
        if (!entryId) {
          locateBySubject();
          return;
        }
        apiGet('/locate?id=' + encodeURIComponent(entryId)).then(function (data) {
          if (locateSeq.current !== seq) return;
          if (data && typeof data.path === 'string') {
            setSearchNote(null);
            openFile(data.path, typeof data.line === 'number' ? data.line : null);
            return;
          }
          locateBySubject();
        }, function () {
          if (locateSeq.current !== seq) return;
          locateBySubject();
        });
      }, [openFile, showToast, t]);

      const loadLog = useCallback(function () {
        const seq = logSeq.current + 1;
        logSeq.current = seq;
        setLogLoading(true);
        setLogError(null);
        apiGet('/log?lines=120').then(function (data) {
          if (logSeq.current !== seq) return;
          setLog(data && typeof data === 'object' ? data : null);
          setLogLoading(false);
        }, function (error) {
          if (logSeq.current !== seq) return;
          setLogError(toPanelError(error));
          setLogLoading(false);
        });
      }, []);

      const openLog = useCallback(function () {
        setConfigOpen(false);
        setLogOpen(true);
        loadLog();
      }, [loadLog]);

      const closeLog = useCallback(function () {
        setLogOpen(false);
      }, []);

      const loadConfig = useCallback(function () {
        setConfigLoading(true);
        setConfigError(null);
        apiGet('/config').then(function (data) {
          setConfigData(data && typeof data === 'object' ? data : null);
          const value = data && data.value && typeof data.value === 'object' ? data.value : {};
          setConfigDraft(Object.assign({}, value));
          setConfigLoading(false);
        }, function (error) {
          setConfigError(toPanelError(error));
          setConfigLoading(false);
        });
      }, []);

      const openConfig = useCallback(function () {
        setLogOpen(false);
        closeFile();
        setConfigOpen(true);
        loadConfig();
      }, [closeFile, loadConfig]);

      const closeConfig = useCallback(function () {
        configPollRef.current += 1;
        setConfigOpen(false);
        setConfigError(null);
      }, []);

      const changeConfigField = useCallback(function (name, value) {
        setConfigDraft(function (previous) {
          const next = Object.assign({}, previous);
          next[name] = value;
          return next;
        });
      }, []);

      const saveConfigNow = useCallback(function () {
        const original = configData && configData.value && typeof configData.value === 'object' ? configData.value : {};
        const draft = configDraft && typeof configDraft === 'object' ? configDraft : {};
        const patch = {};
        for (const name of Object.keys(draft)) {
          if (draft[name] !== original[name]) patch[name] = draft[name];
        }
        if (Object.keys(patch).length === 0) {
          showToast('success', t('config.noChange'));
          return;
        }
        setConfigSaving(true);
        setConfigError(null);
        const token = configPollRef.current + 1;
        configPollRef.current = token;
        apiPost('/config', { patch: patch }).then(function (data) {
          setConfigSaving(false);
          const note = data && typeof data.note === 'string' && data.note ? data.note : t('config.saved');
          showToast('success', note);
          // 乐观更新：立刻用刚保存的值刷新界面，不必等回读（此时插件可能还没被 DSH 重载）。
          setConfigData(function (previous) {
            if (!previous || typeof previous !== 'object') return previous;
            return Object.assign({}, previous, { value: Object.assign({}, previous.value || {}, patch) });
          });
          setConfigDraft(function (previous) { return Object.assign({}, previous || {}, patch); });
          requestStatus();
          // 后台轮询确认：等 DSH 重载插件后读到真实值；读到就同步，超时提示重启。
          let attempts = 0;
          const verify = function () {
            if (configPollRef.current !== token) return;
            attempts += 1;
            apiGet('/config').then(function (next) {
              if (configPollRef.current !== token) return;
              const value = next && next.value && typeof next.value === 'object' ? next.value : null;
              if (value !== null) {
                const matches = Object.keys(patch).every(function (name) { return value[name] === patch[name]; });
                if (matches) {
                  configPollRef.current += 1;
                  setConfigData(next);
                  setConfigDraft(Object.assign({}, value));
                  return;
                }
              }
              if (attempts >= 10) {
                configPollRef.current += 1;
                showToast('error', t('config.pendingReload'));
                return;
              }
              setTimeout(verify, 800);
            }, function () {
              if (configPollRef.current !== token) return;
              if (attempts >= 10) {
                configPollRef.current += 1;
                showToast('error', t('config.pendingReload'));
                return;
              }
              setTimeout(verify, 800);
            });
          };
          setTimeout(verify, 800);
        }, function (error) {
          setConfigSaving(false);
          setConfigError(toPanelError(error));
        });
      }, [configData, configDraft, requestStatus, showToast, t]);

      const toolbar = h('div', { className: 'evo-toolbar' },
        h('input', {
          className: 'evo-input', type: 'search', value: query, key: 'input',
          placeholder: t('search.placeholder'), 'aria-label': t('search.placeholder'),
          onChange: function (event) {
            setQuery(event.target.value);
          },
          onKeyDown: function (event) {
            if (event.key === 'Enter') {
              event.preventDefault();
              runSearch();
            }
          }
        }),
        h('div', { className: 'evo-seg', role: 'group', 'aria-label': t('search.mode.label'), key: 'mode' },
          h('button', {
            type: 'button', key: 'everos',
            className: 'evo-seg-btn' + (mode === 'everos' ? ' is-active' : ''),
            'aria-pressed': mode === 'everos',
            onClick: function () {
              setMode('everos');
            }
          }, t('search.mode.everos')),
          h('button', {
            type: 'button', key: 'local',
            className: 'evo-seg-btn' + (mode === 'local' ? ' is-active' : ''),
            'aria-pressed': mode === 'local',
            onClick: function () {
              setMode('local');
            }
          }, t('search.mode.local'))),
        h('button', {
          type: 'button', className: 'evo-btn evo-btn-primary', key: 'go',
          disabled: searching, onClick: runSearch
        }, searching ? t('search.searching') : t('search.button')));

      let content;
      if (configOpen) {
        content = h(ConfigView, {
          key: 'config', data: configData, draft: configDraft, loading: configLoading,
          saving: configSaving, error: configError, t: t,
          onChange: changeConfigField, onSave: saveConfigNow, onClose: closeConfig
        });
      } else if (logOpen) {
        content = h(LogView, {
          key: 'log', log: log, loading: logLoading, error: logError, t: t,
          timeFormat: readTimeFormat(status),
          onRefresh: loadLog, onClose: closeLog
        });
      } else if (selectedPath) {
        content = h(FileView, {
          key: 'file', file: file, path: selectedPath, loading: fileLoading, error: fileError,
          targetLine: targetLine, t: t, onClose: closeFile
        });
      } else {
        content = h(SearchResults, {
          key: 'results', results: searchResults, error: searchError, note: searchNote,
          searching: searching, t: t, onOpenLocal: openFile, onOpenEveros: openEverosResult
        });
      }

      return h('div', { className: 'evo-root', 'data-dsh-everos-panel-view': '' },
        h('div', { className: 'evo-layout' },
          h('aside', { className: 'evo-side', key: 'side' },
            h(StatusCard, {
              key: 'status', status: status, busy: busy, error: statusError, t: t,
              onStart: askStart, onStop: askStop, onRestart: askRestart
            }),
            h(StatsCard, {
              key: 'stats', status: status, tree: tree, error: treeError, t: t,
              onOpenLog: openLog, onOpenConfig: openConfig
            }),
            h('section', { className: 'evo-card evo-card-tree', key: 'tree', 'aria-label': t('tree.title') },
              h('h2', { className: 'evo-card-title' }, t('tree.title')),
              treeError ? h(ErrorBar, { text: describeError(treeError, t), key: 'tree-error' }) : null,
              treeLoading && !tree
                ? h('div', { className: 'evo-muted' }, t('tree.loading'))
                : h(MemoryTree, { tree: tree, selectedPath: selectedPath, onOpen: openFile, t: t }))),
          h('section', { className: 'evo-main', key: 'main' }, toolbar, content)),
        h(Toast, { toast: toast }),
        h(ConfirmDialog, {
          kind: confirmKind, t: t, onCancel: closeConfirm, onConfirm: confirmAction
        }));
    }

    function EverosPanelPage(props) {
      const t = typeof props.t === 'function' ? props.t : function fallbackTranslate(key) {
        return key;
      };
      const pageProps = Object.assign({}, props, { t: t, subscribeLocale: props.subscribeLocale });
      return h(PanelBoundary, { t: t }, h(EverosPanelInner, pageProps));
    }

    /** Sidebar glyph: the shell owns the row, this draws only the memory glyph. */
    function PanelIcon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 16;
      const strokeWidth = props.active ? 1.5 : 1.3;
      return h('svg', {
        'data-dsh-panel-entry': PANEL_ID,
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: strokeWidth,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true'
      },
        h('ellipse', { cx: 8, cy: 4.1, rx: 4.6, ry: 1.9, key: 'top' }),
        h('path', { d: 'M3.4 4.1v3.4c0 1.05 2.06 1.9 4.6 1.9s4.6-.85 4.6-1.9V4.1', key: 'mid' }),
        h('path', { d: 'M3.4 7.5v3.4c0 1.05 2.06 1.9 4.6 1.9s4.6-.85 4.6-1.9V7.5', key: 'low' }));
    }

    /* ------------------------------------------------------------------ *
     * Locale + style seats
     * ------------------------------------------------------------------ */
    function createTranslator(ctx) {
      return function translate(key, params) {
        let text = key;
        try {
          const bound = ctx.locale.bind(NS);
          const value = bound(key, params);
          if (typeof value === 'string' && value) text = value;
        } catch (error) {
          text = key;
        }
        if (params && typeof params === 'object' && text.indexOf('{') !== -1) {
          const names = Object.keys(params);
          for (let index = 0; index < names.length; index += 1) {
            const name = names[index];
            text = text.split('{' + name + '}').join(String(params[name]));
          }
        }
        return text;
      };
    }

    function createLocaleSubscriber(ctx) {
      return function subscribeLocale(listener) {
        try {
          const dispose = ctx.locale.subscribe(listener);
          return typeof dispose === 'function' ? dispose : noop;
        } catch (error) {
          return noop;
        }
      };
    }

    /** Idempotent single-tag CSS injection; the returned disposer removes it. */
    function installStyles() {
      if (typeof document === 'undefined' || !document.head) return noop;
      const selector = 'style[data-plugin-css="' + STYLE_CSS_ID + '"]';
      if (document.querySelector(selector) !== null) return noop;
      const tag = document.createElement('style');
      tag.setAttribute('data-plugin', PLUGIN_ID);
      tag.setAttribute('data-plugin-css', STYLE_CSS_ID);
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return function disposeStyles() {
        try {
          if (tag.parentNode) tag.parentNode.removeChild(tag);
        } catch (error) {
          /* already detached */
        }
      };
    }

    function apply(ctx) {
      const translate = createTranslator(ctx);
      const subscribeLocale = createLocaleSubscriber(ctx);

      ctx.effect(installStyles, 'everos-panel: panel styles');

      ctx.effect(function () {
        try {
          const dispose = ctx.locale.register(NS, { zh: zh, en: en });
          return function releaseDictionaries() {
            try {
              if (typeof dispose === 'function') dispose();
            } catch (error) {
              /* already released */
            }
          };
        } catch (error) {
          return noop;
        }
      }, 'everos-panel: dictionaries');

      ctx.effect(function () {
        try {
          const dispose = ctx.slots.inject('sidebar.panellist', function () {
            try {
              return ctx.slots.register({
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: PANEL_ORDER,
                label: function () {
                  return translate('entry.label');
                }
              }, PanelIcon);
            } catch (error) {
              return noop;
            }
          });
          return typeof dispose === 'function' ? dispose : noop;
        } catch (error) {
          return noop;
        }
      }, 'everos-panel: sidebar entry');

      ctx.effect(function () {
        const face = { t: translate, subscribeLocale: subscribeLocale };
        try {
          const dispose = ctx.slots.inject('main', function () {
            try {
              return ctx.slots.register({
                name: 'main',
                key: PANEL_ID,
                inject: function () {
                  return face;
                }
              }, EverosPanelPage);
            } catch (error) {
              return noop;
            }
          });
          return typeof dispose === 'function' ? dispose : noop;
        } catch (error) {
          return noop;
        }
      }, 'everos-panel: main page');
    }

    return { inject: ['slots', 'locale'], apply: apply };
  }
});
