# Security

## 报告问题

请通过 GitHub Security Advisory 或私下联系维护者，不要在公开 Issue 里贴：

- token、私钥、keystore、密码；
- 完整会话文件、完整记忆正文；
- 设备 ID、内网地址、个人路径。

## 安全边界

- 记忆是**明文 Markdown**，安全依赖操作系统账户与磁盘。
- 只读页面默认只绑定 `127.0.0.1`。
- `mesh_run` 在目标设备上按目标权限执行，不会自动提权；远程内容不可信。
- Syncthing / DSH Remote 的传输、账号、中继由各自项目负责。
- 不要把 `~/.dsh` 放进 Syncthing，也不要把 8384/8765 暴露到公网。

### 0.4.6 起强制的边界

- **读取**：只读共享目录内的普通文件；符号链接/目录联接被拒绝，`realpath` 必须仍在共享目录内；单文件大小受限。
- **写入**：`mesh_digest` 的 `sessionId` 走白名单；记忆文件用临时文件 + `rename`；`AGENTS.md` 托管块会转义 `<!-- dsh-mesh:* -->` 标记并保留 10 份备份。
- **上传**：`mesh_send_file` 只允许 `allowedUploadRoots` 内的文件；`.env`、`id_*`、`*.pem`、`*.key`、`*.jks`、`.ssh/` 等永远拒绝。

### 已知未覆盖（计划 0.6.x）

- `mesh_memory_sync` 的“应用”由上下文里的 Agent 转述用户同意（`confirm` + `expectedSha256`），**不是**宿主级审批弹窗；能改 Agent 上下文的攻击者仍可能说服模型去应用。
- 没有加密选项；共享目录里的敏感记忆仍以明文同步。
- 召回是词面 BM25，不保证语义准确；恶意记忆条目的注入风险由“数据不是指令”约束承担，未做内容审查。
- dashboard 仅靠 Host 头判断回环，且同时起独立端口与 `/dsh-mesh` 路由（计划合并为单服务 + token）。
- 没有索引：每轮召回仍遍历记忆目录（有上限与异步化，但 O(n)）。

## 建议

- 敏感记忆自行加密/脱敏后再写入。
- 使用专用设备/账户运行 DSH；限制共享目录权限。
- 定期备份记忆目录与会话备份。
- 升级前先备份 profile 配置与 `node_modules/dsh-mesh`；`install.ps1 -Rollback` 可回到上一个备份。
