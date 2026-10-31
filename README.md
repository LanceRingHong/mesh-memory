# dsh-mesh

> 跨设备共享记忆 + DSH 委托，给 DeepSeek Harness 装上“不会失忆的第二大脑”。

![version](https://img.shields.io/badge/version-0.9.0-blue)
![license](https://img.shields.io/github/license/LanceRingHong/dsh-mesh)
![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.x-8a2be2)
![Node](https://img.shields.io/badge/Node-%E2%89%A518-3c873a)

- 每条记忆都是本地 Markdown 文件，不用数据库、不藏格式。
- 多设备用 **Syncthing** 同步目录，不把记忆交给第三方云。
- 通过 **DSH Remote** 委托另一台设备建会话、执行任务、读结果、传文件。
- 桌面有侧栏/顶栏入口，DSH Go 有原生记忆页。

> 当前版本 `0.9.0`（图形化记忆中心：待确认 / 记忆 / 备份），MIT。DSH Go 原生记忆页的配套 PR：
> [dsh-go #168](https://github.com/ccch1mneyyy/dsh-Go/pull/168)（Ready for review）。

---

## 目录

- [它解决什么问题](#它解决什么问题)
- [功能](#功能)
- [架构](#架构)
- [依赖与上游](#依赖与上游)
- [兼容性](#兼容性)
- [安装](#安装)
- [配置](#配置)
- [快速开始](#快速开始)
- [记忆格式](#记忆格式)
- [自动召回](#自动召回)
- [工具与 API](#工具与-api)
- [界面](#界面)
- [Syncthing：跨设备记忆](#syncthing跨设备记忆)
- [安全与边界](#安全与边界)
- [故障排查](#故障排查)
- [卸载](#卸载)
- [开发与贡献](#开发与贡献)
- [License 与致谢](#license-与致谢)

---

## 它解决什么问题

DSH 默认每个会话都是新的。`dsh-mesh` 把“该记住的事”写成 Markdown 卡片，放在所有设备都能读的目录里；在模型开口前，插件按当前问题挑出相关卡片注入上下文。它还能把任务交给另一台设备上的 DSH，适合“家里 PC 算力强、平板随身”的场景。

**不是**：

- 不是数据库/向量库，不藏二进制。
- 不同步原始 zstd 会话（单写者，会冲突）。
- 不做任意文件外传：`mesh_send_file` 只允许配置目录内的文件（默认共享记忆目录 + `Downloads`），并拒绝密钥/凭据类文件。
- 不替 DSH Remote 做账号或中继。

## 功能

| 功能 | 说明 |
|---|---|
| 共享记忆 | `AGENTS.shared.md`、`skills/`、`memory/`、`sessions/` 全部是文件 |
| 自动召回 | 每轮 BM25 检索，注入 `<dsh-mesh-memory>`；带预算和去重 |
| 记忆 schema | `description`、`memoryType`、`tags`、`aliases`、`baseline`、`validAt`、`invalidAt`、`supersededBy` |
| 记忆生命周期 | `mesh_memory_update`、软删除到 `.trash/`、恢复；冲突副本用 `mesh_conflicts` 列出 |
| 自动记录 | 会话事件 → 本机收件箱草稿（机械摘要，不调模型）；确认后转正式记忆 |
| 自动备份 | 共享目录快照到本机 git（`$DSH_HOME/dsh-mesh-backups.git`，不进同步目录） |
| 跨设备委托 | `mesh_run` / `mesh_wait` / `mesh_send` / `mesh_read` / `mesh_interrupt` / `mesh_peers` / `mesh_workspaces` |
| 文件传输 | `mesh_send_file` / `mesh_fetch_file`（受 Remote 工作区与大小限制） |
| 桌面 UI | 三段式：待确认（接受/忽略）、记忆（新建/编辑/删除）、备份（快照/恢复）；侧栏底部、对话顶部、对话「记忆」标签三个入口 |
| Go UI | 原生记忆页（companion PR）；`dshGo` 面板；`conversation.view` page island |
| 浏览器 | `http://127.0.0.1:8765/` 只读页（仅回环） |

## 架构

```
DSH 插件宿主
  └─ dsh-mesh
       ├─ index.js            组合根：tools / skills / dashboard / native / recall
       ├─ client.js           桌面 Web 客户端（树、Markdown、侧栏/顶栏入口）
       ├─ src/tools.js        mesh_* 工具
       ├─ src/store.js        目录、frontmatter、树、搜索、manifest
       ├─ src/recall.js       system-prompt/assemble 自动召回
       ├─ src/agents.js       AGENTS 托管块、skills 同步
       ├─ src/dashboard.js    只读 HTTP 页面/API
       ├─ src/native.js       dshGo 原生面板
       ├─ src/remote.js       remote_* 包装
       └─ src/config.js       配置

共享目录（可被 Syncthing 同步）
  ├─ AGENTS.shared.md
  ├─ skills/mesh-memory/SKILL.md
  ├─ memory/{facts,decisions,projects,notes}/
  ├─ sessions/<device>/<sessionId>.md
  ├─ index/{devices.json,sessions.jsonl,files.jsonl}
  └─ .mesh/（本地碎片；skills 清单已移到 $DSH_HOME/dsh-mesh-skills.json，避免把本机路径同步出去）
```

跨设备时：

```
PC DSH ──dsh-mesh──┐
                   ├── Syncthing folder ── 共享 Markdown
平板 DSH ──dsh-mesh─┘

PC DSH ──ds-harness-remote Host ◀── DSH Remote ──▶ 平板 DSH
```

## 依赖与上游

| 组件 | 作用 | 是否必需 | 说明 |
|---|---|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | 插件宿主/会话/工具 | 必需 | 本项目是 DSH 插件，不修改 DSH 本体 |
| Node.js ≥ 18 | 插件运行时 | 必需 | DSH 自带 Node 也行 |
| [ds-harness-remote](https://github.com/liguobao/ds-harness-remote) | DSH Remote 主机插件/中继 | 可选 | 只有“跨设备委托/读会话/传文件”才需要；第三方，MIT |
| [Syncthing](https://syncthing.net/) | 多设备目录同步 | 可选 | 只有“跨设备共享记忆”才需要；MPL-2.0 |
| [DSH Go](https://github.com/ccch1mneyyy/dsh-go) | Android 原生界面 | 可选 | 原生记忆页见配套 PR #168；DSH Go 自身 AGPL-3.0，与本插件 MIT 独立 |
| 浏览器 | 只读记忆页 | 可选 | 只访问 `127.0.0.1:8765` |

> 本仓库只包含 `dsh-mesh` 自己的 MIT 代码；不包含 DSH、DSH Go、DSH Remote、Syncthing 的源码。上游组件的许可证、安装方式、账号与隐私边界由各自项目负责。

更详细的上游说明见 [`docs/UPSTREAM.md`](docs/UPSTREAM.md)。

## 兼容性

| 项目 | 版本 |
|---|---|
| DSH 核心 | 实测 `0.2.1-rc.5`；需要支持 `system-prompt/assemble` 与 `dsh.client` |
| Node.js | ≥ 18 |
| 桌面 | Windows（实测）、macOS/Linux（按 DSH 支持） |
| 移动 | DSH Go 本机引擎/Android 实测 |
| Syncthing | 任意 2.x |
| DSH Remote | 实测 `ds-harness-remote` 0.6.x |

## 安装

本插件目前**不在 npm/插件市场发布**；从本仓库安装。

```powershell
git clone https://github.com/LanceRingHong/dsh-mesh.git
cd dsh-mesh
pwsh -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

默认安装到存在的 `desktop` 和 `web` profile；只装桌面：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Profiles desktop
```

脚本会：

1. 复制插件到 `<profile>/node_modules/dsh-mesh`；
2. 备份 profile `package.json`；
3. 把 `dsh-mesh` 加进 `dsh.profile.bundles`；
4. 向 `cordis.patch.yml` 追加注释，触发热加载。

> 桌面版 `desktop` profile 被 Electron 独占时，用桌面版自带 CLI/安装方式；CLI 操作 `web` profile。

### Android / 本机 Go

把仓库打成 `.tgz`，在目标设备解压到：

```
/root/.dsh/profiles/web/node_modules/dsh-mesh
```

把 `dsh-mesh` 加进该 profile 的 `dsh.profile.bundles`，再追加 `cordis.patch.yml` 注释触发热加载。引擎代码改动需要重启引擎；客户端 UI 需要重开 App/刷新页面。

### 安装后检查

```text
mesh_status
```

应返回 `device`、`memoryDir`、`counts`、`remoteTools`、`dashboardUrl`。

## 配置

在 profile 的 `cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-mesh
      name: dsh-mesh
      config:
        memoryDir: ''
        deviceName: ''
        autoSyncAgents: true
        syncSkills: true
        autoRecall: true
        dashboardPort: 8765
        # 可选：允许 mesh_send_file 上传的本机目录（留空 = 共享记忆目录 + ~/Downloads）
        allowedUploadRoots:
          - D:\dsh-mesh\artifacts
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `memoryDir` | Windows `~/DSH-mesh`；Android 有 `/sdcard` 时 `/sdcard/DSH-mesh` | 共享目录 |
| `deviceName` | 主机名 | 设备显示名，也用于 `sessions/<device>/` |
| `autoSyncAgents` | `false` | 启动时把 `AGENTS.shared.md` 写进设备级 AGENTS 托管块 |
| `syncSkills` | `false` | 启动时复制共享 skills |
| `autoRecall` | `true` | 每轮自动检索并注入记忆 |
| `dashboardPort` | `8765` | 独立只读页面端口，仅 127.0.0.1 |
| `maxFileBytes` | `200000` | 单个记忆文件的读取上限 |
| `maxRecallFiles` | `1000` | 召回候选文件上限，按修改时间倒序取 |
| `maxRecallFileBytes` | `1000000` | 参与召回的单个文件大小上限 |
| `recallMinScore` | `0` | 召回的最低 BM25 绝对分（0 = 只用相对门槛与词项特异性） |
| `recallMaxChars` | `6000` | 每轮注入召回文本的字符预算 |
| `allowedUploadRoots` | `[]` → 共享记忆目录 + `~/Downloads` | 允许 `mesh_send_file` 上传的本机目录 |
| `dashboardToken` | `''` | 独立只读页面的访问 token；留空不校验（仍只绑定 127.0.0.1） |
| `maxSkillBytes` | `2000000` | 单个共享 skill 目录的大小上限；超限或含符号链接时拒绝同步 |
| `captureEnabled` | `true` | 自动把完成的会话写成收件箱草稿（本机，不同步） |
| `captureIdleMinutes` | `5` | 会话空闲多久后生成草稿 |
| `captureMinTurns` | `2` | 至少多少轮才记录（压缩过的长会话按消息条数兜底） |
| `backupEnabled` | `true` | 把共享记忆目录快照到本机 git |
| `backupDebounceSeconds` | `60` | 写入后合并成一个快照的等待时间 |
| `backupIntervalMinutes` | `360` | 定时快照间隔；`0` 关闭 |

多设备时每台设备用不同 `deviceName`，避免摘要目录混在一起。

## 快速开始

```text
记住：我的项目 X 使用 pnpm，测试命令是 pnpm test。
```

Agent 会调用 `mesh_memory_write`，写进 `memory/facts/`。之后：

```text
上次项目 X 的测试命令是什么？
```

插件自动召回相关记忆；没有命中时 Agent 也可以主动：

```text
mesh_memory_search("项目 X 测试")
mesh_memory_read("memory/facts/....md")
```

会话结束：

```text
mesh_digest(sessionId, title, summary)
```

写入 `sessions/<device>/<sessionId>.md`。

## 记忆格式

```yaml
---
title: "项目 X 的测试命令"
kind: facts
memoryType: project
description: "项目 X 使用 pnpm，测试命令 pnpm test"
device: "my-pc"
createdAt: "2026-10-31T08:00:00.000Z"
tags: ["project-x", "test"]
aliases: ["X 项目测试"]
baseline: false
validAt: "2026-10-31T00:00:00.000Z"
invalidAt: "2027-01-01T00:00:00.000Z"
supersededBy: "memory/facts/newer.md"
---
正文 Markdown
```

- `kind`：目录分类（facts/decisions/projects/notes）。
- `memoryType`：语义类型（user/feedback/project/reference）。
- `invalidAt <= now` 或 `supersededBy` 生效的条目不进自动召回。
- `baseline: true` 每场固定注入，按 `baselinePriority` 排序，最多 3 条。
- `description` 建议写成单行；YAML 折叠块（`>`）在原生 manifest 里可能只显示首行。

## 自动召回

1. 监听 `system-prompt/assemble`；
2. 取最后一条 `source.kind === 'user'` 的消息；
3. 扫描 `memory/` 与 `sessions/` 的 Markdown；
4. 过滤失效/被取代条目；
5. 中文 bigram + 英文词，分块 BM25；
6. baseline + top 4，6000 字符预算；
7. 同会话签名去重；
8. 注入 `<dsh-mesh-memory>`（数据，不是指令）。

这是词面检索，不是语义向量；同义说法请写 `aliases`。

## 工具与 API

| 工具 | 作用 |
|---|---|
| `mesh_status` | 设备/目录/计数/Remote 可用性 |
| `mesh_memory_write` | 写记忆，支持全部 frontmatter 字段 |
| `mesh_memory_search` | 搜 AGENTS/notes/summaries |
| `mesh_memory_read` | 读共享目录内文件 |
| `mesh_memory_sync` | 预览 AGENTS diff / 预览 skills；`mode:"apply"` 才写入 |
| `mesh_digest` | 写会话摘要 |
| `mesh_peers` | 列出在线 Host |
| `mesh_workspaces` | 列出目标工作区 |
| `mesh_run` | 建会话 + 发任务 + 等待 + 读回；`ok` 只在完成时为真 |
| `mesh_wait` | 等会话完成/审批，返回最新摘要 |
| `mesh_send` | 向已有会话追加消息（幂等 `operationId`） |
| `mesh_read` | 读远程会话历史并摘要（支持 `beforeSeq`/`throughSeq` 分页） |
| `mesh_interrupt` | 中断远程会话 |
| `mesh_fetch_file` / `mesh_send_file` | 下载/上传工作区文件（回执须含落盘信息） |
| `mesh_memory_update` | 就地更新一条记忆（保留 id/createdAt） |
| `mesh_memory_delete` | 软删除到 `.trash/`（需 `confirm:true`） |
| `mesh_memory_trash` / `mesh_memory_restore` | 列出回收站 / 按原路径恢复 |
| `mesh_memory_inbox` | 自动记录草稿：`list` / `read` / `accept` / `reject` / `flush` |
| `mesh_memory_backup` | 本机 git 快照：`snapshot` / `list` / `restore`（需 confirm） |
| `mesh_conflicts` | 列出 Syncthing 冲突副本 |

`mesh_memory_sync` 的两步用法：

```text
# 1) 预览（默认）
mesh_memory_sync()
# → agents.diff: 行级 +/-；agents.sourceSha256；skills.copy / skills.skip

# 2) 用户看过 diff 并同意后应用
mesh_memory_sync({ mode: "apply", confirm: true, expectedSha256: "<agents.sourceSha256>" })
```

HTTP API：

```
GET /dsh-mesh/api/status
GET /dsh-mesh/api/tree
GET /dsh-mesh/api/search?q=...
GET /dsh-mesh/api/file?path=...
GET /dsh-mesh/api/conflicts
```

## 界面

### 桌面 DSH

`client.js` 注册：

- `conversation.view`「记忆」标签：三段式界面（待确认 / 记忆 / 备份）
- `sidebar.footer.action`：左侧栏底部「记忆」
- `conversation.session.header.utilities`：对话顶部「记忆」

界面操作：待确认里可直接「接受 / 忽略 / 立即整理」；记忆里可「新建 / 编辑 / 删除」；备份里可「立即快照 / 恢复」。

### DSH Go

- `dshGo` 原生面板（全部文件列表 + 复制正文）
- `composer.strip`「记忆」胶囊
- `ui.json` 的 `conversation.view` page island
- 原生只读记忆页：见 companion PR #168（通过 `workspaceFiles/read` 读 `$DSH_HOME/dsh-go/dsh-mesh.json`，不依赖 bridge）

### 浏览器

```
http://127.0.0.1:8765/
```

只绑定回环；独立页面不依赖 DSH 登录，完整树入口在桌面/Go 客户端。

## Syncthing：跨设备记忆

**Syncthing 不是插件运行必需；没有它，每台设备只用自己的记忆目录。** 要让 PC/平板共享 facts、AGENTS、sessions，才需要它。

### 最小步骤

1. 两台设备安装 Syncthing（PC 可用 portable/服务，Android 用 App）。
2. 互相添加设备 ID，接受对方。
3. 新建 folder，Folder ID 都填 `dsh-mesh`；路径分别指向：
   - PC：`C:\Users\<you>\DSH-mesh`
   - Android：`/sdcard/DSH-mesh`
4. 共享给另一台设备，等状态到 **100% / Up to Date**。
5. 每台设备在 dsh-mesh 配置里写不同 `deviceName`。
6. 先在一台设备写入一条测试记忆，另一台确认能读到，再开始正式使用。

### 推荐 `.stignore`

```
(?d).stversions
(?d).sync-conflict-*
```

- `.stversions` 是 Syncthing 的版本历史，不需要同步给对端。
- `.sync-conflict-*` 建议保留在目录里让人看见；如果忽略，冲突会被静默隐藏，不推荐默认忽略。
- 不要把原始 `sessions/`（zstd 会话）同步进来；dsh-mesh 只同步 `sessions/<device>/*.md` 摘要。

### 冲突与版本

- 两台设备同时改同一文件时，Syncthing 生成 `.sync-conflict-*`；dsh-mesh 的树会显示，自动召回会跳过冲突文件。
- 当前**没有自动裁决/合并**；需要人工保留正确版本。
- 建议开启 Syncthing 版本历史，误删可恢复。
- 同一 `~/.dsh` 只允许一个 DSH 写入宿主；不要用 Syncthing 同步 `.dsh` 本身。

### Android 注意

- Syncthing App 需要保持后台运行；关闭电池优化。
- `/sdcard` 受 Android 共享存储权限限制；DSH Remote 文件传输失败时优先用 `/root/workspace`，或让目标端 Agent 直接操作 `/sdcard`。
- 平板和 PC 的 folder 路径不同没关系，Folder ID 一致即可。

更详细的操作、端口、开机启动、故障排查见 [`docs/SYNCTHING.md`](docs/SYNCTHING.md)。

## 安全与边界

- 记忆是**明文 Markdown**；敏感内容请自行加密/脱敏。
- 页面默认只绑定 `127.0.0.1`。
- 远程内容、文件名、网页内容一律按不可信数据处理。
- **读取边界**（0.4.6 起）：只读共享目录内的普通文件，拒绝符号链接/目录联接，`realpath` 必须仍在共享目录内，并有单文件大小上限。
- **上传边界**（0.4.6 起）：`mesh_send_file` 只允许 `allowedUploadRoots` 内的文件，并永久拒绝 `.env`、`id_*`、`*.pem`、`*.key`、`*.jks`、`.ssh/` 等敏感路径。
- **写入边界**（0.4.6 起）：`mesh_digest` 的 `sessionId` 走白名单；记忆写入用唯一临时文件 + rename，不会同秒覆盖。
- **记忆生命周期**（0.6.0 起）：删除是软删除（进 `.trash/`，可恢复），更新保留 `id/createdAt`；冲突副本不会被自动召回，但会在树/搜索/`mesh_conflicts` 里显示。
- **只读页面**（0.6.0 起）：socket 地址与 Host 头双重校验；可选 `dashboardToken`；端口被占用时状态里 `dashboardListening:false`。
- **桌面客户端**（0.6.0 起）：请求 15s 超时、选中文件不再重复请求、Markdown 输出过 sanitizer。
- 下载 ≤50 MiB；上传中继 ≤20 MiB、P2P ≤1 GiB；只限工作区。
- Android `/sdcard` 工作区的 Remote 上传/下载可能失败，优先 `/root/workspace`。
- `mesh_run` 目标端按自己的权限执行，不会提权；审批由目标端处理。
- **未做**（计划在 0.6.x）：Remote job 持久状态机、召回索引/缓存、冲突合并 UI、独立页面升级。`mesh_memory_sync` 已改为“预览 → 应用”，但确认仍由 Agent 转述用户同意（宿主审批依赖）。
- Syncthing 的发现/中继服务器、DSH Remote 的账号/中继属于第三方边界，请按自己的隐私要求配置。

## 故障排查

| 现象 | 先检查 |
|---|---|
| `mesh_status` 报错 | profile 是否加进 `dsh.profile.bundles`；`memoryDir` 是否存在 |
| 记忆页空白 | `mesh_memory_write` 是否写过；`/dsh-mesh/api/tree` 是否有数据 |
| 自动召回不生效 | `autoRecall` 是否 true；DSH 是否支持 `system-prompt/assemble` |
| 另一台设备看不到新记忆 | Syncthing 是否 100%；folder 路径是否写对；是否有 `.sync-conflict-*` |
| Go 顶栏没有「记忆」 | 是否装了带原生页的测试 APK；host `ui.json` 是否有 `page:"memory"` action |
| `mesh_run` 失败 | DSH Remote 是否登录；目标 Host 是否在线；工作区是否存在 |
| `/sdcard` 传文件失败 | 改用 `/root/workspace`，或让目标端 Agent 操作 |
| `mesh_send_file` 报“不在允许上传的目录” | 把目录加进 `allowedUploadRoots`，或先把文件复制到 `~/Downloads` |
| 召回里出现“候选已截断” | 记忆文件超过 `maxRecallFiles`（默认 1000，按 mtime 倒序）；提高上限或归档旧条目 |

更多见 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)。

## 卸载

```powershell
# 从 profile 的 package.json 移除 dsh-mesh 依赖/bundle 后：
Remove-Item <profile>\node_modules\dsh-mesh -Recurse -Force
```

- 共享记忆目录**不会**被删除；需要时手动备份/删除。
- 设备级 `AGENTS.md` 里的 `dsh-mesh` 托管块可以用 `mesh_memory_sync` 之前先备份，或手动删除标记之间内容。
- Syncthing folder 独立于插件；卸载插件不会删除同步目录。

## 开发与贡献

```powershell
npm run check                        # node --check 全部源文件
npm test                             # node:test（store / recall / policy）
pwsh -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Profiles desktop
pwsh -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Rollback   # 回到上一个备份
```

- 架构：[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Syncthing 详细指南：[`docs/SYNCTHING.md`](docs/SYNCTHING.md)
- 上游/许可证：[`docs/UPSTREAM.md`](docs/UPSTREAM.md)
- 变更记录：[`CHANGELOG.md`](CHANGELOG.md)
- 贡献指南：[`CONTRIBUTING.md`](CONTRIBUTING.md)

欢迎 Issue/PR；涉及上游 DSH Go 的改动请同时看 [PR #168](https://github.com/ccch1mneyyy/dsh-Go/pull/168)。

## License 与致谢

- 本仓库：MIT，见 [`LICENSE`](LICENSE)。
- DSH：按其仓库许可证。
- DSH Remote：第三方 MIT。
- Syncthing：MPL-2.0。
- DSH Go：AGPL-3.0（独立项目；本仓库不包含其代码）。

感谢 DSH、DSH Remote、Syncthing、DSH Go 的维护者与社区。


