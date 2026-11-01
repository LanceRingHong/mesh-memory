# Contributing

感谢你愿意改进 dsh-mesh。这个项目优先保持“文件式、可审计、单写者安全”。

## 开发环境

- Node.js ≥ 18
- DSH 0.2.1-rc.x
- Windows PowerShell 7（`pwsh`）用于安装脚本
- 可选：DSH Go / Android 工具链（只改原生页时需要）

## 本地安装

```powershell
git clone https://github.com/LanceRingHong/mesh-memory.git
cd dsh-mesh
pwsh -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Profiles desktop
```

安装后：

```text
mesh_status
```

## 代码约定

- 纯 ESM，Node 原生 `fs`，不引入不必要的依赖。
- 所有写操作限制在 `memoryDir` 内；路径必须经过 `safeRel`，来自模型参数的路径还要额外白名单（如 `sessionId`）。
- 不把原始 DSH 会话加入同步目录。
- 用户可见行为变化要更新 `README.md` / `docs/` / `CHANGELOG.md`。
- 不在日志/错误里输出 token、私钥、完整记忆正文。

## 测试

0.4.6 起有 `node:test` 套件（`test/`），提交前至少跑：

```powershell
npm run check     # node --check 全部源文件
npm test          # store / recall / policy 的行为测试
pwsh -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Profiles desktop
```

新增安全相关改动时，请同时补一条能复现问题的用例；没有用例的“加固”不算完成。

并在测试记忆目录验证：

- `mesh_memory_write`
- `mesh_memory_search`
- `mesh_memory_read`
- 自动召回
- `/dsh-mesh/api/tree` 与 `/api/file`

## 提交 PR

1. 先开 Issue 对齐大改动；
2. 从 `main` 开分支；
3. 提交信息用 `feat:` / `fix:` / `docs:` / `chore:`；
4. 说明：改了什么、为什么、怎么验证、回滚方式；
5. 不提交 `node_modules/`、APK、`*.jks`、`key.properties`、记忆数据。

## 上游

- DSH：https://github.com/deepseek-ai/deepseek-harness
- DSH Remote：https://github.com/liguobao/ds-harness-remote
- Syncthing：https://syncthing.net/
- DSH Go：https://github.com/ccch1mneyyy/dsh-go

改上游行为请先看对应项目的贡献指南。
