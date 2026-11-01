import fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { tokenize } from './recall.js'

/**
 * 本机索引（可丢弃投影）。
 * 位置 `$DSH_HOME/dsh-memory/index.db`，不进同步目录；删掉随时能从 Markdown 全量重建。
 *
 * 两个用途：
 * 1. 全文检索（中文用 bigram 落 tokens 列，2 字词也能命中）；
 * 2. 缓存正文，避免每次召回都读一遍磁盘（按 path + mtime + size 判新旧）。
 */

export function indexPath(settings) {
  return path.join(settings.dshHome, 'dsh-memory', 'index.db')
}

const connections = new Map()

function open(settings) {
  const file = indexPath(settings)
  const cached = connections.get(file)
  if (cached) return cached
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS docs (
      path TEXT PRIMARY KEY,
      title TEXT, description TEXT, kind TEXT, status TEXT,
      device TEXT, agent TEXT, tags TEXT, permalink TEXT,
      updated_at TEXT, mtime_ms REAL, size INTEGER, checksum TEXT, body TEXT
    );
    CREATE TABLE IF NOT EXISTS links (from_path TEXT, target TEXT, UNIQUE(from_path, target));
    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(path UNINDEXED, title, tokens);
  `)
  connections.set(file, db)
  return db
}

async function ensureDir(settings) {
  await fs.mkdir(path.dirname(indexPath(settings)), { recursive: true })
}

function tokensOf(title, description, tags, body) {
  return tokenize(`${title} ${description} ${tags} ${body}`).join(' ')
}

/** 把一条记忆写进索引（含 FTS 与正文缓存）。 */
export function upsertDoc(settings, doc) {
  const db = open(settings)
  const tags = (doc.tags || []).join(' ')
  db.prepare(
    `INSERT INTO docs (path,title,description,kind,status,device,agent,tags,permalink,updated_at,mtime_ms,size,checksum,body)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(path) DO UPDATE SET
       title=excluded.title, description=excluded.description, kind=excluded.kind, status=excluded.status,
       device=excluded.device, agent=excluded.agent, tags=excluded.tags, permalink=excluded.permalink,
       updated_at=excluded.updated_at, mtime_ms=excluded.mtime_ms, size=excluded.size,
       checksum=excluded.checksum, body=excluded.body`,
  ).run(
    doc.path,
    doc.title || '',
    doc.description || '',
    doc.kind || '',
    doc.status || 'active',
    doc.device || '',
    doc.agent || '',
    tags,
    doc.permalink || '',
    doc.updatedAt || '',
    Number(doc.mtimeMs) || 0,
    Number(doc.size) || 0,
    doc.checksum || '',
    doc.body || '',
  )
  db.prepare('DELETE FROM docs_fts WHERE path = ?').run(doc.path)
  db.prepare('INSERT INTO docs_fts (path, title, tokens) VALUES (?,?,?)').run(
    doc.path,
    doc.title || '',
    tokensOf(doc.title, doc.description, tags, doc.body),
  )
  if (Array.isArray(doc.links)) {
    db.prepare('DELETE FROM links WHERE from_path = ?').run(doc.path)
    const ins = db.prepare('INSERT OR IGNORE INTO links (from_path, target) VALUES (?,?)')
    for (const target of doc.links.slice(0, 200)) ins.run(doc.path, String(target))
  }
  return true
}

export function removeDoc(settings, relPath) {
  const db = open(settings)
  db.prepare('DELETE FROM docs WHERE path = ?').run(relPath)
  db.prepare('DELETE FROM docs_fts WHERE path = ?').run(relPath)
  db.prepare('DELETE FROM links WHERE from_path = ?').run(relPath)
}

/** 按 path + mtime + size 命中缓存就返回正文，否则 null（调用方自己去读文件）。 */
export function cachedText(settings, relPath, stat) {
  try {
    const db = open(settings)
    const row = db.prepare('SELECT body, mtime_ms, size FROM docs WHERE path = ?').get(relPath)
    if (!row) return null
    if (Number(row.mtime_ms) !== Number(stat.mtimeMs) || Number(row.size) !== Number(stat.size)) return null
    return String(row.body ?? '')
  } catch {
    return null
  }
}

export function indexStats(settings) {
  try {
    const db = open(settings)
    const docs = db.prepare('SELECT COUNT(*) c FROM docs').get().c
    const fts = db.prepare('SELECT COUNT(*) c FROM docs_fts').get().c
    return { available: true, path: indexPath(settings), docs: Number(docs), fts: Number(fts) }
  } catch (error) {
    return { available: false, path: indexPath(settings), docs: 0, fts: 0, reason: String(error?.message || error) }
  }
}

export function clearIndex(settings) {
  const db = open(settings)
  db.exec('DELETE FROM docs; DELETE FROM docs_fts; DELETE FROM links;')
}

/** 关闭并丢弃连接（测试/基准收尾用）。 */
export function closeIndex(settings) {
  const file = indexPath(settings)
  const db = connections.get(file)
  if (!db) return
  try {
    db.close()
  } catch {}
  connections.delete(file)
}

/** 全文检索：返回按相关度排序的记忆元数据。 */
export function searchIndex(settings, query, { limit = 20, kind, status, device, tag } = {}) {
  const terms = [...new Set(tokenize(query))].slice(0, 16)
  if (!terms.length) return []
  const db = open(settings)
  const match = terms.map((term) => `"${term.replace(/"/g, '')}"`).join(' OR ')
  const where = ['docs_fts MATCH ?']
  const params = [match]
  if (kind) {
    where.push('d.kind = ?')
    params.push(kind)
  }
  if (status) {
    where.push('d.status = ?')
    params.push(status)
  }
  if (device) {
    where.push('d.device = ?')
    params.push(device)
  }
  if (tag) {
    where.push('d.tags LIKE ?')
    params.push(`%${tag}%`)
  }
  const sql = `SELECT d.path, d.title, d.description, d.kind, d.status, d.device, d.updated_at,
                      bm25(docs_fts) AS score
               FROM docs_fts JOIN docs d ON d.path = docs_fts.path
               WHERE ${where.join(' AND ')}
               ORDER BY score LIMIT ?`
  params.push(Math.max(1, Math.min(200, Number(limit) || 20)))
  return db.prepare(sql).all(...params).map((row) => ({
    path: String(row.path),
    title: String(row.title || ''),
    description: String(row.description || ''),
    kind: String(row.kind || ''),
    status: String(row.status || ''),
    device: String(row.device || ''),
    updatedAt: String(row.updated_at || ''),
    score: Math.round(Number(row.score) * 1000) / 1000,
  }))
}

