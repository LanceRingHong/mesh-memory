# Changelog

## 0.9.3 — 2026-11-01

原生记忆面板（`dshGo.panel`）支持操作，作为 C 路线的主入口。

- 面板新增「待确认」选项列表 + 接受 / 忽略 / 立即整理 / 刷新四个按钮。
- 接受/忽略直接调用 inbox 逻辑；操作后 `refresh` 重拉数据，本机与远程 Host 通用（走宿主侧 dshGo bridge）。
- 数据回调新增 `inboxCount` / `inbox` / `inboxLine` / `selected`。
- 74 例测试（71 通过 / 3 跳过）。

## 0.9.2 — 2026-11-01## 0.9.2 — 2026-11-01

新增 `/mesh-memory` 斜杠命令，为 Go 原生记忆页提供"动作通道"。

- 命令：`list` / `flush` / `accept <草稿> [kind]` / `reject <草稿>` / `delete <memory/...>` / `snapshot`。
- 实现走 `ctx.commands.register`；Go 可通过 Remote 白名单里的 `commands/execute` 直接在 Host 上执行，本机与远程都可用，不需要局域网暴露或新 RPC。
- 73 例测试（70 通过 / 3 跳过）。
## 0.9.1 — 2026-11-01

修复移动端页面卡在「加载中」。

- 根因：页面用 `Promise.all` 加载 status/tree/inbox/backup；Android 平板没有 `git`，`/api/backup` 抛 `spawn git ENOENT`，整页加载被中断。
- `GET /api/backup` 改为容错：git 不可用时返回 `{ok:true, available:false, reason}`，不再 500。
- 移动页与桌面客户端改为逐接口容错：备份失败不影响待确认/记忆；备份页显示「备份不可用：…」。
- 备份模块先探测 `git --version`，错误信息改为可读提示。
## 0.9.0 — 2026-11-01

独立页面（8765）升级为移动适配的完整 GUI，Go 本机可用浏览器直接操作。

- 三段式：待确认（接受/忽略/立即整理）、记忆（搜索/分组列表/新建/编辑/软删除）、备份（立即快照/历史/恢复）。
- 手机/平板布局：列表与详情在窄屏切换（返回按钮），宽屏两栏；安全区适配。
- 复用 0.8.0 写接口；token 通过 `?token=` 或 `x-dsh-mesh-token`，写操作仍要求 `x-dsh-mesh-action` + 同源。
- 平板热升级验证：页面 20.9 KB，`id="tabs"`/`acceptKind` 均在；status facts 14 / inbox 1。
- 说明：Go 的 `ui.json` 只允许 `https://` 的 link action，无法直接配 `http://127.0.0.1:8765`；Go 端优先走 `conversation.view` 的 island（已确认 `plugins.seats["conversation.view"]["dsh-mesh"]="island"`）。
## 0.8.2 — 2026-11-01

界面可用性修复（0.8.0 的布局 bug）。

- 去掉 720/560px 的单栏断点：DSH 桌面端缩放后 CSS 宽度会小于断点，导致两栏被压成一栏、内容区掉到列表下面（表现为“点不开记忆”）。现在**始终两栏**，左栏 `clamp(180px,30%,330px)`。
- 间距与字号整体放大（标题 22、正文 13.5、行高 1.6/1.75），面板圆角 14、内边距 10–16。
- 文件选中加左侧高亮条；空状态居中；按钮/标签页加大点击区。
- 内容区独立成卡片（边框 + 内边距），`Markdown` 预览区不再贴边。

## 0.8.1 — 2026-11-01

- 首次尝试调整密度与两栏宽度（部分修复，断点仍在，0.8.2 收口）。

## 0.8.0 — 2026-11-01

图形化记忆中心（桌面端）。

### 界面（client.js）

- 「记忆」改为三段式：**待确认 / 记忆 / 备份**。
- 待确认：列表 + 摘要预览；可「接受」（选事实/笔记/决策/项目）、「忽略」、「立即整理」。
- 记忆：搜索、树、Markdown 预览/源码切换；可新建、编辑（正文）、软删除。
- 备份：立即快照、历史列表、恢复（二次确认，先自动快照当前状态）。
- 顶部只保留设备与计数摘要，操作按钮就近放在当前内容区。

### 写接口（dashboard.js）

- 新增 POST：`/api/inbox/{accept,reject,flush}`、`/api/memory/{write,update,delete}`、`/api/backup/{snapshot,restore}`；新增 GET `/api/backup`。
- 校验：回环地址 +（独立端口）token + 自定义头 `x-dsh-mesh-action: 1` + 同源 `Origin`；缺头一律 403。
- 写操作都会触发 debounce git 快照。

