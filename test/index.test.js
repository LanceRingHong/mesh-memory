import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { makeSettings, writeMemoryFile, memoryDoc } from './helpers.js'
import { walk, readInside, parseFrontmatter } from '../src/store.js'
import { extractLinks } from '../src/links.js'
import { syncIndex, searchIndex, indexStats, cachedText, clearIndex, closeIndex } from '../src/indexdb.js'

const deps = {
  walk,
  readInside,
  parseFrontmatter,
  isConflictPath: (rel) => String(rel).includes('.sync-conflict-'),
  extractLinks,
}

test('索引：增量同步 + 中文两个字也能命中', async (t) => {
  const { settings, memoryDir, cleanup } = await makeSettings()
  t.after(async () => {
    closeIndex(settings)
    await cleanup()
  })
  await writeMemoryFile(
    memoryDir,
    'memory/facts/a.md',
    memoryDoc({ title: 'SSH 只允许密钥', description: '关闭密码登录', body: '配置 PasswordAuthentication no' }),
  )
  await writeMemoryFile(
    memoryDir,
    'memory/facts/b.md',
    memoryDoc({ title: '红烧肉做法', description: '焯水后炖', body: '五花肉切块' }),
  )
  const first = await syncIndex(settings, deps)
  assert.equal(first.added, 2)
  assert.equal(indexStats(settings).docs, 2)

  const hits = searchIndex(settings, '密钥', { limit: 5 })
  assert.equal(hits.length, 1)
  assert.match(hits[0].path, /a\.md$/)

  // 再同步一次：没有变化就不应重复计数
  const second = await syncIndex(settings, deps)
  assert.equal(second.added, 0)
  assert.equal(second.updated, 0)
})

test('索引：正文变化后重新同步会更新，且正文缓存随之失效', async (t) => {
  const { settings, memoryDir, cleanup } = await makeSettings()
  t.after(async () => {
    closeIndex(settings)
    await cleanup()
  })
  const file = path.join(memoryDir, 'memory/facts/c.md')
  await writeMemoryFile(
    memoryDir,
    'memory/facts/c.md',
    memoryDoc({ title: '索引缓存', description: '第一版', body: '旧内容' }),
  )
  await syncIndex(settings, deps)
  const stat1 = await fs.stat(file)
  assert.match(String(cachedText(settings, 'memory/facts/c.md', stat1)), /旧内容/)

  await new Promise((resolve) => setTimeout(resolve, 12))
  await fs.writeFile(
    file,
    memoryDoc({ title: '索引缓存', description: '第二版', body: '新内容 key2' }),
    'utf8',
  )
  const result = await syncIndex(settings, deps)
  assert.equal(result.updated, 1)

  const stat2 = await fs.stat(file)
  // mtime/size 变了 → 缓存必须失效
  assert.equal(cachedText(settings, 'memory/facts/c.md', stat1), null)
  assert.match(String(cachedText(settings, 'memory/facts/c.md', stat2)), /key2/)
})

test('索引：重建后条目数一致，过滤条件生效', async (t) => {
  const { settings, memoryDir, cleanup } = await makeSettings()
  t.after(async () => {
    closeIndex(settings)
    await cleanup()
  })
  await writeMemoryFile(
    memoryDir,
    'memory/facts/d.md',
    memoryDoc({ title: '决策记录', description: '关于索引', body: '正文', extra: { kind: 'decisions' } }),
  )
  await writeMemoryFile(
    memoryDir,
    'memory/facts/e.md',
    memoryDoc({ title: '事实记录', description: '关于索引', body: '正文' }),
  )
  await syncIndex(settings, deps)
  assert.equal(searchIndex(settings, '索引', { limit: 5 }).length, 2)
  assert.equal(searchIndex(settings, '索引', { limit: 5, kind: 'decisions' }).length, 1)

  clearIndex(settings)
  assert.equal(indexStats(settings).docs, 0)
  const rebuilt = await syncIndex(settings, deps)
  assert.equal(rebuilt.added, 2)
})

