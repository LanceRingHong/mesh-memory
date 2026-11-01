import path from 'node:path'
import { parseFrontmatter, readInside, isDocValid, isConflictPath, walk, searchMemory } from './store.js'

const LINK_RE = /\[\[([^\[\]|#]+)(?:#[^\[\]|]+)?(?:\|[^\]]+)?\]\]/g

export function extractLinks(body) {
  const out = []
  const text = String(body || '')
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
      body: String(parsed.body || ''),
      valid: isDocValid(parsed.attrs),
      links: extractLinks(parsed.body),
    })
  }
  return docs
}

/** 构建 [[wikilink]] 图：节点 + 有向边 + 断链。 */
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
      if (target && target.path !== doc.path) edges.push({ from: doc.path, to: target.path, label: link })
      else if (!target) broken.push({ from: doc.path, link })
    }
  }
  return {
    nodes: docs.map((doc) => ({
      path: doc.path,
      title: doc.title,
      permalink: doc.permalink,
      kind: doc.kind,
      status: doc.status,
      tags: doc.tags,
      valid: doc.valid,
      links: doc.links.length,
    })),
    edges,
    broken,
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
  for (let d = 0; d < maxDepth; d += 1) {
    const next = []
    for (const node of frontier) {
      for (const edge of graph.edges) {
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
