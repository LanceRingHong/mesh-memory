# Changelog

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
