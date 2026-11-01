import { walk, readInside, parseFrontmatter } from './store.js'
import { readRecallLog } from './recall-log.js'

/**
 * 晋升候选（0.25.0）：把「被反复召回、或长期没人用」的记忆挑出来，给出可执行的动作。
 *
 * 参考 OpenClaw Dreaming 的 Deep 阶段，但**不自动写**：这里只产出候选，动作由人/客户端执行
 * （设 baseline、升级到正式分类、归档冷门）。打分是确定性的，不调用模型。
 *
 * 六个信号（权重参考 OpenClaw，做了本地化）：
 *   relevance .30（命中分均值）· frequency .24（被召回次数）· diversity .15（不同 query 数）
 *   recency .15（30 天半衰期）· consolidation .10（跨天出现天数）· richness .06（标签密度）
 *
 * 注意：`baseline` 建议额外要求**跨 ≥2 场会话**——同一场对话里被反复召回只说明"这一题在用"，
 * 不说明"每场都该注入"（recall.jsonl 从 0.25.0 起记 session）。
 */

const DAY = 86_400_000
const WEIGHTS = { relevance: 0.3, frequency: 0.24, diversity: 0.15, recency: 0.15, consolidation: 0.1, richness: 0.06 }
const DEFAULTS = {
  minRecall: 2, // 至少被召回几次才算"常被用到"
  minQueries: 2, // 至少来自几个不同问题
  baselineRecall: 5,
  baselineQueries: 3,
  archiveAfterDays: 180, // 多久没用过就建议归档
  limit: 20,
}

const norm = (value) => String(value || '').trim().toLowerCase()

async function loadDocs(settings) {
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

function statsOf(entries) {
  const stats = new Map()
  for (const entry of entries) {
    const at = Date.parse(String(entry.at || ''))
    const items = Array.isArray(entry.items) && entry.items.length
      ? entry.items
      : (Array.isArray(entry.files) ? entry.files : []).map((path) => ({ path, score: 0, lane: 'legacy' }))
    for (const item of items) {
      const path = String(item?.path || '').replace(/\\/g, '/')
      if (!path) continue
      const current = stats.get(path) || {
        count: 0,
        queries: new Set(),
        days: new Set(),
        sessions: new Set(),
        lastAt: 0,
        scoreSum: 0,
        scoreN: 0,
      }
      current.count += 1
      if (entry.query) current.queries.add(String(entry.query).slice(0, 120))
      // 同一场对话里被反复召回 ≠ 跨情境需要：会话数单独计，baseline 要求跨会话。
      if (entry.session) current.sessions.add(String(entry.session).slice(0, 60))
      if (Number.isFinite(at)) {
        current.days.add(new Date(at).toISOString().slice(0, 10))
        current.lastAt = Math.max(current.lastAt, at)
      }
      const score = Number(item?.score)
      if (Number.isFinite(score) && score > 0) {
        current.scoreSum += score
        current.scoreN += 1
      }
      stats.set(path, current)
    }
  }
  return stats
}

function pickAction(doc, stat, ageDays, opts) {
  const count = stat?.count || 0
  const diversity = stat?.queries.size || 0
  const sessions = stat?.sessions.size || 0
  if (doc.kind === 'notes' && count >= opts.minRecall && diversity >= opts.minQueries) {
    return { action: 'promote', targetKind: '研究', why: `杂项被召回 ${count} 次（${diversity} 个问题），值得升级为正式记忆` }
  }
  if (
    doc.baseline !== true &&
    (doc.kind === 'facts' || doc.kind === 'decisions') &&
    count >= opts.baselineRecall &&
    diversity >= opts.baselineQueries &&
    sessions >= 2
  ) {
    return {
      action: 'baseline',
      why: `跨 ${sessions} 场对话被反复用到（${count} 次 / ${diversity} 个问题），适合每场开场注入`,
    }
  }
  if (count === 0 && ageDays >= opts.archiveAfterDays) {
    return { action: 'archive', why: `${Math.round(ageDays)} 天没有被召回，建议归档（可恢复）` }
  }
  return null
}

export async function promotionCandidates(settings, options = {}) {
  const opts = { ...DEFAULTS, ...options }
  const entries = await readRecallLog(settings, { limit: 500 })
  const stats = statsOf(entries)
  const docs = await loadDocs(settings)
  const now = Date.now()

  const maxCount = Math.max(1, ...[...stats.values()].map((s) => s.count))
  const maxDiv = Math.max(1, ...[...stats.values()].map((s) => s.queries.size))
  const maxDays = Math.max(1, ...[...stats.values()].map((s) => s.days.size))
  const avgScores = [...stats.values()].filter((s) => s.scoreN > 0).map((s) => s.scoreSum / s.scoreN)
  const maxScore = Math.max(1e-6, ...avgScores)

  const candidates = []
  for (const doc of docs) {
    const stat = stats.get(doc.path)
    const ageDays = Math.max(0, (now - (Date.parse(doc.updatedAt) || now)) / DAY)
    const picked = pickAction(doc, stat, ageDays, opts)
    if (!picked) continue
    const recency = Math.exp(-ageDays / 30)
    const relevance = stat && stat.scoreN ? stat.scoreSum / stat.scoreN / maxScore : 0
    const frequency = stat ? stat.count / maxCount : 0
    const diversity = stat ? stat.queries.size / maxDiv : 0
    const consolidation = stat ? stat.days.size / maxDays : 0
    const richness = Math.min(doc.tags.length, 5) / 5
    const score = Math.round(
      100 *
        (WEIGHTS.relevance * relevance +
          WEIGHTS.frequency * frequency +
          WEIGHTS.diversity * diversity +
          WEIGHTS.recency * recency +
          WEIGHTS.consolidation * consolidation +
          WEIGHTS.richness * richness),
    )
    candidates.push({
      path: doc.path,
      title: doc.title,
      kind: doc.kind,
      action: picked.action,
      ...(picked.targetKind ? { targetKind: picked.targetKind } : {}),
      why: picked.why,
      score,
      recalls: stat?.count || 0,
      queries: stat?.queries.size || 0,
      sessions: stat?.sessions.size || 0,
      lastAt: stat?.lastAt ? new Date(stat.lastAt).toISOString() : '',
      signals: {
        relevance: Math.round(relevance * 100) / 100,
        frequency: Math.round(frequency * 100) / 100,
        diversity: Math.round(diversity * 100) / 100,
        recency: Math.round(recency * 100) / 100,
        consolidation: Math.round(consolidation * 100) / 100,
        richness: Math.round(richness * 100) / 100,
      },
    })
  }

  candidates.sort((a, b) => b.score - a.score || b.recalls - a.recalls)
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    weights: WEIGHTS,
    scanned: docs.length,
    recalls: entries.length,
    candidates: candidates.slice(0, Math.max(1, Number(opts.limit) || 20)),
  }
}
