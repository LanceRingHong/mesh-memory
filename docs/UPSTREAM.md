# 上游组件与许可证

`dsh-mesh` 自己只包含 MIT 代码；它站在这些上游项目之上。这里说明每个组件的作用、是否必需、许可证和边界。

## 总览

| 组件 | 作用 | 必需 | 许可证 | 链接 |
|---|---|---|---|---|
| DeepSeek Harness（DSH） | 插件宿主、会话、工具、Web UI | 是 | 见仓库 | https://github.com/deepseek-ai/deepseek-harness |
| Node.js | 插件运行时 | 是 | MIT 类 | https://nodejs.org/ |
| ds-harness-remote | DSH Remote 主机插件/中继通道 | 可选（跨设备委托） | MIT | https://github.com/liguobao/ds-harness-remote |
| Syncthing | 多设备目录同步 | 可选（跨设备记忆） | MPL-2.0 | https://syncthing.net/ |
| DSH Go | Android 原生界面/本机引擎 | 可选（Go 原生页） | AGPL-3.0 | https://github.com/ccch1mneyyy/dsh-go |
| DSH Go 原生记忆页 PR | 原生记忆页/顶栏入口 | 可选 | 跟随 DSH Go | https://github.com/ccch1mneyyy/dsh-Go/pull/168 |

版本是 2026-10-31 实测；上游升级后以各自文档为准。

## 1. DeepSeek Harness（DSH）

- 本插件是 DSH 的 Cordis 插件，使用：
  - `ctx.inject(['tools'])` 注册工具；
  - `ctx.on('system-prompt/assemble')` 做自动召回；
  - `dsh.client` / `window.__ModuleLoader__.load` 做桌面客户端；
  - `ctx.webServer` 挂 `/dsh-mesh`；
  - `dshGo` 服务做 Go 原生面板。
- DSH 本体的安装、账号、模型、权限由 DSH 管；本插件不修改 DSH 源码。
- 实测 `0.2.1-rc.5`；需要支持 `system-prompt/assemble` 和 `dsh.client`。

## 2. ds-harness-remote

- 提供 Remote Host 能力：`remote_list_hosts`、`remote_list_workspaces`、创建/发送/读取/中断会话、文件上传下载。
- 只有 `mesh_run` / `mesh_read` / `mesh_interrupt` / 文件传输需要；本机记忆、召回、UI 不需要。
- 走第三方中继/控制面，账号与元数据由该服务处理；隐私边界请自行评估。
- MIT；仓库：https://github.com/liguobao/ds-harness-remote

## 3. Syncthing

- 只做目录同步，不理解 Markdown、不解析记忆。
- 只有“多设备共享同一份记忆”才需要；单机不需要。
- MPL-2.0；官网：https://syncthing.net/
- 详细配置见 [`SYNCTHING.md`](SYNCTHING.md)。

## 4. DSH Go

- Android 上的 DSH 客户端/本机引擎；本插件在 Go 上有：
  - `dshGo` 原生面板；
  - `composer.strip`「记忆」胶囊；
  - `ui.json` 的 `conversation.view` page island；
  - 原生记忆页（配套 PR #168）。
- DSH Go 自身是 AGPL-3.0，与本仓库 MIT 独立；本仓库不包含 DSH Go 代码。
- 原生页 PR：https://github.com/ccch1mneyyy/dsh-Go/pull/168

## 5. 边界与合规

- 本仓库不 vendor 上述项目源码。
- 安装/使用上游组件时，请同时遵守其许可证与隐私政策。
- DSH Remote 的账号、中继、元数据不在本插件控制范围内。
- Syncthing 的发现/中继服务器可关闭或自建。
- 记忆是明文 Markdown；敏感内容请自行加密/脱敏。

## 6. 上游链接汇总

- DSH：https://github.com/deepseek-ai/deepseek-harness
- DSH Remote：https://github.com/liguobao/ds-harness-remote
- Syncthing：https://syncthing.net/
- DSH Go：https://github.com/ccch1mneyyy/dsh-go
- DSH Go 原生记忆页 PR：https://github.com/ccch1mneyyy/dsh-Go/pull/168
- Node.js：https://nodejs.org/
