import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as store from '../src/store.js'
import * as profile from '../src/profile.js'
import { makeSettings } from './helpers.js'

test('ensureProfile：默认四个 collection + 分组（0.13.0）', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  const p = await profile.ensureProfile(settings)
  assert.deepEqual(p.collections.map((c) => c.id).sort(), ['decisions', 'facts', 'notes', 'projects'])
  assert.ok(p.groups.length >= 1)
  const file = path.join(memoryDir, 'index', 'profile.json')
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).version, 1)
})

test('writeProfile：自定义 collection 后 writeNote 落到 memory/<id>/（0.13.0）', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  const p = await profile.ensureProfile(settings)
  await profile.writeProfile(settings, {
    ...p,
    collections: [...p.collections, { id: 'research', label: '研究', icon: '◇', color: '#9ad0ff', order: 50 }],
    groups: [...p.groups, { id: 'research', label: '研究', collections: ['research'] }],
  })
  await profile.ensureCollectionDirs(settings, await profile.readProfile(settings))

  const file = await store.writeNote(settings, { kind: 'research', title: '论文笔记', content: 'x' })
  assert.match(path.relative(memoryDir, file).replace(/\\/g, '/'), /^memory\/research\//)
  const attrs = store.parseFrontmatter(await fs.readFile(file, 'utf8')).attrs
  assert.equal(attrs.kind, 'research')
})

test('normalizeProfile：拒绝非法 id、补齐内置 collection（0.13.0）', () => {
  const p = profile.normalizeProfile({
    collections: [
      { id: '../escape', label: 'bad' },
      { id: 'ok', label: 'OK', color: 'nope' },
    ],
    groups: [{ id: 'g', label: 'G', collections: ['ok', 'missing'] }],
  })
  const ids = p.collections.map((c) => c.id)
  assert.ok(!ids.includes('../escape'))
  assert.ok(ids.includes('facts') && ids.includes('ok'))
  assert.equal(p.groups[0].collections.join(','), 'ok')
  assert.match(p.collections.find((c) => c.id === 'ok').color, /^#[0-9a-f]{6}$/i)
})
