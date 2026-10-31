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

## 建议

- 敏感记忆自行加密/脱敏后再写入。
- 使用专用设备/账户运行 DSH；限制共享目录权限。
- 定期备份记忆目录与会话备份。
- 升级前先备份 profile 配置与 `node_modules/dsh-mesh`。
