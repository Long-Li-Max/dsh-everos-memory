# @lorenzo__li/dsh-everos-memory

面向 DeepSeek Harness 的 EverOS 记忆集成插件。

本插件将 EverOS 记忆引擎、服务生命周期管理与可视化面板整合为一个 DSH 插件：对话内容可按策略自动提炼为长期记忆，并在后续对话中按相关度回忆；使用者可在 DSH 侧栏面板中查看服务状态、浏览记忆文件、检索记忆条目、查看服务日志，并直接调整全部配置项。

- 当前版本：`1.0.0`
- 插件包名：`@lorenzo__li/dsh-everos-memory`（显示名：EverOS 记忆）
- 加载器行：单 row，`id: everos`
- 运行平台：Windows（服务启停能力仅 Windows 可用，详见「已知限制」）

> 本插件为社区项目，基于 `@everos-ai/dsh-plugin` 二次开发，与 EverMind / EverOS 官方无关。

## 目录

1. [系统组成](#系统组成)
2. [环境要求](#环境要求)
3. [安装与升级](#安装与升级)
4. [配置](#配置)
5. [面板功能](#面板功能)
6. [架构与生命周期](#架构与生命周期)
7. [安全边界](#安全边界)
8. [故障排查](#故障排查)
9. [许可证与第三方代码](#许可证与第三方代码)
10. [已知限制](#已知限制)
11. [目录结构](#目录结构)
12. [开发与测试](#开发与测试)

## 系统组成

EverOS 由两个相互独立的部分组成，二者均需正确安装后记忆功能才可用：

| 组成 | 形态 | 职责 |
|---|---|---|
| **EverOS 服务** | 独立 Python 程序（FastAPI/uvicorn），默认监听 `127.0.0.1:8000` | 记忆的写入、提炼、索引与检索；数据以 Markdown 为正本，索引可重建 |
| **本插件** | DSH 插件（一个 bundle，一条 loader row） | 内置记忆客户端（回忆/记录钩子）、服务管家（启停/自愈/日志）、管理面板（UI 与同源只读接口） |

本插件**不包含** EverOS 服务本体，也不在仓库中分发其虚拟环境；安装脚本会从官方 PyPI 安装服务。

## 环境要求

| 项目 | 要求 |
|---|---|
| DeepSeek Harness | 0.2.x（开发与验证版本） |
| 操作系统 | Windows 10/11（服务启停）；其他系统仅面板浏览、搜索与日志可用 |
| Python | 3.10 及以上（仅用于安装 EverOS 服务） |
| EverOS 服务 | 1.4.x（通过 `pip install everos` 安装） |
| 模型服务 | 一个 OpenAI 协议兼容的对话模型 API Key（供服务端提炼记忆），例如 DeepSeek |

## 安装与升级

### 第一步：安装 EverOS 服务

Windows 下在仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-everos.ps1
```

脚本将依次完成：

1. 校验 Python 版本（3.10+）；
2. 在服务根目录（默认 `%ProgramData%\everos`，可用 `-Root` 或 `EVEROS_DIR` 指定）创建虚拟环境；
3. 从官方 PyPI 安装 `everos`；
4. 若服务根目录下不存在 `everos.toml`，从 `docs/everos.toml.example` 复制一份配置模板；
5. 输出需要填入面板设置的 `everosDir`、`startCommand`、`panelLogPath` 三项值。

可选参数：`-DryRun`（只打印计划，不修改任何内容）、`-SkipInstall`（跳过 pip 安装）、`-Root`、`-VenvPath`、`-Python`。

安装完成后，编辑服务根目录下的 `everos.toml`，将 `[llm] api_key` 替换为自己的 Key；也可通过环境变量 `EVEROS_LLM__API_KEY` 提供。其他操作系统可手动执行 `pip install everos` 并按官方文档准备配置。

### 第二步：安装插件

**方式一（推荐，正式发布版）**：从 npm 安装。依赖（`@deepseek-ai/schemastery`、`@deepseek-ai/cosmokit`）会由包管理器自动安装：

```sh
dsh plugin --profile <profile> add @lorenzo__li/dsh-everos-memory
```

也可在 DSH 插件页面按包名安装。

**方式二（开发调试）**：将本仓库目录作为插件安装（“从目录安装”，或以 `install_bundle` 指向本目录）。此方式建立目录链接，因此：

- 安装目录不可移动或改名，否则插件失效；
- 安装前需在插件目录执行一次 `npm install`，以安装依赖；
- 修改本插件代码后必须重启 DSH 才能加载新的 Host 代码。

### 第三步：配置并启动

打开 DSH 侧栏「EverOS 记忆」面板 → 「设置」，填入第一步输出的 `everosDir`、`startCommand`、`panelLogPath`，并按需开启 `autoStart`；保存后点击「启动」。

首次启动为冷启动，通常需要 30–70 秒；状态变为运行中后记忆功能开始工作。未完成配置时，面板会显示配置引导，启动与重启按钮为禁用状态。

## 配置

全部配置集中为一份表单，共 **31 项**：记忆引擎 24 项（与官方插件字段一致）+ 面板与服务 7 项。有两种修改方式，二者等价：

1. **面板内修改（推荐）**：「设置」页按分组展示字段，含中文标签与说明，保存后写入 DSH profile 并尽量热生效；
2. **直接编辑 profile**：在 `cordis.patch.yml` 中按 row id `everos` 覆盖。

面板字段如下：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `panelTimeFormat` | `local` | 日志与时间的显示格式：`local`（本地日期时间）、`local-short`（仅时分秒）、`iso`（本地 ISO 带时区）、`utc`（原始 UTC） |
| `panelLogPath` | 空（未配置） | 管家启动的实例写日志到此路径 |
| `panelEverosExe` | 空 | 覆盖启动命令中的可执行文件；留空时取 `startCommand` 的第一个参数 |
| `panelRequestTimeoutMs` | `20000` | 面板请求超时 |
| `panelStartTimeoutMs` | `180000` | 启动后等待健康检查的最长时间 |
| `panelAutoRestart` | `true` | 服务异常退出后是否自动拉起 |
| `panelRespectManualStop` | `true` | 面板手动停止后是否不再自动拉起 |

记忆字段（24 项）中，最常调整的是：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:8000` | 服务地址，同时决定面板与管家使用的端口 |
| `everosDir` | 由 `EVEROS_DIR` 或 `%ProgramData%\everos` 推导 | 记忆根目录（服务 `--root`） |
| `startCommand` | 空 | 面板「启动」按钮与管家执行的命令 |
| `appId` | `dsh` | 记忆分区 |
| `autoStart` | `false` | DSH 启动时是否自动拉起服务 |
| `recallTopK` | `5` | 每条记忆轨最多取回条目数 |
| `recallMaxChars` | `12000` | 注入记忆的最大字符数 |
| `recallTimeoutMs` | `5000` | 单次回忆超时；冷启动环境下建议调高至 15000 以上 |
| `flushMessageThreshold` | `50` | 累计消息数达到该值即提交记忆 |
| `flushIdleMs` | `30000` | 空闲达到该时长即提交记忆 |

profile 覆盖示例（路径需替换为实际值）：

```yaml
- id: everos
  name: "@lorenzo__li/dsh-everos-memory"
  config:
    baseUrl: http://127.0.0.1:8000
    everosDir: 'C:\everos'
    startCommand: 'C:\everos\venv\Scripts\everos.exe server start --root C:\everos'
    autoStart: true
    recallTopK: 3
    panelLogPath: 'C:\everos\logs\everos-server.log'
```

注意：loader 的配置覆盖为**整体替换**，覆盖时需写出全部要使用的字段，未写字段回落到 schema 默认值。

此外支持以下环境变量，用于提供默认值：

| 变量 | 作用 |
|---|---|
| `EVEROS_DIR` | 默认服务根目录 |
| `EVEROS_EXE` | 默认可执行文件路径 |
| `EVEROS_DEBUG_LOG` | 诊断日志路径；设为空字符串则关闭文件日志 |

## 面板功能

| 区域 | 功能 |
|---|---|
| 状态卡 | 运行状态、服务版本、PID、已运行时长、模型能力标记，以及启动/停止/重启操作 |
| 统计卡 | 搜索与写入调用次数、记忆文件数、数据总量、最后写入时间、服务日志入口 |
| 记忆树 | 工作区 → 记忆类型（对话纪要、原子事实、Agent 案例、用户画像、Agent 技能）→ 文件 |
| 阅读区 | 记忆文件的轻量 Markdown 渲染，支持按行定位 |
| 搜索 | `EverOS 排序`（调用服务，带相关度）与 `原文匹配`（直接扫描 Markdown，服务未运行时可用）；排序结果优先按条目 id 精确定位原文 |
| 服务日志 | 服务日志尾部 120 行；由管家启动的实例日志必定落盘；时间显示格式可配置 |
| 设置 | 31 项配置的分组表单，保存后写入 profile 并尽量热生效 |

面板数据来源遵循「读双通道、写走服务」原则：浏览、原文与离线搜索直接读取 Markdown；相关度搜索、状态与写入经由 EverOS 服务。

## 架构与生命周期

单个 loader row 内包含三部分：

1. **记忆客户端**（内置引擎）：在 `agent/pre-step` 阶段回忆、在 `agent/turn-stopping` 阶段记录；
2. **服务管家**（`lib/service-manager.js`）：服务进程的唯一拥有者，负责启动、停止、重启、周期自愈与日志落盘；
3. **管理面板**：Host 侧同源 JSON 路由（`/api/everos-panel/*`）与浏览器侧整页 UI。

关键语义：

- 面板所需的服务地址、命令与目录**全部由记忆配置派生**，不重复配置；
- 面板对 `webServer` 为**可选依赖**：无网页载体的 profile 中记忆照常工作；
- 记忆客户端在每轮操作前先向管家询问服务可用性；服务不可用时**快速跳过**，不阻塞对话；
- 记忆客户端不再启动或停止服务进程，生命周期完全由管家负责；
- `autoStart` 仅控制 DSH 启动时的自动拉起；设置 `autoStart: false` 后，手动启动的服务在崩溃后仍会按 `panelAutoRestart` 自愈；
- 面板手动停止后，若 `panelRespectManualStop` 为真，管家不再自动拉起，直至手动启动；该“手动停止”状态仅在本次 DSH 运行内有效；
- 停止服务前会先校验端口上响应的是否为 EverOS，避免误杀其他程序。

## 安全边界

- 记忆为只读浏览：本插件不提供写入或删除记忆的接口，也不读取 `everos.toml` 中的 API Key；
- 文件访问仅限 `memoryRoot` 范围内，越界路径一律拒绝；
- 面板 HTTP 接口仅接受**回环地址 + 同源**请求；经 `remote-web-ui` 从手机访问时面板接口返回 403；
- 仓库与插件包中不含任何 API Key、记忆数据或日志文件；`everos.toml` 由使用者自行提供。

## 故障排查

| 现象 | 处理方式 |
|---|---|
| 面板显示“未配置”且启动按钮不可点 | 运行 `scripts\setup-everos.ps1`，或按「配置」一节的说明填写 `everosDir` 与 `startCommand` |
| 启动超时或一直不通过健康检查 | 冷启动可能需要 30–70 秒；查看「服务日志」确认是否缺少 API Key 或端口被占用 |
| 端口被占用 | 修改 `baseUrl` 端口（同时需修改服务 `everos.toml` 中的 `[api] port`） |
| 设置保存后界面未更新 | 写入 profile 后 DSH 通常会自动重载；若未生效，重启 DSH |
| 对话中未出现记忆回忆 | 确认服务状态为运行中；检查诊断日志（`EVEROS_DEBUG_LOG`）中是否出现 `skip recall: service not usable` |
| 面板接口返回 403 | 仅允许本机回环同源访问，远程访问请使用 DSH 自身的远程访问方式 |

## 许可证与第三方代码

- 本插件自身代码：MIT，见仓库根 `LICENSE`；
- `vendor/everos-memory/`：来自 `@everos-ai/dsh-plugin@0.1.0`（Apache-2.0），保留原始 LICENSE 与版权声明；为适配 DSH 0.2 与统一管家，含若干本地修改，明细见 `vendor/README.md`；
- 运行时依赖 `@deepseek-ai/schemastery` 与 `@deepseek-ai/cosmokit`（均 MIT）在 `package.json` 的 `dependencies` 中声明，安装时自动获取；
- EverOS 服务的著作权归其作者所有；本插件的名称与文档不代表 EverOS 官方立场。

## 已知限制

- **平台**：服务启停依赖 Windows 的 `netstat` 与 `taskkill`，仅在 Windows 可用；其他系统上启动/停止/自愈会返回明确的“不支持”提示，浏览、搜索与日志不受影响；
- **DSH 版本耦合**：基于 DSH 0.2.x 的会话接口与 v4 消息格式开发，DSH 升级后需重新验证；
- 服务日志仅覆盖由本插件管家启动的实例；若服务由外部程序启动，面板会提示日志可能没有新内容；
- `autoStart` 默认关闭，以避免未配置的机器在每次启动时尝试失败；
- npm 包已发布，版本号与 `dsh.engines.dsh` 兼容范围由 `package.json` 声明；DSH 升级后若超出范围，插件更新检查会提示。

## 目录结构

```
index.js                  # 插件入口：记忆 + 管家 + 面板（单一份 Config）
lib/everos.js             # 面板数据服务：状态、目录树、文件、搜索、按 id 定位、日志
lib/service-manager.js    # 服务管家：启动、停止、重启、自愈、日志、手动停止策略
lib/settings.js           # 设置读写：DSH settings 服务优先，profile 文件兜底
lib/settings-fields.js    # 31 项配置的字段定义（分组、中英文标签、类型、说明）
client.js                 # 浏览器侧：侧栏入口与整页界面
vendor/everos-memory/     # 内置 EverOS 记忆引擎（Apache-2.0，含本地补丁）
scripts/setup-everos.ps1  # EverOS 服务安装脚本（Windows）
docs/everos.toml.example  # 服务配置示例
cordis.patch.yml          # 单 row 定义（id: everos），仅含可移植默认值
locale/                   # 插件列表显示信息（zh/en）
icon.svg                  # 插件图标
LICENSE                   # MIT
.gitignore                # 排除 node_modules、日志、服务配置等
```

## 开发与测试

修改代码后建议依次执行：

```powershell
npm install
node --check index.js
node --check client.js
node --check lib/everos.js
node --check lib/service-manager.js
node --check lib/settings.js

node ..\everos-settings-test.mjs
node ..\everos-service-manager-test.mjs
node ..\everos-panel-merged-test.mjs
```

测试覆盖：设置读写与字段校验、管家状态机（幂等启动、手动停止、自愈、卸载、未配置与非 Windows 分支）、面板路由与鉴权 fence、按条目 id 定位。

插件修改生效需重启 DSH；仅修改 `client.js` 时刷新页面即可。