/**
 * 全量同步：walk 一遍 memory/，按 path + mtime + size 判断新旧。
 * 返回 {added, updated, removed, total}，供 /api/index/sync 与启动时调用。
 */
export async function syncIndex(settings, { walk, readInside, parseFrontmatter, isConflictPath, extractLinks } = {}) {
  if (!walk) throw new Error('syncIndex 需要注入 walk/readInside 等依赖')
  await ensureDir(settings)
  const db = open(settings)
  const existing = new Map()
  for (const row of db.prepare('SELECT path, mtime_ms, size FROM docs').all()) {
    existing.set(String(row.path), { mtimeMs: Number(row.mtime_ms), size: Number(row.size) })
  }
  const seen = new Set()
  let added = 0
  let updated = 0
  for (const file of await walk(settings.memoryDir, 'memory')) {
    const rel = path.relative(settings.memoryDir, file).replace(/\\/g, '/')
    if (isConflictPath && isConflictPath(rel)) continue
    let stat
    try {
      stat = await fs.stat(file)
    } catch {
      continue
    }
    seen.add(rel)
    const prev = existing.get(rel)
    if (prev && prev.mtimeMs === stat.mtimeMs && prev.size === stat.size) continue
    let text
    try {
      text = await readInside(settings, rel, { maxBytes: 2_000_000 })
    } catch {
      continue
    }
    const parsed = parseFrontmatter(text)
    upsertDoc(settings, {
      path: rel,
      title: String(parsed.attrs.title || path.basename(rel, '.md')),
      description: String(parsed.attrs.description || ''),
      kind: String(parsed.attrs.kind || rel.split('/')[1] || 'notes'),
      status: String(parsed.attrs.status || 'active'),
      device: String(parsed.attrs.device || ''),
      agent: String(parsed.attrs.agent || ''),
      tags: Array.isArray(parsed.attrs.tags) ? parsed.attrs.tags : [],
      permalink: String(parsed.attrs.permalink || ''),
      updatedAt: String(parsed.attrs.updatedAt || parsed.attrs.createdAt || ''),
      checksum: String(parsed.attrs.checksum || ''),
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      body: String(parsed.body || ''),
      links: extractLinks ? extractLinks(parsed.body) : [],
    })
    if (prev) updated += 1
    else added += 1
  }
  let removed = 0
  for (const rel of existing.keys()) {
    if (seen.has(rel)) continue
    removeDoc(settings, rel)
    removed += 1
  }
  return { added, updated, removed, total: seen.size }
}
