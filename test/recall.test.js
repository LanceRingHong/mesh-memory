import test from 'node:test'
import assert from 'node:assert/strict'
import { makeSettings, writeMemoryFile, memoryDoc } from './helpers.js'
import { buildRecall } from '../src/recall.js'
import { ensureLayout } from '../src/store.js'

const NOW = Date.now()

test('有效性：supersededBy / future validAt / past invalidAt 不进召回（P1-8）', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings()
  t.after(cleanup)
  await ensureLayout(settings)

  const cases = [
    { token: 'plainvalid', extra: {}, included: true },
    { token: 'supersededone', extra: { supersededBy: 'memory/facts/newer.md', validAt: '2020-01-01T00:00:00.000Z' }, included: false },
    { token: 'futurevalid', extra: { validAt: '2999-01-01T00:00:00.000Z' }, included: false },
    { token: 'pastinvalid', extra: { invalidAt: '2020-01-01T00:00:00.000Z' }, included: false },
    { token: 'futureinvalid', extra: { invalidAt: '2999-01-01T00:00:00.000Z' }, included: true },
  ]
  for (const [i, item] of cases.entries()) {
    await writeMemoryFile(
      memoryDir,
      `memory/facts/valid-${i}.md`,
      memoryDoc({ title: item.token, body: `the ${item.token} token`, extra: item.extra }),
      NOW - 10_000 + i,
    )
  }

  for (const item of cases) {
    const built = await buildRecall(settings, item.token)
    const hit = built.files.includes(`memory/facts/valid-${cases.indexOf(item)}.md`)
    assert.equal(hit, item.included, `${item.token} 的召回结果应为 ${item.included}`)
  }
})

test('候选数超过上限时按 mtime 倒序并标记 truncated（P1-5/P1-10）', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings({ maxRecallFiles: 10 })
  t.after(cleanup)
  await ensureLayout(settings)

  for (let i = 0; i < 30; i += 1) {
    await writeMemoryFile(
      memoryDir,
      `memory/facts/f${String(i).padStart(3, '0')}.md`,
      memoryDoc({ title: `filler ${i}`, body: 'nothing to see' }),
      NOW - 100_000 + i,
    )
  }
  await writeMemoryFile(
    memoryDir,
    'memory/facts/newest.md',
    memoryDoc({ title: 'newest', body: 'the freshtoken is here' }),
    NOW,
  )

  const built = await buildRecall(settings, 'freshtoken')
  assert.equal(built.truncated, true, '超过上限必须显式标记 truncated')
  assert.ok(built.files.includes('memory/facts/newest.md'), '新记忆必须优先进入候选')
})

test('默认上限下 300 条记忆不影响新记忆召回（P1-5）', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings()
  t.after(cleanup)
  await ensureLayout(settings)

  for (let i = 0; i < 300; i += 1) {
    await writeMemoryFile(
      memoryDir,
      `memory/facts/f${String(i).padStart(3, '0')}.md`,
      memoryDoc({ title: `filler ${i}`, body: 'nothing to see' }),
      NOW - 1_000_000 + i * 1000,
    )
  }
  await writeMemoryFile(
    memoryDir,
    'memory/facts/zzz-needle.md',
    memoryDoc({ title: 'needle', body: 'the needle-xyzzy token' }),
    NOW,
  )

  const built = await buildRecall(settings, 'needle')
  assert.ok(built.files.includes('memory/facts/zzz-needle.md'), '第 301 条记忆仍应被召回')
  assert.ok(!built.truncated)
})

// P1-6：曾经仅凭 is/the 就能召回“煮意面”。
test('停用词不会带来无关召回（P1-6）', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings()
  t.after(cleanup)
  await ensureLayout(settings)
  await writeMemoryFile(
    memoryDir,
    'memory/facts/pasta.md',
    memoryDoc({ title: 'Pasta', body: 'This is the pasta cooking guide. 如何煮意面。' }),
    NOW,
  )

  const built = await buildRecall(settings, 'what is the deployment command')
  assert.deepEqual(built.files, [])
})

test('召回分数门槛可配置（P1-6）', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings({ recallMinScore: 999 })
  t.after(cleanup)
  await ensureLayout(settings)
  await writeMemoryFile(
    memoryDir,
    'memory/facts/one.md',
    memoryDoc({ title: 'unique', body: 'the raritytoken appears once' }),
    NOW,
  )

  const gated = await buildRecall(settings, 'raritytoken')
  assert.deepEqual(gated.files, [], '高于门槛时不应注入')

  const relaxed = await buildRecall({ ...settings, recallMinScore: 0 }, 'raritytoken')
  assert.ok(relaxed.files.includes('memory/facts/one.md'), '门槛为 0 时应正常召回')
})

test('超大单文件被跳过而不是拖垮召回（P1-10）', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings({ maxRecallFileBytes: 2000 })
  t.after(cleanup)
  await ensureLayout(settings)
  await writeMemoryFile(
    memoryDir,
    'memory/facts/huge.md',
    memoryDoc({ title: 'huge', body: `hugefiller ${'x'.repeat(5000)}` }),
    NOW,
  )
  await writeMemoryFile(
    memoryDir,
    'memory/facts/small.md',
    memoryDoc({ title: 'small', body: 'the smalltoken here' }),
    NOW,
  )

  const built = await buildRecall(settings, 'hugefiller')
  assert.deepEqual(built.files, [], '超限文件应被跳过')
  const small = await buildRecall(settings, 'smalltoken')
  assert.ok(small.files.includes('memory/facts/small.md'))
})

test('召回缓存按 mtime/size 失效，不会返回旧内容（P1-10）', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings()
  t.after(cleanup)
  await ensureLayout(settings)
  const rel = 'memory/facts/cache.md'
  await writeMemoryFile(memoryDir, rel, memoryDoc({ title: 'cache', body: 'the cachetoken v1' }), NOW - 5000)
  const first = await buildRecall(settings, 'cachetoken')
  assert.ok(first.files.includes(rel), '首次应命中')
  assert.match(first.text, /v1/)

  // 同路径改写 + 更新 mtime：缓存必须失效
  await writeMemoryFile(memoryDir, rel, memoryDoc({ title: 'cache', body: 'the cachetoken v2' }), NOW)
  const second = await buildRecall(settings, 'cachetoken')
  assert.match(second.text, /v2/, '改写后应读到新内容')

  // 新增文件也要进入候选
  await writeMemoryFile(memoryDir, 'memory/facts/fresh.md', memoryDoc({ title: 'fresh', body: 'brandnewtoken' }), NOW + 5000)
  const third = await buildRecall(settings, 'brandnewtoken')
  assert.ok(third.files.includes('memory/facts/fresh.md'))
})
