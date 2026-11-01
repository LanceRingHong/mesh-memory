/**
 * 索引基准：生成 N 条临时记忆，比较「索引检索」与「直接扫盘」。
 * 用法：node scripts/bench-index.mjs [N]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { settingsOf } from '../src/config.js'
import { walk, readInside, parseFrontmatter, searchMemory } from '../src/store.js'
import { extractLinks } from '../src/links.js'
import { syncIndex, indexStats, searchIndex, clearIndex, closeIndex } from '../src/indexdb.js'

const deps = {
  walk,
  readInside,
  parseFrontmatter,
  isConflictPath: (rel) => String(rel).includes('.sync-conflict-'),
  extractLinks,
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-bench-'))
const memoryDir = path.join(root, 'mem')
const dshHome = path.join(root, 'home')
await fs.mkdir(path.join(memoryDir, 'memory', 'facts'), { recursive: true })
await fs.mkdir(dshHome, { recursive: true })

const N = Number(process.argv[2] || 1000)
const words = ['召回', '索引', '图谱', '审阅', '冲突', '同步', '身份', '任务', '界面', '记忆', 'git', 'sqlite', 'windows', 'ssh', '平板']

for (let i = 0; i < N; i += 1) {
  const tag = words[i % words.length]
  const tag2 = words[(i * 7) % words.length]
  const body = `## 第 ${i} 条\n\n关于 ${tag} 与 ${tag2} 的一段说明。\n\n- 要点 A${i}\n- 要点 B${i}\n`
  const text = [
    '---',
    `title: "${tag} 记录 ${i}"`,
    `description: "${tag2} 的一句话描述"`,
    'kind: facts',
    `tags: ["${tag}"]`,
    'status: active',
    'updatedAt: "2026-11-01T10:00:00.000Z"',
    '---',
    '',
    body,
  ].join('\n')
  await fs.writeFile(path.join(memoryDir, 'memory', 'facts', `doc-${i}.md`), text, 'utf8')
}

const settings = { ...settingsOf({ memoryDir, dshHome, deviceName: 'bench' }), memoryDir, dshHome }

let t = performance.now()
const cold = await syncIndex(settings, deps)
console.log(`cold sync ${Math.round(performance.now() - t)} ms`, JSON.stringify(cold))
t = performance.now()
const warm = await syncIndex(settings, deps)
console.log(`warm sync ${Math.round(performance.now() - t)} ms`, JSON.stringify(warm))

const queries = ['召回 索引', '图谱', '审阅 冲突', '界面 记忆', 'ssh git', '平板 任务', 'sqlite', '同步 身份']
const times = []
let hits = 0
for (const q of queries) {
  for (let i = 0; i < 10; i += 1) {
    const start = performance.now()
    hits += searchIndex(settings, q, { limit: 20 }).length
    times.push(performance.now() - start)
  }
}
times.sort((a, b) => a - b)
console.log(
  `index search p50=${times[Math.floor(times.length * 0.5)].toFixed(1)} ms ` +
    `p95=${times[Math.floor(times.length * 0.95)].toFixed(1)} ms hits=${hits}`,
)

const scanTimes = []
for (const q of ['召回', '图谱', '审阅']) {
  const start = performance.now()
  await searchMemory(settings, q, 20)
  scanTimes.push(performance.now() - start)
}
console.log(`scan search avg ${(scanTimes.reduce((a, b) => a + b, 0) / scanTimes.length).toFixed(1)} ms`)
console.log('stats', JSON.stringify(indexStats(settings)))

clearIndex(settings)
closeIndex(settings)
await fs.rm(root, { recursive: true, force: true })

