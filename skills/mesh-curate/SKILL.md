---
name: mesh-curate
description: 知识库整理：合并重复、补元数据、清理标签、标记 baseline；先出计划再改。
---

# mesh-curate

## 何时用

- 用户说“整理记忆 / 清理重复 / 归类”；
- `mesh_memory_doctor` 报出 duplicate / missing-permalink / 无 title。

## 步骤

1. `mesh_memory_doctor` + `mesh_memory_duplicates` 拿清单。
2. 先写一份**计划**（可以只在对话里）：要合并哪些、保留哪条、改哪些标签。
3. 得到用户同意后执行：
   - 合并：保留信息更全的一条，`mesh_memory_update` 补全正文/别名，另一条 `mesh_memory_delete`（软删除）；
   - 补字段：`mesh_memory_update` 补 `description` / `tags` / `aliases`；
   - baseline：只给“每场都该知道”的 3 条以内设 `baseline: true`。
4. 再跑一次 `mesh_memory_doctor`，确认 error 归零。
5. `mesh_memory_backup snapshot`。

## 原则

- 一次只处理一类问题；
- 删除只能是软删除，且要告诉用户可在 `.trash/` 恢复；
- 标签不超过 5 个，优先复用已有标签。
