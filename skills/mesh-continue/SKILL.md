---
name: mesh-continue
description: 续接上次工作：用检索与最近变化重建上下文，再读关键笔记，给出下一步。
---

# mesh-continue

## 何时用

- 新会话开始，用户说“继续 / 上次做到哪了 / 接着来”；
- 隔了几天回到某个项目。

## 步骤

1. `mesh_memory_reflect` 看最近 7 天变化（没有就 `mesh_memory_search` 主题词）。
2. `mesh_memory_search` 搜项目名/关键词，读最相关的 2–3 条（`mesh_memory_read`）。
3. 看 `mesh_status` 的 counts 与 inbox，确认有没有待确认草稿。
4. 用 5 行以内总结：
   - 上次到哪；
   - 已定的结论；
   - 未完成/风险；
   - 建议的下一步（一个）。
5. 用户确认后再动手，不要直接改文件。

## 原则

- 先读后写；上下文不足时明确说“只知道这些”。
- 不把旧结论当现行事实：看 `invalidAt` / `supersededBy`。
