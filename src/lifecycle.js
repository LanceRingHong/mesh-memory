import { parseFrontmatter, readInside, renderNote, writeFileAtomic, publishNativeManifest, safeRel } from './store.js'

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
