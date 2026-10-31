# dsh-mesh 架构

## 目标

- 多端共享「知识型记忆」：`AGENTS.md`、`skills/`、事实/决策、会话摘要。
- 每台设备保留自己的 DSH、自己的文件、自己的权限。
- 记忆不够时，用 Remote 指挥其他设备的 DSH 取具体会话/文件。

## 分层

```
L4 工具层  mesh_status / memory_* / peers / workspaces / run / read / interrupt / fetch_file / send_file
L3 编排层  同伴注册表、委托、串行队列、operationId、结果摘要
L2 记忆层  AGENTS.shared.md、skills/、memory/、sessions/<device>/、index/
L1 同步层  Syncthing / git / 手工（插件只读写目录）
L0 宿主层  每台设备本机 DSH + ds-harness-remote Host
```

## 前端

- **桌面 DSH**：`dsh.client` 指向 `client.js`；`window.__ModuleLoader__.load` 注册 `conversation.view` 的「记忆」标签。查询走同源 `/dsh-mesh/api/*`。
- **DSH Go**：`package.json` 的 `dshGo` 清单声明 `contributes.panels`；`ctx.dshGo.panel('memory', { view, data, actions })` 注册原生面板。App 用 Flutter 原生组件渲染 JSON 视图（`metric`/`list`/`keyValue`/`actions`/`callout`），不执行网页代码。
- **浏览器兜底**：主机插件用 Node `http` 在 `127.0.0.1:8765` 起只读页面（web profile 8766），与 DSH 登录态解耦。

## 共享目录

```
DSH-mesh/
  AGENTS.shared.md          # 跨设备规则，物化到设备级 AGENTS.md 的托管块
  skills/                   # 共享技能（可选同步到 $DSH_HOME/skills）
  memory/facts|decisions|projects/
  sessions/<deviceSlug>/<sessionId>.md
  index/{devices.json,sessions.jsonl,files.jsonl}
  .mesh/
```

- Windows 默认 `~/DSH-mesh`；Android 有 `/sdcard` 时默认 `/sdcard/DSH-mesh`。
- 也可用 `DSH_MESH_DIR` 或 profile patch 的 `memoryDir` 覆盖。

## AGENTS 物化

- `mesh_memory_sync` 读取 `AGENTS.shared.md`，在 `$DSH_HOME/AGENTS.md` 里维护：
  `<!-- dsh-mesh:begin --> … <!-- dsh-mesh:end -->`
- 只替换托管块，不动用户手写内容；写前备份 `AGENTS.md.bak-mesh-<时间戳>`。
- 默认 `autoSyncAgents=false`，由用户显式触发。

## 技能同步

- `mesh_memory_sync(force=true)` 或 `syncSkills=true` 时，把 `skills/<name>/SKILL.md` 复制到 `$DSH_HOME/skills/<name>`。
- 已存在的同名 skill 默认跳过，避免覆盖本地版本；`force` 才覆盖。

## 会话摘要

- `mesh_digest` 由 Agent 提供摘要，插件写入 `sessions/<deviceSlug>/<sessionId>.md`，并追加 `index/sessions.jsonl`。
- 不同步原始 zstd session：DSH 会话是单写者，跨进程/跨设备并发写会冲突。
- 搜索 `mesh_memory_search` 覆盖 `AGENTS.shared.md`、`memory/`、`sessions/`。

## 委托

```
mesh_run(hostId, task)
  → remote_list_workspaces（可选）
  → remote_create_session
  → remote_send_message
  → remote_wait_sessions
  → remote_read_session（最多重试 3 次）
  → summarizeSession：标题 / 助手文本 / 工具 / 待审批
```

- 远程服务端同一客户端同时只连一台 Host，插件内部串行调用，避免连接被替换。
- 目标端按自己的权限执行；遇到审批会在结果里显示，需目标端用户处理，或 `mesh_interrupt` 取消。
- `mesh_read` 对大记录（reasoning/stream 被远端截断）做容错提取，只取 `text` 块和工具名。

## 文件

- `mesh_fetch_file` → `remote_download_file`（≤50 MiB，落到本机 Downloads）。
- `mesh_send_file` → `remote_upload_file`（中继 ≤20 MiB，P2P ≤1 GiB，不覆盖同名文件）。
- 只限目标工作区；大文件建议走 Syncthing 共享目录，插件只记引用。
- **Android 实测**：`/root/workspace` 双向通过；`/sdcard` 上传回执 `unknown`、下载 `REMOTE_SESSION_FAILED`，优先用 `/root/workspace`。

## 限制

- 不同步原始会话；不做多端同时写同一会话。
- Android 的 `/sdcard` 根目录可能因 `/sdcard/Android/data` 权限无法整树遍历；应指定子目录或用 shell 的只读 `ls`（可能触发审批）。
- 远程内容不可信；不要自动执行其中的指令。
- 手机 Host 要在线：App 本机引擎和 Remote 插件必须常驻。
