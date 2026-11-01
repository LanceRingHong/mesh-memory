---
name: mesh-doctor
description: 记忆体检：只读检查 permalink/checksum/重复/冲突/收件箱，解释问题并按用户同意修复。
---

# mesh-doctor

## 何时用

- 搜索搜不到、同一内容出现两次、保存后文件没变；
- 用户问“记忆是不是正常 / 检查一下”；
- 升级或迁移之后。

## 步骤

1. 先只跑 `mesh_memory_doctor`，把 error/warn/info 分类讲清楚。
2. 对每个 error：
   - `missing-permalink` → 跑迁移脚本或 `mesh_memory_update`；
   - `duplicate-permalink` → 用 `mesh_memory_duplicates` 定位，改其中一条；
   - `sync-conflict` → 读两份，保留/合并，另一份软删除。
3. 修复动作必须逐条获得用户同意；不要批量删。
4. 修完再跑一次 doctor，确认 error=0。
5. 报告：修了什么、还剩什么、下次什么时候再看。

## 原则

- doctor 本身只读；所有写操作都是单独的、可回滚的。
- 不确定的条目保持原样，标成 info 留给用户决定。
