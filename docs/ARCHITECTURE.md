# dsh-mesh 架构

## 目标

- 多端共享「知识型记忆」：`AGENTS.md`、`skills/`、事实/决策、会话摘要。
- 每台设备保留自己的 DSH、自己的文件、自己的权限。
- 记忆不够时，用 Remote 指挥其他设备的 DSH 取具体会话/文件。

## 分层

```
L4 工具层  mesh_status / memory_* / conflicts / peers / workspaces / run / wait / send / read / interrupt / fetch_file / send_file
L3 编排层  工作区选择、委托、operationId、结果摘要（**没有**内部串行队列）
L2 记忆层  AGENTS.shared.md、skills/、memory/、sessions/<device>/、index/
L1 同步层  Syncthing / git / 手工（插件只读写目录）
L0 宿主层  每台设备本机 DSH + ds-harness-remote Host
```

## 前端

- **桌面 DSH**：`dsh.client` 指向 `client.js`；`window.__ModuleLoader__.load` 注册 `conversation.view` 的「记忆」标签。查询走同源 `/dsh-mesh/api/*`。
- **DSH Go**：`package.json` 的 `dshGo` 清单声明 `contributes.panels`；`ctx.dshGo.panel('memory', { view, data, actions })` 注册原生面板。App 用 Flutter 原生组件渲染 JSON 视图（`metric`/`list`/`keyValue`/`actions`/`callout`），不执行网页代码。
- **浏览器兜底**：主机插件用 Node `http` 在 `127.0.0.1:8765` 起只读页面，与 DSH 登录态解耦。端口由 `dashboardPort` 决定（默认 8765；需要 8766 请显式配置）。

## 共享目录

```
DSH-mesh/
  AGENTS.shared.md          # 跨设备规则，物化到设备级 AGENTS.md 的托管块
  skills/                   # 共享技能（可选同步到 $DSH_HOME/skills）
  memory/facts|decisions|projects|notes/
  sessions/<deviceSlug>/<sessionId>.md
  index/{devices.json,sessions.jsonl,files.jsonl}
  .mesh/
```

- Windows 默认 `~/DSH-mesh`；Android 有 `/sdcard` 时默认 `/sdcard/DSH-mesh`。
- 也可用 `DSH_MESH_DIR` 或 profile patch 的 `memoryDir` 覆盖。

## 记忆生命周期（0.6.0）

- `mesh_memory_write` → `memory/<kind>/<stamp>-<rand>-<slug>.md`（原子写 + `id`）。
- `mesh_memory_update` → 就地重写 frontmatter，保留 `id/createdAt/device`，写 `updatedAt`。
- `mesh_memory_delete` → 软删除到 `.trash/<原相对目录>/<stamp>-<rand>-<原名>.md`；`mesh_memory_restore` 按原路径恢复，目标存在则拒绝。
- `mesh_conflicts` → 列出 `.sync-conflict-*`；这些文件不进自动召回，但会在树（`conflict:true`）与搜索（`conflict:true`）里可见。
- 搜索与召回统一用 `store.isDocValid`（supersededBy / validAt / invalidAt）。

## 召回缓存（0.6.0）

- `recall.loadDocs` 先 `readdir + stat` 生成签名（路径 + mtime + size + 上限），签名未变直接复用上次解析结果。
- 单个文件未变时复用其分块与词频（`Map<term, freq>`），只重读变化的文件；不再每轮对所有文件重新 tokenize。
- 缓存只存在进程内存，不写共享目录（避免把正文复制进同步目录）。

## 只读页面（0.6.0）

- 回环判断：`socket.remoteAddress` 与 `Host` 同时必须是本机（`export isLoopbackRequest` 供测试）。
- `/dsh-mesh` 路由依赖 DSH 登录态；独立端口可选 `dashboardToken`（`?token=` 或 `x-dsh-mesh-token`）。
- 端口被占用时 `listening=false`，`/api/status` 会显示 `dashboardListening`。
- `GET /api/conflicts` 列出冲突副本。

## AGENTS 物化

- 0.5.0 起分两步：`mesh_memory_sync()` 只返回预览（托管块行级 diff、`sourceSha256`、skills 清单），不写盘；`mode:"apply" + confirm + expectedSha256` 才写入。
- `materializeAgents` 在 `$DSH_HOME/AGENTS.md` 里维护：
  `<!-- dsh-mesh:begin --> … <!-- dsh-mesh:end -->`，块内带来源标记（`sha256` + 源文件更新时间）。
