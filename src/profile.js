import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * 仓库结构 profile（0.13.0）：每个用户可以用自己的分类/分组/配色。
 * 存 `$memoryDir/index/profile.json`（随 Syncthing 同步），不写进记忆正文。
 */
export const BUILTIN_KINDS = ['facts', 'decisions', 'projects', 'notes']
const ID_RE = /^[a-z0-9\u4e00-\u9fa5][a-z0-9\u4e00-\u9fa5-]{0,31}$/i
const PALETTE = ['#8fb7ff', '#f6c177', '#6fcf97', '#c9a7ff', '#4fd1c5', '#ef9a9a', '#ffd08a', '#9ad0ff']

export function defaultProfile() {
  const collections = [
    { id: 'facts', label: '事实', icon: '◆', color: '#8fb7ff', order: 10, builtin: true },
    { id: 'decisions', label: '决策', icon: '◈', color: '#f6c177', order: 20, builtin: true },
    { id: 'projects', label: '项目', icon: '▣', color: '#6fcf97', order: 30, builtin: true },
    { id: 'notes', label: '笔记', icon: '▤', color: '#c9a7ff', order: 40, builtin: true },
  ]
  return {
    version: 1,
    name: 'my-memory',
    collections,
    groups: [
      { id: 'all', label: '全部记忆', collections: collections.map((c) => c.id) },
      { id: 'core', label: '基础', collections: ['facts', 'decisions'] },
      { id: 'work', label: '工作', collections: ['projects', 'notes'] },
    ],
  }
}

export function profileFile(settings) {
  return path.join(settings.memoryDir, 'index', 'profile.json')
}

function cleanId(value) {
  const id = String(value || '').trim()
  return ID_RE.test(id) ? id : ''
}

export function normalizeProfile(raw, { name = 'my-memory' } = {}) {
  const base = defaultProfile()
  const source = raw && typeof raw === 'object' ? raw : {}
  const collections = []
  const seen = new Set()
  const list = Array.isArray(source.collections) ? source.collections : []
  for (const item of list) {
    const id = cleanId(item?.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    collections.push({
      id,
      label: String(item.label || id).slice(0, 40),
      icon: String(item.icon || '▣').slice(0, 4),
      color: /^#[0-9a-f]{6}$/i.test(String(item.color || '')) ? String(item.color) : PALETTE[collections.length % PALETTE.length],
      order: Number(item.order) || 10 + collections.length * 10,
      ...(BUILTIN_KINDS.includes(id) ? { builtin: true } : {}),
    })
  }
  for (const id of BUILTIN_KINDS) {
    if (!seen.has(id)) {
      collections.push(base.collections.find((c) => c.id === id))
      seen.add(id)
    }
  }
  collections.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

  const ids = new Set(collections.map((c) => c.id))
  const groups = []
  for (const group of Array.isArray(source.groups) ? source.groups : []) {
    const id = cleanId(group?.id)
    const cols = (Array.isArray(group?.collections) ? group.collections : []).filter((x) => ids.has(x))
    if (!id || !cols.length || groups.some((g) => g.id === id)) continue
    groups.push({ id, label: String(group.label || id).slice(0, 40), collections: cols })
  }
  if (!groups.length) groups.push({ id: 'all', label: '全部记忆', collections: [...ids] })

  return {
    version: 1,
    name: String(source.name || name).slice(0, 60),
    updatedAt: new Date().toISOString(),
    collections,
    groups,
  }
}

export async function readProfile(settings) {
  const file = profileFile(settings)
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    return normalizeProfile(raw)
  } catch {
    return defaultProfile()
  }
}

export async function ensureProfile(settings) {
  const file = profileFile(settings)
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    return normalizeProfile(raw)
  } catch {
    const profile = defaultProfile()
    await writeProfile(settings, profile)
    return profile
  }
}

export async function writeProfile(settings, raw) {
  const profile = normalizeProfile(raw)
  const file = profileFile(settings)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = path.join(path.dirname(file), `.profile.${process.pid}.${randomBytes(3).toString('hex')}.tmp`)
  await fs.writeFile(tmp, `${JSON.stringify(profile, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, file)
  return profile
}

export async function ensureCollectionDirs(settings, profile) {
  for (const collection of profile.collections) {
    await fs.mkdir(path.join(settings.memoryDir, 'memory', collection.id), { recursive: true })
  }
}

export function collectionMap(profile) {
  return new Map(profile.collections.map((collection) => [collection.id, collection]))
}
