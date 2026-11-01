---
name: mesh-capture
description: 把一个工作线程的“当前结论”收成一条记忆；同一线程重复捕获时改写原条目，不追加流水账。
---

# mesh-capture

## 何时用

- 一段讨论已经得出决定/结论，值得下个会话还记得；
- 用户说“记一下 / 保存 / 别忘了”；
- 会话即将结束或上下文快满。

## 先查再写

1. `mesh_memory_search` 搜主题词，确认是否已有同线程的条目。
2. 找到：`mesh_memory_update` 改写正文与 `description`，保留 `permalink/id/createdAt`。
3. 找不到：`mesh_memory_write`，`source` 写 `session:<当前会话 id>`（如果拿不到就省略），`tags` 加 `capture`。

## 写什么

写**现在的理解**，不是过程日志：

- 结论/决定是什么；
- 为什么（关键权衡）；
- 影响哪些文件/路径/版本；
- 还有什么没做。

不写：寒暄、中间尝试、被否决的方案（除非是否决理由本身重要）。

## 约束

- 一条记忆一个主题，标题直接写结论；
- `description` 一句话，检索靠它；
- 不写密钥、token、完整会话正文；
- 写完 `mesh_memory_backup snapshot` 可选（插件会自动防抖快照）。