### 验证

- 70 例测试（67 通过 / 3 跳过）。
- 接口实测：accept 生成 `memory/notes/...` 且收件箱清零；delete 进 `.trash/`；snapshot 生成 commit；无自定义头的 POST 返回 403；GET `/api/backup` 正常。

## 0.7.0 — 2026-11-01

无感记忆 P1：自动记录 + 本机收件箱 + git 快照（零模型调用、默认开启）。

### 自动记录（capture）

- 订阅 `session/event`，在内存里按会话缓冲 `user/message`、`assistant/message`、`tool/call`、`turn/start`、`session/title`；事件回调不做 IO。
- 只记 `source.kind === 'user'` 的用户输入（harness 的运行时上下文同样是 user 角色，已过滤）。
- `session/disposed`、空闲 `captureIdleMinutes`（默认 5）或手动 flush 时，生成**机械摘要**：用户诉求、最后结论、涉及文件、工具、轮数。
- 草稿写到 `$DSH_HOME/dsh-mesh/inbox/sessions/<sessionId>.md`（本机、不同步、不参与召回）。

### 收件箱（inbox）

- 新增 `mesh_memory_inbox`：`list` / `read` / `accept` / `reject` / `flush`。
- `accept` 把草稿转成正式记忆（默认 `memory/notes/`，带 `auto-capture` 标签），草稿归档到 `inbox/accepted/`。
- 收件箱非空时，每会话最多一次在系统提示里注入一行提醒（不重复占 token）。
- dashboard 新增「待确认」计数、`/api/inbox`、`/api/inbox/file` 与区块；桌面客户端卡片。

### 备份（git）

- 新增 `mesh_memory_backup`：`snapshot` / `list` / `restore`（`restore` 需 `confirm:true`，且先做还原前快照）。
- git 目录在 `$DSH_HOME/dsh-mesh-backups.git`，work-tree 是共享记忆目录——**`.git` 不进 Syncthing**，每台设备独立历史。
- 写入（write/update/delete/digest/sync/accept）后 debounce 60s 合并提交；另每 6 小时定时快照。

### 配置

`captureEnabled`、`captureIdleMinutes`、`captureMinTurns`、`backupEnabled`、`backupDebounceSeconds`、`backupIntervalMinutes`。

### 测试

70 例（67 通过 / 3 跳过）：新增 capture 事件解析、inbox 写入/接受/拒绝/路径限制、git 快照与还原。

## 0.6.2 — 2026-10-31

修复 0.6.0 引入的跨设备写冲突。

- 设备注册表改为**每设备一个文件**：`index/devices/<slug>.json`。上一版所有设备都写 `index/devices.json`，
  在 Syncthing 下会互相覆盖（平板实测出现 `devices.sync-conflict-*`）。
- `listDevices` 合并各设备文件 + 旧 `index/devices.json`（只读兼容），按 slug/名字去重。
- `mesh_digest` 的会话索引改为 `index/sessions/<slug>.jsonl`，同样避免多设备追加同一文件。
- 新增测试：两台设备写同一记忆目录时互不覆盖、旧注册表只读兼容。

## 0.6.1 — 2026-10-31

修复 Windows CI 暴露的上传白名单误判。

- `resolveUploadPath` 现在对 `allowedUploadRoots` 做 `realpath` 规范化（根不存在时退回 `resolve`）。
  之前根目录若写成 8.3 短路径（GitHub Windows runner 的 `RUNNER~1`）或目录链接，
  真实文件路径（长路径）会与配置字符串不相等，被误判为“不在允许目录”。
- 新增回归测试：白名单根为目录链接时，真实路径下的文件仍应放行。
- CI：失败时用 `scripts/ci-annotate.mjs` 把测试输出尾部转成 annotation（公开 API 可读，便于无 token 排障）。

## 0.6.0 — 2026-10-31

审计整改第三批：记忆生命周期、检索一致性、可运维性、CI。无破坏性行为变更（除新增确认参数）。

### 记忆生命周期

- 新增 `mesh_memory_update`：就地改标题/描述/正文/tags/aliases/baseline/有效期，保留 `id`/`createdAt`/`device`，写 `updatedAt`。
- 新增 `mesh_memory_delete`：**软删除**到 `.trash/`（保留原目录结构，必须 `confirm:true`）。
- 新增 `mesh_memory_trash` / `mesh_memory_restore`：列出回收站、按原路径恢复，目标已存在时拒绝覆盖。
- 新增 `mesh_conflicts`：列出 Syncthing 冲突副本，供人工裁决。

