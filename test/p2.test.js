import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import * as store from '../src/store.js'
import * as query from '../src/query.js'
import * as lifecycle from '../src/lifecycle.js'
import * as links from '../src/links.js'
import * as tasks from '../src/tasks.js'
import { makeSettings } from './helpers.js'

function rel(settings, file) {
  return path.relative(settings.memoryDir, file).replace(/\\/g, '/')
}

test('queryMemory：按 kind/tag/status 过滤（0.12.0）', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  await store.writeNote(settings, { kind: 'facts', title: 'fact a', content: 'x', tags: ['alpha'] })
  await store.writeNote(settings, { kind: 'decisions', title: 'decision b', content: 'y', tags: ['beta'] })

  const facts = await query.queryMemory(settings, { kind: 'facts' })
  assert.equal(facts.count, 1)
  assert.equal(facts.items[0].title, 'fact a')
  assert.equal(facts.items[0].status, 'active')

  const tagged = await query.queryMemory(settings, { tag: 'beta' })
  assert.equal(tagged.count, 1)
  assert.equal(tagged.items[0].kind, 'decisions')

  const statuses = await query.statusCounts(settings)
  assert.equal(statuses.active, 2)
})

test('lifecycle：归档后搜索/有效性排除，unarchive 恢复（0.12.0）', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  const file = await store.writeNote(settings, { kind: 'facts', title: 'archivable', content: 'body' })
  const relPath = rel(settings, file)

  await assert.rejects(() => lifecycle.archiveNote(settings, relPath, { confirm: false }), /confirm/)
  const archived = await lifecycle.archiveNote(settings, relPath, { confirm: true })
  assert.equal(archived.status, 'archived')
  const attrs = store.parseFrontmatter(await store.readMemory(settings, relPath)).attrs
  assert.equal(attrs.status, 'archived')
  assert.ok(attrs.archivedAt)
  assert.equal(store.isDocValid(attrs), false)
  assert.equal((await store.searchMemory(settings, 'archivable')).length, 0)

  const restored = await lifecycle.unarchiveNote(settings, relPath)
  assert.equal(restored.status, 'active')
  const after = store.parseFrontmatter(await store.readMemory(settings, relPath)).attrs
  assert.equal(after.status, 'active')
  assert.equal(after.invalidAt, undefined)
  assert.equal((await store.searchMemory(settings, 'archivable')).length, 1)
})

test('links：wikilink 图与 1 跳上下文（0.12.0）', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  const target = await store.writeNote(settings, { kind: 'facts', title: '目标笔记', content: 'target body' })
  await store.writeNote(settings, {
    kind: 'facts',
    title: '种子笔记',
    content: `seed body [[目标笔记]] and [[不存在的笔记]]`,
  })

  const graph = await links.buildLinkGraph(settings)
  assert.equal(graph.nodes.length, 2)
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.broken.length, 1)
  assert.equal(graph.edges[0].to, rel(settings, target))

  const ctx = await links.contextFor(settings, { path: rel(settings, await store.writeNote(settings, { kind: 'facts', title: 'x', content: 'x' })) })
  assert.ok(ctx.count >= 1)

  const seedRel = graph.nodes.find((n) => n.title === '种子笔记').path
  const around = await links.contextFor(settings, { path: seedRel, depth: 1 })
  assert.equal(around.seeds.length, 1)
  assert.ok(around.items.some((item) => item.title === '目标笔记' && item.relation === 'out'))
})

test('tasks：创建/更新/列表/取消与汇总（0.12.0）', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  const task = await tasks.createTask(settings, { title: 'deploy', prompt: 'do it', hostId: 'h1' })
  assert.equal(task.status, 'queued')
  assert.match(task.id, /^task-/)

  const running = await tasks.updateTask(settings, task.id, { status: 'running', sessionId: 's1' })
  assert.equal(running.status, 'running')
  assert.equal(running.sessionId, 's1')

  const list = await tasks.listTasks(settings, { status: 'running' })
  assert.equal(list.count, 1)
  assert.equal(list.items[0].id, task.id)

  const cancelled = await tasks.cancelTask(settings, task.id)
  assert.equal(cancelled.status, 'cancelled')
  const summary = await tasks.taskSummary(settings)
  assert.equal(summary.total, 1)
  assert.equal(summary.cancelled, 1)
})
