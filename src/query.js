import path from 'node:path'
import { parseFrontmatter, readInside, isDocValid, isConflictPath, walk } from './store.js'

function relOf(settings, file) {
  return path.relative(settings.memoryDir, file).replace(/\\/g, '/')
}

/**
 * 元数据查询（0.12.0）：按 frontmatter 过滤，不依赖全文检索。
 * filters: kind / memoryType / status / device / agent / tag / tagsAll / tagsAny /
 *          title / permalink / baseline / updatedAfter / updatedBefore / includeInvalid
 */
export async function queryMemory(settings, filters = {}, { limit = 100, includeInvalid = false } = {}) {
  const rows = []
  const files = await walk(settings.memoryDir, 'memory')
  for (const file of files) {
    const rel = relOf(settings, file)
    if (isConflictPath(rel)) continue
    let text = ''
    try {
      text = await readInside(settings, rel, { maxBytes: 2_000_000 })
    } catch {
      continue
    }
    const attrs = parseFrontmatter(text).attrs
    const valid = isDocValid(attrs)
    if (!valid && !(includeInvalid || filters.includeInvalid === true)) continue
    if (filters.kind && attrs.kind !== filters.kind) continue
    if (filters.memoryType && attrs.memoryType !== filters.memoryType) continue
    if (filters.status && attrs.status !== filters.status) continue
    if (filters.device && String(attrs.device || '') !== String(filters.device)) continue
    if (filters.agent && String(attrs.agent || '') !== String(filters.agent)) continue
    if (filters.permalink && String(attrs.permalink || '').toLowerCase() !== String(filters.permalink).toLowerCase()) continue
    if (filters.title && !String(attrs.title || '').toLowerCase().includes(String(filters.title).toLowerCase())) continue
    if (filters.baseline === true && attrs.baseline !== true) continue
    if (filters.tag) {
      const tag = String(filters.tag).toLowerCase()
      if (!(Array.isArray(attrs.tags) ? attrs.tags : []).some((t) => String(t).toLowerCase() === tag)) continue
    }
    if (Array.isArray(filters.tagsAll) && filters.tagsAll.length) {
      const tags = (Array.isArray(attrs.tags) ? attrs.tags : []).map((t) => String(t).toLowerCase())
      if (!filters.tagsAll.every((t) => tags.includes(String(t).toLowerCase()))) continue
    }
    if (Array.isArray(filters.tagsAny) && filters.tagsAny.length) {
      const tags = (Array.isArray(attrs.tags) ? attrs.tags : []).map((t) => String(t).toLowerCase())
      if (!filters.tagsAny.some((t) => tags.includes(String(t).toLowerCase()))) continue
    }
    const updated = String(attrs.updatedAt || attrs.createdAt || '')
    if (filters.updatedAfter && !(Date.parse(updated) >= Date.parse(String(filters.updatedAfter)))) continue
    if (filters.updatedBefore && !(Date.parse(updated) <= Date.parse(String(filters.updatedBefore)))) continue
    rows.push({
      path: rel,
      title: String(attrs.title || ''),
      description: String(attrs.description || ''),
      kind: String(attrs.kind || ''),
      memoryType: String(attrs.memoryType || ''),
      status: String(attrs.status || 'active'),
      device: String(attrs.device || ''),
      agent: String(attrs.agent || ''),
      permalink: String(attrs.permalink || ''),
      tags: Array.isArray(attrs.tags) ? attrs.tags : [],
      baseline: attrs.baseline === true,
      updatedAt: updated,
      valid,
    })
  }
  rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  return { count: rows.length, items: rows.slice(0, Math.max(1, Number(limit) || 100)) }
}

/** 每个 collection（memory/<id>/）的条目数，给界面导航用。 */
export async function collectionCounts(settings) {
  const counts = {}
  for (const file of await walk(settings.memoryDir, 'memory')) {
    const rel = relOf(settings, file)
    if (isConflictPath(rel)) continue
    try {
      const attrs = parseFrontmatter(await readInside(settings, rel, { maxBytes: 200_000 })).attrs
      const id = String(attrs.kind || rel.split('/')[1] || 'notes')
      counts[id] = (counts[id] || 0) + 1
    } catch {}
  }
  return counts
}

/** 状态统计（给 UI 的侧栏用）。 */
export async function statusCounts(settings) {
  const counts = { active: 0, archived: 0, superseded: 0, draft: 0, invalid: 0 }
  const files = await walk(settings.memoryDir, 'memory')
  for (const file of files) {
    const rel = relOf(settings, file)
    if (isConflictPath(rel)) continue
    try {
      const attrs = parseFrontmatter(await readInside(settings, rel, { maxBytes: 200_000 })).attrs
      const status = String(attrs.status || 'active')
      if (counts[status] !== undefined) counts[status] += 1
      else counts.active += 1
      if (!isDocValid(attrs)) counts.invalid += 1
    } catch {}
  }
  return counts
}