### 检索一致性

- 搜索与自动召回共用 `isDocValid`：失效/被取代的条目不再出现在搜索结果里。
- 搜索结果覆盖 `skills/`，并带 `title` 与 `conflict` 标记。
- 召回新增文档缓存：签名 = 路径+mtime+size+上限；命中时连文件都不读，只重读变化的文件，并复用预计算的词频（不再每轮重新 tokenize）。

### 可观测 / 边界

- 树：冲突文件标 `conflict:true`；`.mesh`/`.stversions`/`.trash` 只显示目录节点、不暴露内部文件；超过 300 项返回 `truncated:true`（native manifest 同步带该标记）。
- 设备注册表由插件维护（`index/devices.json`，10 分钟内不重复写）。
- dashboard：回环判断改为 **socket 地址 + Host 头双重校验**（Host 可伪造，socket 不行）；独立页面支持可选 `dashboardToken`；新增 `/api/conflicts`；状态里带 `dashboardListening`/`tokenRequired`。
- 客户端：修掉选中文件时的重复请求与竞态（请求序号 + 单独的 `selectFile`）；`api()` 加 15s 超时；Markdown 输出加 sanitizer 兜底。
- 工具错误统一为 `{ ok:false, tool, error }`，不再出现“有的抛错、有的返回 ok:false”。

### Remote

- `mesh_read` 支持 `beforeSeq`/`throughSeq` 分页，返回 `nextCursor`。
- 会话摘要超长时标记 `truncated` 与 `messageCount`，不再让“部分历史”看起来像全部。

### 工程

- GitHub Actions：Node 20/22/24 × Ubuntu/Windows，跑 `npm run check` + `npm test`。
- 测试 54 例（51 通过 / 3 跳过）。
- `maxSkillBytes`：共享 skill 超过上限或含符号链接时拒绝同步。

## 0.5.0 — 2026-10-31

审计整改第二批：信任边界与 Remote 语义。**含行为变更，升级前先看第一节。**

### 行为变更（可能影响现有用法）

- `mesh_memory_sync` 默认**只预览**（返回 AGENTS 托管块的行级 diff 与 skills 清单，不写盘）。应用需要 `mode:"apply"` + `confirm:true` + `expectedSha256`（预览返回的 `agents.sourceSha256`）。
- `mesh_run` 的 `ok` 只在目标会话**明确完成**（`idle`/`completed`）时为 `true`；`running`/`accepted`/待审批都返回 `ok:false` 并附 `hint`，需用 `mesh_wait` 续等。
- 显式传入的 `workspacePath` / `workspaceId` 找不到时**直接报错**并列出候选，不再静默换到第一个工作区。

### 安全 / 信任边界

- 嵌套 Remote 调用改走 `ctx.tools.execute()`：经过 `tools/pre-execute`、guard 与 per-agent 可见性检查，不再直接 `tool.execute()` 绕过审批链。
- AGENTS/skills 采用“预览 → 应用”两步；应用前校验源文件哈希，避免预览后内容被替换的盲写。
- 托管块加入来源标记：`> 来源：AGENTS.shared.md · sha256:… · 更新于 …`，便于事后审计这条规则从哪来。

### Remote 语义

- 新增 `mesh_wait`（等待会话完成/审批）与 `mesh_send`（追加消息，支持幂等 `operationId`）。
- `mesh_run` 支持调用方传入 `operationId`，重试不会重复建会话/发消息。
- 建会话成功但发送失败时尝试 `mesh_interrupt`，减少孤儿会话。
- 未指定工作区且目标有多个 harness 工作区时，结果带 `workspaceFallback:true` 与候选列表。
- 上传/下载回执：`accepted` / `pending` / `timeout` 不再被当成成功，必须出现 `path`/`name`/`bytes`。

### 测试

- 42 例（39 通过 / 3 跳过：本机无符号链接特权，已用 junction 覆盖 realpath 路径）。
- 新增 `test/remote.test.js`（嵌套派发、可见性、工作区、状态、回执）与 `test/agents.test.js`（预览/应用/哈希/diff/转义）。

## 0.4.6 — 2026-10-31

安全与数据完整性加固（第三方审计整改第一批；不含新功能）。

### 安全

