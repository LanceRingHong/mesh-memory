import { parseFrontmatter, readInside, updateNote, walk, writeNote } from './store.js'

/**
 * 偏好（0.25.0）：一条偏好只有**一个现行版本**。
 *
 * 参考 OpenClaw `USER.md` 的做法：偏好用祈使句（Always / Never / Prefer），改动时**就地 supersede**，
 * 绝不追加互相矛盾的第二条。这样"我不喜欢打字"从一件事变成一条规则，改主意时也只改一处。
 *
 * 约定：偏好记忆带 `偏好` 标签；标题形如 `偏好：<主题>`；默认进 baseline（每场开场生效）。
 */

export const PREFERENCE_TAG = '偏好'
const TOPIC_TAG_LIMIT = 6

const norm = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '')

async function listDocs(settings) {
  const docs = []
  for (const file of await walk(settings.memoryDir, 'memory')) {
    const rel = String(file).replace(/\\/g, '/').split('/memory/').pop()
    const path = `memory/${rel}`
    if (path.includes('.sync-conflict-')) continue
    let text = ''
    try {
      text = await readInside(settings, path, { maxBytes: 1_000_000 })
    } catch {
      continue
    }
    const parsed = parseFrontmatter(text)
    docs.push({
      path,
      kind: String(parsed.attrs.kind || path.split('/')[1] || 'notes'),
      title: String(parsed.attrs.title || ''),
      description: String(parsed.attrs.description || ''),
      tags: Array.isArray(parsed.attrs.tags) ? parsed.attrs.tags.map(String) : [],
      baseline: parsed.attrs.baseline === true,
      status: String(parsed.attrs.status || 'active'),
      updatedAt: String(parsed.attrs.updatedAt || parsed.attrs.createdAt || ''),
    })
  }
  return docs
}

/**
 * 写/改一条偏好。
 * - 已有同主题偏好：就地更新（标题统一成 `偏好：<主题>`），并把更早的重复条目标 superseded；
 * - 没有：新建一条，自动带 `偏好` 标签与 baseline。
 */
export async function setPreference(settings, input = {}) {
  const topic = String(input.topic || '').trim()
  const directive = String(input.directive || input.content || '').trim()
  if (!topic) throw new Error('topic 必填（这条偏好的主题，如“打字/分类方式”）')
  if (!directive) throw new Error('directive 必填（偏好内容，祈使句最好：Always / Never / Prefer…）')

  const kind = String(input.kind || 'facts')
  const baseline = input.baseline !== false
  const extraTags = Array.isArray(input.tags) ? input.tags.map(String) : []
  const tags = [...new Set([PREFERENCE_TAG, ...extraTags.slice(0, TOPIC_TAG_LIMIT)])]
  if (!tags.includes(topic)) tags.push(topic)
  const title = `偏好：${topic}`
  const description = String(input.description || `${topic}：${directive.replace(/\s+/g, ' ').slice(0, 80)}`)
  const body = directive

  const docs = await listDocs(settings)
  const matched = docs
    .filter((doc) => doc.status !== 'superseded' && doc.tags.map(norm).includes(norm(PREFERENCE_TAG)))
    .filter((doc) => norm(doc.title).includes(norm(topic)) || doc.tags.map(norm).includes(norm(topic)))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))

  if (!matched.length) {
    const file = await writeNote(settings, {
      kind,
      title,
      description,
      content: body,
      tags,
      memoryType: 'user',
      baseline,
      baselinePriority: 30,
      source: 'prefer',
    })
    // writeNote 返回绝对路径；对外统一成相对 memoryDir 的路径（与其它工具一致）。
    const rel = String(file).startsWith(String(settings.memoryDir))
      ? String(file).slice(String(settings.memoryDir).length + 1).replace(/\\/g, '/')
      : String(file).replace(/\\/g, '/')
    return { ok: true, action: 'created', path: rel, superseded: [] }
  }

  const [primary, ...stale] = matched
  await updateNote(settings, primary.path, {
    title,
    description,
    content: body,
    tags,
    baseline,
    baselinePriority: 30,
  })
  const now = new Date().toISOString()
  const superseded = []
  for (const doc of stale) {
    try {
      await updateNote(settings, doc.path, { invalidAt: now, supersededBy: primary.path })
      superseded.push(doc.path)
    } catch {}
  }
  return { ok: true, action: 'updated', path: primary.path, superseded, topic }
}
