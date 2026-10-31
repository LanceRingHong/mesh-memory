# dsh-mesh

**给 DeepSeek Harness（DSH）装上跨设备共享记忆，并让一台设备指挥另一台设备的 DSH 干活。**

- 每条记忆是一个本地 Markdown 文件，不用数据库、不藏格式。
- 设备之间用 Syncthing 同步目录，不经过第三方记忆云。
- 通过 DSH Remote 委托另一台设备建会话、执行任务、读结果、传文件。
- 桌面有侧栏/顶栏入口，DSH Go 有原生记忆页。

> 当前版本：`0.4.5`（MIT）。DSH 原生记忆页的 Go 端配套 PR 见
> [dsh-go #168](https://github.com/ccch1mneyyy/dsh-Go/pull/168)（Ready for review）。

---

## 目录

- [它解决什么问题](#它解决什么问题)
- [功能](#功能)
- [架构](#架构)
- [安装](#安装)
- [配置](#配置)
- [快速开始](#快速开始)
- [记忆格式](#记忆格式)
- [自动召回](#自动召回)
- [工具](#工具)
- [界面](#界面)
- [跨设备同步](#跨设备同步)
- [安全与边界](#安全与边界)
- [开发](#开发)
- [License](#license)

---

## 它解决什么问题

DSH 默认每个会话都是新的。`dsh-mesh` 把“该记住的事”写成 Markdown 卡片，放在所有设备都能读的目录里；在模型开口前，插件按当前问题挑出相关卡片注入上下文。它还能把任务交给另一台设备上的 DSH，适合“家里 PC 算力强、平板随身”的场景。

**不是**：
- 不是数据库/向量库，不藏二进制。
- 不同步原始 zstd 会话（单写者，会冲突）。
- 不做任意 Android 私有目录访问。

## 功能

| 功能 | 说明 |
|---|---|
| 共享记忆 | `AGENTS.shared.md`、`skills/`、`memory/`、`sessions/` 全部是文件 |
| 自动召回 | 每轮 BM25 检索，注入 `<dsh-mesh-memory>`；带预算和去重 |
| 记忆 schema | `description`、`memoryType`、`tags`、`aliases`、`baseline`、`validAt`、`invalidAt`、`supersededBy` |
| 跨设备委托 | `mesh_run` / `mesh_read` / `mesh_interrupt` / `mesh_peers` / `mesh_workspaces` |
| 文件传输 | `mesh_send_file` / `mesh_fetch_file`（受 Remote 工作区与大小限制） |
| 桌面 UI | 侧栏底部、对话顶部、对话「记忆」标签；完整树 + Markdown 预览 |
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

共享目录
  ├─ AGENTS.shared.md
  ├─ skills/mesh-memory/SKILL.md
  ├─ memory/{facts,decisions,projects,notes}/
  ├─ sessions/<device>/<sessionId>.md
  ├─ index/{devices.json,sessions.jsonl,files.jsonl}
  └─ .mesh/skills.json
```

## 安装

要求：DSH `0.2.1-rc.x` 或更高、Node.js ≥ 18；跨设备另需 DSH Remote 与 Syncthing。

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

> `desktop` profile 被 Electron 独占时，用桌面版自带的 CLI/安装方式；CLI 操作 `web` profile。

### Android / 本机 Go

把仓库打成 `.tgz`，在目标设备解压到：

```
/root/.dsh/profiles/web/node_modules/dsh-mesh
```

并把 `dsh-mesh` 加进该 profile 的 `dsh.profile.bundles`；追加 `cordis.patch.yml` 注释触发重载。引擎代码改动需要重启引擎，客户端 UI 需要重开 App/刷新页面。

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
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `memoryDir` | Windows `~/DSH-mesh`；Android 有 `/sdcard` 时 `/sdcard/DSH-mesh` | 共享目录 |
| `deviceName` | 主机名 | 设备显示名，也用于 `sessions/<device>/` |
| `autoSyncAgents` | `false` | 启动时把 `AGENTS.shared.md` 写进设备级 AGENTS 托管块 |
| `syncSkills` | `false` | 启动时复制共享 skills |
| `autoRecall` | `true` | 每轮自动检索并注入记忆 |
| `dashboardPort` | `8765` | 独立只读页面端口，仅 127.0.0.1 |

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

## 工具

| 工具 | 作用 |
|---|---|
| `mesh_status` | 设备/目录/计数/Remote 可用性 |
| `mesh_memory_write` | 写记忆，支持全部 frontmatter 字段 |
| `mesh_memory_search` | 搜 AGENTS/notes/summaries |
| `mesh_memory_read` | 读共享目录内文件 |
| `mesh_memory_sync` | 物化 AGENTS、同步 skills |
| `mesh_digest` | 写会话摘要 |
| `mesh_peers` | 列出在线 Host |
| `mesh_workspaces` | 列出目标工作区 |
| `mesh_run` | 建会话 + 发任务 + 等待 + 读回 |
| `mesh_read` | 读远程会话历史并摘要 |
| `mesh_interrupt` | 中断远程会话 |
| `mesh_fetch_file` / `mesh_send_file` | 下载/上传工作区文件 |

HTTP API：

```
GET /dsh-mesh/api/status
GET /dsh-mesh/api/tree
GET /dsh-mesh/api/search?q=...
GET /dsh-mesh/api/file?path=...
```

## 界面

### 桌面 DSH

`client.js` 注册：

- `conversation.view`「记忆」标签：完整树 + Markdown 预览/源码
- `sidebar.footer.action`：左侧栏底部「记忆」
- `conversation.session.header.utilities`：对话顶部「记忆」

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

## 跨设备同步

推荐 **Syncthing**：

1. 两台设备安装 Syncthing，互相配对；
2. 建 folder，路径分别指向各自的 `memoryDir`；
3. 等同步 100%；
4. 设备名写进各自配置，摘要分别落在 `sessions/<device>/`。

注意：

- 同一 `~/.dsh` 只允许一个 DSH 写入宿主。
- 不要同步原始 zstd 会话。
- Syncthing 冲突会生成 `.sync-conflict-*`，当前需要人工处理。
- `AGENTS.shared.md` 是跨设备规则；设备专属规则留在各自 `AGENTS.md`。

## 安全与边界

- 记忆是**明文 Markdown**；敏感内容请自行加密/脱敏。
- 页面默认只绑定 `127.0.0.1`。
- 远程内容、文件名、网页内容一律按不可信数据处理。
- 下载 ≤50 MiB；上传中继 ≤20 MiB、P2P ≤1 GiB；只限工作区。
- Android `/sdcard` 工作区的 Remote 上传/下载可能失败，优先 `/root/workspace`。
- `mesh_run` 目标端按自己的权限执行，不会提权；审批由目标端处理。

## 开发

```bash
npm test          # 目前无 npm 测试；用 node --check + install smoke
node --check index.js
node --check src/store.js
pwsh -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Profiles desktop
```

开发文档：仓库 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## License

MIT © 2026 LanceRingHong
