import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * 召回流水：每次真实注入追加一行 JSONL。
 * 位置 `$DSH_HOME/dsh-mesh/recall.jsonl`（本机、不进同步目录），超 2 MB 自动裁到最近 500 条。
 * 用途：详情页回答"这条记忆最近被用到过没有"。
 */

const MAX_BYTES = 2_000_000
const KEEP_LINES = 500

export function recallLogPath(settings) {
  return path.join(settings.dshHome, 'dsh-mesh', 'recall.jsonl')
}

export async function recordRecall(settings, { query, files } = {}) {
  const file = recallLogPath(settings)
  const list = (Array.isArray(files) ? files : []).filter((item) => typeof item === 'string').slice(0, 20)
  if (!list.length) return
  const line = `${JSON.stringify({
    at: new Date().toISOString(),
    device: settings.deviceName || '',
    query: String(query || '').slice(0, 200),
    files: list,
  })}\n`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.appendFile(file, line, 'utf8')
  } catch {
    return
  }
  try {
    const info = await fs.stat(file)
    if (info.size <= MAX_BYTES) return
    const text = await fs.readFile(file, 'utf8')
    const kept = text.trim().split('\n').slice(-KEEP_LINES).join('\n')
    await fs.writeFile(file, `${kept}\n`, 'utf8')
  } catch {}
}

async function readAll(settings) {
  try {
    const text = await fs.readFile(recallLogPath(settings), 'utf8')
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

/** 最近的召回流水（时间倒序）；传 path 则只返回命中该条的记录。 */
export async function readRecallLog(settings, { limit = 100, path: target = '' } = {}) {
  const all = await readAll(settings)
  const wanted = String(target || '').replace(/\\/g, '/')
  const filtered = wanted ? all.filter((entry) => Array.isArray(entry.files) && entry.files.includes(wanted)) : all
  return filtered.reverse().slice(0, Math.max(1, Math.min(500, Number(limit) || 100)))
}

/** 每条记忆被召回的次数与最近一次时间，供列表/详情显示。 */
export async function recallCounts(settings) {
  const all = await readAll(settings)
  const counts = {}
  for (const entry of all) {
    for (const file of entry.files || []) {
      const item = counts[file] || { count: 0, lastAt: '' }
      item.count += 1
      if (String(entry.at || '') > item.lastAt) item.lastAt = String(entry.at || '')
      counts[file] = item
    }
  }
  return counts
}
