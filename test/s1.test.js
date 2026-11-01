import assert from 'node:assert/strict'
import test from 'node:test'
import { makeSettings, writeMemoryFile, memoryDoc } from './helpers.js'
import { buildLinkGraph, extractLinks, contextFor } from '../src/links.js'
import { explainRecall } from '../src/recall.js'

/** S1：弱边让图有结构；代码里的 `[[...]]` 不再算链接；召回测试台与真实注入同源。 */

test('代码块与行内代码里的 [[...]] 不算链接（S1 断链误报）', () => {
  const body = '正常链接：[[真实记忆]]\n\n讲解：用 `[[标题]]` 或 `[[permalink]]` 表示链接。\n\n```\n[[示例]]\n```'
  assert.deepEqual(extractLinks(body), ['真实记忆'])
})

test('共享 tag 的条目之间生成弱边，且 weak 边带 reason（S1 弱边）', async (t) => {
  const { settings, memoryDir, cleanup } = await makeSettings()
  t.after(cleanup)
  await writeMemoryFile(
    memoryDir,
    'memory/facts/a.md',
    memoryDoc({ title: 'A', description: '甲', body: '正文 A', extra: { tags: ['网络', 'ssh'] } }),
  )
  await writeMemoryFile(
    memoryDir,
    'memory/facts/b.md',
    memoryDoc({ title: 'B', description: '乙', body: '正文 B', extra: { tags: ['ssh'] } }),
  )
  await writeMemoryFile(
    memoryDir,
    'memory/facts/c.md',
    memoryDoc({ title: 'C', description: '丙', body: '正文 C', extra: { tags: ['无关'] } }),
  )
  const graph = await buildLinkGraph(settings)
  assert.equal(graph.edges.length, 1)
  const edge = graph.edges[0]
  assert.equal(edge.type, 'weak')
  assert.equal(edge.reason, 'tag:ssh')
  assert.equal(graph.stats.weak, 1)
  assert.equal(graph.stats.strong, 0)
  assert.equal(graph.broken.length, 0)
})

test('弱边不参与 context 扩散（只沿手写 wikilink）', async (t) => {
  const { settings, memoryDir, cleanup } = await makeSettings()
  t.after(cleanup)
  await writeMemoryFile(
    memoryDir,
    'memory/facts/a.md',
    memoryDoc({ title: 'A', description: '甲', body: '见 [[B]]', extra: { tags: ['same'] } }),
  )
  await writeMemoryFile(
    memoryDir,
    'memory/facts/b.md',
    memoryDoc({ title: 'B', description: '乙', body: '正文 B', extra: { tags: ['same'] } }),
  )
  await writeMemoryFile(
    memoryDir,
    'memory/facts/c.md',
    memoryDoc({ title: 'C', description: '丙', body: '正文 C', extra: { tags: ['same'] } }),
  )
  const graph = await buildLinkGraph(settings)
  assert.equal(graph.stats.strong, 1, 'A→B 是强边')
  assert.ok(graph.stats.weak >= 1, '同 tag 还有弱边')
  const ctx = await contextFor(settings, { path: 'memory/facts/a.md', depth: 1, limit: 10 })
  assert.ok(ctx.items.some((item) => item.path === 'memory/facts/b.md'), '强边邻居应在上下文里')
})

test('explainRecall 返回分数、预算与注入文本（与注入同源）', async (t) => {
  const { settings, memoryDir, cleanup } = await makeSettings()
  t.after(cleanup)
  await writeMemoryFile(
    memoryDir,
    'memory/facts/a.md',
    memoryDoc({
      title: 'SSH 只允许密钥登录',
      description: 'sshd 关闭密码认证',
      body: '配置 PasswordAuthentication no，并限制来源网段。',
      extra: { tags: ['ssh'] },
    }),
  )
  await writeMemoryFile(
    memoryDir,
    'memory/facts/b.md',
    memoryDoc({ title: '无关主题', description: '烹饪', body: '红烧肉要焯水。' }),
  )
  const result = await explainRecall(settings, 'ssh 密钥登录怎么配')
  assert.ok(result.hits >= 1, '应至少命中一条')
  assert.ok(result.detail.hits[0].score > 0)
  assert.equal(result.detail.hits[0].path, 'memory/facts/a.md')
  assert.ok(result.text.includes('<dsh-mesh-memory>'))
  assert.ok(result.detail.budget.used > 0)
  assert.equal(result.detail.budget.limit, settings.recallMaxChars || 6000)
  assert.ok(result.detail.budget.sections.hits > 0)
})

test('explainRecall 对空查询返回空结果而不抛错', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  const result = await explainRecall(settings, 'zzzz-不存在的词')
  assert.equal(result.hits, 0)
  assert.equal(result.text, '')
})
