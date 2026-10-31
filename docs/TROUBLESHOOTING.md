# 故障排查

按“先插件、再同步、最后远程”的顺序排查，避免把网络问题当成记忆问题。

## 1. 插件是否加载

```text
mesh_status
```

期望：返回 `device`、`memoryDir`、`counts`、`remoteTools`、`dashboardUrl`。

如果工具不存在：

- 检查 profile 的 `package.json` 的 `dsh.profile.bundles` 是否有 `dsh-mesh`；
- 检查 `<profile>/node_modules/dsh-mesh` 是否存在；
- 检查 `cordis.patch.yml` 是否被追加/触发热加载；
- 重启 DSH；客户端 UI 改动还需要刷新/重开 App。

## 2. 记忆目录

```powershell
# Windows
dir $env:USERPROFILE\DSH-mesh

# Android
ls /sdcard/DSH-mesh
```

- `memoryDir` 是否和 Syncthing folder 一致；
- 是否有 `memory/facts/`；
- 目录是否被 `.gitignore`/Syncthing ignore 误排除。

## 3. 自动召回不生效

- `autoRecall` 是否为 true；
- DSH 版本是否支持 `system-prompt/assemble`；
- 会话里是否有真实用户消息（不是工具结果）；
- 记忆是否失效/被取代（`invalidAt`/`supersededBy`）；
- 查询词是否和内容有词面重合；同义说法请写 `aliases`。

这是词面 BM25，不是语义向量。

## 4. 记忆页空白/报错

- `/dsh-mesh/api/status` 是否 200；
- `/dsh-mesh/api/tree` 是否返回节点；
- 桌面端刷新页面；Go 端重开 App；
- 如果使用 Go 原生页，检查 `$DSH_HOME/dsh-go/dsh-mesh.json` 是否存在、是否包含 `files`；
- 检查 host 是否支持 `workspaceFiles/read`。

## 5. 多设备不同步

| 检查 | 说明 |
|---|---|
| Syncthing 状态 | 是否 `Up to Date` / 100% |
| Folder ID | 两边必须都是 `dsh-mesh` |
| 路径 | PC/Android 可以是不同路径 |
| 设备名 | 不要两台都叫同一个 `deviceName` |
| 冲突文件 | 搜 `.sync-conflict-*` |
| 版本历史 | `.stversions` 不参与同步是正常的 |

详见 [`SYNCTHING.md`](SYNCTHING.md)。

## 6. 跨设备委托失败

- `mesh_peers` 是否能看到目标 Host；
- 目标 Host 是否登录 DSH Remote；
- `mesh_workspaces` 是否能列出目标工作区；
- `mesh_run` 的 `workspacePath` 是否存在；
- 目标端是否在等待审批；
- 网络是否 P2P/中继可用。

`mesh_run` 失败不会自动提权；目标端按自己的权限执行。

## 7. 文件传输失败

- 下载 ≤50 MiB；上传中继 ≤20 MiB、P2P ≤1 GiB；
- 只限工作区；
- Android `/sdcard` 可能因共享存储权限失败，优先 `/root/workspace`；
- 目标端可以把文件从 `/root/workspace` 移到 `/sdcard/Download`。

## 8. Go 顶栏没有「记忆」

- 是否安装了带原生页的测试 APK（`.meshdebug` 并存版）；
- 官方 DSH Go 没有这个页面；
- host 的 `$DSH_HOME/dsh-go/ui.json` 是否有：

```json
{
  "header": {
    "actions": [
      "newChat",
      "detail",
      {
        "id": "memory",
        "icon": "book",
        "label": "记忆",
        "action": { "type": "open", "page": "memory" }
      }
    ]
  }
}
```

- App 是否连到该 host；
- `ui.json` 是否通过 check.mjs/app 解析；
- 重开 App 让配置重新加载。

## 9. 会话/日志问题

- 同一 `~/.dsh` 只允许一个 DSH 写入宿主；
- 不要在 turn 进行中重启/重开会话；
- 原始 session 不要用 Syncthing 同步；
- 出现会话异常时先备份 `.zstd`，不要反复重开写入。

## 10. 收集信息

提交 Issue 时请附：

- DSH 版本、插件版本、OS；
- `mesh_status` 输出（去掉设备 ID/路径中的敏感部分）；
- 相关错误文本；
- 是否使用 Syncthing/DSH Remote；
- 最小复现步骤。

不要附 token、私钥、完整会话文件或含个人信息的记忆正文。
