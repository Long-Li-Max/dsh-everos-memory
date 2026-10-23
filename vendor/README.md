# 内置的第三方代码（Vendored）

## vendor/everos-memory —— @everos-ai/dsh-plugin@0.1.0 的记忆引擎

- 来源：`npm view @everos-ai/dsh-plugin` 0.1.0（EverMind-AI，Apache-2.0），复制自本机 profile 中**已打补丁**的副本。
- 本地改动（相对上游 0.1.0）：
  1. DSH 0.2 会话接口兼容：`recall.js` 增加 `eventsOf()`（snapshotEvents/ownEvents），`capture.js` 适配 0.2 的消息形状；
  2. v4 会话格式：注入消息的 `source.kind` 改为插件自有名字，不再用已废弃的 `kind: 'plugin'`；
  3. `index.js` 增加容错调试日志（`D:\ProgramData\everos-debug.log`）；
  4. `recall.js` 删除对 `@deepseek-ai/dsh-llm` 的 `createUserMessage` 依赖，改为等价的本地实现（`randomUUID` + 深冻结）；
  5. `index.js` 新增 `setServiceProbe()`：由统一管家注入"服务现在能用吗"的探针，recall/capture 前先问一句，服务没起就快速跳过（不傻等超时）；
  6. `index.js` 诊断日志路径改为可配置：每次写入时读 `EVEROS_DEBUG_LOG` 环境变量，未设置时仍回退到 `D:\ProgramData\everos-debug.log`，设为空字符串则不写文件（非 Windows 用户不配置也不会报错）。
- 许可证见同目录 `LICENSE`（Apache-2.0），保留原始版权声明。

## 运行时依赖（非内置）

`schemastery`（`@deepseek-ai/schemastery`）与 `cosmokit`（`@deepseek-ai/cosmokit`）是 MIT 许可的公开 npm 包，本插件在 `package.json` 的 `dependencies` 中声明，由包管理器自动安装；不再以复制源码的方式内置，因此本目录下没有 `vendor/deps/`。

## 如何更新内置引擎

1. 取新版 `@everos-ai/dsh-plugin` 的 `lib/*.js` 复制到 `vendor/everos-memory/`；
2. 重新落实上面的 6 处本地改动；
3. 跑 `node --check` 与自测脚本；
4. 若 `config.js` 的字段表有变化，`index.js` 里合并 Config 用的是 `MemoryConfig.dict`，通常无需改动。