- `mesh_digest`：`sessionId` 改为白名单（字母/数字/点/下划线/短横线，≤128 字符），路径统一经 `safeRel`；不再返回宿主绝对路径。
- 读取统一走 `readInside`：拒绝符号链接与目录联接，`realpath` 必须仍在共享记忆目录内，并有单文件大小上限。dashboard、Go 原生面板、`mesh_memory_read` 共用同一套边界。
- `mesh_send_file`：新增 `allowedUploadRoots` 白名单（默认共享记忆目录 + `~/Downloads`），`realpath` 校验，永久拒绝 `.env`、`id_*`、`*.pem`、`*.key`、`*.jks`、`.ssh/` 等敏感路径。
- AGENTS 托管块：转义共享内容中的 `<!-- dsh-mesh:begin/end -->`，检测重复标记并拒绝写入；源文件缺失/为空时不再清空现有托管块。
- `readSharedAgents` 区分 `ENOENT` 与其他错误：读失败会中止并报错，不再当作空文件。

### 数据完整性

- 记忆写入：唯一临时文件 + `rename` + `fsync`；文件名加随机后缀、frontmatter 加 `id`，同秒同标题不再互相覆盖。
- native manifest：写入串行化 + 唯一临时文件，消除并发 `ENOENT`。
- skills 本地清单移出共享目录（`$DSH_HOME/dsh-mesh-skills.json`），避免把本机绝对路径同步给其他设备。
- `AGENTS.md` 备份带随机后缀，只保留最近 10 份。

### 召回

- 候选按 mtime 倒序，`maxRecallFiles` 默认 1000（原硬编码 240，超出后新记忆会静默失效）。
- 新增 `maxRecallFileBytes`（默认 1 MB）：超大文件跳过而不是拖慢 prompt assembly。
- 中英文停用词 + 相对分数门槛 + 词项特异性闸门；`recallMinScore` 可配。
- `supersededBy` 一律不注入；未来 `validAt` 不注入；无法解析的时间不再静默放行。
- 候选被截断时在注入文本里显式标注。

### 工程

- 新增 `node:test` 测试 24 例：路径穿越、符号链接/junction、上传白名单、同秒覆盖、frontmatter、并发 manifest、召回上限/停用词/有效性。
- `package.json` 增加 `test` / `check` 脚本与 `files` 白名单（仍 `private`，不走 npm 发布）。
- `install.ps1` 改为“先备份再替换”，新增 `-Rollback`，保留 5 份备份。
- frontmatter 解析支持 BOM、无尾换行、`>`/`|` 块与流式数组。
- `mesh_status` 增加 notes 计数、召回参数、上传白名单；dashboard 增加「笔记」卡片。

## 0.4.5 — 2026-10-31

- Native manifest adds `description` and `updatedAt` for the Go memory page.
- `memory_write` and `digest` refresh the native manifest.
- README rewritten with install, upstream, Syncthing and troubleshooting sections.
- Added docs: Syncthing, upstream, troubleshooting, contributing, security.
- Installer no longer copies `.git` into `node_modules`.

## 0.4.4 — 2026-10-31

- Native manifest filters to `AGENTS.shared.md`, `skills/`, `memory/`, `sessions/`.
- Excludes `index/`, `.mesh/`, `.stversions/` from the human-facing manifest.
- AGENTS title becomes「共享规则」in the manifest.

## 0.4.3 — 2026-10-31

- Added `$DSH_HOME/dsh-go/dsh-mesh.json` native manifest.
- Manifest is written on plugin start and after memory writes.
- Companion DSH Go native memory page can read it over `workspaceFiles/read`.

## 0.4.2 — 2026-10-31

- Automatic recall on `system-prompt/assemble`.
- BM25 over memory and session summaries, 6000-char budget, per-session dedupe.
- Frontmatter: `memoryType`, `description`, `aliases`, `baseline`, `validAt`, `invalidAt`, `supersededBy`.
- Validity filtering: expired/superseded entries are skipped.

## 0.4.1 — 2026-10-31

- Chinese category labels in the desktop tree.
- Markdown preview/source toggle with headings, lists, code, tables, links, quotes.

## 0.4.0 — 2026-10-31

- `/dsh-mesh/api/tree` full tree.
- Desktop sidebar footer / header utilities / conversation view entries.
- DSH Go native panel lists all files.
- Tablet profile support.

## 0.3.1 — 2026-10-31

- Composer strip「记忆」capsule for DSH Go.

## 0.3.0 — 2026-10-31

- Desktop `client.js` (conversation view).
- DSH Go native panel via `dshGo`.

## 0.2.x — 2026-10-31

- Dashboard route `/dsh-mesh/`.
- Standalone read-only page on 8765/8766.
- AGENTS/skills sync.
- Tablet install.

## 0.1.0 — 2026-10-31

- Initial MVP: shared memory, 13 `mesh_*` tools, Remote delegation, file transfer.





