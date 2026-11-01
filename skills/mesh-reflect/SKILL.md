---
name: mesh-reflect
description: 睡眠式反思：看上次反思以来变化的记忆，把持久结论折回对应条目，并写一条 reflection 笔记。
---

# mesh-reflect

## 何时用

- 每天 1–2 次，或用户说“整理一下 / 反思 / 复盘”；
- 一段密集工作之后（新增了很多记忆）。

## 步骤

1. 调 `mesh_memory_reflect` 拿变化清单（默认从上次 reflection 或 7 天前）。
2. 逐条读变化的笔记（`mesh_memory_read`），判断：
   - 只是过程记录 → 不处理；
   - 有持久结论 → 折回它所属的主题条目（`mesh_memory_update`）；
   - 与旧结论冲突 → 旧条目标 `supersededBy`，新条目写清原因。
3. 写一条 reflection 笔记：
   - `kind: notes`，标题 `reflection YYYY-MM-DD`；
   - 正文：本次改了什么、为什么、还有什么没解决；
   - `tags: ["reflection"]`。
4. 需要时 `mesh_memory_backup snapshot`。

## 原则

- 反思不是复述；只保留“下个月还需要知道”的东西。
- 不删除，用 `supersededBy` / `invalidAt` 表达失效。
- 一次最多改 5–10 条，改太多说明该拆主题了。
