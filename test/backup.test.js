import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { makeSettings } from './helpers.js'
import { ensureLayout } from '../src/store.js'
import { listSnapshots, restoreSnapshot, snapshot } from '../src/backup.js'

test('git 快照：首次提交、无变化跳过、列表可读', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings()
  t.after(cleanup)
  await ensureLayout(settings)
  await fs.writeFile(path.join(memoryDir, 'memory', 'facts', 'a.md'), 'v1\n', 'utf8')

  const first = await snapshot(settings, 'test')
  assert.equal(first.changed, true)
  assert.match(first.commit, /^[0-9a-f]{7,}$/)

  const second = await snapshot(settings, 'test')
  assert.equal(second.changed, false)

  const list = await listSnapshots(settings)
  assert.equal(list.length, 1)
  assert.match(list[0].message, /^snapshot:/)
})

test('git 还原：回到指定快照并保留还原前快照', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings()
  t.after(cleanup)
  await ensureLayout(settings)
  const file = path.join(memoryDir, 'memory', 'facts', 'a.md')
  await fs.writeFile(file, 'v1\n', 'utf8')
  const first = await snapshot(settings, 'test')

  await fs.writeFile(file, 'v2\n', 'utf8')
  const changed = await snapshot(settings, 'test')
  assert.equal(changed.changed, true)

  const restored = await restoreSnapshot(settings, first.commit, { confirm: true })
  assert.equal(restored.restored, first.commit)
  assert.equal(await fs.readFile(file, 'utf8'), 'v1\n')

  const list = await listSnapshots(settings)
  assert.ok(list.length >= 3, '应包含首次、v2、还原前、还原后')
})

test('还原必须显式 confirm', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await ensureLayout(settings)
  await assert.rejects(() => restoreSnapshot(settings, 'abcdef1', {}), /confirm/)
})
