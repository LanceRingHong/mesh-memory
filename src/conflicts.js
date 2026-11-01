import path from 'node:path'
import { listConflicts, readInside, trashNote, writeFileAtomic } from './store.js'

/**
 * Syncthing 冲突副本（0.24.0）。
 *
 * 文件长这样：`memory/facts/标题.sync-conflict-20261101-120000-ABCDEF.md`，
 * 基名是去掉 `.sync-conflict-<时间>-<设备>` 之后的部分。
 * 这里只做「定位 + 配对 + 裁决」，不自动合并：裁决结果写回基名文件，
 * 冲突副本进 `.trash/`（可恢复），符合"不物理删"的约定。
 */

const CONFLICT_RE = /\.sync-conflict-[^.]+(?=\.[^.]+$)/

/** `a.sync-conflict-20260101-120000-ABCDEF.md` → `a.md`；不是冲突副本返回空串。 */
export function conflictBase(rel) {
  const text = String(rel || '').replace(/\\/g, '/')
  const base = text.replace(CONFLICT_RE, '')
  return base === text ? '' : base
}

/** 共享目录内的绝对路径；越界直接抛错（写法与 store.js 的读取侧一致）。 */
export function absInside(memoryDir, rel) {
  const root = path.resolve(memoryDir)
  const abs = path.resolve(root, rel)
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('路径越界')
  return abs
}

/** 造出并排裁决需要的两侧文本。 */
export async function pairConflict(settings, rel) {
  const base = conflictBase(rel)
  if (!base) throw new Error('不是 Syncthing 冲突副本路径')
  const conflictText = await readInside(settings, rel, { maxBytes: 400_000 })
  let baseText = ''
  try {
    baseText = await readInside(settings, base, { maxBytes: 400_000 })
  } catch {
    baseText = ''
  }
  return { conflict: rel, base, baseText, conflictText }
}

/**
 * 裁决：take='conflict' 用副本覆盖基名文件，take='base' 保留现有基名文件。
 * 两种都把冲突副本移进 `.trash/`，可恢复。
 */
export async function resolveConflict(settings, rel, take) {
  const pair = await pairConflict(settings, rel)
  const mode = take === 'conflict' ? 'conflict' : 'base'
  if (mode === 'conflict') await writeFileAtomic(absInside(settings.memoryDir, pair.base), pair.conflictText)
  const trashed = await trashNote(settings, pair.conflict)
  return { ok: true, take: mode, base: pair.base, conflict: pair.conflict, trashed }
}

/** 冲突列表 + 基名（列表接口直接可用）。 */
export async function listConflictPairs(settings) {
  const items = await listConflicts(settings)
  return items.map((item) => ({ ...item, base: conflictBase(item.path) }))
}
