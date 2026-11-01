import { parseFrontmatter, readInside, renderNote, writeFileAtomic, publishNativeManifest, safeRel, trashNote } from './store.js'

const STATUSES = new Set(['active', 'archived', 'superseded', 'draft'])

/**
 * 生命周期状态（0.12.0）：
 * - active：正常，参与搜索/召回；
 * - archived：归档，不参与搜索/召回，但文件保留；
 * - superseded：被取代，不参与；
 * - draft：草稿（正式记忆里一般不用，留给导入流程）。
 */
export async function setStatus(settings, rel, status, { confirm = false } = {}) {
  const next = String(status || '').trim()
  if (!STATUSES.has(next)) throw new Error(`status 只接受 ${[...STATUSES].join(' / ')}`)
  if (next === 'archived' && confirm !== true) throw new Error('归档需要 confirm:true（可随时 unarchive）')
  const path = safeRel(settings, rel)
  const parsed = parseFrontmatter(await readInside(settings, rel))
  const attrs = { ...parsed.attrs }
  const now = new Date().toISOString()
  attrs.status = next
  attrs.updatedAt = now
  if (next === 'archived') {
    attrs.archivedAt = now
    if (!attrs.invalidAt) attrs.invalidAt = now
  } else {
    delete attrs.archivedAt
    if (next === 'active') delete attrs.invalidAt
  }
  await writeFileAtomic(path, renderNote(attrs, parsed.body))
  await publishNativeManifest(settings).catch(() => {})
  return { path: String(rel), status: next, updatedAt: now }
}

export function archiveNote(settings, rel, options = {}) {
  return setStatus(settings, rel, 'archived', options)
}

export function unarchiveNote(settings, rel) {
  return setStatus(settings, rel, 'active', { confirm: true })
}

/**
 * 换集合（0.25.0）：把一条记忆从 `memory/<a>/` 挪到 `memory/<b>/`，保留正文与 permalink。
 * 用于「杂项被反复用到 → 升级为正式分类」的晋升动作。旧文件进 `.trash/`（可恢复）。
 */
export async function moveNote(settings, rel, toKind, { confirm = false } = {}) {
  if (confirm !== true) throw new Error('移动需要 confirm:true')
  const relPosix = String(rel || '').replace(/\\/g, '/')
  const match = relPosix.match(/^memory\/([^/]+)\/([^/]+\.md)$/i)
  if (!match) throw new Error('只允许移动 memory/<kind>/<file>.md')
  const target = String(toKind || '').trim()
  if (!target) throw new Error('toKind 必填')
  if (match[1] === target) return { from: relPosix, to: relPosix, moved: false }

  const parsed = parseFrontmatter(await readInside(settings, relPosix))
  const attrs = { ...parsed.attrs, kind: target, updatedAt: new Date().toISOString() }
  const nextRel = `memory/${target}/${match[2]}`
  await writeFileAtomic(safeRel(settings, nextRel), renderNote(attrs, parsed.body))
  await trashNote(settings, relPosix)
  await publishNativeManifest(settings).catch(() => {})
  return { from: relPosix, to: nextRel, moved: true }
}
