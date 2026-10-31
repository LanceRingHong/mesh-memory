# Changelog

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
