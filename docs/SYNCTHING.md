# Syncthing 配置指南（dsh-mesh）

> Syncthing 是**可选**的：没有它，dsh-mesh 仍能在单机使用；要让多台设备共享同一份 Markdown 记忆，才需要它。

## 1. 同步什么，不同步什么

**同步**（共享目录内）：

```
DSH-mesh/
  AGENTS.shared.md
  skills/
  memory/{facts,decisions,projects,notes}/
  sessions/<device>/*.md      ← 摘要，不是原始 zstd 会话
  index/
  .mesh/
```

**不要同步**：

- `~/.dsh` 本身（账号、配置、原始会话，单写者）。
- 原始 `session.v4.jsonl.zstd`。
- 任何 keystore/token/密码。

每台设备用自己的 `deviceName`，摘要写到各自的 `sessions/<device>/`，避免互相覆盖。

## 2. 安装

### Windows

- 下载 Syncthing Windows 版，解压到固定目录。
- 启动后打开 `http://127.0.0.1:8384`。
- 设置开机启动：把启动快捷方式放进 `shell:startup`，或用计划任务/服务。
- 只在本机访问 GUI；不要把 8384 暴露到公网。

### Android

- 安装 Syncthing App（F-Droid/Play/官方渠道）。
- 给存储权限；关闭电池优化，允许后台运行。
- 共享目录选 `/sdcard/DSH-mesh`（或你自己的路径）。
- 保持 App 在后台，锁屏后也要能同步。

## 3. 配对设备

1. 两台设备打开 Syncthing GUI/App。
2. 在 A 的「操作 → 显示 ID」复制设备 ID。
3. A 点「添加远程设备」，粘贴 B 的 ID，起个名字。
4. B 会收到提示，接受；B 也添加 A。
5. 双方设备列表显示「已连接」。

设备 ID 是公钥指纹，不是密码；仍建议不要公开贴到 Issue/截图里。

## 4. 建共享文件夹

两边都新建 folder：

| 字段 | 建议 |
|---|---|
| Folder ID | `dsh-mesh`（两边必须一致） |
| Folder Label | `dsh-mesh` |
| Path | PC：`C:\Users\<you>\DSH-mesh`；Android：`/sdcard/DSH-mesh` |
| Folder Type | Send & Receive |
| File Versioning | 建议「Staggered」或「Trash Can」 |

然后在 folder 的「共享」里勾选另一台设备。

> 路径两边可以不同，Folder ID 必须相同。

## 5. 验证同步

1. 在 PC 写：

```text
mesh_memory_write(kind="facts", title="同步测试", content="hello from PC")
```

2. 等 Syncthing 状态到 **100% / Up to Date**。
3. 在平板：

```text
mesh_memory_search("同步测试")
```

4. 反向再写一条，确认 PC 能读到。

如果没有：

- 看 folder 是否 `Up to Date`；
- 看路径是否是 dsh-mesh 的 `memoryDir`；
- 看是否有 `.sync-conflict-*`；
- 看 dsh-mesh `mesh_status` 的 `memoryDir`。

## 6. `.stignore` 建议

在共享目录根放 `.stignore`：

```
(?d).stversions
(?d).sync-conflict-*
```

说明：

- `.stversions` 是版本历史，通常不需要同步给对端。
- `.sync-conflict-*` 是冲突副本；**建议保留并让人看见**。如果你把它忽略，冲突会被静默隐藏，不建议默认这么做。
- 不要忽略 `AGENTS.shared.md`、`memory/`、`sessions/`。

## 7. 冲突处理

Syncthing 不会自动合并文件。两台设备同时改同一文件时，会生成：

```
memory/facts/xxx.sync-conflict-20261031-120000-ABCDEFG.md
```

处理：

1. 不要直接删；先对比两份内容。
2. 把正确内容写回原文件，或保留两份并在 `description` 里说明。
3. 确认后删除冲突副本。
4. 重启/刷新 dsh-mesh 页面；自动召回会跳过冲突文件。

长期看，建议：

- 同一主题尽量由一台设备写；
- 用 `description`/`supersededBy` 表达版本；
- 不要把同一个文件放在两个设备上同时编辑。

## 8. 开机启动 / 后台

### Windows

```powershell
# 示例：把快捷方式放入当前用户启动目录
$startup = [Environment]::GetFolderPath('Startup')
# 手动把 Syncthing 快捷方式放进去，或建计划任务
```

- 用 `shell:startup` 打开启动目录。
- 不要同时跑两个 Syncthing 实例。
- 如果使用服务模式，确认 folder 权限对服务账号可读写。

### Android

- 设置 → 应用 → Syncthing → 电池 → 不受限制。
- 允许后台活动；部分 ROM 需要在最近任务里锁定。
- 同步时保持 Wi-Fi/网络可用。

## 9. 安全

- Syncthing 传输是加密的；设备 ID 是公钥指纹。
- GUI 默认只监听 `127.0.0.1:8384`；不要端口映射到公网。
- 共享目录里有明文记忆；设备丢失/借出时注意。
- 不要把 `~/.dsh` 加进 Syncthing。
- Syncthing 的发现/中继服务器可关闭，改用局域网/静态地址；按隐私要求配置。

## 10. 故障排查

| 现象 | 检查 |
|---|---|
| 一直 `Syncing` | 大文件/网络；看对方是否在线 |
| 两边都有但内容不同 | 路径是否是同一 folder；是否有冲突文件 |
| 平板不同步 | App 是否被电池优化杀掉；存储权限 |
| PC 不同步 | Syncthing 是否开机启动；folder 路径权限 |
| 记忆页看不到新内容 | dsh-mesh 是否指向同一目录；刷新页面 |
| 出现 `.sync-conflict-*` | 两边同时写；按第 7 节人工处理 |

## 11. 和 DSH Remote 的区别

| | Syncthing | DSH Remote |
|---|---|---|
| 作用 | 同步文件目录 | 远程建会话/发任务/读会话/传文件 |
| 需要 | 两台设备安装 Syncthing | 两台设备装 `ds-harness-remote` 并登录 |
| 是否必需 | 跨设备共享记忆才需要 | 跨设备委托才需要 |
| 数据 | 共享目录 Markdown | 目标设备工作区/会话 |

两者可以同时用，也可以只用其中一个。
