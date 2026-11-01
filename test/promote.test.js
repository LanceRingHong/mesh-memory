import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { makeSettings, writeMemoryFile, memoryDoc } from './helpers.js'
import { promotionCandidates } from '../src/promote.js'

async function writeRecallLog(dshHome, entries) {
  const dir = path.join(dshHome, 'dsh-mesh')
  await fs.mkdir(dir, { recursive: true })
  const lines = entries.map((entry) => JSON.stringify(entry)).join('\n')
  await fs.writeFile(path.join(dir, 'recall.jsonl'), `${lines}\n`, 'utf8')
}

const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString()

test('晋升：杂项被反复召回 → 建议升级分类', async (t) => {
  const { settings, memoryDir, dshHome, cleanup } = await makeSettings()
  t.after(cleanup)
  await writeMemoryFile(
    memoryDir,
    'memory/notes/idea.md',
    memoryDoc({ title: '一个被反复问到的问题', body: '先记在杂项里', extra: { kind: 'notes', permalink: 'idea-1' } }),
  )
  await writeRecallLog(dshHome, [
    { at: daysAgo(0), query: '问题一', files: ['memory/notes/idea.md'], items: [{ path: 'memory/notes/idea.md', score: 6, lane: 'hit' }] },
    { at: daysAgo(1), query: '问题二', files: ['memory/notes/idea.md'], items: [{ path: 'memory/notes/idea.md', score: 4, lane: 'hit' }] },
    { at: daysAgo(2), query: '问题三', files: ['memory/notes/idea.md'], items: [{ path: 'memory/notes/idea.md', score: 5, lane: 'hit' }] },
  ])

  const result = await promotionCandidates(settings)
  const hit = result.candidates.find((item) => item.path === 'memory/notes/idea.md')
  assert.ok(hit, '杂项应进入候选')
  assert.equal(hit.action, 'promote')
  assert.equal(hit.kind, 'notes')
  assert.equal(hit.recalls, 3)
  assert.equal(hit.queries, 3)
  assert.ok(hit.score > 0)
  assert.ok(hit.why.includes('升级'))
})

test('晋升：常被用到的 facts → 建议设 baseline；已有 baseline 的不再出现', async (t) => {
  const { settings, memoryDir, dshHome, cleanup } = await makeSettings()
  t.after(cleanup)
  await writeMemoryFile(
    memoryDir,
    'memory/facts/env.md',
    memoryDoc({ title: '环境速查', body: '代理端口 7897', extra: { kind: 'facts', permalink: 'env-1' } }),
  )
  await writeMemoryFile(
    memoryDir,
    'memory/facts/already.md',
    memoryDoc({ title: '已是基线', body: '已经 baseline', extra: { kind: 'facts', permalink: 'env-2', baseline: true } }),
  )
  const entries = []
  for (let i = 0; i < 6; i += 1) {
    const query = `问${i % 3}`
    // 跨两场会话：同一个会话里反复召回不足以建议 baseline。
    entries.push({
      at: daysAgo(i),
      session: i % 2 === 0 ? 'session-a' : 'session-b',
      query,
      files: ['memory/facts/env.md'],
      items: [{ path: 'memory/facts/env.md', score: 7, lane: 'hit' }],
    })
  }
  await writeRecallLog(dshHome, entries)

  const result = await promotionCandidates(settings)
  const env = result.candidates.find((item) => item.path === 'memory/facts/env.md')
  const already = result.candidates.find((item) => item.path === 'memory/facts/already.md')
  assert.ok(env, '未设 baseline 的应进入候选')
  assert.equal(env.action, 'baseline')
  assert.equal(already, undefined, '已 baseline 的不应重复建议')
})

test('晋升：长期没被召回 → 建议归档', async (t) => {
  const { settings, memoryDir, cleanup } = await makeSettings()
  t.after(cleanup)
  await writeMemoryFile(
    memoryDir,
    'memory/facts/old.md',
    memoryDoc({
      title: '很久没用的结论',
      body: '过期了',
      extra: { kind: 'facts', permalink: 'old-1', updatedAt: daysAgo(400) },
    }),
  )

  const result = await promotionCandidates(settings)
  const hit = result.candidates.find((item) => item.path === 'memory/facts/old.md')
  assert.ok(hit)
  assert.equal(hit.action, 'archive')
  assert.equal(hit.recalls, 0)
})

test('晋升：没有任何信号时返回空候选（不硬造）', async (t) => {
  const { settings, memoryDir, cleanup } = await makeSettings()
  t.after(cleanup)
  await writeMemoryFile(
    memoryDir,
    'memory/notes/fresh.md',
    memoryDoc({ title: '刚写的东西', body: '今天写的', extra: { kind: 'notes', permalink: 'fresh-1' } }),
  )
  const result = await promotionCandidates(settings)
  assert.equal(result.candidates.length, 0)
  assert.equal(result.scanned, 1)
})
