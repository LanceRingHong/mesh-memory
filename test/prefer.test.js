import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { makeSettings, writeMemoryFile, memoryDoc } from './helpers.js'
import { setPreference } from '../src/prefer.js'
import { parseFrontmatter } from '../src/store.js'

const read = async (memoryDir, rel) => parseFrontmatter(await fs.readFile(path.join(memoryDir, rel), 'utf8'))

test('偏好：首次写入进 baseline 且带「偏好」标签', async (t) => {
  const { settings, memoryDir, cleanup } = await makeSettings()
  t.after(cleanup)

  const result = await setPreference(settings, {
    topic: '打字方式',
    directive: 'Prefer 口语输入，由 agent 成稿；不要让我敲长文。',
  })
  assert.equal(result.action, 'created')
  assert.equal(result.superseded.length, 0)

  const doc = await read(memoryDir, result.path)
  assert.equal(doc.attrs.baseline, true)
  assert.equal(doc.attrs.memoryType, 'user')
  assert.ok(doc.attrs.tags.includes('偏好'))
  assert.ok(doc.attrs.tags.includes('打字方式'))
  assert.match(doc.body, /口语输入/)
})

test('偏好：同主题再次写入时就地更新，不新增文件', async (t) => {
  const { settings, memoryDir, cleanup } = await makeSettings()
  t.after(cleanup)

  const first = await setPreference(settings, { topic: '分类粒度', directive: 'Never 让我分类；分类交给 agent。' })
  const second = await setPreference(settings, { topic: '分类粒度', directive: 'Never 让我分类；最多 4 个域。' })

  assert.equal(second.action, 'updated')
  assert.equal(second.path, first.path)

  const files = (await fs.readdir(path.join(memoryDir, 'memory/facts'))).filter((name) => name.endsWith('.md'))
  assert.equal(files.length, 1, '同主题只应有一个文件')

  const doc = await read(memoryDir, second.path)
  assert.match(doc.body, /最多 4 个域/)
  assert.doesNotMatch(doc.body, /分类交给 agent/, '旧内容应被替换而不是追加')
})

test('偏好：历史上重复的同主题条目会被 supersede', async (t) => {
  const { settings, memoryDir, cleanup } = await makeSettings()
  t.after(cleanup)
  const older = { kind: 'facts', permalink: 'pref-old', tags: ['偏好', '汇报格式'], updatedAt: '2026-01-01T00:00:00.000Z' }
  const newer = { kind: 'facts', permalink: 'pref-new', tags: ['偏好', '汇报格式'], updatedAt: '2026-06-01T00:00:00.000Z' }
  await writeMemoryFile(memoryDir, 'memory/facts/pref-a.md', memoryDoc({ title: '偏好：汇报格式', body: '旧说法 A', extra: older }))
  await writeMemoryFile(memoryDir, 'memory/facts/pref-b.md', memoryDoc({ title: '偏好：汇报格式', body: '旧说法 B', extra: newer }))

  const result = await setPreference(settings, { topic: '汇报格式', directive: 'Prefer 先结论后依据，不超过一屏。' })
  assert.equal(result.action, 'updated')
  assert.equal(result.path, 'memory/facts/pref-b.md', '应更新最新的一条')
  assert.deepEqual(result.superseded, ['memory/facts/pref-a.md'])

  const stale = await read(memoryDir, 'memory/facts/pref-a.md')
  assert.ok(stale.attrs.invalidAt, '旧条目应标记失效时间')
  assert.equal(stale.attrs.supersededBy, 'memory/facts/pref-b.md')
})

test('偏好：缺 topic / directive 时拒绝', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await assert.rejects(() => setPreference(settings, { directive: 'x' }), /topic 必填/)
  await assert.rejects(() => setPreference(settings, { topic: 'y' }), /directive 必填/)
})
