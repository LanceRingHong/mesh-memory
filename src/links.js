import path from 'node:path'
import { parseFrontmatter, readInside, isDocValid, isConflictPath, walk, searchMemory } from './store.js'

// 排除 ASCII 括号：`[[标题](url)` 这类 Markdown 链接曾被误判成 wikilink。
const LINK_RE = /\[\[([^\[\]()|#]+)(?:#[^\[\]|]+)?(?:\|[^\]]+)?\]\]/g

export function extractLinks(body) {
  const out = []
  // 代码块/行内代码里的 `[[标题]]` 是在讲解语法，不是真链接。
  const text = String(body || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
  let match
  while ((match = LINK_RE.exec(text))) {
    const target = String(match[1] || '').trim()
    if (target) out.push(target)
  }
  return [...new Set(out)]
}

function norm(value) {
  return String(value || '').trim().toLowerCase().replace(/\.md$/i, '')
}

async function loadDocs(settings) {
  const docs = []
  for (const file of await walk(settings.memoryDir, 'memory')) {
    const rel = path.relative(settings.memoryDir, file).replace(/\\/g, '/')
    if (isConflictPath(rel)) continue
    let text = ''
    try {
      text = await readInside(settings, rel, { maxBytes: 2_000_000 })
    } catch {
      continue
    }
    const parsed = parseFrontmatter(text)
    docs.push({
      path: rel,
      title: String(parsed.attrs.title || ''),
      permalink: String(parsed.attrs.permalink || ''),
      kind: String(parsed.attrs.kind || ''),
      status: String(parsed.attrs.status || 'active'),
      tags: Array.isArray(parsed.attrs.tags) ? parsed.attrs.tags : [],
      device: String(parsed.attrs.device || ''),
      source: String(parsed.attrs.source || ''),
      updatedAt: String(parsed.attrs.updatedAt || parsed.attrs.createdAt || ''),
      body: String(parsed.body || ''),
      valid: isDocValid(parsed.attrs),
      links: extractLinks(parsed.body),
    })
  }
  return docs
}

const WEAK_LIMIT = 3
const WEAK_MAX_DOCS = 500
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function pairKey(a, b) {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
}

/**
 * 弱边：没有手写 `[[...]]` 时也能让图有结构。
 * 依据强弱排序：共享 tag > 同来源（同一会话/任务）> 同分类 + 同设备 + 7 天内。
 * 只做双向去重、每个节点最多 WEAK_LIMIT 条，避免图上糊成毛线球。
 */
function addWeakEdges(docs, edges) {
  if (docs.length > WEAK_MAX_DOCS) return
  const taken = new Set(edges.map((edge) => pairKey(edge.from, edge.to)))
  const degree = new Map()
  const bump = (p) => degree.set(p, (degree.get(p) || 0) + 1)
  const tryAdd = (a, b, reason) => {
    const key = pairKey(a, b)
    if (a === b || taken.has(key)) return false
    if ((degree.get(a) || 0) >= WEAK_LIMIT || (degree.get(b) || 0) >= WEAK_LIMIT) return false
    taken.add(key)
    bump(a)
    bump(b)
    edges.push({ from: a, to: b, type: 'weak', reason })
    return true
  }
  const parsedAt = (value) => {
    const t = Date.parse(String(value || ''))
    return Number.isFinite(t) ? t : null
  }

  for (const doc of docs) {
    if ((degree.get(doc.path) || 0) >= WEAK_LIMIT) continue
    const sharedTag = new Map()
    for (const other of docs) {
      if (other.path === doc.path) continue
      if (!doc.tags.length || !other.tags.length) continue
      const hit = doc.tags.find((tag) => other.tags.includes(tag))
      if (hit) sharedTag.set(other.path, hit)
    }
    for (const [path, tag] of [...sharedTag.entries()].slice(0, WEAK_LIMIT)) {
      tryAdd(doc.path, path, `tag:${tag}`)
    }
    if (doc.source) {
      for (const other of docs) {
        if (other.path === doc.path || other.source !== doc.source) continue
        if (!tryAdd(doc.path, other.path, 'source')) continue
      }
    }
    const mine = parsedAt(doc.updatedAt)
    if (mine && doc.device) {
      for (const other of docs) {
        if (other.path === doc.path || other.kind !== doc.kind || other.device !== doc.device) continue
        const theirs = parsedAt(other.updatedAt)
        if (!theirs || Math.abs(mine - theirs) > WEEK_MS) continue
        if (!tryAdd(doc.path, other.path, 'nearby')) continue
      }
    }
  }
}

/** 构建关系图：节点 + 强边（wikilink）+ 弱边（tag/来源/同分类邻近）+ 断链。 */
export async function buildLinkGraph(settings) {
  const docs = await loadDocs(settings)
  const byKey = new Map()
  for (const doc of docs) {
    if (doc.permalink) byKey.set(norm(doc.permalink), doc)
    if (doc.title) byKey.set(norm(doc.title), doc)
    byKey.set(norm(path.basename(doc.path, '.md')), doc)
  }
  const edges = []
  const broken = []
  for (const doc of docs) {
    for (const link of doc.links) {
      const target = byKey.get(norm(link))
      if (target && target.path !== doc.path) edges.push({ from: doc.path, to: target.path, label: link, type: 'link' })
      else if (!target) broken.push({ from: doc.path, link })
    }
  }
  addWeakEdges(docs, edges)
  const weakCount = edges.filter((edge) => edge.type === 'weak').length
  return {
    nodes: docs.map((doc) => ({
      path: doc.path,
      title: doc.title,
      permalink: doc.permalink,
      kind: doc.kind,
      status: doc.status,
      tags: doc.tags,
      device: doc.device,
      valid: doc.valid,
      links: doc.links.length,
    })),
    edges,
    broken,
    stats: { nodes: docs.length, strong: edges.length - weakCount, weak: weakCount, broken: broken.length },
  }
}

/** 以一条或一组条目为种子，沿 wikilink 取 1 跳上下文。 */
export async function contextFor(settings, { path: seedPath, query, depth = 1, limit = 8 } = {}) {
  const graph = await buildLinkGraph(settings)
  const byPath = new Map(graph.nodes.map((node) => [node.path, node]))
  let seeds = []
  if (seedPath) {
    const key = String(seedPath).replace(/\\/g, '/').replace(/^\.\//, '')
    if (byPath.has(key)) seeds = [key]
  } else if (query) {
    const hits = await searchMemory(settings, query, 5)
    seeds = hits.map((hit) => hit.path).filter((p) => byPath.has(p))
  }
  const visited = new Set(seeds)
  let frontier = [...seeds]
  const relations = new Map(seeds.map((p) => [p, 'seed']))
  const maxDepth = Math.max(1, Math.min(2, Number(depth) || 1))
  // 只沿强边（手写 wikilink）扩散：弱边是给人看的，不该把上下文撑爆。
  const walkEdges = graph.edges.filter((edge) => edge.type !== 'weak')
  for (let d = 0; d < maxDepth; d += 1) {
    const next = []
    for (const node of frontier) {
      for (const edge of walkEdges) {
        let other = null
        if (edge.from === node && !visited.has(edge.to)) other = edge.to
        else if (edge.to === node && !visited.has(edge.from)) other = edge.from
        if (!other) continue
        visited.add(other)
        relations.set(other, edge.from === node ? 'out' : 'in')
        next.push(other)
      }
    }
    frontier = next
    if (!frontier.length) break
  }
  const items = []
  for (const rel of visited) {
    const node = byPath.get(rel)
    if (!node) continue
    let excerpt = ''
    try {
      const parsed = parseFrontmatter(await readInside(settings, rel, { maxBytes: 300_000 }))
      excerpt = String(parsed.body || '').replace(/\s+/g, ' ').slice(0, 600)
    } catch {}
    items.push({ ...node, relation: relations.get(rel) || 'seed', excerpt })
    if (items.length >= Math.max(1, Number(limit) || 8)) break
  }
  return { seeds, depth: maxDepth, count: items.length, items, broken: graph.broken.slice(0, 20) }
}