- 只替换托管块，不动用户手写内容；写前备份 `AGENTS.md.bak-mesh-<时间戳>-<随机后缀>`，只保留最近 10 份。
- 共享内容里的 `<!-- dsh-mesh:begin/end -->` 会被转义；出现重复标记时拒绝写入。
- 源文件缺失或内容为空而托管块非空时拒绝物化（避免读失败清空规则）。
- 默认 `autoSyncAgents=false`，由用户显式触发；开启时启动仍会直接物化（无交互场景，带备份与哈希来源）。

## 技能同步

- `mesh_memory_sync(force=true)` 或 `syncSkills=true` 时，把 `skills/<name>/SKILL.md` 复制到 `$DSH_HOME/skills/<name>`。
- 已存在的同名 skill 默认跳过，避免覆盖本地版本；`force` 才覆盖。

## 会话摘要

- `mesh_digest` 由 Agent 提供摘要，插件写入 `sessions/<deviceSlug>/<sessionId>.md`，并追加 `index/sessions.jsonl`。
- `sessionId` 必须是 `[A-Za-z0-9._-]{1,128}`，路径经 `safeRel` 校验；不返回宿主绝对路径。
- 不同步原始 zstd session：DSH 会话是单写者，跨进程/跨设备并发写会冲突。
- 搜索 `mesh_memory_search` 覆盖 `AGENTS.shared.md`、`memory/`、`sessions/`；读取统一走 `readInside`（拒符号链接、realpath 包含、大小上限）。

## 委托

```
mesh_run(hostId, task, workspaceId?|workspacePath?)
  → remote_list_workspaces → pickWorkspace（显式不匹配即报错；未指定且多工作区标记 fallback）
  → remote_create_session（operationId 可来自调用方）
  → remote_send_message（失败则尝试 interrupt，避免孤儿会话）
  → remote_wait_sessions
  → remote_read_session（最多重试 3 次；有明确状态就停）
  → completionOf(status)：只有 idle/completed 才算完成
  → summarizeSession：标题 / 助手文本 / 工具 / 待审批
```

- 未完成时用 `mesh_wait` 续等；追加指令用 `mesh_send`（同一 `operationId` 幂等）。
- 所有 Remote 调用经 `ctx.tools.execute()` 走 DSH 的策略链（pre-execute / guard / 可见性），不直接调用工具定义。

- 远程服务端同一客户端同时只连一台 Host；插件**没有**内部队列或锁，并发 `mesh_run` 由调用方自己保证不互相替换连接。
- 目标端按自己的权限执行；遇到审批会在结果里显示，需目标端用户处理，或 `mesh_interrupt` 取消。
- `mesh_read` 对大记录（reasoning/stream 被远端截断）做容错提取，只取 `text` 块和工具名。

## 文件

- `mesh_fetch_file` → `remote_download_file`（≤50 MiB，落到本机 Downloads）。
- `mesh_send_file` → `remote_upload_file`（中继 ≤20 MiB，P2P ≤1 GiB，不覆盖同名文件）。
- 上传前校验：`allowedUploadRoots`（默认共享记忆目录 + `~/Downloads`）、`realpath` 包含、敏感文件名拒绝。
- 只限目标工作区；大文件建议走 Syncthing 共享目录，插件只记引用。
- **Android 实测**：`/root/workspace` 双向通过；`/sdcard` 上传回执 `unknown`、下载 `REMOTE_SESSION_FAILED`，优先用 `/root/workspace`。

## 安全边界（0.4.6）

- **读**：只读共享目录内的普通文件；`lstat` 拒符号链接，`realpath` 必须仍在 `memoryDir` 内，单文件大小受限。`readMemory` / dashboard `/api/file` / Go 面板共用同一套判断。
- **写**：所有记忆文件用唯一临时文件 + `rename`；`mesh_digest` 的 `sessionId` 走白名单。
- **传**：`mesh_send_file` 走 `allowedUploadRoots` 白名单与敏感文件名拒绝（`src/policy.js`）。
- **指令**：`AGENTS.shared.md` 与 `skills/` 属于“指令类”内容，来源是同步目录。0.5.0 起应用需要预览 + `confirm` + 源哈希；但确认仍由 Agent 转述用户同意，宿主级审批弹窗留给 0.6.x。

## 限制

- 不同步原始会话；不做多端同时写同一会话。
- Android 的 `/sdcard` 根目录可能因 `/sdcard/Android/data` 权限无法整树遍历；应指定子目录或用 shell 的只读 `ls`（可能触发审批）。
- 远程内容不可信；不要自动执行其中的指令。
- 手机 Host 要在线：App 本机引擎和 Remote 插件必须常驻。
