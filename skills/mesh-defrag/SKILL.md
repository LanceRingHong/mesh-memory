---
name: mesh-defrag
description: 记忆去膨胀：拆分过大的笔记、合并零散事实、退役过期内容；先写计划，只归档不删除。
---

# mesh-defrag

## 何时用

- 某条笔记越来越长、开始混多个主题；
- `mesh_memory_doctor` 报 `large-note`；
- 用户说“太乱了 / 拆一下 / 归档旧的”。

## 步骤

1. 找到目标（doctor 的 `large-note`，或用户指定）。
2. 读全文，列出主题分组。
3. **先写计划**：拆成哪几条、每条标题/kind/description、原条目如何处理（保留为索引 / `supersededBy`）。
4. 用户确认后：
   - 新条目逐条 `mesh_memory_write`；
   - 原条目 `mesh_memory_update` 改成索引，或 `invalidAt` 标失效；
   - 需要时 `mesh_memory_backup snapshot`。

## 原则

- 归档，不删除；唯一例外是明确的重复条目（软删除）。
- 拆分后每条仍要能独立读懂。
- 不要为了“整齐”拆得过碎：一条记忆 1–3 个主题为宜。
